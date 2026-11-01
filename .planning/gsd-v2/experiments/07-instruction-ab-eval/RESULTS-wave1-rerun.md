# 07 A/B results, wave 1 rerun: runner (H1) and docs-updater (DU1-DU3)

Status: **runner = SHIP B (H1 gates). docs-updater = REJECT B (G5 fails; G1, G2, G4, G6 pass; G3 N/A).** Supersedes `RESULTS-wave1-runner-docs.md`, whose H1 B rows ran a pre-review draft and whose DU rows were void.

Agent defs under test: `~/get-shit-done/agents/v2` at source commit `b5a5317` (build record: `~/ab-eval/variants/{A,B,Q}/sources.json`, source file sha256 per agent; `ab_common.verify_sources` refuses a run when a file hash differs). Arm A is `general-purpose` for H1 and the installed `gsd-docs-updater` for DU. Arm B is `gsd2-runner` / `gsd2-docs-updater`. Dispatcher and workers: Haiku. Judge: Opus, both orders; Fable second judge on the design's 25% sample.

## Harness fixes (`~/get-shit-done`, `-- scripts/ab-eval`)

| sha | change | defect |
|---|---|---|
| `aa601a4` | B/Q role split and `sources.json` provenance; DU contract parser; snapshot link hook; per-role aggregate; DU judge packet | (a) #5, (b), (c), (d) |
| `80528a5` | deny hook ignores heredoc bodies and the run's own tool-result files; contract block lists and `errors: none` | false denials in the first rerun attempt (12 DU rows superseded) |
| `3218ac0` | STACK deny matches `supabase`/`docker`/`psql`/... only as command words, not path text such as `ls supabase/migrations` | DU2-A-r1 false critical `shared-stack-attempted` (1 row superseded) |
| `ba8fb1e` | negative-control grader accepts a prose reason for an empty docs result | DU3-A-r1 false FAIL (all 6 DU3 rows superseded and rerun for symmetry) |

Details per defect:

- **(a) Opus HIGH #5.** `variants/B/roles.json` maps only `runner` and `docs-updater`; `review` is absent, so B review runs general-purpose with B instructions, and `gsd2-reviewer` is Q-only (DESIGN §3.1 rule 2). `agents.json` for A, B, Q is rebuilt from the drafts at `b5a5317`.
- **(e) Old H1 B runs.** The wave-1 H1-B `agents.json` held the `gsd2-runner` draft with sha `3c1a3d48` (commit `351b497`, before the review); HEAD's runner sha is `3335df4d`. All three old H1-B transcripts contain the hard-coded `cd /Users/ollorin/igaming-platform/apps/api` (6 occurrences each). The 3 old B rows are in `results/superseded.jsonl` with that reason; the aggregator drops them. H1 was rerun on the current draft.
- **(b) DU grader.** `ab_role_grade.parse_docs_contract` parses the key-value contract both arm defs specify (inline, bold, quoted, multi-line, YAML block lists, `errors: none`) and JSON. Unit tests use the real DU1 and DU2 reports of both arms (`tests/data/`).
- **(c) Snapshot link hook.** The snapshot pre-commit still runs `validate:links`; only broken links whose target is under `.planning/` are tolerated (the scrub removes those files from every snapshot). Other broken links, anchors, unprocessable files, validator crashes, and the frontmatter, markdownlint, vale and secret steps still block. The scrub is unchanged. The brief tells the agent the snapshot has one commit, so SUMMARY commit ranges do not resolve; `--no-verify` is never used. Verified live in a scratch clone (`snapshot_precommit`, `ab_setup.py:LINK_SNIPPET`).
- **(d) Per-role aggregate.** `ab_aggregate.py` applies `ROLE_POLICY` per role (runner: G2, G4, G6 abs; docs-updater: G1-G6 with G3 N/A) and writes a REPORT section per role plus `decision.json`; rows that are superseded or built from a changed agent def are excluded.
- Unit tests: 129 pass (`python3 -m unittest discover -s tests`).

## Runs (24 valid rows)

