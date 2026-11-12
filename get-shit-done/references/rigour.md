# Rigour levels (`standard` | `high` | `spike`)

A phase has one rigour level. It lives on one line in ROADMAP.md, is resolved by `resolveRigour()` in `bin/rigour.js`, and is emitted by `init plan-phase`, `init execute-phase` and `quality assess-risk`.

```
### Phase 2: Short Name
**Rigour**: spike (D-07)
**Spike roots**: spike/, scripts/probes/
```

Absent line = `standard` = every rule in the agents and workflows applies unchanged. `high` needs no id. `spike` needs a decision id and at least one root. Init output fields: `rigour`, `rigour_source` (`roadmap` | `default` | `rejected`), `rigour_decision`, `spike_roots`, `rigour_rejected_reason`.

## What `spike` replaces

A spike phase answers a few throwaway questions about feasibility. Its output is evidence, never product code. When `rigour` is `spike`, this table replaces the rules it names; everything not named stays as written.

| Role / step | spike |
|---|---|
| Roadmapper | each spike phase states 1-5 spike questions as its success criteria |
| Research, VALIDATION.md, E2E cases | one research agent allowed; the validation strategy and E2E case steps are skipped |
| Planner model | `planner_model` always |
| Plan shape | at most 2 plans, all `wave: 1`, run sequentially; each task names the question it answers and the capture file that answers it |
| Test mandates (tiers, mutants, probe harness, threat-model task, atomicity task, tdd pairing, test-writer spawn) | none apply. Evidence is one capture file (command and its output) per question, in the phase directory |
| Risk triage | always `checker`; a `rigour_violation` from `quality assess-risk` stops plan-phase before the checker |
| Plan-checker | `checker_model`, ONE round, Dimensions 1-7, 12 and 15 only |
| Revision | one planner revision for blockers, no re-check |
| Rulings | only for a record that is irreversible outside the spike roots (data loss, real user data, public contract, legal). Everything else is an `A-` assumption logged `cheap`, default taken. An effect confined to the spike roots on synthetic data is not irreversible |
| Executor review | one review round checking secrets, spike-root containment, and that each capture matches its command; no batched top-tier diff review |
| Verifier | profile-tier model. Checks only: each question has an answer (yes, no or inconclusive) with a capture file newer than the code it ran; containment; secret scan. A disproved hypothesis is `passed`. Missing capture or a secret in a capture is `gaps_found`. Test suite, UI QA, E2E, test-file coverage, docs, test delta and Defect Classes rules do not apply |
| Gap closure | always the light path, once; a question still open afterwards is recorded `inconclusive` |

`high` treats the whole phase as risk-domain: `ruling_model` for every plan, adversarial triage always, plan-check cap of 3 rounds and then a top-tier ruling instead of the auto-mode force-proceed. The implementation review loop is unchanged.

## Never relaxed at any rigour

1. No secret in a committed file, capture file or command output; capture files are scanned.
2. No push, deploy or remote mutation beyond a throwaway target named in the spike's decision row. Hooks and guardrails are untouched.
3. No real user data and no production credentials. A question that needs either is not a spike question.
4. Nothing outside the spike roots and `.planning/` is written.
5. Spike output is never promoted: no `standard` or `high` plan lists a spike-root path in `files_modified` or imports from it, and spike evidence is never cited as a test REUSE.
6. The decisions ledger still records every assumption.

## Guards

- **G1 fail closed.** `spike` without a decision id that is an active `D-` row (owner answer or opus ruling) naming the phase, or without roots, resolves to `standard` with `rigour_source: rejected`. An `A-` row cannot authorise a spike.
- **G2 containment.** A plan `files_modified` entry outside the roots and `.planning/` is a `rigour_violation`.
- **G3 production disjoint.** A spike root may not equal or contain a `stack.style.roots` or `stack.paths` entry.
- **G4 lowering needs a row.** Setting `spike` needs the `D-` row of G1. Removing `high` from a phase that already has PLAN files needs a `D-` row naming the phase.
- **G5 audit.** The milestone audit lists every spike phase and confirms by `git diff --stat` over its commits that G2 held.

## Promotion

1. The last spike phase writes `SPIKE-RESULT.md`: per question the answer, the capture path, go/no-go, and what must be rebuilt.
2. ONE batched ruling (owner for business calls, top tier for risk-domain shape) turns it into `D-` rows, replacing the per-question rulings.
3. `complete-milestone` records spike questions as answered, not as validated requirements.
4. The product milestone is planned from scratch at `standard` or `high`; spike roots are read-only reference.
