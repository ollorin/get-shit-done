---
name: v0.1.9 Post-Mortem Learnings
description: Critical process failures from v0.1.9 Bonus System milestone — context overflow recovery, cross-phase validation, Charlotte QA enforcement, documentation gaps
type: feedback
---

## Cross-Phase Integration Checks Are Unconditional
Run integration tests after EVERY phase — not "if migrations changed". The conditional was always true for v0.1.9 but never triggered because the orchestrator forgot.
**Why:** 15 test failures discovered only at the end instead of incrementally.
**How to apply:** After every phase completion, run `deno task test:integration` before starting the next phase. No exceptions.

## Charlotte QA Cannot Be "Code-Level Verified"
UI phases (any phase that creates/modifies .tsx/.jsx files) MUST have Charlotte run with live browser screenshots. "Verified via code inspection" is not acceptable.
**Why:** 5 UI bugs found only when Charlotte ran post-facto (crashed campaign list, frozen countdown, empty promotions section).
**How to apply:** Start dev servers before UI phases. Run Charlotte scenarios + regression. If Charlotte's browser is broken, fix it before declaring phase complete.

## Context Overflow Loses Requirements
When a phase coordinator hits context limits, Charlotte QA and other late-phase steps get dropped. The coordinator returns incomplete work as "complete".
**Why:** Phases 114, 116, 117 all overflowed — each had 500-770 line plans that accumulated too much code context.
**How to apply:** Split plans to max 400 lines. If a plan has both DB migrations AND edge function changes AND integration tests, split into 3 separate plans.

## Cross-Layer Type Validation Is Mandatory
DB CHECK constraints, RPC validation arrays, edge function validation, frontend types, and UI display maps must have identical enum/status values. v0.1.9 had `friend_challenge` in edge function but not in DB, and `paused_by_cap` missing from frontend.
**Why:** Runtime 500 errors or silently wrong UI labels.
**How to apply:** When adding a new value to ANY layer, grep all other layers and update in the same commit.

## Documentation Is Not Optional
v0.1.9 shipped 3 new schemas, 20+ endpoints, 15+ tables with ZERO docs. This must be a mandatory final phase.
**Why:** New developers have no reference for the entire bonus system.
**How to apply:** After all phases complete, before PR, spawn docs-updater or write endpoint docs manually.
