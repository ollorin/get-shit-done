# 11 X0 and X1: pre-registration (committed before the first scored E run)

Source of truth for thresholds is `DESIGN.md` ("X0 calibration", "Order and gates", "Volume metric"). This file only fixes the operational definitions the design left open. Computed by `scripts/ab-eval/ab_x1.py` (committed with this file); nothing there reads a result to pick a threshold.

## Arms and runs

- A = installed `gsd-test-writer` (sha256 `6f71e2a3...` = `~/.claude/agents/gsd-test-writer.md`, same as the wave-2 control). E = `agents/v2/gsd2-test-writer.e.md`, variant `E` built with `variant-from-drafts --variant E --suffix .e`. Role-direct: Haiku dispatcher, one Agent call, brief `prompts/brief-test-writer.md`.
- Tasks TW1-TW4. TW1, TW2 as in wave 2. Snapshots were rebuilt on 2026-11-01 (the old ones were pruned), so wave-2 A rows are not used for gates, only for baseline volume.
- Reps: **3 per arm per task** (design says 5). Reason: the 90-minute time box. Gates are unchanged. A runs happen before the E runs and double as the X0 A-vs-A source; the gates are ratios to A, so seeing A first moves no threshold.
- No pilot run of E. The first E run is scored. The draft is not edited after it.
- Judges: Opus (`opus`) in both orders on every pair, and `claude-fable-5-1` in both orders on every pair, if quota allows. Both verdicts are reported; a disagreement is recorded, not resolved. Decision uses Opus. Fable is a confidence check only.

## Tasks added in X0

| task | base | bloated block in scope | new behaviours (registry `behaviours`) | reference solution | net LOC of reference | seeded mutants |
|---|---|---|---|---|---|---|
| TW3 | `cbe980ebb^` (4063077f5) | six `PATCH ... returns 405` tests of `operator-methods.test.ts` (1,532 lines, 26 literal duplicates in the HEAD version) | 2: 409 `PAYMENT_METHOD_TYPE_IMMUTABLE` mapping, unchanged-type control | `examples/artifacts/TW3/ref`: block merged to a table, 2 new tests | -27 (cases -3) | 4 |
| TW4 | `fea0a00f4` (HEAD, 4,314-line `crash-multiplayer-handlers.test.ts`, 12 duplicate tests in 6 groups, above the design's 10) | three `handleGetRoundHistory` limit tests | 2: fractional limit floored, non-finite limit falls back to 20 | `examples/artifacts/TW4/ref` (production change is synthetic and lives in the ref overlay; base lacks it) | -22 (cases -2) | 4 |

Registry `behaviours`: TW1 3, TW2 6, TW3 2, TW4 2 (counted from the brief). TW4's behaviour is authored for the eval because the one real candidate (`de6c89c86`) changes a signature, so its RED fails by type error and not by assertion. Calibration (no LLM, `ab_setup.py calibrate`): reference fails at base by assertion, passes on GREEN x3, kills 4 of 4 mutants for both.

## Metrics (`ab_volume.py`, from `grade/diff.patch` on test files)

`cases_added/removed` (regex `Deno.test(`, `it(`, `test(`, `t.step(` at line start), `loc_added/removed` (non-blank lines; hunks that only re-indent or re-wrap are excluded), `net_loc`, `net_cases`, `loc_per_behaviour = loc_added / behaviours`, `cases_per_behaviour`, `mutants_killed`, `mutants_survived` (a run whose tests fail on the GREEN tree never reaches the mutation step; all seeded mutants then count as survived, both arms; clarification committed before the first E run finished), `kills_per_added_case = killed / max(cases_added, 1)`. Case counts miss wrappers and count a table loop as one case: merging into a table lowers `net_cases` by design.

## Gates (X1, all must pass; stat = sum over tasks of per-task medians unless stated)

| Gate | Operational definition |
|---|---|
| Acceptance | per task, accepted rate of E at least A, no task lower (`ab_role_grade.grade_mutants` acceptance) |
| Mutants survived | sum of medians E <= A |
| Volume | `net_loc`: E <= 0.8 x A when A > 0, else E <= A; and `net_cases`: E <= A |
| Bloated start | TW3 and TW4 each: median `net_loc` of E <= 0 and the kill bar met (all 4 mutants killed) in more than half of E reps |
| Kills per added case | sum of medians E >= A |
| Judge `test_quality` | per pair, the arm both orders prefer on `test_quality` wins, else tie. delta = (E wins - A wins) / pairs. Pass when delta >= -margin, margin = 0.5 x (fraction of X0 A-vs-A pairs with a decisive `test_quality` verdict), per judge |
| Honesty losses | judgment rows (both orders) where the honesty dimension goes to the other arm: E losses <= A losses + 1 |
| Cost | `result_cost_usd` (dispatcher + agent), E <= 1.0 x A |
| Share above 100k | calls of the subagent transcript with context (input + cache read + cache creation) above 100,000 / all calls, E <= A |

Also reported, not gated: first-turn tokens (subagent), hidden-test info (n/a for TW), judge overall verdict, per-pair table, the two judges' disagreement.

Decision rule: any FAIL rejects E (no second round, DESIGN). Rejected is a valid result.

## X0 noise

A-vs-A pairs from the A reps (3 per task, so 12 pairs available; the first 10 by task order TW1..TW4, rep pairs (1,2), (1,3), (2,3)) are packed with `ab_judge.py pack --same-arm` (arms labelled A1/A2) and judged in both orders by the same judges. Noise level = decisive rate of `test_quality` and of the overall verdict.

## Quota, time, disk

Start no batch at seven-day utilisation >= 0.81 (`drive.sh` checks `results/quota.json` before every task batch). Stop at 7 GiB free on `/System/Volumes/Data`. Keep `~/ab-eval` below 3 GiB logical.

## Not run

X2, X3, X4. The X0 probes (`maxTurns` partial output, frontmatter hooks under `disableAllHooks`, `bashOutputMaxChars` reaching subagents, `Test-Author` trailer vs the commit hook) and the executor-side harness items (continuation loop, ordered dispatcher, `--settings` arm) belong to X2-X4 and were not built.
