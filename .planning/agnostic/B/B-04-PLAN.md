---
phase: agnostic-B
plan: 04
type: execute
wave: 4
depends_on: ["B-01", "B-02", "B-03"]
files_modified:
  - get-shit-done/bin/project-deploy.js
  - get-shit-done/bin/project-deploy-apply.js
  - get-shit-done/bin/project-deploy.test.js
  - get-shit-done/bin/gsd-tools.js
  - package.json
autonomous: true
requirements: [AGN-B2, AGN-B3, AGN-B4, AGN-B5, AGN-B6, AGN-B7]
must_haves:
  truths:
    - "`gsd-tools project init|diff|sync` deploys a rendered preset into a project: unchanged file → overwritten; edited file → merged; conflicting file → not written, reported, exit 2; project-added allow rule and project text outside markers survive"
    - "Any abort (render error, secret-shaped string in rendered output, invalid settings.json, destination outside the root, guardrail refusal) writes nothing: the project tree is byte-identical before and after"
    - "With `CLAUDECODE` set, `init` and `sync` refuse when `.claude/hooks/**` or `.claude/settings.json` would change, except `init` into a project that has no `.claude/settings.json`"
    - "A second `sync` with no preset change writes nothing; `diff` then reports zero changes"
  artifacts:
    - path: get-shit-done/bin/project-deploy.js
      provides: "planDeploy, runCli"
    - path: get-shit-done/bin/project-deploy-apply.js
      provides: "applyPlan, ensureGitignore, writeAtomic"
    - path: get-shit-done/bin/project-deploy.test.js
      provides: "plan tests P1-P11 and apply/CLI tests A1-A13, listed in package.json `test`"
    - path: get-shit-done/bin/gsd-tools.js
      provides: "`case 'project'` dispatch"
  key_links:
    - from: get-shit-done/bin/gsd-tools.js
      to: get-shit-done/bin/project-deploy.js
      via: "require + `case 'project'` directly before `case 'prompt-optimize'`"
      pattern: "case 'project'"
    - from: "planDeploy"
      to: "project-deploy-scan.js scanText"
      via: "every rendered file and the rendered fragment, before any write"
      pattern: "scanText"
e2e_flows: []
---

<objective>
Phase B engine + B7, design lines 203-234 of `/Users/ollorin/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md`: compose the B-01..B-03 modules into plan-then-write, add the manifest and merge base, the `CLAUDECODE` refusal, and the CLI. `project doctor` is Phase G. Hook canaries before commit are Phase F1 (no canaries exist in this repo yet).
</objective>

<threat_model>
The tool writes hooks and permissions, so it is itself a guardrail path (design risk R3).

| # | Threat | Control | Proof |
|---|---|---|---|
| T1 | An agent session runs `sync` to change hooks or permissions | refusal on `CLAUDECODE` for guarded changes (`planDeploy` step 12) | P6, A8, A9 |
| T2 | A preset writes outside the project, to a never-managed file, or replaces `.claude/settings.json` wholesale | `validateDest` (B-02 test 5) + realpath containment (step 6) | P7, A10 |
| T3 | A preset sets keys such as `disableAllHooks` or `defaultMode` | fragment key allow-list (B-02 test 7) | B-02 test 7 |
| T4 | A preset removes a project's own deny rule or hook | set-merge removes only previously deployed entries (B-03 tests 3, 6, 8) | A6 |
| T5 | A secret reaches a committed file through a preset file or a config value | scan of rendered output before write (step 5) | P5, A8 |
| T6 | A failure half-applies a deployment | all reads, merges and checks happen in `planDeploy`; `applyPlan` runs only on `ok`; manifest written last | A8, A2 |
| T7 | Conflict markers land in a hook script | a conflict produces no content (B-02 test 5); file, base and manifest entry stay | A5 |
| T8 | `--preset ../x` reads an arbitrary directory | name regex | P2 |
| Residual | An agent clears the variable (`CLAUDECODE= gsd-tools project sync`) | not closed: same limit as `scripts/hooks-apply.sh:4` in the igaming repo ("This steers; a detached process still passes"). Direct text edits of those paths stay blocked by `get-shit-done/bin/hooks/gsd-protect-managed-files.js:44-48` | none (stated limit) |
</threat_model>

