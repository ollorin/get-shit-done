<purpose>
Mature a raw product concept into a structured PRD through three sequential stages with confidence-driven Q&A. Stores output at `.planning/prds/pending/{slug}.md`.
</purpose>

<input_modes>
The `concept` variable can be:
- **Raw text**: Any string that is not a valid file path or URL (e.g., "Auth system for multi-tenant SaaS")
- **File path**: If the input matches an existing file path on disk, read its content as the concept
- **URL**: If the input starts with `http://` or `https://`, fetch the page content as the concept source

Detection order:
1. Check if input starts with `http://` or `https://` → URL mode (fetch with WebFetch)
2. Check if input is a valid file path that exists → file mode (read with Read tool)
3. Otherwise → raw text mode
</input_modes>

<decisions>
Contract: @~/.claude/get-shit-done/references/decisions-protocol.md (`decisions` = `node "$HOME/.claude/get-shit-done/bin/decisions.js"`).

- An answer that settles a product choice is written as a `D-` record when it is given (`--source prd:stage{N} --prd {slug}`). A gap left unresolved is written as an `A-` record with the default this PRD proceeds on. Open Questions and Assumptions bullets start with their id; neither section holds an item that has no record.
- Unattended (`GSD_AUTONOMOUS=1`): wherever this workflow says STOP and wait, take the default, write the `A-`, continue. Slug: derive it from the concept. Step 4 approval: `assumed`.
</decisions>

<process>

## Step 0: Initialize

1. Detect input mode and extract concept content (see `<input_modes>` above).

2. Ask user for PRD slug:
   - Output this exact question as your final text, then **STOP immediately — do not call any more tools, do not continue the workflow**:
     ```
     What should this PRD be called? (slug format: lowercase, hyphens only, no spaces)
     ```
   - Wait for the user's reply. The slug comes from that reply, not from any examples or assumptions.
   - Validate: lowercase, hyphens only, no spaces — if invalid, output the correction request and STOP again
   - If `.planning/prds/pending/{slug}.md` already exists, warn user and append `-2` or ask to confirm overwrite (STOP and wait for reply)

3. Create directory structure:
```bash
mkdir -p .planning/prds/pending
mkdir -p .planning/prds/done
```

4. Check that the PRD template exists before using it:
   - If `~/.claude/get-shit-done/templates/prd.md` does NOT exist, display:
     ```
     ERROR: PRD template not found at ~/.claude/get-shit-done/templates/prd.md
     The GSD installation may be incomplete or corrupted.
     Run the GSD installer to restore missing templates, then retry.
     ```
     Then stop — do not proceed further.

   Create empty PRD draft at `.planning/prds/pending/{slug}.md` from the template at `~/.claude/get-shit-done/templates/prd.md`.
   Replace `{slug}`, `{date}`, and `{concept_summary}` placeholders in the template.

5. Write the stage marker at the top of the PRD file:
```
<!-- stage: initialized -->
```

## Step 1: PM Discovery Stage

Display header:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► Stage 1/3: PM Discovery
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 1a. Web Research

Perform competitive landscape research on the concept:

**Delegate all web fetches to a Haiku subagent** to keep the main context lean:
- Spawn a `general-purpose` agent with model `haiku`
- Pass it: the concept text + a prompt to fetch 2-3 competitive/market URLs and return a 3-5 bullet summary
- Use the returned summary — do not re-fetch URLs in the main session

If the subagent fails or returns no useful content: print "Research unavailable — proceeding with concept description only" and continue.

1. Identify 2-3 relevant search angles from the concept (e.g., "competitor products", "market category", "problem domain") and pass them to the Haiku subagent.

2. If all fetches fail: print "Research unavailable — proceeding with concept description only" and continue to Q&A without blocking.

3. Synthesize research into a brief market context summary (3-5 bullet points):
   - Key competitor approaches
   - Target user patterns observed
   - Market gaps or opportunities

