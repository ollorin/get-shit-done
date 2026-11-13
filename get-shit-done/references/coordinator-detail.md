# gsd-phase-coordinator.md: dispatch detail

The phase coordinator is a thin dispatcher. It follows the workflows for planning and execution inline (Read the file, follow it; no nested agent per workflow, depth stays roadmap -> coordinator -> role agents) and keeps only four things of its own: context-budget monitoring, the dispatch table, the autonomous discuss step (the one step with no workflow twin) and the mapping from execute-phase's JSON trailer to the return JSON.

<execution_cycle>

<context_budget_monitoring>

## Context budget monitoring

Check context use at the start of each major step (discuss, plan, execute, verify). When the runtime does not expose it, estimate 5-10% per major step completed; when it cannot be determined, default to 0% and proceed.

| Threshold | Action |
|---|---|
| >= 60% | Compressed output: bullets only, no narration, no optional diagnostics. Log once: `{"type":"context_budget","event":"compressed_mode","phase":{N},"usage_pct":{pct}}` through `execution-log event`. |
| >= 60% right after the plan step | Do not start execute. Write the `plan` checkpoint, return `{"status":"completed_with_deferrals","deferred":["execute"],"reason":"context_budget_exceeded","handoff_summary":"..."}`. The orchestrator respawns a fresh coordinator that resumes at execute. |
| >= 80% before verify is done | Write the checkpoint with `resume_from` set to the next step and return `status: "completed_with_deferrals"` with `deferred` listing what remains (`verify`, `ui_qa`), `reason: "context_budget_exceeded"` and a `handoff_summary` (phase goal, key decisions, steps completed, files modified). Do not record UI QA evidence yourself: `ui_qa_ran` is written by the verifier into `{N}-VERIFICATION.md`. |

Do not power through the remaining steps at 80%: an overflow mid-verify produces partial artifacts the orchestrator may accept as valid. Returning early with explicit deferrals is always better than silent truncation. A deferred step is picked up by a fresh agent in this same run; accepting a genuinely missing artifact is a mandatory-step skip and needs `gsd-tools.js deferred add {phase} --step <step> --reason <reason> --approver <approver>`. `verify phase-gate {phase}` stays the blocking authority for artifact existence.

</context_budget_monitoring>

## Dispatch table

Set `$ARGUMENTS` yourself and pass `--auto` to every `init` call: without it execute-phase and plan-phase clear the chain flag. Every spawn prompt in a followed workflow also carries `auto: true` and `legacy: true` when the run is legacy. Models come from `init plan-phase` (planner, checker, researcher) and `init execute-phase` (executor, verifier, `ruling_model`, `utility_model`, `reviewer_model`); never write a model literal.

| Step | Read and follow | `$ARGUMENTS` | Stop condition |
|---|---|---|---|
| discuss (only when there is no `*-CONTEXT.md`) | the autonomous discuss step below | n/a | CONTEXT.md committed |
| plan | `@get-shit-done/workflows/plan-phase.md`, steps 1-13 | `{N} --auto --no-advance [--legacy]` | step 14 returns the `planned` trailer and does not launch execute-phase |
| execute and verify | `@get-shit-done/workflows/execute-phase.md` | `{N} --auto --no-transition [--legacy]` | the `--no-transition` completion trailer; do not run transition |
| gap closure (at most one cycle) | plan-phase, then execute-phase | `{N} --gaps --auto --no-advance`, then `{N} --gaps-only --auto --no-transition` | still `gaps_found` after the cycle: return it |

Checkpoints: write `CHECKPOINT.json` for the discuss and plan steps with `gsd-tools phase checkpoint {N} --step <discuss|plan> --status <complete|skipped|failed>` (the single writer of that file; execute-phase writes the `verify` checkpoint itself). Never hand-write it, and never call `phase complete`: execute-phase calls it, and you return `completed` only when its trailer says so.

Skip rules: when a PLAN.md set already exists on disk, skip discuss and plan (checkpoint `skipped`) and start at execute; when every plan has a SUMMARY.md and VERIFICATION.md exists, run execute-phase anyway: it re-verifies and owns the result.

A plan step that returns `failed`, a malformed trailer or `plan_count: 0` is a `failed` return with `step: "plan"`. Do not enter execute.

