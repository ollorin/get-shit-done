# C-01 Summary: igaming snapshot preset at 95a02959e (C1, flat, no packs)

## Outcome
- `get-shit-done/presets/igaming/` created: 54 tracked files. 49 deployable files from `git archive 95a02959e5fa464f3bcce11378c803f7b86ec76d` (CLAUDE.md, rules 12, hooks 19, skills 15, canaries 2), `settings.snapshot.json` verbatim, `settings.fragment.json` (permissions + hooks), `preset.json`, `golden.sha256` (50 lines), `README.md`.
- One secret-shaped hit redacted (see Redactions). Scan after redaction: `scanDir` 0 hits over 54 files.
- Golden tests G1-G6 in `get-shit-done/bin/preset-igaming.test.js` (6 tests, 155 lines), wired into `package.json` `scripts.test`.
- Lint scope test `presets/ is out of scope (agnostic-C1)` (L1, L2) appended to `scripts/agnostic-lint.test.js`. `scripts/agnostic-lint.js` and `scripts/agnostic-lint/` unchanged (no commits since `fc1e621`).
- Full suite `npm test`: rc=0, `# tests 1921`, `# pass 1921`, `# fail 0`.
- `node scripts/agnostic-lint.js check`: exit 0.
- Phase H must carry the four undeployed settings keys: env, enableAllProjectMcpServers, enabledPlugins, sandbox.

## Commits
- `22f75a0` feat(agnostic-C1): igaming snapshot preset at 95a02959e (49 files, settings fragment, golden)
- `72880b0` test(agnostic-C1): igaming snapshot golden tests (9 mutants killed), wired into npm test
- `0e31774` test(agnostic-C1): presets/ stays outside the agnostic lint scope (2 mutants killed)

## Tests
`get-shit-done/bin/preset-igaming.test.js` (`describe 'igaming preset snapshot (agnostic-C1)'`), 6 green:
- `G1` loads as flat preset: `kind whole`, `render false`, `capability null`; README names the full SHA and `## Redactions`
- `G2` file list equals snapshot tree minus META; dests equal golden keys minus settings; `src === srcOf(dest)`; counts 12/19/15/2/1; golden has 50 unique lines
- `G3` `renderPreset` ok with no errors; 49 rendered files, each sha256 equals its golden line
- `G4` executable bits are exactly the 10 top-level `.claude/hooks/*.sh` plus `run-canaries.sh` (11)
- `G5` snapshot sha equals golden `.claude/settings.json`; fragment keys `hooks`, `permissions`; allow/deny/ask sizes 289/19/3, no duplicates, sets equal to snapshot; fragment hooks deep-equal snapshot hooks (order); undeployed keys pinned with the Phase H message; `mergeSettings(null, null, …)` keeps sets and hook order
- `G6` copy with the root replaced by `{{project.root}}` (10 occurrences): renders back to the committed fragment; `/elsewhere` differs; `{}` gives `missing config key: project.root`

`scripts/agnostic-lint.test.js` (`describe 'presets/ is out of scope (agnostic-C1)'`), 2 green:
- `L1` no `SCOPES` match for six preset paths; `listScopeFiles` has no `get-shit-done/presets/` path; `git ls-files get-shit-done/presets` gives at least 50 (54)
- `L2` `scan` counts `get-shit-done/templates/t.md` `{deno:1}`; no `get-shit-done/presets/` key in `denied` or `allowed`, though the preset file contains hits

REUSE (0 added): `project-deploy-scan.test.js` `5 repo presets contain no token-shaped string` (now non-vacuous, passes) and `5b`; `install.test.js` `presets/ is copied byte-for-byte (agnostic-B1)`.

