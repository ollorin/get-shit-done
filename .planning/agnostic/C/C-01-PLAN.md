---
phase: agnostic-C
plan: 01
type: execute
wave: 1
depends_on: ["B-04"]
files_modified:
  - "get-shit-done/presets/igaming/** (new, 54 files)"
  - get-shit-done/bin/preset-igaming.test.js
  - scripts/agnostic-lint.test.js
  - package.json
autonomous: true
requirements: [AGN-C1]
must_haves:
  truths:
    - "`get-shit-done/presets/igaming/` holds the 50 tracked igaming project files of commit `95a02959e5fa464f3bcce11378c803f7b86ec76d`: 49 deployable files byte-equal to the commit's blobs (or to their recorded redacted form), plus the verbatim settings file"
    - "Rendering the preset reproduces `golden.sha256` for rules, hooks, skills, canaries and CLAUDE.md (byte-equal, executable bits kept); the settings fragment equals the snapshot's allow/deny/ask as sets and its hook arrays in order"
    - "No untracked or ignored igaming file is in the preset, and the preset contains no token-shaped string"
    - "The agnostic lint does not count anything under `get-shit-done/presets/`, and a test fails if a scope starts to match it"
  artifacts:
    - path: get-shit-done/presets/igaming/preset.json
      provides: "flat preset: 49 `whole`, `render: false` entries + `settings_fragment`"
    - path: get-shit-done/presets/igaming/golden.sha256
      provides: "50 lines `<sha256>  <project-relative dest>` computed from the pinned commit"
    - path: get-shit-done/presets/igaming/README.md
      provides: "pinned SHA, layout, redaction record, what is not deployed"
    - path: get-shit-done/bin/preset-igaming.test.js
      provides: "golden tests G1-G6, listed in package.json `test`"
    - path: scripts/agnostic-lint.test.js
      provides: "scope test L1-L2 for presets/"
  key_links:
    - from: get-shit-done/bin/preset-igaming.test.js
      to: get-shit-done/bin/project-deploy-render.js
      via: "`renderPreset(PRESET, IGAMING_VALUES)`"
      pattern: "renderPreset"
    - from: get-shit-done/bin/project-deploy-scan.test.js
      to: get-shit-done/presets/
      via: "existing test `5 repo presets contain no token-shaped string` (vacuous until this plan)"
      pattern: "presetHits"
e2e_flows: []
---

<objective>
Phase C1 of `/Users/ollorin/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md` (sections 4.4-4.6): snapshot first, factor later. A flat preset, no `extends`, no packs (Phase F). The Charlotte MCP allow rules and the 10 absolute-path allow rules stay verbatim in the fragment.
</objective>

<precondition>
Run only after `.planning/agnostic/B/B-04-SUMMARY.md` exists and `git status --short -- package.json get-shit-done/bin scripts` prints nothing. Otherwise stop and report (B-04 owns `package.json` and `get-shit-done/bin/project-deploy*` until its summary is committed).
</precondition>

<decisions>
1. **Layout has no `.claude/` directory inside the preset.** `get-shit-done/bin/hooks/gsd-protect-managed-files.js:45-49` (`isProtectedConfigPath`) blocks agent writes to any `.claude/hooks/` or `.claude/settings*.json` path, so the snapshot lives at `rules/`, `hooks/`, `skills/`, `canaries/`, `CLAUDE.md`, and `preset.json` maps each to its project path. This is also the layout of design 4.4.
2. **CLAUDE.md is `kind: whole`, `render: false`.** The snapshot has no marker lines, so this is the design's "byte-equal with `--no-markers`". Markers are added at cutover (Phase H).
3. **Settings.** `get-shit-done/bin/project-deploy-render.js:9` allows only `permissions` and `hooks` in a fragment. `settings.snapshot.json` is the verbatim file (golden line `.claude/settings.json`, never deployed); `settings.fragment.json` is derived from it. The four other keys (`env`, `enableAllProjectMcpServers`, `enabledPlugins`, `sandbox`) are NOT deployed by the Phase B engine. G5 pins that exact list so a change is seen. **Phase H must carry these four keys** (the README `## Settings` and the SUMMARY say so, and the G5 assertion message names it).
4. **Hook canaries are included** (`canaries/canaries.jsonl`, `canaries/run-canaries.sh` → `scripts/validation/hook-canaries/`). Reason: Phase F1 parameterises the hooks and needs rows that match the hooks of the same commit. They are data in this phase: the runner needs `jq`, `perl`, macOS `date -v` and hooks under `~/.claude`, so it is not run by the fork's `npm test` until F1.
5. **Lint scope.** No scope in `scripts/agnostic-lint.js:13-26` matches `get-shit-done/presets/`, so presets are already uncounted. No code change; Task 3 pins it with a test.
6. **Planner measurement at the pinned SHA** (fork `58a50a5`; re-measured for counts at `95a02959e`, the repin of the revision pass: `git diff --stat e319843b 95a02959e -- CLAUDE.md .claude scripts/validation/hook-canaries` changes only `CLAUDE.md`, still 50 files, 228 lines, 1 absolute path; `scanDir` is re-run by Task 1): 50 files, `scanDir` 0 hits, no `{{dot.path}}` placeholder in any file, `renderPreset` ok, `planDeploy init` ok with 50 changes. Absolute `/Users/ollorin` strings: 10 in the settings file, 1 in CLAUDE.md, 122 in `canaries.jsonl`; kept verbatim (they become `{{project.root}}` in Phase F).
</decisions>

