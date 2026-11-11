# B-FIX1 Summary

## Task 1 (H1)

### Commits
- `1b50dda` fix(agnostic-B-FIX1): H1 canonical identity guard for dest paths

### Outcome
- `project-deploy-fs.js` (101 lines): `canonicalRel(root, rel)`, `sameFile(a, b)`, `fsFold`.
- `project-deploy-canon.js` (43 lines, new, split out to keep `project-deploy.js` under 300 lines): `resolvePaths` (symlink refusal, `validateDest` re-run on the canonical path, duplicate canonical path rejection, guarded set by identity) and `isGuardedCanon`.
- `project-deploy.js` (280 lines): `planDeploy` calls `resolvePaths` after the escapes check; guarded list uses the identity set. `GUARDED_PREFIX` and the `destKey` import removed.
- `project-deploy-canon.test.js` (new, 17 rows), added to `package.json` `scripts.test`.
- `npm test` (`NODE_PATH=$HOME/get-shit-done/node_modules`): rc=0, 1864 pass, 0 fail (baseline 1847 + 17). Log: `.tmp/agnostic-B-FIX1-H1.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).
- Probe (APFS, this host): long-s and case aliases of an existing dir are observable; `realpathSync.native` returns the canonical name, `realpathSync` keeps the alias. Fold tests run, none skipped.

### Test rows
| Row | Case | Expectation |
|---|---|---|
| H1-a | long-s alias of an existing hooks dir (skip only if fold unobservable) | guarded |
| H1-b | long-s alias, no hooks dir (folded tail) | guarded |
| H1-c | `.CLAUDE/Hooks/x.sh`, no `.claude` | guarded |
| H1-d | symlink to hooks dir | refused: `dest traverses a symlink` |
| H1-e | symlink to `.claude` (`alias/settings.json`) | refused: symlink |
| H1-f | symlinked parent of hooks (`alias/hooks/x.sh`) | refused: symlink |
| H1-g | symlinked final file, target inside root | refused: symlink |
| H1-h | `scripts/x.sh` | not guarded |
| H1-i | long-s settings spelling, settings file exists (skip only if fold unobservable) | refused: `set-managed` |
| H1-j | long-s settings spelling, no file (folded tail) | refused: `set-managed` |
| H1-k | `.GIT/x` | refused: `never-managed path` (caught at preset load by `destKey`, asserted for completeness) |
| U1 | `canonicalRel` dangling symlink component | refused, not treated as missing |
| U2 | `canonicalRel` file used as directory | fails closed: `dest cannot be resolved` |
| U3 | `canonicalRel` missing tail | folded and joined to real head |
| U4 | `sameFile` hard link / missing path | true / false |
| U5 | `resolvePaths` long-s vs `s` duplicate | `duplicate canonical path` |
| U6 | `resolvePaths` case-only duplicate; guarded membership | duplicate rejected; only `.claude/hooks/x.sh` guarded |

### Mutants (copy-and-restore harness `.tmp/mutate-h1.js`, sha256 checked before and after)
| Mutant | Failing tests | Killed | Restored identical |
|---|---|---|---|
| M1 drop symlink refusal | H1-d, H1-e, H1-f, H1-g, U1 | yes | yes |
| M2 `realpathSync.native` swapped for JS `realpathSync` | H1-i | yes | yes |
| M3 fold is `toLowerCase` only | H1-b, H1-j, U5 | yes | yes |
| M4 drop `validateDest(canon)` re-run | H1-i, H1-j | yes | yes |

### Deviations and notes
- `validateDest` runs on the unfolded canonical path, as the ruling states. The tail is already folded, so long-s and case in the tail are caught. An existing component spelled with a long s is caught only through `realpathSync.native`, which is what M2 exercises.
- Duplicate detection compares the folded canonical path (stricter than the spec's literal "canon value").
- `SETTINGS` and `.gitignore` (init) get the symlink and canonical checks too (write targets). Their canonical paths are not part of the duplicate check.
- The identity clause (`sameFile` against `root/.claude/hooks`) is defence in depth. `canonicalRel` refuses symlinks, so for a dest whose existing ancestors are real directories the string clause already decides. No test row isolates the identity clause alone; the claim is untested in isolation.
- The `.claude/hooks` literal is kept in `project-deploy-canon.js` as a constant; no shell command spells it.
- Test runs need `NODE_PATH=$HOME/get-shit-done/node_modules`: this worktree has no `node_modules`, and the 9 CLI tests fail with `Cannot find module 'dotenv'` without it.
- Nothing pushed. No `install:gsd`. No stash, reset or clean.

## Self-Check
- Commit `1b50dda` present on `exp/agnostic`.
- Ruling H1 spec rows and four mutants present; 17/17 rows pass.
