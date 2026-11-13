<purpose>
Initialize a new project through unified flow: questioning, research (optional), requirements, roadmap. This is the most leveraged moment in any project — deep questioning here means better plans, better execution, better outcomes. One workflow takes you from idea to ready-for-planning.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<auto_mode>
## Auto Mode Detection

Check if `--auto` flag is present in $ARGUMENTS.

**If auto mode:**
- Skip brownfield mapping offer (assume greenfield)
- Skip deep questioning (extract context from provided document)
- Config: YOLO mode is implicit (skip that question), but ask granularity/git/agents FIRST (Step 2a)
- After config: run Steps 6-9 automatically with smart defaults:
  - Research: Always yes
  - Requirements: Include all table stakes + features from provided document
  - Requirements approval: Auto-approve
  - Roadmap approval: Auto-approve

**Document requirement:**
Auto mode requires an idea document — either:
- File reference: `/gsd:new-project --auto @prd.md`
- Pasted/written text in the prompt

If no document content provided, error:

```
Error: --auto requires an idea document.

Usage:
  /gsd:new-project --auto @your-idea.md
  /gsd:new-project --auto [paste or write your idea here]

The document should describe what you want to build.
```
</auto_mode>

<process>

## 1. Setup

**MANDATORY FIRST STEP — Execute these checks before ANY user interaction:**

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init new-project)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `researcher_model`, `synthesizer_model`, `roadmapper_model`, `commit_docs`, `project_exists`, `has_codebase_map`, `planning_exists`, `has_existing_code`, `has_package_file`, `is_brownfield`, `needs_codebase_map`, `has_git`, `project_path`.

**If `project_exists` is true:** Error — project already initialized. Use `/gsd:progress`.

**If `has_git` is false:** Initialize git:
```bash
git init
```

## 2. Brownfield Offer

**If auto mode:** Skip to Step 4 (assume greenfield, synthesize PROJECT.md from provided document).

**If `needs_codebase_map` is true** (from init — existing code detected but no codebase map):

Use AskUserQuestion:
- header: "Codebase"
- question: "I detected existing code in this directory. Would you like to map the codebase first?"
- options:
  - "Map codebase first" — Run /gsd:map-codebase to understand existing architecture (Recommended)
  - "Skip mapping" — Proceed with project initialization

**If "Map codebase first":**
```
Run `/gsd:map-codebase` first, then return to `/gsd:new-project`
```
Exit command.

**If "Skip mapping" OR `needs_codebase_map` is false:** Continue to Step 3.

## 2a. Auto Mode Config (auto mode only)

**If auto mode:** Collect config settings upfront before processing the idea document.

YOLO mode is implicit (auto = YOLO). Ask remaining config questions. If they cannot be asked (no interactive channel), apply exactly these defaults, the options labelled "(Recommended)": `granularity: "coarse"`, `parallelization.enabled: true`, `planning.commit_docs: true`, `model_profile: "balanced"`, `workflow.research`, `workflow.plan_check` and `workflow.verifier` all `true`. Never pick the cheaper option implicitly.

**Round 1 — Core settings (3 questions, no Mode question):**

```
AskUserQuestion([
  {
    header: "Granularity",
    question: "How finely should scope be sliced into phases?",
    multiSelect: false,
    options: [
      { label: "Coarse (Recommended)", description: "Fewer, broader phases (3-5 phases, 1-3 plans each)" },
      { label: "Standard", description: "Balanced phase size (5-8 phases, 3-5 plans each)" },
      { label: "Fine", description: "Many focused phases (8-12 phases, 5-10 plans each)" }
    ]
  },
  {
    header: "Execution",
    question: "Run plans in parallel?",
    multiSelect: false,
    options: [
      { label: "Parallel (Recommended)", description: "Independent plans run simultaneously" },
      { label: "Sequential", description: "One plan at a time" }
    ]
  },
  {
    header: "Git Tracking",
    question: "Commit planning docs to git?",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Planning docs tracked in version control" },
      { label: "No", description: "Keep .planning/ local-only (add to .gitignore)" }
    ]
  }
])
```

**Round 2 — Workflow agents (same as Step 5):**

```
AskUserQuestion([
  {
    header: "Research",
    question: "Research before planning each phase? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Investigate domain, find patterns, surface gotchas" },
      { label: "No", description: "Plan directly from requirements" }
    ]
  },
  {
    header: "Plan Check",
    question: "Verify plans will achieve their goals? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Catch gaps before execution starts" },
      { label: "No", description: "Execute plans without verification" }
    ]
  },
  {
    header: "Verifier",
    question: "Verify work satisfies requirements after each phase? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Confirm deliverables match phase goals" },
      { label: "No", description: "Trust execution, skip verification" }
    ]
  },
  {
    header: "AI Models",
    question: "Which AI models for planning agents?",
    multiSelect: false,
    options: [
      { label: "Balanced (Recommended)", description: "Strong planning, cheap execution — good quality/cost ratio (see references/model-profiles.md)" },
      { label: "Quality", description: "Strongest model for research/roadmap — higher cost, deeper analysis" },
      { label: "Budget", description: "Cheapest model where possible — fastest, lowest cost" }
    ]
  }
])
```

