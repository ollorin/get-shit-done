---
name: feedback-fable-replaces-opus-during-allowance
description: "The owner 2026-11-10: while the Fable test allowance lasts, Opus-tier dispatches (plans, rulings, batched review, phase verifier, milestone audit) use model fable; fall back to opus if rejected"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-11-10T21:52:51.913Z
---

The owner 2026-11-10: Fable 5.2 ([1m]) is available with extra test tokens; use it wherever Opus was used (phase validation, high-stakes plans, rulings, diff review, milestone audit). Sonnet coordinators/reviewers and Haiku implementers unchanged; Fable agents may use Haiku helpers.

**Why:** extra tokens exist specifically to test Fable; the first uses (plan review, test-speed strategy, agent slimming) produced verified findings (e.g. X8-C7-1 authz hole traced by me).

**How to apply:** pass `model: "fable"` with the same `subagent_type` as the Opus role; if the dispatch is rejected for allowance/availability, use `opus` and report it. Still no all-high-tier batches. Supersedes "Fable not used" in [[feedback-use-fable-for-game-ui]] while the allowance lasts.
