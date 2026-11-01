Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
<objective>
Execute plan {{PLAN_NUMBER}} of phase {{PHASE_NUMBER}}-{{PHASE_NAME}}.
Commit each task atomically. Create SUMMARY.md. Update STATE.md and ROADMAP.md.
</objective>

<scope>
Execute ONLY these tasks of the plan: {{TASK_NAMES}}. Other tasks of the plan are out of scope; do not execute or edit them.
Files in scope: {{SCOPE_FILES}}.{{SCOPE_NOTE}}
The shared stack (Supabase, Docker, integration tests, Charlotte, db reset, preflight) is unavailable in this run. Any step that needs it must be reported as NOT RUN, never as passed.
</scope>

<execution_context>
@.gsd-eval/execute-plan.md
@.gsd-eval/summary.md
@.gsd-eval/checkpoints.md
@.gsd-eval/tdd.md
</execution_context>

<files_to_read>
Read these files at execution start using the Read tool:
- {{PLAN_FILE}} (Plan)
- .planning/STATE.md (State)
- .planning/ROADMAP.md (Roadmap)
- .planning/config.json (Config, if exists)
- ./CLAUDE.md (Project instructions, if exists — follow project-specific guidelines and coding conventions)
- .claude/skills/ (Project skills — list skills, read SKILL.md for each, follow relevant rules during implementation)
</files_to_read>

<success_criteria>
- [ ] Scoped tasks executed
- [ ] Each task committed individually
- [ ] SUMMARY.md created in plan directory
- [ ] `## Defect Classes` present in SUMMARY.md (rows, or an explicit `None found. (reviewed by: …)`)
- [ ] STATE.md updated with position and decisions
- [ ] ROADMAP.md updated with plan progress
</success_criteria>
PROMPT>>>
