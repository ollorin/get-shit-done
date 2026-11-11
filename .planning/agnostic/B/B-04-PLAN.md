---
phase: agnostic-B
plan: 04
type: execute
wave: 4
depends_on: ["B-01", "B-02", "B-03"]
files_modified:
  - get-shit-done/bin/project-deploy.js
  - get-shit-done/bin/project-deploy-session.js
  - get-shit-done/bin/project-deploy-apply.js
  - get-shit-done/bin/project-deploy.test.js
  - get-shit-done/bin/gsd-tools.js
  - package.json
autonomous: true
requirements: [AGN-B2, AGN-B3, AGN-B4, AGN-B5, AGN-B6, AGN-B7]
must_haves:
  truths:
    - "`gsd-tools project init|diff|sync` deploys a rendered preset into a project: unchanged file → overwritten; edited file → merged; conflicting file → not written, reported, exit 2; project-added allow rule and project text outside markers survive"
    - "Any abort decided by the plan (render error, secret-shaped string in rendered output, invalid settings.json, any written path outside the root, manifest of another preset, guardrail refusal) writes nothing: the project tree is byte-identical before and after. An I/O failure during apply stops at the failing path, leaves no temp file, does not write the manifest, and is reported with exit 1"
    - "`init` and `sync` change `.claude/hooks/**` (compared case-insensitively) or `.claude/settings.json` only when all four hold: the `CLAUDECODE` key is absent from the environment (present-but-empty refuses), stdin is a TTY, stdout is a TTY, no ancestor process is an agent CLI. Sole exception: `init` into a project that has no `.claude/settings.json`"
    - "A second `sync` with no preset change writes nothing; `diff` then reports zero changes"
  artifacts:
    - path: get-shit-done/bin/project-deploy.js
      provides: "planDeploy, runCli"
    - path: get-shit-done/bin/project-deploy-session.js
      provides: "detectSession, agentAncestor, guardFailures"
    - path: get-shit-done/bin/project-deploy-apply.js
      provides: "applyPlan, ensureGitignore, writeAtomic"
    - path: get-shit-done/bin/project-deploy.test.js
      provides: "plan tests P1-P12 and apply/CLI tests A1-A14, listed in package.json `test`"
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
    - from: "planDeploy step 12"
      to: "project-deploy-session.js guardFailures"
      via: "`env` and `session` (injected in tests, detected from the process otherwise)"
      pattern: "guardFailures"
e2e_flows: []
---

<objective>
Phase B engine + B7, design lines 203-234 of `/Users/ollorin/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md`: compose the B-01..B-03 modules into plan-then-write, add the manifest and merge base, the guardrail refusal, and the CLI. `project doctor` is Phase G. Hook canaries before commit are Phase F1 (no canaries exist in this repo yet).
</objective>

<threat_model>
The tool writes hooks and permissions, so it is itself a guardrail path (design risk R3).

| # | Threat | Control | Proof |
|---|---|---|---|
| T1 | An agent session runs `sync` to change hooks or permissions | four-gate refusal for guarded changes (`planDeploy` step 12, `guardFailures`): env key absent, stdin TTY, stdout TTY, no agent ancestor; any gate that cannot be evaluated counts as failed | P6, P12, A8, A9 |
| T2 | A preset writes outside the project, to a never-managed file, or replaces `.claude/settings.json` wholesale, including through a case variant (`.claude/Settings.json`) or a symlinked `.planning/.gsd-preset-base` | `validateDest` on the lowercased NFC form (B-02 test 5) + realpath containment of every path the apply step touches (step 6) | P7, A8, A10 |
| T3 | A preset sets keys such as `disableAllHooks` or `defaultMode` | fragment key allow-list (B-02 test 7) | B-02 test 7 |
| T4 | A preset removes a project's own deny rule or hook; an agent edits the manifest so a later sync removes one | set-merge removes only entries listed in the manifest (B-03 tests 3, 6, 8); the report lists every added and removed entry by value so the person running `sync` sees it; the removal itself needs the four gates | A6 |
| T5 | A secret reaches a committed file through a preset file or a config value | scan of rendered output before write (step 5) | P5, A8 |
| T6 | A failure half-applies a deployment | all reads, merges and checks happen in `planDeploy`; `applyPlan` runs only on `ok`; manifest written last; an I/O failure stops the apply, and the next `sync` converges (a file already holding the new render is `unchanged`, B-02 row b) | A8, A2, A14 |
| T7 | Conflict markers land in a hook script | a conflict produces no content (B-02 test 5 of the files suite); file, base and manifest entry stay | A5 |
| T8 | `--preset ../x` reads an arbitrary directory; a preset file is a symlink to a file outside the preset | name regex; `lstat` regular-file + realpath containment in `loadPreset` (B-02 test 5) | P2, B-02 test 5 |
| T9 | A manifest written for one preset is reused to sync another | step 4 name check | P3 |
| Residual | A process that is detached from the agent's process tree, has the env key removed and owns a pty on stdin and stdout passes all four gates | not closed, and no typed confirmation word is required (decision). Same limit as `/Users/ollorin/igaming-platform/scripts/hooks-apply.sh:4` ("This steers; a detached process still passes"). Direct text edits of those paths stay blocked by `isProtectedConfigPath`, `get-shit-done/bin/hooks/gsd-protect-managed-files.js:45-49` | none (stated limit) |
</threat_model>

