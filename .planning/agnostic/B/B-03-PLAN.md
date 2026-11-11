---
phase: agnostic-B
plan: 03
type: execute
wave: 3
depends_on: ["B-02"]
files_modified:
  - get-shit-done/bin/project-deploy-files.js
  - get-shit-done/bin/project-deploy-files.test.js
  - get-shit-done/bin/project-deploy-settings.js
  - get-shit-done/bin/project-deploy-settings.test.js
  - package.json
autonomous: true
requirements: [AGN-B4, AGN-B5]
must_haves:
  truths:
    - "In a block-managed file only the text between `<!-- gsd:begin <id> -->` and `<!-- gsd:end <id> -->` is replaced; every byte outside the markers and every block the preset does not own is untouched; a project file with malformed markers yields no content"
    - "Settings set-merge: new = (current − previously deployed) ∪ newly rendered, for allow/deny/ask strings and hook commands; a project-added rule or hook survives; preset hooks come first in preset order; keys the fragment does not own are preserved"
    - "The merge is idempotent, never mutates its inputs, rejects a malformed settings file instead of coercing it, and reports every added and removed entry by value"
  artifacts:
    - path: get-shit-done/bin/project-deploy-files.js
      provides: "parseBlocks, planBlockFile, stripMarkerLines (added to the B-02 exports)"
    - path: get-shit-done/bin/project-deploy-settings.js
      provides: "mergeSettings, serializeSettings"
    - path: get-shit-done/bin/project-deploy-settings.test.js
      provides: "set-merge tests, listed in package.json `test`"
  key_links:
    - from: "mergeSettings `deployed` result"
      to: "manifest `settings` block written by B-04"
      via: "`{ permissions: { allow, deny, ask }, hooks: [{ event, matcher, command }] }`"
      pattern: "deployed"
    - from: "mergeSettings `added` / `removed` results"
      to: "B-04 `report.settings`"
      via: "same by-value shape as `deployed`"
      pattern: "removed"
e2e_flows: []
---

<objective>
Phase B4 (block-managed markers) + B5 (settings set-merge), design lines 218-227 and 240 of `/Users/ollorin/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md`. Pure functions on strings and objects; the engine in B-04 does the file I/O.
</objective>

