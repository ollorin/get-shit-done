<purpose>
Verify milestone achieved its definition of done by aggregating phase verifications, checking cross-phase integration, and assessing requirements coverage. Reads existing VERIFICATION.md files (phases already verified during execute-phase), aggregates tech debt and deferred gaps, then spawns integration checker for cross-phase wiring. Finally distils the milestone's recorded `## Defect Classes` into general preventive rules in the consuming repo's `.claude/rules/*.md` (Step 7) so the defects review caught are not made again.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

## 0. Initialize Milestone Context

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init milestone-op)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract from init JSON: `milestone_version`, `milestone_name`, `phase_count`, `completed_phases`, `commit_docs`.

Resolve integration checker model:
```bash
integration_checker_model=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" resolve-model gsd-integration-checker --raw)
```

**Fork capability handshake (hard stop).** This workflow's later gates (Step 5.7) only exist in a
fork version that declares `qa-verdict-lifecycle-v1`. Auditing with an older installed fork would
silently skip a gate the consuming repo depends on and still report "Audit Passed" — exactly the
silent-pass class this phase closes — so a capability shortfall aborts the audit outright rather
than degrading quietly. A repo declaring no `quality.required_gsd_gates` is unaffected: the check
exits 0 and is inert for every existing GSD project.

```bash
HANDSHAKE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" verify gate-handshake 2>&1) || {
  echo "$HANDSHAKE"
  # HARD STOP — do not audit a milestone with a fork that lacks the gates this repo requires.
  exit 1
}
```

If this fails, the remedy is `npm run install:gsd` from `~/get-shit-done` — never `/gsd:update`
(may pull upstream and clobber fork-local patches).

## 1. Determine Milestone Scope

```bash
# Get phases in milestone (sorted numerically, handles decimals)
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" phases list
```

- Parse version from arguments or detect current from ROADMAP.md
- Identify all phase directories in scope
- Extract milestone definition of done from ROADMAP.md
- Extract requirements mapped to this milestone from REQUIREMENTS.md

## 2. Read All Phase Verifications

For each phase directory, read the VERIFICATION.md:

```bash
# For each phase, use find-phase to resolve the directory (handles archived phases)
PHASE_INFO=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" find-phase 01 --raw)
# Extract directory from JSON, then read VERIFICATION.md from that directory
# Repeat for each phase number from ROADMAP.md
```

From each VERIFICATION.md, extract:
- **Status:** passed | gaps_found
- **Critical gaps:** (if any — these are blockers)
- **Non-critical gaps:** tech debt, deferred items, warnings
- **Anti-patterns found:** TODOs, stubs, placeholders
- **Requirements coverage:** which requirements satisfied/blocked

If a phase is missing VERIFICATION.md, flag it as "unverified phase" — this is a blocker.

## 3. Spawn Integration Checker

With phase context collected:

Extract `MILESTONE_REQ_IDS` from REQUIREMENTS.md traceability table — all REQ-IDs assigned to phases in this milestone.

```
Agent(
  prompt="Check cross-phase integration and E2E flows.

Phases: {phase_dirs}
Phase exports: {from SUMMARYs}
API routes: {routes created}

Milestone Requirements:
{MILESTONE_REQ_IDS — list each REQ-ID with description and assigned phase}

MUST map each integration finding to affected requirement IDs where applicable.

Verify cross-phase wiring and E2E user flows.",
  subagent_type="gsd-integration-checker",
  model="{integration_checker_model}",
  description="Integration check milestone"
)
```

## 4. Collect Results

Combine:
- Phase-level gaps and tech debt (from step 2)
- Integration checker's report (wiring gaps, broken flows)

## 5. Check Requirements Coverage (3-Source Cross-Reference)

MUST cross-reference three independent sources for each requirement:

### 5a. Parse REQUIREMENTS.md Traceability Table

Extract all REQ-IDs mapped to milestone phases from the traceability table:
- Requirement ID, description, assigned phase, current status, checked-off state (`[x]` vs `[ ]`)

### 5b. Parse Phase VERIFICATION.md Requirements Tables

For each phase's VERIFICATION.md, extract the expanded requirements table:
- Requirement | Source Plan | Description | Status | Evidence
- Map each entry back to its REQ-ID

### 5c. Extract SUMMARY.md Frontmatter Cross-Check

For each phase's SUMMARY.md, extract `requirements-completed` from YAML frontmatter:
```bash
for summary in .planning/phases/*-*/*-SUMMARY.md; do
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" summary-extract "$summary" --fields requirements_completed | jq -r '.requirements_completed'
done
```

### 5d. Status Determination Matrix

For each REQ-ID, determine status using all three sources:

| VERIFICATION.md Status | SUMMARY Frontmatter | REQUIREMENTS.md | → Final Status |
|------------------------|---------------------|-----------------|----------------|
| passed                 | listed              | `[x]`           | **satisfied**  |
| passed                 | listed              | `[ ]`           | **satisfied** (update checkbox) |
| passed                 | missing             | any             | **partial** (verify manually) |
| gaps_found             | any                 | any             | **unsatisfied** |
| missing                | listed              | any             | **partial** (verification gap) |
| missing                | missing             | any             | **unsatisfied** |

