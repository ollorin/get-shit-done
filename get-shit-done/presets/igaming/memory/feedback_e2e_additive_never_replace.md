---
name: feedback-e2e-additive-never-replace
description: "New/faster test suites are built alongside existing ones; old LLM Charlotte tests are retired only after proven equal-or-better coverage + measured speed, keeping a few for UI checks"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-09-25T18:20:26.279Z
---

When introducing a new test harness (e.g. scripted no-LLM E2E replacing LLM Charlotte), build it ADDITIVELY. Never remove or change existing tests in the same effort. Old scenarios are dropped only after the new counterpart has proven the same or better coverage and a measured speedup, and a small LLM subset always stays to check the UI.

**Why:** the LLM suite understands page content and judges screenshots, which scripts can't. The owner won't trade that away on a projection (2026-09-25, Phase 388.1).

**How to apply:** new suites get their own task and runner path. Retirement is a separate, evidence-gated owner decision backed by a per-scenario equivalence ledger. Related: [[feedback-never-skip-quality-gates]]; always run such work as a GSD phase, not ad-hoc.
