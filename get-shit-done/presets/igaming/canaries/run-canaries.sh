#!/bin/bash
# One-command canary runner for the project + user hooks:  scripts/validation/hook-canaries/run-canaries.sh
# Lives outside .claude/hooks so agents can add rows without touching enforcement (RULING R8).
# Env: HOOKS_DIR (default: <repo>/.claude/hooks; a patch copy must NOT live under a path containing .claude/hooks), SLOW=1 (also run `git commit` rows of @bash-all through check-api-contract-drift),
#      VERBOSE=1 (print passing rows). Exits 1 on any mismatch. Uses throwaway git repos in $TMPDIR;
#      never touches the live stack, the real repo state or ~/igaming-platform/.tmp/charlotte.lock.
# Row: {hook,expect,tool,input,cwd,label,class}  expect = allow|deny|ask|grant|rewrite
#   hook "@bash-all" / "@edit-all" runs every registered project hook for that tool (all must give `expect`).
#   reason: REQUIRED on deny/ask rows (substring of the hook's stderr / ask-JSON) so a crash-path deny cannot pass;
#           optional "out" on allow rows asserts a substring of stdout (e.g. an additionalContext reminder).
#   hook "fork:<file>" runs ~/get-shit-done/get-shit-done/bin/hooks/<file> (unregistered or not-yet-installed hooks).
#   raw: string fed verbatim as stdin (fail-closed rows).
#   cwd tokens: @repo-drift (stub registry that exits 1) @repo-nomarker @repo-marker @repo-nopreflight @repo-main @repo-feature @repo-locked @repo-unlocked @repo-stale31 @repo-fresh29 @repo-stale
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
HOOKS_DIR="${HOOKS_DIR:-$HOOKS_ROOT/.claude/hooks}"
CORPUS="${CORPUS:-$HERE/canaries.jsonl}"
UH="$HOME/.claude/get-shit-done/bin/hooks"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkrepo() { # name branch [preflight] [marker]
  local d="$T/$1"; mkdir -p "$d/scripts"; git -C "$d" init -q -b "$2" . 2>/dev/null
  git -C "$d" -c user.email=a@b -c user.name=n commit -q --allow-empty -m init
  [ "${3:-}" = 1 ] && echo '#!/bin/bash' > "$d/scripts/preflight.sh"
  [ "${4:-}" = 1 ] && touch "$d/.preflight-passed"
  echo "$d"
}
R_NOMARKER=$(mkrepo nomarker feature 1 0); R_MARKER=$(mkrepo marker feature 1 1)
R_NOPF=$(mkrepo nopf feature 0 0); R_MAIN=$(mkrepo main main 0 0); R_FEATURE=$(mkrepo feat feature 0 0)
R_LOCKED=$(mkrepo locked feature 0 0); R_UNLOCKED=$(mkrepo unlocked feature 0 0)
R_STALE31=$(mkrepo stale31 feature 1 1); touch -t "$(date -v-31M +%Y%m%d%H%M.%S)" "$R_STALE31/.preflight-passed"   # just past the 30-minute window
R_FRESH29=$(mkrepo fresh29 feature 1 1); touch -t "$(date -v-29M +%Y%m%d%H%M.%S)" "$R_FRESH29/.preflight-passed"   # just inside it
R_STALE=$(mkrepo stale feature 1 1); touch -t "$(date -v-3d +%Y%m%d%H%M.%S)" "$R_STALE/.preflight-passed"
R_PUSHMAIN=$(mkrepo pushmain main 0 0)
R_DRIFT=$(mkrepo drift feature 0 0); mkdir -p "$R_DRIFT/scripts/api-contract"
printf 'console.error("drift: stub");\nDeno.exit(1);\n' > "$R_DRIFT/scripts/api-contract/diff-registries.ts"
mkdir -p "$R_LOCKED/.tmp"
printf '{"pid":%s,"acquired_at":"2026-01-01T00:00:00Z","expires_at":"2099-01-01T00:00:00Z","source":"mcp","holders":[],"main_thread":true,"session_id":null}\n' "$$" > "$R_LOCKED/.tmp/charlotte.lock"
resolve_cwd() { case "$1" in
  @repo-nomarker) echo "$R_NOMARKER";; @repo-marker) echo "$R_MARKER";; @repo-nopreflight) echo "$R_NOPF";;
  @repo-main) echo "$R_MAIN";; @repo-feature) echo "$R_FEATURE";; @repo-locked) echo "$R_LOCKED";; @repo-stale31) echo "$R_STALE31";; @repo-fresh29) echo "$R_FRESH29";; @repo-stale) echo "$R_STALE";; @repo-unlocked) echo "$R_UNLOCKED";; @repo-drift) echo "$R_DRIFT";;
  ""|null) echo "$T";; *) echo "$1";; esac; }
