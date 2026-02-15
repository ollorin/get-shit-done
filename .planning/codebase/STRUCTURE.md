# Codebase Structure

**Analysis Date:** 2026-02-15

## Directory Layout

```
get-shit-done/
├── bin/                           # Package entry point
│   └── install.js                 # Multi-runtime installer (Claude/OpenCode/Gemini)
│
├── commands/                       # User-facing slash commands
│   └── gsd/                        # 29 command definition files (.md)
│       ├── new-project.md          # /gsd:new-project
│       ├── plan-phase.md           # /gsd:plan-phase
│       ├── execute-phase.md        # /gsd:execute-phase
│       ├── verify-work.md          # /gsd:verify-work
│       ├── map-codebase.md         # /gsd:map-codebase
│       └── ... (25 more commands)
│
├── agents/                         # Subagent specifications (11 agents as .md)
│   ├── gsd-planner.md              # Plan creation agent
│   ├── gsd-executor.md             # Task execution agent
│   ├── gsd-verifier.md             # Work verification agent
│   ├── gsd-codebase-mapper.md      # Architecture/stack analysis agent
│   ├── gsd-phase-researcher.md     # Phase domain research agent
│   ├── gsd-project-researcher.md   # Project discovery agent
│   ├── gsd-plan-checker.md         # Plan verification agent
│   ├── gsd-debugger.md             # Failure diagnosis agent
│   ├── gsd-roadmapper.md           # Roadmap creation agent
│   ├── gsd-integration-checker.md  # Integration analysis agent
│   └── gsd-research-synthesizer.md # Research aggregation agent
│
├── get-shit-done/                  # Core system (runtime-agnostic)
│   ├── bin/
│   │   ├── gsd-tools.js            # Central CLI (2600+ lines, ~50 commands)
│   │   └── gsd-tools.test.js       # Tests for gsd-tools
│   │
│   ├── workflows/                  # 30 orchestrator workflows (.md)
│   │   ├── new-project.md           # Project initialization orchestrator
│   │   ├── plan-phase.md            # Planning orchestrator (research→plan→verify)
│   │   ├── execute-phase.md         # Execution orchestrator (wave coordination)
│   │   ├── execute-plan.md          # Single plan executor helper
│   │   ├── verify-work.md           # User acceptance testing orchestrator
│   │   ├── verify-phase.md          # Phase completion verification
│   │   ├── complete-milestone.md    # Milestone archival workflow
│   │   ├── new-milestone.md         # Milestone initialization
│   │   ├── audit-milestone.md       # Milestone verification
│   │   ├── quick.md                 # Fast ad-hoc task workflow
│   │   ├── discuss-phase.md         # User decision capture
│   │   ├── pause-work.md            # Session handoff
│   │   ├── resume-project.md        # Session resumption
│   │   └── ... (16 more workflows)
│   │
│   ├── templates/                  # Output templates for documents
│   │   ├── phase-prompt.md          # PLAN.md file structure template
│   │   ├── summary.md               # SUMMARY.md template
│   │   ├── summary-minimal.md       # Minimal summary variant
│   │   ├── summary-standard.md      # Standard summary variant
│   │   ├── summary-complex.md       # Complex execution summary
│   │   ├── config.json              # Default config template
│   │   ├── context.md               # CONTEXT.md template for user decisions
│   │   ├── UAT.md                   # User acceptance test template
│   │   ├── DEBUG.md                 # Debug session template
│   │   └── ... (14 more templates)
│   │
│   ├── references/                 # Shared reference documents
│   │   ├── ui-brand.md              # UI patterns (banners, checkpoints, status symbols)
│   │   ├── checkpoints.md           # Checkpoint protocol documentation
│   │   ├── verification-patterns.md # How to write verification logic
│   │   ├── tdd.md                   # Test-driven development patterns
│   │   ├── git-integration.md       # Git operation patterns
│   │   ├── continuation-format.md   # Format for resuming interrupted work
│   │   ├── phase-argument-parsing.md# How to parse phase numbers
│   │   ├── planning-config.md       # Configuration structure reference
│   │   ├── model-profiles.md        # Model selection guidance
│   │   ├── model-profile-resolution.md
│   │   ├── decimal-phase-calculation.md
│   │   ├── questioning.md           # Questioning methodology
│   │   └── git-planning-commit.md   # Planning commit protocol
│
├── hooks/                          # Git hooks and utilities
│   ├── gsd-check-update.js         # Check for GSD updates
│   └── gsd-statusline.js           # CLI status line display
│
├── scripts/
│   └── build-hooks.js              # Build script for hooks compilation
│
├── .planning/                       # Example/reference project structure
│   ├── codebase/                   # Codebase analysis output (auto-generated)
│   │   ├── ARCHITECTURE.md
│   │   ├── STRUCTURE.md
│   │   ├── STACK.md
│   │   ├── INTEGRATIONS.md
│   │   ├── CONVENTIONS.md
│   │   ├── TESTING.md
│   │   └── CONCERNS.md
│   ├── phases/                     # Phase execution directory
│   │   ├── 01-init/               # Example phase
│   │   │   ├── 01-01-PLAN.md      # Plan files per phase
│   │   │   ├── 01-01-SUMMARY.md
│   │   │   └── ...
│   │   └── 02-features/
│   ├── config.json                # Project configuration
│   ├── PROJECT.md                 # Project vision and constraints
│   ├── REQUIREMENTS.md            # Scoped requirements (v1/v2/out-of-scope)
│   ├── ROADMAP.md                 # Phase roadmap with status
│   ├── STATE.md                   # Current project state and decisions
│   ├── research/                  # Research artifacts
│   │   ├── STACK.md
│   │   ├── FEATURES.md
│   │   ├── ARCHITECTURE.md
│   │   └── PITFALLS.md
│   └── quick/                     # Ad-hoc task tracking
│       └── 001-task-name/
│           ├── PLAN.md
│           └── SUMMARY.md
│
└── package.json                    # npm metadata (name, version, bin, files)
```

