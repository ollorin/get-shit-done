---
name: gsd:execute-roadmap
description: Execute entire roadmap autonomously with Opus coordinator spawning fresh sub-coordinators per phase
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
---
<objective>
Execute the full ROADMAP.md autonomously. Coordinator stays lean — parses roadmap, confirms with user, then spawns a fresh sub-coordinator per phase. Each phase gets a clean 200k context window.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-roadmap.md
</execution_context>

<context>
**Version-skew preflight:** Before executing, read `~/.claude/cache/gsd-skew-check.json` if it exists. If `drifted_count > 0`, the installed GSD copy has drifted from its source — warn the user (name the drifted files if listed) and offer to stop and re-run the installer before proceeding.

@.planning/ROADMAP.md
@.planning/STATE.md
</context>

<process>
Execute the execute-roadmap workflow from @~/.claude/get-shit-done/workflows/execute-roadmap.md end-to-end.
Preserve all workflow gates (user confirmation, dependency checking, checkpoint handling, completion logging).

On any failure to load or execute the workflow, follow @~/.claude/get-shit-done/references/dispatcher-contract.md — STOP, do not improvise, report what failed and what state was written.
</process>
