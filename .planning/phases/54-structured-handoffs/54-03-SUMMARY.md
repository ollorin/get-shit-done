---
phase: 54-structured-handoffs
plan: 03
subsystem: infra
tags: [eval-harness, handoff-brief, resume-brief, tdd, mile-40]

# Dependency graph
requires:
  - phase: 54-01
    provides: "buildHandoffBrief/handoff-brief.md's 5-key handoff brief structure — this plan's assertion checks for exactly those 5 keys"
  - phase: 54-02
    provides: "buildResumeBrief's third invariantsText parameter — this plan's assertion proves that mechanism re-injects verbatim, not paraphrased, content"
provides:
  - "assertHandoffBriefPresent(spawnEntries, requiredAgents) in get-shit-done/bin/eval-harness.js"
  - "assertResumeInvariantsReinjected(briefText, sourceFilePath, expectedInvariants) in get-shit-done/bin/eval-harness.js"
  - "runEvalAssertions additive options: requiredHandoffAgents, handoffSpawnTrace, resumeInvariants"
  - "tests/fixtures/eval-project/golden-artifacts/post-54/ golden fixture (spawn-trace.json + expectations.json)"
affects: [54-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verbatim-containment assertion pattern: a substring only counts as 're-injected' when it is present in BOTH the source and the derived text — proves copy, rejects paraphrase and fabrication, symmetric to assertNoInjectionCompliance's fail-safe/pure/never-throw contract"
    - "Additive runEvalAssertions option wiring: a new check key only appears in the checks object when its triggering option is supplied, and folds into the aggregate pass via the existing '(!check || check.pass)' guard — zero behavior change for callers that omit the option"

key-files:
  created:
    - tests/fixtures/eval-project/golden-artifacts/post-54/spawn-trace.json
    - tests/fixtures/eval-project/golden-artifacts/post-54/expectations.json
  modified:
    - get-shit-done/bin/eval-harness.js
    - get-shit-done/bin/eval-harness.test.js

requirements-completed: []  # MILE-40 spans all 4 plans in this phase; REQUIREMENTS.md is only flipped to Complete once 54-04 lands the full success criteria, not after this plan alone. Same convention as 54-01/54-02.

key-decisions:
  - "assertHandoffBriefPresent requires at least one required-agent entry to exist in spawnEntries before it can pass — an empty or entirely-irrelevant spawn trace must never trivially satisfy the presence check"
  - "assertResumeInvariantsReinjected treats a substring as re-injected only when inSource AND inBrief are both true; a substring present in briefText but absent from the real source file is reported in missing_from_source (guards against a brief fabricating invariants that were never actually in ROADMAP.md), symmetric to missing_from_brief for the reverse gap"
  - "runEvalAssertions' handoffSpawnTrace option, when supplied as an array, overrides the entries used for the handoff check; otherwise it reuses the already-parsed spawn-trace.json entries read for agents_spawned rather than re-reading the file — avoids a redundant fs read and lets a caller test the presence check against entries not backed by a real file on disk"

patterns-established:
  - "Any future eval-harness.js assertion that proves 'X was copied verbatim from Y' should use the same symmetric inSource/inBrief containment check (both directions), not a one-directional substring test, since one-directional checks can't distinguish paraphrase-rejection from fabrication-detection"

# Metrics
duration: ~15min
completed: 2026-07-06
---

# Phase 54 Plan 03: Handoff-Brief Presence + Resume-Invariant Re-Injection Eval Assertions Summary

**assertHandoffBriefPresent and assertResumeInvariantsReinjected give MILE-40 a real, on-disk-fixture-backed eval proof that handoff briefs actually reach the executor/verifier boundaries and that resume invariants are copied verbatim (not paraphrased or fabricated) from ROADMAP.md — both wired additively into runEvalAssertions so every existing 53-xx eval caller is untouched.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (all completed)
- **Files modified:** 4 (2 modified, 2 created)

## Accomplishments
- `assertHandoffBriefPresent(spawnEntries, requiredAgents)` in `eval-harness.js`: for every spawn-trace entry whose agent is in `requiredAgents` (default `['gsd-executor', 'gsd-verifier']`), requires a non-null `handoff_brief` object with all 5 canonical keys (`phase_goal`, `key_decisions`, `open_risks`, `file_map`, `hard_rules`) present and non-empty (string or array). Returns `{ pass, missing: [{ phase, agent, reason }] }`; `pass` requires at least one relevant entry to exist. Never throws — coerces non-array inputs.
- `assertResumeInvariantsReinjected(briefText, sourceFilePath, expectedInvariants)`: reads `sourceFilePath` (try/catch, never throws), coerces `expectedInvariants` to an array (string → one-element array, non-array/empty → `pass:false`), and for each expected substring checks it is present verbatim in BOTH the source content and `briefText`. Returns `{ pass, missing_from_source, missing_from_brief }` — a substring only "re-injected" when present in both, rejecting paraphrase and fabrication symmetrically.
- Both wired additively into `runEvalAssertions` via new `requiredHandoffAgents`/`handoffSpawnTrace` (→ `checks.handoff_brief_present`) and `resumeInvariants` (→ `checks.resume_invariants_reinjected`) options, folded into the aggregate `pass` with the same `(!check || check.pass)` guard `injection_resisted` uses. Callers omitting both options see no new keys — verified by a dedicated regression test.
- New golden fixture `tests/fixtures/eval-project/golden-artifacts/post-54/spawn-trace.json`: post-53-02's 8 entries plus a complete, realistic `handoff_brief` on each `gsd-executor`/`gsd-verifier` entry; `expectations.json` mirrors post-53-02's plus a `requiredHandoffAgents` key. `assertHandoffBriefPresent` against this real on-disk fixture returns `pass:true`; removing a key from one entry flips it to `false`.
- 13 new tests across the plan's 6 required categories (happy path, missing/malformed input, edge case, boundary, wiring/integration, regression-guard) — exceeds the minimum of 6. Notably proves paraphrase rejection (a reworded briefText fails containment) and fabrication detection (a briefText substring absent from the real source lands in `missing_from_source`).
- Full suite gate: 544/544 tests passing (was 532 at baseline) — zero new failures, zero regressions.

## Documentation Updates

- `CHANGELOG.md` — new entry under `## [Unreleased]` / `### Added` for the two eval assertions, the additive `runEvalAssertions` wiring, and the post-54 golden fixture (MILE-40)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add both assertions + additive runEvalAssertions wiring + golden fixture** - `8c61637` (feat)
2. **Task 2: TDD — both assertions across 6 categories** - `a8e3364` (test)
3. **Task 3: Full suite gate** - no separate commit (verification-only; no files changed — the suite was already green after Task 2)

**Docs commit:** `c383983` (docs)

## Files Created/Modified
- `get-shit-done/bin/eval-harness.js` - `assertHandoffBriefPresent`, `assertResumeInvariantsReinjected`, `REQUIRED_HANDOFF_KEYS`/`isNonEmptyHandoffValue` helpers, `runEvalAssertions` additive wiring, `module.exports` additions
- `get-shit-done/bin/eval-harness.test.js` - new `describe('Phase 54-03: ...')` block, 13 tests across 6 categories
- `tests/fixtures/eval-project/golden-artifacts/post-54/spawn-trace.json` - new golden fixture, 8 entries with complete `handoff_brief` blocks on executor/verifier entries
- `tests/fixtures/eval-project/golden-artifacts/post-54/expectations.json` - new golden fixture, mirrors post-53-02 plus `requiredHandoffAgents`

## Decisions Made
- `assertHandoffBriefPresent`'s `pass` requires `relevantCount > 0` (at least one required-agent entry exists) so an empty/irrelevant trace never trivially passes — matches the plan's must-have truth exactly.
- `assertResumeInvariantsReinjected`'s dual `missing_from_source`/`missing_from_brief` design catches both directions of drift: a brief that drops an invariant, and a brief that invents one not actually in the source — the plan's boundary-category tests lock both in.
- `handoffSpawnTrace` is an override, not a required companion to `requiredHandoffAgents` — either option alone triggers the check, and when `handoffSpawnTrace` is omitted the check reuses the already-parsed `spawn-trace.json` entries `runEvalAssertions` reads for `agents_spawned`, avoiding a redundant file read.

## Deviations from Plan

### Process Deviations (not Rule 1-4 cases)

**1. Task 2 (tdd="true") executed inline instead of via a literal gsd-test-writer subagent spawn**
- **Found during:** Task 2
- **Issue:** No Task/Agent-spawning tool was available in this execution environment (only Read, Write, Edit, Bash) — same constraint noted in 54-01/54-02's summaries.
- **Handling:** Wrote the test suite directly, following `gsd-test-writer.md`'s documented process and the plan's exact 6-category specification verbatim: a `describe('Phase 54-03: ...')` block with 13 tests total (exceeds the minimum of 6), all passing on first run against the real implementation (no test-then-fix cycle needed).
- **Files modified:** `get-shit-done/bin/eval-harness.test.js`
- **Verification:** `node --test get-shit-done/bin/eval-harness.test.js` → 49/49 pass (file total, including pre-existing 53-01/53-03 suites); full suite gate (Task 3) confirms 544/544, no regressions.
- **Committed in:** `a8e3364`

**2. Mandatory docs-update step executed inline instead of via a literal gsd-docs-updater subagent spawn**
- **Found during:** post-Task-3 mandatory docs update step
- **Issue:** Same tooling constraint as above.
- **Handling:** Performed `gsd-docs-updater.md`'s own documented procedure manually: classified build scope (bin/CLI internal module extension, no api/UI/architecture-decision keyword match) as `refactoring`, matching this repo's established convention for comparable additions — a substantive `### Added` CHANGELOG entry, same pattern as the immediately-preceding 54-01/54-02 entries.
- **Files modified:** `CHANGELOG.md`
- **Verification:** Entry traces every claim to this plan's actual commits/tests; committed separately from task commits.
- **Committed in:** `c383983`

---

**Total deviations:** 2 process deviations, both due to the same no-Agent-tool environment constraint documented in 54-01/54-02. No Rule 1-4 auto-fixes were needed — no bugs, missing critical functionality, or blocking issues were discovered while implementing this plan's two pure, additive functions.
**Impact on plan:** None on functional scope. Both process deviations fully delivered their mandated outcomes (TDD coverage across all 6 categories; a traceable docs update) via the executor performing the specified subagent's documented procedure directly.

## Issues Encountered
None beyond the process deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `assertHandoffBriefPresent` and `assertResumeInvariantsReinjected` are ready for Plan 04 to consume when wiring real coordinator/executor/verifier agent-boundary handoff-brief injection and validating it end-to-end against a real live run.
- The post-54 golden fixture demonstrates the presence assertion against realistic `handoff_brief` data; 54-04 can extend it with a real recorded live-run capture if desired, or reuse it as-is.
- No blockers for 54-04.

---
*Phase: 54-structured-handoffs*
*Completed: 2026-07-06*

## Self-Check: PASSED

- FOUND: `.planning/phases/54-structured-handoffs/54-03-SUMMARY.md`
- FOUND: `get-shit-done/bin/eval-harness.js`
- FOUND: `tests/fixtures/eval-project/golden-artifacts/post-54/spawn-trace.json`
- FOUND: `tests/fixtures/eval-project/golden-artifacts/post-54/expectations.json`
- FOUND: commit `8c61637` (Task 1)
- FOUND: commit `a8e3364` (Task 2)
- FOUND: commit `c383983` (docs)
