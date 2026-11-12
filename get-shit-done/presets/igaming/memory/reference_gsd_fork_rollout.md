---
name: gsd-fork-rollout-mechanism
description: "How to roll out GSD framework changes — fork source + local installer (npm run install:gsd), NOT /gsd:update"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66bd0822-38d0-4737-a4dd-fbc643115868
---

GSD framework changes (lifecycle gates in `workflows/`/`agents/`, `gsd-tools.js`, hooks, templates) are authored in the fork **SOURCE** at `~/get-shit-done` (git `origin` = <private-repo>; `upstream` = glittercowboy/get-shit-done — **NEVER push to upstream**).

**Roll out to the installed copy** `~/.claude/get-shit-done` by running the **LOCAL installer from `~/get-shit-done`**: `npm run install:gsd` (→ `scripts/install-orchestrator.js`; `bin/install.js` also exists).

**Do NOT use `/gsd:update` to roll out** — per owner (2026-07-16) it may pull from the remote **ORIGINAL/upstream** repo rather than the fork, overwriting the fork's changes. This corrects the v0.1.24 PRD's constraint C1, which wrongly conflated "the installer" with "the `/gsd:update` flow."

Binds v0.1.24 Wave P (Phase 284) — where the GSD lifecycle gates (FPGATE/SECGATE/DFGATE, planner/plan-checker/verifier mods) are authored — and every future GSD-fork change. Rollout sequence: author in `~/get-shit-done` → commit + push to `origin` (fork) → `npm run install:gsd`. See [[feedback_v019_postmortem]].
