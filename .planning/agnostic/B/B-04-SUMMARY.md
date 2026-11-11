# B-04 Summary: deploy planner, apply, CLI, four-gate refusal (B7)

## Outcome
- `project-deploy.js` (273 lines): `planDeploy` (read-only plan, steps 1-12), `runCli`. Wired into `gsd-tools.js` as `case 'project'`.
- `project-deploy-session.js` (60 lines): `agentAncestor`, `detectSession`, `guardFailures`.
- `project-deploy-apply.js` (78 lines): `writeAtomic`, `ensureGitignore`, `applyPlan`.
- `project-deploy-fs.js` (59 lines, new, not in the plan's artifact list): path and IO helpers split out of `project-deploy.js` to stay under the 300-line cap.
- `project-deploy.test.js` (748 lines): 46 tests, wired into `package.json` `scripts.test`.
- `gsd-tools.js`: 8 insertions, 0 deletions since `f57caf2` (the `require` after `projectProfile`, and `case 'project'` before `case 'prompt-optimize'`).
- `npm test`: rc=0, `# tests 1847`, `# pass 1847`, `# fail 0` (B-03 baseline 1801, plus 46). Log: `.tmp/agnostic-B04.log`.
- `node scripts/agnostic-lint.js check`: exit 0. `scripts/agnostic-lint/` unchanged since `a6a06e4`.
- `get-shit-done/presets` still absent. No `.gsd-tmp-` or stray file in the repo.

## Commits
- `58a50a5` feat(agnostic-B): deploy planner (manifest, three-way, blocks, settings, scan, four-gate refusal)
- `4ec908e` test(agnostic-B): deploy planner tests (9 mutants killed), wired into npm test
- `ba0fd6e` test(agnostic-B7): four-gate refusal tests (10 mutants killed)
- `aab5d96` feat(agnostic-B): project init|diff|sync (apply, CLI, gsd-tools dispatch)
- `dd94fbb` test(agnostic-B): project init|diff|sync tests (14 mutants killed)

## Tests (all present by name in the full-suite output)
- Planner, `describe('planDeploy (agnostic-B)')`: P1; P2; P3; P4; P5; P7; P8; P9; P10; P11.
- Refusal, `describe('guardrail refusal (agnostic-B7)')`: P6a-P6e, P6f, P6g-P6j, P6m (table rows); P6k (omitted env); P6l (omitted session); P12 (two tests: `agentAncestor` and `detectSession`/`guardFailures`).
- Apply and CLI, `describe('project init|diff|sync (agnostic-B)')`: A1; A1b (`.gitignore` variant, split from A1); A2; A3; A4; A5; A6; A7; A8 (seven causes, one test each); A9; A10; A11; A12; A13; A14.
- REUSE: `project-profile.test.js` CLI tests not re-added.

## Mutation proof (copy-and-restore harness, one anchor per mutant, each module `git diff` empty afterwards)
Anchor counts were checked before each run. Each row names the tests that failed; "+" marks tests beyond the plan's named set.

| Mutant | Module | Failing tests |
|---|---|---|
| T2-M1 step 5 removed | planner | P5, A8 |
| T2-M2 scan preset source, not render | planner | P5 |
| T2-M3 step 6 removed | planner | P7, A8 |
| T2-M4 step 6 rendered dests only | planner | P7, A8 |
| T2-M5 MANIFEST containment removed | planner | P7 |
| T2-M6 `diff` rejects no manifest | planner | P3, A11 (+) |
| T2-M7 preset-name comparison removed | planner | P3 |
| T2-M8 conflict gets new manifest entry | planner | P11, A5 (+) |
| T2-M9 preset name regex removed | planner | P2, A13 (+) |
| T3-M1 refusal exception keyed on manifest | planner | P6b |
| T3-M2 refusal ignores guarded_changes | planner | P6d |
| T3-M3 step 12 never refuses | planner | P6b, P6c, P6g-P6m (+), A8, A9 (+) |
| T3-M7 omitted env defaults to `{}` | planner | P6k |
| T3-M8 omitted session all-pass | planner | P6l, A9 (+) |
| T3-M9 step 10 raw dest | planner | P6m |
| T3-M4 env gate `Boolean(env.CLAUDECODE)` | session | P6g |
| T3-M5 stdin and stdout gates dropped | session | P6h, P6i, P12 (+), A8, A9 (+) |
| T3-M6 ancestor gate dropped | session | P6j, P12 (+) |
| T3-M10 `agentAncestor` unparsable returns false | session | P12 |
| T5-M1 `runCli` applies a failed plan | CLI | A8, A9, A13 (+) |
| T5-M2 refused plan is applied | planner | P6b, P6c, P6g-P6m (+), A8, A9 |
| T5-M3 `runCli` ignores its `env` argument | CLI | A6 (+), A9 (+), A12 |
| T5-M4 exit 0 when conflicts | CLI | A5 |
| T5-M5 base copies not written | apply | A1, A3, A4, A5, A8 (+) |
| T5-M6 `writeAtomic` no identical-bytes skip | apply | A2, A4 |
| T5-M7 `ensureGitignore` appends all four lines | apply | A1b |
| T5-M8 step 8 passes `null` as prev | planner | A6 |
| T5-M9 `writeAtomic` ignores mode | apply | A1 |
| T5-M10 conflict receives the current render | planner | P11, A5 |
| T5-M11 `report.settings.removed` dropped | planner | A6 |
| T5-M12 `writeAtomic` catch keeps temp file | apply | A14 |
| T5-M13 `applyPlan` continues past a failed write | apply | A14 |
| T5-M14 no `!.env.example` re-append after `.env*` | apply | A1b |

Totals: 33 mutants, 33 killed, 0 survived. All modules restored after each run.

## Threat-model proof
| # | Proof |
|---|---|
| T1 agent session changes hooks or permissions | P6a-P6m, P6k, P6l, P12; A8 (rows 3-4); A9 |
| T2 write outside root, never-managed file, wholesale settings replacement, symlinked base dir | P7a-P7c; A8 (rows 6-7); A10. Case-variant `.claude/Settings.json` is rejected by B-02 `validateDest` (not re-tested here) |
| T3 fragment keys such as `disableAllHooks` | B-02 test 7 (unchanged) |
| T4 project rule or hook removed by a preset; manifest edited to remove one | A6 (removal reported by value in `diff` before it happens) |
| T5 secret reaches a committed file | P5a, P5b; A8 (row 1) |
| T6 half-applied deployment | A8 (all rows), A2, A14 |
| T7 conflict markers in a hook | A5 (conflict writes no content for the file) |
| T8 `--preset ../x`, symlinked preset file | P2 (`../x`, `nope`); B-02 test 5 for the symlinked preset file (not re-tested here) |
| T9 manifest reused for another preset | P3 |
| Residual (stated limit) | Detached process with env key removed and a pty on stdin and stdout passes all four gates. Not closed, by decision. |

## Deviations
1. **New helper module.** `project-deploy-fs.js` holds `exists`, `contained`, `isDirectory`, `readRegular`, `readJsonObject`, `isPlainObject`. `project-deploy.js` was 324 lines after `runCli` and would breach the 300-line cap. Not in the plan's artifact list.
2. **`project-deploy.js` target.** The plan targets 240 lines for Task 1; the file is 273 (under the 300 cap).
3. **Secret echo in the report (open finding, not fixed).** `report.settings.added` lists values by value (as the plan requires), so a secret-shaped string in `stack.paths.backend` appears in the plan report and CLI stdout even though the plan is refused (P5b). Only the committed-file path is protected. P5b therefore asserts "no token" in `secret_hits` and `errors` only. Ruling needed: redact settings values when `secret_hits` is non-empty.
4. **P6l relies on piped stdio.** With omitted `session` the real process is inspected. The test asserts `failed.length > 0`, which holds because `node --test` gives the test child piped stdout (not a TTY).
5. **Mutant superset.** Several mutants fail more tests than the plan named (marked "+" above). Each named test still fails.
6. **Mutant harness correction.** The first T2-M2 mutant was a no-op (it stripped placeholders from already-rendered text), so it survived. It was corrected to scan the preset source file named in `preset.json` and then killed. The earlier survivor is not counted.
7. **Blocked command.** One inline `node -e` debug command was blocked by the protected-config PreToolUse hook because it named `.claude/` paths. It was not reshaped. The line was read with the Read tool and the test fixed from there.
8. **Two commits amended.** `58a50a5` and `aab5d96` were amended before any push to fix malformed trailer blocks (own unpushed commits).
9. **Attribution trailer.** `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` (the harness-specified line) used instead of the brief's `Claude Haiku`.
10. **Extra test.** A1b (`.gitignore` variant) is a separate named test rather than a variant inside A1.

## Self-Check: PASSED
