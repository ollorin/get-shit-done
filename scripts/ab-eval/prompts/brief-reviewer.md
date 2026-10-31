Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
Review a change for defects. Read-only: do not edit, commit, or run anything that changes the tree.

{{TASK_BRIEF}}

The change under review is in `.review/change.diff` (the snapshot is checked out at the commit that contains it).
Files in scope: {{SCOPE_FILES}}.
The shared stack (Supabase, Docker, integration tests, Charlotte, db reset, preflight) is unavailable in this run; report anything that needs it as NOT RUN.
Cite file:line for every finding; mark anything you could not trace "unverified" with the probe that would settle it. Report findings answer-first with severity (critical, major, minor), the mechanism, and the fix.
PROMPT>>>
