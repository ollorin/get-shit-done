# Experiment 12 - mutation-based test redundancy (pilot, measurement only)

Status: PARTIAL. Nothing deleted or edited in igaming-platform (worktree `.tmp/wt-redundancy` at de2d2b1de, removed; `git worktree list` clean). Stopped early on the coordinator's quota instruction. Not done: domain coverage floor (no coverage run was made), manual reading of the money-path module, cross-file pass for the pilot. No LLM tokens are spent by the mutation runs themselves.

## Method and tooling
- Tool: `scripts/gsd-mutate/` runs the mutants and gives per-case data for free: `failing_tests` on a confirmed kill lists the failing BDD steps / `Deno.test` names (kill = fails in both runs). No change to gsd-mutate was needed. Matrix granularity is the test case (`it`/step/`Deno.test`).
- gsd-mutate does not generate mutants. Harness (fork, `scripts/test-redundancy/`): `lib.ts` (operator-based generator, case discovery from `deno test` output, kill matrix, greedy cover with LOC tie-break), `run.ts` (generate, run gsd-mutate, build matrix; `--cross N` re-runs mutants against other unit test files), `reduce.ts` (build a reduced test copy), `batch.sh`/`go.sh`, `aggregate.py`, `selftest.ts` (12 cases: `deno test --allow-read scripts/test-redundancy/selftest.ts`, green). `reduce.ts` is selftested but was not used.
- Operators: eq/and-or/not-drop/cmp/arith/num+1/bool, if-condition true/false/negate, isOk/isErr, some/every, max/min, `??`-left, call-statement delete, `undefined as never` for object property values and `return` values (type-preserving), prose-string emptying. Missing: argument drop, ternary swap, array/loop mutations, regex changes beyond digit bumps.
- Test runs: `deno test --allow-all --env-file=.env.test <file>` inside the worktree (copy of the local env file; values not recorded). Evidence per module in `<module>/` (`mutants.json`, `mutate.jsonl` + `mutate.jsonl.run.json`, `summary.json`, `matrix.tsv`); all runs `exit_code 0`, both baselines green.

## Module choice (measured from disk)
Scanned co-located `*.test.ts` with a sibling source in `apps/api/libs` and `functions` (471 pairs overall: 208,158 test LOC vs 104,614 source LOC; all 1,046 test files = 659,825 LOC, so co-located unit pairs are 31% of test LOC; the rest are integration/stack tests this method cannot reach cheaply). Filter: no DB/Redis/network, not money/auth/KYC, logic not a barrel. Ranked by test LOC / source LOC: `result.test.ts` (23x) is a test of neverthrow/ts-pattern through a 22-line re-export (0 mutable sites; the "pure barrel" class in the rules), `two-factor-facade`/`middleware` need Redis/auth. Pilot = `libs/infrastructure/src/lib/response/fp-utilities.ts` (163 LOC) with its test (554 LOC, 34 cases, ratio 3.4, highest eligible). Money-path second module = `functions/payments/services/withdrawal-settlement.test.ts` (1,797 LOC, ratio 4.0) mutated across its 5 source files (settlement, session-claim, release, reversal, payout-error-classification) because the test file exercises all five (a settlement-only first run left 13 cases at 0 kills purely for that reason).
Iteration note: my first generator (comparison/string operators only) produced 10 mutants on the pilot and 25 of 40 type-check kills on region-gate; adding the type-preserving operators raised the pilot to 36 mutants. Operator set drives everything below.

