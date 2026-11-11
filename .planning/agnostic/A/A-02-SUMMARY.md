# A-02 Summary: project/stack profile loader and `gsd-tools profile get|check`

## Outcome
- `get-shit-done/bin/project-profile.js` (227 lines, target <=260): schema constants, `loadProfile`, `getProfileValue`, `validateProfile`, `runCli`. Nothing else calls it.
- `gsd-tools.js`: 12 insertions, 0 deletions since `db24beb` (the `require` after `deriveCheckSet`, and `case 'profile'` before `case 'prompt-optimize'`).
- `npm test`: rc=0, `# pass 1709`, `# fail 0` (A-01 baseline 1696, plus 13 new).
- `node scripts/agnostic-lint.js check` exit 0; `scripts/agnostic-lint/baseline.json` unchanged since `1bf7d5d`.

## Commits
- `d974464` feat(agnostic-A2): project/stack profile loader and gsd-tools profile get|check
- `5acde4d` test(agnostic-A2): profile loader unit + CLI tests (6 mutants killed), wired into npm test

## Tests
Behaviours 1-9 unit (in-memory profiles), 10-13 CLI (scratch `.planning/config.json`). All 13 present by name in the full-suite output.

## Mutation proof (`get-shit-done/bin/project-profile.js`, each reverted to HEAD, `git diff` empty afterwards)
| Mutant | Failing tests |
|---|---|
| M1 drop `stack.commands.test_file` from `REQUIRED_KEYS` | 3, 10 |
| M2 `runCli(['check'])` always exit 0 | 10 |
| M3 `get` returns `''` for an undefined value | 12 |
| M4 skip placeholder check | 5 |
| M5 skip gate duplicate-id check | 6 |
| M6 `getProfileValue` accepts any top-level key | 9 |

## Smoke checks (scratch dir)
- `{}` config: `profile check` exit 1, `missing` = the 5 required keys.
- Minimal valid config: exit 0, `ok: true`; `profile get stack.commands.test_file --raw` prints `npm test -- {file}` with no trailing newline; `profile get stack.commands.lint` exits 1 with `Error: profile key not set: stack.commands.lint`.

## Deviations
- Test 3 iterates over a literal list of the five spec keys, not `REQUIRED_KEYS`. With the plan's wording, M1 would not fail test 3 (the loop would just skip the dropped key). Found while preparing the mutants.
- `profile get` on a corrupt or non-object `config.json` returns the load error (`config.json is not valid JSON`), not `profile key not set`. The spec is silent on this case; the error is more accurate.
- Judgment calls not spelled out in the spec: non-empty means non-whitespace (`trim`); a non-object `project` or `stack` is reported as `invalid`; `missing` is sorted alphabetically (spec: arrays sorted by key); `null` counts as present-but-invalid, not missing.
- Worktree has no `node_modules`; `gsd-tools.js` needs `dotenv` via `NODE_PATH=$HOME/get-shit-done/node_modules`. Every run used that variable. No install performed.

## Defect Classes
None found. (reviewed by: other — executor self-review, mutants M1-M6, CLI smoke checks)

## Self-Check
- Files present: `get-shit-done/bin/project-profile.js`, `get-shit-done/bin/project-profile.test.js`, `get-shit-done/bin/gsd-tools.js`, `package.json`.
- Commits `d974464` and `5acde4d` present in `git log`.
- Full suite rc=0, `# fail 0`; lint exit 0; baseline unchanged.

## Self-Check: PASSED
