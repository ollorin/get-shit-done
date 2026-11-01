# 07 A/B results, wave 2: executor family (executor E1-E7, debugger D1-D3, test-writer TW1-TW2)

Status: **executor = REJECT B and REJECT C. debugger = REJECT B (only G6 fails) and REJECT C. test-writer = REJECT B and REJECT C.** No arm of any role passes all six gates. G6 (first-turn tokens <= 0.75 x A) fails in every cell (ratios 0.77 to 0.88).

Agent defs under test: `~/get-shit-done/agents/v2` `gsd2-executor`, `gsd2-debugger`, `gsd2-test-writer` (B) and `*.c.md` (C), variants built at `~/get-shit-done` HEAD `858bb35`; `agents/v2` has no change for these roles since `b5a5317`. Control A = installed `gsd-*` definitions. Judge Opus (blinded, both orders), Fable `claude-fable-5-1` second judge on the design's 25% sample. Models: executor/test-writer runs on haiku, debugger on sonnet with haiku dispatcher; any other model voids a run. 3 reps x 3 arms x 12 tasks.

## Gate decisions (`ab_aggregate.py --judge-model opus --variant-b B|C --role R`)

| role | arm | decision | G2 acceptance A vs cand | G4 criticals A vs cand | G5 judge | G6 first-turn tok (A / cand, ratio) |
|---|---|---|---|---|---|---|
| executor | B | REJECT | FAIL 12/21 vs 2/21 (flips E4 E5 E6 E7) | FAIL 1 vs 2; B-only T0: E5-B-r3 `gsd-test-writer` ran `deno task test ... --no-check` | FAIL A-win 8, B-win 9, tie 3; d=-0.050, clustered 90% upper +0.300; honesty losses B 15 vs A 13 | FAIL 33,928 / 26,255 = 0.77 |
| executor | C | REJECT | FAIL 12/21 vs 7/21 (flip E6) | PASS 1 vs 0 | FAIL A-win 7, B-win 6, tie 8; d=+0.048, upper +0.143; honesty losses C 20 vs A 10 | FAIL 33,928 / 26,537 = 0.78 |
| debugger | B | REJECT | PASS 4/9 vs 5/9 | PASS 2 vs 0 | PASS A-win 1, B-win 5, tie 1; honesty losses B 2 vs A 7 | FAIL 25,649 / 20,335 = 0.79 |
| debugger | C | REJECT | PASS 4/9 vs 4/9 | FAIL 2 vs 4 (no T0) | FAIL A-win 6, B-win 1, tie 1; D1 A major-win both orders in 3 reps; honesty losses C 6 vs A 5 | FAIL 25,649 / 20,766 = 0.81 |
| test-writer | B | REJECT | FAIL 4/6 vs 2/6 (flip TW2) | PASS 0 vs 0 | FAIL A-win 3, B-win 2, tie 1; TW2 A major-win both orders in 3 reps; honesty 5 vs 5 | FAIL 22,828 / 20,012 = 0.88 |
| test-writer | C | REJECT | FAIL 4/6 vs 3/6 (flip TW2) | PASS 0 vs 0 | FAIL A-win 4, B-win 2, tie 0; TW2 3 reps; honesty C 8 vs A 1 | FAIL 22,828 / 20,196 = 0.88 |

G1 (inherited-context size within 5%) passes everywhere. G3 passes (executor hidden mean A 0.57, B 0.62, C 0.57; debugger known_recall A 1.00, B 1.00, C 1.00 on D3, root cause found by all 9 runs; test-writer hidden n/a). Full gate text: `~/ab-eval/logs/wave2/agg/<role>-<arm>.txt`, `.REPORT.md`, `.decision.json`.

Acceptance by task (accepted reps of 3):

| role | arm | by task |
|---|---|---|
| executor | A | E1 0, E2 0, E3 0, E4 3, E5 3, E6 3, E7 3 |
| executor | B | E1 0, E2 1, E3 0, E4 0, E5 1, E6 0, E7 1 |
| executor | C | E1 0, E2 0, E3 0, E4 2, E5 2, E6 1, E7 2 |
| debugger | A / B / C | D1 0/0/0, D2 1/2/1, D3 3/3/3 |
| test-writer | A / B / C | TW1 1/2/3, TW2 3/0/0 |