## Per-module numbers (all unit, in-file matrix; `zero-unique` = kills nothing the other cases in the same file do not also kill)
| module | src/test LOC | cases | mutants | killed (tests) | killed (type-check) | survived | module-level kills | zero-kill cases | zero-unique cases | greedy keep | droppable cases | droppable case LOC / all case LOC | ms per mutant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| better-stack-shipper | 110/303 | 24 | 32 | 25 | 0 | 7 | 1 | 2 | 17 | 9 | 15 | 105 / 181 | 101 |
| coin-selection | 120/393 | 23 | 63 | 35 | 26 | 2 | 0 | 3 | 16 | 9 | 14 | 100 / 182 | 503 |
| deletion-schedule | 49/157 | 16 | 26 | 16 | 10 | 0 | 0 | 3 | 15 | 5 | 11 | 98 / 129 | 96 |
| evaluate-region-gate | 89/297 | 18 | 51 | 28 | 16 | 7 | 0 | 2 | 15 | 5 | 13 | 149 / 211 | 264 |
| evaluate-wagering-mode | 117/339 | 17 | 53 | 28 | 24 | 1 | 0 | 1 | 14 | 5 | 12 | 130 / 179 | 469 |
| fp-utilities | 163/554 | 34 | 36 | 16 | 14 | 6 | 0 | 7 | 32 | 6 | 28 | 312 / 392 | 405 |
| iap-store-adapter | 120/480 | 28 | 25 | 16 | 5 | 4 | 0 | 11 | 26 | 4 | 24 | 225 / 265 | 297 |
| iso-date | 42/115 | 55 | 83 | 59 | 14 | 10 | 0 | 2 | 50 | 14 | 41 | 48 / 62 | 118 |
| structured-logger | 77/236 | 16 | 33 | 19 | 6 | 8 | 0 | 1 | 12 | 5 | 11 | 123 / 180 | 141 |

Money-path family (`withdrawal-settlement`, 5 source files), raw numbers only, cases NOT read: 479 mutants = 133 killed by tests, 195 killed only by type-check, 151 survived (31.5% of all mutants; 53% of the 284 that reached a test). Mutant time 350 s total (mean 0.73 s; killed 0.89 s incl. the confirming second run, type-check 0.43 s, survived 0.99 s). Per-case matrix was not recomputed after the multi-source rerun (the run hit the 30-minute background limit during its cross pass, before `summary.json` was written; the stale single-source summary was deleted). Cross pass partial: 7 other test files tried, 3 ran 284 mutants (kills 24 / 45 / 95 of 284), 3 produced nothing (baseline not green or skipped), 1 incomplete. A first single-source run (settlement file only, 116 mutants) is superseded. `iap-store-adapter` (money path, 25 mutants, 11 of 28 cases kill nothing) and `coin-selection`/`evaluate-wagering-mode` (money-adjacent) rows above are in-file only and unread.

## Pilot (fp-utilities): numbers
36 mutants: 16 killed by tests, 14 type-check only, 6 survived. 34 cases: 7 kill nothing, 32 have zero unique kills. Greedy minimal set = 6 cases (80 LOC) keeps all 16 kills; the other 28 cases = 312 of 392 case LOC (80%; whole file 554 LOC, the rest is fixtures/helpers that stay). Before reading: 28 of 34 cases removable.

### After reading all 28 candidates
- redundant: 21 (219 LOC): parseRequestBody x5 (invalid-JSON tag, generic type, two `expect*Async` helper cases, empty body), validateRequest x9 (valid input, all issues, empty object, three `expect*` helper cases, null, undefined, accumulate), validateRequestAsync x4 (same-as-sync, invalid async, andThen chain, parse-failure pipeline), checkRateLimitFP x3 (ok, RateLimitError, short-circuit).
- guards something no mutant exercised: 6 (the happy-path body passthrough, `null` JSON body is Ok, the `"."` separator of nested paths (a hand mutant `join("/")` was killed by this case only; no generated mutant touches that short string), `statusCode 400` and `AUTH_005/429` (defined in other modules), and `{identifier}` forwarded as the 3rd `checkLimit` argument (auth rate-limit contract; no argument-drop operator)).
- unclear: 1 (`handle limiter errors gracefully`). The greedy set kept `preserve error cause`, whose assertions sit inside `if (result.isErr())` and pass vacuously if the code returned Ok; this dropped case asserts `isErr()` first. Greedy with a LOC tie-break picked the weaker twin.
Honest share: 28/34 (82%) candidates by mutants; 21/34 (62%, 219 of 392 case LOC = 56%) after reading. The reading removed 7 of 28. Two further limits: only direct-import test files were searched for cross-file overlap (none exist for this module; indirect users via the `@igaming/infrastructure` barrel were NOT checked in the pilot run), and 6 survivors are the opposite problem (below).

