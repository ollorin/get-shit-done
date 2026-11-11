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

## Task 2 (H2)

### Outcome
- `project-deploy-guard.js` (new, 40 lines): `guardedSet({canonDests, hookCommands, presetFlags})` (pure), `hookCommandsOf(settings)`, `triplesCommands(triples)`, `refusalOf(...)` (moved out of `project-deploy.js` to keep it at 279 lines).
- Guarded if any of: H1 identity flag (`resolved.guarded`); first segment folds to `.husky` or `.githooks`; `fsFold(canon)` is contained in `fsFold(command)` for any hook command from current settings, the fragment, or previous manifest triples; the preset entry has `guarded: true`.
- `project-deploy-render.js`: `guarded` added to `FILE_KEYS`, boolean-validated, default `false`, carried on rendered files.
- `project-deploy-canon.js`: `resolvePaths` also returns `canons` (managed dests with canonical paths).
- `planDeploy`: `--preset-dir` refused (`preset-dir requires a human terminal`) when `guarded` is non-empty and the session is not a human, before the init exemption. The init exemption now requires `init`, settings absent, and every guarded file action `create`.
- `runCli` passes `presetFlag: presetDir !== undefined`. `planDeploy` opts `presetFlag` defaults to false, so direct `planDeploy` callers are unaffected.
- `package.json` `scripts.test`: added `project-deploy-guard.test.js`.

### Test rows (`project-deploy-guard.test.js`, 16 rows)
| Row | Case | Expectation |
|---|---|---|
| H2-a | `.husky/pre-commit` | guarded (first segment) |
| H2-b | `.GitHooks/x`, canon `.githooks/x` | guarded, folded |
| H2-c | `scripts/gate.sh` referenced by `$CLAUDE_PROJECT_DIR/SCRIPTS/Gate.sh` (case) | guarded; `scripts/other.sh` not |
| H2-d | `docs/a.md` with preset flag | guarded |
| H2-e | `docs/a.md` unreferenced; hook dir dest with h1 | docs unguarded, hook dir guarded |
| H2-f | `scripts/x.sh` with h1 only | guarded |
| H2-g | `hookCommandsOf` / `triplesCommands` malformed input | only string commands |
| H2-h | project-added settings hook names `scripts/gate.sh`; agent init | guarded_changes includes it; refused |
| H2-i | agent `--preset-dir` init updates existing `.husky/pre-commit` | refused, nothing written |
| H2-j | agent `--preset-dir` init with a hook file | refused, `preset-dir requires a human terminal`, snapshot unchanged |
| H2-k | human `--preset-dir` init | writes the hook |
| H2-l | `diff` with agent session and `--preset-dir` | never refused |
| H2-m | agent init, all creates, no flag | exempt, ok |
| H2-n | `guarded: 'yes'` | preset error `guarded must be a boolean: a.md` |
| H2-o | `guarded:true` docs file, agent init with settings present | refused |
| H2-p | agent `planDeploy` init, existing `.husky` block update, no flag | refused by the exemption check alone |

### Changed existing tests (intentional, per spec)
- `project-deploy.test.js` A9: the agent `--preset-dir` fresh init now asserts refusal (`preset-dir requires a human terminal`) and no hook written. It previously asserted success, which the spec forbids.
- `project-deploy-render.test.js` row 4: expected preset entries now carry `guarded: false`.

### Mutants (`.tmp/mutate-h2.js`, sha256 checked before and after each; test files run: guard, deploy, render, canon)
| Mutant | Killed by (first failing row) | Restored identical |
|---|---|---|
| M1 drop H1 identity clause | H1-a (and H2-e, H2-f) | yes |
| M2 drop husky/githooks clause | H2-a | yes |
| M3 drop hook-command clause | H2-c | yes |
| M4 drop guarded:true clause | H2-d | yes |
| M5 scan only fragment commands | H2-h | yes |
| M6 drop create-only condition | H2-p (H2-i does not reach it: `--preset-dir` refuses first) | yes |
| M7 preset-dir flag ignored under exemption (extra) | H2-j | yes |

