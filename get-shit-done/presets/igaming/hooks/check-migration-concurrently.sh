#!/bin/bash
# Hook: check-migration-concurrently.sh
#
# Blocks writing migration files that contain CREATE INDEX CONCURRENTLY.
# Supabase applies migrations inside transaction blocks where CONCURRENTLY
# is forbidden (ERROR: CREATE INDEX CONCURRENTLY cannot run inside a
# transaction block).
#
# Triggered on: Write, Edit tool calls to apps/api/migrations/*.sql
#
# Exit codes:
#   0 = allow
#   2 = block with message

PATH="$PATH:/usr/bin:/bin"
INPUT=$(cat)
. "${BASH_SOURCE[0]%/*}/lib/fail-closed.sh"
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || true)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null || true)

# Only check migration SQL files
if ! echo "$FILE" | grep -qE 'apps/api/migrations/.*\.sql$'; then
  exit 0
fi

# For Write tool: check the content field
if [ "$TOOL" = "Write" ]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // ""' 2>/dev/null || true)
  if echo "$CONTENT" | grep -iqE 'CREATE[[:space:]]+INDEX[[:space:]]+CONCURRENTLY'; then
    # On exit 2, Claude Code only surfaces stderr — send the reason there.
    exec 1>&2
    echo "❌ BLOCKED: Migration contains CREATE INDEX CONCURRENTLY."
    echo ""
    echo "Supabase applies every migration inside a transaction block."
    echo "CREATE INDEX CONCURRENTLY is forbidden inside transaction blocks."
    echo ""
    echo "✅ Use instead:"
    echo "  CREATE INDEX IF NOT EXISTS idx_name ON table (column);"
    echo ""
    echo "See .claude/rules/database.md for details."
    exit 2
  fi
fi

# For Edit tool: check the new_string field
if [ "$TOOL" = "Edit" ]; then
  NEW_STRING=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // ""' 2>/dev/null || true)
  if echo "$NEW_STRING" | grep -iqE 'CREATE[[:space:]]+INDEX[[:space:]]+CONCURRENTLY'; then
    # On exit 2, Claude Code only surfaces stderr — send the reason there.
    exec 1>&2
    echo "❌ BLOCKED: Migration edit introduces CREATE INDEX CONCURRENTLY."
    echo ""
    echo "Supabase applies every migration inside a transaction block."
    echo "CREATE INDEX CONCURRENTLY is forbidden inside transaction blocks."
    echo ""
    echo "✅ Use instead:"
    echo "  CREATE INDEX IF NOT EXISTS idx_name ON table (column);"
    echo ""
    echo "See .claude/rules/database.md for details."
    exit 2
  fi
fi

exit 0
