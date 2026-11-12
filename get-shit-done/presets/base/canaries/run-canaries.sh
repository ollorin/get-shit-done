#!/bin/bash
# One-command canary runner for the project hooks:  scripts/validation/hook-canaries/run-canaries.sh
# Lives outside .claude/hooks so rows can be added without touching enforcement; a changed runner or a removed row is reported by hook-patch-trailer-check.sh.
# Env: HOOKS_DIR (default: <repo>/.claude/hooks), CORPUS (default: canaries.jsonl beside this file),
#      VERBOSE=1 (print passing rows), DUMP_REASONS=1 (print the deny/ask reason of each row).
#      CANARY_JOBS (parallel workers, default: the CPU count, at most 8; the printed order stays the row order).
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
mkrepo() { # name branch [gate 1|0] [marker 0|1 = in git dir, 2 = repo root]: makes $T/<name>
  local d="$T/$1"; mkdir -p "$d"; git -C "$d" init -q -b "$2" . 2>/dev/null
  git -C "$d" -c user.email=a@b -c user.name=n commit -q --allow-empty -m init
  if [ "${3:-}" = 1 ]; then mkdir -p "$(dirname "$d/{{stack.commands.pre_pr_gate}}")"; echo '#!/bin/bash' > "$d/{{stack.commands.pre_pr_gate}}"; fi
  [ "${4:-}" = 1 ] && touch "$d/.git/.pre-pr-passed"
  [ "${4:-}" = 2 ] && touch "$d/.pre-pr-passed"
  return 0
}
mkcfg() { # name json: a feature-branch repo holding .planning/config.json
  mkrepo "$1" feature 0 0; mkdir -p "$T/$1/.planning"; printf '%s' "$2" > "$T/$1/.planning/config.json"
}
mkcfg_stdin() { # name: like mkcfg, the config.json text comes from stdin
  mkrepo "$1" feature 0 0; mkdir -p "$T/$1/.planning"; cat > "$T/$1/.planning/config.json"
}
# The fixture repos are independent of each other, so they are made in parallel.
mkrepo default "{{stack.branch.default}}" & mkrepo feat feature 0 0 &
mkrepo nomarker feature 1 0 & mkrepo marker feature 1 1 & mkrepo nogate feature 0 0 &
mkrepo rootmarker feature 1 2 & mkrepo master master 0 0 &
mkcfg lockedcmds '{"stack":{"locked_commands":["test:e2e","run-all-suites.sh"]}}' & mkcfg badcfg '{not json' &
mkcfg lockedmulti '{"stack":{"locked_commands":["npm run test:e2e","make integration"]}}' &
mkcfg never '{"stack":{"locked_commands":["test:e2e"],"deploy":{"never_touch":["gh workflow run deploy-prod","tools/release.sh prod","git push heroku"]}}}' &
{ mkcfg_stdin flakecfg <<'JSON'
{"stack":{"flake_patterns":{"test_globs":["**/*.integration.test.ts"],"patterns":[{"id":"hardcoded-round-number","match":"round_number\\s*:\\s*(?![\"'])\\d+\\b","requires_before":"\\.from\\(\\s*[\"'][\\w.]*[Ss]hared[\\w.]*[\"'](?![\\s\\S]*\\.from\\()","unless_nearby":"23505","message":"hardcoded round_number inserted into a shared table with no nearby 23505 retry; namespace the value per run or retry on collision"},{"id":"hardcoded-id","match":"(?:^|[^\\w.])(?:[A-Za-z_]\\w*_id|id)\\s*:\\s*(?![\"'])\\d+\\b","requires_before":"\\.from\\(\\s*[\"'][\\w.]*[Ss]hared[\\w.]*[\"'](?![\\s\\S]*\\.from\\()","unless_nearby":"23505","message":"hardcoded id inserted into a shared table with no nearby 23505 retry; namespace the value per run or retry on collision"},{"id":"absolute-time-window","match":"(?:end_hour|endHour)\\s*:\\s*(?![\"'])\\d+\\b","requires_before":"(?:start_hour|startHour)\\s*:\\s*(?![\"'])\\d+\\b","unless_nearby":"getUTCHours","message":"hardcoded absolute hour window with no getUTCHours-anchored window nearby; anchor it to the current UTC hour"}]}}}
JSON
} &
{ mkcfg_stdin flakebadre <<'JSON'
{"stack":{"flake_patterns":{"test_globs":["**/*.integration.test.ts"],"patterns":[{"id":"bad","match":"(unclosed","message":"never reached"}]}}}
JSON
} &
{ mkrepo stale31 feature 1 1; age_file "$T/stale31/.git/.pre-pr-passed" $((31 * 60)); } &   # just past the 30-minute window
{ mkrepo fresh29 feature 1 1; age_file "$T/fresh29/.git/.pre-pr-passed" $((29 * 60)); } &   # just inside it
{ mkrepo stale feature 1 1; age_file "$T/stale/.git/.pre-pr-passed" $((3 * 86400)); } &
wait
for d in default feat nomarker marker nogate rootmarker master lockedcmds badcfg lockedmulti never flakecfg flakebadre stale31 fresh29 stale; do
  git -C "$T/$d" rev-parse -q --verify HEAD >/dev/null 2>&1 || { echo "run-canaries: the fixture repo '$d' could not be made (fail closed)" >&2; exit 1; }