<threat_model>
The preset carries permissions and hooks, so it is a guardrail path. No money mutation and no database: the atomicity control is B-04's (tests A2, A8, REUSE).

| # | Threat | Control | Proof |
|---|---|---|---|
| T1 | An untracked or ignored igaming file (`settings.local.json`, `.mcp.json`, `.env*`) enters the fork | source is `git archive <sha>` only: a commit object holds tracked content only; the working tree is never read | Task 1 verify (file count 50, `shasum -c` against the archive); G2 (no stray file) |
| T2 | A token-shaped string enters the fork | `scanDir` over the preset before commit, redact + record on a hit | Task 1 verify; `project-deploy-scan.test.js` test `5 repo presets contain no token-shaped string` and `5b` |
| T3 | The snapshot drifts from the pinned commit, or a later factoring changes bytes | `golden.sha256` computed from the archive, not from the copy | G3, mutants M1, M7 |
| T4 | A hook loses its executable bit, so a deployed guardrail silently never runs | mode assertion | G4, mutant M2 |
| T5 | The fragment drops a deny/ask rule or reorders hooks | set equality with size check; ordered deep-equal of hooks | G5, mutants M3, M4 |
| T6 | An executor writes into the igaming repo | `git archive` and `git ls-tree` are read-only; rule below | executor rules |
| Residual | `project init --preset igaming` in another project would deploy igaming's mutating allow rules (`rm -rf <igaming>/.tmp/*` and others) | not closed here: the preset is the igaming snapshot only; README states it; the reviewed base subset is Phase F4 | none (stated limit) |
</threat_model>

<executor_rules>
- Work only in `/Users/ollorin/get-shit-done-agnostic` (branch `exp/agnostic`). The igaming repo `/Users/ollorin/igaming-platform` is READ-ONLY and only through `git -C /Users/ollorin/igaming-platform archive|ls-tree|show <sha>`. Never read its working tree, never `cd` into it, never touch `~/.claude` or `~/get-shit-done`.
- Forbidden: `npm run install:gsd`, `node bin/install.js`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout`, `git restore`, `--no-verify`, `gsd-tools project init|sync` with a `--root` outside `os.tmpdir()`.
- Session hooks reject: recursive `grep`/`rg` (use `git grep -n <pat> -- <path>`), and shell commands that write to a path containing `.claude/hooks` or `.claude/settings`. Use the commands below as written; they never name those paths.
- Never Read `canaries/canaries.jsonl` (145 KB) or `settings.snapshot.json` in full; use `wc`, `shasum`, `node -e` one-liners. Do not open the copied rules, hooks or skills: they are opaque bytes in this plan.
- Mutants: back the file up to `/tmp/c01-bak/` first (`cp -p`), mutate, run the single test file, confirm the named test fails, restore with `cp -p`, then `git status --short -- <dir>` prints nothing.
- One test file: `cd /Users/ollorin/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules node --test <file>`. Full suite once, in Task 3: `NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-C01.log 2>&1; echo rc=$?`, read the last 15 lines only.
- Tests: `node:test`, `node:assert`, CommonJS, `'use strict'`, built-ins only, tmp dirs under `os.tmpdir()` removed in `afterEach`. No token-shaped literal anywhere.
- Commit per task: `git add -f <paths>` then `git commit -m "<msg>" -- <paths>`; ignore untracked `.audit/`. Trailers on every commit:
  `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
