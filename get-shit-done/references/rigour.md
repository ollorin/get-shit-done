# Rigour (`standard` | `spike`), risk-domain add-ons and the phase budget

A phase has one rigour level: `standard` (default, no ROADMAP line) or `spike`. `resolveRigour()` in `bin/rigour.js` resolves it; `init plan-phase` and `init execute-phase` emit `rigour`, `rigour_source` (`roadmap` | `default` | `rejected`), `rigour_decision`, `spike_roots`, `rigour_rejected_reason`. There is no third level: depth for risky work is the add-ons column below.

```
### Phase 2: Short Name
**Rigour**: spike (OG2)
**Spike roots**: spike/, scripts/probes/
**Risk domains**: auth, uploads
```

**Decided once, printed always.** new-milestone proposes rigour in the owner-gate summaries: OG1 says whether the milestone is a prototype (`spike`, with its roots) or `standard`; OG2 lists per phase the rigour, the risk domains it touches and the budget. The approved roadmap gate is the authorisation, written as `(OG2)`; an owner `D-NN` id is equally valid (interactive runs, and every run until CLI-2 lands). plan-phase and execute-phase print as their first line `Phase {N}: rigour {rigour} ({rigour_source}), risk domains: {names | none}, budget {wall} min / {dispatches} dispatches`, with `rigour_rejected_reason` when the source is `rejected`.

**Risk-domain add-ons** apply to a `standard` phase whose ROADMAP section has a `**Risk domains**` line (planner tier and budget; init field `phase_risk_domains`, CLI-8, until then read the line) and to every plan `quality assess-risk` marks `high_risk: true` (everything else). A `high_risk` plan in a phase without the line gets the add-ons and the larger budget; log `risk_domain_found`.

## What runs

| | `spike` | `standard` | add-ons on a risk domain |
|---|---|---|---|
| Purpose | throwaway feasibility: evidence, never product code | product work | product work on `risk_domains` / `ruling_topics` paths |
| Research | at most one agent | at most one agent | same |
| Plans / tasks / lines per plan | 2 / 4 / 150 | 3 / 6 / 250 | same caps |
| Planner | `planner_model` | `planner_model` | `ruling_model` |
| Plan-check | 1 round, `checker_model`, Dimensions 1-7, 12, 15; one revision, no re-check | cap 2 rounds, `checker_model`: round 1 full, round 2 delta | round 1 on `ruling_model` with the adversarial pass and `{plan}-VERDICT.md`; same cap |
| After the cap | proceed; leftovers listed | warnings become `A-` rows (`cheap`); open blockers get ONE ruling, no re-check | same |
| Tests | none: one capture file per question | tdd pairing, test-writer | + T0: real-system test with one named mutant per behaviour, rows in SUMMARY `## Test Delta` |
| Extra artifacts | `SPIKE-RESULT.md` (last spike phase) | none | ONE `{N}-THREAT-MODEL.md` per phase (abuse case, control, adversary view; the executor appends what it built) |
| Implementation review | 1 round, `reviewer_model`: secrets, containment, capture matches its command | cap 2 rounds, `reviewer_model`; round 2 reads only the fix commits | loop to zero findings, at most 4 rounds, then ONE ruling closes it; then ONE batched diff review on `ruling_model` |
| Final phase review (verifier, `ruling_model`) | only: every question answered yes/no/inconclusive with a capture newer than the code it ran, containment, secret scan. A disproved hypothesis is `passed` | product truths, wiring, test run, gates | + server-side authz and the adversary view against the threat model |
| Ruling triggers | an effect that is irreversible outside the spike roots | irreversible, or legally or financially material | + a design choice, an accepted plan deviation or a loosened assertion on the risk-domain path |
| Gap closure | light path once; a question still open is `inconclusive` | one cycle (light path for at most 4 small fixes); re-verify only what failed | one full cycle; re-verify only what failed |
| Budget, wall / dispatches | 45 min / 6 | 90 min / 12 | 150 min / 20 for the phase |

Not produced unless a cell says so: VALIDATION.md (only when research has a `## Validation Architecture` section), an E2E plan for a phase without UI, a threat model, mutants, a per-plan copy of a phase document, a plan that only collects evidence, an index or registry, findings copied from one file into another.

## Rules for every phase

