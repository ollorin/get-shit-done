---
phase: agnostic-B
plan: 02
type: execute
wave: 2
depends_on: ["B-01"]
files_modified:
  - get-shit-done/bin/project-deploy-render.js
  - get-shit-done/bin/project-deploy-render.test.js
  - get-shit-done/bin/project-deploy-files.js
  - get-shit-done/bin/project-deploy-files.test.js
  - package.json
autonomous: true
requirements: [AGN-B2, AGN-B3]
must_haves:
  truths:
    - "A preset renders with `{{dot.path}}` substitution from the project's config object only; a missing or non-scalar key is an error, never an empty string or a default; there are no conditionals"
    - "A preset cannot name a destination outside the project, a never-managed file (`.claude/settings.local.json`, `.mcp.json`, `.env*` other than `.env.example`), or `.claude/settings.json` as a whole file; the rules compare the lowercased NFC form, so a case variant on a case-insensitive volume is rejected too"
    - "A preset source or settings fragment that is a symlink, or that resolves outside the preset directory, is an error and is never read"
    - "Whole-file decision: on-disk hash equals manifest hash → overwrite; edited → `git merge-file` result; conflict or unmanaged existing file → no content is produced"
  artifacts:
    - path: get-shit-done/bin/project-deploy-render.js
      provides: "renderText, destKey, validateDest, loadPreset, renderPreset"
    - path: get-shit-done/bin/project-deploy-files.js
      provides: "sha256, gitMergeFile, planWholeFile"
    - path: get-shit-done/bin/project-deploy-render.test.js
      provides: "render and preset validation tests"
    - path: get-shit-done/bin/project-deploy-files.test.js
      provides: "whole-file three-way tests (real `git merge-file` in tmp dirs)"
  key_links:
    - from: get-shit-done/bin/project-deploy-files.js
      to: "git merge-file -p <current> <base> <next>"
      via: "spawnSync in a private temp dir; exit 0 = clean, 1..127 = conflict"
      pattern: "merge-file"
e2e_flows: []
---

<objective>
Phase B2 (render) + B3 (whole-file three-way), design lines 203-227 of `~/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md`. Two pure-ish modules; nothing calls them until B-04. The manifest file itself is written by the engine in B-04; this plan fixes the data it needs (`sha256` of rendered content, rendered bytes as merge base).

Scope: a preset here is one flat directory. Preset composition (`extends`, `packs`, for example a shared base plus `packs/charlotte`) is owned by Phase F (factor base); this loader rejects both keys until then. Phase C's igaming preset is a flat verbatim snapshot: every file entry carries `render: false`.
</objective>

<executor_rules>
- Work only in `~/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `~/igaming-platform`, `~/.claude`, `~/get-shit-done`. Tests create every file under `fs.mkdtempSync(path.join(os.tmpdir(), ...))` and remove it in `afterEach`.
- Forbidden: `npm run install:gsd`, `node bin/install.js`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Do not edit or `require` Phase A files (`scripts/agnostic-lint*`, `get-shit-done/bin/project-profile*.js`, the A3 templates and reference). Before editing `package.json` run `git status --short -- package.json`; if not empty, stop and report.
- One test file: `NODE_PATH=$HOME/get-shit-done/node_modules node --test <file>`. Full suite once, in Task 4: `cd ~/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-B02.log 2>&1; echo rc=$?`, read the last 15 lines only. Success: rc=0, `# fail 0`, named tests present.
- Lint: `node scripts/agnostic-lint.js check` exits 0 without regenerating the baseline. Non-test files in `get-shit-done/bin/` are in scope: no vendor, product or tool names in code or comments.
- No token-shaped literal in any file.
- CommonJS, `'use strict'`, node built-ins only, result objects instead of `throw` across a module boundary, `const` only, inputs never mutated, comments only for a non-obvious constraint. Each module ≤ 300 lines.
- Commit per task: `git add -f <paths>` then `git commit -m "<msg>" -- <paths>`; check with `git show --stat HEAD -- <paths>`; ignore untracked `.audit/`. Trailers on every commit:
  `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
</executor_rules>

<spec>

## Preset directory

```
<presetDir>/preset.json
<presetDir>/<src files...>
<presetDir>/settings.fragment.json      (optional, named by preset.json)
```

`preset.json`:

```json
{ "name": "demo", "version": "1", "description": "optional",
  "files": [ { "src": "rules/style.md", "dest": ".claude/rules/style.md",
               "kind": "whole", "render": true, "capability": "ui_qa" } ],
  "settings_fragment": "settings.fragment.json" }
