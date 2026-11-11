---
phase: agnostic-C
plan: 02
type: execute
wave: 2
depends_on: ["C-01"]
files_modified:
  - get-shit-done/presets/igaming/config.stack.json
  - get-shit-done/presets/igaming/PRODUCT-BRIEF.md
  - get-shit-done/presets/igaming/STACK-PROFILE.md
  - get-shit-done/presets/igaming/preset.json
  - get-shit-done/presets/igaming/README.md
  - get-shit-done/bin/preset-igaming.test.js
autonomous: true
requirements: [AGN-C2]
must_haves:
  truths:
    - "`gsd-tools profile check` in a project whose `.planning/config.json` is the preset's `config.stack.json` exits 0 with no missing key, no invalid key and no unknown-key warning"
    - "The igaming brief follows the template sections, stays within 120 lines, and its Risk Domains table ids equal `project.risk_domains`"
    - "The Commands block of the igaming STACK-PROFILE.md is rendered from `stack.commands`, so the prose file cannot drift from the machine values; every test command shape, gate and service of the config appears in the file"
    - "The C-01 golden stays green and now renders with the real igaming values"
  artifacts:
    - path: get-shit-done/presets/igaming/config.stack.json
      provides: "`project` and `stack` blocks for igaming (schema of get-shit-done/bin/project-profile.js)"
    - path: get-shit-done/presets/igaming/PRODUCT-BRIEF.md
      provides: "igaming domain brief, deployed to `.planning/PRODUCT-BRIEF.md` (whole, `render: false`)"
    - path: get-shit-done/presets/igaming/STACK-PROFILE.md
      provides: "igaming stack profile, deployed to `.planning/STACK-PROFILE.md` (block, rendered)"
    - path: get-shit-done/bin/preset-igaming.test.js
      provides: "tests P1-P5; G2, G3, G6 updated"
  key_links:
    - from: get-shit-done/presets/igaming/STACK-PROFILE.md
      to: get-shit-done/presets/igaming/config.stack.json
      via: "`{{stack.commands.<key>}}` placeholders inside `<!-- gsd:begin commands -->`"
      pattern: "\\{\\{stack\\.commands\\."
    - from: get-shit-done/bin/preset-igaming.test.js
      to: get-shit-done/bin/gsd-tools.js
      via: "`spawnSync(node, [gsd-tools.js, 'profile', 'check'], { cwd: <tmp project> })`"
      pattern: "profile.*check"
e2e_flows: []
---

<objective>
Phase C2: write the igaming PRODUCT-BRIEF.md, STACK-PROFILE.md and `config.stack.json` from the snapshot and the igaming planning files, in the schema Phase A defined. Task 1 is a Sonnet-level dispatch (`model: "sonnet"`): it needs judgment on what is a stable domain fact. Task 2 is Haiku.
</objective>

<precondition>
`.planning/agnostic/C/C-01-SUMMARY.md` exists; `git status --short -- package.json get-shit-done/bin get-shit-done/presets` prints nothing.
</precondition>

<executor_rules>
- Same rules as C-01 `<executor_rules>` (work dir, forbidden commands, hook limits, mutants by backup/restore under `/tmp/c02-bak/`, single-file test command, trailers). Task 1 trailer: `Co-Authored-By: Claude Sonnet <noreply@anthropic.com>`; Task 2: `Co-Authored-By: Claude Haiku <noreply@anthropic.com>`; both plus `Claude-Session: https://claude.ai/code/session_012KdjXbyhjnRuXKgkn5MYj8`.
- Sources, in this order, all at the pinned SHA `e319843b09949980ccae17efd75c45553dce86aa`:
  1. `get-shit-done/presets/igaming/CLAUDE.md` and `get-shit-done/presets/igaming/rules/*.md` (already in the fork; read by line range).
  2. Other igaming files only as `git -C /Users/ollorin/igaming-platform show <SHA>:<path> > /tmp/c02-src/<name>` and then Read by line range: `.planning/PROJECT.md` (761 lines: read 119-128, 510-518, 562-570 and the `Key Decisions` rows you cite), `.planning/config.json`, `docs/development/command-reference.md` (lines 15-60 and 765-775), `apps/api/supabase/config.toml` (lines 1-30). Never read the igaming working tree.
