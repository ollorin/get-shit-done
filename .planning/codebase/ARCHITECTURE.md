# Architecture

**Analysis Date:** 2026-02-15

## Pattern Overview

**Overall:** Multi-layer orchestration system for context-aware AI development workflows.

**Key Characteristics:**
- Command-driven CLI with slash command entry points spawned in AI assistant runtimes
- Orchestrator-agent pattern where thin orchestrators spawn specialized subagents with fresh context windows
- State machine workflow with planning, execution, and verification phases
- Context engineering at every layer (loaded files, environment variables, configuration)
- Atomic git commits tied to task completion
- Zero accumulated context degradation (fresh 200k token budgets per subagent)

## Layers

**Command Layer:**
- Purpose: User-facing entry points for workflows (e.g., `/gsd:new-project`, `/gsd:plan-phase 1`)
- Location: `commands/gsd/` (29 command definitions as `.md` files)
- Contains: Markdown specifications that route to workflow orchestrators
- Depends on: Workflow layer, gsd-tools CLI
- Used by: Claude Code, OpenCode, Gemini CLI runtimes

**Workflow Orchestrator Layer:**
- Purpose: Coordinate multi-step workflows, spawn subagents, route results
- Location: `get-shit-done/workflows/` (30 orchestration workflows)
- Contains: Orchestrator prompts that manage agent spawning, wave grouping, result collection
- Key files: `new-project.md`, `plan-phase.md`, `execute-phase.md`, `verify-work.md`
- Depends on: gsd-tools CLI for state/phase operations
- Used by: Command layer via invocation

**Subagent Layer:**
- Purpose: Specialized implementation for discrete tasks (planning, executing, verifying)
- Location: `agents/` (11 agent specifications as `.md` files)
- Contains: Agent role definitions, execution protocols, responsibilities
- Key agents:
  - `gsd-planner.md` - Creates executable PLAN.md files from phase descriptions
  - `gsd-executor.md` - Implements tasks atomically with per-task commits
  - `gsd-verifier.md` - Validates codebase against delivery goals
  - `gsd-codebase-mapper.md` - Analyzes codebase for architecture/tech/concerns
  - `gsd-phase-researcher.md` - Domain research for phases
  - `gsd-plan-checker.md` - Validates plans achieve goals
- Depends on: Workflow orchestrator for context, gsd-tools CLI
- Used by: Orchestrators via subagent spawning

**Tools & Utilities Layer:**
- Purpose: Centralized CLI operations for state, config, phase management, git operations
- Location: `get-shit-done/bin/gsd-tools.js` (main CLI, ~2600 lines)
- Contains: Atomic commands for config loading, state mutations, git operations, scaffolding
- Depends on: Node.js filesystem and git APIs
- Used by: All orchestrators and agents

**Installation & Setup Layer:**
- Purpose: Multi-runtime installation and configuration
- Location: `bin/install.js` (installer with runtime detection)
- Contains: Interactive installer for Claude Code, OpenCode, Gemini with global/local placement
- Used by: End users via `npx get-shit-done-cc@latest`

## Data Flow

**Workflow Initiation → Planning → Execution → Verification:**

1. **User invokes command** (`/gsd:new-project`)
2. **Command routes to orchestrator** (e.g., `new-project.md`)
3. **Orchestrator loads project state** via `gsd-tools init new-project`
4. **Orchestrator prompts user** for decisions (questions, approvals)
5. **Orchestrator spawns research agents** in parallel, waits for results
6. **Orchestrator synthesizes research** and creates REQUIREMENTS.md, ROADMAP.md
7. **User invokes next command** (`/gsd:plan-phase 1`)
8. **Plan orchestrator loads phase state** via `gsd-tools init plan-phase`
9. **Plan orchestrator spawns planner agent** with CONTEXT.md and phase description
10. **Planner creates PLAN.md** with tasks, waves, dependencies
11. **Plan orchestrator spawns checker agent** to verify plan achieves goals
12. **User invokes execution** (`/gsd:execute-phase 1`)
13. **Execute orchestrator discovers plans**, groups into execution waves
14. **Execute orchestrator spawns executor agents** per plan (parallel where dependencies allow)
15. **Each executor loads plan**, implements tasks, commits per-task, produces SUMMARY.md
16. **Execute orchestrator collects all SUMMARY.md files**, updates roadmap state
17. **User invokes verification** (`/gsd:verify-work 1`)
18. **Verifier agent loads SUMMARY.md and tests** against user's requirements
19. **If failures:** Verifier spawns debugger agents to diagnose