**On-disk artifact spot-check (REQUIRED before accepting `satisfied`).** The matrix above reads only
self-reported documents (VERIFICATION.md ↔ SUMMARY.md ↔ REQUIREMENTS.md) — a phase can report itself
satisfied without the code existing. For each REQ-ID resolving to `satisfied`, spot-check on disk that
at least one concrete artifact the phase claims (a file path named in its SUMMARY.md/VERIFICATION.md, or
a `verify artifacts`-style check against the plan's stated deliverables) actually exists:

```bash
# For each artifact path the phase's SUMMARY.md/VERIFICATION.md names as delivered:
[ -e "$artifact_path" ] || echo "SPOT-CHECK FAIL: ${REQ_ID} reports satisfied but ${artifact_path} is absent on disk"
```

If a `satisfied` requirement's claimed artifacts are absent on disk, downgrade it to `partial (verify
manually)` and note the discrepancy — never accept a paper-only `satisfied`.

### 5e. FAIL Gate and Orphan Detection

**REQUIRED:** Any `unsatisfied` requirement MUST force `gaps_found` status on the milestone audit.

**Orphan detection:** Requirements present in REQUIREMENTS.md traceability table but absent from ALL phase VERIFICATION.md files MUST be flagged as orphaned. Orphaned requirements are treated as `unsatisfied` — they were assigned but never verified by any phase.

### 5f. PRD-TRACE.md Cross-Reference (Optional — per phase with PRD Express Path)

For each phase directory in the milestone scope:

```bash
PRD_TRACE=$(ls ".planning/phases/${phase_dir}"/*-PRD-TRACE.md 2>/dev/null | head -1)
```

If PRD_TRACE is empty for this phase: skip — note "Phase {N}: no PRD-TRACE.md (PRD Express Path not used)" as informational in audit output. NOT a blocker.

If PRD_TRACE found:

1. Parse the PRD-TRACE.md table — extract each row: REQ-ID, Requirement, Category, Plan, Status.

2. For each row where Plan column is NOT "TBD":
   - Read the phase VERIFICATION.md for that phase
   - Check whether the corresponding plan's work is listed as having its requirements satisfied
   - Produce per-requirement alignment status: SATISFIED | UNSATISFIED | UNVERIFIED

3. For the phase, produce a PRD traceability table:
   ```markdown
   ### Phase {N} PRD Traceability (Source: {source_prd from PRD-TRACE.md frontmatter})

   | PRD REQ-ID | Requirement | Plan | Status |
   |------------|-------------|------|--------|
   | PRD-01 | {text} | {plan} | SATISFIED |
   | PRD-02 | {text} | TBD | UNVERIFIED |
   ```

4. Compute `prd_satisfied` and `prd_total` counts for this phase:
   - `prd_satisfied`: rows where status == SATISFIED
   - `prd_total`: all rows (including UNVERIFIED and UNSATISFIED)

5. Accumulate into milestone totals: `total_prd_satisfied` and `total_prd_requirements`.

## 5.5. Nyquist Compliance Discovery

Skip if `workflow.nyquist_validation` is explicitly `false` (absent = enabled).

```bash
NYQUIST_CONFIG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get workflow.nyquist_validation --raw 2>/dev/null)
```

If `false`: skip entirely.

For each phase directory, check `*-VALIDATION.md`. If exists, parse frontmatter (`nyquist_compliant`, `wave_0_complete`).

Classify per phase:

| Status | Condition |
|--------|-----------|
| COMPLIANT | `nyquist_compliant: true` and all tasks green |
| PARTIAL | VALIDATION.md exists, `nyquist_compliant: false` or red/pending |
| MISSING | No VALIDATION.md |

Add to audit YAML: `nyquist: { compliant_phases, partial_phases, missing_phases, overall }`

Discovery only — never triggers manual validation; missing/partial test-content coverage is now enforced automatically by gsd-verifier's Step 6c gate during `/gsd:execute-phase`.

## 5.6. Deferred Waivers Table

For each phase directory in the milestone's phase range:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" deferred list {phase} --raw
```

Aggregate all returned waiver entries (`step`, `reason`, `approver`, `timestamp`, `phase`, `plan`) across every phase in the milestone. Do not read `DEFERRED.json` files directly or grep `deferred-items.md` prose — `deferred list` is the single deterministic source, sharing the same malformed-JSON handling as `verify phase-gate` (a corrupt `DEFERRED.json` for any phase must be surfaced, not silently skipped as "no waivers").

Render into the aggregated `v{version}-MILESTONE-AUDIT.md` output (feeds into step 6 below, the same way step 5.5's Nyquist classification feeds the `nyquist: {...}` YAML block):

```markdown
### Deferred Waivers

| Phase | Plan | Step | Reason | Approver | Timestamp |
|-------|------|------|--------|----------|-----------|
| 45    | 03   | verification | mid-execution dry run | ollorin | 2026-07-04T17:52:27.112Z |
```

If zero waivers exist across the whole milestone, render:

```
No deferred/waived items this milestone
```

Never render a table with a header row and no data rows — the presence or absence of the table itself is the signal.

## 5.7. QA Verdict Gate

**Existence gate.** Run this step ONLY when `scripts/qa-verdict.ts` exists in the target repo —
same "run when the repo ships it" convention as the Layer-1 gates. Skip the entire step — no gap,
no warning — when the file is absent.

```bash
[ -f scripts/qa-verdict.ts ] || echo "SKIP 5.7 — scripts/qa-verdict.ts not present in this repo"
```

Unlike Step 5.5's `workflow.nyquist_validation` skip, there is **no config flag** to disable this
step when the script IS present — a gate with an off switch is not a gate.

**Resolve the run dir and the milestone number.**

```bash
RUN_DIR=$(ls -d apps/e2e-charlotte/results/*/ 2>/dev/null \
  | grep -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}/$' \
  | sort | tail -1)
