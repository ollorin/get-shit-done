# A-03 Summary: product-brief and stack-profile templates, project-context reference

## Outcome
- `get-shit-done/templates/product-brief.md` (61 lines, budget 120): 8 domain H2 sections, guidelines block.
- `get-shit-done/templates/stack-profile.md` (66 lines, budget 150): 8 H2 sections, `<!-- gsd:begin commands -->` block with the 8 A-02 command keys.
- `get-shit-done/references/project-context.md` (68 lines, budget 90): pointer block, reading-values section, key table, `<!-- profile-example -->` json.
- Nothing includes or copies the three files; no existing file changed.
- `node scripts/agnostic-lint.js check`: exit 0, `baseline.json` last changed at `1bf7d5d` (A-01), unchanged.
- `npm test`: rc=0, `# pass 1714`, `# fail 0` (A-02 1709 plus 5). Tests 14-18 present by name.
- Behaviour-file check: `git diff --quiet db24beb -- agents commands get-shit-done/workflows bin hook-config.json` exits 0.

## Commits
- `2cb4ec0` docs(agnostic-A3): product-brief and stack-profile templates, project-context reference
- `5bffe4a` test(agnostic-A3): templates and project-context reference checked against the profile schema (5 mutants killed)

## Tests (`get-shit-done/bin/project-profile.test.js`, `describe('templates and reference')`)
- 14 profile-example parses and `validateProfile` returns ok with `warnings: []`.
- 15 pointer block carries the three inner sentences and both tags verbatim.
- 16 product-brief has the 8 H2 headings in order.
- 17 stack-profile has the 8 H2 headings in order, one begin and one end marker, and the commands table keys equal `KNOWN_COMMAND_KEYS`.
- 18 line budgets 120 / 150 / 90.

## Mutation proof (each reverted by Edit; `git diff --quiet HEAD` on templates and references exit 0 afterwards)
| Mutant | Failing test |
|---|---|
| M1 delete `test_file` from example json | 14 |
| M2 add `"deploy": "x"` under example `stack.commands` | 14 (warning) |
| M3 "Never substitute a default stack." to "Prefer the profile." | 15 |
| M4 `## Risk Domains` renamed `## Risks` | 16 |
| M5 delete `search` row from the commands block | 17 |

## Defect Classes
None found. (reviewed by: mutation-proof, 5 mutants, all killed; no defect in the shipped files surfaced)

## Deviations
- Stack-profile template's `## Commands` block is written as raw markdown inside the `<template>` fence, not as a nested fence, so the markers and table are literal. Consistent with the product-brief fence style.
- Test 14 anchors the json fence immediately after the marker (`<!-- profile-example -->\n```json`), stricter than the spec's "after".

## Self-Check: PASSED
- Files exist: `get-shit-done/templates/product-brief.md`, `get-shit-done/templates/stack-profile.md`, `get-shit-done/references/project-context.md`, `get-shit-done/bin/project-profile.test.js`.
- Commits exist: `2cb4ec0`, `5bffe4a`.

## Review round 1 fixes

Every Sonnet round-1 finding is fixed, with a test that fails on the pre-fix code (mutants reverted, file restored after each).

| Finding | Sev | Fix | Commit |
|---|---|---|---|
| F1 | MEDIUM | reg, authtech, cloud, owner, nx classes case-insensitive; caps re-derived from upstream/main; test 13 | `3c15819` |
| F2 | MEDIUM | validator tests 19-25; 10 mutants killed | `e60b1de` |
| F3 | LOW-MED | scopes for `hooks/*.js`, `skills/`, `routing-rules.md`, `get-shit-done/config/*.json`; test 3b | `0efb30e` |
| F4 | LOW | `g` and `y` flags rejected by name; test 14 | `8bd6d17` |
| F5 | LOW | `--root` without a value and unknown flags exit 2; test 15 | `8bd6d17` |
| F6 | LOW | usage text: check and write-baseline scan git-tracked files only | `8bd6d17` |
| F7 | LOW | `test_file` must contain `{file}`; `<file>` in shapes documented as literal; test 26 | `e60b1de`, `c6b2639` |
| F8 | LOW | placeholder scan skips single-quoted text and `${name}`; test 26 | `e60b1de` |
| F9 | LOW | stack-profile and product-brief wording now matches what is checked | `c6b2639` |
| F10 | LOW | tests 16-18: `report` matrix, bad pattern via CLI, unknown subcommand exit 2 | `8bd6d17` |

Baseline recalibration (approved `--allow-raise`, used for F1 and F3 only):
- F1: denied 846 to 867, allowed 290 to 338. Allow-list 70 to 73 entries.
- F3: denied 867 to 869. Rises: `routing-rules.md` authtech 1, `config/gate-capabilities.json` gates 1. Both fork-only, no upstream count.
- No drops in either step.

Deliberate scope choices: `pnpm`, `paths`, `gates`, `zg`, `abs`, `ports` stay case-sensitive (lowercase tool and path names, no uppercase variant in the fork). `email` stays case-sensitive (SES, Resend).

Correction: the F1 commit body says 4 new allow-list entries; the count is 3 (70 to 73). The entry list in the commit is correct.

Tests: `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: 1729 pass, 0 fail (was 1714). A-03 tests 14-18 still pass; no pinned wording changed.