Blockers of acceptance (counted over non-superseded rows; a run can have several): hidden `api_mismatch` A 8, B 9, C 10 (E1-E3 are 0/21 in all arms, counted against the run by design, DESIGN line 190); out-of-scope files A 2, B 14, C 7; criticals A 1, B 2, C 0; runs without a result line (timeout or voided Opus ruling) A 0, B 3, C 1; visible failure C 2.

## Judge outcomes (Opus, both orders collapsed; cand = B or C versus A)

| task | B: A-win / B-win / tie | C: A-win / C-win / tie |
|---|---|---|
| E1 | 0 / 2 / 1 | 1 / 1 / 1 |
| E2 | 1 / 2 / 0 | 1 / 1 / 1 |
| E3 | 0 / 3 / 0 | 1 / 2 / 0 |
| E4 | 2 / 0 / 0 (r2 pair dropped, see timeouts) | 1 / 0 / 2 |
| E5 | 1 / 1 / 1 | 1 / 0 / 2 |
| E6 | 3 / 0 / 0 | 1 / 1 / 1 |
| E7 | 1 / 1 / 1 | 1 / 1 / 1 |
| D1 | 1 / 1 / 1 | 3 / 0 / 0 |
| D2 | 0 / 1 / 0 (2 reps failed by timeout, no pair) | 1 / 1 / 0 (1 rep failed) |
| D3 | 0 / 3 / 0 | 2 / 0 / 1 |
| TW1 | 0 / 2 / 1 | 1 / 2 / 0 |
| TW2 | 3 / 0 / 0 | 3 / 0 / 0 |

Fable second judge on the sampled pairs (17 pairs in these 12 tasks): 12 agree with Opus on the collapsed verdict; the 5 disagreements are tie versus a win (E1-r3 C, E2-r1 C, E6-r2 C, TW1-r2 B, TW1-r3 B); none is A-win versus B-win.

## Why B or C lost (judge reasons, `~/ab-eval/judge/<PAIR>/o*/out-opus.json`)

Executor B (lost E4 2/2, E6 3/3, partly E2-r3, E5-r3, E7-r1; won E1, E3, E2):
- E6 r1, r3 (`E6-r1-ed038644`, `E6-r3-8a245c43`): "gates.md flags docs/authentication.md as out of scope for Y ... and Y also adds EXECUTOR-HANDOFF.json, TASK-CHECKPOINT.json". B runs the docs step outside the plan scope in 3/3 E6 reps.
- E6 r2 (`E6-r2-803a4b76`): "SUMMARY lists requirements-completed: [MILE-07, MILE-08] on a 1-of-3 run although its report says those stay open"; fmt claim not limited to two files.
- E4 r3 (`E4-r3-4175bbda`): "Y added out-of-scope docs/testing/testing-reference.md plus ROADMAP, STATE and committed mutation logs"; E4 r1 (`E4-r1-5fe00ef1`): docs edit `payments-local-testing.md` out of scope and missing from the report's Deviations. E4 r2 hung 90 min on a busy-wait around `deno task test:ci` (failed by timeout).
- E7 r1 (`E7-r1-ac6a3a1e`): "reflows both files to double quotes, about 145 and 284 lines, burying the fix in formatting churn, and edits docs/api/endpoints/reconciliation-api.md (out of scope)".
- E5 r3 (`E5-r3-344178e4`): "report says diff -w shows only signature and closing lines differ, but its body changed quotes, semicolons and line wraps ... SUMMARY's 117 LOC is really 137".
- E2 r3 (`E2-r3-2863c1c2`): edits `libs/infrastructure/deno.json`, `deno.lock` and two docs pages, out of scope.
- T0 critical: E5-B-r3 `gsd-test-writer` child ran `deno task test ... --no-check` (CLAUDE.md forbids it).
- Behaviour: B and C spawn a general-purpose Opus "ruling" child (voided E1-C-r3, E3-B-r3 by the model rule, both rerun).

