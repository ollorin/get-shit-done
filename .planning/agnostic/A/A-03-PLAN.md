---
phase: agnostic-A
plan: 03
type: execute
wave: 3
depends_on: ["A-01", "A-02"]
files_modified:
  - get-shit-done/templates/product-brief.md
  - get-shit-done/templates/stack-profile.md
  - get-shit-done/references/project-context.md
  - get-shit-done/bin/project-profile.test.js
autonomous: true
requirements: [AGN-A3]
must_haves:
  truths:
    - "Templates for `.planning/PRODUCT-BRIEF.md` and `.planning/STACK-PROFILE.md` exist with the sections of design 4.1, and the stack template carries the `commands` managed block"
    - "`references/project-context.md` holds the one pointer block agents will later include, plus a config example that the A2 validator accepts with zero warnings (doc and schema cannot drift)"
    - "The three new files add zero agnostic-lint hits and no existing file references them yet (no behaviour change)"
  artifacts:
    - path: get-shit-done/templates/product-brief.md
      provides: "brief template, ≤ 120 lines"
    - path: get-shit-done/templates/stack-profile.md
      provides: "stack profile template, ≤ 150 lines, `<!-- gsd:begin commands -->` block"
    - path: get-shit-done/references/project-context.md
      provides: "pointer block + key reference + validated example, ≤ 90 lines"
    - path: get-shit-done/bin/project-profile.test.js
      provides: "doc-vs-schema tests appended"
  key_links:
    - from: get-shit-done/references/project-context.md
      to: get-shit-done/bin/project-profile.js
      via: "test parses the fenced json after `<!-- profile-example -->` and runs validateProfile on it"
      pattern: "profile-example"
e2e_flows: []
---

<objective>
Phase A3 (design: FABLE-AGNOSTIC-GSD sections 4.1-4.2): add the two project templates and the shared reference. Nothing includes or copies them yet (phase D wires them).
</objective>

<execution_context>
@get-shit-done/workflows/execute-plan.md
@get-shit-done/templates/summary.md
</execution_context>

<executor_rules>
- Work only in `/Users/ollorin/get-shit-done-agnostic` (branch `exp/agnostic`). Never touch `/Users/ollorin/igaming-platform`, `~/.claude`, `~/get-shit-done`.
- Forbidden: `npm run install:gsd`, `npm install`, `git push`, `git stash`, `git reset`, `git clean`, `git checkout -- <file>`, `--no-verify`.
- Full suite: `cd /Users/ollorin/get-shit-done-agnostic && NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-A03.log 2>&1; echo rc=$?` then read only the last 15 lines. Expected before this plan: fail 0. Pass counts: one `it` per numbered behaviour; success is `# fail 0` plus the named tests present in the output (no numeric `# pass` threshold).
- The three markdown files are inside the agnostic-lint scopes. They must contain NO denylist term: no vendor/tool/product names (see `scripts/agnostic-lint/terms.json`), no `localhost:<port>` (write URLs as `http://127.0.0.1:<port>`), no words `payment`, `money`, `wallet`, `deposit`, `withdraw`, `bonus`, `docker`, `postgres`, `React`, `jest`, no `CEO`, no absolute home paths, no `~/.claude/` (the installer rewrites that string in `.md` files). `node scripts/agnostic-lint.js check` must exit 0 WITHOUT regenerating the baseline.
- Style sample for templates, if needed: `get-shit-done/templates/project.md` lines 1-40 only.
- Commit per task with `git add -f <paths>` + `git commit -m "<msg>" -- <paths>` (the SUMMARY is committed the same way). Verify steps that run after a commit use `git show --stat HEAD -- <paths>`, never `git status`/`git diff` against HEAD; ignore the untracked `.audit/` directory. Every commit message ends with these trailers (Haiku executors use `Claude Haiku`):
  `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`
</executor_rules>

<spec>

## `get-shit-done/templates/product-brief.md` (≤ 120 lines)

Line 1 `# Product Brief Template`, one line saying it is the template for `.planning/PRODUCT-BRIEF.md` (domain only; technology goes to STACK-PROFILE.md; living requirements stay in PROJECT.md), then a `<template>` fenced markdown block whose body has exactly these H2 headings in this order, each with 1-4 placeholder lines in `[brackets]`:

