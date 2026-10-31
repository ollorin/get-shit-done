# GSD v2 decisions

| Date | Decision | Why | Evidence |
|---|---|---|---|
| 2026-10-31 | v0.1.34 keeps running; overhaul runs in parallel | CEO | — |
| 2026-10-31 | Proof policy (mutation, review rounds) may be relaxed experimentally | CEO; review + rulings ≈ 26% of cost | `research/01-SESSION-ANALYSIS.md` finding 9-10 |
| 2026-10-31 | UI/UX tests stay LLM-driven; no compiled deterministic scripts | CEO: scripts brittle, ID upkeep, UX needs an LLM | — |
| 2026-10-31 | gsd-dsh port fixed later; every GSD change documented in `docs/v2/CHANGES.md` | CEO | — |
| 2026-10-31 | Overhaul is run from this hub, not through the GSD phase machinery being redesigned | avoids paying the overhead under change | `research/01-SESSION-ANALYSIS.md` finding 5 |
