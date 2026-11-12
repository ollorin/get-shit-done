# Instruction A/B experiments: inventory (GSD fork)

Read-only; no tests or runs. Not read: `PREREG-X2.md`, `RULING-executor-d.md`, `VARIANT-B-*.md`, `PROBES.md`, `DESIGN-ALL-AGENTS.md`, `~/ab-eval/variants/*/sources.json`. Cites are `file:line` relative to `~/get-shit-done/.planning/gsd-v2/experiments/` unless shown. Short names: W1 = 07/RESULTS-wave1-rerun.md, W2 = 07/RESULTS-wave2-executor-family.md, W3 = 07/RESULTS-wave3-reviewer.md, DG = 07/DESIGN.md, DX = 07/DIAGNOSIS-executor.md, DU = 07/DOCS-UPDATER-DIAGNOSIS.md, RUN = 07/RUNNER.md, R10 = 10/RESULT.md, PX1 = 11/PREREG-X0-X1.md, X1 = 11/RESULTS-X0-X1.md, X2 = 11/RESULTS-X2.md, R13 = 13/RESULT.md, P14 = 14/PLAN.md, PL14 = 14/RESULTS-PILOT.md, P15 = 15/PLAN.md, R15 = 15/RESULTS.md, RD = `~/get-shit-done/scripts/ab-eval/README.md`. Sizes are `wc -c` of today's files; reports quote build-time sizes that may differ.

## 0. Verdicts

| exp | tested | verdict | cite |
|---|---|---|---|
| 07 W1 | runner H1 (B `gsd2-runner` v A `general-purpose`); docs DU1-3 (B v A `gsd-docs-updater`) | runner SHIP B (G2, G4, G6 only); docs REJECT B (G5) | W1:76-98 |
| 07 W2 | executor E1-7 (B, C); debugger D1-3 (B, C); test-writer TW1-2 (B, C) | all six arms REJECT (executor B/C; debugger B only G6 fails; test-writer B/C) | W2:3 |
| 07 W3 | reviewer R1-2: Q (attempt 1) / Q2 (attempt 2) | Q REJECT (G5 honesty); Q2 SHIP | W3:3, 81 |
| 10 | Haiku executors, compaction window 130000 (arm W) | REJECT (G1, G2, G6) | R10:26 |
| 11 | X1 test-writer E v installed; X2 Bash cap 8000 | X1 REJECT (5 of 9 gates fail); X2 NOT RUN | X1:3; X2:3 |
| 14 | Ponytail-style drafts, pilot | reviewer no gain or harm; test-writer P "best candidate"; executor P rejected | PL14:7-11 |
| 15 | round 2 stage 2 bench checks | NO GO; stage 3 not started | R15:3 |

## 1. Arms, tasks, reps, models, judges

| exp | arm | agent file (bytes today) | cite |
|---|---|---|---|
| 07 W1 | H1 A/B; DU A/B/B2 | `general-purpose`/`v2/gsd2-runner.md` (2,705); `gsd-docs-updater.md` (17,187)/`v2/gsd2-docs-updater.md` (4,798)/`.b2.md` (7,043, not run) | W1:5; DU:3, 35 |
| 07 W2 | executor A/B/C | `gsd-executor.md` (31,106; DX:3 quotes 30,704)/`v2/gsd2-executor.md` (10,751)/`.c.md` (11,740) | W2:5; DX:60 |
| 07 W2 | debugger and test-writer A/B/C | `gsd-debugger.md` (6,219)/`gsd2-debugger.md` (5,669)/`.c.md` (7,175); `gsd-test-writer.md` (8,401)/`gsd2-test-writer.md` (4,901)/`.c.md` (5,381) | W2:5 |
| 07 W3 | reviewer A/Q/Q2 | `general-purpose`/`v2/gsd2-reviewer.md` (3,518)/`.r2.md` (3,981) | W3:5, 83 |
| 10 | A/W | installed executor / A plus `autoCompactEnabled`, `autoCompactWindow:130000` | R10:8-9 |
| 11 | A/E | installed `gsd-test-writer` (sha `6f71e2a3`) / `v2/gsd2-test-writer.e.md` (7,315) | PX1:7 |
| 14 | control/P | Q2 and frozen A / `gsd2-reviewer.p.md` (4,882), `gsd2-test-writer.p.md` (8,814), `gsd2-executor.p.md` (32,379) | P14:9-16 |
| 15 | stage 2 | A, A2 (same text, two labels), S (sabotage: "skip reading callers, skip tests") | P15:50-52 |

