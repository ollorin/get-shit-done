# Model Profiles

Model profiles control which Claude model each GSD agent uses. This allows balancing quality vs token spend.

## Profile Definitions

| Agent | `quality` | `balanced` | `budget` |
|-------|-----------|------------|----------|
| gsd-planner | opus | opus | sonnet |
| gsd-roadmapper | opus | sonnet | sonnet |
| gsd-executor | opus | haiku | haiku |
| gsd-phase-researcher | opus | sonnet | haiku |
| gsd-project-researcher | opus | sonnet | haiku |
| gsd-research-synthesizer | sonnet | sonnet | haiku |
| gsd-debugger | opus | sonnet | sonnet |
| gsd-codebase-mapper | sonnet | haiku | haiku |
| gsd-verifier | opus | opus | opus |
| gsd-plan-checker | sonnet | sonnet | haiku |
| gsd-integration-checker | sonnet | sonnet | haiku |
| gsd-test-writer | sonnet | haiku | haiku |
| gsd-docs-updater | sonnet | haiku | haiku |
| gsd-phase-coordinator | sonnet | sonnet | sonnet |

## Profile Philosophy

**quality** - Maximum reasoning power
- Opus for all decision-making agents
- Sonnet for read-only verification
- Use when: quota available, critical architecture work

**balanced** (default) - Smart allocation
- Opus only for planning (where architecture decisions happen)
- Haiku for execution and test/doc writing (Opus plans are already decomposed)
- Sonnet for coordinators, research and first-pass review; Opus for the phase verifier
- Use when: normal development, good balance of quality and cost

**budget** - Minimal Opus usage
- Haiku for anything that writes code
- Haiku for research and verification
- Use when: conserving quota, high-volume work, less critical phases

## Resolution Logic

Orchestrators resolve model before spawning:

```
1. Read .planning/config.json
2. Get model_profile (default: "balanced")
3. Look up agent in table above
4. Pass model parameter to Task call
```

## Switching Profiles

Runtime: `/gsd:set-profile <profile>`

Per-project default: Set in `.planning/config.json`:
```json
{
  "model_profile": "balanced"
}
```

## Design Rationale

**Why Opus for gsd-planner?**
Planning involves architecture decisions, goal decomposition, and task design. This is where model quality has the highest impact.

**Why Haiku for gsd-executor?**
Executors follow explicit PLAN.md instructions. The plan already contains the reasoning; execution is implementation. A miss is caught by Sonnet reviews and Opus phase verification; escalate to Sonnet after two failures on the same task.

**Why Opus for the verifier?**
Verification requires goal-backward reasoning - checking if code *delivers* what the phase promised. Sonnet pre-verifies; Opus rules at phase end.

**Why Haiku for gsd-codebase-mapper?**
Read-only exploration and pattern extraction. No reasoning required, just structured output from file contents.