```

`--current-milestone` comes from `milestone_version` already resolved in Step 0 (major/minor
stripped to its integer milestone number). The regex deliberately excludes `results/test/`.

**REQUIRED:** If `RUN_DIR` is empty, this MUST force `gaps_found` ("no run manifest to evaluate the
milestone against") — never a skip. An existence-gated step that finds no manifest is not the same
as a repo that never shipped the script.

**Invoke and parse.**

```bash
VERDICT=$(deno run --allow-read --allow-env scripts/qa-verdict.ts "${RUN_DIR%/}" \
  --current-milestone "$MILESTONE_N" --json)
```

Exit 2 (bad input) MUST force `gaps_found`. `deno` missing while `scripts/qa-verdict.ts` exists
MUST also force `gaps_found` — the repo shipped the gate; the workflow may not decline to run it
just because its runtime isn't on `PATH`.

**REQUIRED: the three blocking conditions.** Any one of the following MUST force `gaps_found` on
the milestone audit:

1. `p0Exceptions.length > 0` MUST force `gaps_found`. Definition inline (`verdict.ts`'s own
   comment): `p0Exceptions` are P0-risk features NOT in `EXECUTED_GREEN` or `GAP_ACCEPTED`.
2. `manifestStale: true` MUST force `gaps_found`. The verdict's manifest is not reset-stamped, so
   the evidence does not describe the tree being audited.
3. Any `guardHealth[]` entry with `resolvedCount < totalCount` **or** `canaryPassed: true` MUST
   force `gaps_found`. **`canaryPassed: true` is the BAD case** — it means the guard failed to fail
   on a mutation it was built to catch (`verdict.ts`'s own comment: "true here means the guard
   passed a mutation it was supposed to catch, which is the BAD case"). The inverted-looking field
   name is exactly where a reader mis-implements this — do not treat `true` as good.

**Drill log (four rules).** Check `.planning/qa/drill-log.json` — the path convention this phase
establishes; Phase 312 / MILE-15 is the future producer. Validate loosely against the frozen
`DrillLog` shape (`milestoneId`, `ranAt`, `entries[]`, `allEntriesCaught`).

| Condition | Result |
|-----------|--------|
| File absent | **`gaps_found`.** PRD F3.3 verbatim: *"A missing drill = `gaps_found`."* |
| Present but unparseable, or missing `allEntriesCaught` | **`gaps_found`** — a corrupt drill log is not a passing drill log |
| Present with `allEntriesCaught: false` | **`gaps_found`** |
| Present with `allEntriesCaught: true` | pass |

Until Phase 312 ships the producer, this condition will fire on every real milestone audit run
today — that is the gate working as designed, not a bug to route around.

**Conditional `gsd-qa-analyst` spawn.** Immediately after parsing the verdict, spawn ONLY when the
trigger holds:

- `p0Exceptions` is non-empty, OR
- some `features[]` entry has `state: "GAP"` with no `riskTier` in
  `apps/e2e-charlotte/coverage-registry.json`

Do NOT spawn on a clean verdict. Do NOT spawn when the only failures are `manifestStale` and/or
`guardHealth` problems — those are infra-shaped findings, not feature-shaped ones, and there is no
judgment call left for `gsd-qa-analyst` to add on top.

Resolve the model with the same `resolve-model` call shape Step 0 uses for the integration
checker:

```bash
qa_analyst_model=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" resolve-model gsd-qa-analyst --raw)
```

Mirror Step 3's exact `Agent(...)` call shape:

```
Agent(
  prompt="Analyse this milestone's QA verdict. Quote it; compute nothing.

Verdict JSON path: {path}
Run dir: {RUN_DIR}
Milestone: {milestone_version}
Registry: apps/e2e-charlotte/coverage-registry.json

Duties: propose risk tiers for NEW registry entries (human confirms in PR review), prioritize gap closure, draft gap-closure phase inputs in the shape plan-milestone-gaps consumes.",
  subagent_type="gsd-qa-analyst",
  model="{qa_analyst_model}",
  description="QA verdict analysis"
)
```

**The analyst's output NEVER changes the gate verdict.** The deterministic script decides
`gaps_found`; the analyst only proposes and drafts. An agent that could soften a gate is exactly
the confabulation channel this design exists to remove.

**Feed Step 6.** Every value in Step 6's `qa: {...}` aggregate block (below) is COPIED verbatim
from this step's verdict JSON — the workflow computes no QA number of its own, the same
anti-confabulation rule the analyst obeys.

## 6. Aggregate into v{version}-MILESTONE-AUDIT.md

Create `.planning/v{version}-MILESTONE-AUDIT.md` with:

```yaml
---
milestone: {version}
audited: {timestamp}
status: passed | gaps_found | tech_debt
scores:
  requirements: N/M
  phases: N/M
  integration: N/M
  flows: N/M
  prd_traceability: N/M  # N/M PRD requirements satisfied across all phases with PRD-TRACE.md. Omit if no phases used PRD Express Path.
gaps:  # Critical blockers
  requirements:
    - id: "{REQ-ID}"
      status: "unsatisfied | partial | orphaned"
      phase: "{assigned phase}"
      claimed_by_plans: ["{plan files that reference this requirement}"]
      completed_by_plans: ["{plan files whose SUMMARY marks it complete}"]
      verification_status: "passed | gaps_found | missing | orphaned"
      evidence: "{specific evidence or lack thereof}"
  integration: [...]
  flows: [...]
tech_debt:  # Non-critical, deferred
  - phase: 01-auth
    items:
      - "TODO: add rate limiting"
      - "Warning: no password strength validation"
  - phase: 03-dashboard
    items:
      - "Deferred: mobile responsive layout"
