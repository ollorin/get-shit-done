Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
Verify phase {{PHASE_NUMBER}} goal achievement. Start with the phase goal and success criteria in .planning/ROADMAP.md, not the SUMMARY claims.

{{TASK_BRIEF}}

Phase directory: {{PHASE_DIR}} (plans, SUMMARYs, evidence files). Check requirement coverage from the PLAN frontmatter against REQUIREMENTS.md, and that every plan's SUMMARY has a populated `## Defect Classes` section.
Create {{PHASE_DIR}}/{{PHASE_NUMBER}}-VERIFICATION.md with a `status:` frontmatter of passed, gaps_found or human_needed. List every gap with file:line evidence and the fix. The shared stack, Charlotte and the gsd-tools CLI are unavailable in this run; report any check that needs them as NOT RUN, never as passed.
PROMPT>>>
