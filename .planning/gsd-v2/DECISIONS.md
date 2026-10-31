# GSD v2 decisions

| Date | Decision | Why | Evidence |
|---|---|---|---|
| 2026-10-31 | v0.1.34 keeps running; overhaul runs in parallel | CEO | — |
| 2026-10-31 | Proof policy (mutation, review rounds) may be relaxed experimentally | CEO; review + rulings ≈ 26% of cost | `research/01-SESSION-ANALYSIS.md` finding 9-10 |
| 2026-10-31 | UI/UX tests stay LLM-driven; no compiled deterministic scripts | CEO: scripts brittle, ID upkeep, UX needs an LLM | — |
| 2026-10-31 | gsd-dsh port fixed later; every GSD change documented in `docs/v2/CHANGES.md` | CEO | — |
| 2026-10-31 | Overhaul is run from this hub, not through the GSD phase machinery being redesigned | avoids paying the overhead under change | `research/01-SESSION-ANALYSIS.md` finding 5 |
| 2026-10-31 | Instruction cuts: yes, carefully — each cut A/B-tested on the same tasks with an independent blind judge (Opus; Fable optional) before rollout | CEO; quality must not drop | `research/05-GSD-V2-DESIGN.md` D4 |
| 2026-10-31 | LOW findings are NOT batched to phase end (D6 LOW-backlog rejected). Instead cap review rounds on non-T0 work (not money/auth/RNG/KYC) | CEO | 05 D6, Q1 |
| 2026-10-31 | Mutation proof: the problem is wall time; propose and test faster schemes | CEO; 05-M8 measured 3.1% of leaf hours — re-measure end-to-end incl. live re-proof plans | 05-M8 |
| 2026-10-31 | CLAUDE.md/rules/MEMORY may change before the v0.1.34 boundary (coordinate with the peer session) | CEO; overrides 05 Q3 | 05 Q3 |
| 2026-10-31 | Remove the plan-ahead coordinator | CEO | 05 Q4 |
| 2026-10-31 | Plan is Claude Max/Ultra (largest) since ~2026-10-27 — explains wk3 spend without a limit hit; governor must use the real meter | CEO | 05-M6, P8 |
| 2026-10-31 | Phase cap ≤15 plans adopted as default (CEO did not object) | 01-F11 | 05 Q5 |