<executor_rules>
- Work only in `/Users/ollorin/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `/Users/ollorin/igaming-platform`, `~/.claude`, `~/get-shit-done`, and never run `gsd-tools project init|sync` with `--root` pointing anywhere but a `mkdtempSync` directory. Tests create every project and preset under `os.tmpdir()` and remove them in `afterEach`.
- Do every check of deployed files inside the node tests. Do not type shell commands that name a `.claude/settings` file or a `.claude/hooks` path (a PreToolUse hook rejects such commands).
- The executor's own shell has `CLAUDECODE` set, no TTY, and an agent ancestor. Every in-process call passes an explicit `env` object AND an explicit `session` object (`HUMAN` or a variant, see fixture). Every `spawnSync` passes an explicit `env`: `{ ...process.env, CLAUDECODE: '1' }`, or the key removed (`const { CLAUDECODE: _drop, ...NO_KEY } = process.env`).
- Forbidden: `npm run install:gsd`, `node bin/install.js`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Do not edit or `require` Phase A files (`scripts/agnostic-lint*`, `get-shit-done/bin/project-profile*.js`, the A3 templates and reference). Before editing `get-shit-done/bin/gsd-tools.js` or `package.json` run `git status --short -- <file>`; if not empty, stop and report (another writer is active).
- `get-shit-done/bin/gsd-tools.js` is 16.4k lines: read ONLY 205-225 (requires) and 15168-15187 (dispatch neighbourhood); locate by the quoted anchors if lines moved. Do not read or edit `gsd-tools.test.js`.
- Read the B-01..B-03 modules by their `module.exports` line and the function you call, not whole plans: `project-deploy-scan.js`, `project-deploy-render.js`, `project-deploy-files.js`, `project-deploy-settings.js`.
- One test file: `NODE_PATH=$HOME/get-shit-done/node_modules node --test <file>`. Full suite once, in Task 5: `cd /Users/ollorin/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-B04.log 2>&1; echo rc=$?`, read the last 15 lines only. Success: rc=0, `# fail 0`, named tests present.
- Lint: `node scripts/agnostic-lint.js check` exits 0 without regenerating the baseline. No vendor, product or tool names in code or comments of non-test files beyond the identifiers this plan spells out. No token-shaped literal in any file (tests build them at runtime, as in `project-deploy-scan.test.js`).
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

## `project-deploy-session.js` (target ≤ 60 lines)

- `agentAncestor(psOutput, pid)` → boolean. `psOutput` is the text of `ps -axo pid=,ppid=,comm=`; each line parsed with `/^\s*(\d+)\s+(\d+)\s+(.*)$/`. Start at `pid`; at each hop take the text after the last `/` of the command and test it against `/^claude/i`; a match → `true`; then move to the parent; stop at pid ≤ 1 or a pid not in the table → `false`. Fail closed → `true` when: `psOutput` is not a string, no line parses, the starting `pid` is not in the table, or 64 hops pass without reaching the top.
- `detectSession(io)` → `{ stdin_tty, stdout_tty, agent_ancestor }`. `io` (optional) = `{ stdin, stdout, pid, psOutput }`, defaults `process.stdin`, `process.stdout`, `process.pid`, and for `psOutput` the stdout of `spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' })` when its `status === 0`, else `''` (so a platform without `ps` fails closed). `stdin_tty = io.stdin.isTTY === true`, same for stdout.
- `guardFailures(env, session)` → the failed gates, a subset of `['env', 'stdin_tty', 'stdout_tty', 'agent_ancestor']` in that order: `env` when `env.CLAUDECODE !== undefined` (any value, `''` included); `stdin_tty` when `session.stdin_tty !== true`; `stdout_tty` when `session.stdout_tty !== true`; `agent_ancestor` when `session.agent_ancestor !== false`.

## `planDeploy(opts)` → `{ report, ops }` (`project-deploy.js`); reads only, never writes

`opts`: `root` (absolute), `command` (`'init' | 'diff' | 'sync'`), `env` (object; `undefined` → `process.env`), `session` (`{ stdin_tty, stdout_tty, agent_ancestor }`; `undefined` → `detectSession()`, called only when step 12 has to decide), `presetDir` (optional absolute path), `presetName` (optional), `presetsRoot` (default `path.join(__dirname, '..', 'presets')`).