<executor_rules>
- Work only in `/Users/ollorin/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `/Users/ollorin/igaming-platform`, `~/.claude`, `~/get-shit-done`. These tests need no files on disk at all.
- Forbidden: `npm run install:gsd`, `node bin/install.js`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Do not edit or `require` Phase A files (`scripts/agnostic-lint*`, `get-shit-done/bin/project-profile*.js`, the A3 templates and reference). Before editing `package.json` run `git status --short -- package.json`; if not empty, stop and report.
- One test file: `NODE_PATH=$HOME/get-shit-done/node_modules node --test <file>`. Full suite once, in Task 4: `cd /Users/ollorin/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-B03.log 2>&1; echo rc=$?`, read the last 15 lines only. Success: rc=0, `# fail 0`, named tests present.
- Lint: `node scripts/agnostic-lint.js check` exits 0 without regenerating the baseline. No vendor, product or tool names in code or comments of non-test files.
- Read `get-shit-done/bin/project-deploy-files.js` whole (≤ 90 lines) before Task 1; change none of its B-02 functions. Read `project-deploy-files.test.js` lines 1-30 only (helpers) before appending.
- CommonJS, `'use strict'`, node built-ins only, result objects instead of `throw`, `const` only, inputs never mutated, comments only for a non-obvious constraint. Each module ≤ 300 lines.
- Commit per task: `git add -f <paths>` then `git commit -m "<msg>" -- <paths>`; check with `git show --stat HEAD -- <paths>`; ignore untracked `.audit/`. Trailers on every commit:
  `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
</executor_rules>

<spec>

## Block markers (`project-deploy-files.js`)

A marker is a whole line, after removing one optional trailing `\r`:
begin `^<!-- gsd:begin ([a-z0-9][a-z0-9-]*) -->$`, end `^<!-- gsd:end ([a-z0-9][a-z0-9-]*) -->$`. A marker with leading spaces or other text on the line is ordinary text.

- `parseBlocks(text)` → `{ ok: true, blocks: [{ id, beginLine, endLine, inner }] }` or `{ ok: false, reason }`. Lines are `text.split('\n')`, indices 0-based; `inner` = the lines strictly between the markers joined with `\n` (empty string when there are none). Reasons: `end without begin: <id>`, `nested begin: <id>`, `mismatched end: <id>`, `duplicate block id: <id>`, `unclosed block: <id>`.
- `planBlockFile({ current, next, prevBlocks })` → `{ action, content?, reason?, blocks, warnings }`. `current` string or `null`, `next` string (the rendered preset file), `prevBlocks` = `{ id: sha256hex }` from the manifest or `null`.
  1. `parseBlocks(next)` not ok, or zero blocks → `{ action: 'error', reason: 'preset block file: <reason | no managed blocks>' }`.
  2. `blocks` = `{ id: sha256(Buffer.from(inner, 'utf8')) }` for every block of `next`.
  3. `current === null` → `{ action: 'create', content: next, blocks, warnings: [] }`.
  4. `parseBlocks(current)` not ok → `{ action: 'conflict', reason: 'malformed markers: <reason>', blocks, warnings: [] }` (no `content`).
  5. For each block of `next`, in order: present in `current` → replace the lines strictly between its markers with the `next` inner lines; absent → append to the end: if the text does not end with `\n` add one, then an empty line, then the begin line, the inner lines, the end line and a final `\n`. Blocks of `current` that `next` does not have are left as they are. Text of `next` outside its markers is used only in case 3.
  6. Warning `local edit in block overwritten: <id>` when the block exists in `current`, `prevBlocks[id]` is set, and the sha256 of the current inner differs from both `prevBlocks[id]` and the new inner hash.
  7. Result equals `current` → `{ action: 'unchanged', blocks, warnings }`; else `{ action: 'update', content, blocks, warnings }`.
- `stripMarkerLines(text)` → `text` without marker lines (each removed together with its line break). Used by the Phase C golden comparison.

## `project-deploy-settings.js`

`mergeSettings(current, prev, fragment)` → `{ ok: true, settings, deployed, changed, added, removed }` or `{ ok: false, reason }`.

- `current`: parsed `.claude/settings.json` or `null` (file absent → treated as `{}`).
- `prev`: the manifest's `settings` block `{ permissions: { allow, deny, ask }, hooks: [{ event, matcher, command }] }` or `null` (nothing deployed before).
- `fragment`: `renderPreset(...).settings` or `null` (treated as an empty fragment, so everything in `prev` is removed).

Invalid `current` → `{ ok: false, reason }`, nothing skipped or coerced. The invalid list: root not a plain object (`settings root is not an object`); `permissions` present and not a plain object; `permissions.allow|deny|ask` present and not an array; `hooks` present and not a plain object; a `hooks[event]` that is not an array; a group in `hooks[event]` that is not a plain object (`null`, a string, an array); a group whose `hooks` key is present and not an array.

Permissions, for each `k` of `allow`, `deny`, `ask`:
`result[k]` = the entries of `current.permissions[k]` in their current order, first occurrence only, minus every entry that is in `prev.permissions[k]` and not in `fragment.permissions[k]`; then the entries of `fragment.permissions[k]` not already present, in fragment order. A `k` that ends empty and was absent in `current` is not created. Other keys of `current.permissions` (for example `defaultMode`, `additionalDirectories`) are kept as they are.

Hooks. A handler's identity is the triple `(event, matcher ?? '', command)`; only handlers with `type === 'command'` have one. `managed` = triples of `prev.hooks` ∪ triples of `fragment.hooks`.
For each event (current's events in current order, then fragment-only events in fragment order):
`result[event]` = the fragment's groups for that event (deep copies, fragment order), then the current groups with every managed handler removed; a current group whose `hooks` array becomes empty through that removal is dropped. An event that ends with no groups is omitted.

Everything else: every other top-level key of `current` is kept with its value, in the current key order; `permissions` and `hooks` keep their position when they exist and are appended when new; neither key is created when it would be empty and was absent.

- `deployed` = `{ permissions: { allow: [...], deny: [...], ask: [...] }, hooks: [{ event, matcher, command }] }` from the fragment (all three permission keys always present, `matcher` `''` when absent, hooks in fragment order).
- `changed` = `JSON.stringify(settings) !== JSON.stringify(current === null ? {} : current)`, and `true` when `current === null` and `settings` is not `{}`.
- `added` / `removed`, by value, same shape as `deployed`: `added` = the permission strings and handler triples that are in `settings` and not in `current`; `removed` = those in `current` and not in `settings`. All three permission keys always present; order of first appearance. B-04 puts both in its report so the person running the command reads each rule and hook that changes (the manifest that drives removals is an editable file).
- `serializeSettings(settings)` → `JSON.stringify(settings, null, 2) + '\n'`.

Inputs are never mutated (build new objects and arrays).

</spec>

<tasks>

<task type="auto">
  <name>Task 1: block-managed functions in project-deploy-files.js</name>
  <files>get-shit-done/bin/project-deploy-files.js</files>
  <action>
Add `parseBlocks`, `planBlockFile`, `stripMarkerLines` per `<spec>` and add them to `module.exports`. The B-02 functions stay byte-identical (`git diff` shows additions only, plus the export line). The file stays ≤ 220 lines.

Commit: `feat(agnostic-B4): block-managed marker parsing and replacement`.
  </action>
  <verify>
`NODE_PATH=$HOME/get-shit-done/node_modules node --test get-shit-done/bin/project-deploy-files.test.js` → `# fail 0` (B-02 tests still green).
`node -e "const f=require('./get-shit-done/bin/project-deploy-files.js');const n='<!-- gsd:begin a -->\nNEW\n<!-- gsd:end a -->\n';const c='top\n<!-- gsd:begin a -->\nold\n<!-- gsd:end a -->\nbottom\n';console.log(JSON.stringify(f.planBlockFile({current:c,next:n,prevBlocks:null}).content))"` prints `"top\n<!-- gsd:begin a -->\nNEW\n<!-- gsd:end a -->\nbottom\n"`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>Three functions added, B-02 behaviour unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: block-managed tests</name>
  <files>get-shit-done/bin/project-deploy-files.test.js</files>
  <behavior>
