---
phase: agnostic-C
plan: 03
type: execute
wave: 3
depends_on: ["C-02", "B-04"]
files_modified:
  - get-shit-done/bin/preset-igaming.test.js
autonomous: true
requirements: [AGN-C3]
must_haves:
  truths:
    - "The igaming `project.risk_domains` and `project.ruling_topics` contain exactly the terms the prompts hard-code today; removing or adding a term, or lowering a tier in the brief, fails a test"
    - "Every other hard-coded class-1 list in the prompts and the code default `adversarial_review_security_patterns` is covered by the brief lists through an explicit, tested mapping"
    - "`gsd-tools project init --preset igaming` into an empty tmp project deploys the golden bytes, modes and settings sets, and `project diff` then reports zero changes"
  artifacts:
    - path: get-shit-done/bin/preset-igaming.test.js
      provides: "term-coverage tests T1-T5 and deploy tests D1-D4"
  key_links:
    - from: get-shit-done/bin/preset-igaming.test.js
      to: "agents/gsd-planner.md, agents/gsd-plan-checker.md, agents/gsd-test-writer.md, agents/gsd-phase-coordinator.md, get-shit-done/references/decisions-protocol.md, get-shit-done/references/coordinator-detail.md, get-shit-done/workflows/{prd,new-milestone,plan-phase,execute-phase}.md, get-shit-done/bin/gsd-tools.js"
      via: "the sentence regexes of `<spec>`, read from the repo at test time"
      pattern: "Tag every behaviour on a"
    - from: get-shit-done/bin/preset-igaming.test.js
      to: get-shit-done/bin/project-deploy.js
      via: "`runCli(root, ['init' | 'diff' | 'sync', '--preset', 'igaming'], env, session)`"
      pattern: "runCli"
e2e_flows: []
---

<objective>
Phase C3 (design 4.6 item 6, risk R7) plus the deploy proof: the T0 rule for money/auth/RNG/KYC cannot silently weaken when Phase E4 moves the lists from the prompts to the brief, and the preset deploys cleanly through B-04's CLI. An Opus-tier review of the lists is a separate dispatch (`<opus_review_dispatch>`), not an executor task.
</objective>

<precondition>
`.planning/agnostic/C/C-02-SUMMARY.md` AND `.planning/agnostic/B/B-04-SUMMARY.md` exist; `get-shit-done/bin/project-deploy.js` exports `runCli`; `git status --short -- package.json get-shit-done/bin get-shit-done/presets` prints nothing. Otherwise stop and report.
</precondition>

<executor_rules>
- Same rules as C-01 `<executor_rules>` (work dir, forbidden commands, hook limits, backup/restore under `/tmp/c03-bak/`, single-file test command, Haiku trailer + `Claude-Session`).
- Deploy tests: every project root is `fs.mkdtempSync` under `os.tmpdir()`, removed in `afterEach`. Every `runCli` call passes an explicit `env` object and an explicit `session` object; every `spawnSync` passes an explicit `env`. Never deploy outside a tmp dir.
- Do all checks of deployed files inside the node tests. Do not type shell commands that name a `.claude/settings` file or a `.claude/hooks` path.
- Read `get-shit-done/bin/project-deploy.js` and `project-deploy-apply.js` only at the functions a mutant names. Read prompt files only at the cited lines.
- Do not edit any prompt file, `gsd-tools.js`, or anything under `get-shit-done/presets/` (mutants are restored).
</executor_rules>

<spec>

## Class-1 sites today (planner-verified at fork `58a50a5`; every regex below returns exactly the quoted capture)