<executor_rules>
- Work only in `/Users/ollorin/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `/Users/ollorin/igaming-platform`, `~/.claude`, `~/get-shit-done`, and never run `gsd-tools project init|sync` with `--root` pointing anywhere but a `mkdtempSync` directory. Tests create every project and preset under `os.tmpdir()` and remove them in `afterEach`.
- Do every check of deployed files inside the node tests. Do not type shell commands that name a `.claude/settings` file or a `.claude/hooks` path (a PreToolUse hook rejects such commands).
- The executor's own shell has `CLAUDECODE` set. Every in-process call passes an explicit `env` object; every `spawnSync` passes `env: { ...process.env, CLAUDECODE: <'' or '1'> }`.
- Forbidden: `npm run install:gsd`, `node bin/install.js`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Do not edit or `require` Phase A files (`scripts/agnostic-lint*`, `get-shit-done/bin/project-profile*.js`, the A3 templates and reference). Before editing `get-shit-done/bin/gsd-tools.js` or `package.json` run `git status --short -- <file>`; if not empty, stop and report (another writer is active).
- `get-shit-done/bin/gsd-tools.js` is 16.4k lines: read ONLY 205-225 (requires) and 15168-15187 (dispatch neighbourhood); locate by the quoted anchors if lines moved. Do not read or edit `gsd-tools.test.js`.
- Read the B-01..B-03 modules by their `module.exports` line and the function you call, not whole plans: `project-deploy-scan.js`, `project-deploy-render.js`, `project-deploy-files.js`, `project-deploy-settings.js`.
- One test file: `NODE_PATH=$HOME/get-shit-done/node_modules node --test <file>`. Full suite once, in Task 4: `cd /Users/ollorin/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-B04.log 2>&1; echo rc=$?`, read the last 15 lines only. Success: rc=0, `# fail 0`, named tests present.
- Lint: `node scripts/agnostic-lint.js check` exits 0 without regenerating the baseline. No vendor, product or tool names in code or comments of non-test files. No token-shaped literal in any file (tests build them at runtime, as in `project-deploy-scan.test.js`).
- CommonJS, `'use strict'`, node built-ins only, result objects instead of `throw`, `const` only, comments only for a non-obvious constraint. Each module ≤ 300 lines.
- Commit per task: `git add -f <paths>` then `git commit -m "<msg>" -- <paths>`; check with `git show --stat HEAD -- <paths>`; ignore untracked `.audit/`. Trailers on every commit:
  `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
</executor_rules>

<spec>

## Paths (relative to the project root, `/` separators)

`CONFIG = '.planning/config.json'`, `MANIFEST = '.planning/gsd-project-manifest.json'`, `BASE_DIR = '.planning/.gsd-preset-base'` (merge base of `<dest>` is `BASE_DIR/<dest>`), `SETTINGS = '.claude/settings.json'`.

## Manifest

```json
{ "manifest_version": 1,
  "preset": { "name": "demo", "version": "1" },
  "files": { "<dest>": { "kind": "whole", "sha256": "<hex of rendered bytes>" },
             "<dest>": { "kind": "block", "sha256": "<hex of rendered bytes>", "blocks": { "<id>": "<hex>" } } },
  "settings": { "permissions": { "allow": [], "deny": [], "ask": [] }, "hooks": [ { "event": "", "matcher": "", "command": "" } ] } }
