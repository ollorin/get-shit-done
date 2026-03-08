---
name: gsd:discover
description: Product discovery workflow. Drop a rough idea (1 page) — runs 6-dimension investigation in 2 rounds, synthesizes enriched PRD, discusses with you, hands off to /gsd:new-milestone.
---

Load and execute `@~/.claude/get-shit-done/workflows/discover.md`.

Input: The user provides either:
- A file path: `/gsd:discover @path/to/idea.md`
- Inline text: `/gsd:discover [paste description here]`

Extract the idea content from whichever format is provided.
Pass it as `idea` to the discover workflow.
