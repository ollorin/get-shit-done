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
| 2026-11-01 | Agents: test each new version by A/B on enough examples; orchestrator may ship a replacement alone when confident, Fable allowed as second opinion; always with backups and git history | CEO | `experiments/07-instruction-ab-eval/` |
| 2026-11-01 | 1h cache for roles with visible savings; Charlotte scenario sessions back to 5m | CEO | `experiments/03-coordinator-cache-ttl/RESULT-BREAKEVEN.md` |
| 2026-11-01 | Always newest model via aliases; Haiku tasks must fit under 100k context | CEO; 85% of Haiku executor spawns exceed it, ~$215 vs ~$50 per 21 days | measured from transcripts |
| 2026-11-01 | Hooks must be enabled; broken ones fixed; flip at a joint 401+402 plan boundary | CEO; `disableAllHooks: true` in igaming `.claude/settings.local.json:76` | `experiments/09-hooks-audit/` |
| 2026-11-01 | `gsd-test-writer` is the specialist and should do the test work and curb test volume; supersedes inline-testing in executor candidate D | CEO; 1,401 test files, 749k LOC; 687 test files added vs 10 deleted in 60 days | `RULING-executor-d.md` R3 superseded |
| 2026-11-01 | Reviewer v2 not shipped until a larger A/B on real review tasks gives confidence | CEO | `RESULTS-wave3-reviewer.md` |
| 2026-11-01 | Full OrbStack restart approved at the nearest joint 401+402 plan boundary; memory limit unchanged | CEO; OrbStack Helper at 20 GiB after 10 h, about 2 GiB/h | `experiments/08-orbstack-memory/samples.tsv` |
| 2026-11-01 | RTK disabled globally | CEO; it alters command output (`experiments/09-hooks-audit/RULING.md`) | applied by `flip.sh --apply` |
