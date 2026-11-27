#!/bin/sh
# Pre-PR gate: runs the profile commands and, only on a fully green run, writes the marker the push hook accepts.
#
#   Stage 1 (deterministic, once): stack.commands.typecheck, stack.commands.lint.
#   Stage 2 (once): stack.commands.test_all. A red run stops the gate before stage 3.
#   Stage 3 (once): each stack.gates[].run, in profile order.
# The full output of every check is kept in .tmp/pre-pr-gate/<N>-<check id>.log, N the check's order in the run (cleared at the start of each run).
# A command key that is not set in .planning/config.json prints "NOT CONFIGURED: stack.commands.<key>" and the gate
# fails before anything runs: an unset command is a gap, never a skip. Set the literal `true` to state there is none.
# The marker is "$(git rev-parse --absolute-git-dir)/.pre-pr-passed" (per worktree, never in the working tree). It is
# removed at the start of every run and written at no other point than the end of a green run.
# The gate does not take the stack lock itself (the lock leaves files under .tmp/, which a new project does not ignore).
# A project whose commands use the shared stack runs it as: scripts/stack-lock.sh --label pre-pr-gate -- scripts/pre-pr-gate.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd) || exit 1
cd "$ROOT" || exit 1

GITDIR=$(git rev-parse --absolute-git-dir 2>/dev/null) || { echo "pre-pr-gate: not inside a git repository" >&2; exit 1; }
MARKER="$GITDIR/.pre-pr-passed"
rm -f "$MARKER"

TMPD=$(mktemp -d "${TMPDIR:-/tmp}/pre-pr-gate.XXXXXX") || exit 1
trap 'rm -rf "$TMPD"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# One read of the profile: "C<TAB>key<TAB>command" per set command, "G<TAB>id<TAB>run" per gate.
CONFIG=".planning/config.json"
if ! CONFIG="$CONFIG" node -e '
  const fs = require("fs");
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(process.env.CONFIG, "utf8")); } catch (e) { console.error("pre-pr-gate: cannot read " + process.env.CONFIG + ": " + e.message); process.exit(1); }
  const one = (v) => String(v).replace(/[\t\r\n]+/g, " ").trim();
  const stack = (cfg && cfg.stack) || {};
  const cmds = stack.commands || {};
  for (const k of ["typecheck", "lint", "test_all"]) {
    if (cmds[k] === null || cmds[k] === "none") console.log("N\t" + k + "\t");
    else if (typeof cmds[k] === "string" && cmds[k].trim() !== "") console.log("C\t" + k + "\t" + one(cmds[k]));
  }
  const bad = [];
  if (stack.gates !== undefined && !Array.isArray(stack.gates)) bad.push("stack.gates is not an array");
  const gates = Array.isArray(stack.gates) ? stack.gates : [];
  const text = (v) => typeof v === "string" && v.trim() !== "";
  gates.forEach((g, i) => { if (!g || !text(g.id) || !text(g.run)) bad.push("stack.gates[" + i + "] needs a non-empty id and run"); });
  if (bad.length > 0) {
    for (const b of bad) console.error("NOT CONFIGURED: " + b);
    console.error("pre-pr-gate: malformed stack.gates in " + process.env.CONFIG + "; a gate that cannot run is a gap, never a skip.");
    process.exit(1);
  }
  for (const g of gates) console.log("G\t" + one(g.id) + "\t" + one(g.run));
' > "$TMPD/profile.tsv"; then
  exit 1
fi

TAB=$(printf '\t')
CMD_typecheck=""; CMD_lint=""; CMD_test_all=""
UNCONFIGURED=""
while IFS="$TAB" read -r kind a b; do
  if [ "$kind" = N ]; then UNCONFIGURED="$UNCONFIGURED $a"; continue; fi
  [ "$kind" = C ] || continue
  case "$a" in
    typecheck) CMD_typecheck="$b" ;;
    lint) CMD_lint="$b" ;;
    test_all) CMD_test_all="$b" ;;
  esac
done < "$TMPD/profile.tsv"

MISSING=0
for key in typecheck lint test_all; do
  eval "val=\$CMD_$key"
  case " $UNCONFIGURED " in *" $key "*) continue ;; esac
  if [ -z "$val" ]; then
    echo "NOT CONFIGURED: stack.commands.$key"
    MISSING=$((MISSING + 1))
  fi
