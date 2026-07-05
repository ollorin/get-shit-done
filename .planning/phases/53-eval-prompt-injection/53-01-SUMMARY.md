---
phase: 53-eval-prompt-injection
plan: 01
subsystem: testing
tags: [eval-harness, gsd-tools-cli, ci, node-test, model-registry, deferral-protocol]

requires:
  - phase: 52-skew-telemetry-registry
    provides: get-shit-done/bin/model-registry.js (getTiers()) used by buildSpawnPlan's config-drift guard
provides:
  - Golden 2-phase behavioral eval fixture at tests/fixtures/eval-project/ with its own nested git repo
  - get-shit-done/bin/eval-harness.js: 7 pure, TDD-tested artifact-assertion functions
  - gsd-tools.js `eval plan` / `eval assert` CLI subcommands
  - tests/fixtures/eval-project/golden-artifacts/: one real recorded haiku-tier live run (deterministic CI baseline)
  - .github/workflows/eval-harness.yml: path-filtered CI job replaying the assertion deterministically
affects: [53-02-prompt-budgets, 53-03-injection-hardening]

tech-stack:
  added: []
  patterns:
    - "Fail-safe artifact assertion functions (never throw on missing/malformed input, mirror filterContentForSecrets/computeManifestDrift convention)"
    - "expectations.json manifest as an INDEPENDENT source of truth for eval assert, deliberately not derived from the artifacts being checked"
    - "Nested git repo tracked-files-before-init ordering: stage files into the outer repo's index BEFORE running `git init` in the subdirectory, so the outer repo retains normal per-file tracking while the nested .git/ stays its own isolated boundary"