1. `## Identity` (name, one-liner, owner title; note: machine value lives in `config.json` `project.slug` / `project.owner_title`)
2. `## Domain Glossary`
3. `## Users and Roles`
4. `## Risk Domains` (a table: `Domain | What counts as this path | Required test tier | Ruling required`; note: the list of ids must equal `config.json` `project.risk_domains`, and the ruling column must match `project.ruling_topics`)
5. `## Compliance and Regulation`
6. `## Config Dimensions` (things that must never be hard-coded: markets, currencies, modes)
7. `## Owner Policies` (decided autonomously / escalated / launch strategy)
8. `## Out of Scope`

After the block, a `<guidelines>` section of ≤ 12 lines: target ≤ 120 lines; stable facts only; a risk domain is a path where a defect is unacceptable and needs the highest test tier.

## `get-shit-done/templates/stack-profile.md` (≤ 150 lines)

Line 1 `# Stack Profile Template`, one line saying it is the template for `.planning/STACK-PROFILE.md` (technology only), then a `<template>` block with these H2 headings in order:

1. `## Commands` containing exactly:

```
<!-- gsd:begin commands -->
| Key | Command |
|-----|---------|
| test_file | [stack.commands.test_file] |
| test_all | [stack.commands.test_all] |
| typecheck | [stack.commands.typecheck] |
| lint | [stack.commands.lint] |
| format | [stack.commands.format] |
| frontend_test | [stack.commands.frontend_test] |
| pre_pr_gate | [stack.commands.pre_pr_gate] |
| search | [stack.commands.search] |
<!-- gsd:end commands -->
```

   plus one line above it: the block is rendered from `.planning/config.json` `stack.commands`; edit the config, not the table.
2. `## Test Command Shapes` (the only shapes agents may run, verbatim; from `stack.test_command_shapes`)
3. `## Paths` (backend, migrations, API handlers, e2e scenarios, frontends; from `stack.paths`)
4. `## Gates` (id + command; from `stack.gates`; rule: run every gate, a missing runtime is a gap, never a skip)
5. `## Services` (table `Name | URL | Health | Launch | Ready`; from `stack.services`; no default port is ever assumed)
6. `## Capabilities` (UI QA driver/agent or "none"; state-reset commands that must not run during a QA session)
7. `## Isolation` (port base, container suffix, lock dir, machine locks)
8. `## Conventions` (prose: language/runtime versions, error-handling and module rules, anything not machine-read)

Then `<guidelines>` ≤ 12 lines: target ≤ 150 lines; every value code or hooks consume lives in `config.json`, this file explains it; check with `gsd-tools profile check`.

## `get-shit-done/references/project-context.md` (≤ 90 lines)

Sections:

1. `# Project Context` + 2 lines of purpose.
2. `## Pointer block` with this block verbatim inside a fenced code block:

```
<project_context>
Domain facts and risk domains: `.planning/PRODUCT-BRIEF.md`. Commands, paths, services and tools: `.planning/STACK-PROFILE.md`.
Read the sections your role needs before acting. Every command, path and tool name comes from the profile.
If a key you need is missing, stop and report the key. Never substitute a default stack.
</project_context>
```

3. `## Reading values`: `node get-shit-done/bin/gsd-tools.js profile get <key> --raw` (exit 1 + `profile key not set: <key>` when absent) and `profile check`; placeholders `{root}`, `{file}`, `{paths}`, `{project}` are filled by the caller.
4. `## Keys`: a table of the required keys (5) and optional groups, one line each, copied from the A-02 schema (`get-shit-done/bin/project-profile.js` `REQUIRED_KEYS`, `KNOWN_COMMAND_KEYS`: read the top ~40 lines of that file).
5. `## Example`: the line `<!-- profile-example -->` immediately followed by a fenced `json` block holding a complete `{ "project": {...}, "stack": {...} }` object with neutral values that validates with zero warnings, e.g. slug `demo-app`, owner_title `owner`, risk_domains `["auth","billing"]`, ruling_topics `["auth","security"]`, commands `test_file: "npm test -- {file}"`, `test_all: "npm test"`, `typecheck: "npx tsc --noEmit"`, `lint: "npx eslint {paths}"`, paths `backend: "src"`, `api_globs: ["src/api/**"]`, one gate `{ "id": "unit", "run": "npm test" }`, one service `{ "name": "web", "url": "http://127.0.0.1:4100", "health": "http://127.0.0.1:4100/health" }`, `capabilities: {}`, isolation `{ "port_base": 4100, "lock_dir": ".tmp", "machine_locks": [] }`.

</spec>

<tasks>

