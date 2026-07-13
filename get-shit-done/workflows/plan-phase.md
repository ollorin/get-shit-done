<purpose>
Create executable phase prompts (PLAN.md files) for a roadmap phase with integrated research and verification. Default flow: Research (if needed) -> Plan -> Verify -> Done. Orchestrates gsd-phase-researcher, gsd-planner, and gsd-plan-checker agents with a revision loop (max 3 iterations).
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.

@~/.claude/get-shit-done/references/ui-brand.md
</required_reading>

<process>

## 1. Initialize

Load all context in one call (paths only to minimize orchestrator context):

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init plan-phase "$PHASE")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `researcher_model`, `planner_model`, `checker_model`, `research_enabled`, `plan_checker_enabled`, `nyquist_validation_enabled`, `commit_docs`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `has_research`, `has_context`, `has_plans`, `plan_count`, `planning_exists`, `roadmap_exists`, `phase_req_ids`.

**File paths (for <files_to_read> blocks):** `state_path`, `roadmap_path`, `requirements_path`, `context_path`, `research_path`, `verification_path`, `uat_path`. These are null if files don't exist.

**If `planning_exists` is false:** Error — run `/gsd:new-project` first.

## 2. Parse and Normalize Arguments

Extract from $ARGUMENTS: phase number (integer or decimal like `2.1`), flags (`--research`, `--skip-research`, `--gaps`, `--skip-verify`, `--prd <filepath>`).

Extract `--prd <filepath>` from $ARGUMENTS. If present, set PRD_FILE to the filepath.

**If no phase number:** Detect next unplanned phase from roadmap.

**If `phase_found` is false:** Validate phase exists in ROADMAP.md. If valid, create the directory using `phase_slug` and `padded_phase` from init:
```bash
mkdir -p ".planning/phases/${padded_phase}-${phase_slug}"
```

**Existing artifacts from init:** `has_research`, `has_plans`, `plan_count`.

## 3. Validate Phase

```bash
PHASE_INFO=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" roadmap get-phase "${PHASE}")
```

**If `found` is false:** Error with available phases. **If `found` is true:** Extract `phase_number`, `phase_name`, `goal` from JSON.

## 3.5. Handle PRD Express Path

**Skip if:** No `--prd` flag in arguments.

**If `--prd <filepath>` provided:**

1. Read the PRD file:
```bash
PRD_CONTENT=$(cat "$PRD_FILE" 2>/dev/null)
if [ -z "$PRD_CONTENT" ]; then
  echo "Error: PRD file not found: $PRD_FILE"
  exit 1
fi
```

2. Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PRD EXPRESS PATH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Using PRD: {PRD_FILE}
Generating CONTEXT.md from requirements...
```

3. Parse the PRD content and generate CONTEXT.md. The orchestrator should:
   - Extract all requirements, user stories, acceptance criteria, and constraints from the PRD
   - Map each to a locked decision (everything in the PRD is treated as a locked decision)
   - Identify any areas the PRD doesn't cover and mark as "Claude's Discretion"
   - Create CONTEXT.md in the phase directory

4. Write CONTEXT.md:
```markdown
# Phase [X]: [Name] - Context

**Gathered:** [date]
**Status:** Ready for planning
**Source:** PRD Express Path ({PRD_FILE})

<domain>
## Phase Boundary

[Extracted from PRD — what this phase delivers]

</domain>

<decisions>
## Implementation Decisions

{For each requirement/story/criterion in the PRD:}
### [Category derived from content]
- [Requirement as locked decision]

### Claude's Discretion
[Areas not covered by PRD — implementation details, technical choices]

</decisions>

<specifics>
## Specific Ideas

[Any specific references, examples, or concrete requirements from PRD]

</specifics>

<deferred>
## Deferred Ideas

[Items in PRD explicitly marked as future/v2/out-of-scope]
[If none: "None — PRD covers phase scope"]

</deferred>

---