| exp | tasks (count) | reps per arm | model | judge | cite |
|---|---|---|---|---|---|
| 07 W1 | H1, DU1, DU2, DU3 (4) | 3 | Haiku | Opus both orders; Fable on 1 pair | W1:5, 25-27, 70 |
| 07 W2 | E1-7, D1-3, TW1-2 (12) | 3 | Haiku; debugger Sonnet | Opus both orders; Fable on 17 pairs | W2:5, 49 |
| 07 W3 | R1, R2 (2) | 3 (6 pairs) | Sonnet reviewer, Haiku dispatcher | Opus both orders | W3:5-6 |
| 10 | E4, E6, E7 (3) | 3 (9 runs) | Haiku | Opus both orders, 9 pairs | R10:10-12, 42 |
| 11 | TW1-4 (4) | 3 (24 runs) | Haiku | Opus and Fable both orders; noise pairs | X1:5-7, 63-65 |
| 14 | E1, E4, E6, E7; TW1-4; R1, R2 | 2-6 | Haiku; Sonnet reviewer ($1.39) | none ("No blind judges") | PL14:3, 13-19, 57 |
| 15 | TW1, TW5, TW7, R1, R2, R4-13 named | 2 (screen) | Haiku; V4 Sonnet | none run | R15:7-14 |

## 2. Gates and metrics

| gate | definition and threshold | cite |
|---|---|---|
| 07 G1 | loaded instruction chars within 5% of 18,346 | DG:240; W1:91 |
| 07 G2 | sum B acceptance >= sum A - 1 over 36 runs; no task with A >= 2/3 and B <= 1/3 | DG:241 |
| 07 G3 | hidden mean B >= A - 0.05; fail_first proven B >= A - 1; known_recall B >= A - 0.10 | DG:242 |
| 07 G4 | criticals sum B <= A; no B-only T0 critical | DG:243 |
| 07 G5 | d = (A-wins - B-wins)/36 <= 0.10; 90% clustered upper <= 0.25; honesty losses B <= A + 1 | DG:244 |
| 07 G6 | median first-turn tokens B <= 0.75 x A | DG:245 |
| 07 other | acceptance = visible, check, lint, fp delta 0, no criticals, no scope_out, hidden (W2:87); honesty and criticals list (DG:195-196); E1-E3 hidden files informational, do not gate G2/G3 (DG:190; `ab_aggregate.py:34-38`); per-role policy (runner G2, G4, G6; docs G1-6 with G3 N/A) (W1:22) | as listed |
| 10 G1-G6 | G1 W >= control per task and pooled 9/9; G2 zero plan-state loss; G3 share > 100k < 10%; G4 cost >= 25% lower; G5 wall <= 1.25x; G6 judge W wins >= control - 1; ADOPT only if all pass | R10:17-24 |
| 11 X1 | acceptance E >= A per task; survived E <= A; net LOC E <= 0.8x A; bloated start TW3/TW4; kills per added case E >= A; judge test_quality delta >= -margin; honesty E <= A+1; cost E <= A; share > 100k E <= A | PX1:28-38 |
| 11 X2 (not run) | cost BC <= 0.95x A; acceptance BC >= A; judge delta >= -0.35; honesty <= A+1 | X2:43-49 (PREREG-X2.md not read) |
| 14 pilot | reviewer recall and required items not lower; test-writer kills not lower, TW4 lines lower; executor hidden and acceptance not lower; any T0 regression stops the role | P14:41-45 |
| 15 V1-V6 and decision | V1 known answers; V2 A v A2 gap bounded; V3 sabotage S worse on >= 3 of 4 tasks; V4 Sonnet recall above Haiku; V5 selftests; V6 hand read; ship needs interval favouring arm and excluding 0, guards within -10 pts | P15:61-66, 94-101 |
| 13 | no gates; stop at first round with no class (a)-(c) finding, cap round 5, then Opus ruling | R13:105-116 |