`report`: `{ command, ok, preset, errors, secret_hits, refused, files, settings, guarded_changes, changes, conflicts }`
- `preset`: `{ name, version }` or `null`; `errors`: `[{ file?, reason }]`; `secret_hits`: `[{ file, pattern, line }]`; `refused`: `null` or `{ reason, paths, failed }`
- `files`: `[{ path, kind, action, reason?, warnings? }]` in preset order, orphans last
- `settings`: `null` or `{ action: 'create' | 'update' | 'unchanged', added, removed }`, where `added` and `removed` are the by-value lists `mergeSettings` returns (`{ permissions: { allow, deny, ask }, hooks: [{ event, matcher, command }] }`), so the person running the command reads exactly which rules and hooks appear and disappear (the manifest that drives removals is a file an agent can edit)

`ops` (never serialised): `{ files: [{ dest, content, mode }], bases: [{ dest, content }], settingsText, manifest }`.

`contained(root, rel)`: resolve `fs.realpathSync` of the nearest existing ancestor of `path.join(root, rel)` (the path itself when it exists) and re-append the missing tail; `true` when the result equals or sits under `fs.realpathSync(root)`.

Steps. A step that records an error finishes its own loop, then `planDeploy` returns `ok: false` with empty `ops`:

1. `root` is not a directory → `root is not a directory`. Read `CONFIG`: absent → `missing .planning/config.json`; unparseable or not a plain object → `.planning/config.json is not valid JSON`.
2. Preset: `presetDir` if given; else name = `presetName` or `config.stack.preset`; none → `no preset: pass --preset or set stack.preset`; name not matching `^[a-z0-9][a-z0-9-]*$` → `invalid preset name`; dir = `path.join(presetsRoot, name)`.
3. `renderPreset(dir, config)`; not ok → its errors.
4. Manifest: `contained(root, MANIFEST)` false → `{ file: MANIFEST, reason: 'destination escapes project root' }` (checked before the read). Unparseable → `manifest is not valid JSON`. `init` with a manifest → `already initialised: run project sync`. `sync` without → `not initialised: run project init`. `diff` accepts both. A manifest whose `preset.name` differs from the rendered preset's `name` → `manifest preset is <manifest name>, not <preset name>` (`sync` and `diff`).
5. Secret scan: `scanText(file.content)` for every rendered file (`file` = its dest) and `scanText(JSON.stringify(rendered.settings, null, 2))` when a fragment exists (`file` = `'settings fragment'`). Any hit → `secret_hits` plus one error `secret-shaped string in rendered output`.
6. Containment of every path steps 7-8 read and `applyPlan` writes: each rendered `dest`; `BASE_DIR/<dest>` for each; `SETTINGS` when step 8 applies; `.gitignore` when `command === 'init'` (`MANIFEST` was checked in step 4). `contained` false → `{ file: <that relative path>, reason: 'destination escapes project root' }`. A symlinked `.planning`, `.planning/.gsd-preset-base` or `.claude` that leaves the root is caught here, before step 7 reads anything.
7. Files. `prev = manifest.files[dest]`. `current` = dest bytes or `null`.
   - `whole`: `planWholeFile({ current, base: <BASE_DIR/dest bytes or null>, manifestHash: prev && prev.kind === 'whole' ? prev.sha256 : null, next: content })`.
   - `block`: `planBlockFile({ current: <utf8 or null>, next: content.toString('utf8'), prevBlocks: prev && prev.blocks || null })`; action `error` → `{ file: dest, reason }` in `errors`.
   - `create | overwrite | merge | update` → `ops.files` gets `{ dest, content, mode }` (`mode` = the rendered `mode`).
   - every action except `conflict` → `ops.bases` gets `{ dest, content: <rendered bytes> }` and the new manifest entry `{ kind, sha256: sha256(rendered bytes), blocks? }`. `conflict` → the previous manifest entry is carried over (or none).
   - manifest entries whose dest the preset no longer has → carried over, reported as `{ path, kind, action: 'orphan' }`. Nothing is ever deleted.
8. Settings, when `rendered.settings !== null` or `manifest.settings` exists: `current` = parsed `SETTINGS` or `null` when absent; unparseable → `{ file: SETTINGS, reason: 'not valid JSON' }`; `mergeSettings(current, manifest.settings || null, rendered.settings)`; not ok → `{ file: SETTINGS, reason }`. Action: `create` (file absent and `changed`), `update` (`changed`), else `unchanged`. `report.settings = { action, added, removed }`. `ops.settingsText = serializeSettings(settings)` for create/update. New manifest `settings = deployed`. Otherwise `report.settings = null`.
9. `changes` = number of file actions in `create | overwrite | merge | update`, plus 1 for settings `create | update`. `conflicts` = number of `conflict`.
10. `guarded_changes` (sorted) = dests whose `destKey(dest)` (B-02: NFC-normalised, lowercased) starts with `.claude/hooks/` and whose action is in `create | overwrite | merge | update`, plus `SETTINGS` when its action is `create | update`. The original dest spelling is what is listed.
11. Any error so far → `ok: false`.
12. Refusal. Evaluated when `command !== 'diff'` and `guarded_changes.length > 0` and NOT (`command === 'init'` and `SETTINGS` does not exist). `failed = guardFailures(env, session)`; non-empty → `refused = { reason: 'guardrail paths change only from a terminal outside an agent session', paths: guarded_changes, failed }`, `ok: false`, empty `ops`.