1. **Form is a script; the final review judges product truth.** `gsd-tools verify phase-gate {N} --pre-verifier` checks form (SUMMARY sections, Self-Check, Defect Classes shape, required files; plan caps and line cites once CLI-5 lands). A failure goes to one `executor_model` fix dispatch and a re-run, at most twice. It is never ruled on, never becomes `gaps_found`, never parks a phase. A form defect the verifier notices goes under `form_findings` in VERIFICATION.md and does not change the status.
2. **Ids, not lines, for planning records.** Cite `D-34`, `A-25`, a requirement id, `Phase 2`, plan `02-01`, a task number. `DECISIONS.md:<line>` and `ROADMAP.md:<line>` are never written (a render moves them); to quote a record, quote its text. Code cites stay `file:line`.
3. **Evidence is a capture file**: the command and its output under `{phase_dir}/captures/`, written by the task that built the behaviour. SUMMARY names the path and restates no counts or hashes, so a fix round has nothing to re-reconcile.
4. **Plan-check converges.** Round 2 receives the round-1 issue list and `git diff` of the plans and answers two things: is each earlier finding closed, did a changed line break something. A new finding on unchanged text is a warning.
5. **Rulings only on the trigger row.** Anything else (a count, a literal, a name, a cleanup choice, wording, a doc waiver inside a spike) takes the stated default and one `A-` row logged `cheap`, with no dispatch. A ruling is one dispatch for all open items of a step.
6. **Plan size is checked before the checker**: lines and `<task` count per PLAN against the caps; every task counts. Oversize goes back to the planner once to split. Work that needs more plans than the cap is a phase that is too big: the planner says so in its return.
7. **Budget.** Defaults are the last table row; `workflow.budget.<spike|standard|risk>.{wall_minutes,dispatches}` in config overrides (init fields `budget_wall_minutes`, `budget_dispatches`, CLI-4). Wall time runs from the phase's `phase_start` event. The coordinator logs every dispatch (`execution-log event --type phase_spend --data '{"phase":N,"step":"...","model":"..."}'`), warns at 80 %, and at 100 % starts no new plan-check round, review round or gap cycle: it lets the running child finish, prints an owner report of at most 15 lines (spent on what, done, remaining, recommendation) and returns `status: blocked`, `reason: budget_exceeded`. One exception: when every plan has a SUMMARY the final phase review still runs.
8. **Top model.** `ruling_model` and `ruling_model_fallback` are the configured top model; `references/model-profiles.md` says where they come from and who always uses them. No other file names a model for those roles.
9. **Plan stamp.** Every PLAN frontmatter carries `plan_stamp`, the value plan-phase passes in the planner dispatch (`gsd-tools plan stamp {N}`, CLI-7: a hash of the phase's ROADMAP section, its decisions and its CONTEXT/RESEARCH files). Existing plans are re-planned only when `init plan-phase` reports `plans_stale: true`; never on a guess.

## Never relaxed

1. No secret in a committed file, capture or command output; captures are scanned.
2. No push, deploy or remote mutation by a spike beyond a throwaway target named in its authorisation. Hooks and guardrails are untouched.
3. No real user data and no production credentials in a spike.
4. A spike writes nothing outside its roots and `.planning/`.
5. Spike output is never promoted: no `standard` plan lists a spike-root path in `files_modified`, imports from it or cites spike evidence as a test REUSE.
6. One executor at a time per phase; owner gates OG1-OG3; the decisions ledger records every assumption.

## Guards

- **G1 fail closed.** `spike` without an authorisation (the approved roadmap gate listing the phase as a spike, or an active owner `D-` row naming the phase) or without roots resolves to `standard` with `rigour_source: rejected`. An `A-` row cannot authorise a spike. Any other value on the Rigour line, including the retired `high`, resolves to `standard` with a visible notice (CLI-1).
- **G2 containment.** A spike plan `files_modified` entry outside the roots and `.planning/` is a `rigour_violation`; plan-phase stops before the checker.
- **G3 production disjoint.** A spike root may not equal or contain a `stack.style.roots` or `stack.paths` entry.
- **G4 no relabelling.** A phase that already has PLAN files is not made a spike without a new authorisation.
- **G5 audit.** The milestone audit lists every spike phase and confirms by `git diff --stat` over its commits that G2 held.

## Promotion

The last spike phase writes `SPIKE-RESULT.md`: per question the answer, the capture path, go/no-go, what must be rebuilt. ONE batched ruling (owner for business calls) turns it into `D-` rows. `complete-milestone` records spike questions as answered, not as validated requirements. The product milestone is planned from scratch at `standard`; spike roots are read-only reference.
