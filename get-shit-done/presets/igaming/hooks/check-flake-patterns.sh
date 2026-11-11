#!/bin/bash
# Hook: check-flake-patterns.sh
#
# Blocks writing/editing *.integration.test.ts content that introduces
# hardcoded flake-prone patterns: bare round_number/*_id literals inserted
# into cross-test shared tables with no retry-on-23505 collision handling,
# and absolute (non-UTC-anchored) hour windows. See Phase 277 (MILE-07) and
# apps/api/scripts/flake-gate.ts for the full pattern rationale.
#
# Triggered on: Write, Edit tool calls to **/*.integration.test.ts
#
# This is the EARLY, tool-use-time layer of the flake-prevention gate. The
# git pre-commit hook (scripts/hooks/pre-commit) is the AUTHORITATIVE,
# full-file-content layer that actually blocks the commit — this hook may
# only see an Edit's `new_string` fragment (partial context), so it can
# under-detect but should never produce a false block the pre-commit hook
# wouldn't also produce.
#
# Exit codes:
#   0 = allow
#   2 = block with message

PATH="$PATH:/usr/bin:/bin"
INPUT=$(cat)
. "${BASH_SOURCE[0]%/*}/lib/fail-closed.sh"
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || true)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null || true)

# Only check integration test files
if ! echo "$FILE" | grep -qE '\.integration\.test\.ts$'; then
  exit 0
fi

# Never hard-fail the hook itself if required tooling is missing.
command -v jq >/dev/null 2>&1 || exit 0
command -v deno >/dev/null 2>&1 || exit 0

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo ".")}"
GATE_SCRIPT="$REPO_ROOT/apps/api/scripts/flake-gate.ts"
[ -f "$GATE_SCRIPT" ] || exit 0

if [ "$TOOL" = "Write" ]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // ""' 2>/dev/null || true)
elif [ "$TOOL" = "Edit" ]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // ""' 2>/dev/null || true)
else
  exit 0
fi

[ -z "$CONTENT" ] && exit 0

TMPFILE=$(mktemp) || exit 0
printf '%s' "$CONTENT" > "$TMPFILE"

GATE_OUTPUT=$(deno run --allow-read "$GATE_SCRIPT" "$TMPFILE" 2>&1)
GATE_EXIT=$?
rm -f "$TMPFILE"

if [ "$GATE_EXIT" -ne 0 ]; then
  # On exit 2, Claude Code only surfaces stderr — send the reason there.
  exec 1>&2
  echo "BLOCKED: $FILE introduces a flake-prone hardcoded pattern."
  echo ""
  # Strip the temp file path from the gate's output for a cleaner message.
  echo "$GATE_OUTPUT" | grep -E '\[hardcoded-round-number\]|\[hardcoded-id\]|\[absolute-time-window\]' | sed "s|$TMPFILE|$FILE|g"
  echo ""
  echo "Use TEST_RUN_ID namespacing, retry-on-23505, or a current-UTC-hour-anchored window instead"
  echo "(see .claude/rules/testing.md — Integration Test Isolation / Flake Prevention Gate)."
  echo ""
  echo "If this is a deliberate, justified exception, add a comment on the same line or the line"
  echo "above: // flake-gate-ignore: <reason>"
  exit 2
fi

exit 0
