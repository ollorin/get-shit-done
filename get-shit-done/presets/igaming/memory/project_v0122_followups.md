---
name: project_v0122_followups
description: Deferred tech-debt surfaced during the v0.1.22 CI-hardening release (2026-07-11)
metadata: 
  node_type: memory
  type: project
  originSessionId: c05eab6b-762a-49b7-9221-9d52e888e5a8
  modified: 2026-08-27T16:32:58.613Z
---

Three items were found but deliberately NOT fixed during the v0.1.22 release (merge commit c62c5026, tag v0.1.22) to keep the release focused. Address in a later phase:

1. **Security follow-up** — one auth-hardening item from the v0.1.22 release is tracked in the private repo's tracker; its details are deliberately not preserved here. Related: [[bug_view_recreation_drops_grants]].

2. **`deploy-production.yml` phantom failed runs — cause re-investigated 2026-08-27, still unresolved.** The originally-described cause (an invalid `branches:` sub-key under `workflow_dispatch`) was already fixed at commit `a23e4f27` on both `main` and every branch checked — that key is gone. The phantom `push`-event run (zero jobs, `conclusion: failure`) still happens on every push regardless (confirmed on PR #141, already merged, and PR #142). Root cause is still NOT identified — ruled out: no other workflow references it as reusable, file has zero diff between branches, `on:` block genuinely only lists `workflow_dispatch` with no `push` trigger. Leading unconfirmed theory: interaction between the `environment: production` gate on its jobs and GitHub's environment-protection-rule status reporting for events the workflow was never meant to handle. Deliberately NOT fixed via guesswork — this file gates real production secrets/deploys, not a safe place to experiment blind. Confirmed cosmetic/non-blocking: no required-status-check enforcement exists (see item 5), PRs merge fine despite it.

3. **`RATE_LIMIT_BYPASS` is a dead env var** — read by the pre-auth gates but never wired into the edge-runtime secrets, so it cannot reach the edge-runtime container. Either wire it through config and workflow, or remove the dead read; see the private repo's tracker.

4. **`deploy-staging.yml` chronic red — RESOLVED 2026-07-11.** "Deploy to Staging" had failed on every `main` commit for months (v0.1.21 included) because its "Pre-Deployment Tests" ran `deno task test:integration:ci` (single `deno test --parallel` process, MockRedis) → ~51 test-isolation failures. Fixed across PRs #131/#133: repointed pre-deploy tests to the bucketed `scripts/run-integration-tests.sh` + SRH Redis (parity with pr-validation); added the missing workspace-libs copy step to the Deploy Edge Functions job; added dummy `SUPABASE_URL` env to the coverage-baseline recompute. Staging now FULLY deploys — migrations, edge functions, both Vercel frontends, post-deployment validation all green (run 29149661176, main d3b3aab3). Also fixed a real surfaced flake: `crash-bet-wallet.integration.test.ts` raw hardcoded `round_number` → collision-retry. Last remaining item: PR #134 (open, unmerged) adds `permissions: contents: write` to the `update-coverage-baseline` job so its `git push origin main` (bot ratchet commit) stops 403-ing — cosmetic; the deploy itself is green without it.

5. **GitHub Actions minutes quota — hit 2026-07-11.** After the day's very heavy CI usage (many full-stack ~20-min pr-validation + staging-deploy runs on the private 2-vCPU repo), GitHub stopped creating NEW Actions runs (no repo-wide run created after ~10:38Z; PR #134 triggered no pr-validation despite no path filters, Actions enabled). Almost certainly the private-repo Actions minutes/spending limit. Resolution is account-side only: wait for the monthly reset or raise the spending limit (Settings → Billing → Actions). Until then, new CI/staging-deploy runs won't start. There are NO required status checks on `main` (branch protection needs GitHub Pro), so PRs can still be merged without CI when necessary.

**Why:** each is real but out-of-scope for a release already validated green (pr-validation CI); bundling them risked the release. #4 is pre-existing (months) and equal to v0.1.21's state. **How to apply:** dedicated hardening/security phase; #2 one-line workflow fix, #1 security review, #3 cleanup, #4 repoint the staging test step to the bucketed runner (blast radius: live staging deploy).
