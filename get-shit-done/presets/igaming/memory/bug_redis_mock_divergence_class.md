---
name: bug-redis-mock-divergence-class
description: "MockRedisClient diverges from real Upstash (RESP integers vs booleans, raw vs decoded strings, Lua ARGV handling), so green unit suites hid 3 production login breaks in v0.1.33 Phase 392"
metadata:
  node_type: memory
  type: project
  originSessionId: 58cca91c-5014-4482-b959-beca6c420713
  modified: 2026-10-03T18:36:42.111Z
---

In Phase 392 (v0.1.33), three separate commits shipped production-breaking login defects behind a green unit suite. In each case the Redis test double behaved differently from real Upstash:
- B1: magic-link value double-encoded.
- B2: a Lua boolean is returned as RESP integer `1`, but the code compared with `=== true`.
- N1: the `redis.eval` ARGV order was wrong. The mock dispatches on key count and ignores the script text.

**Why:** the mock (`libs/infrastructure/src/lib/cache/redis-client.ts`, `MockRedisClient`) invents script semantics, and the "fidelity" tests only stubbed `fetch`.

**How to apply:** any Redis Lua or encoding change needs an integration test that runs the real script against the stack's real Redis. Never trust a unit test that uses the mock for `eval`, GETDEL, or reply shapes. Opus diff reviews should check for this class explicitly.

**The same class exists for Supabase.** Phase 391 (v0.1.33) found at least 6 instances where a hand-rolled Supabase stub modelled less of the query chain than production calls (for example a missing `.eq('game_type', …)`), so tests passed against a path production never takes. It did not converge within the phase. Phase 392 also found a double that answered for an id production would never query. Candidate theme for the codebase-review-hardening milestone: one shared high-fidelity Supabase fake in place of per-file stubs.

Related: [[feedback-zero-tolerance-tests]], [[project-next-milestone-code-review-first]].