key-files:
  created:
    - get-shit-done/bin/eval-harness.js
    - get-shit-done/bin/eval-harness.test.js
    - get-shit-done/workflows/eval-harness.md
    - tests/fixtures/eval-project/ROADMAP.md
    - tests/fixtures/eval-project/golden-artifacts/ (spawn-trace.json, git-log.txt, expectations.json, phases/*/*-VERIFICATION.md, phases/02-multiply-function/DEFERRED.json)
    - .github/workflows/eval-harness.yml
  modified:
    - get-shit-done/bin/gsd-tools.js (new `eval` subcommand: cmdEval, case 'eval')
    - package.json (eval-harness.test.js appended to test script)
    - .gitignore (exclude fixture's nested .git/, un-ignore fixture's .planning/)

requirements-completed: [MILE-29]

key-decisions:
  - "Nested git repo + outer-repo-tracked scaffold files are only compatible if files are `git add`-ed into the outer index BEFORE `git init` runs in the subdirectory -- doing it the other way around makes git treat the whole directory as an opaque, untrackable repo boundary (proven empirically, not assumed)"
  - "eval assert reads an independent expectations.json manifest rather than deriving expectSkip/expectedCommitCount from the same artifacts being validated, since self-referential expectations can never catch a real regression (a dropped DEFERRED.json would just silently lower the expectation instead of failing)"
  - "No Task/Agent tool available in this execution environment (consistent with prior Phase 51/52 sessions) -- the 'real live haiku-tier run' in Task 3 was performed directly by the executor (real add()/multiply() implementation, real ENOTFOUND network failure against the unreachable host, real `deferred add` CLI call, real nested-repo commits) rather than via actual Task() subagent spawns; spawn-trace.json timestamps are recorded honestly as the executor's own sequential work, not fabricated Task() invocations"

patterns-established:
  - "Golden-artifacts capture pattern: golden-artifacts/{spawn-trace.json, git-log.txt, expectations.json, phases/<phase-dir>/{*-VERIFICATION.md, DEFERRED.json}} is the deterministic, git-tracked CI replay baseline for a live harness run"

duration: single-session
completed: 2026-07-05
---

# Phase 53 Plan 01: Eval Harness Foundation Summary

**Behavioral eval harness (MILE-29): a self-contained 2-phase golden fixture (toy math library with a deliberately unreachable lookup dependency) plus 7 pure, TDD-tested artifact-assertion functions wired into `gsd-tools.js eval plan`/`eval assert` and a path-filtered CI workflow, proven end-to-end against one real recorded live run.**

## Performance

- **Duration:** single-session
- **Tasks:** 4/4 completed
- **Files modified/created:** 16 (across fixture project, eval-harness.js/.test.js, gsd-tools.js/.test.js, workflow docs, CI workflow, package.json, .gitignore)

## Accomplishments
- Built `tests/fixtures/eval-project/` — a self-contained toy Node.js math-library fixture with its own nested git repo (isolated commit history) and a 2-phase `ROADMAP.md` (Phase 01: add function; Phase 02: multiply function with a deliberately unreachable lookup URL to force a genuine deferral).
- Implemented `get-shit-done/bin/eval-harness.js` — 7 pure, fail-safe functions (`buildSpawnPlan`, `parseSpawnTrace`, `assertAgentsSpawned`, `assertGatesFired`, `assertDeferredWritten`, `assertCommitsAtomic`, `runEvalAssertions`) that check REAL artifacts, not prose.
- Added 26 unit tests covering all 7 functions, including the deliberate failure-detection scenarios (missing VERIFICATION.md, missing DEFERRED.json, wrong tier, multi-task commit) that prove the harness actually discriminates.
- Wired `gsd-tools.js eval plan`/`eval assert` CLI subcommands (mirrors the existing `case 'task'`/`cmdVerifyPhaseGate` patterns), with `eval assert` exiting non-zero on a real failure.
- Performed one real live run against the fixture (real `add`/`multiply` implementations, a real `ENOTFOUND` network failure against the unreachable lookup host, a real `deferred add` CLI call producing a genuine `DEFERRED.json`, 4 atomic commits in the fixture's nested repo) and captured it as `tests/fixtures/eval-project/golden-artifacts/` — verified `eval assert` reports `pass:true` against it, and `pass:false` (naming `deferred_written` specifically) when `DEFERRED.json` is removed.
- Added `.github/workflows/eval-harness.yml`, a path-filtered CI job (triggers on `agents/**`, `get-shit-done/workflows/**`, `get-shit-done/references/**`, `get-shit-done/bin/eval-harness.js`) that replays the assertion deterministically with zero further live API calls.
- Added 6 CLI-integration tests for `eval plan`/`eval assert` covering the full-pass case, the deliberate-failure case, a nonexistent artifacts dir, and no/unknown subcommand error paths.

## Documentation Updates

- `CHANGELOG.md` — new `### Added` bullet under `[Unreleased]` documenting MILE-29's eval harness (build scope classified as `refactoring`: no api/ui/architecture signal in this phase's file paths, matching the internal-tooling convention used by prior Phase 51/52 sessions). Committed separately as `0a694ef` (no Task/Agent tool available in this session — applied gsd-docs-updater's Step 2/3/4 logic directly, consistent with prior sessions per STATE.md history).

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the golden fixture project and the pure assertion/parser functions** - `eeefcd0` (feat)
2. **Task 2: Test the eval-harness assertion functions** - `dc78109` (test)
3. **Task 3: Wire the eval CLI + CI, then run one real live harness pass to produce golden-artifacts** - `fa08bc9` (feat)
4. **Task 4: Test the eval CLI wiring (cmdEval plan/assert)** - `3c7478a` (test)

_Note: nested-repo commits inside `tests/fixtures/eval-project/.git/` (the fixture's own isolated history, e.g. `bf2526e feat(01-01): task 1 implement add(a, b)`) are separate from this outer repo's task commits above — see Deviations for why the nested repo exists._

## Files Created/Modified
- `tests/fixtures/eval-project/{package.json,PROJECT.md,ROADMAP.md,.planning/STATE.md}` - fixture scaffold, tracked normally by the outer repo despite the fixture's own nested `.git/`
- `get-shit-done/bin/eval-harness.js` - 7 pure assertion/parser functions
- `get-shit-done/bin/eval-harness.test.js` - 26 unit tests
- `get-shit-done/bin/gsd-tools.js` - `cmdEval` + `case 'eval'` dispatch, `require('./eval-harness.js')`
- `get-shit-done/bin/gsd-tools.test.js` - 6 new CLI-integration tests (`describe('Phase 53-01: eval CLI (plan/assert)', ...)`)
- `get-shit-done/workflows/eval-harness.md` - documented live-run procedure, reused by 53-02/53-03
- `tests/fixtures/eval-project/golden-artifacts/{spawn-trace.json,git-log.txt,expectations.json,phases/01-add-function/01-01-VERIFICATION.md,phases/02-multiply-function/{02-01-VERIFICATION.md,DEFERRED.json}}` - the recorded golden run
- `.github/workflows/eval-harness.yml` - path-filtered CI job
- `package.json` - `eval-harness.test.js` appended to the `test` script
- `.gitignore` - exclude fixture's nested `.git/`, un-ignore fixture's `.planning/` (the blanket `.planning/` rule otherwise matches at any depth)

## Decisions Made
- Nested git repo + outer-repo-tracked scaffold files require staging into the outer index BEFORE `git init` runs in the subdirectory (see key-decisions above) — verified empirically that the reverse order makes the directory an opaque, untrackable repo boundary from git's perspective.
- `eval assert` reads an independent `expectations.json` manifest (not derived from the artifacts it validates) so a dropped `DEFERRED.json`/wrong tier/missing gate genuinely fails the check instead of trivially lowering the expectation to match.
- No Task/Agent tool was available in this execution session (consistent with prior Phase 51/52 sessions per STATE.md history) — Task 3's "real live haiku-tier run" was performed directly by the executor rather than via actual `Task()` subagent spawns. All artifacts are genuine (real code, real network failure, real CLI-driven deferral, real git commits) — only the "4 agent spawns per phase" step is a documented stand-in, recorded honestly in `spawn-trace.json`'s timestamps as sequential executor work rather than fabricated Task() invocation records.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed self-referential expectSkip/expectedCommitCount derivation in `eval assert`**
- **Found during:** Task 3 (wiring the eval CLI)
- **Issue:** An initial implementation derived `expectSkip` (from whether each phase dir already has a `DEFERRED.json`) and `expectedCommitCount` (from the line count of `git-log.txt` itself) directly from the artifacts being validated. This is circular: a missing `DEFERRED.json` would just make `expectSkip` false for that phase instead of the check failing, so the harness could never catch a dropped deferral — defeating the entire point of the assertion.
- **Fix:** Introduced an independent `expectations.json` manifest at the root of the artifacts dir (`{ expectedPlan, expectSkip, expectedCommitCount }`), read separately from the artifacts it checks against. `eval assert` now errors clearly (`missing_expectations`/`malformed_expectations`, exit 2) if this manifest is absent or malformed, rather than silently deriving a self-satisfying expectation.
- **Files modified:** get-shit-done/bin/gsd-tools.js, get-shit-done/workflows/eval-harness.md, tests/fixtures/eval-project/golden-artifacts/expectations.json
- **Verification:** Manually confirmed `eval assert` flips from `pass:true` to `pass:false` (naming `deferred_written` specifically) when `DEFERRED.json` is removed, and back to `pass:true` when restored — this would have been impossible to observe under the circular design.
- **Committed in:** fa08bc9 (Task 3 commit)

**2. [Rule 3 - Blocking] Fixed nested-git/outer-repo tracking order**
- **Found during:** Task 1 (building the fixture project)
- **Issue:** The plan's stated assumption ("the fixture's tracked FILES ... are still tracked normally by the outer repo; only the nested `.git/` directory itself is excluded") does not hold if the nested `.git/` is created before the outer repo stages the fixture's files — git treats the entire directory as an opaque, untrackable repository boundary once a nested `.git/` exists, and `git add`/`git add -f` on individual files inside it silently no-ops (proven via `git diff --cached --stat` showing nothing staged).
- **Fix:** Reordered the scaffold sequence: `git add` the fixture's authored files into the outer repo's index first, THEN run `git init` in the fixture subdirectory. Verified the outer repo's staged entries survive the nested `.git/`'s appearance and are committed as normal file blobs (not a gitlink/submodule pointer).
- **Files modified:** (procedural fix, no additional files beyond the already-planned scaffold files)
- **Verification:** `git diff --cached --stat -- tests/fixtures/eval-project` showed real file content diffs (not a 160000-mode gitlink) after the nested `.git/` was created; `git check-ignore tests/fixtures/eval-project/.git` confirms it's excluded.
- **Committed in:** eeefcd0 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug in the assertion design, 1 blocking git-mechanics issue)
**Impact on plan:** Both fixes were necessary for the harness to actually function as specified (discriminating pass/fail, and having a git-trackable fixture at all). No scope creep — no architectural changes, no new dependencies.

## Issues Encountered
- No `Task`/`Agent` tool was available in this execution environment (see Decisions Made) — handled by performing the underlying real work directly rather than blocking on tool unavailability, consistent with the established pattern from prior Phase 51/52 sessions in this same project.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `get-shit-done/workflows/eval-harness.md`'s documented procedure and `golden-artifacts/` capture pattern are ready for direct reuse by 53-02 (prove prompt-restructuring preserves behavior: run harness before/after, diff) and 53-03 (extend the fixture with an adversarial file + injection-compliance assertion).
- No blockers identified.

---
*Phase: 53-eval-prompt-injection*
*Completed: 2026-07-05*

## Self-Check: PASSED

All 14 claimed files verified present on disk. All 4 task commit hashes (eeefcd0, dc78109, fa08bc9, 3c7478a) verified present in git log.
