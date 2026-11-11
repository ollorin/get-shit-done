<purpose>
Give the CEO a demo of what a phase (or a milestone) delivers: Markdown with real screenshots, plus a video. Agent: `gsd-demo`. Checker: `DC` = `node "$HOME/.claude/get-shit-done/bin/demo-check.js"`. A demo is not QA and never sets `charlotte_qa_ran`.
</purpose>

<modes>
`.planning/config.json` `demo.mode` (read with `gsd-tools.js config get demo.mode --raw`; absent = `milestone`):

| mode | at phase end (no stack) | recording |
|---|---|---|
| `milestone` | script | all scripted phases in the milestone-end stack window |
| `phase` | script | in the phase's own Charlotte window, right after its QA run |
| `off` | nothing | nothing |

A phase gets a demo only when `gsd-tools.js verify phase-gate {N}` reports `charlotte_qa_required: true` (it touched UI or API paths) and its VERIFICATION status is `passed`.
</modes>

<process>

## 1. Script (phase end, no stack, about one Haiku call)

```
Agent(subagent_type="gsd-demo", model="haiku", description="Demo script phase {N}",
  prompt="mode=script phase_dir={phase_dir}")
```

Result on disk: `{phase_dir}/demo/scenario.json` and `{phase_dir}/{padded_phase}-DEMO.md` with `demo_recorded: false`. Verify with `DC check {phase_dir}` (exit 0, `"recorded":false`); commit both with the phase's docs. `no_demo` is a valid return: log the reason, write nothing.

## 2. Record (stack window only)

Preconditions, all checked by the caller, never by the demo agent: the project's stack lock is held by this caller for the whole recording; app and API answer; no db reset and no other Charlotte run during it; fixture accounts named in `scenario.accounts` exist (provision through the project's API fixture path). One recording at a time: Charlotte drives one browser.

```
Agent(subagent_type="gsd-demo", model="haiku", description="Record demo phase {N}",
  prompt="mode=record phase_dir={phase_dir} lock_file={project stack-lock owner file}")
```

Then, yourself:

```bash
DC check {phase_dir}      # exit 0 and "recorded":true, or the demo does not exist
git add {phase_dir}/demo/scenario.json {phase_dir}/demo/steps.jsonl {phase_dir}/demo/manifest.json {phase_dir}/demo/shots {phase_dir}/*-DEMO.md
```

- `check` non-zero: do not commit, do not notify; re-record once, then report the errors.
- `result: failed` with a passing check is a real finding (the product did not do what the phase claims): the DEMO.md is committed as is and the failed step goes to the phase's gap list. Never re-script a step to make it pass.
- `blocked`: the script-only DEMO.md stays; report why.
- Videos are not committed (`**/demo/video/` in `.gitignore`); their path, size and sha256 are in the manifest.

## 3. Milestone rollup (after the last recording)

```bash
DC rollup {phase_dir_1} {phase_dir_2} ... --out .planning/demos/{milestone}-DEMO.md
```

Exit 1 = some phase's demo fails its check: fix or re-record before reporting. Print to the chat: the first three lines of the rollup file, its path, and the video paths.

</process>

<limits>
Per phase: at most 15 steps, 400 KB per screenshot, 4 MB of screenshots, 25 MB of video, 5 minutes per recording (Charlotte auto-stops). `DC check` enforces the first four.
</limits>