Append one `describe('block-managed files (agnostic-B4)', ...)`; test names prefixed `B4-`. Tier T1 for 5, 8, 9; T2 otherwise. Layer unit, strings only. Existing B-02 tests 1-10 in this file: REUSE as the regression for the untouched whole-file functions.

`M = (id) => ['<!-- gsd:begin ' + id + ' -->', '<!-- gsd:end ' + id + ' -->']`.

B4-1. ADD. `parseBlocks` on a text with blocks `a` and `b` → ids in order, correct `inner`, an empty block has `inner === ''`.
B4-2. ADD. Malformed, one case each, `ok: false` with the stated reason: unclosed, end without begin, nested begin, mismatched end id, duplicate id.
B4-3. ADD. Not markers: a marker line with two leading spaces, a marker followed by text on the same line, `<!-- gsd:begin A_B -->` → zero blocks, `ok: true`. A marker line ending in `\r` is a marker.
B4-4. ADD. `current: null` → `create`, `content === next`.
B4-5. ADD. Replace: `current` = project text, block `a` (old inner, 2 lines), project text, block `b`, project text; `next` has `a` (new inner, 3 lines) and `b` (unchanged) → `update`; the result equals `current` with only the inner of `a` replaced (assert full-string equality against a hand-built expected string).
B4-6. ADD. Append: `current` has no block `c` and does not end with `\n` → result is `current + '\n' + '\n' + begin + '\n' + inner + '\n' + end + '\n'`.
B4-7. ADD. Same inner → `unchanged`, no `content`.
B4-8. ADD. A block `mine` that only `current` has is byte-identical in the result while `a` is replaced.
B4-9. ADD. Malformed `current` (unclosed block) → `conflict`, `'content' in result === false`. `next` with no markers, and `next` with a duplicate id → `action: 'error'`.
B4-10. ADD. Warning: `prevBlocks.a` = hash of the old preset inner, `current` inner edited by hand, `next` inner new → `update` with warning `local edit in block overwritten: a`; no warning when the current inner hash equals `prevBlocks.a`.
B4-11. ADD. `blocks` = sha256 of each `next` inner (compare against `sha256(Buffer.from(inner))`).
B4-12. ADD. `stripMarkerLines` removes the four marker lines of a two-block text and nothing else; CRLF markers are removed with their `\r\n`.
  </behavior>
  <action>
