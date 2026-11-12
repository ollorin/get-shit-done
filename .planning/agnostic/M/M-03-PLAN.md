---
phase: agnostic-M
plan: 03
type: backend
wave: 3
depends_on: ["02"]
files_modified:
  - get-shit-done/presets/base/**
  - get-shit-done/bin/preset-base.test.js
  - get-shit-done/bin/project-profile.js
  - get-shit-done/bin/project-profile.test.js
  - get-shit-done/bin/project-registry.js
  - get-shit-done/bin/project-registry.test.js
  - tests/fixtures/agnostic/base-deployed-exceptions.json
  - package.json
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "`gsd-tools project init --preset base` on an empty git repo creates CLAUDE.md with the full methodology and the clean-code mandate, .claude/settings.json, five hooks with lib, the canary runner and rows, the hook-change tooling, the testing rule and one skill; exit 0"
    - "The five hooks pass their canary rows (own rows plus the 82 `@bash-all` and 12 `@edit-all` shared rows) after deployment with default and with non-default parameter values, on macOS and on Linux, and the runner fails on a flipped row"
    - "The settings fragment allows only read-only commands, denies the generic destructive commands, secret reads and the project's never-touch deploy commands, and registers exactly the five hooks (four on `Bash`, one on `Write|Edit`)"
    - "No deployed file names the igaming project, its domain, its products or an absolute user path, outside one shared exception list"
  artifacts:
    - get-shit-done/presets/base/preset.json
    - get-shit-done/presets/base/settings.fragment.json
    - get-shit-done/bin/preset-base.test.js
    - tests/fixtures/agnostic/base-deployed-exceptions.json
---

<objective>
The guardrail half of the base deployment, per `FABLE-KNOWHOW-TRANSFER.md` (K:) tasks T1-T6, T14, the hook parts of T8 and the flake-pattern hook of K:94. The know-how half is M-08, the style gate and ported tools M-09. Everything here deploys to every project (index decision 4). Copy sources: the verbatim snapshot `get-shit-done/presets/igaming/` (preferred) and, read-only, `~/igaming-platform/CLAUDE.md`, `.claude/` and `scripts/`. No golden hash. The engine is not edited.

Placeholders (index decision 3): the four text keys `{{project.owner_title}}`, `{{stack.branch.default}}`, `{{stack.commands.search}}`, `{{stack.commands.pre_pr_gate}}`, and the five deny slots of 3.12. The 2.1 wiring writes their defaults and restricts their values. Any other command is named in prose ("the `test_all` command of the stack profile"). K:289-291 names `project.name`, `commands.check`, `commands.gate`, `paths.tmp`: use the existing schema names instead (`project-profile.js:19`), `.tmp` stays literal.

**`guarded: true` is set explicitly** on every entry under `.claude/hooks/` (wrappers and `lib/`), on `run-canaries.sh`, `hooks-apply.sh` and `hook-patch-trailer-check.sh`. The engine guards by itself only `.husky` and `.githooks` (`project-deploy-guard.js:14`) and files in the directory a hook command names (`:101`), which does not reach `lib/`. `canaries.jsonl` is not guarded: rows may be added without touching enforcement.

`preset-base.test.js` is new (parallel to `preset-igaming.test.js`); every test runs in a tmp git repo with `GSD_HOME=<tmp>`. Fork CI is `ubuntu-latest` running `npm test`: no test and no deployed script may need a macOS-only tool. Tasks are listed in execution order; 3.8 (the Fable review) runs last so it sees every hook and settings piece.
</objective>

<tasks>

<task id="3.1" type="auto" tdd="true">
<name>CLAUDE.md with the full methodology and the clean-code mandate, preset.json, profile keys (K: T1, T7 part)</name>
<files>presets/base/preset.json, presets/base/CLAUDE.md (new), preset-base.test.js (new), project-profile.js:17-24, 102-110, 126-145, project-profile.test.js, package.json:64</files>
<action>
- CLAUDE.md carries every K: section 1.1 row of class AS-IS or PARAMS, in the source order, with the source wording kept and only the names replaced. Read `~/igaming-platform/CLAUDE.md` in full (228 lines). Sections: path-trace; behaviour guidelines; use of tools (`{{stack.commands.search}}`; the allowed test-command shapes become "the shapes in `stack.test_command_shapes`"); **clean code and functional style** (below); code quality; token and length discipline; before creating a PR and "before any plan claims done" (commands named as profile keys, gate script `{{stack.commands.pre_pr_gate}}`, the style gate `scripts/style-gate.mjs` named among the checks); CI failure triage (`scripts/ci-diagnose.mjs`); subagent tiering table and rules; high-stakes domains ("the risk domains of `.planning/PRODUCT-BRIEF.md`; authentication and security always"); review loop (plus one line: every review round applies the checklist of `.claude/rules/code-style.md`); "Opus runs once each at"; rulings; Haiku context and reporting cost; parallelism; all orchestration hard rules (the UI QA bullets say "the UI QA capability", the reset bullet says "the stack reset command of the profile"); temp files; branch management (`{{stack.branch.default}}`). Owner is `{{project.owner_title}}`.
- Clean code and functional style is a default mandate, not a project choice (owner ruling; K:79 classed `fp.md` PROJECT, overruled). Written language-agnostically from the igaming section "Functional Programming" (4 bullets) widened to: errors are values (a result type, never a thrown exception across a module boundary); immutability (no in-place change of an input or shared value); routing and dispatch by a match/table, not an if/else chain; pure domain and application logic, side effects at the edges; small single-purpose modules (size and cohesion rule: `.claude/rules/module-structure.md`); no duplicated logic. Last line: "The concrete idioms for this stack are in `.planning/STACK-PROFILE.md`, section Style; the full rule and the review checklist are in `.claude/rules/code-style.md`; `scripts/style-gate.mjs` enforces it."
- Not carried (K: class PROJECT): Local Development, References, the Domain Rules table, the model-allowance paragraph, the product names in the high-stakes list, the library names of the FP section (they live in the rule set, M-09).
- All of it inside one managed block (`<!-- gsd:begin core -->` … `<!-- gsd:end core -->`, `project-deploy-files.js:48-49`); entry `kind: "block"`, `render: true`. Below the block: a short project section (commands → `.planning/STACK-PROFILE.md`; domain and risk domains → `.planning/PRODUCT-BRIEF.md`; lessons and procedures → `docs/gsd/`; add `.tmp/` to `.gitignore`).
- `preset.json`: name `base`, version `1`.
- Profile loader, `KNOWN_STACK_KEYS` with shape checks: `branch` (`{ default: string }`); `locked_commands` (list of non-empty strings, 3.9); `flake_patterns` (`{ test_globs: [string], patterns: [{ id, match, requires_before?, unless_nearby?, window?, message }] }`, 3.11); `deploy` (`{ never_touch: [string] (at most 5), slot_1 … slot_5: string }`, 3.12); `style` (`{ rule_set: string, roots: [string], exclude_globs?: [string], edge_globs?: [string], max_file_lines?: integer, dup_min_lines?: integer }`, 9.2); `cve` (`{ lockfiles?: [string], severity_floor?: string, allow_missing_scanner?: boolean }`, 9.7); `host` (`{ worker_patterns?: [string], protected_patterns?: [string] }`, 9.9). Add `backend` and `web_ui` to `KNOWN_CAPABILITY_KEYS` (object or `false`); accept `lock_file` in `capabilities.ui_qa`.
</action>
<behavior>
- T2 CLI: `project init --preset base` in a tmp repo whose config has a slug and `stack.capabilities: {}` → exit 0; CLAUDE.md has both markers, the rendered owner title, search command and default branch, and each section heading of the list above incl. the clean-code heading (one literal array in the test). ADD.
- T2 unit: the rendered CLAUDE.md contains no `{{`; the clean-code section names no library and no language. ADD.
- T2 unit: `profile check` accepts each new key with a valid value; rejects `capabilities.backend: true`, `locked_commands: "x"`, `deploy.never_touch` with 6 entries, `style.rule_set: 3`, a `flake_patterns` pattern without `match`. ADD.
</behavior>
<verify>Full gate.</verify>
<done>3 tests pass; `wc -l` of the rendered file recorded (no limit).</done>
</task>

<task id="3.2" type="auto" tdd="true">
<name>Settings fragment (K: T2) [critical path]</name>
<files>presets/base/settings.fragment.json, preset.json (`settings_fragment`), preset-base.test.js</files>
<action>
Read `presets/igaming/settings.snapshot.json` (same content as igaming `.claude/settings.json`) at the allow rows for git read commands and read-only coreutils, and the deny/ask block (locate by content).
- deny: the 16 generic rows of the snapshot: `rm -rf /`, `rm -rf ~`, `rm -rf *`, `git push --force`, `git push -f`, `git reset --hard`, `git clean -fd`, `docker rm`, `docker rmi`, `docker system prune`, `dropdb`, `> /dev/sda`, `npm install -g`, `npm uninstall -g`, `sudo npm`, `sudo`; plus the three new secret-read rows `Read(./.env)`, `Read(./.env.*)`, `Read(**/secrets/**)`. (The snapshot's deny array has 19 rows: these 16 and 3 `production` rows. K:121 "17 of 20" is wrong; index section 0, corrections.) The `production` rows are not dropped: 3.12 renders them per project.
- ask: `Bash(git rebase:*)`, `Bash(npm uninstall:*)`, `Bash(docker stop:*)`.
- allow: `Read(**)`, git read commands, read-only coreutils, shell keywords. Nothing else.
- Never carried: any `.env` allow, bare `git push`, `Bash(bash:*)`, `curl`, `python3`, `node`, `xargs`, `psql`, compound or pipe wildcards, `Bash(*NAME=*)` rules, absolute paths.
- hooks: left empty here; 3.3, 3.5, 3.9 and 3.11 add the five registrations.
Shape allowed by the engine: `permissions.{allow,deny,ask}` and `hooks` only (`project-deploy-render.js:9-10`).
</action>
<behavior>
- T2 CLI: after `init`, `.claude/settings.json` holds exactly the fragment's allow, deny and ask sets. ADD.
- T2 unit: no allow entry matches `/\.env|git push|bash:|curl|python|node|xargs|psql|[|;&]|\*[A-Z_]+=\*|\/Users\//`; the 19 fixed deny rows and 3 ask rows are present. ADD.
- T2 unit: `scanText` (`project-deploy-scan.js`) over the fragment returns no hit. ADD.
</behavior>
<verify>Full gate.</verify>
<done>3 tests pass; allow count recorded.</done>
</task>

<task id="3.12" type="auto" tdd="true">
<name>Never-touch deploy commands rendered as deny rows [critical path, mutation]</name>
<files>presets/base/settings.fragment.json, get-shit-done/bin/project-registry.js (`applyToConfig`), project-registry.test.js, project-profile.js (value restriction), preset-base.test.js</files>
<action>
igaming denies three production deploy commands (`.claude/settings.json:311-313`); K:123-124 classes them PARAMS. The engine renders scalars only (`project-deploy-render.js:25, 56`), so a list cannot become rows directly. Design, no engine edit:
- The interview answer (4.2) is `stack.deploy.never_touch`: at most 5 command prefixes, each matching `^[A-Za-z0-9 ._/-]+$` (e.g. `gh workflow run deploy-prod`). An empty list is a valid answer.
- `applyToConfig` (2.1 wiring, runs before the engine) derives five scalars in the same write: `stack.deploy.slot_N` = entry N, or the inert literal `gsd-unused-deploy-slot-N` when there is none. Slots are always rewritten from the list (the list is the source). More than 5 entries or an entry outside the pattern → the wiring's validation step fails before any write and names the key.
- The fragment gains five deny rows `Bash({{stack.deploy.slot_1}}:*)` … `slot_5`.
A prefix row stops the literal spelling only; whether that is enough is question 7 of 3.8.
</action>
<behavior>
- T1 CLI: `never_touch: ["gh workflow run deploy-prod", "tools/release.sh prod"]` → after `init` the deny set holds `Bash(gh workflow run deploy-prod:*)`, `Bash(tools/release.sh prod:*)` and three `gsd-unused-deploy-slot-N` rows. ADD.
- T1 CLI: no `stack.deploy` → five inert rows, exit 0. ADD.
- T1 CLI: a fresh tmp repo whose config already holds stale `stack.deploy.slot_1..5` (from an earlier list) and `never_touch: ["tools/release.sh prod"]` → after `init` the config's `slot_1` is `tools/release.sh prod`, `slot_2..5` the inert literals, and the settings hold the matching rows. ADD. (A second `init` on an initialised repo is refused by the engine, `project-deploy.js:166`, and per decision 6a the settings file is never rewritten, so this test uses a fresh repo and reads `.planning/config.json`.)
- T1 CLI: 6 entries, and an entry `x"; y` → exit 1, config and registry bytes unchanged. ADD.
- T1 unit: the 3.2 set-equality test counts 24 deny rows (19 + 5). UPDATE.
Mutants: m1 slots filled only when absent (a changed list keeps old values) → the stale-slots test, asserting `stack.deploy.slot_N` in the config; m2 the 5-entry limit dropped (entry 6 silently lost) → third test; m3 value check removed → third test.
</behavior>
<verify>Full gate; mutants killed, one line each in the summary.</verify>
<done>4 tests added, 1 updated.</done>
</task>

<task id="3.3" type="auto" tdd="true">
<name>Hook shell + redirect-recursive-search (K: T3) [critical path]</name>
<files>presets/base/hooks/redirect-recursive-search.sh, hooks/lib/{run-perl.sh, fail-closed.sh, ShellParse.pm, redirect-recursive-search.pl}, preset.json, settings.fragment.json, preset-base.test.js</files>
<action>
Copy from `presets/igaming/hooks/` (10 + 8 + 7 + 359 + 79 lines). `ShellParse.pm` is copied byte-for-byte (`render: false`); its runtime names (`:214`, `:248`, `:250`, `:263`) are a generic wrapper list and go on the shared exception list of 3.7, not into an edit. In `redirect-recursive-search.pl` the search tool named in the message becomes `{{stack.commands.search}}` (`render: true` for that file only). Every entry `kind: "whole"`, `guarded: true` (wrapper and each `lib/` file), modes preserved. Register on `PreToolUse`, matcher `Bash`, as `"$CLAUDE_PROJECT_DIR"/.claude/hooks/redirect-recursive-search.sh`.
</action>
<behavior>
- T1 process: deployed hook, stdin JSON `grep -r x .` → deny whose reason names the configured search command; `grep -n x file` → allow. ADD.
- T1 process: malformed stdin → the verdict `fail-closed.sh` defines (read it, assert it). ADD.
- T1 unit: the deployed `ShellParse.pm` is byte-equal to the igaming snapshot copy. ADD.
</behavior>
<verify>Full gate.</verify>
<done>4 assertions pass.</done>
</task>

<task id="3.4" type="auto" tdd="true">
<name>Canary runner (portable) + rewritten, rendered rows of the first hook (K: T4) [critical path]</name>
<files>presets/base/canaries/run-canaries.sh, canaries.jsonl, preset.json, preset-base.test.js</files>
<action>
- Runner from `presets/igaming/canaries/run-canaries.sh` (96 lines): hook lists = the base set (`BASH_HOOKS`, `EDIT_HOOKS`, `:43-44`), no `fork:`/`user:`/`user-rtk` branches (`:70-72`), no `SLOW` contract-drift branch (`:63`), hooks found relative to the project root. Removed now, by line of `run-canaries.sh`: `:4` (the `SLOW=1`/drift sentence of the header), `:6` (the igaming path and `charlotte.lock` in the header), `:13` (the tokens `@repo-drift`, `@repo-locked`, `@repo-unlocked` from the cwd-token list), `:35-36` (the drift fixture: stub registry that calls `Deno.exit(1)`), `:37-38` (the locked fixture holding a `.tmp/charlotte.lock`), and the `mkrepo` calls `R_DRIFT` (`:35`) and `R_LOCKED`/`R_UNLOCKED` (`:30`) they feed. The unit test of this task greps the runner for `Deno`, `charlotte`, `drift`, `igaming` and `supabase` and expects none. `render: true`: the fixture repo that stands for "on the protected branch" is created on `{{stack.branch.default}}` (token `@repo-default`, was `@repo-main`). Dest `scripts/validation/hook-canaries/` (the path `hooks-apply.sh` expects), `guarded: true` for the runner only.
- **Portability.** The source sets marker ages with `date -v-31M` (`:31-33`), which exists only on macOS. Replace each with `perl -e 'utime $t, $t, $ARGV[0]'` with `$t = time - <seconds>` (perl is already required by every hook). Needs `jq` and `perl` only; the test fails with the missing tool's name, it never skips.
- Rows: `grep '"redirect-recursive-search.sh"' presets/igaming/canaries/canaries.jsonl` (84 rows). 13 of them carry a project term (`grep -c -i -E 'deno|supabase|apps/api|preflight|igaming|/Users/'`). Rewrite each such row, never drop it: replace the project command, path or name with a neutral one of the same shape (same wrapper, same operators, same flag positions) so the row exercises the same parser path, and keep `expect`. Absolute project paths become the runner's cwd token.
- `canaries.jsonl` is `render: true`. Wherever a row's `input` or `reason` holds a value the hook renders from config, the row holds the same placeholder, so rows and hooks cannot disagree after rendering. The value restriction of 2.1 keeps rendered JSON valid.
</action>
<behavior>
- T1 process: after `init` with the defaults, the runner exits 0. ADD.
- T1 process: after `init` with `commands.search: "rg -n"`, the runner exits 0 (rows follow the config). ADD.
- T1 process: one row with `expect` flipped → the runner exits non-zero and names the row. ADD.
- T1 unit: the preset's `canaries.jsonl` has 84 rows for this hook and none matches the project-term pattern above. ADD.
- T1 unit: the runner source contains no `date -v`, no `$HOME`, and none of `Deno`, `charlotte`, `drift`, `igaming`, `supabase` (case-insensitive). ADD.
</behavior>
<verify>Full gate.</verify>
<done>Rows: 84 kept, 13 rewritten (table of old → new command in the summary).</done>
</task>

<task id="3.5" type="auto" tdd="true">
<name>Merge-target and push-gate hooks + rewritten rows (K: T5) [critical path]</name>
<files>presets/base/hooks/check-git-merge-target.sh, block-push-without-local-tests.sh, hooks/lib/{check-git-merge-target.pl, block-push-without-local-tests.pl}, canaries.jsonl, canaries/run-canaries.sh (marker fixtures), preset.json, settings.fragment.json, preset-base.test.js</files>
<action>
Copy (6 + 61, 5 + 63 lines), `render: true` on the two `.pl` files, every entry `guarded: true`:
- merge-target (`.pl:22-59`): the protected branch is `{{stack.branch.default}}` (keep `master` as a second literal); the rendered name is compared as a literal string or inside `\Q…\E`, never as a bare regex (a branch name may hold `.` and `/`). "CEO approval" becomes "`{{project.owner_title}}` approval".
- push gate (`.pl:16, 37, 45-55`): gate script path `{{stack.commands.pre_pr_gate}}`; the deny reason names the gate script. Keep "no gate script file → allow" (`.pl:48`) and the row that proves it.
- **Marker location.** The source marker is `<repo root>/.preflight-passed` (`.pl:49`), kept out of commits by igaming's own `.gitignore:7`. The base preset cannot add a `.gitignore` line (index decision 6), so a root marker would be an untracked, committable file. The marker is `.pre-pr-passed` inside the directory `git rev-parse --absolute-git-dir` prints for the push's repo (per worktree). The write-block pattern (`.pl:16`) keeps matching the marker name in any directory. The runner's `mkrepo` (`run-canaries.sh:21-27`) creates the marker there.
- Rows: the 25 + 42 rows of the two hooks. 1 and 36 of them carry a project term or a hard-coded value the hook now renders (`"CEO approval required"`, `"git push requires local CI preflight"`, branch `main`, the gate and marker names). Rewrite as in 3.4, placeholders where the hook renders them, fixture tokens renamed to match the new marker. No row dropped. New rows: a repo whose marker exists only at the repo root → deny (token `@repo-rootmarker`); `touch .git/.pre-pr-passed` → deny (marker write); a repo with no gate script file → allow (token `@repo-nogate`: the documented fail-open of `.pl:48`, so a change to that direction flips a row; the way a configured path could point at nothing is closed in 2.1, which validates `pre_pr_gate` as a space-free repo-relative path). Register both on `PreToolUse`, matcher `Bash`.
</action>
<behavior>
- T1 process: the runner exits 0 over all three hooks' rows with the defaults. UPDATE the 3.4 test (same assertion, more rows).
- T1 process: with `branch.default: "release/1.x"`, `owner_title: "Founder"`, `pre_pr_gate: "tools/gate.sh"` rendered, the runner exits 0; a push to `release/1.x` asks with a reason naming "Founder"; a push to `release/1ax` and to `feature/x` does not (the dot is literal). ADD.
- T1 process: push with no gate script file → allow; with the script and no marker → block; with a fresh marker in the git dir → allow; with a fresh marker at the repo root only → block; with a 31-minute-old marker → block. ADD.
- T1 unit: 25 + 42 + 3 rows present, none matches the project-term pattern or the literals `CEO`, `preflight`. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Rows per hook recorded: kept, rewritten, added (3).</done>
</task>

<task id="3.9" type="auto" tdd="true">
<name>check-test-command, profile-driven redesign + rows + the 82 shared Bash rows (K: T8 part) [critical path, Sonnet implements]</name>
<files>presets/base/hooks/check-test-command.sh, hooks/lib/check-test-command.pl, canaries.jsonl, canaries/run-canaries.sh (one fixture token), preset.json, settings.fragment.json, preset-base.test.js</files>
<action>
The igaming hook (13 + 161 lines) hard-codes one project's task runner, suite names and paths (`check-test-command.pl:17-123`). Its transferable rule is one sentence: a command that runs a suite which uses the shared local stack must run under the stack lock or the session supervisor. Redesign, do not port:
- Source of truth: `stack.locked_commands` in `<project>/.planning/config.json`, a list of literals (3.1), read at run time with core `JSON::PP`. Each literal is a token sequence. **Where the config is found**: from the git toplevel of the hook's working directory (`git rev-parse --show-toplevel` run in the cwd the tool call carries), never from `CLAUDE_PROJECT_DIR`. The canary runner sets `CLAUDE_PROJECT_DIR` to the hooks root, not to the fixture repo (`run-canaries.sh:48`), so a hook that read it would see no fixture config and every row would pass vacuously. No toplevel (not a git repo) → no config → allow.
- Verdict: for each command segment `ShellParse` yields, if a literal's tokens occur in order and adjacent in the segment and the segment is not wrapped (`lock_info`, `ShellParse.pm:251-271`), deny; the reason prints the wrapped form `scripts/stack-lock.sh --label <x> -- <cmd>`. Otherwise allow. The reminder branch of the old hook (`:150-158`) is not carried.
- No config file, no `stack` block, or an empty or absent list → allow (inert until the owner lists a command). A config file that is present and unreadable or not JSON → the fail-closed verdict.
- `ShellParse.pm` stays byte-equal (3.3). It recognises the wrapper only as the command word `stack-lock.sh` or `stack-lock.ts` (`:261`, `:267`), so `node scripts/stack-lock.mjs -- <cmd>` is NOT a wrapped command and is denied. 8.4 therefore ships `scripts/stack-lock.sh` as the only entry point and 8.1 says so.
- Rows: start from the 123 igaming rows. Keep every row whose class still exists (wrapper forms, chained commands, env prefixes, quoting, malformed input), rewritten with neutral commands against a fixture config `locked_commands: ["test:e2e", "run-all-suites.sh"]` (new runner token `@repo-locked-cmds`). Drop only rows that test logic which no longer exists; the summary lists each dropped class with its row count. New row: `node scripts/stack-lock.mjs --label x -- <listed cmd>` → deny.
- **Shared rows.** The corpus has 82 `@bash-all` rows (all `expect: allow`; each runs every registered Bash hook, `run-canaries.sh:63, 77-78`). Carry all 82; 35 carry a project term and are rewritten as in 3.4. A rewritten row that no longer gets `allow` from the four base Bash hooks is a finding to resolve, never a row to drop or flip.
- Register on `PreToolUse`, matcher `Bash`. Entries `guarded: true`.
</action>
<behavior>
- T1 process: with the fixture config, an unwrapped listed command → deny naming the wrapped form; the same under `scripts/stack-lock.sh --label x --` → allow; under `node scripts/stack-lock.mjs --label x --` → deny; an unlisted command → allow. ADD.
- T1 process: a listed literal that appears only as data (`X=test:e2e other-command`, `echo "test:e2e"`) → allow. ADD.
- T1 process: no `locked_commands` → allow; config file with invalid JSON → the fail-closed verdict. ADD.
- T1 process: the runner exits 0 over the four Bash hooks' rows and the shared rows; a flipped row of this hook and a flipped `@bash-all` row each fail it. UPDATE the 3.4 test.
- T1 unit: exactly 82 `@bash-all` rows, none matching the project-term pattern. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Row count before (123) and after, dropped classes listed; 82 shared rows, 35 rewritten.</done>
</task>

<task id="3.11" type="auto" tdd="true">
<name>check-flake-patterns, profile-driven redesign + rows + the 12 shared edit rows (K:94) [critical path, Sonnet implements]</name>
<files>presets/base/hooks/check-flake-patterns.sh, hooks/lib/flake-gate.mjs, canaries.jsonl, canaries/run-canaries.sh (one fixture token), preset.json, settings.fragment.json, preset-base.test.js</files>
<action>
Sources: `presets/igaming/hooks/check-flake-patterns.sh` (75 lines) and, read-only, `~/igaming-platform/apps/api/scripts/flake-gate.ts` (235 lines, now read: pure `scanFlakePatterns`, `:119-192`). The source hard-codes three categories built on one project's names: a field literal inserted into a table whose name matches `/shared/` with no `23505` retry within 40 lines (`:127-167`), and an hour window with no `getUTCHours` anchor (`:170-191`); it runs on Deno and matches only `*.integration.test.ts`. The transferable rule: a test value that is only correct by luck is flagged unless evidence of handling is nearby or a justified ignore comment is present. Redesign in plain Node, one implementation for the hook and the gate:
- `flake-gate.mjs` exports the pure `scanFlakePatterns(content, patterns)` and has two modes: `--hook` (reads the tool JSON on stdin) and `--all` (scans the tracked files matching `test_globs`; a `stack.gates[]` entry, 9.13).
- Source of truth: `stack.flake_patterns` (3.1), read at run time from `.planning/config.json` at the git toplevel of the hook's working directory, never from `CLAUDE_PROJECT_DIR` (the canary runner points that variable at the hooks root, `run-canaries.sh:48`, so reading it would hide the fixture config; see 3.9). A line that matches `match` is a violation when `requires_before` (if set) matches within the `window` lines above (default 40), and `unless_nearby` (if set) matches nowhere within `window` lines either side. The three igaming categories are expressible this way and go into the igaming project block (index section 4), not into base.
- Suppression as the source (`parseSuppressionAt`, `:62-84`): `flake-ignore: <reason>` on the same or the previous line; a marker without a reason still blocks.
- Hook mode: tool `Write` scans `content`, `Edit` scans `new_string` (a fragment can only under-detect, `:112-118`); other tools and files outside `test_globs` → allow. No config, no `flake_patterns`, or an empty list → allow. Unreadable or non-JSON config, a pattern that is not a valid regular expression, or unparseable stdin → the fail-closed deny. Patterns are compiled with `new RegExp` and never evaluated as code. `node` missing → the wrapper denies with the tool's name (the source allowed on a missing runtime, `.sh:35-36`; 3.8 question 3 rules on it).
- Rows: the 3 igaming rows rewritten against a fixture config (token `@repo-flake-cfg`) plus: justified ignore → allow; ignore without reason → deny; `requires_before` absent in the window → allow; `unless_nearby` present → allow; `Edit` fragment → deny; no config → allow; invalid regex in config → deny. 10 rows.
- **Shared rows.** The 12 `@edit-all` rows (all `expect: allow`, every one holding an absolute project path) are carried, rewritten to the cwd token and neutral file names of the same shape; they now run through this hook.
- Register on `PreToolUse`, matcher `Write|Edit`. Entries `guarded: true`.
</action>
<behavior>
- T1 process: the 10 rows above through the deployed hook, via the runner. ADD.
- T1 unit: `scanFlakePatterns` on the three source incident shapes with the igaming pattern list gives the source's three categories, and nothing on the source's exempt shapes (session-scoped table, retry present). ADD.
- T1 process: `--all` in a tmp repo exits 1 naming file, line and pattern id; exits 0 after a justified ignore. ADD.
- T1 unit: exactly 12 `@edit-all` rows, none matching the project-term pattern; a flipped one fails the runner. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Row counts recorded: 10 own, 12 shared.</done>
</task>

<task id="3.10" type="auto" tdd="true">
<name>hooks-apply.sh + hook-patch-trailer-check.sh with a floor parameter (K: T8 part) [critical path]</name>
<files>presets/base/scripts/hooks-apply.sh, scripts/validation/hook-patch-trailer-check.sh, preset.json, preset-base.test.js</files>
<action>
Copy from `~/igaming-platform/scripts/hooks-apply.sh` (65 lines) and `scripts/validation/hook-patch-trailer-check.sh` (48 lines), read-only source. Dests `scripts/hooks-apply.sh`, `scripts/validation/hook-patch-trailer-check.sh`, executable, `render: false`, `guarded: true`.
- Trailer check: the source hard-codes an igaming commit as `FLOOR_DEFAULT` (`:11`) and its comment names the CEO (`:10`); in any other repository that SHA does not resolve and the script fails on every run (`:28`). Remove both lines. The floor is `--floor <sha>` (kept, `:16`) or, without the flag, the oldest commit that touches the guarded paths (`git rev-list --reverse HEAD -- .claude/hooks .claude/settings.json`, first line: the commit that deployed them, which is exempt as the floor itself). No such commit → `scanned 0 commit(s)`, exit 0. The two messages that say "bump FLOOR_DEFAULT" (`:28-29`) say "pass --floor <sha>". Everything else (unresolvable floor, non-ancestor floor, parse-or-fail count) stays.
- `hooks-apply.sh`: change nothing but a path that does not exist in a base project, and `shasum -a 256` (`:26`) → `shasum` or `sha256sum`, whichever exists (name each change in the summary). Comments that cite an igaming experiment id are shortened to the rule.
This is the only sanctioned way to change a deployed hook: a human terminal, a patch hash, a review file, the canaries run against the patched copy, a trailer on the commit.
</action>
<behavior>
- T1 process: in a tmp base project, `hooks-apply.sh --dry-run` on a fixture patch that adds one comment line to a hook → exit 0. ADD.
- T1 process: a fixture patch that makes one canary row fail → non-zero, the hook file unchanged. ADD.
- T1 process: trailer check, no flag: passes when the only commit touching the paths is the first one; fails naming the commit after a second commit edits a hook without the trailer; passes when that commit carries `Hook-Patch:`. ADD.
- T1 process: `--floor 0123456789abcdef0123456789abcdef01234567` (unresolvable) → exit 1 naming the floor; a floor on another branch (not an ancestor) → exit 1. ADD.
- T1 unit: neither deployed script contains `FLOOR_DEFAULT`, a 40-hex literal or `CEO`. ADD.
</behavior>
<verify>Full gate.</verify>
<done>5 tests pass; changed lines listed.</done>
</task>

<task id="3.6" type="auto" tdd="true">
<name>Rule testing.md, full kernel + skill finishing-a-development-branch (K: T6, T9 part)</name>
<files>presets/base/rules/testing.md, presets/base/skills/finishing-a-development-branch/SKILL.md, preset.json, preset-base.test.js</files>
<action>
Rule from `presets/igaming/rules/testing.md`, every generic part K:71 lists, as one file: no ambient local env (L21-34), clean-room gate run (L36-56), never add skip/ignore flags (L133), falsifiability and mutation proof (L135-148; the tool is `scripts/mutate/mutate.mjs`, 9.6), test economy tiers (L150-157), new coverage in a wired suite (L159-161), isolation (L175-181), flake prevention (the rule of 3.11 with the three igaming incident shapes as the worked example of a `stack.flake_patterns` list, names made neutral), bucket completeness self-check; plus "mocks mirror the real reply shape" and "a positive control for every new check". Commands are named as profile keys. Skill from the 206-line igaming copy with `{{stack.commands.pre_pr_gate}}` and `{{stack.branch.default}}`. Dests `.claude/rules/testing.md`, `.claude/skills/finishing-a-development-branch/SKILL.md`.
</action>
<behavior>- T2 CLI: both files exist after `init`; the rule contains each kernel heading (literal array). ADD (extend the 3.1 test).</behavior>
<verify>Full gate.</verify>
<done>Deployed; line counts recorded.</done>
</task>

<task id="3.7" type="auto" tdd="true">
<name>Regression guard for the base deployment, shared exception list (K: T14)</name>
<files>preset-base.test.js, tests/fixtures/agnostic/base-deployed-exceptions.json (new)</files>
<action>
One describe that loads, renders and deploys `base` three times: `capabilities: {}` after the 2.1 wiring (both groups on), `{ backend: false, web_ui: false }`, and `{ backend: {}, web_ui: false }`. M-08 and M-09 tasks add their files to the expected lists of this describe.
`base-deployed-exceptions.json`: `[{ "file", "class", "lines", "reason" }]`, the single list of deployed lines allowed to match a class pattern of `scripts/agnostic-lint/terms.json`. Start: `.claude/hooks/lib/ShellParse.pm` × `deno` (`:248`, `:250`, `:263`), × `pnpm` (`:214`), reason "generic wrapper and interpreter list"; `.claude/settings.json` × `docker` (three deny rows, one ask row), reason "generic destructive-command deny list". Both this guard and the pilot (7.2) read this file; neither holds a second list. An entry may be added only for a generic tool or technology list, never for classes `igaming`, `game`, `reg`, `money`, `owner`, `charlotte`, `abs`.
</action>
<behavior>
- T1: the deployed file list equals one literal expected list per configuration; the two gated groups are present with `{}` and absent with `false`. ADD.
- T1: no deployed line matches any class pattern of `terms.json`, except the (file, class, line) triples of the exception file; every exception entry still matches (no stale entry). ADD.
- T1: positive control: a temp copy of the preset with a project term injected into `CLAUDE.md` makes the same check fail. ADD.
- T1: hook registrations in the deployed settings: `PreToolUse` has exactly two groups, matcher `Bash` with the four Bash hooks and matcher `Write|Edit` with `check-flake-patterns.sh`; every command points at an existing executable file. ADD.
- T1: in `preset.json`, every entry whose dest is under `.claude/hooks/` (incl. `lib/`) and the three scripts named in the objective have `guarded: true`; `canaries.jsonl` does not. ADD.
</behavior>
<verify>Full gate; `preset-igaming.test.js` still green.</verify>
<done>5 tests pass.</done>
</task>

<task id="3.8" type="auto" tdd="true">
<name>Fable review of the settings fragment, every hook registration and the hook tooling; apply fixes</name>
<files>.planning/agnostic/M/M-03-FRAGMENT-RULING.md (written by the reviewer), then the files of 3.2-3.5, 3.9-3.12</files>
<action>
One reviewer on `model: "fable"` (fall back to `opus` and say so) gets the diff of 3.2-3.5, 3.9, 3.10, 3.11, 3.12 and answers each with file:line evidence:
1. Can any allow rule mutate a file, read a secret or reach the network?
2. The secret-read deny rows are a new rule: do they take precedence over `Read(**)`, do they cover nested `.env` files, is `.env.example` still readable, and what legitimate work do they block?
3. Do the five hooks fail open or closed on a crash, a missing `perl`/`jq`/`node`, or malformed input, and is each choice right for a project in its first hour? In particular: the push block is active on a default project as soon as 8.7's gate script exists; `check-test-command` and `check-flake-patterns` are inert until their list is set; the flake hook now denies on a missing `node` where the source allowed.
4. The rendered values (four text keys, five deploy slots) are restricted to `[A-Za-z0-9 ._/-]` (2.1, 3.12). Is that enough to keep a value from injecting code into a rendered `.pl`, `.sh`, `.jsonl` or settings file? Can a `flake_patterns` regex read at run time do anything but match?
5. Which read-only allow rows are missing for an unattended run not to stall (name each)?
6. Can an agent session change a deployed hook without `hooks-apply.sh`, and does the canary runner living outside `.claude/hooks` open a way to weaken enforcement?
7. **Row by row, all 19 fixed deny rows, the 5 deploy slots and the 3 ask rows:** name a spelling that does the same damage and is not caught, and rule for each row: accept as a steer, add a row, or move the rule into a `ShellParse` hook. Candidates the reviewer must settle (each is unverified here; the probe is the permission matcher's documented prefix rule plus one live attempt in a tmp project): `git push origin x --force` and `--force-with-lease` against `git push --force` / `-f`; `git clean -fdx`, `git clean -f -d`; `git -C . reset --hard`; `rm -rf ./*`, `rm -fr`; `sudo` behind `env` or `command`; a deploy command with a flag before the target.
8. **Every hook registration:** matcher (`Bash`, `Write|Edit`), and that each command resolves to a deployed file whose preset entry is `guarded: true`, including each `lib/` file it loads (`run-perl.sh`, `fail-closed.sh`, `ShellParse.pm`, the `.pl` files, `flake-gate.mjs`).
9. The marker under the git dir (3.5): can an agent session create it without the gate script, and is the per-worktree location right for linked worktrees?
Haiku applies the ruling; then Sonnet rounds to zero on 3.2-3.5, 3.9-3.12 (cap in index section 0). 8.4 and 8.7 are not in this review; they are must-confirm items of the batched Fable diff review (index section 2).
</action>
<behavior>
- T1: every rule the ruling adds or removes is reflected in the set-equality test of 3.2. UPDATE.
- T1: each fail-open/fail-closed choice the ruling changes gets one process test in the hook's test; each spelling the ruling moves into a hook gets one canary row. ADD + reason: changed verdict.
</behavior>
<verify>Full gate; each ruling point closed with a commit hash in the summary.</verify>
<done>No open point.</done>
</task>

</tasks>

<verification>Full gate; `node scripts/agnostic-lint.js check` ok (`presets/` is outside the lint scope; the 3.7 guard covers it).</verification>
<success_criteria>The four must-have truths hold by test.</success_criteria>
<output>`.planning/agnostic/M/M-03-SUMMARY.md`</output>
