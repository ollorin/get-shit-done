# Experiment 13: what Sonnet review rounds after round 5 found

Date: 2026-11-02. Read-only study of `/Users/ollorin/igaming-platform/.planning`. Classes are my own judgement; the severity column is as the review gave it.

## Answer

The data supports an Opus ruling after round 5, and for most plans earlier. It does not support looping to zero automatically.

- Rounds 6+ produced 87 findings: 402-06 R6-R15 (10 rounds), 401-07 L3 R6-R11 (6), 402-07 R6 (1) and 392 R7-R12 (6). None is class (a). Four are class (b), all in 392, all latent: dormant code, an admin-only path, or an unreachable trigger. All 87 are LOW or INFO except 7 MED; none of the 7 could lose money or open access, and the nearest (392 R8-1, class d) fails closed.
- 63% of rounds 6+ findings are class (e), inaccurate doc, cite or SUMMARY text. 76% trace to the previous batch's own edits or to the loop's bookkeeping (tallies, status sentences, commit shas).
- Rounds 1-5 of the same plans: 121 findings, 4 class (a), 17 class (b). The (a) findings sit in rounds 1-2 (402-07 R1, 401-07 L3 R1, 392 R2).
- The only MED-or-higher behaviour defects found after round 5 on the 402/401 plans came from the Opus batched diff review, not from Sonnet rounds. 402-06's Sonnet round 10 reported zero findings; the Opus batch review then found a MED and two more behaviour-relevant items. A Sonnet zero does not mean no bug.
- Caveat on 392: its rounds R7-R12 each reviewed a newly written batch (G-H to G-S), not a repeat review of one diff. Round numbers there overstate how long any single diff was looped.

## Coverage

Covered, every finding read:
- 402-06 R1-R15 (`402-06-SONNET-REVIEW-N.md`), 402-07 R1-R6, 401-07 L3 R1-R11 (`401-07-L3-SONNET-REVIEW*.md`, R-label = round number, base file = R1), the 401-07 final-tree Sonnet review as R0.
- 392 gap-closure `392-GAPCLOSURE-REVIEW-R2..R12` in `.planning/milestones/v0.1.33-phases/392-*/`. This is the only earlier plan with 6+ rounds that the search found: `git log --all --name-only -- '*REVIEW*'` shows 392-03 with 5, 391/386/387 with 3 or fewer.
- Opus references: `402-BATCH-B-OPUS-REVIEW.md`, `401-07-RULING.md` (Batch B), `392-OPUS-RECHECK-GJGK.md`, `402-07` rulings.
- Reviewer transcripts for 33 of the review rounds (token and time), see Q4.

Not covered or incomplete:
- 392 R1 file does not exist on disk. R11 is not a `GAPCLOSURE-REVIEW` file; I used `392-PREVERIFY-3.md` (its R11-1..R11-5) as round 11.
- 401-08 (4 rounds) and 402-08 (1 round) are below the 6-round threshold, read only for headline.
- 400-xx "passes 4-11" (e.g. 400-20) and `.planning/code-review/findings/REVIEW-T*` are sweep passes, not Sonnet review loops; not analysed. Reviews not named `*REVIEW*` are not found by my search.
- Origin tags (FIX / LOOP / OLD / NEW) are per-finding for 402-06, 401-07 and 402-07, and round-level judgement for 392.
- Rounds 1-5 (a) and (b) findings are the reviews' claims; I did not re-trace them except where noted in Q1.
- Fix-batch and coordinator cost is not measured (Q4).

## Class counts

| scope | n | a | b | c | d | e | f | g |
|---|---|---|---|---|---|---|---|---|
| rounds 6+ all | 87 | 0 | 4 | 8 | 3 | 55 | 17 | 0 |
| 402-06 R6-R15 | 28 | 0 | 0 | 2 | 1 | 21 | 4 | 0 |
| 401-07 L3 R6-R11 | 20 | 0 | 0 | 0 | 1 | 16 | 3 | 0 |
| 402-07 R6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 392 R7-R12 | 39 | 0 | 4 | 6 | 1 | 18 | 10 | 0 |
| rounds 1-5 all | 121 | 4 | 17 | 27 | 3 | 51 | 19 | 0 |
| 402-06 R1-R5 | 46 | 0 | 4 | 10 | 1 | 19 | 12 | 0 |
| 401-07 L3 R1-R5 | 28 | 1 | 0 | 5 | 0 | 19 | 3 | 0 |
| 402-07 R1-R5 | 19 | 1 | 2 | 3 | 0 | 12 | 1 | 0 |
| 392 R2-R5 | 28 | 2 | 11 | 9 | 2 | 1 | 3 | 0 |

