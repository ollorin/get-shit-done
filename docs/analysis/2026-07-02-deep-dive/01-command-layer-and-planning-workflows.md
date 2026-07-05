# Command Layer & Planning Workflows — Deep Analysis

**Audit Date:** 2026-07-02  
**Scope:** Command entry points and planning-side workflows  
**Focus:** Workflow/command mismatches, weak enforcement of mandatory steps, stale references, token wastage

---

## Inventory

### Commands (34 total)
All in `/Users/ollorin/get-shit-done/commands/gsd/`:

| Command | Size | Purpose |
|---------|------|---------|
| new-project.md | 1.4K | Initialize greenfield project |
| new-milestone.md | 1.7K | Start milestone cycle |
| discuss-phase.md | 2.9K | Gather implementation decisions |
| plan-phase.md | 1.5K | Create phase plans with research/verify |
| research-phase.md | 5.4K | Standalone research investigation |
| execute-phase.md | 1.2K | Execute all plans in phase |
| quick.md | 1.6K | Ad-hoc task execution |
| execute-roadmap.md | 869B | Execute entire roadmap |
| verify-work.md | 1.2K | Conversational UAT testing |
| progress.md | 717B | Show project status |
| map-codebase.md | 2.5K | Analyze existing codebase |
| prd.md | 1.1K | Create PRD from analysis |
| add-phase.md | 1.0K | Insert phase before/after existing |
| insert-phase.md | 1.0K | Insert phase with numbering |
| remove-phase.md | 942B | Remove phase from roadmap |
| validate-phase.md | 871B | Pre-execution validation |
| list-phase-assumptions.md | 1.4K | Extract phase assumptions |
| plan-milestone-gaps.md | 1.1K | Close phase/milestone gaps |
| debug.md | 3.8K | Systematic debugging |
| generate-e2e-coverage.md | 3.4K | Generate E2E test cases |
| audit-milestone.md | 1.2K | Audit milestone before archiving |
| complete-milestone.md | 4.4K | Archive completed milestone |
| check-todos.md | 1.1K | Check task list status |
| add-todo.md | 1.1K | Add task to list |
| mine-conversations.md | 1012B | Extract learning from chat |
| pause-work.md | 963B | Pause execution session |
| resume-work.md | 1.1K | Resume from checkpoint |
| update.md | 956B | Update project artifacts |
| set-profile.md | 935B | Set model profile |
| settings.md | 1002B | Configure preferences |
| help.md | 594B | Show command help |
| open-pr.md | 4.1K | Open GitHub PR |
| reapply-patches.md | 3.1K | Reapply git patches |
| join-discord.md | 396B | Join Discord server |

### Workflows (37 total)
All in `/Users/ollorin/get-shit-done/get-shit-done/workflows/`:

| Workflow | Size | Purpose | Command? |
|----------|------|---------|----------|
| new-project.md | 32.8K | Initialize project | ✓ |
| new-milestone.md | 19.2K | Start milestone | ✓ |
| discuss-phase.md | 24.9K | Gather phase decisions | ✓ |
| plan-phase.md | 21.3K | Plan phase with research | ✓ |
| execute-phase.md | 28.5K | Execute phase plans | ✓ |
| execute-plan.md | 23.7K | Execute single plan (internal) | — |
| execute-roadmap.md | 22.1K | Execute entire roadmap | ✓ |
| quick.md | 17.9K | Quick task mode | ✓ |
| verify-work.md | 15.5K | UAT verification | ✓ |
| verify-phase.md | 11.2K | Goal-backward verification | — |
| help.md | 13.7K | Help system | ✓ |
| audit-milestone.md | 13.8K | Audit before archive | ✓ |
| complete-milestone.md | 20.1K | Archive milestone | ✓ |
| prd.md | 21.1K | PRD creation flow | ✓ |
| progress.md | 9.0K | Status reporting | ✓ |
| discovery-phase.md | 8.1K | Discovery questionnaire | ✗ |
| map-codebase.md | 8.6K | Codebase analysis | ✓ |
| resume-project.md | 8.9K | Resume work (resume-work routes here) | ~ |
| diagnose-issues.md | 6.4K | Diagnostic workflow | ✗ |
| plan-milestone-gaps.md | 6.7K | Gap closure planning | ✓ |
| analyze-pending-sessions.md | 5.4K | Session analysis | ✗ |
| health.md | 4.4K | Health check | ✗ |
| check-todos.md | 4.5K | Todo management | ✓ |
| add-todo.md | 4.1K | Add todo | ✓ |
| transition.md | 13.1K | Phase transition | ✗ |
| remove-phase.md | 4.0K | Remove phase | ✓ |
| research-phase.md | 1.9K | Research workflow | ✓ |
| set-profile.md | 1.9K | Profile setting | ✓ |
| update.md | 5.8K | Update artifacts | ✓ |
| insert-phase.md | 3.5K | Insert phase | ✓ |
| discover.md | 3.1K | Discovery process | ✗ |
| pause-work.md | 2.9K | Pause execution | ✓ |
| settings.md | 6.8K | Settings management | ✓ |
| list-phase-assumptions.md | 4.2K | Extract assumptions | ✓ |
| add-phase.md | 2.7K | Add phase | ✓ |
| mine-conversations.md | 5.3K | Extract learnings | ✓ |
| validate-phase.md | 4.9K | Pre-execution validation | ✓ |

