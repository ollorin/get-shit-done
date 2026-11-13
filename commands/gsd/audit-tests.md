---
name: gsd:audit-tests
description: Audit the whole test suite for tests that cannot fail, duplicated proof and slow shape, per directory or bucket, slowest first
argument-hint: "[<test directory or bucket> ...] [--minutes N]"
allowed-tools:
  - Read
  - Bash
  - Agent
  - Task
---

<objective>
Run the test steward (`agents/gsd-test-writer.md`) over $ARGUMENTS, or over every test directory and bucket the profile defines, slowest first, inside a time box.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/audit-tests.md
</execution_context>

<process>
Follow the audit-tests workflow. It edits tests only, commits per unit, never runs the full suite and never pushes.
</process>