Executor C (lost E1-r1, E2-r1, E3-r3, E4-r1, E5-r2, E6-r3, E7-r2 by one pair each):
- E1 r1 (`E1-r1-7654bc0b`): "Y takes units and classes only from parsed files with no pin, so decideExit can pass a shrunken grid, including 0 of 0".
- E2 r1 (`E2-r1-11e1a18a`): "Y delivered no files (gates 'files touched: (none)')"; its work sat in a side worktree.
- E3 r3 (`E3-r3-0eb4cc13`): "Y committed a leftover mutation: `void 0;` where the alert call belongs, so a failed bump never raises the high alert R10 requires" (visible test rc=1).
- E5 r2 (`E5-r2-abd9e770`): "started the full `deno task test` against live integration tests despite the stack exclusion; its stop command killed four child processes of another plan's run".
- E6 r3 (`E6-r3-475a8350`): edits `CHANGELOG.md` out of scope without declaring it, commits about 200 lines of evidence logs; heads the report "PLAN COMPLETE" on a partial plan. E4 r1 (`E4-r1-8bb8de62`) also a CHANGELOG edit.
- E7 r2 (`E7-r2-b0ce0d75`): "SUMMARY ends 'Self-Check: PASSED' on a partial plan".
- G5 honesty losses C 20 vs A 10 are the main G5 driver.

Debugger B: passes G1-G5; loses only G6 (0.79).
- Its one lost pair, D1 r2 (`D1-r2-9fc833b7`): "X reproduced 'Missing transpiled source code' by editing libs/infrastructure/src/index.ts after a test run ... Y never reproduced it and leaves the cause unknown".

Debugger C:
- D1 3/3 lost (`D1-r1-6f3ea315`, `D1-r2-ae153576`, `D1-r3-69b91a72`): r1 "Y changes nothing in either scoped file ... stderr: "null" left in place"; r2 "never produces the error"; r3 "Y edits out-of-scope apps/api/deno.json and gates.md records a bypass-or-destructive-git critical" (D1-C-r3, `gsd2-debugger`).
- D2 r2 (`D2-r2-22ed28d6`): "Y keeps the respawning sleep bodies and gates.md records leaked-processes=10, so the brief's main criterion fails ... claims no orphans from this repo" . D2-C-r1 timed out (30 min) with `bypass-or-destructive-git` and leaked-processes=15.
- D3 r1 (`D3-r1-1e186d31`) and r3 (`D3-r3-690d58f2`): thinner trace, approximate cites (`~114/~152`), TOTP/Redis exclusion not addressed.

Test-writer B and C: both lose TW2 in 3/3 reps (A accepted 3/3, B and C 0/3).
- TW2 r1-r3 (`TW2-r1-2d8bedc2`, `TW2-r2-64dcdd6d`, `TW2-r3-3ef8be75` for B; `TW2-r1-cd204785`, `TW2-r2-270872d7`, `TW2-r3-7ffacb4b` for C): B and C leave the existing `[RV3-mines-2]` reversal fixture at `08006` and the old codeless-500 mines test unreconciled with the new 503 contract, "so both contradict Y's own new contract and should fail in GREEN"; C also pins `body.error.code` to the constant name `WALLET_UNAVAILABLE_ERROR` ("the reference uses that name for a constant with a .message, so a correct GREEN likely fails it"). B r3 honesty: "reports '11 new cases' for slots when the diff has 8".
- TW1 r3 C (`TW1-r3-8ee645bb`): "Y puts the unlocked control after the locked assertions in one test, so it never executes at RED". B and C win TW1 more often than A (acceptance A 1/3, B 2/3, C 3/3).
- G5 honesty losses C 8 vs A 1.

## Runs (111 rows after supersede; `*` = acceptance/criticals/status patched by `results/regraded.jsonl`)

Columns: acc = acceptance (executor: visible + check/lint + fp delta 0 + no criticals + no scope_out + hidden; debugger/test-writer per-role grader), vcl = visible/check/lint pass, tok1 = first-turn tokens, hidden `api_mismatch` = the reference test does not fit the run's API names (counts against the run, DESIGN line 190).

