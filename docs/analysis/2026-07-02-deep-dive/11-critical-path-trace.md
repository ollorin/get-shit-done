# Critical Path Trace: prd → new-milestone → execute-roadmap

**Analysis Date:** 2026-07-02  
**Scope:** Transitive dependency closure of GSD's core user workflow

---

## Executive Summary

The critical path consists of **6 commands** → **10 workflows** → **12 agents** (plus orchestrators) → **30+ gsd-tools commands** → **5 templates** + **5 references**.

**All-Opus baseline (Phase 1):** Coordinator always Opus. Most agents inherit or default to Sonnet/Haiku per task.

---

## Flow Diagram

```
/gsd:prd
  └─ workflow: prd.md
      └─ Agent: general-purpose (haiku) [web fetch only]
         └─ workflow:prd.md (continued)

/gsd:new-milestone
  └─ workflow: new-milestone.md
      ├─ Agent: gsd-project-researcher (4x parallel)
      ├─ Agent: gsd-research-synthesizer
      └─ Agent: gsd-roadmapper

/gsd:execute-roadmap
  └─ workflow: execute-roadmap.md
      └─ Agent: gsd-phase-coordinator [per phase, fresh 200k context]
          ├─ Step: harvest_knowledge (haiku extraction agents)
          ├─ Step: discuss → runs gsd-phase-coordinator OR uses existing CONTEXT.md
          ├─ Step: research → Agent: gsd-phase-researcher
          ├─ Step: plan
          │   ├─ Agent: gsd-planner
          │   ├─ Agent: gsd-plan-checker
          │   └─ Agent: gsd-e2e-test-generator [web phases only]
          ├─ Step: execute
          │   └─ Agent: gsd-executor [per plan, wave-based]
          │       ├─ Task: tdd=true → Agent: gsd-test-writer
          │       └─ Checkpoint: ui-qa → Agent: gsd-charlotte-qa [automated]
          └─ Step: verify → Agent: gsd-verifier

/gsd:progress
  └─ workflow: progress.md
      └─ Uses: gsd-tools commands only

/gsd:audit-milestone
  └─ workflow: audit-milestone.md
      └─ Agent: gsd-integration-checker

/gsd:complete-milestone
  └─ workflow: complete-milestone.md
      └─ Uses: gsd-tools commands only
```

---

## USED: Commands (6 total, all on critical path)

| Command | Workflow | Purpose |
|---------|----------|---------|
| `/gsd:prd` | prd.md | Mature product concepts to PRD (3 PM/PO/Tech stages) |
| `/gsd:new-milestone` | new-milestone.md | Start milestone cycle: requirements → roadmap |
| `/gsd:execute-roadmap` | execute-roadmap.md | Execute full roadmap with phase coordinators |
| `/gsd:progress` | progress.md | Check progress, route to next action |
| `/gsd:audit-milestone` | audit-milestone.md | Verify milestone achieves definition of done |
| `/gsd:complete-milestone` | complete-milestone.md | Archive completed milestone, update PROJECT.md |

**Count:** 6/6 commands on critical path (100%)

---

## USED: Workflows (10 total, all on critical path)

| Workflow | Invoked By | Purpose |
|----------|-----------|---------|
| **prd.md** | `/gsd:prd` command | Three-stage PRD maturation with Q&A loops |
| **new-milestone.md** | `/gsd:new-milestone` command | Milestone initialization: research → requirements → roadmap |
| **execute-roadmap.md** | `/gsd:execute-roadmap` command | Coordinate full roadmap execution across phases |
| **progress.md** | `/gsd:progress` command | Progress reporting and routing |
| **audit-milestone.md** | `/gsd:audit-milestone` command | Milestone verification and gap assessment |
| **complete-milestone.md** | `/gsd:complete-milestone` command | Archive and version release |
| **execute-phase.md** | gsd-phase-coordinator (step: execute) | Execute all plans in a phase, wave-based parallelization |
| **plan-phase.md** | gsd-phase-coordinator (step: plan) | Create executable PLAN.md files with research/verification |
| **discuss-phase.md** | gsd-phase-coordinator (step: discuss) OR /gsd:discuss-phase | Extract design decisions via gray-area identification |
| **execute-plan.md** | gsd-executor (spawned per plan) | Execute a single PLAN.md with atomic task commits |

