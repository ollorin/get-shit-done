# UI QA Exemptions

Applies to every phase in a project with a web frontend. Gated: deployed only when the profile's `stack.capabilities.web_ui` is an object. The frontend directories are `stack.paths.frontends`; the UI QA driver is the project's (`stack.capabilities.ui_qa`).

## Rule: Infrastructure-Only Phases

UI QA is exempt for phases that:

1. Produce ZERO .tsx/.jsx files in the frontend directories (`stack.paths.frontends`)
2. Produce ONLY infrastructure artifacts: shell scripts, CI/CD YAML, JSON registries, Bash helpers, Markdown documentation, config files
3. Have no impact on frontend rendering, navigation, state, or UX

### Examples (UI QA exempt):
- A test-runner phase: creates a runner script, updates the CI workflow, creates docs and registries
- Testing infrastructure improvements: new test runners, CI configurations, test utilities
- Backend build optimization: bundler configs, transpiler improvements, no UI impact

### Examples (UI QA required):
- Any phase creating or modifying files under the frontend directories
- Any phase modifying API endpoints consumed by existing frontend (existing UI must still work)
- Any phase adding new pages, modifying forms, changing navigation, adding modals
- Any phase that could cause visual regression in the web apps

## How to Apply

1. **During planning**: When planning a phase, check if any .tsx/.jsx files are created/modified
2. **If YES**: Include `checkpoint:ui-qa` in the plan
3. **If NO**: Check if ANY files modified could impact existing frontend (API response shape changes, auth changes, etc.)
   - If existing UI could break: Include `checkpoint:ui-qa`
   - If pure infrastructure: Emit `ui_qa_ran: false` in SUMMARY.md with justification
4. **In verification**: If UI QA is skipped, set `ui_qa_ran: false` with a one-line reason

## Verification Language

When skipping UI QA for infrastructure phases, use:

```
ui_qa_ran: false  # Infrastructure phase — no .tsx/.jsx files produced
```

This signals to the verifier that the exemption rule was applied, not forgotten.
