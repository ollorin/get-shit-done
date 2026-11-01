# 11 X2: pre-registration (committed before any BC run)

Source of truth for thresholds: `DESIGN.md`, paragraph "X2, Bash cap". This file fixes the operational definitions. Computed by `scripts/ab-eval/ab_bashcap.py` (committed with it); no threshold below was chosen after seeing a BC result, and there is no BC result.

## Arms and runs

- A = existing arm A rows, reused, 12 rows, none superseded: E3 r1-r3 (`...062550-466b86`, `...064725-e70838`, `...071400-a49ef0`), E4 r1-r3, E6 r1-r3 (`...111257-eb3371`, `...111835-7cfcc8`, `...112314-76a8e5`), E7 r1-r3. They ran the frozen `gsd-executor` entry (sha256 `e2b2ec1a...`, `variants/A/agents.json`; the installed definition has since moved to `20f84401...`). `variants/A` is not rebuilt.
- BC = the same frozen entry, same briefs, `--settings` file = harness settings plus `"bashOutputMaxChars": 8000` (`ab_run.py --bash-cap 8000`, rows in `results/runs-bashcap.jsonl`). Tasks E3, E4, E6, E7, 3 reps each, dispatcher and executor on the cheapest tier, at most 2 runs in parallel.
- Snapshots of E3/E4/E6/E7 were pruned; they are rebuilt with `ab_setup.py all --task <T> --variant A`. Rebuilt snapshots get new commit hashes (exp 10 saw the same). Validity check before the first scored BC run counts: its `instructions` and `first_turn_tok` equal the A rows of the same task within 1%; if not, the A rows for that task are stale and A is re-run.
- Known confound: A rows ran 2026-11-01, BC would run later (provider-side drift is unmeasured). Reported, not corrected.

## Gates (all must pass; stat = sum over E3, E4, E6, E7 of per-task medians unless stated)

| Gate | Definition |
|---|---|
| Acceptance | per task, BC accepted rate >= A rate, no task lower (A: E3 0/3, E4 3/3, E6 3/3, E7 3/3; E3 cannot flip) |
| Cost | `result_cost_usd` is not used; priced from all transcript calls at list prices of the executor tier ($0.10 input, $0.125 cache write, $0.01 cache read, $0.50 output per MTok), x5 on every class for a call whose prompt exceeds 100k (exp 10 method without its compaction add-on: no arm here compacts). BC <= 0.95 x A. A = $2.169 |
| Calls above 100k | pooled share of executor (subagent) calls with prompt above 100k: BC strictly below A. A = 613 of 711 = 0.862 |
| Read-back | counted and reported, not a pass/fail: tool results saved to a file (`<persisted-output>`), later Read/Bash calls naming a saved file, characters read back. Read-back calls are in the transcripts, so cost and share already include them. A baseline: 20 saved, 30 read-backs (E3 19/28, E7 1/2) |
| Judge | Opus only, matched pairs (rep k BC vs rep k A), both orders, `ab_judge.py pack/judge/collapse`. Overall winner: (BC wins - A wins) / pairs >= -0.35, where 0.35 = 0.5 x the X0 Opus decisive rate of the overall verdict on A-vs-A pairs (7 of 10, `RESULTS-X0-X1.md`; no new noise pairs). Honesty rows lost by BC <= A + 1. A second opinion, if wanted, is a fresh Opus |

A pass still needs one verifier and one coordinator check, because the setting is global (DESIGN).

## Guards

Quota: fresh value from `rate_limit_event` first; no batch at seven-day utilisation >= 0.81 (`BASHCAP_START_CEILING` 0.8099), stop between runs at 0.82 (`BASHCAP_STOP_CEILING` 0.8199). Disk: stop under 7 GiB free; `~/ab-eval` under 3 GiB. Time box 2 hours. Any later grader change is disclosed in `RESULTS-X2.md`.