**Count:** 10/39 workflows on critical path (26%)

**Not on path:** 29 workflows (add-phase, audit-milestone aside, check-todos, diagnose-issues, discover, discovery-phase, health, insert-phase, list-phase-assumptions, map-codebase, mine-conversations, plan-milestone-gaps, quick, remove-phase, research-phase, resume-project, set-profile, settings, transition, update, validate-phase, verify-phase, verify-work, and more specialized helpers)

---

## USED: Agents (12 total, all on critical path)

### Level 1: Top-Level Orchestrators & Research

| Agent | Model | Spawned By | Purpose |
|-------|-------|-----------|---------|
| **gsd-phase-coordinator** | Sonnet (inherit from init) | execute-roadmap.md | Execute full phase lifecycle (discuss/research/plan/execute/verify) |
| **gsd-project-researcher** | {researcher_model} | new-milestone.md (4x parallel) | Research stack/features/architecture/pitfalls for new milestone |
| **gsd-research-synthesizer** | {synthesizer_model} | new-milestone.md | Synthesize parallel researcher outputs into SUMMARY.md |
| **gsd-roadmapper** | {roadmapper_model} | new-milestone.md | Create ROADMAP.md from requirements with phase structure |
| **general-purpose (haiku)** | Haiku | prd.md (2x for web research) | Lightweight web fetching for PRD research stages |

### Level 2: Phase Planning & Execution (Spawned by Phase Coordinator)

| Agent | Model | Spawned By | Purpose |
|-------|-------|-----------|---------|
| **gsd-phase-researcher** | {researcher_model} | gsd-phase-coordinator (research step) | Deep research on how to implement phase |
| **gsd-planner** | {planner_model} | gsd-phase-coordinator (plan step) | Create PLAN.md files with task breakdown |
| **gsd-plan-checker** | {checker_model} | gsd-phase-coordinator (plan step) | Verify plans meet phase goal (goal-backward analysis) |
| **gsd-executor** | {executor_model} | gsd-phase-coordinator (execute step, per plan) | Execute PLAN.md with atomic commits, deviations, checkpoints |
| **gsd-verifier** | {verifier_model} | gsd-phase-coordinator (verify step) | Verify phase achieves promised goal (not just task completion) |

### Level 3: Specialized Execution Agents (Spawned by Executor/Coordinator)

| Agent | Model | Spawned By | Purpose |
|-------|-------|-----------|---------|
| **gsd-test-writer** | Haiku | gsd-executor (tdd=true tasks) | Write comprehensive tests (6+ categories, min 6 tests) |
| **gsd-charlotte-qa** | Haiku | gsd-phase-coordinator (checkpoint:ui-qa gate) | Automated web UI/UX QA with 3-round QA loop |
| **gsd-integration-checker** | {integration_checker_model} | audit-milestone.md | Check cross-phase wiring and E2E flows |

### Additional Agents Spawned During Phase Coordinator Lifecycle

| Agent | Model | Spawned By | Purpose |
|-------|-------|-----------|---------|
| **gsd-meta-answerer** | Haiku | gsd-phase-coordinator (discuss step) | Answer phase questions from knowledge DB |
| **gsd-e2e-test-generator** | Sonnet | gsd-phase-coordinator (plan step, web phases) | Generate E2E test scenarios from UI inventory |
| **gsd-ui-inventory** | Haiku | gsd-e2e-test-generator | Scan web app for pages/routes/components |