### 1b. Initial Gap Assessment

Before the Q&A loop, assess initial confidence based on the concept + research:

Set initial gaps list. For PM Discovery, standard blocking gaps are:
- target_user: "Who is the primary user persona?" (blocked if not clearly stated in concept)
- problem_severity: "How acute is this problem — is it a pain or a nice-to-have?" (blocked if unclear)
- market_differentiation: "What makes this different from existing solutions?" (blocked if unclear)
- success_definition: "What does user success look like 6 months after adoption?" (blocked if not stated)
- business_model: "Who pays and how?" (blocked if this is a commercial product concept — skip if internal tool)
- vision: "What must this feel like to its user, and what would make you reject the result even if every story passes?" (always blocked — the vision is never inferred)
- non_goals: "What must this not do or become?" (blocked if not stated)

Remove gaps that are already clearly answered by the concept or research.

Set initial confidence:
- 1-2 gaps: confidence = 0.65 (`vision` is always one of them, so Stage 1 always asks at least one round)
- 3+ gaps: confidence = 0.50

### 1c. Q&A Loop

Run the Q&A loop using the `<qa_loop_template>` pattern:
- max_rounds = 3
- max_questions = 4
- confidence_threshold = 0.80

**Round structure:**
```
Stage 1/3: PM Discovery — Round {N}/3
Current confidence: {X}% — blocking gaps: {list of remaining gap names}

[1-4 questions addressing the current gaps, numbered]
```

After each user reply:
- Map answers to gaps
- Mark gaps as resolved if the answer provides a clear, actionable decision
- Update confidence:
  - All gaps resolved → 0.85
  - 1-2 gaps remain vague → 0.65
  - Non-committal answers or deferred to Claude → 0.50

**Force-advance after round 3:** If confidence < 0.80 after round 3, proceed anyway. Add unresolved gaps to the PRD's Open Questions section.

### 1c-bis. Confidence-Gated Discovery Fan-Out

After the Q&A loop above completes:

If `confidence >= 0.65`: discovery stays dormant — skip this subsection entirely, continue to 1d unchanged.

If `confidence < 0.50` AND `gaps` is non-empty:
1. Determine fan-out count: one investigator per remaining gap, capped at 6, minimum 4 if 4+ gaps remain (if fewer than 4 gaps remain, spawn exactly one investigator per gap).
2. For each targeted gap, spawn a Haiku investigator in parallel:
   ```
   Agent(
     subagent_type="gsd-product-investigator",
     model="haiku",
     description="Investigate gap: {gap_name}",
     prompt="idea={concept} dimension={infer closest of: domain|competitive|innovation|codebase|technical|risk from gap_name} gap_question={gap_question_text} codebase_path={codebase path if brownfield else null} round=2"
   )
   ```
3. Wait for all to complete. If ALL investigators fail or return empty: log "Discovery investigation unavailable — proceeding with standard unresolved-gap handling" and continue to 1d completely unchanged (do not hard-block PRD completion).
4. If at least one investigator succeeds, spawn the synthesizer to merge findings:
   ```
   Agent(
     subagent_type="gsd-discovery-synthesizer",
     model="{ruling_model}",  # the configured top model: gsd-tools resolve-model top --raw (CLI-3)
     description="Merge Stage 1 discovery findings",
     prompt="slug={slug} stage=1 original_idea={concept} findings={collected investigator outputs, one per gap}"
   )
   ```
5. Parse the synthesizer's returned findings-per-gap. For each gap now resolved by investigation, remove it from `gaps` and note the resolution. Recompute `confidence`: if all gaps now resolved -> 0.75; if some remain -> 0.60.
6. Log: "Discovery fan-out: {N} investigators spawned, confidence {before} -> {after}, {R} of {G} gaps resolved"

If confidence is between 0.50 and 0.65 (exclusive of 0.65): stays dormant, same as the documented threshold — no fan-out.

