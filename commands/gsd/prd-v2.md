---
name: gsd:prd-v2
description: Turn a concept or draft into a PRD without Q&A rounds - decides on its own, reads the product brief and sibling PRDs, asks the product owner only critical questions
argument-hint: "<concept | file | URL> [--brief <file>] [--siblings <dir> ...] [--index <file>] [--slug <slug>] [--coordinated]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - WebFetch
  - WebSearch
  - Agent
  - Task
---

<objective>
Produce a PRD at `.planning/prds/pending/{slug}.md` from a concept, a draft file or a URL.

Differences from `/gsd:prd`:
- No question rounds. Gaps are closed from the input, the product brief, sibling PRDs, the codebase and research; what remains is decided with a default and recorded as an `A-` assumption. The slug is derived.
- The product owner is asked only critical questions (strategic, business or legal, irreversible), once, on the approval screen. No critical question means no stop.
- Feature research is mandatory for every PRD (comparable products, legal and policy points, abuse patterns), with sources cited in the PRD. Product-level context (market, stack, non-functional baseline) is read from a brief instead of being researched again for each PRD.
- Sibling PRDs and drafts are indexed so scope does not overlap and dependencies are named.

**Input:** $ARGUMENTS
- Concept: raw text, a file path (a draft from a `prd-drafts/` folder works), or a URL. Required.
- `--brief <file>`: product brief. Optional; found by a Haiku search when absent.
- `--siblings <dir> ...`: folders holding other PRDs or drafts of the same product. Optional; found by a Haiku search when absent.
- `--index <file>`: prebuilt sibling index; no scout is spawned.
- `--slug <slug>`: optional override.
- `--coordinated`: run under a coordinator that renders the ledger and commits.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/prd-v2.md
</execution_context>

<process>
Execute the workflow from @~/.claude/get-shit-done/workflows/prd-v2.md end-to-end with $ARGUMENTS.
</process>