---

## How It Works

### Command Entry → Workflow Routing

Each `.md` file in `/commands/gsd/` follows a thin-wrapper pattern:

```yaml
name: gsd:command-name
description: User-facing summary
execution_context:
  - @~/.claude/get-shit-done/workflows/corresponding-workflow.md
  - @~/.claude/get-shit-done/references/...
process:
  Execute the workflow from @~/.claude/get-shit-done/workflows/...
  Preserve all workflow gates (validation, approvals, commits, routing).
```

**Example:** `new-project.md` (command) → execution_context references `@~/.claude/get-shit-done/workflows/new-project.md` (deployed copy) → orchestrator executes workflow end-to-end.

### Planning-Side Workflow Stack

**Phase lifecycle:**

```
┌─────────────────────────────────────────────────────────────┐
│ /gsd:new-project  or  /gsd:new-milestone                    │
│ (Planning setup: questionnaire → research → requirements    │
│  → roadmap)                                                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ /gsd:discuss-phase                                          │
│ (Gray area extraction: prior decisions + codebase context + │
│  analysis → CONTEXT.md)                                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ /gsd:plan-phase                                             │
│ (Research + Planning + Verify)                              │
│ 1. Research (if enabled) → RESEARCH.md                      │
│ 2. Plan → {phase}-PLAN.md files                             │
│ 3. Verify (if enabled) → PLAN.md quality check              │
│ 4. [5.6] E2E test generation (web phases)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ /gsd:execute-phase                                          │
│ (Wave-based execution with checkpoints)                     │
│ 1. Wave grouping & dependency analysis                      │
│ 2. Spawn executor per plan (parallel if enabled)            │
│ 3. [E2E QA loop] Charlotte automated testing                │
│ 4. SUMMARY.md + commit                                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ /gsd:verify-work (or inline verification in execute-phase)  │
│ (Conversational UAT)                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
            ┌─────────────────────────────────┐
            │ Phase complete, next phase or   │
            │ milestone complete              │
            └─────────────────────────────────┘
```

### Key Orchestration Patterns

**Thin orchestrator, heavy subagent:**
- Command/workflow orchestrator stays ~10-15% context
- Subagents (researcher, planner, executor) get ~100% fresh context (200k)
- Context is passed via file paths, not inlined
- Checkpoints allow main context to handle user interaction

**File path references:**
- Workflows reference context via `{variable_name}` placeholders (e.g., `{research_path}`, `{context_path}`)
- Init scripts (gsd-tools.js) resolve paths to actual files
- Subagents read files themselves with `Read` tool

**Wave-based execution (execute-phase.md):**
```
Wave 1: Plans with no dependencies (parallel if enabled)
  ↓ [COMPLETED_CONTEXT_BLOCK assembled]
Wave 2: Plans depending on Wave 1
  ↓ [COMPLETED_CONTEXT_BLOCK updated]
Wave 3: Final wave
```

Each plan's executor receives prior wave SUMMARYs as `<completed_plans_context>` block.