**Count:** 12 distinct agents on critical path (out of 23 total)

---

## USED: gsd-tools.js Commands

**Frequency:** ~50+ command invocations across the critical path (every workflow uses multiple)

### High-Frequency Commands (used everywhere)

```
init {workflow}              # Initialize context (most common — Phase 1, roadmap, etc.)
config-get {key}            # Read configuration
config-set {key} {value}    # Write configuration
commit {message} --files    # Stage and commit atomically
```

### Roadmap & Phase Commands

```
roadmap get-phase {N}       # Extract phase details
roadmap analyze             # Comprehensive phase structure
roadmap update-plan-progress # Update plan status after execution
phases list                 # List all phases
find-phase {N}              # Resolve phase directory
phase-plan-index {N}        # Get wave grouping and plan inventory
```

### State & Progress Commands

```
state-snapshot              # Get current project state as JSON
progress bar --raw          # Generate progress visualization
summary-extract {path}      # Extract one-liner from SUMMARY.md
```

### Knowledge & Mining Commands

```
mine-conversations          # Extract decisions from session history
query-knowledge {term}      # Query knowledge DB for user context
store-conversation-result   # Store extracted user reasoning
```

### Execution & Validation Commands

```
init execute-phase {N}      # Initialize phase execution context
init execute-roadmap        # Initialize roadmap execution
init plan-phase {N}         # Initialize planning context
init milestone-op           # Initialize milestone operations (audit/complete)
init progress               # Initialize progress check
execution-log event         # Log roadmap/phase events (JSONL)
gate pre-pr                 # Check pre-PR quality gates
```

### Analytics & Metrics

```
analytics report            # Generate execution analytics
```

**No direct count needed — pattern is: every major workflow invocation starts with `init {context}`, followed by targeted queries and updates.**

---

## USED: Templates

| Template | Used By | Purpose |
|----------|---------|---------|
| `templates/prd.md` | prd.md workflow | Base template for PRD with placeholder sections |
| `templates/project.md` | new-milestone.md workflow | PROJECT.md template for new projects |
| `templates/requirements.md` | new-milestone.md workflow | REQUIREMENTS.md template |
| `templates/milestone-archive.md` | complete-milestone.md workflow | Archive template for completed milestones |
| `templates/summary.md` | execute-plan.md workflow | SUMMARY.md template for plan completion |

**Plus:** `templates/research-project/{STACK,FEATURES,ARCHITECTURE,PITFALLS,SUMMARY}.md` (5 templates spawned by gsd-project-researcher agents)

**Total:** 10 templates on critical path (out of total set)

---

## USED: References

| Reference | Used By | Purpose |
|-----------|---------|---------|
| `references/questioning.md` | new-milestone.md workflow | Q&A structure for milestone scoping |
| `references/ui-brand.md` | new-milestone.md, plan-phase.md workflows | UI/brand conventions for visual design |
| `references/checkpoints.md` | execute-plan.md workflow | Checkpoint protocol for pausing execution |
| `references/tdd.md` | execute-plan.md workflow | TDD execution (RED-GREEN-REFACTOR) |
| `references/git-integration.md` | execute-plan.md workflow | Git commit protocols |

**Total:** 5 references on critical path

---

## USED: bin/*.js Scripts

Only **gsd-tools.js** is directly invoked on the critical path. It's the primary execution harness.

```
~/.claude/get-shit-done/bin/gsd-tools.js     [primary utility]
```

Other scripts in `/bin/` (install.js, verify.js, etc.) are NOT invoked by workflows.

---

## NOT ON PATH: Commands

**33 commands exist, 6 are on critical path. Here are the 27 NOT used:**

