---
name: project-next-milestone-code-review-first
description: "After v0.1.33, the next milestone is codebase-review-hardening (a solid base before any new feature), not the arena player-experience milestone"
metadata:
  node_type: memory
  type: project
  originSessionId: 58cca91c-5014-4482-b959-beca6c420713
  modified: 2026-10-03T09:58:05.051Z
---

The owner decided on 2026-10-03 that the milestone after v0.1.33 comes from `.planning/prds/pending/codebase-review-hardening.md`. The arena player-experience milestone and the other 20 Opus-hardened pending PRDs come after it. I had recommended doing arena first; the owner overruled.

**Why:** "we will need to have next code review, to have solid base for the all next features".

**How to apply:**
- When v0.1.33 is released, create the milestone from that PRD and run execute-roadmap.
- Do not run an Opus hardening pass on it first; the owner declined one. Plan it as written.
- Do not re-propose feature-first ordering.

Related: [[project-pvp-first-launch-strategy]], [[feedback-prd-hardening-means-improve]].
