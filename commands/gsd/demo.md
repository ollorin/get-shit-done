---
name: gsd:demo
description: Script or record a CEO demo for a phase, or roll up a milestone's demos
argument-hint: "<phase> [script|record] | rollup"
allowed-tools:
  - Read
  - Bash
  - Agent
  - Task
  - mcp__telegram__send_message
---

<objective>
Produce `{phase_dir}/{padded_phase}-DEMO.md` (+ `demo/` evidence) for $ARGUMENTS, or the milestone rollup.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/demo.md
</execution_context>

<process>
Follow the demo workflow. `script` (default) needs no stack. `record` runs only when you hold the project's stack lock for the whole recording; otherwise stop and say so. `rollup` covers every phase of the current milestone that has a DEMO.md.
</process>
