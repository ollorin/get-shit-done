Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
{{TASK_BRIEF}}

The shared stack (Supabase, Docker, integration tests, Charlotte, db reset, preflight) is unavailable in this run. Any step that needs it must be reported as NOT RUN, never as passed. Cite file:line for every claim; mark anything untraced "unverified" with the exact probe that would settle it.
PROMPT>>>