Merge these keys into `.planning/config.json` with mode set to "yolo". Never overwrite an existing file: it may already hold `project`/`stack` blocks. Write each key with `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set <key.path> <value>` (e.g. `parallelization.enabled`, `planning.commit_docs`); the JSON below is the resulting shape:

```json
{
  "mode": "yolo",
  "granularity": "[selected]",
  "model_profile": "quality|balanced|budget",
  "models": { "top": "opus" },
  "parallelization": { "enabled": true|false },
  "planning": { "commit_docs": true|false },
  "workflow": {
    "research": true|false,
    "plan_check": true|false,
    "verifier": true|false,
    "nyquist_validation": granularity !== "quick",
    "auto_advance": true
  }
}
```

**If commit_docs = No:** Add `.planning/` to `.gitignore`.

**Commit config.json:**

```bash
mkdir -p .planning
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "chore: add project config" --files .planning/config.json
```

**Persist auto-advance chain flag to config (survives context compaction):**

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set workflow._auto_chain_active true
```

Proceed to Step 4 (skip Steps 3 and 5).

## 3. Deep Questioning

**If auto mode:** Skip (already handled in Step 2a). Extract project context from provided document instead and proceed to Step 4.

**Display stage banner:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► QUESTIONING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Open the conversation:**

Ask inline (freeform, NOT AskUserQuestion):

"What do you want to build?"

Wait for their response. This gives you the context needed to ask intelligent follow-up questions.

**Follow the thread:**

Based on what they said, ask follow-up questions that dig into their response. Use AskUserQuestion with options that probe what they mentioned — interpretations, clarifications, concrete examples.

Keep following threads. Each answer opens new threads to explore. Ask about:
- What excited them
- What problem sparked this
- What they mean by vague terms
- What it would actually look like
- What's already decided

Consult `questioning.md` for techniques:
- Challenge vagueness
- Make abstract concrete
- Surface assumptions
- Find edges
- Reveal motivation

**Check context (background, not out loud):**

As you go, mentally check the context checklist from `questioning.md`. If gaps remain, weave questions naturally. Don't suddenly switch to checklist mode.

**Decision gate:**

When you could write a clear PROJECT.md, use AskUserQuestion:

- header: "Ready?"
- question: "I think I understand what you're after. Ready to create PROJECT.md?"
- options:
  - "Create PROJECT.md" — Let's move forward
  - "Keep exploring" — I want to share more / ask me more

If "Keep exploring" — ask what they want to add, or identify gaps and probe naturally.

Loop until "Create PROJECT.md" selected.

## 4. Write PROJECT.md

**If auto mode:** Synthesize from provided document. No "Ready?" gate was shown — proceed directly to commit.

Synthesize all context into `.planning/PROJECT.md` using the template from `templates/project.md`.

**For greenfield projects:**

Initialize requirements as hypotheses:

```markdown
## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] [Requirement 1]
- [ ] [Requirement 2]
- [ ] [Requirement 3]

### Out of Scope

- [Exclusion 1] — [why]
- [Exclusion 2] — [why]
```

All Active requirements are hypotheses until shipped and validated.

**For brownfield projects (codebase map exists):**

Infer Validated requirements from existing code:

1. Read `.planning/codebase/ARCHITECTURE.md` and `STACK.md`
2. Identify what the codebase already does
3. These become the initial Validated set

```markdown
## Requirements

### Validated

- ✓ [Existing capability 1] — existing
- ✓ [Existing capability 2] — existing
- ✓ [Existing capability 3] — existing

### Active

- [ ] [New requirement 1]
- [ ] [New requirement 2]

### Out of Scope

- [Exclusion 1] — [why]
```

**Key Decisions:**

Initialize with any decisions made during questioning:

```markdown
## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| [Choice from questioning] | [Why] | — Pending |
```

**Last updated footer:**

```markdown
---
*Last updated: [date] after initialization*
```

Do not compress. Capture everything gathered.

**Commit PROJECT.md:**

```bash
mkdir -p .planning
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: initialize project" --files .planning/PROJECT.md
```

## 4.5. Product Brief

**Adopt first.** When `context_gate.adoptable.brief` is non-null (a root `PRODUCT-BRIEF.md` exists, `.planning/PRODUCT-BRIEF.md` does not), run `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" project adopt-brief` (copy-if-absent, never overwrites) and record `adopted.from` as the source in your output; the adopted brief is then offered as the proposed answers below.

**Skip when `context_gate` (from `init new-project`) lists neither `.planning/PRODUCT-BRIEF.md` nor any `project.*` key under `missing` or `invalid`.** A half-written section is not skipped: an existing brief or `project` block is offered as the proposed answers.

Otherwise ask only what section 3 did not answer, one question at a time, each phrased so the answer is a choice:

