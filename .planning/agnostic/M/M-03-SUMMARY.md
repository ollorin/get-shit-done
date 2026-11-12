# M-03 summary: base preset guardrails, chunks 1-2 (3.1-3.5, 3.12)

Branch `exp/agnostic`. Base `cb600d0` (M-02 review round 7). Executor: Haiku 5.5, run by the handoff brief.
Done: 3.1, 3.2, 3.12 (chunk 1); 3.3, 3.4, 3.5 (chunk 2, sections below). Not done: 3.6-3.11, 3.7, 3.8 (the Fable review). Later chunks append below.

| Task | Commit | Status | Tests added or changed |
|---|---|---|---|
| 3.1 | 8cef8b0 | done | 6 (3 base preset, 3 profile keys) |
| 3.2 | 97f99fb | done | 4 base |
| 3.12 | 95dd267 | done, mutants killed | 4 base + 1 registry (pure); 3.2 set-equality and init tests updated to 24 deny rows |
| 3.3 | 96c0e7e | done, mutants killed | 5 base; 3.1 file list extended |
| 3.4 | 280af61 | done, mutants killed | 7 base; 3.1 file list extended |
| 3.5 | 03f0b5f | done, mutants killed | 2 base; 3.1 list extended, 3.3 registration and 3.4 counts updated |

