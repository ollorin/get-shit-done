Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
<objective>
Write the tests for plan {{PLAN_NUMBER}} of phase {{PHASE_NUMBER}} ({{PHASE_NAME}}) as described below. Tests only: do not edit any non-test file.
</objective>

{{TASK_BRIEF}}

Plan: {{PLAN_FILE}}. Test files in scope: {{SCOPE_FILES}}. {{COMMIT_NOTE}}
The shared stack is unavailable in this run; integration tests are out of scope and must be reported NOT RUN.
PROMPT>>>
