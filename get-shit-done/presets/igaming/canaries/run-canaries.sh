#!/bin/bash
# One-command canary runner for the project + user hooks:  scripts/validation/hook-canaries/run-canaries.sh
# Lives outside .claude/hooks so agents can add rows without touching enforcement (RULING R8).
# Env: HOOKS_DIR (default: <repo>/.claude/hooks; a patch copy must NOT live under a path containing .claude/hooks), SLOW=1 (also run `git commit` rows of @bash-all through check-api-contract-drift),
#      VERBOSE=1 (print passing rows), DUMP_REASONS=1 (print the deny/ask reason of each row),
#      CANARY_JOBS (parallel workers, default: the CPU count, at most 8; the printed order stays the row order).
#      Exits 1 on any mismatch, a malformed row, or a run count that differs from the row count (fail closed). Uses throwaway git repos in $TMPDIR;
#      never touches the live stack, the real repo state or ~/igaming-platform/.tmp/charlotte.lock.
# Row: {hook,expect,tool,input,cwd,label,class}  expect = allow|deny|ask|grant|rewrite
#   hook "@bash-all" / "@edit-all" runs every registered project hook for that tool (all must give `expect`).
#   reason: REQUIRED on deny/ask rows (substring of the hook's stderr / ask-JSON) so a crash-path deny cannot pass;
#           optional "out" on allow rows asserts a substring of stdout (e.g. an additionalContext reminder).
#   hook "fork:<file>" runs ~/get-shit-done/get-shit-done/bin/hooks/<file> (unregistered or not-yet-installed hooks).
#   raw: string fed verbatim as stdin (fail-closed rows).
#   cwd tokens: @repo-drift (stub registry that exits 1) @repo-nomarker @repo-marker @repo-nopreflight @repo-main @repo-feature @repo-locked @repo-unlocked @repo-stale31 @repo-fresh29 @repo-fresh20 @repo-stale
# Isolation: every worker owns a private copy of the fixture repos ($T/w<k>), so one worker re-aging a marker (age_marker, per case) can
# never move another worker's marker across the 30-minute window (the stale31/fresh29 boundary pair). Hooks still run with
# CLAUDE_PROJECT_DIR=<this repo> (check-flake-patterns.sh needs its real apps/api/scripts), so the run fails if `git status --porcelain`
# (plus a checksum per listed file) of this repo differs before and after: no hook may write there; concurrent edits by other agents trip it too.
set -u
for tool in jq git; do command -v "$tool" >/dev/null 2>&1 || { echo "run-canaries: required tool '$tool' not found on PATH (fail closed)" >&2; exit 1; }; done
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
HOOKS_DIR="${HOOKS_DIR:-$HOOKS_ROOT/.claude/hooks}"
CORPUS="${CORPUS:-$HERE/canaries.jsonl}"
[ -f "$CORPUS" ] && [ -r "$CORPUS" ] || { echo "run-canaries: corpus '$CORPUS' is missing or unreadable (fail closed)" >&2; exit 1; }
UH="$HOME/.claude/get-shit-done/bin/hooks"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkrepo() { # name branch [preflight] [marker]
  local d="$T/base/$1"; mkdir -p "$d/scripts"; git -C "$d" init -q -b "$2" . 2>/dev/null
  git -C "$d" -c user.email=a@b -c user.name=n commit -q --allow-empty -m init
  [ "${3:-}" = 1 ] && echo '#!/bin/bash' > "$d/scripts/preflight.sh"
  [ "${4:-}" = 1 ] && touch "$d/.preflight-passed"
  return 0
}
mkdir "$T/base" || exit 1
mkrepo nomarker feature 1 0 & mkrepo marker feature 1 1 & mkrepo nopf feature 0 0 & mkrepo main main 0 0 & mkrepo feat feature 0 0 &
mkrepo locked feature 0 0 & mkrepo unlocked feature 0 0 & mkrepo stale31 feature 1 1 & mkrepo fresh29 feature 1 1 & mkrepo fresh20 feature 1 1 &
mkrepo stale feature 1 1 & mkrepo pushmain main 0 0 & mkrepo drift feature 0 0 &
wait
for d in nomarker marker nopf main feat locked unlocked stale31 fresh29 fresh20 stale pushmain drift; do
  git -C "$T/base/$d" rev-parse -q --verify HEAD >/dev/null 2>&1 || { echo "run-canaries: the fixture repo '$d' could not be made (fail closed)" >&2; exit 1; }
