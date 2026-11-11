# B-01 Summary: installer copies `presets/` verbatim (B1) and secret-pattern scanner (B6)

## Outcome
- `bin/install.js`: `copyDirVerbatim` added; `copyWithPathReplacement` takes `opts.verbatimDirs` (top-level only); the `get-shit-done` call site passes `{ verbatimDirs: ['presets'] }`; both helpers exported.
- `get-shit-done/bin/project-deploy-scan.js` (53 lines): `SECRET_PATTERNS` (10 ids), `scanText`, `scanDir`.
- `package.json` `scripts.test`: `get-shit-done/bin/project-deploy-scan.test.js` added after `project-profile.test.js`. One-line change.
- `get-shit-done/presets/` not created.
- Full suite (`npm test`): rc=0, `# tests 1751`, `# pass 1751`, `# fail 0`.
- `node scripts/agnostic-lint.js check`: exit 0. `scripts/agnostic-lint/` has no commits since `2f52c3b`.

## Commits
- `284190d` feat(agnostic-B1): installer copies get-shit-done/presets byte-for-byte
- `4f0d741` test(agnostic-B1): presets byte-copy install tests (3 mutants killed)
- `f9a9019` feat(agnostic-B6): secret-pattern scanner (scanText, scanDir)
- `11bb7fa` test(agnostic-B6): secret scan tests (7 mutants killed), wired into npm test

## Tests
Installer (`bin/install.test.js`, `describe 'presets/ is copied byte-for-byte (agnostic-B1)'`), 4 new, all green:
1. presets/ files survive copyWithPathReplacement byte-equal while other .md files are rewritten
2. verbatimDirs is top-level only: default call rewrites presets/, nested presets/ dirs are rewritten under the option
3. gemini runtime: presets/ keeps its .md file and creates no .toml anywhere
4. CLI install copies get-shit-done/presets/ byte-for-byte and records its sha256 in the manifest

Scanner (`get-shit-done/bin/project-deploy-scan.test.js`), 17 tests, all green:
- `fixture table covers every SECRET_PATTERNS id`
- `1 <id>` x10: one hit per token, pattern id and line, matched text absent from the result
- `2 negatives`, `3 scanDir walks nested and dotfiles...`, `4 a Buffer with non-UTF-8 bytes...`
- `5 repo presets contain no token-shaped string`, `5b demonstrated failure: ...`
- `6 self-scan: the scanner module and this test file contain no token-shaped string`

Test tokens are built by runtime concatenation. No token literal is committed.

## Mutation proof (each reverted; restored files compared byte-for-byte with backups)
| Mutant | File | Failing tests |
|---|---|---|
| install M1 drop call-site `{ verbatimDirs }` | bin/install.js | CLI install (4) |
| install M2 `copyDirVerbatim` routes through `copyWithPathReplacement` | bin/install.js | 1, 3, 4 |
| install M3 `opts` passed into recursion | bin/install.js | 2 |
| scan M1 delete `vcs_token` entry | scanner | fixture table, 1 vcs_token, 3, 4, 5b |
| scan M2 add `match: line.match(re)[0]` to each hit | scanner | 1 (all 10 ids), 3, 4, 5b |
| scan M3 scanDir skips dotfiles | scanner | 3 |
| scan M4 scanDir does not recurse | scanner | 3, 5b |
| scan M5 `line: 1` always | scanner | 1 (all 10 ids), 3 |
| scan M6 Buffer input returns `[]` | scanner | 3, 4, 5b |
| scan M7 `presetHits` scans a fixed empty dir (test file) | test file | 5b |

`git diff --stat` on `bin/install.js` and the scanner module is empty after the revert.

## Deviations
- `copyDirVerbatim` is placed above the doc comment of `copyWithPathReplacement`, not between that comment and the function. The plan's "directly above" would have split the comment from its function. Its `@param opts` JSDoc line was also added (one line, not in the plan).
- Test 5a/5b and M7 are as specified. On this tree `get-shit-done/presets/` is absent, so 5a is a vacuous pass until Phase C creates it; 5b is the proof the scan can fail.
- The 4 installer tests are asserted under the new `describe`. The third install test (gemini) checks the `.toml` absence with a recursive listing.
- M1 for the scanner fails the fixture-coverage test and the `vcs_token` test, not only test 1; the plan's per-mutant list was a minimum.
- Mutant M7 was applied to the test file, not the module; the first run hit the anchor-uniqueness guard because the helper always targeted the module. Re-run directly on the test file; no change in outcome.

## Defect Classes
None found. (reviewed by: other — executor self-review, mutants M1-M7 across 2 files, full suite, lint)

## Self-Check
- Files present: `bin/install.js`, `bin/install.test.js`, `get-shit-done/bin/project-deploy-scan.js`, `get-shit-done/bin/project-deploy-scan.test.js`, `package.json`.
- Commits `284190d`, `4f0d741`, `f9a9019`, `11bb7fa` present in `git log`.
- `git diff --stat 2f52c3b..HEAD` lists only the five `files_modified` entries; `.planning/agnostic/B/B-01-SUMMARY.md` is the sixth file (this file).
- `git grep -c project-deploy-scan.test.js -- package.json` = 1; `get-shit-done/presets` absent.
- Full suite rc=0, `# fail 0`; lint exit 0.

## Self-Check: PASSED
