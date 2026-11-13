<purpose>
Create executable phase prompts (PLAN.md files) for a roadmap phase with integrated research and verification. Default flow: Research (if needed) -> Plan -> Verify -> Done. Orchestrates gsd-phase-researcher, gsd-planner, and gsd-plan-checker agents with a capped revision loop (`references/rigour.md`).
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.

@~/.claude/get-shit-done/references/ui-brand.md
</required_reading>

<process>

## 1. Initialize

Load all context in one call (paths only to minimize orchestrator context):

```bash
LEGACY_FLAG=""
if [[ " $ARGUMENTS " == *" --legacy "* ]]; then LEGACY_FLAG="--legacy"; fi
AUTO_FLAG=""
if [[ " $ARGUMENTS " == *" --auto "* ]]; then AUTO_FLAG="--auto"; fi
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init plan-phase "$PHASE" $LEGACY_FLAG $AUTO_FLAG)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

If the command exits 1 and INIT has `error: project_context_missing`: stop, print its `missing` list and `hint`. Do not continue without the brief and profile. An unattended run on a project without a brief exports `GSD_LEGACY=1` before the first command; the flag alone does not reach spawned agents: when `LEGACY_FLAG` is set, put `legacy: true` in every spawned agent's prompt (they pass `--legacy` to their own init call).

**Auto mode:** `auto_mode` (init) is the one rule for "no human is answering"; `references/auto-mode.md` defines it and the prompt classes K1-K6. When it is true, AskUserQuestion is never called and nothing waits for a reply: each prompt below takes its class action and logs an `auto_decision` event. Put `auto: true` in every spawned agent's prompt (they pass `--auto` to their own init call; an exported variable may not reach them).

Parse JSON for: `auto_mode`, `researcher_model`, `planner_model`, `checker_model`, `executor_model`, `ruling_model`, `ruling_model_fallback`, `utility_model`, `research_enabled`, `plan_checker_enabled`, `nyquist_validation_enabled`, `commit_docs`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `has_research`, `has_context`, `has_plans`, `plan_count`, `planning_exists`, `roadmap_exists`, `phase_req_ids`, `brief_path`, `stack_profile_path`, `stack_commands`. Every spawned agent receives `brief_path` and `stack_profile_path` (when not null) in its `<files_to_read>`, and `stack_commands` verbatim.

**Rigour and budget (print first):** init also returns the rigour fields and `phase_req_ids`. `references/rigour.md` is the contract (levels, risk-domain add-ons, caps, budget). Before anything else print its first line (`Phase {N}: rigour ..., risk domains: ..., budget ...`). Pass `rigour`, the spike roots, the risk domains and the remaining budget in every spawn prompt and log each dispatch as `phase_spend`. On a breach return `status: blocked`, `reason: budget_exceeded` with the owner report.

**Spike branches (`rigour` is `spike`):** step 5: one research agent at most; steps 5.5 and 5.6 are skipped. Step 8: `planner_model`; at most 2 plans, all `wave: 1`, each task naming its question and capture file. Step 8b: always the light path, once. Step 9.5: `TRIAGE_MODE=checker` always, and a `rigour_violation` in an `assess-risk` result stops plan-phase with the offending paths before step 10. Step 10: `checker_model`, one round, Dimensions 1-7, 12 and 15. Step 12: one planner revision for blockers, no re-check.

**Risk-domain add-ons (`standard` only):** a phase with a `**Risk domains**` ROADMAP line plans on `ruling_model` (step 8); the plans `assess-risk` marks `high_risk` in step 9.5 get round 1 of the check on `ruling_model` with the adversarial pass. Nothing else in the phase changes.

**Which round cap governs what:** step 12 caps only the plan-check loop; the implementation review loop has its own cap in `references/rigour.md` and is run by execute-phase.

**File paths (for <files_to_read> blocks):** `state_path`, `roadmap_path`, `requirements_path`, `context_path`, `research_path`, `verification_path`, `uat_path`. These are null if files don't exist.

**If `planning_exists` is false:** Error — run `/gsd:new-project` first.

## 2. Parse and Normalize Arguments

Extract from $ARGUMENTS: phase number (integer or decimal like `2.1`), flags (`--research`, `--skip-research`, `--gaps`, `--skip-verify`, `--auto`, `--no-advance`, `--prd <filepath>`). `--no-advance` makes step 14 return the planning status instead of launching execute-phase (a caller that drives execution itself, such as the phase coordinator, passes it).

Extract `--prd <filepath>` from $ARGUMENTS. If present, set PRD_FILE to the filepath.

**If no phase number:** Detect next unplanned phase from roadmap.

**If `phase_found` is false:** Validate phase exists in ROADMAP.md. If valid, create the directory using `phase_slug` and `padded_phase` from init (derived from the ROADMAP header; `phase_dir_target` is the same path):
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

Auto (auto_mode, references/auto-mode.md K2): when `auto_mode` is true do not ask. Proceed with research + requirements only and record `Planned without CONTEXT.md (auto mode)` in the first plan's `<context>` section and in `{PHASE_DIR}/{N}-PLAN-CHECK.md` when one is written.

Otherwise use AskUserQuestion:
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
  Auto (auto_mode, references/auto-mode.md K2): skip research and continue with requirements only; record `research: skipped (blocked)` in `{PHASE_DIR}/{N}-PLAN-CHECK.md` when one is written.

## 5.5. Create Validation Strategy

Skip when `nyquist_validation_enabled` is false, when `rigour` is `spike`, or when RESEARCH.md has no `## Validation Architecture` section (the grep below prints nothing): a validation strategy nobody wrote is not invented here.

