# M-06 summary: risk domains (E4) and owner title (E5)

Branch `exp/agnostic`. Executor Sonnet 5.5. Tasks 6.1, 6.2, 6.3, 6.5 done; 6.4 (Fable review) dropped, the coordinator runs one review. Review rounds and the full suite: not run (coordinator).

## Commits

| Task | Commit | New/updated tests |
|---|---|---|
| 6.1 | dcaf92f | R-a, R-b, R-c, R-d (project-context.test.js), R-e (gsd-tools.test.js), R-g, R-h (preset-igaming.test.js); 3 length asserts 10 to 9 |
| 6.2 | a0280be | counts below |
| 6.3 | e98daa4 | R-f: 8 files x 3 sentences, planner obligations, brief template heading |
| 6.5 | 9d711e1, then the gsd-demo.md commit | owner-title render test, owner-answer test, 2 N3 rows |

Lint: `ok (613 denied, 364 allowed)`. Targeted tests green: project-context, preset-igaming, decisions, gsd-protect-managed-files, prompt-budget, project-profile, eval-harness, and the gsd-tools.test.js rows for computeHighRisk / the config defaults.

## 6.1 mutants (all killed)

- m1 `security` dropped from the always-list: 6 failures.
- m2 source forced to `brief`: 3 failures.
- m3 de-duplication made case-sensitive: 1 failure (R-c).
- m4 use site ignores the brief domains (`riskDomains` spread removed): R-e fails.

Files restored byte-identical (`cmp`).

## Per-file counts (lines of money/reg/game/owner removed)

Agents: planner 10, plan-checker 5, test-writer 2, phase-coordinator 6, verifier 4, e2e-test-generator 9, roadmapper 4, ui-inventory 3, qa-analyst 2, product-investigator 3, demo 5, discovery-synthesizer 1; generate-e2e-coverage 3. References: decisions-protocol 15, coordinator-detail 11, verifier-detail 6, planner-detail 6, checkpoints 2, gsd-test-protocol 1, verification-patterns 1. Workflows: execute-phase 4, prd 5, plan-phase 2, new-milestone 2, audit-milestone 2, execute-roadmap 3, demo 1. Commands: decide, demo, prd. bin: decisions.js 3, knowledge-synthesis.js 1, gsd-tools.js 1 comment.

## Deviations

1. **Not at zero (generic lists, left for 7.1):** `gsd-tools.js:7070` (`DOC_KEYWORD_SIGNAL_RE`, `payment`), `:7815` (`SENSITIVE_LONG_RE`, money/reg/game words), `gsd-circuit-breaker.js:18` and `gsd-validator.js:27` (`payment` in complexity keyword lists), `workflows/execute-plan.md:484` (table that mirrors `:7070`). They are regex/keyword vocabularies, not comments. `SENSITIVE_PATH_RE` is exported and used by ~12 gsd-tools tests with `wallet` fixtures and no brief; making it brief-driven touches 4 use sites and those tests. Remaining: money 5, reg 1, game 1 lines (bin) plus the execute-plan line. Needs a ruling in 7.1.
2. The plan's hook change (`gsd-protect-managed-files.js:20`) is a comment about `flip.sh`'s flag; the hook denies `flip.sh --apply|--rollback` for any flag. So "accept both flags" does not apply: I named `--approved-by-owner` with the legacy alias in the comment, allow-listed that line (`owner`, max 1, reason "legacy flag alias"), quoted RISE: `RISE allowed get-shit-done/bin/hooks/gsd-protect-managed-files.js owner baseline=0 current=1`, no RISE denied, used `--allow-raise`. N3 rows added: the new flag is denied. `flip.sh` (in `.planning`) is untouched and still takes `--approved-by-ceo`.
3. Decision source value `ceo-answer` renamed `owner-answer` (decisions.js, protocol). Existing ledgers keep the old string; nothing reads it.
4. `computeHighRisk` takes an optional 4th argument (brief risk domains); `cmdQualityAssessRisk` passes `riskDomainsFor(cwd)`. Legacy project with no brief loses the `payment` trigger of the adversarial review (state for the coordinator's review); `auth` and `security` still trigger.
5. `contextFields` now also returns `all_state_mutating`; the invalid-config test row was updated.
6. R-f also asserts the planner mandate's obligations (extra, not in the plan).
7. Commit for gsd-demo.md was separate from 6.5's main commit because the other executor had a staged hunk in it.
8. Possible miss: `git grep -E '\b..\b'` did not honour `\b` here; the lint check is the authority and reads 0 for the swept files.
