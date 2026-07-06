---
phase: 55-failures-to-regression
plan: 03
subsystem: testing
tags: [eval-harness, regression-fixtures, ci, cli, integration-tests]

# Dependency graph
requires:
  - phase: 55-01
    provides: eval-candidate builders (from-debug/from-verification) + tests/eval-regressions/{queue,accepted,archived}/ directories + agent wiring
  - phase: 55-02
    provides: validateEvalCandidateSchema + eval-candidate list/accept/reject review-queue lifecycle
provides:
  - "loadAcceptedEvalCandidates / executeEvalCandidate / runEvalRegressions loader+executor in eval-harness.js (additive exports)"
  - "validateEvalCandidateShape (eval-harness-local, deliberately independent duplicate of gsd-tools.js's validateEvalCandidateSchema rules to avoid a circular require)"
  - "`eval regress <accepted-dir> --project-root <dir>` CLI subcommand (direct-exit: 0 pass / 1 fail)"
  - "CI wiring: npm test chains eval regress; eval-harness.yml gains tests/eval-regressions/** path triggers + dedicated eval-regress job"
  - "Cross-cutting integration tests proving all 4 MILE-32 success-criterion scenarios end-to-end via the real CLI"
affects: [56-prompt-optimization, 59-dormant-quality-agents]

# Tech tracking
tech-stack:
  added: []
  patterns: ["second documented deviation from eval-harness.js's fail-safe convention: a malformed COMMITTED regression fixture is a loud valid:false entry, never silently dropped (same file-header documentation style as buildSpawnPlan's config-drift throw)"]

key-files:
  created: []
  modified:
    - get-shit-done/bin/eval-harness.js
    - get-shit-done/bin/eval-harness.test.js
    - get-shit-done/bin/gsd-tools.js
    - get-shit-done/bin/gsd-tools.test.js
    - package.json
    - .github/workflows/eval-harness.yml

requirements-completed: [MILE-32]

key-decisions:
  - "eval-harness.js re-implements the candidate schema rules locally (EVAL_CANDIDATE_REQUIRED_KEYS / validateEvalCandidateShape returning a bare error-string array) instead of requiring gsd-tools.js's validateEvalCandidateSchema — gsd-tools.js already requires eval-harness.js, the reverse would be circular; the two rule sets must be kept in sync manually if either changes."
  - "Malformed or schema-invalid files in accepted/ are explicit valid:false result entries and force pass:false + exit 1 — a broken COMMITTED fixture is a real CI/data bug, not an expected missing-data case (documented in the file-header comment as the second deliberate fail-safe deviation)."
  - "Empty (or absent) accepted/ dir is an explicit trivial pass {pass:true, total:0, malformed:[], executed:[]} — asserted via deepStrictEqual so the contract cannot drift silently."
  - "`eval regress` bypasses output() and calls process.exit(result.pass ? 0 : 1) directly, mirroring `eval assert`'s direct-exit pattern, so CI gets a real exit code."
  - "CI wiring is dual: npm test (broad every-push/PR trigger via test.yml) chains eval regress at the end of scripts.test, AND eval-harness.yml gains a dedicated eval-regress job with tests/eval-regressions/** added to both push/pull_request path filters."
  - "Integration tests drive the REAL CLI subprocess for every scenario (runGsdTools/execSync), chaining from-debug -> accept -> eval regress in one temp cwd — proving the full pipeline composes, not just that each command works in isolation."

patterns-established:
  - "eval regress CLI: cmdEval subcommand dispatch extended to (plan|assert|regress); regress is the CI entry point for permanent accepted regression candidates."

# Metrics
duration: ~45min (multi-session; implementation landed pre-checkpoint, tests + gate post-resume)
completed: 2026-07-06
---

# Phase 55 Plan 03: Eval Regression Loader/Executor + CI Wiring Summary

**`eval regress` closes the MILE-32 loop: every accepted candidate under tests/eval-regressions/accepted/ is now a permanent eval case executed on every push/PR (npm test chain + dedicated eval-harness.yml job), with malformed committed fixtures failing loudly and an empty accepted/ dir passing trivially — proven end-to-end by integration tests that chain generation -> accept -> CI pickup through the real CLI.**

## Performance