1. Owner title: how rulings address the owner.
2. Risk domains: what must never break and needs real-database tests. For each: an id, the paths or flows that count as it, and whether a ruling is required.
3. Compliance regimes that apply, one line each.
4. Config dimensions that must never be hard-coded (markets, currencies, modes), each with its config key.
5. Decisions the agents may take alone, and the decisions that go to the owner.

Write `.planning/PRODUCT-BRIEF.md` from `@~/.claude/get-shit-done/templates/product-brief.md`. Then write the `project` block of `.planning/config.json`: `slug` (the directory name unless the owner gave one), `owner_title`, `risk_domains` (ids), `ruling_topics` (ids a ruling covers).

**Auto mode:** take the answers from the idea document. For each mandatory value it lacks, record an assumption and continue:

```bash
node "$HOME/.claude/get-shit-done/bin/decisions.js" add --kind assumption --source new-project --question "Owner title" --default "owner" --reversibility cheap
node "$HOME/.claude/get-shit-done/bin/decisions.js" add --kind assumption --source new-project --question "Risk domains: empty list, so every state-mutating path is a risk-domain path" --default "[]" --reversibility costly
```

`ruling_topics` defaults to `[]`, recorded with `--reversibility cheap`. The empty `risk_domains` default is recorded `costly`, not `cheap`: it decides which paths get real-database tests. With an empty list, `init` reports `risk_domains_source: "builtin"` and every state-mutating path is treated as a risk-domain path, so the default is strict, never lax. The assumption text says so.

## 5. Workflow Preferences

**If auto mode:** Skip — config was collected in Step 2a. Proceed to Step 5.5.

**Check for global defaults** at `~/.gsd/defaults.json`. If the file exists, offer to use saved defaults:

```
AskUserQuestion([
  {
    question: "Use your saved default settings? (from ~/.gsd/defaults.json)",
    header: "Defaults",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Use saved defaults, skip settings questions" },
      { label: "No", description: "Configure settings manually" }
    ]
  }
])
```

If "Yes": read `~/.gsd/defaults.json`, use those values for config.json, and skip directly to **Commit config.json** below.

If "No" or `~/.gsd/defaults.json` doesn't exist: proceed with the questions below.

**Round 1 — Core workflow settings (4 questions):**

```
questions: [
  {
    header: "Mode",
    question: "How do you want to work?",
    multiSelect: false,
    options: [
      { label: "YOLO (Recommended)", description: "Auto-approve, just execute" },
      { label: "Interactive", description: "Confirm at each step" }
    ]
  },
  {
    header: "Granularity",
    question: "How finely should scope be sliced into phases?",
    multiSelect: false,
    options: [
      { label: "Coarse", description: "Fewer, broader phases (3-5 phases, 1-3 plans each)" },
      { label: "Standard", description: "Balanced phase size (5-8 phases, 3-5 plans each)" },
      { label: "Fine", description: "Many focused phases (8-12 phases, 5-10 plans each)" }
    ]
  },
  {
    header: "Execution",
    question: "Run plans in parallel?",
    multiSelect: false,
    options: [
      { label: "Parallel (Recommended)", description: "Independent plans run simultaneously" },
      { label: "Sequential", description: "One plan at a time" }
    ]
  },
  {
    header: "Git Tracking",
    question: "Commit planning docs to git?",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Planning docs tracked in version control" },
      { label: "No", description: "Keep .planning/ local-only (add to .gitignore)" }
    ]
  }
]
```

**Round 2 — Workflow agents:**

These spawn additional agents during planning/execution. They add tokens and time but improve quality.

| Agent | When it runs | What it does |
|-------|--------------|--------------|
| **Researcher** | Before planning each phase | Investigates domain, finds patterns, surfaces gotchas |
| **Plan Checker** | After plan is created | Verifies plan actually achieves the phase goal |
| **Verifier** | After phase execution | Confirms must-haves were delivered |

All recommended for important projects. Skip for quick experiments.

```
questions: [
  {
    header: "Research",
    question: "Research before planning each phase? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Investigate domain, find patterns, surface gotchas" },
      { label: "No", description: "Plan directly from requirements" }
    ]
  },
  {
    header: "Plan Check",
    question: "Verify plans will achieve their goals? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Catch gaps before execution starts" },
      { label: "No", description: "Execute plans without verification" }
    ]
  },
  {
    header: "Verifier",
    question: "Verify work satisfies requirements after each phase? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Confirm deliverables match phase goals" },
      { label: "No", description: "Trust execution, skip verification" }
    ]
  },
  {
    header: "AI Models",
    question: "Which AI models for planning agents?",
    multiSelect: false,
    options: [
      { label: "Balanced (Recommended)", description: "Strong planning, cheap execution — good quality/cost ratio (see references/model-profiles.md)" },
      { label: "Quality", description: "Strongest model for research/roadmap — higher cost, deeper analysis" },
      { label: "Budget", description: "Cheapest model where possible — fastest, lowest cost" }
    ]
  }
]
```

