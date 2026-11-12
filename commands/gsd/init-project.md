---
name: gsd:init-project
description: Add the product brief and stack profile to an existing GSD project
allowed-tools:
  - Read
  - Bash
  - Write
  - AskUserQuestion
---
<objective>
Give an existing GSD project the context that `/gsd:new-project` gives a new one: the product brief and the stack profile. Runs only the interview steps 4.5 and 5.6 of the new-project workflow.

**Creates (when absent):**
- `.planning/PRODUCT-BRIEF.md`
- `.planning/STACK-PROFILE.md`
- the `project` and `stack` blocks of `.planning/config.json`
- the base deployment, through `project init` (absent files only)

**Never overwrites.** `init` creates absent files and keeps existing ones. Two exceptions, both reported: it appends missing ignore lines (`.claude/settings.local.json`, `.mcp.json`, `.env*`, `!.env.example`) to an existing `.gitignore` (the report's `appended` list), and it writes the machine-wide project registry outside the project root (the report's `registry` entry: `path`, `written`). The report of what differs is `project diff`.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/new-project.md
@~/.claude/get-shit-done/templates/product-brief.md
@~/.claude/get-shit-done/templates/stack-profile.md
</execution_context>

<process>
1. Run `init new-project`. If its `context_gate.ok` is true, print both file paths and stop: nothing is missing. Otherwise print `context_gate.missing` and `context_gate.invalid`, and run section 4.5 when they name the brief or a `project.*` key, section 5.6 when they name the stack profile or a `stack.*` key.
2. Execute sections 4.5 and 5.6 of `@~/.claude/get-shit-done/workflows/new-project.md` only. Skip sections 1 to 4 and 6 to 9: the project's PROJECT.md, requirements and roadmap stay as they are.
3. Commit the files that now exist: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs: add product brief and stack profile" --files .planning/PRODUCT-BRIEF.md .planning/STACK-PROFILE.md .planning/config.json`
4. Report the exit code of the final `project diff` and the `files` report of the deploy, both from section 5.6.

On any failure to load the workflow, follow @~/.claude/get-shit-done/references/dispatcher-contract.md: STOP, do not improvise, report what failed and what state was written.
</process>