## `project-deploy-apply.js`

- `writeAtomic(file, content, mode)` → `{ ok: true, wrote: boolean }` or `{ ok: false, reason }`. Whole body in one `try`: `mkdirSync(dirname, { recursive: true })`; if `file` is a regular file (`lstatSync`) with identical bytes → `{ ok: true, wrote: false }`; write `<file>.gsd-tmp-<pid>`, `chmodSync` it to the existing regular file's mode, else `mode` (default `0o644`), `renameSync` → `{ ok: true, wrote: true }`. `catch (e)`: remove the temp file if it exists (errors of that removal ignored), return `{ ok: false, reason: e.code || e.message }`.
- `ensureGitignore(root)` → same result shape as `writeAtomic`. Lines, in this order: `.claude/settings.local.json`, `.mcp.json`, `.env*`, `!.env.example`. A line counts as present when an existing line equals it after `trim()`. Append the missing ones in that order (adding a `\n` first when the file does not end with one), create the file when absent. When `.env*` is appended, `!.env.example` is appended after it even if an earlier line already holds it (a negation only works after the pattern it negates).
- `applyPlan(root, plan, command)` → `{ ok: true, written }` or `{ ok: false, written, failed: { path, reason } }`; `written` = relative paths actually written, in write order. Order: `ops.files`; `ops.bases` (under `BASE_DIR`); `SETTINGS` when `ops.settingsText`; `.gitignore` when `command === 'init'`; `MANIFEST` last. Stops at the first write whose result is not ok; nothing after it (in particular `MANIFEST`) is written. Called only when `report.ok`.

## `runCli(cwd, args, env, session)` → `{ exitCode, result }` (`project-deploy.js`)

`env` and `session` are passed through to `planDeploy` unchanged (`undefined` → its defaults).

`args`: `<init|diff|sync> [--root <dir>] [--preset <name>] [--preset-dir <dir>]`; `--root` and `--preset-dir` resolve against `cwd`; `--root` defaults to `cwd`. Missing or unknown subcommand, unknown flag or a flag without a value → `exitCode: 1`, `result: { ok: false, errors: [{ reason: 'Usage: project <init|diff|sync> [--root <dir>] [--preset <name>] [--preset-dir <dir>]' }] }`.

`result` = `report` plus `written` (`[]` for `diff` and for a plan with `ok: false`).
Exit code: `ok: false` → 1. `diff`: `changes > 0 || conflicts > 0` → 2, else 0. `init` / `sync`: apply; apply not ok → `result.ok = false`, `result.errors` gains `{ file: failed.path, reason: 'write failed: <reason>' }`, `written` = what was written, exit 1; else `conflicts > 0` → 2, else 0.

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

(No `session` argument: the real process is inspected.)

## Test fixture (local helpers at the top of `project-deploy.test.js`)

- `HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false })`.
- `makeProject(config)` → tmp root with `CONFIG` = `config` or `{ project: { slug: 'demo' }, stack: { paths: { backend: 'srv' }, capabilities: {} } }`.
- `makePreset()` → tmp preset dir, `preset.json` `{ name: 'demo', version: '1', files: [...], settings_fragment: 'settings.fragment.json' }` with:
  - `rules/style.md` → `.claude/rules/style.md`, whole: `'# Style\n\nBackend lives in {{stack.paths.backend}}.\nline three\nline four\nline five\n'`
  - `hooks/guard.js` → `.claude/hooks/guard.js`, whole, mode `0o755`: `'// guard\nprocess.exit(0);\n'`
  - `CLAUDE.md` → `CLAUDE.md`, block: `'# Project\n\n<!-- gsd:begin core -->\nRun tests in {{stack.paths.backend}}.\n<!-- gsd:end core -->\n'`
  - fragment: `{ permissions: { allow: ['Bash(ls:*)', 'Read({{stack.paths.backend}}/**)'], deny: ['Read(./private/**)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }] } }`
- `snapshot(root)` → sorted `[relPath, sha256]` pairs of every file under `root`, dotfiles included (symlinks listed by their link target, not followed).
- `seedDeployed(root, presetDir)` (plan tests only): writes each rendered file to its dest, each base copy, `SETTINGS` from `mergeSettings(null, null, rendered.settings)`, and a hand-built manifest per the Manifest section. The apply tests use a real `init` instead.

</spec>

<tasks>

<task type="auto">
  <name>Task 1: project-deploy-session.js and project-deploy.js planDeploy (read-only plan, scan, containment, refusal)</name>
  <files>get-shit-done/bin/project-deploy-session.js, get-shit-done/bin/project-deploy.js</files>
  <action>