Merge these settings into `.planning/config.json`. Never overwrite an existing file: it may already hold `project`/`stack` blocks. Write each key with `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set <key.path> <value>`; the JSON below is the resulting shape:

```json
{
  "mode": "yolo|interactive",
  "granularity": "coarse|standard|fine",
  "model_profile": "quality|balanced|budget",
  "models": { "top": "opus" },
  "parallelization": { "enabled": true|false },
  "planning": { "commit_docs": true|false },
  "workflow": {
    "research": true|false,
    "plan_check": true|false,
    "verifier": true|false,
    "nyquist_validation": granularity !== "quick"
  }
}
```

**If commit_docs = No:**
- Set `planning.commit_docs: false` in config.json
- Add `.planning/` to `.gitignore` (create if needed)

**If commit_docs = Yes:**
- No additional gitignore entries needed

**Commit config.json:**

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "chore: add project config" --files .planning/config.json
```

**Note:** Run `/gsd:settings` anytime to update these preferences.

## 5.5. Resolve Model Profile

Use models from init: `researcher_model`, `synthesizer_model`, `roadmapper_model`.

## 5.6. Stack Profile

**Skip when `context_gate` (from `init new-project`) lists neither `.planning/STACK-PROFILE.md` nor any `stack.*` key under `missing` or `invalid`.** A half-written section is not skipped: an existing `stack` block is offered as the proposed answers. Keys that only `project init` defaults (`stack.branch.default`, `stack.commands.search`, `stack.commands.pre_pr_gate`, isolation) are not in the gate's list.

Ask in this order. Skip any question that detection already answers. Brownfield: propose each answer from `.planning/codebase/STACK.md` and `TESTING.md`, then confirm it.

1. **Preset.** One of `available_presets`, default `base`, written as `stack.preset`. The base deploys everything by default; there is nothing to opt into. Two questions decide the only gated groups:
   - "Does the project have a backend (server-side code that handles requests or stores data)?"
   - "Does it have a web UI?"

   Yes, unsure or undetected → `stack.capabilities.backend: {}` / `stack.capabilities.web_ui: {}`. A clear no → `false`. `stack.capabilities` is always written, even when both are `false`.

2. **Commands.** Ask for: run one test file (the value must contain `{file}`), run all tests, typecheck, lint, format, pre-PR gate, search, and the default branch.
   - `test_all`, `typecheck` and `lint` are always asked: the deployed gate script fails on an unset one. "There is none" is written as the literal `true`. A project with no code yet writes `none` (or `null`) for `test_file`, `test_all`, `typecheck` and `lint` instead: the context gate passes with a `not configured yet` warning, `STACK-PROFILE.md` records it as `not configured yet`, and the pre-PR gate skips the command with a visible warning and ends `PASSED, BUT NOT CONFIGURED`, never a silent pass. Replace each with a real command once code exists.
   - Commands that must run under the stack lock → `stack.locked_commands` (none is `[]`).
   - Test values that are right only by luck (fixed ids in shared tables, wall-clock windows) → `stack.flake_patterns` (none: omit the key). The worked example is in `.claude/rules/testing.md`.
   - Dependency scan: when a lockfile is detected, say that the default `dependency-scan` gate needs the external `osv-scanner` binary, which GSD does not install, and print its install instructions. If the owner declines to install it, write `stack.cve.allow_missing_scanner: true` and record an assumption. Without the key the gate fails with `NOT INSTALLED: osv-scanner` once a lockfile exists; with it the gate prints `SKIPPED` and exits 0.
   - This step writes no gate list: `init` appends the default gates. Project gates are added to that list, never in place of a default.

2a. **Style rule set.** One of the rule sets under `presets/base/scripts/style-gate/rule-sets/`: `js-ts`, `python` or `generic`. Propose it from the detected language and write `stack.style.rule_set` with `stack.style.roots` (the source directories). There is no question whether the style gate runs. A language with no rule set gets `generic` and an assumption record. Copy the chosen set's `idioms` into the Style section of `STACK-PROFILE.md`, with the concrete library or construct the project uses for errors as values, immutability, routing and purity. Every root must exist when the gate runs (a missing directory exits 1 with `roots entry is not a directory`). When the source root does not exist yet (greenfield): choose the root, create it with an empty `.gitkeep`, and record it in `stack.style.roots`; do the same for every other new root.

3. **Paths.** Backend root, migrations, API handler globs, e2e scenarios, frontends. Written as `stack.paths`.

4. **Services.** For each: name, URL, health (URL or path), health command if a shell check is needed, launch command, ready signal. None is a valid answer. Written as `stack.services`.

5. **UI QA driver.** None (no `ui_qa` key is written), or a pack under `presets/packs/`, which is a separate mechanism and is installed only when named here. Also: reset commands that must not run during a QA session, and protected branches.

6. **Never-touch deploy targets.** Always asked. Answer with the exact command prefixes that reach them: at most 5, each using only `A-Za-z0-9 ._/-`. Written as `stack.deploy.never_touch`; "none" is written as `[]`. `project init` renders each one as a deny row, and a prefix row stops the literal spelling only. Show the owner the rendered rows from the `init` report and say so.

**Then, in order:**

1. Write the `stack` block of `.planning/config.json`. Keep the `project` block from 4.5.
2. Run the profile check and stop on failure, showing the keys it names: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" profile check`
3. Deploy: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" project init --preset <name>`. It allocates `port_base`, sets the container id to the slug and fills the defaults (`stack.branch.default`, `stack.commands.search`, `stack.commands.pre_pr_gate`). Show its `files` report:
   - a `conflict` row means an existing project file was kept; say so.
   - a `refused` result means `.claude/settings.json` already exists. Print the same command for the owner to run in a terminal, and continue without it.
   - `project init` exiting 1 with `already initialised: run project sync` means an earlier run already deployed (the context gate re-ran this section because STACK-PROFILE.md is missing). Run `project sync --preset <name>` instead and continue to step 4. A sync exit code 2 is a kept conflict: continue, and report it.
