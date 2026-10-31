Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
<verification_context>
**Phase:** {{PHASE_NUMBER}} ({{PHASE_NAME}})

{{TASK_BRIEF}}

<files_to_read>
- {{PLAN_FILE}} (Plan to verify)
- .planning/ROADMAP.md (Roadmap)
- .planning/STATE.md (State)
- .planning/REQUIREMENTS.md (Requirements, if present)
- the phase directory {{PHASE_DIR}}: CONTEXT and RESEARCH files if present
</files_to_read>

**Project instructions:** Read ./CLAUDE.md if exists — verify plans honor project guidelines
**Project skills:** Check .claude/skills/ directory (if it exists) — verify plans account for project skill rules
Read-only: do not edit any file. The shared stack is unavailable in this run.
</verification_context>

<expected_output>
- ## VERIFICATION PASSED — all checks pass
- ## ISSUES FOUND — structured issue list (id, severity, location file:line, mechanism, fix)
- ## Defect Classes — in BOTH returns (table of class, instance, caught_by, severity, rule_gap; or exactly `None found. (reviewed by: plan-check)`)
</expected_output>
PROMPT>>>
