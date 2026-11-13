# Rigour at `spike`: rules read only when `rigour` is `spike`

Companion of `references/rigour.md` (the "What runs" table there has the spike column). Nothing here applies to `standard`.

**Spike executor.** At spike the executor is the investigator, so `executor_model` (the floor, and with it the fix dispatch) resolves to `sonnet` (`executorModelFor` in `bin/gsd-tools.js`), and a plan runs as ONE executor on the highest tier tag among its tasks, never below that floor (`executor_model` per plan in `phase-plan-index`). Standard rigour runs one executor per task on the task's tag (`references/task-routing.md`).

**Retried parked spike phase.** A retry after a park is a new budget window (and "ONE fix dispatch" is per window); `budget status` and `phase_complete` also carry `total_wall_minutes` and `total_dispatches` across windows (metrics). On `--retry-parked` the phase coordinator resumes at `verify`: one fix dispatch carrying every still-open fix and bounded probe of the existing final review, its re-check, then the one ruling for what stays open; the top-model verifier is not re-run unless the ruling orders it.

**Spike path.** planner, checker, (one planner revision), executor(s), final review, (fix, fix re-check, ruling): the round caps above bound the dispatches, the wall budget bounds the cost; dispatches are counted, never limited. The `verify phase-gate` checks `test`, `docs`, `ui_qa` and `e2e_plan` are `not_applicable` at spike (the script resolves the rigour, so no `A-` waiver row and no `deferred add` is written for them); the review-file gate does not require a `{N}-REVIEW-{round}.md` at spike; `verify form --plans-only` skips `evidence_only_plan` at spike (a decision-record or evidence phase is legitimate there).

**Negative answers.**
An answer "no / does not work / none exists" needs (a) a root cause shown in a capture, or (b) a recorded search of the installed package or source for the error text and for sibling options (command and output in a capture). Otherwise the answer is `inconclusive`, and an `inconclusive` row needs the same (a) or (b), run in the phase that can still act on what it finds: the search reads the failure text and sibling options (adapters, modes, flags) in the installed package and docs. The final review downgrades any "no" lacking (a)/(b). The script check: the answer table (below) names that capture for every row but `yes`; `verify phase-gate` reports a WORK error for a row without one.

## Spike answer table

`SPIKE-RESULT.md` (or the VERIFICATION body) holds one table per phase, one row per question; it is the only per-phase result record at spike:

```
| Question | Answer | Capture | Probe | Root cause or search |
|---|---|---|---|---|
| Q1 does the admin answer on workerd | inconclusive | `captures/q1.txt` | `spike/probes/q1.sh` | |
| Q2 is there a database adapter | no | `captures/q2.txt` | | `captures/q2-search.txt` |
```

Answer is `yes`, `no` or `inconclusive`. `bin/spike-check.js` (called by `verify phase-gate` and `phase complete` at spike) reports a WORK error for a row other than `yes` whose Root cause or search cell is empty or names a file that is not on disk, and for a stale capture: the Probe script is newer than its Capture (last commit time, or mtime when dirty or untracked). A form error is reported when ROADMAP marks the phase complete while REQUIREMENTS still shows one of its requirements pending or STATE still calls it in progress. At spike a plan SUMMARY is at most 15 lines (plan id, commits, capture paths, Self-Check): it restates no result, count or conclusion. No `index.tsv` or registry is written, and no `DEFERRED.json` entry for a `not_applicable` gate.

## Guards

- **G1 fail closed.** `spike` without the newest approved roadmap gate listing the phase in `--spike-phases` with `--spike-roots`, or without roots, resolves to `standard` with `rigour_source: rejected`. No `D-` or `A-` row authorises a spike. Any other value on the Rigour line, including the retired `high`, resolves to `standard` with a visible notice.
- **G2 containment.** A spike plan `files_modified` entry outside the roots and `.planning/` is a `rigour_violation`; plan-phase sends it back to the planner ONCE (offending paths and the gate's `spike_roots` named), re-runs the check, and a second violation stops plan-phase before the checker. The planner always plans against the GATE's roots (init `spike_roots`); a ROADMAP `**Spike roots**` line that differs is informational.
- **G3 production disjoint.** A spike root may not equal or contain a `stack.style.roots` or `stack.paths` entry.
- **G4 no relabelling.** A phase that already has executed plans (a SUMMARY) cannot be newly added to `--spike-phases`; phases the approved gate already lists are not re-checked by a `--revise`.
- **G5 audit.** The milestone audit lists every spike phase and confirms by `git diff --stat` over its commits that G2 held.

## Promotion

The last spike phase writes `SPIKE-RESULT.md`: per question the answer, the capture path, go/no-go, what must be rebuilt. ONE batched ruling (owner for business calls) turns it into `D-` rows. `complete-milestone` records spike questions as answered, not as validated requirements. The product milestone is planned from scratch at `standard`; spike roots are read-only reference.