- Every value in `config.stack.json` must be traceable to one of those files. Keep a list `key → file:line` and put it in the SUMMARY. A value you cannot trace is left out (optional keys) or reported as a blocker (required keys); never invent one.
- The three new files hold project-specific text by design; they are outside the lint scope (C-01 test L1).
- No token-shaped string, no secret value, no `.env` content in any of the three files.
</executor_rules>

<spec>

## `config.stack.json`

Exactly two top-level keys, `project` and `stack`; only keys the loader knows (`get-shit-done/bin/project-profile.js:17-24`), so `profile check` prints no warning. Serialised with 2-space indent and a trailing newline.

Starting values (design 4.1). Trace each one and correct it where the source differs:

```json
{
  "project": {
    "slug": "igaming",
    "owner_title": "CEO",
    "risk_domains": ["money", "payment", "ledger", "settlement", "auth", "rng", "kyc"],
    "ruling_topics": ["money", "auth", "security", "rng"]
  },
  "stack": {
    "preset": "igaming",
    "preset_version": "1",
    "paths": {
      "backend": "apps/api",
      "migrations": "apps/api/migrations",
      "api_globs": ["apps/api/functions/**"],
      "e2e_scenarios": "apps/e2e-charlotte/scenarios",
      "frontends": ["apps/player-web", "apps/operator-web"]
    },
    "commands": {
      "test_file": "cd {root}/apps/api && deno task test {file}",
      "typecheck": "deno check {paths}",
      "lint": "deno lint {paths}",
      "format": "deno fmt {paths}",
      "frontend_test": "npx nx test {project}",
      "pre_pr_gate": "scripts/preflight.sh",
      "search": "zg query"
    },
    "test_command_shapes": ["<each allow-listed shape of presets/igaming/CLAUDE.md:37, one string per shape, verbatim, with {root} for the checkout path>"],
    "gates": [
      { "id": "fp", "run": "deno run --allow-read scripts/fp-gate.ts" },
      { "id": "p0-tier-delta", "run": "deno run --allow-read scripts/check-p0-tier-delta.ts --diff-file <diff>" }
    ],
    "services": [
      { "name": "player-web", "url": "http://localhost:3000", "launch": "npx nx dev player-web" },
      { "name": "operator-web", "url": "http://localhost:3001", "launch": "npx nx dev operator-web" }
    ],
    "capabilities": {
      "ui_qa": { "driver": "charlotte", "agent": "gsd-charlotte-qa", "tool_prefix": "mcp__charlotte__", "reset_patterns": ["supabase db reset"] }
    },
    "isolation": { "port_base": 54320, "container_suffix": "api", "lock_dir": ".tmp", "machine_locks": ["container-runtime"] }
  }
}
```

Fixed, not open to judgment (Plan C-03 pins them against the prompts and an Opus-tier review follows): `project.risk_domains`, `project.ruling_topics`, `project.owner_title`. Fixed by the engine: `stack.preset`, `stack.preset_version` (must equal `preset.json` `name` and `version`).
Rules: command values use only the placeholders `{root}`, `{file}`, `{paths}`, `{project}` (`project-profile.js:20`); no `|` character in a command value (it would break the rendered table); the gates list holds every gate command that `CLAUDE.md` "Before any plan, fix or SUMMARY claims done" names; add the backend service (API URL from `config.toml` port) if `command-reference.md` gives its launch command; `health` and `ready` only when a source states them.

## `PRODUCT-BRIEF.md` (≤ 120 lines, deployed verbatim)

