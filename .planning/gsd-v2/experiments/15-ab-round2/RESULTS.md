# Exp 15 results

## Stage 2, 2026-11-03: NO GO, stage 3 not started

90 runs, all `done`, $14.15; weekly reading 0.02. Rows `~/ab-eval/results/runs-round2-stage2.jsonl`, matches `results/matches.jsonl`. Report: `round2_report.py --log runs-round2-stage2.jsonl --role <role> --model <model>`.

| gate | result | evidence |
|---|---|---|
| V1 known answers | pass | `calib.json` ok on TW5-8, R4-13 |
| V2 A/A | pass, wide | reviewer recall +0.08 [0, +0.25] over 4 tasks; test-writer kills per 100 lines +0.26 [-0.20, +1.00] over 4 tasks. TW1 added lines A 192/202/215, A2 124/100/98 on the same text |
| V3 sabotage | FAIL, 2 of 4, gate 3 of 4 | reviewer caught: R2 and R4 recall 0.75 vs 1.00. Test-writer not: S killed all mutants on TW1 and TW5, with fewer lines, so it scored better than control |
| V4 Sonnet above Haiku | FAIL | R4-R11, 2 runs each: Sonnet 0.81, Haiku 0.84; $0.20 vs $0.07 a run. 5 of 8 tasks at recall 1.00 on both, leaving 5 with R1 and R2 against a floor of 6 |
| V5 judge | selftests pass; pairs not run | no go made them moot |
| V6 hand read | FAIL on one metric | `findings` reads 0 for arm A: `round2_report.py` counts `"severity"` JSON, arm A writes prose. R12-A-r1 states one major and four minor. Kills, added lines and recall agreed where read: TW5-A-r1 6/6 at 118 lines; R7-A-r1 misses K1; R7-A-r101 finds it |

## Why

- Test-writer ceiling: briefs enumerate the behaviours, so the mutants are named in all but the patch. A, A2, S kill 100% on TW1, TW5, TW7.
- Test-writer floor: TW2 0 of 8 pass on green, the old `[RV3-mines-2]` test conflict from exp 14.
- S was only partly obeyed: every S run still ran the tests, against its text.
- Reviewer ceiling: small diffs and a brief that names the risk. Only R1, R7, R9 and R2 under S leave headroom.
- Cost noise: same text on TW7 costs $0.04 to $0.59, following peak context 95k to 266k across the 100k price line.

## Budget

Reading moved 0.01 to 0.02 over $13.00 of runs, so 1% is about $13 here (chat and subagent use included), not the $18 assumed. 3% left is about $39; stage 3 as planned costs $59.
