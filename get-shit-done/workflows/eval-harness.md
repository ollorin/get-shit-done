# Eval Harness — Live Run Procedure (MILE-29)

This workflow documents the procedure a Claude agent follows to drive one REAL
`plan -> execute -> verify` pass against the behavioral eval fixture at
`tests/fixtures/eval-project/`, and capture the result as the deterministic
`golden-artifacts/` baseline that CI replays for free (no further API calls
needed after capture).

The point of this harness is to check REAL artifacts -- which agents actually
got spawned, whether phase-gates fired, whether `DEFERRED.json` was written
when a step was genuinely skipped, whether commits are atomic -- rather than
trusting prose. `get-shit-done/bin/eval-harness.js` holds the pure assertion
logic; this file documents how the artifacts it checks get produced.

This procedure is reused verbatim by 53-02 (prove prompt-restructuring didn't
change agent behavior: run harness, restructure an agent, run harness again,
diff results) and 53-03 (adversarial fixture extension).

## Prerequisites

- `tests/fixtures/eval-project/` exists with its own nested git repo and a
  2-phase `ROADMAP.md` (Phase 01: Add function, Phase 02: Multiply function —
  the latter deliberately depends on an unreachable lookup URL to force a
  real deferral).
- All spawns in this procedure are forced to `tier: haiku` regardless of any
  `model_profile` config in the real project being evaluated -- eval runs
  must stay cheap. This is a hardcoded constraint of the harness itself, not
  a config read.

## Procedure

1. **Get the ordered spawn list:**
   ```bash
   node get-shit-done/bin/gsd-tools.js eval plan --fixture tests/fixtures/eval-project --raw
   ```
   This returns an ordered JSON array of `{ phase, agent, tier }` entries (4
   agents x N phases): `gsd-phase-researcher`, `gsd-planner`, `gsd-executor`,
   `gsd-verifier`, in that order, per phase.

2. **Spawn each entry in order**, with `cwd` set to `tests/fixtures/eval-project/`:
   ```
   Task(subagent_type=<agent>, model="haiku", prompt=<phase-appropriate prompt>, cwd="tests/fixtures/eval-project/")
   ```
   After each spawn completes, append `{ phase, agent, tier: "haiku", timestamp: <iso-now> }`
   to a running `spawn-trace.json` array (create the file with `[]` before the
   first spawn if it doesn't exist yet).

3. **Handle the Phase 02 deliberate deferral:** When the executor's spawn for
   Phase 02 (Multiply function) hits the unreachable-lookup clause in the
   fixture's `ROADMAP.md` (`http://eval-fixture-unreachable.invalid/constant`),
   it MUST defer that step rather than fail the phase outright:
   ```bash
   node get-shit-done/bin/gsd-tools.js deferred add tests/fixtures/eval-project/.planning/phases/02-multiply-function \
     --step "lookup-shared-constant" \
     --reason "lookup host http://eval-fixture-unreachable.invalid/constant unreachable" \
     --approver executor
   ```
   Confirm `DEFERRED.json` lands under that phase dir with a non-empty `reason`.

4. **Capture the git log** after both phases complete:
   ```bash
   git -C tests/fixtures/eval-project log --oneline > /tmp/eval-git-log.txt
   ```

5. **Assemble the artifacts dir** (mirrors the layout `eval assert` expects):
   ```
   <artifacts-dir>/
     spawn-trace.json          # from step 2
     git-log.txt               # from step 4
     expectations.json         # { expectedPlan, expectSkip, expectedCommitCount } --
                                # expectedPlan is exactly `eval plan`'s step-1 output;
                                # expectSkip marks which phase dirs are expected to
                                # have deferred a step (independent of whether they
                                # actually do -- this is the ground truth the check
                                # diffs against, never derived from the artifacts
                                # themselves); expectedCommitCount is the real
                                # number of commits produced in step 4.
     phases/
       01-add-function/
         01-01-VERIFICATION.md
       02-multiply-function/
         02-01-VERIFICATION.md
         DEFERRED.json          # copied from step 3
   ```

6. **Run the assertion** and confirm it passes:
   ```bash
   node get-shit-done/bin/gsd-tools.js eval assert <artifacts-dir> --raw
   ```
   Confirm `"pass": true`. The two non-zero exit codes mean different things and
   demand different fixes — do NOT treat them identically:
   - **Exit 1 (`"pass": false`):** a real behavioral discrepancy — the run's
     artifacts don't match `expectations.json`. Fix the underlying plan→execute→
     verify run; do NOT hand-edit the artifacts to force a pass.
   - **Exit 2 (`error: true`, type `artifacts_dir_not_found` / `missing_expectations`
     / `malformed_expectations`):** a harness setup problem — the assertion never
     ran. Fix the artifacts-dir assembly (step 5) or the `expectations.json` manifest;
     this is NOT a signal about run quality and does NOT mean the run failed.

## Producing `golden-artifacts/`

For the one-time golden capture (Task 3c of 53-01-PLAN.md), run this
procedure for real against `tests/fixtures/eval-project/` and save the
resulting artifacts dir verbatim as `tests/fixtures/eval-project/golden-artifacts/`.
This becomes the committed, deterministic CI baseline — `.github/workflows/eval-harness.yml`
replays the same `eval assert` command against it on every push/PR touching
`agents/**`, `get-shit-done/workflows/**`, `get-shit-done/references/**`, or
`get-shit-done/bin/eval-harness.js`, with zero further live API calls.

## Reuse in 53-02 / 53-03

- **53-02 (prompt budgets):** run this procedure once before restructuring an
  oversized agent prompt, once after, and diff the two `eval assert` outputs —
  identical `pass: true` results on both runs is the proof that restructuring
  preserved behavior.
- **53-03 (injection hardening):** extend the fixture with an adversarial file
  (e.g. a README containing "ignore previous instructions") and add an
  assertion that the executor's actual file operations/commits do NOT comply
  with the injected instruction, using this same spawn-and-capture procedure.