done
touch -t "$(date -v-31M +%Y%m%d%H%M.%S)" "$T/base/stale31/.preflight-passed"   # just past the 30-minute window
touch -t "$(date -v-29M +%Y%m%d%H%M.%S)" "$T/base/fresh29/.preflight-passed"   # just inside it
touch -t "$(date -v-3d +%Y%m%d%H%M.%S)" "$T/base/stale/.preflight-passed"
mkdir -p "$T/base/drift/scripts/api-contract"
printf 'console.error("drift: stub");\nDeno.exit(1);\n' > "$T/base/drift/scripts/api-contract/diff-registries.ts"
mkdir -p "$T/base/locked/.tmp"
printf '{"pid":%s,"acquired_at":"2026-01-01T00:00:00Z","expires_at":"2099-01-01T00:00:00Z","source":"mcp","holders":[],"main_thread":true,"session_id":null}\n' "$$" > "$T/base/locked/.tmp/charlotte.lock"
age_marker() { touch -t "$(date -v-"$2"M +%Y%m%d%H%M.%S)" "$1/.preflight-passed"; }   # re-aged per case: a load-time age drifts across the 30-minute window
BASH_HOOKS="check-supabase-command.sh check-test-command.sh block-push-without-local-tests.sh redirect-recursive-search.sh check-git-merge-target.sh"
EDIT_HOOKS="check-migration-concurrently.sh check-deno-json-imports.sh check-migration-drop.sh check-flake-patterns.sh"
verdict() { # hook-path cwd stdin -> V=deny|ask|rewrite|grant|allow|errorN (no subshell per call); stderr -> $ERRF, stdout -> $OUTF
  local rc runner=""; case "$1" in *.js) runner=node;; esac
  (cd "$2" && printf '%s' "$3" | CLAUDE_PROJECT_DIR="$HOOKS_ROOT" $runner "$1" >"$OUTF" 2>"$ERRF"); rc=$?
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
# printf %b; trailing newlines and NUL dropped, as a command substitution would), then the hook's stdin object. A repo token resolves to
# @W@/<name>; the worker swaps @W@ for its own repo root. @DRIFT in the stdin text becomes the worker's drift repo.
ROW_FIELDS='def txt: if type == "string" then . else tojson end;
def clean: txt | explode | map(select(. != 0)) | implode | sub("\n+\\z"; "");
def enc: gsub("\\\\"; "\\\\") | gsub("\n"; "\\n") | gsub("\u001f"; "\\0037");
select(length > 0) | fromjson
| ((.cwd // "") | clean) as $c
| ($repos[$c] // (if $c == "" or $c == "null" then $T else $c end)) as $cwd
| (if .hook == "@bash-all" then (try (if (.input.command|test("git commit")) and $slow != "1" then "" else "check-api-contract-drift.sh" end) catch "") else "" end) as $extra
| ([.hook, .expect, .label, (.reason // ""), (.out // ""), $cwd, (.raw // ""), $extra] | map(clean | enc) | join("\u001f") + "\u001f."),
  ({session_id:"canary",transcript_path:"/tmp/x",cwd:$cwd,permission_mode:"default",hook_event_name:"PreToolUse",tool_name:.tool,tool_input:.input,tool_use_id:"t"} | tojson | gsub("@DRIFT"; "@W@/drift"))'
REPOS='{"@repo-nomarker":"@W@/nomarker","@repo-marker":"@W@/marker","@repo-nopreflight":"@W@/nopf","@repo-main":"@W@/main","@repo-feature":"@W@/feat",
  "@repo-locked":"@W@/locked","@repo-unlocked":"@W@/unlocked","@repo-stale31":"@W@/stale31","@repo-fresh29":"@W@/fresh29","@repo-fresh20":"@W@/fresh20",
  "@repo-stale":"@W@/stale","@repo-drift":"@W@/drift"}'
ROWS="$T/rows"
jq -Rrc --arg T "$T" --arg slow "${SLOW:-0}" --argjson repos "$REPOS" "$ROW_FIELDS" "$CORPUS" > "$ROWS" || { echo "run-canaries: the rows of '$CORPUS' could not be read (fail closed)" >&2; exit 1; }
US=$(printf '\037')
JOBS="${CANARY_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null)}"; case "$JOBS" in ''|*[!0-9]*) JOBS=4;; esac
[ "$JOBS" -ge 1 ] || JOBS=1; [ "$JOBS" -le 8 ] || JOBS=8
mkdir "$T/o" || exit 1
worker() { # worker k takes the rows whose index mod JOBS is k, in its own repo copy $T/w<k>; output to $T/o/<index>, counts to $T/cnt.<k>
local k="$1" idx=0 pass=0 fail=0 ran=0 W="$T/w$1"; ERRF="$T/stderr.$k"; OUTF="$T/stdout.$k"
cp -Rp "$T/base" "$W" || return
while IFS="$US" read -r hook expect label reason outsub cwd raw extra _ && IFS= read -r stdin; do
  idx=$((idx+1)); [ $((idx % JOBS)) = "$k" ] || continue
  ran=$((ran+1)); {
  for f in hook expect label reason outsub cwd raw extra; do case "${!f}" in *\\*) printf -v "$f" '%b' "${!f}";; esac; done # only an escaped field is decoded
  stdin=${stdin//@W@/$W}; cwd=${cwd//@W@/$W}
  case "$cwd" in
    "$W/stale31") age_marker "$W/stale31" 31;; "$W/fresh29") age_marker "$W/fresh29" 29;; "$W/fresh20") age_marker "$W/fresh20" 20;;
  esac
  [ -n "$raw" ] && stdin="$raw"
  case "$hook" in
    @bash-all) list="$BASH_HOOKS $extra";;
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
    verdict "$p" "$cwd" "$stdin"; v=$V
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
repo_state() { git -C "$HOOKS_ROOT" status --porcelain --untracked-files=all 2>/dev/null | sort | while IFS= read -r l; do printf '%s %s\n' "$l" "$(cksum < "$HOOKS_ROOT/${l:3}" 2>/dev/null)"; done; }
STATE_BEFORE="$(repo_state)"
k=0; while [ "$k" -lt "$JOBS" ]; do worker "$k" & k=$((k+1)); done; wait
STATE_AFTER="$(repo_state)"
pass=0; fail=0; ran=0; k=0
while [ "$k" -lt "$JOBS" ]; do
  if read -r r p f < "$T/cnt.$k"; then ran=$((ran+r)); pass=$((pass+p)); fail=$((fail+f)); fi 2>/dev/null
  k=$((k+1))
done
i=1; while [ "$i" -le "$TOTAL" ]; do [ -s "$T/o/$i" ] && cat "$T/o/$i"; i=$((i+1)); done
if [ "$ran" != "$TOTAL" ] || [ $((pass + fail)) != "$TOTAL" ]; then echo "run-canaries: ran $ran of $TOTAL rows (pass=$pass fail=$fail): the run is incomplete (fail closed)" >&2; exit 1; fi
if [ "$STATE_BEFORE" != "$STATE_AFTER" ]; then
  echo "FAIL a hook wrote inside the shared repo $HOOKS_ROOT during the run (git status --porcelain differs before/after):"
  diff <(printf '%s\n' "$STATE_BEFORE") <(printf '%s\n' "$STATE_AFTER") | head -20
  fail=$((fail+1))
fi
echo "canaries: pass=$pass fail=$fail (HOOKS_DIR=$HOOKS_DIR)"
[ "$fail" = 0 ]