- **Duration:** ~45 min across two sessions (coordinator death mid-plan; implementation commit 8bb56df landed pre-checkpoint, resumed at tests)
- **Tasks:** 4 (1 implementation, 2 tdd="true" via gsd-test-writer spawns, 1 full-suite gate)
- **Files modified:** 6

## Accomplishments
- `validateEvalCandidateShape(candidate)` — eval-harness-local validator returning a bare error-string array (idiomatic to this file), covering the 7 required keys, allowed `expected.type` values, `expected.file`, and needle rules for `file_contains`/`file_not_contains`.
- `loadAcceptedEvalCandidates(acceptedDir)` — never throws; absent dir = zero candidates; each `.json` file (sorted, deterministic) becomes either `{file, valid:true, candidate}` or a loud `{file, valid:false, error}` entry ("Malformed JSON: ..." / "Schema validation failed: ...") — never silently dropped.
- `executeEvalCandidate(candidate, projectRoot)` — executes file_exists/file_not_exists/file_contains/file_not_contains assertions against the live repo; always returns `{id, pass, reason}`, never throws.
- `runEvalRegressions(acceptedDir, projectRoot)` — aggregate: `pass = no malformed && all executed pass`; empty dir yields the explicit trivial pass `{pass:true, total:0, malformed:[], executed:[]}`.
- `eval regress <accepted-dir> --project-root <dir>` CLI wired into cmdEval (subcommand errors updated to `(plan|assert|regress)`), direct-exit like `eval assert`.
- `npm test` now ends with `eval regress tests/eval-regressions/accepted --project-root .`; eval-harness.yml gains `tests/eval-regressions/**` path triggers and a dedicated `eval-regress` job.
- 10 loader/executor tests (gsd-test-writer, all 6 TDD categories incl. the malformed-file-is-explicit-not-absent proof, the empty-dir deepStrictEqual trivial-pass proof, and a real CLI subprocess wiring test).
- 7 cross-cutting integration tests (gsd-test-writer) covering all 4 MILE-32 success-criterion scenarios end-to-end via the real CLI: (a) generation from a seeded debug session + inconclusive-writes-nothing inverse, (b) accept/reject transitions (archived-not-deleted), (c) CI pickup flipping pass->fail when the fixture's target file regresses, (d) malformed-candidate loud handling, plus a full from-debug->accept->regress pipeline chain.
- Full `npm test` green at 595/595 (578 after 55-02 + 17 new), including the live `eval regress` chain (trivial pass, real accepted/ dir empty besides .gitkeep).

## Deferred-Items Resolution
- 55-02's deferred note (REQUIREMENTS.md marked MILE-32 `[x]` prematurely) is now RESOLVED by this plan landing: the CI-execution half of criterion 3 and all of criterion 4 are satisfied, so the checkbox and the "Phase 55 | Complete" mapping row are accurate as of this plan.

## Documentation Updates
- `CHANGELOG.md` — refactoring/internal-tooling scope: `### Added` bullet under `## [Unreleased]` describing the loader/executor, `eval regress` CLI, dual CI wiring, loud malformed handling, and empty-dir trivial pass.

## Docs

**Scope:** refactoring (internal tooling — CLI + CI wiring, no public api/ui surface)
**Files written:**
- CHANGELOG.md
**Commit:** 2a64a65

## Task Commits

Each task was committed atomically:

1. **Task 1: loader/executor + eval regress CLI + CI wiring** - `8bb56df` (feat)
2. **Task 2: TDD loader/executor coverage (gsd-test-writer)** - `2b2cc6e` (test)
3. **Task 3: MILE-32 end-to-end integration tests (gsd-test-writer)** - `e6bd004` (test)
4. **Task 4: full suite gate** - no commit (verification only: 595/595 + live eval regress trivial pass)

Docs gate: `2a64a65` (docs, gsd-docs-updater)

## Self-Check: PASSED

- All 4 tasks complete; both tdd="true" tasks executed via real gsd-test-writer spawns.
- Full npm test 595/595, zero regressions to 55-01/55-02 or the 550-test milestone baseline.
- All 5 must-have truths verified (loader+executor+CLI exit codes, loud malformed handling, empty-dir trivial pass, dual CI wiring, 4-scenario integration coverage).
