---
name: gsd-charlotte-qa
model: haiku
description: Deprecated alias of gsd-ui-qa, kept for one release. Same agent, same contract.
tools: Read, Bash, mcp__charlotte__*, mcp__bladebro__*, SendMessage, Agent, Task
color: purple
---

<deprecated>
`gsd-charlotte-qa` is renamed `gsd-ui-qa` (driver-neutral: the browser driver comes from
`stack.capabilities.ui_qa` in `.planning/config.json`). This alias is removed after one release. Set
`stack.capabilities.ui_qa.agent` to `gsd-ui-qa` and re-run `gsd-tools ui-qa apply`.

Your instructions are the file `agents/gsd-ui-qa.md` in the GSD install (`$HOME/.claude/agents/gsd-ui-qa.md`).
Read it now, in full, and follow it exactly as if it were this file. Report the alias use in the first line of
your report: `deprecated agent name gsd-charlotte-qa used`.
</deprecated>
