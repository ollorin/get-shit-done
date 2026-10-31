# Experiment 05 - mutation wall-time (result)

Scope: phases 398-402 (Oct 14-31), 2,007 spawns (1,971 leaf + 36 coordinators), 353.8 leaf active h, $2,125 est leaf + 234 coordinator h / $631. MAIN-session time excluded. Scripts: `scripts/` (`mt_extract.py` per-call timelines -> `mt_analyze.py` attribution -> `mt_report.py`, `mt_cycle.py`; `mutate_run.py` trial). Est $ = index (+/-30%).

## Method
Per-call timeline for every spawn. Mutation window = cluster of strong mutation signals (mutant-ID edits, `.tmp` mutant logs, "mutant" in cmds, mutation-evidence files) that contains at least one HARD call (db-reset, test run, stack/psql, wait, prod/test edit), extended +/-120-300 s to adjacent test/reset calls. Whole-spawn modes: description says mutant/mutation, or plans 400-46/47/50/51 (evidence re-proof). Variants low/mid/high differ in cluster gap (120/300/900 s). Manual sampling of windows: ~80-90% precision (unverified beyond the sample). Headline = mid.

## 1. Share of the five phases
| variant | leaf mutation h | % of leaf h | est $ | % of leaf $ |
|---|---|---|---|---|
| low | 38.8 | 11.0% | 211 | 9.9% |
| **mid** | **60.9** | **17.2%** | **411** | **19.3%** |
| high | 73.5 | 20.8% | 506 | 23.8% |

Plus coordinator time allocated by concurrent-leaf share: 48.0 h (20%) / $114 (18%). **End to end, mid: 108.9 agent-h of 588 (18.5%), $525 of $2,756 (19.0%).** 05-M8's 3.1% / 1.2% was low by 6x or more (keyword-only; misses mutant runs, resets, waits inside executors, and re-proof plans).

By phase (mid, leaf): 398 2.9% h / 4.5% $; 399 16.9% / 14.1%; 400 17.9% / 21.3% ($307); 401 22.0% / 25.5%; 402 16.9% / 16.6%. By kind: executors 38.5 h ($253), gp-runner/implementers 16.3 h, review 3.1 h, rulings 1.7 h, plans 1.1 h. By mode: windows 35.1 h ($258); mutation-described spawns 17.2 h ($50); **evidence re-proof plans 8.7 h ($103)**.

## 2. Wall clock (minutes with >=1 leaf agent active, idle >30 min removed)
All: busy 245 h; any mutation active 66 h (27%); **mutation is the only active work 40 h (16%)**. 399: 26%/15%; 400: 26%/18%; 401: 37%/25%; 402: 32%/8%. Calendar spans: 398 11 h, 399 52 h, 400 310 h, 401 28 h, 402 10 h. The 40 h is the critical-path floor a speedup can remove; the rest overlaps other work.

## 3. Where the mutation time goes (mid, 60.9 h)
| part | h | % |
|---|---|---|
| model generation + harness (LLM turns between calls) | 26.9 | 44.1% |
| integration bucket runs (p50 43 s, p90 125 s, n=752) | 13.3 | 21.9% |
| wait/poll shell loops | 8.9 | 14.7% |
| supabase db reset (p50 35 s, n=333) | 3.5 | 5.8% |
| stack/psql/serve ops | 1.6 | 2.6% |
| search / other bash / git / gates | 3.6 | 6.0% |
| full-suite runs | 1.5 | 2.4% |
| live single-file runs (p50 6 s) | 1.0 | 1.6% |
| unit single-file runs (p50 2 s) | 0.9 | 1.4% |
| edits (mutant apply/restore, logs, evidence) | 0.2 | 0.3% |

**Dominant: LLM overhead (44%) plus whole-bucket runs and polling (37%). The unit test that actually kills a mutant is 1.4%.** Stack-occupying calls: 20.9 of 83.4 h (25%) of all scoped stack time is inside mutation windows. (Bucket runs inside windows include baseline/regression runs, not only per-mutant ones: unverified split.)

## 4. Per mutant
Spawns whose description gives a mutant count (n=35 only): spawn mutation-minutes / mutants: p25 0.9, **p50 2.3**, p75 3.1, p90 5.3. Unit (no db-reset) n=25: p50 1.1 min. SQL/live (about one reset per mutant) n=10: p50 2.9 min. Cycle mechanics (windows, all spawns): db-reset p50 35 s, gap between resets p50 98 s (p90 206 s); unit-file run p50 2 s, gap 11 s; live file run p50 6 s. 400-51 window log: 44 live cycles in ~1.5 h, ~3 min per cycle, windows 5-15.5 min per 6-10 cycles. Counts: ~560 mutation IDs in 398-402 SUMMARYs (398: 8, 399: 116, 400: 388, 401: 23, 402: 25).

## 5. Re-proof
400-46/47/50/51: 73 spawns, 9.8 active h, $114 (46: 25 spawns 4.0 h $42; 47: 27, 1.9 h, $31; 50: 5, 0.7 h, $16; 51: 16, 3.2 h, $25) plus the live cycles (56 + 44 = 100 cycles for 98 IDs). Cause traced in the plans: `.tmp` evidence logs purged by a scratch cleanup, so IDs without committed evidence had to be re-run (400-46 class table: 361 IDs, classes R reuse logs, U unit-in-worktree, L live). Not pure waste: 400-50 reported 2 survivors, so some re-proof found real gaps (H4 only partly confirmed).

