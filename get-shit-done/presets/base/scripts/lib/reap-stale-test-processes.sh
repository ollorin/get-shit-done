# shellcheck shell=bash
# =============================================================================
# reap-stale-test-processes.sh — automatic, provably-safe stale test-process
# reaper
# =============================================================================
# NOTE: this file is sourced by bash, never executed directly (no shebang, no exec bit).
#
# WHAT THIS IS: exactly three worker classes get AUTOMATIC, no-human-in-the-
# loop kill treatment — a test-runner process whose command contains an entry of
# stack.host.worker_patterns (W1; an empty or absent list matches nothing), a
# headless `claude --print` process (W2), and a Puppeteer-launched
# Chrome-for-Testing main process (W3) — and ONLY when a one-`ps`-snapshot ownership walk proves
# every ancestor between the candidate and PID 1 is either PASS-THROUGH (a
# plain shell/task-runner wrapper) or simply absent. Any OWNER pattern, any
# live human terminal, any UNRECOGNIZED ancestor, or a walk that cannot be
# completed (depth cap, cycle, vanished ancestor) makes the candidate
# PROTECTED. Fail-safe direction: a misclassification can only under-kill,
# never kill something a live process still owns.
#
# Safety primitive (why not `PPID==1` on the worker itself): a bucket's
# test runner runs inside a backgrounded subshell of the owning script.
# When the owning runner is SIGKILLed, the worker's PARENT is the orphaned
# subshell, not PID 1 — so this walks the FULL ancestor chain to PID 1, not
# just one hop.
#
# Every fallible statement in the public entry points is `|| true`-guarded —
# callers run under `set -euo pipefail`, so a bare failing command here would abort the caller.
# Every `"${arr[@]}"` expansion on a possibly-EMPTY array is guarded via the
# `${arr[@]+"${arr[@]}"}` idiom (same convention as
# the same convention as the callers' own array handling) — macOS ships bash 3.2,
# where an empty array's `[@]` expansion is "unbound variable" under
# `set -u`, which the real call sites set.
#
# Platform: macOS and Linux (procps). The library reads `ps` keywords `pid ppid pgid tty stat etime time rss command lstart`;
# a platform whose `ps` lacks one prints UNSUPPORTED PLATFORM: <uname> and reaps nothing (protected, the fail-safe direction).
#
# Config (.planning/config.json, read once per sweep; unreadable or non-JSON config reaps nothing): stack.host.worker_patterns
# (W1 commands) and stack.host.protected_patterns (commands that are owners: the walk stops there and nothing under them is reaped).
#
# Escape hatches (env vars):
#   STALE_REAPER_DISABLE           any non-empty value: sweep does nothing
#   STALE_REAPER_DRY_RUN            any non-empty value: classify + log, never signal
#   STALE_REAPER_MIN_AGE_SECONDS    race-floor age before a candidate is even considered (default 600)
#   STALE_REAPER_GRACE_SECONDS      SIGTERM->SIGKILL grace period (default 5)
#   STALE_REAPER_PROJECT_ROOT       root a W1/W2/W3 process's cwd must be under (default <repo-root>); config stack.host.project_pattern is the alternative command match
#   STALE_REAPER_CMD_FILTER         only candidates whose command line contains this substring (default: all)
#   STALE_REAPER_CONFIG             config file path (default <repo-root>/.planning/config.json)
#   STALE_REAPER_AUDIT_DIR          audit directory (default <repo-root>/.tmp/stale-reaper)
#   MIN_FREE_DISK_GIB               require_free_disk_space threshold (default 3, 0 disables)
#
# Audit: one JSONL line per sweep decision, appended to
# <audit dir>/<YYYYMMDD>.jsonl.
# =============================================================================

_REAP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_REAP_REPO_ROOT="$(cd "${_REAP_LIB_DIR}/../.." && pwd)"

# Indirection so the canary can override just the `-o lstart=` identity-check
# call (simulating PID reuse) without needing to fake the entire process
# table. Every other library call goes through the real `ps`.
_reap_ps() { command ps "$@"; }

