Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
{{TASK_BRIEF}}

The shared stack and the gsd-tools CLI are unavailable in this run. Return the structured contract: written_files, commit, errors (non-empty written_files, or an explicit reason none were needed).
PROMPT>>>