qa:  # Step 5.7 — omit entirely if scripts/qa-verdict.ts is absent (existence-gated)
  manifest_run_id: {manifestRunId}
  manifest_stale: {manifestStale}
  p0_exceptions: [{featureIds}]
  guard_health: [{guardId, resolvedCount, totalCount, canaryPassed}]
  drill_log: { present: bool, all_entries_caught: bool|null }
  qa_analyst_ran: bool
---
```

Plus full markdown report with tables for requirements, phases, integration, tech debt.

**The PRD Traceability section** (include after Requirements Coverage, before Tech Debt):

```markdown
## PRD Traceability

{For each phase with a PRD-TRACE.md — paste the per-phase table from Step 5f:}

### Phase {N}: {name}
**Source PRD:** {source_prd from PRD-TRACE.md frontmatter}

| PRD REQ-ID | Requirement | Plan | Status |
|------------|-------------|------|--------|
...

{If no phases had PRD-TRACE.md in this milestone:}
*No phases in this milestone used the PRD Express Path — PRD-TRACE.md not present in any phase directory.*
```

**Status values:**
- `passed` — all requirements met, no critical gaps, minimal tech debt
- `gaps_found` — critical blockers exist
- `tech_debt` — no blockers but accumulated deferred items need review

## 7. Distil Defect Classes into Project Rules

The milestone's phases recorded what review actually caught. Without this step those findings
live only in SUMMARY.md files, get read once, and the same class of defect gets made again next
milestone. This step converts them into general preventive rules in the consuming repo's own
`.claude/rules/*.md` — and it is the LAST thing before the PR, so the rules ship with the
milestone.

Skip this step when the milestone's phases have no `## Defect Classes` sections and no review
artifacts at all (nothing to distil) — say so in the report rather than inventing entries.

**Collect — YOU do this, before any dispatch.** Write every row to
`.planning/v{version}-DEFECT-ROWS.md`; the author dispatch reads that one file, never the phase
tree. Three sources, in order:

**(a) The `## Defect Classes` section bodies.** Loop over the `{phase_dirs}` Step 1 resolved for
THIS milestone — not every directory under `.planning/phases/`, which sweeps in other
milestones' phases. For each `*-SUMMARY.md` in those directories, extract the section BODY
(heading to the next `^## `, inclusive of the heading line for identification):

```bash
# One block per SUMMARY; empty output means the phase predates the section.
awk '/^## Defect Classes$/{f=1} f && /^## / && !/^## Defect Classes$/{f=0} f' \
  .planning/phases/{phase_dir}/{N}-{NN}-SUMMARY.md
```

Also read each phase's `{N}-PLAN-CHECK.md` if present (the plan-checker's Defect Classes block,
written there by `plan-phase.md` Step 11) and `{N}-{NN}-VERDICT.md` (the plan-checker adversarial pass's own block).

**(b) Pre-section phases.** A phase with no `## Defect Classes` anywhere predates the
requirement. Read EVERY artifact in its directory except `*-PLAN.md`, `*-RESEARCH.md` and
`*-CONTEXT.md`, and reconstruct the same 5 columns from what they record. In practice that
means the real artifact names a project accumulates: `*-SWEEP.md`, `*-FINDING.md`,
`*-MUTATION-PROOF.md`, `*-DECISIONS.md`, `*-RECONCILIATION.md`, `*-RULING*.md`,
`*-VERIFICATION.md`, `deferred-items.md`, and the prose sections of the `*-SUMMARY.md` itself (Issues Encountered,
Decisions & Deviations, Deviations from Plan). Also read `.planning/debug/resolved/` and **the
milestone's quick dirs**, defined here once and used everywhere in this step (including the
author prompt below — a definition that drifts between two prompts is how a "which quick dirs?"
question gets answered two different ways in the same milestone):

> **The milestone's quick dirs** = the directories under `.planning/quick/` whose own earliest
> commit is at-or-after the previous milestone's release tag. Resolve it deterministically, not
> by listing whatever directories happen to exist.
>
> **Step 1 + Step 2 — resolve the cutoff, then sweep, in ONE script.** They are not two
> blocks: a cutoff that fails to resolve must abort the sweep, and it can only do that if the
> resolution and the sweep share one shell's `set -e` and one `CUTOFF_AT`. Run it under **bash**,
> not the login shell — `[ "$a" -ge "$b" ]` and `head` are portable, but the `${VAR:?...}` guard
> and `>&2` behave differently under `sh`. Either save it as a script with the shebang and run
> `bash ./script.sh`, or wrap it in `bash -c '...'`.
>
> The tag must be the *previous* milestone's, NOT the latest tag: a project can be several
> milestones ahead of its newest release tag, and the latest tag then belongs to this milestone
> or a later one. `v{version}`'s predecessor is defined in `MILESTONES.md` (the milestone section
> immediately preceding `{version}`); take that section's own `shipped:`/`completed:` date, or the
> milestone BEFORE it if `{version}` itself is tagged.
>
> ```bash
> #!/usr/bin/env bash
> # One script: resolution and sweep share `set -euo pipefail`, so an unresolved
> # cutoff kills the run instead of silently widening the sweep to every quick dir.
> set -euo pipefail
> # Fail CLOSED outside a repo. Every `git` call below is fatal on failure (see
> # the loop), so without this guard the run dies with git's raw message and no
> # statement of what was wrong; against a project that is not yet a repo the
> # whole sweep is UNMEASURABLE, not empty.
> #
> # The OUTPUT must be compared, not the exit status. Run with cwd inside `.git/`,
> # `git rev-parse --is-inside-work-tree` prints `false` and still exits 0 — a
> # status-only guard sails straight through the one directory that is not a
> # checkout, and `git rev-parse --show-toplevel` then dies of its own
> # "must be run in a work tree" fatal, which is a raw git message rather than
> # the statement of intent this gate needs.
> [ "$(git rev-parse --is-inside-work-tree 2>/dev/null || true)" = true ] \
>   || { echo "NOT a git work tree — the cutoff is unmeasurable. Escalate." >&2; exit 1; }
> # An absent or empty .planning/quick/ must iterate ZERO times. Without this the
> # glob stays literal and the loop runs once on the string `.planning/quick/*/`.
> shopt -s nullglob
> # Then move to the ROOT. The sweep reads RELATIVE paths (`.planning/quick/*/`,
> # and the tag lookup resolves against the current directory), so a run started
> # from a subdirectory would find nothing and report "no quick dirs" for a
> # milestone that has plenty. The guard above already refused `.git/` itself.
> cd "$(git rev-parse --show-toplevel)"
> # PREV_VERSION = the milestone preceding {version} in MILESTONES.md.
> PREV_TAG="v$PREV_VERSION"
> if git rev-parse -q --verify "refs/tags/$PREV_TAG" >/dev/null; then
>   CUTOFF_AT=$(git log -1 --format=%at "$PREV_TAG")
> else
>   # EXPLICIT FALLBACK: the tag is missing. Say so in the report, and fall back to
>   # the shipped date recorded in MILESTONES.md for $PREV_VERSION. If THAT is
>   # missing too, the `date` call below fails and `set -e` stops the script —
>   # do not silently read every quick dir, which would sweep in other
>   # milestones' work and justify this milestone's rules with defects it never had.
>   #
>   # The date is PINNED to 00:00:00 UTC, via `-u` on BOTH the BSD and the GNU
>   # call. `date` parses a zone-less input in the LOCAL zone, so without `-u` the
>   # same shipped date yields a different instant on every machine and a cutoff
>   # that moves by hours with the operator's TZ. Dropping `-u` from EITHER call
>   # lets that branch fall back to local midnight.
>   echo "MISSING TAG $PREV_TAG — falling back to the MILESTONES.md ship date" >&2
>   SHIP='{prev_milestone_ship_date}T00:00:00'
>   CUTOFF_AT=$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "$SHIP" +%s 2>/dev/null \
>              || date -u -d "$SHIP" +%s)                 # BSD date, then GNU
> fi
> # Unresolved cutoff is fatal, never a default: the old fail-open default
> # widened the sweep to every quick dir in the repo on any resolution failure.
> : "${CUTOFF_AT:?cutoff unresolved - escalate}"
> for d in .planning/quick/*/; do
>   # EARLIEST add, which is the directory's own birth. `git log` emits
>   # newest-first, so a bare `head -1` returns the NEWEST add of ANY file in the
>   # dir — a dir whose files were added across several commits gets dated by its
>   # last one, and a later-added file can pull a genuinely older dir past the
>   # cutoff. `--reverse` puts the oldest add first, so `head -1` is the birth.
>   # A `%at` epoch compared with -ge is an integer compare, so no timezone,
>   # locale, or string-collation question can go wrong.
>   #
>   # git's output is captured FIRST, then trimmed with parameter expansion.
>   # Two earlier forms were wrong, in different ways:
>   #   `git log … | head -1 || true` — `head` closes the pipe after one line and
>   #   git dies of SIGPIPE, which under `pipefail` is indistinguishable from a
>   #   real failure, so `|| true` swallowed both and a broken repo swept clean.
>   #   `printf '%s' "$log" | head -1` — git is safely out of the pipeline by then,
>   #   but it is one more pipe to break: `printf` can take SIGPIPE from `head`
>   #   once `$log` exceeds the 64 KB pipe buffer (a quick dir with many commits),
>   #   and it does so differently under bash 3.2 and bash 5.
>   # `${log%%$'\n'*}` is a pure expansion — no subprocess, no pipe, no signal —
>   # and it yields the same first line in both bashes. Capturing the git call
>   # first is also what leaves a real git failure FATAL, which is the fail-closed
>   # behaviour this gate exists to have. No stderr redirection either: a failure
>   # must be readable, not silent.
>   log=$(git log --reverse --diff-filter=A --format=%at -- "$d")
>   first_at=${log%%$'\n'*}
>   [ -n "$first_at" ] || continue                       # no commits → EXCLUDED
>   if [ "$first_at" -ge "$CUTOFF_AT" ]; then
>     echo "$d"
>   fi
> done
> ```
>
> A quick dir with **no commits is EXCLUDED** — it is in flight and has not contributed a
> finding yet. (Contrast the Defect Classes gate itself, which fails CLOSED on an uncommitted
> file: collection is a sweep over what exists, the gate is a check on one file's compliance.
> An in-flight quick dir simply has nothing to contribute to this distillation.)

Defects found in those directories belong to no phase directory at all, which is exactly why
they need naming. If `.planning/v{version}-AUDIT-INPUTS.md` exists, read it too.

Mark every reconstructed row `reconstructed: true` in the rows file. A reconstructed row is
weaker evidence: it may justify adding or tightening a rule, but **never** on its own justify
deleting an existing rule.

**(c) Nothing else.** Do not read the milestone's own source, tests, or git history for defects
— this step distils what review already recorded, it does not run a new review.

Write the rows file as a table with a `reconstructed` column, one row per defect, plus a trailing
count. If it comes out empty, say so and skip the dispatch.

**Dispatch (fresh Opus, model `"opus"`).** The author of a rule set does not review it. Spawn:

```
Agent(
  subagent_type="general-purpose",
  model="opus",
  description="Distil milestone {version} defect classes",
  prompt=<see block below>
)
```

```
<rules_distill_prompt>
You are updating the CONSUMING REPO's Claude rules from the defect classes recorded during
milestone {version}. The project is: {project_root}

