<purpose>
Product discovery workflow. Takes a rough idea (1-2 pages), runs multi-round deep investigation across 6 dimensions, synthesizes an enriched PRD, discusses with user, and hands off to /gsd:new-milestone.
</purpose>

<process>

## Step 1: Load Idea

Read the input document provided by user (path or inline text).
Extract: product_name (infer if not stated), codebase_path (check if .planning/ exists → brownfield).

Create `.planning/discovery/` directory.
Copy or write the original idea to `.planning/discovery/IDEA.md`.

## Step 2: Round 1 — Parallel Investigation

Spawn 6 gsd-product-investigator agents in parallel (Sonnet model):

```
investigators = [
  { dimension: "domain",     prompt: "idea={idea} dimension=domain codebase_path={path} round=1" },
  { dimension: "competitive", prompt: "idea={idea} dimension=competitive codebase_path={path} round=1" },
  { dimension: "innovation",  prompt: "idea={idea} dimension=innovation codebase_path={path} round=1" },
  { dimension: "codebase",   prompt: "idea={idea} dimension=codebase codebase_path={path} round=1"
                              // SKIP if greenfield (no existing codebase) },
  { dimension: "technical",  prompt: "idea={idea} dimension=technical codebase_path={path} round=1" },
  { dimension: "risk",       prompt: "idea={idea} dimension=risk codebase_path={path} round=1" },
]
```

Wait for all to complete. Log one-line summary from each.

## Step 3: Round 1 Synthesis (Opus)

Spawn gsd-discovery-synthesizer (Opus):
```
prompt: "project_dir={dir} product_name={name} round=1 original_idea={idea}"
```

Parse the returned gap list (JSON array of gap questions).

If gap count = 0: skip Round 2, proceed to Step 5 (final synthesis).

## Step 4: Round 2 — Gap Closure

For each gap question (up to 10 gaps; if >10, take top 10 by importance):
  Spawn a targeted gsd-product-investigator (Sonnet):
  ```
  prompt: "idea={idea} dimension=domain round=2 gap_question={gap} codebase_path={path}"
  ```
  (dimension='domain' is a fallback — the agent should infer the right dimension from the gap question)

Wait for all Round 2 investigators to complete.
Aggregate their answers into `.planning/discovery/GAPS-R2.md`.

## Step 5: Final Synthesis (Opus)

Spawn gsd-discovery-synthesizer (Opus):
```
prompt: "project_dir={dir} product_name={name} round=2 original_idea={idea}"
```

Wait for completion. PRD is now at `.planning/discovery/PRD.md`.

## Step 6: Present and Discuss

Display the PRD to user section by section. For each major section:
- Executive Summary → ask: "Does this capture the right scope?"
- Feature Specification → ask: "Any features to add, remove, or reprioritize?"
- Risk Assessment → ask: "Any risks we missed?"
- Open Questions → ask each question inline

Incorporate feedback: edit PRD directly or re-run targeted investigators if significant changes needed.

## Step 7: Commit and Handoff

```bash
git add .planning/discovery/
git commit -m "docs: product discovery for {product_name}"
```

Present:
```
Discovery complete. PRD at .planning/discovery/PRD.md

To create the milestone roadmap:
  /gsd:new-milestone --prd .planning/discovery/PRD.md
```

</process>
