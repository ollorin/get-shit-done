# Exp 14: Ponytail-informed agent descriptions, A/B plan

Status: pilot done, verdicts in `RESULTS-PILOT.md`; the steps under "After the reset" are next, with the executor draft dropped. Source analysis: `SOURCE.md`. Budget set by the CEO on 2026-11-02: from 97% weekly use, 2% for this plan and the runs, the last 1% for routine work and the mutation run.

## Question

Do Ponytail's rules give less code and fewer empty review findings on our tasks, with no loss of correctness, mutation kills or known-defect recall?

## Arms

| arm | reviewer | test-writer | executor |
|---|---|---|---|
| control | Q2 (`gsd2-reviewer.r2.md`) at Haiku, re-run here | frozen A, rows already in `runs.jsonl` | frozen A, rows already in `runs.jsonl` |
| P | `gsd2-reviewer.p.md` | `gsd2-test-writer.p.md` | `gsd2-executor.p.md` |

P is the control text plus one section, so a difference points to that section. Test-writer and executor start from the frozen A text, which the control rows used and which still equals the installed text. Variant P exists only for these three roles; its debugger and coordinator entries are the installed ones and are not used.

## Model

Everything on Haiku. For executor and test-writer that is the production tier, so the result is direct. For the reviewer (Sonnet in production) it is a signal only: a gain on Haiku does not prove a gain on Sonnet, where there may be less to fix; a Haiku failure does not prove failure there either. The reviewer needs a Sonnet confirmation before shipping.

## Queue, cheapest first

Prices are means from `runs.jsonl`.

| step | tasks | runs | est. cost |
|---|---|---|---|
| 1 reviewer, both arms | R1, R2 x 3 | 12 | about $0.5 at most |
| 2 test-writer, P | TW4, TW3, TW1 x 3 | 9 | about $0.5 |
| 3 test-writer, P | TW2 x 2 | 2 | about $0.8 |
| 4 executor, P | E1 x 3 | 3 | about $1.7 |

Round 2, added when round 1 ended at 97% use: E6, E7 x 3, TW2 up to 6, R1 and R2 up to 6 per arm, E4 x 3. E1 fails hidden tests in both arms, so it cannot show acceptance; the round 2 tasks can.

The driver `run_pilot.sh` stops by itself at 99% weekly use. Calibration: $20.8 of runs moved use 60% to 79% while phases also ran, so 1% is at least $1.1; the true figure is unmeasured.

## Gates

A pilot cannot ship anything. It only decides whether a role gets a full A/B after the reset.

- Reviewer: known-defect recall not lower (`ab_match`), required items not lost, acceptance not lower. Wanted: fewer findings without a concrete case. No blind judge in the pilot, to save budget.
- Test-writer: acceptance and mutant kills not lower on any task, TW1-TW3 (T0) unchanged in behaviour, test lines lower on TW4.
- Executor: hidden tests and acceptance not lower, `fp` counters not worse (watch for dropped `Result`), added lines lower.
- Any regression on a T0 task stops that role.

Past failures (executor B, test-writer E) passed on cost and failed on acceptance, so acceptance is read first.

## After the reset

0. Add a log to the `pass_on_green` check and find the TW2 fault; re-check whether it affected the rejection of test-writer E. Run every control in the same period as its arm.
1. Full A/B with Opus blind judges, DESIGN §6 gates, at least 3 reps per task: test-writer P, then reviewer P after step 2.
2. Reviewer: Sonnet confirmation, as an extra arm of the larger reviewer A/B already planned.
3. Executor: only if a narrower draft appears (for example the frontend only). Needs 2-3 non-money tasks with an over-build trap.
4. Option: the vendor's 18 hidden-check tasks as a cheap pre-screen. They are not on our stack, so a coarse filter only, and fit is unverified.
5. Ship only per the usual route: backup, `docs/v2/CHANGES.md`, narrow installer.

## How to resume

Everything is restartable; the driver skips completed runs.

```bash
bash ~/get-shit-done/scripts/ab-eval/run_pilot.sh      # edit CEILING first if the budget changed
python3 ~/get-shit-done/scripts/ab-eval/pilot_report.py
```

Rows: `~/ab-eval/results/runs-ponytail.jsonl` (not committed), separate from `runs.jsonl`. Recall matches for reviewer rows: `ab_match.py run --run <id> --runs-log runs-ponytail.jsonl`.
