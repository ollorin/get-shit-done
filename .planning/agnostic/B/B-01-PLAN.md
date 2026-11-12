---
phase: agnostic-B
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - bin/install.js
  - bin/install.test.js
  - get-shit-done/bin/project-deploy-scan.js
  - get-shit-done/bin/project-deploy-scan.test.js
  - package.json
autonomous: true
requirements: [AGN-B1, AGN-B6]
must_haves:
  truths:
    - "The installer copies `get-shit-done/presets/**` byte-for-byte: no `~/.claude/` rewrite, no attribution processing, no `.md` to `.toml` conversion; every other `.md` is rewritten exactly as before"
    - "`scanText` / `scanDir` report every token-shaped string by file, pattern id and line, never the matched text; `npm test` fails when a file under `get-shit-done/presets/` contains one"
    - "No test writes outside `os.tmpdir()`; no committed file contains a token-shaped literal (the scan of the module and its test file returns zero hits)"
  artifacts:
    - path: bin/install.js
      provides: "`copyDirVerbatim`, `copyWithPathReplacement(..., opts.verbatimDirs)`, both exported"
    - path: get-shit-done/bin/project-deploy-scan.js
      provides: "SECRET_PATTERNS, scanText, scanDir"
    - path: get-shit-done/bin/project-deploy-scan.test.js
      provides: "pattern, directory, repo-presets and self-scan tests, listed in package.json `test`"
  key_links:
    - from: "bin/install.js get-shit-done copy call (currently line 1553)"
      to: copyDirVerbatim
      via: "`{ verbatimDirs: ['presets'] }` fifth argument"
      pattern: "verbatimDirs"
e2e_flows: []
---

<objective>
Phase B1 + B6 (design: `~/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md` lines 203-234). B1: presets survive install unmodified. B6: the secret scanner that B-04 runs over rendered output and `npm test` runs over `get-shit-done/presets/`.

`get-shit-done/presets/` does not exist yet (Phase C creates it). Do not create it, not even temporarily.
</objective>

