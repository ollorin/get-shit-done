# Sourced right after `INPUT=$(cat)` by the Write/Edit hooks: unreadable input is a deny, not an allow
# (guard-authoring.md section 2 "Unreadable is FAIL"). /usr/bin/jq ships with macOS, so a PATH without jq
# cannot stall the hook.
JQ="$(command -v jq 2>/dev/null)"; [ -x "$JQ" ] || JQ=/usr/bin/jq
[ -x "$JQ" ] || { echo "BLOCKED: jq not found, hook cannot read its input (fail closed)" >&2; exit 2; }
printf '%s' "$INPUT" | "$JQ" -e . >/dev/null 2>&1 || { echo "BLOCKED: hook input is not valid JSON (fail closed)" >&2; exit 2; }
jq() { "$JQ" "$@"; }
