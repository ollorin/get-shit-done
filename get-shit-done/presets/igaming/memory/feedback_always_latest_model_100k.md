---
name: feedback-always-latest-model-100k
description: Always run the newest model via aliases; plans must keep Haiku tasks under the 100k-token price threshold
metadata:
  node_type: memory
  type: feedback
  originSessionId: 23b0ea8e-ad82-5178-915e-2742fc366b39
  modified: 2026-11-01T17:25:51.658Z
---

Use model aliases so agents always run the newest version; never pin an old ID (Charlotte's `run.ts` stayed on Haiku 4.5 for months). Plans must split work so each Haiku task fits under 100k context: Haiku 5.5 costs 5x more above 100k prompt tokens.

**Why:** the owner asked for this split explicitly for extra savings. Measured 2026-11-01: 85% of Haiku executor spawns still exceed 100k, ~$215 vs ~$50 per 21 days, with `autoCompactWindow` at 350k.
**How to apply:** check any spawn or script for pinned IDs; verify plan sizing against measured peak context, not intent. Related: [[project-gsd-v2-overhaul]].
