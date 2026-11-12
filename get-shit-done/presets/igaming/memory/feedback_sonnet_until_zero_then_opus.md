---
name: feedback-sonnet-until-zero-then-opus
description: "Haiku implements; fresh Sonnet reviews: high-stakes plans loop to zero, others at most 3 rounds; Opus only at mandatory points, once each"
metadata:
  node_type: memory
  type: feedback
  originSessionId: adce7a78-b4e2-4ee6-b8fb-2143c4dfbb8a
  modified: 2026-10-07T17:09:33.352Z
---

Haiku does implementation; fresh Sonnet agents (never the implementer) run every review/verify loop until findings are closed; Opus runs only where mandatory (money/auth/security plans, ONE batched diff review after Sonnet reports zero findings, the phase-end verifier, judgment-call rulings), once each.

**Why:** phases 391 and 392 burned many Opus rounds (391 had 4 Opus reviews, 392 had rulings A–H plus verifier-driven gap rounds) against the milestone cap of 2, mostly re-finding defects a cheap review pass would have caught; the weekly Opus quota is limited.

**How to apply:** put this rule in every coordinator brief; escalate an implementation task to Sonnet only after Haiku fails it twice, or if undecomposed/ambiguous; a Sonnet pre-verification of all must-haves precedes the Opus verifier; Opus re-checks only HIGH/money-path fixes. Related: [[feedback-use-fable-for-game-ui]], [[feedback-fix-all-findings-no-blind-defer]].

**Cost rule:** Haiku is cheaper with context under ~100k tokens — keep Haiku tasks small (one plan task / one finding batch), read line ranges not whole files, save test logs to .tmp/ and read only failing lines, fresh agent per task; all agents report answer-first, ≤10 lines.

**Clarified 2026-10-14 (v0.1.34 run):** owner: Opus is fine where it adds value (CRITICAL/HIGH re-verification, money/auth plans+reviews, rulings), just don't overuse it: default Haiku/Sonnet, batch Opus work, state a reason per Opus dispatch. Put in every coordinator brief.

Update 2026-11-02: non-high-stakes plans get at most 3 rounds (a CRITICAL/HIGH in round 3 earns a fourth). High-stakes loops: after round 4 a fresh Opus ruling decides whether another round runs (rounds 6+ on 4 plans: 87 findings, no reachable money/auth bug, 76% churn).