**State Management:**
- `.planning/config.json` - Project configuration (model profiles, workflow settings)
- `.planning/STATE.md` - Current position, decisions, blockers (mutated by gsd-tools)
- `.planning/ROADMAP.md` - Phase structure and completion status
- `.planning/REQUIREMENTS.md` - Scoped v1/v2/out-of-scope
- `.planning/PROJECT.md` - Project vision and constraints
- `phases/{NN-slug}/` - Per-phase directory containing PLAN.md, SUMMARY.md files

## Key Abstractions

**Phase:**
- Purpose: Logically grouped work (e.g., "Authentication", "UI Components")
- Examples: Phase 1 (auth), Phase 2.1 (components), Phase 2.2 (layouts)
- Pattern: Directory `phases/{padded-phase}-{slug}/` with PLAN.md and SUMMARY.md files

**Plan:**
- Purpose: Atomic executable specification with 2-3 tasks and verification criteria
- Examples: `01-01-PLAN.md` (Phase 1, Plan 1)
- Pattern: Frontmatter (phase, plan, wave, dependencies) + objective + context + tasks

**Task:**
- Purpose: Single implementation unit (create file, refactor function, add test)
- Pattern: XML structure (type, name, files, action, verify, done criteria)
- Types: `auto` (autonomous, no checkpoints), `checkpoint:*` (requires human approval)

**Wave:**
- Purpose: Execution grouping for parallelization (Wave 1, Wave 2, Wave 3...)
- Pattern: Pre-computed during planning based on task dependencies
- Execution: All plans in Wave 1 execute in parallel, then Wave 2, then Wave 3

**Context:**
- Purpose: User decisions captured before planning (layout choices, library selections, etc)
- Pattern: `.planning/{phase}-CONTEXT.md` with sections: Decisions, Deferred Ideas, Claude's Discretion
- Consumption: Planner reads CONTEXT.md before creating tasks, honors locked decisions

**Research Artifact:**
- Purpose: Domain investigation output (stack analysis, feature patterns, architecture)
- Pattern: `.planning/{phase}-RESEARCH.md` or `.planning/codebase/{STACK,ARCH,CONCERNS}.md`
- Consumption: Planner reads research to understand ecosystem before planning

## Entry Points

**Command Entry Point (`/gsd:new-project`):**
- Location: `commands/gsd/new-project.md`
- Triggers: User invokes `/gsd:new-project` in Claude Code runtime
- Responsibilities: Route to orchestrator workflow `get-shit-done/workflows/new-project.md`
- Output: Loads full workflow in active session

**Orchestrator Entry Point (new-project workflow):**
- Location: `get-shit-done/workflows/new-project.md`
- Triggers: Invoked by command shell
- Responsibilities: Execute questioning → research → requirements → roadmap creation
- Output: PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, `.planning/` directory structure

**Plan Orchestrator Entry Point (plan-phase workflow):**
- Location: `get-shit-done/workflows/plan-phase.md`
- Triggers: User runs `/gsd:plan-phase 1`
- Responsibilities: Load phase, spawn researcher (optional), spawn planner, spawn checker, verify loop
- Output: `{phase}-{plan}-PLAN.md` files per phase

**Execute Orchestrator Entry Point (execute-phase workflow):**
- Location: `get-shit-done/workflows/execute-phase.md`
- Triggers: User runs `/gsd:execute-phase 1`
- Responsibilities: Discover plans, compute waves, spawn executors in parallel waves, collect results
- Output: `{phase}-{plan}-SUMMARY.md` files, git commits

