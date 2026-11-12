# M-01 summary: init context fields and the missing-brief gate

Branch `exp/agnostic`, worktree `~/get-shit-done-agnostic`. Base `0b9c35a`. Executor: Haiku 5.5. Review rounds: not run (1.1 and 1.2 need one Sonnet round each, 1.3 needs rounds to zero); pending coordinator dispatch.

## Commits

| Task | Commit | Files | New tests |
|---|---|---|---|
| M-00 | 3cc67aa | B-FIX3-SUMMARY.md (Freeze), C-02-PLAN.md and C-03-PLAN.md (CANCELLED) | 0 |
| 1.1 | 80a4a08 | project-context.js (new), project-context.test.js (new), gsd-tools.js, package.json | 4 |
| 1.2 | 7d8ef6f | gsd-tools.js (12 remaining cmdInit* results, both execute-roadmap branches) | 15 |
| 1.3 | ed63486 | project-context.js, project-context.test.js, gsd-tools.js, gsd-tools.test.js | 8 |

Totals: 1979 tests before, 2006 after, 0 fail, 0 skipped. The full suite was run with `GSD_LEGACY` unset and with `GSD_LEGACY=1` exported: same result both times.
Ratchet lint `node scripts/agnostic-lint.js check`: `ok (869 denied, 338 allowed)` after every task. No STALE line, no baseline write, no allow-list raise.
Frozen engine: `git diff 0b9c35a..HEAD -- get-shit-done/bin/project-deploy*.js` is empty.

## Mutants (1.3, gate)

Each mutant was applied in place, run with `--test-name-pattern` on the named row, and the file restored from `.tmp/m01/` (byte-identical check after the run).

- m1 `ok` forced to `true` in project-context.js: D6-a fails (1 fail).
- m2 `[BRIEF_REL, PROFILE_REL]` reduced to `[BRIEF_REL]`: D6-b fails.
- m3 `--legacy` dropped from the gate line in gsd-tools.js: D6-c fails.
- m4 `process.env.GSD_LEGACY === '1'` loosened to `Boolean(process.env.GSD_LEGACY)`: D6-d fails.
- m5 `&& invalid.length === 0` removed from contextGate: D6-f fails.

All five killed; 5 of 5.

## Deviations

- M-00: the CANCELLED line is the literal first line of C-02-PLAN.md and C-03-PLAN.md, so it sits above the `---` frontmatter, which is no longer line 1. Nothing in the repo parses these two plans.
- 1.1: four tests, not three. The fourth is a unit test of `availablePresets`.
- 1.2: the table test is 14 rows plus one test that counts the `case` lines of the init dispatch against the row list.
- 1.3: `cmdInitExecutePhase` and `cmdInitPlanPhase` take a fifth `gate` parameter so the result can carry `project_context`. The gate error is written with `writeStdoutSync` and `process.exit(1)`, because `output()` always exits 0.
- 1.3: `runGsdTools` in gsd-tools.test.js defaults to `GSD_LEGACY: '1'`. A `git grep` found no other test that spawns `init plan-phase` or `init execute-phase` directly.
- 1.3: when config.json is absent, `validateProfile` lists every required key as missing. D6-a asserts inclusion of the two files only.

## Self-Check: PASSED

- Commits 3cc67aa, 80a4a08, 7d8ef6f, ed63486 exist (`git cat-file -e`).
- Files project-context.js, project-context.test.js and this summary exist in the worktree.
- Frozen engine diff is empty.

## Review round 1 fixes

Commit `6317a01` (gsd-tools.js, project-context.js, project-context.test.js). Tests 2014 pass, 0 fail, run with `GSD_LEGACY` unset and exported. Ratchet lint `ok (869 denied, 338 allowed)`. Tests run with `NODE_PATH=$HOME/get-shit-done/node_modules` (the worktree has no `node_modules`).

| Finding | Fix | Tests |
|---|---|---|
| F1 MEDIUM: profile key absent with both files present not covered | `contextGate` lists `report.missing` (unchanged code, now pinned) | D6-h |
| F2 MEDIUM: zero-byte, whitespace-only or directory counted as present | `isPresent()`: regular file with a non-whitespace char; `contextFields` and `contextGate` both use it | D6-i (3 rows x 2 files) |
| F3 LOW: `--legacy` only recognised in the last position | `init` case strips `--legacy` into `initArgs` before positional parsing; `--legacy=1` stays unrecognised | D6-j, D6-k |
| F4 LOW: no human-readable line on gate failure | `gateStderr()` writes one stderr line before the JSON on stdout | D6-l |
| F5 LOW: env `''` and `'true'` not pinned | none needed in code (`=== '1'` already gates); pinned | D6-m |

Mutants (in place, `--test-name-pattern` on the named row, file restored from a byte copy, `cmp`-identical):
- m1 `ok` always true: D6-a fails (1 fail).
- m2 only the brief checked: D6-b fails (1 fail).
- m3 `--legacy` ignored: D6-c fails (1 fail).
- m4 env compared loosely: D6-d fails (1 fail).
- m5 `invalid` ignored: D6-f fails (1 fail).
- m6 `...report.missing` dropped: D6-h fails (1 fail, AssertionError).
- extra x-F3 `initArgs = args` (no `--legacy` strip): D6-j fails (1 fail).

6 of 6 required mutants killed (m1-m6), plus the F3 check.
