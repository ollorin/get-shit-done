Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
Coordinate phase {{PHASE_NUMBER}} ({{PHASE_NAME}}).

{{TASK_BRIEF}}

This is an evaluation harness: the shared stack, Charlotte and the gsd-tools CLI are unavailable, and the executor, verifier, plan-checker, docs-updater, test-writer and review agents you spawn are the project's standard agent names. Spawn them as you normally would (always pass `model`). Return the final JSON state.
PROMPT>>>