1. Create `project-deploy-session.js` per `<spec>`. Exports `{ agentAncestor, detectSession, guardFailures }`.
2. Create `project-deploy.js` with `planDeploy` per `<spec>` steps 1-12 (target ≤ 240 lines; `runCli` comes in Task 4). Export `{ planDeploy, CONFIG, MANIFEST, BASE_DIR, SETTINGS }`. It requires `./project-deploy-scan.js`, `./project-deploy-render.js` (`renderPreset`, `destKey`), `./project-deploy-files.js`, `./project-deploy-settings.js`, `./project-deploy-session.js` and nothing from Phase A. It performs no write of any kind (the only temp files are those `gitMergeFile` creates and removes under `os.tmpdir()`).

Commit: `feat(agnostic-B): deploy planner (manifest, three-way, blocks, settings, scan, four-gate refusal)`.
  </action>
  <verify>
`node -e "const d=require('./get-shit-done/bin/project-deploy.js');const r=d.planDeploy({root:require('os').tmpdir(),command:'diff',env:{}});console.log(r.report.ok, r.report.errors[0].reason)"` prints `false missing .planning/config.json`.
`node -e "const s=require('./get-shit-done/bin/project-deploy-session.js');console.log(JSON.stringify(s.guardFailures({CLAUDECODE:''},{stdin_tty:true,stdout_tty:true,agent_ancestor:false})), s.agentAncestor('',1))"` prints `["env"] true`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>`planDeploy` exists and is read-only; the session module exists; lint at baseline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: planDeploy tests (tmp projects, read-only proof)</name>
  <files>get-shit-done/bin/project-deploy.test.js, package.json</files>
  <behavior>
All ADD (`git grep -n "project-deploy.js" -- '*.test.js'` is empty). Tier T1. Layer integration on tmp dirs with the fixture helpers of `<spec>`. Every test ends with `assert.deepStrictEqual(snapshot(root), before)` (planDeploy never writes). `env` and `session: HUMAN` are always passed explicitly. P6 and P12 are Task 3.

P1. Fresh project, `init`, `env: {}` → three files `create`, settings `create`, `changes === 4`, `conflicts === 0`, `guarded_changes` deep-equals `['.claude/hooks/guard.js', '.claude/settings.json']`, `refused === null`, `ok === true`; `report.settings.added.permissions.allow` deep-equals the two rendered allow strings.
P2. Errors, one case each, `ok: false`: no `CONFIG`; `CONFIG` holding `{`; no `presetDir`, no `presetName`, no `stack.preset`; `presetName: '../x'` (`invalid preset name`); `presetName: 'nope'` with `presetsRoot` a tmp dir. Positive: `presetName: 'demo'` with `presetsRoot` = parent of a preset dir named `demo` → `ok: true`; the same through `config.stack.preset = 'demo'`.
P3. `init` on a seeded project → `already initialised`; `sync` on a fresh project → `not initialised`; `diff` → `ok: true` in both. Seeded project (manifest preset `demo`) with a preset dir whose `preset.json` has `name: 'other'`: `sync` and `diff` → `ok: false`, reason `manifest preset is demo, not other`.
P4. Config without `stack.paths.backend` → `ok: false`, an error whose reason is `missing config key: stack.paths.backend`.
P5. Secret scan: (a) a preset file containing a runtime-built token → `ok: false`, `secret_hits` deep-equals `[{ file: <dest>, pattern: 'vcs_token', line: <n> }]`, `JSON.stringify(report)` does not include the token; (b) the token as the value of `stack.paths.backend` in `CONFIG`, clean preset → hits for the rendered files that use the placeholder and for `'settings fragment'`.
P7. Symlink escape, one case each, `ok: false` and the outside dir stays empty: (a) `.claude/rules` in the project is a symlink to another tmp dir → error `{ file: '.claude/rules/style.md', reason: 'destination escapes project root' }`; (b) `.planning/.gsd-preset-base` is a symlink to another tmp dir → an error with `file` starting `.planning/.gsd-preset-base/` and the same reason; (c) `.planning/gsd-project-manifest.json` is a symlink to a file in another tmp dir → error with `file: MANIFEST`.
P8. Orphan: seeded, then the rules entry removed from `preset.json` → the file is reported with `action: 'orphan'`, `ops.manifest.files` still has its entry.
P9. `SETTINGS` on disk holding `{` → `ok: false`, error with `file: '.claude/settings.json'`.
P10. Seeded, preset unchanged → every action `unchanged`, `changes === 0`, `ops.manifest` deep-equals the manifest on disk.
P11. Seeded states for `rules/style.md`: preset changes `line five` → `overwrite`; project changes `# Style` and preset changes `line five` → `merge`; both change `line four` differently → `conflict`, `conflicts === 1`, no `ops.files` entry for it, `ops.manifest.files` keeps the seeded `sha256`.
  </behavior>
  <action>
Write the test file with the fixture helpers and P1-P5, P7-P11. In `package.json` `scripts.test` insert ` get-shit-done/bin/project-deploy.test.js` immediately after `get-shit-done/bin/project-deploy-settings.test.js`.