Investigator failure is NON-FATAL: if any Agent() call throws, times out, or returns unparseable output, treat that specific gap as still-unresolved and continue — never abort the PRD workflow because an investigator failed.

Continue to 1d using the (possibly updated) `confidence` and `gaps`.

### 1d. Write PM Section to PRD

After the Q&A loop completes, write the PM Discovery section to `.planning/prds/pending/{slug}.md`.

Replace the `{problem_statement}` placeholder with:
```markdown
## Problem Statement

**Target User:** {target_user answer}
**Problem:** {core problem from concept + Q&A}
**Current Solutions:** {from research — how people solve it today}
**Gap:** {what existing solutions don't do well}
```

Replace `{goals_list}` placeholder with:
```markdown
## Goals

- {goal 1 derived from success_definition answer}
- {goal 2}
- {goal 3}
*(Goals are user-facing outcomes, not features)*
```

Add market context as a comment block after the Problem Statement section:
```markdown
<!-- PM Discovery: Market Context
{market context summary from research — 3-5 bullets}
-->
```

Populate the Open Questions section with any gaps that were not resolved by the Q&A loop. This sets the initial Open Questions list:
- If any gaps remain unresolved after the Q&A loop, replace the `{open_questions}` placeholder with:
  ```markdown
  ## Open Questions

  {For each unresolved gap from Stage 1 Q&A:}
  - **[Stage 1 — {gap_name}]** {gap question text} *(unresolved — {reason: deferred/vague/not addressed})*
  ```
- If all gaps were resolved, replace `{open_questions}` with `## Open Questions\n\n*(None from Stage 1)*`

### 1e. Update Stage Marker

Update the stage marker at the top of the PRD file:
- Find: `<!-- stage: initialized -->`
- Replace with: `<!-- stage: pm -->`

Then continue to Step 2: PO/BA Scoping Stage.

## Step 2: PO/BA Scoping Stage

Display header:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► Stage 2/3: PO/BA Scoping
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2a. Read Codebase Context

Scan the existing codebase to understand what has already been built:

```bash
ls -la .planning/prds/done/ 2>/dev/null || echo "No done PRDs yet"
```

Read each done PRD file (if any) to understand what user stories and features are already implemented. Summarize in a "Prior context" variable.

Also list existing source directories to understand the tech stack:
```bash
ls -d */ 2>/dev/null | grep -v ".planning\|node_modules\|.git" | head -20
```

Use this to understand: is this a greenfield or brownfield project? If brownfield, what domains are already covered?

### 2b. Initial Scoping Gap Assessment

Set initial scoping gaps for the Q&A:
- user_personas: "Who are the distinct user types that need different features?" (blocked if only one persona named in concept)
- core_actions: "What are the 3-5 core actions each user persona needs to do?" (blocked if not specified)
- mvp_scope: "Which of these actions are essential for MVP vs deferred to Phase 2?" (always blocked — requires explicit user decision)
- priority_story: "Which user story is the most critical to validate first?" (blocked if not clear)
- acceptance_evidence: "How does the user know each story is complete? (concrete behavior, not feature description)" (blocked if vague)
- decision_points: "Per MVP story, the product choices with more than one reasonable answer: limits, defaults, states, permissions, copy tone, failure behaviour" (always blocked — list them all, ask the ones most expensive to change first within the round budget, give each of the rest a default and an `A-` record)

Set initial confidence:
- 1 gap (mvp_scope only): confidence = 0.60 (ensures at least one focused Q&A round)
- 2-3 gaps: confidence = 0.50
- 4+ gaps: confidence = 0.30

Note: `mvp_scope` is always marked blocked — the MVP boundary MUST be defined through Q&A, never inferred. There can never be 0 gaps at this stage because `mvp_scope` is always blocked.

### 2c. Q&A Loop

Run the Q&A loop using the `<qa_loop_template>` pattern:
- max_rounds = 3
- max_questions = 4
- confidence_threshold = 0.80