The eight `## ` sections of `get-shit-done/templates/product-brief.md`, same names, same order, no placeholder brackets left.
- Identity: name, one-liner (from PROJECT.md "What This Is", one sentence), owner title, slug (pointer to config, no second copy of the value beyond the template line).
- Domain Glossary: stable terms used in rules and CLAUDE.md (wallet, ledger, settlement, bonus, sweeps mode, PVP arena, crash, slots, provably fair, responsible gaming, operator, player). One line each, traced.
- Users and Roles: player, operator, anonymous caller, service role; what each may never do.
- Risk Domains: the table with exactly one row per `project.risk_domains` id, in config order. Columns: `Domain | What counts as this path | Required test tier | Ruling required`. Tier is `T0` in every row. Ruling is `yes` for `money`, `auth`, `rng` and `no` for the others. The `auth` row's "what counts" names RLS policies (the test-writer prompt lists RLS as T0). Directly under the table one line: `Ruling topics: money, auth, security, rng` (the `project.ruling_topics` ids, same order).
- Compliance and Regulation: only regimes a source names (for example GLI-19 responsible gaming, KYC/AML), one line each with its source.
- Config Dimensions: market/jurisdiction, currency, provider, wagering mode (sweeps vs real money) with the rule "never hard-coded".
- Owner Policies: decided autonomously / escalated / launch strategy, from CLAUDE.md "Judgment calls" and "High-stakes domains". Include one line `High-stakes domains (Opus-tier plan and review): ...` copying the list of `presets/igaming/CLAUDE.md` "High-stakes domains" verbatim (it contains "complex game logic"), and one line recording the Fable allowance ruling as an owner policy.
- Out of Scope: from PROJECT.md "Out of Scope".

## `STACK-PROFILE.md` (≤ 150 lines, block-managed, rendered)

The sections of `get-shit-done/templates/stack-profile.md`, same names and order. The Commands section is:

```
<!-- gsd:begin commands -->
| Key | Command |
|-----|---------|
| test_file | {{stack.commands.test_file}} |
...one row per key of `stack.commands`, in config order, and no row for a key the config lacks...
<!-- gsd:end commands -->
```

Drop the template sentence "will be rendered ... not built yet"; write "Rendered from `.planning/config.json` `stack.commands` by `gsd-tools project init|sync`." No other `{{...}}` in the file. The other sections are prose kept in step by test P4: Test Command Shapes lists every `stack.test_command_shapes` string verbatim in backticks; Paths; Gates (id and run of each); Services table (name, url and the optional fields the config has); Capabilities; Isolation (port base, container suffix, lock dir, machine locks); Conventions (runtime, Result types, immutability, `match` routing, 500-LOC module ceiling: pointers to the rule files, not copies).

## `preset.json`

Append two entries to `files` (after the snapshot entries, in this order):
`{ "src": "PRODUCT-BRIEF.md", "dest": ".planning/PRODUCT-BRIEF.md", "kind": "whole", "render": false }`
`{ "src": "STACK-PROFILE.md", "dest": ".planning/STACK-PROFILE.md", "kind": "block", "render": true }`
`config.stack.json` is not a `files` entry (`.planning/config.json` is never managed, `project-deploy-render.js:12-17`); `project init` reads the project's own config.

## `README.md`

Add a section `## Brief, profile and config` (≤ 8 lines): the three files are authored, not part of the snapshot or the golden; `config.stack.json` is merged into the project's `.planning/config.json` by hand (Phase D automates it); the Commands block is rendered.

</spec>

<tasks>

<task type="auto">
  <name>Task 1 (Sonnet): write config.stack.json, PRODUCT-BRIEF.md, STACK-PROFILE.md; extend preset.json and README</name>
  <files>get-shit-done/presets/igaming/config.stack.json, get-shit-done/presets/igaming/PRODUCT-BRIEF.md, get-shit-done/presets/igaming/STACK-PROFILE.md, get-shit-done/presets/igaming/preset.json, get-shit-done/presets/igaming/README.md</files>
  <action>
Follow `<spec>`. Order: config first (trace list), then the profile, then the brief, then `preset.json` and README. Do not edit any snapshot file, `golden.sha256`, `settings.fragment.json` or `settings.snapshot.json`.

Commit: `feat(agnostic-C2): igaming product brief, stack profile and config.stack.json`.
  </action>
  <verify>