*Phase: XX-name*
*Context gathered: [date] via PRD Express Path*
```

4.5. Write PRD-TRACE.md:

Display progress: `Generating PRD traceability map...`

Parse each requirement/user story/acceptance criterion/constraint from PRD_CONTENT. Assign sequential REQ-IDs starting at PRD-01 in the order they appear in the PRD.

For each requirement found, extract:
- **REQ-ID**: PRD-01, PRD-02, ... (sequential)
- **Requirement**: the requirement text (trimmed to one line if multi-line)
- **Category**: derive from content context (functional | acceptance_criterion | user_story | constraint | nonfunctional)
- **Plan**: TBD (set at generation time — the planner assigns plan numbers later when creating PLAN.md files)
- **Status**: pending

Write to `${phase_dir}/${padded_phase}-PRD-TRACE.md`:
```markdown
---
phase: {padded_phase}-{phase_slug}
source_prd: {PRD_FILE}
generated: {current_date}
---

# PRD Traceability Map

| REQ-ID | Requirement | Category | Plan | Status |
|--------|-------------|----------|------|--------|
| PRD-01 | {requirement text} | {category} | TBD | pending |
| PRD-02 | {requirement text} | {category} | TBD | pending |
```

Set `prd_trace_path="${phase_dir}/${padded_phase}-PRD-TRACE.md"`.

5. Commit (includes both CONTEXT.md and PRD-TRACE.md):
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs(${padded_phase}): generate context and PRD traceability map from PRD" --files "${phase_dir}/${padded_phase}-CONTEXT.md" "${phase_dir}/${padded_phase}-PRD-TRACE.md"
```

6. Set `context_content` to the generated CONTEXT.md content and continue to step 5 (Handle Research).

**Effect:** This completely bypasses step 4 (Load CONTEXT.md) since we just created it. The rest of the workflow (research, planning, verification) proceeds normally with the PRD-derived context.

## 4. Load CONTEXT.md

**Skip if:** PRD express path was used (CONTEXT.md already created in step 3.5).

Check `context_path` from init JSON.

If `context_path` is not null, display: `Using phase context from: ${context_path}`

**If `context_path` is null (no CONTEXT.md exists):**

Use AskUserQuestion:
- header: "No context"
- question: "No CONTEXT.md found for Phase {X}. Plans will use research and requirements only — your design preferences won't be included. Continue or capture context first?"
- options:
  - "Continue without context" — Plan using research + requirements only
  - "Run discuss-phase first" — Capture design decisions before planning

If "Continue without context": Proceed to step 5.
If "Run discuss-phase first": Display `/gsd:discuss-phase {X}` and exit workflow.

## 5. Handle Research

**Skip if:** `--gaps` flag, `--skip-research` flag, or `research_enabled` is false (from init) without `--research` override.

**If `has_research` is true (from init) AND no `--research` flag:** Use existing, skip to step 6.

**If RESEARCH.md missing OR `--research` flag:**

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCHING PHASE {X}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning researcher...
```

### Spawn gsd-phase-researcher

```bash
PHASE_DESC=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" roadmap get-phase "${PHASE}" | jq -r '.section')
```

Research prompt:

```markdown
<objective>
Research how to implement Phase {phase_number}: {phase_name}
Answer: "What do I need to know to PLAN this phase well?"
</objective>

<files_to_read>
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {requirements_path} (Project requirements)
- {state_path} (Project decisions and history)
</files_to_read>

<additional_context>
**Phase description:** {phase_description}
**Phase requirement IDs (MUST address):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — read SKILL.md files, research should account for project skill patterns
</additional_context>

<output>
Write to: {phase_dir}/{phase_num}-RESEARCH.md
</output>
```

```
Agent(
  prompt=research_prompt,
  subagent_type="gsd-phase-researcher",
  model="{researcher_model}",
  description="Research Phase {phase}"
)
```

### Handle Researcher Return

- **`## RESEARCH COMPLETE`:** Display confirmation, continue to step 6
- **`## RESEARCH BLOCKED`:** Display blocker, offer: 1) Provide context, 2) Skip research, 3) Abort

## 5.5. Create Validation Strategy

MANDATORY unless `nyquist_validation_enabled` is false.