(g) is 0 everywhere: no finding was withdrawn or disproved by the reviewer. Rounds 6+ by severity: 60 LOW, 20 INFO, 7 MED, 0 HIGH. Rounds 1-5: 87 LOW, 22 MED, 9 INFO, 3 HIGH.

Origin of rounds 6+ findings: FIX 47 (caused by the previous batch or an Opus fix), LOOP 19 (tallies, status, untracked review files), OLD 17 (pre-existing, missed earlier), NEW 4 (defect in newly written code). So 66 of 87 (76%) exist because the loop or a fix ran.

## Per-round trend (findings; classes)

402-06: R1 9 (b2 c2 e1 f4) | R2 13 | R3 8 | R4 9 | R5 7 (e5 f2) | R6 4 (e3 f1) | R7 3 | R8 4 (c1 e2 f1) | R9 2 (e2) | R10 0 | R11 5 | R12 6 | R13 2 | R14 2 | R15 0.
401-07 L3: R1 12 (a1 c4 e5 f2) | R2 5 | R3 2 | R4 1 | R5 8 (e8) | R6 8 (e8) | R7 3 | R8 2 | R9 4 | R10 3 | R11 0.
402-07: R1 5 (a1 b2 c2) | R2 3 | R3 9 (e8 f1) | R4 1 | R5 1 | R6 0.
392: R2 11 (a2 b6) | R3 8 | R4 7 | R5 2 | R6 0 | R7 4 | R8 11 | R9 7 | R10 6 | R11 5 | R12 6.

Behaviour-relevant classes (a, b) vanish after round 2 on 402/401. Test-weakness (c) lasts to round 4-5 on 402-06 and reappears once at R8 and R11. From round 5-6 on, nearly everything is (e)/(f). Two rebounds: 401-07 R5-R6 (8 each) came from the reviewer widening scope to a future plan (`401-22-PLAN.md`) and doc cites, and 402-06 R11-R12 came from the Opus batch fixes.

## Q1: most serious findings in rounds 6+

None would have caused a production incident. The five most serious, with what happens without them:

1. 392 R8-1 (MED, class d, FIX). The market PATCH was made to require `expected_version` while the market GET still selected only `config_key, config_value` (`get-market-config.ts:63` at commit 75a98bc41, traced via `git show`). Without the fix no client could learn the version to send, so market wagering-mode edits through the API would fail closed with 409 or 400. Fail-closed, no money loss; found in code written by the previous batch.
2. 392 R8-2 (LOW, class b, NEW). The G-J RPC compared `v_current_ver <> p_expected_version`; `configurations.version` is `INTEGER DEFAULT 1`, nullable (`apps/api/migrations/20260126100200_configurations_foundation.sql:140`), so a NULL-version row would accept any expected version. Needs a row inserted with an explicit NULL, which only the admin/base-table path can do. Opus re-check later verified the `IS DISTINCT FROM` fix (`392-OPUS-RECHECK-GJGK.md`, "NULL" row).
3. 392 R7-2 (LOW, class b). `player.handle_player_backup_codes_*` triggers: the `service_role` bypass is dead inside SECURITY DEFINER (`20260204110000_fix_2fa_and_session_public_views.sql:67-80`), and the ownership test compares to `player.current_player_id()`, which is `NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID` (`20260130000200_update_rls_policies.sql:85-90`), NULL for a service-role request, so the RAISE is skipped. Not reachable by an attacker because the table grants were revoked from anon and authenticated (`20260923000600_public_relation_grant_hardening.sql`). Defence-in-depth gap, fixed in 5cec86694.
4. 392 R7-1 (LOW, class b). `credential_hash: btoa(credentialValue).slice(0, 8)` was a reversible prefix of the login and threw for non-Latin1 input (`account-takeover-service.ts:614` before 572df1eee). Dormant: `git grep recordFailedLoginFraudEvent` finds only its own unit test (and a coverage file); no production caller. Without the fix: a PII leak and a rejecting fail-open function the day someone wired it.
5. 402-06 R8-1 (MED, class c, FIX). R7-2 made a 28-site `.push` rebinding across six test files; nine edits were in `crash-bet-wallet.integration.test.ts`, which the cited live bucket never ran (`scripts/run-integration-tests.sh:1400,1546` vs `B4B_FILES`). Without the finding the "live-gated" claim stayed untrue. Cites are the review's, not re-traced. The follow-up live run (39 files, 501 s, per R9) passed, so no bug was hiding.