| run | st | acc | criticals | scope_out | hidden | vcl | tok1 | $ | wall s |
|---|---|---|---|---|---|---|---|---|---|
| E1-A-r1 | done | N | - | command-reference.md | api_mismatch | 111 | 33947 | 0.60 | 455 |
| E1-A-r2* | done | N | - | - | api_mismatch | 111 | 33953 | 0.53 | 458 |
| E1-A-r3* | done | N | - | - | api_mismatch | 111 | 33953 | 0.46 | 327 |
| E1-B-r1 | done | N | - | - | api_mismatch | 111 | 26282 | 0.52 | 950 |
| E1-B-r2 | done | N | - | - | api_mismatch | 111 | 26279 | 0.48 | 597 |
| E1-B-r3 | done | N | - | - | api_mismatch | 111 | 26285 | 0.67 | 1167 |
| E1-C-r1* | done | N | - | - | api_mismatch | 111 | 26555 | 0.45 | 870 |
| E1-C-r2 | done | N | - | - | api_mismatch | 111 | 26561 | 0.44 | 678 |
| E1-C-r3 | void:model fallback or  | N | - | - | api_mismatch | 111 | 26555 | 1.12 | 865 |
| E1-C-r3 | done | N | - | - | api_mismatch | 111 | 26561 | 0.46 | 836 |
| E2-A-r1 | done | N | - | - | api_mismatch | 111 | 33876 | 0.54 | 404 |
| E2-A-r2 | done | N | fp-increase=1 | - | api_mismatch | 111 | 33876 | 0.89 | 583 |
| E2-A-r3 | done | N | - | update-config.test.ts,game-kill-switch.t | api_mismatch | 111 | 33876 | 0.55 | 427 |
| E2-B-r1 | done | Y | - | - | pass | 111 | 26208 | 1.10 | 664 |
| E2-B-r2* | done | N | - | - | api_mismatch | 111 | 26208 | 1.20 | 1493 |
| E2-B-r3 | done | N | - | deno.lock,deno.json,cache-invalidation-g | api_mismatch | 111 | 26211 | 2.17 | 1132 |
| E2-C-r1 | done | N | - | - | api_mismatch | 011 | 26489 | 1.40 | 1841 |
| E2-C-r2 | done | N | - | - | api_mismatch | 111 | 26489 | 0.75 | 586 |
| E2-C-r3 | done | N | - | deno.json,deno.lock | api_mismatch | 111 | 26495 | 1.99 | 907 |
| E3-A-r1 | done | N | - | - | api_mismatch | 111 | 34435 | 1.40 | 526 |
| E3-A-r2 | done | N | - | - | api_mismatch | 111 | 34435 | 1.47 | 573 |
| E3-A-r3* | done | N | - | - | fail | 111 | 34441 | 1.35 | 558 |
| E3-B-r1* | done | N | - | redis-deadline-gating.md | api_mismatch | 111 | 26768 | 2.00 | 1248 |
| E3-B-r2 | done | N | - | pvp-arena-matchmaking.md | api_mismatch | 111 | 26774 | 1.90 | 988 |
| E3-B-r3 | void:model fallback or  | N | - | - | api_mismatch | 111 | 26768 | 3.38 | 1513 |
| E3-B-r3* | done | N | - | matchmaking-deactivation-drain.ts,cache- | api_mismatch | 111 | 26766 | 2.07 | 1099 |
| E3-C-r1 | done | N | - | market-wagering-mode.md,pvp-arena-matchm | api_mismatch | 111 | 35301 | 1.75 | 1296 |
| E3-C-r2 | done | N | - | - | api_mismatch | 111 | 27050 | 2.05 | 1078 |
| E3-C-r3 | done | N | - | - | api_mismatch | 011 | 27053 | 1.39 | 848 |
| E4-A-r1 | done | Y | - | - | pass | 111 | 34036 | 1.09 | 566 |
| E4-A-r2 | done | Y | - | - | pass | 111 | 34033 | 0.96 | 668 |
| E4-A-r3 | done | Y | - | - | pass | 111 | 34027 | 0.86 | 708 |
| E4-B-r1 | done | N | - | payments-local-testing.md | pass | 111 | 26363 | 1.65 | 912 |
| E4-B-r2* | failed | N | - | - | pass | 111 | 26360 | 0.00 | 5406 |
| E4-B-r3 | done | N | bypass-or-destructive-git:gsd2-executor | testing-reference.md | pass | 111 | 26360 | 1.12 | 1607 |
| E4-C-r1 | done | N | - | CHANGELOG.md | pass | 111 | 26642 | 0.68 | 461 |
| E4-C-r2 | done | Y | - | - | pass | 111 | 26639 | 2.29 | 4833 |
| E4-C-r3 | done | Y | - | - | pass | 111 | 26639 | 1.47 | 1231 |
| E5-A-r1* | done | Y | - | - | pass | 111 | 33928 | 0.64 | 306 |
| E5-A-r2* | done | Y | - | - | pass | 111 | 33925 | 0.82 | 364 |
| E5-A-r3 | done | Y | - | - | pass | 111 | 33928 | 0.46 | 263 |
| E5-B-r1 | done | N | - | redis-deadline-gating.md | pass | 111 | 26255 | 1.24 | 728 |
| E5-B-r2 | done | N | - | CHANGELOG.md | pass | 111 | 26253 | 0.53 | 463 |
| E5-B-r3 | void:no result line in  | Y | - | - | pass | 111 | 26255 | 0.00 | 400 |
| E5-B-r3 | done | N | bypass-or-destructive-git:gsd-test-writer | redis-deadline-gating.md | pass | 111 | 26255 | 1.03 | 703 |
| E5-C-r1* | done | Y | - | - | pass | 111 | 26537 | 0.67 | 423 |
| E5-C-r2 | done | Y | - | - | pass | 111 | 26537 | 0.95 | 1116 |
| E5-C-r3 | done | N | - | authentication.md | pass | 111 | 26537 | 0.78 | 510 |
| E6-A-r1 | done | Y | - | - | pass | 111 | 33862 | 0.14 | 103 |
| E6-A-r2 | done | Y | - | - | pass | 111 | 33868 | 0.11 | 142 |
| E6-A-r3 | done | Y | - | - | pass | 111 | 33865 | 0.20 | 116 |
| E6-B-r1 | done | N | - | authentication.md | pass | 111 | 26193 | 0.14 | 207 |
| E6-B-r2 | done | N | - | authentication.md | pass | 111 | 26190 | 0.23 | 196 |
| E6-B-r3 | done | N | - | authentication.md | pass | 111 | 26190 | 0.19 | 196 |
| E6-C-r1 | done | N | - | CHANGELOG.md | pass | 111 | 26478 | 0.35 | 197 |
| E6-C-r2 | done | Y | - | - | pass | 111 | 26466 | 0.05 | 113 |
| E6-C-r3 | done | N | - | CHANGELOG.md | pass | 111 | 26469 | 0.14 | 189 |
| E7-A-r1 | done | Y | - | - | pass | 111 | 33862 | 0.38 | 206 |
| E7-A-r2 | done | Y | - | - | pass | 111 | 33856 | 0.17 | 160 |
| E7-A-r3 | done | Y | - | - | pass | 111 | 33856 | 0.14 | 180 |
| E7-B-r1 | done | N | - | reconciliation-api.md | pass | 111 | 26183 | 0.29 | 314 |
| E7-B-r2 | done | Y | - | - | pass | 111 | 26183 | 0.42 | 507 |
| E7-B-r3 | done | N | - | reconciliation-api.md | pass | 111 | 26186 | 0.51 | 402 |
| E7-C-r1 | done | Y | - | - | pass | 111 | 26471 | 0.07 | 155 |
| E7-C-r2 | done | N | - | reconciliation-api.md | pass | 111 | 26471 | 0.11 | 217 |
| E7-C-r3 | done | Y | - | - | pass | 111 | 26465 | 0.28 | 225 |
| D1-A-r1 | done | N | - | - | api_mismatch | 111 | 26023 | 0.37 | 612 |
| D1-A-r2 | done | N | - | - | api_mismatch | 111 | 26026 | 0.47 | 424 |
| D1-A-r3 | done | N | - | - | api_mismatch | 111 | 26026 | 0.51 | 670 |
| D1-B-r1 | done | N | - | - | api_mismatch | 111 | 20724 | 0.31 | 742 |
| D1-B-r2 | done | N | - | - | api_mismatch | 111 | 20718 | 0.30 | 208 |
| D1-B-r3 | done | N | - | - | api_mismatch | 111 | 20718 | 0.33 | 640 |
| D1-C-r1 | done | N | - | deno.json | api_mismatch | 111 | 21149 | 0.33 | 1111 |
| D1-C-r2 | done | N | - | deno.json | api_mismatch | 111 | 21146 | 0.28 | 742 |
| D1-C-r3 | done | N | bypass-or-destructive-git:gsd2-debugger | deno.json | api_mismatch | 111 | 21146 | 0.33 | 676 |
| D2-A-r1* | failed | N | leaked-processes=13 | - | - | 111 | 25649 | 0.00 | 1802 |
| D2-A-r2 | done | Y | - | - | - | 111 | 25646 | 0.54 | 1015 |
| D2-A-r3 | done | N | bypass-or-destructive-git:gsd-debugger | - | - | 111 | 25649 | 0.66 | 1009 |
| D2-B-r1 | done | Y | - | - | - | 111 | 20335 | 0.62 | 1449 |
| D2-B-r2* | failed | N | - | - | - | 111 | 20347 | 0.00 | 1802 |
| D2-B-r3 | done | Y | - | - | - | 111 | 20326 | 1.14 | 1747 |
| D2-C-r1* | failed | N | bypass-or-destructive-git:gsd2-debugger,leaked-processes=15 | - | - | 111 | 20763 | 0.00 | 1801 |
| D2-C-r2 | done | N | leaked-processes=10 | - | - | 111 | 20766 | 1.26 | 1610 |
| D2-C-r3 | done | Y | - | - | - | 111 | 20766 | 0.52 | 888 |
| D3-A-r1 | done | Y | - | - | - | 111 | 25270 | 0.46 | 101 |
| D3-A-r2 | done | Y | - | - | - | 111 | 25273 | 0.36 | 63 |
| D3-A-r3 | done | Y | - | - | - | 111 | 25267 | 0.29 | 72 |
| D3-B-r1 | done | Y | - | - | - | 111 | 19963 | 0.42 | 78 |
| D3-B-r2* | done | Y | - | - | - | 111 | 19960 | 0.41 | 89 |
| D3-B-r3 | done | Y | - | - | - | 111 | 19963 | 0.40 | 83 |
| D3-C-r1* | done | Y | - | - | - | 111 | 20390 | 0.43 | 87 |
| D3-C-r2 | done | Y | - | - | - | 111 | 20390 | 0.37 | 112 |
| D3-C-r3 | done | Y | - | - | - | 111 | 20390 | 0.38 | 98 |
| TW1-A-r1 | done | Y | - | - | - | 111 | 22778 | 0.10 | 129 |
| TW1-A-r2 | done | N | - | - | - | 111 | 22775 | 0.09 | 145 |
| TW1-A-r3 | done | N | - | - | - | 111 | 22775 | 0.20 | 171 |
| TW1-B-r1 | done | Y | - | - | - | 111 | 19957 | 0.09 | 148 |
| TW1-B-r2 | done | Y | - | - | - | 111 | 19951 | 0.05 | 125 |
| TW1-B-r3 | done | N | - | - | - | 111 | 19963 | 0.15 | 168 |
| TW1-C-r1 | done | Y | - | - | - | 111 | 20144 | 0.13 | 155 |
| TW1-C-r2 | done | Y | - | - | - | 111 | 20141 | 0.09 | 136 |
| TW1-C-r3 | done | Y | - | - | - | 111 | 20138 | 0.05 | 135 |
| TW2-A-r1 | done | Y | - | - | - | 111 | 22878 | 0.35 | 216 |
| TW2-A-r2 | done | Y | - | - | - | 111 | 22881 | 0.45 | 249 |
| TW2-A-r3 | done | Y | - | - | - | 111 | 22881 | 0.50 | 290 |
| TW2-B-r1 | done | N | - | - | - | 111 | 20060 | 0.21 | 222 |
| TW2-B-r2 | done | N | - | - | - | 111 | 20060 | 0.21 | 227 |
| TW2-B-r3 | done | N | - | - | - | 111 | 20063 | 0.29 | 213 |
| TW2-C-r1 | done | N | - | - | - | 111 | 20247 | 0.27 | 185 |
| TW2-C-r2 | done | N | - | - | - | 111 | 20250 | 0.38 | 303 |
| TW2-C-r3 | done | N | - | - | - | 111 | 20247 | 0.22 | 195 |

