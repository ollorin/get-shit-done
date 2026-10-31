Make exactly one Agent call: `subagent_type: {{SUBAGENT_TYPE}}`, `model: {{MODEL}}`, `run_in_background: false`, description `{{DESCRIPTION}}`, prompt = the block between the lines `<<<PROMPT` and `PROMPT>>>` below, verbatim. When it returns, print its final report verbatim and stop.

<<<PROMPT
<qa_request>
**Mode:** {{MODE}}

{{TASK_BRIEF}}

Serve the fixture app with `charlotte_dev_serve` on the directory `qa-fixture/qa-app` and test it from the served URL. The shared stack is unavailable. Return the structured result described by your output format.
</qa_request>
PROMPT>>>
