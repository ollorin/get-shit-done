#!/bin/bash
# =============================================================================
# Session-Limit Supervisor
# =============================================================================
# Problem this exists to fix (verified, not hypothetical): long-running agent
# work dies mid-flight whenever the Claude account hits a session/usage
# limit, and NOTHING resumes it automatically. GSD ships a pure parser for
# limit-death messages (`resilience parse-death` in gsd-tools.js) plus prose
# in workflows/*.md instructing an LLM orchestrator to sleep-loop and
# respawn -- but that orchestrator is exactly what the limit just killed, so
# the prose never runs, and foreground `sleep` is blocked inside the Claude
# Code harness anyway. Only a process OUTSIDE the Claude session can survive
# a session limit. This script is that process.
#
# What it does: runs a long command, tees its combined stdout+stderr to a
# log file AND the terminal, and after the command exits checks whether the
# failure looks like a session/usage/quota/rate-limit death (via a cheap
# local keyword pre-filter, THEN the authoritative parser --
# `node gsd-tools.js resilience parse-death` -- never its own regex for the
# reset time). If it's a limit death with a plausible reset time, it waits
# (polling in 60s increments, re-checking the wall clock every iteration so
# a laptop sleep or clock jump can't cause an overshoot) until just past the
# reset, then re-runs the SAME command with --resume-flag appended. It loops
# until the command exits 0, fails for an ordinary (non-limit) reason, or
# the resume attempt cap is reached.
#
# Usage:
#   scripts/session-supervisor.sh [options] -- <command...>
#
# Options:
#   --resume-flag <flag>   Flag appended to the command on every resume
#                           attempt (NOT the first run). Optional -- omit
#                           for a plain re-run with no flag.
#   --max-resumes <N>      Max resume attempts before giving up (default 5).
#   --log <path>           JSONL audit log path. Default:
#                           <repo-root>/.tmp/session-supervisor-<ts>-<pid>.jsonl
#                           Never point this at .planning/ -- that tree is
#                           reserved for GSD planning artifacts, not scratch
#                           logs. The raw child output log sits alongside it
#                           with a .output.log suffix per attempt.
#   --gsd-tools <path>      The gsd-tools.js used for `resilience parse-death`.
#                           Default: $GSD_TOOLS, else
#                           $HOME/.claude/get-shit-done/bin/gsd-tools.js.
#   --cleanup-cmd <cmd>     Shell command run before every attempt and once on
#                           exit (leaked-process or temp-profile cleanup). Its
#                           failure is ignored. Default: none.
#   --dry-run-wait          Verification/test mode: detect the death, compute
#                           the wait duration, log it -- but do NOT actually
#                           sleep. Proceeds straight to the resume attempt.
#                           Use this to test the full detect -> resume loop
#                           without burning hours of real wall-clock time.
#   -h, --help              Show this help and exit.
#
# Examples:
#   # A suite whose task bakes in a state reset: do NOT add a --resume-flag that
#   # the suite refuses in combination with that reset (the resume would exit
#   # non-zero and never actually resume). Wrap each batch of the suite in this
#   # script without --resume-flag, so a resume is a plain re-invocation.
#
#   # GSD roadmap execution (no resume flag -- gsd-tools.js resume state
#   # lives in .planning/ CHECKPOINT.json files, not a CLI flag):
#   scripts/session-supervisor.sh --max-resumes 8 -- \
#     claude --print "/gsd:execute-roadmap"
#
# Detached run (survives THIS terminal / THIS Claude session dying -- the
# entire point of this script):
#   nohup scripts/session-supervisor.sh -- <command...> \
#     > .tmp/session-supervisor-nohup.out 2>&1 < /dev/null &
#   disown
#   # or, if setsid is available (Linux; `brew install util-linux` on macOS):
#   setsid scripts/session-supervisor.sh -- <command...> \
#     > .tmp/session-supervisor-nohup.out 2>&1 < /dev/null &
#
# Exit codes:
#   0 = child eventually exited 0 (success, possibly after one or more waits)
#   1 = usage/setup error (bad args, no command given, missing dependency)
#   2 = child failed for an ordinary (non-limit) reason -- not treated as a
#       session-limit death
#   3 = a limit death was detected but the reset time is missing, unparseable,
#       already in the past, or beyond the 6-hour wait cap -- refused to sleep
#   4 = resume attempt cap reached without the child ever succeeding
#
# Safety caps (mirrors the precedent in
# ~/.claude/get-shit-done/workflows/execute-roadmap.md step 4a):
#   - Max single wait: 6 hours. Beyond that (or missing/past reset time),
#     exit 3 instead of sleeping -- a stuck supervisor is worse than a loud
#     failure.
#   - Max resume attempts: 5 by default (--max-resumes). Exit 4 once
#     exhausted so a pathological detect-wait-fail loop cannot run forever.
# =============================================================================