BASH_HOOKS="check-supabase-command.sh check-test-command.sh block-push-without-local-tests.sh redirect-recursive-search.sh check-git-merge-target.sh"
EDIT_HOOKS="check-migration-concurrently.sh check-deno-json-imports.sh check-migration-drop.sh check-flake-patterns.sh"
ERRF="$T/stderr"; OUTF="$T/stdout"
verdict() { # hook-path cwd stdin -> deny|ask|rewrite|allow|errorN ; stderr -> $ERRF, stdout -> $OUTF
  local rc runner=""; case "$1" in *.js) runner=node;; esac
  (cd "$2" && printf '%s' "$3" | CLAUDE_PROJECT_DIR="$HOOKS_ROOT" $runner "$1" >"$OUTF" 2>"$ERRF"); rc=$?
  local out; out=$(cat "$OUTF")
  [ "$rc" = 2 ] && { echo deny; return; }
  [ "$rc" != 0 ] && { echo "error$rc"; return; }
  case "$out" in *'"permissionDecision": "deny"'*|*'"permissionDecision":"deny"'*) echo deny;; *'"permissionDecision": "ask"'*|*'"permissionDecision":"ask"'*) echo ask;; *'"permissionDecision": "allow"'*|*'"permissionDecision":"allow"'*) echo grant;; *updatedInput*) echo rewrite;; *) echo allow;; esac; }
pass=0; fail=0
while IFS= read -r row; do
  [ -z "$row" ] && continue
  hook=$(jq -r .hook <<<"$row"); expect=$(jq -r .expect <<<"$row"); label=$(jq -r .label <<<"$row")
  reason=$(jq -r '.reason // ""' <<<"$row"); outsub=$(jq -r '.out // ""' <<<"$row")
  cwd=$(resolve_cwd "$(jq -r '.cwd // ""' <<<"$row")")
  stdin=$(jq -c --arg cwd "$cwd" '{session_id:"canary",transcript_path:"/tmp/x",cwd:$cwd,permission_mode:"default",hook_event_name:"PreToolUse",tool_name:.tool,tool_input:.input,tool_use_id:"t"}' <<<"$row")
  stdin=${stdin//@DRIFT/$R_DRIFT}
  raw=$(jq -r '.raw // empty' <<<"$row"); [ -n "$raw" ] && stdin="$raw"
  case "$hook" in
    @bash-all) list="$BASH_HOOKS $(jq -r --arg slow "${SLOW:-0}" 'if (.input.command|test("git commit")) and $slow != "1" then "" else "check-api-contract-drift.sh" end' <<<"$row")";;
    @edit-all) list="$EDIT_HOOKS";;
    *) list="$hook";;
  esac
  got=""; seen=""; for h in $list; do
    case "$h" in
      /*|~*) p="${h/#\~/$HOME}";;
      user:*) p="$UH/${h#user:}";;
      fork:*) p="$HOME/get-shit-done/get-shit-done/bin/hooks/${h#fork:}";;
      user-rtk) p="$HOME/.claude/hooks/rtk-rewrite.sh";;
      *) p="$HOOKS_DIR/$h";;
    esac
    v=$(verdict "$p" "$cwd" "$stdin")
    seen="$(cat "$ERRF") $(cat "$OUTF")"
    if [ "$hook" = "@bash-all" ] || [ "$hook" = "@edit-all" ]; then
      [ "$v" != "$expect" ] && { got="$h=$v"; break; } || { got="$expect"; [ "$v" != allow ] && break; }
    else got="$v"; fi
  done
  note=""
  if [ "${DUMP_REASONS:-0}" = 1 ] && [ "$got" = "$expect" ] && { [ "$expect" = deny ] || [ "$expect" = ask ]; }; then
    echo "REASON	$label	$(printf '%s' "$seen" | jq -Rrs 'if test("permissionDecisionReason") then (capture("permissionDecisionReason\":\"(?<r>[^\"]*)").r) else (split("\n")|map(select(length>0))|.[0]) end' 2>/dev/null)"
  fi
  if [ "$got" = "$expect" ]; then
    case "$expect" in
      deny|ask) if [ -z "$reason" ]; then note="row lacks a reason substring"
                elif [[ "$seen" != *"$reason"* ]]; then note="reason '$reason' not in hook output"; fi;;
      *) if [ -n "$outsub" ] && [[ "$seen" != *"$outsub"* ]]; then note="output lacks '$outsub'"; fi;;
    esac
  fi
  if [ "$got" = "$expect" ] && [ -z "$note" ]; then pass=$((pass+1)); [ "${VERBOSE:-0}" = 1 ] && echo "ok   [$hook] $label"
  else fail=$((fail+1)); echo "FAIL [$hook] expect=$expect got=$got${note:+ ($note)} :: $label"; fi
done < "$CORPUS"
echo "canaries: pass=$pass fail=$fail (HOOKS_DIR=$HOOKS_DIR)"
[ "$fail" = 0 ]
