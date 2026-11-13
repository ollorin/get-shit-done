# Rigour (`standard` | `spike`), risk-domain add-ons and the phase budget

A phase has one rigour level: `standard` (default, no ROADMAP line) or `spike`. `resolveRigour()` in `bin/rigour.js` resolves it; `init plan-phase` and `init execute-phase` emit `rigour`, `rigour_source` (`roadmap` | `default` | `rejected`), `rigour_decision`, `spike_roots`, `rigour_rejected_reason`. There is no third level: depth for risky work is the add-ons column below. The init output also carries `rigour_notice` (a visible mismatch or unknown value, never authority).

```
### Phase 2: Short Name
**Rigour**: spike (OG2)
**Spike roots**: spike/, scripts/probes/
**Risk domains:** auth, uploads
```

**Decided once, printed always.** The newest APPROVED roadmap owner gate of the milestone is the single source of truth for spike phases and roots: `gsd-tools owner-gate request --kind roadmap --spike-phases N,M --spike-roots a,b`. new-milestone proposes rigour in the owner-gate summaries (OG1: prototype or `standard`; OG2: per phase the rigour, risk domains and budget). The ROADMAP `**Rigour**:` / `**Spike roots**:` lines are informational (the roadmapper writes them for readers); a mismatch with the gate prints `rigour_notice`. plan-phase and execute-phase print as their first line `Phase {N}: rigour {rigour} ({rigour_source}), risk domains: {names | none}, budget {wall} min / {dispatches} dispatches`, plus `rigour_rejected_reason` when the source is `rejected` and `rigour_notice` when set. Changing the spike phases of an already approved roadmap gate needs a new approval: repeat the request with `--revise`; the gate goes back to pending and blocks the roadmap until the owner approves it.

**Risk-domain add-ons** engage when the init field `risk_addons` is true, the one boolean every workflow and agent keys on: a `standard` phase whose `**Risk domains:**` line is not `none` (`phase_risk_domains`) or that has a plan with `high_risk: true` in its frontmatter (plan-phase also engages them when `quality assess-risk` newly marks a plan `high_risk`). The line is mandatory in every ROADMAP phase section: a comma list of single tokens from the project's `risk_domains`, or `none`; trailing prose is ignored, unknown tokens print a notice, and `owner-gate request --kind roadmap` fails when a phase that is not complete lacks it (the message names the phases and the exact line to add); a complete phase without it is one notice. For an old roadmap without the line `init plan-phase` matches the configured names against the phase goal and requirements and prints a notice.

## What runs

| | `spike` | `standard` | add-ons on a risk domain |
|---|---|---|---|
| Purpose | throwaway feasibility: evidence, never product code | product work | product work on `risk_domains` / `ruling_topics` paths |
| Research | at most one agent | at most one agent | same |
| Plans / tasks / lines per plan | 2 / 4 / 150 | 3 / 6 / 250 | same caps |
| Planner | `planner_model` | `planner_model` | `ruling_model` |
| Plan-check | 1 round, `checker_model`, Dimensions 1-7, 12, 15; one revision, no re-check | cap 2 rounds, `checker_model`: round 1 full, round 2 delta | round 1 on `ruling_model` with the adversarial pass and `{plan}-VERDICT.md`; same cap |
| After the cap | proceed; leftovers listed | warnings become `A-` rows (`cheap`); remaining blockers get ONE planner revision and ONE targeted re-check of only those blockers (same checker tier, delta scope) | same, then a blocker that survives goes to ONE ruling on `ruling_model` before execution, never an OVERRIDE line alone |
| Tests | none: one capture file per question | tdd pairing, test-writer | + T0: real-system test with one named mutant per behaviour, rows in SUMMARY `## Test Delta` |
| Extra artifacts | `SPIKE-RESULT.md` (last spike phase) | none | ONE `{N}-THREAT-MODEL.md` per phase (abuse case + control, written by the planner before execution) |
| Implementation review | 1 round, `reviewer_model`: secrets, containment, capture matches its command | cap 2 rounds, `reviewer_model`; round 2 reads only the fix commits; a CRITICAL/HIGH still open after the cap is fixed and re-checked by ONE targeted re-review of that finding (fresh reviewer, same tier, only its lines) or goes to ONE ruling, never an `A-` row | loop to zero findings, at most 4 rounds, then ONE ruling closes it; then ONE batched diff review on `ruling_model` |
| Final phase review (verifier, `ruling_model`) | only: every question answered yes/no/inconclusive with a capture newer than the code it ran, containment, secret scan. A disproved hypothesis is `passed` | product truths, wiring, test run, gates | + server-side authz read from the code, against the threat model |
| Ruling triggers | an effect that is irreversible outside the spike roots | irreversible, or legally or financially material | + a design choice, an accepted plan deviation or a loosened assertion on the risk-domain path |
| Gap closure | light path once; a question still open is `inconclusive` | one cycle (light path for at most 4 small fixes); re-verify only what failed | one full cycle; re-verify only what failed |
| Budget, wall / dispatches | 45 min / 6 | 90 min / 12 | 150 min / 20 for the phase |

Not produced unless a cell says so: an E2E plan without UI, a threat model, mutants, a per-plan copy of a phase document, an evidence-only plan, an index or registry, findings copied between files.

## Rules for every phase

