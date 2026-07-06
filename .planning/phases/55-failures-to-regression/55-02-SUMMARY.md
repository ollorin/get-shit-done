---
phase: 55-failures-to-regression
plan: 02
subsystem: testing
tags: [eval-harness, regression-fixtures, review-queue, cli]

# Dependency graph
requires:
  - phase: 55-01
    provides: buildEvalCandidateFromDebugFile / buildEvalCandidatesFromVerificationFile / writeEvalCandidates + `eval-candidate` CLI dispatch + tests/eval-regressions/{queue,accepted,archived}/ directories this plan extends
provides:
  - "validateEvalCandidateSchema pure schema validator (required keys, source/status enums, expected.type/file/needle rules)"
  - "cmdEvalCandidateList/Accept/Reject CLI wrappers"
  - "`eval-candidate list [dir]`, `eval-candidate accept <id>`, `eval-candidate reject <id> --reason \"...\"` subcommands"
  - "accept-time schema re-validation that cannot be bypassed by hand-editing a queued candidate"
affects: [55-03-ci-execution]

# Tech tracking
tech-stack:
  added: []
  patterns: ["pure validator + thin CLI wrapper reused across accept/reject, mirroring cmdDeferredAdd's read-validate-move-stamp shape and safeReadFile/safeJsonParse/atomicWriteFileSync conventions"]

key-files:
  created: []
  modified:
    - get-shit-done/bin/gsd-tools.js
    - get-shit-done/bin/gsd-tools.test.js

requirements-completed: [MILE-32]

key-decisions:
  - "validateEvalCandidateSchema is re-run at accept time unconditionally, even against a candidate that was already in the queue — closes the loophole where a human hand-edits a previously-valid candidate into an invalid shape before accepting it."
  - "Reject never deletes: a rejected candidate is moved queue -> archived with rejected_at + a reason that is appended (never overwritten) if one already existed, preserving the full review history."
  - "Reject does NOT re-run schema validation (only requires successful JSON.parse) — a broken candidate must still be archivable/rejectable; only accept needs the full-schema gate, since only accept promotes a candidate into the permanent CI-trusted set."
  - "All malformed-JSON failure paths (accept and reject) write a typed JSON error object directly to stdout and exit non-zero (1 for not-found, 2 for malformed/invalid-schema) rather than going through output() (which always exits 0) — loud, parseable failure, matching cmdDeferredAdd's phase_not_found/corrupted_state convention."
  - "cmdEvalCandidateList/Accept/Reject are not exported from module.exports (only validateEvalCandidateSchema is) — matches cmdDeferredAdd's CLI-only test coverage convention already established in this file."

patterns-established:
  - "eval-candidate CLI: list/accept/reject subcommands added to the existing case 'eval-candidate' dispatch (from-debug/from-verification/list/accept/reject), with the 'Unknown eval-candidate subcommand' error message enumerating all 5."

# Metrics
duration: ~30min
completed: 2026-07-06
---

# Phase 55 Plan 02: Eval Candidate Review Queue Summary

**`eval-candidate list/accept/reject` now give a human reviewer a durable, auditable way to promote a queued regression candidate to `accepted/` (re-validated against the schema even if hand-edited) or archive it to `archived/` with an appended reason — never silently deleting or silently accepting a broken candidate.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 (1 implementation, 1 tdd="true", 1 full-suite gate)
- **Files modified:** 2

