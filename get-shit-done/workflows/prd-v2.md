<purpose>
Turn a concept, a draft file or a URL into a PRD at `.planning/prds/pending/{slug}.md` without question rounds. The workflow decides, records what it decided, and stops for the CEO only on critical questions. Built for a product that is split into many PRDs: it reads one product brief and an index of sibling PRDs instead of researching the product again each time.
</purpose>

<inputs>
Parse `$ARGUMENTS`:
- `--brief <file>`, `--siblings <dir> [<dir> ...]`, `--slug <slug>`: optional flags.
- `--index <file>`: a prebuilt context index (the scout's output format). When given, Step 0.4 reads it and spawns no scout.
- `--coordinated`: a coordinator runs several PRDs at once. Do not run `git`, `decisions render` or `decisions digest`; write only this PRD and ledger records (`decisions add`); the coordinator renders, digests and commits.

All paths are relative to the project root (the directory that holds `.planning/`).
- Everything else is `concept`: starts with `http://` or `https://` → fetch it; an existing file path → read it; otherwise raw text.

A draft file may carry its own slug (a `# Draft: {slug}` heading or a `slug:` line), scope notes, gaps and mockup paths. Use them.
</inputs>

<decisions>
Contract: @~/.claude/get-shit-done/references/decisions-protocol.md (`decisions` = `node "$HOME/.claude/get-shit-done/bin/decisions.js"`).

Every gap is closed by the first rung that answers it:

1. The concept or draft itself.
2. The product brief and `.planning/prds/BASELINE.md`.
3. Sibling PRDs (the index, then the sibling file when the index points at it).
4. Binding ledger records: `decisions list`. Never re-decide what a `D-` or an open `A-` already answers.
5. The codebase, when the project has one.
6. Research (Step 1).
7. Your own default. Write it as an `A-` record (`--source prd:stage{N} --prd {slug}`) with the default, the options considered and its reversibility.

Classes of question:
- **Money, auth, security, RNG:** never wait. Send to the ruling route in `decisions-protocol.md` and record the returned `D-`.
- **Critical:** the CEO's call (strategy, business model, a legal or compliance position) and expensive to undo after launch (examples: target markets, a monetisation rule, whether the feature should exist, a public contract, who signs off legal texts). Legal and compliance questions belong here, not on the ruling route. Record as an `A-` with `--reversibility irreversible` and the default you would defend, keep working on that default, and put it on the approval screen (Step 5). These are the only questions the CEO is asked.
- **Everything else:** decide (rung 7). Do not ask. A choice that follows from a decision already in the brief or baseline is not a question at all: apply it and cite the brief.

Ledger size: record an `A-` only for a choice that is costly or irreversible to change. A cheap default is stated in the acceptance criteria and gets no record. More than 8 records for one PRD means cheap choices are being logged.
An `A-` written here has no phases yet; it is mapped at milestone review (`decisions map`), as the protocol says.

A question that the brief, the baseline or a sibling PRD already answers is not a gap. A critical question already recorded for the product is cited by its id, not asked again.

Unattended (`GSD_AUTONOMOUS=1`): never stop; Step 5 approval is `assumed`.
</decisions>

<process>

## Step 0: Initialize and build context

1. Read the concept (see `<inputs>`).

2. Slug: `--slug`, else the draft's own slug, else derive one from the concept (lowercase, hyphens, 2 to 5 words, named after the capability). If `.planning/prds/pending/{slug}.md` exists with a stage marker, resume (see `<resume_support>`); if it exists without one, or the slug exists in `prds/done/`, append `-2`. Do not ask.

3. `mkdir -p .planning/prds/pending .planning/prds/done`. If `~/.claude/get-shit-done/templates/prd-v2.md` is missing, print the path and stop: the installation is incomplete.

4. **Context scout.** With `--index`, read that file and `ls .planning/prds/pending`, then skip to item 5. Otherwise one Haiku agent (`general-purpose`, `model: "haiku"`), so sibling files never load into this context:

   ```
   Goal: build the context index for a PRD about: {concept, first 300 chars}.
   Brief: {--brief path, or "not given: find it"}. Sibling folders: {--siblings paths, or "not given: find them"}.
   Finding: look in the working directory, `.planning/`, and the folder that holds the concept file and its parent.
   A brief is a file named like PRODUCT-BRIEF, PROJECT, VISION or BRIEF (`.md`), or a root README that describes the product.
   Sibling folders are `.planning/prds/pending`, `.planning/prds/done`, and any folder named like `prd-drafts`, `prds` or `drafts`. Skip the concept file itself.
   Return, in at most 120 lines:
   BRIEF: path, plus which of these it contains: vision, audience, target markets, monetisation, tech baseline, non-functional baseline, compliance position, product-level decisions.
   BASELINE: whether `.planning/prds/BASELINE.md` exists and its section headings.
   SIBLINGS: one line per file: path | slug | state (draft, pending, done) | scope in at most 15 words | MVP or later.
   OVERLAPS: the siblings whose scope touches the concept, and for each the shared entity or boundary in one line.
   Report only what the files say. Write "not found" where nothing exists.
   ```

   If the agent fails, do the same search yourself with `ls` and head-of-file reads, limited to the same folders.

5. Read the brief in full (it is one file). Read `.planning/prds/BASELINE.md` if it exists. Read in full only the siblings whose scope touches the concept, at most 5; for the rest the index line is enough. A sibling that exists both as a draft and in `pending/` or `done/` is read from `pending/` or `done/`. `siblings indexed` on the `**Inputs:**` line is the number of index lines.

6. Create `.planning/prds/pending/{slug}.md` from the template; fill `{slug}`, `{date}`, `{concept_summary}` and the `**Inputs:**` line. The first line is `<!-- stage: initialized -->`.

## Step 1: Research

Two kinds. Product-level research is done once and shared; feature research is done for every PRD, always.

### 1a. Feature research (mandatory, every PRD)

A PRD written without looking at how the feature works elsewhere is a guess. Before any story is written, find out:
- how 2 to 4 comparable products implement this feature, and what their users complain about;
- the legal, regulatory and platform-policy points for this feature in the product's target markets;
- known abuse and failure patterns, and how they are usually countered;
- the established user expectations (what a user will assume without being told).

How: one research agent (`general-purpose`, `model: "haiku"`) with the concept and these four questions, returning at most 15 bullets, each with its source URL. When agents cannot be spawned (a coordinated or nested run), search yourself: 4 to 8 searches, reading the pages that matter. Check the brief, the baseline and sibling PRDs first and search only for what they do not already establish.

Use: findings change the stories, acceptance criteria, non-functional rows and defaults; a default backed by a finding cites it. Write them to the PRD's **Research Findings** section, each with its URL. A claim you could not source is written as "unverified" and never as fact. A finding that matters to other PRDs (a market rule, a platform policy) is also appended to `.planning/prds/BASELINE.md` under the matching heading with its URL, unless `--coordinated` (then list it in the final report for the coordinator to add).

If search is unavailable, say so in Research Findings and record the decisions that most needed evidence as `A-` records.

### 1b. Product context (research only what is missing)

Needed at product level: market and competitor context, target markets, tech baseline, non-functional baseline, compliance position.

- Present in the brief or in `BASELINE.md` → use it. No research.
- Missing → research it once and save it for every later run:
  - Market and compliance: one Haiku agent (`general-purpose`) fetches 2 to 3 sources and returns at most 8 bullets with their URLs.
  - Tech and non-functional baseline: take the project's existing stack when there is a codebase or a project `CLAUDE.md`; otherwise choose a default stack for the product as a whole and record the choice as one `A-` (`costly`).
  - Append the result to `.planning/prds/BASELINE.md` under the headings `## Market Context`, `## Target Markets`, `## Tech Baseline`, `## Non-Functional Baseline`, `## Compliance Position`. Each line carries its source: a URL, a file path or an `A-` id. Never edit the user's brief. Never rewrite a baseline section that already exists; add to it only what this PRD newly learned.
- Target markets and the compliance position are critical when absent from both brief and baseline: record one `A-` (`irreversible`) each, with a default, and continue.

If research is unavailable, continue on the concept and record the missing part as an `A-`.

**Gap investigation.** If, after rungs 1 to 5, three or more PRD-specific gaps would otherwise be decided blind, spawn one `gsd-product-investigator` (`model: "haiku"`) per gap, at most 4, in waves no wider than the project's parallelism limit (2 when none is stated):

```
idea={concept} dimension={domain|competitive|innovation|codebase|technical|risk} round=2 gap_question={question} codebase_path={path or null}
```

Use what comes back as evidence for the decision; an investigator that fails leaves the gap for rung 7. No synthesizer pass: you merge at most four short reports yourself.

## Step 2: PM stage

Close these gaps by the ladder, using the Step 1 findings: target user, problem and its severity, how it is solved today, what is different here, vision (what it must feel like and what would make the CEO reject the result even if every story passes), non-goals, success definition.

Write to the PRD:
- **Problem Statement:** Target User, Problem, Current Solutions, Gap.
- **Goals:** outcomes, 3 to 6.
- **Non-Goals:** including what an overlapping sibling owns.
- **Success Metrics:** per the template rule; each metric names its data source.
- A market-context comment under the Problem Statement only for points specific to this PRD; product-level context stays in the baseline.

Set the marker to `<!-- stage: pm -->`.

## Step 3: PO stage

1. **Boundaries first.** From the sibling index fill **Relationship to Adjacent PRDs**. For each overlap decide which PRD owns the shared piece: the one already `pending` or `done` wins over a draft; between two drafts, the one whose core purpose it is. What a sibling owns goes to Non-Goals here. If a `pending` or `done` sibling contradicts this concept, do not edit the sibling: record the conflict as an `A-` (`costly`) with the resolution this PRD assumes.

2. **Stories.** Personas, their core actions, then `US-N` stories. Stay inside the concept's scope: an idea that belongs to a sibling becomes a line in the relationship table, not a story.

3. **Decision points.** For each MVP story list the product choices with more than one reasonable answer (limits, defaults, states, permissions, copy tone, failure behaviour). Decide each one by the ladder. Record as `A-` the ones that are costly or irreversible to change; state the cheap ones directly in the acceptance criteria.

4. **Acceptance Criteria** per story: concrete checkboxes including failure and empty states. Backend behaviour → an `**API tests:**` line (happy path, auth failure, validation, error handling, edge cases). A page, form or interactive component → a `**UI QA:**` line (renders, key interactions, error states, responsive behaviour); use the project's UI QA tool name when the project `CLAUDE.md` names one. Each Success Metric has a criterion saying the event or record it is computed from is produced by this feature; collection and reporting belong to the product's analytics PRD when one exists.

5. **UX Notes:** screens and their states in words. Add `References:` only for mockups that came with the input, with their real paths. No mockups is normal: say that visual design is done at implementation.

6. **MVP Boundary:** decide it. Use the scope marks in the draft and the brief when present; otherwise MVP is the smallest set of stories that delivers the first Goal end to end. Every story appears in exactly one list. Moving something the source marked MVP out of MVP, or the reverse, is recorded as an `A-` (`costly`).

7. **Non-Functional Requirements and Compliance:** what is specific to this PRD on top of the baseline: abuse cases, personal data handled, load expectation, accessibility, SEO for public surfaces, regulatory points per market. Cite the baseline; do not copy it. End with a **Settings** list: the rules, limits, lists of values, texts and switches of this feature that staff change without a deploy, who may change each, and what stays fixed in code and why.

Set the marker to `<!-- stage: po -->`.

## Step 4: Tech stage

Scope: WHAT to consider and WHY. No schemas, routes, DDL or code.

- The baseline fixes the stack → list only the capabilities this PRD adds (for example search, media storage, email delivery) with a primary candidate, an alternative and the reason, plus Architectural Constraints. Write "Uses the product baseline; no additions" when that is true.
- No baseline stack even after Step 1 → name candidates per domain as above, current as of today's date.
- Research a domain (one Haiku agent, 1 to 2 comparison pages) only when the choice is not obvious and is costly to reverse.

**No-HOW check, whole PRD:** remove and rewrite as prose any fenced code block longer than 2 lines, any SQL DDL (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`), and any HTTP method followed by a path (`GET /...`, `POST /...`). Paths to source files and mockups are allowed. Do not ask; say in the final screen how many were removed.

Fill **Assumptions** (every `A-` of this PRD: id, default, reversibility) and **Open Questions** (only the critical ones, by id). Neither section holds an item without a ledger record.

Set the marker to `<!-- stage: complete -->`.

## Step 5: Approval

Any open `A-` about money, auth, security or RNG goes to the ruling route first and is replaced by its `D-`. Run `decisions render`.

**No critical question open for this PRD, or unattended:** write `<!-- approval: assumed {date} -->` under the stage marker, print `decisions digest` to the chat, run `decisions digest --mark-only`, go to Step 6. No stop. With `--coordinated`, write the marker and skip render, digest and commit.

**Critical questions open:** show one screen and stop:

```
PRD {slug} — {N} critical question(s)

Summary (max 10 lines): problem, who it is for, MVP stories by title, what is deferred, which siblings it depends on.

Critical ({N}):  A-NN  {question} -> default: {default}
Also assumed ({N}): the 5 most costly, one line each; the rest are in .planning/DECISIONS.md

Reply: approve | A-NN <answer> ... | change <what>
```

- `A-NN <answer>`: `decisions answer A-NN --value "<answer>"`, update the PRD text it changes, show the screen again if critical questions remain.
- `change <what>`: edit the PRD, record a `D-` (`--source prd:approval`), show the screen again.
- `approve`: write `<!-- approval: approved {date} -->`; unanswered critical questions stay open on their defaults.

Commit the PRD, `.planning/prds/BASELINE.md` if it changed, `.planning/DECISIONS.jsonl` and `.planning/DECISIONS.md` together.

## Step 6: Finalize

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► PRD Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRD: .planning/prds/pending/{slug}.md
Approval: {approved | assumed}
Stories: {N} ({M} MVP)   Decisions: {N} decided, {N} assumed, {N} critical open
Context: brief {path | none}, baseline {used | extended | created}, siblings indexed {N}, overlaps resolved {N}
No-HOW check: {N} removed

Next step: /gsd:new-milestone
```

If the run created or extended `BASELINE.md`, say which sections, so the CEO can correct product-level assumptions once instead of in every PRD.

</process>

<resume_support>
If `.planning/prds/pending/{slug}.md` exists with a stage marker, rebuild context (Step 0.4 and 0.5) and resume:
- `initialized` → Step 1
- `pm` → Step 3
- `po` → Step 4
- `complete` without an `<!-- approval: ... -->` line → Step 5; with one → show the Step 6 screen
</resume_support>
