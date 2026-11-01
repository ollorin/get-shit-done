# 10 Haiku 100k: can compaction keep Haiku executors under the 100k price tier?

Status: gates declared 2026-11-01 18:5x CET, after the probes and the arm-W launch but before any W run finished or was graded
(`git log` for this file shows the declaration commit). Results sections follow below the gate block once written.

## Declared gates (fixed; no retune, no edit after the first scored run)

Arm W = arm A instructions unchanged, `--settings` adds `autoCompactEnabled:true` and
`modelSettings["claude-haiku-5-5"].autoCompactWindow = 130000` (probe: compaction fires at about window minus 33k, so about 97k).
One window value, no replacement. Tasks E4 (3 plan tasks, 80-90 calls), E7 (2 plan tasks), E6 (1 task), 3 reps each = 9 W runs.
Control = the existing arm A rows of E4, E6, E7 (3 each, not superseded). They ran with no compaction because the harness drops the
user settings and `~/.claude.json` has `autoCompactEnabled:false`; under the real 350000 window compaction would fire near 317k, and
the control peaks are 118k-265k, so these rows equal the production control for these three tasks.

| id | gate | pass condition |
|---|---|---|
| G1 | acceptance | W acceptance_pass count >= control on every task and pooled (control is 3/3 on E4, E6, E7, so W needs 9/9) |
| G2 | plan-state loss after compaction | 0 W runs with: executor ended before the plan was complete (acceptance false with fewer commits than the control minimum for the task, or a final message that stops for lack of permission or confirmation); a file written twice after a compact boundary; a constraint/commit/checkpoint step the control run did that the W run lacks |
| G3 | calls above 100k | pooled share of executor API calls with prompt tokens > 100k under 10% in W (control measured separately) |
| G4 | cost | sum over E4, E6, E7 of per-task median cost at list prices (Haiku 5.5 $0.10/$0.125/$0.01/$0.50 per MTok, x5 on every class for a call whose prompt exceeds 100k; compaction calls priced as extra usage at base price) is at least 25% lower than control |
| G5 | wall | sum of per-task median wall time <= 1.25 x control |
| G6 | judge | Opus judge on matched pairs (rep k of W vs rep k of A), both orders: W wins >= control wins - 1 over the judgments, and no judged "lost task / forgotten constraint" flag against W |

ADOPT only if G1-G6 all pass. Any failure is REJECT. A single failed gate is not retried with another window.

## Verdict: REJECT (window 130000 for Haiku). G1, G2, G6 fail; G3, G4, G5 pass.

Compaction does cut the price tier (80% of calls above 100k becomes under 1%, tier-priced cost -60%), but it aborts or truncates
executors: 2 of 3 E4 runs died with `Autocompact is thrashing`, and 1 of 3 E6 runs lost its closing docs/STATE/ROADMAP commit.
Tools and raw outputs: `tools/` (gates-output.txt, sim-output.txt, drivers-output.txt, scripts). Run rows:
`~/ab-eval/results/runs-haiku100k.jsonl` (not committed).

## Gate table (W = 9 runs, control = 9 existing arm A rows; numbers from `tools/gates-output.txt`)

| gate | control | W | result |
|---|---|---|---|
| G1 acceptance | 9/9 | 7/9 (E4 1/3, E6 3/3, E7 3/3) | FAIL |
| G2 plan-state loss | 0 | 3/9: E4 r1, r2 (agent killed by thrash error after 8 and 12 compactions, 1 commit each vs 3-5), E6 r2 (2 commits; no SUMMARY/STATE/ROADMAP commit after the 2nd boundary, control wrote it) | FAIL |
| G3 executor calls above 100k | 80.1% (417 calls) | 0.8% (3 of 366 calls) | PASS |
| G4 cost, sum of task medians, tier prices, compaction calls included at base price | $1.005 | $0.404 (-59.8%) | PASS |
| G5 wall, sum of task medians | 963.8 s | 953.5 s (0.99x) | PASS |
| G6 Opus judge, both orders, 9 pairs = 18 judgments | A 12 wins | W 6 wins (E4 2, E6 4, E7 0 of 6) | FAIL (needs W >= 11) |

