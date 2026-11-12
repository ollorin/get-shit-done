---
name: Phase 235 Integration Test Fixes Applied (Apr 5, 2026)
description: Three distinct bugs fixed in parallel test runner; all buckets now passing
type: project
---

**Phase 235 Status**: ✅ **FIXED** — Commit 57fb0657

Three bugs caused 4 test buckets to fail in parallel execution. All fixes deployed and validated (1262 tests passing).

**Why**: 
- Missing RPC function meant auth tests couldn't run
- Schema cache probe used wrong body, making it unreliable → functions started with incomplete cache → cascading timeouts
- Implicit config bypass masked captcha test expectation

**What was done**:
1. Created `update_encrypted_profile()` migration (B5-auth-op fix)
2. Fixed CI probe from `-d '{}'` to `-d '{"p_source":"__schema_probe__","p_event_type":"__schema_probe__"}'` (B1/B3/B8 cascading fixes)
3. Removed implicit bypass on missing TURNSTILE_SECRET_KEY (anti-cheat-captcha fix)

**How to apply**: See `.planning/PHASE_235_FIXES_SUMMARY.md` for full context and prevention strategies.

**Token savings**: Fixed via Sonnet + Haiku parallelization — avoided full test suite runs for each diagnosis round.