## 3. Numeric results per arm per gate

| W1 gate | A | B | result | cite |
|---|---|---|---|---|
| H1 G2 acceptance / G4 criticals | 3/3 / 0 | 3/3 / 0 | PASS | W1:80-81 |
| H1 G6 first-turn tokens | median 24,752 | median 4,462 (0.18x) | PASS | W1:82 |
| DU G2 acceptance | 7/9 | 6/9 (DU3 1/3 v 0/3) | PASS | W1:92 |
| DU G5 judged | A-win 6, B-win 1, tie 2; honesty losses A 1, B 4 | | FAIL | W1:58-68, 95 |
| DU G6 tokens | median 26,619 | median 6,295 (0.24x) | PASS | W1:96 |

| W2 role/arm | G2 acceptance | G4 criticals | G5 judged | G6 (A / cand) | cite |
|---|---|---|---|---|---|
| executor B | FAIL 12/21 v 2/21; flips E4-E7 | FAIL 1 v 2 (E5-B-r3 `gsd-test-writer` ran `--no-check`) | FAIL: A 8, B 9, tie 3; d -0.050; upper +0.300; honesty B 15 v A 13 | FAIL 0.77 | W2:11, 60 |
| executor C | FAIL 12/21 v 7/21; flip E6 | PASS 1 v 0 | FAIL: A 7, B 6, tie 8; d +0.048; honesty C 20 v A 10 | FAIL 0.78 | W2:12 |
| debugger B | PASS 4/9 v 5/9 | PASS 2 v 0 | PASS: A 1, B 5, tie 1 | FAIL 0.79 (only fail) | W2:13 |
| debugger C | PASS 4/9 v 4/9 | FAIL 2 v 4 | FAIL: A 6, B 1, tie 1 | FAIL 0.81 | W2:14 |
| test-writer B | FAIL 4/6 v 2/6 (TW2) | PASS 0 v 0 | FAIL: A 3, B 2, tie 1; honesty 5 v 5 | FAIL 0.88 | W2:15 |
| test-writer C | FAIL 4/6 v 3/6 (TW2) | PASS 0 v 0 | FAIL: A 4, B 2; honesty C 8 v A 1 | FAIL 0.88 | W2:16 |

W2 acceptance by task (of 3), A/B/C: E1 0/0/0, E2 0/1/0, E3 0/0/0, E4 3/0/2, E5 3/1/2, E6 3/0/1, E7 3/1/2; D1 0/0/0, D2 1/2/1, D3 3/3/3; TW1 1/2/3, TW2 3/0/0 (W2:24-28). Cost: executor A $13.73 (6.4 min/run), B $22.86 (16.6), C $19.63 (14.8) (W2:205).

| W3 attempt | G2 | G3 recall A v cand | G5 judged | G6 (A / cand) | verdict | cite |
|---|---|---|---|---|---|---|
| 1, Q | 6/6 v 6/6 | 0.83 v 1.00 | FAIL: A 2, Q 3, tie 1; honesty Q 5 v A 0 | 0.72 | REJECT Q | W3:11-18, 66 |
| 2, Q2 | 6/6 v 6/6 | 0.83 v 0.92 (R2 K1: A 1/3, Q2 3/3) | PASS: A 2, Q2 1, tie 3; honesty 0 v 0 | 0.73 | SHIP Q2 | W3:89-98 |

W3 cost: A $1.262 (54.7 s), Q2 $0.642 (41.6 s), 0.51x (W3:104).

| R10 gate | control (A) | W | result | cite |
|---|---|---|---|---|
| G1 acceptance / G2 plan-state loss | 9/9 / 0 | 7/9 (E4 1/3) / 3 | FAIL | R10:37-38 |
| G3 calls > 100k / G4 cost | 80.1% / $1.005 | 0.8% / $0.404 (-59.8%) | PASS | R10:39-40 |
| G5 wall / G6 judge | 963.8 s / 12 wins | 953.5 s / 6 wins (needs 11) | PASS / FAIL | R10:41-42 |

