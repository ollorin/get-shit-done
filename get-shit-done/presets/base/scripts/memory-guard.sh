#!/usr/bin/env bash
# memory-guard.sh: report-first memory-pressure guard for a development host.
#
# Long-running sessions leave orphaned worker processes behind until the host is under real memory pressure. This script
# REPORTS the memory state and lists conservatively defined stale-process candidates. It never kills anything without
# --live, and --live needs an interactive terminal plus two separate confirmations before a single signal is sent.
#
# Stale means: an orphan (PPID 1: its owning session is gone) whose command matches stack.host.worker_patterns, that is
# not under a "/daemon/" path, does not match stack.host.protected_patterns, is not in a protected process group, and is
# older than the staleness floor. It never means "uses a lot of memory". Both lists are read once from
# .planning/config.json (an unreadable or non-JSON config is a failure); an absent or empty worker list lists nothing.
#
# Platforms: macOS (sysctl, vm_stat) and Linux (/proc/meminfo). Any other platform prints UNSUPPORTED PLATFORM and exits 0
# in report mode, 1 with --live.

set -euo pipefail

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'
header() { echo -e "\n${B}=== $1 ===${N}"; }
pass()   { echo -e "${G}  PASS${N}  $1"; }
warn()   { echo -e "${Y}  WARN${N}  $1"; }
info()   { echo -e "${C}  INFO${N}  $1"; }
act()    { echo -e "${R}  ACT${N}   $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$REPO_ROOT/.planning/config.json"
CONTAINER_CLI="${CONTAINER_CLI:-docker}"

LIVE=false
STALE_MINUTES="${MEMORY_GUARD_STALE_MINUTES:-30}"
DEV_PORTS="${MEMORY_GUARD_DEV_PORTS:-}"

for arg in "$@"; do
  case "$arg" in
    --dry-run) LIVE=false ;;
    --live)    LIVE=true ;;
    --help|-h)
      cat <<EOF
Usage: scripts/memory-guard.sh [--dry-run] [--live]

  --dry-run   Report only (the default even with no flags: nothing is acted on unless --live is passed).
  --live      Clean up stale orphan processes. Needs an interactive terminal, prints the exact kill list and requires
              TWO separate confirmations before any signal. Processes of an active session are hard-protected.
  --help      Show this help.

Env overrides:
  MEMORY_GUARD_STALE_MINUTES  Minimum age (minutes) before an orphan is a candidate (default 30)
  MEMORY_GUARD_DEV_PORTS      Comma-separated ports treated as "active dev server" (default none)
  CONTAINER_CLI               Container runtime CLI used for the memory snapshot (default: the CONTAINER_CLI= line)

Config (.planning/config.json): stack.host.worker_patterns (commands that may be listed as stale),
stack.host.protected_patterns (commands never listed).
EOF
      exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if $LIVE && [ ! -t 0 ]; then
  echo "refused: --live needs an interactive terminal (stdin is not a terminal); nothing was touched" >&2
  exit 1
fi

OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *)
    echo "UNSUPPORTED PLATFORM: $OS"
    if $LIVE; then exit 1; fi
    exit 0 ;;
esac

for tool in ps awk node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not found" >&2; exit 1; }
done

# One read of the config: prints "<list>:<pattern>" lines. Unreadable or non-JSON config exits non-zero.
HOST_LISTS="$(node -e '
const fs = require("fs");
let c;
try { c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { console.error("config unreadable or not JSON: " + e.message); process.exit(1); }
const host = (c && c.stack && c.stack.host) || {};
for (const k of ["worker_patterns", "protected_patterns"]) {
  const v = host[k];
  if (v === undefined) continue;
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string" && s.length > 0)) { console.error("stack.host." + k + " must be an array of non-empty strings"); process.exit(1); }
  for (const s of v) console.log(k + ":" + s);
}' "$CONFIG")" || { echo "error: cannot read $CONFIG" >&2; exit 1; }

WORKER_PATTERNS=()
PROTECTED_PATTERNS=()
while IFS= read -r line; do
  case "$line" in
    worker_patterns:*)    WORKER_PATTERNS+=("${line#worker_patterns:}") ;;
    protected_patterns:*) PROTECTED_PATTERNS+=("${line#protected_patterns:}") ;;
  esac