### Verification
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: rc=0, 1880 pass, 0 fail (H1 baseline 1864). Log: `.tmp/agnostic-B-FIX1-H2.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).

### Deviations and notes
- The prev-manifest clause of the hook-command scan has no isolated `planDeploy` row. A project-added hook still appears in current settings, so the union is never separable at planDeploy level. The clause is covered only by the `triplesCommands` unit row (H2-g).
- Transitive script references stay unguarded, per the ruling's deferral.
- Test runs need `NODE_PATH=$HOME/get-shit-done/node_modules` (no `node_modules` in this worktree).
- Nothing pushed. No `install:gsd`. No stash, reset or clean.

## Task 3 (M4+M3)

### Commits
- `cc7c84c` fix(agnostic-B-FIX1): M4 typed APPLY confirmation, M3 redacted report settings, H2 prev-manifest row

### Outcome
- `project-deploy-confirm.js` (new): `shownFiles`, `confirmationText(plan)`, `confirmed(plan, ask)`, `readTtyLine(text)`, `show` (JSON.stringify plus escaping of C1 controls, U+2028/9).
- `project-deploy-redact.js` (new): `redactShape(shape)`, `settingsReport(settingsPlan, secretFound)`.
- `project-deploy.js` (298 lines): `planDeploy` success result adds `exempt`, `presetPath` (realpath), `shown`; `planFile`/`planSettings` carry the current bytes as `old`; `report.settings` built by `settingsReport`. `runCli` gates after the diff return.
- `package.json` `scripts.test`: added `project-deploy-confirm.test.js`, `project-deploy-redact.test.js`.
- Existing human-session CLI calls now inject `APPLY_IO`: `project-deploy.test.js` (run helper, A12 line), `project-deploy-guard.test.js` (H2-k). No assertions changed.

### Injected hook signatures (for C-03 deploy tests)
- `runCli(cwd, args, env, session, io = {})`. `env`: plain object (`{}` for a human run). `session`: `{ stdin_tty, stdout_tty, agent_ancestor }`. `io.confirm(text: string) => string`: proceed only when it returns exactly `'APPLY'`. Default when `io.confirm` is absent: `readTtyLine`, which writes the text and one prompt line to `/dev/tty` and reads one line; open failure returns `''` (declined).
- Test pattern: `const APPLY_IO = Object.freeze({ confirm: () => 'APPLY' })`; spy pattern: `const asked = []; io = { confirm: (t) => { asked.push(t); return answer; } }`.
- `planDeploy({ root, command, presetDir, presetName, presetsRoot, env, session, presetFlag })` unchanged in input. Success result: `{ report, ops, exempt, presetPath, shown }`.
- Refusal on decline: `exitCode 1`, `result.refused = { reason: 'confirmation declined', paths: guarded_changes }`, `written: []`.
- `report.settings` shape: `{ action, added, removed }` with values redacted, or `{ action, added: null, removed: null, redacted: true }` when `secret_hits` is non-empty.

### Test rows
| Row | Case | Expectation |
|---|---|---|
| C1 | `APPLY` after a guarded hook change | exit 0, hook written |
| C2 | `apply`, empty, `APPLY `, `yes` (4 rows) | exit 1, `confirmation declined`, `written: []`, tree unchanged |
| C3 | `diff` with a guarded change and an answer of APPLY | exit 2, never prompts |
| C4 | rule-only (unguarded) sync | never prompts |
| C5 | init over an existing `{}` settings file | prompts (not exempt) |
| C6 | settings fragment adds `Bash(git:*)`, drops the hook | text has `+ permission allow: "Bash(git:*)"` and `- hook: {json}` verbatim |
| C7 | ESC byte in a guarded hook | text has `\u001b`, no raw ESC |
| C8 | guarded hook change | shown `new sha256` equals the bytes written |
| C9 | settings-only change (no hook) | prompts (settings is a guarded write) |
| R1 | `redactShape` unit | token replaced by `<redacted:vcs_token>`; clean strings untouched |
| R2 | token in a rendered hook command | ok false, `settings` `{added:null, removed:null, redacted:true}`, token absent from report |
| R3 | token-bearing allow rule removed by sync | `removed.permissions.allow` = `['<redacted:vcs_token>']`, ok true, token absent from report |
| H2-q | script named only by the previous manifest hook | `guarded_changes` = `['scripts/gate.sh']` (fills the Task 2 gap) |

### Mutants (`.tmp/mutate-m4m3.js`, sha256 checked before and after each)
| Mutant | Killed by (first failing row) | Restored identical |
|---|---|---|
| M4 drop the `confirmed` call in `runCli` | C1, C2 | yes |
| M4 case-insensitive compare | C2 (`apply`) | yes |
| M4 omit removed lines | C6 | yes |
| M4 print raw values (no `show`) | C7 | yes |
| M3 redact added only | R3 | yes |
| M3 drop secret branch (added/removed nulled) | R2 | yes |
| H2 drop previous-manifest hook-command clause | H2-q | yes |

### Verification
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: rc=0, 1896 pass, 0 fail (Task 2 baseline 1880; +15 new, +1 H2-q). Log: `.tmp/agnostic-B-FIX1-M4M3-full.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).
- Unmutated baseline of the mutant run: rc=0.

### Deviations and notes
- `readTtyLine` (the real `/dev/tty` path, including open-failure = declined) is not exercised by a test: a live read would block the runner in a terminal. Covered by injection in every test; the TTY path is unverified-by-test and needs a manual check.
- Settings writes count as guarded (`guarded_changes` already included SETTINGS), so any sync that changes `.claude/settings.json` requires `APPLY`. C9 pins this. Flagged as a UX cost, not changed here.
- The confirmation text shows the redacted `report.settings` values, so a removed token is shown as `<redacted:...>`.
- The `show` escape also covers DEL, C1 controls, U+2028/9 (beyond the ruling's ESC example), because a terminal can interpret those.
- M5 and later tasks untouched. Nothing pushed. No `install:gsd`. No stash, reset or clean.
