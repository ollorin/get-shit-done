---
name: Never skip pre-PR quality gates
description: MUST run integration tests, Charlotte E2E, and full check suite TWICE before opening any PR — never claim work is complete without evidence
type: feedback
---

Never skip pre-PR quality gates. Run integration tests, Charlotte E2E regression, and the full check suite TWICE before opening any PR.

**Why:** During v0.1.8 roadmap execution, I opened a PR without running integration tests or Charlotte E2E. The Phase 106 migration had 3 bugs (nonexistent table reference, view column dependency, function dependency cascade) that would have been caught by `supabase db reset` + integration tests. Additionally, 52 integration tests failed because the test auth helper wasn't updated for operator auth — also would have been caught. The user had to intervene to fix what should have been caught automatically.

**How to apply:** After all phases complete and before `gh pr create`:
1. Run `npx supabase db reset` — must succeed without errors
2. Run ALL integration tests (`functions/__tests__/*.integration.test.ts`) — must be 0 failures
3. Run Charlotte E2E regression — must pass
4. Run full check suite TWICE (lint, type check, unit tests, builds) — both green
5. Only THEN open the PR

Never rationalize skipping these with "the phase coordinators already ran tests" — phase coordinators test in isolation, not against the full migration chain.
