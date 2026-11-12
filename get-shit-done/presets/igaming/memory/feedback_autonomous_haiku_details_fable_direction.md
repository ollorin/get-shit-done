---
name: feedback_autonomous_haiku_details_fable_direction
description: "During autonomous roadmap execution, resolve questions with Haiku (gather details) → Opus (direction; replaced Fable 2026-09-23); only escalate genuinely strategic/irreversible calls to the owner"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 57b0729a-6d9b-434e-9d90-dbd122a25489
  modified: 2026-09-23T07:17:00.423Z
---

When driving roadmap execution autonomously (e.g. `gsd:execute-roadmap` through the end of a
milestone), the owner's standing directive is: **do not stall on the owner for routine questions.**
Instead — collect the concrete details with a **Haiku** subagent (read-only fact-gathering: versions,
file paths, config state, measured facts), then put the decision to **Opus** for the direction /
recommendation, and execute its "DO THIS". (Originally Fable; the owner replaced Fable with Opus
project-wide on 2026-09-23.)

**Why:** the owner manages AI-only development and wants momentum without being pestered on every
tactical/toolchain call, but still wants decisions grounded in real data + a strong advisory opinion
rather than Claude guessing. This worked cleanly on the Phase-287 ESLint 8→9 decision (Haiku gathered
version/peer-dep facts → the advisor recommended whole-workspace ESLint 9 + native suppressions ratchet).

**How to apply:** For technical/tactical decisions during autonomous execution, route through
Haiku-details → Opus-direction and proceed on the verdict (relay it to the owner, but don't wait for
approval). STILL escalate to the owner directly for genuinely strategic / irreversible / market-level
calls — e.g. the Africa-first-vs-US/EU market pivot tension flagged for Phase 289 (see
[[platform_market_generic_mandate]]). See [[feedback_use_fable_for_game_ui]] for the model-tiering
rule this composes with.