done <<< "$HOST_LISTS"

# shellcheck disable=SC1091
[ -f "$SCRIPT_DIR/lib/reap-stale-test-processes.sh" ] && source "$SCRIPT_DIR/lib/reap-stale-test-processes.sh"

matches_any() {
  local text="$1"; shift
  local pat
  for pat in "$@"; do
    case "$text" in *"$pat"*) return 0 ;; esac
  done
  return 1
}

header "HOST MEMORY PRESSURE"
if [ "$OS" = "Darwin" ]; then
  HOST_MEM_BYTES=$(sysctl -n hw.memsize)
  HOST_MEM_MIB=$(( HOST_MEM_BYTES / 1024 / 1024 ))
  PAGE_SIZE=$(vm_stat | head -1 | grep -oE '[0-9]+ bytes' | grep -oE '[0-9]+' || echo 16384)
  FREE_PAGES=$(vm_stat | awk -F: '/Pages free/{gsub(/[^0-9]/,"",$2); print $2}')
  FREE_MIB=$(( FREE_PAGES * PAGE_SIZE / 1024 / 1024 ))
  info "Truly free pages: ${FREE_MIB} MiB (a floor: compressed and purgeable pages are reclaimable on demand)"
  info "Swap: $(sysctl -n vm.swapusage 2>/dev/null || echo unknown)"
  info "Kernel vm-pressure level: $(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || echo unknown) (directional signal only)"
else
  HOST_MEM_MIB=$(awk '/^MemTotal:/{printf "%d", $2/1024}' /proc/meminfo)
  FREE_MIB=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo)
  info "Available memory (MemAvailable): ${FREE_MIB} MiB"
  info "Swap: $(awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{printf "%d MiB used of %d MiB", (t-f)/1024, t/1024}' /proc/meminfo)"
  if [ -r /proc/pressure/memory ]; then info "Pressure stall (/proc/pressure/memory): $(head -1 /proc/pressure/memory)"; fi
fi
info "Host total RAM: ${HOST_MEM_MIB} MiB ($(( HOST_MEM_MIB / 1024 )) GiB)"
FREE_PCT=$(awk -v f="$FREE_MIB" -v t="$HOST_MEM_MIB" 'BEGIN{printf "%.1f", (f/t)*100}')
info "Free: ${FREE_PCT}% of host RAM"
if awk -v f="$FREE_PCT" 'BEGIN{exit !(f < 5)}'; then
  warn "Free memory is under 5% of host RAM: real pressure right now"
else
  pass "Free memory is above the 5% floor"
fi

header "CONTAINER MEMORY (informational, never acted on)"
if command -v "$CONTAINER_CLI" >/dev/null 2>&1 && "$CONTAINER_CLI" info >/dev/null 2>&1; then
  "$CONTAINER_CLI" stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' 2>/dev/null || true
else
  info "No reachable container runtime: skipping the container memory snapshot"
fi

header "ACTIVE SESSION DETECTION (always protected, no override)"
PROTECTED_PGIDS=()
if [ "${#PROTECTED_PATTERNS[@]}" -gt 0 ]; then
  while IFS='|' read -r pid pgid command; do
    [ -z "$pid" ] && continue
    if matches_any "$command" "${PROTECTED_PATTERNS[@]}"; then PROTECTED_PGIDS+=("$pgid"); fi
  done < <(ps -axo pid=,pgid=,command= | awk '{pid=$1; pgid=$2; $1=$2=""; sub(/^ +/, ""); print pid "|" pgid "|" $0}')
fi
if [ -n "$DEV_PORTS" ] && command -v lsof >/dev/null 2>&1; then
  IFS=',' read -ra PORT_ARR <<< "$DEV_PORTS"
  for port in "${PORT_ARR[@]}"; do
    for pid in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true); do
      pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
      [ -n "$pgid" ] && PROTECTED_PGIDS+=("$pgid")
      info "Port $port is LISTENing on PID $pid (protected, pgid ${pgid:-unknown})"
    done
  done
