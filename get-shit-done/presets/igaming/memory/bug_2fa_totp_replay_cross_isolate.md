---
name: bug-2fa-totp-replay-cross-isolate
description: Real 2FA TOTP replay vulnerability fixed 2026-07-09 — cross-isolate stale Redis key bypassed replay check; DB is source of truth
metadata: 
  node_type: memory
  type: project
  originSessionId: c05eab6b-762a-49b7-9221-9d52e888e5a8
---

Real security bug found + fixed 2026-07-09 while chasing a "flaky" 2FA integration test during the v0.1.21 release. It was NOT a test artifact — it was a genuine 2FA-bypass / TOTP-replay vulnerability in production auth code.

**Root cause:** `TOTP2FAProvider.verify()` in `apps/api/libs/infrastructure/src/lib/facades/two-factor-facade.ts` unconditionally trusted a Redis "pending setup" key to mean "this is a setup-confirmation call" — and the setup-confirmation branch has NO replay check and unconditionally returns success. `enable()` writes that key to whichever edge-runtime isolate handled setup, but confirmation/verify can land on a DIFFERENT isolate (config.toml `policy = "per_worker"`; in tests each isolate has its own MockRedis Map), so the pending key goes stale and never gets deleted. A later verify routing back to that stale isolate took the unchecked setup branch → same TOTP code replayable.

**Fix:** before honoring a pending-setup key, `verify()` now checks the DB (isolate-independent source of truth) for TOTP `enabled=true`; if already enabled, the key is stale → delete it and fall through to the normal replay-protected path.

**How to apply / watch for:** this is the same CROSS-ISOLATE STATE hazard family as [[bug-view-recreation-drops-grants]]'s sibling MockRedis issue — any auth/security flow that trusts Redis-only state to gate a branch is suspect under `per_worker` isolates. DB should be source of truth for security-critical branch decisions, not per-isolate cache. Both this and the grants bug were masked by "flaky"/"environmental" test failures and only surfaced because the twice-green preflight gate was run honestly (not bypassed). See [[project-full-audit-2026-07]]; the deeper MockRedis test-double fix is owned by testing-ci-hardening (v0.1.22).
