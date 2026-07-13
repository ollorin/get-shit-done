# Model Profile "auto" — Quick Reference

## Current Setting

```json
// .planning/config.json
{
  "model_profile": "auto",
  "coordinator_model": "sonnet"
}
```

---

## How It Works

### Phase 1: Planning
```
Planner writes PLAN.md
  ↓
Check: is model_profile == "auto"?
  ↓ YES
Spawn task-router agent per task
  ↓
Each router analyzes complexity + quota
  ↓
Inject <model>{tier}</model> into PLAN.md
```

**Result:** PLAN.md with explicit tier assignments for each task

---

### Phase 2: Execution
```
Coordinator reads PLAN.md
  ↓
Check: is model_profile == "auto"?
  ↓ YES
Detect: <model> elements present?
  ↓ YES (per-task mode)
For each task:
  - Read tier from <model>
  - Apply quota downgrade if needed (>95%→haiku, >80%+opus→sonnet)
  - Spawn executor with that tier
  - Track: ROUTING_STATS[tier] += 1
```

**Result:** Tasks execute at their assigned tiers with quota-aware adjustments

---

## The Task Router Decision Rubric

When task-router evaluates a task, it uses this distribution target:

| Tier | % | When to Use |
|------|---|-------------|
| **Haiku** | ~55% | Well-specified, mechanical work. No judgment needed. |
| **Sonnet** | ~30% | Multi-step, requires design decisions. |
| **Opus** | ~15% | Hard architectural choices, unknown root causes. |

**Key principle:** "When in doubt, go one tier down."

### Haiku Examples
- Bug with clear location and description
- Add field, rename variable, update config
- Tests for already-designed feature
- Mechanical find-and-replace
- SQL migration (schema given)
- Update dependency version

### Sonnet Examples
- Refactor with unclear target structure
- Debug issue where root cause unknown
- Feature touching multiple files with no design spec
- Write/update documentation
- Schema design from requirements
- Phase verification

### Opus Examples
- Design decisions with multiple valid approaches
- Complete root cause unknown across systems
- Breaking API changes with system-wide impact

---

## Quota-Based Downgrades (Execution Only)

Applied per-task after routing decision:

```
Check: node ~/.claude/get-shit-done/bin/gsd-tools.js quota status --json

If session.percent > 95%:
  TIER = haiku  (critical conservation)

Else if session.percent > 80% AND TIER == opus:
  TIER = sonnet  (moderate conservation)

Else:
  Keep original tier
```

---

## Key Files

| File | Role | Lines |
|------|------|-------|
| `agents/gsd-task-router.md` | Routing decision logic | Full agent |
| `agents/gsd-planner.md` | Inject tiers into PLAN.md | 1166-1229 |
| `agents/gsd-phase-coordinator.md` | Execute per-task spawning | 560-700+ |
| `agents/gsd-executor.md` | Receive & track tiers | 34-89, 140-148 |

---

## What Gets Routed

✓ **All executor tasks** — each task in PLAN.md gets a tier

✗ **NOT routed:**
- Knowledge mining (always haiku)
- Meta-answerer Q&A (always sonnet)
- Charlotte QA testing (always haiku, sonnet on retry)
- Verifier (always sonnet)
- Integration tester (always sonnet)

---

## Failure Signaling

If a routed task fails after retries:

```
Executor returns:
  TASK FAILED: {name} [tier: {ROUTED_TIER}] — {error}

Coordinator sees [tier: {ROUTED_TIER}] and could:
  1. Decide to re-spawn at higher tier
  2. Log escalation
  3. Add to SUMMARY.md

Status: Signaling ready, escalation logic not shown in code
```

---

## SUMMARY.md Reporting

After execution, includes routing section:

```markdown
## Routing

| Task | Routed Tier | Escalated |
|------|-------------|-----------|
| 1    | haiku       | no        |
| 2    | sonnet      | no        |
| 3    | haiku       | yes → sonnet |

Distribution: 2 haiku / 1 sonnet / 0 opus
Escalations: 1 (haiku → sonnet on retry)
```

Only included if `model_profile: "auto"` was active.

---

## To Disable Auto Routing

```bash
# Set model_profile to something else
jq '.model_profile = "quality"' .planning/config.json > temp.json && mv temp.json .planning/config.json

# Coordinator will then:
# - Skip all routing detection
# - Use coordinator_model (default: sonnet) for all executors
# - No <model> elements injected into PLAN.md
```

---

## Gaps & TODOs

1. **Support agent tiers hardcoded** — Meta-answerer, Verifier always sonnet; Charlotte QA always haiku. Could be auto-routed.

2. **No failure escalation logic** — Executor can signal routed failures with tier info, but no shown code for coordinator re-spawn.

3. **Legacy format support** — Coordinator supports `[haiku]` prefix in task names for backwards compat, but planner only creates `<model>` elements.

4. **Quota check only at execution** — Planner doesn't check quota during routing pass, executor downgrades later.

---

## Testing

```bash
# View a phase's routing stats
grep -A 10 "^## Routing" .planning/phases/*/01-PLAN-SUMMARY.md

# Check execution log
grep "routing_decision\|routing_decisions" .planning/EXECUTION_LOG.md

# Verify <model> tags in plan
grep "<model>" .planning/phases/*/01-PLAN.md
```

---

## See Also

- Full design report: `docs/MODEL_PROFILE_AUTO_DESIGN_REPORT.md`
- Task router source: `agents/gsd-task-router.md`
- Planner routing pass: `agents/gsd-planner.md` lines 1166-1229
