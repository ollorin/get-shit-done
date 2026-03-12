# End-to-End Testing Mandate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce API integration tests and Charlotte UI QA in every phase that creates API endpoints or UI, by fixing three GSD source files: prd.md (inline test ACs), gsd-roadmapper.md (testing success criteria mandate), and gsd-planner.md (hard testing gate).

**Architecture:** Targeted edits to three agent/workflow files. No new files. Changes propagate automatically — installed copies at `~/.claude/` are the source, `agents/` are the canonical source deployed via install. Edit source in `/Users/ollorin/get-shit-done/`, then run install to deploy.

**Tech Stack:** Markdown files (agent prompts). No code to run. Verification is reading the edited files and confirming the text is correct.

---

### Task 1: Edit `prd.md` — Add test AC generation rule

**Files:**
- Modify: `~/.claude/get-shit-done/workflows/prd.md` (line ~245-255, the `{acceptance_criteria}` replacement block)

The current AC template in Stage 2d is:
```markdown
Replace `{acceptance_criteria}` placeholder with:
```markdown
## Acceptance Criteria

{For each user story:}
**US-{N} Acceptance Criteria:**
- [ ] {concrete testable condition 1}
- [ ] {concrete testable condition 2}
- [ ] {edge case: what happens when...}

```
```

**Step 1: Read the file to confirm current content**

Read `~/.claude/get-shit-done/workflows/prd.md` lines 244-256 to confirm exact text before editing.

**Step 2: Apply the edit**

Replace the AC template block. The new version adds a mandatory test AC rule after the edge case line:

Old text (exact):
```
Replace `{acceptance_criteria}` placeholder with:
```markdown
## Acceptance Criteria

{For each user story:}
**US-{N} Acceptance Criteria:**
- [ ] {concrete testable condition 1}
- [ ] {concrete testable condition 2}
- [ ] {edge case: what happens when...}

```
```

New text:
```
Replace `{acceptance_criteria}` placeholder with:
```markdown
## Acceptance Criteria

{For each user story:}
**US-{N} Acceptance Criteria:**
- [ ] {concrete testable condition 1}
- [ ] {concrete testable condition 2}
- [ ] {edge case: what happens when...}
- [ ] **API tests:** {comma-separated list of test scenarios}   ← include when US involves backend behavior (API endpoint, RPC, business logic, state machine)
- [ ] **Charlotte QA:** {comma-separated list of QA flows}     ← include when US involves a UI page, form, modal, or interactive component

```

**Test AC generation rules:**
- US involves backend behavior (API endpoint, RPC, DB function, state machine, business logic) → add `**API tests:**` AC listing: happy path, auth/authz failure, validation errors, error handling, edge cases
- US involves a UI page, form, modal, or interactive component → add `**Charlotte QA:**` AC listing: renders correctly, key interactions, error states, responsive behavior
- US is pure infrastructure (migration only, config, no user-facing behavior) → omit both
- US has both backend + UI → include both
```

**Step 3: Verify the edit**

Re-read the edited section. Confirm:
- `**API tests:**` line is present with the `←` annotation
- `**Charlotte QA:**` line is present with the `←` annotation
- "Test AC generation rules:" block is present with the four rules
- Surrounding text is unchanged

**Step 4: Also edit the source copy**

The same change must be made in the git-tracked source. The installed copy at `~/.claude/get-shit-done/workflows/prd.md` is what agents use, but the source of truth is `/Users/ollorin/get-shit-done/`.

Check if a source `workflows/` directory exists. If not, the prd workflow is only in `~/.claude/get-shit-done/workflows/prd.md` (installed). In that case the edit to `~/.claude/` is sufficient — note this in the commit message.

**Step 5: Commit**

```bash
cd /Users/ollorin/get-shit-done
git add -p  # or stage specific file if found in source
git commit -m "feat: add inline API test and Charlotte QA ACs to PRD workflow

Every user story with backend behavior gets '**API tests:**' AC.
Every user story with UI gets '**Charlotte QA:**' AC.
Infrastructure-only stories (migrations, config) omit both.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

If the prd.md is installed-only (not in git source), commit a note to CHANGELOG or skip — the `~/.claude/` edit is the working change.

---

### Task 2: Edit `gsd-roadmapper.md` — Add testing mandate section

**Files:**
- Modify: `/Users/ollorin/get-shit-done/agents/gsd-roadmapper.md`

**Step 1: Read lines 82-148 to confirm exact location**

The `</philosophy>` tag closes at line 82. The `<goal_backward_phases>` section starts at line 84. The new `<testing_mandate>` section goes between `</goal_backward_phases>` (line 147) and `<phase_identification>` (line 149).

**Step 2: Insert the `<testing_mandate>` section**

After line 147 (`</goal_backward_phases>`), insert:

```markdown

