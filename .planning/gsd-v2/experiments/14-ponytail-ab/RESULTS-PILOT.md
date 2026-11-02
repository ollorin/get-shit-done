# Exp 14: pilot results (2026-11-02)

76 runs on Haiku, $18.42, weekly use 97% to 98%. Rows: `~/ab-eval/results/runs-ponytail.jsonl`. A pilot ships nothing. No blind judges.

## Verdicts

| role | verdict | next |
|---|---|---|
| reviewer | candidate, unproven | Sonnet confirmation, then full A/B |
| test-writer | best candidate, TW2 unusable | fix the TW2 grading fault, then full A/B |
| executor | this draft rejected | do not run a full A/B of it |

## Executor (same-load comparison)

| task | acceptance A | P | P without `git stash list` | median added A / P | mean cost A / P |
|---|---|---|---|---|---|
| E6 | 5/6 | 5/6 | 5/6 | 130 / 115 | $0.14 / $0.11 |
| E7 | 5/6 | 4/6 | 5/6 | 146 / 139 | $0.31 / $0.26 |
| E4 | 2/2 | 3/5 | 5/5 | 195 / 332 | $0.79 / $1.26 |

- Real harm in P: E7 r2 failed hidden tests with the smallest diff of the arm (61 lines, money-adjacent); E6 r1 ran `deno test --no-check` in a scratch copy, a forbidden flag.
- Hidden tests: A 14/14, P 16/17.
- Code volume: small cut on E6 and E7, more code and 60% more cost on E4. E1 (control from 2026-11-01, not same load): 949 vs 1098 lines, hidden tests fail in both arms.
- Reading: our executor gets decomposed plans, where the ladder finds little to cut. This matches the vendor's near-zero effect on surgical tasks. Sample is small; the verdict rests on no gain plus one real failure, not on a statistic.

## Test-writer

| task | acceptance A / P | added A / P |
|---|---|---|
| TW1 | 3/6 / 3/3 | 160 / 107 |
| TW3 | 3/3 / 3/3 | 73 / 63 |
| TW4 | 3/3 / 3/3 | 42 / 33 |
| TW2 | see below | 353 / 347 |

Controls for TW1, TW3, TW4 are from 2026-11-01, so this is not a same-load comparison. The section is scoped to non-T0, yet TW1 and TW3 (T0) also shrank; that may be noise or leakage, and needs a look.

TW2 is unusable: same-load control 0/3, P 1/6, while A was 5/6 on 2026-11-01. Failing check: `pass_on_green` (`ab_role_grade.py:266`), which also zeroes mutant kills. A failed control's test passes on the reference tree when run alone (rc 0, without `.env.test`), so the fault looks environmental; cause unverified. Load is one suspect; TW2 r1 passed and r2 failed four minutes later under similar load, which does not support it strongly. The grader keeps no log of this check: add one first.

Open question: test-writer E was rejected on 2026-11-01 partly on TW2 (0/3 vs 2/3). If this fault was already active, that gate is doubtful. Unverified. Other E failures (honesty, test quality) stand.

## Reviewer (both arms re-run on Haiku)

| task | findings per run Q2 / P | known defects Q2 / P |
|---|---|---|
| R1 | 4.0 / 2.5 | 1/6 / 0/6 |
| R2 | 4.2 / 3.8 | 8/12 / 8/12 |

About 22% fewer findings, recall about level (9/18 vs 8/18). R1 K1 is required and Haiku nearly always misses it in both arms, so this task says little on Haiku; Sonnet found it at 0.83 (`RESULTS-wave3-reviewer.md`, arm A). Whether the dropped findings were empty is unverified: no judge ran. A Haiku result is a signal only.

## Harness lessons

- Controls must run under the same conditions. Controls from the day before made TW2 look like a 5/6 to 1/6 regression caused by P; a same-day control showed otherwise. Round 1 and 2 readings of executor acceptance were also too harsh (5/9 vs 11/11).
- `git stash list` was graded as a bypass (`BYPASS_RE`); fixed. It appeared in 5 P runs and in no same-load A run, reason unknown, harmless.
