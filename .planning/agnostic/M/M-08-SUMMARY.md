# M-08 summary: base know-how docs and rules, tasks 8.1, 8.2, 8.3, 8.6

Branch `exp/agnostic`, base `be0f432`. Executor Haiku 5.5. Not pushed; no `install:gsd`.
Done: 8.1 `e9488da`, 8.2 `3a07e9c`, 8.3 `cd621bd`, 8.6 `04b851e`. Not in this brief: 8.4, 8.5, 8.7-8.14.

| Task | Commit | Deployed files (lines) | Tests added |
|---|---|---|---|
| 8.1 | e9488da | rules/shared-stack.md (43), docs/host-ops.md (62), docs/file-claims-template.md (14), docs/cleanup-keep.txt (8) | 1 unit; 3.1, 3.7 lists |
| 8.2 | 3a07e9c | docs/agent-ops-lessons.md (50): 23 lessons, 6 finding entries | 1 unit (counts) |
| 8.3 | cd621bd | docs/engineering-lessons.md (17): 6 lessons, 2 rescued; docs/defect-classes.md (18): 10 classes | 1 unit (counts, headers) |
| 8.6 | 04b851e | rules/guard-authoring.md (55), rules/pre-pr-gates.md (46), rules/module-structure.md (52) | 1 unit (render) |