Full gate after each commit: `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: 2234 (base, HEAD cb600d0, measured in a clean worktree) → 2240 → 2244 → 2249, 0 fail. `node scripts/agnostic-lint.js check`: ok (740 denied, 363 allowed) after 3.1 and 3.2; ok (740 denied, 364 allowed) after 3.12.

## 3.1 CLAUDE.md, preset.json, profile keys (8cef8b0)

- `presets/base/CLAUDE.md` (211 lines, `wc -l`; rendered 211 lines, no placeholder left). Managed block `core` holds the methodology; the project notes sit below it. Written from igaming `CLAUDE.md` with names replaced: `{{project.owner_title}}`, `{{stack.branch.default}}`, `{{stack.commands.search}}`, `{{stack.commands.pre_pr_gate}}`. Sections kept in source order; the `zg`, `deno`, `supabase`, `rtk`, Fable-allowance and Local Development/References/Domain Rules parts are not carried (plan class PROJECT or user-global tooling).
- Clean code section ("Clean code and functional style") is language-agnostic, with the last line the plan specifies. Test asserts it names no language.
- `presets/base/preset.json`: name `base`, version `1`, one `block` entry for CLAUDE.md (`render: true`, `guarded: false`).
- Profile keys: `bin/project-profile-keys.js` (new sibling module, 101 lines) holds the shape checks for `branch`, `locked_commands`, `flake_patterns`, `deploy`, `style`, `cve`, `host`. `project-profile.js` registers them. `backend` and `web_ui` accept an object or `false`; `ui_qa.lock_file` accepted.
- Deviations: `flake_patterns` also rejects a pattern whose `match`, `requires_before` or `unless_nearby` is not a valid regular expression, and a `window` that is not a positive integer (not in the plan list; cheap, fails before the hook would). `KNOWN_CAPABILITY_KEYS` already held `backend` and `web_ui` from M-02, so nothing changed there.
- Root `.gitignore:4` ignores every `CLAUDE.md`. `presets/base/CLAUDE.md` is force-added, as `presets/igaming/CLAUDE.md` already is. `.gitignore` not changed (out of scope).

## 3.2 settings fragment (97f99fb)

- `presets/base/settings.fragment.json`: 47 allow rows, 16 generic deny rows, 3 secret-read deny rows (`Read(./.env)`, `Read(./.env.*)`, `Read(**/secrets/**)`), 3 ask rows. No `hooks` key yet.
- Allow rows are the snapshot's read-only rows only: `Read(**)`, `git status|diff|log|show|rev-parse|check-ignore`, read-only coreutils, shell keywords. Dropped from the snapshot: `find:*` (`-delete`, `-exec`), `sed:*` (`-i`), `sort:*` (`-o`), `uniq:*`, `awk:*`, `tee:*`, `env:*` (runs a command), `git branch:*` (`-D`), `xargs`, `curl`, `psql`, `python3`, `node`, `bash:*`, `git push`, absolute paths, `*NAME=*` rows.
- Known gaps for the Fable review (3.8): prefix allows (`echo:*`, `cat:*`, `jq:*`, `git diff:*`) still accept a shell redirection (`> file`) or git's `--output` option; `Grep`, `Glob`, `LSP` are not allowed (plan says "nothing else"), which may stall unattended runs (3.8 question 5).
- Tests: init writes exactly the fragment sets (3.12 later updated the deny expectation); no allow rule matches the forbidden pattern; fixed deny and ask rows present; `scanText` finds nothing.

## 3.12 never-touch deploy commands (95dd267)

- `applyToConfig` (`bin/project-registry.js`) derives `stack.deploy.slot_1..5` from `never_touch` on every init. Unused slots are `gsd-unused-deploy-slot-N`. The list is the source; a changed list rewrites all five.
- Validation (`bin/project-profile-keys.js`): `never_touch` at most 5 entries, each matching `^[A-Za-z0-9 ._/-]+$`; `slot_N` use the same rule (decision 3: all nine rendered values are restricted, not only the list). The check runs in `registerForInit` before any write, so a bad list exits 1 naming `stack.deploy.never_touch`.
- Fragment: five rows `Bash({{stack.deploy.slot_N}}:*)`; the deny set is 24 rows.
- Lint: the inert literal is a fixed string the plan requires, and it matches the `game` class (`\bslots?\b`). Named allow-list entry added (`get-shit-done/bin/project-registry.js`, `game`, max 1), baseline written with `--allow-raise`. `check` printed `RISE allowed` for that entry only, no `RISE denied`.

Mutants (each applied to the real file, run, restored, `cmp`-verified byte-identical):

- m1 slots filled only when absent (existing `slot_N` wins over the list): killed by 3 tests (stale-slot CLI, applyToConfig pure, 3.12 stale-slot CLI).
- m2 five-entry limit dropped from `never_touch`: killed by the six-entries CLI case (exit 0 instead of 1).
- m3 rendered-text check removed from `never_touch`: killed by the `x"; y` CLI case (exit 0 instead of 1).

Self-check: commits 8cef8b0, 97f99fb, 95dd267 exist on `exp/agnostic`. No push. No `install:gsd`. Nothing outside the worktree written except `.tmp/` scratch (removed). `~/.gsd`, `~/.claude`, `~/igaming-platform` not touched.

Chunk 2 gates: `NODE_PATH=$HOME/get-shit-done/node_modules npm test` 2249 (chunk 1 end) → 2254 (3.3) → 2261 (3.4) → 2263 (3.5), 0 fail. `node scripts/agnostic-lint.js check`: ok (740 denied, 364 allowed) after each commit; no lint-scoped file touched. `timeout` is not installed on this macOS, so no test run uses it.

## 3.3 redirect-recursive-search hook (96c0e7e)

- Copied from `presets/igaming/hooks/`: wrapper, `lib/run-perl.sh`, `lib/fail-closed.sh`, `lib/ShellParse.pm` (byte-equal, test-checked), `lib/redirect-recursive-search.pl`. All five `guarded: true`; only the `.pl` has `render: true`.
- Changes: the zg tooling in the deny message is `{{stack.commands.search}}` (default `git grep -n`). Comments that cited igaming experiment ids and RESULT.md were shortened to the rule. `rtk grep` deny is kept: rtk is the user's global tool, a generic shape.
- Fragment: one `PreToolUse` entry, matcher `Bash`, `"$CLAUDE_PROJECT_DIR"/.claude/hooks/redirect-recursive-search.sh`.
- Tests (5): `grep -r` and `grep --recursive` denied with the configured search command named; `rg -n` profile changes the message; malformed stdin exits 2 with BLOCKED; ShellParse byte-equal; registration.
- Mutants on the `.pl` (each restored, `cmp`-verified):
  - M1 long-option recursion disabled: first pass survived (only `-r` was tested); the `--recursive` case was added to the test, then killed by 1 test.
  - M2 short `-r` branch removed: killed by 2 tests.
  - M3 message placeholder replaced by the literal `git grep -n`: killed by 1 test.

## 3.4 canary runner and redirect rows (280af61)

- `canaries/run-canaries.sh` deploys to `scripts/validation/hook-canaries/` (`render: true`, `guarded: true`). Removed: fork/user/user-rtk branches, the SLOW branch, the drift and locked fixtures, `$HOME`, the node runner branch. `date -v` replaced by `perl -e 'utime …'` (`age_file`). Needs jq and perl only; `@repo-main` renamed `@repo-default` (fixture on `{{stack.branch.default}}`).
- Corpus: the 84 redirect rows; 13 carry a project term and were rewritten with the same expect and parser path (none dropped):

| Source (igaming) | Base |
|---|---|
| `apps/api/foo.ts`, `apps/api/x.ts`, `apps/api/x.ts apps/api/y.ts`, `apps/api/x`, `apps/api/functions/x/index.ts`, `rg foo apps/api/`, `rg -n foo apps/api/x.ts` (+ `apps/api` in the zg and rg labels) | `src/…`, `src/` |
| `apps/player-web/src`, `~/igaming-platform/.tmp/wt-401-09/apps/player-web/src` | `ui/a`, `.tmp/wt-1/ui/a` |
| `~/igaming-platform/apps/operator-web/src` | `ui/b` |
| `~/igaming-platform/.planning/phases/401-…/401-01-PLAN.md` | `.planning/phase-1/plan-1.md` |
| `/private/tmp/claude-502/…/byig9ah2x.output`, `~/.claude/projects/…/bl5xdonnp.txt` | `.tmp/task-1.output`, `.tmp/tool-results/out-1.txt` |
| `terms_snapshot`, `execution_rules`, `withdrawals.queue`, `useWithdrawalQueue`, `country` (in `\.country\|country:`) | `sample_token`, `sample_rules`, `queue.items`, `useQueueItems`, `region` |
| raw fail-closed `deno task test:regression git push` | `npm run test:regression git push` |

  Labels were truncated in the source; the truncated tails were rewritten too (a stray `apps` fragment remains in one label, harmless).
- Tests (7): tool presence for jq and perl (fail by name); defaults exit 0 with `pass=154` (after 3.5); `rg -n` profile exit 0; a flipped row fails and is named; corpus has the 84 rows and no project term; runner source has no `date -v`, `$HOME`, or Deno/charlotte/drift/igaming/supabase.
- Mutant M1 (`[ "$fail" = 0 ]` replaced by `true`): killed by 1 test.
- The marker ages (31 min, 29 min, 3 days) are exercised by the 3.5 rows, which pass on macOS. Linux `utime` is not run here; the CI check is the first Linux run.

## 3.5 merge-target and push-gate hooks (03f0b5f)

- `check-git-merge-target` and `block-push-without-local-tests` copied from the snapshot. The `.pl` files are `render: true`. Owner title, default branch and gate path are rendered. Branch names are compared with `eq`, never as a regex.
- Marker: `.pre-pr-passed` inside `git rev-parse --absolute-git-dir` of the push's repo (per worktree). A root marker no longer counts. The gate script must write `"$(git rev-parse --absolute-git-dir)/.pre-pr-passed"`; task 8.1 has to say so.
- Gate scope: `-f "$root/{{stack.commands.pre_pr_gate}}"`; with no gate file the push is allowed (`.pl` fail-open kept, row `@repo-nogate`). The deny message drops igaming's `--all` and `--skip-twice` flags.

Rewrites across the source rows (counts over the 67 source rows; 52 changed, 0 dropped):

| Source text | Base text | Source rows |
|---|---|---|
| `.preflight-passed`, `.preflight-{…}`, `.preflight-pass?d` | `.pre-pr-…` (same shape) | 19 |
| `CEO approval required` (reason) | `{{project.owner_title}} approval required` | 16 |
| `git push requires local CI preflight` (reason) | `git push requires the local pre-PR gate` | 15 |
| `written only by scripts/preflight.sh` (reason) | `written only by {{stack.commands.pre_pr_gate}}` | 16 |
| `git push origin HEAD:main`, `+main`, `git checkout main && …`, `git switch main; …` | `{{stack.branch.default}}` in place of `main` | 4 |
| `"cwd": "@repo-main"` | `@repo-default` | 4 |
| `"cwd": "@repo-nopreflight"` | `@repo-nogate` | 1 |
| `deno eval "Deno.writeTextFileSync('.preflight-passed','')"` | `bun eval "Bun.write('.pre-pr-passed','')"` (the hook's interpreter list still names `deno`) | 1 |
| raw `{not json deno task test:regression git push` | `{not json npm run test:regression git push` | 2 (A8 rows of the two hooks) |
| labels with `preflight` | `pre-PR gate` | many |

- Three new rows: `@repo-rootmarker` git push denied (marker at the repo root only); `touch .git/.pre-pr-passed` denied; `@repo-nogate` push allowed.
- Tests (2 added): the release/1.x, Founder, `tools/gate.sh` profile gives 154 rows green, the merge hook asks naming Founder for `release/1.x`, and not for `release/1ax` or `feature/x`; the push gate names the rendered gate file and blocks with no marker. The 3.4 count assertions moved to 154.
- Mutants (each restored, `cmp`-verified):
  - M1 protected-branch compare made a bare regex `m{^{{stack.branch.default}}$}`: killed by 1 test (the dot in `release/1.x` matches `release/1ax`).
  - M2 marker location moved to the repo root: killed by 3 tests.
  - M3 `touch` removed from the write-block list: killed by 3 tests.

Deviations from the plan:
1. `master` is not added to the merge-into check. The source compares only the default branch there (`check-git-merge-target.pl:55`); `master` is kept in the on_main, forced-checkout and push-destination checks where the source has it. So `git merge` into a `master` checkout is not asked. This is the source's behaviour, left unchanged; the 3.8 review should rule on it.
2. `deno` stays in the write-block interpreter list (`block-push-without-local-tests.pl`, `always`): a generic interpreter name. 3.7 needs an exception entry for it (file, class `deno`, reason "generic interpreter list").
3. Plan 3.5 says the rows name the rendered values; the crash row N7 (`tool_input` as a string) still carries `git push origin main` as data. `main` is not a project term, so the row was kept as written.

## Chunk 3 (Sonnet 5.5): 3.9 check-test-command, profile-driven

Gate after 3.9: `NODE_PATH=$HOME/get-shit-done/node_modules npm test` 2263 → 2272, 0 fail (9 tests added, 1 changed count). `agnostic-lint check`: ok (740 denied, 364 allowed), no lint-scoped file touched.

- Hook: `hooks/check-test-command.sh` (wrapper, `run-perl.sh`) and `hooks/lib/check-test-command.pl`, both `guarded: true`, `render: false`; registered third on `PreToolUse` `Bash` after the push gate. `ShellParse.pm` untouched (byte-equal test still green).
- Rule: `stack.locked_commands` literals (token sequences, adjacent and in order; a path word matches a slash-less literal by basename) denied unless the segment is wrapped (`ShellParse` `locked`/`wrapper`: `stack-lock.sh|ts`, `session-supervisor.sh`). The reason prints `scripts/stack-lock.sh --label <x> -- <cmd>`. Config: `<git toplevel of the tool call cwd>/.planning/config.json`, never `CLAUDE_PROJECT_DIR`. Not a git repo, no file, no `stack`, no or empty list: allow. File present but unreadable, not JSON, `stack` not an object, list not an array of non-empty strings (a JSON number is refused, `B` flags): exit 2 "fail closed". The command is parsed before the config, so a non-object `tool_input` still crashes into the `run-perl.sh` deny.
- Data rule (not in the plan text, needed for `echo "test:e2e"`): a segment whose command word is a reader/printer/editor of its arguments (`echo cat grep rg git sed awk ...`, list `%DATA` in the `.pl`) is data. A shell running a script (`bash x.sh`, which `ShellParse` leaves with no `rest`) is judged on its words.
- Runner: one helper `mkcfg`, tokens `@repo-locked-cmds` (`locked_commands: ["test:e2e","run-all-suites.sh"]`) and `@repo-badcfg` (not JSON), hook added to `BASH_HOOKS`.
- Rows: check-test-command 123 (igaming) → 81: 60 carried and rewritten with neutral commands, 21 new. Corpus 154 → 317 (+81 +82). Dropped 63 rows, by class:
  - nx / npm-script target classification (`nx_class`, `nx_words`): 26
  - run.ts runner entry-file logic (bulk/scenario/relative-from-runner-dir, `deno check` is not a run): 12
  - fixed suite-name list (`test:player` ... `test:tags`): 8
  - lock exempts only a single scenario, bulk or two scenarios stay denied under the lock (and its `bash -c` / `env` / `--scenario <one>` variants): 6
  - directory-sensitive classification (`cd`/cwd into the suite dir, bare task): 4
  - `deno task --cwd/-c` flag parsing: 4
  - task-name suffix family (`test:integration:ci`; literals are one token): 1
  - direct integration-file run reminder (branch not carried): 2
- New rows (21): `node scripts/stack-lock.mjs` denied; second literal wrapped; lock script via `bash`; `bash -c` and `env -i` nested under the lock; data forms (assignment, echo, grep, cat); longer task name allowed; `bash` of an unlisted script; `pnpm run`, `yarn`, `bun run`; `bash run-all-suites.sh`; `.bin/` path by basename; `bash -c` with a launcher; CI prefix + redirect; no config (not a repo, repo without file); bad config fails closed for a harmless command.
- Shared rows: 82 `@bash-all` carried, all `allow`, all still allowed by the four Bash hooks (runner `pass=317 fail=0`); 35 matched the plan's project-term regex and were rewritten; the other 47 got a project-name scrub too (project names in the `nx` rows). No row dropped or flipped. They run in a cwd with no locked list, so they test the other three hooks and that this hook is inert there; the non-vacuity of this hook's own rows is proved by test "rows are not vacuous".
- Finding, not a row drop: `bash scripts/stack-lock.sh --label x -- bash -c "<listed>"` is denied (`ShellParse::_unwrap` takes the inner `-c` for the outer shell, so the inner command is flattened unlocked). Fail-safe direction, `ShellParse.pm` frozen; the same without the leading `bash` is allowed and is the row kept.
- Tests (9, in `preset-base.test.js`): deny/allow/node-wrapper; data forms; multi-token literal; no-list/empty/not-a-repo allow and four bad shapes plus invalid JSON fail closed; malformed and non-object stdin; config from cwd toplevel not `CLAUDE_PROJECT_DIR` (two repos, subdirectory); mutated-hook runner test (a copy of the deployed hooks reading `CLAUDE_PROJECT_DIR` fails the runner, so rows are not vacuous); runner green with a project list of its own and a flipped hook row and a flipped `@bash-all` row each fail it; 81 + 82 rows, no project term, registration, `guarded`.
- Mutants on `check-test-command.pl` (each applied, run with `--test-name-pattern 3.9`, restored byte-identical, `restored=true`):
  - M1 deny exit 2 → 0: killed by 4
  - M2 wrapped-form exemption removed: killed by 3
  - M3 data-not-command exemption removed: killed by 2
  - M4 invalid JSON config → allow: killed by 2
  - M5 config read from `CLAUDE_PROJECT_DIR`: killed by 6 (incl. the non-vacuity test)
  - M6 adjacency dropped: killed by 1
  - M7 numeric literal accepted: killed by 1
  - M8 shell-script words dropped (`bash run-all-suites.sh`): killed by 1 (runner rows)
  - M9 wrong-shape `locked_commands` → allow: killed by 1
  - M10 basename match removed: killed by 2
- Block, verbatim: a one-shot `node -e` that wrote `preset.json` was refused by the protect hook ("writes a protected path from a script", the script named the deployed hook dest strings), and a cleanup `rm -rf` naming the scratch project's deployed config dir ("removes or renames the .claude directory"). Not reshaped: `preset.json` and the fragment were edited with the Edit tool, scratch projects use new directories.
- Deviation: plan 3.9 lists one fixture token; a second (`@repo-badcfg`) was added for the fail-closed row.

## Chunk 3 (Sonnet 5.5): 3.11 check-flake-patterns, profile-driven

Gate after 3.11: `NODE_PATH=$HOME/get-shit-done/node_modules npm test` 2272 → 2288, 0 fail (16 tests added). `agnostic-lint check`: ok (740 denied, 364 allowed), no lint-scoped file touched.

- Files: `hooks/check-flake-patterns.sh` (wrapper, `guarded: true`, mode 755) and `hooks/lib/flake-gate.mjs` (`guarded: true`), registered on `PreToolUse` matcher `Write|Edit` by `settings.fragment.json`. One pure `scanFlakePatterns(content, patterns)` (also exports `parseSuppressionAt`, `compilePatterns`, `loadFlakeConfig`, `globToRegExp`, `matchesGlobs`) serves `--hook` and `--all`. Patterns are compiled with `new RegExp(source)`, never evaluated; a test greps the source for `eval`, `new Function`, `vm.`.
- Config: `<git toplevel of the tool call cwd>/.planning/config.json`, never `CLAUDE_PROJECT_DIR`. Allow: no toplevel, no file, no `stack`, no `flake_patterns`, empty `patterns` (even beside unusable `test_globs`), tool other than `Write`/`Edit`, file outside `test_globs`. Deny (exit 2, "fail closed"): unreadable or non-JSON config, wrong shape, invalid regex in `match`/`requires_before`/`unless_nearby`, `window` not a positive integer, unparseable stdin, `tool_input` not an object, non-string content, any unexpected error. Config is checked before the glob filter, so a broken config denies every Write/Edit. `--all`: exit 1 on a violation (names file, line, id), 0 clean, 2 for an unusable config or no repository.
- Wrapper: no `/usr/bin:/bin` PATH addition; `command -v node` fails → "BLOCKED: node not found ..." exit 2 (test runs it with an empty PATH and `/bin/bash`).
- Rows: 10 own + 12 shared `@edit-all`; corpus 317 → 339. Own: the 3 igaming rows rewritten (hour window deny, non-test file allow, malformed stdin deny) plus justified ignore allow, ignore without reason deny, `requires_before` absent allow, `unless_nearby` present allow, Edit fragment deny, no config allow, invalid regex deny. Shared: the 12 Edit/Write rows with neutral paths and text of the same shapes; they run in `@repo-flake-cfg`, so the hook parses the real config for each; one carries a test-glob file name so it reaches the scanner.
- Worked example (tests and runner fixture, not base config): the three igaming categories as profile patterns. `hardcoded-round-number` and `hardcoded-id`: `match` on the field, `requires_before` a `.from("…shared…")` with no later `.from(` in the text above (negative lookahead, so the nearest table decides), `unless_nearby` `23505`. `absolute-time-window`: `match` on `end_hour`, `requires_before` `start_hour`, `unless_nearby` `getUTCHours`. A test checks the runner's fixture equals the test's pattern list.
- Deviations from the plan text: (1) the time-window pattern reports the `end_hour` line (the schema has no "evidence after"); (2) `requires_before` is tested against the joined lines above including the line itself (multi-line regexes, no flags supported); (3) suppression accepts the comment leaders `//`, `#`, `--`, `/*`, `;`, `<!--`, the source only `//`; (4) a second runner token `@repo-flake-badre` for the invalid-regex row, and a runner heredoc helper `mkcfg_stdin`; (5) the CLI starts on the mode flag `--hook`/`--all`, not on a comparison of `argv[1]` with the module URL.
- Defect found and fixed while testing (Rule 1): the first draft started the CLI only when `argv[1]` equalled the module URL. Through a symlinked path (macOS tmp dirs under `/var`) the guard was false, nothing ran, exit 0: a silent fail-open. Fixed by the mode flag; regression test "reached through a symlinked path".
- Tests (16, `preset-base.test.js`): incident shapes and exempt shapes; window bounds (default 40 and custom 2, above/below/line itself); suppression forms; deployed hook deny/allow; Write vs Edit field; inert configs; fail-closed branches; cwd toplevel vs `CLAUDE_PROJECT_DIR`; symlink; missing node; `--all`; globs; fixture and no-eval; runner green plus flipped own row and flipped `@edit-all` row; mutated-hook runner test (non-vacuity); 10 + 12 rows, no project term, registration, guarded.
- Mutants (applied, `--test-name-pattern 3.11`, restored byte-identical, 16/16 `restored=true`):
  - F1 hook allows a violation: killed by 5
  - F2 marker without reason counts as justified: killed by 4
  - F3 `requires_before` window unbounded: killed by 1
  - F4 `unless_nearby` ignores the lines below: killed by 3
  - F5 Edit scans `content` instead of `new_string`: killed by 2
  - F6 invalid regex swallowed: killed by 2
  - F7 non-JSON config allows: killed by 2
  - F8 unparseable stdin allows: killed by 2
  - F9 config from `CLAUDE_PROJECT_DIR`: killed by 7 (incl. the non-vacuity test)
  - F10 `test_globs` ignored: killed by 2
  - F11 wrapper allows when node is missing: killed by 1
  - F12 `--all` always exits 0: killed by 1
  - F13 `requires_before` not enforced: killed by 3
  - F14 unreadable config file allows: killed by 1
  - F15 empty pattern list no longer inert: survived the first test set (equivalent outcome); the test now also covers empty patterns beside invalid `test_globs`, then killed by 1
  - F16 slash-less glob matches the full path: killed by 1
- Equivalent mutants not run: dropping the tool-name early exit and the non-string content check change no verdict (the content check is also caught by the top-level handler).

## Chunk 4 (Haiku 5.5): 3.10 hooks-apply and trailer check, 3.6 rule and skill, 3.7 regression guard

Commits: 3.10 `d3bd75b`, 3.6 `e4af278`, 3.7 `45cd9a9`. Gate after each: `NODE_PATH=$HOME/get-shit-done/node_modules npm test` 2288 → 2296 → 2298 → 2306, 0 fail. `node scripts/agnostic-lint.js check`: ok after each (740 denied, 364 → 363 allowed after 3.7).

### 3.10 hooks-apply and trailer check (d3bd75b)

- `presets/base/scripts/hooks-apply.sh` (66 lines) and `scripts/validation/hook-patch-trailer-check.sh` (52 lines), both `guarded: true`, mode 755. Changes: the experiment-id citation dropped from the header; `shasum -a 256` → `sha256_file` (shasum, else sha256sum, else fail naming both). Nothing else in hooks-apply changed; the `.claude/hooks` and canary paths exist in a base project.
- Trailer check: `FLOOR_DEFAULT` and the CEO comment removed. Without `--floor` the floor is the oldest commit touching `.claude/hooks` or `.claude/settings.json` (`rev-list --reverse`); none → `scanned 0 commit(s)`, exit 0. `--floor ""` is an error, not the default (`FLOOR_GIVEN`). Both "bump FLOOR_DEFAULT" messages say `pass --floor <sha>`.
- Tests: 8 (plan: 5): deployed, executable, preset entries; no FLOOR_DEFAULT, 40-hex literal or CEO in source or deployed copy; dry-run on a comment patch exits 0 and leaves the hook unchanged; dry-run on an allow-all patch exits 1 naming the failing row; trailer passes on the deploy commit alone, fails on an unreviewed hook commit, passes with `Hook-Patch:`; unresolvable floor and non-ancestor floor exit 1 naming the floor.
- Mutants (applied to the real file, run with `--test-name-pattern 3.10`, restored, `cmp`-verified): M1 default floor disabled → killed by 3; M2 floor = newest touching commit → killed by 2; M3 trailer key renamed → killed by 1; M4 dry-run applies to the tree → killed by 2.
- The dry-run tests run the full canary corpus (339 rows); they are the slow tests of this describe.

### 3.6 testing rule and finishing skill (e4af278)

- `presets/base/rules/testing.md` (86 lines, `render: true`, `paths:` frontmatter over test globs). Kernel sections: the ambient-env and clean-room rules (four `Rule:` headings), Test Failure Policy, Test Falsifiability (positive control, fixture reaches its branch, mutation proof, mutation tool `scripts/mutate/mutate.mjs` (9.6), committed evidence, doubles mirror the real reply, a run counts only with its count), Test Economy (risk tiers as `PRODUCT-BRIEF.md` domains plus authentication and security), wired-suite rule, Integration Test Isolation (shared-config restore and the cross-process lock helper), Flake Prevention Gate (`stack.flake_patterns`, a neutral example entry), Parallel Test Execution (bucket completeness).
- Commands are profile keys: `{{stack.commands.pre_pr_gate}}`, `{{stack.commands.search}}`, `{{stack.branch.default}}`. Rendered output checked.
- `presets/base/skills/finishing-a-development-branch/SKILL.md` (200 lines, `render: true`): igaming app selection, `--all/--backend/--frontend` flags and the affected-projects list removed; marker is `.pre-pr-passed` in the git dir (3.5). The cross-references to other skills are kept (the names are not deployed; 8.11 and later may add them).
- Tests: 2 new (kernel headings, rendered placeholders, skill marker, entries unguarded, frontmatter); 3.1 file list extended.

### 3.7 regression guard (45cd9a9)

- The guard scans every deployed file (23 files; the 20 `.planning/.gsd-preset-base` copies are checked byte-equal to their dests instead of scanned twice) against `scripts/agnostic-lint/terms.json`. Passes only on exact set equality of (file, class, line) triples with `tests/fixtures/agnostic/base-deployed-exceptions.json`: no unexcepted line, no stale entry, no duplicate.
- Exception file: 7 entries, classes `deno`, `pnpm`, `docker` only (enforced by a whitelist test; no `igaming/game/reg/money/owner/charlotte/abs`). ShellParse `deno` [248,250,263] and `pnpm` [214]; push-hook interpreter list `deno` [19]; `.claude/settings.json` `docker` [60,61,62,81]; engine manifest copy `docker` [151,152,153,172]; canary rows `pnpm` [226,317] and `docker` [292,293].
- Positive control: a preset copy with `The igaming product rule.` appended to CLAUDE.md renders through `renderPreset` and the scan reports `CLAUDE.md|igaming|…`. `init --preset-dir` is refused outside a terminal ("preset-dir requires a human terminal", `project-deploy-guard.js`), so the control renders directly.
- Literal deployed list for all three configurations (identical until 8.12/8.13). Gated-group mechanism tested through `renderPreset` with a `capability` entry: present with `{backend:{}, web_ui:{}}`, absent with `false`.
- PreToolUse: exactly two groups (Bash: four hooks in order; Write|Edit: flake hook); each command resolves to an executable deployed file. Guarded: 16 entries (13 hook files, 3 scripts) true; canaries.jsonl false.
- 8 tests (plan: 5).
- Mutants: M1 exception entry removed → killed by 1; M2 stale exception triple added → killed by 1; M3 `hooks-apply.sh` entry unguarded → killed by 1. Restored, `cmp`-verified.

Deviations from the plan text (3.7 and the corpus sweep):

1. **Inert deploy literal renamed** `gsd-unused-deploy-slot-N` → `gsd-unused-deploy-entry-N` (3.12 requires the literal). The word `slot` matches the `game` class (`\bslots?\b`), and the brief forbids a `game` exception. The rename touches `bin/project-registry.js`, the registry and profile tests, and the settings rows (rendered), and removes the `game` allow-list entry. Lint baseline rewritten after the count fell (740 denied, 363 allowed; no RISE rows). The 3.12 summary above names the old literal and is history.
2. **Corpus missed in chunks 1-3.** The 3.4, 3.5, 3.9 and 3.11 row rewrites scrubbed only the terms of the earlier project-term regex, so `zg`, `npx nx`, `apps/operator-web/src`, `run-integration-tests`, `localhost:3000/3001`, `getRedisClient`, `pnpm` and `docker` survived. 3.7 rewrote 27 lines (same expect, same parser path): `zg query` → `git grep -n` (rows 8, 44); `nx` → `turbo` (16 rows); `apps/operator-web/src` → `ui/b`; `run-integration-tests` → `run-suite` (9); `localhost:300x` → `example.invalid/a|b`; `getRedisClient` → `getCacheClient`. `pnpm` and `docker` rows are excepted (generic tools). 339 rows, none dropped.
3. **Wording fixes outside the rows:** CLAUDE.md "Exact sweeps" → "Exact searches", "money-path" → "risk-domain-path", "TOTP secrets" → "second-factor secrets"; push hook "This saves CI money." → "CI minutes." (3.1, 3.5 texts; no test pins them).
4. **Exceptions added beyond the plan list:** push-hook `deno` (3.5 deviation 2, as planned), the engine manifest copy of the docker rows, and the two canary shapes. All generic tools.
5. **Tests:** 3.10 has 8 (plan 5), 3.6 has 2 plus the 3.1 list, 3.7 has 8 (plan 5). Mutation proofs are the three named for 3.7 and four for 3.10.
6. **Blocks observed:** one `grep -rn` in this session was refused by the search redirect hook ("BLOCKED: recursive grep reads the whole tree", advice `git grep -n <pattern> -- <path>`); reshaped to `git grep`. No protect-hook block; no shell command named a protected hooks path.

Open for the 3.8 Fable review: the `deno` and `pnpm` exceptions (question 7 of 3.8 covers the docker rows); the rename of the inert literal (question 4, rendered values); `git grep -n` as the rendered search default in the rule text.

## 3.8 ruling C5/C6/C8

Commits: C5 `02b974c`, C6 `720e490`, C8 `cf96a5d`. Full suite 2341/2341 (baseline 2306). Canary runner: 419 rows after C5, 443 after C6. Reference implementation reproduced verbatim (section 6, markers dropped); M1 (78 rows) and M2 (24 rows) went in as listed; all 82 `@bash-all` rows still pass with the fifth hook.

C5 mutants (each killed by a named `3.8 mutant killed:` test, which runs the hook's 80 rows through the runner on a mutated copy):
- R1 sudo prefix check removed: killed (sudo, env sudo, xargs sudo rows).
- R1 doas removed: killed (`doas ls`).
- R2 `$recursive` forced on: killed (`rm *` allow row).
- R2 `$ROOT_LIKE` narrowed to `/`: killed (`~`, `*`, `.`, `..`, `$HOME` rows).
- R2 split flag cluster (`-fr`) not recognised: killed.
- R3 push checks first argument only: killed (`origin x --force`).
- R3 `+refspec` removed: killed. R3 `-f` cluster removed: killed (`-uf`).
- R3 `reset --hard` removed: killed. R3 forced clean removed: killed.
- R3 clean dry-run exemption removed: killed (`-n -f -d`, `--dry-run -fd`).
- R4 ask turned into exit 0: killed (4 ask rows). R4 `pull --rebase` removed: killed.
- R6 template exemption removed: killed (`.env.example`, `.env.sample`). R6 redirect targets ignored: killed (`tr a b < .env`).
- R6 `secrets/` directory removed: killed. R6 bare `.env` removed: killed. R6 `.env.<name>` removed: killed. R6 reader `grep` removed: killed.

C6 mutants (4, `3.8 C6 mutant killed:`): never loop below the lock skip: killed (`stack-lock.sh -- tools/release.sh prod`). Subsequence turned into adjacency: killed (`gh workflow run --ref main deploy-prod`). `tok_eq` path-suffix branch removed: killed (`./tools/release.sh prod`, `/abs/proj/...`). `$data` exception removed: killed (`echo gh workflow run deploy-prod`, commit message row). Process tests: wrapped/flag-before/prefix/lock forms denied, data forms allowed, a list changed after init applies without sync, `never_touch: "x"`, `deploy: []`, `['']`, `[7]` fail closed, `never_touch` absent or `[]` behaves as before.

C8 mutant (`3.8 C8 mutant killed`): alarm removed from the wrapper, with a stand-in `node` that sleeps 12 s: the intact wrapper exits 2 at 10 s, the mutant exits 0. Real-regex test: `^(a+)+$` against 40 `a` and `!` exits 2, stderr names `10 s`, elapsed under 15 s; a normal edit stays under 5 s.

Deviations: (1) the M1 row `cat ./apps/api/.env.local` trips the corpus project-term lint (`apps/api`); the corpus and tests use `./app/server/.env.local`, same class. (2) M2 has two blocks, not four; the single locked-commands deny and the known-gap row are inline in the ruling and were added from the text. (3) Manifest line numbers in `base-deployed-exceptions.json` moved by +8 for the docker rows (two new manifest entries); settings.json lines unchanged. (4) The 3.7 mirror count is 22 (two new preset files). No other change to existing tests beyond the literal lists and counts the ruling names.

## 3.8 ruling C1-C4,C7,C9-C12

Commits: C1 `41df1c2`, C2 `b5998d9`, C3 `6be06b3`, C4 `2aa2591`, C7 `6303f32`, C9 `a51f103`, C10 `9ea571f`, C11 `acd083f`, C12 `7ecabde`. Full suite 2356/2356 (2341 + 15 new). Canary runner 449 rows (443 + 4 C2 + 2 C7). Agnostic lint ok. The engine `bin/project-deploy*.js` is unchanged.

- C1 `41df1c2`: diff and sync refuse an unsafe rendered value before the engine runs, naming the key; slot_N re-derived on diff and sync (restored when the engine refuses without writes). Mutants killed: check for init only (named test fails); slots for sync only (diff re-derive test fails); key filter without `stack.deploy` (`stack.deploy = "x"` case fails).
- C2 `b5998d9`: the config edit passes the flake hook; Bash and Write messages name the repair path. Mutant: exemption removed, `3.8 C2` process test fails. Canary rows: 3 flake + 1 Bash.
- C3 `6be06b3`: 14 control rows removed; `Grep`, `Glob`, `LSP`, 21 git, 20 coreutils added; allow 77. Mutant: `Bash(if *)` re-added, the `3.8 C3` assertion fails.
- C4 `2aa2591`: nine any-depth env rows replace `./.env` and `./.env.*`; four docker deny rows, three npm deny rows, four ask rows; deny 38, ask 7. Mutant: `Read(./.env)` restored, `3.8 C4` and the 33-row set test fail (2 failures).
- C7 `6303f32`: merge into `master` asked (lone and compound); canary rows on `@repo-master`. Mutant: `master` clause removed, the `3.8 C7` process test fails.
- C9 `a51f103`: runner, corpus, `hooks-apply.sh` and the trailer check watched; a commit that deletes or rewrites a canary row needs the trailer; `hooks-apply` refuses a dirty tooling tree. Mutants: runner dropped from PATHS (named test fails); removal check at `> 1` (one-row deletion test fails).
- C10 `9ea571f`: `fail-closed.sh` removed with its preset entry; 3.1 list, 3.7 list and guarded count 17. Removal not mutated: re-adding the entry fails the 3.1 literal list and the 3.7 count.
- C11 `acd083f`: two comments corrected (comment only; runner green at 449).
- C12 `7ecabde`: branch names follow git ref rules; rendered text capped at 80. Mutants: plain rendered check for the branch (the `C12` branch test fails); length cap removed (the 81-character test fails).

Deviations: (1) C1 `sync` is refused by the guard outside a terminal, so its re-derivation is tested through `initWithRegistration` with a stub engine, not through a real sync write. (2) C1 restores the config bytes when the engine exits 1 without writing; the ruling does not say so. (3) C1 tests sit in `project-registry.test.js`, not `preset-base.test.js`. (4) C2 `fail_closed` takes an optional second line; the repair line is printed only for the not-valid-JSON case. (5) C7 does not change the reason text: a merge into `master` reads "git merge into main"; the tests assert the approval substring. (6) C9 paths are the deployed project paths; the fork source is under `presets/base/scripts/`. (7) C9 `hooks-apply.sh` refusal is behind the TTY gate and has no test. A probe through `script(1)` was blocked by the protect hook (it writes into a `.claude/hooks` path in a scratch repo); not reshaped, so the refusal is verified by reading only (`bash -n` passes). (8) Exception lines recomputed three times: settings docker lines `90-96,125,128,129`; manifest docker lines `185-191,220,223,224` (deployed file state at C10).

## Review round 1 fixes

Part A (hooks) findings H1, M2-M5, L6-L9 fixed; part B had none. Commits: safe-git rule `193d299`, H1 `b81859f`, HookGuard (M2, L8, M5 env) `489bc99`, M5 `f938f81`, M3/L6/L7-denied `448ac08`, M4/L7 `dd44a13`, L9 `9c5c70f`, and the follow-up fix `9d2a478` (full suite 2366/2366, 571 canary rows, lint ok). `ShellParse.pm` is untouched (3.3 byte-equal test); the new guard module is `hooks/lib/HookGuard.pm` (preset entry guarded, render false), 3.1/3.7 lists, mirror count 22 and exception file updated (one new triple: `HookGuard.pm` pnpm line 46, existing class; manifest docker lines moved by the new file entry).

- H1: the lone-`git merge` grant needs `merge` as first word after `git` (no `-c`, `--config-env`, `--exec-path`, `-C`), no env or wrapper prefix, no redirect, pipe, `&`, `;`, substitution, subshell, backslash. Only `check-git-merge-target.pl` emitted a bare `allow`; the other five hooks emit none. 8 rows; mutant (grant unconditional) kills 6.
- M2: `HookGuard::prepare` denies (merge-target: asks) when a residual wrapper, keyword or assignment sits at `rest[0]` (the 20-prefix limit) or `flatten($c,$cwd,-1)` yields more entries than `flatten($c,$cwd,0)` (the 12-level limit), reason names the limit. 13 rows incl. boundary allows (19 prefixes, 12 nested lock wrappers); mutants (each check removed) kill 6 and 5.
- L8: `run-perl.sh` runs the hook under a 10 s perl alarm (rc 142 denies naming it) after `HookGuard::start` denies a command over 32768 bytes; all six registrations carry `timeout: 15`. Process tests L8a/b/c; mutants (alarm 100 s) kill L8b.
- M5: `HookGuard::toplevel` / `flake-gate.mjs` `toplevelOf`: a nonexistent cwd or any git failure other than "not a git repository / must be run in a work tree" denies; an existing directory outside a work tree allows (documented). `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and kin are dropped first (perl in `start`, node in `cleanEnv`). The flake hook takes the root from the edited file's repository (absolute or resolved path) and allows a file outside any work tree with a stderr note; `--all` scans tracked files only (documented in the header). 6 process tests; mutants (env kept, nonexistent cwd allowed) kill them.
- M3: prefixes derived from the git option tables, no probe run: `reset --h`, `clean --f`/`--d`, `pull --reb`, `push --al`/`--m`; `rm --r..`. No `push --force` abbreviation is unambiguous (`--force-with-lease`, `--force-if-includes` share the prefix), so push keeps the exact match.
- M4/L7 (test-command): `tok_eq` normalises `//`, `/./`, `./`, `dir/..`; option words between listed tokens tolerated; the lock script counts only at `<toplevel>/scripts/` (otherwise nothing in the command is locked). The 3.9 test `make -j4 integration` flips to denied by this decision. `cd tools && ./release.sh prod` stays the ruling's known gap.
- L6: `HookGuard` unwrap list (`ionice setsid arch xcrun flock taskset chrt unbuffer script su parallel`, dash words left by `time -p`, `command --`, `exec -c`, `nice --adjustment=5`) feeds all five hooks; check-denied-command adds the fallback lane (later git/rm/sudo/doas words and quoted command lines behind an unknown command word). Search tools `ug ggrep zgrep pcregrep busybox grep gfind` in redirect-recursive-search (fast path now includes `ug`).
- L7: secrets (`cp`/`mv`/`source`/`.` readers, `.env*` globs; copy destinations exempt), tree-wide rm spellings via `root_like`, push gate (`curl`/`wget`/editors, redirect into a variable once a variable holds the marker, case-insensitive marker, `send-pack`, `subtree push`), merge-target (`git pull` on the default branch, `gh api .../merges`, `git fetch x:<default>`, `git update-ref`). Mutants on each group kill 4-21 rows.
- L9: matcher `Write|Edit|MultiEdit`, every `edits[].new_string` scanned, malformed `edits` fails closed; the `flake-ignore` previous-line behaviour is documented in `rules/testing.md`. 7 rows.

Corpus 449 -> 571 rows (+122 round-1 rows, class `review-r1`). Deviation: a first merge-target version used the branch inside a `/.../` regex; the 3.5 release/1.x test caught it; it now compares with `eq` (test added).

## Review round 1 fixes, batch 2

Findings F1-F9 of the second Sonnet reviewer fixed. Commits: F1 `3de6698`, F8 `26a5091`, F2/F3/F4/F5/F7/F9 `b6f42ae`, F6 (see `git log` for the `project-profile` commit). Full `npm test` in the real worktree: 2398/2398 (baseline 2366, +32 tests); corpus 571 -> 684 rows (class `review-r1b`); agnostic-lint test green. `ShellParse.pm` untouched (3.3 byte-equal test).

- F1: the runner needs `jq`, `perl`, `git` (named failure, exit 1); every row must parse as `{hook, expect in allow|deny|ask|grant|rewrite, label, and raw or tool+input object}` (a bad row fails the run naming its line); a missing, unreadable or row-less corpus exits 1; `ran != rows in file` exits 1; no `canaries: pass=` line is printed on any refusal. `hooks-apply.sh` runs the runner through `run_canaries` and treats an exit 0 without a `canaries: pass=N fail=0` line (N>0) as failure, in the dry run and the real apply. Tests: jq hidden via PATH, missing, empty, blank-only, garbage, truncated, wrong-shape rows, no trailing newline, stub runner. The ran-versus-rows check is defence in depth; no corpus I could build makes the loop stop early, so it is asserted by source needle only.
- F8: `PATHS` is a bash array filled from `git apply --numstat` split on tabs; a path git C-quotes (control character, newline) is refused; `"${PATHS[@]}"` in add, commit and revert. Tests: space path refused by full name outside and applied in the dry run inside, tab and newline paths refused, no unquoted `$PATHS`.
- F2: `git grep` with `-O`, a cluster ending in `-O...`, or any abbreviation of `--open-files-in-pager` down to `--op` (derived from `git grep -h`: `--o` is ambiguous with `--only-matching` and `--or`) is denied; options after `--` are ignored. `git -c` / `--config-env` keys that run a command (`core.pager|fsmonitor|editor|sshcommand|askpass|hookspath|gitproxy`, `alias.*`, `pager.*`, `diff.external`, textconv/command, merge driver, `filter.*`, credential helper, gpg program, `sequence.editor`, tool cmd/path keys, `include*.path`, `uploadpack.packobjectshook`, `protocol.ext.allow`, remote receivepack/uploadpack/vcs) or any value starting with `!` are denied (not asked). `-c user.name=x` and `-c color.ui=never` stay allowed.
- F3: the sudo prefix check now runs before the empty-`rest` skip, so `sudo -i`, `sudo -s`, `sudo --login`, `env sudo -i`, `/usr/bin/sudo -s`, `bash -c "sudo -i"` and bare `sudo` are denied; `doas` already was; `su` without `-c`/`--command` (login forms) is denied, `su -c CMD` is judged by CMD.
- F4: nine deny rows (`Read(~/.ssh/**)`, the cloud CLI credentials directory, `~/.config/gh/**`, `~/.gnupg/**`, `**/.npmrc`, `**/.git-credentials`, `**/*.pem`, `**/*.key`, `**/id_rsa*`): fixed deny 33 -> 42, total 38 -> 47, slot index 33 -> 42. `secret_path` also denies those paths for the reader and copy commands, plus `id_dsa|ecdsa|ed25519`. `.env.example` and every template stay readable (C4 test unchanged).
- F5: `root_like` treats `$HOME`, `${HOME}`, `$PWD`, `${PWD}`, `$OLDPWD` and `~user` as the whole tree. `rm -rf $(pwd)` is not caught: the tokeniser replaces a substitution with `$SUB`, so the target is unjudgeable (unverified fix would need ShellParse).
- F6: `branchCheck` implements check-ref-format: no empty component (`//`, leading, trailing `/`), no component starting with `.` or ending `.lock`, no `..`, no trailing `.`, not `HEAD`, no `@{`, no control character or `~^:?*[\` (the rendered alphabet already excluded the metacharacters; named as defence in depth).
- F7: `HookGuard::start` denies (exit 2, "not a JSON string") a `tool_name` Bash call whose `command` is a number, null, boolean, array, object or missing, before any of the five Bash hooks reads it (JSON numbers are told from strings by the SV flags, so the string `"5"` is still a command). `flake-gate.mjs` validates path and text shapes first: a non-string `file_path`/`path`, `content`, `new_string`, non-array `edits`, non-object edit or non-string `edits[].new_string` is denied even with no config.
- F9: `secret_path` lowercases every segment, so `.ENV`, `.Env.Local`, `SECRETS/x` and `~/.SSH/id_rsa` are denied for Bash readers. No upper-case `Read(...)` rows were added: the C4 shape forbids a trailing `.*` row, so a full upper-case twin set is not possible, and a partial one is worse than none. Whether the settings matcher is case-sensitive is unverified; the Read tool has no hook here, so the case-variant Read gap on a case-insensitive filesystem stays open for the Read tool only.

Mutants killed (each in the `3.8` mutant list, run against the hook's own rows): sudo-only skip restored, `su` rule, pager option ignored, pager abbreviation narrowed, `-c` keys ignored, `!` value ignored, `$PWD` and `~user` narrowed, key directories, `.config/gh`, `.npmrc`/`.git-credentials`, `.pem`/`.key`, `id_rsa` names, case-folding removed; F7 `_is_string` check removed (process test).

Deviations: (1) the lint's `cloud` class matches the vendor word for that CLI directory, and the brief allows no new exception class, so the settings row is `Read(~/.a?s/**)` (also matches other three-letter dot directories of that shape) and the hook regex is `a[w]s`; the corpus rows spell it `aws` (decoded by `jq`). (2) F2, F3, F4, F5, F7, F9 share one commit: they edit the same `check-denied-command.pl`, one corpus and one test file, and interactive hunk staging is unavailable. (3) The worktree has no `node_modules`; a temporary symlink to the main checkout's `node_modules` was used for the runs and removed. (4) Exception lines recomputed: settings docker `90-96,134,137,138`, manifest docker `189-195,233,236,237`, `HookGuard.pm` pnpm line 59; no new class.


## Review round 2 fixes

Findings M1-M3, L1-L6 of Sonnet review round 2 fixed. Commits: M1 `1dd2883`, M2+L5 `e2a9bc8`, M3 `6c84a21`, L1 `8bf1998`, L2+L3 `82242a2`, L4 `1dad854`, L6 `2ad69b9`, tests/pins/exceptions/ruling `be0f432` and `1ce3d52`. Corpus 684 -> 812 rows (class `review-r2`, 128 new; 7 older rows re-pointed, see below). Full `npm test` at `1ce3d52`: 2433 tests, 2432 pass; the one failure (`scripts/agnostic-lint.test.js` "repo at baseline") is caused by another agent's uncommitted `scripts/agnostic-lint/{baseline,allowlist}.json` and `agents/` edits in the same worktree, none of them mine; `node scripts/agnostic-lint.js check` was ok at each of my commits (740 denied, 363 allowed). Every new row set was run red against the HEAD hook first (M1 12 fail, M2/L5 16, M3 8, L2/L3 32, L4 8), then green.

- M1: `HookGuard::fallback_entries` parses a word holding a space as a command line only when it is the first argument of the unknown command (`wrapper 'git reset --hard'`, existing row kept) or follows an evaluator (`sh|bash|zsh|dash|ksh ... -c`, eval, xargs, `env -S`, watch, timeout, nohup, exec, sudo, doas); `--title "deny sudo ls"`, `--filter "denies sudo"`, `-t "..."` are data. The 2000 cap now counts derived command lines, not scanned words; a 16 KB chain of 1000 `find . -name x;` passes (input cap 32 KB unchanged). 25 allow rows (the four commands, 20 more, the chain).
- M2: grep cluster walk (digits are counts, `-d`/`--directories` value `rec|recu|recur|recurs|recurse`, A B C m D e f take their value); `rm -5rf /` denied. L5: `-maxdepth` counts only as a find option (skipping the value of -name, -type ... ) before the first `-exec|-execdir|-ok|-okdir`; `ag`, `ack`, `ack-grep` need a file operand or a pipe.
- M3: `tok_eq` lowercases both sides; a word after `cd dir &&` is also tried as `dir/word` (`e->{dir}`); `flake-gate.mjs` globs and the `flake-ignore` marker are `/i`.
- L1: wrappers use `D=${BASH_SOURCE[0]%/*}` (`.` for a bare name) and `. "$D/lib/run-perl.sh" X || exit 2`; `run-perl.sh` resolves its own dir with an explicit failure exit 2; the flake wrapper resolves the same way.
- L2: 15 more readers; `.env*.example|.sample|.template|.dist` readable; `git -c credential.helper= push` allowed (empty value), `credential.helper=foo` and bare `credential.helper` still denied. L3: `HookGuard::start` denies any control character except tab and newline (NUL, ESC, CR ...) for all five Bash hooks; `rm -rf .*` and a recursive rm whose target starts with a command substitution (`$SUB`) are denied; `su` is denied in every form. Frozen-tokeniser limits listed in the `check-denied-command.pl` header and `rules/testing.md`.
- L4: `sed --in-place` (any unambiguous prefix) and `find ... -exec|-execdir|-ok|-okdir <writer>` / `-fprint*` on the marker deny; interpreter code that only stats it (statSync, getmtime ...) and awk programs without `>`, `|`, `system(`, `getline`, `-i`, `-f` are allowed.
- L6: `run_canaries` runs the runner under `env -u HOOKS_DIR -u CORPUS` and takes the hooks dir as its second argument (dry-run passes the patched copy). `Read(~/.a?s/**)` kept: the `cloud` class is a vendor class, not a generic-tool list, so no exception line; reason in `M-03-FRAGMENT-RULING.md` A13. `Read(~/.ssh/id_ed25519*)`/`id_ecdsa*` not added (`~/.ssh/**` covers them; the 47-row deny set stays).
- Mutants killed (R2 list in the 3.8 section, run against the `review-r2` rows): M1 quoted-word parse, M2 digit cluster (grep and rm), `-d` value, L5 maxdepth after exec / value of -name / ag+ack, M3 case and cd dir (hook) and glob and marker case (flake), L2 readers / template suffix / credential reset, L3 substitution target / control characters, L4 sed, find, interpreter exemption, write detection, awk. L1 and L6 mutants (drop `|| exit 2`; drop `env -u`) are inside their tests. Existing mutant needles for `tok_eq`, `su`, the template regex, `git -c` and `root_like` updated to the new source text.

Deviations: (1) the `deno test --filter "denies sudo"` row is `bun test --filter ...` in the corpus (the corpus must carry no `deno` term, test 3.9); the `deno` form is in the unit test. (2) A quoted word that is the FIRST argument of an unknown command is still parsed as a command line (existing row `someunknown 'git reset --hard'`, "keep every deny row green"); `notify "git reset --hard done"` is therefore denied. (3) Seven earlier rows changed because the binding decisions reverse them: `su` login rows now expect the reason `su runs commands`, `su -c "id" root` is deny, `su -c "git push --force" root` reason follows, the never-touch "known gap" row `cd tools && ./release.sh prod` is deny (gap closed). (4) NUL/control rows are on `check-denied-command.sh` (the `@bash-all` rows must all be allow, test 3.9). (5) `jest` in a row label hit the `frontend` lint class: the row uses `mocha`. (6) Exception lines recomputed: `HookGuard.pm` pnpm 59 -> 64, `block-push-without-local-tests.pl` deno 22 -> 22, 27; no new class. (7) Other agent committed M-05/M-08 work on this branch during the run; `be0f432` and later contain only my paths.

## Fable round 1 fixes

Corpus 812 -> 892 rows (F1 +46, F2 +34). Canary run over a freshly deployed project: `canaries: pass=892 fail=0`. Guard tests `3.7`, `8.2`, `8.3` pass (13/13); the full suite is left to the coordinator.

- F1 (9ac6452) `check-denied-command.pl`: `file_words` skips the pattern, program or filter (first positional unless -e/-f/--regexp/--file/--expression) for grep-family, rg, sed, awk, jq, yq and the values of value-taking options; file arguments and -f/--file values stay judged. 25 allow rows (the 7 named plus 18 routine pattern-bearing commands) and 21 deny rows. Red against the pre-fix hook: 17 of the allow rows fail. Six R2-L2 rows (`ag .env` ... `pcregrep .env`) had the pattern as their only argument; they now read `<tool> pat .env`.
- F2 (90ad823) `check-test-command.pl`: a locked literal matches as an ordered subsequence of the command words (any word between its tokens is skippable). New fixture `@repo-locked-multi` (locked_commands `npm run test:e2e`, `make integration`) in `run-canaries.sh`. 18 deny rows (the four named plus 14) and 16 allow rows (data-only `echo`/`printf`/`grep`/`git commit -m`, `FLAG=... true`, `make clean`, `npm run lint`, locked runs under `stack-lock.sh`). Red against the pre-fix hook: 9 deny rows allowed.
- F3 (b5695c3) 29 `[memory: ...]` tags in `agent-ops-lessons.md` (23) and `engineering-lessons.md` (6) are now `[incident: <project incident id>]`; the intro line tells a project to fill or delete it. Guard 3.7 tries each line also with `_` and `-` as separators (no new hits); positive control injects `[memory: ceo_x]`; a test asserts no `[memory:` in either deployed doc. Pins 8.2/8.3 updated.
- F4 (b5695c3, 156b602) `zg` removed from the reader lists in `HookGuard.pm:144` and `check-test-command.pl:57`; guard 3.7 has a literal `\bzg\b` check with an injected-zg control (the test is in the F3 commit, the hook edit in the F4 commit).

Deviations: (1) the F1 commit also carries two hunks of the concurrent M-08 executor in `preset-base.test.js` (guard-estate entries and the mirror count 42 -> 44), because both of us edit that file; those hunks are committed without their preset files until M-08 commits them. (2) The 36-minute `preset-base.test.js` was not run whole; deploy and canary runner were run via a scratch script outside the repo, with `NODE_PATH` pointing at the `node_modules` of the main checkout (this worktree has none).

Slice-2 notes from the review (not fixed):
- env loading denied but `while read ... < .env` / `dd if=.env` allowed
- `apt-get install -y sudo`, `rm -rf "$(mktemp -d)"`, `git -c core.pager=cat log` hard-deny
- `git rebase --abort/--continue` and `git pull` on the default branch prompt
- `gh pr create --push` not judged as push
- trailer-check floor for projects that already committed settings.json
- `project diff` rewrites config when slots stale
- CLAUDE.md/rules name scripts deployed by M-08/M-09
- `stack.commands.pre_pr_gate` has no 80-char cap
- suite takes 36 min