`rm -rf /tmp/c02-proj && mkdir -p /tmp/c02-proj/.planning && cp get-shit-done/presets/igaming/config.stack.json /tmp/c02-proj/.planning/config.json && cd /tmp/c02-proj && NODE_PATH=$HOME/get-shit-done/node_modules node /Users/ollorin/get-shit-done-agnostic/get-shit-done/bin/gsd-tools.js profile check; echo rc=$?` → `rc=0`, `"ok": true`, `"missing": []`, `"invalid": []`, `"warnings": []`.
`node -e "const c=require('./get-shit-done/presets/igaming/config.stack.json');const r=require('./get-shit-done/bin/project-deploy-render.js').renderPreset('get-shit-done/presets/igaming',c);console.log(r.ok,r.errors.length,r.files.length)"` → `true 0 51`.
`node -e "console.log(JSON.stringify(require('./get-shit-done/bin/project-deploy-scan.js').scanDir('get-shit-done/presets/igaming').hits))"` → `[]`.
`wc -l get-shit-done/presets/igaming/PRODUCT-BRIEF.md get-shit-done/presets/igaming/STACK-PROFILE.md` → ≤ 120 and ≤ 150.
`git diff --stat HEAD~1 -- get-shit-done/presets/igaming/rules get-shit-done/presets/igaming/hooks get-shit-done/presets/igaming/skills get-shit-done/presets/igaming/canaries get-shit-done/presets/igaming/CLAUDE.md get-shit-done/presets/igaming/golden.sha256` is empty.
  </verify>
  <done>Three files written with a trace list; profile check ok; preset renders 51 files; snapshot untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: profile check, brief and profile consistency tests; golden renders with the real igaming values</name>
  <files>get-shit-done/bin/preset-igaming.test.js</files>
  <behavior>
Same file as C-01 Task 2. Tier T1. Layer: integration on the committed preset, tmp project for the CLI. `CONFIG = JSON.parse(config.stack.json)`.

UPDATE G2. `META` gains `config.stack.json`; `SRC_RULES` gains `['.planning/', '']`; set of `dest` deep-equals (golden keys minus `SETTINGS_DEST`) plus `.planning/PRODUCT-BRIEF.md` and `.planning/STACK-PROFILE.md`; the 49 snapshot entries are still `whole` / `render: false`; the brief entry is `whole` / `render: false`; the profile entry is `block` / `render: true`. G1's "every file entry is whole/render false" moves to "every entry whose dest is a golden key".
UPDATE G3, G6. `IGAMING_VALUES = { ...CONFIG, project: { ...CONFIG.project, root: IGAMING_ROOT } }`. G3 compares the 49 rendered files whose dest is a golden key (count asserted) and asserts 51 rendered files in total. G6's negative cases become `{ ...IGAMING_VALUES, project: { ...IGAMING_VALUES.project, root: '/elsewhere' } }` (settings differ) and `CONFIG` without `project.root` (errors include `missing config key: project.root`).
P1. ADD. Profile check, CLI: tmp project with `.planning/config.json` = the bytes of `config.stack.json`; `spawnSync(process.execPath, [<gsd-tools.js>, 'profile', 'check'], { cwd: tmp })` → status 0; stdout JSON `ok === true`, `missing`, `invalid`, `warnings` all `[]`. In-process `validateProfile(loadProfile(tmp))` deep-equals the same result. Top-level keys of `CONFIG` deep-equal `['project', 'stack']`.
P2. ADD. Engine agreement: `CONFIG.stack.preset === preset.json name`, `CONFIG.stack.preset_version === preset.json version`; no value of `CONFIG.stack.commands` contains `|`; every `stack.paths` string value and array element is relative (no leading `/`, no `IGAMING_ROOT`); `JSON.stringify(CONFIG)` does not contain `IGAMING_ROOT`.
P3. ADD. Commands block: in the source `STACK-PROFILE.md`, the rows between `<!-- gsd:begin commands -->` and `<!-- gsd:end commands -->` (after the two header rows) are exactly, in order, `| <key> | {{stack.commands.<key>}} |` for `Object.keys(CONFIG.stack.commands)`; the file has no other `{{`. In the rendered file (from `renderPreset(PRESET, IGAMING_VALUES)`, dest `.planning/STACK-PROFILE.md`) each row is `| <key> | <CONFIG value> |` and there is no `{{`. `parseBlocks` of the rendered text is ok with one block `commands`.
P4. ADD. Profile prose in step with the config: the source `STACK-PROFILE.md` contains every `stack.test_command_shapes` string, every gate `id` and `run`, every service `name` and `url`, each `stack.paths` value, `String(stack.isolation.port_base)`, `stack.capabilities.ui_qa.driver` and `.agent`; headings deep-equal the template's `## ` headings in order (`Commands`, `Test Command Shapes`, `Paths`, `Gates`, `Services`, `Capabilities`, `Isolation`, `Conventions`); ≤ 150 lines.
P5. ADD. Brief shape: `## ` headings deep-equal `Identity`, `Domain Glossary`, `Users and Roles`, `Risk Domains`, `Compliance and Regulation`, `Config Dimensions`, `Owner Policies`, `Out of Scope`; ≤ 120 lines; no line matching `/^\[.*\]$/` (no template placeholder left); the ids of the first column of the Risk Domains table, in order, deep-equal `CONFIG.project.risk_domains`; the brief contains `CONFIG.project.owner_title`. (Tier, ruling column and prompt term coverage are C-03 T5.)
REUSE. G4, G5 unchanged; secret scan test 5 of `project-deploy-scan.test.js`. 0 tests added.
  </behavior>
  <action>