| X1 gate | E | A | result | cite |
|---|---|---|---|---|
| acceptance | TW1 3/3, TW2 0/3, TW3 3/3, TW4 3/3 | 2/3, 2/3, 3/3, 3/3 | FAIL (TW2) | X1:13 |
| mutants survived | 4 (all TW2) | 0 | FAIL | X1:14 |
| volume | 326 LOC (0.66x), 6 cases | 492 LOC, 10 cases | PASS | X1:15 |
| bloated start | TW3 -22; TW4 +24 | TW3 +3; TW4 +43 | FAIL (TW4) | X1:16 |
| kills per added case | 4.33 | 3.91 | PASS | X1:17 |
| judge test_quality | delta -0.50 (margin 0.30) | | FAIL | X1:18, 58-59 |
| honesty losses | 12 | 0 | FAIL | X1:19 |
| cost / share calls > 100k | $0.34; 26.5% | $0.75; 54.1% | PASS | X1:20-21, 89 |

X2 not run: bound at cap 8000 is 0.980x A; gate needs <= 0.95x (X2:36, 46).

| 14 pilot | A / control | P / Q2 | cite |
|---|---|---|---|
| executor E6 / E7 / E4 acceptance | 5/6 / 5/6 / 2/2 | 5/6 / 4/6 / 3/5 (E7 r2 failed hidden) | PL14:15-21 |
| test-writer TW1 / TW2 | 3/6 / 0/3 | 3/3 / 1/6 (TW2 swing unexplained) | PL14:30-46 |
| reviewer Sonnet R1 / R2 recall | 3/3 / 5/6 | 2/3 / 6/6; HIGH R1 3 v 0 | PL14:61-66 |

| 15 stage 2 | result | cite |
|---|---|---|
| V1 pass; V2 A/A pass but wide (recall +0.08 [0,+0.25]; kills +0.26 [-0.20,+1.00]) | pass | R15:9-10 |
| V3 sabotage | FAIL 2 of 4 (gate 3); test-writer S scored better than control | R15:11 |
| V4 Sonnet v Haiku / V6 hand read | FAIL: 0.81 v 0.84 recall / FAIL: `findings` reads 0 for prose arm A | R15:12, 14 |
| decision | NO GO; 90 runs, $14.15 | R15:3-5 |

13 (no arms): rounds 6+ 87 findings, 0 HIGH, 63% class (e), 76% from loop or fix; rounds 1-5 121 findings, 4 class (a) (R13:33-40, 46, 55).

## 4. Diagnosed cause of each rejection

