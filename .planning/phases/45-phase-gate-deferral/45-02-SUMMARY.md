---
phase: 45-phase-gate-deferral
plan: 02
subsystem: testing
tags: [gsd-tools, verification, phase-gate, has-ui, route-detection]

# Dependency graph
requires:
  - phase: 45-01
    provides: "collectPhaseTouchedFiles, cmdVerifyPhaseGate, shared UI_FILE_PATTERNS/API_FILE_PATTERNS constants, 45-01's extension-only HAS_UI stub"
provides:
  - "isUIFile(filePath) — pure classifier: UI extension match OR app/pages/routes path (excluding api/ sub-paths and config/declaration files)"
  - "computeHasUI(touchedFiles) — pure function, touchedFiles.some(isUIFile), no I/O, no SUMMARY.md read"
  - "UI_FILE_PATTERNS extended with .astro/.mdx"
  - "cmdVerifyPhaseGate now derives has_ui from computeHasUI(touchedFiles) instead of the 45-01 extension-only stub"
affects: [45-03-deferred-waiver-protocol, 45-04-workflow-agent-wiring, 45-05-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route-path UI detection: /(^|\/)(app|pages|routes)\// AND NOT /(^|\/)api\// AND NOT config/declaration filename, layered on top of extension matching"

key-files:
  created: []
  modified:
    - get-shit-done/bin/gsd-tools.js
    - get-shit-done/bin/gsd-tools.test.js

requirements-completed: [MILE-06]

key-decisions:
  - "isUIFile's config/declaration exclusion regex checks both a generic `.config.` /`.d.` suffix pattern AND a basename-prefix list (vite/next/tailwind/jest/vitest/webpack/babel/eslint/prettier) — covers both `foo.config.ts` style and framework-named config files without over-fitting to one convention"
  - "Route-path detection intentionally accepts any non-api file under app/pages/routes/ as UI, even non-standard extensions (e.g. .ts under routes/) — accepted false-positive risk per 45-CONTEXT.md discretion, matching the plan's own guidance to refine only if test fixtures show false positives (none did)"

patterns-established:
  - "Diff-derived boolean detectors (computeHasUI) as pure functions taking only the touched-files array — no I/O, no SUMMARY.md read — establishes the shape future phase-gate detectors (e.g. HAS_API, HAS_MIGRATION) should follow for the same self-report-independence guarantee"

# Metrics
duration: ~15min
completed: 2026-07-04
---

# Phase 45 Plan 02: Diff-Based HAS_UI Detection Summary

**Replaced the 45-01 extension-only HAS_UI stub with `computeHasUI(touchedFiles)` — a pure, route-pattern-aware detector that catches `.astro`/`.mdx` files and UI route files (`app/`, `pages/`, `routes/`) while correctly excluding `api/` sub-paths and config/declaration files, all independent of SUMMARY.md self-reports.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-04T17:29:00Z (approx.)
- **Completed:** 2026-07-04T17:44:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `UI_FILE_PATTERNS` extended from `['.tsx', '.jsx', '.vue', '.svelte']` to include `.astro`, `.mdx`
- `isUIFile(filePath)`: extension match OR route-directory path (`app/`, `pages/`, `routes/`) excluding `api/` sub-paths, config files (`*.config.*`), and declaration files (`*.d.ts`)
- `computeHasUI(touchedFiles)`: pure function, no I/O, no SUMMARY.md read — `touchedFiles.some(isUIFile)`
- `cmdVerifyPhaseGate`'s `hasUi` now calls `computeHasUI(touchedFiles)` directly, replacing the 45-01 stub
- 8 new tests proving the full HAS_UI detection matrix (SUMMARY-independence, non-UI, mixed, api-exclusion for both `pages/api/` and `app/api/.../route.ts`, `.astro` route detection, config-file exclusion edge case, plan-structure regression)

## Documentation Updates

No documentation-worthy changes in this phase (internal CLI tool + tests; same as 45-01, `verify phase-gate`/`computeHasUI` usage is documented inline in gsd-tools.js, not a standalone docs/ page — 45-04 wires this into user-facing workflow/agent docs).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add isUIFile/computeHasUI and extend shared UI extension list** - `419e19f` (feat)
2. **Task 2: Test HAS_UI detection matrix** - `98b2b6a` (test)

_Note: Task 2's tests were written directly rather than via a spawned `gsd-test-writer` subagent, since no `Agent()`-spawning tool was available in this execution context — same situation as 45-01. Noted per task instructions._

## Files Created/Modified
- `get-shit-done/bin/gsd-tools.js` - Extended `UI_FILE_PATTERNS`; added `isUIFile(filePath)` and `computeHasUI(touchedFiles)`; wired `cmdVerifyPhaseGate`'s `hasUi` to `computeHasUI(touchedFiles)`
- `get-shit-done/bin/gsd-tools.test.js` - Added `describe('diff-based HAS_UI detection matrix (Phase 45-02)')` with 8 tests

## Decisions Made
- Kept `isUIFile`'s route-path branch permissive (any non-api file under `app/pages/routes/` counts as UI) per the plan's explicit "refine only if fixtures show false positives" instruction — no fixture in this plan's test matrix showed a false positive, so the permissive form was kept as-is
- Config/declaration exclusion checks both a suffix regex (`.config.ts`, `.d.ts`) and a basename-prefix list for common framework config filenames, giving broader coverage than either alone

## Deviations from Plan

None in the production code (`get-shit-done/bin/gsd-tools.js`) — Task 1 was implemented exactly as specified in the plan, including the provided `isUIFile` regex logic verbatim.

### Test-fixture-only finding (not a production deviation)

While writing Task 2's regression test (extending the 45-01 `verify plan-structure` UI-QA-check fixture to add a second, checkpoint task), a pre-existing parser quirk in `cmdVerifyPlanStructure` was discovered: its task-tag regex (`/<task([^>]*)>/g`) also matches the outer `<tasks>` wrapper's own opening tag (since "tasks" starts with "task"), which shifts task-attribute attribution by one index when 2+ tasks are wrapped in `<tasks>...</tasks>` — misclassifying a `checkpoint:ui-qa` task as non-checkpoint and wrongly flagging it as missing `<action>`. This is unrelated to the UI_FILE_PATTERNS/computeHasUI change this plan makes (it exists identically before and after this plan's edits) and was not introduced by any change in this plan. Per the scope boundary ("only fix what you break"), this was **not fixed** — instead the regression test fixture was written without the `<tasks>` wrapper (matching the convention already used by every pre-45-02 test in the file, including the one this regression test extends), and the finding was logged to `deferred-items.md`.

- **Logged to:** `.planning/phases/45-phase-gate-deferral/deferred-items.md`
- **Impact on plan:** None — Task 2's tests pass using the established no-wrapper convention; the underlying parser regex was left untouched, matching scope.

---

**Total deviations:** 0 auto-fixed. 1 pre-existing gap discovered and deferred (documented above, not fixed, out of scope for this plan).
**Impact on plan:** No scope creep. Production code matches the plan's spec exactly.

## Issues Encountered
None beyond the deferred parser-quirk finding documented above.

## Test Results

Tests (Task 2): 8 passing, 0 failing (out of 198 total in the full suite, up from 190 before this plan)

| Behavior | Result |
|----------|--------|
| `.tsx` in diff, omitted from SUMMARY.md key-files | `has_ui: true` (proves independence from SUMMARY.md) |
| Non-UI plan (`.ts` only, no route path) | `has_ui: false` |
| Mixed plan (`.tsx` + several `.ts`) | `has_ui: true` |
| `pages/api/users.ts` alone | `has_ui: false` |
| `app/api/users/route.ts` alone | `has_ui: false` |
| `routes/checkout.astro` alone | `has_ui: true` |
| `*.config.ts` under `pages/` | `has_ui: false` (config exclusion wins) |
| Regression: `verify plan-structure` UI-QA-check on `.tsx`/`.astro`-extended `UI_FILE_PATTERNS` | still `valid: true` |

Categories covered: SUMMARY-independence, non-UI-negative, mixed-positive, api-path exclusion (both `pages/` and `app/` conventions), extended-extension detection, config-file exclusion edge case, plan-structure regression.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `isUIFile`/`computeHasUI` are in place and wired into `cmdVerifyPhaseGate` for 45-03/45-04/45-05 to build on
- `verify phase-gate 45` was re-run against the real `.planning/phases/45-phase-gate-deferral/` directory after this plan's changes: `has_ui: false`, `touched_files_count: 2` (only `gsd-tools.js`/`gsd-tools.test.js` touched so far in this phase — correctly not flagged as UI), confirming the command works against real, not just fixture, data
- One pre-existing, unrelated parser quirk in `cmdVerifyPlanStructure` (see Deviations) logged to `deferred-items.md` for future attention — does not block 45-03/45-04/45-05
- No blockers for 45-03

---
*Phase: 45-phase-gate-deferral*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: get-shit-done/bin/gsd-tools.js
- FOUND: get-shit-done/bin/gsd-tools.test.js
- FOUND: commit 419e19f
- FOUND: commit 98b2b6a

## Docs

**Status:** Failed — No Agent()/Task subagent-spawning tool available in this execution context, so gsd-docs-updater could not be spawned (same limitation as 45-01). This plan's changes are internal CLI-tool code + tests with no user-facing docs/ impact (documented inline in gsd-tools.js's own header comment block); flagging here per the mandatory-docs-update protocol rather than silently skipping.