done
R_DEFAULT="$T/default"; R_FEATURE="$T/feat"; R_NOMARKER="$T/nomarker"; R_MARKER="$T/marker"; R_NOGATE="$T/nogate"; R_ROOTMARKER="$T/rootmarker"
R_MASTER="$T/master"; R_LOCKED="$T/lockedcmds"; R_BADCFG="$T/badcfg"; R_LOCKEDMULTI="$T/lockedmulti"; R_NEVER="$T/never"; R_FLAKE="$T/flakecfg"
R_FLAKEBAD="$T/flakebadre"; R_STALE31="$T/stale31"; R_FRESH29="$T/fresh29"; R_STALE="$T/stale"
BASH_HOOKS="redirect-recursive-search.sh check-git-merge-target.sh block-push-without-local-tests.sh check-test-command.sh check-denied-command.sh"
EDIT_HOOKS="check-flake-patterns.sh"
ERRF="$T/stderr"; OUTF="$T/stdout"
verdict() { # hook-path cwd stdin -> V=deny|ask|rewrite|grant|allow|errorN (a variable: no subshell per call); stderr -> $ERRF, stdout -> $OUTF
  local rc; (cd "$2" && printf '%s' "$3" | CLAUDE_PROJECT_DIR="$HOOKS_ROOT" "$1" >"$OUTF" 2>"$ERRF"); rc=$?
  local out; out=$(<"$OUTF")
  [ "$rc" = 2 ] && { V=deny; return; }
  [ "$rc" != 0 ] && { V="error$rc"; return; }
  case "$out" in *'"permissionDecision": "deny"'*|*'"permissionDecision":"deny"'*) V=deny;; *'"permissionDecision": "ask"'*|*'"permissionDecision":"ask"'*) V=ask;; *'"permissionDecision": "allow"'*|*'"permissionDecision":"allow"'*) V=grant;; *updatedInput*) V=rewrite;; *) V=allow;; esac; }
ROW_SHAPE='type=="object" and (.hook|type=="string" and length>0) and (.expect|IN("allow","deny","ask","grant","rewrite")) and (.label|type=="string") and ((.raw|type=="string") or ((.tool|type=="string") and (.input|type=="object")))'
TOTAL=$(grep -c -v '^$' "$CORPUS"); TOTAL=${TOTAL:-0}
if [ "$TOTAL" -lt 1 ]; then echo "run-canaries: corpus '$CORPUS' holds no rows (fail closed)" >&2; exit 1; fi
# One jq pass checks every row; only when it does not vouch for the whole corpus does the per-row check below run and name the line.
shape_ok=$(jq -Rn "[inputs | length == 0 or ([try (fromjson | $ROW_SHAPE) catch false] == [true])] | all" "$CORPUS" 2>/dev/null)
badrows=0; lineno=0
[ "$shape_ok" = true ] || while IFS= read -r row || [ -n "$row" ]; do
  lineno=$((lineno+1)); [ -z "$row" ] && continue
  jq -e "$ROW_SHAPE" <<<"$row" >/dev/null 2>&1 || { echo "FAIL corpus line $lineno does not parse as a canary row"; badrows=$((badrows+1)); }
