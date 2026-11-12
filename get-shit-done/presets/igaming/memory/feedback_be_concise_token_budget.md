---
name: feedback-be-concise-token-budget
description: "User wants terse, token-conscious responses — short status updates, no padded explanations"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6463b0de-f617-448c-962c-a4ee06b54592
  modified: 2026-09-04T22:06:06.929Z
---

Keep responses short and token-conscious. Trim explanations to the essential fact, skip restating context already established, avoid long prose paragraphs for status updates.

**Why:** User explicitly corrected verbosity twice in one session (2026-09-04/05) — once telling me to shorten a specific CLAUDE.md doc line, then directly: "I asked you to be concise and think on token budget and try to be shorter and clear."

**How to apply:** Default to 1-3 sentences for status updates and confirmations. When writing docs/comments on the user's behalf, apply the same discipline (matches this repo's own CLAUDE.md "Token & Length Discipline" section). Save longer explanations for when the user asks a substantive question requiring detail — don't pad routine progress reports or tool-result summaries.

**Roadmap runs (2026-09-28, third correction):** "dont generate so many status tacking messages, manage tocken budget." During autonomous roadmap execution, never arm a per-commit Monitor — each event triggers a reply. Only watch for terminal signals (phase complete / lock release / failure), and report once per phase boundary or blocker.