## 6. Trial (offline, unit level, no live stack)
Target: `apps/api/functions/payments/services/payment-method-limits.ts` + its 4-test file, in throwaway worktree `.tmp/wt-gsd2-mut` at HEAD (removed afterwards; shared branch untouched; script asserts sha256 of the source restored after every mutant; worktree `git status` clean before removal). 10 hand-written mutants, each with a unique salt so deno's check cache is cold. Command shape `deno test <file>`, cwd `apps/api`.

| scheme | wall for 10 mutants | per mutant |
|---|---|---|
| Manual/LLM cycle (derived from transcripts, unit class) | ~11 min | **~66 s** (p50 1.1 min incl. test run 2 s) |
| S1 scripted in-place mutate-run-restore, whole file | 6.2-6.4 s (3 runs) | 0.63 s |
| S1 + run only the failing-first test (`--filter`) | 6.3-6.4 s | 0.63 s (no gain: startup + type-check dominate) |
| S1 copy-mode, 4 parallel workers (no restore needed) | 3.4-3.6 s | 0.35 s |
| (warm check cache, not realistic for new mutants) | 2.2-2.5 s | 0.22-0.25 s |

Result: **~100x vs the manual cycle** (66 s -> 0.63 s), ~190x with 4 workers (an 8-worker run and a 2-worker first run were noisy: 3.5 s / 10.5 s). Test-run time is a small part of the manual cycle, as section 3 predicted. Outcomes: 4 test-kills, 3 type-check kills (M4, M6, M7 fail `Type checking failed`, not a test: the script labels these `kill-typechk` and a mutation claim must not count them), 3 survivors. Survivors: M1 (`|| value === undefined`, equivalent mutant since `Number(undefined)` is NaN -> null), M2 (`isFinite` guard removed, so NaN leaks), M5 (`.eq('is_active', true)` removed, so the tests do not pin that filter; the mock chain ignores arguments, root cause unverified). Two real test gaps found in 1.6 s of LLM-free compute.

## 7. Schemes
Speedups are on the 60.9 h mid figure; only S1 and the unit rows are measured, the live-stack rows are expected (no live stack touched), unverified.

| # | scheme | expected effect | risk |
|---|---|---|---|
| S1 | `mutate_run.py`-style script: one LLM call writes `mutants.json` (id, old, new, target test), script applies/runs/restores all, prints a table; LLM reads one table. Classify kill-test / kill-typechk / survived; assert sha restored. | removes most of the 44% LLM residual and 6% search/bash: unit class 100x measured; overall mutation time -45 to -55% (60.9 -> ~30 h) | script bug leaves a mutant applied (mitigated: sha assert, run in worktree); needs guard-authoring-style canary (a known-killed and a known-survivor mutant) |
| S2 | Per mutant run only the failing-first test file, one bucket run at the end of the window | bucket 13.3 h -> ~4 h (file p50 6 s vs bucket p50 43 s): about -9 h | misses cross-file kills; keep one bucket per window |
| S3 | SQL guards: swap the function body via psql `CREATE OR REPLACE` inside one stack window, one db reset at the end, md5 probe per mutant; unit-level mutants for pure logic | db reset 3.5 h + part of wait/stack 8.9 h: about -4 to -8 h; per live cycle ~3 min -> ~15 s expected | covers function-body mutants only (schema/trigger/policy mutants still reset); dirty DB state if the end reset is skipped |
| S4 | Evidence committed with the fix as one JSONL line per mutant (id, source sha, cmd, exit, failing test names, kind), not `.tmp` | removes the re-proof class: 8.7 h / $103 (14% of mutation h, 25% of mutation $) | none for correctness; needs a gate that SUMMARY mutation IDs match JSONL ids |
| S5 | Sampling by risk tier: one mutant per guarded condition for non-money/auth code, full set for money/auth/KYC/RNG | cuts mutant count ~40-50% on non-high-stakes plans: -5 to -10 h | weaker proof; policy decision, needs an Opus ruling per CLAUDE.md |

Combined S4 + S1 + S2 + S3 (S5 optional): 60.9 h -> ~13-20 h (3-4.5x less), $411 -> ~$100-140. Wall-clock: mutation-only critical path 40 h -> ~10-13 h, total wall about -11 to -12% of the 245 busy h. The ceiling matters: even free mutation saves at most 16% of wall (40 h) plus partial overlap time (27% total).

## 8. Recommendation
1. S4 first (cheap, no risk, kills the 100-cycle re-proof class).
2. S1 as a shipped `scripts/gsd-mutate/` tool with canary corpus (per `.claude/rules/guard-authoring.md` style), used by Haiku executors; executors write mutants.json, not edit-run-restore by hand.
3. S2 as the default per-mutant test selection; S3 as a follow-up measured on one live stack window before it becomes policy.
4. S5 only with a CEO/Opus ruling.

## Caveats
Signal-window precision 80-90% (sampled); low/mid/high range is the honest uncertainty (11-21% of hours). Untagged spawns were assigned to phases by time window. The trial is one 70-line module with a 4-test file; live-stack timings are derived from transcripts and `400-51-evidence/window-log.txt`, not re-measured. Phase 404 worktree work overlaps 401/402 calendar time and was excluded where tagged 403-409.
