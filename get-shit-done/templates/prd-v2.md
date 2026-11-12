# PRD Template v2

Template for `.planning/prds/pending/{slug}.md`, written by `/gsd:prd-v2`. Product-oriented: WHAT and WHY, no HOW.

Intake contract kept from v1 (read by `/gsd:new-milestone`): the file lives in `prds/pending/`, starts with a stage marker, and has a `**Concept:**` line. User Stories, Acceptance Criteria and MVP Boundary are what the roadmapper decomposes.

---

<template>

```markdown
<!-- stage: initialized -->

# PRD: {slug}

**Created:** {date}
**Status:** pending
**Concept:** {concept_summary}
**Inputs:** {concept source} | brief: {brief path or "none"} | siblings indexed: {N}

---

## Problem Statement

{problem_statement}

---

## Goals

{goals_list}

---

## Non-Goals

{non_goals}

---

## Success Metrics

{success_metrics}

---

## Relationship to Adjacent PRDs

{adjacent_prds}

---

## User Stories

{user_stories}

---

## Acceptance Criteria

{acceptance_criteria}

---

## UX Notes

{ux_notes}

---

## MVP Boundary

**MVP (Phase 1):**
{mvp_items}

**Phase 2 (deferred):**
{phase2_items}

---

## Non-Functional Requirements and Compliance

{nfr_compliance}

---

## Tech Candidates

> WHAT technologies to consider and WHY. No schemas, API routes, DDL or code.

{tech_candidates}

---

## Open Questions

{open_questions}

---

## Assumptions

{assumptions}

---

*PRD Status: pending*
*Stored: .planning/prds/pending/{slug}.md*
*Ready for: /gsd:new-milestone*
```

</template>

<guidelines>

**Content rules per section:**

- **Problem Statement:** target user, problem, how it is solved today, the gap. The pain, not the solution.
- **Goals:** outcomes a user reaches. Not features.
- **Non-Goals:** what this PRD will not do or become, and what a sibling PRD owns instead. At least one line; "none" is not an answer.
- **Success Metrics:** 2 to 5 rows, `| Metric | Target or direction | Measured from |`. Every metric names the event or data it is computed from, so instrumentation becomes a story or an acceptance criterion and is not discovered after launch.
- **Relationship to Adjacent PRDs:** `| PRD | Direction | What crosses the boundary |`, direction is `needs`, `provides` or `shares`. Covers every sibling whose scope touches this one. A shared concept (a status list, an entity, a points ledger) names the one PRD that owns its definition. Write "No sibling PRDs found" when the index was empty.
- **User Stories:** "As a [user], I want [action] so that [outcome]", numbered `US-N`.
- **Acceptance Criteria:** testable behaviour as checkboxes, grouped by story. Backend behaviour gets an `**API tests:**` line; a page, form or interactive component gets a `**UI QA:**` line (named after the project's UI QA tool when it has one). Include the failure and empty states.
- **UX Notes:** screens and states in words: what each screen must show, the empty, loading and error states, and the breakpoints that matter. Visual design is done at implementation. Add a `References:` list only when the input came with mockups or screenshots; never invent paths.
- **MVP Boundary:** explicit lists; every story appears in exactly one of them.
- **Non-Functional Requirements and Compliance:** only what is specific to this PRD on top of the product baseline (cite the baseline, do not copy it): security and abuse cases, privacy and personal data handled, performance or load expectation, accessibility, SEO when the surface is public, and regulatory points with the market they apply to. A row with no known answer is an `A-` assumption, not a blank.
- **Tech Candidates:** names and rationale only. When the product baseline fixes the stack, list only what this PRD adds or where it must deviate, with the reason.
- **Open Questions:** only questions that wait for the CEO (critical). Each starts with its ledger id.
- **Assumptions:** every decision taken without the CEO, each starting with its `A-` id, the default chosen, and its reversibility (`cheap`, `costly`, `irreversible`).

**Belongs / does not belong:**

| Belongs in PRD | Does not belong |
|---|---|
| "Users need real-time updates" | "Use WebSockets at /ws/events" |
| "PostgreSQL: relational data with complex queries" | "CREATE TABLE users (id UUID...)" |
| "The list shows an empty state with a call to action" | A component tree or a pixel layout |
| "Success: onboarding completes in under 5 minutes" | "POST /api/onboarding" |

**Markers (written by the workflow):**
- `<!-- stage: initialized -->`, `<!-- stage: pm -->`, `<!-- stage: po -->`, `<!-- stage: complete -->`
- `<!-- approval: approved {date} -->` or `<!-- approval: assumed {date} -->` on the line under the stage marker

</guidelines>