---

## Issues Found

### 1. [CRITICAL] Debug Command References Non-Existent Workflow
**Severity:** HIGH  
**File:line:** `commands/gsd/debug.md:29` | `workflows/` (no match)  
**Evidence:**
```yaml
# commands/gsd/debug.md line 25:
execution_context:
  - (none, workflow reference missing)

# commands/gsd/debug.md line 34:
Task(
  subagent_type="gsd-debugger",
  ...
)
```

**Problem:** `debug` command spawns gsd-debugger agent and references a debug workflow that doesn't exist. There is no `/workflows/debug.md` or similar. The command describes executing "a debug workflow" but the workflow is never referenced, leaving no orchestration pattern for checkpoints or continuations.

**Impact:** Debug command lacks proper gateway patterns, checkpoint handling, and session management that all other workflows have.

---

### 2. [HIGH] E2E Test Generation Enforcement Is Weak in Plan Phase
**Severity:** HIGH  
**File:line:** `workflows/plan-phase.md:275-296` | `workflows/execute-phase.md:9-20`  
**Evidence:**

In `plan-phase.md:275-296`:
```markdown
## 5.6. Generate E2E Test Cases (Web Projects)

**Trigger:** Phase goal mentions UI, frontend, page, component, form, or modal

**Process:**
[...generate test cases...]

**Hard rule:** If phase creates/modifies UI pages and E2E-TEST-PLAN.md is empty or missing, planning is incomplete.
```

But in `execute-phase.md:9-20`:
```markdown
## E2E Testing — Non-Negotiable Rules

1. **Every UI page created or modified MUST have e2e test coverage** — verified by post-execution inventory scan
6. **Pre-dev test generation (Step 5.6) and post-dev gap closure (Step 6.5) are MANDATORY for web phases** — not optional, not deferrable
7. **Subagents that skip or defer e2e testing will trigger verification failure** — QGATE-07 enforces this
```

**Problem:** 
- plan-phase.md says "Hard rule" but offers no verification gate before proceeding
- If E2E-TEST-PLAN.md is missing, planning can continue (Step 6 is not blocked)
- execute-phase.md says "MANDATORY" and references "QGATE-07" but no QGATE-07 definition exists
- Language is strong ("CANNOT be skipped") but execution path has no hard stops

**Impact:** E2E test generation can be silently skipped. Weak enforcement means UI phases execute without pre-dev test planning.

---

### 3. [HIGH] Missing Workflow Definitions (5 workflows without commands)
**Severity:** HIGH  
**File:** `workflows/` (these exist but have no entry points)  
**Evidence:**
- `discover.md` — No `/commands/gsd/discover.md` | Referenced by new-project (discover-phase implied)
- `discovery-phase.md` — No `/commands/gsd/discovery-phase.md` | Similar to discover
- `diagnose-issues.md` — No `/commands/gsd/diagnose-issues.md` | Appears to be internal/orphaned
- `health.md` — No `/commands/gsd/health.md` | Health checking workflow orphaned
- `analyze-pending-sessions.md` — No `/commands/gsd/analyze-pending-sessions.md` | Session analysis orphaned
- `transition.md` — No `/commands/gsd/transition.md` | Phase transition orphaned

**Problem:** These workflows exist but are not exposed as commands, creating confusion about whether they're internal or unreachable user workflows.

---

### 4. [HIGH] Missing Commands Without Workflows (6 commands with no workflow)
**Severity:** HIGH  
**File:line:**  
- `commands/gsd/generate-e2e-coverage.md` — No `workflows/generate-e2e-coverage.md`
- `commands/gsd/join-discord.md` — No matching workflow
- `commands/gsd/open-pr.md` — No matching workflow  
- `commands/gsd/reapply-patches.md` — No matching workflow

**Evidence:** Command files reference workflows that don't exist. Example (generate-e2e-coverage.md):
```yaml
execution_context:
  - @~/.claude/get-shit-done/workflows/generate-e2e-coverage.md  # MISSING
```

**Problem:** Commands are disconnected from workflow definitions, no orchestration pattern, unclear how checkpoints should be handled.

---

