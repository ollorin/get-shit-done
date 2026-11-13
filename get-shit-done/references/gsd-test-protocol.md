<overview>
The GSD test protocol defines what test evidence is required per phase type and how that evidence
must appear in SUMMARY.md. Every executed plan that touches source code MUST include test evidence
in its SUMMARY.md. Missing evidence is a verification gap.

This reference is used by:
- `gsd-executor` agents when writing SUMMARY.md
- `gsd-verifier` agents when checking whether a phase produced adequate test evidence
- The `open-pr` command pre-flight check
</overview>

<evidence_tiers>

## Test Evidence Tiers

| Tier | Label | Required for |
|------|-------|--------------|
| T1 | Unit tests | Domain logic, application services, utility functions |
| T2 | Integration tests | API routes, database queries, RPC calls |
| T3 | UI QA | UI phases — any phase touching .tsx/.jsx files |
| T4 | E2E flows | Cross-layer user flows defined in plan frontmatter |

</evidence_tiers>

<evidence_by_phase_type>

## Evidence Requirements by Phase Type

### Backend — Domain/Application/Infrastructure (`functions/`, `libs/`)

**Minimum required:** T1 (unit tests)

```markdown
## Test Evidence

**Unit tests:** the `test_all` command from `stack_commands` — 12/12 passing
Command: the `test_all` command from `stack_commands`
Output: `12 tests passed, 0 failed`
```

If the plan adds or modifies database queries or API routes, T2 is also required:

```markdown
**Integration tests:** the integration gate in `stack.gates[]` — 5/5 passing
Command: the integration gate in `stack.gates[]`
Output: `5 tests passed, 0 failed`
```

### Frontend UI (`stack.paths.frontends`)

**Minimum required:** T3 (UI QA)

```markdown
## Test Evidence

**UI QA:** Passed — 0 issues found
Mode: ui-qa, Round: 1
Flows tested: settings form, history tab, limit removal
```

If the frontend phase has e2e_flows in the plan frontmatter, T4 is also required.

### Infrastructure-only (migrations, config, CI changes)

**Minimum required:** Verification command output

```markdown
## Test Evidence

**Migration verification:** the database reset in `stack.services[]` — completed successfully
**Type check:** npx tsc --noEmit — 0 errors
```

### GSD Workflow / Tooling Changes (`~/get-shit-done/`)

**Minimum required:** Dry-run or equivalent verification

```markdown
## Test Evidence

**Dry-run verification:** Command tested with --dry-run flag
**Installation verification:** install script run, files propagated to ~/.claude/
**Gate test:** the pre-PR command (`stack.commands.pre_pr_gate` caller) with its dry-run flag, without the pass marker → rejected as expected
```

</evidence_by_phase_type>

<summary_md_format>

## SUMMARY.md Test Evidence Section

Every SUMMARY.md MUST include a `## Test Evidence` section. Structure:

```markdown
## Test Evidence

| Check | Command | Result |
|-------|---------|--------|
| Unit tests | the `test_all` command from `stack_commands` | 12/12 passing |
| Integration tests | the integration gate in `stack.gates[]` | 5/5 passing |
| Type check | `npx tsc --noEmit` | 0 errors |
| Lint | `npm run lint` | 0 warnings |
| FP lint | `bash scripts/fp-lint.sh` | 0 violations |
```

**Mandatory fields:**
- At least one row matching the phase type requirements above
- Result column must be concrete: `N/N passing`, `0 errors`, `PASSED`, never `OK` or `Done`

**If tests were skipped with justification:**
```markdown
## Test Evidence

Unit tests: skipped — infrastructure-only change (migration file only, no logic code)
Verification: the database reset in `stack.services[]` completed without errors
```

Justification must be specific. "No tests needed" is never acceptable.

</summary_md_format>

<gsd_executor_instructions>

## Instructions for gsd-executor Agents

When writing SUMMARY.md after plan execution:

1. **Identify the phase type** from the plan's objective and files modified
2. **Select the minimum evidence tier** from the table above
3. **Run the required check** and capture output
4. **Include the `## Test Evidence` section** in SUMMARY.md with concrete results

If a required check fails:
- Do NOT write a passing SUMMARY.md
- Report the failure with the full error output
- The plan is NOT complete until tests pass

If infrastructure prevents running tests (e.g., the database service in `stack.services[]` not running for integration tests):
- Document the blocker in SUMMARY.md under `## Test Evidence`
- Note what would be run when the blocker is resolved
- The verifier will flag this as a gap requiring human verification

</gsd_executor_instructions>

<test_cost_rule>

## Test cost: where the full pre-PR gate run happens

Canonical statement; agents point here. Project rules name the exact commands.

1. Inside a plan and in fix loops run only the affected test files (the `test_file` command from `stack_commands`) plus the single bucket containing them (the integration gate in `stack.gates[]`), once. No full pre-PR gate run inside a plan.
2. ONE full run per phase (the `mechanical_gates` step of `execute-phase.md`: every `stack.gates[]` entry plus the full test run, output in `{phase_dir}/captures/gates.txt`), on the final phase tree, before any review. Reviewers and the verifier read that capture and do not re-run the suite. After fixing its findings, rerun only the touched test files (and their bucket when the project defines buckets), appended to the capture.
3. The "tests green twice" pass over all buckets runs once, at milestone end / before the PR, not per phase and not per plan. `--skip-twice` is allowed for intermediate checks and is never claimed PR-ready.
4. Cheap gates run on their own and early: test coverage for touched libs, type check, lint, format, and every gate in `stack.gates[]`. The phase-final full pre-PR gate run stays mandatory: it catches cross-module breakage (fmt vs a pin test, a contract change vs another plan's test).

Reason: a full pre-PR gate run is 25+ min under the shared stack lock; repeating it per plan starves parallel phases.

</test_cost_rule>

<verifier_instructions>

## Instructions for gsd-verifier Agents

When verifying a phase, check the `## Test Evidence` section in each SUMMARY.md:

1. **Does the section exist?** If absent: gap — `missing_test_evidence`
2. **Does it match the required tier?** If unit test phase has no unit test output: gap — `insufficient_test_evidence`
3. **Are results concrete?** `12/12 passing` is concrete. `OK` is not: gap — `non_specific_test_evidence`
4. **For UI phases: did UI QA run?** If UI source files in key-files but no UI QA row: gap — `missing_charlotte_qa`

Report all gaps in VERIFICATION.md under `## Gaps`.

</verifier_instructions>