Append the describe block; run the file.

Mutation proof (edit `project-deploy-files.js`, run the file, confirm, revert; record in SUMMARY):
- M1: `planBlockFile` returns `next` as content whenever `current` exists → B4-5, B4-8 fail.
- M2: malformed `current` falls through to `update` with `next` → B4-9 fails.
- M3: marker regexes lose the `^` anchor → B4-3 fails.
- M4: absent blocks are not appended → B4-6 fails.
- M5: duplicate id accepted → B4-2 fails.
- M6: blocks missing from `next` are deleted from the result → B4-8 fails.
- M7: warning never emitted → B4-10 fails.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy-files.js` is empty.
Commit: `test(agnostic-B4): block-managed tests (7 mutants killed)`.
  </action>
  <verify>
Single-file run `# fail 0`; B-02 tests 1-10 and B4-1..B4-12 present by name.
  </verify>
  <done>12 behaviours added, 7 mutants killed and reverted.</done>
</task>

<task type="auto">
  <name>Task 3: project-deploy-settings.js (set-merge)</name>
  <files>get-shit-done/bin/project-deploy-settings.js</files>
  <action>
Create the module per `<spec>` section `project-deploy-settings.js` (target ≤ 190 lines). Exports `{ mergeSettings, serializeSettings }`. No file I/O.

Commit: `feat(agnostic-B5): settings set-merge (permissions and hook commands)`.
  </action>
  <verify>
`node -e "const s=require('./get-shit-done/bin/project-deploy-settings.js');const r=s.mergeSettings({permissions:{allow:['P','old']}},{permissions:{allow:['old'],deny:[],ask:[]},hooks:[]},{permissions:{allow:['new']}});console.log(JSON.stringify(r.settings.permissions.allow), r.changed, JSON.stringify(r.removed.permissions.allow))"` prints `["P","new"] true ["old"]`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>Module exists, smoke output as stated.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: settings set-merge tests</name>
  <files>get-shit-done/bin/project-deploy-settings.test.js, package.json</files>
  <behavior>
