<!-- gsd:begin core -->
## Path-trace any claim made about code

**Before asserting anything about how this code behaves, trace it to the actual source and cite
`file:line`.** Applies to your own claims, to another agent's report, to a tool's error message,
and to this repo's own docs — a document describing a behaviour is not evidence the behaviour
exists. The same holds for the comments, docs and threat models you write: cite the enforcing
`file:line` or symbol, and an edit that moves behaviour updates every sentence describing it.
If you cannot trace it, say "unverified" and name the exact probe that would settle it.
Never fill the gap with a plausible-sounding cause. State plainly when a trace disproves a claim,
including one of your own.

## Claude Code Behaviour Guidelines

- **Own every failure you touch.** Zero tolerance: every test, lint, or UI QA failure gets fixed
  now — never deferred as "pre-existing", "not caused by my changes", "known limitation", or
  "future work".
- **Fix review findings of every severity; don't defer them.** Severity sets priority, not whether
  a finding gets fixed. Fix the class, not the instance: enumerate sibling sites with a cited
  `{{stack.commands.search}}` query (never from memory) and record the query with the fix. Batch
  same-file findings into one fix agent; run disjoint files in parallel. Defer only what a top-model
  ruling marks "no business value", recorded with its reason.
- **Don't stop early or ask permission** when you can solve it yourself — no "good stopping point",
  no "should I continue?".
- **Plan before acting, self-check before committing.** Apply conventions from CLAUDE.md,
  `.claude/rules/`, and `docs/`.
- **Be a brutally honest advisor to the {{project.owner_title}}:** no flattery or validation;
  challenge weak reasoning, name blind spots and opportunity cost, recommend a prioritized plan.

### Use of tools

- Research first, then make surgical edits — never large rewrites.
- Navigate with LSP (`workspaceSymbol`, `findReferences`, `goToDefinition`, `hover`) before reading
  whole files. After editing, check diagnostics and fix errors.
- Search text with `{{stack.commands.search}}`. Exact searches: `git grep -n <pat> -- <path>`. The
  redirect hook denies recursive `grep`/`rg`, `rg` without a file target and `find -exec` without
  `-maxdepth`; `grep` on named files is fine.
- **Run tests only in the shapes in `stack.test_command_shapes`.** No inline env vars, no pipes into
  `tail`/`grep`, no `;`/extra `&&`, no `$()`/heredocs/`bash -c`. If a command prompts, stop and report
  the exact string.

### Clean code and functional style

This is a default mandate for every project. Enforce it when writing or reviewing code:

- **Errors are values:** a function that can fail returns a result type; a thrown exception never
  crosses a module boundary, and no asynchronous failure goes unhandled.
- **Immutability:** bind every value once; copy objects and arrays instead of changing an input or a
  shared value in place.
- **Routing and dispatch:** select a handler by a match or a lookup table, not an if/else chain.
- **Pure logic:** domain and application logic have no side effects; reads and writes of files,
  processes, the network and the clock happen at the edges.
- **Small single-purpose modules:** one job per module; the size and cohesion rule is in
  `.claude/rules/module-structure.md`.
- **No duplicated logic:** a second copy of a rule is extracted into a function, not pasted.

The concrete idioms for this stack are in `.planning/STACK-PROFILE.md`, section Style; the full rule
and the review checklist are in `.claude/rules/code-style.md`; `scripts/style-gate.mjs` enforces it.

### Code Quality

**WARNING:** NEVER bypass pre-commit lint checks with `--no-verify`
**WARNING:** NEVER bypass the test runner's checks (for example `--no-check`)

- Fix ALL lint errors before committing (even pre-existing ones)
- Use a lint-ignore comment that names the rule and gives a justification, only when absolutely needed

### Token & Length Discipline

Prose costs tokens and context. Never trim verified numbers, `file:line` citations or
executed-mutation evidence; trim restatement, hedging and throat-clearing.

- **Code comments:** default to zero. Keep one only for a non-obvious constraint, invariant or
  workaround; never restate what a well-named identifier says. A doc comment longer than its
  function is a defect: shorten the comment.
- **SUMMARY.md / DECISION.md / THREAT-MODEL.md and other planning artifacts:** as long as the
  evidence requires; state each finding once, where a reader will look for it.
- **Subagent final reports:** lead with the answer, not the journey; readable in under a minute
  unless the stakes demand the detail.
