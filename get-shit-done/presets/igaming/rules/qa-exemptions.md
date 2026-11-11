---
paths:
  - ".planning/**"
---

# Charlotte QA Exemption Rules

Applies to: All phases in projects with web frameworks (React, Next.js, Vue, etc.)

---

## Rule: Infrastructure-Only Phases

Charlotte QA is exempt for phases that:

1. Produce ZERO .tsx/.jsx files in frontend application directories (apps/player-web/, apps/operator-web/)
2. Produce ONLY infrastructure artifacts: shell scripts, CI/CD YAML, JSON registries, Bash helpers, Markdown documentation, config files
3. Have no impact on frontend rendering, navigation, state, or UX

### Examples (Charlotte QA exempt):
- Phase 235 (Parallel Runner): Creates scripts/run-integration-tests.sh, updates .github/workflows/pr-validation.yml, creates docs and registries
- Testing infrastructure improvements: New test runners, CI configurations, test utilities
- Backend build optimization: Bundler configs, transpiler improvements, no UI impact

### Examples (Charlotte QA required):
- Any phase creating/modifying apps/player-web/** or apps/operator-web/** files
- Any phase modifying API endpoints consumed by existing frontend (existing UI must still work)
- Any phase adding new pages, modifying forms, changing navigation, adding modals
- Any phase that could cause visual regression in the web apps

## How to Apply

1. **During planning**: When planning a phase, check if any .tsx/.jsx files are created/modified
2. **If YES**: Include `checkpoint:ui-qa` in the plan
3. **If NO**: Check if ANY files modified could impact existing frontend (API response shape changes, auth changes, etc.)
   - If existing UI could break: Include `checkpoint:ui-qa`
   - If pure infrastructure: Emit `charlotte_qa_ran: false` in SUMMARY.md with justification
4. **In verification**: If Charlotte QA is skipped, set `charlotte_qa_ran: false` with a one-line reason

## Verification Language

When skipping Charlotte QA for infrastructure phases, use:

```
charlotte_qa_ran: false  # Infrastructure phase — no .tsx/.jsx files produced
```

This signals to the verifier that the exemption rule was applied, not forgotten.

---

*Exemption rule established: Phase 235 Gap Closure*
