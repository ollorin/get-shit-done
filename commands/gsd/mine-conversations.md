---
name: gsd:mine-conversations
description: Mine Claude Code project conversations to extract decisions, reasoning patterns, and meta-knowledge
argument-hint: [--max-age-days N] [--limit N] [--include-subagents] [--all-projects]
allowed-tools:
  - Read
  - Bash
  - Task
---

<objective>
Mine Claude Code conversation JSONL files to extract knowledge (decisions, reasoning patterns, meta-knowledge) and store results in the project knowledge database.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/mine-conversations.md
</execution_context>

<process>
**Follow the mine-conversations workflow** from `@~/.claude/get-shit-done/workflows/mine-conversations.md`.

The workflow handles all logic including:
1. Discovering conversation JSONL files ready for mining
2. Spawning Haiku subagents for each extraction type
3. Storing results via store-conversation-result
4. Skipping already-analyzed conversations
5. Reporting a summary of stored, evolved, skipped, and failed results
</process>