### 5. [MEDIUM] Name Mismatch: resume-work vs resume-project
**Severity:** MEDIUM (Intentional but confusing)  
**File:line:** `commands/gsd/resume-work.md:25`  
**Evidence:**
```yaml
# Command: resume-work
# But routes to:
execution_context:
  @~/.claude/get-shit-done/workflows/resume-project.md
```

**Problem:** Command name is `resume-work` but workflow is `resume-project`. No indication this is intentional aliasing. New users will search for "resume-work workflow" and find nothing.

**Impact:** Documentation and discoverability issues.

---

### 6. [MEDIUM] Stale Template References in Workflows
**Severity:** MEDIUM  
**File:line:** `workflows/plan-phase.md:265` | `workflows/execute-plan.md:124` | `workflows/verify-phase.md:22`  
**Evidence:**

In plan-phase.md:265:
```bash
grep -l "## Validation Architecture" "${PHASE_DIR}"/*-RESEARCH.md 2>/dev/null
```

Reads template: `~/.claude/get-shit-done/templates/VALIDATION.md`

But `/templates/` directory appears to be empty or indexed differently. No VALIDATION.md template found during inventory.

In execute-plan.md:160:
```bash
@~/.claude/get-shit-done/templates/summary.md
```

In verify-phase.md:22:
```yaml
@~/.claude/get-shit-done/templates/verification-report.md
```

**Problem:** Multiple workflows reference template files that don't exist or aren't accessible. This breaks the execution flow when workflows try to read/write templates.

---

### 7. [MEDIUM] Weak Mandatory Step Enforcement: E2E QA in Execute Phase
**Severity:** MEDIUM  
**File:line:** `workflows/execute-phase.md:303-367` (checkpoint handling)  
**Evidence:**

In checkpoint handling (lines 319-367):
```markdown
**UI QA checkpoints — always auto-run (Charlotte is the human here):**

When executor returns `Type: ui-qa` — regardless of AUTO_CHAIN or AUTO_CFG:

1. Log: `⚡ UI QA: Starting Charlotte automated testing...`
2. **Auto-start dev servers**
3. **Run Charlotte QA loop** (max 3 rounds)
```

But earlier (lines 9-20):
```markdown
6. **Pre-dev test generation (Step 5.6) and post-dev gap closure (Step 6.5) are MANDATORY for web phases**
```

**Problem:**
- Plan-phase.md has E2E test generation (5.6) but no hard gate to block planning if skipped
- Execute-phase.md has Charlotte QA loop but it's conditional on executor returning `ui-qa` checkpoint
- If plan omits UI QA checkpoint, Charlotte loop doesn't run
- No validation that E2E-TEST-PLAN.md was actually created before execution

**Impact:** E2E testing can be bypassed if planner doesn't create checkpoint or if executor skips returning it.

---

### 8. [MEDIUM] Contradictory Instruction: "Preserve Gates" vs Actual Gate Implementation
**Severity:** MEDIUM  
**File:line:** `commands/gsd/plan-phase.md:42-43`  
**Evidence:**
```yaml
<process>
Execute the plan-phase workflow from @~/.claude/get-shit-done/workflows/plan-phase.md end-to-end.
Preserve all workflow gates (validation, research, planning, verification loop, routing).
```

But then in the actual workflow (plan-phase.md Step 5.6):
```markdown
**Hard rule:** If phase creates/modifies UI pages and E2E-TEST-PLAN.md is empty or missing, planning is incomplete.

...

**If not found:** Warn and continue — plans may fail Dimension 8.
```

**Problem:** Command says "preserve all gates" but workflow implementation says "warn and continue" for missing E2E tests. The gate is not hard-blocking.

---

### 9. [MEDIUM] Token Waste: Large Prompts Re-Included in Spawn Calls
**Severity:** MEDIUM  
**File:line:** `workflows/new-project.md:550-701` (researchers), `workflows/execute-phase.md:147-228` (executors)  
**Evidence:**

new-project.md spawns 4 researchers with full agent prompt embedded:
```markdown
Agent(prompt="<research_type>
Project Research — Stack dimension for [domain].
</research_type>

<milestone_context>
[greenfield OR subsequent]

Greenfield: Research the standard stack for building [domain] from scratch.
...
</milestone_context>
...
[500+ chars of prompt]
", subagent_type="gsd-project-researcher", ...)
```

