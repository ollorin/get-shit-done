#!/bin/sh
# =============================================================================
# Pre-PR gate run-disagreement JSONL appender
# =============================================================================
# Appends ONE JSON line per invocation to the APPEND-ONLY evidence file
#   ${PRE_PR_DISAGREEMENT_LOG:-.planning/pre-pr-disagreements.jsonl}
# recording a flake-sensitive stage whose run-1 and run-2 outcomes DISAGREED. The file is the evidence base for any
# future decision to relax the double run to run-once-plus-retry: never truncate or rewrite it; only append.
#
# Asymmetry: pass->fail is the only reachable direction today, because a run-1 failure stops the gate before run 2
# starts, so run1 is "pass" on every line this tool is currently asked to write.
#
# Contract: this tool never fails its caller. Every failure path (bad args, node error, unwritable output path) exits 0
# silently; a dangling flag or a missing --stage/--run1/--run2 writes no record. set -u only, deliberately NOT set -e.
#
# Usage:
#   scripts/log-pre-pr-disagreement.sh \
#     --stage <slug> --run1 <pass|fail> --run2 <pass|fail> --run2-exit <n> \
#     [--failed-buckets <csv>] [--failing-tests <newline-or-csv-list>] [--log <path>]
#
# Env:
#   PRE_PR_DISAGREEMENT_LOG: override the output path (verification runs use it so they never pollute the real file).
set -u

STAGE=""
RUN1=""
RUN2=""
RUN2_EXIT="0"
FAILED_BUCKETS=""
FAILING_TESTS=""
LOG_PATH=""

while [ $# -gt 0 ]; do
  # A flag with no value is invalid input: write nothing (a bare `shift 2` would abort the shell under dash).
  case "$1" in --*) [ $# -ge 2 ] || exit 0 ;; esac
  case "$1" in
    --stage)          STAGE="${2:-}";          shift 2 ;;
    --run1)           RUN1="${2:-}";           shift 2 ;;
    --run2)           RUN2="${2:-}";           shift 2 ;;
    --run2-exit)      RUN2_EXIT="${2:-0}";     shift 2 ;;
    --failed-buckets) FAILED_BUCKETS="${2:-}"; shift 2 ;;
    --failing-tests)  FAILING_TESTS="${2:-}";  shift 2 ;;
    --log)            LOG_PATH="${2:-}";       shift 2 ;;
    *) shift ;;
  esac
done

# A record needs its three identifying fields; a dangling flag or a missing one writes nothing (exit 0, silent).
[ -n "$STAGE" ] && [ -n "$RUN1" ] && [ -n "$RUN2" ] || exit 0

OUT="${PRE_PR_DISAGREEMENT_LOG:-.planning/pre-pr-disagreements.jsonl}"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || TS=""
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || BRANCH=""
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null) || HEAD_SHA=""

# run2_exit must be a JSON number: normalise any garbage to 0.
case "$RUN2_EXIT" in
  ''|*[!0-9]*) RUN2_EXIT=0 ;;
esac

# One JSON line built by node (safe escaping). failed_buckets: csv -> array. failing_tests: newline- or comma-separated
# list -> array. Empty inputs -> empty arrays.
LINE=$(TS="$TS" BRANCH="$BRANCH" HEAD_SHA="$HEAD_SHA" STAGE="$STAGE" RUN1="$RUN1" RUN2="$RUN2" RUN2_EXIT="$RUN2_EXIT" \
  FAILED_BUCKETS="$FAILED_BUCKETS" FAILING_TESTS="$FAILING_TESTS" LOG_PATH="$LOG_PATH" node -e '
  const e = process.env;
  const list = (s, re) => s.split(re).map((x) => x.trim()).filter((x) => x.length > 0);
  console.log(JSON.stringify({
    ts: e.TS, branch: e.BRANCH, head_sha: e.HEAD_SHA, stage: e.STAGE, run1: e.RUN1, run2: e.RUN2,
    run2_exit: Number(e.RUN2_EXIT),
    failed_buckets: list(e.FAILED_BUCKETS, /,/),
    failing_tests: list(e.FAILING_TESTS, /[\n,]/),
    log: e.LOG_PATH,
  }));
' 2>/dev/null) || exit 0

if [ -z "$LINE" ]; then
  exit 0
fi

# Append-only (>>). Any write failure exits 0 silently: a logging failure never fails the gate.
{ printf '%s\n' "$LINE" >> "$OUT"; } 2>/dev/null || exit 0

echo "  pre-PR disagreement logged: stage=${STAGE} run1=${RUN1} run2=${RUN2} -> ${OUT}"
exit 0
