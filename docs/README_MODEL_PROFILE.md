# Model Profile "auto" — Complete Documentation Index

This directory contains comprehensive documentation on how the GSD system's `model_profile: "auto"` feature works.

## Quick Start

**Current Setting:** `model_profile: "auto"` in `.planning/config.json`

**What it does:** Automatically assigns model tiers (haiku/sonnet/opus) to each task based on task complexity and current quota usage.

**Files to read:**
1. **[Quick Reference](MODEL_PROFILE_QUICK_REFERENCE.md)** — Start here (5 min read)
2. **[Flow Diagrams](MODEL_PROFILE_FLOW.md)** — Visual architecture (10 min read)
3. **[Full Design Report](MODEL_PROFILE_AUTO_DESIGN_REPORT.md)** — Complete reference (20 min read)

---

## Documentation Map

### 1. Quick Reference
**File:** `MODEL_PROFILE_QUICK_REFERENCE.md`
**Purpose:** Fast lookup guide
**Contains:**
- Current config setting
- High-level "how it works" flow
- Task router decision rubric (55% haiku, 30% sonnet, 15% opus)
- Quota downgrade rules
- What gets routed vs. hardcoded
- Gap summary

**Best for:** Understanding "what should I know about auto mode?"

---

### 2. Flow Diagrams
**File:** `MODEL_PROFILE_FLOW.md`
**Purpose:** Visual architecture and step-by-step execution
**Contains:**
- Configuration entry point
- Planning phase (routing pass, task-router decisions, consistency check)
- Execution phase (per-task vs. plan-level routing, quota checks)
- Executor integration (failure signaling, SUMMARY.md reporting)
- Support agents (hardcoded tiers)
- Complete flow diagram
- Timeline example
- Decision point table

**Best for:** "Show me how the data flows" and tracing execution path

---