**Subagent Entry Point (Planner):**
- Location: `agents/gsd-planner.md`
- Triggers: Spawned by plan-phase orchestrator via subagent protocol
- Responsibilities: Parse phase goal and CONTEXT.md decisions, create PLAN.md with tasks/waves
- Output: Returns PLAN.md XML structure to orchestrator

**Subagent Entry Point (Executor):**
- Location: `agents/gsd-executor.md`
- Triggers: Spawned by execute-phase orchestrator per plan
- Responsibilities: Load PLAN.md, implement tasks sequentially, commit per-task, produce SUMMARY.md
- Output: Git commits + SUMMARY.md file returned to orchestrator

**CLI Entry Point (gsd-tools):**
- Location: `get-shit-done/bin/gsd-tools.js`
- Triggers: Orchestrators invoke `node gsd-tools.js <command> [args]`
- Responsibilities: File I/O, state mutations, git operations, scaffolding
- Pattern: Stateless utility - reads/writes from filesystem, no daemon state

## Error Handling

**Strategy:** Fail-fast with structured error messages, provide recovery paths

**Patterns:**

1. **Missing Prerequisites:**
   - Check files exist before reading (use gsd-tools `verify-path-exists`)
   - If `.planning/` missing: Error with init steps
   - If ROADMAP.md missing: Error suggesting `/gsd:new-project`
   - If phase not found: List available phases

2. **Plan Execution Failures:**
   - Executor catches errors during task implementation
   - On failure: Stop at failed task, record state, return error to orchestrator
   - Orchestrator offers: Retry, debug, or skip task
   - Debugger spawned to diagnose root cause

3. **Verification Failures:**
   - Verifier checks must_haves against codebase
   - If must_have missing: Report specifically which file/test/behavior
   - Offer: Spawn debugger or create fix plan for re-execution

4. **State Inconsistencies:**
   - Consistency check validates phase numbers, disk vs roadmap sync
   - If inconsistent: Offer reconstruct or manual fix guidance

## Cross-Cutting Concerns

**Logging:**
- Approach: Structured status messages prefixed with stage banners (e.g., "GSD ► PLANNING PHASE 1")
- Pattern: Checkpoint boxes for user interaction required, progress bars for phase completion
- Location: `get-shit-done/references/ui-brand.md` defines UI patterns

**Validation:**
- Frontmatter validation: PLAN.md, SUMMARY.md files validated against schemas
- gsd-tools commands: `verify plan-structure`, `verify references`, `verify commits`
- Phase numbering: `validate consistency` checks decimal phases and renumbering

**Authentication:**
- None built-in. Auth delegated to:
  - Claude Code runtime (handles `.env` secrets)
  - Brave Search API (optional via config.brave_search)
  - Git (uses local git config for commits)

**Context Management:**
- Project context: PROJECT.md (always loaded by orchestrators)
- Phase context: CONTEXT.md (loaded by planner to honor user decisions)
- Codebase context: `.planning/codebase/{ARCHITECTURE,STACK,CONCERNS}.md` (loaded by planner for brownfield projects)
- Reference context: `get-shit-done/references/*.md` (patterns referenced by orchestrators)

**Model Resolution:**
- Lookup table: `get-shit-done/bin/gsd-tools.js` lines 125-137 (MODEL_PROFILES)
- Profiles: quality (Opus for planners), balanced (Sonnet), budget (Haiku)
- Configuration: `config.json` model_profile + agent type determines model per operation

**Git Integration:**
- Atomic commits: Each task produces one commit immediately upon completion
- Commit message format: `feat(PHASE): task description` with Co-Authored-By trailer
- State tracking: All commits go to `.planning/` files with `commit_docs` config
- Branching: Optional per config (none, phase, milestone strategies)

---

*Architecture analysis: 2026-02-15*