set -uo pipefail
# Deliberately NOT `set -e`: this script's entire job is to observe and act
# on a child command's non-zero exit, repeatedly, in a loop. Every fallible
# step below checks its own return code explicitly instead.

GSD_TOOLS="${GSD_TOOLS:-${HOME}/.claude/get-shit-done/bin/gsd-tools.js}"
POLL_INTERVAL_SECONDS=60
RESET_BUFFER_SECONDS=60
MAX_WAIT_SECONDS=$((6 * 3600))

R='\033[0;31m'  G='\033[0;32m'  Y='\033[1;33m'  C='\033[0;36m'  N='\033[0m'

print_help() {
  cat <<'HELP'
session-supervisor.sh -- survives Claude session/usage-limit deaths by
running OUTSIDE the Claude session, detecting the death, waiting for the
reset, and resuming. See the header comment at the top of this file for
the full rationale.

Usage:
  scripts/session-supervisor.sh [options] -- <command...>

Options:
  --resume-flag <flag>   Flag appended to the command on every resume
                          attempt (NOT the first run). Optional -- omit
                          for a plain re-run with no flag.
  --max-resumes <N>      Max resume attempts before giving up (default 5).
  --log <path>           JSONL audit log path. Default:
                          <repo-root>/.tmp/session-supervisor-<ts>-<pid>.jsonl
                          Never point this at .planning/. The raw child
                          output is captured alongside it, one file per
                          attempt, with a .attempt-N.output.log suffix.
  --gsd-tools <path>      The gsd-tools.js used for `resilience parse-death`
                          (default: $GSD_TOOLS, else the installed GSD path).
  --cleanup-cmd <cmd>     Shell command run before every attempt and once on
                          exit. Its failure is ignored. Default: none.
  --dry-run-wait          Verification mode: detect the death, compute the
                          wait, log it -- but do NOT actually sleep. Jumps
                          straight to the resume attempt.
  -h, --help              Show this help and exit.

Examples:
  # A suite whose task bakes in a state reset: wrap each batch without
  # --resume-flag, so a resume is a plain re-invocation.

  scripts/session-supervisor.sh --max-resumes 8 -- \
    claude --print "/gsd:execute-roadmap"

Detached run (survives THIS terminal / THIS Claude session dying):
  nohup scripts/session-supervisor.sh -- <command...> \
    > .tmp/session-supervisor-nohup.out 2>&1 < /dev/null &
  disown
  # or, if setsid is available (Linux; `brew install util-linux` on macOS):
  setsid scripts/session-supervisor.sh -- <command...> \
    > .tmp/session-supervisor-nohup.out 2>&1 < /dev/null &

Exit codes:
  0 = child eventually exited 0
  1 = usage/setup error
  2 = child failed for an ordinary (non-limit) reason
  3 = limit death detected but reset time missing/unparseable/past/beyond 6h
  4 = resume attempt cap reached without success
HELP
}

# -- Locate repo root (for the default log path) without cd'ing -- the child
# command must inherit the CALLER's cwd (a task may expect to run
# from a subdirectory), so we never `cd` in this script.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# -- Optional cleanup hook (--cleanup-cmd): runs before every attempt and on
# exit (success, failure, or early error). It is a shell command line, run
# with sh -c; its failure never changes the supervisor's exit code. --
CLEANUP_CMD=""
run_cleanup() {
  [ -n "$CLEANUP_CMD" ] || return 0
  sh -c "$CLEANUP_CMD" >/dev/null 2>&1 || true
}
trap 'run_cleanup' EXIT

# -- Parse args --
RESUME_FLAG=""
MAX_RESUMES=5
LOG_PATH=""
DRY_RUN_WAIT=false