| id | File (line today) | Regex (capture 1 = the list) | Capture | Must equal / be covered by |
|---|---|---|---|---|
| S1 | `agents/gsd-planner.md` (138) | `/Tag every behaviour on a (.+?) path T0/` | `money, auth, RNG, KYC, payment, ledger or settlement` | set-equal `risk_domains` |
| S2 | `agents/gsd-plan-checker.md` (390) | `/any behaviour on a (.+?) path must be tagged T0/` | same as S1 | set-equal `risk_domains` |
| S3 | `get-shit-done/references/decisions-protocol.md` (29) | `/^(.+?) questions are not parked/m` | `Money, auth, security and RNG` | set-equal `ruling_topics` |
| S4 | `get-shit-done/references/decisions-protocol.md` (31) | `/a row about (.+?) to the ruling dispatch/` | `money, auth, security or RNG` | set-equal `ruling_topics` |
| S5 | `get-shit-done/workflows/new-milestone.md` (418) | `/Rows about (.+?) are not asked/` | same as S4 | set-equal `ruling_topics` |
| S6 | `get-shit-done/workflows/prd.md` (527) | ``/any open `A-` about (.+?) goes to the ruling route/`` | same as S4 | set-equal `ruling_topics` |
| S7 | `agents/gsd-test-writer.md` (39) | `/T0 ([A-Za-z\/]+):/` | `money/auth/RNG/KYC/RLS` | covered (alias `rls`) |
| S8 | `agents/gsd-phase-coordinator.md` (180) | `/High-stakes plans \((.+?)\)/` | `money/auth/security/RNG/KYC/game logic` | covered (alias `game logic`) |
| S9 | `get-shit-done/workflows/execute-phase.md` (728) | same as S8 | same as S8 | covered |
| S10 | `get-shit-done/workflows/execute-phase.md` (203) | ``/`opus` for (.+?) plans/`` | `money/auth/security/RNG/KYC` | covered |
| S11 | `get-shit-done/workflows/plan-phase.md` (387) | same as S10 | same as S10 | covered |
| S12 | `get-shit-done/references/coordinator-detail.md` (319) | `/in a (\S+) domain/` | `money/auth/KYC/RNG` | covered |
| S13 | `get-shit-done/bin/gsd-tools.js` (408 and 423; the design cites 406, 421) | `/adversarial_review_security_patterns: (\[[^\]]*\])/g` | 2 matches, each `['auth', 'payment', 'secret', 'credential', 'crypto', 'security', 'token', 'password', '/api/', 'migration']` | `auth`, `payment` ∈ `risk_domains`; `security` ∈ `ruling_topics` |

`terms(capture)` = `capture.split(/\s*,\s*|\s+(?:or|and)\s+|\//)`, each trimmed and lowercased, empty strings dropped. For S13 parse the literal with `JSON.parse(capture.replace(/'/g, '"'))`.
`covered(term)` = `term ∈ risk_domains ∪ ruling_topics`, or `term` is a key of `ALIASES = { 'rls': <the brief's auth row "what counts" cell matches /RLS/>, 'game logic': <the brief's Owner Policies section matches /game logic/i> }` and that condition holds.

Pinned constants in the test (they outlive Phase E4): `RISK_DOMAINS = ['money', 'payment', 'ledger', 'settlement', 'auth', 'rng', 'kyc']`, `RULING_TOPICS = ['money', 'auth', 'security', 'rng']`.

One comment line above the S-table tests: `// Phase E4 rewrites these sentences: when a regex stops matching, replace that row with an assertion that the prompt points to the brief list. Do not delete the row.`

</spec>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: term-coverage tests (brief lists equal the lists the prompts hard-code)</name>
  <files>get-shit-done/bin/preset-igaming.test.js</files>
  <behavior>
Append `describe('igaming brief term coverage (agnostic-C3)', ...)`. Tier: T1 by layer (static text, no database exists in this repo); the subject is the T0 policy itself, so every row gets a mutant. `CONFIG` and the brief are read from `get-shit-done/presets/igaming/`; prompt files from the repo root (`path.join(__dirname, '..', '..')`).

