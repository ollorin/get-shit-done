#!/bin/bash
# Hook-Patch trailer gate (detective control for .claude/hooks). Once hooks are enabled, scripts/hooks-apply.sh
# is the only sanctioned path into .claude/hooks and .claude/settings.json, and it stamps every commit with a
# `Hook-Patch: <id>` trailer. This fails when a commit in FLOOR..HEAD touching those paths lacks the trailer.
# The canary runner, its corpus and the two scripts are watched too: a commit that deletes or rewrites a canary row needs
# the trailer, adding one does not. A `project sync` run from a terminal that changes these paths is committed by that
# person with `Hook-Patch: preset-<name>-<version>`; hooks-apply.sh stamps its own.
# Deterministic, read-only, no stack. Wire it into the project's pre-PR gate.
#   hook-patch-trailer-check.sh [--floor <sha>] [--repo <dir>]
# Without --floor the floor is the oldest commit that touches those paths (the one that deployed them; exempt).
# Unreadable is FAIL: an unresolvable floor, a floor that is not an ancestor of HEAD (squash merge, shallow
# clone) or a git error exits 1 naming the cause. After a squash merge, pass --floor <merge commit>.
set -u
FLOOR=""; FLOOR_GIVEN=0; REPO=""
usage() { echo "usage: hook-patch-trailer-check.sh [--floor <sha>] [--repo <dir>]" >&2; exit 64; }
while [ $# -gt 0 ]; do
  case "$1" in
    --floor) [ $# -ge 2 ] || usage; FLOOR="$2"; FLOOR_GIVEN=1; shift 2;;
    --repo) [ $# -ge 2 ] || usage; REPO="$2"; shift 2;;
    *) usage;;
  esac
done
[ -n "$REPO" ] || REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PATHS=(.claude/hooks .claude/settings.json scripts/hooks-apply.sh scripts/validation/hook-patch-trailer-check.sh scripts/validation/hook-canaries/run-canaries.sh)
CORPUS=scripts/validation/hook-canaries/canaries.jsonl
fail() { echo "hook-patch-trailer: FAIL: $*" >&2; exit 1; }
g() { git -C "$REPO" "$@"; }

g rev-parse --git-dir >/dev/null 2>&1 || fail "$REPO is not a git repository"
HEAD_SHA=$(g rev-parse --verify --quiet 'HEAD^{commit}') || fail "HEAD does not resolve to a commit"
if [ "$FLOOR_GIVEN" = 0 ]; then
  OLDEST=$(g rev-list --reverse HEAD -- "${PATHS[@]}") || fail "git rev-list failed"
  FLOOR="${OLDEST%%$'\n'*}"
  [ -n "$FLOOR" ] || { echo "hook-patch-trailer: scanned 0 commit(s) touching ${PATHS[*]}; 0 without a Hook-Patch trailer"; exit 0; }
fi
FLOOR_SHA=$(g rev-parse --verify --quiet "$FLOOR^{commit}") || fail "floor '$FLOOR' is not a commit in this repository (shallow clone or squash merge?): pass --floor <sha>"
g merge-base --is-ancestor "$FLOOR_SHA" "$HEAD_SHA" || fail "floor ${FLOOR_SHA:0:9} is not an ancestor of HEAD: pass --floor <sha>"

TOTAL=$(g rev-list --count "$FLOOR_SHA..$HEAD_SHA" -- "${PATHS[@]}") || fail "git rev-list --count failed"
COMMITS=$(g rev-list "$FLOOR_SHA..$HEAD_SHA" -- "${PATHS[@]}") || fail "git rev-list failed"

checked=0; missing=()
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  value=$(g show -s --format='%(trailers:key=Hook-Patch,valueonly)' "$sha") || fail "git show failed for $sha"
  checked=$((checked + 1))
  [ -n "$(printf '%s' "$value" | tr -d '[:space:]')" ] || missing+=("${sha:0:9} $(g show -s --format=%s "$sha")")
done <<<"$COMMITS"
CORPUS_COMMITS=$(g rev-list "$FLOOR_SHA..$HEAD_SHA" -- "$CORPUS") || fail "git rev-list failed"
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  removed=$(g show --numstat --format= "$sha" -- "$CORPUS" | awk '{ s += $2 } END { print s + 0 }') || fail "git show failed for $sha"
  [ "$removed" -gt 0 ] || continue
  value=$(g show -s --format='%(trailers:key=Hook-Patch,valueonly)' "$sha") || fail "git show failed for $sha"
  [ -n "$(printf '%s' "$value" | tr -d '[:space:]')" ] || missing+=("${sha:0:9} $(g show -s --format=%s "$sha") (removes or rewrites $removed canary row(s))")
done <<<"$CORPUS_COMMITS"

[ "$checked" = "$TOTAL" ] || fail "inspected $checked of $TOTAL commits (parse-or-fail)"
echo "hook-patch-trailer: scanned $checked commit(s) in ${FLOOR_SHA:0:9}..HEAD touching ${PATHS[*]}; ${#missing[@]} without a Hook-Patch trailer"
if [ "${#missing[@]}" -gt 0 ]; then
  printf '  missing Hook-Patch: %s\n' "${missing[@]}" >&2
  echo "hook-patch-trailer: FAIL: change hooks only through scripts/hooks-apply.sh (stamps the trailer)" >&2
  exit 1
fi
