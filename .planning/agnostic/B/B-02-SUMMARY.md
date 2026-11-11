# B-02 Summary: preset loader and `{{dot.path}}` renderer (B2), whole-file three-way decision (B3)

## Outcome
- `get-shit-done/bin/project-deploy-render.js` (270 lines, cap 300; plan target 240): `PLACEHOLDER_RE`, `renderText`, `destKey`, `validateDest`, `loadPreset`, `renderPreset`.
- `get-shit-done/bin/project-deploy-files.js` (48 lines): `sha256`, `gitMergeFile`, `planWholeFile`.
- `package.json` `scripts.test`: both test files added after `project-deploy-scan.test.js`. Two-file change.
- Nothing calls the two modules yet (`git grep` outside tests: empty).
- Full suite `npm test`: rc=0, `# tests 1775`, `# pass 1775`, `# fail 0`.
- `node scripts/agnostic-lint.js check`: exit 0. `scripts/agnostic-lint/` has no commits since `16c0d17`.

## Commits
- `aa241ec` feat(agnostic-B2): preset loader and `{{dot.path}}` renderer
- `579eda3` test(agnostic-B2): render and preset validation tests (13 mutants killed), wired into npm test
- `4e2c82c` feat(agnostic-B3): whole-file three-way decision over `git merge-file`
- `ec72044` test(agnostic-B3): whole-file three-way tests (7 mutants killed), wired into npm test

## Tests
`project-deploy-render.test.js` (14 node:test cases, names as numbered in the plan):
1 substitution (distinct, repeated, number, boolean); 2 missing / invalid / inherited-leaf (`{{a.toString}}`, `{{__proto__.polluted}}`, `{{constructor.name}}`); 3 literal forms; 4 minimal and full load with defaults; 5a shape violations (9 cases); 5b dest table, two violations reported; 5c case and NFC variants, duplicate by case and by normalisation; 5d allowed dests; 5e symlink source, symlink-inside, symlinked directory, symlinked fragment (outside marker never in the result); 6 render / `render:false` bytes / capability gate / mode / order; 7 fragment rendered after parse (quote case), shape errors, unparseable, no fragment; 8 missing and non-scalar key; 9 missing preset dir.

`project-deploy-files.test.js` (10 cases, real `git merge-file` in tmp dirs): 1 create; 2 unchanged; 3 overwrite without git; 4 merge; 5 conflict yields no content; 6 unmanaged and missing base; 7 local edit with unchanged upstream; 8 temp dir removed after clean and conflict; 9 missing git binary; 10 CRLF bytes and sha256 digest.

## Mutation proof
Each mutant applied to the module by exact-anchor replacement, the test file run, module restored byte-for-byte (`cmp` against a backup). `git diff` on both modules is empty afterwards.

`project-deploy-render.js`:
| Mutant | Failing tests |
|---|---|
| M1 lookup uses `key in obj` | 2 (after test fix, see Deviations) |
| M2 absent key renders `''`, unreported | 2, 8 |
| M3 `render: false` ignored | 6 |
| M4 drop `.claude/settings.local.json` | 5b, 5c, loadPreset |
| M5 capability gate ignored | 6 |
| M6 fragment top-level keys unchecked | 7 |
| M7 fragment rendered before `JSON.parse` | 7 |
| M8 no `..` segment check | 5b, loadPreset |
| M9 `validateDest` on raw dest | 5c, loadPreset |
| M10 `destKey` without NFC | 5c, loadPreset |
| M11 `statSync` instead of `lstatSync` for sources | 5e, loadPreset |
| M12 realpath containment removed | 5e, loadPreset |
| M13 `.env.example` exception removed | 5d, loadPreset |

`project-deploy-files.js`:
| Mutant | Failing tests |
|---|---|
| M1 row c removed | 3, 10 |
| M2 git status 1 treated as ok | 5, 8 |
| M3 conflict carries `content` | 5 |
| M4 row f returns overwrite | 6 |
| M5 temp dir not removed | 8, 9 |
| M6 row b removed | 2 |
| M7 spawn error reported as conflict | 9 |

## Deviations
- `project-deploy-render.js` is 270 lines, over the plan's 240 target and under the 300 cap. Kept the validation tables explicit rather than compressing them.
- Render M1 survived the first test draft: `{{__proto__.polluted}}` and `{{constructor.name}}` resolve to missing under `key in obj` too, because the inherited value is not reached at the top level. Test 2 now also covers `{{a.toString}}` (an inherited leaf on a real object), which kills M1. Test edit is in `579eda3`.
- Added validation beyond the spec table, all fail-closed: unknown file-entry keys rejected; `description` must be a string when present; `files` must be an array; `settings_fragment` must be a non-empty string; backslash rejected in `src`; a missing `src` file reports `source missing: <src>` (spec gives no text).
- `gitMergeFile` maps any exception (e.g. `mkdtemp` failure) to `reason: 'git merge-file failed'`; the spec does not cover that path.
- Fragment unparseable reason reads `<file> missing or not valid JSON` (one reason for missing and malformed).

## Defect Classes
None found. (reviewed by: other, executor self-review; mutants M1-M13 and M1-M7; full suite; lint)

## Self-Check
- Files present: `get-shit-done/bin/project-deploy-render.js`, `project-deploy-render.test.js`, `project-deploy-files.js`, `project-deploy-files.test.js`, `package.json`.
- Commits `aa241ec`, `579eda3`, `4e2c82c`, `ec72044` present in `git log 16c0d17..HEAD`.
- `git diff --stat 16c0d17..HEAD` lists only the five `files_modified` entries plus this summary.
- `git grep -c project-deploy-render.test.js -- package.json` = 1; the same for `project-deploy-files.test.js`.
- Full suite rc=0, `# fail 0`; lint exit 0.

## Self-Check: PASSED