T1. ADD. Pinned lists: `CONFIG.project.risk_domains` has 7 entries, no duplicate, and as a sorted array deep-equals sorted `RISK_DOMAINS`; `CONFIG.project.ruling_topics` has 4 entries, no duplicate, sorted deep-equals sorted `RULING_TOPICS`; `CONFIG.project.owner_title === 'CEO'`.
T2. ADD. Exact sites S1-S6, table-driven, one sub-assert per row: the regex matches exactly once in the file (S3-S6: once each); sorted `terms(capture)` deep-equals the sorted config list named in the row.
T3. ADD. Covered sites S7-S12: the regex matches (S8-S11 at least once); every term satisfies `covered(term)`; the two alias conditions are asserted on their own (auth row names RLS; Owner Policies names game logic), and `Object.keys(ALIASES)` are each used by at least one site (no dead alias).
T4. ADD. Code default S13: exactly 2 matches in `gsd-tools.js`, deep-equal to each other; the parsed list includes `auth`, `payment`, `security`; `auth` and `payment` are in `risk_domains`; `security` is in `ruling_topics`.
T5. ADD. Brief table: rows of the `## Risk Domains` table parsed by `|`; column 3 (tier) is `T0` in every row; column 4 (ruling) is `yes` exactly for ids in `ruling_topics` and `no` otherwise; the section has a line `Ruling topics: money, auth, security, rng` (compare the comma-split, trimmed list with `CONFIG.project.ruling_topics`, order included); every "what counts" cell is non-empty.
REUSE. Table ids equal `risk_domains`: P5 (C-02). Schema validity: P1. 0 tests added.
  </behavior>
  <action>
Append the describe block; run the file.

Mutation proof (on preset data, backup → mutate → run → confirm → restore; record in SUMMARY):
- M1: remove `"kyc"` from `risk_domains` → T1, T2 (S1, S2), T3 fail.
- M2: add `"bonus"` to `risk_domains` → T1, T2 fail.
- M3: remove `"security"` from `ruling_topics` → T1, T2 (S3-S6), T4 fail.
- M4: add `"kyc"` to `ruling_topics` → T1, T2, T5 fail.
- M5: brief `ledger` row tier `T0` → `T1` → T5 fails.
- M6: brief `rng` row ruling `yes` → `no` → T5 fails.
- M7: remove "RLS" from the brief's auth row → T3 fails.
- M8: remove the "game logic" text from Owner Policies → T3 fails.
- M9 (test-of-test, temporary edit of a COPY): copy `agents/gsd-planner.md` to `/tmp/c03-bak/`, in the working file change `ledger or settlement` to `ledger`, run → T2 (S1) fails; restore; `git diff --stat -- agents/` is empty. (Proves a prompt that drops a term is caught while the sentence exists.)

After the last restore `git status --short -- get-shit-done/presets agents` prints nothing.
Commit: `test(agnostic-C3): igaming brief term coverage against the prompt lists (9 mutants killed)`.
  </action>
  <verify>
Single-file run `# fail 0`; T1-T5 present by name.
`git grep -c "Tag every behaviour on a" -- agents/gsd-planner.md` → `agents/gsd-planner.md:1` (the prompt is unchanged).
  </verify>
  <done>5 behaviours, 9 mutants killed and restored.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: deploy the preset into a tmp project with `project init`; `project diff` is empty; full suite; SUMMARY</name>
  <files>get-shit-done/bin/preset-igaming.test.js</files>
  <behavior>
Append `describe('igaming preset deploys (agnostic-C)', ...)`. Tier T1. Layer: integration through B-04's `runCli` (in-process) and the `gsd-tools project` dispatch (D4). Fixture: `HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false })`; `AGENT = { stdin_tty: false, stdout_tty: false, agent_ancestor: true }`; `makeProject()` → tmp root with `.planning/config.json` = the bytes of `config.stack.json`; `snapshot(root)` → sorted `[relPath, sha256, mode & 0o777]` of every file, dotfiles included.