## Directory Purposes

**`bin/`:**
- Purpose: Package installation and entry point
- Contains: Multi-runtime installer with interactive prompts
- Key files: `install.js` (58KB installer)
- Generated on: npm install via `prepublishOnly` script

**`commands/gsd/`:**
- Purpose: User-facing command definitions routing to workflows
- Contains: 29 markdown files, one per CLI command
- Pattern: Each file specifies purpose, required reading, and orchestrator workflow to invoke
- Key pattern: All commands invoke orchestrators, never directly implement logic
- Examples: `new-project.md`, `plan-phase.md`, `quick.md`

**`agents/`:**
- Purpose: Subagent specifications with role, responsibilities, and execution protocols
- Contains: 11 markdown files defining specialized agents
- Key pattern: Each agent has `<role>`, `<philosophy>`, `<execution_flow>` sections
- Model assignment: gsd-tools resolves model per agent based on profile
- Examples: `gsd-planner.md` (task creation), `gsd-executor.md` (implementation)

**`get-shit-done/bin/`:**
- Purpose: Centralized CLI utility replacing scattered bash patterns
- Key file: `gsd-tools.js` (~2600 lines)
- Functions: 50+ atomic commands for state, phases, config, git, scaffolding
- Consumption: Invoked by all orchestrators via `node gsd-tools.js <command>`
- Testing: `gsd-tools.test.js` with Node.js test runner

**`get-shit-done/workflows/`:**
- Purpose: Orchestrator prompts coordinating multi-step workflows
- Contains: 30 markdown files defining orchestrator logic
- Responsibilities: Load state → spawn agents → route results → update state
- Key workflows: `new-project.md`, `plan-phase.md`, `execute-phase.md`
- Pattern: Each spawns 1-4 subagents in waves, collects results, returns structured JSON

**`get-shit-done/templates/`:**
- Purpose: Output document templates with frontmatter and structure
- Contains: Markdown templates for PLAN.md, SUMMARY.md, CONTEXT.md, etc
- Consumption: Scaffolded by gsd-tools commands, filled by orchestrators/agents
- Variants: Standard, minimal, complex versions for different scenarios

**`get-shit-done/references/`:**
- Purpose: Shared patterns and documentation referenced by multiple workflows
- Contains: 13 markdown files covering UI patterns, checkpoints, verification, git, etc
- Pattern: Written once, @-referenced by multiple orchestrators
- Example: `ui-brand.md` defines banners/checkpoints used by all output

**`hooks/`:**
- Purpose: Git hooks and development utilities
- Contains: `gsd-check-update.js` (version check), `gsd-statusline.js` (CLI feedback)
- Generated: Built via `npm run build:hooks` into `dist/` for distribution

**`.planning/` (example structure):**
- Purpose: Project execution directory created by `/gsd:new-project`
- Contains: Project vision, roadmap, phase execution, analysis artifacts
- Lifecycle: Created once per project, mutated by all workflows
- User-facing: Configuration, decisions, requirements; read-only during execution
- System-facing: STATE.md, ROADMAP.md mutated by gsd-tools

## Key File Locations

**Entry Points:**
- `bin/install.js`: Initial installation (59KB, sets up runtimes)
- `commands/gsd/{command}.md`: User command routing (each invokes orchestrator)
- `get-shit-done/workflows/new-project.md`: Project initialization orchestrator
- `get-shit-done/bin/gsd-tools.js`: Central CLI for all atomic operations