done < "$CORPUS"
[ "$badrows" = 0 ] || { echo "run-canaries: $badrows malformed row(s) in '$CORPUS' (fail closed)" >&2; exit 1; }
# One jq pass turns each row into two lines: the fields joined by the unit separator (backslash, newline and the separator escaped for
# printf %b; trailing newlines and NUL dropped, as a command substitution would), then the hook's stdin object.
ROW_FIELDS='def txt: if type == "string" then . else tojson end;
def clean: txt | explode | map(select(. != 0)) | implode | sub("\n+\\z"; "");
def enc: gsub("\\\\"; "\\\\") | gsub("\n"; "\\n") | gsub("\u001f"; "\\0037");
select(length > 0) | fromjson
| ((.cwd // "") | clean) as $c
| ($repos[$c] // (if $c == "" or $c == "null" then $T else $c end)) as $cwd
| ([.hook, .expect, .label, (.reason // ""), (.out // ""), $cwd, (.raw // "")] | map(clean | enc) | join("\u001f") + "\u001f."),
  {session_id:"canary",transcript_path:"/tmp/x",cwd:$cwd,permission_mode:"default",hook_event_name:"PreToolUse",tool_name:.tool,tool_input:.input,tool_use_id:"t"}'
REPOS=$(jq -cn --arg default "$R_DEFAULT" --arg feature "$R_FEATURE" --arg nomarker "$R_NOMARKER" --arg marker "$R_MARKER" --arg nogate "$R_NOGATE" \
  --arg rootmarker "$R_ROOTMARKER" --arg master "$R_MASTER" --arg locked "$R_LOCKED" --arg lockedmulti "$R_LOCKEDMULTI" --arg never "$R_NEVER" \
  --arg flake "$R_FLAKE" --arg flakebad "$R_FLAKEBAD" --arg badcfg "$R_BADCFG" --arg stale31 "$R_STALE31" --arg fresh29 "$R_FRESH29" --arg stale "$R_STALE" \
  '{"@repo-default":$default,"@repo-feature":$feature,"@repo-nomarker":$nomarker,"@repo-marker":$marker,"@repo-nogate":$nogate,"@repo-rootmarker":$rootmarker,
    "@repo-master":$master,"@repo-locked-cmds":$locked,"@repo-locked-multi":$lockedmulti,"@repo-never":$never,"@repo-flake-cfg":$flake,
    "@repo-flake-badre":$flakebad,"@repo-badcfg":$badcfg,"@repo-stale31":$stale31,"@repo-fresh29":$fresh29,"@repo-stale":$stale}')
ROWS="$T/rows"
jq -Rrc --arg T "$T" --argjson repos "$REPOS" "$ROW_FIELDS" "$CORPUS" > "$ROWS" || { echo "run-canaries: the rows of '$CORPUS' could not be read (fail closed)" >&2; exit 1; }
US=$(printf '\037')
# The rows are independent, so JOBS workers share them (CANARY_JOBS, default: the CPU count, at most 8); worker k takes the rows whose
# index mod JOBS is k, writes what a row prints to $T/o/<index> and its counts to $T/cnt.<k>. A worker that dies leaves no counts: incomplete.
JOBS="${CANARY_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null)}"; case "$JOBS" in ''|*[!0-9]*) JOBS=4;; esac
[ "$JOBS" -ge 1 ] || JOBS=1; [ "$JOBS" -le 8 ] || JOBS=8
mkdir "$T/o" || exit 1
worker() {
local k="$1" idx=0 pass=0 fail=0 ran=0; ERRF="$T/stderr.$k"; OUTF="$T/stdout.$k"
while IFS="$US" read -r hook expect label reason outsub cwd raw _ && IFS= read -r stdin; do
  idx=$((idx+1)); [ $((idx % JOBS)) = "$k" ] || continue
  ran=$((ran+1)); {
  for f in hook expect label reason outsub cwd raw; do case "${!f}" in *\\*) printf -v "$f" '%b' "${!f}";; esac; done # only an escaped field is decoded
  [ -n "$raw" ] && stdin="$raw"
  case "$hook" in
    @bash-all) list="$BASH_HOOKS";;
    @edit-all) list="$EDIT_HOOKS";;
    *) list="$hook";;
  esac
  got=""; seen=""; for h in $list; do
    verdict "$HOOKS_DIR/$h" "$cwd" "$stdin"; v=$V
    seen="$(<"$ERRF") $(<"$OUTF")"
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
  } > "$T/o/$idx"
done < "$ROWS"
echo "$ran $pass $fail" > "$T/cnt.$k"
}
k=0; while [ "$k" -lt "$JOBS" ]; do worker "$k" & k=$((k+1)); done; wait
pass=0; fail=0; ran=0; k=0
while [ "$k" -lt "$JOBS" ]; do
  if read -r r p f < "$T/cnt.$k"; then ran=$((ran+r)); pass=$((pass+p)); fail=$((fail+f)); fi 2>/dev/null
  k=$((k+1))
done
i=1; while [ "$i" -le "$TOTAL" ]; do [ -s "$T/o/$i" ] && cat "$T/o/$i"; i=$((i+1)); done
if [ "$ran" != "$TOTAL" ] || [ $((pass + fail)) != "$TOTAL" ]; then echo "run-canaries: ran $ran of $TOTAL rows (pass=$pass fail=$fail): the run is incomplete (fail closed)" >&2; exit 1; fi
echo "canaries: pass=$pass fail=$fail (HOOKS_DIR=$HOOKS_DIR)"
[ "$fail" = 0 ]
