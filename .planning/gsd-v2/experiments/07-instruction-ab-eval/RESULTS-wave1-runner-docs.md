# 07 A/B results, wave 1: runner (H1) and docs-updater (DU1-DU3)

Status: **runner decided on the H1 gates. docs-updater inconclusive, blocked by two harness defects. DU2 and DU3 not run.** Run stopped on the first DU defect per the stop rule.

## Runs

Runner rep 1 is the 2026-11-01 smoke pair (not re-run). Reps 2-3 were run in this batch. Arm A is `general-purpose`, arm B is `gsd2-runner`. Judge: none (H1 has an exact oracle; DU judging blocked).

| run_id | task | arm | rep | agent | acc | role checks (counts / names / no_edits) | 1st-turn tok | cost $ | wall s | turns | denials |
|---|---|---|---|---|---|---|---|---|---|---|---|
| H1-A-r1-20261101-012210-15a922 | H1 | A | 1 (smoke) | general-purpose | T | T / T / T | 24752 | 0.0109 | 22.3 | 4 | 0 |
| H1-A-r2-20261101-021437-603ca8 | H1 | A | 2 | general-purpose | T | T / T / T | 24755 | 0.0110 | 21.9 | 4 | 0 |
| H1-A-r3-20261101-021541-d0dc00 | H1 | A | 3 | general-purpose | T | T / T / T | 24758 | 0.0100 | 20.6 | 4 | 0 |
| H1-B-r1-20261101-012246-6c8a00 | H1 | B | 1 (smoke) | gsd2-runner | T | T / T / T | 4309 | 0.0078 | 19.7 | 4 | 0 |
| H1-B-r2-20261101-021508-ccd2e6 | H1 | B | 2 | gsd2-runner | T | T / T / T | 4309 | 0.0079 | 22.0 | 5 | 0 |
| H1-B-r3-20261101-021610-d8e650 | H1 | B | 3 | gsd2-runner | T | T / T / T | 4307 | 0.0079 | 25.1 | 6 | 0 |
| DU1-A-r1-20261101-021647-1eaee8 | DU1 | A | 1 | gsd-docs-updater | F | contract_parses F, writes_only_docs T, no_claude_dir_writes T | 26530 | 0.0289 | 85.2 | 13 | 0 |
| DU1-B-r1-20261101-021819-85ffef | DU1 | B | 1 | gsd2-docs-updater | F | contract_parses F, writes_only_docs T, no_claude_dir_writes T | 6246 | 0.0272 | 82.4 | 19 | 0 |

Not run: DU1 reps 2-3, all DU2 and DU3 runs. Both DU1 runs stopped at a harness defect (below), so further DU spend would produce the same false FAIL.

Logs: `~/ab-eval/logs/wave1/` (H1-A-r2, H1-B-r2, H1-A-r3, H1-B-r3, DU1-A-r1, DU1-B-r1, aggregate.log). Run dirs: `~/ab-eval/runs/<RUN_ID>/`.

## Runner (H1): gate decision = SHIP B (on the H1 gates)

Design gates for H1 are G2, G4, G6' (`DESIGN-ALL-AGENTS.md` §4). G3 and G5 do not apply to an exact-oracle task.

| gate | result | evidence |
|---|---|---|
| G1 manipulation | PASS | `ab_aggregate.py` G1 line (global run set; not role-filtered) |
| G2 acceptance | PASS | A 3/3, B 3/3; no task flips |
| G4 criticals | PASS | criticals 0 in all 6 H1 runs |
| G6' first-turn tokens | PASS | B median 4,309 vs threshold 8k; A median 24,755 (B/A 0.17) |
| G3 secondary | vacuous | hidden and known recall n/a; fail_first n/a on both arms |
| G5 judged | not applicable | no judge for H1 |

Caveat: one task, one planted exact-oracle failure, 3 reps per arm. The result supports the runner cut only for this task shape.

## docs-updater (DU1-DU3): gate decision = INCONCLUSIVE (blocked, 0 valid runs)

Both DU1 runs failed acceptance for reasons that are not about instruction quality:

1. **Grader defect (contract parse).** `ab_role_grade.py:81` calls `last_json(report, "written_files")`, which requires a JSON object. Both agents wrote the contract as key-value text (`written_files: [...]`, `commit: none`, `errors: [...]`). Result: `contract_parses` F with "no JSON contract in report" on both arms. Logs: `~/ab-eval/runs/DU1-A-r1-20261101-021647-1eaee8/report.md` and `~/ab-eval/runs/DU1-B-r1-20261101-021819-85ffef/report.md`.
2. **Snapshot defect (pre-commit hook).** Both agents report that the commit was blocked by `validate:links` with "7 broken links" in `docs/api/endpoints/games.md:459,537`, `docs/development/ci-drift-proofing.md:127`, `docs/game-engine/games/pvp-arena.md:1757,1759`, `docs/migrations/kyc-aml-schema.md:324,340`. The link targets are `.planning/` files that the planning scrub removed from the snapshot. Result: `commit: none` on both arms. Arm B also reports "SUMMARY commit range 9359361d3..f107b6d43 does not resolve" because the snapshot has a single commit. Same report files as above.

Defect 1 fails every docs-updater run whose agent emits the contract as text, which is what both DU1 arms did. Defect 2 blocks the commit that the docs contract requires. DU2 and DU3 would hit the same grader check, so they were not run. I did not edit the runner, grader, or hooks, and I did not use `--no-verify`.

Rebuild note: the H1, DU1, DU2, DU3 and E6 `raw` trees and `pristine-*` directories were missing at the start of this batch. I rebuilt them with `ab_setup.py base`, `index`, `variant`, and `calibrate` (via `all`). Calibration passed after rebuild for H1, DU1, DU2, DU3. The rebuilt pristine commit hashes differ from the originals. The H1 rep-1 smoke runs used the earlier snapshot.

## Judging

No judged pairs. H1 has no judge in the design. The DU judge was not run because no DU pair is valid.

## Aggregator caveat

`ab_aggregate.py` does not filter by role. Its `accepted: False` in `results/REPORT.md` is the global verdict over E6 (2 runs), DU1 (2 runs) and H1 (6 runs), so it does not represent the runner decision. The runner decision above is computed from the H1 rows only. The docs-updater decision is blocked and cannot be read from the aggregate output.

## Cost and time

- Cost, 8 runs: $0.1115 (run cost only; no judge spend).
- Run wall, sum of per-run wall times: 299 s. Each H1 run was about 20-25 s. Each DU1 run was about 82-85 s.
- Setup, including snapshot rebuilds and calibration: about 10 minutes.
- Budget guard: weekly utilization 0.37 at start, 0.39 at end (ceiling 0.85). The guard never stopped a run.
- Disk: 39 GiB free at start, 36 GiB at end.

## Next steps

1. Fix `ab_role_grade.py` docs contract parsing so it accepts the key-value contract the agents emit, or change the brief to require JSON. Decide which, because it changes what the agents are asked to produce.
2. Exclude `.planning/` link targets from the snapshot `validate:links` check, or keep the planning files that docs link to (`scrub_planning` / `planning_keep`).
3. Re-run DU1 (reps 1-3, both arms), then DU2 and DU3, once both fixes are in.
4. Add a role filter to `ab_aggregate.py` so per-role decisions come from the role's rows only.
