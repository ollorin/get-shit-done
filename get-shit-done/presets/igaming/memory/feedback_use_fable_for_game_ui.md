---
name: feedback_use_fable_for_game_ui
description: "Model tiering: Opus plans (decomposed) + verifies + high-stakes; Sonnet coordinates + first review; Haiku implements + runs tests; Sonnet escalation only on 2 Haiku failures/ambiguity; Fable not used"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d29a6c8d-ecd0-4f75-a980-b2df3eb2d186
  modified: 2026-10-28T22:34:59.738Z
---

**Match the subagent model to the task's actual complexity. Routing everything to one high tier is
a defect, not caution.** Corrected 2026-07-25: the owner explicitly called out over-use of Opus
("make sure you not using opus models for all, select right models based on task complexity").

**Fable is no longer used (owner directive 2026-09-23): everything previously routed to Fable goes to
Opus.** This replaces the older Fable plan+review rule and its 2026-08-28 same-session Opus
fallback — Opus is now the standing tier, not a fallback.

Tiers (see [[user_role_ceo_cpo]]):
- **Opus** — architecture, API contract changes, DB schema design, cross-cutting root-cause
  analysis; AND the PLAN + REVIEW for games (UI/UX, configs, complex game logic) and high-stakes
  correctness on this real-money platform: security, auth, money movement/payments, fraud/AML, KYC,
  RNG/fairness. Opus plans in detail, decomposed into small tasks, and does phase-end verification and the
  milestone audit. A phase in these domains is Sonnet-research → Opus-plan → Haiku-implement →
  fresh Opus-review of the diff against the plan (and MANDATE-6/money-movement constraints). Plan,
  implementation, and review stay separate dispatches so the review is independent.
- **Sonnet** — ALL coordinators and the first reviewer (fresh review/pre-verification rounds to
  zero findings, never the implementer), plus research. Implements only when escalated: Haiku
  failed the same task twice, task undecomposed/ambiguous, unclear-root-cause debugging, architecture.
- **Coordinators** (execute-roadmap phase coordinators, death-resume coordinators) — ALWAYS Sonnet,
  passed explicitly as `model: "sonnet"` (the gsd-phase-coordinator default ran on Opus and
  hit the session limit mid-Phase 384, 2026-09-24). Opus coordinator only if the owner explicitly
  asks. Coordinators escalate judgment calls (defer/accept a failure,
  plan deviation, loosening/disputing a test, high-stakes autonomous design decisions) to a fresh
  Opus dispatch; `gsd-verifier` runs on Opus.
- **Haiku** (alias `haiku`, never a hard-coded ID) — test runner AND default implementer for regular
  coding tasks (Opus plans are already decomposed), plus lint/builds, git ops, file/config reads,
  SUMMARY/STATE/changelog writing. A Haiku miss is caught by the Sonnet reviews and Opus verification.

**Why:** high tiers cost quota that later phases need, and a whole-batch-Opus run adds wall-clock
with zero quality gain on mechanical work. On 2026-07-25 a Charlotte E2E run died mid-suite on an
account session limit — 16 scenarios errored purely from budget exhaustion, so tier discipline is
a throughput constraint here, not just a cost preference.

**How to apply:** a parallel batch should be MIXED — e.g. Opus for an auth refresh-race diagnosis,
Haiku implementing decomposed tasks and running the suite, Sonnet reviewing. If every agent in a batch is Opus,
re-check whether each genuinely needed it. Mirrored into the repo's `CLAUDE.md` under
"Subagent Usage IS MANDATORY". Historical artifacts named `*-FABLE-REVIEW.md` stay as-is; new
reviews are Opus reviews.
- **Opus checkpoints** (2026-09-25): any work not implemented by Opus gets an Opus gsd-verifier at phase end and an Opus audit-milestone at milestone end. Rules must stay model-agnostic — never reference the proxy or whether a tier is routed (owner).

Plan-only coordinator itself runs on Opus, along with its researcher, planner and plan-checker. Implementation runs on Haiku. I once launched the plan coordinator on Sonnet while giving only its children Opus, and the owner called it out: "you launched sonnet again".

Never use Opus forks as a workaround for lower-tier work (implementation, fixes, investigation, debugging) — route implementation to Haiku (gsd-executor `model: "haiku"`), debugging to Sonnet, even though dispatches sometimes die on cloudflare malformed-200 errors. Opus (fork when `model: "opus"` 404s) is only for high-stakes plans/reviews, verifier, architecture/schema. On any dispatch/API failure (malformed 200, 5xx, 429), re-dispatch or resume from on-disk state immediately; on rate limits retry at the first moment the reset allows — never leave a phase idle waiting for a human.

**2026-10-28 (owner): pin models explicitly.** "Haiku for almost everything, Sonnet as per-task reviewer, Opus review of the whole phase at the end." Agent definitions without a `model:` line (executor, planner, plan-checker, test-writer, debugger) INHERIT the spawner's tier: Phase 400 executors ran on Sonnet (400-32..400-44) because the Sonnet coordinator passed `sonnet`. Every spawn now passes `model` explicitly; executor and test-writer definitions pin `haiku` (GSD fork 53f7f14, repo CLAUDE.md d11bcd441). Weekly usage was ~50% on 2026-10-28; the old 2026-10-03 weekly-limit note is obsolete (limit reset 2026-10-27) and removed.