Rounds 1-5 for comparison (review-claimed except where traced). 402-07 R1 F1 (HIGH, a): the new migration copied source bodies and reverted the live RG exclusion list, reopening `gamstop_excluded` and `account_closed` players on three bonus grant paths. Traced: the rewriter `20261004100400_rg_exclusion_lists_canonical_statuses.sql:8-14` exists, and the fix commit is 85695bc36 ("rebased on live bodies"). 401-07 L3 F3 (HIGH, a-latent): `selectStoreAdapter` falls to the mock for any env except exactly `production` (`iap-store-adapter.ts:105-119`); Opus ruled it not exposed (both deploys set both vars) and routed it to 401-16.

## Q2: later Opus review, and what Opus found that Sonnet missed

No round 6+ finding is class (a), so nothing to compare for (a). For the class (b)/(d) items: 392 R8-1, R8-2, R7-1, R7-2 were fixed before the Opus G-J/G-K re-check read the code, so whether Opus would have found them independently is unverified.

Opus found what the Sonnet loops did not:
- 402-05/06 (`402-BATCH-B-OPUS-REVIEW.md`, after Sonnet R10 reported zero): F5 MED, `chain_exhausted` returns 200 with no alert, so a variant silently stops after about 10,000 rounds (`round-lifecycle.ts:133-143` now alerts); F2 LOW, `p_bet_amount` crossed as a JS number while the debit used `toLedgerDecimal(...,8)` (`crash-bet-insert.ts:58`); F6, a status deny-list in plan 402-16. Ten Sonnet rounds, one of them zero, saw none of the three.
- 401-06/07 (`401-07-RULING.md`, Batch B): MED, a same-key retry of an accepted withdrawal re-ran the fraud gate after its own reserve existed and created a new review row instead of the 200 replay (class a, money path; fix b8a9bfb08 with a real-DB RED mutant showing one new queue row); MED, deposit mapped every limits-read error to 422 instead of 503. The earlier Sonnet final review of the tree (10 findings) listed neither. Whether the retry bug existed at that review's HEAD (685a8fe4e) is unverified.
- 392 (`392-OPUS-RECHECK-GJGK.md`, after Sonnet R8 and R9 read the same commits): MED, a `deno check` type error in the e2e fixture that broke every scenario importing it; LOW, audit `new_values` and the RPC return reported a value never stored (F6); LOW, market answered 500 where arena answered 422 (F7); LOW, non-discriminating self-assertion (F2).

Pattern: Sonnet finds record and test-shape defects round after round; Opus, reading across files with design intent, finds the behaviour defects. All of the above came after at least 4 Sonnet rounds on the same plan.

## Q3: how much is fix-induced or documentation churn

- Class (d) plus (e): 58 of 87 (67%). With (f) style items: 75 of 87 (86%).
- By origin, FIX plus LOOP: 66 of 87 (76%). 402-06: 24 of 28 (86%). 392: 32 of 39 FIX at round level. 401-07: 10 of 20 (the other 10 are old wrong cites and plan-text defects in `401-22-PLAN.md`, a plan not yet executed).
- Loop-self-feeding examples: the round-tally and status sentences in `402-06-SUMMARY.md` were found stale in R7, R8, R9, R12, R13, R14 (each fix re-staled them); R7-1 and R12-2 are cites or shas broken by the previous fix; R13-2 and R14-1 are about the sha-count derivation added to answer R12. 401-07 R7, R8, R10 repeat one stale FINAL-CONFIRM sentence three times. Both loops ended only when the status text was reduced to one generated table (402-06 R10) or the claim was removed (R14-1 "No counts are recorded").
- The Opus fixes themselves fed 402-06 R11-R14: R11-2 and R11-3 are errors copied from the Opus text; R11-1 is a `.push` in the new test; R12-2 is eight shas from the worktree used for the fix.
- The single most expensive class-(f) item: R7-2 `.push` rebinding (28 sites, six files, a 501 s live bucket, and the R8-1 finding it caused) for zero behaviour effect. The same `.push` rule was violated again in the next Opus fix (R11-1).

## Q4: cost per round

Measured from reviewer-agent transcripts under `~/.claude/projects/-Users-ollorin-igaming-platform/*/subagents/` (matched by the Write call of each review file; usage deduplicated per message). cacheW = new context written, cacheR = context re-read, out = output tokens. Wall minutes are first to last event of the reviewer only.

| round set | rounds | cacheW | cacheR | out | wall |
|---|---|---|---|---|---|
| 402-06 R1-R5 (avg per round) | 5 | 185k | 2.4M | 23k | 3.2 min |
| 402-06 R6-R15 (avg per round) | 10 | 123k | 1.9M | 14k | 2.2 min |
| 401-07 L3 R6-R11 (avg per round) | 6 | 85k | 1.2M | 12k | 2.0 min |
| 402-07 R6 | 1 | 60k | 0.3M | 3.6k | 0.5 min |
| all 17 rounds 6+ (total) | 17 | 1.80M | 27.0M | 211k | 34.7 min |
| Opus 402 batch B review | 1 | 287k | 11.6M | 47k | 9.3 min |

