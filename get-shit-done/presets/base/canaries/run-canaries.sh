#!/bin/bash
# One-command canary runner for the project hooks:  scripts/validation/hook-canaries/run-canaries.sh
# Lives outside .claude/hooks so rows can be added without touching enforcement; a changed runner or a removed row is reported by hook-patch-trailer-check.sh.
# Env: HOOKS_DIR (default: <repo>/.claude/hooks), CORPUS (default: canaries.jsonl beside this file),
#      VERBOSE=1 (print passing rows), DUMP_REASONS=1 (print the deny/ask reason of each row).
# Exits 1 on any mismatch. Needs only jq and perl (a missing one is a named failure). Fails closed: a missing or empty corpus, a row that does not
# parse as {hook,expect,tool,label strings; input object or raw string}, or a run count that differs from the row count exits 1 and prints no
# "canaries: pass=" line. Uses throwaway git repos in $TMPDIR.
# Row: {hook,expect,tool,input,cwd,label,class}  expect = allow|deny|ask|grant|rewrite
#   hook "@bash-all" / "@edit-all" runs every registered hook for that tool (all must give `expect`).
#   reason: REQUIRED on deny/ask rows (substring of the hook's stderr / ask-JSON) so a crash-path deny cannot pass;
#           optional "out" on allow rows asserts a substring of stdout.
#   raw: string fed verbatim as stdin (fail-closed rows).
#   cwd tokens: @repo-default (on the default branch) @repo-feature @repo-master (on master) @repo-nomarker @repo-marker @repo-nogate
#               @repo-rootmarker @repo-stale31 @repo-fresh29 @repo-stale
#               @repo-locked-cmds (config: stack.locked_commands = test:e2e, run-all-suites.sh) @repo-badcfg (config that is not JSON)
#               @repo-locked-multi (config: stack.locked_commands = "npm run test:e2e", "make integration")
#               @repo-never (config: locked_commands test:e2e + stack.deploy.never_touch of three entries)
#               @repo-flake-cfg (config: stack.flake_patterns with three example patterns) @repo-flake-badre (a pattern whose regex is invalid)
set -u
for tool in jq perl git; do command -v "$tool" >/dev/null 2>&1 || { echo "run-canaries: required tool '$tool' not found on PATH: refusing to report a pass (fail closed)" >&2; exit 1; }; done
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
HOOKS_DIR="${HOOKS_DIR:-$HOOKS_ROOT/.claude/hooks}"
CORPUS="${CORPUS:-$HERE/canaries.jsonl}"
[ -f "$CORPUS" ] && [ -r "$CORPUS" ] || { echo "run-canaries: corpus '$CORPUS' is missing or unreadable (fail closed)" >&2; exit 1; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
age_file() { perl -e '$t = time - $ARGV[1]; utime $t, $t, $ARGV[0] or die "utime failed\n"' "$1" "$2"; } # file seconds-old
mkrepo() { # name branch [gate 1|0] [marker 0|1 = in git dir, 2 = repo root]
  local d="$T/$1"; mkdir -p "$d"; git -C "$d" init -q -b "$2" . 2>/dev/null
  git -C "$d" -c user.email=a@b -c user.name=n commit -q --allow-empty -m init
  if [ "${3:-}" = 1 ]; then mkdir -p "$(dirname "$d/{{stack.commands.pre_pr_gate}}")"; echo '#!/bin/bash' > "$d/{{stack.commands.pre_pr_gate}}"; fi
  [ "${4:-}" = 1 ] && touch "$d/.git/.pre-pr-passed"
  [ "${4:-}" = 2 ] && touch "$d/.pre-pr-passed"
  echo "$d"
}
R_DEFAULT=$(mkrepo default "{{stack.branch.default}}"); R_FEATURE=$(mkrepo feat feature 0 0)
R_NOMARKER=$(mkrepo nomarker feature 1 0); R_MARKER=$(mkrepo marker feature 1 1); R_NOGATE=$(mkrepo nogate feature 0 0)
R_ROOTMARKER=$(mkrepo rootmarker feature 1 2); R_MASTER=$(mkrepo master master 0 0)
mkcfg() { # name json: a feature-branch repo holding .planning/config.json
  local d; d=$(mkrepo "$1" feature 0 0); mkdir -p "$d/.planning"; printf '%s' "$2" > "$d/.planning/config.json"; echo "$d"
}
R_LOCKED=$(mkcfg lockedcmds '{"stack":{"locked_commands":["test:e2e","run-all-suites.sh"]}}'); R_BADCFG=$(mkcfg badcfg '{not json')
R_LOCKEDMULTI=$(mkcfg lockedmulti '{"stack":{"locked_commands":["npm run test:e2e","make integration"]}}')
R_NEVER=$(mkcfg never '{"stack":{"locked_commands":["test:e2e"],"deploy":{"never_touch":["gh workflow run deploy-prod","tools/release.sh prod","git push heroku"]}}}')
mkcfg_stdin() { # name: like mkcfg, the config.json text comes from stdin
  local d; d=$(mkrepo "$1" feature 0 0); mkdir -p "$d/.planning"; cat > "$d/.planning/config.json"; echo "$d"
}
R_FLAKE=$(mkcfg_stdin flakecfg <<'JSON'
{"stack":{"flake_patterns":{"test_globs":["**/*.integration.test.ts"],"patterns":[{"id":"hardcoded-round-number","match":"round_number\\s*:\\s*(?![\"'])\\d+\\b","requires_before":"\\.from\\(\\s*[\"'][\\w.]*[Ss]hared[\\w.]*[\"'](?![\\s\\S]*\\.from\\()","unless_nearby":"23505","message":"hardcoded round_number inserted into a shared table with no nearby 23505 retry; namespace the value per run or retry on collision"},{"id":"hardcoded-id","match":"(?:^|[^\\w.])(?:[A-Za-z_]\\w*_id|id)\\s*:\\s*(?![\"'])\\d+\\b","requires_before":"\\.from\\(\\s*[\"'][\\w.]*[Ss]hared[\\w.]*[\"'](?![\\s\\S]*\\.from\\()","unless_nearby":"23505","message":"hardcoded id inserted into a shared table with no nearby 23505 retry; namespace the value per run or retry on collision"},{"id":"absolute-time-window","match":"(?:end_hour|endHour)\\s*:\\s*(?![\"'])\\d+\\b","requires_before":"(?:start_hour|startHour)\\s*:\\s*(?![\"'])\\d+\\b","unless_nearby":"getUTCHours","message":"hardcoded absolute hour window with no getUTCHours-anchored window nearby; anchor it to the current UTC hour"}]}}}
JSON
)
R_FLAKEBAD=$(mkcfg_stdin flakebadre <<'JSON'
{"stack":{"flake_patterns":{"test_globs":["**/*.integration.test.ts"],"patterns":[{"id":"bad","match":"(unclosed","message":"never reached"}]}}}
JSON
)
R_STALE31=$(mkrepo stale31 feature 1 1); age_file "$R_STALE31/.git/.pre-pr-passed" $((31 * 60))   # just past the 30-minute window
R_FRESH29=$(mkrepo fresh29 feature 1 1); age_file "$R_FRESH29/.git/.pre-pr-passed" $((29 * 60))   # just inside it
R_STALE=$(mkrepo stale feature 1 1); age_file "$R_STALE/.git/.pre-pr-passed" $((3 * 86400))
resolve_cwd() { case "$1" in
  @repo-default) echo "$R_DEFAULT";; @repo-feature) echo "$R_FEATURE";; @repo-nomarker) echo "$R_NOMARKER";;
  @repo-marker) echo "$R_MARKER";; @repo-nogate) echo "$R_NOGATE";; @repo-rootmarker) echo "$R_ROOTMARKER";; @repo-master) echo "$R_MASTER";; @repo-locked-cmds) echo "$R_LOCKED";; @repo-locked-multi) echo "$R_LOCKEDMULTI";; @repo-never) echo "$R_NEVER";; @repo-flake-cfg) echo "$R_FLAKE";; @repo-flake-badre) echo "$R_FLAKEBAD";; @repo-badcfg) echo "$R_BADCFG";;
  @repo-stale31) echo "$R_STALE31";; @repo-fresh29) echo "$R_FRESH29";; @repo-stale) echo "$R_STALE";;
  ""|null) echo "$T";; *) echo "$1";; esac; }
