<purpose>

Start a new milestone cycle for an existing project. Loads project context, gathers milestone goals (from MILESTONE-CONTEXT.md or conversation), updates PROJECT.md and STATE.md, optionally runs parallel research, defines scoped requirements with REQ-IDs, spawns the roadmapper to create phased execution plan, and commits all artifacts. Brownfield equivalent of new-project.

</purpose>

<required_reading>

Read all files referenced by the invoking prompt's execution_context before starting.

</required_reading>

<process>

## Auto mode (read first)

```bash
INIT0=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init new-milestone $ARGUMENTS)
if [[ "$INIT0" == @file:* ]]; then INIT0=$(cat "${INIT0#@file:}"); fi
```

`auto_mode` in `INIT0` is the single switch (`@~/.claude/get-shit-done/references/auto-mode.md`). When it is true, no question is asked and nothing waits for a reply; every prompt below carries its `Auto (auto_mode, ...)` line. **Input contract:** an auto run needs one of (a) `--auto @goals.md` (the goals document), (b) `.planning/MILESTONE-CONTEXT.md`, or (c) exactly one pending PRD with `<!-- stage: complete -->` and an `<!-- approval: ... -->` line. With none of them stop before any write and say which input is missing:

Auto (auto_mode, references/auto-mode.md K3): no goals document, context file or approved complete PRD means stop before writing anything and name the missing input.

**Owner gates (the only two stops in an auto run).** Two gates stay mandatory in full auto mode (`references/auto-mode.md`, Owner gates): OG1 the milestone's composition (which PRDs and requirements) and OG2 the roadmap. At each, request the gate, print the owner summary and END the run in state `waiting_owner_approval`; never ask, never loop. On every auto invocation read `owner-gate status` first and route:

| Gate record for this milestone | Continue at |
|---|---|
| none, or `composition` rejected | the normal path (a rejected gate: redraft step 9 with the owner's note, then request it again) |
| `composition` pending | stop again, `waiting_owner_approval`, print the same summary |
| `composition` approved, no `roadmap` gate or `roadmap` rejected | step 10 (a rejected gate: re-spawn the roadmapper with the owner's note) |
| `roadmap` pending | stop again, `waiting_owner_approval` |
| `roadmap` approved | step 11 hand-off |

Interactive runs (`auto_mode` false) ignore this section.

## 0. First Milestone After init-project

Applies when `.planning/PROJECT.md` or `.planning/STATE.md` is absent while `.planning/config.json` and `.planning/PRODUCT-BRIEF.md` exist: the project was set up by `/gsd:init-project` (or only holds PRDs) and has never had a milestone. Otherwise skip to step 1.

1. Create `.planning/PROJECT.md` from `@~/.claude/get-shit-done/templates/project.md`, using the brief's Identity and scope, the config's `project` block, and (when present) the PRDs in `.planning/prds/pending/`. Validated requirements are empty (nothing has shipped); Active requirements start as hypotheses, as in new-project step 4 for greenfield.
2. Create `.planning/STATE.md` from `@~/.claude/get-shit-done/templates/state.md`, with Current Position `Phase: Not started (defining requirements)`.
3. There is no MILESTONES.md: step 3 suggests `v1.0`, and step 1 skips that read. Step 4 then adds the Current Milestone section to the new PROJECT.md, and step 5 only updates the new STATE.md.
4. Commit the two files: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: initialize project for first milestone" --files .planning/PROJECT.md .planning/STATE.md`. Then continue with step 1.

## 1. Load Context

- Read PROJECT.md (existing project, validated requirements, decisions)
- Read MILESTONES.md (what shipped previously; absent for a first milestone)
- Read STATE.md (pending todos, blockers)
- Check for MILESTONE-CONTEXT.md (from /gsd:discuss-milestone)

## 1.5. Check for Pending PRDs

Before gathering milestone goals, check for existing pending PRDs in `.planning/prds/pending/`:

```bash
PENDING_PRDS=$(ls .planning/prds/pending/*.md 2>/dev/null)
```

**If PENDING_PRDS is non-empty (PRDs found):**

For each file in PENDING_PRDS, extract:
- `SLUG` — filename without `.md` extension (e.g., `auth-system` from `auth-system.md`)
- `CONCEPT_SUMMARY` — the line starting with `**Concept:**` in the file (e.g., `Auth system for multi-tenant SaaS`)
- `STAGE` — the stage marker at the top of the file (`<!-- stage: complete -->`, `<!-- stage: pm -->`, etc.)
- `STATUS_LABEL` — if STAGE is `<!-- stage: complete -->`: empty string; otherwise: ` (in progress)`

Auto (auto_mode, references/auto-mode.md K2): with exactly one PRD that is `stage: complete` and carries an approval line, select it; with none eligible or more than one, fall back to the goals document or MILESTONE-CONTEXT.md, and when neither exists stop (K3) before any write. Never pick among several PRDs by guessing.

Display a selection prompt using AskUserQuestion:
```
header: "Pending PRDs"
question: "Found {N} pending PRD(s). Select one as the milestone foundation, or enter a goal manually:"
options:
  - "[1] {slug1} — {concept_summary1}{status_label1}"
  - "[2] {slug2} — {concept_summary2}{status_label2}"
  - ... (one per PRD, numbered sequentially)
  - "Enter milestone goal manually"
```

**If user selects a PRD option (selects option 1 through N):**
- Set `SELECTED_PRD_PATH = .planning/prds/pending/{selected_slug}.md`
- Set `SELECTED_PRD_SLUG = {selected_slug}`

**If STAGE of the selected PRD is NOT `<!-- stage: complete -->`:**
Auto (auto_mode, references/auto-mode.md K3): a PRD that is not `stage: complete` is never used in an unattended run; it is not selected, and the run stops (or uses the goals document) instead of continuing anyway.

Ask (plain text, not AskUserQuestion):
```
This PRD is still in progress (stage: {STAGE}). Key sections may be incomplete. Continue anyway? (yes/no)
```
- If user answers **no**: Return to the PRD selection prompt (re-display the options list).
- If user answers **yes**: Proceed.

- Set `PRD_DRIVEN = true`
- Display: "Using PRD: {SELECTED_PRD_SLUG} as milestone foundation."
- If the PRD has no `<!-- approval: ... -->` line: run Step 4 (Approval) of `@~/.claude/get-shit-done/workflows/prd.md` now, before any roadmap work.

Auto (auto_mode, references/auto-mode.md K3): a missing PRD approval is owner content and is never granted by an unattended run; stop before any write and name the PRD.

**If user selects "Enter milestone goal manually":**
- Set `PRD_DRIVEN = false`
- Continue to step 2.

**If PENDING_PRDS is empty (no PRDs found):**
- Set `PRD_DRIVEN = false`
- Skip step 1.5 entirely. Continue to step 2 without showing any PRD UI.

## 2. Gather Milestone Goals

**Skip this step if PRD_DRIVEN=true** — the selected PRD provides goals and scope. Proceed directly to step 3.

**If MILESTONE-CONTEXT.md exists:**
- Use features and scope from discuss-milestone
- Present summary for confirmation

Auto (auto_mode, references/auto-mode.md K1): proceed on the context file's scope without confirming; goals from `--auto @goals.md` are used the same way.

**If no context file:**
- Present what shipped in last milestone
- Auto (auto_mode, references/auto-mode.md K3): take the goals from the `--auto` document; with none, stop before any write (see the input contract).
- Ask inline (freeform, NOT AskUserQuestion): "What do you want to build next?"
- Wait for their response, then use AskUserQuestion to probe specifics
- If user selects "Other" at any point to provide freeform input, ask follow-up as plain text — not another AskUserQuestion

## 3. Determine Milestone Version

- Parse last version from MILESTONES.md
- Suggest next version (v1.0 → v1.1, or v2.0 for major)
- Confirm with user

Auto (auto_mode, references/auto-mode.md K1): take the suggested version (a version named in the goals document wins) without confirming.

## 4. Update PROJECT.md

Add/update:

```markdown
## Current Milestone: v[X.Y] [Name]

**Goal:** [One sentence describing milestone focus]

**Target features:**
- [Feature 1]
- [Feature 2]
- [Feature 3]
```

Update Active requirements section and "Last updated" footer.

## 5. Update STATE.md

Re-Read STATE.md fresh before editing — the read in step 1 predates any research spawn and a concurrent session may have advanced it; apply only the Current Position change to the current contents. **See @~/.claude/get-shit-done/references/shared-file-writes.md.**

```markdown
## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: [today] — Milestone v[X.Y] started
```

Keep Accumulated Context section from previous milestone.

## 6. Cleanup and Commit

Delete MILESTONE-CONTEXT.md if exists (consumed).

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: start milestone v[X.Y] [Name]" --files .planning/PROJECT.md .planning/STATE.md
```

## 7. Load Context and Resolve Models

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init new-milestone)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract from init JSON: `researcher_model`, `synthesizer_model`, `roadmapper_model`, `commit_docs`, `research_enabled`, `current_milestone`, `project_exists`, `roadmap_exists`.

## 8. Research Decision

> **Skip this step if PRD_DRIVEN=true.** The selected PRD already contains research (Tech Candidates from Stage 3 of the PRD workflow); proceed directly to step 9.

Auto (auto_mode, references/auto-mode.md K2): follow `research_enabled` from init (default on) and do not write the choice to config; "Research first" when it is on.

AskUserQuestion: "Research the domain ecosystem for new features before defining requirements?"
- "Research first (Recommended)" — Discover patterns, features, architecture for NEW capabilities
- "Skip research" — Go straight to requirements

**Persist choice to config** (so future `/gsd:plan-phase` honors it):

```bash
# If "Research first": persist true
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set workflow.research true

# If "Skip research": persist false
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set workflow.research false
```

**If "Research first":**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCHING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning 4 researchers in parallel...
  → Stack, Features, Architecture, Pitfalls
```

```bash
mkdir -p .planning/research
```

Spawn 4 parallel gsd-project-researcher agents. Each uses this template with dimension-specific fields:

**Common structure for all 4 researchers:**
```
Agent(prompt="
<research_type>Project Research — {DIMENSION} for [new features].</research_type>

<milestone_context>
SUBSEQUENT MILESTONE — Adding [target features] to existing app.
{EXISTING_CONTEXT}
Focus ONLY on what's needed for the NEW features.
</milestone_context>

<question>{QUESTION}</question>

<files_to_read>
- .planning/PROJECT.md (Project context)
</files_to_read>

<downstream_consumer>{CONSUMER}</downstream_consumer>

<quality_gate>{GATES}</quality_gate>

<output>
Write to: .planning/research/{FILE}
Use template: ~/.claude/get-shit-done/templates/research-project/{FILE}
</output>
", subagent_type="gsd-project-researcher", model="{researcher_model}", description="{DIMENSION} research", run_in_background=true)
```

**Dimension-specific fields:**

| Field | Stack | Features | Architecture | Pitfalls |
|-------|-------|----------|-------------|----------|
| EXISTING_CONTEXT | Existing validated capabilities (DO NOT re-research): [from PROJECT.md] | Existing features (already built): [from PROJECT.md] | Existing architecture: [from PROJECT.md or codebase map] | Focus on common mistakes when ADDING these features to existing system |
| QUESTION | What stack additions/changes are needed for [new features]? | How do [target features] typically work? Expected behavior? | How do [target features] integrate with existing architecture? | Common mistakes when adding [target features] to [domain]? |
| CONSUMER | Specific libraries with versions for NEW capabilities, integration points, what NOT to add | Table stakes vs differentiators vs anti-features, complexity noted, dependencies on existing | Integration points, new components, data flow changes, suggested build order | Warning signs, prevention strategy, which phase should address it |
| GATES | Versions current (verify with Context7), rationale explains WHY, integration considered | Categories clear, complexity noted, dependencies identified | Integration points identified, new vs modified explicit, build order considers deps | Pitfalls specific to adding these features, integration pitfalls covered, prevention actionable |
| FILE | STACK.md | FEATURES.md | ARCHITECTURE.md | PITFALLS.md |

After all 4 complete, spawn synthesizer:

```
Agent(prompt="
Synthesize research outputs into SUMMARY.md.

<files_to_read>
- .planning/research/STACK.md
- .planning/research/FEATURES.md
- .planning/research/ARCHITECTURE.md
- .planning/research/PITFALLS.md
</files_to_read>

Write to: .planning/research/SUMMARY.md
Use template: ~/.claude/get-shit-done/templates/research-project/SUMMARY.md
Commit after writing.
", subagent_type="gsd-research-synthesizer", model="{synthesizer_model}", description="Synthesize research")
```

Display key findings from SUMMARY.md:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► RESEARCH COMPLETE ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Stack additions:** [from SUMMARY.md]
**Feature table stakes:** [from SUMMARY.md]
**Watch Out For:** [from SUMMARY.md]
```

**If "Skip research":** Continue to Step 9.

## 9. Define Requirements

> **Skip this step if PRD_DRIVEN=true.** The roadmapper will generate REQUIREMENTS.md from PRD User Stories in Step 10. Proceed directly to Step 10.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► DEFINING REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Read PROJECT.md: core value, current milestone goals, validated requirements (what exists).

**If research exists:** Read FEATURES.md, extract feature categories.

Present features by category:
```
## [Category 1]
**Table stakes:** Feature A, Feature B
**Differentiators:** Feature C, Feature D
**Research notes:** [any relevant notes]
```

**If no research:** Gather requirements through conversation. Ask: "What are the main things users need to do with [new features]?" Clarify, probe for related capabilities, group into categories.

Auto (auto_mode, references/auto-mode.md K3): scope comes from the goals document, context file or PRD: features it names are in; table stakes it omits are future; differentiators it omits are out of scope. Every scope question the documents leave unanswered becomes an `A-` row (`decisions add --kind assumption ... --default "<d>"`, K6) with the cheapest default; none is asked.

**Scope each category** via AskUserQuestion (multiSelect: true, header max 12 chars):
- "[Feature 1]" — [brief description]
- "[Feature 2]" — [brief description]
- "None for this milestone" — Defer entire category

Track: Selected → this milestone. Unselected table stakes → future. Unselected differentiators → out of scope.

Auto (auto_mode, references/auto-mode.md K3): answer "No, research covered it" and record each gap research found as an `A-` assumption row instead of asking.

**Identify gaps** via AskUserQuestion:
- "No, research covered it" — Proceed
- "Yes, let me add some" — Capture additions

**Generate REQUIREMENTS.md:**
- v1 Requirements grouped by category (checkboxes, REQ-IDs)
- Future Requirements (deferred)
- Out of Scope (explicit exclusions with reasoning)
- Traceability section (empty, filled by roadmap)

**REQ-ID format:** `[CATEGORY]-[NUMBER]` (AUTH-01, NOTIF-02). Continue numbering from existing.

**Requirement quality criteria:**

Good requirements are:
- **Specific and testable:** "User can reset password via email link" (not "Handle password reset")
- **User-centric:** "User can X" (not "System does Y")
- **Atomic:** One capability per requirement (not "User can login and manage profile")
- **Independent:** Minimal dependencies on other requirements

Present FULL requirements list for confirmation:

```
## Milestone v[X.Y] Requirements

### [Category 1]
- [ ] **CAT1-01**: User can do X
- [ ] **CAT1-02**: User can do Y

### [Category 2]
- [ ] **CAT2-01**: User can do Z

Does this capture what you're building? (yes / adjust)
```

If "adjust": Return to scoping.

**Commit requirements:**
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: define milestone v[X.Y] requirements" --files .planning/REQUIREMENTS.md
```

**Rigour proposal (before the gate, no question asked).** Propose `spike` when the goals document or PRD describes the milestone, or named parts of it, as a prototype, spike or feasibility probe whose output is evidence and not product code, and name the spike roots; otherwise propose `standard` (`references/rigour.md`). The proposal is one line of the gate summary, so the owner approves or rejects it with the composition.

**Owner gate OG1 (composition).** Auto (auto_mode, references/auto-mode.md OG1): do not draft the roadmap yet. Request the gate with the composition summary, print it, and end the run `waiting_owner_approval`.

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" owner-gate request --kind composition --milestone v[X.Y] --summary "<PRD slugs or goals source; N requirements by category; out-of-scope list; open A- rows; rigour proposal: standard | spike (roots: <paths>; which parts)>"
```

Owner summary (compact): milestone name and version, the PRDs or goals document it is built from, the requirement count per category, what is out of scope, the open `A-` assumptions with their defaults, and the rigour proposal with its one-line reason. The owner approves with `gsd-tools owner-gate approve --kind composition` and re-runs `/gsd:new-milestone --auto`.

## 10. Create Roadmap

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► CREATING ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning roadmapper...
```

**Starting phase number:** Read MILESTONES.md for last phase number. Continue from there (v1.0 ended at phase 5 → v1.1 starts at phase 6).

**If PRD_DRIVEN=true:** Read the full content of SELECTED_PRD_PATH into variable `PRD_CONTENT`.

**Spawn roadmapper:**

```
Agent(prompt="
<planning_context>
<files_to_read>
- .planning/PROJECT.md
- .planning/REQUIREMENTS.md
- .planning/research/SUMMARY.md (if exists)
- .planning/config.json
- .planning/MILESTONES.md
- .planning/DECISIONS.md (if exists — binding `D-`/`A-` records, see your <decision_points> section)
</files_to_read>
</planning_context>

{IF PRD_DRIVEN=true: INSERT THIS BLOCK}
<prd_source>
<prd_slug>{SELECTED_PRD_SLUG}</prd_slug>
<prd_content>
{PRD_CONTENT}
</prd_content>
<decomposition_mode>prd-driven</decomposition_mode>
</prd_source>
{END IF}

<instructions>
{IF PRD_DRIVEN=true:}
Create roadmap for milestone v[X.Y] from the PRD provided in <prd_source>:
1. Start phase numbering from [N]
2. Generate REQUIREMENTS.md entries from the PRD User Stories (use MILE-XX IDs — MILE-01, MILE-02, etc., starting from 01 or continuing from existing numbering)
3. Derive phases from the generated requirements only — one phase per logical capability cluster
4. Map every MVP User Story to exactly one phase (use PRD MVP Boundary section to exclude Phase 2 items from this milestone)
5. Derive 2-5 success criteria per phase from the PRD Acceptance Criteria
6. Order phases by technical dependency (data/infrastructure before API before UI is typical — adjust for the domain)
7. DO NOT write any files yet — return ROADMAP PREVIEW with the proposed phase structure and generated requirements
8. Format the return as: ## ROADMAP PREVIEW followed by the summary table, phase details and `## Decision Points`

{IF PRD_DRIVEN=false (non-PRD-driven — existing behavior):}
Create roadmap for milestone v[X.Y]:
1. Start phase numbering from [N]
2. Derive phases from THIS MILESTONE's requirements only
3. Map every requirement to exactly one phase
4. Derive 2-5 success criteria per phase (observable user behaviors)
5. Validate 100% coverage
6. Write files immediately (ROADMAP.md, STATE.md, update REQUIREMENTS.md traceability)
7. Return ROADMAP CREATED with summary and `## Decision Points`

Rigour: Auto (auto_mode, references/auto-mode.md K2): take the proposal of the approved `composition` gate; never widen it. `standard`: add no Rigour line. `spike`: pass `OG2` as the authorisation; the roadmap gate requested in step 11 lists every spike phase and its approval is the owner's answer (`references/rigour.md`). Until CLI-2 lands record the composition approval instead (`decisions add --kind decision --source owner-answer --question "Rigour of milestone v[X.Y]" --answer "spike, roots <paths>; owner gate composition@[X.Y] approved <approved_at>"`), pass the returned `D-NN`, and after the return run `decisions map D-NN --phases <the spike phase numbers> --milestone v[X.Y]`. A gate summary with no spike proposal authorises no spike, and an `A-` row never does. Interactive: ask the owner once whether this milestone, or which phases of it, is a throwaway feasibility spike, and record a yes as a `D-` decision the same way. The roadmapper stamps `**Rigour**: spike (<authorisation>)` and `**Spike roots**: <paths>` on every spike phase (its 1-5 spike questions are the success criteria) and `**Risk domains**: <names>` on every `standard` phase that touches one, and returns rigour, risk domains and budget per phase.

Write files first, then return.
</instructions>
", subagent_type="gsd-roadmapper", model="{roadmapper_model}", description="Create roadmap")
```

**Handle return:**

**If `## ROADMAP BLOCKED`:** Present blocker, work with user, re-spawn.

Auto (auto_mode, references/auto-mode.md K5): resolve what the blocker names from the input documents and re-spawn the roadmapper once; a second `## ROADMAP BLOCKED` stops the run (K4), reporting the blocker, with nothing approved.

**If `## ROADMAP CREATED`** (non-PRD-driven): Read ROADMAP.md, present inline per format below, then ask for approval.

**If `## ROADMAP PREVIEW`** (PRD-driven): Display the preview inline, then ask for approval. Files have NOT been written yet.

**Display format (for both ROADMAP CREATED and ROADMAP PREVIEW):**

```
## Proposed Roadmap

**[N] phases** | **[X] requirements mapped** | All covered ✓

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| [N] | [Name] | [Goal] | [REQ-IDs] | [count] |

### Phase Details

**Phase [N]: [Name]**
Goal: [goal]
Requirements: [REQ-IDs]
Success criteria:
1. [criterion]
2. [criterion]
```

**Decision points (before approval).** Follow `Roadmap decision points` in `@~/.claude/get-shit-done/references/decisions-protocol.md` (the roadmapper's `## Decision Points` table); `--source milestone-review` stays as written there. A risk-domain path is any path the product brief lists under Risk Domains (`risk_domains` in the init output); authentication/authorisation and security are always risk domains. When `risk_domains_source` is `builtin` (`project.risk_domains` in config.json is empty or absent), every path that mutates state is a risk-domain path. Tag every behaviour on a risk-domain path T0 (real-DB, mutation-proven).

Auto (auto_mode, references/auto-mode.md K6): after the artifact check (ROADMAP.md has every requirement mapped, decision points routed per the protocol above) approve and continue; open questions are already `A-` rows. "Adjust phases" and "Review full file" are not offered.

**Ask for approval** via AskUserQuestion:
- "Approve" — Commit and continue
- "Adjust phases" — Tell me what to change
- "Review full file" — Show raw roadmap text

**If "Adjust":** Get notes, re-spawn roadmapper with revision context, loop until approved.
**If "Review":** Display full roadmap text, re-ask.

**After approval:**

**If PRD_DRIVEN=true (files not yet written — ROADMAP PREVIEW was shown):**
Re-spawn roadmapper to write files:
```
Agent(prompt="
{same prompt as above, including prd_source block}

<instructions>
The roadmap below has been approved by the user. Write files now:
1. Write ROADMAP.md with the approved phase structure
2. Write REQUIREMENTS.md with the generated MILE-XX requirements and traceability
3. Update STATE.md for new milestone
4. Return ROADMAP CREATED

Approved roadmap:
{ROADMAP PREVIEW text that was displayed to user}
</instructions>
", subagent_type="gsd-roadmapper", model="{roadmapper_model}", description="Write approved roadmap")
```

Wait for ROADMAP CREATED signal before continuing.

**If PRD_DRIVEN=false (files already written by roadmapper):**
Proceed directly to commit step below.

**Commit roadmap and PRD lifecycle (after approval and files written):**

**Confirm the artifact before committing — do NOT commit on the roadmapper's say-so.** Read the
files the agent claims to have written and verify they exist and contain their required sections
(ROADMAP.md: a `## Phases` section with at least one `### Phase`; REQUIREMENTS.md: a traceability
table with MILE-XX → Phase rows). If a required section is missing or the file is empty, do NOT
commit — re-spawn the roadmapper or surface the gap to the user.

**If PRD_DRIVEN=true:**
```bash
mkdir -p .planning/prds/done
if [ -f .planning/prds/done/{SELECTED_PRD_SLUG}.md ] && [ ! -f .planning/prds/pending/{SELECTED_PRD_SLUG}.md ]; then
  echo "PRD already moved to done/ (resuming after an interrupted commit) — skipping move."
elif ! mv .planning/prds/pending/{SELECTED_PRD_SLUG}.md .planning/prds/done/{SELECTED_PRD_SLUG}.md; then
  echo "ERROR: Could not move PRD to done/ — stopping. Resolve manually:"
  echo "  mv .planning/prds/pending/{SELECTED_PRD_SLUG}.md .planning/prds/done/{SELECTED_PRD_SLUG}.md"
  echo "Then re-run the commit step once the file is in place."
  exit 1
fi
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: create milestone v[X.Y] roadmap — {SELECTED_PRD_SLUG} PRD promoted" --files .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md .planning/DECISIONS.jsonl .planning/DECISIONS.md .planning/prds/pending/{SELECTED_PRD_SLUG}.md .planning/prds/done/{SELECTED_PRD_SLUG}.md
```

Print after commit:
```
Requirements traceability: REQUIREMENTS.md updated with MILE-XX → Phase mapping.
PRD promoted: .planning/prds/done/{SELECTED_PRD_SLUG}.md
```

**If PRD_DRIVEN=false:**
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: create milestone v[X.Y] roadmap ([N] phases)" --files .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md .planning/DECISIONS.jsonl .planning/DECISIONS.md
```

## 11. Done

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► MILESTONE INITIALIZED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Milestone v[X.Y]: [Name]**

| Artifact       | Location                    |
|----------------|-----------------------------|
| Project        | `.planning/PROJECT.md`      |
| Research       | `.planning/research/`       |
| Requirements   | `.planning/REQUIREMENTS.md` |
| Roadmap        | `.planning/ROADMAP.md`      |

**[N] phases** | **[X] requirements** | Ready to build ✓

**Auto mode:** the roadmap is the second owner gate; the hand-off to the roadmap run happens only on the invocation that finds it approved. There is no phase to discuss by hand.

Auto (auto_mode, references/auto-mode.md OG2): with no approved `roadmap` gate, request it, print the owner summary (phase table: number, name, goal, requirement IDs, rigour, whether it touches a risk domain; requirement coverage; the open `A-` rows; the expected budget per phase from `references/rigour.md`) and end the run `waiting_owner_approval`; start no phase.

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" owner-gate request --kind roadmap --milestone v[X.Y] --summary "<N phases; coverage; open A- rows; rigour per phase, e.g. 1-2 spike, 3 standard (risk: auth)>" --spike-phases <N,M> --spike-roots <paths>   # the two flags only with spike phases and only once CLI-2 has landed
```

Auto (auto_mode, references/auto-mode.md K1): with the `roadmap` gate approved, proceed to the roadmap run without waiting.

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set workflow._auto_chain_active true
```

Exit skill and invoke SlashCommand("/gsd:execute-roadmap --auto").

**Interactive mode:**

## ▶ Next Up

**Phase [N]: [Phase Name]** — [Goal]

`/gsd:discuss-phase [N]` — gather context and clarify approach

<sub>`/clear` first → fresh context window</sub>

Also: `/gsd:plan-phase [N]` — skip discussion, plan directly
```

</process>

<success_criteria>
- [ ] PROJECT.md updated with Current Milestone section
- [ ] STATE.md reset for new milestone
- [ ] MILESTONE-CONTEXT.md consumed and deleted (if existed)
- [ ] Research completed (if selected) — 4 parallel agents, milestone-aware
- [ ] Requirements gathered and scoped per category
- [ ] REQUIREMENTS.md created with REQ-IDs
- [ ] gsd-roadmapper spawned with phase numbering context
- [ ] Roadmap files written immediately (not draft)
- [ ] User feedback incorporated (if any)
- [ ] ROADMAP.md phases continue from previous milestone
- [ ] All commits made (if planning docs committed)
- [ ] User knows next step: `/gsd:discuss-phase [N]` (interactive), or the run continued into `/gsd:execute-roadmap --auto` with `workflow._auto_chain_active` set (auto)

**Atomic commits:** Each phase commits its artifacts immediately.
</success_criteria>