**Round structure:**
```
Stage 2/3: PO/BA Scoping — Round {N}/3
Current confidence: {X}% — blocking gaps: {list of remaining gap names}
Prior context: {brownfield/greenfield — done PRDs found: N}

[1-4 questions addressing the current gaps, numbered]
```

Focus questions on:
- User stories in "As a [user], I want [action] so that [outcome]" format
- Acceptance criteria: "The story is complete when [concrete testable behavior]"
- MVP line: "For MVP, include X, Y, Z. Defer A, B, C to Phase 2."

### 2c-bis. Confidence-Gated Discovery Fan-Out

After the Q&A loop above completes:

If `confidence >= 0.65`: discovery stays dormant — skip this subsection entirely, continue to 2d unchanged.

If `confidence < 0.50` AND `gaps` is non-empty:
1. Determine fan-out count: one investigator per remaining gap, capped at 6, minimum 4 if 4+ gaps remain (if fewer than 4 gaps remain, spawn exactly one investigator per gap).
2. For each targeted gap, spawn a Haiku investigator in parallel. Gap questions and dimension inference come from Stage 2's scoping gaps (user_personas, core_actions, mvp_scope, priority_story, acceptance_evidence). Reference "Prior context" (brownfield/greenfield, done PRDs found from 2a) in the prompt where relevant to the gap:
   ```
   Agent(
     subagent_type="gsd-product-investigator",
     model="haiku",
     description="Investigate gap: {gap_name}",
     prompt="idea={concept} dimension={infer closest of: domain|competitive|innovation|codebase|technical|risk from gap_name} gap_question={gap_question_text} codebase_path={codebase path if brownfield else null} round=2 prior_context={brownfield/greenfield, done PRDs found — from 2a, where relevant to this gap}"
   )
   ```
3. Wait for all to complete. If ALL investigators fail or return empty: log "Discovery investigation unavailable — proceeding with standard unresolved-gap handling" and continue to 2d completely unchanged (do not hard-block PRD completion).
4. If at least one investigator succeeds, spawn the synthesizer to merge findings:
   ```
   Agent(
     subagent_type="gsd-discovery-synthesizer",
     model="{ruling_model}",  # the configured top model: gsd-tools resolve-model top --raw (CLI-3)
     description="Merge Stage 2 discovery findings",
     prompt="slug={slug} stage=2 original_idea={concept} findings={collected investigator outputs, one per gap}"
   )
   ```
5. Parse the synthesizer's returned findings-per-gap. For each gap now resolved by investigation, remove it from `gaps` and note the resolution. Recompute `confidence`: if all gaps now resolved -> 0.75; if some remain -> 0.60.
6. Log: "Discovery fan-out: {N} investigators spawned, confidence {before} -> {after}, {R} of {G} gaps resolved"

If confidence is between 0.50 and 0.65 (exclusive of 0.65): stays dormant, same as the documented threshold — no fan-out.

Investigator failure is NON-FATAL: if any Agent() call throws, times out, or returns unparseable output, treat that specific gap as still-unresolved and continue — never abort the PRD workflow because an investigator failed.

Continue to 2d using the (possibly updated) `confidence` and `gaps`.

### 2d. Write PO Section to PRD

After the Q&A loop completes, write the PO Scoping section to `.planning/prds/pending/{slug}.md`.

Replace `{user_stories}` placeholder with:
```markdown
## User Stories

{For each user story derived from Q&A:}
**US-{N}: {story title}**
As a {persona}, I want to {action} so that {outcome}.

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
- [ ] **UI QA:** {comma-separated list of QA flows}     ← include when US involves a UI page, form, modal, or interactive component

```

