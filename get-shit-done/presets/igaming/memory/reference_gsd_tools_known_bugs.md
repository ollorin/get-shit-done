---
name: reference_gsd_tools_known_bugs
description: "Known bugs in gsd-tools.js (the GSD fork's CLI) found during v0.1.29 roadmap execution, not yet fixed upstream"
metadata: 
  node_type: memory
  type: reference
  modified: 2026-09-09T15:37:50.162Z
  originSessionId: a1894921-c321-4953-a2e4-f815991253a7
---

Found live during v0.1.29 (PVP Arena Combat Economics) roadmap execution, phases 338-341.
Workarounds applied inline each time; none fixed in the fork source yet (per [[reference_gsd_fork_rollout]]'s
discipline — fixes belong in `~/get-shit-done`, not patched ad hoc in a consuming repo).

1. **`gsd-tools.js phase complete <N>` corrupts `ROADMAP.md`'s Progress summary-table row.** Found
   in Phase 341: it overwrote the Requirements column with the literal string "Complete" and the
   Plans-Complete column with a date, instead of updating Plans-Complete (e.g. "5/5") and Status
   ("Complete") in their own columns. This is almost certainly the ROOT CAUSE of the recurring
   "stale/inconsistent summary-table row" gap `gsd-verifier` found and had to correct by hand in
   Phases 338 and 339 before Phase 340/341's coordinators learned to fix it proactively — not
   independent human/agent carelessness each time, a single tool bug.

2. **`gsd-tools.js verify test-content`'s hollow-test detector only recognizes `expect`/`assert.\w+`
   call patterns, not Deno's `assertEquals(...)` family** (`assertEquals`, `assertRejects`,
   `assertThrows`, etc. — the actual convention this whole Deno-based repo uses). Produces a false
   "hollow test" PARTIAL verdict on files that contain real, substantial `Deno.test` blocks (seen:
   3 files with 17/53/5 real test blocks each, all real). Verifier caught this by direct
   enumeration/reading rather than trusting the tool's automated verdict — the pattern to follow:
   don't trust this specific check's PARTIAL/hollow verdict without a manual read-through when the
   codebase under test is Deno-native.

**Separately, a real verification convention worth keeping:** `VERIFICATION.md` for phase N MUST
be named `{N}-VERIFICATION.md` (not plain `VERIFICATION.md`) — `gsd-tools.js verify phase-gate`
looks for that exact prefixed filename and reports a false `missing_verification` failure
otherwise even when a correctly-named-but-wrong file exists with `status: passed`. Hit in Phase 338
(cost a full extra round-trip to diagnose); phases 339 onward got it right from the start once
briefed explicitly.

3. **`gsd-tools.js verify phase-gate`'s `testRequired` check is a naive regex
   (`/tdd=["']?true/.test(planContent)`) over the WHOLE PLAN.md body, not just frontmatter task
   declarations.** It false-positives on prose that merely *discusses* the absence of a tdd task —
   e.g. a docs-only plan's own justification text ("no `tdd=\"true\"` task ... were required
   (MANDATE-1/2 both N/A)") matches the regex and flags `required: true, failure_type:
   "missing_test"` even though the phase has zero code and a genuinely passing gsd-verifier
   VERIFICATION.md. Found in Phase 354 (v0.1.30, docs-only milestone-closure phase), verified as a
   false positive by reading both PLAN.md files directly — no real `tdd="true"` frontmatter task
   existed in either. Since `execute-roadmap.md`'s own 5a step only reads the `has_ui` field from
   this same JSON (never gates on the top-level `passed` boolean), this bug doesn't actually block
   roadmap execution for UI-less phases — but don't trust a manual/standalone `verify phase-gate`
   "failed" result on a docs-only or backend-only phase without reading the plan content yourself
   first.

4. **`gsd-tools.js verify phase-gate` on a DECIMAL (inserted) phase number produces mass false
   `claimed_file_not_in_diff` warnings — nearly every file the plan legitimately touched gets
   flagged — plus a `missing_test` failure, even when the phase is genuinely complete.** Found in
   Phase 368.1 (v0.1.31, an urgent `gsd:insert-phase` CVE-remediation insertion): `verify phase-gate
   368.1` reported `passed: false` and flagged `package.json`, `pnpm-lock.yaml`,
   `scripts/cve-scan-baseline.json`, `docs/security/cve-remediation-backlog.md`, etc. as
   "claimed_file_not_in_diff" despite every one of them being genuinely modified in real, committed
   changes (`git log`/`git show --stat` on the actual commits confirmed all of it, and an
   independent `gsd-verifier` run separately confirmed 11/11 must-haves). Root cause unconfirmed —
   likely the same diff-range-computation machinery mis-resolving a decimal phase number's commit
   boundary (falls back to phase 368's range, or to some default that doesn't include 368.1's own
   commits) rather than a new distinct bug from #3 above. Workaround applied: spot-check `git log
   --oneline` + `git show --stat` on the phase's actual commits directly rather than trusting this
   tool's `passed`/`touched_file_warnings` output for any decimal/inserted phase — same "don't
   trust a standalone verify phase-gate failure without reading the real diff yourself" lesson as
   #3, but specifically flagged here because decimal phases make it categorically worse (mass
   false positives, not one regex false-positive).

**Fixed 2026-10-02 (`10d062a` in ~/get-shit-done):** `phase complete` and `roadmap update-plan-progress` now find the Status/Plans column from the table header, so the summary-row corruption is gone. The other bugs listed above still stand.