<step name="harvest_knowledge">
Off unless `knowledge.harvest` is true in `.planning/config.json` (`gsd-tools config get knowledge.harvest --raw --default false`): it reads other projects' sessions, which a generic run must not do. When enabled, run `gsd-tools mine-conversations --all-projects --max-age-days 3 --limit 5`, hand each returned `extractionRequests[]` prompt to one `{utility_model}` agent (`subagent_type="general-purpose"`, `max_turns=15`) and store the outputs with `gsd-tools store-conversation-result "{sessionId}" '{resultsJson}' --content-hash "{contentHash}"`. Every failure is logged and skipped; the step never blocks the phase.
</step>

<step name="discuss">
The only step with no workflow twin: `workflows/discuss-phase.md` is driven by questions to the owner, and plan-phase proceeds without CONTEXT in auto mode. It runs before plan and writes `{padded_phase}-CONTEXT.md`.

```bash
ls .planning/phases/{phase_dir}/*-CONTEXT.md 2>/dev/null || echo "NO_CONTEXT"
```

**CONTEXT.md exists:** `phase checkpoint {N} --step discuss --status skipped`, log "Discuss step skipped", go to plan.

**Otherwise:**

1. `gsd-tools roadmap get-phase {phase_number}` gives the goal, requirements and success criteria.
2. Name 3-5 phase-specific gray areas: concrete implementation concerns (for example "answer confidence threshold", never "UI" or "behavior"), distinct from each other. Pick the lens by what the phase delivers: agent (interface contracts, modes, errors, output format), CLI (flags, output, recovery, verbosity), workflow (sequencing, skip conditions, state, failure handling), schema/data (fields, relationships, migration, naming).
3. Drop every gray area the decision ledger already answers (`node "$HOME/.claude/get-shit-done/bin/decisions.js" list --phase {phase_number}`, contract `@get-shit-done/references/decisions-protocol.md`): its `D-`/`A-` line goes into CONTEXT.md's decisions verbatim with the id and no questions are generated for it.
4. For each remaining gray area write 10 questions (simple) to 20 (complex), at three levels: high (pattern or approach), mid (parameters), low (edge case). Each is `{gray_area, question, specificity}`. Reason inline; no subagent.
5. Spawn one answerer for all questions:

```
Agent(
  subagent_type="gsd-meta-answerer",
  model="{utility_model}",
  description="Answer phase {phase_number} questions",
  max_turns=15,
  prompt="<phase_context>Phase: {phase_number}\nGoal: {phase_goal}\nRequirements: {requirements_list}</phase_context>\n<questions>{questions_json_array}</questions>"
)
```

6. Evaluate each answer: `confidence >= 0.7` and not `no_results` and no `error` is `sufficient`; everything else is `needs-escalation`.
7. Sensitivity check. Nothing in discuss blocks on a human. A needs-escalation item is `ruling` when it is on the trigger row of `references/rigour.md` (irreversible; legally or financially material; a design choice on a risk-domain path or in `ruling_topics`), `owner` when it is a strategic or business/legal call only the owner can make, and otherwise a `discretion_item`: take the default and log one `A-` row (`decisions.js add --kind assumption --source coordinator-judgment`, its true reversibility; a count, a literal, a name, wording or a cleanup choice is always `cheap`).
8. Route, and never park or wait from discuss:
   - `ruling`: ONE fresh ruling agent for all such items on `{ruling_model}` (a rejected spawn retries once on `{ruling_model_fallback}` and says so in the log). Record it with `decisions.js add --kind decision --source opus-ruling` (phases = this phase) and proceed on it. If no ruling can be obtained, log an assumption with reversibility `costly` and continue on the default.
   - `owner`: `decisions.js add --kind assumption --source unattended --reversibility {true value} --phases {only the consuming phases}` (never `--global` unless every phase consumes it), print the question in the chat, continue on the default. The orchestrator's `gate` parks only the consuming phases, and only when the assumption is `irreversible`. An owner item that also touches a risk domain takes the ruling route first.
   Every routed item goes into CONTEXT.md under Claude's Discretion, citing its `A-`/`D-` id. Append each ruling (confidence 1.0, `source: "opus-ruling"`) to the sufficient answers, and store it in the knowledge DB when `gsd-tools` exposes the writer (non-fatal).
9. `mkdir -p .planning/phases/{phase_dir}`, then write `.planning/phases/{phase_dir}/{padded_phase}-CONTEXT.md` (`phase checkpoint` needs the directory to exist):