Mutation proof (edit `project-deploy.js`, run the file, confirm, revert; record in SUMMARY):
- M1: step 5 removed → P5 fails.
- M2: step 5 scans the preset source bytes instead of the rendered content → P5b fails.
- M3: step 6 removed → P7a fails.
- M4: step 6 checks the rendered dests only (no `BASE_DIR/<dest>`) → P7b fails.
- M5: step 4 containment check of `MANIFEST` removed → P7c fails.
- M6: `diff` rejects a project without a manifest → P3 fails.
- M7: step 4 preset-name comparison removed → P3 fails.
- M8: a conflicted file gets a new manifest entry → P11 fails.
- M9: preset name regex removed → P2 fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy.js` is empty.
Commit: `test(agnostic-B): deploy planner tests (9 mutants killed), wired into npm test`.
  </action>
  <verify>
Single-file run `# fail 0`, P1-P5 and P7-P11 present by name.
`git grep -c "get-shit-done/bin/project-deploy.test.js" -- package.json` → `package.json:1`.
  </verify>
  <done>10 behaviours, 9 mutants killed and reverted.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: refusal gate tests (P6 matrix, P12 session detection)</name>
  <files>get-shit-done/bin/project-deploy.test.js</files>
  <behavior>
Append `describe('guardrail refusal (agnostic-B7)', ...)` to the file Task 2 created. Tier T1. Layer integration on tmp dirs (P6), unit (P12). Every P6 row ends with the snapshot equality. Existing behaviour in this file (P1-P11): REUSE as regression, 0 tests added for it.

P6. ADD. Refusal matrix. `H` = the preset's `hooks/guard.js` content changed after seeding; `R` = only `rules/style.md` changed; `X` = the preset gains `hooks/extra.js` → dest `.claude/Hooks/extra.js` (capital H). `session` is `HUMAN` unless the row says otherwise.

| case | state | command | `env` | `session` | expected |
|---|---|---|---|---|---|
| a | fresh, no `SETTINGS` | init | `{ CLAUDECODE: '1' }` | all three gates failing | `refused === null`, `ok` (first-time init exception) |
| b | fresh but `SETTINGS` = `{}` exists | init | `{ CLAUDECODE: '1' }` | HUMAN | `refused.paths` = guarded changes, `refused.failed` deep-equals `['env']`, `ok: false` |
| c | seeded + H | sync | `{ CLAUDECODE: '1' }` | HUMAN | refused, paths `['.claude/hooks/guard.js']` |
| d | seeded + R | sync | `{ CLAUDECODE: '1' }` | all three gates failing | not refused, `guarded_changes` `[]`, `ok` |
| e | seeded + H | sync | `{}` | HUMAN | not refused, `ok` (the only passing combination) |
| f | seeded + H | diff | `{ CLAUDECODE: '1' }` | all three gates failing | `refused === null`, `guarded_changes` lists the hook |
| g | seeded + H | sync | `{ CLAUDECODE: '' }` | HUMAN | refused, `failed` `['env']` (present-but-empty refuses) |
| h | seeded + H | sync | `{}` | `stdin_tty: false` | refused, `failed` `['stdin_tty']` |
| i | seeded + H | sync | `{}` | `stdout_tty: false` | refused, `failed` `['stdout_tty']` |
| j | seeded + H | sync | `{}` | `agent_ancestor: true` | refused, `failed` `['agent_ancestor']` |
| k | seeded + H | sync | omitted, with `process.env.CLAUDECODE = '1'` set in the test (restored in `finally`) | HUMAN | refused, `failed` `['env']` (omitted `env` is `process.env`) |
| l | seeded + H | sync | `{}` | omitted | refused, and `failed` includes `stdin_tty` or `agent_ancestor` (the test process is not an interactive terminal; assert `failed.length > 0`) |
| m | seeded + X | sync | `{ CLAUDECODE: '1' }` | HUMAN | refused, `paths` deep-equals `['.claude/Hooks/extra.js']` |

P12. ADD. Session detection, no real `ps`: `agentAncestor` on a hand-written table `300 → 200 → 1` where pid 200's command is `/usr/local/bin/claude` → `true`; same table with `/bin/zsh` → `false`; command `Claude Helper` under a path with spaces → `true`; `''`, `undefined`, a table that lacks the start pid, and a two-entry parent cycle → `true`. `detectSession({ stdin: { isTTY: true }, stdout: {}, pid: 300, psOutput: <zsh table> })` deep-equals `{ stdin_tty: true, stdout_tty: false, agent_ancestor: false }`. `guardFailures({}, HUMAN)` → `[]`; with all four failing → the four ids in the stated order.
  </behavior>
  <action>
Append the describe block; run the file.