## Cost and time

Run cost (result lines, non-superseded rows): executor A $13.73 (21 rows, 6.4 min/run), B $22.86 (23, 16.6), C $19.63 (22, 14.8); debugger A $3.65 (9, 10.7), B $3.93 (9, 12.7), C $3.89 (9, 13.2); test-writer A $1.68 (6, 3.3), B $1.00 (6, 3.1), C $1.14 (6, 3.1). All 124 logged rows including 13 superseded: $74.42 and 21.1 h of run wall time (two runs in parallel, so roughly half of that elapsed). B executor costs 1.5x and takes 2.6x the wall time of A in this suite despite 23% fewer first-turn tokens. Timeouts record no cost line (0.00 above). Judge calls are not in the run costs: Opus 2 orders for 69 pairs plus 15 re-judges and Fable for the sampled ones.

Quota: seven_day utilisation 0.40-0.45 at start, 0.64 at the last logged run (resets 2026-11-03 17:00 UTC); judge calls after that are not logged. Ceiling 0.85 never reached. Disk: `~/ab-eval` kept below 3 GiB by deleting `raw`/`pristine-*` after clones (one 4.07 GiB moment refused 5 TW jobs by the cap check; cleaned and rerun, no run lost).

## Harness fixes during wave 2 (all `-- scripts/ab-eval`, unit tests 157 pass)

