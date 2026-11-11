# A-01 Summary: ratchet lint for project-specific terms

## Outcome
- `scripts/agnostic-lint.js` (check / report / write-baseline), 25-class denylist, 70-entry capped allow-list, tool-generated baseline.
- `npm test` now runs `scripts/agnostic-lint.test.js` (13 tests). Full suite: 1696 pass, 0 fail (baseline 1683).
- No installable file changed: `git diff --quiet db24beb -- agents commands get-shit-done bin hook-config.json` exits 0.

## Commits
- `e1e9e7b` feat(agnostic-A1): term denylist, allow-list and ratchet lint script
- `d285816` test(agnostic-A1): fixture tests for the ratchet lint (7 mutants killed)
- `1bf7d5d` feat(agnostic-A1): committed baseline, repo-at-baseline test, wired into npm test

## Tests
Fixture tests 1-9 and 3a (node:test, tmp roots), repo-tree tests 10-12. All present by name in the full-suite output.

## Mutation proof (on scripts/agnostic-lint.js, each reverted, source verified equal to HEAD afterwards)
| Mutant | Killed by |
|---|---|
| M1 never push to rises | 3a, 5, 6, 8 (plan said 5, 6, 8; 3a also fails because it asserts a RISE line) |
| M2 drop `*.test.js` exclusion in bin | 3 |
| M3 ignore `max` (every allow-listed hit allowed) | 4 |
| M4 count occurrences, not lines | 1 |
| M5 skip inputs-hash comparison | 7 |
| M6 never push to drops | 5, 7 |
| M7 always disk-walk, never git ls-files | 3a |

Note: my first M3 draft zeroed the allowed count, which is not the plan's mutant. It was caught by test 4 too, then replaced with the specified mutant and re-run.

## Live probes (real tree, each reverted)
- L1: appended `Charlotte` to `agents/gsd-executor.md`. Output: `RISE denied agents/gsd-executor.md charlotte baseline=3 current=4`, exit 1. Test 10 fails (`not ok 1 - 10 repo at baseline`). Revert clean.
- L2: `get-shit-done/references/zz-probe.md` (`deno task test`). Untracked: check exit 0. After `git add -N`: `RISE denied get-shit-done/references/zz-probe.md deno baseline=0 current=1`, exit 1. Removed with `git rm -f`; check back to exit 0.
- L3: `allowlist.json` max for `agents/gsd-integration-checker.md` frontend 2 -> 1. Output: `STALE inputs hash (terms.json or allowlist.json changed; run write-baseline)`, plus RISE denied and STALE allowed for the same cell (expected consequence of a lower cap). Revert clean.

## Scope counts
Files per scope match the spec: agents 23, commands 34, workflows 36, references 29, templates 36, bin 63, install 1, hook-config 1.

## Matrix
`report` equals the planner's Task 1 table in all 25 rows (verified before the baseline was generated).

## Delta vs FABLE-AGNOSTIC-GSD section 1.1 (counts only; patterns NOT tuned)
Compared cells in the scopes the design table covers (agents, commands, workflows, references, templates, bin). Design table has no `install`/`hook-config` columns; `v2`, `bintest`, `scripts/ab-eval` are out of this lint's scope. Rows not listed are equal.

| Class | Cell | Lint | Design 1.1 | Likely cause |
|---|---|---|---|---|
| money | agents | 36/12 | 32/12 | case-insensitive |
| money | commands | 3/1 | 2/1 | case-insensitive |
| money | references | 18/8 | 15/8 | case-insensitive |
| money | templates | 17/6 | 9/3 | case-insensitive |
| supabase | templates | 33/3 | 30/3 | case-insensitive |
| edgefn | references | 3/2 | 2/2 | pattern/case |
| edgefn | templates | 1/1 | 0 | pattern/case |
| redis | references | 8/1 | 6/1 | case-insensitive |
| redis | templates | 5/2 | 3/2 | case-insensitive |
| charlotte | agents | 87/12 | 86/12 | case-insensitive |
| charlotte | workflows | 56/7 | 55/7 | case-insensitive |
| charlotte | references | 84/8 | 74/8 | case-insensitive |
| charlotte | bin | 46/3 | 43/3 | case-insensitive |
| postgres | workflows | 2/2 | 1/1 | pattern/case |
| postgres | templates | 8/5 | 3/2 | case-insensitive |
| telegram | bin | 47/7 | 44/7 | case-insensitive |
| authtech | agents | 2/2 | 1/1 | `2FA` term not in design row |
| authtech | workflows | 6/4 | 5/3 | `2FA` term not in design row |
| authtech | references | 16/5 | 14/5 | `2FA` term not in design row |
| frontend | agents | 7/5 | 3/2 | broader term set + case-insensitive |
| frontend | workflows | 4/4 | 3/3 | broader term set + case-insensitive |
| frontend | references | 27/12 | 14/8 | broader term set + case-insensitive |
| frontend | templates | 51/11 | 22/8 | broader term set + case-insensitive |
| frontend | bin | 3/3 | 0 | broader term set + case-insensitive |
| gates | references | 21/6 | 20/6 | `migration-security-gate`/`cve-scan-gate` added |
| ports | agents | 9/3 | 8/3 | pattern/case |
| ports | references | 34/4 | 35/4 | pattern/case |
| ports | bin | 3/2 | 1/1 | pattern/case |

Not in the design table at all: `cloud` (Stripe/Vercel/AWS) and `docker` split out (design folds docker into other rows), `zg`/`abs`/`paths` agree.

Rows with no delta: igaming, game, reg, owner, deno, nx, pnpm, orbstack, email, docker, paths, zg, abs.

## Deviations
- `scripts/agnostic-lint.js` is 252 lines; the plan target is <=220. Left as is, behaviour unchanged, to avoid trimming for line count alone.
- Mutant M1 killed by 4 tests, not 3 (plan named 5, 6, 8).

## Defect Classes
None found. (reviewed by: other — fixture tests, mutants M1-M7, live probes L1-L3)

## Self-Check
- Files: `scripts/agnostic-lint.js`, `scripts/agnostic-lint/terms.json`, `scripts/agnostic-lint/allowlist.json`, `scripts/agnostic-lint/baseline.json`, `scripts/agnostic-lint.test.js`, `package.json` — all present.
- Commits `e1e9e7b`, `d285816`, `1bf7d5d` present in `git log`.
- Full suite rc=0, `# fail 0`, 13 named tests present.
- `node scripts/agnostic-lint.js check` exits 0 on the committed tree.

## Self-Check: PASSED
