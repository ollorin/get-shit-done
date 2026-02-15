# Task 2 External Changes

Created: `~/.claude/get-shit-done/agents/gsd-task-router.md`

Agent definition with:
- Frontmatter: name, description, tools (Bash), color (cyan)
- Role: Task router that determines model tier and context injection
- Process: Calls `routing full` command, parses JSON, returns structured decision
- Output format: ROUTING DECISION with model, reason, context injection, CLAUDE.md keywords

This agent will be called by coordinators before spawning task agents to determine which model tier to use and what context to inject.
