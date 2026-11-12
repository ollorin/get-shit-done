#!/bin/bash
# hooks-apply.sh <id> [--dry-run] - the ONLY sanctioned way to change .claude/hooks/** once hooks are enabled.
# Run by a person in a terminal outside Claude Code: it refuses when CLAUDECODE is set or a claude process is
# an ancestor (a pty from script(1) would pass the TTY gate). This steers; a detached process still passes.
#
#   1. .planning/hook-patches/<id>.patch   patch prepared by an agent, touching only .claude/hooks/** paths
#   2. .planning/hook-patches/<id>.review.md must contain the lines
#         patch-sha256: <sha256 of the .patch file>
#         sonnet-zero-findings: yes
#         opus-review: yes|not-needed      (yes REQUIRED when the patch narrows a deny)
#   3. TTY on stdin+stdout and the typed word APPLY (skipped by --dry-run, which mutates nothing)
#   4. apply, run scripts/validation/hook-canaries/run-canaries.sh, commit ONLY the patched paths with a
#      Hook-Patch: <id> trailer (pre-commit runs; never --no-verify), revert the patch on any failure.
# --dry-run: checks 1-2 and `git apply --check`, then runs the canaries against a patched COPY under .tmp/
# (the copy path must not contain .claude/hooks).
set -u
ID="${1:-}"; MODE="${2:-}"
[ -n "$ID" ] || { echo "usage: scripts/hooks-apply.sh <id> [--dry-run]" >&2; exit 64; }
case "$ID" in *[!A-Za-z0-9._-]*|.*) echo "invalid id" >&2; exit 64;; esac
ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1
PATCH=".planning/hook-patches/$ID.patch"; REVIEW=".planning/hook-patches/$ID.review.md"
die() { echo "hooks-apply: $*" >&2; exit 1; }
sha256_file() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else die "needs shasum or sha256sum"; fi; }
[ -f "$PATCH" ] || die "missing $PATCH"
[ -f "$REVIEW" ] || die "missing $REVIEW"
HASH=$(sha256_file "$PATCH" | awk '{print $1}')
grep -qE "^patch-sha256: $HASH\$" "$REVIEW" || die "patch hash $HASH is not recorded in $REVIEW (a review approves one file state)"
grep -qE '^sonnet-zero-findings: yes$' "$REVIEW" || die "$REVIEW lacks 'sonnet-zero-findings: yes'"
grep -qE '^opus-review: (yes|not-needed)$' "$REVIEW" || die "$REVIEW lacks 'opus-review: yes|not-needed'"
# numstat lines are "added<TAB>deleted<TAB>path"; git C-quotes a path holding a control character or newline (it then starts with a double quote): refused.
NUMSTAT=$(git apply --numstat "$PATCH") || die "patch does not parse"
PATHS=()
while IFS=$'\t' read -r _added _deleted f; do
  [ -n "$f" ] || continue
  case "$f" in \"*|*[[:cntrl:]]*) die "patch path $f holds a control character or newline";; esac
  PATHS+=("$f")
done <<<"$NUMSTAT"
[ "${#PATHS[@]}" -gt 0 ] || die "empty patch"
for f in "${PATHS[@]}"; do
  case "$f" in .claude/hooks/*) ;; *) die "patch touches '$f' (only .claude/hooks/** is allowed)";; esac
  case "$f" in *..*) die "path traversal in '$f'";; esac
done
git apply --check "$PATCH" || die "patch does not apply to the current tree"
# Runs the canary runner and trusts it only when its own count line says pass=<N>, N>0, fail=0: an exit 0 with no count line is a failure.
# HOOKS_DIR and CORPUS inherited from the caller's environment never reach the runner (they could point the canaries at other hooks or rows); only the second argument sets HOOKS_DIR.
run_canaries() { # runner-path [hooks-dir]
  local -a ev=(-u HOOKS_DIR -u CORPUS); [ -n "${2:-}" ] && ev+=("HOOKS_DIR=$2")
  local out rc; out=$(env "${ev[@]}" "$1" 2>&1); rc=$?
  printf '%s\n' "$out"
  [ "$rc" = 0 ] || return "$rc"
  printf '%s\n' "$out" | grep -qE '^canaries: pass=[1-9][0-9]* fail=0 ' || { echo "hooks-apply: the canary runner exited 0 without a 'canaries: pass=N fail=0' count line: not trusted" >&2; return 1; }
}

if [ "$MODE" = "--dry-run" ]; then
  COPY=".tmp/hook-try/$ID"; rm -rf "$COPY"; mkdir -p "$COPY"
  cp -R .claude/hooks/. "$COPY/"
  git apply --directory="$COPY" -p3 "$PATCH" || die "dry-run apply to copy failed"
  echo "dry-run: patched copy at $COPY"
  run_canaries scripts/validation/hook-canaries/run-canaries.sh "$ROOT/$COPY"; exit $?
fi

under_agent() { [ -n "${CLAUDECODE:-}" ] || ps -axo pid=,ppid=,comm= | awk -v p=$$ '{pp[$1]=$2; x=$0; sub(/^ *[0-9]+ +[0-9]+ +/,"",x); c[$1]=x} END{while(p>1&&p in pp){n=c[p]; sub(/.*\//,"",n); if(n ~ /^claude/) exit 0; p=pp[p]} exit 1}'; }
under_agent && die "runs only from a terminal outside Claude Code (an agent can fake a TTY with script(1))"
[ -t 0 ] && [ -t 1 ] || die "needs a TTY (a person in a terminal)"
echo "About to apply hook patch '$ID' to: ${PATHS[*]}"
git apply --stat "$PATCH"
echo "----- patch (this is what APPLY will commit; the .review.md is agent-written and proves nothing) -----"
cat "$PATCH"
echo "-----"
printf 'Type APPLY to continue: '; read -r WORD
[ "$WORD" = "APPLY" ] || die "aborted"
git diff --quiet -- .claude/hooks || die "uncommitted changes under .claude/hooks; resolve first"
git diff --quiet HEAD -- scripts/validation/hook-canaries scripts/hooks-apply.sh || die "uncommitted changes to the canary runner, the corpus or this script; commit or revert them first"
git apply "$PATCH" || die "apply failed"
revert() { git restore --staged -- "${PATHS[@]}" 2>/dev/null; git apply -R "$PATCH" 2>/dev/null; echo "hooks-apply: reverted '$ID': $*" >&2; exit 1; }
run_canaries scripts/validation/hook-canaries/run-canaries.sh || revert "canaries failed"
git add -- "${PATHS[@]}" || revert "git add failed"
git commit -m "fix(hooks): apply hook patch $ID

Hook-Patch: $ID" -- "${PATHS[@]}" || revert "commit failed (pre-commit)"
echo "hooks-apply: '$ID' committed: $(git rev-parse --short HEAD)"