All ADD (`git grep -n project-deploy-settings -- '*.test.js'` is empty). Tier T1 (permissions and hooks are the project's guardrails). Layer unit, in-memory objects. Every test passes deep-frozen inputs (a local recursive `Object.freeze` helper), which also proves behaviour 11.

Helpers: `grp(matcher, ...commands)` → `{ matcher, hooks: commands.map((command) => ({ type: 'command', command })) }`.

1. `current: null`, `prev: null`, fragment with allow, deny, ask and one `PreToolUse` group → `settings` deep-equals the fragment; `deployed` lists the three arrays and the hook triple; `added` deep-equals `deployed`; `removed` is all-empty; `changed === true`.
2. Project-added allow rule survives: `current.allow = ['A1', 'PROJECT', 'A2']`, `prev.allow = ['A1', 'A2']`, `fragment.allow = ['A1', 'A3']` → `['A1', 'PROJECT', 'A3']`; `removed` deep-equals `{ permissions: { allow: ['A2'], deny: [], ask: [] }, hooks: [] }`; `added` deep-equals `{ permissions: { allow: ['A3'], deny: [], ask: [] }, hooks: [] }`.
3. Deny and ask: a project-added `deny` and `ask` entry survive; a `deny` entry that is in `current`, NOT in `prev` and not in the fragment is still there after the merge. A `deny` entry that IS in `prev` and not in the fragment is gone and is named in `removed.permissions.deny`.
4. `prev: null`, `current.allow` already contains a fragment entry → present once.
5. Hooks order and removal: `current.PreToolUse = [grp('Bash', 'preset-old'), grp('Write', 'project-hook')]`, `prev.hooks` has `('PreToolUse', 'Bash', 'preset-old')`, fragment `PreToolUse = [grp('Bash', 'preset-new'), grp('Edit', 'preset-2')]` → `[grp('Bash', 'preset-new'), grp('Edit', 'preset-2'), grp('Write', 'project-hook')]`; `removed.hooks` deep-equals `[{ event: 'PreToolUse', matcher: 'Bash', command: 'preset-old' }]`; `added.hooks` deep-equals the two preset triples in fragment order.
6. Mixed group: `current` group `grp('Bash', 'preset-old', 'project-cmd')` with `preset-old` in `prev` and dropped from the fragment → the group remains with only `project-cmd`.
7. `prev: null` and `current` already holds a handler with the same triple as the fragment → present once (in the fragment's position).
8. Same command under a different matcher or event is a different identity: the project handler `('PostToolUse', 'Bash', 'preset-new')` survives.
9. Preservation: `current` with top-level `env`, `statusLine`, `permissions.defaultMode`, `permissions.additionalDirectories`, a hook handler of `type: 'prompt'` → all deep-equal in the result; `Object.keys(settings)` keeps the current order.
10. Idempotence: `r1 = merge(current, prev, fragment)`; `r2 = merge(r1.settings, r1.deployed, fragment)` → `r2.changed === false`, `r2.added` and `r2.removed` all-empty, and `serializeSettings(r2.settings) === serializeSettings(r1.settings)`.
11. Inputs deep-frozen in every test above: no TypeError, inputs deep-equal to pristine copies afterwards.
12. `fragment: null` with a `prev` → every previously deployed permission and handler is removed, project entries stay; an event left empty is omitted.
13. Invalid `current`, table-driven, one case each → `ok: false` with a non-empty `reason`, no `settings` key: `permissions.allow` a string; `hooks` an array; root an array; `hooks.PreToolUse` an object; `hooks.PreToolUse = ['x']`; `hooks.PreToolUse = [null]`; `hooks.PreToolUse = [[]]`; `hooks.PreToolUse = [{ matcher: 'Bash', hooks: 'cmd' }]`; `hooks.PreToolUse = [{ matcher: 'Bash', hooks: {} }]`.
14. `serializeSettings` output ends with exactly one `\n` and parses back deep-equal.
  </behavior>
  <action>
Write the test file. In `package.json` `scripts.test` insert ` get-shit-done/bin/project-deploy-settings.test.js` immediately after `get-shit-done/bin/project-deploy-files.test.js`.

Mutation proof (edit the module, run the file, confirm, revert; record in SUMMARY):
- M1: permissions result = fragment entries only → 2, 3 fail.
- M2: previously deployed entries are never removed → 2, 5, 12 fail.
- M3: project groups placed before fragment groups → 5 fails.
- M4: no de-duplication against `current` → 4, 7 fail.
- M5: other top-level keys dropped → 9 fails.
- M6: removal test is `!fragmentSet.has(e)` (ignores `prev`) → 3 fails.
- M7: hook identity is the command alone → 8 fails.
- M8: result built by mutating `current` in place → 11 fails (frozen input).
- M9: invalid `current.permissions.allow` coerced to `[]` → 13 fails.
- M10: a non-object hook group is skipped instead of rejected → 13 fails.
- M11: a group whose `hooks` is not an array is treated as having no handlers → 13 fails.
- M12: `removed` is always the all-empty shape → 2, 3, 5 fail.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy-settings.js` is empty. Then the full suite once.
Commit: `test(agnostic-B5): settings set-merge tests (12 mutants killed), wired into npm test`.
Then write and commit `.planning/agnostic/B/B-03-SUMMARY.md` (format of `.planning/agnostic/A/A-02-SUMMARY.md`).
  </action>
  <verify>
Single-file run `# fail 0`, tests 1-14 present by name.
`git grep -c "project-deploy-settings.test.js" -- package.json` → `package.json:1`.
Full suite rc=0, `# fail 0`. `node scripts/agnostic-lint.js check` exit 0.
  </verify>
  <done>14 behaviours, 12 mutants killed and reverted, suite green.</done>
</task>

</tasks>

<verification>
- `git diff <plan-start-sha> -- get-shit-done/bin/project-deploy-files.js` shows additions only (plus the export line).
- Full suite rc 0, `# fail 0`; agnostic lint exit 0; `git log --oneline <plan-start-sha>..HEAD -- scripts/agnostic-lint/` empty.
- No file outside `files_modified` and `.planning/agnostic/B/` changed.
</verification>

<success_criteria>
The must_haves truths hold, each backed by a named test and at least one killed mutant.
</success_criteria>

<output>
`.planning/agnostic/B/B-03-SUMMARY.md`: outcome, commits, tests by name, mutation table, deviations, Self-Check.
</output>