# ---------------------------------------------------------------------------
# collect_descendants / kill_process_tree — moved verbatim (behavior-wise)
# from a batch runner's own copy, made nounset-safe (the real call sites run
# under `set -u`), with an added PID-identity (lstart) re-check ahead of each signal
# in kill_process_tree — harmless for a caller
# that never passes the extra arguments, since the check is then skipped.
# ---------------------------------------------------------------------------

collect_descendants() {
  local root="$1"
  local ps_snapshot
  ps_snapshot="$(_reap_ps -Ao pid=,ppid= 2>/dev/null)" || ps_snapshot=""
  local frontier=("$root")
  local seen=" ${root} "
  local found=()
  while [ "${#frontier[@]}" -gt 0 ]; do
    local next=()
    local parent
    for parent in "${frontier[@]+"${frontier[@]}"}"; do
      local pid ppid
      while read -r pid ppid; do
        [ -z "${pid:-}" ] && continue
        if [ "$ppid" = "$parent" ] && [[ "$seen" != *" ${pid} "* ]]; then
          seen="${seen}${pid} "
          found+=("$pid")
          next+=("$pid")
        fi
      done <<< "$ps_snapshot"
    done
    frontier=("${next[@]+"${next[@]}"}")
  done
  printf '%s\n' "${found[@]+"${found[@]}"}"
}