```
add-phase, add-todo, check-todos, debug, 
discuss-phase (can be called standalone but not on mainline path),
execute-phase (can be called standalone but invoked by coordinator),
generate-e2e-coverage, help, insert-phase, join-discord,
list-phase-assumptions, map-codebase, mine-conversations, open-pr,
pause-work, plan-milestone-gaps, plan-phase (can be standalone but usually from coordinator),
quick, reapply-patches, remove-phase, research-phase, resume-work,
set-profile, settings, update, validate-phase, verify-work
```

**Pattern:** The 6 commands form the **mainline** (/gsd:prd → /gsd:new-milestone → /gsd:execute-roadmap → /gsd:progress → /gsd:audit-milestone → /gsd:complete-milestone). Remaining 27 are **off-path utilities** (debugging, planning gaps, configuration, branching operations, etc.).

---

## NOT ON PATH: Workflows (29 workflows not reached)

Comprehensive list:

```
add-phase.md                          (adding phase mid-milestone)
check-todos.md                        (todo tracking)
diagnose-issues.md                    (debugging)
discover.md                           (product discovery)
discovery-phase.md                    (pre-planning discovery)
health.md                             (system health check)
insert-phase.md                       (inserting phase)
list-phase-assumptions.md             (assumption enumeration)
map-codebase.md                       (codebase analysis)
mine-conversations.md                 (standalone mining)
plan-milestone-gaps.md                (gap remediation planning)
quick.md                              (quick execution)
remove-phase.md                       (phase removal)
research-phase.md                     (standalone research)
resume-project.md                     (project resurrection)
set-profile.md                        (model profile config)
settings.md                           (configuration)
transition.md                         (state transitions)
update.md                             (project update)
validate-phase.md                     (phase validation)
verify-phase.md                       (standalone verification)
verify-work.md                        (work verification)
[+ 7 more workflow utilities]
```

---

## NOT ON PATH: Agents (11 agents not on critical path)

| Agent | Purpose | Why Not on Path |
|-------|---------|-----------------|
| gsd-debugger | Debug failing work | Only invoked via `/gsd:debug` |
| gsd-discovery-synthesizer | Synthesize product discovery | Only in /gsd:new-project discovery phase |
| gsd-docs-updater | Update documentation | Triggered post-execution (optional step) |
| gsd-e2e-test-generator | E2E test generation | Spawned conditionally (web phases only) |
| gsd-integration-tester | Integration testing | Not on mainline (alternative verification) |
| gsd-nyquist-auditor | Nyquist validation | Optional validation extension |
| gsd-phase-researcher | Phase research | Conditionally spawned (if research enabled) |
| gsd-product-investigator | Product investigation | Only in new-project (not mainline) |
| gsd-project-researcher | Project research | On path (new-milestone) |
| gsd-roadmapper | Roadmap creation | On path (new-milestone) |
| gsd-task-router | Model tier routing | Internal utility (not spawned directly) |
| gsd-ui-inventory | UI inventory scan | Conditional (web phases, inside e2e-gen) |

**Count:** 11 agents exist but not on critical path out of 23 total

---

## Execution Model: Context Windows & Parallelism

### Context Budgets

| Agent | Window | Usage Pattern |
|-------|--------|---------------|
| Coordinator (execute-roadmap) | 200k | Lean orchestrator (~10-15% per phase) |
| gsd-phase-coordinator | 200k | Full phase lifecycle (fresh per phase) |
| gsd-executor | 200k | Single plan execution (~50% target) |
| gsd-planner | 200k | Plan creation (~50% target) |
| gsd-verifier | 200k | Goal-backward verification |
| All others | 200k | Typical task scope (~30-70%) |

**Strategy:** Fresh 200k context per phase/plan to prevent context rot. Executors stay lean on purpose — each phase is isolated.

### Parallelism

- **execute-roadmap:** Sequential phase execution (with dependency DAG checking)
- **execute-phase:** Wave-based plan parallelization (max 2-3 concurrent per type)
- **new-milestone:** 4x parallel researchers + synthesizer
- **Within plans:** Tasks execute sequentially (checkpoints halt parallelism when user input needed)