elif [ -n "$DEV_PORTS" ]; then
  info "lsof not found: dev ports are not checked"
fi
if [ "${#PROTECTED_PGIDS[@]}" -eq 0 ]; then pass "No protected process group detected"; else info "Protected process groups: ${PROTECTED_PGIDS[*]}"; fi

is_protected_pgid() {
  local p
  for p in "${PROTECTED_PGIDS[@]:-}"; do
    [ "$p" = "$1" ] && return 0
  done
  return 1
}

header "STALE ORPHAN SCAN (staleness floor: ${STALE_MINUTES}min)"
STALE_SEC=$(( STALE_MINUTES * 60 ))
KILL_PIDS=()
KILL_LINES=()
TOTAL_STALE_RSS_KB=0

# ps has no portable seconds-elapsed keyword: etime is [[dd-]hh:]mm:ss, converted here.
ETIME2SEC_AWK='
function etime2sec(e,    dh, parts, n, days, hh, mm, ss) {
  days=0; hh=0; mm=0; ss=0
  if (index(e, "-") > 0) { split(e, dh, "-"); days=dh[1]; e=dh[2] }
  n = split(e, parts, ":")
  if (n == 3) { hh=parts[1]; mm=parts[2]; ss=parts[3] }
  else if (n == 2) { mm=parts[1]; ss=parts[2] }
  else { ss=parts[1] }
  return days*86400 + hh*3600 + mm*60 + ss
}
{
  pid=$1; ppid=$2; pgid=$3; etimes=etime2sec($4); rss=$5;
  $1=$2=$3=$4=$5="";
  sub(/^ +/,"");
  print pid "|" ppid "|" pgid "|" etimes "|" rss "|" $0
}'

if [ "${#WORKER_PATTERNS[@]}" -eq 0 ]; then
  info "stack.host.worker_patterns is empty: no process is listed as stale"
else
  while IFS='|' read -r pid ppid pgid etimes rss command; do
    [ -z "$pid" ] && continue
    [ "$ppid" != "1" ] && continue
    case "$command" in *"/daemon/"*) continue ;; esac
    matches_any "$command" "${WORKER_PATTERNS[@]}" || continue
    if [ "${#PROTECTED_PATTERNS[@]}" -gt 0 ] && matches_any "$command" "${PROTECTED_PATTERNS[@]}"; then continue; fi
    if is_protected_pgid "$pgid"; then
      info "Skipping PID $pid (belongs to a protected process group)"
      continue
    fi
    if [ "${etimes:-0}" -lt "$STALE_SEC" ]; then
      info "PID $pid matches a worker pattern but is younger than the ${STALE_MINUTES}min floor (age ${etimes}s)"
      continue
    fi
    age_min=$(( etimes / 60 ))
    act "Stale orphan candidate: PID $pid, age ${age_min}min, RSS ${rss}KiB: $command"
    KILL_PIDS+=("$pid")
    KILL_LINES+=("PID $pid (age ${age_min}min, ${rss}KiB): $command")
    TOTAL_STALE_RSS_KB=$(( TOTAL_STALE_RSS_KB + rss ))
  done < <(ps -axo pid=,ppid=,pgid=,etime=,rss=,command= | awk "$ETIME2SEC_AWK")
  if [ "${#KILL_PIDS[@]}" -eq 0 ]; then
    pass "No stale orphans found"
  else
    warn "${#KILL_PIDS[@]} stale orphan(s) found, $(( TOTAL_STALE_RSS_KB / 1024 )) MiB reclaimable"
  fi
fi

header "AUTOMATIC REAPER VIEW (what scripts/reap-stale.sh would classify right now)"
if type reap_stale_test_processes_report >/dev/null 2>&1; then
  reap_stale_test_processes_report
else
  info "scripts/lib/reap-stale-test-processes.sh is not deployed: no reaper view"
