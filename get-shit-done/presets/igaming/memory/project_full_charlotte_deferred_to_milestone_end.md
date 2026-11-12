---
name: project-full-charlotte-deferred-to-milestone-end
description: "Owner 2026-10-30: the full Charlotte regression is deferred from every phase end to the milestone end (v0.1.34); per-plan scenario runs continue"
metadata:
  node_type: memory
  type: project
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-10-30T08:14:23.378Z
---

Owner 2026-10-30: "Defer full Charlotte regression to the milestone end." For v0.1.34 (Phases 398-422) no phase runs the phase-end FULL player-web/operator regression; it runs once at milestone completion, before the PR. Per-plan deterministic scenario runs (e.g. scenario 54, 26) still happen where a plan touches UI/API.

**Why:** the full run needs CLAUDE_CODE_OAUTH_TOKEN (interactive `claude setup-token`) and is slow; Phase 400 already had 51 plans of delay.

**How to apply:** phase VERIFICATION.md sets `charlotte_qa_ran` only from real run logs and records the full regression as "deferred to milestone end by owner decision", never as passed. Milestone-end step (owned by main): create the token, run one full regression on the final tree (clean tree, fresh prod build, manifest gitSha = HEAD), then preflight + PR. Must re-cover the Phase 400 gaps: operator RG tab (400-49, 2FA-blocked ui-qa), scenario 54 and the raw-DOM-write class (Phase 418). Risk accepted: a late failure is harder to bisect across 25 phases. See [[feedback-never-skip-quality-gates]].