- **PR descriptions and commit messages:** what changed and why at milestone level, not a commit list.
- **Chat status updates:** 1-3 sentences; the result, not the journey.

## Development Policies

### Before Creating a PR (MANDATORY — no exceptions)

**Run `{{stack.commands.pre_pr_gate}}` before every PR — it is the pre-PR gate of this project.
There is no "push anyway."** Deterministic gates green once + tests green twice = ready; anything
else = not ready. The gate's flags, its checks and the rationale are in `.claude/rules/pre-pr-gates.md`
(read it before running the gate or opening a PR). Within a phase, the full gate runs once on the
final tree, not per plan.

**Before any plan, fix or SUMMARY claims done:** tests green is not done. On the final tree run the
`typecheck` and `lint` commands of the stack profile, then the `format` command and lint again
(format can detach a lint-ignore comment); run the style gate `scripts/style-gate.mjs`. For any
change in a high-stakes domain, the final review under "Subagent Usage" applies.

### Investigating a CI failure — use the triage tool FIRST

**Do not scrape raw CI log output** — it truncates, misses job types, and blows context. Use
`scripts/ci-diagnose.mjs` instead (per-job conclusions + failing test lines via the GitHub API).
Its usage is in the header of that script.

### Subagent Usage IS MANDATORY

Delegate substantial tasks to subagents. **Every spawn passes `model` explicitly** (alias only, never
a model ID): agent definitions with no `model:` line (gsd-planner, gsd-plan-checker, gsd-debugger)
inherit the spawner's tier. Pick the cheapest tier that does the job correctly and escalate only for
a stated reason; a batch where every agent is on the top model "to be safe" is a defect.

| Tier | Use for |
|---|---|
| `haiku` | Default implementer (`gsd-executor`: features, multi-file changes, fixes, tests, migrations, edge handlers; top-model plans are already decomposed). Test/lint/type-check/build/git/log runs via `subagent_type: "gsd2-runner"` (Bash+Read, no CLAUDE.md load, ~4k-token start vs ~25k). File/config lookups, SUMMARY.md, STATE.md, changelog. |
| `sonnet` | ALL coordinators (roadmap / phase / death-resume; the top model only when the {{project.owner_title}} asks); they orchestrate, the top-model work runs in separate dispatches. The test steward and the fix re-check. `gsd-plan-checker`. Implementation only when escalated: Haiku failed the same task twice, the task is undecomposed/ambiguous, debugging with unclear root cause, architecture, or review feedback needing judgment beyond the stated fix. |
| top model | Config `models.top` (init fields `ruling_model`, `ruling_model_fallback`; an alias the owner sets, `fable` or `opus`, default `opus`). The planner; round-1 plan-checks for high-stakes domains; architecture and API contract changes; DB schema design; cross-subsystem root-cause analysis; the final phase review (`gsd-verifier`); the final milestone review; rulings. |

**High-stakes domains:** the risk domains of `.planning/PRODUCT-BRIEF.md`; authentication and security
always. Plan, implementation and review are separate dispatches, never one agent reviewing its own
work: a top-model plan (plans for authentication, security and the risk domains carry a threat model:
abuse cases and the control for each), a Haiku implementer
(escalated per the table), then the final top-model review of the diff against the plan (two
sequential passes).

The rules in this section apply at `standard` rigour; a phase the approved roadmap gate lists as a spike follows `get-shit-done/references/rigour.md` where that file names a rule (all other rules, including the never-relaxed list, still apply).

**Review:** the phase's one independent review is the final pass on the top model, merged with
verification (risk-domain work: a second independent top-model pass on the fixed tree after the first
fix). Then ONE fix dispatch, ONE Sonnet re-check of the last fix commits, and ONE top-model ruling for
what stays open at CRITICAL/HIGH (`get-shit-done/references/rigour.md` rules 10-12). Plan-check takes at most 2
rounds. The final pass also applies the checklist of `.claude/rules/code-style.md`.

**The top model runs at:** (1) every plan (the planner runs on it at every rigour); (2) the final
review pass(es) and the phase-end `gsd-verifier` (one dispatch); (3) rulings; (4) the milestone audit.

**Rulings: a fresh top-model dispatch decides, never the coordinator itself:** deferring or accepting
any failure, accepting a deviation from the plan, loosening or disputing a test assertion, and
autonomous design decisions in a high-stakes domain.