BASH_HOOKS="redirect-recursive-search.sh check-git-merge-target.sh block-push-without-local-tests.sh check-test-command.sh check-denied-command.sh"
EDIT_HOOKS="check-flake-patterns.sh"
ERRF="$T/stderr"; OUTF="$T/stdout"
verdict() { # hook-path cwd stdin -> deny|ask|rewrite|grant|allow|errorN ; stderr -> $ERRF, stdout -> $OUTF
  local rc; (cd "$2" && printf '%s' "$3" | CLAUDE_PROJECT_DIR="$HOOKS_ROOT" "$1" >"$OUTF" 2>"$ERRF"); rc=$?
  local out; out=$(cat "$OUTF")
  [ "$rc" = 2 ] && { echo deny; return; }
  [ "$rc" != 0 ] && { echo "error$rc"; return; }
  case "$out" in *'"permissionDecision": "deny"'*|*'"permissionDecision":"deny"'*) echo deny;; *'"permissionDecision": "ask"'*|*'"permissionDecision":"ask"'*) echo ask;; *'"permissionDecision": "allow"'*|*'"permissionDecision":"allow"'*) echo grant;; *updatedInput*) echo rewrite;; *) echo allow;; esac; }
ROW_SHAPE='type=="object" and (.hook|type=="string" and length>0) and (.expect|IN("allow","deny","ask","grant","rewrite")) and (.label|type=="string") and ((.raw|type=="string") or ((.tool|type=="string") and (.input|type=="object")))'
TOTAL=$(grep -c -v '^$' "$CORPUS"); TOTAL=${TOTAL:-0}
if [ "$TOTAL" -lt 1 ]; then echo "run-canaries: corpus '$CORPUS' holds no rows (fail closed)" >&2; exit 1; fi
badrows=0; lineno=0
while IFS= read -r row || [ -n "$row" ]; do
  lineno=$((lineno+1)); [ -z "$row" ] && continue
  jq -e "$ROW_SHAPE" <<<"$row" >/dev/null 2>&1 || { echo "FAIL corpus line $lineno does not parse as a canary row"; badrows=$((badrows+1)); }