```bash
grep -l "## Validation Architecture" "${PHASE_DIR}"/*-RESEARCH.md 2>/dev/null
```

**If found:**
1. Read template: `~/.claude/get-shit-done/templates/VALIDATION.md`
2. Write to `${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md` (use Write tool)
3. Fill frontmatter: `{N}` → phase number, `{phase-slug}` → slug, `{date}` → current date
4. Verify:
```bash
test -f "${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md" && echo "VALIDATION_CREATED=true" || echo "VALIDATION_CREATED=false"
```
5. If `VALIDATION_CREATED=false`: STOP — do not proceed to Step 6
6. If `commit_docs`: `commit-docs "docs(phase-${PHASE}): add validation strategy"`

**If not found:** Warn and continue — plans may fail Dimension 8.

## 5.6. Generate E2E Test Cases (Web Projects)

**Trigger:** Phase goal mentions UI, frontend, page, component, form, or modal — OR PLAN.md modifies `.tsx`/`.jsx` files.

**Skip if:** No web framework detected in project.

**Process:**
1. Read RESEARCH.md to understand what UI will be built/changed
2. Spawn gsd-ui-inventory (haiku) focused on the affected modules (not full app scan)
3. Spawn gsd-e2e-test-generator (sonnet) with:
   - Focused UI inventory
   - Phase requirements
   - Existing test coverage for affected areas
4. Generator produces `{phase_dir}/E2E-TEST-PLAN.md` with:
   - Test cases for new/changed UI
   - Acceptance criteria that phase executor must satisfy
   - Tags for generated tests
5. Planner receives E2E-TEST-PLAN.md and incorporates test tasks into PLAN.md

**Hard rule:** If phase creates/modifies UI pages and E2E-TEST-PLAN.md is empty or missing, planning is incomplete. The planner must include e2e test scenario creation as explicit tasks.

**Output:** `{phase_dir}/E2E-TEST-PLAN.md` — consumed by executor and verifier.

## 6. Check Existing Plans

```bash
ls "${PHASE_DIR}"/*-PLAN.md 2>/dev/null
```

**If exists:** Offer: 1) Add more plans, 2) View existing, 3) Replan from scratch.

## 7. Use Context Paths from INIT

Extract from INIT JSON:

```bash
STATE_PATH=$(printf '%s\n' "$INIT" | jq -r '.state_path // empty')
ROADMAP_PATH=$(printf '%s\n' "$INIT" | jq -r '.roadmap_path // empty')
REQUIREMENTS_PATH=$(printf '%s\n' "$INIT" | jq -r '.requirements_path // empty')
RESEARCH_PATH=$(printf '%s\n' "$INIT" | jq -r '.research_path // empty')
VERIFICATION_PATH=$(printf '%s\n' "$INIT" | jq -r '.verification_path // empty')
UAT_PATH=$(printf '%s\n' "$INIT" | jq -r '.uat_path // empty')
CONTEXT_PATH=$(printf '%s\n' "$INIT" | jq -r '.context_path // empty')
```

## 7.5. Verify Nyquist Artifacts

Skip if `nyquist_validation_enabled` is false.

```bash
VALIDATION_EXISTS=$(ls "${PHASE_DIR}"/*-VALIDATION.md 2>/dev/null | head -1)
```

If missing and Nyquist enabled — ask user:
1. Re-run: `/gsd:plan-phase {PHASE} --research`
2. Disable Nyquist in config
3. Continue anyway (plans fail Dimension 8)

Proceed to Step 8 only if user selects 2 or 3.

## 8. Spawn gsd-planner Agent

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PLANNING PHASE {X}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning planner...
```

Planner prompt:

```markdown
<planning_context>
**Phase:** {phase_number}
**Mode:** {standard | gap_closure}

<files_to_read>
- {state_path} (Project State)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {research_path} (Technical Research)
- {verification_path} (Verification Gaps - if --gaps)
- {uat_path} (UAT Gaps - if --gaps)
</files_to_read>

