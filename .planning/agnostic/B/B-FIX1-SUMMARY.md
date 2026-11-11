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

## Task 4 (M5)

### Commits
- `fix(agnostic-B-FIX1): M5 ancestor and env checks hardened` (see `git log --oneline -1` on exp/agnostic)

### Outcome
- `project-deploy-session.js` (75 lines): steering, not a boundary (header comment). Missing ancestor now refuses (`agentAncestor` returns true). `ps` reads `args=`; an agent matches on basename or args with `/(^|\/)claude(\s|$)|claude-code|@anthropic-ai|^claude/i`. Env failure on any key matching `/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_AGENT_SDK)/` with a defined value. New `orphan` session field (own ppid is 1), new `orphan` guard failure.
- `detectSession` now returns `{ stdin_tty, stdout_tty, agent_ancestor, orphan }`. The existing P12 assertion in `project-deploy.test.js` gains `orphan: false` (intentional).
- Injected session shape for tests is unchanged for callers: `{ stdin_tty, stdout_tty, agent_ancestor }` (`orphan` absent means not orphan).
- `project-deploy-session.test.js` (new, 5 rows), added to `package.json` `scripts.test`.

### Test rows
| Row | Case | Expectation |
|---|---|---|
| M5-a | node with ppid 1 | `orphan` refused |
| M5-b | ancestor chain with a missing link | agent_ancestor refused |
| M5-c | `node .../claude-code/cli.js` ancestor (args) | agent_ancestor refused |
| M5-d | only `CLAUDE_CODE_SESSION_ID` set | `['env']` |
| M5-e | clean zsh→login→Terminal→launchd | no failures |

### Mutants (`.tmp/mutate-m5.js`, sha256 checked before and after)
| Mutant | Killed by | Restored identical |
|---|---|---|
| revert missing-ancestor line | M5-b | yes |
| drop orphan rule | M5-a | yes |
| exact-match CLAUDECODE only | M5-d | yes |

### Verification
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: rc=0, 1901 pass, 0 fail (Task 3 baseline 1896; +5 new). Log: `.tmp/agnostic-B-FIX1-M5.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).

### Deviations and notes
- M5 is steering: a pty-holding agent with a scrubbed env passes these checks. Stated in the module header; the real boundary remains the Phase H PreToolUse deny (B-FIX1 deferred list).
- Args matching can refuse a human whose shell command line contains a `claude` path segment (safe direction).
- Nothing pushed. No `install:gsd`. No stash, reset or clean.

## Task 5 (L6+L8)

### Commits
- `710654b` fix(agnostic-B-FIX1): L6 malformed manifest shape stops planDeploy
- L8 commit: `fix(agnostic-B-FIX1): L8 scan patterns for URL credentials, bearer and assigned secrets; readRegular lstat`

### Outcome
- L6: `project-deploy-manifest.js` (new, 26 lines) `manifestShapeError(manifest)` returns `'files'`, `'settings'` or `null`. Checks `files` entries are objects, `settings` is an object or null, `settings.hooks` elements are `{event:string, command:string, matcher?:string}`, `settings.permissions` allow/deny/ask are string arrays. `planDeploy` (`project-deploy.js`, 300 lines) stops with `manifest is malformed` right after the JSON parse.
- L8: `project-deploy-scan.js` adds `url_credentials`, `bearer_token`, `assigned_secret` (ruling regexes). `project-deploy-fs.js` `readRegular` uses `lstatSync`, so a symlink is `not a regular file`.
- Test-source hygiene: the `assigned_secret` pattern flags `const token = TOKENS.vcs_token;` in the scan test (self-scan, test 6), so the variable is renamed to `planted`. Token-shaped test strings are built at runtime (`'postgres' + '://' + ...`).

### Test rows
| Row | Case | Expectation |
|---|---|---|
| L6-a | well-formed manifest, null settings, empty manifest | `null` |
| L6-b | `settings.hooks:[null]`, `hooks:[{event:1}]`, `files:{a:null}`, `settings:"x"`, `permissions.allow:[1]` | named shape error |
| L6-c | planDeploy with `settings.hooks:[null]` | `manifest is malformed`, `ops.manifest` null, tree unchanged |
| L8-a | one positive per new pattern (`url_credentials`, `bearer_token`, `assigned_secret`) | pattern id and line only, never the text (test 1 via `TOKENS`) |
| L8-b | negatives `TOKEN=${GITHUB_TOKEN}`, `https://example.com/a@b` | no hits |
| L8-c | symlink to a regular file through `readRegular` | `not a regular file`; target read; absent gives `bytes: null` |

### Mutants (`.tmp/mutate-l6.js`, `.tmp/mutate-l8.js`, sha256 checked before and after)
| Mutant | Killed by | Restored identical |
|---|---|---|
| L6 skip hooks element check | L6-b, L6-c | yes |
| L8 drop placeholder lookahead in `assigned_secret` | L8-b (and self-scan) | yes |
| L8 `readRegular` back to `statSync` | L8-c | yes |