kill_process_tree() {
  local root_pid="$1"
  local grace_s="${2:-5}"
  local expected_root_lstart="${3:-}"
  local caller="${4:-}"

  local descendants=()
  local pid
  while IFS= read -r pid; do [ -n "$pid" ] && descendants+=("$pid"); done < <(collect_descendants "$root_pid")
  local all=("$root_pid" "${descendants[@]+"${descendants[@]}"}")

  # Root FIRST, children after. Killing a child first lets a root that respawns
  # its children (`while true; do sleep 3600 & wait; done` is the real-world
  # shape: an integration bucket restarting its worker) spawn a replacement
  # that this snapshot never saw - it then outlives the tree kill as an orphan
  # reparented to launchd. Signalling the root first closes that window: it
  # cannot spawn anything more once it is gone.
  local i
  for ((i=0; i<${#all[@]}; i++)); do
    local target="${all[i]}"
    if [ "$target" = "$root_pid" ] && [ -n "$expected_root_lstart" ]; then
      local cur_lstart
      cur_lstart="$(_reap_ps -o lstart= -p "$target" 2>/dev/null)" || cur_lstart=""
      if [ "$cur_lstart" != "$expected_root_lstart" ]; then
        if [ -n "$caller" ] && declare -f reap_audit_log >/dev/null 2>&1; then
          reap_audit_log "$caller" "$target" "" "" "" "" "" "pid_reused" "lstart mismatch before SIGTERM" || true
        fi
        continue
      fi
    fi
    kill -TERM "$target" 2>/dev/null || true
  done

  sleep "$grace_s"

  local still=()
  while IFS= read -r pid; do [ -n "$pid" ] && still+=("$pid"); done < <(collect_descendants "$root_pid")
  unset pid
  local survivors=("$root_pid" "${still[@]+"${still[@]}"}")
  # Root first here too - a SIGTERM-ignoring root keeps respawning between the
  # grace sleep and this escalation, so the same orphan window applies.
  for ((i=0; i<${#survivors[@]}; i++)); do
    local target="${survivors[i]}"
    if kill -0 "$target" 2>/dev/null; then
      if [ "$target" = "$root_pid" ] && [ -n "$expected_root_lstart" ]; then
        local cur_lstart2
        cur_lstart2="$(_reap_ps -o lstart= -p "$target" 2>/dev/null)" || cur_lstart2=""
        if [ "$cur_lstart2" != "$expected_root_lstart" ]; then
          if [ -n "$caller" ] && declare -f reap_audit_log >/dev/null 2>&1; then
            reap_audit_log "$caller" "$target" "" "" "" "" "" "pid_reused" "lstart mismatch before SIGKILL" || true
          fi
          continue
        fi
      fi
      kill -KILL "$target" 2>/dev/null || true
    fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# Config and platform
# ---------------------------------------------------------------------------

REAP_WORKER_PATTERNS=()
REAP_PROTECTED_PATTERNS=()
REAP_PROJECT_PATTERN=""
_REAP_CONFIG_LOADED=""

# One JSON.parse of the config. Returns 1 (and prints the cause) on an unreadable or non-JSON config or a list of the
# wrong shape; the arrays are then left empty and the callers reap nothing.
reap_load_config() {
  [ "$_REAP_CONFIG_LOADED" = "yes" ] && return 0
  local cfg="${STALE_REAPER_CONFIG:-${_REAP_REPO_ROOT}/.planning/config.json}"
  local out
  out="$(node -e '
const fs = require("fs");
let c;
try { c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { console.error("config unreadable or not JSON: " + e.message); process.exit(1); }
const host = (c && c.stack && c.stack.host) || {};
for (const k of ["worker_patterns", "protected_patterns"]) {
  const v = host[k];
  if (v === undefined) continue;
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string" && s.length > 0 && !s.includes("\n"))) { console.error("stack.host." + k + " must be an array of non-empty strings"); process.exit(1); }
  for (const s of v) console.log(k + ":" + s);
}
const pp = host.project_pattern;
if (pp !== undefined) {
  if (typeof pp !== "string" || pp.length === 0 || pp.includes("\n")) { console.error("stack.host.project_pattern must be a non-empty string"); process.exit(1); }
  console.log("project_pattern:" + pp);
}' "$cfg" 2>&1)" || { echo "[stale-reaper] $out (config $cfg): nothing reaped" >&2; return 1; }
  REAP_WORKER_PATTERNS=()
  REAP_PROTECTED_PATTERNS=()
  REAP_PROJECT_PATTERN=""
  local line
  while IFS= read -r line; do
    case "$line" in
      project_pattern:*)    REAP_PROJECT_PATTERN="${line#project_pattern:}" ;;
      worker_patterns:*)    REAP_WORKER_PATTERNS+=("${line#worker_patterns:}") ;;
      protected_patterns:*) REAP_PROTECTED_PATTERNS+=("${line#protected_patterns:}") ;;
    esac
  done <<< "$out"
  _REAP_CONFIG_LOADED="yes"
  return 0
}

# 0 when this platform's ps answers every keyword the library reads; otherwise prints UNSUPPORTED PLATFORM and returns 1.
reap_platform_supported() {
  local os
  os="$(uname -s 2>/dev/null)" || os="unknown"
  case "$os" in
    Darwin|Linux)
      if _reap_ps -Awwo pid=,ppid=,pgid=,tty=,stat=,etime=,time=,rss=,command= -p "$$" >/dev/null 2>&1 \
        && [ -n "$(_reap_ps -o lstart= -p "$$" 2>/dev/null)" ]; then
        return 0
      fi ;;
  esac
  echo "UNSUPPORTED PLATFORM: $os"
  return 1
}

# ---------------------------------------------------------------------------
# ps snapshot + parsing helpers
# ---------------------------------------------------------------------------

# One double-`-w` snapshot (macOS ps truncates the COMMAND column to terminal
# width without it), reshaped
# by awk into `pid|ppid|pgid|tty|stat|etime|cputime|rss|command` lines so the
# rest of the library can parse with a plain `IFS='|' read`.
reap_ps_snapshot() {
  _reap_ps -Awwo pid=,ppid=,pgid=,tty=,stat=,etime=,time=,rss=,command= 2>/dev/null | awk '
  {
    pid=$1; ppid=$2; pgid=$3; tty=$4; stat=$5; etime=$6; cputime=$7; rss=$8;
    $1=$2=$3=$4=$5=$6=$7=$8="";
    sub(/^ +/,"");
    print pid "|" ppid "|" pgid "|" tty "|" stat "|" etime "|" cputime "|" rss "|" $0
  }'
}

reap_ps_line_for_pid() {
  local snapshot="$1" target="$2"
  local line
  while IFS= read -r line; do
    case "$line" in
      "${target}|"*) printf '%s\n' "$line"; return 0 ;;
    esac
  done <<< "$snapshot"
  return 1
}

# Converts a ps `etime=`/`time=` field ([[dd-]hh:]mm:ss[.ff]) to whole
# seconds. `10#` prefixes avoid octal misinterpretation of zero-padded
# fields (e.g. "08").
reap_etime_to_seconds() {
  local e="$1"
  # `ps -o time=` (unlike the awk-reshaped etime field inside
  # reap_ps_snapshot, whose default field-splitting already trims this) pads
  # its raw output with leading whitespace on macOS (verified: "  0:00.00") —
  # trim both ends before parsing, or the arithmetic below hits a bash
  # syntax error on the embedded spaces.
  e="${e#"${e%%[![:space:]]*}"}"
  e="${e%"${e##*[![:space:]]}"}"
  local days=0 hh=0 mm=0 ss=0
  case "$e" in
    *-*) days="${e%%-*}"; e="${e#*-}" ;;
  esac
  local ncolons
  ncolons="$(printf '%s' "$e" | awk -F: '{print NF-1}')"
  case "$ncolons" in
    2) hh="${e%%:*}"; local rest="${e#*:}"; mm="${rest%%:*}"; ss="${rest#*:}" ;;
    1) mm="${e%%:*}"; ss="${e#*:}" ;;
    *) ss="$e" ;;
  esac
  ss="${ss%%.*}"
  [ -z "$days" ] && days=0
  [ -z "$hh" ] && hh=0
  [ -z "$mm" ] && mm=0
  [ -z "$ss" ] && ss=0
  echo $(( 10#${days} * 86400 + 10#${hh} * 3600 + 10#${mm} * 60 + 10#${ss} ))
}

# ---------------------------------------------------------------------------
# Classification — Section 2/3 of the plan.
# ---------------------------------------------------------------------------
# Sets REAP_CLASS to one of:
#   OWNER          walk stops here; candidate/ancestor is protected
#   PASS_THROUGH   walk continues to this process's PPID
#   UNKNOWN        fail-safe: treated as OWNER (protected) by the walk
#   CANDIDATE_W1   a stack.host.worker_patterns match
#   CANDIDATE_W2   headless claude --print
#   CANDIDATE_W3   Chrome-for-Testing main
reap_tty_is_none() {
  case "$1" in
    '??'|'?'|''|'-') return 0 ;;
    *) return 1 ;;
  esac
}