while [ $# -gt 0 ]; do
  case "$1" in
    --resume-flag)  RESUME_FLAG="${2:-}"; shift 2 || { echo "Error: --resume-flag needs a value" >&2; exit 1; } ;;
    --max-resumes)  MAX_RESUMES="${2:-}"; shift 2 || { echo "Error: --max-resumes needs a value" >&2; exit 1; } ;;
    --log)          LOG_PATH="${2:-}";    shift 2 || { echo "Error: --log needs a value" >&2; exit 1; } ;;
    --gsd-tools)    GSD_TOOLS="${2:-}";   shift 2 || { echo "Error: --gsd-tools needs a value" >&2; exit 1; } ;;
    --cleanup-cmd)  CLEANUP_CMD="${2:-}"; shift 2 || { echo "Error: --cleanup-cmd needs a value" >&2; exit 1; } ;;
    --dry-run-wait) DRY_RUN_WAIT=true;    shift ;;
    -h|--help)      print_help; exit 0 ;;
    --)             shift; break ;;
    *) echo "Error: unrecognized option '$1' before '--'. See --help." >&2; exit 1 ;;
  esac
done

CMD=("$@")
if [ "${#CMD[@]}" -eq 0 ]; then
  echo "Error: no command given. Usage: session-supervisor.sh [options] -- <command...>" >&2
  exit 1
fi

case "$MAX_RESUMES" in
  ''|*[!0-9]*) echo "Error: --max-resumes must be a non-negative integer, got '${MAX_RESUMES}'" >&2; exit 1 ;;
esac

if [ ! -f "$GSD_TOOLS" ]; then
  echo -e "${R}Error:${N} required dependency not found: $GSD_TOOLS" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo -e "${R}Error:${N} required dependency not found: jq" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo -e "${R}Error:${N} required dependency not found: node" >&2
  exit 1
fi

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "${REPO_ROOT}/.tmp"
if [ -z "$LOG_PATH" ]; then
  LOG_PATH="${REPO_ROOT}/.tmp/session-supervisor-${RUN_ID}.jsonl"
fi
mkdir -p "$(dirname "$LOG_PATH")" 2>/dev/null || true

CMD_STR="$(printf '%q ' "${CMD[@]}")"
RESUME_CMD=("${CMD[@]}")
if [ -n "$RESUME_FLAG" ]; then
  RESUME_CMD+=("$RESUME_FLAG")
fi
RESUME_CMD_STR="$(printf '%q ' "${RESUME_CMD[@]}")"

# -- Audit log helper: one JSON line per event, append-only. A logging
# failure must never take down the supervisor. --
audit_log() {
  local event="$1"
  # NOTE: intentionally NOT `local extra_json="${2:-{}}"` -- bash mis-parses
  # a literal `{}` inside a `${var:-default}` default-value word (confirmed
  # empirically: it emits a stray trailing `}`, corrupting the JSON handed
  # to jq below and silently killing every audit_log call). Two statements
  # instead of one clever one.
  local extra_json="${2:-}"
  [ -z "$extra_json" ] && extra_json='{}'
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || ts=""
  local line
  line="$(jq -n -c \
    --arg ts "$ts" \
    --arg event "$event" \
    --arg run_id "$RUN_ID" \
    --argjson attempt "${ATTEMPT:-0}" \
    --argjson extra "$extra_json" \
    '{ts: $ts, event: $event, run_id: $run_id, attempt: $attempt} + $extra' 2>/dev/null)" || return 0
  [ -n "$line" ] || return 0
  { printf '%s\n' "$line" >> "$LOG_PATH"; } 2>/dev/null || true
}

echo -e "${C}session-supervisor${N} run_id=${RUN_ID} log=${LOG_PATH}"
echo -e "${C}command:${N} ${CMD_STR}"
[ -n "$RESUME_FLAG" ] && echo -e "${C}resume command:${N} ${RESUME_CMD_STR}"
echo -e "${C}max resumes:${N} ${MAX_RESUMES}  ${C}dry-run-wait:${N} ${DRY_RUN_WAIT}"

ATTEMPT=0
audit_log "start" "$(jq -n -c \
  --arg cmd "$CMD_STR" \
  --arg resume_cmd "$RESUME_CMD_STR" \
  --argjson max_resumes "$MAX_RESUMES" \
  --arg dry_run_wait "$DRY_RUN_WAIT" \
  '{cmd: $cmd, resume_cmd: $resume_cmd, max_resumes: $max_resumes, dry_run_wait: ($dry_run_wait == "true")}')"