<testing_mandate>

## Testing Success Criteria Are Mandatory

When phases create API endpoints or UI, testing is NOT a separate concern — it is a delivery criterion of that phase.

### Rule 1: API Test Criterion

If any requirement mapped to a phase has an `**API tests:**` AC, the phase success criteria MUST include:

> Integration tests cover: [list the test scenarios from the AC]

Example:
- Bad: "Deposit limit blocks player when exceeded" ← behavioral only
- Good: "Deposit limit blocks player when exceeded" AND "Integration tests cover: limit enforcement, limit exceeded (422), cooling-off, concurrent deposits" ← behavioral + tested

### Rule 2: Charlotte QA Criterion

If any requirement mapped to a phase has a `**Charlotte QA:**` AC, the phase success criteria MUST include:

> Charlotte QA passes for: [list the flows from the AC]

Example:
- Bad: "Player can view and manage their limits on the RG limits page" ← behavioral only
- Good: "Player can view and manage their limits on the RG limits page" AND "Charlotte QA passes for: limit widget renders, edit flow saves, operator-imposed read-only badge" ← behavioral + QA'd

### Rule 3: No Testing Deferral

Do NOT compress all testing into a single testing phase at the end of the milestone.

Each delivery phase that creates API endpoints or UI MUST include its own test success criteria. A dedicated integration test phase (e.g., "Phase N: E2E Tests") is allowed for cross-cutting concerns only — it cannot replace per-phase test criteria.

</testing_mandate>

```

**Step 3: Add anti-pattern to `<anti_patterns>` section**

Find the `<anti_patterns>` section (around line 546). Add after the last existing anti-pattern:

```markdown

**Don't defer all testing to a final phase:**
- Bad: Phases 1-9 implement features, Phase 10 adds all tests
- Good: Each delivery phase includes test success criteria alongside implementation criteria
```

**Step 4: Add three items to `<success_criteria>` checklist**

Find the `<success_criteria>` section (around line 576). After the line:
```
- [ ] Success criteria derived for each phase (2-5 observable behaviors)
```

Add:
```
- [ ] Phases with API test ACs have an integration test success criterion
- [ ] Phases with Charlotte QA ACs have a QA success criterion
- [ ] No delivery phase defers all testing to a later phase
```

**Step 5: Verify all three edits**

Re-read the file and confirm:
- `<testing_mandate>` section exists between `</goal_backward_phases>` and `<phase_identification>`
- The three Rules are present (API tests, Charlotte QA, No deferral)
- Anti-pattern added in `<anti_patterns>` section
- Three new checklist items in `<success_criteria>`

**Step 6: Commit**

```bash
cd /Users/ollorin/get-shit-done
git add agents/gsd-roadmapper.md
git commit -m "feat: mandate testing success criteria per delivery phase in roadmapper

Phases with API test ACs must include integration test criterion.
Phases with Charlotte QA ACs must include QA criterion.
No deferral of all testing to a single final phase.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Edit `gsd-planner.md` — Hard testing gate

**Files:**
- Modify: `/Users/ollorin/get-shit-done/agents/gsd-planner.md`

**Step 1: Read lines 1280-1295 to confirm exact text**

Find the end of the `<step name="validate_plan">` block which currently ends with:
```
Also verify: plans with API endpoints have a `tdd='true'` task. If missing, add one.
</step>
```
at line 1291-1292.

**Step 2: Replace the soft check with a hard gate**

Old text (exact, lines 1291-1292):
```
Also verify: plans with API endpoints have a `tdd='true'` task. If missing, add one.
</step>
```