4. Write `.planning/STACK-PROFILE.md` from `@~/.claude/get-shit-done/templates/stack-profile.md`. It is written last, after the profile check passed and `init` (or `sync`) ran. A `refused` settings file (step 3) is not a failed deploy: it leaves the rest deployed and `.claude/settings.json` for the owner to apply, so the file's existence does not mean settings.json was written.
5. If a UI QA pack was chosen, run `gsd-tools pack install <name>` and show the owner its `manual_settings`.
6. Review the deployment with `project diff --preset <name>` and report its exit code. There is no `diff` before the deploy: it exits 1 on the defaulted keys of step 3 until `init` has written them.

Every `diff` call passes `--preset`: without it and without `stack.preset` the command exits 1 with `no preset`.

**Auto mode:** both gated groups are on unless the idea document plainly rules one out (a command-line tool has no web UI). Record each "off" as an assumption with the decisions CLI, as in 4.5, with `--reversibility costly`. A `typecheck` or `lint` the idea document says does not exist is written as the literal `true`, with no assumption. A missing mandatory answer (`test_file`, `test_all`, `typecheck`, `lint`) becomes an assumption, with defaults taken from the detected package manifest. If nothing can be detected and the project has no code yet, write `none` for that key (an assumption is recorded); if it has code, stop and name the key; never invent a command. No UI QA driver (no `ui_qa` key written) → record an assumption: `node "$HOME/.claude/get-shit-done/bin/decisions.js" add --kind assumption --source new-project --question "UI QA driver: none, so no UI QA runs and ui_qa_ran is false each phase" --default "none" --reversibility costly`. `stack.style.rule_set` comes from the detected language. `stack.deploy.never_touch` not stated in the idea document → `[]`, recorded as an assumption with `--reversibility costly`: no deploy command is denied until the owner lists one. `osv-scanner` not found on PATH and a lockfile present → write `stack.cve.allow_missing_scanner: true` and record an assumption with `--reversibility costly`.

## 6. Research Decision

**If auto mode:** Default to "Research first" without asking.

Use AskUserQuestion:
- header: "Research"
- question: "Research the domain ecosystem before defining requirements?"
- options:
  - "Research first (Recommended)" — Discover standard stacks, expected features, architecture patterns
  - "Skip research" — I know this domain well, go straight to requirements

**If "Research first":**

Display stage banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCHING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Researching [domain] ecosystem...
```

Create research directory:
```bash
mkdir -p .planning/research
```

**Determine milestone context:**

Check if this is greenfield or subsequent milestone:
- If no "Validated" requirements in PROJECT.md → Greenfield (building from scratch)
- If "Validated" requirements exist → Subsequent milestone (adding to existing app)

Display spawning indicator:
```
◆ Spawning 4 researchers in parallel...
  → Stack research
  → Features research
  → Architecture research
  → Pitfalls research
