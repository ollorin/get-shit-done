---
phase: agnostic-A
plan: 02
type: execute
wave: 2
depends_on: ["A-01"]
files_modified:
  - get-shit-done/bin/project-profile.js
  - get-shit-done/bin/project-profile.test.js
  - get-shit-done/bin/gsd-tools.js
  - package.json
autonomous: true
requirements: [AGN-A2]
must_haves:
  truths:
    - "`gsd-tools profile check` exits 1 and lists every missing required key and every invalid value of the `project` and `stack` blocks of `.planning/config.json`; exits 0 with `ok: true` on a valid profile"
    - "`gsd-tools profile get <key>` prints the value of a `project.*` / `stack.*` key and exits 1 with `profile key not set: <key>` when it is absent; it never substitutes a default"
    - "No existing command, agent or workflow calls the new code; existing 1683+ tests stay green and the agnostic lint baseline is unchanged"
  artifacts:
    - path: get-shit-done/bin/project-profile.js
      provides: "schema constants, loadProfile, getProfileValue, validateProfile, runCli"
    - path: get-shit-done/bin/project-profile.test.js
      provides: "unit + CLI tests, listed in package.json `test`"
    - path: get-shit-done/bin/gsd-tools.js
      provides: "`case 'profile'` dispatch immediately before `case 'prompt-optimize'`"
  key_links:
    - from: get-shit-done/bin/gsd-tools.js
      to: get-shit-done/bin/project-profile.js
      via: "require next to `deriveCheckSet` (currently line 221) + `case 'profile'` before `case 'prompt-optimize'` (currently line 15171)"
      pattern: "case 'profile'"
e2e_flows: []
---

<objective>
Phase A2 (design: FABLE-AGNOSTIC-GSD section 4.1): a loader and validator for the new `project` and `stack` blocks of `.planning/config.json`, exposed as `gsd-tools profile get|check`. Nothing consumes it yet.

Output: one module (target ≤ 260 lines), its test file, a 2-edit wiring in `gsd-tools.js`, one token added to `package.json` scripts.test.
</objective>

<execution_context>
@get-shit-done/workflows/execute-plan.md
@get-shit-done/templates/summary.md
</execution_context>