**Test AC generation rules:**
- US involves backend behavior (API endpoint, RPC, DB function, state machine, business logic) → add `**API tests:**` AC listing: happy path, auth/authz failure, validation errors, error handling, edge cases
- US involves a UI page, form, modal, or interactive component → add `**UI QA:**` AC listing: renders correctly, key interactions, error states, responsive behavior
- US is pure infrastructure (migration only, config, no user-facing behavior) → omit both
- US has both backend + UI → include both

Replace `{mvp_items}` and `{phase2_items}` placeholders with:
```markdown
## MVP Boundary

**MVP (Phase 1):**
- {user story or feature included in MVP}
- {user story or feature included in MVP}

**Phase 2 (deferred):**
- {user story or feature deferred}
- {user story or feature deferred}

```

### 2e. Write Assumptions Section (PRD-06)

Replace the `{assumptions}` placeholder with:
```markdown
## Assumptions

The following are assumed but not confirmed — GSD's research phase should validate these:

- {assumption 1 derived from Q&A gaps and brownfield/greenfield context}
- {assumption 2}
- {assumption 3}

*(Assumptions are things we've taken as given without proof. Each one is a risk that could change scope if invalidated.)*
```

Include in assumptions:
- Technology assumptions (e.g., "assumed to run on existing Node.js stack")
- User behavior assumptions (e.g., "assumed users have email verified before using this feature")
- Integration assumptions (e.g., "assumed the identity provider is already integrated for sign-in")
- Any gaps deferred from the Q&A (unresolved items become explicit assumptions)

Append any unresolved Stage 2 gaps to the Open Questions section (cumulative — do not replace Stage 1 entries):
- Read the current Open Questions section from `.planning/prds/pending/{slug}.md`
- For each unresolved gap from Stage 2 Q&A, append:
  ```
  - **[Stage 2 — {gap_name}]** {gap question text} *(unresolved — {reason: deferred/vague/not addressed})*
  ```
- If no Stage 2 gaps remain unresolved, append a note: `*(No new open questions from Stage 2)*`

### 2f. Update Stage Marker

Update the stage marker at the top of the PRD file:
- Find: `<!-- stage: pm -->`
- Replace with: `<!-- stage: po -->`

Then continue to Step 3: HL Tech Discovery Stage.

## Step 3: HL Tech Discovery Stage

Display header:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► Stage 3/3: HL Tech Discovery
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORTANT — Scope guardrail for this stage:
Tech Discovery identifies WHAT technologies to consider and WHY.
It does NOT define HOW to implement. No schemas, API routes, or code.
```

### 3a. Technology Research

Research technology candidates for the product concept:

**Delegate all web fetches to a Haiku subagent** (same pattern as Stage 1):
- Spawn a `general-purpose` agent with model `haiku`
- Pass it: the technology domains + user stories from the PRD + a prompt to fetch 1-2 comparison pages per domain and return primary/alternative candidates with rationale
- Use the returned summary — do not re-fetch in the main session
- If the subagent fails: proceed with Claude's existing knowledge of technology candidates

1. Identify 2-3 technology domains relevant to the concept (e.g., "real-time communication", "document storage", "ML inference") and pass them to the Haiku subagent.

2. Review the User Stories and MVP Boundary from the PRD draft (already written by Stage 2) to understand what capabilities are needed:
   - Read `.planning/prds/pending/{slug}.md` to extract user stories and MVP scope
   - Map each MVP user story to the technology domains it requires

3. For each technology domain, identify:
   - **Primary candidate**: The leading technology for this domain in 2025-2026
   - **Alternative candidate**: A notable alternative with different tradeoffs
   - **Rationale**: Why the primary candidate is appropriate for this concept's scale and constraints

### 3b. Tech Q&A (optional)

If technology direction is clear from research and the concept, skip Q&A and proceed to 3c.

If unclear (e.g., multiple viable tech stacks with very different implications), run one Q&A round:
- max_rounds = 1
- max_questions = 4
- Questions focus on: scale requirements, team expertise, existing infrastructure constraints, cost sensitivity
- **CRITICAL: Output questions and STOP. Do not continue until user replies.**

### 3c. Write Tech Candidates Section

**CRITICAL INSTRUCTIONS for tech section content:**
- Write technology NAMES and RATIONALE only
- Acceptable: "a relational database suitable for structured user data with complex queries"
- Acceptable: "WebSockets — enables real-time bidirectional communication for the live collaboration feature"
- NOT acceptable: SQL schema definitions, CREATE TABLE statements, API endpoint paths, TypeScript interfaces, class definitions, function signatures, deployment config files, container compose files

Replace `{tech_candidates}` placeholder in `.planning/prds/pending/{slug}.md` with:

```markdown
## Tech Candidates