1. **Form is a script; the final review judges product truth.** Plan-time: the planner runs `gsd-tools verify form {N} --plans-only` (plan lines/tasks/plan-count caps over UNEXECUTED plans, evidence-only plan, missing `plan_stamp`) and fixes every error before plan-check; executed plans (with a SUMMARY) are never checked for caps. After execution `gsd-tools verify phase-gate {N} --pre-verifier` returns `failures` (missing WORK, including `missing_evidence`), `work_errors` and `form_errors` (SUMMARY Self-Check section missing; a planning-record line cite in a PLAN or SUMMARY the phase wrote; ledger rows are never checked). Form is `form_errors` only; never use `evidence_errors` or `work_errors` to decide form. Form errors go to one `executor_model` fix dispatch and a re-run, at most twice (never plan caps). A survivor is closed with `gsd-tools phase complete {N} --form-debt` (recorded in VERIFICATION frontmatter `form_debt`); it still refuses on missing work. A form debt never parks, never becomes `gaps_found`, never blocks dependents, and is never ruled on. A form issue the verifier notices goes in its report body and changes no status.
2. **Ids, not lines, for planning records.** Cite `D-34`, `A-25`, a requirement id, `Phase 2`, plan `02-01`, a task number. `DECISIONS.md:<line>` and `ROADMAP.md:<line>` are never written (a render moves them); to quote a record, quote its text. Code cites stay `file:line`.
3. **Evidence is a capture file**: the command and its output under `{phase_dir}/captures/`, written by the task that built the behaviour. SUMMARY names the path and restates no counts or hashes, so a fix round has nothing to re-reconcile.
4. **Plan-check converges.** Round 2 receives the round-1 issue list and `git diff` of the plans and answers two things: is each earlier finding closed, did a changed line break something. A new finding on unchanged text is a warning.
5. **Rulings only on the trigger row.** Anything else (a count, a literal, a name, a cleanup choice, wording, a doc waiver inside a spike) takes the stated default and one `A-` row logged `cheap`, with no dispatch. A ruling is one dispatch for all open items of a step.
6. **Plan size is checked at plan time, before the checker**, by `verify form {N} --plans-only`: every task counts; oversize goes back to the planner to split. Work that needs more plans than the cap is a phase that is too big: the planner says so in its return.
7. **Budget.** Defaults are the last table row; `workflow.budget.<spike|standard|risk>.{wall_minutes,dispatches}` in config overrides (init fields `budget_wall_minutes`, `budget_dispatches`). The coordinator calls `gsd-tools budget spend --phase {N}` once when it spawns any child agent (one dispatch) and `gsd-tools budget spend --phase {N} --done` when that child returns (extends the wall window, not a dispatch: a long running dispatch becomes visible), and `gsd-tools budget status --phase {N}` (`wall_minutes_spent`, `dispatches_spent`, `pct`, `warn`, `breach`) before each NEW cycle (plan-check round, review round, gap cycle). Wall time is the sum of work windows (phase start, or the first spend event when the phase has none, to the next record, park or complete, measured to the phase's last logged event, never the clock); idle time between sessions never counts. Warn at 80 %; at 100 % start nothing new, let the running child finish, print an owner report of at most 15 lines and return `status: blocked`, `reason: budget_exceeded`. One exception: when every plan has a SUMMARY the final phase review still runs.
8. **Top model.** `ruling_model` and `ruling_model_fallback` are the configured top model; `references/model-profiles.md` says where they come from and who always uses them. No other file names a model for those roles.
9. **Plan stamp.** The planner copies `plan_stamp` from an `init plan-phase` call made immediately before the planner spawn into each PLAN frontmatter (hash of the ROADMAP phase section, the phase's requirement lines, CONTEXT and RESEARCH; no ledger rows: what a plan depends on is in CONTEXT). `plans_stale: true` is consumed once, in plan-phase.md; never re-plan on a guess.

## Never relaxed

1. No secret in a committed file, capture or command output; captures are scanned.
2. No push, deploy or remote mutation by a spike beyond a throwaway target named in its authorisation. Hooks and guardrails are untouched.
3. No real user data and no production credentials in a spike.
4. A spike writes nothing outside its roots and `.planning/`.
5. Spike output is never promoted: no `standard` plan lists a spike-root path in `files_modified`, imports from it or cites spike evidence as a test REUSE.
6. One executor at a time per phase; owner gates OG1-OG3; the decisions ledger records every assumption.

## Guards

- **G1 fail closed.** `spike` without the newest approved roadmap gate listing the phase in `--spike-phases` with `--spike-roots`, or without roots, resolves to `standard` with `rigour_source: rejected`. No `D-` or `A-` row authorises a spike. Any other value on the Rigour line, including the retired `high`, resolves to `standard` with a visible notice.
- **G2 containment.** A spike plan `files_modified` entry outside the roots and `.planning/` is a `rigour_violation`; plan-phase stops before the checker.
- **G3 production disjoint.** A spike root may not equal or contain a `stack.style.roots` or `stack.paths` entry.
- **G4 no relabelling.** A phase that already has executed plans (a SUMMARY) cannot be newly added to `--spike-phases`; phases the approved gate already lists are not re-checked by a `--revise`.
- **G5 audit.** The milestone audit lists every spike phase and confirms by `git diff --stat` over its commits that G2 held.

## Promotion

The last spike phase writes `SPIKE-RESULT.md`: per question the answer, the capture path, go/no-go, what must be rebuilt. ONE batched ruling (owner for business calls) turns it into `D-` rows. `complete-milestone` records spike questions as answered, not as validated requirements. The product milestone is planned from scratch at `standard`; spike roots are read-only reference.