reap_classify() {
  local command="$1" tty="$2"
  local argv0 argv0base rest argv1

  argv0="${command%% *}"
  argv0base="${argv0##*/}"
  if [ "$command" != "$argv0" ]; then
    rest="${command#* }"
  else
    rest=""
  fi
  argv1="${rest%% *}"
  [ "$rest" = "$command" ] && argv1=""

  case "$command" in
    *scripts/pre-pr-gate.sh*|*scripts/session-supervisor.sh*|*scripts/stack-lock.sh*|*scripts/stack-lock.mjs*|*scripts/reap-stale.sh*)
      REAP_CLASS="OWNER"; return 0 ;;
  esac
  local pat
  for pat in ${REAP_PROTECTED_PATTERNS[@]+"${REAP_PROTECTED_PATTERNS[@]}"}; do
    case "$command" in *"$pat"*) REAP_CLASS="OWNER"; return 0 ;; esac
  done

  if [ "$argv0base" = "claude" ]; then
    local has_print=false tok
    for tok in $command; do
      case "$tok" in --print|-p) has_print=true; break ;; esac
    done
    if $has_print && reap_tty_is_none "$tty"; then
      REAP_CLASS="CANDIDATE_W2"
    else
      REAP_CLASS="OWNER"
    fi
    return 0
  fi

  # Known, deliberate completeness gap (proven empirically, not assumed —
  # canary fixture F3): once a pty session's leader dies, `ps` keeps
  # reporting the ORIGINAL tty (not `??`) for a surviving child, and the
  # `/dev/$tty` device node keeps existing. So a process that inherited a
  # real pty and outlives its session stays classified OWNER here (never
  # auto-reaped) even though its terminal is genuinely gone. Left as-is per
  # the fail-safe direction (D2: under-kill, never over-kill) rather than
  # adding a more invasive liveness probe — none of the real call sites
  # (the deployed gate, supervisor and lock scripts) ever launch a candidate
  # through a pty wrapper, so this gap cannot arise from this reaper's actual callers.
  if ! reap_tty_is_none "$tty" && [ -e "/dev/$tty" ]; then
    REAP_CLASS="OWNER"
    return 0
  fi

  case "$argv0base" in
    sh|bash|zsh|dash|env|nohup|timeout|tee|xargs)
      REAP_CLASS="PASS_THROUGH"; return 0 ;;
  esac
  for pat in ${REAP_WORKER_PATTERNS[@]+"${REAP_WORKER_PATTERNS[@]}"}; do
    case "$command" in *"$pat"*) REAP_CLASS="CANDIDATE_W1"; return 0 ;; esac
  done

  case "$argv0" in
    */.cache/puppeteer/chrome/*)
      case "$argv0base" in
        chrome_crashpad_handler) REAP_CLASS="UNKNOWN"; return 0 ;;
      esac
      case "$command" in
        *--type=*) REAP_CLASS="UNKNOWN"; return 0 ;;
      esac
      case "$command" in
        *--user-data-dir=*puppeteer_dev_chrome_profile-*)
          REAP_CLASS="CANDIDATE_W3"; return 0 ;;
      esac
      ;;
  esac

  REAP_CLASS="UNKNOWN"
  return 0
}

# Walks from a candidate's PPID toward PID 1 within ONE already-captured
# snapshot. Returns 0 (ORPHAN) or 1 (PROTECTED — OWNER/UNKNOWN/cycle/depth-cap
# /vanished ancestor, all fail-safe). Sets REAP_CHAIN to a human-readable
# "pid:basename,pid:basename,...,1:pid1" trail for the audit log.
reap_walk_owner() {
  local start_ppid="$1"
  local snapshot="$2"
  local depth=0
  local max_depth=32
  local cur="$start_ppid"
  local seen=" "
  REAP_CHAIN=""

  while :; do
    if [ "$cur" = "1" ] || [ -z "$cur" ]; then
      REAP_CHAIN="${REAP_CHAIN}1:pid1"
      return 0
    fi
    depth=$((depth + 1))
    if [ "$depth" -gt "$max_depth" ]; then
      REAP_CHAIN="${REAP_CHAIN}${cur}:depth-cap-exceeded"
      return 1
    fi
    case "$seen" in
      *" $cur "*) REAP_CHAIN="${REAP_CHAIN}${cur}:cycle"; return 1 ;;
    esac
    seen="${seen}${cur} "

    local line
    line="$(reap_ps_line_for_pid "$snapshot" "$cur")" || line=""
    if [ -z "$line" ]; then
      REAP_CHAIN="${REAP_CHAIN}${cur}:vanished-ancestor"
      return 1
    fi
    local p pp pg tty stat etimes cputime rss cmd
    IFS='|' read -r p pp pg tty stat etimes cputime rss cmd <<< "$line"
    local base="${cmd%% *}"; base="${base##*/}"
    REAP_CHAIN="${REAP_CHAIN}${p}:${base},"

    case "$stat" in
      *Z*) cur="$pp"; continue ;;
    esac

    reap_classify "$cmd" "$tty"
    case "$REAP_CLASS" in
      OWNER) return 1 ;;
      PASS_THROUGH) cur="$pp"; continue ;;
      *) return 1 ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Scope and self-protection
