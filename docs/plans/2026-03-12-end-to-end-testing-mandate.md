# End-to-End Testing Mandate

**Date:** 2026-03-12
**Status:** Approved

## Problem

The GSD pipeline (PRD → new-milestone → roadmap → plan-phase → executor) was not producing API-level or UI-level tests despite explicit mandates in gsd-planner.md. Root cause: the roadmapper deferred all testing to a single catch-all phase (e.g., Phase 83 in the RG milestone), so the planner never saw testing requirements in individual phase success criteria and never added `tdd="true"` tasks. The planner's validation was a soft one-liner ("also verify... if missing, add one") rather than a hard gate.

## Scope

Three files in `/Users/ollorin/get-shit-done/`:
1. `~/.claude/get-shit-done/workflows/prd.md` (source: `commands/gsd/prd.md` references `workflows/prd.md`)
2. `agents/gsd-roadmapper.md`
3. `agents/gsd-planner.md`

## Design

### 1. prd.md — Inline Test ACs

In Stage 2d (Write PO Section), the AC generation instruction gains a mandatory rule:

> For every user story:
> - If the story involves backend behavior (API endpoint, RPC, business logic) → add `- [ ] **API tests:** [list of scenarios]` as the last AC
> - If the story involves a UI page, form, or interactive component → add `- [ ] **Charlotte QA:** [list of flows]` as the last AC
> - If pure infrastructure (migration only, no user-facing behavior) → neither required

AC template becomes:
```markdown
**US-{N} Acceptance Criteria:**
- [ ] {behavioral condition 1}
- [ ] {behavioral condition 2}
- [ ] {edge case condition}
- [ ] **API tests:** {scenario list}        ← add when US has backend behavior
- [ ] **Charlotte QA:** {flow list}         ← add when US has UI
```

### 2. gsd-roadmapper.md — Testing Success Criteria Mandate

Add a new `<testing_mandate>` section after `<goal_backward_phases>`:

**Two rules:**

1. **Per-phase testing criteria**: When deriving success criteria for a phase, if any mapped requirement has an `API tests:` AC → the phase MUST include a success criterion: *"Integration tests cover: [scenarios from AC]"*. If any mapped requirement has a `Charlotte QA:` AC → the phase MUST include: *"Charlotte QA passes for: [flows from AC]"*.

2. **No deferral rule** (in `<anti_patterns>`): *"Don't compress all testing into a final phase. Each delivery phase that creates API endpoints or UI must include its own test success criteria."*

Add to `<success_criteria>` checklist:
- `- [ ] Phases with API test ACs have a testing success criterion`
- `- [ ] Phases with Charlotte QA ACs have a QA success criterion`
- `- [ ] No delivery phase defers all testing to a later phase`

### 3. gsd-planner.md — Hard Testing Gate

Replace the soft single-line check in `checkpoint_type_audit`:
> "Also verify: plans with API endpoints have a `tdd='true'` task. If missing, add one."

With a dedicated `validate_testing_gate` step that runs **after** all plans are built, **before** returning to the orchestrator:

```
For each plan:
  - Find all tasks that create/modify API endpoints (edge functions, RPCs, HTTP routes)
  - Check: is there an adjacent tdd="true" task covering it?
  - Find all tasks that create/modify web UI (pages, forms, components)
  - Check: is there a checkpoint:ui-qa task covering it?

If any violation:
  RETURN: ## PLAN REJECTED — TESTING GATE FAILED
  List each violation: "Plan NN: task '[name]' creates [API/UI] with no [tdd task/ui-qa checkpoint]"
  Do NOT return plans to orchestrator.

If no violations:
  Proceed normally.
```

## Files to Edit

| File | Change |
|------|--------|
| `~/.claude/get-shit-done/workflows/prd.md` | Stage 2d: add test AC rule to AC generation instruction |
| `agents/gsd-roadmapper.md` | Add `<testing_mandate>` section + anti-pattern + checklist items |
| `agents/gsd-planner.md` | Replace soft check with hard `validate_testing_gate` step |

Note: `agents/` changes must also be deployed to `~/.claude/agents/` (or re-run install).