RESUME_COUNT=0

while true; do
  # Sweep at the top of every attempt (including resumes) so a stale orphan
  # from a prior crashed attempt is gone before this one starts.
  run_cleanup

  ATTEMPT=$((RESUME_COUNT + 1))
  if [ "$RESUME_COUNT" -eq 0 ]; then
    RUN_CMD=("${CMD[@]}")
  else
    RUN_CMD=("${RESUME_CMD[@]}")
  fi

  OUTPUT_LOG="${LOG_PATH%.jsonl}.attempt-${ATTEMPT}.output.log"
  : > "$OUTPUT_LOG" 2>/dev/null || true

  echo ""
  echo -e "${C}=== attempt ${ATTEMPT} (resume ${RESUME_COUNT}/${MAX_RESUMES}) ===${N}"
  echo -e "${C}running:${N} $(printf '%q ' "${RUN_CMD[@]}")"
  echo -e "${C}output tee'd to:${N} ${OUTPUT_LOG}"

  # Stream combined stdout+stderr to BOTH the terminal and the per-attempt
  # log file. ${PIPESTATUS[0]} (bash-specific) captures the CHILD's exit
  # code, not tee's -- this is why the shebang is #!/bin/bash, not /bin/sh.
  "${RUN_CMD[@]}" 2>&1 | tee -a "$OUTPUT_LOG"
  CHILD_RC=${PIPESTATUS[0]}

  echo -e "${C}attempt ${ATTEMPT} exited:${N} ${CHILD_RC}"

  if [ "$CHILD_RC" -eq 0 ]; then
    echo -e "${G}SUCCESS${N} — child exited 0 on attempt ${ATTEMPT}."
    audit_log "final" "$(jq -n -c --arg outcome "success" --argjson child_rc "$CHILD_RC" '{outcome: $outcome, child_rc: $child_rc}')"
    exit 0
  fi

  # -- Distinct diagnostic for an OAuth-session-expiry failure: a nested CLI
  # subprocess's own OAuth token expiring mid-run, which is a DIFFERENT class
  # from the session/usage/quota-limit family below. Reported separately,
  # then it falls through to the same exit 2 as any non-limit failure: it is
  # NOT a resume path. There is no scheduled reset time for an expired OAuth
  # session, so the limit parser would only land on exit 3, and fixing the
  # expiry takes a manual re-authentication (e.g. `claude login`) that this
  # process cannot perform.
  if grep -qi 'OAuth session expired' "$OUTPUT_LOG" 2>/dev/null; then
    echo -e "${R}OAuth session expired${N} — a nested 'claude' subprocess's OAuth token expired mid-run (not a Claude Code account usage/session limit). This is NOT auto-resumable: there is no scheduled reset time for an expired OAuth session. Manual re-authentication of the nested CLI (e.g. 'claude login') is required before re-running."
    audit_log "final" "$(jq -n -c --arg outcome "oauth_session_expired_manual_reauth_required" --argjson child_rc "$CHILD_RC" '{outcome: $outcome, child_rc: $child_rc}')"
    exit 2
  fi

  # -- Cheap local pre-filter: decide WHETHER to bother calling the
  # authoritative parser. This keyword list intentionally mirrors the
  # patterns in gsd-tools.js's parseDeathMessage() (session limit / usage
  # limit / quota limit / rate limit exceeded) -- it is NOT used to extract
  # a reset time, only to decide whether the (more expensive, authoritative)
  # `resilience parse-death` call is worth making.
  if ! grep -qiE 'session limit|usage limit|quota limit|rate limit exceeded' "$OUTPUT_LOG" 2>/dev/null; then
    echo -e "${Y}Non-limit failure${N} — no session/usage/quota/rate-limit signature found in output."
    audit_log "final" "$(jq -n -c --arg outcome "failed_non_limit" --argjson child_rc "$CHILD_RC" '{outcome: $outcome, child_rc: $child_rc}')"
    exit 2
  fi

  # Pull a bounded snippet around the match for the parser -- avoids handing
  # a potentially huge log through a shell arg, and avoids false context
  # bleed from unrelated earlier output.
  SNIPPET="$(grep -iE -A3 -B1 'session limit|usage limit|quota limit|rate limit exceeded' "$OUTPUT_LOG" 2>/dev/null | head -c 4000)"

  echo -e "${Y}Possible limit-death signature found${N} — asking the authoritative parser..."
  DEATH_JSON="$(node "$GSD_TOOLS" resilience parse-death --text "$SNIPPET" 2>/dev/null)" || DEATH_JSON=""
  if [ -z "$DEATH_JSON" ]; then
    echo -e "${Y}parse-death returned nothing usable${N} — treating as non-limit failure."
    audit_log "final" "$(jq -n -c --arg outcome "failed_non_limit" --argjson child_rc "$CHILD_RC" --arg reason "parse-death empty" '{outcome: $outcome, child_rc: $child_rc, reason: $reason}')"
    exit 2
  fi

  IS_DEATH="$(echo "$DEATH_JSON" | jq -r '.is_death // false' 2>/dev/null)" || IS_DEATH="false"
  RESET_TIME_ISO="$(echo "$DEATH_JSON" | jq -r '.reset_time_iso // empty' 2>/dev/null)" || RESET_TIME_ISO=""
  MATCHED_PATTERN="$(echo "$DEATH_JSON" | jq -r '.matched_pattern // empty' 2>/dev/null)" || MATCHED_PATTERN=""

  if [ "$IS_DEATH" != "true" ]; then
    echo -e "${Y}Non-limit failure${N} — parser confirmed no death signature (snippet was a false-positive keyword hit)."
    audit_log "final" "$(jq -n -c --arg outcome "failed_non_limit" --argjson child_rc "$CHILD_RC" '{outcome: $outcome, child_rc: $child_rc}')"
    exit 2
  fi

  echo -e "${Y}LIMIT DEATH DETECTED${N} — matched_pattern='${MATCHED_PATTERN}' reset_time_iso='${RESET_TIME_ISO}'"
  audit_log "limit_detected" "$(jq -n -c --arg matched "$MATCHED_PATTERN" --arg reset "$RESET_TIME_ISO" --argjson child_rc "$CHILD_RC" '{matched_pattern: $matched, reset_time_iso: $reset, child_rc: $child_rc}')"

  # -- Resume cap check: fail fast, don't wait for nothing. --
  if [ "$RESUME_COUNT" -ge "$MAX_RESUMES" ]; then
    echo -e "${R}RESUME CAP REACHED${N} — ${RESUME_COUNT}/${MAX_RESUMES} resumes already used. Giving up."
    audit_log "final" "$(jq -n -c --arg outcome "resume_cap_exhausted" --argjson resume_count "$RESUME_COUNT" --argjson max_resumes "$MAX_RESUMES" '{outcome: $outcome, resume_count: $resume_count, max_resumes: $max_resumes}')"
    exit 4
  fi

  # -- Validate reset time: missing, unparseable, in the past, or beyond the
  # 6-hour cap all refuse to sleep (exit 3) rather than hang or overshoot. --
  if [ -z "$RESET_TIME_ISO" ]; then
    echo -e "${R}No reset time in death message${N} — refusing to sleep blind. Exiting."
    audit_log "final" "$(jq -n -c --arg outcome "implausible_reset_time" --arg reason "missing reset_time_iso" '{outcome: $outcome, reason: $reason}')"
    exit 3
  fi

  NOW_EPOCH=$(date -u +%s)
  RESET_EPOCH=$(date -u -d "${RESET_TIME_ISO}" +%s 2>/dev/null) \
    || RESET_EPOCH=$(date -u -jf "%Y-%m-%dT%H:%M:%S" "${RESET_TIME_ISO%%.*}" +%s 2>/dev/null) \
    || RESET_EPOCH=""

  if [ -z "$RESET_EPOCH" ]; then
    echo -e "${R}Unparseable reset time${N} '${RESET_TIME_ISO}' — refusing to sleep blind. Exiting."
    audit_log "final" "$(jq -n -c --arg outcome "implausible_reset_time" --arg reason "unparseable reset_time_iso" --arg reset "$RESET_TIME_ISO" '{outcome: $outcome, reason: $reason, reset_time_iso: $reset}')"
    exit 3
  fi

  RAW_WAIT_SECONDS=$((RESET_EPOCH - NOW_EPOCH))

  if [ "$RAW_WAIT_SECONDS" -lt 0 ]; then
    echo -e "${R}Reset time is in the past${N} (now=$(date -u -r "$NOW_EPOCH" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ), reset=${RESET_TIME_ISO}) — refusing to sleep. Exiting."
    audit_log "final" "$(jq -n -c --arg outcome "implausible_reset_time" --arg reason "reset time in the past" --argjson wait_seconds "$RAW_WAIT_SECONDS" '{outcome: $outcome, reason: $reason, wait_seconds: $wait_seconds}')"
    exit 3
  fi

  if [ "$RAW_WAIT_SECONDS" -gt "$MAX_WAIT_SECONDS" ]; then
    echo -e "${R}Reset time is beyond the ${MAX_WAIT_SECONDS}s (6h) cap${N} (wait would be ${RAW_WAIT_SECONDS}s) — refusing to sleep. Exiting."
    audit_log "final" "$(jq -n -c --arg outcome "implausible_reset_time" --arg reason "wait exceeds 6h cap" --argjson wait_seconds "$RAW_WAIT_SECONDS" --argjson cap_seconds "$MAX_WAIT_SECONDS" '{outcome: $outcome, reason: $reason, wait_seconds: $wait_seconds, cap_seconds: $cap_seconds}')"
    exit 3
  fi

  TARGET_EPOCH=$((RESET_EPOCH + RESET_BUFFER_SECONDS))
  TOTAL_WAIT_SECONDS=$((TARGET_EPOCH - NOW_EPOCH))
  NOW_HUMAN="$(date -u -r "$NOW_EPOCH" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null || date -u '+%Y-%m-%d %H:%M:%S UTC')"
  RESET_HUMAN="$(date -u -r "$RESET_EPOCH" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null || echo "$RESET_TIME_ISO")"

  echo -e "${Y}Current time:${N} ${NOW_HUMAN}"
  echo -e "${Y}Reset time:${N}   ${RESET_HUMAN} (+${RESET_BUFFER_SECONDS}s buffer)"
  echo -e "${Y}Wait duration:${N} ${TOTAL_WAIT_SECONDS}s (~$((TOTAL_WAIT_SECONDS / 60)) min)"

  audit_log "wait_start" "$(jq -n -c --arg now "$NOW_HUMAN" --arg reset "$RESET_HUMAN" --argjson wait_seconds "$TOTAL_WAIT_SECONDS" --arg dry_run "$DRY_RUN_WAIT" '{now: $now, reset_time: $reset, wait_seconds: $wait_seconds, dry_run: ($dry_run == "true")}')"

  if [ "$DRY_RUN_WAIT" = "true" ]; then
    echo -e "${Y}[DRY-RUN-WAIT]${N} would sleep ~${TOTAL_WAIT_SECONDS}s until ${RESET_HUMAN} — NOT actually sleeping. Proceeding to resume immediately."
    audit_log "wait_end" "$(jq -n -c --arg dry_run "true" '{dry_run: true, actually_slept_seconds: 0}')"
  else
    echo -e "${C}Sleeping in ${POLL_INTERVAL_SECONDS}s increments (Ctrl-C to abort cleanly)...${N}"
    while true; do
      NOW_EPOCH=$(date -u +%s)
      if [ "$NOW_EPOCH" -ge "$TARGET_EPOCH" ]; then
        break
      fi
      REMAINING=$((TARGET_EPOCH - NOW_EPOCH))
      if [ "$REMAINING" -lt "$POLL_INTERVAL_SECONDS" ]; then
        SLEEP_FOR=$REMAINING
      else
        SLEEP_FOR=$POLL_INTERVAL_SECONDS
      fi
      [ "$SLEEP_FOR" -lt 1 ] && SLEEP_FOR=1
      sleep "$SLEEP_FOR"
    done
    echo -e "${G}Reset time reached.${N}"
    audit_log "wait_end" "$(jq -n -c --arg dry_run "false" '{dry_run: false}')"
  fi

  RESUME_COUNT=$((RESUME_COUNT + 1))
  echo -e "${C}Resuming${N} (resume ${RESUME_COUNT}/${MAX_RESUMES})..."
  audit_log "resume" "$(jq -n -c --argjson resume_count "$RESUME_COUNT" --arg cmd "$RESUME_CMD_STR" '{resume_count: $resume_count, cmd: $cmd}')"
  # Loop back to the top -- next attempt uses RESUME_CMD.
done
