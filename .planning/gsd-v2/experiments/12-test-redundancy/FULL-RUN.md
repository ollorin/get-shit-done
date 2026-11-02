# Exp 12: full mutation matrix (2026-11-02)

Base `b9c4b6db0`. Data: `.tmp/gsd-v2/redundancy-full/` in the igaming repo; per-module figures in `full-run/modules.json`. No tokens used. Shallow reading only: no test was read and nothing is deleted.

435 co-located unit pairs: 368 measured, 67 not (59 baseline failed, 7 file error, 1 timeout). The 67 are a gap, not a finding.

| | all | high-stakes paths | other |
|---|---|---|---|
| pairs | 368 | 266 | 102 |
| test LOC / source LOC | 138,081 / 76,293 (1.81) | 106,673 / 55,012 (1.94) | 31,408 / 21,281 (1.48) |
| test cases | 6,928 | 5,046 | 1,882 |
| mutants | 30,580 | 21,786 | 8,794 |
| killed by tests | 38% | 36% | 41% |
| killed by the type check | 28% | 30% | 24% |
| survived | 34% | 33% | 35% |
| cases the matrix calls droppable | 4,437 (64%) | 3,307 | 1,130 |
| their LOC | 48,279 | 37,505 | 10,774 |
| cases killing no mutant | 1,203, 12,012 LOC | 949 | 254 |

"High-stakes" is a path-name regex, so it is approximate.

## Reading

- 64% is a ceiling, not a deletion list. `--cross 0` only tests each case against its sibling source; a case may guard another module. In the fp-utilities pilot, reading kept 7 of the 28 flagged cases.
- Both problems are real at once: many tests add nothing unique, and a third of mutants survive. More tests have not closed the gaps. Deleting and adding need to be one effort.
- 28% of mutants die at the type check, so a test aimed at those adds nothing.
- Largest droppable LOC, non-money: `configurations/arena-validation.ts` 1,068, `player-management-service.ts` 503, `resolve-wagering-mode.ts` 430. Money or game: `blackjack-handlers.ts` 1,322, `session-handlers.ts` 1,215, `wallet/operator-handlers.ts` 1,013.
- Most survivors: `payments/operator-transactions.ts` 236, `security/rate-limiter.ts` 235, `cache/redis-client.ts` 223.

## Next

Pilot deletion on 2-3 non-money modules: agents read flagged cases, run the cross-file check and coverage, delete, compare. Money paths need an Opus ruling. Survivors on money and security paths go to the test-writer as a separate list; unread survivors are not yet bugs.
