---
name: feedback-keep-two-phases-in-flight
description: Owner wants at least 2 roadmap phases in flight at once whenever dependencies and file sets allow; coordinated via file claims + peer check-in before stack resets
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-09-26T11:06:52.962Z
---

Owner directive (2026-09-26): keep at least 2 roadmap phases running in parallel, as long as they don't edit the same files. Run 3 if possible.

**Why:** it cuts milestone wall time. A single serial phase coordinator leaves capacity idle.

**How to apply:** when a phase finishes, or dependencies clear, spawn the next independent phase so 2 are always in flight.
- Each coordinator claims its paths in `.tmp/phase-file-claims.md` and gets its peers' agent IDs.
- Before any `supabase db reset`, stack stop/start or preflight, a coordinator takes `.tmp/local-stack.lock` AND SendMessages its peers for an OK.
- Commit only your own paths.
- UPDATED 2026-09-26: the owner amended CLAUDE.md. Main may run 3 executing phase coordinators plus 1 plan-ahead coordinator (planning only, no code or stack). The 2-child ceiling still binds each coordinator. The real bottleneck is the single local stack (the lock queue). Keep Charlotte at --parallel 2 or less and MAX_CONCURRENT_BUCKETS=2 (16GB host, heavy swap).
- When a phase slot frees: prefer an already-planned phase (from the plan-ahead coordinator) so execution starts immediately. Priority: security (387.1, 387.2), then 388.1 (pulled forward: faster regression gate), then the rest.

Related: [[feedback-dont-overspawn-subagents]], [[feedback-no-sendmessage-to-handed-back-coordinator]].
