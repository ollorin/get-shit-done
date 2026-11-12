---
name: User role — the owner managing AI-only development
description: User is the owner of the iGaming platform, who manages development exclusively through Claude agents via GSD workflows. No human developers — all coding, testing, and deployment done by AI agents.
type: user
---

The user is the sole stakeholder (owner) of the iGaming platform. They do NOT write code.

All development is done exclusively by Claude agents orchestrated through GSD workflows:
- User discusses requirements/vision with agent → PRD (gsd:prd)
- PRD fed to agent → milestone, phases, roadmap (gsd:new-milestone)
- Another agent executes the roadmap as orchestrator, spawning subagents per phase (gsd:execute-roadmap)

**How to apply:** Never frame user stories around "developer wants to..." — frame them around what the AI agent system needs to do autonomously, and what the user (stakeholder) needs to review/decide. The user's interaction is at the strategic level (approve PRDs, review results, set priorities), not at the code level.
