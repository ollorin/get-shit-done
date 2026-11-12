---
name: feedback-planners-write-plans-not-scripts
description: gsd-planner / plan-checker produce only PLAN.md (+RESEARCH/CONTEXT) — never .sh/.ts/.py in phase dirs; checks become executor tasks writing real tests or scripts/validation guards
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-09-27T12:44:46.295Z
---

Planners never write scripts or code. Owner (2026-09-27): "gsd-planner ... assigned to create some SH scripts?? this is totally incorrect."

**Why:** My review-budget rule 8 ("put verification in a script, test it once, reference it") pushed planners into authoring 13 verify-lib/guard/canary scripts in phase dirs — code outside the test suites, unreviewed as deliverables, and inflating plan-check rounds.

**How to apply:** A needed check is specified in PLAN.md as an executor task naming the real test file (unit/integration) or `scripts/validation/` guard to create, its assertions, and the red mutation. Existing phase-dir scripts are specs; the executor re-implements them as tests and deletes them. Codified in `.planning/v0.1.33-REVIEW-BUDGET.md` rule 8 (14d65852a).