<executor_rules>
- Work only in `/Users/ollorin/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `/Users/ollorin/igaming-platform`, `~/.claude`, `~/get-shit-done`.
- Forbidden: `npm run install:gsd`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Full suite: `cd /Users/ollorin/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-A02.log 2>&1; echo rc=$?` then read only the last 15 lines. Expected before this plan: pass ≥ 1695, fail 0.
- `get-shit-done/bin/gsd-tools.js` is 16.4k lines. Read ONLY these ranges: 205-230 (requires), 745-748 and 780-806 (`output`, `writeStdoutSync`, `error`), 1886-1901 (`readRawConfigPath`), 15165-15175 (dispatch neighbourhood). Line numbers are from `db24beb`; locate by the quoted anchor text if they moved.
- `get-shit-done/bin/gsd-tools.test.js` is 18k lines: do not read or edit it. CLI tests go in the new test file (a file over 1,500 LOC is not grown).
- The new module is inside the agnostic-lint `bin` scope: it must contain none of the denylist terms (no vendor, tool or product names, no `localhost:<port>`). `node scripts/agnostic-lint.js check` must stay at exit 0 without regenerating the baseline.
- Commit per task with `git commit -m "<msg>" -- <paths>`; `git add -f` for the SUMMARY. Every commit message ends with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
- CommonJS, `'use strict'`, node built-ins only, no `throw` across the module boundary (return result objects), comments only for non-obvious constraints.
</executor_rules>

<spec>

## Source of truth

`<cwd>/.planning/config.json`, top-level keys `project` and `stack`. Other keys of the file are ignored by this module.

## Schema

Required (absent → listed in `missing`):

| key | type / rule |
|---|---|
| `project.slug` | string matching `^[a-z0-9][a-z0-9-]*$` |
| `project.owner_title` | non-empty string |
| `project.risk_domains` | array of non-empty strings (may be empty), no duplicates |
| `project.ruling_topics` | array of non-empty strings (may be empty), no duplicates |
| `stack.commands.test_file` | non-empty string |

Optional (absent is fine; present with a wrong shape → listed in `invalid` with a reason):

| key | type / rule |
|---|---|
| `stack.preset`, `stack.preset_version` | non-empty string |
| `stack.paths` | object; every value is a non-empty string or an array of non-empty strings. Known keys: `backend`, `migrations`, `api_globs`, `e2e_scenarios`, `frontends`. `api_globs` and `frontends`, when present, must be arrays |
| `stack.commands` | object of non-empty strings. Known keys (`KNOWN_COMMAND_KEYS`): `test_file`, `test_all`, `typecheck`, `lint`, `format`, `frontend_test`, `pre_pr_gate`, `search`. Placeholders: every `{name}` token (regex `\{[a-z_]+\}`) in a value must be one of `{root}`, `{file}`, `{paths}`, `{project}` |
| `stack.test_command_shapes` | array of non-empty strings |
| `stack.gates` | array of `{ id, run }`, both non-empty strings, `id` unique |
| `stack.services` | array of `{ name, url, health?, launch?, ready? }`; `name` and `url` required non-empty strings, the rest optional non-empty strings; `name` unique |
| `stack.capabilities` | object. `ui_qa`, when present: `{ driver, agent, tool_prefix?, reset_patterns? }` with `driver` and `agent` non-empty strings, `tool_prefix` string, `reset_patterns` array of non-empty strings |
| `stack.isolation` | object: `port_base` integer 1024-65535, `container_suffix` non-empty string, `lock_dir` non-empty string, `machine_locks` array of non-empty strings; each optional |

Warnings (never fail): an unknown key directly under `project`, `stack`, `stack.commands`, `stack.paths`, `stack.capabilities` or `stack.isolation` → `unknown key: <dotted.key>`.

## Module API (`get-shit-done/bin/project-profile.js`)

- `REQUIRED_KEYS` (the 5 dotted keys, in table order), `KNOWN_COMMAND_KEYS`, `COMMAND_PLACEHOLDERS`
- `loadProfile(cwd)` → `{ found: boolean, error: string|null, project: object|undefined, stack: object|undefined }`. No config file → `found: false, error: null`. Unreadable/unparseable or a non-object root → `found: true, error: 'config.json is not valid JSON'` (or `'config.json root is not an object'`).
- `getProfileValue(profile, keyPath)` → value or `undefined`; walks own enumerable keys only; `keyPath` must start with `project.` or `stack.` (or equal `project` / `stack`), else `undefined`.
- `validateProfile(profile)` → `{ ok, config_found, missing: string[], invalid: [{ key, reason }], warnings: string[] }`. `ok` = `missing` and `invalid` both empty. When `profile.error` is set: `invalid = [{ key: 'config.json', reason: profile.error }]` and `missing = REQUIRED_KEYS`. A required key present with a wrong shape goes to `invalid`, not `missing`. Arrays are sorted by key for stable output. Pure: takes the loaded object, reads no files.
- `runCli(cwd, args)` → `{ exitCode, result, rawValue?, error? }`:
  - `['check']` → `result` = the `validateProfile` object, `exitCode` 0 if ok else 1.
  - `['get', key]` → key not starting with `project`/`stack` → `{ error: 'profile keys start with project. or stack.' }`; value undefined → `{ error: 'profile key not set: <key>' }`; else `{ exitCode: 0, result: { key, value }, rawValue }` where `rawValue` is the string itself for strings, `JSON.stringify(value)` otherwise.
  - anything else → `{ error: 'Usage: profile <get <key>|check>' }`.

## Wiring in `get-shit-done/bin/gsd-tools.js` (exactly two insertions)

1. Directly after the line `const { deriveCheckSet } = require('./pre-pr-checks.js');` add
   `const projectProfile = require('./project-profile.js');`
2. Directly before the line `    case 'prompt-optimize': {` add:

```js
    case 'profile': {
      const r = projectProfile.runCli(cwd, args.slice(1));
      if (r.error) error(r.error);
      if (r.exitCode !== 0) {
        writeStdoutSync(JSON.stringify(r.result, null, 2));
        process.exit(r.exitCode);
      }
      output(r.result, raw, r.rawValue);
      break;
    }

```

`error`, `output`, `writeStdoutSync`, `cwd`, `raw`, `args` already exist in that scope (lines 745, 780, 803, 14270-14276).

</spec>

<tasks>

<task type="auto">
  <name>Task 1: project-profile.js and the `profile` dispatch</name>
  <files>get-shit-done/bin/project-profile.js, get-shit-done/bin/gsd-tools.js</files>
  <action>
Create `get-shit-done/bin/project-profile.js` per `<spec>` and make the two insertions in `gsd-tools.js`. Read only the `gsd-tools.js` ranges named in `<executor_rules>`. Do not reuse or change `readRawConfigPath` / `cmdConfigGet` (existing `config get` behaviour stays byte-identical); the module reads the file itself.

Smoke check from a scratch dir (create with `mktemp -d`, write `.planning/config.json` there):
- file containing `{}` → `node <repo>/get-shit-done/bin/gsd-tools.js profile check` exits 1 and `missing` has the 5 required keys.
- file with a valid minimal profile (`project.slug: "demo"`, `owner_title: "owner"`, `risk_domains: ["auth"]`, `ruling_topics: []`, `stack.commands.test_file: "npm test -- {file}"`) → exit 0, `"ok": true`; `profile get stack.commands.test_file --raw` prints `npm test -- {file}`; `profile get stack.commands.lint` exits 1 with `Error: profile key not set: stack.commands.lint`.

Commit: `feat(agnostic-A2): project/stack profile loader and gsd-tools profile get|check`.
  </action>
  <verify>
The three smoke checks behave as stated.
`node scripts/agnostic-lint.js check` → exit 0 (baseline untouched).
`git diff --stat -- get-shit-done/bin/gsd-tools.js` shows 1 file, 11-12 insertions, 0 deletions.
  </verify>
  <done>Module exists, CLI wired at the two named anchors, lint still at baseline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Unit and CLI tests for the profile loader, with executed mutations</name>
  <files>get-shit-done/bin/project-profile.test.js, package.json</files>
  <behavior>
All ADD (new module; `git grep -n project-profile -- '*.test.js'` is empty before this task). Tier T2, layer unit for 1-9 (call `validateProfile` / `getProfileValue` with in-memory objects built from a `validProfile()` helper that returns the full section-4.1-shaped example with neutral values), CLI for 10-13 (tmp dir with `.planning/config.json`, `spawnSync(process.execPath, [gsdToolsPath, 'profile', ...], { cwd: tmp })`).

1. Full valid profile → `ok: true`, `missing: []`, `invalid: []`, `warnings: []`.
2. Minimal valid profile (only the 5 required keys) → `ok: true`.
3. Each required key removed in turn (5 cases, loop) → `ok: false` and `missing` equals exactly `[thatKey]`.
4. Required key with wrong shape: `project.slug: "Has Space"`, `project.risk_domains: "auth"`, `project.risk_domains: ["auth","auth"]`, `stack.commands.test_file: ""` → each in `invalid` (with the key), none in `missing`.
5. Placeholder rule: `stack.commands.lint: "x {files}"` → `invalid` has `stack.commands.lint`; `"x {paths} {root}"` is valid.
6. Collections: duplicate `gates[].id`, gate without `run`, duplicate `services[].name`, service without `url` → each `invalid` with key `stack.gates` / `stack.services`.
7. `capabilities.ui_qa` without `agent` → invalid `stack.capabilities.ui_qa`; `capabilities: {}` valid. `isolation.port_base: 80` and `"54320"` (string) → invalid; `54320` valid.
8. Unknown keys: `stack.commands.deploy: "x"` and `project.extra: 1` → `ok: true` with two `unknown key:` warnings.
9. `getProfileValue`: nested hit; missing → `undefined`; `workflow.research` (outside project/stack) → `undefined`; `stack.__proto__` → `undefined`.
10. CLI `profile check`, valid config → exit 0, stdout JSON `ok: true`. Invalid config → exit 1 AND stdout is parseable JSON listing the missing key. No `.planning/config.json` → exit 1, `config_found: false`. Corrupt JSON file → exit 1, `invalid[0].key === 'config.json'`.
11. CLI `profile get project.owner_title --raw` → stdout exactly the string; `profile get project.risk_domains --raw` → the JSON array; without `--raw` → `{ key, value }`.
12. CLI `profile get stack.commands.lint` on a profile without it → exit 1, stderr contains `profile key not set: stack.commands.lint`, stdout empty (no default substituted).
13. Regression guard for existing behaviour: in the same tmp project, `config get project.slug --raw` (the pre-existing command) still prints the slug and `profile` with no subcommand exits 1 with `Usage: profile`. ADD (cheapest proof that the dispatch insertion did not shadow `config`).
  </behavior>
  <action>
Write `get-shit-done/bin/project-profile.test.js` (`node:test`, `node:assert`; helper style: `get-shit-done/bin/pre-pr-checks.test.js` lines 1-30). Then in `package.json` `scripts.test` insert ` get-shit-done/bin/project-profile.test.js` immediately after `get-shit-done/bin/demo-check.test.js`; change nothing else.

Run `NODE_PATH=$HOME/get-shit-done/node_modules node --test get-shit-done/bin/project-profile.test.js` → all pass.

Mutation proof (Edit, run the file, confirm the named test fails, revert; record in SUMMARY):
- M1: drop `stack.commands.test_file` from `REQUIRED_KEYS` → test 3 fails.
- M2: make `runCli(['check'])` always return `exitCode: 0` → test 10 fails.
- M3: in `runCli(['get'])` return `''` instead of the error for an undefined value → test 12 fails.
- M4: skip the placeholder check → test 5 fails.
- M5: skip the duplicate-id check for gates → test 6 fails.
- M6: let `getProfileValue` accept any top-level key → test 9 fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-profile.js` is empty. Then the full suite: rc=0, `# fail 0`, `# pass` ≥ 1708 (1695 + 13).

Commit: `test(agnostic-A2): profile loader unit + CLI tests (6 mutants killed), wired into npm test`.
  </action>
  <verify>
Single-file run `# fail 0`, ≥ 13 tests.
`git grep -c "get-shit-done/bin/project-profile.test.js" -- package.json` → `package.json:1`.
Full suite rc=0, pass ≥ 1708, fail 0. `node scripts/agnostic-lint.js check` exit 0.
  </verify>
  <done>13 behaviours covered, 6 mutants killed and reverted, suite green and larger.</done>
</task>

</tasks>

<verification>
- `gsd-tools profile check|get` behave per spec in a scratch project.
- `git diff db24beb --stat -- get-shit-done/bin/gsd-tools.js`: insertions only, at the two anchors.
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test` rc 0, pass ≥ 1708; agnostic lint exit 0 with unchanged `baseline.json` (`git diff --quiet HEAD~2 -- scripts/agnostic-lint/baseline.json`).
</verification>

<success_criteria>
A project's `project`/`stack` blocks can be validated and read through one CLI that fails loudly on a missing key; nothing else in GSD changed behaviour.
</success_criteria>

<output>
After completion create `.planning/agnostic/A/A-02-SUMMARY.md` (`git add -f`).
</output>