**Configuration:**
- `.planning/config.json`: Project model profile, workflow settings, branching strategy
- `get-shit-done/references/planning-config.md`: Config schema documentation
- `get-shit-done/bin/gsd-tools.js` lines 125-137: Model profile lookup table

**Core Logic:**
- `agents/gsd-planner.md`: How plans are created from phases
- `agents/gsd-executor.md`: How tasks are executed with commits
- `agents/gsd-verifier.md`: How deliverables are verified
- `get-shit-done/workflows/execute-phase.md`: Wave-based parallel execution

**Testing:**
- `get-shit-done/bin/gsd-tools.test.js`: Tests for CLI utility functions
- `get-shit-done/references/verification-patterns.md`: Testing guidance for agents

## Naming Conventions

**Files:**
- Commands: lowercase hyphenated (`new-project.md`, `map-codebase.md`)
- Agents: `gsd-{role}.md` prefix (e.g., `gsd-planner.md`, `gsd-executor.md`)
- Workflows: Action-oriented lowercase hyphenated (`plan-phase.md`, `execute-phase.md`)
- Templates: Descriptive with context (`phase-prompt.md`, `summary.md`)
- Plans: `{phase}-{plan}-PLAN.md` format (e.g., `01-01-PLAN.md`)
- Summaries: `{phase}-{plan}-SUMMARY.md` format (e.g., `01-01-SUMMARY.md`)

**Directories:**
- Phase directories: `{padded-phase}-{slug}` (e.g., `01-init`, `02-features`, `02.1-hotfix`)
- Decimal phases: `{major}.{minor}` for sub-phases (e.g., `2.1` between 2 and 3)
- Research output: `.planning/codebase/` for analysis (ARCHITECTURE.md, STACK.md, etc)
- Execution history: `.planning/phases/` for all phase work

## Where to Add New Code

**New Workflow Command:**
1. Create `/commands/gsd/new-command.md` - routes to orchestrator
2. Create `/get-shit-done/workflows/new-orchestrator.md` - implements workflow logic
3. Register in command routing if needed

**New Subagent:**
1. Create `/agents/gsd-{role}.md` with `<role>`, `<philosophy>`, `<execution_flow>`
2. Add model profile entry to `get-shit-done/bin/gsd-tools.js` MODEL_PROFILES if needed
3. Spawn from orchestrator using subagent protocol (documented in orchestrators)

**New gsd-tools Command:**
1. Add to `get-shit-done/bin/gsd-tools.js` main function
2. Document in usage comments (lines 1-117)
3. Add test cases to `gsd-tools.test.js`
4. Pattern: Use `safeReadFile()` for I/O, `loadConfig()` for settings, `execGit()` for git ops

**New Shared Reference:**
1. Create `/get-shit-done/references/new-topic.md`
2. Document pattern once
3. @-reference from orchestrators that need it

**New Output Document Type:**
1. Create template in `/get-shit-done/templates/{docname}.md`
2. Include frontmatter with required fields
3. Use in orchestrator via gsd-tools `template fill` command

## Special Directories

**`.planning/` Directory:**
- Purpose: Project state and execution tracking
- Generated: By `/gsd:new-project` in active project
- Location: User's project root (e.g., `/Users/user/myapp/.planning/`)
- Committed: Yes (all `.planning/` files go to git by default, controlled by `commit_docs` config)
- Contents evolve: Starts with PROJECT.md, REQUIREMENTS.md, ROADMAP.md; grows with phases

**`.planning/phases/` Subdirectory:**
- Purpose: Phase execution staging area
- Created: By `/gsd:plan-phase` for each phase
- Pattern: Directory per phase (`01-auth`, `02-ui`) containing PLAN.md and SUMMARY.md files
- Lifecycle: Created during planning, populated during execution

**`.planning/codebase/` Subdirectory:**
- Purpose: Architecture and tech analysis output (for brownfield projects)
- Created: By `/gsd:map-codebase` command
- Pattern: One file per focus area (ARCHITECTURE.md, STACK.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, INTEGRATIONS.md)
- Consumption: Loaded by planner when planning phases in existing codebases
- Generated: `--raw` flag prevents output, `--focus tech|arch|quality|concerns` specifies analysis type

**`.planning/research/` Subdirectory:**
- Purpose: Domain and ecosystem investigation
- Created: By `/gsd:new-project` research phase
- Pattern: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md (one per research area)
- Consumption: Planner reads research before creating tasks
- Variants: Phase-specific research in `.planning/{phase}-RESEARCH.md`

**`hooks/dist/` Subdirectory:**
- Purpose: Compiled hooks for distribution
- Generated: By `npm run build:hooks`
- Committed: `.gitignore` prevents committing (only `hooks/` tracked)
- Built from: `scripts/build-hooks.js` and source files in `hooks/`

---

*Structure analysis: 2026-02-15*