Caveats that do not change the verdict: (1) the E4 and G5 figures are flattered by the two aborted E4 runs, which stopped early
(W E4 wall 578 s median vs 667 s); (2) the compaction call itself carries 96k-108k prompt tokens in executors (`preTokens` 100k-108k in E4),
so some compaction calls are above the line and G4 prices them too low (compaction extra is $0.37 of W's $1.20 total);
(3) the judge preferred W on E6 r1 and r2 even though r2 lacked the docs commit, so G2 is the stricter evidence; (4) n=3 per task,
one window value, no retune, as declared.

## Costs under both prices (sum of per-task medians over E4+E6+E7; per-call prices Haiku 5.5, x5 above 100k)

| | control tier | control flat | W tier | W flat |
|---|---|---|---|---|
| $ | 1.005 | 0.273 | 0.404 | 0.392 |

Under the tier prices W saves 60%; at flat prices (no 5x line) W costs 43% MORE than control, because compaction re-writes a 50-65k prefix
at $0.125/MTok and re-reads it. So the saving exists only because of the 5x line.
Production (21 days, `.tmp/gsd-v2/out/files.jsonl`, 349 Haiku gsd-executor spawns): $261 at tier prices, $57 if every call were
priced flat (`tools/sim-output.txt` first lines; the brief's $215/$50 are on a slightly different cut; same shape).
297 of 349 spawns exceed 100k and 80.3% of 21,605 calls are above it.

## Probe findings (throwaway `claude -p --model haiku`, scratch settings via `--settings`, `claude` 2.1.304)

1. Real settings are not loaded by the harness. `--setting-sources project,local` drops `~/.claude/settings.json`
   (`autoCompactEnabled:true`, `autoCompactWindow:350000`), and `~/.claude.json` has `autoCompactEnabled:false`. So arm A in the eval
   never compacts (all 21 A executor rows: compactions 0). The probes with `modelSettings` alone (p1, p2 env var) did not compact up to
   379k tokens; adding `"autoCompactEnabled":true` made `modelSettings["claude-haiku-5-5"].autoCompactWindow` work (p3-p8). The key
   `claude-haiku-5-5` is the model id in transcripts. Default Haiku 5.5 window is 1,000,000 (`modelUsage.contextWindow`).
2. Valid window range is 100000 to 1000000 (binary: `SP=1e5`, `CN=1e6`, "below_minimum" is clamped to 100k). A value of 95000 is
   not valid. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` outranks settings in the resolver (binary function `XS`); env route not probed live (unverified).
3. Compaction fires about 33k below the window: window 100000 -> `preTokens` 66.3k-70.4k (p4, 6 events); window 130000 -> 96.4k-98.5k in
   probes and 100k-108k in real executors. No call in W exceeded 101.0k prompt tokens (executor calls above 100k: 3 of 366).
4. Lower bound is not the 37k first turn. After a compaction the executor context is 49k-66k (E4 W r1: calls 69k, 48k, 63k, 49k...). With a
   window of 100000 (trigger about 67k) the main-thread probe thrashed after 3 compactions and died (p3: `Autocompact is thrashing: the
   context refilled to the limit within 3 turns ... 3 times in a row`). At 130000 the same abort hit real E4 executors twice: E4 tool results add
   14-20k tokens in one step (E4 W r1 calls: 63.5k, 77.4k, 97.9k, then 48.8k), so 97k trigger minus a 49k-66k floor leaves 1-3 turns. A usable window must leave more headroom than the biggest
   expected single tool result times about 3.
5. Cost of a compaction (p4, 6 events, `modelUsage` minus transcript sums): about 6.1k uncached input, 3.1k output, 61k cache read, 5-25 s,
   plus the next call re-writes about 33k of cache. About $0.003 for the summary call and $0.004 for the rewrite at flat prices. Model: same
   model, `modelUsage` lists only `claude-haiku-5-5`.
6. Subagents compact too (p6-p8 and W runs), and in all 3 synthetic subagent probes the reader stopped at the first or second compaction
   ("Reads are paused", "Your latest instruction was not to make further tool calls"). Mechanism traced in p8sub: Haiku's summary wrote
   "Later user message: do not call any tools ... If the user confirms the task should continue ... Do not proceed with any tool call
   until the user's current instruction permits it", i.e. it recorded the summariser prompt as a user instruction. Main thread
   probes (p4: 6 compactions, p5: 7) continued and kept the standing rule (`RULE-OK: PINEAPPLE-42`); p5's final answer admitted it could
   not confirm four files. The same truncation pattern appears in W E6 r2 (ends right after boundary 2, no docs commit).

## Eval tasks and long tasks (step 2)

E tasks already cross 100k: arm A peak context per run is 118k-345k; per executor call share above 100k is 40-98% (E6 37-81%, E7 40-95%,
E4 90-93%, E3 93-97%, E1-E2, E5 78-98%). E4 is a 3-plan-task chain (80-90 calls, peak 210-265k) and E7 two plan tasks. So no new chained task
was built: the existing registry already provides it, and the time box went to the window arm.
Gaps: E1-E3 and E5 were not used (E1-E3 accept 1 of 27 across arms per RULING-executor-d; E5 passes 1/3 in A). The control rows are
the existing A rows; their peaks are below the production trigger (317k), so they equal the production control for E4, E6, E7.
Setup changes needed to run this (committed): `ab_run.py --window N` (settings file `harness/settings-wNk.json`, rows to
`runs-haiku100k.jsonl`), `SOURCE_DRIFT_OK` in `ab_common.py` (installed `gsd-executor.md` moved to `cdb285a`, W uses the frozen
`variants/A/agents.json` entry, entry hash still enforced), `MIN_FREE_GIB` 10 -> 8, arm W rows judgeable in `ab_judge.py`.

## What drives the top 20 costliest Haiku executor spawns (`tools/drivers-output.txt`)

The 20 spawns are 23.7% of all executor cost. Calls per spawn: median 185 (all spawns median 48). Every one peaks at 288-323k, which is the
current 350000 window minus the compaction buffer: 17 of 20 already compacted once. The drivers, by tokens added to context
(cache-write tokens attributed to the tool that produced them): Bash output 76% (other 34%, tests/gates/mutation 18%, file-inspect
scripts 15%, search 10%), planning-doc reads 9%, code/test reads 6%, edits 6%. Medians: Bash results 190k chars, Read results 108k chars.
Not drivers: rule files (instructions about 41k chars = 10k tokens inside a 38.9k first turn; nested rules about 2k chars), the plan
(prompt 1,500 chars; plan files are read on demand). They are "Finish / Resume / fix review findings" spawns of 130-470 calls.
First turn plus growth: median growth per call is 1.3k tokens (mean 2.9k), so a fresh executor crosses 100k near call 35-40.

Is one-plan-task-per-spawn the better fix? On the same 349 spawns' call series (`tools/sim.py`, same cost model reproduces $263 vs the $261 actual):

| policy | cost vs now | calls above 100k |
|---|---|---|
| now | 1.00x | 81.5% |
| compaction at about 97k (this experiment's target) | 0.20x | 0% (model; real runs lost work) |
| compaction at about 150k | 0.49x | 50% |
| new executor every 15 calls | 0.22x | 9% |
| new executor every 25 calls | 0.32x | 23% |
| new executor every 35 calls | 0.43x | 37% (handoff overhead not modelled) |

A plan task is 25-80 calls (median spawn 48), so splitting by plan task gets to 0.4-0.6x and 40-50% above the line, not under 10%. It is safe
(a fresh context, not a summary), unlike compaction, but it is not sufficient alone. Combined levers worth a separate test:
cap Bash output (190k-char median in the top 20), split at about 25 calls, and keep results out of context. Unverified: handoff cost and
whether executors re-read the plan and lose state across a split; the eval harness can measure that with E4 (3 plan tasks) as 3 spawns.

## Recommended settings change

None for `~/.claude/settings.json`. Do not add `modelSettings["claude-haiku-5-5"].autoCompactWindow` at 130000 (or at 100000, which thrashes at once).
Keep `autoCompactWindow: 350000` and `autoCompactEnabled:true`. If a Haiku window is still wanted, the only untested candidate is a window of
about 200000 (trigger about 167k, headroom above the 49-66k floor is 100k+), which the model prices at about 0.5x with 50% of calls still above
the line; it needs its own declared experiment (no retune of this one). Separate defect for the hand-off: the executor dispatcher in W E4
reported "no tasks executed" although the executor had made a commit, so a thrash abort looks like a clean no-op to the coordinator.
