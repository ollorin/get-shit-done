---
phase: agnostic-M
plan: 04
type: backend
wave: 6
depends_on: ["01", "03", "08", "09"]
files_modified:
  - get-shit-done/workflows/new-project.md
  - get-shit-done/templates/stack-profile.md
  - commands/gsd/new-project.md
  - commands/gsd/init-project.md
  - get-shit-done/workflows/plan-phase.md
  - get-shit-done/workflows/execute-phase.md
  - get-shit-done/workflows/execute-plan.md
  - get-shit-done/workflows/complete-milestone.md
  - get-shit-done/references/executor-detail.md
  - get-shit-done/references/planner-detail.md
  - get-shit-done/references/planning-config.md
  - agents/*.md
  - get-shit-done/config/prompt-budgets.json
  - get-shit-done/bin/project-context.test.js
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "`/gsd:new-project` writes PRODUCT-BRIEF.md, STACK-PROFILE.md and the project/stack config blocks, then runs `project init`"
    - "The interview deploys the whole base by default; the only deployment questions are whether the project has a backend and a web UI, both on when unsure; the style gate is never a question, only its rule set is"
    - "The interview records the deploy commands that must never be run and `project init` renders them as deny rows"
    - "Every workflow and reference that calls `init plan-phase` or `init execute-phase` passes `--legacy` through and stops on the gate error"
    - "Every installed agent carries the same short pointer block exactly once"
    - "No edit in this plan raises the lint baseline"
  artifacts:
    - commands/gsd/init-project.md
    - get-shit-done/workflows/new-project.md
---

<objective>
D2, D3, D5 and the workflow side of D6. Prompt files only, plus presence tests in `project-context.test.js`. None of the added text may contain a lint term: name no driver, runtime, database or product; say "a pack under `presets/packs/`", "the profile", "the owner".
</objective>

<tasks>

<task id="4.1" type="auto" tdd="true">
<name>Interview: brief step (D2)</name>
<files>get-shit-done/workflows/new-project.md (insert `## 4.5. Product Brief` between :343 and :346; read :1-60, :204-345 only), commands/gsd/new-project.md:17-37</files>
<action>
Step, at most 45 lines. Skip when `brief_exists` (from `init new-project`). Ask only what the questioning of section 3 did not answer (D:288): owner title; risk domains ("what must never break and needs real-database tests": name, what counts as that path, whether a ruling is required); compliance regimes; config dimensions that must never be hard-coded; what the agents may decide alone. Write `.planning/PRODUCT-BRIEF.md` from `templates/product-brief.md` (8 sections, `:10-49`) and the `project` block of `.planning/config.json` (`slug` from the directory name unless given, `owner_title`, `risk_domains`, `ruling_topics`).
Auto mode: take answers from the idea document; for each mandatory value it lacks, write an assumption with the decisions CLI (`references/decisions-protocol.md:13-17`: `decisions add --kind assumption --source new-project --question … --default … --reversibility cheap`) and continue. Defaults: owner title "owner", `risk_domains: []`, `ruling_topics: []`. The empty `risk_domains` default is recorded with `--reversibility costly`, not `cheap`: it decides which paths get real-database tests. With an empty list the init output says `risk_domains_source: "builtin"` and every state-mutating path is treated as a risk-domain path (6.1), so the default is strict, never lax; the assumption text says so.
Command file: add the two new outputs to "Creates" and the two templates to `execution_context`.
</action>
<behavior>
- T2 unit: `new-project.md` has the heading `## 4.5. Product Brief` between sections 4 and 5 and names `templates/product-brief.md` and `--kind assumption`; the line that sets the `risk_domains` default contains `--reversibility costly`. ADD.
</behavior>
<verify>Full gate; lint check ok with no `write-baseline` needed for a rise.</verify>
<done>Step present.</done>
</task>

<task id="4.2" type="auto" tdd="true">
<name>Interview: stack step and init (D2)</name>
<files>get-shit-done/workflows/new-project.md (insert `## 5.6. Stack Profile` between :499 and :501, line numbers before 4.1's insert; read :346-505 only), get-shit-done/templates/stack-profile.md (new section `## Style` before `## Conventions`, `:55`: rule set, roots, and one line each for errors, immutability, routing, purity)</files>
<action>
Step, at most 75 lines. Skip when `stack_profile_exists`. Questions in this order, each skipped when detection answers it (D:283-287):
1. Preset: one of `available_presets`, default `base`, written as `stack.preset`. The base deploys everything by default; there is nothing to opt into. Two questions decide the only gated groups (index decision 4): "does the project have a backend (server-side code that handles requests or stores data)?" and "does it have a web UI?". Yes, unsure or undetected → `stack.capabilities.backend: {}` / `web_ui: {}`; a clear no → `false`. `stack.capabilities` is always written, even when both are `false`. Brownfield: propose answers from `.planning/codebase/STACK.md` and `TESTING.md`, then confirm.
2. Commands: run one test file (must contain `{file}`), run all tests, typecheck, lint, format, pre-PR gate, search; default branch. `test_all`, `typecheck` and `lint` are asked always: the deployed gate script fails on an unset one (8.7). "There is none" is written as the literal `true`. Commands that must run under the stack lock → `stack.locked_commands` (none is a valid answer). Test values that are only right by luck (fixed ids in shared tables, wall-clock windows) → `stack.flake_patterns` (none is a valid answer; the worked example is in `.claude/rules/testing.md`). Dependency scan prerequisite (9.7): when a lockfile is detected, say that the default `dependency-scan` gate needs the external `osv-scanner` binary, which GSD does not install, and print the install line; if the owner declines, write `stack.cve.allow_missing_scanner: true` and record an assumption (without it the gate fails with `NOT INSTALLED: osv-scanner` once a lockfile exists; with it the gate prints `SKIPPED` and exits 0). Auto mode: `osv-scanner` not found on PATH and a lockfile present → the key is written and recorded as an assumption `--reversibility costly`. The step does not write `stack.gates`: the `init` wiring appends the default gates (9.13); project gates are added to the list, never in place of a default.
2a. Style rule set: one of the files under `presets/base/scripts/style-gate/rule-sets/` (`js-ts`, `python`, `generic`), proposed from the detected language, written as `stack.style.rule_set` with `stack.style.roots` (the source directories). There is no question whether the style gate runs. A language with no rule set gets `generic` (size and duplication rules) plus an assumption record. The chosen set's `idioms` are copied into the Style section of `STACK-PROFILE.md` (errors as values, immutability, routing, purity: the concrete library or construct for each).
3. Paths: backend root, migrations, API handler globs, e2e scenarios, frontends.
4. Services: name, URL, health check, launch command, ready signal for each. None is a valid answer.
5. UI QA driver: none (no `ui_qa` key is written), or a pack under `presets/packs/` (the separate driver mechanism, index decision 5); reset commands that must not run during a QA session; protected branches.
6. Deploy targets that must never be touched from an agent session: asked always, answered as the exact command prefixes that reach them (at most 5, characters `[A-Za-z0-9 ._/-]`), written as `stack.deploy.never_touch`; "none" is written as `[]`. `project init` renders each as a deny row (3.12); the step shows the rendered rows from the `init` report and says that a prefix row stops the literal spelling only.
Then: write the `stack` block; write `.planning/STACK-PROFILE.md` from `templates/stack-profile.md`; run `gsd-tools profile check` (stop on failure, show the keys); run `gsd-tools project diff --preset <name>` and show what would be written (read-only); run `gsd-tools project init --preset <name>` (allocates `port_base`, sets the container id to the slug, fills the defaults) and show its `files` report: a `conflict` row means an existing project file was kept, say so; a `refused` result means `.claude/settings.json` already exists, print the same command for the owner to run in a terminal and continue without it; if a UI QA pack was chosen run `gsd-tools pack install <name>` and show `manual_settings` to the owner; finish with `gsd-tools project diff --preset <name>` and report its exit code. Every `diff` call passes `--preset`: without it and without `stack.preset` the command exits 1 with `no preset` (`project-deploy.js:152-153`).
Auto mode: both gated groups are on unless the idea document plainly rules one out (a command-line tool has no web UI); each such "off" is recorded as an assumption. A missing mandatory answer (`test_file`, `test_all`, `typecheck`, `lint`) becomes an assumption as in 4.1, with defaults taken from the detected package manifest; if nothing can be detected, stop and name the key (never invent a command). `stack.style.rule_set` comes from the detected language. `stack.deploy.never_touch` not stated in the idea document → `[]`, recorded as an assumption with `--reversibility costly` (no deploy command is denied until the owner lists one).
</action>
<behavior>
- T2 unit: the step contains, in order, `profile check`, `project diff --preset`, `project init --preset`, and the words `conflict` and `refused`; no `project diff` in the file lacks `--preset`. ADD.
- T2 unit: the step names `stack.preset`, `stack.capabilities.backend`, `stack.capabilities.web_ui` `stack.locked_commands`, `stack.style.rule_set`, `stack.deploy.never_touch` and `stack.flake_patterns`, and contains none of the four former pack keys (`agent_ops`, `quality_gates`, `secure_backend`, `tdd_web`). ADD.
- T2 unit: the step names `osv-scanner` and `allow_missing_scanner`. ADD.
- T2 unit: the step has no line that writes `stack.gates` and no question that makes the style gate optional (it does not match `/(skip|disable|without) the style gate/i`); it names the three rule sets; `templates/stack-profile.md` has a `## Style` heading with the four idiom lines. ADD.
- T2 unit: the workflow file's lint counts equal the baseline before this plan. REUSE `scripts/agnostic-lint.test.js` ratchet (the `check` run in the gate).
</behavior>
<verify>Full gate.</verify>
<done>Step present.</done>
</task>

<task id="4.3" type="auto" tdd="true">
<name>/gsd:init-project and --legacy pass-through in every caller (D3, D6)</name>
<files>commands/gsd/init-project.md (new, under 50 lines, frontmatter as `commands/gsd/new-project.md:1-11`), workflows/plan-phase.md:13-27, workflows/execute-phase.md:27-50, workflows/execute-plan.md:18, workflows/complete-milestone.md:801, references/executor-detail.md:32, references/planner-detail.md:966, references/planning-config.md:51, 149, project-context.test.js</files>
<action>
- Command: for an existing GSD project with no brief or profile. Runs `init new-project`, then steps 4.5 and 5.6 of `new-project.md` only, then commits the new files. `init` never overwrites (index decision 6a); the report is `project diff` (6b). No `sync` anywhere.
- plan-phase / execute-phase: pass `--legacy` to the `init` call when `$ARGUMENTS` contains it; add one line after the call: "If INIT has `error: project_context_missing`: stop, print `missing` and the hint. Do not continue without the brief and profile." Add `brief_path`, `stack_profile_path`, `stack_commands` to the parsed-fields lists; spawned agents receive the two paths in `<files_to_read>` and the commands verbatim.
- The same pass-through and the same stop line go into every other caller, or the gate ends a run in the middle: `execute-plan.md:18`, `executor-detail.md:32`, `planner-detail.md:966`, `complete-milestone.md:801`, `planning-config.md:51` and `:149` (the list `git grep -n -E 'gsd-tools(\.js)?"? init (plan-phase|execute-phase)' -- get-shit-done agents commands` prints at `f6f17bf`, besides the two workflows). A caller with no `$ARGUMENTS` of its own (a reference read by a spawned agent) adds no flag: the command reads `GSD_LEGACY` itself (1.3, exact value `1`). It gets the stop line plus "a legacy project runs with `GSD_LEGACY=1` exported". Do not write `${GSD_LEGACY:+--legacy}`: it would turn `GSD_LEGACY=0` into the flag.
- `execute-roadmap.md` and `plan-phase.md` each get one sentence: an unattended run on a project without a brief exports `GSD_LEGACY=1` before the first command; the flag alone does not reach spawned agents.
</action>
<behavior>
- T2 unit: `commands/gsd/init-project.md` exists with `name: gsd:init-project`; no file under `commands/gsd/` is named `sync-project.md`. ADD.
- T2 unit, presence over a grep list: the test lists every file under `get-shit-done/`, `agents/`, `commands/` with a line matching `init (plan-phase|execute-phase)` after `gsd-tools`; each such file contains `project_context_missing` and either `--legacy` or `GSD_LEGACY`; no file contains `${GSD_LEGACY:+`. The file list is computed, not literal, and the test asserts it has at least 7 files (the seven at `f6f17bf`), so a new caller cannot be missed. ADD.
- T2 unit: `execute-roadmap.md` names `GSD_LEGACY=1`. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Command exists; all seven caller files stop on the gate error.</done>
</task>

<task id="4.4" type="auto" tdd="true">
<name>Pointer block, first 11 agents (D5)</name>
<files>agents/gsd-codebase-mapper.md … agents/gsd-phase-researcher.md (alphabetical, 11 files; read the first 15 lines of each only)</files>
<action>
Insert, directly after the closing `---` of the frontmatter, a blank line and exactly this block (D:188-193), byte-identical in every file:

```
<project_context>
Domain facts and risk domains: `.planning/PRODUCT-BRIEF.md`. Commands, paths, services and tools: `.planning/STACK-PROFILE.md`.
Read the sections your role needs before acting. Every command, path and tool name comes from the profile.
If a key you need is missing, stop and report the key. Never substitute a default stack.
</project_context>
```

Nothing else in the agent changes.
</action>
<behavior>
- Covered by the test added in 4.5. ADD there (one test over all agents; none here, so the suite is not red between the two tasks).
</behavior>
<verify>`git diff --stat` shows 6 added lines per file; full gate.</verify>
<done>11 files carry the block.</done>
</task>

<task id="4.5" type="auto" tdd="true">
<name>Pointer block, remaining 11 agents + presence test (D5)</name>
<files>agents/gsd-plan-checker.md … agents/gsd2-runner.md (11 files), get-shit-done/presets/packs/charlotte/agents/gsd-charlotte-qa.md, get-shit-done/config/prompt-budgets.json, project-context.test.js</files>
<action>Same insert, including the pack agent. If `prompt-budget.test.js` fails for one of the five budgeted agents, raise that budget by the block's size only (about 80 tokens) and say so in the summary.</action>
<behavior>
- T2 unit: every `agents/*.md` and the pack agent contains the block exactly once, byte-equal to one constant in the test; `agents/v2/` is not checked. ADD.
- T2 unit: the block matches no pattern of `terms.json`. ADD.
</behavior>
<verify>Full gate; lint check ok with no rise.</verify>
<done>23 agents carry the block.</done>
</task>

</tasks>

<verification>Full gate; `node scripts/agnostic-lint.js check` ok without `--allow-raise`.</verification>
<success_criteria>The five must-have truths hold; the interview itself is exercised in 7.3.</success_criteria>
<output>`.planning/agnostic/M/M-04-SUMMARY.md`</output>