</executor_rules>

<tasks>

<task type="auto">
  <name>Task 1: snapshot the tracked igaming files at the pinned SHA, scan, write preset.json, fragment, golden, README</name>
  <files>get-shit-done/presets/igaming/**</files>
  <action>
Run exactly (each line is one command; all were run by the planner against `/tmp` and exit 0):

```
SHA=95a02959e5fa464f3bcce11378c803f7b86ec76d; I=/Users/ollorin/igaming-platform; P=/Users/ollorin/get-shit-done-agnostic/get-shit-done/presets/igaming; RAW=/tmp/igaming-raw-C01
rm -rf $RAW; mkdir -p $RAW $P/canaries
git -C $I archive $SHA CLAUDE.md .claude scripts/validation/hook-canaries | tar -x -C $RAW
git -C $I archive $SHA CLAUDE.md .claude | tar -x -C $P -s '|^\.claude/||'
git -C $I archive $SHA scripts/validation/hook-canaries | tar -x -C $P/canaries --strip-components 3
mv $P/settings.json $P/settings.snapshot.json
git -C $I ls-tree -r --name-only $SHA -- CLAUDE.md .claude scripts/validation/hook-canaries | (cd $RAW && xargs shasum -a 256) > $P/golden.sha256
```

(`SHA`, `I`, `P`, `RAW` must be set again in every later shell call.) `$RAW` is the pristine archive and the only source of `golden.sha256`.

Then generate `preset.json` and `settings.fragment.json` from those two files (one command):

```
node -e "const fs=require('fs');const P=process.argv[1];const dests=fs.readFileSync(P+'/golden.sha256','utf8').trim().split('\n').map((l)=>l.slice(66));const files=dests.filter((d)=>!d.endsWith('/settings.json')).map((d)=>({src:d.replace(/^\.claude\//,'').replace(/^scripts\/validation\/hook-canaries\//,'canaries/'),dest:d,kind:'whole',render:false}));fs.writeFileSync(P+'/preset.json',JSON.stringify({name:'igaming',version:'1',description:'Verbatim snapshot of the igaming project files at a pinned commit (see README.md)',files,settings_fragment:'settings.fragment.json'},null,2)+'\n');const s=JSON.parse(fs.readFileSync(P+'/settings.snapshot.json','utf8'));fs.writeFileSync(P+'/settings.fragment.json',JSON.stringify({permissions:{allow:s.permissions.allow,deny:s.permissions.deny,ask:s.permissions.ask},hooks:s.hooks},null,2)+'\n');console.log(files.length)" $P
```
Expected output `49`.

Secret scan (mandatory, before the README and before any commit):
```
node -e "console.log(JSON.stringify(require('./get-shit-done/bin/project-deploy-scan.js').scanDir(process.argv[1])))" get-shit-done/presets/igaming
```
Expected `{"files_scanned":53,"hits":[]}`. If `hits` is not empty, for each hit: in the preset copy only, replace the matched token on that line with `<redacted:PATTERN_ID>` (Edit tool; never print the token), recompute that file's golden line with `shasum -a 256` on the redacted copy and replace the line in `golden.sha256`, re-derive the fragment if the file was the settings snapshot, and record `file, line, pattern id` in the README. Re-run the scan until `hits` is `[]`.

Write `get-shit-done/presets/igaming/README.md` (≤ 60 lines), sections in this order:
- `# igaming preset (snapshot)`: source repo name, pinned SHA (full 40 hex), branch `feature/codebase-review-hardening`, snapshot date, "tracked files only, taken with `git archive`".
- `## Layout`: the src → dest mapping (`CLAUDE.md`; `rules/` → `.claude/rules/`; `hooks/` → `.claude/hooks/`; `skills/` → `.claude/skills/`; `canaries/` → `scripts/validation/hook-canaries/`), file counts (1, 12, 19, 15, 2), all `render: false`.
- `## Settings`: `settings.snapshot.json` is the verbatim file and is never deployed; `settings.fragment.json` is its `permissions` and `hooks`; the keys `env`, `enableAllProjectMcpServers`, `enabledPlugins`, `sandbox` are not deployed by the current engine; deployed settings are set-equal, not byte-equal; the line `Phase H must carry these four keys (env, enableAllProjectMcpServers, enabledPlugins, sandbox): the engine does not deploy them.`
- `## Redactions`: `None. scanDir: 0 hits over <n> files at this SHA.` or one line per redaction (file, line, pattern id) and the sentence "the golden compares against the redacted form for these files".
- `## Not changed in this snapshot`: absolute user paths are kept verbatim (counts from decision 6) until Phase F turns them into `{{project.root}}`; the Charlotte MCP allow rules stay in the fragment until the pack exists (Phase F); canaries are data until Phase F1.
- `## Do not use for a new project`: the fragment contains mutating allow rules scoped to the igaming checkout.
- `## Re-verify against the source`: the two `git archive` / `shasum -a 256 -c` commands from `<verify>`.

Commit: `feat(agnostic-C1): igaming snapshot preset at 95a02959e (49 files, settings fragment, golden)`.
  </action>
  <verify>
`cd /tmp/igaming-raw-C01 && shasum -a 256 -c --status /Users/ollorin/get-shit-done-agnostic/get-shit-done/presets/igaming/golden.sha256; echo rc=$?` → `rc=0` (with redactions: only the README-listed files fail).
`wc -l get-shit-done/presets/igaming/golden.sha256` → 50.
`node -e "const r=require('./get-shit-done/bin/project-deploy-render.js').renderPreset(process.argv[1],{});const {sha256}=require('./get-shit-done/bin/project-deploy-files.js');const g=new Map(require('fs').readFileSync(process.argv[1]+'/golden.sha256','utf8').trim().split('\n').map((l)=>[l.slice(66),l.slice(0,64)]));console.log(r.ok,r.files.length,r.files.filter((f)=>g.get(f.dest)!==sha256(f.content)).length,r.files.filter((f)=>f.mode&0o111).length)" get-shit-done/presets/igaming` → `true 49 0 11`.
`git ls-files get-shit-done/presets/igaming | wc -l` → 54. `git ls-files -s get-shit-done/presets/igaming/hooks get-shit-done/presets/igaming/canaries | grep -c '^100755'` → 11.
`git -C /Users/ollorin/igaming-platform status --short | wc -l` is the same number before and after the task (record both).
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>54 tracked preset files; golden derived from the archive; scan clean or redactions recorded; igaming repo untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: golden test for the snapshot (bytes, modes, settings sets, render with igaming values)</name>
  <files>get-shit-done/bin/preset-igaming.test.js, package.json</files>
  <behavior>
New file: no existing suite owns preset content (`git grep -n "presets/igaming" -- '*.test.js'` is empty). Tier T1 (no database in this repo; the guardrail rows of the threat model are covered by G4, G5). Layer: integration on the committed preset through the real `loadPreset` / `renderPreset` / `mergeSettings`.

Helpers at the top of the file:
- `PRESET = path.join(__dirname, '..', 'presets', 'igaming')`; `IGAMING_ROOT = '/Users/ollorin/igaming-platform'`; `IGAMING_VALUES = { project: { slug: 'igaming', root: IGAMING_ROOT } }`; `SETTINGS_DEST = '.claude/settings.json'`.
- `META = ['preset.json', 'README.md', 'golden.sha256', 'settings.fragment.json', 'settings.snapshot.json']`.
- `golden()` → `Map(dest → hex)`; every non-empty line must match `/^([0-9a-f]{64})  (.+)$/`, else `assert.fail`.
- `SRC_RULES = [['.claude/', ''], ['scripts/validation/hook-canaries/', 'canaries/']]`; `srcOf(dest)` = first rule whose prefix matches, replaced; else `dest`.
- `walk(dir)` → sorted relative file paths, `/` separators.

G1. ADD. `loadPreset(PRESET)` is ok; `name === 'igaming'`, `version === '1'`, `settings_fragment === 'settings.fragment.json'`; every file entry has `kind: 'whole'`, `render: false`, `capability: null`. README contains the full pinned SHA and the heading `## Redactions`.
G2. ADD. File list: set of `src` deep-equals `walk(PRESET)` minus `META`; set of `dest` deep-equals golden keys minus `SETTINGS_DEST`; every entry satisfies `src === srcOf(dest)`; counts by dest prefix: `.claude/rules/` 12, `.claude/hooks/` 19, `.claude/skills/` 15, `scripts/validation/hook-canaries/` 2, `CLAUDE.md` 1; golden has 50 lines.
G3. ADD. Byte equality: `renderPreset(PRESET, IGAMING_VALUES)` is ok with no errors; for every rendered file `sha256(content) === golden().get(dest)`; 49 files compared (assert the count so an empty loop cannot pass).
G4. ADD. Modes: the dests whose rendered `mode & 0o111` is non-zero deep-equal (sorted) the 10 golden dests matching `/^\.claude\/hooks\/[^/]+\.sh$/` plus `scripts/validation/hook-canaries/run-canaries.sh`.
G5. ADD. Settings (design 4.6 item 3): `sha256(settings.snapshot.json bytes) === golden().get(SETTINGS_DEST)`; fragment top-level keys deep-equal `['hooks', 'permissions']` (sorted); for each of `allow`, `deny`, `ask`: no duplicate in the fragment list, `new Set(fragment)` equals `new Set(snapshot)` (compare sorted arrays), sizes 289 / 19 / 3; `fragment.hooks` `deepStrictEqual` `snapshot.hooks` (order included); snapshot keys other than `permissions` and `hooks`, sorted, deep-equal `['enableAllProjectMcpServers', 'enabledPlugins', 'env', 'sandbox']`, with the assertion message `undeployed settings keys changed: Phase H must carry env, enableAllProjectMcpServers, enabledPlugins, sandbox (README ## Settings)`; `mergeSettings(null, null, rendered.settings)` is ok and its `settings` has the same three sets and `hooks` deep-equal to `snapshot.hooks`.
G6. ADD. Render with igaming values: copy `PRESET` to a tmp dir (`fs.cpSync(..., { recursive: true })`); in the copy's `settings.fragment.json` text replace every `IGAMING_ROOT` with `{{project.root}}` and assert exactly 10 replacements; `renderPreset(copy, IGAMING_VALUES).settings` deep-equals the committed fragment; `renderPreset(copy, { project: { root: '/elsewhere' } }).settings` does NOT deep-equal it; `renderPreset(copy, {})` is not ok with reason `missing config key: project.root`.
REUSE. Secret scan of `presets/`: `get-shit-done/bin/project-deploy-scan.test.js` tests `5 repo presets contain no token-shaped string` and `5b` (demonstrated failure). 0 tests added; test 5 stops being vacuous with Task 1.
REUSE. Installer byte-copy of `presets/`: `bin/install.test.js` `describe 'presets/ is copied byte-for-byte (agnostic-B1)'` (line 642). 0 tests added.
  </behavior>
  <action>
Write the test file (target ≤ 220 lines). In `package.json` `scripts.test` insert ` get-shit-done/bin/preset-igaming.test.js` immediately after `get-shit-done/bin/project-deploy.test.js`.

Mutation proof (each on preset data, backup → mutate → run → confirm → restore; record in SUMMARY):
- M1: append one byte to `hooks/lib/ShellParse.pm` → G3 fails.
- M2: `chmod -x` on `hooks/check-test-command.sh` → G4 fails.
- M3: delete the first `deny` string in `settings.fragment.json` → G5 fails.
- M4: swap the first two hook entries of `hooks.PreToolUse[0].hooks` in `settings.fragment.json` → G5 fails.
- M5: delete one entry of `files` in `preset.json` → G2 fails.
- M6: add a file `rules/extra.md` → G2 fails.
- M7: change one hex digit of the `CLAUDE.md` line in `golden.sha256` → G3 fails.
- M8: append a space to `settings.snapshot.json` → G5 fails.
- M9: duplicate the first `allow` string in `settings.fragment.json` → G5 fails (duplicate check).

After the last restore `git status --short -- get-shit-done/presets` prints nothing.
Commit: `test(agnostic-C1): igaming snapshot golden tests (9 mutants killed), wired into npm test`.
  </action>
  <verify>
Single-file run: `# fail 0`, G1-G6 present by name.
`git grep -c "get-shit-done/bin/preset-igaming.test.js" -- package.json` → `package.json:1`.
`NODE_PATH=$HOME/get-shit-done/node_modules node --test get-shit-done/bin/project-deploy-scan.test.js` → `# fail 0`.
  </verify>
  <done>6 behaviours, 9 mutants killed and restored.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: lint scope test (presets/ is never counted), full suite, SUMMARY</name>
  <files>scripts/agnostic-lint.test.js</files>
  <behavior>
Append `describe('presets/ is out of scope (agnostic-C1)', ...)` to the existing suite (it owns scope behaviour). Tier T1. Layer unit + tmp-dir integration with the file's existing `mkRoot`, `put`, `configure` helpers. `scripts/agnostic-lint.js` is NOT edited (decision 5).

L1. ADD. For each of `get-shit-done/presets/igaming/CLAUDE.md`, `.../rules/database.md`, `.../hooks/check-test-command.sh`, `.../skills/create-migration/SKILL.md`, `.../settings.fragment.json`, `.../PRODUCT-BRIEF.md`: no entry of `lint.SCOPES` matches the path. On the real repo root: the flattened `lint.listScopeFiles(<repo root>)` has no path starting with `get-shit-done/presets/`, while `git ls-files get-shit-done/presets` (via `execFileSync`) lists at least 50 files (so the assertion is not vacuous).
L2. ADD. Tmp root with `configure(root)` and a file `get-shit-done/presets/x/CLAUDE.md` containing lines that hit both fixture classes, plus a file `get-shit-done/templates/t.md` with one hit: `lint.scan(root, <compiled terms>, [])` reports the template file and has no key under `get-shit-done/presets/` in `denied` or `allowed`.
REUSE. Repo baseline unchanged: the existing test that runs `check` on the repo (run in the full suite) plus `node scripts/agnostic-lint.js check` exit 0 in `<verify>`. 0 tests added.
  </behavior>
  <action>
Append the describe block; run the file.

Mutation proof (edit `scripts/agnostic-lint.js`, run the file, confirm, restore from backup; record in SUMMARY):
- M1: add `{ id: 'presets', match: (p) => p.startsWith('get-shit-done/presets/') }` to `SCOPES` → L1, L2 fail.
- M2: widen the `templates` scope to `p.startsWith('get-shit-done/')` → L1, L2 fail.

After the restore `git diff --stat -- scripts/agnostic-lint.js scripts/agnostic-lint/` is empty. Then the full suite once.
Commit: `test(agnostic-C1): presets/ stays outside the agnostic lint scope (2 mutants killed)`.
Then write and commit `.planning/agnostic/C/C-01-SUMMARY.md` (format of `.planning/agnostic/B/B-01-SUMMARY.md`): outcome, pinned SHA, file counts, the line `Phase H must carry the four undeployed settings keys: env, enableAllProjectMcpServers, enabledPlugins, sandbox`, scan result and redaction list, commits, tests by name, mutation table, threat-model proof table, deviations, Self-Check.
  </action>
  <verify>
`NODE_PATH=$HOME/get-shit-done/node_modules node --test scripts/agnostic-lint.test.js` → `# fail 0`, L1 and L2 present.
Full suite `rc=0`, `# fail 0`. `node scripts/agnostic-lint.js check` → exit 0, and `git log --oneline <plan-start-sha>..HEAD -- scripts/agnostic-lint/ scripts/agnostic-lint.js` is empty.
`git status --short` shows only `.audit/`.
  </verify>
  <done>2 behaviours, 2 mutants killed, suite green, baseline untouched.</done>
</task>

</tasks>

<verification>
- `cd /tmp/igaming-raw-C01 && shasum -a 256 -c --status <fork>/get-shit-done/presets/igaming/golden.sha256` → rc 0 (fresh `git archive` of the pinned SHA).
- `git -C /Users/ollorin/igaming-platform log -1 --format=%H feature/codebase-review-hardening` may have moved on; the preset stays at the pinned SHA (design risk R2).
- Full suite rc 0; agnostic lint exit 0 with the baseline file unchanged.
- No file under `get-shit-done/presets/igaming` has a path segment starting with `.`.
</verification>

<success_criteria>
The must_haves truths hold, each backed by a named test and a killed mutant; every threat-model row except the stated residual has a passing proof.
</success_criteria>

<output>
`.planning/agnostic/C/C-01-SUMMARY.md`.
</output>