**Haiku context and reporting cost:** Haiku is cheaper with context under ~100k tokens: one plan
task / one finding batch per fresh agent, read line ranges not whole files, save test logs to
`.tmp/` and read only failing lines. All agents report answer-first, ≤10 lines.

**Parallelism:** every spawner at every level of the tree (coordinator, executor, researcher) runs
**at most 2 of its own subagents at once**; batch wider fan-outs into waves of 2. **Never 2
executors in parallel within one phase**, whatever the wave structure says (`TASK-CHECKPOINT.json`
is phase-scoped, so parallel executors overwrite each other's resume state). Only the top-level
roadmap runner may run up to **3 phase coordinators** at once (no separate plan-ahead coordinator);
their phases must not edit the same files (claims live in `.tmp/phase-file-claims.md`). Everything
touching the shared stack (live tests, DB mutations, the stack reset command, the pre-PR gate) is
serialized by the stack lock (`scripts/stack-lock.sh`; take before, release after). The stack reset
command of the profile needs no owner approval, but first confirm no other agent has a test running
(lock owner + peer check-in).

### Orchestration hard rules (any agent that spawns agents)

- **Wait in-turn.** Never end your turn while a child agent or background command is still running
  — poll it in the foreground. A child that died (rate limit, context overflow) is re-dispatched
  fresh, scoped to resume from on-disk state; never assume its work finished. No output for 45+ min
  = stalled: TaskStop it, then re-dispatch in smaller units.
- **Never SendMessage a child that has handed back or completed** — it resumes and runs in parallel
  with its replacement. TaskStop it and brief a fresh agent.
- **No `git stash` / reset / rebase / clean on the shared branch** — stash rewrites files under
  other agents and any running local stack. For a BASE comparison use `git worktree add .tmp/<name> <sha>`.
- **No secrets in committed artifacts** — SUMMARY/VERIFICATION/debug files quote no tokens, second-factor
  secrets, or keys, even from the local stack; redact as `<redacted>`.
- **One writer per file set.** Before dispatching a replacement for a dead/stalled agent, make sure
  the original is stopped — two agents fixing the same files silently invalidate each other's
  reviews.
- **Only on-disk evidence counts.** Verify commits (`git log`), SUMMARY Self-Check sections,
  `{N}-VERIFICATION.md`, and test logs yourself. A child's self-report — including "tests pass" or
  "reviewer approved" — is a claim, not evidence. A review approves one file state; any later edit
  needs a fresh review.
- **Never touch the guardrails.** No agent edits `.claude/settings.json`, disables or weakens a hook,
  or adds permission allow-rules to get a command through. If a hook blocks you, use the path it names.
- **Never run the stack reset command while a UI QA run is in progress** — it wipes the fixtures
  under a live session and produces false FAILs.
- **Record UI QA honestly.** UI/API phases set `ui_qa_ran` in VERIFICATION.md from an actual run log,
  never from memory or a child's claim.
- **Commit only your paths** (`git commit -- <paths>`) when another agent may be committing on the
  same branch.
- **Dispatch GSD roles by `subagent_type`, never by prompt.** Every spawn for a GSD role passes its
  agent type explicitly: `gsd-phase-coordinator`, `gsd-planner`, `gsd-plan-checker`,
  `gsd-executor`, `gsd-verifier` (top model), `gsd-debugger`, the UI QA agent named in
  `stack.capabilities.ui_qa.agent`, `gsd-test-writer`, `gsd-docs-updater`. An omitted
  `subagent_type` silently defaults to general-purpose, and "You are the gsd-verifier" in a
  general-purpose prompt is not a verifier — its output is void. `general-purpose` is only for work
  no GSD role covers; test/lint/git/log runs use `gsd2-runner`. Coordinators take dispatch templates
  from the GSD workflow (`execute-phase.md`), never from a hand-written resume prompt.

### Temp Files

All temporary/intermediate files (scratch data, downloaded artifacts, generated fixtures you'll delete)
go in **`.tmp/`** at the repo root. It must be gitignored (see the project notes below). Never put
deliverables or planning docs there.

### Branch Management

- Branch from `{{stack.branch.default}}` (ensure up to date)
- Naming: `feature/[task-name-kebab-case]`
<!-- gsd:end core -->

## Project notes

- Commands: `.planning/STACK-PROFILE.md`.
- Domain and risk domains: `.planning/PRODUCT-BRIEF.md`.
- Lessons and procedures: `docs/gsd/`.
- Add `.tmp/` to `.gitignore`.