Per late round that is about 106k new tokens, 12k output, 2 minutes of reviewer time. This is the cheap part. Not measured: the fix-batch agent, the coordinator turns and the live gates after each round. Estimate, unverified: the all-in cost of a late round is 2-3 times the reviewer figure. End to end for 402-06, round 5 batch E landed 19:30 on 2026-11-01 and the Self-Check flipped to PASSED at 21:44 (134 min), of which 68 min is after the Opus review (K1-K4 fixes needed anyway, plus rounds 11-15). 401-07 went from the R5 fix (07:26) to R11 FINAL-CONFIRM (13:52 on the same day), about 6.4 h elapsed, in parallel with other work. Live gates seen in the logs: B3b-wallet 111-191 s, B4b 103-132 s, zero-write-prepass 501 s.

## Q5: recommendation

Rule: stop automatic looping at the first round with no class (a)-(c) finding, and in any case after round 5. At that point an Opus ruling decides whether another round is justified. Do not run another round for (d)/(e)/(f) findings; close them with a mechanical check.

Data behind the threshold: on 402-06 the first round with no (a)-(c) finding is R5 (it had 5 e, 2 f); 401-07 L3 is R3; 402-07 is R3 (R2 had the last (c)); 392 is R6, though its later rounds are new batches. Rounds after those points: 10 on 402-06, 8 on 401-07, 3 on 402-07 (21 reviewer runs). They found 0 class (a)/(b) findings and 4 class (c)/(d) ones (402-06 R8-1, R11-1, R11-4; 401-07 R10-2).

What the Opus ruling should look at:
1. The last round's findings by class. Any (a) or (b) on a money, auth or security path means: fix, then a fresh review scoped to the fix diff only.
2. Whether the previous fix batch touched money, auth, KYC or RNG code. If not, the next round can only find record defects; skip it.
3. Whether the findings are (c): require a recorded mutant kill for the weak assertion instead of another round.
4. Whether the loop is feeding itself: tallies, status sentences, commit shas, line cites. Replace them with a generated table or a script check (cites resolve, shas are ancestors, counts equal the files), run once.
5. The Opus batched diff review is the gate for behaviour defects. Schedule it right after the round-5 decision, not after the loop reaches zero. In 402-06 it ran after R10 and found the only MED; every Sonnet round between R6 and R10 preceded it.

Risk of the rule, named honestly: under "stop at first clean (a)-(c) round, cap 5" the following would not have been found by Sonnet, and would rely on Opus or tests:
- 402-06 R8-1 (live bucket did not run nine edited sites) and R11-4 (plan mutant gap). Neither hid a bug.
- 392 R8-1 (market GET returns no version, fail-closed) and R8-2 (NULL version, admin path). 392 should not be counted by round number: each of its rounds reviewed new code, so the rule would have treated R8 as round 1 of a new diff and still run it.
- Any class (a) that first appears in a late round is possible in principle; the data has none in 17 late rounds on the three main plans, but the sample is three plans in one phase, and Opus rather than Sonnet found the (a) defect in 401. Treat this as strong evidence for 402/401-style plans, weaker for novel domains.

## Findings table

Columns: plan, round, finding id (ids repeat across rounds in 402-07 and 392: read with the round), severity as given, my class, origin (rounds 6+ only; FIX caused by previous batch or Opus fix, LOOP loop bookkeeping, OLD pre-existing, NEW newly written code), summary. Rounds 1-5 have no origin except where marked. 392 R2-R5 ids are lettered in the order of the review table.