## Accomplishments
- `validateEvalCandidateSchema(candidate)` — pure, never-throws validator covering all 7 required keys, `source`/`status` enum checks, and `expected.type`/`expected.file`/`expected.needle` rules (identical rule set Plan 55-03's eval-harness loader independently re-implements for the accepted-dir).
- `cmdEvalCandidateList(cwd, dirArg, raw)` — lists `queue`/`accepted`/`archived` contents; a malformed JSON file in a listed dir is surfaced with `{file, error: 'malformed JSON'}` instead of being silently skipped.
- `cmdEvalCandidateAccept(cwd, id, raw)` — re-validates schema immediately before the queue→accepted move; a missing file exits 1 (`candidate_not_found`), a JSON-parse failure or schema-invalid file exits 2 (`malformed_candidate` / `invalid_candidate_schema`) and is left untouched in `queue/`.
- `cmdEvalCandidateReject(cwd, id, reason, raw)` — moves queue→archived (write-then-delete, not a bare rename), stamping `rejected_at` and appending (`"first reason; second reason"`, never overwriting) any existing `reason`.
- `case 'eval-candidate':` dispatch extended with `list`/`accept`/`reject`; unknown-subcommand error message now lists all 5 subcommands.
- `validateEvalCandidateSchema` exported additively from `module.exports`; `cmdEvalCandidate*` functions remain CLI-only (not exported), matching `cmdDeferredAdd`'s convention.
- 9 new tests (exceeding the 6-test/6-category minimum) in `describe('eval-candidate review queue (Phase 55-02)')`, including the accept-re-validates-a-hand-edited-file proof and the reject-appends-not-overwrites boundary case.
- Full `npm test` green at 578/578 (569 baseline after 55-01 + 9 new).

## Documentation Updates
- `CHANGELOG.md` — refactoring/internal-tooling scope (no api/ui path signal): new `### Added` bullet under `## [Unreleased]` describing `validateEvalCandidateSchema` + `cmdEvalCandidateList/Accept/Reject` + the extended `eval-candidate` CLI built in this plan

## Docs

**Scope:** refactoring (internal-tooling; no api/ui path signal in modified files)
**Files written:**
- CHANGELOG.md
**Commit:** c202bae

## Task Commits

Each task was committed atomically:

1. **Task 1: validateEvalCandidateSchema + list/accept/reject CLI** - `8c6eb5e` (feat)
2. **Task 2: TDD — schema validation + accept/reject/list lifecycle across 6 categories** - `3830e1b` (test)
3. **Task 3: Full suite gate** - no code changes; verification-only (npm test 578/578 green)

**Plan metadata:** (pending final commit below)

## Files Created/Modified
- `get-shit-done/bin/gsd-tools.js` — new "Eval Candidate Review Queue (MILE-32, Phase 55-02)" section: `EVAL_CANDIDATE_REQUIRED_KEYS`/`EVAL_CANDIDATE_ALLOWED_SOURCES`/`EVAL_CANDIDATE_ALLOWED_STATUSES`/`EVAL_CANDIDATE_ALLOWED_EXPECTED_TYPES` constants, `validateEvalCandidateSchema`, `cmdEvalCandidateList`, `cmdEvalCandidateAccept`, `cmdEvalCandidateReject`; extended `case 'eval-candidate':` dispatch; additive `module.exports` entry for `validateEvalCandidateSchema`
- `get-shit-done/bin/gsd-tools.test.js` — `describe('eval-candidate review queue (Phase 55-02)')` (9 tests across all 6 QA categories)

## Decisions Made
- Schema re-validation happens unconditionally at accept time (not only at write time in 55-01), closing the hand-edit bypass the must-haves called out.
- Reject intentionally skips full schema re-validation — only a successful `JSON.parse` is required, since a broken candidate must still be legitimately archivable.
- Error responses on accept/reject write directly to stdout + `process.exit(1|2)` rather than using `output()` (which unconditionally exits 0), so a non-zero exit code is guaranteed on every failure path.

## Deviations from Plan

**1. [Tooling constraint] gsd-test-writer subagent not invocable — tests written directly**
- **Found during:** Task 2 (`tdd="true"`)
- **Issue:** This execution environment exposes only Read/Write/Edit/Bash tools — no Agent/Task tool to spawn `gsd-test-writer` as the plan's `<behavior>` block specifies.
- **Fix:** Wrote and ran the full TDD test suite directly, following the plan's `<behavior>` block verbatim (all 6 categories, 9 tests total, exceeding the minimum-6-tests requirement, exact fixture/assertion shapes specified in the plan including the hand-edited-invalid-candidate re-validation proof and the reason-append boundary case). Run standalone (`node --test --test-name-pattern="eval-candidate review queue"`) before committing, then re-verified as part of the full `npm test` run.
- **Files modified:** `get-shit-done/bin/gsd-tools.test.js`
- **Verification:** 9/9 passing standalone; full suite 578/578 passing.
- **Committed in:** `3830e1b`

**2. [Tooling constraint] gsd-docs-updater subagent not invocable — docs update performed directly**
- **Found during:** Mandatory `documentation_hard_gate` step (post-task-completion, pre-SUMMARY-finalization)
- **Issue:** Same tool constraint as above — no Agent tool available to spawn `gsd-docs-updater`.
- **Fix:** Followed `agents/gsd-docs-updater.md`'s documented procedure by hand: classified build scope as `refactoring` (internal CLI tooling, no api/route/handler or component/page/frontend path signal in either modified file), located `CHANGELOG.md`'s existing `## [Unreleased]` convention (matching the detailed-bullet style established by Phase 55-01 and earlier phases rather than the generic one-liner template), wrote one traceable bullet sourced from this plan's actual functions/files/test counts, staged and committed it.
- **Files modified:** `CHANGELOG.md`
- **Verification:** Bullet content cross-checked against actual function names, file paths, and test counts in this SUMMARY.md and the real diff.
- **Committed in:** `c202bae`

---

**Total deviations:** 2 (both tooling constraints, not Rule 1-4 code deviations)
**Impact on plan:** No scope or behavioral deviation from the plan's task specs or the mandatory docs gate — only the mechanism changed (direct authorship instead of a spawned subagent) because no Agent/Task tool was available in this execution environment. All must-have test categories/counts and the docs gate's structured contract were met.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 55-03 (CI execution) can now assume `tests/eval-regressions/accepted/` only ever contains schema-valid candidates, since `eval-candidate accept` re-validates unconditionally before every promotion.
- `eval-candidate` CLI now has all 5 subcommands the 55-01 forward-reference anticipated (`from-debug`, `from-verification`, `list`, `accept`, `reject`).
- No blockers.

---
*Phase: 55-failures-to-regression*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 4 claimed files confirmed present on disk (`get-shit-done/bin/gsd-tools.js`, `get-shit-done/bin/gsd-tools.test.js`, `CHANGELOG.md`, this SUMMARY.md); all 3 claimed commit hashes (`8c6eb5e`, `3830e1b`, `c202bae`) confirmed present via `git cat-file -e`.