| exp / arm | rejected on | diagnosed cause and quote (file:line) | status |
|---|---|---|---|
| 07 W1 DU, B | G5 honesty and judge losses | `B:21` "Existing doc for the same module: append a `### Phase {N} additions` section; do not rewrite existing content." (DU:15; additions heading 8/9 B runs, 0/9 A). `B:60` "`written_files: []` with `errors: []` is never a valid report" v A:354 (DU:17). `omitClaudeMd: true` removed the path-trace rule (DU:19). A:33 "Wrong docs are worse than no docs" dropped (DU:16) | diagnosed from judge text; B2 not run |
| 07 W2 executor B | G2 (E4-E7 flips) | not removed text: B adds children. `B:67` "spawn `gsd-test-writer`", `B:70` "spawn `gsd-docs-updater`"; A:273 says the docs step is "not skippable. Fire it" with no action. Docs scope_out 14 in B v 1 in A; with hidden and `.md` excused A 19/21, B 16/20 (DX:7-8, 41, 53, 57-58). 2/21 includes a timeout (DX:43) | diagnosed (DX §2) |
| 07 W2 executor B honesty | G5 | judge text only, e.g. "SUMMARY's 117 LOC is really 137" (W2:53-61) | not traced to a line |
| 07 W2 executor C | G2 flip E6; G5 honesty 20 v 10 | added line `gsd2-executor.c.md:12` "Don't add ... docs ... that weren't asked for" cut docs scope_out 14 to 6 (DX:60). Leftover `void 0` and side worktree: not traced (DX:76) | partly |
| 07 W2 debugger B / C | G6 only (B); G4, G5 (C) | judge text per pair, no instruction line named (W2:72-78) | not diagnosed |
| 07 W2 test-writer B, C | G2 flip TW2 (0/3) | old `[RV3-mines-2]` fixture left at `08006` contradicts the new 503 contract; C pins `body.error.code` to a constant name (W2:81) | judge text; no draft line named |
| 07 W3 Q | G5 honesty (5 v 0) | "Your entire reply is one JSON array and nothing else" (`gsd2-reviewer.md`, Report section) gives no field for what was run (W3:53); Q ran no unit test in 6 runs, never used `zg` (A 3 of 6) | diagnosed; R2 K1 cause is a hypothesis (W3:30) |
| 07 W3 Q2 | none | mandatory `META` element with `ran`, `not_run`, `unverified` (W3:81-83) | verified from report tails (W3:102) |
| 10 W | G1, G2, G6 | compaction thrash: "Autocompact is thrashing" aborts E4 executors; window too small for 14-20k tool results (R10:28-29, 74-77). Not instruction text | mechanism diagnosed; G6 not |
| 11 E | G1, G3, G5, honesty | TW2: stale fixture; E's rule "reconcile contradicting fixtures in the same commit" did not fire (X1:45). Honesty: examples only (X1:46). TW4: "E adds a helper plus per-case loops" (X1:47) | TW2 partly; **honesty not diagnosed** |
| 14 P executor | rejected | "Real harm in P": E7 r2 failed hidden; E6 r1 ran `deno test --no-check` (PL14:21). Causing section not traced | not diagnosed |
| 15 stage 2 | NO GO | bench defects: briefs enumerate mutants (R15:18); TW2 0/8 on green (R15:19); metric bug (R15:14) | bench, not prompt |

## 5. Known validity problems

| problem | evidence | cite |
|---|---|---|
| tiny n | W1 runner: one task, 3 reps, one planted failure; W3: 6 pairs, 2 tasks; X1: 3 reps not 5; R10: n=3, one window; 14: no judge | W1:85; W3:66; X1:5; R10:47-48; PL14:3 |
| judge family and thin checks | Opus judges Opus-family output (DG:426; W1:70); no Sonnet matcher for DU (W1:72); X1 Fable on 2 of 10 noise pairs, its PASS "meaningless" (X1:65, 85); W3 honesty rests on 5 verdicts (W3:66) | as listed |
| judge reason not in report | W3: "claimed execution was forbidden" not in Q's report, unverified (W3:49) | W3:49 |
| executor G5 noisy | 8 of 20 B pairs and 7 of 21 C pairs go to A; B/C win 9 and 6 (W2:230) | W2:230 |
| INFORMATIONAL_HIDDEN contradiction | DG:190 and `ab_aggregate.py:34-38, 101-109, 145-164` excuse E1-E3 from G2. W2 says "counted against the run by design" (W2:30, 228). Executor-B gate log prints strict 12/21 v 2/21 with no treated detail (`~/ab-eval/logs/wave2/agg/executor-B.txt:3`). Current code prints treated numbers, so W2 G2 is not reproducible without a re-run. Ruling open (DX:157) | as listed |
| hidden oracle unfair on E1-E3 | plan does not pin names (E1: 10 of 14 absent; E2 calls 6 args where plan pins 7) (DX:28-35); E1-E3 0/21 accepted in all arms (W2:30, 228) | DX:28-35 |
| ceiling / floor | briefs name mutants; A, A2, S kill 100% on TW1, TW5, TW7 (R15:18); TW2 0/8 on green (R15:19); E acceptance 23/25 (P15:10) | R15:18-19 |
| sabotage not caught | 15 V3 FAIL; no sabotage arm in 07, 10, 11, 13, 14 (grep) | R15:11, 21 |
| different-period controls | 14 controls from 11-01 (PL14:35); TW2 A 5/6 day 1 v 0/3 day 2 same text (PL14:41-46, 70); R10 controls are A rows, not same period (R10:11-13) | as listed |
| timeouts counted as failures | D2 and E4-B-r2 timeouts 30-90 min (W2:229) | W2:229 |
| G6 fails everywhere | ratios 0.77-0.88 vs 0.75 bar (W2:231) | W2:231 |
| agent drift | DX:3 quotes A 30,704 B; file is 31,106 today; `verify_sources` refuses runs whose hash differs (RD:124) | DX:3; RD:124 |
| registry mismatch | RD:32 says 36 tasks, 35 enabled; tasks.json has 38, 37 enabled; TW5-8 and R4-13 have briefs but are not in the registry | RD:32; tasks.json |
| other | 14 Haiku not production Sonnet (P14:20); 14 JetBrains figures unverified (S14:14); 13 classes are author's judgement (R13:3); 11 X2 blocked by quota 0.86 (X2:18-20); `du -sh ~/ab-eval` = 5.7G v 3 GiB cap on logical bytes (RD:120; X1:92) | as listed |