```

Spawn 4 parallel gsd-project-researcher agents with path references:

```
Agent(prompt="<research_type>
Project Research — Stack dimension for [domain].
</research_type>

<milestone_context>
[greenfield OR subsequent]

Greenfield: Research the standard stack for building [domain] from scratch.
Subsequent: Research what's needed to add [target features] to an existing [domain] app. Don't re-research the existing system.
</milestone_context>

<question>
What's the standard 2025 stack for [domain]?
</question>

<files_to_read>
- {project_path} (Project context and goals)
</files_to_read>

<downstream_consumer>
Your STACK.md feeds into roadmap creation. Be prescriptive:
- Specific libraries with versions
- Clear rationale for each choice
- What NOT to use and why
</downstream_consumer>

<quality_gate>
- [ ] Versions are current (verify with Context7/official docs, not training data)
- [ ] Rationale explains WHY, not just WHAT
- [ ] Confidence levels assigned to each recommendation
</quality_gate>

<output>
Write to: .planning/research/STACK.md
Use template: ~/.claude/get-shit-done/templates/research-project/STACK.md
</output>
", subagent_type="gsd-project-researcher", model="{researcher_model}", description="Stack research", run_in_background=true)

Agent(prompt="<research_type>
Project Research — Features dimension for [domain].
</research_type>

<milestone_context>
[greenfield OR subsequent]

Greenfield: What features do [domain] products have? What's table stakes vs differentiating?
Subsequent: How do [target features] typically work? What's expected behavior?
</milestone_context>

<question>
What features do [domain] products have? What's table stakes vs differentiating?
</question>

<files_to_read>
- {project_path} (Project context)
</files_to_read>

<downstream_consumer>
Your FEATURES.md feeds into requirements definition. Categorize clearly:
- Table stakes (must have or users leave)
- Differentiators (competitive advantage)
- Anti-features (things to deliberately NOT build)
</downstream_consumer>

<quality_gate>
- [ ] Categories are clear (table stakes vs differentiators vs anti-features)
- [ ] Complexity noted for each feature
- [ ] Dependencies between features identified
</quality_gate>

<output>
Write to: .planning/research/FEATURES.md
Use template: ~/.claude/get-shit-done/templates/research-project/FEATURES.md
</output>
", subagent_type="gsd-project-researcher", model="{researcher_model}", description="Features research", run_in_background=true)

Agent(prompt="<research_type>
Project Research — Architecture dimension for [domain].
</research_type>

<milestone_context>
[greenfield OR subsequent]

Greenfield: How are [domain] systems typically structured? What are major components?
Subsequent: How do [target features] integrate with existing [domain] architecture?
</milestone_context>

<question>
How are [domain] systems typically structured? What are major components?
</question>

<files_to_read>
- {project_path} (Project context)
</files_to_read>

<downstream_consumer>
Your ARCHITECTURE.md informs phase structure in roadmap. Include:
- Component boundaries (what talks to what)
- Data flow (how information moves)
- Suggested build order (dependencies between components)
</downstream_consumer>

<quality_gate>
- [ ] Components clearly defined with boundaries
- [ ] Data flow direction explicit
- [ ] Build order implications noted
</quality_gate>

<output>
Write to: .planning/research/ARCHITECTURE.md
Use template: ~/.claude/get-shit-done/templates/research-project/ARCHITECTURE.md
</output>
", subagent_type="gsd-project-researcher", model="{researcher_model}", description="Architecture research", run_in_background=true)

Agent(prompt="<research_type>
Project Research — Pitfalls dimension for [domain].
</research_type>

<milestone_context>
[greenfield OR subsequent]

Greenfield: What do [domain] projects commonly get wrong? Critical mistakes?
Subsequent: What are common mistakes when adding [target features] to [domain]?
</milestone_context>

<question>
What do [domain] projects commonly get wrong? Critical mistakes?
</question>

<files_to_read>
- {project_path} (Project context)
</files_to_read>

<downstream_consumer>
Your PITFALLS.md prevents mistakes in roadmap/planning. For each pitfall:
- Warning signs (how to detect early)
- Prevention strategy (how to avoid)
- Which phase should address it
</downstream_consumer>

<quality_gate>
- [ ] Pitfalls are specific to this domain (not generic advice)
- [ ] Prevention strategies are actionable
- [ ] Phase mapping included where relevant
</quality_gate>

<output>
Write to: .planning/research/PITFALLS.md
Use template: ~/.claude/get-shit-done/templates/research-project/PITFALLS.md
</output>
", subagent_type="gsd-project-researcher", model="{researcher_model}", description="Pitfalls research", run_in_background=true)
```

**Fan-out completion gate (verify all 4 artifacts exist on disk BEFORE spawning the synthesizer).**
"After all 4 agents complete" is not enough — an agent can return without having written its file.
Confirm every expected artifact exists and is non-empty:

```bash
MISSING=""
for f in STACK FEATURES ARCHITECTURE PITFALLS; do
  [ -s ".planning/research/$f.md" ] || MISSING="$MISSING $f.md"
done
if [ -n "$MISSING" ]; then
  echo "Research fan-out incomplete — missing/empty:$MISSING"
fi
```

If any are missing/empty: re-spawn ONLY the researcher(s) for the missing file(s) once, then re-check.
If still missing after the retry, STOP and report which research files were not produced — do NOT
spawn the synthesizer against an incomplete input set (it would silently synthesize from partial data).

Only once all 4 files exist and are non-empty, spawn the synthesizer to create SUMMARY.md:

```
Agent(prompt="
<task>
Synthesize research outputs into SUMMARY.md.
</task>

<files_to_read>
- .planning/research/STACK.md
- .planning/research/FEATURES.md
- .planning/research/ARCHITECTURE.md
- .planning/research/PITFALLS.md
</files_to_read>

<output>
Write to: .planning/research/SUMMARY.md
Use template: ~/.claude/get-shit-done/templates/research-project/SUMMARY.md
Commit after writing.
</output>
", subagent_type="gsd-research-synthesizer", model="{synthesizer_model}", description="Synthesize research")
```

Display research complete banner and key findings:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCH COMPLETE ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Key Findings

**Stack:** [from SUMMARY.md]
**Table Stakes:** [from SUMMARY.md]
**Watch Out For:** [from SUMMARY.md]

Files: `.planning/research/`
```

**If "Skip research":** Continue to Step 7.

## 7. Define Requirements

Display stage banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► DEFINING REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Load context:**

Read PROJECT.md and extract:
- Core value (the ONE thing that must work)
- Stated constraints (budget, timeline, tech limitations)
- Any explicit scope boundaries

**If research exists:** Read research/FEATURES.md and extract feature categories.

**If auto mode:**
- Auto-include all table stakes features (users expect these)
- Include features explicitly mentioned in provided document
- Auto-defer differentiators not mentioned in document
- Skip per-category AskUserQuestion loops
- Skip "Any additions?" question
- Skip requirements approval gate
- Generate REQUIREMENTS.md and commit directly

**Present features by category (interactive mode only):**

```
Here are the features for [domain]:

## Authentication
**Table stakes:**
- Sign up with email/password
- Email verification
- Password reset
- Session management

**Differentiators:**
- Magic link login
- OAuth (Google, GitHub)
- 2FA

**Research notes:** [any relevant notes]

---

## [Next Category]
...
```

**If no research:** Gather requirements through conversation instead.

Ask: "What are the main things users need to be able to do?"

For each capability mentioned:
- Ask clarifying questions to make it specific
- Probe for related capabilities
- Group into categories

**Scope each category:**

For each category, use AskUserQuestion:

- header: "[Category]" (max 12 chars)
- question: "Which [category] features are in v1?"
- multiSelect: true
- options:
  - "[Feature 1]" — [brief description]
  - "[Feature 2]" — [brief description]
  - "[Feature 3]" — [brief description]
  - "None for v1" — Defer entire category

Track responses:
- Selected features → v1 requirements
- Unselected table stakes → v2 (users expect these)
- Unselected differentiators → out of scope

**Identify gaps:**

Use AskUserQuestion:
- header: "Additions"
- question: "Any requirements research missed? (Features specific to your vision)"
- options:
  - "No, research covered it" — Proceed
  - "Yes, let me add some" — Capture additions

**Validate core value:**

Cross-check requirements against Core Value from PROJECT.md. If gaps detected, surface them.

**Generate REQUIREMENTS.md:**

Create `.planning/REQUIREMENTS.md` with:
- v1 Requirements grouped by category (checkboxes, REQ-IDs)
- v2 Requirements (deferred)
- Out of Scope (explicit exclusions with reasoning)
- Traceability section (empty, filled by roadmap)

**REQ-ID format:** `[CATEGORY]-[NUMBER]` (AUTH-01, CONTENT-02)

**Requirement quality criteria:**

Good requirements are:
- **Specific and testable:** "User can reset password via email link" (not "Handle password reset")
- **User-centric:** "User can X" (not "System does Y")
- **Atomic:** One capability per requirement (not "User can login and manage profile")
- **Independent:** Minimal dependencies on other requirements

Reject vague requirements. Push for specificity:
- "Handle authentication" → "User can log in with email/password and stay logged in across sessions"
- "Support sharing" → "User can share post via link that opens in recipient's browser"

**Present full requirements list (interactive mode only):**

Show every requirement (not counts) for user confirmation:

```
## v1 Requirements

### Authentication
- [ ] **AUTH-01**: User can create account with email/password
- [ ] **AUTH-02**: User can log in and stay logged in across sessions
- [ ] **AUTH-03**: User can log out from any page

### Content
- [ ] **CONT-01**: User can create posts with text
- [ ] **CONT-02**: User can edit their own posts

[... full list ...]

---

Does this capture what you're building? (yes / adjust)
```

If "adjust": Return to scoping.

**Commit requirements:**

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: define v1 requirements" --files .planning/REQUIREMENTS.md
```

## 8. Create Roadmap

Display stage banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► CREATING ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning roadmapper...
```

Spawn gsd-roadmapper agent with path references:

```
Agent(prompt="
<planning_context>

<files_to_read>
- .planning/PROJECT.md (Project context)
- .planning/REQUIREMENTS.md (v1 Requirements)
- .planning/research/SUMMARY.md (Research findings - if exists)
- .planning/config.json (Granularity and mode settings)
</files_to_read>

</planning_context>

<instructions>
Create roadmap:
1. Derive phases from requirements (don't impose structure)
2. Map every v1 requirement to exactly one phase
3. Derive 2-5 success criteria per phase (observable user behaviors)
4. Validate 100% coverage
5. Write files immediately (ROADMAP.md, STATE.md, update REQUIREMENTS.md traceability)
6. Return ROADMAP CREATED with summary

Write files first, then return. This ensures artifacts persist even if context is lost.
</instructions>
", subagent_type="gsd-roadmapper", model="{roadmapper_model}", description="Create roadmap")
```

**Handle roadmapper return:**

**If `## ROADMAP BLOCKED`:**
- Present blocker information
- Work with user to resolve
- Re-spawn when resolved

**If `## ROADMAP CREATED`:**

Read the created ROADMAP.md and present it nicely inline:

```
---

## Proposed Roadmap

**[N] phases** | **[X] requirements mapped** | All v1 requirements covered ✓

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | [Name] | [Goal] | [REQ-IDs] | [count] |
| 2 | [Name] | [Goal] | [REQ-IDs] | [count] |
| 3 | [Name] | [Goal] | [REQ-IDs] | [count] |
...

### Phase Details

**Phase 1: [Name]**
Goal: [goal]
Requirements: [REQ-IDs]
Success criteria:
1. [criterion]
2. [criterion]
3. [criterion]

**Phase 2: [Name]**
Goal: [goal]
Requirements: [REQ-IDs]
Success criteria:
1. [criterion]
2. [criterion]

[... continue for all phases ...]

---
```

**Decision points (before approval).** Follow `Roadmap decision points` in `@~/.claude/get-shit-done/references/decisions-protocol.md` (the roadmapper's `## Decision Points` table); its "approval prompt" is the gate below. Auto mode counts as unattended there.

**If auto mode:** Skip approval gate — auto-approve and commit directly.

**CRITICAL: Ask for approval before committing (interactive mode only):**

Use AskUserQuestion:
- header: "Roadmap"
- question: "Does this roadmap structure work for you?"
- options:
  - "Approve" — Commit and continue
  - "Adjust phases" — Tell me what to change
  - "Review full file" — Show raw ROADMAP.md

**If "Approve":** Continue to commit.

**If "Adjust phases":**
- Get user's adjustment notes
- Re-spawn roadmapper with revision context:
  ```
  Agent(prompt="
  <revision>
  User feedback on roadmap:
  [user's notes]

  <files_to_read>
  - .planning/ROADMAP.md (Current roadmap to revise)
  </files_to_read>

  Update the roadmap based on feedback. Edit files in place.
  Return ROADMAP REVISED with changes made.
  </revision>
  ", subagent_type="gsd-roadmapper", model="{roadmapper_model}", description="Revise roadmap")
  ```
- Present revised roadmap
- Loop until user approves

**If "Review full file":** Display raw `cat .planning/ROADMAP.md`, then re-ask.

**Commit roadmap (after approval or auto mode):**

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: create roadmap ([N] phases)" --files .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md
```

## 9. Done

Present completion summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PROJECT INITIALIZED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**[Project Name]**

| Artifact       | Location                    |
|----------------|-----------------------------|
| Project        | `.planning/PROJECT.md`      |
| Config         | `.planning/config.json`     |
| Research       | `.planning/research/`       |
| Requirements   | `.planning/REQUIREMENTS.md` |
| Roadmap        | `.planning/ROADMAP.md`      |

**[N] phases** | **[X] requirements** | Ready to build ✓
```

**If auto mode:**

```
╔══════════════════════════════════════════╗
║  AUTO-ADVANCING → EXECUTE ROADMAP        ║
╚══════════════════════════════════════════╝
```

Auto (auto_mode, references/auto-mode.md K1): hand the whole roadmap to the unattended run; no phase is discussed by hand.

Exit skill and invoke SlashCommand("/gsd:execute-roadmap --auto")

**If interactive mode:**

```
───────────────────────────────────────────────────────────────

## ▶ Next Up

**Phase 1: [Phase Name]** — [Goal from ROADMAP.md]

/gsd:discuss-phase 1 — gather context and clarify approach

<sub>/clear first → fresh context window</sub>

---

**Also available:**
- /gsd:plan-phase 1 — skip discussion, plan directly

───────────────────────────────────────────────────────────────
```

</process>

<output>

- `.planning/PROJECT.md`
- `.planning/config.json`
- `.planning/research/` (if research selected)
  - `STACK.md`
  - `FEATURES.md`
  - `ARCHITECTURE.md`
  - `PITFALLS.md`
  - `SUMMARY.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

</output>

<success_criteria>

- [ ] .planning/ directory created
- [ ] Git repo initialized
- [ ] Brownfield detection completed
- [ ] Deep questioning completed (threads followed, not rushed)
- [ ] PROJECT.md captures full context → **committed**
- [ ] config.json has workflow mode, granularity, parallelization → **committed**
- [ ] Research completed (if selected) — 4 parallel agents spawned → **committed**
- [ ] Requirements gathered (from research or conversation)
- [ ] User scoped each category (v1/v2/out of scope)
- [ ] REQUIREMENTS.md created with REQ-IDs → **committed**
- [ ] gsd-roadmapper spawned with context
- [ ] Roadmap files written immediately (not draft)
- [ ] User feedback incorporated (if any)
- [ ] ROADMAP.md created with phases, requirement mappings, success criteria
- [ ] STATE.md initialized
- [ ] REQUIREMENTS.md traceability updated
- [ ] User knows next step is `/gsd:discuss-phase 1`

**Atomic commits:** Each phase commits its artifacts immediately. If context is lost, artifacts persist.

</success_criteria>