### 3. Full Design Report
**File:** `MODEL_PROFILE_AUTO_DESIGN_REPORT.md`
**Purpose:** Comprehensive reference and design analysis
**Contains:**
- Executive summary
- Configuration & activation (where model_profile is defined, how it's read)
- Auto-routing architecture (two-phase system: planning + execution)
- Task router agent (decision rubric, quota adjustment, context injection)
- Executor integration (routing context, failure signaling, SUMMARY.md)
- Hardcoded model assignments (gap analysis: what's not routed)
- Complete model assignment flow diagram
- Decision points & logic (when/why routing is active)
- Supporting infrastructure (routing commands, gsd-tools.js)
- Execution statistics and targets
- Gaps & design issues (6 detailed gaps with recommendations)
- Command reference (config, testing, manual operations)
- Recommended reading order
- Summary table

**Best for:** Design review, gap analysis, architectural decisions

---

## Source Code References

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| **Task Router Agent** | `agents/gsd-task-router.md` | Full | Analyzes task complexity and decides tier |
| **Planner Routing Pass** | `agents/gsd-planner.md` | 1166-1229 | Injects `<model>` tags into PLAN.md |
| **Coordinator Routing** | `agents/gsd-phase-coordinator.md` | 560-700+ | Spawns executors with selected tiers |
| **Executor Integration** | `agents/gsd-executor.md` | 34-89, 140-148, 446-461 | Tracks tiers, signals failures, reports stats |
| **Task Context Skill** | `skills/task-context/SKILL.md` | Full | Alternative routing interface |
| **Config File** | `.planning/config.json` | Line 6 | `model_profile` setting |

---

## Key Concepts

### The Three Tiers

| Tier | % Target | Use When |
|------|----------|----------|
| **Haiku** | ~55% | Task is well-specified, mechanical work, no judgment needed |
| **Sonnet** | ~30% | Multi-step work requires design decisions, investigation, or judgment |
| **Opus** | ~15% | Hard architectural choices, completely unknown root cause, breaking changes |

### The Two-Phase Process

1. **Planning Phase:**
   - Planner writes PLAN.md with all tasks
   - If `model_profile: "auto"`, spawn task-router per task
   - Each router analyzes complexity + quota, returns haiku/sonnet/opus
   - Decisions injected as `<model>` elements in PLAN.md

2. **Execution Phase:**
   - Coordinator reads PLAN.md and detects `<model>` elements
   - If found: per-task mode (spawn executor per task with assigned tier)
   - If not found: plan-level mode (spawn task-router once for whole plan)
   - Each executor runs with its assigned model tier
   - Quota-based downgrades applied at execution time (>95%→haiku, >80%+opus→sonnet)

### Quota-Based Downgrades

Applied per-task after routing decision in execution phase:

```
Check session quota usage:
- >95% → force haiku (critical conservation)
- >80% AND tier=opus → downgrade to sonnet
- Otherwise → keep original tier
```

---

## How to Use This Documentation

### For Users

**Question:** "Should I use auto mode?"
→ Read: Quick Reference, Section "To Disable Auto Routing"

**Question:** "Why did task X get routed to sonnet instead of haiku?"
→ Read: Flow Diagrams (Task Router decision logic), Full Report (Task Router Agent section)

**Question:** "How do I see what tiers were assigned?"
→ Read: Quick Reference "Testing" section, or grep SUMMARY.md for routing stats

### For Developers

**Question:** "I want to implement failure-based escalation. Where does the signal flow?"
→ Read: Full Report "Gap 2: No Failure-Based Escalation", Flow Diagrams (Executor section)

**Question:** "How can I make support agents use auto routing?"
→ Read: Full Report "Gap 1: Support Agent Tiers Are Hardcoded"

**Question:** "What happens when quota is >95%?"
→ Read: Quick Reference "Quota-Based Downgrades", Full Report "Task Router Agent" section 2

**Question:** "Is there legacy format support? When is it used?"
→ Read: Full Report "Gap 5: Legacy [tier] Name Prefix Support"

### For Design Reviews

1. Start with: Full Report sections 1-3 (overview, architecture, task router)
2. Review: Flow Diagrams (understand execution path)
3. Analyze: Full Report sections 9-10 (gaps, recommendations, summary table)
4. Decision: Which gaps to address in next iteration?

---

## Known Gaps (Brief Summary)

**Gap 1: Support agent tiers hardcoded**
- Meta-answerer, Verifier, Integration Tester always sonnet
- Charlotte QA always haiku (sonnet on retry)
- Could benefit from dynamic routing

**Gap 2: No failure-based escalation**
- Executor signals routed failures with tier info
- Escalation logic not shown in current code
- Coordinator could re-spawn at higher tier on haiku failure

**Gap 3: Quota check only at execution**
- Planner doesn't check quota during routing pass
- Executor downgrades later
- Could pre-filter during planning

**Gap 4: Consistency check logic underdefined**
- Definition of "similar tasks" unclear
- Could silently downgrade without clear reason

**Gap 5: Legacy format support**
- Coordinator supports both `<model>` elements and `[haiku]` prefix
- Only new format created by planner
- Could confuse format divergence

**Gap 6: Plan-level routing underexercised**
- Fallback when no `<model>` elements found
- Rarely triggered (planner always injects)
- Could hide bugs

→ Full details: See Full Report "Section 9: GAPS & Design Issues"

---

## Command Reference

### View Current Setting
```bash
jq '.model_profile' .planning/config.json
```

### Enable Auto Mode
```bash
jq '.model_profile = "auto"' .planning/config.json > temp.json && mv temp.json .planning/config.json
```

### Disable Auto Mode (Use Sonnet for All)
```bash
jq '.model_profile = "quality"' .planning/config.json > temp.json && mv temp.json .planning/config.json
```

### Check Routing Stats for a Phase
```bash
grep -A 10 "^## Routing" .planning/phases/*/01-PLAN-SUMMARY.md
```

### View Execution Log
```bash
grep "routing_decision\|routing_decisions" .planning/EXECUTION_LOG.md
```

### Verify `<model>` Tags in Plan
```bash
grep "<model>" .planning/phases/*/01-PLAN.md
```

---

## Testing & Debugging

### Manual Task Router Test
```bash
Task(
  subagent_type="gsd-task-router",
  prompt="Route this task: Implement user authentication with JWT"
)
```

### Check if Routing Pass Ran
- Look for `<model>` elements in `.planning/phases/*/01-PLAN.md`
- Check EXECUTION_LOG.md for `routing_decisions` entries

### Verify Per-Task Mode Activated
```bash
# If these exist, per-task mode ran:
grep "<model>" .planning/phases/*/01-PLAN.md

# If these don't exist, plan-level fallback used:
grep "model>haiku\|model>sonnet\|model>opus" .planning/phases/*/01-PLAN.md
```

### Understand a Specific Task's Assignment
1. Find task in PLAN.md
2. Look for `<model>` element immediately after `</name>`
3. Check EXECUTION_LOG.md for corresponding `routing_decisions` entry
4. Read SUMMARY.md routing table for actual spawn tier (may differ due to quota)

---

## Architecture Layers

```
┌─ User Configuration ──────────────────┐
│ .planning/config.json                 │
│ model_profile: "auto"                 │
└─────────────────────────────────────────┘
                    ↓
┌─ Planning Phase ──────────────────────┐
│ Planner → Task Router (per task)      │
│ Decisions → <model> tags              │
└─────────────────────────────────────────┘
                    ↓
┌─ Plan Document ───────────────────────┐
│ PLAN.md with <model> elements         │
│ (source of truth for tiers)           │
└─────────────────────────────────────────┘
                    ↓
┌─ Execution Phase ─────────────────────┐
│ Coordinator detects tiers             │
│ Applies quota downgrades              │
│ Spawns executors (per task)           │
└─────────────────────────────────────────┘
                    ↓
┌─ Executor Layer ──────────────────────┐
│ Runs at assigned tier                 │
│ Tracks ROUTED_TIER                    │
│ Creates SUMMARY.md with stats         │
└─────────────────────────────────────────┘
                    ↓
┌─ Logs & Reporting ────────────────────┐
│ EXECUTION_LOG.md (routing decisions)  │
│ SUMMARY.md (routing stats per plan)   │
│ STDOUT (tier distribution summary)    │
└─────────────────────────────────────────┘
```

---

## Relationships to Other Systems

| System | Interaction | Location |
|--------|-------------|----------|
| **Task Router Skill** | Alternative interface to routing | `skills/task-context/SKILL.md` |
| **Quota System** | Downgrades tiers when quota high | Task Router (85-90), Coordinator (668-676) |
| **Execution Log** | Records routing decisions | Planner (1217-1222), Coordinator (614-617) |
| **SUMMARY.md** | Reports routing stats | Executor (446-461) |
| **gsd-tools.js** | Provides config, quota, routing CLI | Referenced throughout |
| **Charlotte QA Loop** | Uses dynamic tier (haiku→sonnet) | Coordinator (785, 964, 1000) |

---

## Next Steps / Roadmap

**Short term (bugs/quick wins):**
- Document undefined "similarity" criteria for consistency check
- Simplify plan-level routing docs (it's rarely used)

**Medium term (improvements):**
- Implement failure-based escalation (Gap 2)
- Add per-task routing to support agents (Gap 1)
- Pre-check quota during planning phase (Gap 3)

**Long term (architecture):**
- Deprecate legacy `[tier]` prefix format
- Consider streaming routing decisions (parallel planner + router)
- Build routing analytics dashboard

---

## Questions?

If something is unclear:

1. **Check the relevant section in the Full Report** (Section 6-11)
2. **Review the source agent code** directly (links in "Source Code References")
3. **Look at actual PLAN.md + SUMMARY.md** for concrete examples
4. **Test manually** (see "Testing & Debugging" section)

---

## Document Version

**Last Updated:** 2026-03-09
**Scope:** Complete `model_profile: "auto"` implementation
**Author:** GSD Research Task
**Status:** Comprehensive (covers all code paths, gaps documented)

