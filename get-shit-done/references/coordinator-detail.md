# gsd-phase-coordinator.md: dispatch detail

The phase coordinator is a thin dispatcher. It follows the workflows for planning and execution inline (Read the file, follow it; no nested agent per workflow, depth stays roadmap -> coordinator -> role agents) and keeps only three things of its own: the dispatch table, the autonomous discuss step (the one step with no workflow twin) and the mapping from execute-phase's JSON trailer to the return JSON.

<execution_cycle>

<context_and_checkpoints>

## Context and checkpoints

Work the phase until it is done. Context fill is never a reason to stop, defer a step or hand back: a full window is handled by auto-compaction (`autoCompactWindow` in this agent's frontmatter). Hand back only when the phase is finished, on a real blocker (a denial, an owner gate, a tool failure) or on a failure the ladder says to park. Write the checkpoint at every step and plan boundary all the same: crash recovery needs it. A coordinator that dies is re-dispatched fresh from on-disk state (checkpoints, SUMMARY/VERIFICATION files, resume brief), never resumed by message. `gsd-tools context-usage` stays available as a measurement (`verdict.compaction_near`); it never tells you to hand back. Do not record UI QA evidence yourself: `ui_qa_ran` is written by the verifier into `{N}-VERIFICATION.md`. Accepting a genuinely missing artifact is a mandatory-step skip and needs `gsd-tools.js deferred add {phase} --step <step> --reason <reason> --approver <approver>`. `verify phase-gate {phase}` stays the blocking authority for artifact existence.

</context_and_checkpoints>

<waiting_on_children>

## Waiting on children

After spawning a child, end your turn. Its `SubagentHandback` (or task notification) wakes you: read its return, verify its artifacts on disk, close it with `dispatch end`, then take the next step. Wait for every child of a wave before the wave's next step. Never run `sleep` or grep loops on a child's output file; a child silent for 45+ minutes is stalled (TaskStop, then re-dispatch). A notification whose summary says the agent "is waiting on its own background work", or whose note says the result may be interim, is not a handback: do not verify it or run `dispatch end`; end your turn again, the same task-id notifies again. With each wait start one `run_in_background` timer of 2700 s; its exit wakes you to check the child's output mtime (stalled rule, 45 min). A turn that ends while a child still runs is a wait, not a finish: the phase result is returned only after every child is closed.

</waiting_on_children>

## Dispatch table

Set `$ARGUMENTS` yourself and pass `--auto` to every `init` call: without it execute-phase and plan-phase clear the chain flag. Every spawn prompt in a followed workflow also carries `auto: true` and `legacy: true` when the run is legacy. Models come from `init plan-phase` (planner, checker, researcher) and `init execute-phase` (executor, verifier, `ruling_model`, `utility_model`, `reviewer_model`); never write a model literal.

| Step | Read and follow | `$ARGUMENTS` | Stop condition |
|---|---|---|---|
| discuss (only when there is no `*-CONTEXT.md`; never at `spike`) | the autonomous discuss step below | n/a | CONTEXT.md committed |
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
7. Sensitivity check. Nothing in discuss blocks on a human. A needs-escalation item is `ruling` when it is on the trigger row of `references/rigour.md` (irreversible; legally or financially material; a design choice on a risk-domain path or in `ruling_topics`), `owner` when it is a strategic or business/legal call only the owner can make, and otherwise a `discretion_item`: take the default and log one `A-` row (`node "$HOME/.claude/get-shit-done/bin/decisions.js" add --kind assumption --source coordinator-judgment`, its true reversibility; a count, a literal, a name, wording or a cleanup choice is always `cheap`).
8. Route, and never park or wait from discuss:
   - `ruling`: ONE fresh ruling agent for all such items on `{ruling_model}` (a rejected spawn retries once on `{ruling_model_fallback}` and says so in the log). Record it with `node "$HOME/.claude/get-shit-done/bin/decisions.js" add --kind decision --source opus-ruling` (phases = this phase) and proceed on it. If no ruling can be obtained, log an assumption with reversibility `costly` and continue on the default.
   - `owner`: `node "$HOME/.claude/get-shit-done/bin/decisions.js" add --kind assumption --source unattended --reversibility {true value} --phases {only the consuming phases}` (never `--global` unless every phase consumes it), print the question in the chat, continue on the default. The orchestrator's `gate` parks only the consuming phases, and only when the assumption is `irreversible`. An owner item that also touches a risk domain takes the ruling route first.
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
| `gaps_found` | run the one gap-closure cycle from the dispatch table; if the trailer is still `gaps_found`, return `gaps_found` with the gaps from VERIFICATION.md and `gap_cycle_done: true` | the orchestrator then parks the phase without a second cycle |
| `blocked` with `reason: budget_exceeded` | `blocked`, same reason, with the owner report | no gap cycle, no retry |
| `human_needed` | `human_needed` with `human_items` | a human-only item is never auto-resolved |
| `blocked` | `blocked` with `reason` | `reason: "parked"` when a decision gate parked it |
| `failed`, or no parseable trailer | `failed` with `step` and `error` | a trailer-less return that looks like a session or quota death is returned as is: the orchestrator's death handling reads it |

Every return also carries the telemetry fields of `<return_state>`.

<handoff_brief>
Executors and verifiers are spawned by execute-phase, which assembles the fixed 5-section handoff brief (phase goal, key decisions, open risks, file map, hard rules) per `@get-shit-done/references/handoff-brief.md`. Your own contribution is the `key decisions` and `open risks` text: take them from CONTEXT.md and from the plan-checker's unresolved issues, never from memory.
</handoff_brief>

</execution_cycle>

<cost_and_test_commands>
**Test cost:** exactly one full run per phase (every gate in `stack.gates[]` plus the full tests, into `captures/gates.txt`), on the final tree before any review; the twice-green pass runs once at milestone end. Executors and fix loops run affected files plus one bucket. See gsd-test-protocol.md `test_cost_rule`.

**Context and reporting cost:** the executor tier is cheaper with context under ~100k tokens: size each executor task small (one plan task / one finding batch), read line ranges not whole files, save test logs to `.tmp/` and read only failing lines, fresh agent per task. All agents report answer-first, up to 10 lines.

**Run tests only through `stack_commands` (`test_file`, `test_all`), verbatim; never retype a command.** No inline env vars, no `| tail/grep`, no `;`/extra `&&`, no `$()`/heredocs/`bash -c`. If a command prompts, stop and report the exact string.
</cost_and_test_commands>