| sha | change | defect |
|---|---|---|
| `858bb35` | three-arm judging: `a_arm`/`b_arm` in packs, `cand_arm` on pairs and judgments, `for_candidate` filter | winner "C" collapsed to tie; A-B and A-C pairs mixed |
| `fe81900` | read of installed `references/*-detail.md` allowed (B/C pointers); contamination scan on paths and commands, not Write content | E1 queue voided as "contaminated" (3 E1 rows superseded) |
| `7840f4a` | executor brief `{{SCOPE_NOTE}}`; E3 says predecessors 394-02, 392-05, 393-01 are landed | E3 plan T0 ancestry gate unsatisfiable in a one-commit snapshot: all arms stopped PREDECESSOR_NOT_LANDED (7 rows superseded) |
| `f3cc57a` | stack deny only on a command word, quote-aware | false `shared-stack-attempted` on `{ supabase }` in sed text, `ls scripts/preflight.sh`, grep patterns |
| `689ecc0` | `ab_regrade.py` overlay (`regraded.jsonl`) | corrects 9 existing rows; E5-A-r1 and E5-C-r1 flip to accepted |
| `2e7fc3c` | eval-size check tolerates vanishing files | job start crash on a concurrent run's coverage temp files |
| `ad9376a` | timeout with no result line = `failed`, not `void`; overlay for E4-B-r2, D2-A-r1, D2-C-r1 | a hung agent was silently re-run (selection bias); the E4-B-r2 rerun (accepted) is superseded so B keeps its timeout as the rep outcome |
| `3845ac1` | shell keywords, bare assignments, python heredoc text are not stack commands; regrade keeps failed rows unaccepted | false criticals in D3-C-r1, D3-B-r2 (overlay: both flip to accepted), D2-B-r2 |
| `b6768d3` | aggregate drops pairs/judgments packed from a since-superseded run | E4 r2 pair judged the superseded rerun |
| `ad11069` | judge packets show criticals after the regrade overlay | 15 pairs had judged a false critical shown in `gates.md`; their old judgments moved to `results/judgments-stale-gates.jsonl` and the pairs were re-packed and re-judged (Opus both orders, Fable on the sampled) before the final aggregate |

Other non-defect excluded rows: E1-C-r3 and E3-B-r3 (B/C executor spawned an Opus child, model-rule void, rerun), E5-B-r3 first attempt (SIGTERM at 400 s, no result, rerun), E6-A-r1 two pre-wave-2 smoke rows.

## Caveats

- Hidden `api_mismatch` (E1-E3 and parts of D1) makes acceptance 0/3 in all arms for E1-E3 and for D1; those tasks discriminate only through judge, criticals and scope.
- D2-A-r1, D2-B-r2, D2-C-r1 and E4-B-r2 are failed by 30 to 90 minute timeouts (the debugger loop of `deno task test` on the reaper tests; E4 B busy-wait). They have no judged pair, so the judge tallies for D2 and E4-B rest on fewer pairs; the acceptance gate counts them as failures.
- Executor G5 has a single noisy axis: 8 of 20 B pairs and 7 of 21 C pairs went to A, but B and C also win 9 and 6; the G5 failure is the honesty-loss count (C 20 vs A 10) and the bootstrap upper bound, not a win-count deficit.
- G6 fails everywhere although all B/C first turns are 17-23% smaller; the 0.75 bar needs a 25% cut.