> This section lists WHAT technologies to consider and WHY. HOW to implement is determined by GSD's research phase.

{For each technology domain:}
### {Domain Name}
**Primary candidate:** {tech name} — {rationale: why it fits this concept's scale, requirements, and constraints}
**Alternative:** {tech name} — {when this alternative makes more sense}

{Repeat for each domain}

### Architectural Constraints
- {constraint 1 — e.g., "Must integrate with existing authentication layer"}
- {constraint 2 — e.g., "Must support mobile clients (not desktop-only tech)"}
```

### 3d. No-HOW Guard

After writing the tech section, run a content check on the PRD file to detect prohibited content:

Read the Tech Candidates section from `.planning/prds/pending/{slug}.md`.

Check for prohibited pattern indicators:
- SQL patterns: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `INSERT INTO`, `SELECT *`
- Schema patterns: `schema:`, `fields:`, `type:`, `interface `, `class `, `model:`
- Route patterns: `/api/`, `/v1/`, `endpoint`, `POST /`, `GET /`, `PUT /`, `DELETE /`
- Code patterns: `function `, `def `, `const `, `=>`, `return `, backtick code blocks with more than 2 lines

If ANY prohibited pattern is found:
```
No-HOW Guard: Prohibited content detected in Tech Candidates section.

Found: {list of prohibited patterns found}

Options:
1. Auto-clean — remove the prohibited content and keep only technology names + rationale
2. Rewrite — I'll rewrite the tech section with correct scope
3. Continue — keep as-is (not recommended)
```

Wait for user response. If auto-clean selected: remove lines containing prohibited patterns.
If rewrite selected: regenerate the tech section from scratch following the correct format.
If continue selected: add a warning comment to the PRD.

If NO prohibited patterns found:
```
No-HOW Guard: Tech section is clean — no schemas, routes, or code detected.
```

Append any unresolved Stage 3 gaps to the Open Questions section (cumulative — do not replace Stage 1 or Stage 2 entries):
- Read the current Open Questions section from `.planning/prds/pending/{slug}.md`
- For each unresolved gap from Stage 3 Q&A (if any), append:
  ```
  - **[Stage 3 — {gap_name}]** {gap question text} *(unresolved — {reason: deferred/vague/not addressed})*
  ```
- If no Stage 3 gaps remain unresolved, append a note: `*(No new open questions from Stage 3)*`

### 3e. Update Stage Marker

Update the stage marker at the top of the PRD file:
- Find: `<!-- stage: po -->`
- Replace with: `<!-- stage: complete -->`

Then continue to Step 4: Approval.

## Step 4: Approval

Before the screen, risk rule. A risk-domain path is any path the product brief lists under Risk Domains (`risk_domains` in the init output); authentication/authorisation and security are always risk domains. When `risk_domains_source` is `builtin` (`project.risk_domains` in config.json is empty or absent), every path that mutates state is a risk-domain path. Tag every behaviour on a risk-domain path T0 (real-DB, mutation-proven). Any open `A-` about a risk-domain path or a ruling topic goes to the ruling route in `decisions-protocol.md` (when it meets the trigger there) and is replaced by the `D-` it returns, so it never reaches the screen as an irreversible wait. Run `decisions render`, then show the owner (title: `owner_title` in the init output) one screen, nothing else:

```
PRD {slug} — approval

Summary (max 12 lines): problem, who it is for, the MVP stories by title, what is deferred.

Decided ({N}):  D-NN  {question} -> {answer}
Assumed ({N}):  A-NN  {question} -> {default} [{reversibility}]   (irreversible: the phase that needs it waits for you)

Reply: approve | A-NN <answer> ... | change <what>
```

Order the Assumed list by reversibility (irreversible, costly, cheap), at most 10 lines; the rest are in `.planning/DECISIONS.md`.

- `A-NN <answer>`: `decisions answer A-NN --value "<answer>"`, update the PRD text the answer changes, show the screen again.
- `change <what>`: edit the PRD, record the change as a `D-` (`--source prd:approval`), show the screen again.
- `approve`: write `<!-- approval: approved {date} -->` on the line under the stage marker.
- Unattended: write `<!-- approval: assumed {date} -->`, print `decisions digest` output to the chat, run `decisions digest --mark-only`, continue.

Commit the PRD, `.planning/DECISIONS.jsonl` and `.planning/DECISIONS.md` together.

## Step 5: Finalize

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PRD Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRD stored at: .planning/prds/pending/{slug}.md
Approval: {approved | assumed — {N} questions queued}
Decisions: {N} decided, {N} assumed (.planning/DECISIONS.md)

Next step:
  /gsd:new-milestone
```

</process>

<resume_support>
## Resume Support

If `.planning/prds/pending/{slug}.md` already exists with a stage marker, resume from the appropriate stage:
- `<!-- stage: initialized -->` → resume from Step 1 (PM Discovery)
- `<!-- stage: pm -->` → resume from Step 2 (PO/BA Scoping)
- `<!-- stage: po -->` → resume from Step 3 (HL Tech Discovery)
- `<!-- stage: complete -->` → no `<!-- approval: ... -->` line: resume from Step 4 (Approval); otherwise the PRD is done, display the finalize message

To check for existing PRD: ask user for slug first, then check if file exists.
</resume_support>

<qa_loop_template>
## Confidence-Driven Q&A Loop (reusable pattern for all stages)

```
function qa_loop(stage_name, topic_context, max_rounds=3, max_questions=4, confidence_threshold=0.80):
  round = 1
  confidence = {initial_confidence_from_stage_assessment}
  # Set by stage gap assessment above before calling this loop
  gaps = [initial blocking gaps for this stage]

  while confidence < confidence_threshold AND round <= max_rounds:
    print header: "Stage X/3: {stage_name} — Round {round}/{max_rounds}"
    print confidence: "Current confidence: {confidence*100:.0f}% — blocking gaps: {gaps}"

    questions = derive up to max_questions concrete questions that address the gaps

    Output the round header and numbered questions as your final text.
    **CRITICAL: After outputting the questions, STOP IMMEDIATELY.**
    Do NOT call any more tools. Do NOT continue the workflow. Do NOT force-advance.
    Do NOT write anything after the last question.
    The user's next message will contain their answers — process those answers
    when that message arrives, then continue the loop.

    Update confidence based on answers:
      - All blocking gaps answered with clear decisions → confidence = 0.85 (sufficient)
      - Most gaps answered but 1-2 remain vague → confidence = 0.65 (needs more)
      - User answers are non-committal or defer to Claude → confidence = 0.50 (not sufficient)

    Update gaps list: remove resolved gaps, keep unresolved
    round += 1

  if confidence < confidence_threshold:
    // Force advance — log unresolved gaps to Open Questions section
    Append unresolved gaps to the PRD's Open Questions section
    Print: "Advancing to next stage — {len(gaps)} gap(s) added to Open Questions"

  return answers accumulated across all rounds
```

This template is used by all three stages. Each stage defines its own initial gaps.
</qa_loop_template>
