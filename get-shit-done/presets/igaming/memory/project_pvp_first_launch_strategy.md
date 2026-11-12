---
name: project_pvp_first_launch_strategy
description: "Owner's launch sequencing rationale: PVP Arena first, not all 99 PRDs, to generate revenue that funds the rest"
metadata:
  type: project
  originSessionId: 8635dd
  modified: 2026-09-11T21:00:31.542Z
---

Explained 2026-09-11: the ~99-PRD backlog (`.planning/IMPLEMENTATION-SEQUENCE.md`) is the full
platform roadmap — own games (slots, crash already playable in MVP form per shipped work;
`slots-production-rewrite.md` is the pending hardening pass), RG limits, and the "killer features"
meant to beat competitors. The owner's decision: do not build all 99 before launching. Launch the
narrower PVP Arena product first (v0.1.29-v0.1.32 backend + the v1 full-stack critical path —
player web/mobile, operator console — [[reference: IMPLEMENTATION-SEQUENCE.md "PVP Arena v1"
section]]), get it live, generate revenue, then use that revenue to fund implementing the rest of
the PRD backlog and further building out slots/crash.

**How to apply:** when scoping any future phase/PRD/milestone work, default to "does this belong in
the PVP-arena-first launch path, or is it backlog for post-launch, revenue-funded work" — do not
silently expand scope toward full-platform completeness before the PVP arena itself can launch. This
is the same discipline as [[platform_market_generic_mandate]]'s config-dimension principle, applied
to sequencing rather than architecture: ship the smallest real product, not the whole roadmap, first.