```

`files` keys sorted. No timestamps (a no-op sync must reproduce the same bytes). `settings` is absent when no fragment was ever deployed. Serialised as `JSON.stringify(m, null, 2) + '\n'`.

## `planDeploy(opts)` → `{ report, ops }` (`project-deploy.js`); reads only, never writes

`opts`: `root` (absolute), `command` (`'init' | 'diff' | 'sync'`), `env` (object), `presetDir` (optional absolute path), `presetName` (optional), `presetsRoot` (default `path.join(__dirname, '..', 'presets')`).

`report`: `{ command, ok, preset, errors, secret_hits, refused, files, settings, guarded_changes, changes, conflicts }`
- `preset`: `{ name, version }` or `null`; `errors`: `[{ file?, reason }]`; `secret_hits`: `[{ file, pattern, line }]`; `refused`: `null` or `{ reason, paths }`
- `files`: `[{ path, kind, action, reason?, warnings? }]` in preset order, orphans last
- `settings`: `null` or `{ action: 'create' | 'update' | 'unchanged', added, removed }`

`ops` (never serialised): `{ files: [{ dest, content, mode }], bases: [{ dest, content }], settingsText, manifest }`.

Steps. A step that records an error finishes its own loop, then `planDeploy` returns `ok: false` with empty `ops`:

1. `root` is not a directory → `root is not a directory`. Read `CONFIG`: absent → `missing .planning/config.json`; unparseable or not a plain object → `.planning/config.json is not valid JSON`.
2. Preset: `presetDir` if given; else name = `presetName` or `config.stack.preset`; none → `no preset: pass --preset or set stack.preset`; name not matching `^[a-z0-9][a-z0-9-]*$` → `invalid preset name`; dir = `path.join(presetsRoot, name)`.
3. `renderPreset(dir, config)`; not ok → its errors.
4. Manifest: unparseable → `manifest is not valid JSON`. `init` with a manifest → `already initialised: run project sync`. `sync` without → `not initialised: run project init`. `diff` accepts both.
5. Secret scan: `scanText(file.content)` for every rendered file (`file` = its dest) and `scanText(JSON.stringify(rendered.settings, null, 2))` when a fragment exists (`file` = `'settings fragment'`). Any hit → `secret_hits` plus one error `secret-shaped string in rendered output`.
6. Containment: for every rendered dest, and for `SETTINGS` when step 8 applies: resolve `fs.realpathSync` of the nearest existing ancestor of `path.join(root, dest)` and re-append the missing tail; the result must equal or sit under `fs.realpathSync(root)`. Otherwise `{ file: dest, reason: 'destination escapes project root' }`.
7. Files. `prev = manifest.files[dest]`. `current` = dest bytes or `null`.
   - `whole`: `planWholeFile({ current, base: <BASE_DIR/dest bytes or null>, manifestHash: prev && prev.kind === 'whole' ? prev.sha256 : null, next: content })`.
   - `block`: `planBlockFile({ current: <utf8 or null>, next: content.toString('utf8'), prevBlocks: prev && prev.blocks || null })`; action `error` → `{ file: dest, reason }` in `errors`.
   - `create | overwrite | merge | update` → `ops.files` gets `{ dest, content, mode }` (`mode` = the rendered `mode`).
   - every action except `conflict` → `ops.bases` gets `{ dest, content: <rendered bytes> }` and the new manifest entry `{ kind, sha256: sha256(rendered bytes), blocks? }`. `conflict` → the previous manifest entry is carried over (or none).
   - manifest entries whose dest the preset no longer has → carried over, reported as `{ path, kind, action: 'orphan' }`. Nothing is ever deleted.
8. Settings, when `rendered.settings !== null` or `manifest.settings` exists: `current` = parsed `SETTINGS` or `null` when absent; unparseable → `{ file: SETTINGS, reason: 'not valid JSON' }`; `mergeSettings(current, manifest.settings || null, rendered.settings)`; not ok → `{ file: SETTINGS, reason }`. Action: `create` (file absent and `changed`), `update` (`changed`), else `unchanged`. `ops.settingsText = serializeSettings(settings)` for create/update. New manifest `settings = deployed`. Otherwise `report.settings = null`.
9. `changes` = number of file actions in `create | overwrite | merge | update`, plus 1 for settings `create | update`. `conflicts` = number of `conflict`.
10. `guarded_changes` (sorted) = dests starting with `.claude/hooks/` whose action is in `create | overwrite | merge | update`, plus `SETTINGS` when its action is `create | update`.
11. Any error so far → `ok: false`.
12. Refusal: `command !== 'diff'` and `env.CLAUDECODE` is a non-empty string and `guarded_changes.length > 0` and NOT (`command === 'init'` and `SETTINGS` does not exist) → `refused = { reason: 'guardrail paths change only from a terminal outside an agent session', paths: guarded_changes }`, `ok: false`, empty `ops`.

## `project-deploy-apply.js`

- `writeAtomic(file, content, mode)`: `mkdirSync(dirname, { recursive: true })`; if the file exists with identical bytes return `false`; write `<file>.gsd-tmp-<pid>`, `chmodSync` it to the existing file's mode if the file exists, else `mode` (default `0o644`), `renameSync`; return `true`.
- `ensureGitignore(root)`: lines `.claude/settings.local.json`, `.mcp.json`, `.env*`; a line counts as present when an existing line equals it after `trim()`; append the missing ones (adding a `\n` first when the file does not end with one), create the file when absent; return whether it wrote.
- `applyPlan(root, plan, command)` → `{ written: string[] }` (relative paths actually written, in write order). Order: `ops.files`; `ops.bases` (under `BASE_DIR`); `SETTINGS` when `ops.settingsText`; `.gitignore` when `command === 'init'`; `MANIFEST` last. Called only when `report.ok`.

## `runCli(cwd, args, env)` → `{ exitCode, result }` (`project-deploy.js`)

`args`: `<init|diff|sync> [--root <dir>] [--preset <name>] [--preset-dir <dir>]`; `--root` and `--preset-dir` resolve against `cwd`; `--root` defaults to `cwd`. Missing or unknown subcommand, unknown flag or a flag without a value → `exitCode: 1`, `result: { ok: false, errors: [{ reason: 'Usage: project <init|diff|sync> [--root <dir>] [--preset <name>] [--preset-dir <dir>]' }] }`.

`result` = `report` plus `written` (`[]` for `diff` and for any `ok: false`).
Exit code: `ok: false` → 1. `diff`: `changes > 0 || conflicts > 0` → 2, else 0. `init` / `sync`: apply, then `conflicts > 0` → 2, else 0.

## Wiring in `get-shit-done/bin/gsd-tools.js` (exactly two insertions)

1. Directly after the line `const projectProfile = require('./project-profile.js');` add `const projectDeploy = require('./project-deploy.js');`
2. Directly before the line `    case 'prompt-optimize': {` add:

```js
    case 'project': {
      const r = projectDeploy.runCli(cwd, args.slice(1), process.env);
      writeStdoutSync(JSON.stringify(r.result, null, 2) + '\n');
      process.exit(r.exitCode);
      break;
    }

```

## Test fixture (local helpers at the top of `project-deploy.test.js`)

- `makeProject(config)` → tmp root with `CONFIG` = `config` or `{ project: { slug: 'demo' }, stack: { paths: { backend: 'srv' }, capabilities: {} } }`.
- `makePreset()` → tmp preset dir, `preset.json` `{ name: 'demo', version: '1', files: [...], settings_fragment: 'settings.fragment.json' }` with:
  - `rules/style.md` → `.claude/rules/style.md`, whole: `'# Style\n\nBackend lives in {{stack.paths.backend}}.\nline three\nline four\nline five\n'`
  - `hooks/guard.js` → `.claude/hooks/guard.js`, whole, mode `0o755`: `'// guard\nprocess.exit(0);\n'`
  - `CLAUDE.md` → `CLAUDE.md`, block: `'# Project\n\n<!-- gsd:begin core -->\nRun tests in {{stack.paths.backend}}.\n<!-- gsd:end core -->\n'`
  - fragment: `{ permissions: { allow: ['Bash(ls:*)', 'Read({{stack.paths.backend}}/**)'], deny: ['Read(./private/**)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }] } }`
- `snapshot(root)` → sorted `[relPath, sha256]` pairs of every file under `root`, dotfiles included.
- `seedDeployed(root, presetDir)` (plan tests only): writes each rendered file to its dest, each base copy, `SETTINGS` from `mergeSettings(null, null, rendered.settings)`, and a hand-built manifest per the Manifest section. The apply tests use a real `init` instead.

</spec>

<tasks>

<task type="auto">
  <name>Task 1: project-deploy.js planDeploy (read-only plan, scan, containment, refusal)</name>
  <files>get-shit-done/bin/project-deploy.js</files>
  <action>
Create the module with `planDeploy` per `<spec>` steps 1-12 (target ≤ 230 lines; `runCli` comes in Task 3). Export `{ planDeploy, CONFIG, MANIFEST, BASE_DIR, SETTINGS }`. It requires `./project-deploy-scan.js`, `./project-deploy-render.js`, `./project-deploy-files.js`, `./project-deploy-settings.js` and nothing from Phase A. It performs no write of any kind (the only temp files are those `gitMergeFile` creates and removes under `os.tmpdir()`).

Commit: `feat(agnostic-B): deploy planner (manifest, three-way, blocks, settings, scan, refusal)`.
  </action>
  <verify>
`node -e "const d=require('./get-shit-done/bin/project-deploy.js');const r=d.planDeploy({root:require('os').tmpdir(),command:'diff',env:{}});console.log(r.report.ok, r.report.errors[0].reason)"` prints `false missing .planning/config.json`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>`planDeploy` exists and is read-only; lint at baseline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: planDeploy tests (tmp projects, read-only proof)</name>
  <files>get-shit-done/bin/project-deploy.test.js, package.json</files>
  <behavior>
All ADD (`git grep -n "project-deploy.js" -- '*.test.js'` is empty). Tier T1. Layer integration on tmp dirs with the fixture helpers of `<spec>`. Every test ends with `assert.deepStrictEqual(snapshot(root), before)` (planDeploy never writes). `env` is always passed explicitly.

P1. Fresh project, `init`, `env: {}` → three files `create`, settings `create`, `changes === 4`, `conflicts === 0`, `guarded_changes` deep-equals `['.claude/hooks/guard.js', '.claude/settings.json']`, `refused === null`, `ok === true`.
P2. Errors, one case each, `ok: false`: no `CONFIG`; `CONFIG` holding `{`; no `presetDir`, no `presetName`, no `stack.preset`; `presetName: '../x'` (`invalid preset name`); `presetName: 'nope'` with `presetsRoot` a tmp dir. Positive: `presetName: 'demo'` with `presetsRoot` = parent of a preset dir named `demo` → `ok: true`; the same through `config.stack.preset = 'demo'`.
P3. `init` on a seeded project → `already initialised`; `sync` on a fresh project → `not initialised`; `diff` → `ok: true` in both.
P4. Config without `stack.paths.backend` → `ok: false`, an error whose reason is `missing config key: stack.paths.backend`.
P5. Secret scan: (a) a preset file containing a runtime-built token → `ok: false`, `secret_hits` deep-equals `[{ file: <dest>, pattern: 'vcs_token', line: <n> }]`, `JSON.stringify(report)` does not include the token; (b) the token as the value of `stack.paths.backend` in `CONFIG`, clean preset → hits for the rendered files that use the placeholder and for `'settings fragment'`.
P6. Refusal matrix (`H` = the preset's `hooks/guard.js` content changed after seeding; `R` = only `rules/style.md` changed):

| case | state | command | `env.CLAUDECODE` | expected |
|---|---|---|---|---|
| a | fresh, no `SETTINGS` | init | `'1'` | `refused === null`, `ok` |
| b | fresh but `SETTINGS` = `{}` exists | init | `'1'` | `refused.paths` = guarded changes, `ok: false` |
| c | seeded + H | sync | `'1'` | refused, paths `['.claude/hooks/guard.js']` |
| d | seeded + R | sync | `'1'` | not refused, `guarded_changes` `[]`, `ok` |
| e | seeded + H | sync | absent, and `''` | not refused |
| f | seeded + H | diff | `'1'` | `refused === null`, `guarded_changes` lists the hook |

P7. Symlink escape: `.claude/rules` in the project is a symlink to another tmp dir → `ok: false`, error `{ file: '.claude/rules/style.md', reason: 'destination escapes project root' }`; the outside dir stays empty.
P8. Orphan: seeded, then the rules entry removed from `preset.json` → the file is reported with `action: 'orphan'`, `ops.manifest.files` still has its entry.
P9. `SETTINGS` on disk holding `{` → `ok: false`, error with `file: '.claude/settings.json'`.
P10. Seeded, preset unchanged → every action `unchanged`, `changes === 0`, `ops.manifest` deep-equals the manifest on disk.
P11. Seeded states for `rules/style.md`: preset changes `line five` → `overwrite`; project changes `# Style` and preset changes `line five` → `merge`; both change `line four` differently → `conflict`, `conflicts === 1`, no `ops.files` entry for it, `ops.manifest.files` keeps the seeded `sha256`.
  </behavior>
  <action>
Write the test file with the fixture helpers and P1-P11. In `package.json` `scripts.test` insert ` get-shit-done/bin/project-deploy.test.js` immediately after `get-shit-done/bin/project-deploy-settings.test.js`.

Mutation proof (edit `project-deploy.js`, run the file, confirm, revert; record in SUMMARY):
- M1: step 5 removed → P5 fails.
- M2: step 5 scans the preset source bytes instead of the rendered content → P5b fails.
- M3: refusal exception keyed on "no manifest" instead of "no settings file" → P6b fails.
- M4: refusal fires whenever `CLAUDECODE` is set, regardless of `guarded_changes` → P6a or P6d fails.
- M5: refusal ignores `env` (never refuses) → P6b, P6c fail.
- M6: step 6 removed → P7 fails.
- M7: `diff` rejects a project without a manifest → P3 fails.
- M8: a conflicted file gets a new manifest entry → P11 fails.
- M9: preset name regex removed → P2 fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy.js` is empty.
Commit: `test(agnostic-B): deploy planner tests (9 mutants killed), wired into npm test`.
  </action>
  <verify>
Single-file run `# fail 0`, P1-P11 present by name.
`git grep -c "get-shit-done/bin/project-deploy.test.js" -- package.json` → `package.json:1`.
  </verify>
  <done>11 behaviours, 9 mutants killed and reverted.</done>
</task>

<task type="auto">
  <name>Task 3: applyPlan, runCli and the `project` dispatch</name>
  <files>get-shit-done/bin/project-deploy-apply.js, get-shit-done/bin/project-deploy.js, get-shit-done/bin/gsd-tools.js</files>
  <action>
1. Create `get-shit-done/bin/project-deploy-apply.js` per `<spec>` (target ≤ 90 lines). Exports `{ applyPlan, ensureGitignore, writeAtomic }`.
2. Add `runCli` to `project-deploy.js` per `<spec>` and export it. `planDeploy` stays unchanged.
3. Make the two insertions in `gsd-tools.js` (check `git status --short -- get-shit-done/bin/gsd-tools.js` is empty first).

Commit: `feat(agnostic-B): project init|diff|sync (apply, CLI, gsd-tools dispatch)`.
  </action>
  <verify>
`NODE_PATH=$HOME/get-shit-done/node_modules node get-shit-done/bin/gsd-tools.js project; echo rc=$?` prints the usage JSON and `rc=1`.
`NODE_PATH=$HOME/get-shit-done/node_modules node --test get-shit-done/bin/project-deploy.test.js` → `# fail 0`.
`git show --stat HEAD -- get-shit-done/bin/gsd-tools.js` → 1 file, 7-8 insertions, 0 deletions.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>CLI wired at the two anchors; planner tests still green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: apply and CLI tests (the four deploy scenarios, atomicity, refusal)</name>
  <files>get-shit-done/bin/project-deploy.test.js</files>
  <behavior>
Append `describe('project init|diff|sync (agnostic-B)', ...)`. Tier T1. Layer integration: in-process `runCli(root, [...], env)` unless the row says CLI (`spawnSync(process.execPath, [gsdToolsPath, 'project', ...], { env })`). All projects and presets are tmp dirs. `run(cmd, env = {})` = `runCli(root, [cmd, '--preset-dir', presetDir], env)`.

A1. ADD. `init` on a fresh project → exit 0; each dest equals the rendered text (`srv` substituted); `guard.js` mode `0o755`; `SETTINGS` parses deep-equal to the rendered fragment; every `BASE_DIR/<dest>` is byte-equal to the rendered bytes; `MANIFEST` parses deep-equal to an object the test builds by hand (versions, sorted dests, `sha256` of rendered bytes, block hash, deployed settings) and has no other key; `.gitignore` has the three lines once each. Variant: a pre-existing `.gitignore` of `node_modules\n.mcp.json` (no trailing newline) keeps both lines, gains the two missing ones, and holds `.mcp.json` once.
A2. ADD. Idempotence: `sync` right after `init` → exit 0, `written` `[]`, snapshot identical; `diff` → exit 0, `changes === 0`.
A3. ADD. Unchanged → overwritten: preset `rules/style.md` changes `line five`; `sync` → dest byte-equals the new render; base and manifest `sha256` follow.
A4. ADD. Edited → merged: project changes `# Style` to `# House style`; preset changes `line five`; `sync` → exit 0, dest has both changes, no `<<<<<<<`; base byte-equals the NEW render; manifest `sha256` = hash of the new render; a second `sync` → `written` `[]`.
A5. ADD. Conflict → nothing written: project and preset change `line four` differently, and the preset also changes the `core` block of `CLAUDE.md`; `sync` → exit 2; report lists `.claude/rules/style.md` with `action: 'conflict'`; that file, its base copy and its manifest entry are byte-/deep-identical to before; `CLAUDE.md` has the new block text.
A6. ADD. Project-added allow rule survives: after `init`, `SETTINGS` gains allow `Bash(project:*)` and a `PostToolUse` handler `echo project`; the preset fragment drops `Bash(ls:*)` and adds `Bash(pwd:*)`; `sync` → allow contains `Bash(project:*)` and `Bash(pwd:*)`, not `Bash(ls:*)`; the project handler is present; the deny rule is present.
A7. ADD. Block: after `init`, project text is added above and below the markers in `CLAUDE.md`; the preset changes the block text; `sync` → both project texts intact, inner replaced.
A8. ADD. Abort atomicity. On an initialised project with a pending `rules/style.md` change, each cause in turn (fresh fixture per row): preset file gains a runtime-built token; `CONFIG` loses `stack.paths.backend`; pending hook change with `env.CLAUDECODE = '1'`; `SETTINGS` overwritten with `{`; `.claude/rules` replaced by a symlink to an outside dir → exit 1, `written` `[]`, snapshot identical to the one taken just before the call.
A9. ADD, CLI. Pending hook change: `project sync --root <root> --preset-dir <dir>` with `CLAUDECODE: '1'` → status 1, stdout JSON has `refused.paths` including the hook, snapshot identical; with `CLAUDECODE: ''` → status 0 and the hook file equals the new render. Fresh project, `project init ...` with `CLAUDECODE: '1'` → status 0, hook file and `SETTINGS` exist.
A10. ADD. Never-managed files: `.claude/settings.local.json`, `.mcp.json`, `.env` created before `init` with marker contents → byte-identical after `init` and a changed-preset `sync`.
A11. ADD, CLI. `project` and `project bogus` → status 1 with the usage reason. `project diff` on a fresh project → status 2, stdout parses, snapshot identical.
A12. ADD. Explicit env wins: with `process.env.CLAUDECODE = '1'` set inside the test (restored in `finally`), `runCli(root, ['sync', ...], {})` with a pending hook change → exit 0 and the hook is updated.
A13. ADD, CLI. `project diff --preset demo` (no such directory under the repo's presets root) → status 1; `--preset ../x` → status 1 with `invalid preset name`.
REUSE. `get-shit-done/bin/project-profile.test.js` CLI tests 10-13 (run in the full suite) are the regression for the neighbouring `profile` dispatch. 0 tests added.
  </behavior>
  <action>
Append the describe block; run the file.

Mutation proof (edit the named module, run the file, confirm, revert; record in SUMMARY):
- M1 (`project-deploy.js`): `runCli` calls `applyPlan` even when `report.ok` is false → A8 fails.
- M2 (`project-deploy.js`): a refused plan keeps its `ops` and is applied → A8, A9 fail.
- M3 (`project-deploy.js`): `runCli` uses `process.env` instead of its `env` argument → A12 fails.
- M4 (`project-deploy.js`): exit code 0 when `conflicts > 0` → A5 fails.
- M5 (`project-deploy-apply.js`): base copies not written → A1, A4 fail.
- M6 (`project-deploy-apply.js`): `writeAtomic` always rewrites and returns `true` (no identical-bytes skip) → A2 fails.
- M7 (`project-deploy-apply.js`): `ensureGitignore` always appends all three lines → A1 variant fails.
- M8 (`project-deploy.js`): step 8 passes `null` as `prev` to `mergeSettings` → A6 fails (dropped rule stays).
- M9 (`project-deploy-apply.js`): `writeAtomic` ignores `mode` → A1 fails.
- M10 (`project-deploy.js`): for a conflict, `ops.files` receives the current render → A5 fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy.js get-shit-done/bin/project-deploy-apply.js` is empty. Then the full suite once.
Commit: `test(agnostic-B): project init|diff|sync tests (10 mutants killed)`.
Then write and commit `.planning/agnostic/B/B-04-SUMMARY.md` (format of `.planning/agnostic/A/A-02-SUMMARY.md`), including the threat-model table with the test that proves each row.
  </action>
  <verify>
Single-file run `# fail 0`; P1-P11 and A1-A13 present by name.
Full suite rc=0, `# fail 0`. `node scripts/agnostic-lint.js check` exit 0.
`wc -l get-shit-done/bin/project-deploy*.js` → every non-test module ≤ 300 lines.
`git status --short` shows only `.audit/` (no stray temp or `.gsd-tmp-*` file in the repo).
  </verify>
  <done>13 behaviours added, 10 mutants killed and reverted, suite green, no module over 300 lines.</done>
</task>

</tasks>

<verification>
- The four phase scenarios are named tests: A3 (unchanged → overwritten), A4 (edited → merged), A5 (conflict → nothing written), A6 (project-added allow rule survives sync).
- `git diff <plan-start-sha> --stat -- get-shit-done/bin/gsd-tools.js`: insertions only, at the two anchors.
- Full suite rc 0, `# fail 0`; agnostic lint exit 0; `git log --oneline <plan-start-sha>..HEAD -- scripts/agnostic-lint/` empty.
- No test wrote outside `os.tmpdir()`: `git status --short` clean apart from `.audit/`; `ls get-shit-done/presets` fails (directory still absent).
</verification>

<success_criteria>
The must_haves truths hold, each backed by a named test and at least one killed mutant; every threat-model row except the stated residual has a passing proof test.
</success_criteria>

<output>
`.planning/agnostic/B/B-04-SUMMARY.md`: outcome, commits, tests by name, mutation table, threat-model proof table, deviations, Self-Check.
</output>
