---
phase: agnostic-A
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/agnostic-lint.js
  - scripts/agnostic-lint/terms.json
  - scripts/agnostic-lint/allowlist.json
  - scripts/agnostic-lint/baseline.json
  - scripts/agnostic-lint.test.js
  - package.json
autonomous: true
requirements: [AGN-A1]
must_haves:
  truths:
    - "`npm test` fails when any (file, class) denylist line count in an installable file rises above the committed baseline, and names the file and class"
    - "The baseline is produced only by `node scripts/agnostic-lint.js write-baseline` from the committed `terms.json` + `allowlist.json`; nobody types counts by hand"
    - "Upstream illustrative examples are allow-listed per (file, class) with a cap, and a hit above the cap counts as denied"
    - "A stale baseline (count dropped, or terms/allow-list changed without regenerating) also fails, so the ratchet stays tight"
    - "No existing agent, workflow, reference, template or bin file is modified"
  artifacts:
    - path: scripts/agnostic-lint.js
      provides: "scan / compare / report / check / write-baseline"
    - path: scripts/agnostic-lint/terms.json
      provides: "25-class term denylist"
    - path: scripts/agnostic-lint/allowlist.json
      provides: "70 capped (file, class) upstream-example entries"
    - path: scripts/agnostic-lint/baseline.json
      provides: "generated per-file counts + inputs hash"
    - path: scripts/agnostic-lint.test.js
      provides: "fixture tests + repo-at-baseline test, listed in package.json `test`"
  key_links:
    - from: package.json
      to: scripts/agnostic-lint.test.js
      via: "explicit file list in scripts.test (tests are NOT auto-discovered)"
      pattern: "scripts/agnostic-lint.test.js"
e2e_flows: []
---

<objective>
Phase A1 of the project-agnostic GSD work (design: `~/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md` section 4.3). Add a ratchet lint that counts project-specific terms in installable files and fails `npm test` when a count rises.

Why a new script (MANDATE-8): no existing test or gate looks at term content. `get-shit-done/bin/prompt-budget.js` measures preamble size only; `git grep` for a term gate in `package.json` scripts.test finds none.

Output: lint script, denylist, allow-list, generated baseline, tests wired into `npm test`. Zero behaviour change.
</objective>

<execution_context>
@get-shit-done/workflows/execute-plan.md
@get-shit-done/templates/summary.md
</execution_context>

