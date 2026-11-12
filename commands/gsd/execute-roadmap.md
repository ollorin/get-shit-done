---
name: gsd:execute-roadmap
description: Execute the entire roadmap unattended: a lean orchestrator spawns a fresh phase coordinator per phase
argument-hint: "[--auto] [--retry-parked] [--legacy]"
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
Execute the full ROADMAP.md. The orchestrator stays lean: it loops over `gsd-tools roadmap next` and `roadmap record`, spawning a fresh coordinator per phase; completion is decided on disk. Interactive use confirms before starting (AskUserQuestion); with `--auto`, or any other source of `auto_mode`, nothing is asked: see @~/.claude/get-shit-done/references/auto-mode.md.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-roadmap.md
</execution_context>

<context>
**Version-skew check:** Before executing, read `~/.claude/cache/gsd-skew-check.json` if it exists. If `drifted_count > 0`, the installed GSD copy has drifted from its source: warn (name the drifted files if listed) and log it. Auto (auto_mode, references/auto-mode.md K1): warn and log, never stop. Interactively, you may stop to re-run the installer before proceeding.

@.planning/ROADMAP.md
@.planning/STATE.md
</context>

<process>
Execute the execute-roadmap workflow from @~/.claude/get-shit-done/workflows/execute-roadmap.md end-to-end.
Preserve all workflow gates (confirmation when interactive, dependency checking by `roadmap next`, checkpoint handling, completion recorded by `roadmap record`).

On any failure to load or execute the workflow, follow @~/.claude/get-shit-done/references/dispatcher-contract.md — STOP, do not improvise, report what failed and what state was written.
</process>