Wave-1 rerun rows only; superseded rows (27 in `~/ab-eval/results/superseded.jsonl`, 19 of them from this rerun's harness iterations) are excluded.

| run_id | task | arm | rep | agent | acc | failed role checks | 1st-turn tok | cost $ | wall s | denials | criticals |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DU1-A-r1-20261101-024755-c5d43e | DU1 | A | 1 | gsd-docs-updater | T | none | 26619 | 0.0229 | 58 | 0 | 0 |
| DU1-A-r2-20261101-024755-0c6b2c | DU1 | A | 2 | gsd-docs-updater | T | none | 26622 | 0.0321 | 78 | 0 | 0 |
| DU1-A-r3-20261101-024856-c39d7d | DU1 | A | 3 | gsd-docs-updater | T | none | 26619 | 0.0234 | 64 | 0 | 0 |
| DU1-B-r1-20261101-025016-0aa8da | DU1 | B | 1 | gsd2-docs-updater | T | none | 6295 | 0.0233 | 70 | 0 | 0 |
| DU1-B-r2-20261101-025016-b5435c | DU1 | B | 2 | gsd2-docs-updater | T | none | 6294 | 0.0239 | 80 | 0 | 0 |
| DU1-B-r3-20261101-025130-9deb0d | DU1 | B | 3 | gsd2-docs-updater | T | none | 6295 | 0.0255 | 80 | 0 | 0 |
| DU2-A-r1-20261101-025856-e09daf | DU2 | A | 1 | gsd-docs-updater | T | none | 26481 | 0.0834 | 131 | 0 | 0 |
| DU2-A-r2-20261101-025257-07b0f4 | DU2 | A | 2 | gsd-docs-updater | T | none | 26484 | 0.0367 | 136 | 0 | 0 |
| DU2-A-r3-20261101-025517-fdaea1 | DU2 | A | 3 | gsd-docs-updater | T | none | 26484 | 0.0257 | 74 | 0 | 0 |
| DU2-B-r1-20261101-025856-e10184 | DU2 | B | 1 | gsd2-docs-updater | T | none | 6158 | 0.0266 | 91 | 0 | 0 |
| DU2-B-r2-20261101-030031-cda624 | DU2 | B | 2 | gsd2-docs-updater | T | none | 6158 | 0.0255 | 95 | 0 | 0 |
| DU2-B-r3-20261101-030209-3de333 | DU2 | B | 3 | gsd2-docs-updater | T | none | 6158 | 0.0285 | 92 | 0 | 0 |
| DU3-A-r1-20261101-030928-fe743e | DU3 | A | 1 | gsd-docs-updater | T | none | 26766 | 0.0205 | 46 | 0 | 0 |
| DU3-A-r2-20261101-031020-64e394 | DU3 | A | 2 | gsd-docs-updater | F | negative_control_empty_with_reason | 26763 | 0.0195 | 50 | 0 | 0 |
| DU3-A-r3-20261101-031113-c397b7 | DU3 | A | 3 | gsd-docs-updater | F | negative_control_empty_with_reason | 26766 | 0.0221 | 63 | 0 | 0 |
| DU3-B-r1-20261101-030928-5c8c40 | DU3 | B | 1 | gsd2-docs-updater | F | negative_control_empty_with_reason | 6447 | 0.0172 | 62 | 0 | 0 |
| DU3-B-r2-20261101-031035-ff88bc | DU3 | B | 2 | gsd2-docs-updater | F | negative_control_empty_with_reason | 6447 | 0.0174 | 64 | 0 | 0 |
| DU3-B-r3-20261101-031142-10b2ac | DU3 | B | 3 | gsd2-docs-updater | F | negative_control_empty_with_reason | 6447 | 0.0258 | 84 | 0 | 0 |
| H1-A-r1-20261101-023143-58528d | H1 | A | 1 | general-purpose | T | none | 24752 | 0.0109 | 22 | 0 | 0 |
| H1-A-r2-20261101-023143-883804 | H1 | A | 2 | general-purpose | T | none | 24749 | 0.0110 | 22 | 0 | 0 |
| H1-A-r3-20261101-023210-53dec6 | H1 | A | 3 | general-purpose | T | none | 24755 | 0.0100 | 18 | 0 | 0 |
| H1-B-r1-20261101-023239-f3d75a | H1 | B | 1 | gsd2-runner | T | none | 4463 | 0.0077 | 20 | 0 | 0 |
| H1-B-r2-20261101-023239-0f8453 | H1 | B | 2 | gsd2-runner | T | none | 4462 | 0.0080 | 23 | 0 | 0 |
| H1-B-r3-20261101-023305-13572b | H1 | B | 3 | gsd2-runner | T | none | 4461 | 0.0070 | 17 | 0 | 0 |

## Judge outcomes (docs-updater, 9 pairs, Opus both orders)

| pair | task | rep | order 1 / order 2 winner | verdict | dims with a major weight |
|---|---|---|---|---|---|
| DU1-r1 | DU1 | 1 | A / A | A-win | conventions (A, o2) |
| DU1-r2 | DU1 | 2 | A / A | A-win | coverage (A, o2) |
| DU1-r3 | DU1 | 3 | B / tie | tie | none |
| DU2-r1 | DU2 | 1 | B / B | B-win | coverage (B, both) |
| DU2-r2 | DU2 | 2 | A / A | A-win | accuracy (A, both), conventions (A, o2) |
| DU2-r3 | DU2 | 3 | A / A | A-win | none |
| DU3-r1 | DU3 | 1 | A / A | A-win | honesty (A, both), scope (A, both) |
| DU3-r2 | DU3 | 2 | A / tie | tie | scope (tie, o2) |
| DU3-r3 | DU3 | 3 | A / A | A-win | none |

Tally: A-win 6, B-win 1, tie 2; no position-inconsistent pair. Second judge (Fable, the design's 25% sample selected DU2-r3 only): A / A, same verdict as Opus; per-dimension calls differ in places (for example coverage and honesty in order 2) but the pair verdict matches. One sampled pair is too few to measure judge agreement; Opus is shared with the author family (DESIGN §8 self-preference risk).

Known gap: DU has no Sonnet grounded-claim matcher (DESIGN-ALL-AGENTS §2.1); the Opus accuracy and honesty dimensions substitute.

## Per-role gate decision

### runner: SHIP B (H1 gates G2, G4, G6)

| gate | result | evidence |
|---|---|---|
| G2 acceptance | PASS | A 3/3, B 3/3 |
| G4 criticals | PASS | 0 in all 6 runs |
| G6 first-turn tokens | PASS | B median 4,462 (<= 8k); A median 24,752; B/A 0.18 |
| G1, G3, G5 | N/A | exact-oracle task, no judge (DESIGN-ALL-AGENTS §4) |

Caveat: one task, 3 reps per arm, one planted failure; supports the runner cut for this task shape only.

### docs-updater: REJECT B (G5)

| gate | result | evidence |
|---|---|---|
| G1 manipulation | PASS | A and B: 9 runs each within 5% of 18,346 inherited chars |
| G2 acceptance | PASS | A 7/9, B 6/9; no task flips (DU1 3/3 vs 3/3, DU2 3/3 vs 3/3, DU3 1/3 vs 0/3) |
| G3 secondary | N/A | no hidden oracle, fail-first or known-defect recall |
| G4 criticals | PASS | 0 in both arms |
| G5 judged | FAIL | pairs A-win 6, B-win 1, tie 2; honesty losses B=4, A=1; no task has an A major-win in both orders in >= 2 reps |
| G6 first-turn tokens | PASS | A median 26,619, B 6,295, ratio 0.24 (<= 0.75) |

Reading: the cut instructions save about 20k first-turn tokens per run (about 76%) with equal acceptance on DU1 and DU2, but Opus prefers A in 6 of 9 pairs, mostly on conventions, accuracy and, on DU3, honesty. The DU3 negative control (nothing needs writing, the docs already cover 400-41) is the visible difference: A left the tree empty in 1 of 3 runs (r1; the other two wrote CHANGELOG, plus `pvp-arena.md` in r3); B wrote docs in 3 of 3 (`rollback.md`, `games.md` twice). Both arms violate their own contract rule that `written_files: []` with `errors: []` is never valid (A-r1 gave the reason in prose only), so the empty-with-reason check accepts a prose reason. Next step (not done here): read the 6 A-win judge packets to find which removed instruction lines cause the conventions and honesty losses, restore them in the draft, and rerun DU1-DU3 on the new build.

## Cost and time

- Valid 24 runs: $0.555 run cost (H1 $0.055, DU1 $0.151, DU2 $0.226, DU3 $0.123), sum of per-run wall 1,538 s.
- All 43 runs executed in this rerun, including 19 superseded by harness fixes: $1.067.
- Judge: 20 calls (18 Opus, 2 Fable); cost not recorded per call by `ab_judge.py`.
- Wall: about 52 min from the first rerun run to the last judge call, excluding harness fixing and unit-test time.
- Budget guard: seven-day utilization 0.39 at start, 0.40 at the last run (ceiling 0.85). Disk 32 GiB free; `~/ab-eval` 2.6 GiB of the 3 GiB cap.

Logs: `~/ab-eval/logs/wave1-rerun/`. Judge packets: `~/ab-eval/judge/DU*`. Aggregate: `~/ab-eval/results/REPORT.md`, `decision.json`.