<executor_rules>
- Work only in `~/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `~/igaming-platform`, `~/.claude`, `~/get-shit-done`. Tests create every file under `fs.mkdtempSync(path.join(os.tmpdir(), ...))` and remove it in `afterEach`.
- Forbidden: `npm run install:gsd`, `node bin/install.js` without a scratch cwd, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Do not edit Phase A files: `scripts/agnostic-lint*`, `scripts/agnostic-lint/*`, `get-shit-done/bin/project-profile*.js`, `get-shit-done/templates/product-brief.md`, `get-shit-done/templates/stack-profile.md`, `get-shit-done/references/project-context.md`. Before editing `package.json` run `git status --short -- package.json`; if it is not empty, stop and report (another writer is active).
- One test file: `NODE_PATH=$HOME/get-shit-done/node_modules node --test <file>`. Full suite (once, in Task 4): `cd ~/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-B01.log 2>&1; echo rc=$?`, then read the last 15 lines only. Success is rc=0 and `# fail 0` plus the named tests present; no numeric pass threshold.
- `bin/install.js` is 2105 lines: read ONLY 651-700 (`copyWithPathReplacement`), 1541-1558 (call site), 2103-2105 (exports). `bin/install.test.js`: read 22-110 (helpers, `runInstall`) and 363-450 (scratch-repo pattern). Locate by quoted anchor text if lines moved.
- Lint: `node scripts/agnostic-lint.js check` must exit 0 without regenerating the baseline. `bin/install.js` and every non-test file in `get-shit-done/bin/` are in scope, so new lines (code and comments) carry no vendor, product or tool names. Pattern ids in the scan module are the neutral lowercase ids given below, verbatim.
- Never write a token-shaped literal in any file. Tests build such strings at runtime by concatenation (`'gh' + 'p_' + ...`).
- CommonJS, `'use strict'`, node built-ins only, no `throw` across a module boundary, comments only for a non-obvious constraint.
- Commit per task: `git add -f <paths>` then `git commit -m "<msg>" -- <paths>`. Check with `git show --stat HEAD -- <paths>`; ignore the untracked `.audit/`. Trailers on every commit:
  `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
</executor_rules>

<tasks>

<task type="auto">
  <name>Task 1: installer copies presets/ verbatim</name>
  <files>bin/install.js</files>
  <action>
Three edits, nothing else in the file changes.

1. Directly above `function copyWithPathReplacement(` (its doc comment stays attached to it) add:

```js
function copyDirVerbatim(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDirVerbatim(srcPath, destPath);
    else if (entry.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}
```

2. `copyWithPathReplacement(srcDir, destDir, pathPrefix, runtime)` gains a fifth parameter `opts`. First statement of the body: `const verbatimDirs = (opts && opts.verbatimDirs) || [];`. The directory branch (currently lines 674-675) becomes: if `verbatimDirs.includes(entry.name)` call `copyDirVerbatim(srcPath, destPath)`, else the existing recursive call, unchanged and WITHOUT `opts` (the name matches only at the top level of the call that passed it).

3. Call site: the line `copyWithPathReplacement(skillSrc, skillDest, pathPrefix, runtime);` (currently 1553, the `get-shit-done` copy) gets the fifth argument `{ verbatimDirs: ['presets'] }`. The two other callers (commands at 1533, skills at 1636) stay as they are.

4. `module.exports` (last line): append `copyWithPathReplacement, copyDirVerbatim`.

Commit: `feat(agnostic-B1): installer copies get-shit-done/presets byte-for-byte`.
  </action>
  <verify>
`node -e "const m=require('./bin/install.js');console.log(typeof m.copyDirVerbatim, typeof m.copyWithPathReplacement)"` prints `function function` and nothing else.
`NODE_PATH=$HOME/get-shit-done/node_modules node --test bin/install.test.js` → `# fail 0`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>Three call-site-level edits plus the export; existing installer tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: installer tests for the verbatim copy</name>
  <files>bin/install.test.js</files>
  <behavior>
Append one `describe('presets/ is copied byte-for-byte (agnostic-B1)', ...)` at the end of the file (640 lines now; stays far under 1,500). Tier T2. Behaviours 1-3 layer unit (call the exported function on tmp dirs), 4 layer CLI (scratch-repo install, the pattern at lines 363-450). Compare with `Buffer.equals` on `fs.readFileSync` without an encoding.

Fixture text `MD` = a string holding `~/.claude/get-shit-done/x.md` on one line, then a blank line, then `Co-Authored-By: Someone <someone@example.com>`.

1. ADD. Source tree `a.md` (MD), `presets/demo/CLAUDE.md` (MD), `presets/demo/nested/r.md` (MD), `presets/demo/h.js`. `copyWithPathReplacement(src, dest, './.claude/', 'claude', { verbatimDirs: ['presets'] })` → `dest/a.md` contains `./.claude/get-shit-done/x.md` and no `~/.claude/`; the three preset files are byte-equal to their sources.
2. ADD. Top-level only and default unchanged: (a) the same call with four arguments rewrites `presets/demo/CLAUDE.md` (no `~/.claude/` left in it); (b) with the option, a deeper `sub/presets/x.md` (MD) is rewritten.
3. ADD. Runtime `'gemini'`, source tree holding only `presets/demo/CLAUDE.md`, option passed → destination has `presets/demo/CLAUDE.md` byte-equal and no `.toml` file anywhere under `dest`.
4. ADD. Scratch repo copy as in lines 373-384, plus `get-shit-done/presets/demo/CLAUDE.md` (MD) written into the scratch repo before install. `runInstall(scratchTarget, { installJsPath })` succeeds; `<scratchTarget>/.claude/get-shit-done/presets/demo/CLAUDE.md` is byte-equal to the scratch source; `gsd-file-manifest.json` in `<scratchTarget>/.claude` has `files['get-shit-done/presets/demo/CLAUDE.md']` equal to the sha256 hex of the source bytes.
5. REUSE `bin/install.test.js:394-427` (skills install asserts path-prefix replacement on a non-preset `.md`): regression for the untouched rewrite path. 0 tests added.
  </behavior>
  <action>
Write the describe block; reuse the file's `createScratchDir`, `cleanup`, `copyDirRecursive`, `runInstall`. Run the file.

Mutation proof (edit `bin/install.js`, run this file, confirm the named tests fail, revert; record in SUMMARY):
- M1: remove the fifth argument at the call site → 4 fails.
- M2: `copyDirVerbatim` body calls `copyWithPathReplacement(srcDir, destDir, './.claude/', 'claude')` → 1, 3, 4 fail.
- M3: pass `opts` in the recursive call → 2b fails.

After the last revert `git diff --stat -- bin/install.js` is empty.
Commit: `test(agnostic-B1): presets byte-copy install tests (3 mutants killed)`.
  </action>
  <verify>
`NODE_PATH=$HOME/get-shit-done/node_modules node --test bin/install.test.js` → `# fail 0`, tests 1-4 present by name.
`git diff --stat -- bin/install.js` empty.
  </verify>
  <done>4 behaviours added, 3 mutants killed and reverted.</done>
</task>

<task type="auto">
  <name>Task 3: secret scan module</name>
  <files>get-shit-done/bin/project-deploy-scan.js</files>
  <action>
Create the module (target ≤ 90 lines). Exports `{ SECRET_PATTERNS, scanText, scanDir }`.

`SECRET_PATTERNS` (array of `{ id, re }`, this order, regexes without the `g` flag):

| id | regex |
|---|---|
| `vcs_token` | `/\bgh[pousr]_[A-Za-z0-9]{36,}/` |
| `vcs_fine_grained_token` | `/\bgithub_pat_[A-Za-z0-9_]{22,}/` |
| `cloud_access_key_id` | `/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/` |
| `chat_token` | `/\bxox[abprs]-[A-Za-z0-9-]{10,}/` |
| `llm_api_key` | `/\bsk-[A-Za-z0-9_-]{20,}/` |
| `live_api_key` | `/\b[sr]k_live_[A-Za-z0-9]{16,}/` |
| `maps_api_key` | `/\bAIza[0-9A-Za-z_-]{35}/` |
| `registry_token` | `/\bnpm_[A-Za-z0-9]{36}\b/` |
| `signed_token` | `/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/` |
| `private_key_block` | `/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/` |

- `scanText(text)` → `[{ pattern, line }]`: split on `\n`, 1-based line numbers, one entry per (line, pattern) that matches, ordered by line then by pattern order. `text` may be a string or a Buffer (a Buffer is decoded as `latin1` so no byte is lost). The result never contains the matched text.
- `scanDir(dir)` → `{ files_scanned, hits: [{ file, pattern, line }] }`: recursive over every regular file including dotfiles; skips directories named `node_modules` and `.git`; reads each file as a Buffer; `file` is the path relative to `dir` with `/` separators; hits sorted by file, then line, then pattern order. `dir` absent → `{ files_scanned: 0, hits: [] }`.

Commit: `feat(agnostic-B6): secret-pattern scanner (scanText, scanDir)`.
  </action>
  <verify>
`node -e "const s=require('./get-shit-done/bin/project-deploy-scan.js');console.log(s.SECRET_PATTERNS.length, JSON.stringify(s.scanDir('/nonexistent-dir')))"` prints `10 {"files_scanned":0,"hits":[]}`.
`node scripts/agnostic-lint.js check` → exit 0.
  </verify>
  <done>Module exists with the 10 patterns; lint at baseline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: secret scan tests, repo presets scan in npm test</name>
  <files>get-shit-done/bin/project-deploy-scan.test.js, package.json</files>
  <behavior>
All ADD (`git grep -n project-deploy-scan -- '*.test.js'` is empty). Tier T1 (guardrail). Layer unit; 3 and 5b use a tmp dir. `node:test` + `node:assert`.

Token builders (runtime concatenation only; `R = 'a1B2'`):
`vcs_token`: `'gh' + 'p_' + R.repeat(9)`; `vcs_fine_grained_token`: `'github' + '_pat_' + 'a1B2_'.repeat(5)`; `cloud_access_key_id`: `'AK' + 'IA' + 'A1B2'.repeat(4)`; `chat_token`: `'xo' + 'xb-' + '1234567890-abcdef'`; `llm_api_key`: `'s' + 'k-' + R.repeat(6)`; `live_api_key`: `'s' + 'k_live_' + R.repeat(4)`; `maps_api_key`: `'AI' + 'za' + 'a1B2_'.repeat(7)`; `registry_token`: `'np' + 'm_' + R.repeat(9)`; `signed_token`: `['ey' + 'J' + R.repeat(3), 'ey' + 'J' + 'c3D4'.repeat(3), 'e5F6'.repeat(3)].join('.')`; `private_key_block`: `'-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----'`.

1. Each of the 10 builders (loop over a table keyed by pattern id): text `"line one\nline two\nkey = " + token + "\n"` → `scanText` deep-equals `[{ pattern: id, line: 3 }]`, and `JSON.stringify(result)` does not include `token`.
2. Negatives, each → `[]`: `"${VCS_TOKEN}"`; `"API_KEY="`; a 64-char lowercase hex string (`'0123456789abcdef'.repeat(4)`); `'gh' + 'p_' + 'abc'`; `'task-' + R.repeat(8)`; `'-----BEGIN CERTIFICATE-----'`.
3. `scanDir` on a tmp tree: `a/b/conf.txt` (token on line 2), `.env.example` (token on line 1), `node_modules/x.txt` (token), `clean.md` → `files_scanned === 3`, hits deep-equal `[{ file: '.env.example', pattern, line: 1 }, { file: 'a/b/conf.txt', pattern, line: 2 }]`. Absent dir → `{ files_scanned: 0, hits: [] }`.
4. A Buffer `[0xff, 0xfe, ...Buffer.from(' ' + token + ' '), 0xff]` → one hit.
5. Presets scan through one local helper `presetHits(presetsRoot)` = `scanDir(presetsRoot).hits`; the root is always a parameter. (a) `presetHits(path.join(__dirname, '..', 'presets'))` deep-equals `[]`; test name `5 repo presets contain no token-shaped string`. (b) Demonstrated failure on a tmp presets root: `<tmp>/zz-probe/x.txt` holding a runtime-built `vcs_token` → `presetHits(tmp)` deep-equals `[{ file: 'zz-probe/x.txt', pattern: 'vcs_token', line: 1 }]`.
6. Self-scan: `scanText(fs.readFileSync(<module>))` and `scanText(fs.readFileSync(__filename))` both `[]`.
  </behavior>
  <action>
Write the test file. In `package.json` `scripts.test` insert ` get-shit-done/bin/project-deploy-scan.test.js` immediately after `get-shit-done/bin/project-profile.test.js`; change nothing else.

Mutation proof (edit the module, run the file, confirm, revert; record in SUMMARY):
- M1: delete the `vcs_token` entry → 1 fails.
- M2: add `match: m[0]` to each hit → 1 fails.
- M3: `scanDir` skips names starting with `.` → 3 fails.
- M4: `scanDir` does not recurse into subdirectories → 3, 5b fail.
- M5: `scanText` reports `line: 1` always → 1 fails.
- M6: `scanText` returns `[]` when given a Buffer → 4 fails.
- M7 (test file, reverted there): `presetHits` ignores its argument and scans a fixed empty directory → 5b fails.

No live probe inside the repo. Test 5b on a tmp root is the proof that the presets scan can fail; nothing is created under `get-shit-done/presets/` at any point, and `git status --short` never shows a `presets` entry.

After the last revert `git diff --stat -- get-shit-done/bin/project-deploy-scan.js` is empty. Then the full suite once.
Commit: `test(agnostic-B6): secret scan tests (7 mutants killed), wired into npm test`.
Then write `.planning/agnostic/B/B-01-SUMMARY.md` (format of `.planning/agnostic/A/A-02-SUMMARY.md`) and commit it the same way.
  </action>
  <verify>
Single-file run `# fail 0`, tests 1-6 present by name.
`git grep -c "get-shit-done/bin/project-deploy-scan.test.js" -- package.json` → `package.json:1`.
Full suite rc=0, `# fail 0`. `node scripts/agnostic-lint.js check` exit 0. `ls get-shit-done/presets` fails (directory absent).
  </verify>
  <done>6 behaviours, 7 mutants killed and reverted, nothing written inside the repo outside `files_modified`, suite green.</done>
</task>

</tasks>

<verification>
- `git diff <plan-start-sha> --stat -- bin/install.js`: one new function, one changed signature and branch, one call-site argument, one export line.
- Full suite rc 0, `# fail 0`; agnostic lint exit 0 with `scripts/agnostic-lint/baseline.json` not modified by this plan (`git log --oneline <plan-start-sha>..HEAD -- scripts/agnostic-lint/` is empty).
- No file outside `files_modified` and `.planning/agnostic/B/` changed.
</verification>

<success_criteria>
The must_haves truths hold, each backed by a named test and at least one killed mutant.
</success_criteria>

<output>
`.planning/agnostic/B/B-01-SUMMARY.md`: outcome, commits, tests by name, mutation table, deviations, Self-Check.
</output>