**Phase requirement IDs (every ID MUST appear in a plan's `requirements` field):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — read SKILL.md files, plans should account for project skill rules
</planning_context>

<downstream_consumer>
Output consumed by /gsd:execute-phase. Plans need:
- Frontmatter (wave, depends_on, files_modified, autonomous)
- Tasks in XML format
- Verification criteria
- must_haves for goal-backward verification
</downstream_consumer>

<quality_gate>
- [ ] PLAN.md files created in phase directory
- [ ] Each plan has valid frontmatter
- [ ] Tasks are specific and actionable
- [ ] Dependencies correctly identified
- [ ] Waves assigned for parallel execution
- [ ] must_haves derived from phase goal
</quality_gate>
```

```
Agent(
  prompt=filled_prompt,
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Plan Phase {phase}"
)
```

## 9. Handle Planner Return

- **`## PLANNING COMPLETE`:** Display plan count. If `--skip-verify` or `plan_checker_enabled` is false (from init): skip to step 13. Otherwise: step 10.
- **`## CHECKPOINT REACHED`:** Present to user, get response, spawn continuation (step 12)
- **`## PLANNING INCONCLUSIVE`:** Show attempts, offer: Add context / Retry / Manual

## 9.5. Risk Triage (Adversarial Review, MILE-39)

**Skip if:** `plan_checker_enabled` is false or `--skip-verify` was passed (step 9 already routes past verification entirely in these cases — this triage only matters when a checker-equivalent step is about to run).

For each `*-PLAN.md` file in `${PHASE_DIR}`:

```bash
for PLAN_FILE in "${PHASE_DIR}"/*-PLAN.md; do
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" quality assess-risk "$PLAN_FILE" --raw
done
```

Parse each result: `{ high_risk, reasons, presentation_order }` (or `{ error: true, ... }` on a missing/malformed file — treat an errored assessment as `high_risk: false` for that plan, never let one bad file abort the loop). Collect into `RISK_RESULTS` keyed by plan id.

**If ANY plan's `high_risk` is `true`:** set `TRIAGE_MODE=trio`. Step 10 spawns the attacker → defender → judge trio once per plan file, for EVERY plan in the phase (not only the high-risk ones — `gsd-plan-checker` reviews a phase's plans as one cross-plan pass, so this phase's locked design replaces it wholesale for the phase rather than splitting coverage between two partial paths).

**If NO plan is high-risk (including when `quality assess-risk` errored for every plan — fail toward the pre-existing, safer path):** set `TRIAGE_MODE=checker`. Step 10 runs EXACTLY as it did before Phase 60 — byte-identical.

## 10. Spawn gsd-plan-checker Agent (or Adversarial Review Trio, MILE-39)

**If `TRIAGE_MODE` is `checker`** (the default — no high-risk plan in this phase, or Step 9.5 could not run):

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► VERIFYING PLANS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning plan checker...
```

Checker prompt:

```markdown
<verification_context>
**Phase:** {phase_number}
**Phase Goal:** {goal from ROADMAP}

<files_to_read>
- {PHASE_DIR}/*-PLAN.md (Plans to verify)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
- {research_path} (Technical Research — includes Validation Architecture)
</files_to_read>

**Phase requirement IDs (MUST ALL be covered):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — verify plans honor project guidelines
**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — verify plans account for project skill rules
</verification_context>

<expected_output>
- ## VERIFICATION PASSED — all checks pass
- ## ISSUES FOUND — structured issue list
</expected_output>
```

```
Agent(
  prompt=checker_prompt,
  subagent_type="gsd-plan-checker",
  model="{checker_model}",
  description="Verify Phase {phase} plans"
)
```

**If `TRIAGE_MODE` is `trio`** (one or more plans flagged high-risk by Step 9.5):

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► ADVERSARIAL PLAN REVIEW (MILE-39)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ High-risk plan(s) detected. Spawning attacker → defender → judge trio, once per plan...
```

For EACH `*-PLAN.md` file in the phase directory (the whole phase takes the trio path, per Step 9.5):

1. **Spawn `gsd-plan-attacker`:**
```
Agent(
  prompt=attacker_prompt (plan_content={this plan's full text}, phase_goal={goal from ROADMAP}, context_content={CONTEXT.md if present}, research_content={RESEARCH.md if present}),
  subagent_type="gsd-plan-attacker",
  model="{checker_model}",
  description="Attack Plan {plan_id}"
)
```
Expect `## ATTACK COMPLETE` with a structured `flaws:` list.

2. **Spawn `gsd-plan-defender`**, passing this plan's flaws:
```
Agent(
  prompt=defender_prompt (plan_content={same plan text}, attacker_flaws={flaws from step 1}, context_content, research_content),
  subagent_type="gsd-plan-defender",
  model="{checker_model}",
  description="Defend Plan {plan_id}"
)
```
Expect `## DEFENSE COMPLETE` with a structured `rebuttals:` list.

3. **Spawn `gsd-plan-judge`**, passing this plan's flaws AND rebuttals, ordered per `RISK_RESULTS[plan_id].presentation_order`:
```
Agent(
  prompt=judge_prompt (plan_content, plan_id, phase_dir={PHASE_DIR}, attacker_flaws, defender_rebuttals, presentation_order={RISK_RESULTS[plan_id].presentation_order}),
  subagent_type="gsd-plan-judge",
  model="{checker_model}",
  description="Judge Plan {plan_id}"
)
```
The judge WRITES `{PHASE_DIR}/{plan_id}-VERDICT.md` itself and returns `## JUDGMENT COMPLETE` with the overall `verdict`.

**Fail-open (mandatory, house-style):** If ANY of the 3 agents above errors, times out, or returns output missing its required structured section for ANY plan in this loop: display a loud warning:
```
⚠ Adversarial review trio failed for plan {plan_id}: {reason}. Falling back to standard gsd-plan-checker for the entire phase.
```
Discard any partial trio results already produced this pass, set `TRIAGE_MODE=checker`, and immediately re-run this step's `checker` branch above for the WHOLE phase (byte-identical single-checker spawn) — never block planning on a broken new feature.

After all trio passes complete successfully with no fallback triggered (or after the checker branch returns): proceed to step 11.

## 11. Handle Checker Return

**If `TRIAGE_MODE` is `checker`:**
- **`## VERIFICATION PASSED`:** Display confirmation, proceed to step 13.
- **`## ISSUES FOUND`:** Display issues, check iteration count, proceed to step 12.

**If `TRIAGE_MODE` is `trio`:**
- Read every `{PHASE_DIR}/{plan_id}-VERDICT.md` written in step 10.
- **If ALL verdicts are `approved`:** treat identically to `## VERIFICATION PASSED` above — proceed to step 13.
- **If ANY verdict is `revise` or `critical`:** for EACH such plan, call:
  ```bash
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" quality verdict-to-issues "${PHASE_DIR}/${plan_id}-VERDICT.md" --raw
  ```
  Merge every returned `issues` array into one combined `structured_issues_from_checker` list — the SAME shape `gsd-plan-checker`'s `## ISSUES FOUND` already produces (`{ plan, dimension: "adversarial_review", severity, description, fix_hint }`). Display the merged issues, then proceed to step 12 with this merged list exactly as the single-checker path would.

## 12. Revision Loop (Max 3 Iterations)

Track `iteration_count` (starts at 1 after initial plan + check).

**If iteration_count < 3:**

Display: `Sending back to planner for revision... (iteration {N}/3)`

Revision prompt:

```markdown
<revision_context>
**Phase:** {phase_number}
**Mode:** revision

<files_to_read>
- {PHASE_DIR}/*-PLAN.md (Existing plans)
- {context_path} (USER DECISIONS from /gsd:discuss-phase)
</files_to_read>

**Checker issues:** {structured_issues_from_checker}
</revision_context>

<instructions>
Make targeted updates to address checker issues.
Do NOT replan from scratch unless issues are fundamental.
Return what changed.
</instructions>
```

```
Agent(
  prompt=revision_prompt,
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Revise Phase {phase} plans"
)
```

After planner returns -> re-run Step 9.5's risk triage (a revision may have shrunk `files_modified` below `adversarial_review_file_threshold` or removed the `high_risk` flag, changing which path Step 10 takes) -> spawn step 10 again (checker or trio, per the fresh triage result), increment iteration_count.

**If iteration_count >= 3:**

Display: `Max iterations reached. {N} issues remain:` + issue list

Offer: 1) Force proceed, 2) Provide guidance and retry, 3) Abandon

## 13. Present Final Status

Route to `<offer_next>` OR `auto_advance` depending on flags/config.

## 14. Auto-Advance Check

Check for auto-advance trigger:

1. Parse `--auto` flag from $ARGUMENTS
2. **Sync chain flag with intent** — if user invoked manually (no `--auto`), clear the ephemeral chain flag from any previous interrupted `--auto` chain. This does NOT touch `workflow.auto_advance` (the user's persistent settings preference):
   ```bash
   if [[ ! "$ARGUMENTS" =~ --auto ]]; then
     node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set workflow._auto_chain_active false 2>/dev/null
   fi
   ```
3. Read both the chain flag and user preference:
   ```bash
   AUTO_CHAIN=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get workflow._auto_chain_active --raw --default false)
   AUTO_CFG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get workflow.auto_advance --raw --default false)
   ```

**If `--auto` flag present OR `AUTO_CHAIN` is true OR `AUTO_CFG` is true:**

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► AUTO-ADVANCING TO EXECUTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Plans ready. Launching execute-phase...
```

Launch execute-phase using the Skill tool to avoid nested Task sessions (which cause runtime freezes due to deep agent nesting):
```
Skill(skill="gsd:execute-phase", args="${PHASE} --auto --no-transition")
```

The `--no-transition` flag tells execute-phase to return status after verification instead of chaining further. This keeps the auto-advance chain flat — each phase runs at the same nesting level rather than spawning deeper Task agents.

**Handle execute-phase return:**
- **PHASE COMPLETE** → Display final summary:
  ```
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GSD ► PHASE ${PHASE} COMPLETE ✓
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Auto-advance pipeline finished.

  Next: /gsd:discuss-phase ${NEXT_PHASE} --auto
  ```
- **GAPS FOUND / VERIFICATION FAILED** → Display result, stop chain:
  ```
  Auto-advance stopped: Execution needs review.

  Review the output above and continue manually:
  /gsd:execute-phase ${PHASE}
  ```

**If neither `--auto` nor config enabled:**
Route to `<offer_next>` (existing behavior).

</process>

<offer_next>
Output this markdown directly (not as a code block):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PHASE {X} PLANNED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {X}: {Name}** — {N} plan(s) in {M} wave(s)

| Wave | Plans | What it builds |
|------|-------|----------------|
| 1    | 01, 02 | [objectives] |
| 2    | 03     | [objective]  |

Research: {Completed | Used existing | Skipped}
Verification: {Passed | Passed with override | Skipped}

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Execute Phase {X}** — run all {N} plans

/gsd:execute-phase {X}

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

**Also available:**
- cat .planning/phases/{phase-dir}/*-PLAN.md — review plans
- /gsd:plan-phase {X} --research — re-research first

───────────────────────────────────────────────────────────────
</offer_next>

<success_criteria>
- [ ] .planning/ directory validated
- [ ] Phase validated against roadmap
- [ ] Phase directory created if needed
- [ ] CONTEXT.md loaded early (step 4) and passed to ALL agents
- [ ] Research completed (unless --skip-research or --gaps or exists)
- [ ] gsd-phase-researcher spawned with CONTEXT.md
- [ ] Existing plans checked
- [ ] gsd-planner spawned with CONTEXT.md + RESEARCH.md
- [ ] Plans created (PLANNING COMPLETE or CHECKPOINT handled)
- [ ] gsd-plan-checker spawned with CONTEXT.md
- [ ] Verification passed OR user override OR max iterations with user decision
- [ ] User sees status between agent spawns
- [ ] User knows next steps
</success_criteria>