READ:
- `.planning/v{version}-DEFECT-ROWS.md` — the collected rows. This is your primary input.
- `deferred-items.md` in the `{phase_dirs}` Step 1 resolved for THIS milestone — anything
  deferred that reads as a real defect. Scope it exactly as the collection step scoped it: do
  NOT read `.planning/phases/*/deferred-items.md` with a wildcard. That glob sweeps in every
  other milestone's deferred items, so a rule distil for this milestone would be justified by
  defects the milestone never had. The orchestrator passes you the resolved list; read only
  those paths.
- The milestone's quick dirs, as DEFINED in the collection step above (earliest commit at or
  after the previous milestone's tag) — the orchestrator passes you that resolved list too.
  Never glob `.planning/quick/*/` and assume the contents are this milestone's.
- The existing `.claude/rules/*.md` and CLAUDE.md, in full.

YOU DO NOT COMMIT. You write files and stop. The orchestrator measures, reviews, and commits.
Any commit you make will be rejected.

WRITE SCOPE — edit nothing outside these paths:
- `.claude/rules/*.md`
- `CLAUDE.md` (only for a genuinely cross-cutting class)
- `.planning/v{version}-RULES-DISTILL.md` (your report — the ONLY new file you create)

TASK: cluster the rows into general defect classes, then for EACH class decide exactly one of:
1. **already-covered** — an existing rule already forbids it. Change nothing; record the
   enforcement gap (what let it through) in the report.
