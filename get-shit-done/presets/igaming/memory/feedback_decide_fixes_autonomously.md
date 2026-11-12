---
name: feedback-decide-fixes-autonomously
description: "The owner 2026-09-27 — main decides fix/scope questions itself (fold findings in, grant tools, accept fail-closed defaults); don't ask the owner whether to fix things"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-09-27T01:34:11.220Z
---

The owner, 2026-09-27: "take all decisions on my own, like the above questions — why I would not agree to make fixes." That was after I had asked whether to grant `charlotte:evaluate` and whether to fold the webhook XFF findings into 387.1.

**Why:** the owner always wants defects fixed in-milestone. Asking "should we fix X?" wastes their time and stalls the run.

**How to apply:** decide it myself, via an Opus ruling where the domain is high-stakes, and report it as done:
- fold findings into a phase;
- grant a tool an agent needs;
- accept fail-closed defaults;
- choose a fix pattern.

Still ask the owner only for:
- actions the harness permission system blocks (e.g. `docker rm`, which the owner must run via `!`);
- irreversible or outward-facing steps not already authorised;
- genuine business or legal policy (SLA values, market launch, legal opinions).

Related: [[feedback-autonomous-haiku-details-fable-direction]], [[feedback-no-unapproved-stack-or-history-commands]].
