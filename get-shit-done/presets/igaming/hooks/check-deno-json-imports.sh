#!/bin/bash
# Hook: check-deno-json-imports.sh
#
# Blocks writing edge function deno.json files that use "imports": {} blocks.
# The "imports" key in a function-local deno.json overrides the outer
# import_map.json and silently breaks ALL @igaming/* and @supabase/* imports
# at boot (BOOT_ERROR / WORKER_ERROR).
#
# Triggered on: Write, Edit tool calls to apps/api/functions/*/deno.json
#
# Exit codes:
#   0 = allow
#   2 = block with message

PATH="$PATH:/usr/bin:/bin"
INPUT=$(cat)
. "${BASH_SOURCE[0]%/*}/lib/fail-closed.sh"
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || true)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null || true)

# Only check deno.json files inside functions subdirectories
if ! echo "$FILE" | grep -qE 'apps/api/functions/[^/]+/deno\.json$'; then
  exit 0
fi

# For Write tool: check if content has "imports" key
if [ "$TOOL" = "Write" ]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // ""' 2>/dev/null || true)
  if echo "$CONTENT" | grep -qE '"imports"[[:space:]]*:'; then
    # On exit 2, Claude Code only surfaces stderr — send the reason there.
    exec 1>&2
    echo "BLOCKED: Function deno.json uses \"imports\": {} block."
    echo ""
    echo "An \"imports\" block in a function's deno.json overrides the shared"
    echo "import_map.json and silently breaks all @igaming/* workspace imports"
    echo "at boot (BOOT_ERROR / WORKER_ERROR)."
    echo ""
    echo "Correct pattern:"
    echo '  { "importMap": "../import_map.json", "tasks": { "test": "deno test --allow-all --import-map=../import_map.json ." } }'
    echo ""
    echo "Add any function-local imports to apps/api/functions/import_map.json instead."
    echo ""
    echo "See .claude/rules/edge-functions.md CRITICAL section."
    exit 2
  fi
fi

# For Edit tool: check new_string for "imports" key addition
if [ "$TOOL" = "Edit" ]; then
  NEW_STRING=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // ""' 2>/dev/null || true)
  if echo "$NEW_STRING" | grep -qE '"imports"[[:space:]]*:'; then
    # On exit 2, Claude Code only surfaces stderr — send the reason there.
    exec 1>&2
    echo "BLOCKED: Edit introduces \"imports\": {} in function deno.json."
    echo ""
    echo "Use \"importMap\": \"../import_map.json\" instead."
    echo "See .claude/rules/edge-functions.md CRITICAL section."
    exit 2
  fi
fi

exit 0