fi

header "PER-SESSION HOLDINGS (grouped by nearest interactive claude ancestor)"
# Third-party per-session bridges are never auto-killed: the ownership unit is the session, and the only provably safe
# action is human (close the terminal). This is a holdings report to inform that decision.
CLAUDE_SESSION_PIDS="$(ps -axo pid=,command= | awk '{
  pid=$1; $1="";
  sub(/^ +/,"",$0); cmd=$0;
  if (cmd ~ /(^|\/)claude([ \t]|$)/) print pid
}')"
if [ -z "$CLAUDE_SESSION_PIDS" ] || ! type collect_descendants >/dev/null 2>&1; then
  pass "No claude sessions found (or the descendant walk is not deployed)"
else
  for cpid in $CLAUDE_SESSION_PIDS; do
    ccmd="$(ps -o command= -p "$cpid" 2>/dev/null || echo "")"
    is_headless=false
    for tok in $ccmd; do
      case "$tok" in --print|-p) is_headless=true; break ;; esac
    done
    $is_headless && continue
    ctty="$(ps -o tty= -p "$cpid" 2>/dev/null | tr -d ' ')"
    cetime="$(ps -o etime= -p "$cpid" 2>/dev/null | tr -d ' ')"
    total_rss_kb=0
    for dpid in $(collect_descendants "$cpid" 2>/dev/null); do
      dcmd="$(ps -o command= -p "$dpid" 2>/dev/null || echo "")"
      case "$dcmd" in
        *tsserver*|*typescript-language-server*|*"Chrome for Testing"*|*chrome_crashpad_handler*|*mcp-server*|*-mcp*)
          drss="$(ps -o rss= -p "$dpid" 2>/dev/null | tr -d ' ')"
          case "$drss" in ''|*[!0-9]*) drss=0 ;; esac
          total_rss_kb=$((total_rss_kb + drss))
          ;;
      esac
    done
    total_mib=$((total_rss_kb / 1024))
    info "claude PID ${cpid}  tty=${ctty:-?}  session_age=${cetime:-?}  language-server/browser/bridge rss=${total_mib}MiB"
    if [ "$total_mib" -gt 0 ]; then info "  -> closing this terminal (tty ${ctty:-?}) reclaims ~${total_mib} MiB"; fi
  done
fi

header "ACTION"
if [ "${#KILL_PIDS[@]}" -eq 0 ]; then
  pass "Nothing to clean up: exiting"
  exit 0
fi

if ! $LIVE; then
  echo "REPORT ONLY: would send SIGTERM to:"
  for line in "${KILL_LINES[@]}"; do echo "    $line"; done
  info "Re-run with --live to clean these up (requires double confirmation)."
  exit 0
fi

header "LIVE CLEANUP: DOUBLE CONFIRMATION REQUIRED"
echo "About to send SIGTERM to ${#KILL_PIDS[@]} process(es):"
for line in "${KILL_LINES[@]}"; do echo "    $line"; done
echo
echo -n "Type YES (all caps) to proceed, anything else aborts: "
read -r CONFIRM1
if [ "$CONFIRM1" != "YES" ]; then
  info "Aborted: no processes were touched."
  exit 0
fi
echo -n "Second confirmation, type the exact count of processes to kill (${#KILL_PIDS[@]}): "
read -r CONFIRM2
if [ "$CONFIRM2" != "${#KILL_PIDS[@]}" ]; then
  info "Count did not match: aborted, no processes were touched."
  exit 0
fi
for pid in "${KILL_PIDS[@]}"; do
  if kill -TERM "$pid" 2>/dev/null; then echo "    sent SIGTERM to PID $pid"; else warn "    PID $pid already gone or not killable"; fi
done
sleep 1
for pid in "${KILL_PIDS[@]}"; do
  if ps -p "$pid" >/dev/null 2>&1; then warn "PID $pid is still alive after SIGTERM: not escalated to SIGKILL (re-run to re-check)"; else pass "PID $pid is gone"; fi
done
