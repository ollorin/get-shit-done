#!/usr/bin/env bash
# reap-stale.sh [--live] [--dry-run]: sweep stale test processes (scripts/lib/reap-stale-test-processes.sh).
#
# Report-only by default: without --live no signal is sent, each candidate prints a `would_kill` line.
# --live signals the candidates. Test-runner (worker_patterns), headless-agent and browser workers count only when their cwd is under the project root
# (or the command matches stack.host.project_pattern); the reaper's own ancestors are never candidates.
# A worker is reaped only when a one-snapshot ownership walk proves no live owner; anything unrecognised is protected.
# Worker commands come from stack.host.worker_patterns, extra owners from stack.host.protected_patterns
# (.planning/config.json; an unreadable config exits 1). Not a gate: it is not in stack.gates[].
#
# Exit: 0 after a sweep (including a sweep that found nothing, or an unsupported platform), 1 unreadable config, 2 usage.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

live=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) export STALE_REAPER_DRY_RUN=1 ;;
    --live) live=1 ;;
    --help|-h)
      sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

[ "$live" = 1 ] || export STALE_REAPER_DRY_RUN=1

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/reap-stale-test-processes.sh"

reap_load_config || exit 1
reap_stale_test_processes "reap-stale"