2. **tighten** — a rule exists but is too vague to be violated. Rewrite it as a checkable
   directive, quoting the defect class(es) that justify the change.
3. **new** — no rule covers it. Add a general rule to the most specific existing
   `.claude/rules/*.md` file (create the file only if nothing fits an existing one).

A NEW rules file must carry BOTH the project's `paths:` frontmatter (it decides when the file
auto-loads — a rules file with no paths never loads) AND a row in CLAUDE.md's Domain Rules
table. A new file missing either is a review finding, not a detail.

RULE-WRITING CONSTRAINTS (all binding):
- Write GENERAL principles as checkable directives. "Every security-gating read treats a
  returned `error` as deny" — not "be careful with error handling".
- NO incident narratives. A defect is a class, not a story. At most a one-line pointer to the
  milestone record (e.g. "seen in v0.1.33") — never the file, the incident, or the timeline.
- Merge duplicates. Delete any rule that is obsolete or contradicted by the code as it stands.
- NET LINE GROWTH ACROSS `.claude/rules/*.md` MUST BE ≤ 0. If you can only justify a class by
  adding text, you must delete or compress equivalent text elsewhere in the same commit. State
  in the report, for every file you grew, which specific existing lines you removed and why the
  trade is worth it. A report entry that does not name the removals is an invalid justification.
- Every change you make MUST cite the defect class(es) justifying it, in the report.
- Do not invent classes that no row supports. "None found" everywhere is a valid, complete
  outcome — say so.