Gates: after each commit, targeted `node --test --test-name-pattern "3\.1 |3\.6 |3\.7 |8\.[1-6] " get-shit-done/bin/preset-base.test.js` 17 pass, 0 fail; `node scripts/agnostic-lint.js check` ok (740 denied, 363 allowed), no baseline change. Full `npm test` not run (coordinator). The fork has no `node_modules`; tests ran with `NODE_PATH=~/get-shit-done/node_modules` (read-only use of the GSD install's dependencies).

Shared bookkeeping: 3.7 DEPLOYED literal 15 → 25 (counted from the file); 3.1 list extended per task; mirror count 22 → 32. Manifest docker exception lines moved +40 (189-195, 233, 236, 237 → 229-235, 273, 276, 277); `settings.json` lines unchanged.

## 8.1 notes

- Thresholds: three dated rules disagreed; the newest decides and `host-ops.md` states it (restart below 3 GiB, 2026-10-31; pre-run gate 8 GiB and swap 10 GB, 2026-11-07). Thresholds are named parameters in prose, not profile keys (`stack.host` has only two fields).
- Container runtime and project lock names replaced by generic wording. The default keep list uses `stack.lock*`: 8.4 must default its lock file to a name that glob matches.

## 8.2 notes

- Deviation: K:165 gives 27 files, but K has no per-file table. I identified 23 from the memory index and the bodies I read in full. Four are not identified and are not invented. Coordinator to decide whether to add them.
- Deviation: `fix_all_findings` is classed engineering (K:166), so it sits in 8.3, not here.
- Deviation: three bullets run to three sentences (limit two).
- Pointer renamed: the source slug for the targeted-tests lesson contains a gate term; the entry cites `feedback_targeted_tests_one_full_check_per_phase`.
- Model-allowance rules not carried (as specified). Stack lessons not in this file.

## 8.3 notes

- Deviation: K:166 gives 17 general-engineering files; I identified 6 and added the 2 rescued lines from the stale notes (K:169). Same reason as 8.2.
- Defect-class template: the source table has five columns; the template uses four (`Defect class | Origin | Escaped gate | Evidence`), with the instance folded into Evidence. Reviewer to confirm.
- Class names are stack-neutral; project rows are not included.

## 8.6 notes

- Source `pre-pr-quality-gates.md` is deployed as `pre-pr-gates.md`, as the task file list says.
- Source file:line cites and commit ids are dropped (they name project files); incidents stay as prose.
- The `--all`, `--backend`, `--frontend`, `--skip-twice` flags are dropped: the 8.7 skeleton has none. Branch-axis coverage rule dropped (a defect of the source runtime's coverage merge); the line-axis ratchet is kept.
- Cross-task names fixed here, for 8.7 and 8.8/8.9: disagreement log `.planning/pre-pr-disagreements.jsonl`; canary gate `scripts/validation/canary-gate.mjs`; guard registry `scripts/validation/guard-registry.mjs`; registry doc `docs/gsd/guard-estate.md`. The style gate and its baseline are named generically until 9.2.
- Module-structure parameters (`LOC_CEILING` 500, `SPLIT_TARGET` 400, `TEST_TARGET` 1500, `SCAN_ROOTS`) are named in prose.

## Safety

No destructive git. No changes outside the fork worktree. Scratch under `.tmp/` (gitignored) removed. `.audit/` untouched. No secret-shaped literals written.

## 8.4 notes (stack lock, redesign)

Commit below. Kept from the source: flags, defaults shape, usage text, exit codes 75/2/127/1, `owner.txt` informational only (written after acquire, cleared on release, never read), signal forwarding with 130/143. Dropped: kernel `flock` (replaced by the `wx` create plus liveness takeover), the `Result` plumbing, the Deno permission flags. Default lock file `.tmp/stack.lock`, owner `.tmp/stack.lock.d/owner.txt`, takeover dir `.tmp/stack.lock.takeover`: all match the keep list's `stack.lock*`. Entries `guarded: true`, `render:false`, modes 100755. Tests: 12 in `get-shit-done/bin/preset-base-scripts.test.js` (registered in `package.json` test list), about 18 s; the 3.7 lists, guarded-flag count (20) and mirror count (34) updated; exception manifest lines moved +8 (237-243, 281, 284, 285).

Mutants (each run against the test file, restored byte-equal after):
- m1 liveness always dead: killed by L-b, L-c, L-d, L-f.
- m2 `'wx'` to `'w'`: killed by L-b, L-c, L-d, L-f.
- m3 takeover unlinks without the re-read: survived L-f (the interleaving is timing-dependent), killed by new L-j (calls the exported `takeover` with a lock file taken since the decision).
- m4 release unlinks without the pid check: survived the plan's tests, killed by new L-k (holder's lock file replaced by another pid before release).
- m5 timeout exit 1: killed by L-c, L-b, L-d, L-h.
- m6 signal not forwarded: killed by both L-g legs.
- m7 env without the spread: killed by L-a.

Deviations: (1) `stack-lock.sh` uses `exec node` (the plan text omits `exec`): without it a signal sent to the `sh` pid would not reach node, and L-g sends it to the wrapper pid. (2) m3 and m4 needed two added tests (L-j, L-k, `takeover` exported) beyond the plan's behaviour list; the plan's mutant-to-test mapping for m3 did not hold. (3) `shared-stack.md` line 11 now spells out the three limits (the plan asks for them there). (4) Tests used `NODE_PATH=~/get-shit-done/node_modules` for `preset-base.test.js` only (fork has no node_modules). Limit (2) (10 s create-to-write window) is for the batched Fable review to rule on, as the plan states.

## 8.5 notes (session supervisor + doc)

Deployed: `scripts/session-supervisor.sh` (mode 100755, `guarded: false` as the plan lists only the lock and gate scripts), `docs/gsd/session-supervisor.md`. Mirror count 34 → 36; manifest exception lines moved +8 again (245-251, 289, 292, 293). Tests S-a to S-e (5, in `preset-base-scripts.test.js`) assert the source's own exit rules: 0 on success (lines 297-300), 1 on bad args (188, 195, 199), 2 on a non-limit failure without a resume (335-339 of the source, 339 deployed), 4 at the resume cap (359), 3 for a missing or past reset time (367, 386), resume with the flag appended after a dry-run wait. The parser is a stub passed with `--gsd-tools`, so no test needs `dotenv` or the installed GSD.

Changed against the source (diff: 54 source lines changed or removed; the plan expected 13):
- Charlotte example in the header and help (2 blocks), the batch-wrapper path and nohup example (2), the project's cleanup-library `source` lines and trap (the two libraries are project files, not deployed), the pre-attempt reap call, the OAuth block comment and message (names the project, a findings id and a runner path), one comment naming a runner directory.
- New flags instead of project terms: `--gsd-tools <path>` (default `$GSD_TOOLS`, else the installed path) and `--cleanup-cmd <cmd>` (replaces the two library calls; run via `sh -c`, failure ignored). Doc: Charlotte quick start, the gate/secret-scan sentence (now profile key `stack.commands.pre_pr_gate`), budget paragraph, related list, two new table rows.

Deviations: (1) the changed-line count is 54, not 13, because the flags needed help/header/doc text and the removed libraries took their call sites with them. (2) The script keeps `#!/bin/bash` and needs `jq` (source behaviour, exit 1 when missing; `jq` is on `ubuntu-latest`); the plan's "Node or POSIX shell alone" is not met for this script. Flagged for the Fable review: replacing `jq` with `node -e` would be a rewrite. (3) Tests ran with `NODE_PATH=~/get-shit-done/node_modules` for `preset-base.test.js` only.

## 8.7 notes (pre-pr-gate.sh skeleton + disagreement log)

Deployed: `scripts/pre-pr-gate.sh` (130 lines, `guarded: true`, mode 100755) and `scripts/log-pre-pr-disagreement.sh` (`guarded: false`). Tests G-a to G-f (6, the plan's 5 plus the log script) in `preset-base-scripts.test.js`; they deploy the real base preset with `project init` and use the deployed push hook. The 3.7 lists, guarded count (21), mirror count (38) and manifest exception lines (+8: 253-259, 297, 300, 301) updated.

Kept from `preflight.sh`: `run_check` (PASS/FAIL line, last 15 lines of a failure), two stages (deterministic once, flake-sensitive twice, run 2 only after run 1 passed), `print_summary`, the disagreement comparator reduced to the one reachable case (pass then fail). Dropped: `detect_affected`, the affected-project axes, `run_bounded`/perl process groups, `--all/--backend/--frontend/--skip-twice/--no-stack/--max-buckets`, coloured output, the coverage and integration stages. Commands come from `.planning/config.json` in one `node -e` read: `typecheck`, `lint`, `test_all`, then each `stack.gates[].run`; an unset key prints `NOT CONFIGURED: stack.commands.<key>` and fails before anything runs. The marker is `$(git rev-parse --absolute-git-dir)/.pre-pr-passed`, removed at the start of every run and written only after a fully green run. The push block is therefore active on a default project from the first commit (3.8 point 3 ruling applies).

Mutants (each run against G-a..G-f, restored byte-equal): m1 marker written on a red run: killed by G-d, G-e. m2 marker in the repo root: killed by G-a, G-b, G-e. m3 unset command treated as a skip: killed by G-c. m4 stale marker kept: killed by G-e. m5 run 2 skipped: killed by G-d. m6 gates skipped: killed by G-e.

Deviations: (1) `log-pre-pr-disagreement.sh` is not rename-only: `jq` is replaced by `node -e` (rule: scripts run on Node or POSIX shell alone), the env override is `PRE_PR_DISAGREEMENT_LOG`, shebang `#!/bin/sh`. (2) `with_stack_lock` is not carried: the stack lock leaves `.tmp/` files and the engine's `.gitignore` block does not ignore `.tmp/`, which would break "no new untracked file". A project whose commands use the shared stack runs `scripts/stack-lock.sh --label pre-pr-gate -- scripts/pre-pr-gate.sh`; the gate header says so. (3) Stage 3 (`stack.gates[]`) runs once after the test stage, as the plan orders it; the gate has no per-gate "deterministic" flag, which `pre-pr-gates.md` (8.6) mentions in prose. (4) Targeted tests ran with `NODE_PATH=~/get-shit-done/node_modules` for `preset-base.test.js` only.

## 8.8 notes (canary gate, guard registry, sample guard; Node redesign)

Deployed under `scripts/validation/`: `canary-gate.mjs` (mode 755, 112 lines), `guard-registry.mjs`, `guards/sample-guard.mjs` (755), `canaries/sample-guard.canaries.mjs`; all `guarded: false`, `render: false`. Tests C-a to C-f (6; the plan asked for 4) in `preset-base-scripts.test.js`; the gate tests run the gate from a tmp copy of the deployed `scripts/validation/` tree (no `project init`, no network). 3.7 lists, mirror count (42) and manifest exception lines (269-275, 313, 316, 317) updated.

Kept (ported from `canary-gate.ts`): `evaluateCanaries`, `reconcileCorpusCoverage`, `exitCodeFor`, `MIN_FIXTURES_PER_GUARD = 3`, a throwing `detect()` counts as missed (`:121`), the report text, `--json`. Dropped: the static import list and the hand-kept array (`:32-46`, `:59`), the TypeScript id unions (`guard-registry.ts:17`, `canary-gate.ts:31`), corpora outside the registry, Deno entry. New: dynamic discovery of `canaries/<id>.canaries.mjs`; `UNREADABLE <id>: ...` for a missing file, a failed import, or a missing/ill-shaped `CANARIES` (exit 1); `PHANTOM <id>` for a corpus file with no row (exit unchanged); `validateRegistry` (exported by `guard-registry.mjs`): non-array, missing or `|`-bearing strings, a non-slug id (it is a file name, so `../x` is refused), a duplicate id all fail the gate (`REGISTRY INVALID`). Source test cases ported in C-e: `canary-gate.test.ts:41, 50, 63, 72, 85, 104, 110, 116` (`:132`, `:141` need the igaming registry and are not ported).

Extra mutants (not in the plan), each killed: throwing `detect` treated as pass (C-b, C-e); floor 2 (C-b, C-e); unreadable corpus left out of the exit code (C-c, C-e); phantom made to fail the gate (C-a..C-e).

Deviation: `guard-registry.mjs` rows use `implementedIn` as a bare path (not a doc cell with annotation), so 8.9's on-disk check needs no path extraction.

## 8.9 notes (guard-registry reconcile; Node redesign)

Deployed: `scripts/validation/guard-registry-reconcile.mjs` (mode 755), `docs/gsd/guard-estate.md` (the one table, one row; the "where to add a new gate" text is by reference to `guard-authoring.md` section 4). Tests R-a to R-d (4) in `preset-base-scripts.test.js`; 3.7 lists, mirror count (44) and manifest exception lines (277-283, 321, 324, 325) updated. `guard-authoring.md` section 3 item 3 now says the corpus is discovered by the file name `canaries/<id>.canaries.mjs` (it described the dropped corpus aggregation list).

Kept (ported from `guard-registry-reconcile.ts`): `parseTableByHeading` (`:44`), `parseGuardTable`, `reconcile` (missing, phantom, field divergence, `:106`), `exitCodeFor`, `scanGuardIdReferences` (`:167`) over the one document, and the on-disk check of every `implementedIn` path (the source applied it only to ids without a live export). A missing document is a failure. Dropped: the live `ALL_GUARDS` cross-check (`:16`, `notInLiveAllGuards`), the failure-mode matrix (`verifyFmMatrix`, `MATRIX_PATH`, `:186`, `:20`), the second and third document paths (`:19-21`), `extractPath` (the registry cell is a bare path), id lower-casing (ids are slugs, compared exactly). Changed: guard references in the document are backticked `guard:<id>` tokens (the source's `gN` shape cannot match slug ids); `TABLE NOT FOUND` and `DOCUMENT MISSING` are explicit lines. Source cases ported in R-d: `guard-registry-reconcile.test.ts:85, 95, 111, 123, 132, 180, 268, 276, 288, 310, 322, 329`; not ported: `:148`, `:157` (live export), `:168` (`extractPath`), `:336-:369` (matrix), `:203`, `:369` (real documents).

Mutants (own, not in the plan; each killed): divergence check skipped (R-b, R-d); path check skipped (R-d); missing table passes (R-c); phantom references ignored (R-c, R-d).

## 8.10 notes (CI diagnose, Node port; commit 4ae67b8)

Deployed `scripts/ci-diagnose.mjs` (272 lines; `render: false`, `guarded: false`). Port of `igaming-platform/scripts/ci-diagnose.ts` (495 lines). Flags, output and exit codes as the source: `--run-id` or `--sha`, `--repo owner/name`; exit 1 for usage, missing token, bad arguments. Tests D-a to D-g (7) in `preset-base-scripts.test.js`; `runCi` strips `GH_TOKEN` and `GITHUB_TOKEN`. Mirror count 45.

Deviation: the commit 4ae67b8 staged a blob read before HEAD moved (another executor committed), which reverted M-03's 3.7 hunks. Restored by 39f9d48. Self-caught; no reviewer raised it.

## 8.11 notes (skills; commit 7638deb)

Deployed under `.claude/skills/`: `test-enforcement/SKILL.md` (173 lines), `create-unit-test/SKILL.md` (249), `create-unit-test/test-outline.md` (66), `create-documentation/SKILL.md` (107), `templates/api.md` (187), `templates/guide.md` (268). Neutral rewrite: `stack.commands.*` and `stack.paths` placeholders, `test_globs`, Node test runner examples, `git grep -n` commands. The igaming-specific wording in the two templates is replaced. A stray `api.md-e` from a BSD `sed -i -e` mistake was removed by 13398cf. No tests of their own; 3.1 and 3.7 lists updated; mirror count 51.

## 8.12 notes (gated group backend; commit c052094)

Deployed `rules/handler-correctness.md` (102 lines), `rules/data-integrity.md` (71), `skills/vibe-security/SKILL.md` (658), each with `capability: "backend"`. Sources: `edge-functions.md` 202-285, 343-355; `fp.md:19`; `bonus-system.md:17`; `database.md` 10-41, 192-227, 236-286. In vibe-security, five lines were made generic and a sixth (line 250, the `NEXT_PUBLIC_*`/`REACT_APP_*` prefixes) was found by the 3.7 term scan and fixed before the commit.

3.7 expects the gated list per configuration. Engine rule: a file with a `capability` deploys only when that key is a plain object (`project-deploy-render.js:255`). The registry fills an absent key with `{}` (`project-registry.js:109`), so an absent key is on and only an explicit `false` turns a group off. Mirror count 54. The separate gated term-check test written first was removed as redundant: the gated files are deployed in the default configuration, so the 3.7 term scan already covers them.

## 8.13 notes (gated group web_ui; commit af5c5e8)

Deployed `rules/e2e-assertions.md` (106 lines), `rules/frontend-testability.md` (42), `rules/qa-exemptions.md` (41), each with `capability: "web_ui"`. Sources: `e2e-testing.md` 12-66, 111-129, 150-175, 194-199; `frontend-apps.md` 33-58, 89-99; `qa-exemptions.md` 12-48. Neutral: UI QA driver is `stack.capabilities.ui_qa`, frontends are `stack.paths.frontends`, evidence key is `ui_qa_ran` (was `charlotte_qa_ran`). A `withdrawal-pending-banner` example was replaced by `pending-banner` after the scan. Mirror count 57.

## 8.14 (preserve the rest; CEO waived the private-fork condition)

Commit 0638097. The fork is public (`PUBLIC`); the CEO accepted that. Copies made read-only from the sources; nothing written outside this worktree, nothing pushed.

| Row | Destination | Files (lines) | Notes |
|---|---|---|---|
| 3 | `presets/igaming/memory/` | 71 (1,923) | 9 stale dropped (3 session logs, 6 April test-speed notes). Owner title, absolute paths, contact details and credential-shaped values replaced. |
| 3 | `presets/igaming/lessons-stack.md` | 17 entries (69) | Stack lessons picked by reading each file; slugs listed in the agent report. |
| 7 | `.planning/gsd-v2/tools/` | 126 | 37 root `.py`, 82 `agent-audit/*.py` + `roles.json`, `hooks-flip-backup/` (6). Pickles and stats JSON left out. |
| 8, 9 | `.planning/gsd-v2/experiments/16-ab2/` | 6 | Two A/B notes; `runs-rp-pilot-void.jsonl`, `runs.jsonl`, `decisions.jsonl`, `registry.json` (source at `evolve/`). |

Scrub: `/Users/...` paths to `<project-root>`, `<home>`; owner handle to `<owner>`; `CEO` to `owner`; JWT, `gh[pousr]_` and e-mail shapes to `<redacted>`. The deploy scan (`scanDir`) is empty over all four trees.

Tests (`preset-igaming.test.js`, new describe `8.14`, 5 tests): counts per row, the stale names absent, 17 lesson entries, the deploy scan, no absolute path, contact address or owner title. G2 now excludes `memory/` and `lessons-stack.md` (added to META and `UNDEPLOYED_DIRS`). Result: 16 pass, 0 fail (with `NODE_PATH=$HOME/get-shit-done/node_modules`). `agnostic-lint check` ok (55 denied, 406 allowed).

Deviations:
1. Stale count: 9 dropped, not 8 (K:169 class is 3 session logs + 6 story files). `phase_235_fixes_applied.md` kept.
2. Memory source now holds 80 files; K says 81.
3. `roles.json` stays under `agent-audit/` (its source location), not the tools root.
4. `hooks-flip-backup/` copied scrubbed; the two settings backups held an example JWT, a `ghp_`-shaped string and an e-mail placeholder, all redacted. Scripts that used absolute paths now need `<project-root>` set before they run.
5. Memory notes not reconciled (K:1.7 asks for conflicts to be resolved before copying): restart thresholds, `.schema()` advice and misnamed files copied as written.
6. `user_role_ceo_cpo.md` keeps its file name (pointers kept); `originSessionId` frontmatter kept as opaque metadata.
7. The `preset-igaming.test.js` META change is a new `UNDEPLOYED_DIRS` prefix, not a name list entry, because `memory/` is a directory.

## Gate state (targeted only)

- `NODE_PATH=$HOME/get-shit-done/node_modules node --test get-shit-done/bin/preset-base-scripts.test.js`: 40 pass, 0 fail.
- Same with `--test-name-pattern '3\.7|8\.'` on `preset-base.test.js`: 15 pass, 0 fail (earlier 3.1 pattern run: 18 pass).
- `node scripts/agnostic-lint.js check`: ok (55 denied, 406 allowed).
- Without `NODE_PATH` the scripts file fails 5 tests with `Cannot find module 'dotenv'`. This is a run-setup issue, not a code fault.

## Deviations (8.10 to 8.14)

1. 8.10 staging race reverted M-03 hunks; fixed by 39f9d48.
2. 8.11 stray `api.md-e` committed; removed by 13398cf.
3. Capability default: absent key is on (registry fill), explicit `false` is off; the engine alone would omit absent keys.
4. 8.12 vibe-security line 250 found by the term scan, not the plan.
5. 8.14 executed after the owner waived the private-fork condition (see the 8.14 section); the earlier "not executed" note is superseded.

## Fable round 1 fixes

Files are under `get-shit-done/` (tests: `bin/preset-base-scripts.test.js`, `bin/preset-igaming.test.js`). Each fix was red before the change; mutants were run by hand and reverted.

| Finding | Commit | Test / mutant |
|---|---|---|
| M1 malformed `stack.gates` passes | `38366ee` | G-g (8 malformed shapes: wrong key, empty run, empty id, no id, string, null, object, string gates: exit 1, `NOT CONFIGURED: stack.gates`, no marker), G-h (valid and absent gates still run). Mutant dropping the id check: killed. |
| M2 vacuous canary pass | `432b3e0` | C-g (false, `'no'`, undefined, truthy string, async: exit 1). Mutant `!result`: killed. A promise is reported as "must be synchronous"; async detect is not supported. |
| M3 wrapper killed, command lives | `6e4a23d` | L-m (SIGHUP 129, SIGQUIT 131 reach the child), L-n (real child; SIGKILL of the wrapper, waiter gets 75 while the command lives, then acquires), L-o (classify: either pid alive means alive). Lock file now carries `childPid` (temp file + rename). Mutants: classify on wrapper pid only killed L-n and L-o; FORWARDED without HUP/QUIT killed L-m. Remaining limit (header item 5): grandchildren left after the command exits are not tracked. |
| M4 8.14 pointers on a public fork | `b9cd8e4` | Preserved memory, lessons and tools no longer point at unresolved weaknesses, credential locations or fix hashes tied to a vulnerability. New 8.14 tests: pointer scan (a commit hash and a sensitive word on one line) with a positive control, and no named bypass path or secrets-file name. Mutant (plaintext + hash line appended): killed. Sweep and round-2 decisions: see Fable round 2 fixes. |
| L1 `--timeout` in dead-holder branch | `255b406` | L-p (dead pid plus a fresh `.takeover` directory, `--timeout 1`: exit 75 in under 5 s). The unfixed script did not finish within 60 s of the run. |
| L2 takeover race unstated | `6e4a23d` | Stated as limit 4 in the `stack-lock.mjs` header and in `rules/shared-stack.md` (hardening not done; folded into the M3 commit). |
| L3 empty registry | `3e0a19c` | R-e (the documented deletion gives exit 0, "nothing registered"; the table heading still required), C-h (canary gate: exit 0, "nothing registered"). `guard-estate.md` no longer writes the sample guard as a `guard:<id>` reference, since that made its own deletion fail. Mutant (found = rows exist): killed. |
| L4 five-cell phantom row, directory `implementedIn` | `3e0a19c` | R-f (`MALFORMED DOC ROW`; a directory is `does not exist or is not a file`). Mutants (existsSync, ignore malformed): both killed. |
| L5 dangling flag | `b77d45c` | G-i (five argument shapes under `sh` and `/bin/dash`: exit 0, no file, no output; valid call still logs). Mutant without the dangling check hangs the shell loop and fails by the 3 s spawn timeout; mutant without the required-field check: killed. |
| `pre-pr-gates.md` said suites run twice | `7458aeb` | Doc now describes the three stages the script runs; no test. |
| `ci-diagnose.mjs` mode 644 | `7458aeb` | G-j (every shebang script in a deployed project is executable). Red before the chmod. |

Notes, not fixed:

- `session-supervisor.sh` uses `jq` and `#!/bin/bash`, against the "Node or POSIX shell alone" wording. Fable ruling: not a safety defect; the truth is that the supervisor needs bash and jq.
- Limit (2), the 10 s window between create and write, is accepted as stated.
- `canary-gate` and `guard-registry-reconcile` are not in the default `stack.gates`; they run only when the owner wires them.
- `ci-diagnose` failing-line patterns miss `not ok`.
- The pre-PR marker is not bound to HEAD (M-03 design).

Gate state: `preset-base-scripts.test.js` and `preset-igaming.test.js` together 71 pass, 0 fail; `preset-base.test.js --test-name-pattern '3\.7|8\.'` 15 pass, 0 fail; `node scripts/agnostic-lint.js check` ok.

## Fable round 2 fixes

- A. Stale pins in `preset-base.test.js` after the M-03 fixes: check-test-command rows 141 to 175 (`90ad823`), check-denied-command rows 255 to 301 and split `[62,5,188]` to `[88,5,208]` (`9ac6452`), counts taken from the corpus; 3.9 `make clean integration` now expects deny (ordered subsequence), with an unrelated `make clean` still allowed.
- B. M4 sweep of preserved memory on the public fork. Command: `git grep -n -i -E 'fail-open|auto-?pass|exploit|zero enforcement|not applied|service role|unauthenticated|injection|bypass|leak|\bcve|\brce\b|privilege'` over `presets/igaming/memory`, `lessons-stack.md`, `.planning/gsd-v2/tools`, `.planning/gsd-v2/experiments/16-ab2` (data files `*.jsonl`, `registry.json` excluded; bare `rce` matched "source"). Generalised: `project_full_audit_2026_07.md` (live-gap list with file names, the fix hash, a defect with file range, the age-check detail; now point to the private tracker) and `SUPABASE_ANON_KEY_REMOVED.md` (client file names). Left as is after reading each hit: fixed 2FA and grants notes (no hash), `RATE_LIMIT_BYPASS` as an env-var name, test-process/Puppeteer leak notes, tool allow-rules, 16-ab2 prose hits (no weakness). 8.14 scan widened with exploit, fail-open, auto-pass, injection, unauthenticated, zero enforcement; positive control added.
- Open notes: the lock wrapper of a zombie holds the lock until its parent reaps it (limit stated in the `stack-lock.mjs` header and `shared-stack.md`); SIGKILL between spawn and the `childPid` rewrite leaves a window; history `0638097..b9cd8e4~1` still contains the earlier blobs (owner decision pending, not rewritten).
