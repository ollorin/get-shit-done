---
name: GSD quality gaps exposed by v0.1.8 execution
description: Execute-roadmap bypassed 13-stage test system — phase coordinators skipped Charlotte QA, E2E test generation, UX sweeps, and verifier QGATEs. Integration tests found 52 failures at the end instead of per-phase.
type: project
---

v0.1.8 milestone execution exposed that the 13-stage GSD test system (PRD ACs → roadmapper test criteria → planner validate_testing_gate → executor test-writer → Charlotte QA → UX sweep → E2E gap closure → verifier QGATEs) was entirely bypassed during roadmap execution.

**Why:** The execute-roadmap coordinator spawns phase sub-coordinators with generic prompts that don't reference the test stages. Under context pressure from 7 sequential phases, coordinators skip later stages (Charlotte QA, UX sweep, E2E generation). Phase 105 (UI-heavy) has `verifier: coordinator` in VERIFICATION.md — QGATEs were never run.

**How to apply:** When working on GSD workflow improvements:
1. The execute-roadmap → phase-coordinator prompt must explicitly list mandatory test stages
2. Cross-phase integration tests should run BETWEEN phases, not only at the end
3. `gsd-tools.js gate:pre-pr` should be a hard programmatic check, not prose instructions
4. Phase coordinators should never be allowed to write VERIFICATION.md inline for UI phases — must spawn gsd-verifier