- **GSD process defects go in the report, not in the project's rules.** Some rows describe
  defects in the GSD workflow itself ("the coordinator made a high-stakes ruling itself", "the
  test double's semantics diverged from the DB"). Those are THIS FORK's follow-ups, not the
  consuming project's engineering rules. Record them in a `## Fork follow-ups` section of your
  report and do NOT add them to `.claude/rules/`.

WRITE `.planning/v{version}-RULES-DISTILL.md` with a table —
class | decision (already-covered / tighten / new) | file changed | justification (the rows
that justify it, and the removals that paid for any added lines) | enforcement-gap note for
already-covered — plus a `## Fork follow-ups` section.

RETURN: the changed files, the per-class decisions, and the report path. Do not report your own
before/after line counts as if they were a budget check; the orchestrator measures those.
</rules_distill_prompt>
```

**Measure the budget (YOU do this, not the author).** Before the author dispatch, record
`wc -l .claude/rules/*.md CLAUDE.md`. After it returns, measure again. The rules budget is:

- **Net line growth across `.claude/rules/*.md` must be ≤ 0.** A positive net is a blocking
  finding regardless of what the report claims — the author does not get to set its own budget
  and then grade itself against it.
- **Per-file ceiling:** no single `.claude/rules/*.md` file may exceed its pre-dispatch line
  count by more than the number of lines the report justifies with named removals, and no file
  may exceed 400 lines absolute.
- `CLAUDE.md` is exempt from the ≤ 0 rule (it is the index, not a rules body) but is still
  write-scoped and still reviewed.

**Second, separate Opus check (mandatory).** The author does not review its own work. Spawn a
*different* fresh Opus dispatch with `model="opus"`. Give it the `git diff` of exactly the named
paths plus the before/after line counts you measured — not the whole repo diff:

```
Agent(
  subagent_type="general-purpose",
  model="opus",
  description="Review milestone {version} rules distillation",
  prompt="Review a proposed rules diff in {project_root} for three things ONLY.

(a) GENERALITY — is each added/changed rule a checkable general principle, or an incident story
    in rule clothing?
(b) CONTRADICTION — does any new rule contradict an existing rule, or contradict the code as it
    stands?
(c) BLOAT — given the before/after line counts below, was trimming available where text was
    added? Did the author set its own budget instead of meeting the ≤ 0 net-growth rule?

Here is the `git diff` of the named paths:

<diff>
{git diff -- .claude/rules/ CLAUDE.md .planning/v{version}-RULES-DISTILL.md}
</diff>

Line counts before → after:
{before} → {after}

Report defects with file:line. Do NOT edit anything; return findings only. If the diff is clean,
say so plainly — do not manufacture findings."
)
```

Route the result:

| Review finding | Action |
|---|---|
| None | Commit (see below). |
| Generality / contradiction / bloat defect | **Fix loop:** dispatch a FRESH author with this reviewer's findings verbatim, then re-run the review on the corrected diff. Do not patch in the reviewer or the original author — a fresh author given the findings is the loop. **Cap at 2 rounds.** If round 2's review still reports findings, STOP and escalate to the user with both rounds' findings; do not open a third round. |

**Verify the write scope (YOU do this, before the review).** A prompt is not a sandbox; the
author can drift outside the three permitted paths. Check what actually changed on disk and
refuse the commit if anything else is touched. Snapshot BEFORE the author dispatch, not after —
a tree that was already dirty would otherwise make every unrelated path look like the author's:

```bash
#!/usr/bin/env bash
# BEFORE the author dispatch. A content hash per path, not a porcelain line:
# porcelain encodes a path's state in its STATUS LETTER, so the same path can
# produce different lines before and after for reasons that have nothing to do
# with who wrote it (staged -> unstaged, or a rename's -> rename). Comparing
# the two sets then reports a change that never happened.
mkdir -p .tmp
snapshot() {           # $1 = output file
  : > "$1"
  for p in CLAUDE.md .claude/rules/*.md .planning/v{version}-RULES-DISTILL.md; do
    [ -e "$p" ] || continue
    printf '%s %s\n' "$(git hash-object "$p")" "$p" >> "$1"
  done
  git status --porcelain > "$1.status"   # for the changed-PATH set only
}
git rev-parse HEAD > .tmp/step7-head-before
snapshot .tmp/step7-hash-before
```

**Refuse up front if a permitted path was already dirty — this must be EXECUTED, not read.**
Immediately after the BEFORE snapshot, run this; it exits non-zero and you do not dispatch on a
non-zero exit. A step whose permitted paths start dirty cannot attribute any later change to the
author, so the scope check below has nothing to stand on; and the eventual `git add --`/
`git commit --` would sweep the pre-existing edits into the milestone PR under the rules commit's
message. Get a clean tree first.

```bash
#!/usr/bin/env bash
# The refusal itself. `-uall` so an untracked file is named, not collapsed to its
# directory, and no permitted path is checked at a coarser grain than the write
# scope actually is. A dirty path is a STOP, not something to subtract away later.
set -euo pipefail
dirty=$(git status --porcelain -uall -- CLAUDE.md .claude/rules/)
if [ -n "$dirty" ]; then
  {
    echo "REFUSING to dispatch: permitted paths are already dirty."
    echo "Get a clean tree first — a dirty permitted path cannot be attributed"
    echo "to the author, and the eventual git add -- would commit it as theirs:"
    echo "$dirty"
  } >&2
  exit 1
fi
```

```bash
# AFTER the author dispatch:
git rev-parse HEAD > .tmp/step7-head-after
snapshot .tmp/step7-hash-after
```

Then:

- require `git rev-parse HEAD` to be **unchanged** — the author was told `YOU DO NOT COMMIT`, so
  a new commit is a breach, not a convenience; and
- compute the changed-path set as the **set difference of the two `git status --porcelain`
  files** (path column included) — this is what catches drift, because porcelain is the only
  thing that names a path the author created; and
- compute the changed-CONTENT set as the **`git hash-object` line set difference** — this is
  what decides whether a permitted file actually changed, and it cannot be fooled by a status
  letter changing for an unrelated reason.

Two failure modes the BEFORE snapshot is what closes:

- **Untracked new files.** The author's report is a NEW file, and a rules file it creates is also
  new. `git diff` never shows an untracked file, so `git diff --name-only` alone reported the
  author as clean while it wrote a brand-new `.claude/rules/*.md` that nobody ever looked at.
- **A pre-dirty tree.** A repo already carrying unrelated uncommitted work makes every one of
  those paths look like the author's. The set difference attributes them correctly instead —
  which is exactly why a dirty permitted path is refused up front rather than subtracted away.

Make the new files visible to the reviewer as well — an untracked file has no diff, so the
reviewer would be reviewing nothing at all:

```bash
git add -N -- .claude/rules/ CLAUDE.md .planning/v{version}-RULES-DISTILL.md
git diff -- .claude/rules/ CLAUDE.md .planning/v{version}-RULES-DISTILL.md
```

Every path in the computed changed-PATH set must be one of: a file under `.claude/rules/`,
`CLAUDE.md`, or `.planning/v{version}-RULES-DISTILL.md`. If anything else appears, STOP and
escalate to the user with the offending paths listed — do not revert the author's work yourself
and do not commit a partial selection, because a partial commit hides exactly the drift you are
checking for.

**Verify a new rules file is actually wired (YOU do this, before the review).** A rules file the
author CREATED loads never if it is not registered. For every path in the changed set that did
not exist before the dispatch, assert BOTH:

- the file's frontmatter carries a `paths:` key — a rules file with no `paths:` never auto-loads; and
- `CLAUDE.md`'s Domain Rules table has a row naming it, so a human can find it.

Either one missing is a blocking finding, routed through the same fix loop as a review defect.

**Commit (YOU do this, only after a clean review).** Never use `gsd-tools.js commit` here — it
silently no-ops when the repo's `commit_docs` is off, which would drop the rules change from the
milestone PR without any error. Use git directly, path-scoped, and **stage first**. The exact
git behaviour (measured on git 2.39.1, not assumed) is:

- A **tracked** path in the list commits its current working-tree state, whether or not it was
  staged. So editing an existing `.claude/rules/*.md` needs no `add`.
- An **untracked FILE** pathspec (`.planning/v{version}-RULES-DISTILL.md` before it is ever
  added) makes git **exit 1** with `pathspec … did not match any file(s) known to git`, and
  commits nothing at all — loud, and the whole commit is refused.
- A **DIRECTORY** pathspec (`.claude/rules/`) that CONTAINS an untracked new file is the silent
  one: git commits the modified tracked files, **exits 0**, and leaves the new file uncommitted
  with no warning. This is the case that loses a new rules file from the milestone PR.

So `git add --` is REQUIRED, not cosmetic: without it the directory-pathspec case loses the new
rules file silently.

```bash
git add -- .claude/rules/ CLAUDE.md .planning/v{version}-RULES-DISTILL.md
git commit -m "docs({version}): distil defect classes into project rules" -- \
  .claude/rules/ CLAUDE.md .planning/v{version}-RULES-DISTILL.md
```

Include `CLAUDE.md` in the path list if it was edited. Commit the report even when the review
was not clean, so the milestone record shows whether the rules were reviewed clean or escalated.

## 8. Present Results

Route by status (see `<offer_next>`).

</process>

<offer_next>
Output this markdown directly (not as a code block). Route based on status:

---

**If passed:**

## ✓ Milestone {version} — Audit Passed

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

All requirements covered. Cross-phase integration verified. E2E flows complete.

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Complete milestone** — archive and tag

/gsd:complete-milestone {version}

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

---

**If gaps_found:**

## ⚠ Milestone {version} — Gaps Found

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

### Unsatisfied Requirements

{For each unsatisfied requirement:}
- **{REQ-ID}: {description}** (Phase {X})
  - {reason}

### Cross-Phase Issues

{For each integration gap:}
- **{from} → {to}:** {issue}

### Broken Flows

{For each flow gap:}
- **{flow name}:** breaks at {step}

### Nyquist Coverage

| Phase | VALIDATION.md | Compliant | Action |
|-------|---------------|-----------|--------|
| {phase} | exists/missing | true/false/partial | auto-enforced by gsd-verifier's Step 6c on next `/gsd:execute-phase` |

Phases needing test-content validation: this is now enforced automatically by gsd-verifier's Step 6c (test-content coverage gate) during `/gsd:execute-phase` — no separate manual command is needed.

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Plan gap closure** — create phases to complete milestone

/gsd:plan-milestone-gaps

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

**Also available:**
- cat .planning/v{version}-MILESTONE-AUDIT.md — see full report
- /gsd:complete-milestone {version} — proceed anyway (accept tech debt)

───────────────────────────────────────────────────────────────

---

**If tech_debt (no blockers but accumulated debt):**

## ⚡ Milestone {version} — Tech Debt Review

**Score:** {N}/{M} requirements satisfied
**Report:** .planning/v{version}-MILESTONE-AUDIT.md

All requirements met. No critical blockers. Accumulated tech debt needs review.

### Tech Debt by Phase

{For each phase with debt:}
**Phase {X}: {name}**
- {item 1}
- {item 2}

### Total: {N} items across {M} phases

───────────────────────────────────────────────────────────────

## ▶ Options

**A. Complete milestone** — accept debt, track in backlog

/gsd:complete-milestone {version}

**B. Plan cleanup phase** — address debt before completing

/gsd:plan-milestone-gaps

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────
</offer_next>

<success_criteria>
- [ ] Milestone scope identified
- [ ] All phase VERIFICATION.md files read
- [ ] SUMMARY.md `requirements-completed` frontmatter extracted for each phase
- [ ] REQUIREMENTS.md traceability table parsed for all milestone REQ-IDs
- [ ] 3-source cross-reference completed (VERIFICATION + SUMMARY + traceability)
- [ ] Orphaned requirements detected (in traceability but absent from all VERIFICATIONs)
- [ ] Tech debt and deferred gaps aggregated
- [ ] Integration checker spawned with milestone requirement IDs
- [ ] v{version}-MILESTONE-AUDIT.md created with structured requirement gap objects
- [ ] FAIL gate enforced — any unsatisfied requirement forces gaps_found status
- [ ] Nyquist compliance scanned for all milestone phases (if enabled)
- [ ] Missing VALIDATION.md phases flagged (test-content coverage now enforced automatically by gsd-verifier's Step 6c gate — no manual command needed)
- [ ] PRD-TRACE.md cross-reference run for each phase with PRD Express Path (Step 5f) — optional, skipped if absent; NOT a blocker when absent
- [ ] MILESTONE-AUDIT.md includes PRD Traceability section and prd_traceability score (if any phases used PRD Express Path)
- [ ] Every milestone phase's `## Defect Classes` collected into `v{version}-DEFECT-ROWS.md` (pre-section phases reconstructed from every non-PLAN/RESEARCH/CONTEXT artifact, `.planning/debug/resolved/`, and `.planning/quick/*/`)
- [ ] Fresh Opus distillation dispatched; per class an already-covered / tighten / new decision recorded
- [ ] Net line growth across `.claude/rules/*.md` measured by the orchestrator and ≤ 0 (or the run escalates)
- [ ] Write scope held: only `.claude/rules/`, CLAUDE.md, and the report were edited
- [ ] `v{version}-RULES-DISTILL.md` written AND committed (after a clean review)
- [ ] A SECOND, separate Opus review of the rules diff run on the named paths; findings routed to a FRESH author, capped at 2 rounds, then escalated
- [ ] Committed with `git commit -- <paths>` only after a clean review
- [ ] Results presented with actionable next steps
</success_criteria>
