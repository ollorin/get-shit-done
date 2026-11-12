---
name: feedback-fix-all-findings-no-blind-defer
description: "Fix review findings of every severity in-phase; only Opus \"no business value\" rulings may be deferred — no severity-based ledgers"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 58cca91c-5014-4482-b959-beca6c420713
  modified: 2026-10-02T17:54:11.521Z
---

Every review/verifier/executor finding gets fixed, whatever its severity. Batch same-file findings into one fix agent; run disjoint file sets in parallel. Only an Opus ruling of "no business value" (cosmetic, unreachable, cost > benefit; never money/auth/KYC/RNG/player data) may stay deferred, with its reason recorded.

**Why:** the owner is not comfortable carrying known issues. v0.1.33's "only BLOCKER/HIGH blocks" rule produced ~237 deferred rows, and the agents' own severity ratings proved unreliable: the plaintext KYC webhook key and the empty-key sandbox auth bypass were both first logged as LOW.

**How to apply:** this is now in CLAUDE.md, the GSD coordinator and executor agents, and the milestone rule file. If a milestone rule ever caps review rounds, the cap limits re-review, not fixing. A finding that belongs to a later ROADMAP phase moves there by name, never to an unowned list. Related: [[feedback-zero-tolerance-tests]].
