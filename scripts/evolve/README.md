# evolve: rework corpus, candidate edits, A/B gate

Goal: agent instructions and flow steps change only when replays of real reworked plans show a gain.

| step | script | LLM | output |
|---|---|---|---|
| registry of (base, first attempt, rework) per plan | `corpus.py build` | no | `$EVOLVE_HOME/registry.json` |
| which rework unit tests are green at the fix, red by assertion at the first attempt | `corpus.py calibrate` | no | `calibration` per entry |
| ab-eval tasks `RP-<plan>` (plan tasks that name the tested files; hidden = those tests) | `replay.py make` | no | `$AB_HOME/tasks.json` |
| rank finding classes, draft one rule as a variant | `candidates.py rank`, `draft --class X` | no | `candidates.json`, `drafts/<id>/` |
| runs | `../ab-eval/ab_run.py` (2 in parallel) | Haiku | `$AB_HOME/results/runs.jsonl` |
| decision | `gate.py decide` | no | `decisions.jsonl`: ADOPT, REJECT, MORE-REPS, STOP |
| record | `gate.py adopt`, `rollback` | no | `adopted.json`, `agents/VERSIONS.json` |
| trigger | `run.py` (execute-phase step `evolve_corpus`, dry-run) | no | `.tmp/evolve-phase-N.log` |

Gate rules are in the `gate.py` docstring: 5 reps minimum, 10 before a null result counts, run-level Fisher
test, canary tasks may not lose more than one acceptance, cost cap. Adoption = one commit that applies the draft,
bumps `agents/VERSIONS.json` and adds a CHANGELOG line citing the decision; rollback = `git revert` of it.

Limits: classes come from commit subjects (regex), not from review files; hidden tests only score defects a unit
test can see (not SUMMARY, cite or doc findings); a replay is scoped to the plan tasks that name the tested files.