Mutation proof (edit the named module, run the file, confirm, revert; record in SUMMARY):
- M1 (`project-deploy.js`): refusal exception keyed on "no manifest" instead of "no settings file" → P6b fails.
- M2 (`project-deploy.js`): refusal fires regardless of `guarded_changes` → P6a or P6d fails.
- M3 (`project-deploy.js`): step 12 never refuses → P6b, P6c fail.
- M4 (`project-deploy-session.js`): env gate is `Boolean(env.CLAUDECODE)` → P6g fails.
- M5 (`project-deploy-session.js`): stdin and stdout gates dropped → P6h, P6i fail.
- M6 (`project-deploy-session.js`): ancestor gate dropped → P6j fails.
- M7 (`project-deploy.js`): omitted `env` defaults to `{}` → P6k fails.
- M8 (`project-deploy.js`): omitted `session` defaults to `HUMAN`-like all-pass values → P6l fails.
- M9 (`project-deploy.js`): step 10 tests the raw `dest` → P6m fails.
- M10 (`project-deploy-session.js`): `agentAncestor` returns `false` for unparsable output → P12 fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy.js get-shit-done/bin/project-deploy-session.js` is empty.
Commit: `test(agnostic-B7): four-gate refusal tests (10 mutants killed)`.
  </action>
  <verify>
Single-file run `# fail 0`; P1-P12 present by name.
  </verify>
  <done>2 behaviours (13 matrix rows), 10 mutants killed and reverted.</done>
</task>

<task type="auto">
  <name>Task 4: applyPlan, runCli and the `project` dispatch</name>
  <files>get-shit-done/bin/project-deploy-apply.js, get-shit-done/bin/project-deploy.js, get-shit-done/bin/gsd-tools.js</files>
  <action>
1. Create `get-shit-done/bin/project-deploy-apply.js` per `<spec>` (target ≤ 100 lines). Exports `{ applyPlan, ensureGitignore, writeAtomic }`.
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
  <name>Task 5: apply and CLI tests (the four deploy scenarios, atomicity, refusal)</name>
  <files>get-shit-done/bin/project-deploy.test.js</files>
  <behavior>
Append `describe('project init|diff|sync (agnostic-B)', ...)`. Tier T1. Layer integration: in-process `runCli(root, [...], env, session)` unless the row says CLI (`spawnSync(process.execPath, [gsdToolsPath, 'project', ...], { env })`). All projects and presets are tmp dirs. `run(cmd, env = {}, session = HUMAN)` = `runCli(root, [cmd, '--preset-dir', presetDir], env, session)`.