## Mutation proof (backup `cp -p` to `/tmp/c01-bak/`, mutate, run the single file, restore; `git status` on the preset clean after each restore)
| Mutant | Target | Failing tests |
|---|---|---|
| M1 append one byte to `hooks/lib/ShellParse.pm` | preset | G3 |
| M2 `chmod -x hooks/check-test-command.sh` | preset | G4 |
| M3 drop `permissions.deny[0]` from fragment | preset | G5 |
| M4 swap `PreToolUse[0].hooks[0..1]` (length 6) | preset | G5 |
| M5 remove `files[7]` from `preset.json` | preset | G2 (also G3, G4) |
| M6 add `rules/extra.md` | preset | G2 |
| M7 flip first hex digit of the `CLAUDE.md` golden line | preset | G3 |
| M8 append one space to `settings.snapshot.json` | preset | G5 |
| M9 duplicate `permissions.allow[0]` in fragment | preset | G5 |
| L-M1 add `presets` scope to `SCOPES` | lint module | L1, L2 (also repo-baseline test 10 and repo-tree test 18) |
| L-M2 widen `templates` to `get-shit-done/` | lint module | L1, L2 (also existing tests 3, 3b) |

## Threat-model proof
| # | Threat | Proof |
|---|---|---|
| T1 | untracked or ignored igaming file enters | source is `git archive` only; 54 tracked files, 50 golden lines; G2 no-stray. No `settings.local.json`, `.mcp.json` or `.env*` present |
| T2 | token-shaped string enters | `scanDir`: 1 hit before redaction, 0 after (54 files); existing test 5 and 5b |
| T3 | snapshot drift or later byte change | G3, M1, M7; golden from archive, one line changed only for the redaction |
| T4 | hook loses exec bit | G4, M2 |
| T5 | fragment drops or reorders a rule | G5, M3, M4, M8, M9 |
| T6 | executor writes into igaming | `git archive`, `ls-tree`, `show`, `status` only; igaming status count 155 after the snapshot and again at the end |
| Residual | `project init --preset igaming` elsewhere deploys mutating allow rules | not closed here; README `## Do not use for a new project`; reviewed base subset is Phase F4 |

## Redactions
- `rules/edge-functions.md:126` (`.claude/rules/edge-functions.md` at the pin), pattern `assigned_secret`: matched value replaced by `<redacted:assigned_secret>`. The golden line for that file is the redacted form, so `shasum -c` against a fresh archive fails for exactly that file (expected; README `## Re-verify`).
- The value was not printed or committed. Whether it is a live credential is unverified. The matched key is `REALTIME_JWT_SECRET` (keyword `SECRET`), in the igaming repo at the pin (source line, not this fork). Recommend a check against the igaming owner; project memory says there are no production users yet.

## Deviations
- Commit `22f75a0` was first written with the `Claude Haiku` trailer from the brief. Amended to `Claude Haiku 5.5` per the session attribution reminder before any push. Only that commit is affected.
- M5 and M6 first attempt did not run: the unquoted `$T` in the zsh shell did not word-split, so no test ran (the restores still executed). Both mutants re-run with the command written out; results above are from the re-run.
- The M2 lint mutant command carried one no-op `replace` that matched nothing. The only change made to `scripts/agnostic-lint.js` was the `templates` widening; restore verified by empty `git diff` on the lint paths.
- Decision 6 (`planDeploy init` ok with 50 changes) was a planner measurement and is not re-run here. No test in this plan uses `project init`/`diff`.
- The plan's `git ls-files -s … | grep -c '^100755'` gives 11 after staging (verified). The `preset.json` entries are generated by the plan's one-liner, unmodified.

## Defect Classes
| class | instance | caught_by | severity | rule_gap |
|---|---|---|---|---|
| secret-shaped assignment committed in a rules document | .claude/rules/edge-functions.md:126 (igaming @95a02959e) | other (scanDir secret scan) | major | unverified: igaming rules not traced for a rule on secrets in rules docs |

## Self-Check: PASSED
- Files present: `get-shit-done/presets/igaming/{preset.json,golden.sha256,README.md,settings.fragment.json,settings.snapshot.json}`, `get-shit-done/bin/preset-igaming.test.js`, `scripts/agnostic-lint.test.js`, `package.json`.
- Commits present: `22f75a0`, `72880b0`, `0e31774`.
- Tree clean for `get-shit-done/presets`, `package.json`, `get-shit-done/bin`, `scripts` after the last restore.
