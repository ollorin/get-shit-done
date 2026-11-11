---
paths:
  - "apps/api/functions/bonus/**"
  - "apps/api/migrations/*bonus*.sql"
  - "apps/player-web/src/components/bonus/**"
  - "apps/operator-web/src/components/bonus/**"
---

# Bonus System Rules

Applies to: `functions/bonus/`, `migrations/*bonus*`, `apps/*/components/bonus/`

---

## Realtime Broadcasts Are Non-Blocking Side Effects

`broadcastEvent()` in edge functions must never be awaited. The Supabase Realtime WebSocket subscription can hang indefinitely in local/test environments. The grant is committed to DB before broadcast — the broadcast is a non-critical notification.

Pattern: `broadcastEvent(...).match(() => {}, (err) => console.error(err))`

## Bonus Test State Is Shared and Must Be Isolated

Integration tests create campaigns that persist across runs. Without cleanup, accumulated test campaigns cause the event processing loop to timeout (it evaluates ALL active campaigns per event). Every bonus test file must deactivate non-seeded campaigns at module load before any `Deno.test()` body runs.

**Module-load cleanup is not enough on its own.** A file that creates many campaigns with no `maxGrants`/`dailyGrantCap` (unlimited — never self-exhausts via `bonus_check_budget`) leaves all of them `active` for the rest of that file's own run, so later tests in the *same file* pay an ever-growing `bonus_process_event` fan-out cost even on a single, freshly-reset invocation. `bonus-middleware.integration.test.ts` and `bonus-eligibility.integration.test.ts` fix this with a `test()` wrapper (drop-in replacement for `Deno.test()`) that tracks campaign IDs created via `createActiveTestCampaign()` and deactivates them in a `finally` block after every test. Any bonus test file that creates more than a handful of unlimited campaigns should use the same pattern. Every bonus test file should also end with a `TEARDOWN` test that calls `cleanupAllTestCampaigns(bonusClient)` unconditionally (not age-gated) — this bounds accumulation across repeated back-to-back invocations (e.g. re-running preflight without a `supabase db reset` in between), since the age-gated `cleanupOldCampaigns()` grace window only protects genuinely-parallel sibling files, and `B1a`/`B1b`/`B1c` now run sequentially (see below), so nothing needs that protection anymore.

**Parallel Execution Impact:** See Phase 235 Parallel Runner documentation in `/docs/testing/parallel-runner-results.md` for domain bucket assignment and campaign cleanup timing. Bonus tests are split across three buckets (`B1a-bonus-middleware`, `B1b-bonus-eligibility`, `B1c-bonus-grants`) that run **sequentially within one background job** (not in parallel with each other) specifically because `bonus_process_event` evaluates ALL active campaigns globally — see commit `b2c4df84`. They still run concurrently with the other (non-bonus) domain buckets.