done
if [ "$MISSING" -gt 0 ]; then
  echo "pre-pr-gate: $MISSING command(s) not configured in $CONFIG; set each, or the literal true to state there is none." >&2
  exit 1
fi

# An acknowledged "none" (null or "none") is skipped, never run and never counted as a pass: it is named in the stage
# output and again in the final line.
for key in $UNCONFIGURED; do echo "WARNING: stack.commands.$key is not configured yet (acknowledged none): skipped, not passed"; done

FAILURES=""
FAILED=0
LOGDIR=".tmp/pre-pr-gate"
rm -rf "$LOGDIR"
mkdir -p "$LOGDIR" || exit 1
printf '*\n' > "$LOGDIR/.gitignore"

# run_check <id> <name> <command>: runs through sh -c into $LOGDIR/<N>-<id>.log, prints one PASS/FAIL line and the last 15 lines on failure.
# The counter keeps two checks whose ids sanitize alike (a/b, a_b) or equal a stage id from overwriting each other's log.
CHECK_N=0
run_check() {
  CHECK_N=$((CHECK_N + 1))
  LOG="$LOGDIR/$CHECK_N-$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_').log"
  shift
  _start=$(date +%s)
  _rc=0
  sh -c "$2" </dev/null > "$LOG" 2>&1 || _rc=$?
  if [ "$_rc" -eq 0 ]; then
    echo "  PASS  $1 ($(( $(date +%s) - _start ))s)"
    return 0
  fi
  echo "  FAIL  $1 ($(( $(date +%s) - _start ))s, exit $_rc)"
  tail -15 "$LOG"
  echo "  full log: $LOG"
  FAILED=$((FAILED + 1))
  FAILURES="$FAILURES
  - $1"
  return "$_rc"
}

print_summary() {
  if [ "$FAILED" -eq 0 ]; then
    if [ -n "$UNCONFIGURED" ]; then
      echo "--- $1: PASSED, BUT NOT CONFIGURED (skipped):$UNCONFIGURED ---"
    else
      echo "--- $1: ALL CHECKS PASSED ---"
    fi
    return 0
  fi
  echo "--- $1: $FAILED FAILURE(S) ---"
  printf '%s\n' "$FAILURES"
  return 1
}

echo "--- Stage 1: deterministic, once ---"
[ -n "$CMD_typecheck" ] && run_check typecheck "typecheck (stack.commands.typecheck)" "$CMD_typecheck"
[ -n "$CMD_lint" ] && run_check lint "lint (stack.commands.lint)" "$CMD_lint"
if ! print_summary "Stage 1"; then
  echo "Stage 1 is red: stopping before the test stage. Fix the failures above and re-run: scripts/pre-pr-gate.sh"
  exit 1
fi

echo "--- Stage 2: tests, once ---"
if [ -n "$CMD_test_all" ]; then
  run_check test_all "test_all (stack.commands.test_all)" "$CMD_test_all" || {
    print_summary "Stage 2"
    echo "Stage 2 is red: stopping before the gates. Fix the failures above and re-run: scripts/pre-pr-gate.sh"
    exit 1
  }
fi

echo "--- Stage 3: stack.gates ---"
GATES_CONFIGURED=$(awk -F"$TAB" '$1 == "G"' "$TMPD/profile.tsv" | wc -l | tr -d ' ')
GATES_RUN=0
while IFS="$TAB" read -r kind a b; do
  [ "$kind" = G ] || continue
  GATES_RUN=$((GATES_RUN + 1))
  run_check "$a" "gate $a" "$b" || true
done < "$TMPD/profile.tsv"
if [ "$GATES_RUN" -ne "$GATES_CONFIGURED" ]; then
  echo "NOT CONFIGURED: stack.gates ran $GATES_RUN of $GATES_CONFIGURED configured gates; no marker written." >&2
  exit 1
fi

if ! print_summary "pre-PR gate"; then
  echo "Fix the failures above, then re-run: scripts/pre-pr-gate.sh"
  exit 1
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER" || { echo "pre-pr-gate: cannot write $MARKER" >&2; exit 1; }
echo "Marker written: $MARKER"
exit 0