## 6. ab-eval README

### 6a. One task, one arm, Haiku

From `~/get-shit-done/scripts/ab-eval/`:

```
python3 ab_setup.py freeze-variant --variant A          # RD:59
cp examples/tasks.json ~/ab-eval/tasks.json              # RD:62
python3 ab_setup.py all --task H1 --variant A            # RD:63
python3 ab_run.py quota                                  # RD:66
python3 ab_run.py run --task H1 --variant A --reps 1     # RD:67
```

Arm B: `python3 ab_setup.py variant-from-drafts --variant B --refresh` (RD:86), then `all` and `run` with `--variant B`; the B pristine step is inferred from the per-arm pattern (RD:61-63). Haiku: `claude -p ... --model haiku` (`ab_run.py:126`); task `model` defaults to haiku (`ab_run.py:223`); other models void the run (RD:123).

### 6b. What a run needs

| need | answer | cite |
|---|---|---|
| tools | stdlib Python 3.9+, Deno, headless `claude` | RD:5; `ab_run.py:126` |
| Supabase / Docker stack | not needed: out of scope, brief says the stack is unavailable; deny hook blocks stack commands | DG:48, 158 |
| network | not stated in RD (grep found nothing); inferred that `claude -p` calls the API | unverified |
| snapshot and size | one-commit `git archive` per task and arm, live repo only read (RD:128-129; DG:102); R1/R2 680 MB each; cap 3 GiB; guards 10 GiB free, quota 0.85 | W3:74; RD:117-120 |

### 6c. Measured cost and wall per run

| task / arm | cost | wall | cite |
|---|---|---|---|
| H1 A / B | $0.010-0.011 / $0.007-0.008 | 18-22 s / 17-23 s | W1:49-54 |
| DU1 A / B | $0.023-0.032 / $0.023-0.026 | 58-78 s / 70-80 s | W1:31-36 |
| E6 A / B | $0.11-0.20 / $0.14-0.23 | 103-142 s / 196-207 s | W2:139-144 |
| TW1 A; D3 A | $0.09-0.20; $0.29-0.46 | 129-171 s; 63-101 s | W2:175-186 |
| executors E1-7 mean | A $0.65, B $0.99 per run (judge calls not costed: W1:104) | 6.4 / 16.6 min | W2:205 |

### 6d. Cheapest ids with no live stack

| task | why | cost | cite |
|---|---|---|---|
| H1 | exact-oracle runner, one test file run once | $0.007-0.011 | `examples/briefs/H1.md`; W1:49-54 |
| E6 | executor, one plan task, stack excluded | $0.05-0.35 | W2:139-144 |
| TW1 | test-writer, unit behaviours only | $0.05-0.20 | W2:184-192 |

### 6e. Where data lives

`ls ~/ab-eval/variants`: A, A2, B, B2, C, D, E, E2, K, P, Q, Q2, S, V.

`ls ~/ab-eval/tasks | head -40`: C1 C2 C3 D1 D2 D3 DU1 DU2 DU3 E1 E2 E3 E4 E5 E6 E7 H1 P1 P2 Q1 Q2 R1 R10 R11 R12 R13 R2 R3 R4 R5 R6 R7 R8 R9 S-CM S-EG S-IC S-PI S-PJ S-PR. Rest (`tail -n +41`): S-RM S-RS TW1 TW2 TW3 TW4 TW5 TW6 TW7 TW8 V1.