```bash
grep -l "## Validation Architecture" "${PHASE_DIR}"/*-RESEARCH.md 2>/dev/null
```

**If found:**
1. Read template: `~/.claude/get-shit-done/templates/VALIDATION.md`
2. Write to `${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md` (use Write tool)
3. Fill frontmatter: `{N}` → phase number, `{phase-slug}` → slug, `{date}` → current date
   Fill the template body too: this orchestrator (not the planner or the researcher) copies each row from the RESEARCH.md `## Validation Architecture` section into the matching template table, and replaces any placeholder left over with `TBD`. Do not spawn an agent for it.
4. Verify:
```bash
test -f "${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md" && echo "VALIDATION_CREATED=true" || echo "VALIDATION_CREATED=false"
```
5. If `VALIDATION_CREATED=false`: STOP — do not proceed to Step 6
6. If `commit_docs`: `commit-docs "docs(phase-${PHASE}): add validation strategy"`

**If not found:** continue without the file.

## 5.6. Generate E2E Test Cases (Web Projects)

**Trigger:** Phase goal mentions UI, frontend, page, component, form, or modal — OR PLAN.md modifies `.tsx`/`.jsx` files.

**Skip if:** No web framework detected in project.

**Process:**
1. Read RESEARCH.md to understand what UI will be built/changed
2. Spawn gsd-ui-inventory (`{utility_model}`) focused on the affected modules (not full app scan)
3. Spawn gsd-e2e-test-generator (`{utility_model}`) with:
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
Auto (auto_mode, references/auto-mode.md K2): take 2, use the existing plans as they are and continue to step 10; never replan from scratch. The one exception is deterministic (CLI-7): init reports `plans_stale: true` (the plans' `plan_stamp` no longer matches the phase inputs, `references/rigour.md` rule 9); then re-plan in revision mode with `stale_reason` as the issue.

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

Skip if step 5.5 was skipped (same three conditions).

```bash
VALIDATION_EXISTS=$(ls "${PHASE_DIR}"/*-VALIDATION.md 2>/dev/null | head -1)
```

If missing and Nyquist enabled — ask the user (Auto (auto_mode, references/auto-mode.md K2): take option 3, continue anyway, and record `nyquist: skipped (auto mode)` in `{PHASE_DIR}/{N}-PLAN-CHECK.md` when one is written):
1. Re-run: `/gsd:plan-phase {PHASE} --research`
2. Disable Nyquist in config
3. Continue anyway (plans fail Dimension 9)

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

**Model rule:** every spawn passes `model` explicitly, always an init field: planner `planner_model` (`ruling_model` for a risk-domain phase); plan-checker `checker_model` (`ruling_model` for round 1 with the adversarial pass); rulings `ruling_model`; executor and test-writer `executor_model`. The dispatch also carries `plan_stamp` (`gsd-tools plan stamp {N} --raw`, CLI-7; until it lands pass an empty value), which the planner copies into every PLAN frontmatter.

A risk-domain path is any path the product brief lists under Risk Domains (`risk_domains` in the init output); authentication/authorisation and security are always risk domains. When `risk_domains_source` is `builtin` (`project.risk_domains` in config.json is empty or absent), every path that mutates state is a risk-domain path. Tag every behaviour on a risk-domain path T0 (real-DB, mutation-proven).

```
Agent(
  prompt=filled_prompt,
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Plan Phase {phase}"
)
```

## 8b. Light path for trivial gap closure

When `--gaps` and the gap list holds at most 4 small, independent fixes (each a few lines in one or two files, no new module, none on a risk-domain path): spawn the planner for ONE plan covering all of them, skip the plan-checker round (step 10), and hand it straight to execute-phase `--gaps-only` (executor, then verifier). Anything larger, or touching a data schema, takes the full path. Record `light gap path: {n} fixes, no checker round` in the plan's `<objective>`.

## 9. Handle Planner Return

**Parse the machine-readable status FIRST — do not string-match the prose header.** Every planner return ends with a fenced ```json trailer carrying `{"status": "planning_complete"|"gap_closure_complete"|"plan_rejected"|"checkpoint"|"revision_complete", ...}`. Extract the last fenced JSON block and read `.status`; the `## …` header is human-readable garnish that a reworded line or an em-dash could break. Route on `.status`:

- **`planning_complete` / `gap_closure_complete`** (a bare `complete` with `plans` > 0 is the same outcome: treat it as `gap_closure_complete` under `--gaps`, else `planning_complete`; the header `## PLANNING COMPLETE` / `## GAP CLOSURE PLANS CREATED`): Display plan count. If `--skip-verify` or `plan_checker_enabled` is false (from init): skip to step 13. Otherwise: step 10.
- **`checkpoint`** (header `## CHECKPOINT REACHED`): Present to user, get response, spawn continuation (step 12).
  Auto (auto_mode, references/auto-mode.md K5): do not present; spawn the planner once more with the checkpoint's recommended default, and if it checkpoints again return `status: failed` with the checkpoint text.
- **`plan_rejected`** (header `## PLAN REJECTED — TESTING GATE FAILED`): Show the failing plan count, offer: Add context / Retry / Manual (same handling as an inconclusive return).
  Auto (auto_mode, references/auto-mode.md K5): retry the planner once, then return `status: failed` naming the failing plan count.

**Malformed/absent return (mirror of execute-phase.md's executor-trailer fallback):** If `Agent()` threw, OR there is NO parseable JSON status trailer AND no recognizable `##` header, do NOT improvise the plan outcome. Retry the planner `Agent()` call once. If the retry is still unrecognized, surface the raw output to the user with retry/abort options — never silently proceed as if planning succeeded. Auto (auto_mode, references/auto-mode.md K5): after the one retry return `status: failed` with the raw output.

## 9.4. Plan size (deterministic, no agent)

```bash
for PLAN_FILE in "${PHASE_DIR}"/*-PLAN.md; do printf '%s lines=%s tasks=%s\n' "$PLAN_FILE" "$(wc -l < "$PLAN_FILE")" "$(grep -c '<task' "$PLAN_FILE")"; done
```

Compare with the caps of `references/rigour.md` (tasks and lines per plan; a plan count over the cap is a warning that the phase is too big). A plan over a cap goes back to the planner once (step 12's revision spawn, issue `plan {id}: {lines} lines / {tasks} tasks, cap {L} / {T}: split it`), before any checker is spawned. Still over after that one revision: continue and list it as an unresolved warning.

## 9.5. Risk Triage (Adversarial Review, MILE-39)

**Skip if:** `plan_checker_enabled` is false or `--skip-verify` was passed (step 9 already routes past verification entirely in these cases — this triage only matters when a checker-equivalent step is about to run).

For each `*-PLAN.md` file in `${PHASE_DIR}`:

```bash
for PLAN_FILE in "${PHASE_DIR}"/*-PLAN.md; do
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" quality assess-risk "$PLAN_FILE" --raw
done
```

Parse each result: `{ high_risk, reasons, matched, presentation_order }` (`matched` lists `{domain, path, token}`; compare it with the planner's own `high_risk` flag and report a mismatch to the checker). An errored assessment (`{ error: true, ... }` on a missing/malformed file) already carries `high_risk: true`: it fails closed into the adversarial pass, and one bad file never aborts the loop. Collect into `RISK_RESULTS` keyed by plan id.

**If ANY plan's `high_risk` is `true`:** set `TRIAGE_MODE=adversarial` and `HIGH_RISK_PLANS` to those plan ids. Step 10 still spawns one `gsd-plan-checker` for the phase, with its adversarial pass enabled.

**If NO plan is high-risk:** set `TRIAGE_MODE=checker`; Step 10 runs the plain checker.

## 10. Spawn gsd-plan-checker Agent

**Spawn (both `TRIAGE_MODE` values):**

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

**Append to `checker_prompt` before spawning** (the checker spawn block itself is
byte-identical to its plain form and must stay that way — add this as a trailing section,
never by editing the block above):

```
<expected_output>
- ## VERIFICATION PASSED — all checks pass
- ## ISSUES FOUND — structured issue list
- ## Defect Classes — in BOTH returns
</expected_output>

## Defect Classes

One row per defect-class insight your check surfaced — including "the plan asks for X but the
existing code does the opposite" findings, not only outright issues. The phase coordinator pastes
these verbatim into the related plan's SUMMARY.md, and the milestone-end rules distillation reads
nothing else.

| class | instance | caught_by | severity | rule_gap |
|---|---|---|---|---|
| [general class name] | [path/file.ext:line] | plan-check | [critical\|major\|minor] | [rule that should have prevented it, or "none — new rule needed"] |

`class` is a general reusable name, not an incident story. Return exactly `None found. (reviewed by: plan-check)` if your check surfaced nothing — a bare `None found.` fails the phase gate, and the block is never omitted.
```

**If `TRIAGE_MODE` is `adversarial`:** also append to `checker_prompt`: `Adversarial pass: enabled for plans {HIGH_RISK_PLANS}; write {PHASE_DIR}/{plan_id}-VERDICT.md for each.` and spawn with `model="{ruling_model}"` (never `checker_model`); if that spawn is rejected for availability, retry it once with `model="{ruling_model_fallback}"` and say so. Before EVERY such spawn (including each revision iteration), delete the old verdicts: `rm -f {PHASE_DIR}/{plan_id}-VERDICT.md` for each id in `HIGH_RISK_PLANS`. The checker's Defect Classes rows go to `{PHASE_DIR}/{N}-PLAN-CHECK.md` in Step 11; each VERDICT.md carries its own.

## 11. Handle Checker Return

**Persist the round (on BOTH `TRIAGE_MODE` branches, before routing).** One file per phase, appended and committed path-scoped on every round, so a resumed run knows what was already found. Keep the `git add`: the file is created fresh by the `printf`, and on an untracked path `git commit -- <file>` **exit 1**s and commits nothing.

```bash
F="{PHASE_DIR}/{N}-PLAN-CHECK.md"
[ -f "$F" ] || printf '# Plan check — phase %s\n\n' "{phase_number}" > "$F"
cat >> "$F" <<'EOF'

## Issues (iteration {n})

<every blocker and warning the checker returned, one line each: id, severity, dimension, plan, description>

## Defect Classes (iteration {n})

<the checker's returned block, verbatim, including a `None found. (reviewed by: plan-check)` line>
EOF
git add -- "$F" && git commit -m "docs(phase-{X}): record plan-check round {n}" -- "$F"
```

Readers: the next round (below), the handoff brief (open risks) and the milestone rules distillation, which reads this file directly; nothing is copied from it into a SUMMARY.

**Later rounds are delta rounds.** From iteration 2 on, the checker prompt carries `{PHASE_DIR}/{N}-PLAN-CHECK.md` and `git diff {commit of the previous round} -- {PHASE_DIR}/*-PLAN.md`, and this instruction: `Delta round. For every earlier blocker and warning report fixed, kept or regressed. Then check only the changed lines for new defects. A new finding on unchanged text is a warning, never a blocker, unless it is a secret, a containment violation or a plan that cannot run at all.`

**If `TRIAGE_MODE` is `checker`:**
- **`## VERIFICATION PASSED`:** Display confirmation, proceed to step 13.
- **`## ISSUES FOUND`:** Display issues, check iteration count, proceed to step 12.
- **Malformed/absent return** (Agent() threw, or the return carries neither expected header): do NOT improvise a pass. Retry the `gsd-plan-checker` `Agent()` call once. If the retry still parses as neither `## VERIFICATION PASSED` nor `## ISSUES FOUND`, surface the raw checker output to the user with retry/abort options. Never treat an unparseable checker return as a silent pass. Auto (auto_mode, references/auto-mode.md K5): after the one retry return `status: failed` with the raw output.

**If `TRIAGE_MODE` is `adversarial`:** handle the return exactly as above, then read every `{PHASE_DIR}/{plan_id}-VERDICT.md` for `HIGH_RISK_PLANS`. A VERDICT.md is accepted only if it exists and is newer than its plan (`test {PHASE_DIR}/{plan_id}-VERDICT.md -nt {PHASE_DIR}/{plan_id}-PLAN.md`); a missing or stale one is a malformed return: delete it, re-spawn the checker once. If it is still missing or stale the adversarial pass is unavailable and the plan FAILS CLOSED: do not fall back to the plain checker's pass. Append `adversarial_review: unavailable for {plan_id}: {reason}` to `{PHASE_DIR}/{N}-PLAN-CHECK.md`; the blocker issue returned by the call below (`--require`) enters the revision loop (step 12), and the plan is not approved or executed until a valid verdict exists. Never prompt the user. For each high-risk plan (whatever its verdict), call:
  ```bash
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" quality verdict-to-issues "${PHASE_DIR}/${plan_id}-VERDICT.md" --require --raw
  ```
  Merge the returned `issues` arrays into the checker's `## ISSUES FOUND` list (`{ plan, dimension: "adversarial_review", severity, description, fix_hint }`) and proceed to step 12. All verdicts `approved` (no blocker issue) and `## VERIFICATION PASSED`: proceed to step 13.

## 12. Revision Loop (capped)

Track `iteration_count` (starts at 1 after initial plan + check). `CAP` is the plan-check cap of `references/rigour.md`: 1 for a spike (one revision, no re-check), otherwise 2.

**If iteration_count < CAP** (spike: one revision, then step 13):

Display: `Sending back to planner for revision... (iteration {N}/{CAP})`

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
Fix the listed issues and nothing else: change the fewest lines that close each one.
Do NOT replan from scratch unless issues are fundamental.
Return what changed, per issue id.
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

After the planner returns: re-run Step 9.4 and re-run Step 9.5 (a revision may change which plans are `high_risk`), spawn step 10 again as a delta round (step 11) on `checker_model`, increment iteration_count.

**If iteration_count >= CAP:**

Display: `Plan-check cap reached. {N} issues remain:` + issue list.

- Remaining warnings: log each as an assumption (`decisions add --kind assumption --source plan-check --reversibility cheap --phases {N}`, default = the plan as written) and proceed.
- Remaining blockers: ONE ruling dispatch for all of them (`model="{ruling_model}"`, retry once on `{ruling_model_fallback}`): per blocker `fix: <exact edit>` or `accept: <reason>`. Apply the fixes with one planner revision, do not re-check, and record the ruling (`decisions add --kind decision --source opus-ruling --phases {N}`; the source value is a stored identifier, `references/model-profiles.md`).

Interactive: offer 1) the ruling above, 2) provide guidance and retry, 3) abandon.

Auto (auto_mode, references/auto-mode.md K6): do not ask; take 1, and append to `{PHASE_DIR}/{N}-PLAN-CHECK.md` (committed path-scoped): `OVERRIDE: plan-check cap reached, proceeded in auto mode; ruled: {blocker ids -> fix|accept}; assumed: {A- ids}`. List the same items in the final status. Never proceed silently.

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

**If `--no-advance` is in $ARGUMENTS:** do not launch execute-phase and do not display the auto-advance banner. Print the final status (step 13) and end with a fenced JSON trailer as the last content: `{"status": "planned", "phase": "{N}", "plan_count": {plan count}, "unresolved": [issue ids]}`; use `"status": "failed"` with an `error` field when a step above returned failed. This is the stop condition of a caller that runs execute-phase itself.

**Otherwise, if `--auto` flag present OR `AUTO_CHAIN` is true OR `AUTO_CFG` is true** (chain-advance keeps its own trigger: `mode: yolo` alone does not start chaining):

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
- [ ] Verification passed, or the cap was reached and the ruling / assumptions and the override line are recorded
- [ ] User sees status between agent spawns
- [ ] User knows next steps
</success_criteria>
