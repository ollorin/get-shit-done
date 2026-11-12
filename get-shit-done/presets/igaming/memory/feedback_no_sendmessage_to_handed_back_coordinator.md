---
name: feedback-no-sendmessage-to-handed-back-coordinator
description: SendMessage to a finished/handed-back coordinator RESUMES it — it then acts in parallel with its replacement (duplicate executors). Stop it instead.
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-10-03T17:46:57.371Z
---

Sending a message to a coordinator after it returns (or while it is winding down) wakes it up. It then keeps working alongside the fresh replacement coordinator. On 2026-09-26 in Phase 384 this produced two 384-08 executors writing apps/e2e-charlotte/ at once, and the woken one dispatched general-purpose implementers.

**Why:** a returned agent is resumable. A message counts as a new turn, not a note that gets filed away.

**It also revives with no message at all.** If it hands back while its own child is still running, that child's completion wakes it. On 2026-10-03 in Phase 392 the old coordinator woke when its 392-07 executor finished and dispatched a 392-08 executor in the same minute as the replacement coordinator did.

**How to apply:** once a coordinator hands back, TaskStop it and put every instruction in the new coordinator's prompt. Message only the agent that currently owns the work. Before spawning a replacement, list the running background agents and stop any leftover children the old one spawned. Related: [[bug-gsd-false-gate-pass-under-resume]], [[feedback-dont-overspawn-subagents]].