New text — remove the soft check from validate_plan and close the step, then add a new dedicated step:
```
</step>

<step name="validate_testing_gate">
## Hard Testing Gate

Run this gate AFTER all plans are written, BEFORE returning to orchestrator.

**Scan all plans for testing violations:**

For each plan in this phase:
1. List every task that creates or modifies an API endpoint, edge function, RPC, or HTTP route
2. For each such task: is there an adjacent `tdd="true"` task in the same or immediately following plan?
3. List every task that creates or modifies a web UI page, form, modal, or interactive component
4. For each such task: is there a `checkpoint:ui-qa` task covering it in the same or immediately following plan?

**If any violation found:**

Return immediately with:
```
## PLAN REJECTED — TESTING GATE FAILED

The following plans are missing required test coverage:

{For each violation:}
- Plan {NN}: task "{task name}" creates/modifies {API endpoint/UI} — missing {tdd="true" task / checkpoint:ui-qa}

Fix required before proceeding:
- API tasks without tdd coverage → add a `type="auto" tdd="true"` task immediately after each
- UI tasks without ui-qa coverage → add a `type="checkpoint:ui-qa"` task after the feature group

Resubmit plans after adding missing test tasks.
```

Do NOT return PLANNING COMPLETE. Do NOT write SUMMARY. Do NOT commit.

**If no violations:**

Continue to `update_roadmap` step normally.

**Exemptions (do not flag):**
- Migration-only tasks (no user-facing behavior, no HTTP routes)
- Config/type definition files
- Pure CSS changes with no structural component changes
- Non-web projects (macOS, audio, Xcode) — use judgment
</step>
```

**Step 3: Verify the edit**

Re-read lines ~1288-1340. Confirm:
- The old single line `Also verify: plans with API endpoints...` is gone
- `validate_testing_gate` step exists with `## PLAN REJECTED` block
- The "If no violations" branch leads to `update_roadmap`
- `validate_plan` step still closes with `</step>` before the new step

**Step 4: Commit**

```bash
cd /Users/ollorin/get-shit-done
git add agents/gsd-planner.md
git commit -m "feat: replace soft tdd check with hard testing gate in planner

Plans with API tasks missing tdd='true' or UI tasks missing
checkpoint:ui-qa now return PLAN REJECTED instead of silently
adding tasks. Gate runs after all plans written, before returning
to orchestrator.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Deploy changes to installed copies

**Files:**
- Read: `/Users/ollorin/get-shit-done/bin/install.js` (or equivalent install script) to find deploy command

**Step 1: Find the install/deploy command**

```bash
ls /Users/ollorin/get-shit-done/bin/
cat /Users/ollorin/get-shit-done/package.json | grep -E '"install|"deploy|"build'
```

**Step 2: Run install to deploy agents**

```bash
cd /Users/ollorin/get-shit-done
# Run whatever the install command is, e.g.:
node bin/install.js
# or: npm run install
# or: ./bin/install.sh
```

**Step 3: Verify deployed copies match source**

```bash
diff /Users/ollorin/get-shit-done/agents/gsd-roadmapper.md ~/.claude/agents/gsd-roadmapper.md
diff /Users/ollorin/get-shit-done/agents/gsd-planner.md ~/.claude/agents/gsd-planner.md
```

Both diffs should be empty (or show only expected differences if install transforms content).

**Step 4: Spot-check installed prd.md**

```bash
grep -n "API tests\|Charlotte QA\|Test AC generation" ~/.claude/get-shit-done/workflows/prd.md
```

Should show the new lines from Task 1.

**Step 5: Confirm and final commit if needed**

If install produces any derived files that need committing:
```bash
cd /Users/ollorin/get-shit-done
git status
git add <any generated files>
git commit -m "chore: deploy testing mandate to installed copies

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verification

After all tasks complete, verify the full pipeline is correct:

1. `grep -n "API tests\|Charlotte QA\|Test AC generation" ~/.claude/get-shit-done/workflows/prd.md` — shows 3+ hits
2. `grep -n "testing_mandate\|Testing Success Criteria\|No Testing Deferral" /Users/ollorin/get-shit-done/agents/gsd-roadmapper.md` — shows 3+ hits
3. `grep -n "validate_testing_gate\|PLAN REJECTED\|TESTING GATE FAILED" /Users/ollorin/get-shit-done/agents/gsd-planner.md` — shows 3+ hits
4. `git log --oneline -5` — shows 3 commits from this work