done < "$CORPUS"
[ "$badrows" = 0 ] || { echo "run-canaries: $badrows malformed row(s) in '$CORPUS' (fail closed)" >&2; exit 1; }
pass=0; fail=0; ran=0
while IFS= read -r row || [ -n "$row" ]; do
  [ -z "$row" ] && continue
  ran=$((ran+1))
  hook=$(jq -r .hook <<<"$row"); expect=$(jq -r .expect <<<"$row"); label=$(jq -r .label <<<"$row")
  reason=$(jq -r '.reason // ""' <<<"$row"); outsub=$(jq -r '.out // ""' <<<"$row")
  cwd=$(resolve_cwd "$(jq -r '.cwd // ""' <<<"$row")")
  stdin=$(jq -c --arg cwd "$cwd" '{session_id:"canary",transcript_path:"/tmp/x",cwd:$cwd,permission_mode:"default",hook_event_name:"PreToolUse",tool_name:.tool,tool_input:.input,tool_use_id:"t"}' <<<"$row")
  raw=$(jq -r '.raw // empty' <<<"$row"); [ -n "$raw" ] && stdin="$raw"
  case "$hook" in
    @bash-all) list="$BASH_HOOKS";;
    @edit-all) list="$EDIT_HOOKS";;
    *) list="$hook";;
  esac
  got=""; seen=""; for h in $list; do
    v=$(verdict "$HOOKS_DIR/$h" "$cwd" "$stdin")
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
if [ "$ran" != "$TOTAL" ] || [ $((pass + fail)) != "$TOTAL" ]; then echo "run-canaries: ran $ran of $TOTAL rows (pass=$pass fail=$fail): the run is incomplete (fail closed)" >&2; exit 1; fi
echo "canaries: pass=$pass fail=$fail (HOOKS_DIR=$HOOKS_DIR)"
[ "$fail" = 0 ]