**Problem:** Each agent receives the full prompt inline, not as a file reference. For 4 parallel researchers, this is ~2K tokens × 4 = 8K tokens of duplication. Similar pattern in execute-phase (wave executors).

**Impact:** Inefficient token usage. Should use file references like `@~/.claude/get-shit-done/prompts/researcher-stack.md`.

---

### 10. [LOW] Ambiguous Checkpoint Type: "ui-qa" vs "charlotte-qa"
**Severity:** LOW  
**File:line:** `workflows/execute-phase.md:319`, `execute-plan.md` (no matching checkpoint type)  
**Evidence:**

execute-phase.md:319 mentions:
```markdown
**UI QA checkpoints — always auto-run (Charlotte is the human here):**

When executor returns `Type: ui-qa`...
```

But no definition of what checkpoint types exist or how executors signal `ui-qa`. Reference to `checkpoints.md` exists but specific types not validated.

**Problem:** Checkpoint type naming is inconsistent. Is it "ui-qa" or "charlotte-qa"? Documentation doesn't clarify.

---

### 11. [LOW] Unclear Verification Flow: verify-phase vs verify-work
**Severity:** LOW  
**File:line:** `workflows/verify-phase.md:1-5`  
**Evidence:**
```markdown
<purpose>
Verify phase goal achievement through goal-backward analysis...
Executed by a verification subagent spawned from execute-phase.md.
</purpose>
```

But verify-phase.md is invoked nowhere in execute-phase.md. It appears to be documentation of how verification **should** work, not how it actually works.

**Problem:** Documentation claims verify-phase is spawned from execute-phase, but the actual code doesn't spawn it. Verification happens inline in execute-plan.

**Impact:** Confusion about verification architecture. Two verification patterns (goal-backward via verify-phase docs, vs actual inline checks in execute-plan).

---

### 12. [LOW] Hard Gate Reference (QGATE-07) Undefined
**Severity:** LOW  
**File:line:** `workflows/execute-phase.md:19`  
**Evidence:**
```markdown
7. **Subagents that skip or defer e2e testing will trigger verification failure** — QGATE-07 enforces this
```

QGATE-07 is never defined. No reference file lists quality gates or their numbers.

**Impact:** Unmaintainable claim. If QGATE-07 changes or doesn't exist, this reference becomes stale.

---

## Improvement Candidates

### 1. [Actionable] Create Debug Workflow
**Priority:** HIGH  
**Action:** Create `/workflows/debug.md` matching the orchestration pattern used by other planning workflows.

**Pattern to follow:**
- Reference `~/.claude/get-shit-done/references/debug-protocol.md` for checkpoint handling
- Define checkpoint types: `root-cause-found`, `hypothesis-ready`, `investigation-blocked`
- Implement session file management (`.planning/debug/{issue-slug}.md`)
- Define continuation agent spawning after checkpoints

**Acceptance:** debug command executes full workflow with proper checkpoint handling.

---

### 2. [Actionable] Add Hard Gate for E2E Test Generation in plan-phase.md
**Priority:** HIGH  
**Action:** Add blocking gate in plan-phase.md Step 5.6 (lines 275-296):

Replace:
```markdown
**If not found:** Warn and continue — plans may fail Dimension 8.
```

With:
```markdown
**If not found:** 
STOP — E2E testing is mandatory for web phases. Options:
1. Re-run: `/gsd:plan-phase {PHASE} --research` (regenerates E2E-TEST-PLAN.md)
2. Override: Mark phase as "non-UI" or "internal-refactor-only"
3. Disable: Disable e2e validation in config (not recommended)

Wait for user response before proceeding.
```

**Acceptance:** Planning cannot proceed without explicit user decision on missing E2E tests.

---

### 3. [Actionable] Document Orphaned Workflows
**Priority:** MEDIUM  
**Action:** Create entry points (commands) or mark workflows as internal.

