# GSD v2 — shipped changes

One line per change: what, why, evidence, rollback. Details live in `.planning/gsd-v2/`.

| Date | Change | Why / evidence | Rollback |
|---|---|---|---|
| 2026-10-31 | Charlotte launches `chrome-headless-shell` (charlotte `6defd8d`, deployed to `~/.claude-mcp-servers/charlotte`) | 95% of screenshots hung 180 s while the display slept; 0/20 → 20/20 at ~200 ms. `experiments/02-charlotte-screenshot/RESULT.md` | restore `backup/dist-b94eb19` or `CHARLOTTE_HEADLESS=new` |
| 2026-10-31 | `gsd-phase-coordinator` frontmatter `experimental.cacheTtl: 1h` | subagents default to a 5-min cache; coordinators re-wrote 98% of their cache while polling. `experiments/03-coordinator-cache-ttl/` | restore `experiments/03-coordinator-cache-ttl/backup/` |
| 2026-10-31 | `scripts/gsd-metrics/` KPI tool (`GSD_SINCE`/`GSD_UNTIL`, incremental) | before/after measurement for every experiment; reproduces 01 baseline 44/45 within 1%. `experiments/04-metrics/RESULT.md` | delete dir |
| 2026-10-31 | igaming `CLAUDE.md`: plan-ahead coordinator removed; done-checklist moved in from `pre-pr-quality-gates.md`, which is now `paths:`-scoped (igaming `4063077f5`) | CEO decision; rule loaded into every spawn (~8.6 KB ≈ 2k tokens) though only PR/preflight work needs it (05 table, 06-PROBES P1) | restore `experiments/06-claude-md-quick-cuts/backup/` or `git revert 4063077f5` |
| 2026-10-31 | igaming `scripts/gsd-mutate/` scripted mutate-run-restore runner (igaming `c45b3c91b`); 19 tests; typecheck kills not counted | mutation ≈19% of agent hours, 44% of it LLM turns between calls; prototype 0.63 s vs ~66 s per unit mutant. `experiments/05-mutation-speed/RESULT.md` | `git revert c45b3c91b` (new files only) |
| 2026-11-01 | igaming `.claude/rules/testing.md`: unit-level TS mutants run via `scripts/gsd-mutate/` with conditions of use (igaming `2e485b0f1`); tool hardened over 3 Sonnet rounds + Opus final APPROVED for T0 (`09e078ba1`, `af9633bc1`) | ~100x faster per unit mutant, same evidence. `experiments/05-mutation-speed/PILOT.md` | `git revert 2e485b0f1`; backup `experiments/06-claude-md-quick-cuts/backup/testing.md` |