D1. ADD. `runCli(root, ['init', '--preset', 'igaming'], {}, HUMAN)` → `exitCode === 0`, `result.ok`, `result.conflicts === 0`, `result.secret_hits` `[]`, `result.refused === null`, 51 file entries all `action: 'create'`, `result.settings.action === 'create'`. On disk: for every golden dest except `SETTINGS_DEST`, `sha256(file) === golden` (49 compared, count asserted); the files with an executable bit are exactly the 11 of G4; `.planning/PRODUCT-BRIEF.md` is byte-equal to the preset's; `.planning/STACK-PROFILE.md` has no `{{` and contains every `CONFIG.stack.commands` value; the deployed settings file parses to an object whose keys are exactly `permissions` and `hooks`, whose allow/deny/ask sets equal the snapshot's (sizes 289 / 19 / 3) and whose `hooks` deep-equal `snapshot.hooks`; `.claude/settings.local.json` and `.mcp.json` do not exist under `root`.
D2. ADD. Empty diff: after D1's init, `runCli(root, ['diff', '--preset', 'igaming'], {}, HUMAN)` → `exitCode === 0`, `changes === 0`, `conflicts === 0`, every file `action: 'unchanged'`, settings `action: 'unchanged'`, `guarded_changes` `[]`. Then `runCli(root, ['sync', '--preset', 'igaming'], { CLAUDECODE: '1' }, AGENT)` → `exitCode === 0`, `written` `[]`, `refused === null` (nothing guarded changes), and `snapshot(root)` is identical to the one taken after init.
D3. ADD. Demonstrated non-empty diff: copy the preset to a tmp dir; `init` with `--preset-dir <copy>`; append one line to the copy's `rules/fp.md`; `diff --preset-dir <copy>` → `exitCode === 2`, `changes === 1`, the entry for `.claude/rules/fp.md` has `action: 'overwrite'`; `snapshot(root)` unchanged by the diff.
D4. ADD, CLI. After an in-process init, `spawnSync(process.execPath, [<gsd-tools.js>, 'project', 'diff', '--root', root, '--preset', 'igaming'], { env: { ...process.env, CLAUDECODE: '1' } })` → status 0; stdout parses; `changes === 0`, `conflicts === 0`.
REUSE. Abort atomicity, refusal matrix, merge and conflict behaviour: `get-shit-done/bin/project-deploy.test.js` P1-P12, A1-A14 (B-04). 0 tests added.
  </behavior>
  <action>
Append the describe block; run the file.

Mutation proof (edit the named B-04 module at the named function, run the file, confirm, restore from backup; record in SUMMARY):
- M1 (`project-deploy-apply.js`, `writeAtomic`): ignore `mode` (always `0o644`) → D1 fails (executable set).
- M2 (`project-deploy.js`, settings step): drop `permissions.deny` from the rendered fragment before `mergeSettings` → D1 fails (deny set).
- M3 (`project-deploy.js`, `runCli`): `diff` always returns exit code 0 → D3 fails.
- M4 (`project-deploy-apply.js`, `applyPlan`): skip the `MANIFEST` write → D2 fails (`sync` reports `not initialised`, or the snapshot differs).
- M5 (preset data): append one byte to `skills/vibe-security/SKILL.md` → D1 fails (and G3).

After the last restore `git diff --stat -- get-shit-done/bin/project-deploy.js get-shit-done/bin/project-deploy-apply.js` is empty and `git status --short -- get-shit-done/presets` prints nothing. If a mutant does not fail the named test, do not weaken the test: report it in the SUMMARY with the observed result.

Then the full suite once: `NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-C03.log 2>&1; echo rc=$?`.
Commit: `test(agnostic-C): igaming preset init and empty diff in a tmp project (5 mutants killed)`.
Then write and commit `.planning/agnostic/C/C-03-SUMMARY.md`: outcome, commits, tests by name, mutation table, the S1-S13 table with the line numbers found at execution time, deviations, Self-Check, and the line `Opus-tier review: PENDING (see C-03-PLAN.md <opus_review_dispatch>)`.
  </action>
  <verify>