```markdown
# Phase {N}: {phase_name} - Context

**Gathered:** {current_date}
**Source:** Autonomous (gsd-meta-answerer)
**Status:** Ready for planning

<domain>
## Phase Boundary
{phase goal from ROADMAP.md, verbatim}
</domain>

<decisions>
## Implementation Decisions
{per gray area: "### {name}" then "- {question}: {answer} (confidence: {c})" for each sufficient answer}

### Claude's Discretion
{discretion items, each citing its A-/D- id where it has one}

### Escalated Decisions (Ruled)
{each ruled item: "- {question}: {answer} (ruled by {ruling_model})"; omit when none}
</decisions>

<specifics>
## Specific Ideas
{concrete examples or patterns from the sufficient answers, else "No specific requirements: open to standard approaches"}
</specifics>

<deferred>
## Deferred Ideas
{needs-escalation items below 0.7 that were queued in the ledger, else "None: all gray areas resolved autonomously"}
</deferred>

---
*Phase: {padded_phase}-{phase_slug}*
*Context gathered: {current_date}*
*KB answers: {sufficient_count} | Claude's Discretion: {discretion_count} | Escalated: {escalated_count}*
```

10. Commit: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs({padded_phase}): autonomous discuss step, write phase context" --files ".planning/phases/{phase_dir}/{padded_phase}-CONTEXT.md"`, then `phase checkpoint {N} --step discuss --status complete`.
</step>

## Return mapping

Execute-phase ends with a fenced JSON trailer as its last content: `{"status": "completed"|"gaps_found"|"human_needed"|"blocked"|"failed", "phase": "{N}", "completed_plans": n, "total_plans": n}`. Parse that block, never the prose header. Map it to your return (the shape is in `<return_state>` of the agent file):

| Trailer `status` | Your return | Notes |
|---|---|---|
| `completed` | `completed`, only when `{N}-VERIFICATION.md` has `status: passed` on disk and the trailer says `phase complete` exited 0 | otherwise return `gaps_found` or `failed`; never "completed" on a claim |
| `gaps_found` | run the one gap-closure cycle from the dispatch table; if the trailer is still `gaps_found`, return `gaps_found` with the gaps from VERIFICATION.md and `gap_cycle_done: true` | the orchestrator then parks the phase (without a second cycle once CLI-6 lands) |
| `blocked` with `reason: budget_exceeded` or `form_gate` | `blocked`, same reason, with the owner report | no gap cycle, no retry; dependents are not parked for `form_gate` |
| `human_needed` | `human_needed` with `human_items` | a human-only item is never auto-resolved |
| `blocked` | `blocked` with `reason` | `reason: "parked"` when a decision gate parked it |
| `failed`, or no parseable trailer | `failed` with `step` and `error` | a trailer-less return that looks like a session or quota death is returned as is: the orchestrator's death handling reads it |
| a dispatch that returned before finishing for context | `completed_with_deferrals` | per the budget table |

Every return also carries the telemetry fields of `<return_state>`.

<handoff_brief>
Executors and verifiers are spawned by execute-phase, which assembles the fixed 5-section handoff brief (phase goal, key decisions, open risks, file map, hard rules) per `@get-shit-done/references/handoff-brief.md`. Your own contribution is the `key decisions` and `open risks` text: take them from CONTEXT.md and from the plan-checker's unresolved issues, never from memory.
</handoff_brief>

</execution_cycle>

<cost_and_test_commands>
**Test cost:** one full run of every gate in `stack.gates[]` and `stack.commands.pre_pr_gate` per phase, on the final tree before the final phase review; the twice-green pass runs once at phase end. Executors and test writers run affected files plus one bucket. See gsd-test-protocol.md `test_cost_rule`.

**Context and reporting cost:** the executor tier is cheaper with context under ~100k tokens: size each executor task small (one plan task / one finding batch), read line ranges not whole files, save test logs to `.tmp/` and read only failing lines, fresh agent per task. All agents report answer-first, up to 10 lines.

**Run tests only through `stack_commands` (`test_file`, `test_all`), verbatim; never retype a command.** No inline env vars, no `| tail/grep`, no `;`/extra `&&`, no `$()`/heredocs/`bash -c`. If a command prompts, stop and report the exact string.
</cost_and_test_commands>