### Verification
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: rc=0, 1908 pass, 0 fail (Task 4 baseline 1901). Log: `.tmp/agnostic-B-FIX1-L8.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).

### Deviations and notes
- L6 `files` non-object (for example a string) is now also malformed. Previously tolerated as empty. Intentional: the manifest is written only by this engine, so any other shape is corruption.
- L6 `permissions` non-object is malformed; `mergeSettings` previously ignored it.
- L8 `assigned_secret` will flag any source line with `token = <12+ non-space chars>`. The scanner runs over presets and rendered output, so this is the intended class; the repo's own test file needed the rename.
- Nothing pushed. No `install:gsd`. No stash, reset or clean.

## Task 6 (L7)

### Commits
- `39c35ea` fix(agnostic-B-FIX1): L7 transactional applyPlan with random temp names and rollback

### Outcome
- `project-deploy-apply.js` (169 lines): `applyPlan(root, plan, command, io)`. Stage phase: each changed target becomes `${target}.gsd-tmp-${random}` opened with `'wx'`, with original bytes and mode captured; any failure unlinks the temps and removes directories this apply created. Commit phase: `canonicalRel` re-run per dest, then rename in order, manifest last. Any rename failure restores originals (temp plus `fs.renameSync`), unlinks created files and removes created dirs.
- `applyFailure(report, applied)` exported; `project-deploy.js` runCli failure branch uses it (290 lines, down from 300).
- `writeAtomic` and `ensureGitignore` removed. The `.gitignore` write is now a staged step of the same transaction.
- `project-deploy-apply.test.js` (new, 5 rows), added to `package.json` `scripts.test`.
- `project-deploy.test.js`: `writeAtomic` import dropped; A14 rewritten (see deviations).

### Injected hooks (for C-03 tests)
- `applyPlan(root, plan, command, io = {})`. `plan` is the whole `planDeploy` result (`{ ops, ... }`), not `ops`.
- `io.rename(from, to)`: default `fs.renameSync`. Used only for commit-phase renames. Restores use the real `fs.renameSync`, so an injected failure cannot also break rollback.
- `io.random()`: returns the hex suffix for temp names. Default `crypto.randomBytes(8).toString('hex')`.
- Return: success `{ ok: true, written }`. Failure `{ ok: false, written, rolled_back, failed: { path, reason } }`. `written` lists rels left changed (`[]` when rolled back). `rolled_back` is `true` when nothing persists, including a stage-phase failure; `false` only when a restore itself failed.

### Test rows (`project-deploy-apply.test.js`)
| Row | Case | Expectation |
|---|---|---|
| L7-a | rename fails at step 3 of 5 (a, b, deep/c, settings, manifest); a.txt pre-exists mode 0600 | `ok false`, `rolled_back true`, `written []`, snapshot (hash and mode) byte-identical, `deep/` removed |
| L7-b | success path rename order | `[a.txt, b.txt, deep/c.txt, settings, MANIFEST]`, manifest last |
| L7-c | real init plan, rename fails at step 3, then re-plan and re-run | rolled back identical; second plan and apply succeed, manifest written |
| L7-d | `random` fixed; sentinel planted at the first temp name | `ok false`, sentinel and whole tree unchanged |
| L7-e | symlink planted at `${target}.gsd-tmp-${process.pid}` pointing outside | apply `ok`; outside victim unchanged; target has new bytes |

### Mutants (`.tmp/mutate-l7.js`, copy-and-restore, sha256 checked before and after)
| Mutant | Killed by (first failing row) | Restored identical |
|---|---|---|
| `'wx'` changed to `'w'` | L7-d | yes |
| skip restore (`[...done].reverse()` replaced with `[]`) | L7-a (and L7-c) | yes |
| manifest not last (commit loop reversed) | L7-b | yes |

### Verification
- `node --test get-shit-done/bin/project-deploy-apply.test.js`: 5 pass, 0 fail.
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: rc=0, 1913 pass, 0 fail (Task 5 baseline 1908, +5 new). Log: `.tmp/agnostic-B-FIX1-L7.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).

### Deviations and notes
- A14 (`project-deploy.test.js`) asserted the old partial result (`written: ['good.txt']`, file kept). Under the transaction the first write is rolled back, so it now asserts `written []`, `rolled_back true`, and `good.txt` absent. Intentional, per L7.
- The rollback path for a failed restore (`rolled_back: false`, `written` lists the stuck paths) has no test row. Unverified by test; the code path is `rollback()` `catch` branch in `project-deploy-apply.js`.
- Directories created by an apply are removed on rollback. Covered by L7-a only.
- Nothing pushed. No `install:gsd`. No stash, reset or clean.

## B-FIX1 totals
- Final test count: `NODE_PATH=$HOME/get-shit-done/node_modules npm test` rc=0, 1913 pass, 0 fail (baseline before B-FIX1 1847).
- Ratchet lint: `node scripts/agnostic-lint.js check` ok (869 denied, 338 allowed).
- Findings and fix commits:
  - H1 name-based guard bypass: `1b50dda`
  - H2 referenced hook and preset files unguarded: `43d5ff3`
  - M3 secret echo via report.settings: `cc7c84c`
  - M4 no human review step: `cc7c84c`
  - M5 weak ancestor check: `d45751d`
  - L6 null in manifest.settings.hooks: `710654b`
  - L7 non-transactional applyPlan, predictable temp name: `39c35ea`
  - L8 narrow secret scan, readRegular follows symlinks: `ed0bbcb`
- Steering-only limit (M5) and transitive script references stay deferred, per the ruling (Phase H).
