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