For each orphaned workflow:
- **discover.md** → Likely internal step of new-project. Rename to `_discover-internal.md` or expose as `/gsd:discover`
- **discovery-phase.md** → Rename to `_discovery-phase-internal.md` or create `/commands/gsd/discovery-phase.md`
- **diagnose-issues.md** → Mark as internal or delete (appears unused)
- **health.md** → Mark as internal or expose as `/gsd:health`
- **analyze-pending-sessions.md** → Mark as internal or expose as `/gsd:analyze-sessions`
- **transition.md** → Mark as internal or expose as `/gsd:transition-phase`

**Acceptance:** Every workflow either has a command entry point OR is prefixed with `_` and documented as internal.

---

### 4. [Actionable] Create Missing Workflows or Delete Stale Commands
**Priority:** MEDIUM  
**Action:** For each command without workflow:

- **generate-e2e-coverage** → Create workflow or rename command to `_generate-e2e-coverage` (internal only)
- **join-discord** → Delete (utility, not phase-related)
- **open-pr** → Create workflow or rename to `_open-pr` (git utility)
- **reapply-patches** → Create workflow or rename to `_reapply-patches` (git utility)

**Acceptance:** No command references a non-existent workflow. All commands either execute workflows or are marked as utilities.

---

### 5. [Actionable] Fix Template References
**Priority:** MEDIUM  
**Action:** Audit all template references in workflows:

```bash
grep -r "templates/" /Users/ollorin/get-shit-done/get-shit-done/workflows/ \
  | grep -oE "templates/[a-z-]+\.md" | sort -u
```

For each missing template:
1. Verify file actually exists (may be in wrong path)
2. Create stub if genuinely missing (e.g., `templates/VALIDATION.md`)
3. Update workflow reference if path is wrong

**Acceptance:** All template references resolve to existing files.

---

### 6. [Actionable] Replace Inline Agent Prompts with File References
**Priority:** MEDIUM  
**Action:** Extract large prompts from workflow spawn calls and create prompt files:

Example (new-project.md researchers):
- Create `~/.claude/get-shit-done/prompts/researcher-stack.md`
- Replace `Agent(prompt="<research_type>...")` with reference

Use:
```markdown
Agent(
  prompt="@~/.claude/get-shit-done/prompts/researcher-stack.md\n{context_injections}",
  ...
)
```

**Impact:** ~8K token savings for new-project alone (4 researchers × 2K tokens).

---

### 7. [Actionable] Clarify Verification Architecture
**Priority:** LOW  
**Action:** Choose between inline verification (actual) vs goal-backward verification (documented) and update all references:

Option A (recommended): Keep inline verification in execute-plan, update verify-phase.md to say "Reference documentation only, not executed".

Option B: Implement goal-backward verification agents and spawn from execute-phase.

Update all references to match chosen architecture.

**Acceptance:** Documentation matches actual execution flow.

---

## Open Questions

1. **Are discover/discovery-phase synonyms or different workflows?** They seem to serve the same purpose but are separate files. Consolidation recommended.

2. **Why does debug command exist if no debug workflow is defined?** Was this command planned but never implemented? Should it be deleted or should the workflow be created?

3. **What is the intended E2E testing enforcement level?** "MANDATORY" (execute-phase) vs "warn and continue" (plan-phase) are contradictory. Which is the source of truth?

4. **Are orphaned workflows (health.md, analyze-pending-sessions.md, transition.md) actively used?** If not, they should be removed. If yes, they should have command entry points.

5. **How are quality gates (QGATE-01 through QGATE-07) defined?** execute-plan.md references CPGATE-01 through CPGATE-04 explicitly, but QGATE-07 is mentioned in execute-phase without definition. Is there a gates reference document?

6. **Should resume-work and resume-project be consolidated or is the alias intentional?** Current state (command routes to differently-named workflow) is confusing.

---

## Summary

**Critical Issues:** 3  
- Missing debug workflow
- Weak E2E test generation enforcement
- Missing workflows/commands (11 total mismatches)

**High Issues:** 5  
- Template references unresolved
- Contradictory gate instructions
- Checkpoint type ambiguity
- Verification flow unclear
- Unmaintained QGATE references

**Improvement Opportunity:** Token waste in agent spawning (+8K per multi-agent call).

**Recommended Action:** Fix the 3 critical issues first (blocks user workflows), then address high issues in order of frequency of impact.
