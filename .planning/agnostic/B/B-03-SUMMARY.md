# B-03 Summary: block-managed markers (B4), settings set-merge (B5)

## Outcome
- `get-shit-done/bin/project-deploy-files.js` (139 lines, cap 220): added `parseBlocks`, `planBlockFile`, `stripMarkerLines` to the B-02 exports. B-02 functions unchanged (`git diff` = additions plus the export line).
- `get-shit-done/bin/project-deploy-settings.js` (131 lines, cap 190, new): `mergeSettings`, `serializeSettings`. No file I/O.
- `get-shit-done/bin/project-deploy-settings.test.js` (new, 14 cases) and `package.json` `scripts.test` (one entry added after `project-deploy-files.test.js`).
- Full suite `npm test`: rc=0, `# tests 1801`, `# pass 1801`, `# fail 0`. Log: `.tmp/agnostic-B03.log` (gitignored).
- `node scripts/agnostic-lint.js check`: exit 0. `git log a6a06e4..HEAD -- scripts/agnostic-lint/` is empty.
- Nothing calls the new functions yet; B-04 is the first caller.

## Commits
- `a76212c` feat(agnostic-B4): block-managed marker parsing and replacement
- `4084246` test(agnostic-B4): block-managed tests (7 mutants killed)
- `14fa31a` feat(agnostic-B5): settings set-merge (permissions and hook commands)
- `3d4f1cb` test(agnostic-B5): settings set-merge tests (12 mutants killed), wired into npm test

## Tests
`project-deploy-files.test.js`, describe `block-managed files (agnostic-B4)`, B4-1..B4-12 (B-02 tests 1-10 still green, 22 total):
1 parse ids, inner, empty inner; 2 five malformed reasons; 3 non-marker text is ordinary, CRLF marker is a marker; 4 create; 5 replace touches only the matching inner; 6 append with separator; 7 identical inner is unchanged; 8 project-only block byte-identical; 9 malformed current = conflict, malformed next = error; 10 local-edit warning only when the current inner differs from the previous preset; 11 blocks hashes; 12 stripMarkerLines incl. CRLF.

`project-deploy-settings.test.js`, describe `settings set-merge (agnostic-B5)`, 1-14: 1 null current; 2 project allow survives, deployed allow removed; 3 deny/ask; 4 no-prev dedupe; 5 preset-first order, removed hook named; 6 mixed group keeps project handler; 7 no-prev handler dedupe; 8 identity includes event and matcher; 9 other keys and `prompt` handler preserved in key order; 10 idempotent second merge; 11 frozen inputs left unchanged; 12 null fragment, emptied event omitted; 13 invalid current rejected (10 cases); 14 serialize format. Every merge freezes its inputs (`deepFreeze`), so mutation of an input throws.

## Mutation proof
Mutants applied by exact-anchor replacement to a copy of the module, test file run, module restored from the saved copy; `git diff` on both modules empty afterwards.

`project-deploy-files.js` (B4):
| Mutant | Failing tests |
|---|---|
| M1 `next` returned as content when current exists | B4-5, 6, 7, 8 |
| M2 malformed current falls through to update | B4-9 |
| M3 marker regexes lose `^` | B4-3 |
| M4 absent blocks not appended | B4-6 |
| M5 duplicate id accepted | B4-2, 9 |
| M6 blocks missing from next dropped | B4-8 |
| M7 local-edit warning never emitted | B4-10 |

`project-deploy-settings.js` (B5):
| Mutant | Failing tests |
|---|---|
| M1 permissions = fragment only | 2, 3, 4, 12 |
| M2 previously deployed never removed | 2, 3, 12 |
| M3 project groups before fragment groups | 5, 8 |
| M4 no dedupe against current (perms and hooks) | 2, 4, 7, 10 |
| M5 other top-level keys dropped | 9 |
| M6 removal ignores prev | 2, 3, 4, 12 |
| M7 hook identity = command alone | 8 |
| M8 current mutated in place | 2, 3, 4, 9, 10, 11, 12 |
| M9 invalid `permissions.allow` coerced | 13 |
| M10 non-object group skipped, not rejected | 13 |
| M11 non-array group `hooks` accepted | 13 |
| M12 `removed` always empty | 2, 3, 5, 12 |

## Deviations
1. **Test-input bug, fixed before commit.** First B4-3 draft paired a non-marker begin with a real end marker, which correctly reports `end without begin`. Test inputs corrected; module untouched.
2. **Mutation-harness mishap, disclosed.** A first mutation run used inverse-string reverts; the `false` anchor for M9 was not unique, so M9 stayed applied, and M10–M12 were measured on top of it. Detected via `git diff` (two lines differed from HEAD). Restored the two lines from HEAD, then reran all 12 settings mutants with a copy-and-restore harness. Only the clean run's numbers are reported above; the contaminated numbers were discarded.
3. **Log path.** Plan named `/tmp/agnostic-B03.log`; written to `.tmp/agnostic-B03.log` (the worktree's gitignored temp directory).
4. **Spec-vs-measured mutant notes.** Plan expected M3 to fail only test 5 and M4 only 4, 7; measured sets are supersets (M3 also 8, M4 also 2, 10). Each mutant is killed by at least its named test.
5. **Known edge, not reachable today.** The merge treats only `type: 'command'` handlers as managed. A fragment handler of another type would be re-added each merge, so the second merge would duplicate it. `project-deploy-render.js:184` requires every preset hook to be `type: 'command'`, so presets cannot produce this. If that validation is ever relaxed, the settings merge needs a rule for non-command handlers.

## Self-Check: PASSED
- Files exist: `project-deploy-files.js`, `project-deploy-files.test.js`, `project-deploy-settings.js`, `project-deploy-settings.test.js`, `package.json` (modified), this file.
- Commits exist: `a76212c`, `4084246`, `14fa31a`, `3d4f1cb`.
- Suite rc=0, fail 0; agnostic lint exit 0; module diffs empty after mutation runs.