```

| field | rule |
|---|---|
| top-level keys | only `name`, `version`, `description`, `files`, `settings_fragment`. `extends` or `packs` → error `unsupported preset key: <key>`; any other key → error `unknown preset key: <key>` |
| `name` | string matching `^[a-z0-9][a-z0-9-]*$` |
| `version` | non-empty string |
| `files` | array (may be empty) |
| `files[].src` | relative path with `/` separators, no empty, `.` or `..` segment, not absolute. On disk (`p = path.join(presetDir, src)`): `fs.lstatSync(p).isFile()` must hold, so a symlink, even one pointing at a file inside the preset, → `not a regular file: <src>`; and `fs.realpathSync(p)` must start with `fs.realpathSync(presetDir) + path.sep`, so a file reached through a symlinked directory → `escapes preset directory: <src>` |
| `files[].dest` | `validateDest(dest)` returns `null`; no two entries share a `destKey(dest)` (`a/X.md` and `a/x.md` collide) |
| `files[].kind` | `"whole"` (default) or `"block"` |
| `files[].render` | boolean, default `true`. `false` = bytes copied untouched |
| `files[].capability` | optional non-empty string. The file is included only when `config.stack.capabilities[capability]` is an object |
| `settings_fragment` | optional; same path and on-disk rules as `src` |

`preset.json` itself must be a regular file by `lstat`. `renderPreset` reads only paths that `loadPreset` validated in the same call.

## `destKey(dest)` and `validateDest(dest)` → `null` or a reason string

`destKey(dest)` = `dest.normalize('NFC').toLowerCase()` (exported; B-04 step 10 uses it for the guarded-path test). Every equality, prefix, basename and first-segment rule below is evaluated on the key, never on the raw string: a case-insensitive volume maps `.claude/Settings.json` onto the real settings file.

Reject: non-string or empty; contains `\`; absolute (starts with `/` or matches `^[A-Za-z]:`); any segment empty, `.` or `..`; key equals `.claude/settings.json` (reason `set-managed: use the settings fragment`); never-managed: key equals `.claude/settings.local.json`, key equals `.mcp.json`, or the key's basename starts with `.env` and is not exactly `.env.example`; key equals `.planning/config.json` or `.planning/gsd-project-manifest.json`; key starts with `.planning/.gsd-preset-base/`; the key's first segment is `.git`.

A dest under `.claude/hooks/` in any case (`.claude/Hooks/x.js`) is allowed here; B-04 step 10 treats it as a guarded path.

## `renderText(text, config)` → `{ text, missing: string[], invalid: string[] }`

- Placeholder regex: `/\{\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\}\}/g` (at least one dot, no spaces). Anything else, including `{{ spaced.key }}`, `${{ secrets.X }}`, `{{single}}`, `{{#if a.b}}`, stays literal.
- Lookup walks own enumerable keys only (`Object.prototype.hasOwnProperty.call`) through plain objects.
- Found string, finite number or boolean → `String(value)`. Absent → key in `missing`, placeholder left in `text`. Present but `null`, array or object → key in `invalid`. `missing` and `invalid` are de-duplicated and sorted.

## `loadPreset(presetDir)` → `{ ok, errors: string[], preset }`

Reads and validates `preset.json` per the table, including the `lstat` and realpath rules. `preset` = `{ name, version, files: [{ src, dest, kind, render, capability }], settings_fragment }` with defaults applied. Missing dir or file, or invalid JSON → `ok: false` with one error. All violations are collected, not just the first.

## `renderPreset(presetDir, config)` → `{ ok, errors: [{ file, reason }], name, version, files, settings }`

- `loadPreset` errors → `ok: false`, each as `{ file: 'preset.json', reason }`; no source file is read in that case.
- `files`: for each included entry, in `preset.json` order: `{ dest, kind, content: Buffer, mode }`. `mode` = `fs.statSync(src).mode & 0o777`. `render: false` → `content` is the raw Buffer. `render: true` → file read as `utf8`, `renderText`; each missing key → `{ file: src, reason: 'missing config key: <key>' }`, each invalid → `{ file: src, reason: 'config key is not a scalar: <key>' }`.
- `settings`: `null` when there is no fragment. Otherwise `JSON.parse` the fragment FIRST, validate the shape, then apply `renderText` to every string leaf (so a config value containing `"` cannot break the JSON). Shape: top-level keys ⊆ `permissions`, `hooks`; `permissions` keys ⊆ `allow`, `deny`, `ask`, each an array of non-empty strings; `hooks` is an object `event → [ { matcher?: string, hooks: [ { type: 'command', command: <non-empty string>, timeout?: <number> } ] } ]`. Violations → `{ file: <fragment>, reason }` (unknown top-level key: `unsupported settings fragment key: <key>`). Missing/invalid keys in leaves → same reasons as for files.
- `ok` = `errors.length === 0`. `config` is the parsed `.planning/config.json` object (any top-level block may be referenced).

## `project-deploy-files.js`

- `sha256(buf)` → hex.
- `gitMergeFile(current, base, next, opts)` → `{ ok: true, content: Buffer }` or `{ ok: false, reason }`. `opts.tmpRoot` (default `os.tmpdir()`), `opts.gitBin` (default `'git'`). Creates `fs.mkdtempSync(path.join(tmpRoot, 'gsd-merge-'))`, writes `current`, `base`, `next` there, runs `spawnSync(gitBin, ['merge-file', '-p', currentPath, basePath, nextPath])` (no `encoding`, so stdout is a Buffer). `status === 0` → ok with stdout. `status` 1-127 → `reason: 'merge conflict'`. Anything else (spawn error, `null`, ≥128) → `reason: 'git merge-file failed'`. The temp dir is removed in a `finally` in every case. The project file is never passed to git.
- `planWholeFile({ current, base, manifestHash, next, mergeFn })` → `{ action, content?, reason? }`. `current`/`base` are Buffers or `null`, `manifestHash` string or `null`, `mergeFn` defaults to `gitMergeFile`. First matching row wins:

| # | condition | result |
|---|---|---|
| a | `current === null` | `{ action: 'create', content: next }` |
| b | `current.equals(next)` | `{ action: 'unchanged' }` |
| c | `manifestHash` and `sha256(current) === manifestHash` | `{ action: 'overwrite', content: next }` |
| d | `manifestHash` and `base` | `r = mergeFn(current, base, next)`; ok and `r.content.equals(current)` → `{ action: 'unchanged' }`; ok → `{ action: 'merge', content: r.content }`; else `{ action: 'conflict', reason: r.reason }` |
| e | `manifestHash` and no `base` | `{ action: 'conflict', reason: 'merge base missing' }` |
| f | otherwise | `{ action: 'conflict', reason: 'exists and is not managed' }` |

A `conflict` result has no `content` key.

</spec>

<tasks>

<task type="auto">
  <name>Task 1: project-deploy-render.js</name>
  <files>get-shit-done/bin/project-deploy-render.js</files>
  <action>
Create the module per `<spec>` (target ≤ 240 lines). Exports `{ PLACEHOLDER_RE, renderText, destKey, validateDest, loadPreset, renderPreset }`. It reads only inside `presetDir`; it never reads the project and never writes.

Commit: `feat(agnostic-B2): preset loader and {{dot.path}} renderer`.
  </action>
  <verify>
`node -e "const r=require('./get-shit-done/bin/project-deploy-render.js');console.log(JSON.stringify(r.renderText('a {{x.y}} {{x.z}}',{x:{y:1}})), r.validateDest('.MCP.json')!==null, r.validateDest('.claude/rules/a.md'), r.validateDest('.env.example'))"` prints `{"text":"a 1 {{x.z}}","missing":["x.z"],"invalid":[]} true null null`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>Module exists, smoke output as stated, lint at baseline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: render and preset validation tests</name>
  <files>get-shit-done/bin/project-deploy-render.test.js, package.json</files>
  <behavior>
All ADD (`git grep -n project-deploy-render -- '*.test.js'` is empty). Layer unit; preset fixtures are built in tmp dirs by a local `makePreset(files, presetJson)` helper. Tier T1 for 5, 7 (guardrail), T2 otherwise.

1. `renderText`: two different placeholders, a repeated one, a number and a boolean value → substituted text, `missing: []`, `invalid: []`.
2. Absent key → in `missing`, placeholder still in `text`; array, object and `null` values → in `invalid`; `{{__proto__.polluted}}` and `{{constructor.name}}` → in `missing`.
3. Literal forms untouched and reported nowhere: `{{ spaced.key }}`, `${{ secrets.X }}`, `{{single}}`, `{dot.path}`, `{{#if a.b}}x{{/if}}`.
4. `loadPreset` valid minimal (`name`, `version`, `files: []`) and full → `ok: true`, defaults `kind: 'whole'`, `render: true`.
5. `loadPreset` / `validateDest` rejections, table-driven, one case each, each → `ok: false` (or a non-null reason); two violations in one preset → both reported.
   - 5a shape: name `Bad Name`; missing `version`; `src` absent on disk; `src` `../x`; duplicate `dest`; `kind: 'partial'`; key `extends`; key `packs`; key `foo`.
   - 5b dest: `/abs/x`, `a/../b`, `a\\b`, `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `.env`, `sub/.env.local`, `.env.example.local`, `.planning/config.json`, `.planning/gsd-project-manifest.json`, `.planning/.gsd-preset-base/x`, `.git/hooks/x`.
   - 5c case and normalisation (rejected): `.claude/Settings.json`, `.claude/settings.LOCAL.json`, `.MCP.json`, `.ENV`, `sub/.Env.local`, `.GIT/hooks/x`, `.Planning/Config.json`; duplicate by case: `.claude/rules/A.md` + `.claude/rules/a.md` in one preset; duplicate by normalisation: `'café.md'` + `'café.md'` in one preset.
   - 5d allowed (`validateDest` → `null`): `.env.example`, `sub/.env.example`, `.claude/Hooks/x.js`, `.claude/rules/Style.md`.
   - 5e on disk (`fs.symlinkSync` in the tmp fixture): `src` is a symlink to a file outside the preset dir → `not a regular file: <src>`; `src` is a symlink to another file inside the preset dir → `not a regular file: <src>`; `src` `linkdir/x.md` where `linkdir` is a symlink to an outside directory holding `x.md` → `escapes preset directory: linkdir/x.md`; `settings_fragment` is a symlink to an outside JSON file → `not a regular file`. For each, `renderPreset` returns `ok: false` and the outside file's marker text appears nowhere in `JSON.stringify` of the result.
6. `renderPreset`: `render: true` file substituted; `render: false` file with `{{a.b}}` text and bytes `0xff 0xfe` → `content` byte-equal to the source; file with `capability: 'ui_qa'` absent when `config.stack.capabilities` lacks it and present when `stack.capabilities.ui_qa` is `{}`; a source with mode `0o755` → `mode === 0o755`; order follows `preset.json`.
7. Fragment: an allow string and a hook command with placeholders are rendered; a config value containing `"` and `\` renders into a permission string intact; fragment with top-level `env` or `disableAllHooks` → error `unsupported settings fragment key`; `permissions.allow` a string → error; hook entry without `command` → error; unparseable fragment → error; no fragment → `settings: null`.
8. A missing key in one file → `ok: false`, error `{ file: <src>, reason: 'missing config key: stack.none' }`.
9. `renderPreset` on a missing directory → `ok: false`, one error with `file: 'preset.json'`.
  </behavior>
  <action>
Write the test file. In `package.json` `scripts.test` insert ` get-shit-done/bin/project-deploy-render.test.js` immediately after `get-shit-done/bin/project-deploy-scan.test.js`.

Mutation proof (edit the module, run the file, confirm, revert; record in SUMMARY):
- M1: lookup uses `key in obj` → 2 fails.
- M2: an absent key renders as `''` and is not reported → 2, 8 fail.
- M3: `render: false` ignored → 6 fails.
- M4: drop `.claude/settings.local.json` from `validateDest` → 5 fails.
- M5: capability gate ignored → 6 fails.
- M6: fragment top-level keys not checked → 7 fails.
- M7: fragment text rendered before `JSON.parse` → 7 fails (quote case).
- M8: drop the `..` segment check on `dest` → 5 fails.
- M9: `validateDest` compares the raw `dest` instead of `destKey(dest)` → 5 fails (5c case rows).
- M10: `destKey` lowercases without `normalize('NFC')` → 5 fails (5c normalisation row).
- M11: `fs.statSync` instead of `fs.lstatSync` for `src` and the fragment → 5 fails (5e symlink rows).
- M12: realpath containment removed → 5 fails (5e `linkdir` row).
- M13: `.env.example` exception removed → 5 fails (5d).

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy-render.js` is empty.
Commit: `test(agnostic-B2): render and preset validation tests (13 mutants killed)`.
  </action>
  <verify>
Single-file run `# fail 0`, tests 1-9 present by name.
`git grep -c "project-deploy-render.test.js" -- package.json` → `package.json:1`.
  </verify>
  <done>9 behaviours, 13 mutants killed and reverted.</done>
</task>

<task type="auto">
  <name>Task 3: project-deploy-files.js (hash, git merge-file wrapper, whole-file decision)</name>
  <files>get-shit-done/bin/project-deploy-files.js</files>
  <action>
Create the module per `<spec>` section `project-deploy-files.js` (target ≤ 90 lines). Exports `{ sha256, gitMergeFile, planWholeFile }`. B-03 adds the block functions to this same file.

Commit: `feat(agnostic-B3): whole-file three-way decision over git merge-file`.
  </action>
  <verify>
`node -e "const f=require('./get-shit-done/bin/project-deploy-files.js');const B=Buffer.from;console.log(f.planWholeFile({current:null,base:null,manifestHash:null,next:B('x')}).action, f.planWholeFile({current:B('y'),base:null,manifestHash:null,next:B('x')}).action)"` prints `create conflict`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>Module exists, smoke output as stated.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: whole-file three-way tests</name>
  <files>get-shit-done/bin/project-deploy-files.test.js, package.json</files>
  <behavior>
All ADD (`git grep -n project-deploy-files -- '*.test.js'` is empty). Tier T1. Layer unit with the real `git merge-file` (git 2.39 is on PATH), each test passing its own `tmpRoot` (a `mkdtempSync` dir) through a `mergeFn` wrapper `(c, b, n) => gitMergeFile(c, b, n, { tmpRoot })`.

Texts: `BASE = 'one\ntwo\nthree\nfour\nfive\n'`.

1. `current: null` → `create`, `content` equals `next`.
2. `current` equals `next`, with and without `manifestHash` → `unchanged`, no `content`.
3. Unchanged → overwritten: `current = BASE`, `manifestHash = sha256(BASE)`, `next` differs → `action === 'overwrite'` and `content.equals(next)`; a spy `mergeFn` is not called.
4. Edited → merged: `current` changes line 1, `next` changes line 5, `base = BASE`, `manifestHash = sha256(BASE)` → `merge`; content has both changed lines and no `<<<<<<<`.
5. Conflict → nothing: `current` and `next` change line 3 differently → `action === 'conflict'`, `reason === 'merge conflict'`, `'content' in result === false`.
6. Unmanaged existing: `manifestHash: null`, `current` differs from `next` → `conflict`, reason `exists and is not managed`. `manifestHash` set, `base: null`, hash differs → `conflict`, reason `merge base missing`.
7. Local edit, upstream unchanged (`next = BASE`, `base = BASE`, `current` edited) → `unchanged`.
8. `gitMergeFile` cleans up: after a clean merge and after a conflict, `fs.readdirSync(tmpRoot)` is `[]`.
9. `gitMergeFile(..., { gitBin: 'gsd-no-such-binary', tmpRoot })` → `{ ok: false, reason: 'git merge-file failed' }`, `tmpRoot` empty; `planWholeFile` with that `mergeFn` → `conflict`.
10. Bytes: `next` with CRLF line endings is returned byte-equal on `overwrite`; `sha256(Buffer.from('abc'))` equals the known digest `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  </behavior>
  <action>
Write the test file. In `package.json` `scripts.test` insert ` get-shit-done/bin/project-deploy-files.test.js` immediately after `get-shit-done/bin/project-deploy-render.test.js`.

Mutation proof (edit the module, run the file, confirm, revert; record in SUMMARY):
- M1: remove row c → 3 fails.
- M2: on `status === 1` return `{ ok: true, content: stdout }` → 5 fails.
- M3: a conflict result carries `content: r.content` → 5 fails.
- M4: row f returns `overwrite` → 6 fails.
- M5: temp dir not removed → 8 fails.
- M6: remove row b → 2 fails.
- M7: spawn error treated as `merge conflict` → 9 fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy-files.js` is empty. Then the full suite once.
Commit: `test(agnostic-B3): whole-file three-way tests (7 mutants killed), wired into npm test`.
Then write and commit `.planning/agnostic/B/B-02-SUMMARY.md` (format of `.planning/agnostic/A/A-02-SUMMARY.md`).
  </action>
  <verify>
Single-file run `# fail 0`, tests 1-10 present by name.
Full suite rc=0, `# fail 0`. `node scripts/agnostic-lint.js check` exit 0.
  </verify>
  <done>10 behaviours, 7 mutants killed and reverted, suite green.</done>
</task>

</tasks>

<verification>
- Both modules load with `require` and have no caller yet: `git grep -n "project-deploy-render\|project-deploy-files" -- get-shit-done/bin ':!*.test.js'` lists only the modules themselves.
- Full suite rc 0, `# fail 0`; agnostic lint exit 0; `git log --oneline <plan-start-sha>..HEAD -- scripts/agnostic-lint/` empty.
- No file outside `files_modified` and `.planning/agnostic/B/` changed.
</verification>

<success_criteria>
The must_haves truths hold, each backed by a named test and at least one killed mutant.
</success_criteria>

<output>
`.planning/agnostic/B/B-02-SUMMARY.md`: outcome, commits, tests by name, mutation table, deviations, Self-Check.
</output>