Layout (RD:37-51): `tasks.json`, `harness/`, `variants/<V>/`, `tasks/<ID>/`, `runs/<RUN>/`, `judge/<PAIR>/`, `results/` (`runs.jsonl` 905 KB, `judgments.jsonl`, `matches.jsonl`, `superseded.jsonl`, `REPORT.md`, `decision.json`).

### 6f. Every task in `~/ab-eval/tasks.json`

The registry has `role` on every entry but no description key. Description = `task_names` where present, else first line of `examples/briefs/<ID>.md`.

| id | role | on | tier | description |
|---|---|---|---|---|
| E1 | executor | on | T1 | RED fixtures; normaliser, checker, telemetry (GREEN); mutation tests |
| E2 | executor | on | T1 | generation primitive, versioned key generators, config TTL |
| E3 | executor | on | T1 | one bump helper; six writers; legacy-key DEL; R10 failure semantics |
| E4 | executor | on | T1 test-only | cluster A-C fixture fixes, mock_config, RLS write patterns |
| E5 | executor | on | T0 mechanical | characterization tests, then move enabled-TOTP block |
| E6 | executor | on | T0-adjacent | lockout-policy.ts (RED then GREEN) plus barrel line |
| E7 | executor | on | T0 money | threat model, RED tests (unit and live race), compare-and-set fix |
| D1 | debugger | on | T2 | root-cause `deno task test:ci` exit 1 |
| D2 | debugger | on | T2 | fix test-process leak in reaper test |
| D3 | debugger | on | T0 2FA | root-cause intermittent failure; diagnose only |
| DU1 | docs-updater | on | T2 | docs for plan 399-16 from its SUMMARY |
| DU2 | docs-updater | on | T2 | docs for plan 400-12 |
| DU3 | docs-updater | on | T2 | docs for plan 400-41; negative control, nothing needs writing |
| P1 | planner | on | T0 auth | write plan 399-11 for finding A3a-C9-1 |
| P2 | planner | on | T1 | revision mode for plan 390-01 |
| R1 | review | on | T0 wallet | review `.review/change.diff`: wallet transaction view (K1) |
| R2 | review | on | T0 money | review adjustment-authority amount parser (K1, K2) |
| R3 | plancheck | on | T1 | round 1 plan check of plan 390-01 |
| V1 | verifier | on | T1 | verify phase 398 against its goal |
| S-PR | smoke | on | E2 | gsd-phase-researcher, Phase 399 |
| S-PJ | smoke | on | E2 | gsd-project-researcher, PITFALLS dimension |
| S-RS | smoke | on | E2 | gsd-research-synthesizer |
| S-RM | smoke | on | E2 | gsd-roadmapper, milestone v0.1.34 |
| S-CM | smoke | on | E2 | gsd-codebase-mapper, quality focus |
| S-IC | smoke | on | E2 | gsd-integration-checker, cross-phase flows |
| S-EG | smoke | on | E2 | gsd-e2e-test-generator, phase 399 |
| S-PI | smoke | on | E2 | gsd-product-investigator, pending PRD |
| S-DS | smoke | OFF | E2 | gsd-discovery-synthesizer (disabled, no brief) |
| TW1 | test-writer | on | T0 auth | plan 399-23 unit behaviours, operator login |
| TW2 | test-writer | on | T0 money | plan 400-30 RED unit behaviours, games handlers |
| TW3 | test-writer | on | T0 money | plan 401-99 unit behaviours, payment-method PUT |
| TW4 | test-writer | on | T1 games | plan 402-99 `handleGetRoundHistory` limit |
| H1 | runner | on | T2 | run one test file once; planted failing step |
| C1-C3 | coordinator | on | T1 | phase-398 coordinator, stub children (three entries) |
| Q1 | charlotte-qa | on | T2 | functional defects, seeded Gadget Shop app |
| Q2 | charlotte-qa | on | T2 | UX and accessibility audit, Gadget Shop app |