---

## Key Architectural Insights

### 1. **Transitive Closure Size**
- Commands: 6 (100% of mainline)
- Workflows: 10 (26% of 39)
- Agents: 12 + "orchestrators" (52% of 23)
- Templates: 10 (meaningful subset)
- gsd-tools: 1 primary utility (50+ distinct commands)

### 2. **Critical Dependencies**
- **prd → new-milestone:** Only if PRD-driven path (optional)
- **new-milestone → execute-roadmap:** Always (roadmap is prerequisite)
- **execute-roadmap → progress/audit/complete:** Sequential, but execute-roadmap is the heavyweight

### 3. **Model Distribution**
- Coordinator: Opus (phase-coordinator for each phase)
- Planners/Researchers: Config-driven (default Sonnet, override per project)
- Writers/QA: Haiku (lightweight, cost-optimized)
- Executor: Config-driven (default Sonnet)

### 4. **Failure Modes Not on Path**
- `/gsd:debug` — Debugging sub-system (not mainline)
- `/gsd:plan-milestone-gaps` — Gap remediation (post-audit, optional)
- `/gsd:quick` — Quick execution (alternative to full roadmap)
- Verification agents (gsd-nyquist-auditor, integration-tester) are optional enhancements

---

## Data Flow Summary

```
.planning/
├── PROJECT.md              (created by /gsd:new-milestone, evolved by complete-milestone)
├── REQUIREMENTS.md         (created by /gsd:new-milestone, archived by complete-milestone)
├── ROADMAP.md              (created by gsd-roadmapper, executed by execute-roadmap)
├── STATE.md                (tracking current position and decisions throughout)
├── config.json             (model choices, workflow flags)
├── prds/                   (PRD storage — pending → done lifecycle)
├── research/               (intermediate research from gsd-project-researcher agents)
├── phases/                 (phase directories, each with plans, summaries, verification)
│   └── {N}-{slug}/
│       ├── {N}-CONTEXT.md  (from discuss-phase)
│       ├── {N}-RESEARCH.md (from phase-researcher)
│       ├── {N}-PLAN.md     (from planner, multiple per phase)
│       ├── {N}-SUMMARY.md  (from executor)
│       ├── {N}-VERIFICATION.md (from verifier)
│       └── {N}-UAT.md      (optional quality gate)
├── milestones/             (archived milestone artifacts)
├── EXECUTION_LOG.md        (roadmap execution events, JSONL format)
└── MILESTONE-AUDIT.md      (audit findings before completion)
```

---

## Maintenance Surface

| Category | Count | Scope |
|----------|-------|-------|
| Commands to maintain | 6 | Small (mainline only) |
| Workflows to maintain | 10 | Medium (core logic) |
| Agents to maintain | 12+ | Large (most complexity) |
| Templates to maintain | 10 | Small (structure) |
| References to maintain | 5 | Small (guidance) |
| gsd-tools subcommands | 30+ | Very large (core utility) |

**Conclusion:** The critical path is narrower than the full GSD surface (6 commands vs 33, 10 workflows vs 39, 12 agents vs 23), making it tractable for focused optimization and testing. However, gsd-tools.js is the load-bearing utility — its 30+ subcommands are essential to every step.

---

## Verification Checklist

- [x] Commands: All 6 on path accounted for, 27 alternatives documented
- [x] Workflows: 10 on path (10/39 = 26%), 29 not reached
- [x] Agents: 12 on path (12/23 = 52%), spawned hierarchically
- [x] Templates: 10 identified (prd + research set + summary + archive + project + requirements)
- [x] References: 5 identified (questioning, ui-brand, checkpoints, tdd, git-integration)
- [x] gsd-tools: Primary utility identified with 30+ commands
- [x] Flow: Traced from entry point through full phase lifecycle

---

*Generated by deep-dive analysis of /Users/ollorin/get-shit-done GSD framework*