A1. ADD. `init` on a fresh project → exit 0; each dest equals the rendered text (`srv` substituted); `guard.js` mode `0o755`; `SETTINGS` parses deep-equal to the rendered fragment; every `BASE_DIR/<dest>` is byte-equal to the rendered bytes; `MANIFEST` parses deep-equal to an object the test builds by hand (versions, sorted dests, `sha256` of rendered bytes, block hash, deployed settings) and has no other key; `.gitignore` has the four lines once each with `.env*` before `!.env.example`. Variant: a pre-existing `.gitignore` of `node_modules\n!.env.example\n.mcp.json` (no trailing newline) keeps its three lines, gains `.claude/settings.local.json`, `.env*` and a `!.env.example` after `.env*`, and holds `.mcp.json` once.
A2. ADD. Idempotence: `sync` right after `init` → exit 0, `written` `[]`, snapshot identical; `diff` → exit 0, `changes === 0`.
A3. ADD. Unchanged → overwritten: preset `rules/style.md` changes `line five`; `sync` → dest byte-equals the new render; base and manifest `sha256` follow.
A4. ADD. Edited → merged: project changes `# Style` to `# House style`; preset changes `line five`; `sync` → exit 0, dest has both changes, no `<<<<<<<`; base byte-equals the NEW render; manifest `sha256` = hash of the new render; a second `sync` → `written` `[]`.
A5. ADD. Conflict → nothing written: project and preset change `line four` differently, and the preset also changes the `core` block of `CLAUDE.md`; `sync` → exit 2; report lists `.claude/rules/style.md` with `action: 'conflict'`; that file, its base copy and its manifest entry are byte-/deep-identical to before; `CLAUDE.md` has the new block text.
A6. ADD. Project-added allow rule survives: after `init`, `SETTINGS` gains allow `Bash(project:*)` and a `PostToolUse` handler `echo project`; the preset fragment drops `Bash(ls:*)` and adds `Bash(pwd:*)`; `sync` → allow contains `Bash(project:*)` and `Bash(pwd:*)`, not `Bash(ls:*)`; the project handler is present; the deny rule is present. The result's `settings` deep-equals `{ action: 'update', added: { permissions: { allow: ['Bash(pwd:*)'], deny: [], ask: [] }, hooks: [] }, removed: { permissions: { allow: ['Bash(ls:*)'], deny: [], ask: [] }, hooks: [] } }`. Second part: the manifest's `settings.permissions.deny` is then edited by the test to also list a project-added deny rule and the fragment is left alone; `diff` → `settings.removed.permissions.deny` names that rule by value (the removal is visible before it happens).
A7. ADD. Block: after `init`, project text is added above and below the markers in `CLAUDE.md`; the preset changes the block text; `sync` → both project texts intact, inner replaced.
A8. ADD. Abort atomicity. On an initialised project with a pending `rules/style.md` change, each cause in turn (fresh fixture per row): preset file gains a runtime-built token; `CONFIG` loses `stack.paths.backend`; pending hook change with `env.CLAUDECODE = '1'`; pending hook change with `env = {}` and `session.stdin_tty = false`; `SETTINGS` overwritten with `{`; `.claude/rules` replaced by a symlink to an outside dir; `.planning/.gsd-preset-base` moved aside and replaced by a symlink to an outside dir → exit 1, `written` `[]`, snapshot identical to the one taken just before the call, and (symlink rows) the outside dir holds exactly what it held before.
A9. ADD, CLI. Pending hook change: `project sync --root <root> --preset-dir <dir>` with `CLAUDECODE: '1'` → status 1, stdout JSON `refused.paths` includes the hook and `refused.failed` includes `env`, snapshot identical. Same command with the key removed from the child env (`NO_KEY`) → status 1, `refused.failed` includes `stdout_tty` (the child's stdout is a pipe: the unconfigured CLI fails closed), snapshot identical. Fresh project, `project init ...` with `CLAUDECODE: '1'` → status 0, hook file and `SETTINGS` exist. In-process: `run('sync', {}, HUMAN)` on the pending hook change → exit 0 and the hook file equals the new render.
A10. ADD. Never-managed files: `.claude/settings.local.json`, `.mcp.json`, `.env` created before `init` with marker contents → byte-identical after `init` and a changed-preset `sync`.
A11. ADD, CLI. `project` and `project bogus` → status 1 with the usage reason. `project diff` on a fresh project → status 2, stdout parses, snapshot identical.
A12. ADD. Explicit env wins: with `process.env.CLAUDECODE = '1'` set inside the test (restored in `finally`), `runCli(root, ['sync', ...], {}, HUMAN)` with a pending hook change → exit 0 and the hook is updated.
A13. ADD, CLI. `project diff --preset demo` (no such directory under the repo's presets root) → status 1; `--preset ../x` → status 1 with `invalid preset name`.
A14. ADD. Mid-apply failure: `writeAtomic(<path of an existing non-empty directory>, Buffer.from('x'))` → `{ ok: false, reason: <non-empty string> }`, no throw, and the parent directory lists no `.gsd-tmp-` entry. `applyPlan(root, { ops: { files: [<good file>, <file whose dest is that directory>], bases: [], settingsText: null, manifest: {...} } }, 'sync')` → `ok: false`, `written` deep-equals `[<good dest>]`, `failed.path` is the second dest, `MANIFEST` does not exist, no `.gsd-tmp-` file anywhere under `root`.
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
- M6 (`project-deploy-apply.js`): `writeAtomic` always rewrites and reports `wrote: true` (no identical-bytes skip) → A2 fails.
- M7 (`project-deploy-apply.js`): `ensureGitignore` always appends all four lines → A1 variant fails.
- M8 (`project-deploy.js`): step 8 passes `null` as `prev` to `mergeSettings` → A6 fails (dropped rule stays).
- M9 (`project-deploy-apply.js`): `writeAtomic` ignores `mode` → A1 fails.
- M10 (`project-deploy.js`): for a conflict, `ops.files` receives the current render → A5 fails.
- M11 (`project-deploy.js`): `report.settings` carries `added` only (no `removed`) → A6 fails.
- M12 (`project-deploy-apply.js`): the `catch` in `writeAtomic` does not remove the temp file → A14 fails.
- M13 (`project-deploy-apply.js`): `applyPlan` ignores a failed write and goes on to `MANIFEST` → A14 fails.
- M14 (`project-deploy-apply.js`): `ensureGitignore` does not re-append `!.env.example` after a newly appended `.env*` → A1 variant fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy.js get-shit-done/bin/project-deploy-apply.js` is empty. Then the full suite once.
Commit: `test(agnostic-B): project init|diff|sync tests (14 mutants killed)`.
Then write and commit `.planning/agnostic/B/B-04-SUMMARY.md` (format of `.planning/agnostic/A/A-02-SUMMARY.md`), including the threat-model table with the test that proves each row.
  </action>
  <verify>
Single-file run `# fail 0`; P1-P12 and A1-A14 present by name.
Full suite rc=0, `# fail 0`. `node scripts/agnostic-lint.js check` exit 0.
`wc -l get-shit-done/bin/project-deploy*.js` → every non-test module ≤ 300 lines; `project-deploy.test.js` ≤ 1,500 lines.
`git status --short` shows only `.audit/` (no stray temp or `.gsd-tmp-*` file in the repo).
  </verify>
  <done>14 behaviours added, 14 mutants killed and reverted, suite green, no module over 300 lines.</done>
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
