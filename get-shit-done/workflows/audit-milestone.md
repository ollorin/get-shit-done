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

**Collect.** Every `## Defect Classes` row across the milestone's phases:

```bash
grep -rn "^## Defect Classes" .planning/phases/ --include="*-SUMMARY.md"
```

For phases that predate the section, fall back to their `deferred-items.md`, any
`*-REVIEW.md` / `*-VERDICT.md` / other ruling artifacts, and `{N}-VERIFICATION.md` gaps — read
those and reconstruct the same 5 columns. Mark such rows `reconstructed` in the report; a
reconstructed row is weaker evidence and must not by itself justify deleting an existing rule.

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
- Every `## Defect Classes` row across this milestone's phases' *-SUMMARY.md
- The milestone's review/ruling artifacts (*-REVIEW.md, *-VERDICT.md) and {N}-VERIFICATION.md
  for phases that predate the section
- The existing `.claude/rules/*.md` and CLAUDE.md, in full

TASK: cluster the rows into general defect classes, then for EACH class decide exactly one of:
1. **already-covered** — an existing rule already forbids it. Change nothing; record the
   enforcement gap (what let it through) in the report.
2. **tighten** — a rule exists but is too vague to be violated. Rewrite it as a checkable
   directive, quoting the defect class(es) that justify the change.
3. **new** — no rule covers it. Add a general rule to the most specific existing
   `.claude/rules/*.md` file (create the file only if nothing fits an existing one).

WHERE: `.claude/rules/*.md`. Touch CLAUDE.md only if the class is genuinely cross-cutting —
it applies to every layer, not just the paths one rules file covers.

RULE-WRITING CONSTRAINTS (all binding):
- Write GENERAL principles as checkable directives. "Every security-gating read treats a
  returned `error` as deny" — not "be careful with error handling".
- NO incident narratives. A defect is a class, not a story. At most a one-line pointer to the
  milestone record (e.g. "seen in v0.1.33") — never the file, the incident, or the timeline.
- Merge duplicates. Delete any rule that is obsolete or contradicted by the code as it stands.
- Respect the project's own token/length discipline (see its CLAUDE.md): keep every file under
  a stated budget you set in the report, and PREFER TRIMMING existing text to adding.
- Every change you make MUST cite the defect class(es) justifying it, in the report.
- Do not invent classes that no row supports. "None found" everywhere is a valid, complete
  outcome — say so.

WRITE: `.planning/v{version}-RULES-DISTILL.md` with a table —
class | decision (already-covered / tighten / new) | file changed | justification (the rows
that justify it) | enforcement-gap note for already-covered.

COMMIT: only the rules files you changed plus the report. Use
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs({version}): distil defect
classes into project rules" --files <the rules files> .planning/v{version}-RULES-DISTILL.md`.
Never commit the consuming repo's source code, tests, settings.json, or any hook config.

RETURN: the changed files, the per-class decisions, the before/after line count of each rules
file, and the report path.
</rules_distill_prompt>
```

**Second, separate Opus check (mandatory).** The author does not review its own work. Spawn a
*different* fresh Opus dispatch with `model="opus"` to review the rules diff:

```
Agent(
  subagent_type="general-purpose",
  model="opus",
  description="Review milestone {version} rules distillation",
  prompt="Review the uncommitted `.claude/rules/*.md` diff and .planning/v{version}-RULES-DISTILL.md in {project_root} for three things ONLY: (a) GENERALITY — is each rule a checkable general principle, or is it an incident story in rule clothing? (b) CONTRADICTION — does any new rule contradict an existing rule, or contradict the code as it stands? (c) BLOAT — did the diff grow any file past its stated budget when trimming was available? Report defects with file:line. Do NOT edit anything; return findings only. If the diff is clean, say so plainly — do not manufacture findings."
)
```

Route the result:

| Review finding | Action |
|---|---|
| None | Commit the rules files + report. |
| Generality / contradiction / bloat defect | Send it back to the author dispatch to fix, then re-run the review on the corrected diff. Do not review-and-patch in the same dispatch — that is the self-review the split exists to prevent. |

Commit the report either way, so the milestone record shows whether the rules were reviewed
clean or revised.

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
- [ ] Every milestone phase's `## Defect Classes` collected (pre-section phases reconstructed from their review/VERIFICATION artifacts)
- [ ] Fresh Opus distillation dispatched; per class an already-covered / tighten / new decision recorded
- [ ] `v{version}-RULES-DISTILL.md` written and committed alongside the rules files it justifies
- [ ] A SECOND, separate Opus review of the rules diff run; findings (if any) routed back to the author dispatch, not self-patched
- [ ] Results presented with actionable next steps
</success_criteria>