Edit the test file; run it.

Mutation proof (on preset data, backup → mutate → run → confirm → restore; record in SUMMARY):
- M1: add `"extra": 1` to `stack` in `config.stack.json` → P1 fails (warning).
- M2: remove `{file}` from `stack.commands.test_file` → P1 fails (invalid).
- M3: change `stack.preset_version` to `"2"` → P2 fails.
- M4: in `STACK-PROFILE.md` replace the `lint` row's placeholder with a literal command → P3 fails.
- M5: add `"test_all": "deno task test"` to `stack.commands` without a row → P3 fails.
- M6: delete one gate line from `STACK-PROFILE.md` → P4 fails.
- M7: delete the `kyc` row of the brief's Risk Domains table → P5 fails.
- M8: change the profile entry in `preset.json` to `"render": false` → P3 fails (rendered file still has `{{`).
- M9: delete the brief entry from `preset.json` → G2 fails.

After the last restore `git status --short -- get-shit-done/presets` prints nothing. Then the full suite once: `NODE_PATH=$HOME/get-shit-done/node_modules npm test > /tmp/agnostic-C02.log 2>&1; echo rc=$?`.
Commit: `test(agnostic-C2): igaming profile check and brief/profile consistency tests (9 mutants killed)`.
Then write and commit `.planning/agnostic/C/C-02-SUMMARY.md`: outcome, the `key → file:line` trace list from Task 1, commits, tests by name, mutation table, deviations, Self-Check.
  </action>
  <verify>
Single-file run `# fail 0`; G1-G6 and P1-P5 present by name. Full suite `rc=0`, `# fail 0`.
`node scripts/agnostic-lint.js check` → exit 0. `wc -l get-shit-done/bin/preset-igaming.test.js` ≤ 500.
`git status --short` shows only `.audit/`.
  </verify>
  <done>5 behaviours added, 3 updated, 9 mutants killed, suite green.</done>
</task>

</tasks>

<verification>
- `gsd-tools profile check` on a tmp project holding `config.stack.json` → exit 0, no warnings (P1).
- Golden still green: G3 compares 49 files against `golden.sha256`, rendered with the real igaming values.
- No snapshot file changed since C-01: `git diff --stat <C-01 last sha> -- get-shit-done/presets/igaming/rules get-shit-done/presets/igaming/hooks get-shit-done/presets/igaming/skills get-shit-done/presets/igaming/canaries get-shit-done/presets/igaming/CLAUDE.md get-shit-done/presets/igaming/golden.sha256 get-shit-done/presets/igaming/settings.snapshot.json get-shit-done/presets/igaming/settings.fragment.json` is empty.
</verification>

<success_criteria>
The must_haves truths hold, each backed by a named test and a killed mutant; every config value has a `file:line` source in the SUMMARY.
</success_criteria>

<output>
`.planning/agnostic/C/C-02-SUMMARY.md`.
</output>
