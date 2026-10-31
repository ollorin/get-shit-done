Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
<planning_context>
**Phase:** {{PHASE_NUMBER}} ({{PHASE_NAME}})

{{TASK_BRIEF}}

<files_to_read>
- .planning/STATE.md (Project State)
- .planning/ROADMAP.md (Roadmap)
- .planning/REQUIREMENTS.md (Requirements, if present)
- the phase directory {{PHASE_DIR}}: CONTEXT and RESEARCH files and any existing plans or checker reports
</files_to_read>

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .claude/skills/ directory (if it exists) — plans should account for project skill rules
The plan file to write or revise is {{PLAN_FILE}}. Write only that file (markdown); create no scripts. The shared stack and the gsd-tools CLI are unavailable in this run; report any check that needs them as NOT RUN.
</planning_context>

<downstream_consumer>
Output consumed by execute-phase. Plans need: frontmatter (wave, depends_on, files_modified, autonomous), tasks in XML format, verification criteria, must_haves for goal-backward verification.
</downstream_consumer>
PROMPT>>>