Single-file run `# fail 0`; G1-G6, P1-P5, T1-T5, D1-D4 present by name.
Full suite `rc=0`, `# fail 0`. `node scripts/agnostic-lint.js check` → exit 0.
`wc -l get-shit-done/bin/preset-igaming.test.js` ≤ 900.
`git status --short` shows only `.audit/`; `git -C /Users/ollorin/igaming-platform status --short | wc -l` equals the number recorded in C-01.
  </verify>
  <done>4 behaviours, 5 mutants killed, suite green, Phase C summary written.</done>
</task>

</tasks>

<opus_review_dispatch>
Not an executor task. After C-03-SUMMARY.md is committed, the coordinator sends ONE fresh review dispatch with `model: "fable"` (if rejected for allowance or availability: `model: "opus"`, and say so). The reviewer did not write the brief and edits nothing. Phase C is not complete until its verdict is on disk and every finding is fixed.

Inputs (read by line range): `get-shit-done/presets/igaming/{PRODUCT-BRIEF.md,config.stack.json,STACK-PROFILE.md,README.md}`; the S1-S13 sites of this plan; `get-shit-done/presets/igaming/CLAUDE.md` sections "Subagent Usage" and "High-stakes domains"; `get-shit-done/presets/igaming/rules/{database,edge-functions,bonus-system,testing}.md`; design `/Users/ollorin/igaming-platform/.planning/fable-review/FABLE-AGNOSTIC-GSD.md` sections 1.3 (class 1), 4.1, 4.6, risk R7; the test block `igaming brief term coverage`.

Questions, each answered with `file:line` evidence:
1. Do `risk_domains` and `ruling_topics` hold exactly the terms of S1-S6, nothing more, nothing less?
2. `RLS` is T0 in the test-writer prompt (S7) but is not a risk-domain id. Is folding it into the `auth` row sufficient, or does Phase E4 lose a T0 trigger? Same for `game logic` and `security` in the tiering lists (S8-S12), which the schema has no key for: is a third list (high-stakes / tiering domains) needed in `project-profile.js` before E4?
3. Does any path that igaming treats as highest tier today (igaming rules: bonus credit, win credit, responsible-gaming limits, fraud/AML, game configs) fall outside every "what counts" cell of the brief table? List each gap.
4. Is S13 (`adversarial_review_security_patterns`) correctly left as a built-in default, and do the brief lists cover its domain words?
5. Could a brief that passes T1-T5 still weaken the rule (for example a "what counts" cell narrowed to one directory)? Name the missing assertion.
6. Settings: does `settings.fragment.json` lose any deny/ask rule or hook of the snapshot; is the non-deployment of `env`, `enabledPlugins`, `sandbox`, `enableAllProjectMcpServers` acceptable until cutover, and what must Phase H do about it?
7. Does anything in the brief's Owner Policies grant more autonomy than igaming's CLAUDE.md does?

Output: `.planning/agnostic/C/C-03-OPUS-REVIEW.md`, verdict first (`APPROVED` or findings with severity), ≤ 80 lines. Fixes: a fresh Haiku dispatch per finding batch (brief/config edits and the matching test assertion with a mutant), then `preset-igaming.test.js` and the full suite once more; a change to `risk_domains` or `ruling_topics` needs a second Fable/Opus look at that diff only. The SUMMARY line `Opus-tier review: PENDING` is then replaced by the verdict and the review file path.
</opus_review_dispatch>

<verification>
- T1-T5: brief lists equal the prompt lists; every other class-1 site is covered by a tested mapping.
- D1-D4: init into a tmp project reproduces the golden; diff is empty; a changed preset makes diff non-empty.
- Full suite rc 0; agnostic lint exit 0, baseline unchanged since Phase B.
- igaming repo, `~/.claude` and `~/get-shit-done` untouched (no command in C-01..C-03 writes there).
</verification>

<success_criteria>
The must_haves truths hold, each backed by a named test and a killed mutant; the Opus-tier review verdict is on disk with all findings fixed.
</success_criteria>

<output>
`.planning/agnostic/C/C-03-SUMMARY.md`; after the review, `.planning/agnostic/C/C-03-OPUS-REVIEW.md`.
</output>