# ---------------------------------------------------------------------------

# Working directory of a pid ("" when unreadable: out of scope, the fail-safe direction).
reap_pid_cwd() {
  local pid="$1" d=""
  if [ -e "/proc/$pid/cwd" ]; then
    d="$(cd "/proc/$pid/cwd" 2>/dev/null && pwd -P)" || d=""
  elif command -v lsof >/dev/null 2>&1; then
    d="$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)" || d=""
  fi
  printf '%s' "$d"
}

# 0 when a worker (W1), headless-agent (W2) or browser (W3) process belongs to THIS project: its cwd is under the project root
# (STALE_REAPER_PROJECT_ROOT, default the repo root of this library) or its command contains stack.host.project_pattern.
reap_in_scope() {
  local pid="$2" cmd="$3"
  if [ -n "$REAP_PROJECT_PATTERN" ]; then
    case "$cmd" in *"$REAP_PROJECT_PATTERN"*) return 0 ;; esac
  fi
  local root cwd
  root="$(cd "${STALE_REAPER_PROJECT_ROOT:-$_REAP_REPO_ROOT}" 2>/dev/null && pwd -P)" || return 1
  cwd="$(reap_pid_cwd "$pid")"
  [ -n "$cwd" ] || return 1
  case "$cwd" in "$root"|"$root"/*) return 0 ;; esac
  return 1
}

# Prints " pid pid ... " for this process and every ancestor in the snapshot: never a candidate.
reap_self_ancestors() {
  local snapshot="$1" cur="$$" out=" " n=0 line p pp
  while [ -n "$cur" ] && [ "$cur" != "0" ] && [ "$n" -lt 64 ]; do
    out="${out}${cur} "
    line="$(reap_ps_line_for_pid "$snapshot" "$cur")" || break
    IFS='|' read -r p pp _ <<< "$line"
    [ "$pp" = "$cur" ] && break
    cur="$pp"; n=$((n + 1))
  done
  printf '%s' "$out"
}

# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------

# JSON string escape for the audit line: backslash, double quote, then control characters dropped.
reap_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'
}

reap_audit_log() {
  {
    local caller="$1" pid="$2" class="$3" cmd="$4" etimes="$5" cputime="$6" rss="$7" decision="$8" reason="$9"
    local dir="${STALE_REAPER_AUDIT_DIR:-${_REAP_REPO_ROOT}/.tmp/stale-reaper}"
    mkdir -p "$dir" 2>/dev/null || return 0
    local day ts
    day="$(date -u +%Y%m%d 2>/dev/null)" || day="unknown"
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || ts=""
    local argv_trunc="${cmd:0:512}"
    local etime_s=0 cputime_s=0
    [ -n "$etimes" ] && etime_s="$(reap_etime_to_seconds "$etimes" 2>/dev/null)" && [ -n "$etime_s" ] || etime_s=0
    [ -n "$cputime" ] && cputime_s="$(reap_etime_to_seconds "$cputime" 2>/dev/null)" && [ -n "$cputime_s" ] || cputime_s=0
    local rss_kb="${rss:-0}"
    case "$rss_kb" in ''|*[!0-9]*) rss_kb=0 ;; esac
    printf '{"ts":"%s","caller":"%s","pid":"%s","class":"%s","argv":"%s","chain":"%s","etime_s":%s,"cputime_s":%s,"rss_kb":%s,"decision":"%s","reason":"%s"}\n' \
      "$ts" "$(reap_json_escape "$caller")" "$(reap_json_escape "${pid:-}")" "$class" "$(reap_json_escape "$argv_trunc")" \
      "$(reap_json_escape "${REAP_CHAIN:-}")" "${etime_s:-0}" "${cputime_s:-0}" "${rss_kb:-0}" "$decision" "$(reap_json_escape "$reason")" \
      >> "${dir}/${day}.jsonl" 2>/dev/null || true
  } || true
  return 0
}

# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

reap_stale_test_processes() {
  local caller="${1:-unknown}"
  _reap_stale_test_processes_impl "$caller" || true
  return 0
}

_reap_stale_test_processes_impl() {
  local caller="$1"
  [ -n "${STALE_REAPER_DISABLE:-}" ] && return 0

  reap_load_config || return 0
  reap_platform_supported || return 0

  local min_age="${STALE_REAPER_MIN_AGE_SECONDS:-600}"
  local grace="${STALE_REAPER_GRACE_SECONDS:-5}"
  local dry_run=false
  [ -n "${STALE_REAPER_DRY_RUN:-}" ] && dry_run=true

  local snapshot
  snapshot="$(reap_ps_snapshot)" || return 0
  [ -n "$snapshot" ] || return 0

  local killed=0 protected=0 young=0 dry=0
  local pid ppid pgid tty stat etimes cputime rss cmd
  local self_chain
  self_chain="$(reap_self_ancestors "$snapshot")"

  while IFS='|' read -r pid ppid pgid tty stat etimes cputime rss cmd; do
    [ -z "${pid:-}" ] && continue
    [ "$pid" = "$$" ] && continue
    case "$stat" in *Z*) continue ;; esac

    reap_classify "$cmd" "$tty"
    local class="$REAP_CLASS"
    case "$class" in
      CANDIDATE_W1|CANDIDATE_W2|CANDIDATE_W3) : ;;
      *) continue ;;
    esac
    [ -n "${STALE_REAPER_CMD_FILTER:-}" ] && [[ "$cmd" != *"${STALE_REAPER_CMD_FILTER}"* ]] && continue
    if [[ "$self_chain" == *" ${pid} "* ]]; then
      protected=$((protected + 1))
      reap_audit_log "$caller" "$pid" "$class" "$cmd" "$etimes" "$cputime" "$rss" "protected" "reaper's own ancestor"
      continue
    fi
    if ! reap_in_scope "$class" "$pid" "$cmd"; then
      reap_audit_log "$caller" "$pid" "$class" "$cmd" "$etimes" "$cputime" "$rss" "out_of_scope" "cwd outside project root and no project_pattern match"
      continue
    fi

    local age_s
    age_s="$(reap_etime_to_seconds "$etimes")"
    if [ "$age_s" -lt "$min_age" ]; then
      young=$((young + 1))
      reap_audit_log "$caller" "$pid" "$class" "$cmd" "$etimes" "$cputime" "$rss" "young" "age ${age_s}s < floor ${min_age}s"
      continue
    fi

    if reap_walk_owner "$ppid" "$snapshot"; then
      : # ORPHAN — fall through to kill/dry-run handling
    else
      protected=$((protected + 1))
      reap_audit_log "$caller" "$pid" "$class" "$cmd" "$etimes" "$cputime" "$rss" "protected" "chain=${REAP_CHAIN}"
      continue
    fi

    if $dry_run; then
      dry=$((dry + 1))
      echo "[stale-reaper] would_kill pid=${pid} class=${class} age=${age_s}s cmd=${cmd:0:100}"
      reap_audit_log "$caller" "$pid" "$class" "$cmd" "$etimes" "$cputime" "$rss" "would_kill" "chain=${REAP_CHAIN}"
      continue
    fi

    local lstart_before
    lstart_before="$(_reap_ps -o lstart= -p "$pid" 2>/dev/null)" || lstart_before=""
    kill_process_tree "$pid" "$grace" "$lstart_before" "$caller"

    if kill -0 "$pid" 2>/dev/null; then
      reap_audit_log "$caller" "$pid" "$class" "$cmd" "$etimes" "$cputime" "$rss" "pid_reused" "still alive after kill attempt (identity mismatch or kill failed)"
    else
      killed=$((killed + 1))
      reap_audit_log "$caller" "$pid" "$class" "$cmd" "$etimes" "$cputime" "$rss" "kill" "chain=${REAP_CHAIN}"
    fi
  done <<< "$snapshot"

  if [ "$killed" -gt 0 ] || [ "$protected" -gt 0 ] || [ "$young" -gt 0 ] || [ "$dry" -gt 0 ]; then
    echo "[stale-reaper] killed=${killed} protected=${protected} young=${young} dry_run=${dry}"
  fi
  return 0
}

# Classification-only dump (no signals sent) for memory-guard.sh's report.
reap_stale_test_processes_report() {
  {
    reap_load_config || return 0
    reap_platform_supported || return 0
    local snapshot
    snapshot="$(reap_ps_snapshot)" || return 0
    [ -n "$snapshot" ] || { echo "  (no processes visible)"; return 0; }

    local min_age="${STALE_REAPER_MIN_AGE_SECONDS:-600}"
    local self_chain
    self_chain="$(reap_self_ancestors "$snapshot")"
    local any=false
    local pid ppid pgid tty stat etimes cputime rss cmd

    while IFS='|' read -r pid ppid pgid tty stat etimes cputime rss cmd; do
      [ -z "${pid:-}" ] && continue
      case "$stat" in *Z*) continue ;; esac
      reap_classify "$cmd" "$tty"
      local class="$REAP_CLASS"
      case "$class" in
        CANDIDATE_W1|CANDIDATE_W2|CANDIDATE_W3) : ;;
        *) continue ;;
      esac
      [ -n "${STALE_REAPER_CMD_FILTER:-}" ] && [[ "$cmd" != *"${STALE_REAPER_CMD_FILTER}"* ]] && continue
      [[ "$self_chain" == *" ${pid} "* ]] && continue
      reap_in_scope "$class" "$pid" "$cmd" || continue
      any=true
      local age_s verdict
      age_s="$(reap_etime_to_seconds "$etimes")"
      if [ "$age_s" -lt "$min_age" ]; then
        verdict="young"
      elif reap_walk_owner "$ppid" "$snapshot"; then
        verdict="would_kill"
      else
        verdict="protected"
      fi
      printf '  %-11s pid=%-8s age=%-6ss class=%-14s cmd=%s\n' "$verdict" "$pid" "$age_s" "$class" "${cmd:0:100}"
    done <<< "$snapshot"

    $any || echo "  (no W1/W2/W3 candidate processes found right now)"
  } || true
  return 0
}

# ---------------------------------------------------------------------------
# require_free_disk_space <caller> — refuse a heavy run on a nearly full disk.
# A full host disk takes the local container stack down (ENOSPC).
# Returns 1 (caller exits) when available space on the repo's volume is below
# MIN_FREE_DISK_GIB (default 3; 0 disables). Skipped on GitHub Actions, whose
# ephemeral runners are not the host this protects. An unreadable `df` fails
# open with a warning: the guard must never block work because it could not
# measure. FREE_DISK_CHECK_PATH overrides the measured path (canary use).
# ---------------------------------------------------------------------------
require_free_disk_space() {
  local caller="${1:-unknown}"
  local min_gib="${MIN_FREE_DISK_GIB:-3}"
  local check_path="${FREE_DISK_CHECK_PATH:-$_REAP_REPO_ROOT}"

  case "$min_gib" in
    ''|*[!0-9]*)
      echo "[disk-guard] MIN_FREE_DISK_GIB='${min_gib}' is not a whole number; using 3" >&2
      min_gib=3
      ;;
  esac
  min_gib=$((10#$min_gib))
  [ "$min_gib" -eq 0 ] && return 0
  [ "${GITHUB_ACTIONS:-}" = "true" ] && return 0

  local avail_kb=""
  avail_kb="$(df -Pk "$check_path" 2>/dev/null | awk 'NR==2 {print $4}')" || avail_kb=""
  case "$avail_kb" in
    ''|*[!0-9]*)
      echo "[disk-guard] could not read free space for ${check_path}; not blocking ${caller}" >&2
      return 0
      ;;
  esac

  local min_kb=$((min_gib * 1024 * 1024))
  local avail_gib=$((avail_kb / 1024 / 1024))
  if [ "$avail_kb" -lt "$min_kb" ]; then
    {
      echo "[disk-guard] REFUSING ${caller}: ${avail_gib} GiB free on ${check_path}, need ${min_gib} GiB."
      echo "[disk-guard] A full disk takes the local container stack down (ENOSPC). Free space first:"
      echo "[disk-guard]   clear regenerable dependency and build caches; prune unused images and build cache (see docs/gsd/host-ops.md)"
      echo "[disk-guard] Override (tight disk you accept): MIN_FREE_DISK_GIB=<n>, 0 disables."
    } >&2
    return 1
  fi
  return 0
}
