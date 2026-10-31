# GSD v2 — lean framework overhaul

Goal: GSD replaces a dev + QA team at lower token, time and quota cost. Runs in parallel with igaming-platform v0.1.34.

## Layout

| Path | Holds |
|---|---|
| `README.md` | this page: goal, stream status |
| `DECISIONS.md` | dated decisions: what, why, evidence link |
| `research/NN-*.md` | measurements and research (read-only after written) |
| `experiments/NN-name/` | one change under test: `HYPOTHESIS.md` (metric, baseline), `RESULT.md` (after numbers, keep/revert) |
| `../../docs/v2/CHANGES.md` | shipped changes: what changed, why, how to roll back |
| `../../docs/host-setup.md` | dev-host config (OrbStack, Supabase services, cleanup) |

Changes in other repos (Charlotte, Bladebro, igaming-platform CLAUDE.md/rules) are committed there and recorded in `docs/v2/CHANGES.md` with the commit link. Scratch scripts and raw extracts live in `igaming-platform/.tmp/gsd-v2/` (not committed); reusable ones get promoted to `scripts/`.

## Streams

| # | Stream | Status | Evidence |
|---|---|---|---|
| S1 | Measurement (time, tokens per role/step) | baseline done | `research/01-SESSION-ANALYSIS.md` |
| S2 | Host stability (memory, disk, OrbStack) | audit done | `research/02-MACHINE-AUDIT.md` |
| S3 | Lean GSD (instructions, dead flows, process overhead) | best-practices research done | `research/03-POLLING-CONSTRAINTS.md`, `research/04-BEST-PRACTICES.md` |
| S4 | UI/UX QA speed (Charlotte fix, Bladebro pilot) | screenshot fix proven on branch, not rolled out | `experiments/02-charlotte-screenshot/RESULT.md` |