<executor_rules>
- Work only in `~/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `~/igaming-platform`, `~/.claude`, `~/get-shit-done`.
- Forbidden: `npm run install:gsd`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Full suite: `cd ~/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-A01.log 2>&1; echo rc=$?` then read only the last 15 lines (`# tests`, `# pass`, `# fail`). Baseline before this plan: 1683 pass, 0 fail. Pass counts: one `it` per numbered behaviour; success is `# fail 0` plus the named tests present in the output (no numeric `# pass` threshold).
- Single file: `NODE_PATH=$HOME/get-shit-done/node_modules node --test scripts/agnostic-lint.test.js`.
- Do NOT read `get-shit-done/bin/gsd-tools.js` or the design doc in full; everything needed is in this plan.
- Commit per task with `git add -f <paths>` + `git commit -m "<msg>" -- <paths>` (the SUMMARY is committed the same way). Verify steps that run after a commit use `git show --stat HEAD -- <paths>`, never `git status`/`git diff` against HEAD; ignore the untracked `.audit/` directory. Every commit message ends with these trailers (Haiku executors use `Claude Haiku`):
  `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
- Code style: CommonJS, `'use strict'`, no new dependencies (node built-ins only), comments only for non-obvious constraints.
</executor_rules>

<spec>

## Scopes (installable files; ids are fixed)

| id | files |
|---|---|
| `agents` | `agents/*.md`, NOT recursive (`agents/v2/` is excluded) |
| `commands` | every file under `commands/`, recursive |
| `workflows` | every file under `get-shit-done/workflows/`, recursive |
| `references` | every file under `get-shit-done/references/`, recursive |
| `templates` | every file under `get-shit-done/templates/`, recursive |
| `bin` | every file under `get-shit-done/bin/`, recursive, except `*.test.js` |
| `install` | `bin/install.js` |
| `hook-config` | `hook-config.json` |

Enumerate candidate files with `git ls-files -z` run in `<root>` (so untracked or generated files can never cause a false RISE/STALE; files listed by git but absent on disk are skipped). Only when `<root>` is not a git work tree (a `--root` fixture without `.git`; detect with `fs.existsSync(path.join(root, '.git'))`) fall back to walking the disk with `fs.readdirSync(..., { withFileTypes: true })`. Both paths then apply the same scope rules: skip any path with a segment named `node_modules` or starting with `.`; a missing scope directory/file yields no files (fixtures rely on this). Paths are repo-relative with `/`, sorted. Everything else (`scripts/`, `tests/`, `docs/`, `mcp-servers/`, `hooks/`, `.planning/`) is out of scope.

Expected file counts on the current tree: agents 23, commands 34, workflows 36, references 29, templates 36, bin 63, install 1, hook-config 1.

## Count unit

For each file and class: the number of **lines** on which the class regex matches at least once (same unit as `git grep -c`). Split on `\n`.

## `scripts/agnostic-lint/terms.json`

`{ "version": 1, "classes": [ { "id", "label", "pattern", "flags" } ] }`, 25 classes in this order. `pattern` below is written as JS regex source; in JSON every backslash is doubled (`\b` → `"\\b"`, `\.` → `"\\."`, `\d` → `"\\d"`, `\/` is not needed: write `/` plainly). `flags` is `"i"` or `""`.

| id | pattern | flags |
|---|---|---|
| igaming | `igaming` | i |
| game | `casino\|\bslots?\b\|wager\|jackpot\|betting\|sportsbook\|\bPVP\b\|crash game\|bladebro\|sweeps\|\bbonus` | i |
| reg | `\bKYC\b\|\bAML\b\|\bRNG\b\|\bRTP\b\|fairness` | |
| money | `money\|payment\|wallet\|withdraw\|deposit` | i |
| owner | `\bCEO\b` | |
| supabase | `supabase` | i |
| deno | `\bdeno\b` | i |
| edgefn | `edge function\|edge-function\|edge runtime` | i |
| redis | `redis\|upstash` | i |
| charlotte | `charlotte` | i |
| nx | `\bnx\b` | |
| pnpm | `pnpm` | |
| postgres | `postgres\|psql\|\bRLS\b\|pg_cron\|plpgsql` | i |
| orbstack | `orbstack\|colima\|orbctl` | i |
| email | `\bSES\b\|\bResend\b\|Postmark` | |
| telegram | `telegram` | i |
| docker | `docker` | i |
| authtech | `\bKong\b\|\bJWT\b\|\bTOTP\b\|\b2FA\b` | |
| frontend | `Next\.js\|\bReact\b\|flutter\|Tailwind\|vitest\|playwright\|\bjest\b` | i |
| cloud | `\bStripe\b\|\bVercel\b\|\bAWS\b` | |
| paths | `apps/api\|apps/e2e\|player-web\|operator-web` | |
| gates | `preflight\|run-integration-tests\|fp-gate\|p0-tier\|qa-verdict\|migration-security-gate\|cve-scan-gate` | |
| zg | `\bzg (query\|index)\b` | |
| abs | `~\|igaming-platform` | |
| ports | `localhost:\d+\|charlotte\.lock\|local-stack\.lock` | |

(In the table `\|` is a plain `|` alternation; the backslash is only markdown escaping.) `label` = a short human name of your choice.

## `scripts/agnostic-lint/allowlist.json`

`{ "version": 1, "entries": [ { "file", "class", "max", "reason" } ] }`. Semantics: for an entry, up to `max` matching lines are counted as **allowed**, anything above `max` is **denied**. `reason` for all entries below: `"upstream example: upstream/main has >= max lines for this class in this file"`. Exactly these 70 entries (`class:max`):

```
agents/gsd-codebase-mapper.md                         supabase:1 docker:1 frontend:1
agents/gsd-executor.md                                authtech:1
agents/gsd-integration-checker.md                     frontend:2
agents/gsd-phase-researcher.md                        frontend:2
agents/gsd-plan-checker.md                            authtech:1
agents/gsd-planner.md                                 edgefn:1
get-shit-done/workflows/complete-milestone.md         supabase:1 frontend:1
get-shit-done/workflows/discuss-phase.md              frontend:1
get-shit-done/workflows/execute-plan.md               authtech:1
get-shit-done/workflows/new-project.md                authtech:1
get-shit-done/workflows/transition.md                 authtech:3
get-shit-done/workflows/verify-work.md                docker:1
get-shit-done/references/checkpoints.md               money:1 supabase:13 redis:8 postgres:3 authtech:2 frontend:2 cloud:15 ports:25
get-shit-done/references/continuation-format.md       authtech:3
get-shit-done/references/git-integration.md           money:2 authtech:6 frontend:3 cloud:1
get-shit-done/references/questioning.md               frontend:1
get-shit-done/references/tdd.md                       frontend:4
get-shit-done/references/verification-patterns.md     frontend:5 cloud:1 ports:1
get-shit-done/templates/codebase/architecture.md      authtech:1
get-shit-done/templates/codebase/concerns.md          money:6 supabase:5 redis:1 postgres:2 frontend:3 cloud:9
get-shit-done/templates/codebase/conventions.md       frontend:5
get-shit-done/templates/codebase/integrations.md      money:6 supabase:16 redis:4 postgres:3 docker:1 authtech:3 frontend:1 cloud:17
get-shit-done/templates/codebase/stack.md             postgres:1 docker:2 frontend:4 cloud:1
get-shit-done/templates/codebase/structure.md         frontend:1
get-shit-done/templates/codebase/testing.md           frontend:13
get-shit-done/templates/phase-prompt.md               money:1 frontend:1 cloud:3 ports:4
get-shit-done/templates/requirements.md               money:1
get-shit-done/templates/research.md                   frontend:19
get-shit-done/templates/summary.md                    money:2 edgefn:1 postgres:1 authtech:6 frontend:1
get-shit-done/templates/user-setup.md                 money:1 supabase:12 cloud:13 ports:4
```

## `scripts/agnostic-lint.js` (target ≤ 220 lines)

Exports (all pure except the fs readers and `main`):

- `SCOPES` (the table above), `listScopeFiles(root)` → `{ [scopeId]: string[] }`
- `loadTerms(file)`, `loadAllowlist(file)` (throw a plain `Error` naming the file on bad JSON or a pattern that `new RegExp` rejects)
- `countLines(text, classes)` → `{ [classId]: n }` (non-zero only)
- `scan(root, terms, allowlist)` (files enumerated via `git ls-files`, disk-walk fallback for non-git roots) → `{ denied: { [file]: { [classId]: n } }, allowed: { [file]: { [classId]: n } }, files: { [scopeId]: string[] } }` (non-zero entries only, keys sorted)
- `inputsHash(termsFile, allowlistFile)` → sha256 hex of the two files' bytes concatenated
- `compare(current, baseline)` → `{ rises: [{file, class, kind, baseline, current}], drops: [...] }` where `kind` is `denied` or `allowed`; a (file, class) absent from one side counts as 0
- `totals(scanResult)` → `{ [classId]: { [scopeId]: { lines, files } } }` over denied + allowed
- `main(argv)` returns an exit code; `if (require.main === module) process.exit(main(process.argv.slice(2)))`

CLI: `node scripts/agnostic-lint.js <check|report|write-baseline> [--root <dir>] [--allow-raise]`. Default root = repo root (`path.join(__dirname, '..')`); terms/allowlist/baseline are read from `<root>/scripts/agnostic-lint/`.

- `report`: prints one row per class, one column per scope, cell `lines/files` (or `0`), totals = denied + allowed; then a line `denied=<sum> allowed=<sum>`. Exit 0.
- `check`: exit 1 and print to stderr one line per problem: `RISE <kind> <file> <class> baseline=<n> current=<m>`; `STALE <kind> <file> <class> baseline=<n> current=<m> (run: node scripts/agnostic-lint.js write-baseline)`; `STALE inputs hash (terms.json or allowlist.json changed; run write-baseline)`; `MISSING baseline.json`. Exit 0 with `agnostic-lint: ok (<denied> denied, <allowed> allowed)` otherwise.
- `write-baseline`: writes `baseline.json` = `{ "version": 1, "inputs_sha256", "denied", "allowed" }` (2-space JSON, trailing newline). If a baseline already exists and `compare` reports any rise, refuse (exit 1, file untouched, print the `RISE` lines) unless `--allow-raise` is given.

</spec>

<tasks>

<task type="auto">
  <name>Task 1: Denylist, allow-list and lint script</name>
  <files>scripts/agnostic-lint.js, scripts/agnostic-lint/terms.json, scripts/agnostic-lint/allowlist.json</files>
  <action>
Create the three files exactly per `<spec>`. Read nothing else from the repo except, if you want a style sample, `get-shit-done/bin/pre-pr-checks.js` lines 1-30.

Do NOT write `baseline.json` in this task and do not touch `package.json`.

Sanity run: `node scripts/agnostic-lint.js report`. The printed matrix must equal this table (computed by the planner with the same regexes on `db24beb`; columns agents, commands, workflows, references, templates, bin, install, hook-config):

```
igaming    1/1    1/1   0     2/1    0      3/1   0     1/1
game       1/1    0     2/1   2/1    0      2/2   0     0
reg        11/6   0     5/4   6/3    0      0     0     0
money      36/12  3/1   8/5   18/8   17/6   7/3   0     0
owner      5/2    4/3   5/3   10/2   0      2/1   0     0
supabase   2/2    0     2/2   25/6   33/3   4/2   0     0
deno       6/3    1/1   10/4  20/4   1/1    13/4  0     0
edgefn     3/2    0     6/2   3/2    1/1    0     0     0
redis      0      0     0     8/1    5/2    0     0     0
charlotte  87/12  4/1   56/7  84/8   6/6    46/3  15/1  0
nx         2/2    0     5/2   4/2    0      1/1   0     0
pnpm       1/1    0     0     3/2    0      2/1   0     0
postgres   4/3    0     2/2   5/2    8/5    0     0     0
orbstack   0      0     0     0      0      0     0     0
email      0      0     0     0      0      0     0     0
telegram   0      0     1/1   0      0      47/7  0     0
docker     1/1    0     4/3   2/2    3/2    1/1   0     0
authtech   2/2    0     6/4   16/5   10/3   0     0     0
frontend   7/5    1/1   4/4   27/12  51/11  3/3   0     0
cloud      0      0     1/1   21/4   43/5   2/1   0     0
paths      7/6    6/1   14/4  11/5   1/1    1/1   0     0
gates      18/8   18/4  22/4  21/6   0      5/2   0     0
zg         4/4    0     0     0      0      0     0     0
abs        6/3    0     5/2   38/9   13/2   6/3   0     1/1
ports      9/3    0     2/1   34/4   8/2    3/2   0     0
```

If a cell differs, the cause is a mis-escaped pattern or a scope rule: fix the lint or `terms.json`, never the expected table. If after two attempts a cell still differs, stop and report the cell, your regex and three sample matching lines.

Commit: `feat(agnostic-A1): term denylist, allow-list and ratchet lint script`.
  </action>
  <verify>
`node scripts/agnostic-lint.js report` prints the table above (all 25 rows equal) and exits 0.
`node -e "const a=require('./scripts/agnostic-lint/allowlist.json');console.log(a.entries.length)"` prints `70`.
`node -e "const t=require('./scripts/agnostic-lint/terms.json');console.log(t.classes.length)"` prints `25`.
`git show --stat HEAD -- scripts/agnostic-lint.js scripts/agnostic-lint/terms.json scripts/agnostic-lint/allowlist.json` lists exactly the three new files (ignore `.audit/`).
  </verify>
  <done>Report matrix equals the planner table; 25 classes; 70 allow-list entries; committed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fixture tests for the lint, with executed mutations</name>
  <files>scripts/agnostic-lint.test.js</files>
  <behavior>
All ADD (no existing test covers this script; `git grep -n agnostic-lint -- '*.test.js'` is empty). Tier T2 (tooling), layer unit unless marked CLI. Each test builds a tmp root with `fs.mkdtempSync`, writes its own small `scripts/agnostic-lint/terms.json` (2-3 classes) and `allowlist.json`, and removes the dir in `afterEach`.

1. `countLines` counts lines, not occurrences: a line with two matches counts 1; three matching lines count 3. ADD.
2. Word boundary and case flags: with class `deno` (`\bdeno\b`, `i`) "denoise" = 0, "Deno task" = 1; with class `owner` (`\bCEO\b`, no flag) "CEO" = 1, "ceo" = 0. ADD.
3. Scopes (disk-walk fallback, tmp root without `.git`): `agents/a.md` counted; `agents/v2/b.md` not; `get-shit-done/bin/x.js` counted; `get-shit-done/bin/x.test.js` not; `get-shit-done/bin/hooks/y.js` counted (recursive); `bin/install.js` and `hook-config.json` counted; `scripts/z.js`, `docs/d.md`, `tests/t.md` not. ADD.
3a. Git enumeration: in a tmp root that is a git repo (`git init`, `git add` the tracked fixture files; spawn git with `-c user.name=t -c user.email=t@t` where needed), a matching file that is untracked (never `git add`ed) is NOT counted by `scan` and does not make CLI `check` exit 1 after `write-baseline`; after `git add` it IS counted and `check` then exits 1 with `RISE`; a tracked file deleted from disk is skipped without error. The same tree without `.git` counts the file (disk-walk fallback). ADD.
4. Allow-list cap: file with 3 matching lines and entry `max: 2` → `allowed` 2, `denied` 1; same file with no entry → `denied` 3. ADD.
5. `compare`: +1 on an existing (file, class) → one rise; a new file with a hit → one rise with baseline 0; -1 → one drop; identical → both empty. A rise in `allowed` is reported with `kind: 'allowed'`. ADD.
6. CLI `check` (spawn `process.execPath` with `[lintPath, 'check', '--root', tmp]` via `child_process.spawnSync`): after `write-baseline` exit 0; after appending a matching line to a scoped file exit 1 and stderr contains `RISE denied`, the file path and the class id. ADD.
7. CLI stale paths: removing a matching line → exit 1 with `STALE`; editing `terms.json` without regenerating → exit 1 with `STALE inputs hash`; deleting `baseline.json` → exit 1 with `MISSING baseline.json`. ADD.
8. CLI `write-baseline` refuses to raise: with a baseline present and one extra hit, exit 1 and `baseline.json` bytes unchanged; with `--allow-raise` exit 0 and the new count is in the file. ADD.
9. Bad input: `terms.json` with pattern `"("` → `loadTerms` throws an Error whose message contains the file path. ADD.
  </behavior>
  <action>
Write `scripts/agnostic-lint.test.js` with `node:test` + `node:assert` (style sample: `get-shit-done/bin/pre-pr-checks.test.js` lines 1-30). The lint under test is the real `scripts/agnostic-lint.js` pointed at tmp roots through `--root` / the exported functions; never the repo tree in this task.

Run: `NODE_PATH=$HOME/get-shit-done/node_modules node --test scripts/agnostic-lint.test.js` → all pass.

Mutation proof (apply each by Edit, run the file, confirm the named test FAILS, revert by Edit, confirm green; record mutant → failing test name in the SUMMARY):
- M1: in `compare`, never push to `rises` → tests 5, 6, 8 fail.
- M2: remove the `*.test.js` exclusion in the `bin` scope → test 3 fails.
- M3: ignore `max` (count every allow-listed hit as allowed) → test 4 fails.
- M4: count occurrences instead of lines → test 1 fails.
- M5: skip the inputs-hash comparison in `check` → test 7 fails.
- M6: in `compare`, never push to `drops` → the falling-baseline tests fail (test 5 drop case and test 7 STALE case).
- M7: always use the disk walk, never `git ls-files` → test 3a fails.

After the last revert `git diff --stat -- scripts/agnostic-lint.js` must be empty. Do not add the file to `package.json` yet (Task 3).

Commit: `test(agnostic-A1): fixture tests for the ratchet lint (7 mutants killed)`.
  </action>
  <verify>
`NODE_PATH=$HOME/get-shit-done/node_modules node --test scripts/agnostic-lint.test.js` → `# fail 0`, and tests 1-9 and 3a present by name in the output.
`git diff --stat -- scripts/agnostic-lint.js` empty.
  </verify>
  <done>10 behaviours covered (1-9 and 3a), 7 mutants each killed by a named test, lint source unchanged after reverts.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Generate the baseline, add the repo-at-baseline test, wire into npm test</name>
  <files>scripts/agnostic-lint/baseline.json, scripts/agnostic-lint.test.js, package.json</files>
  <behavior>
All ADD, tier T2, layer integration (real repo tree), appended to `scripts/agnostic-lint.test.js` in a `describe('repo tree')`.

10. Repo at baseline: `scan(repoRoot)` vs committed `baseline.json` → `rises` empty AND `drops` empty AND `inputs_sha256` equals `inputsHash(...)`. On failure the assertion message lists the offending `file class baseline→current` lines. ADD.
11. Allow-list hygiene: every entry has a non-empty `reason`, integer `max` ≥ 1, a `class` that exists in `terms.json`, a `file` that exists on disk and belongs to a scope, and no duplicate (file, class). ADD.
12. Denylist shape: `terms.json` has exactly the 25 ids of the spec, unique. ADD.
  </behavior>
  <action>
1. `node scripts/agnostic-lint.js write-baseline` (creates `scripts/agnostic-lint/baseline.json`; do not edit it by hand). `node scripts/agnostic-lint.js check` → exit 0.
2. Append tests 10-12 to `scripts/agnostic-lint.test.js`.
3. `package.json`, `scripts.test`: insert ` scripts/agnostic-lint.test.js` immediately after `scripts/evolve/gate.test.js` and before ` && node get-shit-done/bin/gsd-tools.js eval regress`. Change nothing else in the file. (Tests are an explicit file list; a file not listed never runs.)
4. Live mutation proof on the real tree (record outputs in the SUMMARY):
   - L1: append one line `Charlotte` to the end of `agents/gsd-executor.md` with Edit → `node scripts/agnostic-lint.js check` exits 1 with `RISE denied agents/gsd-executor.md charlotte`, and test 10 fails. Remove the line with Edit; `git diff --quiet -- agents/gsd-executor.md` must exit 0.
   - L2: create `get-shit-done/references/zz-probe.md` containing `deno task test`; first run `check` and confirm exit 0 (untracked files are ignored), then `git add -N get-shit-done/references/zz-probe.md` and `check` exits 1 with `RISE denied get-shit-done/references/zz-probe.md deno baseline=0 current=1`. Remove with `git rm -f get-shit-done/references/zz-probe.md`.
   - L3: change one `max` in `allowlist.json` from its value to value-1 → `check` exits 1 with `STALE inputs hash`. Revert by Edit; `git diff --quiet -- scripts/agnostic-lint/allowlist.json` exits 0.
5. Full suite (command in `<executor_rules>`): rc=0, `# fail 0`, tests 10-12 present in the output.
6. In the SUMMARY add a short "Delta vs FABLE-AGNOSTIC-GSD section 1.1" table: only the cells of the Task 1 table that differ from the design doc's table (the lint is deliberately a superset: case-insensitive `charlotte`/`money`, `p0-tier`/`qa-verdict` in `gates`, docker split from cloud). State counts only; do not tune patterns to match.

Commit: `feat(agnostic-A1): committed baseline, repo-at-baseline test, wired into npm test`.
  </action>
  <verify>
`node scripts/agnostic-lint.js check` → exit 0.
`git grep -c "scripts/agnostic-lint.test.js" -- package.json` → `package.json:1`.
Full suite: rc=0, `# fail 0`.
`git show --stat HEAD -- scripts/agnostic-lint/baseline.json scripts/agnostic-lint.test.js package.json` lists exactly those three files (ignore `.audit/`); `git diff --quiet db24beb -- agents commands get-shit-done bin hook-config.json` exits 0.
  </verify>
  <done>Baseline generated by the tool, 3 live mutations each failed the check and were reverted, suite green, no installable file changed.</done>
</task>

</tasks>

<verification>
- `node scripts/agnostic-lint.js check` exit 0; `report` equals the Task 1 table.
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test` rc 0, `# fail 0`.
- `git diff --quiet db24beb -- agents commands get-shit-done bin hook-config.json` exits 0 (no behaviour change).
- SUMMARY lists M1-M7 and L1-L3 with the failing test / stderr line for each.
</verification>

<success_criteria>
A rise of one denylist line in any installable file fails `npm test` naming file and class; the baseline is tool-generated; upstream examples are capped, not free.
</success_criteria>

<output>
After completion create `.planning/agnostic/A/A-01-SUMMARY.md` (`git add -f`, new file under an ignore-listed dir).
</output>