| plan | rd | id | sev | class | origin | finding |
|---|---|---|---|---|---|---|
| 402-06 | 1 | F1 | MED | b |  | older stale live round wedges a variant (no alert, HTTP 200) |
| 402-06 | 1 | F2 | MED | b |  | RPC error.message reaches response body |
| 402-06 | 1 | F3 | MED | c |  | tests miss the plan threat model / mutants |
| 402-06 | 1 | F4 | LOW | f |  | fmt drift |
| 402-06 | 1 | F5 | LOW | c |  | CS2 leaks holder tx on assertion failure |
| 402-06 | 1 | F6 | LOW | f |  | .push in new tests |
| 402-06 | 1 | F7 | LOW | f |  | RPC returns unused crash_point |
| 402-06 | 1 | F8 | LOW | e |  | stale prose |
| 402-06 | 1 | F9 | INFO | f |  | process note |
| 402-06 | 2 | N1 | MED | e | FIX | docs/comments describe superseded 001300 |
| 402-06 | 2 | N2 | LOW | b |  | sibling outage arms still 200 |
| 402-06 | 2 | N3 | LOW | b |  | startRound trusts malformed reply |
| 402-06 | 2 | N4 | LOW | c |  | failing CS2 turns 6 tests red |
| 402-06 | 2 | N5 | LOW | f |  | .push in new test |
| 402-06 | 2 | N6 | LOW | e |  | F5 half-fixed, SUMMARY says fixed |
| 402-06 | 2 | N7 | LOW | e |  | stale header comments |
| 402-06 | 2 | N8 | LOW | e |  | SUMMARY numbers/cites wrong |
| 402-06 | 2 | N9 | LOW | e |  | commit table contradicts token |
| 402-06 | 2 | N10 | LOW | f |  | missing trailer |
| 402-06 | 2 | N11 | LOW | e |  | supersede note overstates |
| 402-06 | 2 | N12 | INFO | f |  | clean-room provenance |
| 402-06 | 2 | N13 | INFO | c |  | MS6/active-only mutant |
| 402-06 | 3 | P1 | MED | c |  | abort in shared test helper left unfixed |
| 402-06 | 3 | P2 | LOW | c |  | .maybeSingle vs .single unpinned |
| 402-06 | 3 | P3 | LOW | c |  | mutant sets miss 2 conditions |
| 402-06 | 3 | P4 | LOW | d | FIX | SUMMARY cites stale after B2 |
| 402-06 | 3 | P5 | LOW | e | FIX | SUMMARY self-contradiction |
| 402-06 | 3 | P6 | LOW | e |  | worker doc omits 503 |
| 402-06 | 3 | P7 | INFO | f |  | pre-existing .push |
| 402-06 | 3 | P8 | INFO | f |  | edge down at end |
| 402-06 | 4 | Q1 | MED | e |  | Deviation 23 final while Opus ruling pending |
| 402-06 | 4 | Q2 | LOW | e |  | embedded query output unsupportive |
| 402-06 | 4 | Q3 | LOW | e |  | commit table omits commits |
| 402-06 | 4 | Q4 | LOW | c |  | abort plumbing mutants survive |
| 402-06 | 4 | Q5 | LOW | c |  | sibling caller lacks signal |
| 402-06 | 4 | Q6 | LOW | c |  | 1 s grace may be short |
| 402-06 | 4 | Q7 | LOW | e |  | reused test id |
| 402-06 | 4 | Q8 | LOW | e |  | stale comment |
| 402-06 | 4 | Q9 | INFO | f |  | mutant evidence lacks command |
| 402-06 | 5 | S1 | LOW | e |  | batch D not in SUMMARY |
| 402-06 | 5 | S2 | LOW | e | FIX | SUMMARY numbers stale |
| 402-06 | 5 | S3 | LOW | e |  | commit table omission |
| 402-06 | 5 | S4 | LOW | f |  | .push class unrecorded |
| 402-06 | 5 | S5 | LOW | f |  | sweep file over LOC ceiling |
| 402-06 | 5 | S6 | INFO | e |  | stale DIAGNOSIS sentences |
| 402-06 | 5 | S7 | INFO | e |  | round tallies missing |
| 402-06 | 6 | R6-1 | LOW | e | OLD | claim has no on-disk log |
| 402-06 | 6 | R6-2 | INFO | e | FIX | off-by-one cite |
| 402-06 | 6 | R6-3 | INFO | e | OLD | "byte-identical" overstates |
| 402-06 | 6 | R6-4 | INFO | f | OLD | .push siblings in RS-PC files |
| 402-06 | 7 | R7-1 | LOW | e | FIX | cites stale after R6-4 |
| 402-06 | 7 | R7-2 | LOW | f | OLD | .push in 402-authored tests (28 sites rebound) |
| 402-06 | 7 | R7-3 | LOW | e | LOOP | round 6 tally not recorded |
| 402-06 | 8 | R8-1 | MED | c | FIX | 9 rebinds in a file the cited live gate never ran |
| 402-06 | 8 | R8-2 | LOW | e | LOOP | batch H status text stale |
| 402-06 | 8 | R8-3 | LOW | e | LOOP | 402-05 review status stale |
| 402-06 | 8 | R8-4 | LOW | f | LOOP | review files untracked |
| 402-06 | 9 | R9-1 | LOW | e | LOOP | "rounds 1-4" survives in 3 sentences |
| 402-06 | 9 | R9-2 | LOW | e | LOOP | round 8 tally absent |
| 402-06 | 11 | R11-1 | LOW | d | FIX | .push in new K2 test (Opus F5 fix) |
| 402-06 | 11 | R11-2 | LOW | e | FIX | cites off by one, copied from Opus text |
| 402-06 | 11 | R11-3 | LOW | e | FIX | "no code path writes" overbroad (Opus text) |
| 402-06 | 11 | R11-4 | LOW | c | FIX | plan T5: no mutant kills over-redaction after F6 |
| 402-06 | 11 | R11-5 | LOW | e | LOOP | status/pending stale after K1/K2 |
| 402-06 | 12 | R12-1 | LOW | e | LOOP | no round 10 row |
| 402-06 | 12 | R12-2 | LOW | e | FIX | 8 worktree shas not on branch |
| 402-06 | 12 | R12-3 | LOW | e | FIX | duration mixed |
| 402-06 | 12 | R12-4 | LOW | e | FIX | undefined pending clause |
| 402-06 | 12 | R12-5 | LOW | e | FIX | JSDoc still false after F1 |
| 402-06 | 12 | R12-6 | LOW | f | LOOP | review files untracked |
| 402-06 | 13 | R13-1 | LOW | e | LOOP | placeholder "SUMMARY commit" |
| 402-06 | 13 | R13-2 | INFO | e | LOOP | sha token count not reproducible |
| 402-06 | 14 | R14-1 | LOW | e | LOOP | sha totals copied not derived |
| 402-06 | 14 | R14-2 | LOW | e | LOOP | status says post-L round pending |
| 401-07 | 1 | F1 | MED | c |  | path ceiling: aggregate bucket slack |
| 401-07 | 1 | F2 | MED | c |  | fp-gate regex misses generic fromPromise<T>( |
| 401-07 | 1 | F3 | HIGH | a |  | pre-existing: unset NODE_ENV serves mock IAP verifier (Opus: not exposed, routed to 401-16) |
| 401-07 | 1 | F4 | LOW | e |  | stale comment |
| 401-07 | 1 | F5 | LOW | e |  | stale deferral record |
| 401-07 | 1 | F6 | LOW | e |  | mutant evidence incomplete |
| 401-07 | 1 | F7 | LOW | e |  | stale cites |
| 401-07 | 1 | F8 | LOW | c |  | warn untested |
| 401-07 | 1 | F9 | LOW | f |  | test style |
| 401-07 | 1 | F10 | LOW | c |  | no decoy control |
| 401-07 | 1 | F11 | LOW | f |  | fmt reflow noise |
| 401-07 | 1 | F12 | LOW | e |  | count unreconciled |
| 401-07 | 2 | R2-1 | MED | e | FIX | 60+ doc cites shifted without re-trace |
| 401-07 | 2 | R2-2 | LOW | c |  | vacuous path ceiling |
| 401-07 | 2 | R2-3 | LOW | e | FIX | stale number in canary |
| 401-07 | 2 | R2-4 | LOW | e | FIX | stale reconciliation figure |
| 401-07 | 2 | R2-5 | LOW | f | FIX | .push in new test |
| 401-07 | 3 | R3-1 | LOW | e | FIX | wrong cite |
| 401-07 | 3 | R3-2 | LOW | e | FIX | doc self-contradiction |
| 401-07 | 4 | R4-1 | LOW | e | FIX | mislabelled cite |
| 401-07 | 5 | R5-1 | MED | e | OLD | wrong cite in fraud-prevention.md |
| 401-07 | 5 | R5-2 | LOW | e | OLD | wrong cite |
| 401-07 | 5 | R5-3 | LOW | e | OLD | wrong cites |
| 401-07 | 5 | R5-4 | LOW | e | OLD | claim contradicted by trace (cite) |
| 401-07 | 5 | R5-5 | LOW | e | OLD | cite to missing evidence |
| 401-07 | 5 | R5-6 | LOW | e | LOOP | SUMMARY not updated to rounds |
| 401-07 | 5 | R5-7 | LOW | e | FIX | stale cites |
| 401-07 | 5 | R5-8 | LOW | e | OLD | 401-22 plan task conflicts |
| 401-07 | 6 | R6-1 | MED | e | OLD | 401-22 plan circularity (future plan) |
| 401-07 | 6 | R6-2 | LOW | e | OLD | 401-22 plan fmt scope |
| 401-07 | 6 | R6-3 | LOW | e | OLD | 401-22 stale count |
| 401-07 | 6 | R6-4 | LOW | e | OLD | 401-22 deleted-path executability |
| 401-07 | 6 | R6-5 | LOW | e | OLD | wrong cite |
| 401-07 | 6 | R6-6 | LOW | e | OLD | wrong path/cites |
| 401-07 | 6 | R6-7 | LOW | e | OLD | wrong cite |
| 401-07 | 6 | R6-8 | LOW | e | LOOP | SUMMARY HEAD label; DIAG file untracked |
| 401-07 | 7 | R7-1 | MED | e | OLD | 401-22 plan scope gap (touched-list) |
| 401-07 | 7 | R7-2 | LOW | e | LOOP | FINAL-CONFIRM sentence stale |
| 401-07 | 7 | R7-3 | LOW | e | LOOP | contradictory "Open at close" |
| 401-07 | 8 | R8-1 | LOW | e | LOOP | same stale sentence again |
| 401-07 | 8 | R8-2 | LOW | f | OLD | deno fmt drift on touched files |
| 401-07 | 9 | R9-1 | MED | f | OLD | deno fmt fails on 5 files |
| 401-07 | 9 | R9-2 | LOW | e | LOOP | SUMMARY stale vs landed splits |
| 401-07 | 9 | R9-3 | LOW | e | FIX | line cites broken by split+fmt |
| 401-07 | 9 | R9-4 | LOW | e | FIX | plans cite pre-split lines |
| 401-07 | 10 | R10-1 | MED | f | FIX | fmt fails on 2 e2e tests after edits |
| 401-07 | 10 | R10-2 | LOW | d | FIX | lost space in test title from fix 460f388f5 |
| 401-07 | 10 | R10-3 | LOW | e | LOOP | tally stops at R7 |
| 402-07 | 1 | F1 | HIGH | a |  | forward+ROLLBACK revert live RG exclusion list (gamstop/account_closed bypass on 3 bonus grant paths) |
| 402-07 | 1 | F2 | HIGH | b |  | migration slot below branch max (cannot apply) |
| 402-07 | 1 | F3 | MED | b |  | ROLLBACK asserts stale search_path |
| 402-07 | 1 | F4 | MED | c |  | FC1 tests depend on unstated 2nd campaign |
| 402-07 | 1 | F5 | LOW | c |  | no TEARDOWN test |
| 402-07 | 2 | G1 | MED | e |  | post-RED assertion edit lacks Opus ruling |
| 402-07 | 2 | G2 | LOW | e |  | no raw probe output |
| 402-07 | 2 | G3 | LOW | c |  | null branch of gate never executed |
| 402-07 | 3 | F1 | MED | e |  | shas not on branch |
| 402-07 | 3 | F2 | MED | e |  | doc misleading |
| 402-07 | 3 | F3 | LOW | e |  | RED-era lines |
| 402-07 | 3 | F4 | LOW | e | LOOP | round numbers outside table |
| 402-07 | 3 | F5 | LOW | e |  | placeholder |
| 402-07 | 3 | F6 | LOW | e |  | header total |
| 402-07 | 3 | F7 | LOW | e |  | sweep cites |
| 402-07 | 3 | F8 | LOW | e |  | bucket seconds |
| 402-07 | 3 | F9 | INFO | f |  | timestamps |
| 402-07 | 4 | G1 | LOW | e | LOOP | BATCHES total mismatch |
| 402-07 | 5 | H1 | LOW | e | LOOP | "Verified now" is an earlier tree |
| 392 | 2 | a | MED | b |  | games-crud public GET 503 on Redis blip |
| 392 | 2 | b | MED | a |  | strict limiter check-then-record not atomic: burst exceeds 5/900s TOTP step-up and mail caps (as claimed) |
| 392 | 2 | c | MED | c |  | secdef audit script ignores PROCEDURE |
| 392 | 2 | d | MED | b |  | OTP claim spent before send; failed send leaves 409 |
| 392 | 2 | e | LOW | b |  | catch-up outage mapped to 429 |
| 392 | 2 | f | LOW | b |  | 409 vs 429 inconsistent |
| 392 | 2 | g | LOW | a |  | invalidateSessionRow catch dead, failure silent (as claimed) |
| 392 | 2 | h | LOW | b |  | pre-revoke before validation |
| 392 | 2 | i | LOW | b |  | pulse write awaited w/o deadline |
| 392 | 2 | j | LOW | f |  | step-up counts successes (as ruled) |
| 392 | 2 | k | LOW | c |  | mock evalIncrTtlRearm diverges |
| 392 | 3 | a | MED | c |  | tripwire PASSes on missing input |
| 392 | 3 | b | LOW | b |  | claim release unconditional DEL |
| 392 | 3 | c | LOW | e |  | false comment |
| 392 | 3 | d | LOW | b |  | step-up reset lets thief refill guesses |
| 392 | 3 | e | LOW | c |  | error-echo scan covers 5 handlers |
| 392 | 3 | f | LOW | b |  | local reset mail unconfigured |
| 392 | 3 | g | LOW | c |  | tripwire partial cover |
| 392 | 3 | h | LOW | c |  | burst test only vs single-threaded mock |
| 392 | 4 | a | MED | b |  | OPERATOR_APP_URL in wrong config.toml table |
| 392 | 4 | b | MED | d | FIX | operator modal matched error text G-F removed |
| 392 | 4 | c | LOW | b |  | RG tokens fall to generic text |
| 392 | 4 | d | LOW | c |  | tripwire stripper lexical |
| 392 | 4 | e | LOW | f |  | redis-client over LOC ceiling |
| 392 | 4 | f | LOW | d | FIX | RG block reason lost on dice/plinko path |
| 392 | 4 | g | LOW | f |  | duplicate const |
| 392 | 5 | a | LOW | c |  | 2 modal branches untested |
| 392 | 5 | b | LOW | c |  | backtick swallow, no canary |
| 392 | 7 | R7-1 | LOW | b | NEW | reversible credential prefix in fraud event; no production caller (git grep) so dormant |
| 392 | 7 | R7-2 | LOW | b | OLD | backup-code triggers: service-role bypass dead, NULL compare skips RAISE; table grants revoked so not reachable |
| 392 | 7 | R7-3 | LOW | f | OLD | 22 dead service_role blocks |
| 392 | 7 | R7-4 | INFO | f | OLD | uncommitted config.toml hunk, not 392 |
| 392 | 8 | R8-1 | MED | d | FIX | market PATCH requires expected_version, GET returns none |
| 392 | 8 | R8-2 | LOW | b | NEW | NULL version bypasses precondition (admin-insert path) |
| 392 | 8 | R8-3 | LOW | b | NEW | expected_version > 2^31 gives 500 not 400 |
| 392 | 8 | R8-4 | LOW | e | FIX | SQLSTATE deviation unruled |
| 392 | 8 | R8-5 | LOW | e | FIX | stale comment 40001 |
| 392 | 8 | R8-6 | LOW | c | NEW | self-assertion omits owner/service_role EXECUTE |
| 392 | 8 | R8-7 | INFO | c | FIX | weaker A2 blocked-proof |
| 392 | 8 | R8-8 | INFO | f | FIX | comment |
| 392 | 8 | R8-9 | INFO | f | FIX | process note |
| 392 | 8 | R8-10 | INFO | f | FIX | no secrets |
| 392 | 8 | R8-11 | INFO | f | FIX | rollback unexecuted |
| 392 | 9 | R9-1 | LOW | c | FIX | market GET select not pinned |
| 392 | 9 | R9-2 | LOW | c | FIX | cap cases only on arena tests |
| 392 | 9 | R9-3 | LOW | c | FIX | self-assertion has no demonstrated failure |
| 392 | 9 | R9-4 | LOW | e | FIX | deviation awaits Opus |
| 392 | 9 | R9-5 | INFO | e | FIX | probe overstated |
| 392 | 9 | R9-6 | INFO | e | FIX | doc bound |
| 392 | 9 | R9-7 | INFO | f | FIX | LOC/secrets note |
| 392 | 10 | R10-1 | MED | e | FIX | claimed mutation records not on disk |
| 392 | 10 | R10-2 | LOW | e | FIX | market doc lacks step 0/409/422 |
| 392 | 10 | R10-3 | LOW | e | FIX | error-code table incomplete |
| 392 | 10 | R10-4 | LOW | c | FIX | encoded key vs unencoded lookup in test helpers |
| 392 | 10 | R10-5 | INFO | f | FIX | log tag |
| 392 | 10 | R10-6 | INFO | e | FIX | stale OPEN section |
| 392 | 11 | R11-1 | LOW | e | FIX | doc bound off by one |
| 392 | 11 | R11-2 | LOW | e | FIX | restored-GREEN evidence incomplete |
| 392 | 11 | R11-3 | LOW | e | FIX | expected/actual inverted in log |
| 392 | 11 | R11-4 | INFO | e | FIX | Self-Check heading |
| 392 | 11 | R11-5 | INFO | e | FIX | deferred items/LOC headroom |
| 392 | 12 | R12-1 | LOW | e | FIX | "seven findings" should be six |
| 392 | 12 | R12-2 | LOW | e | FIX | G-Q heading vs FAILED verdict |
| 392 | 12 | R12-3 | LOW | e | FIX | byte-diff proof absent |
| 392 | 12 | R12-4 | INFO | e | FIX | attribution |
| 392 | 12 | R12-5 | INFO | f | FIX | duplicate line |
| 392 | 12 | R12-6 | INFO | f | FIX | handler-to-handler import |