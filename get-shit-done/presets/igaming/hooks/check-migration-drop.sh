#!/bin/bash
# Hook: check-migration-drop.sh
#
# Catches dangerous DROP patterns when writing migration files.
# Triggered on: Write, Edit tool calls to apps/api/migrations/*.sql
#
# Reads the Claude Code PreToolUse payload from stdin (JSON):
#   Write -> .tool_input.file_path + .tool_input.content
#   Edit  -> .tool_input.file_path + .tool_input.new_string
#
# Exit codes:
#   0 = allow
#   2 = block with message (stderr)

PATH="$PATH:/usr/bin:/bin"
INPUT=$(cat)
. "${BASH_SOURCE[0]%/*}/lib/fail-closed.sh"
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || true)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null || true)

# Only check migration SQL files
if ! echo "$FILE" | grep -qE 'apps/api/migrations/.*\.sql$'; then
  exit 0
fi

# Extract the SQL being written
if [ "$TOOL" = "Write" ]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // ""' 2>/dev/null || true)
elif [ "$TOOL" = "Edit" ]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // ""' 2>/dev/null || true)
else
  exit 0
fi

[ -z "$CONTENT" ] && exit 0

block() {
  # On exit 2, Claude Code only surfaces stderr — send the reason there.
  exec 1>&2
}

# Check 1: CREATE OR REPLACE VIEW when dropping columns
# This always fails with "cannot drop columns from view"
if echo "$CONTENT" | grep -qi "DROP COLUMN" && echo "$CONTENT" | grep -qi "CREATE OR REPLACE VIEW"; then
  block
  echo "BLOCKED: Migration uses 'CREATE OR REPLACE VIEW' alongside 'DROP COLUMN'."
  echo "PostgreSQL rejects this with 'cannot drop columns from view'."
  echo "Use 'DROP VIEW IF EXISTS ... ; CREATE VIEW ...' instead."
  echo ""
  echo "Pattern:"
  echo "  DROP VIEW IF EXISTS public.view_name CASCADE;"
  echo "  -- ... DROP COLUMN ..."
  echo "  CREATE VIEW public.view_name AS SELECT ...;"
  exit 2
fi

# Check 2: REVOKE after DROP FUNCTION (function is already gone)
# Flatten newlines for a portable multi-line match (BSD grep has no -P).
FLAT=$(printf '%s' "$CONTENT" | tr '\n' ' ')
if printf '%s' "$FLAT" | grep -qiE 'DROP[[:space:]]+FUNCTION[^;]*;[[:space:]]*REVOKE[^;]*FUNCTION'; then
  block
  echo "BLOCKED: REVOKE appears after DROP FUNCTION."
  echo "REVOKE must come BEFORE DROP, wrapped in an exception handler:"
  echo ""
  echo "  DO \$\$ BEGIN"
  echo "    REVOKE EXECUTE ON FUNCTION schema.fn() FROM authenticated;"
  echo "  EXCEPTION WHEN undefined_function THEN NULL;"
  echo "  END \$\$;"
  echo "  DROP FUNCTION IF EXISTS schema.fn() CASCADE;"
  exit 2
fi

# Check 3: DROP TABLE without IF EXISTS (fails on re-run / fresh db reset)
if printf '%s' "$FLAT" | grep -qiE 'DROP[[:space:]]+TABLE[[:space:]]' && \
   ! printf '%s' "$FLAT" | grep -qiE 'DROP[[:space:]]+TABLE[[:space:]]+IF[[:space:]]+EXISTS'; then
  block
  echo "BLOCKED: Migration contains 'DROP TABLE' without 'IF EXISTS'."
  echo "Use 'DROP TABLE IF EXISTS schema.table_name;' so the migration is"
  echo "idempotent across supabase db reset and re-applied environments."
  exit 2
fi

exit 0