<task type="auto">
  <name>Task 1: Write the two templates and the reference</name>
  <files>get-shit-done/templates/product-brief.md, get-shit-done/templates/stack-profile.md, get-shit-done/references/project-context.md</files>
  <action>
Create the three files exactly per `<spec>`. Do not edit any existing file; do not add an `@` include of the new reference anywhere.

Then: `node scripts/agnostic-lint.js check` → exit 0. If it prints `RISE`, reword the offending line (the message names file and class); never run `write-baseline`.

`wc -l` the three files: ≤ 120, ≤ 150, ≤ 90.

Commit: `docs(agnostic-A3): product-brief and stack-profile templates, project-context reference`.
  </action>
  <verify>
`node scripts/agnostic-lint.js check` exit 0; `git log -1 --format=%H -- scripts/agnostic-lint/baseline.json` equals the A-01 Task 3 commit SHA recorded in the A-01 SUMMARY.
`wc -l` limits hold.
`git show --stat HEAD` lists only the three new files (ignore `.audit/`).
  </verify>
  <done>Three files exist within size limits, zero lint hits, baseline untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Doc-vs-schema tests, with executed mutations</name>
  <files>get-shit-done/bin/project-profile.test.js</files>
  <behavior>
All ADD, appended as `describe('templates and reference')` to the existing suite `get-shit-done/bin/project-profile.test.js` (it owns the profile schema; already listed in `package.json`, so no wiring change). Tier T2, layer unit (file reads + `validateProfile`). Paths resolved from `__dirname` (`../templates/...`, `../references/...`).

14. The json block after `<!-- profile-example -->` in `references/project-context.md` parses and `validateProfile({ found: true, error: null, project, stack })` returns `ok: true` with `warnings: []`.
15. `references/project-context.md` contains the four `<project_context>` lines of the spec verbatim (assert each of the 3 inner sentences and both tags as substrings).
16. `templates/product-brief.md` contains the 8 H2 headings in the spec order (assert ascending `indexOf`).
17. `templates/stack-profile.md` contains the 8 H2 headings in order, exactly one `<!-- gsd:begin commands -->` and one `<!-- gsd:end commands -->` in that order, and the set of first-column keys of the table rows between them equals `KNOWN_COMMAND_KEYS` (imported from `./project-profile.js`).
18. Size budget: line counts ≤ 120 / 150 / 90.
  </behavior>
  <action>
Append tests 14-18. Run `NODE_PATH=$HOME/get-shit-done/node_modules node --test get-shit-done/bin/project-profile.test.js` → all pass.

Mutation proof (Edit the markdown, run, confirm the named test fails, revert by Edit; record in SUMMARY):
- M1: delete the `test_file` line from the example json → test 14 fails.
- M2: add `"deploy": "x"` under `stack.commands` in the example → test 14 fails (warning).
- M3: change "Never substitute a default stack." to "Prefer the profile." → test 15 fails.
- M4: rename `## Risk Domains` to `## Risks` → test 16 fails.
- M5: delete the `| search | ... |` row → test 17 fails.

After reverts: `git diff --quiet HEAD -- get-shit-done/templates get-shit-done/references` exits 0.

Full suite: rc=0, `# fail 0`, tests 14-18 present in the output. `node scripts/agnostic-lint.js check` exit 0.

Commit: `test(agnostic-A3): templates and project-context reference checked against the profile schema (5 mutants killed)`.
  </action>
  <verify>
Single-file run `# fail 0`, tests 14-18 present by name. Full suite rc=0, `# fail 0`.
`git diff --quiet db24beb -- agents commands get-shit-done/workflows bin hook-config.json` exits 0.
  </verify>
  <done>5 behaviours covered, 5 mutants killed and reverted, suite green, no agent/workflow/command changed.</done>
</task>

</tasks>

<verification>
- Phase A end state: `NODE_PATH=$HOME/get-shit-done/node_modules npm test` rc 0, `# fail 0`.
- `node scripts/agnostic-lint.js check` exit 0 with the baseline generated in A-01 (byte-identical since then).
- `git diff --stat db24beb -- agents commands get-shit-done/workflows hook-config.json bin` empty; under `get-shit-done/` only new files plus the two insertions in `bin/gsd-tools.js`.
</verification>

<success_criteria>
Templates and reference exist, are vendor-neutral by lint, and the documented example is proven valid by the schema test.
</success_criteria>

<output>
After completion create `.planning/agnostic/A/A-03-SUMMARY.md` (`git add -f`, new file under an ignore-listed dir).
</output>