### Survivors (tests missing, pilot)
`field: "body"` and the invalid-JSON `message` unpinned (M001-M003), Zod `issue.message` passthrough unpinned (M011), the whole `result.unavailable -> RedisUnavailableError` branch is untested (M028, M030). Other modules: structured-logger boundary values (8000/200/500/1000 limits, `<=`), iso-date `oh <= 14` boundary; several survivors there are equivalent (dead defaults). Withdrawal family: 151 survivors, payout request fields (amount/currency/idempotencyKey/destination) and several CRITICAL log messages not pinned by this file (from the first run; other test files may kill them: cross pass incomplete).

## Method check
- Type-check kills are not test kills: 15-55% of generated mutants die in the compiler (withdrawal family 41%), so typed tag/branch tests are partly redundant with the types by construction; those cases were not counted as unique kills.
- Zero-kill happy-path tests are normal: a mutation set with no site on a pass-through line makes the only test of it look useless. Manual share must be reported with the number (above).
- A kill by module-level failure (`uncaught error`, e.g. better-stack-shipper M010) cannot be attributed to a case.
- Table-driven files (iso-date: 55 generated cases, 14 in the greedy set) have no per-case LOC; row LOC is estimated as 1.
- Within-file only for all but the family; deletion needs the cross-file pass (barrel users included) before it means anything.
- Bug fixed on the way: cases that print console output are opened and closed on separate lines in Deno output (first parser lost them, causing 3 unattributed kills). Selftested.

## Cost and projection (measured, extrapolated; unverified beyond the stated inputs)
- Measured: 0.1-0.5 s/mutant for small unit modules, 0.73 s mean for the family; end-to-end per module 5-21 s including baselines for ~25-80 mutants; the family took ~5 min main pass and ~25 min for 7 cross files (cross costs ~5x the main pass).
- Mutants per source LOC: 0.2-2.0, family 0.32. Whole co-located unit suite: 104.6k source LOC x ~0.35 = ~37k mutants x ~0.7 s = ~7 h sequential, one process (no cross pass); with 8 cross files each ~40 h. Parallel needs one worktree per worker (gsd-mutate README). Compute quota: none (no LLM). The LLM cost is the case reading: ~12k cases (471 files x ~25, rough), ~80% candidates, ~1.5k tokens each = ~14M tokens if every candidate were read (guess). Do not read all; see below.
- Stack-bound tests (integration, the bulk of test LOC) are out of reach at this price: experiment 05 measured ~2.3 min per live mutant.

## Domain coverage floor
Not measured. Plan for the next run: copy the reduced file beside the original (`reduce.ts`), run `libs/infrastructure` unit tests with coverage twice (full vs `--ignore=<original>` plus reduced copy) under CI-equivalent env (SUPABASE_* empty), compare lines against the recorded 88.5 / 91.3 baseline. `.env.cov` for that existed in the worktree (removed with it). Established instead: by mutants alone nothing can be said about line coverage; the pilot's 6 kept cases still run every branch except the `unavailable` branch, which no case runs today.

## Recommendation
1. Value is in the survivors and in a ranked candidate list, not in a flat deletion count: 151 survivors on one money family and 6 on the pilot show missing tests are the larger problem than redundant ones.
2. Wider run only for unit pairs, cheaper variant first: in-file matrix, no cross pass, no reading; rank files by droppable-LOC and by `zero-unique / cases`. ~7 h of machine time, no quota. Then run the cross pass (barrel users via identifier grep, unit-only filter is in `run.ts`) and the coverage check only for the top ~30 files.
3. Reading is required before any deletion (21 of 28 confirmed in the pilot, 7 were not redundant or unclear); cap it to the top files.
4. Approval: deletions need a cited covering test or mutant id (testing.md Test Economy), coverage floor unchanged per domain, and an Opus ruling for anything on a money/auth path (wallet|payment|withdraw|settle|payout|session ...); the money family above is T0 and must not be reduced on this evidence. Deletions of barrel/library re-test files (e.g. `result.test.ts`) wait for the Phase 418 exclusion list.
5. Improve before scaling: add argument-drop, ternary-swap and per-regex operators (sites that made good tests look useless), report a "mutant-poor module" flag (<20 mutants or <50% test-killed) and skip those.
