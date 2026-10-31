# Pre-PR Quality Gates — MANDATORY

Applies to: all PRs, all branches, no exceptions

---

## Why This Rule Exists

Skipping integration tests and Charlotte E2E ships untested migrations that fail on `supabase db reset`. No PR goes out without these gates.

## The Rule

**Before opening ANY PR or claiming work is complete, run the local CI preflight:**

```bash
scripts/preflight.sh
```

This single script mirrors `.github/workflows/pr-validation.yml` exactly. It:
- Auto-detects affected projects from git diff
- Runs the **deterministic** gates ONCE (run 1 only): type checks, `deno lint`,
  frontend builds + lint, import-map freshness, RPC insert-order safety,
  env-manifest parity, migration completeness, docs vale/markdownlint, the
  fp/routing/sizing violation ratchet, the migration-security gate, the
  dependency **CVE/OSV scan gate** (`scripts/cve-scan-gate.ts`, wired into
  preflight itself), and the `next` CVE-waiver tripwire. Static analysis cannot flake, so a
  second identical run adds only wall time.
- Runs the **flake-sensitive** stages TWICE (both passes must be green): unit
  tests + coverage (`test:ci`), the atomic scrubbed integration block, and the
  frontend `nx test` suites — with a `supabase db reset` between the two test
  passes. The test double-run stays LOCKED for now: any stage that passes in
  run 1 and fails in run 2 is recorded as one append-only JSONL line in
  `.planning/preflight-disagreements.jsonl` (stage, run outcomes, best-effort
  failing tests, log path). That file is the evidence base for a future CEO
  decision to relax the test double-run to run-once-plus-retry
  (280-FINDINGS.md) — do not drop the double-run without it.
- Writes `.preflight-passed` marker that unblocks `git push` — written ONLY
  when run 1 AND the flake-sensitive re-run are fully green

**Flags:**
- `--all` — force all checks regardless of changes
- `--backend` / `--frontend` — scope to one layer
- `--skip-twice` — skips the flake-sensitive second run (NOT PR-ready, for quick local checks only)

### Before any plan, fix or SUMMARY claims done

Tests green is not done. On the final tree run: `deno check` and `deno lint` for touched
`apps/api` paths; `deno fmt` then lint again (fmt can detach a `// deno-lint-ignore`);
`deno run --allow-read scripts/fp-gate.ts` (throws, fire-and-forget, 500-LOC); `npx nx typecheck`
and `lint` for a touched frontend project (vitest green is not typecheck green); and, for any NEW
money/auth/KYC module, `deno run --allow-read scripts/check-p0-tier-delta.ts --diff-file <diff>` —
it needs a risk-tiered registry entry.

### Additional gates (not in preflight — run manually when applicable)

**Database Migration Verification** (if any migration files changed):
```bash
cd apps/api && npx supabase db reset
```

**Charlotte E2E Regression Tests** (if any UI or API changes):
```bash
cd apps/e2e-charlotte && deno task test:regression
```

## Coverage Gate

**Coverage validation runs automatically in `deno task test:ci` and CI.**

**Per-domain block/warn mode:** `libs/domain`, `libs/rng`, and
`libs/application` are now **block mode** — a threshold miss in any of these three fails CI.
`libs/infrastructure`, `functions`, and `all` remain **warn mode** — a threshold miss only prints
a warning. Independent of mode, **any domain whose LINES coverage measures below its recorded
baseline fails CI** (see baseline-regression below) — warn-mode domains are not exempt from that
check. **BRANCH-axis baseline regressions are reported but do NOT fail CI** — the
one exception, and it applies only to the baseline check, never to a threshold check.

Per-domain thresholds are maintained in `apps/api/coverage-targets.json`:

```json
{
  "default_mode": "warn",
  "domains": {
    "libs/domain": { "mode": "block", "lines": 85, "branch": 70 },
    "libs/application": { "mode": "block", "lines": 75, "branch": 80 },
    "libs/infrastructure": { "mode": "warn", "lines": 70, "branch": 15, "glide_path": [...] },
    "libs/rng": { "mode": "block", "lines": 88, "branch": 90 },
    "functions": { "mode": "warn", "lines": 55, "branch": 20, "glide_path": [...] },
    "all": { "mode": "warn", "lines": 68, "branch": 33 }
  }
}
```

**Baseline-regression detection:** `apps/api/coverage-baseline.json` is a git-tracked, ratchet-up-only
record of each domain's last-measured lines/branch coverage. `scripts/coverage-gate.ts`'s
`evaluateDomain()` compares fresh measurements against this baseline (0.05pp tolerance for
float/rounding noise) and fails CI on a **LINES-axis** drop — regardless of the domain's block/warn
mode. Never manually lower a value in this file to "fix" a failing gate; a real regression must be
fixed at the source.

**Branch-axis baseline regressions are informational only.** A
below-baseline branch measurement is still computed, still surfaced (`branchRegressed` on the
evaluation, an explicit reason line, and `info` in the printed `Regressed` column) — it just does
not set `blocking`. Reason: `deno coverage`'s cross-isolate BRANCH merge is defective and produces
mathematically impossible aggregates (e.g. `auth-schemas.ts` measured
`Branch 0.0% / Line 82.8%` simultaneously). Lines-axis merging is a plain per-line union
and is unaffected, so that axis carries the whole regression guarantee. **This changes only the
baseline check — a block-mode domain that falls below its configured BRANCH target in
`coverage-targets.json` still fails CI exactly as before.** Full rationale, the revert recipe, and
the CEO veto invitation: `docs/testing/coverage-glide-path.md` → "Assumed decisions (CEO to veto)".

`libs/infrastructure` and `functions` carry a dated `glide_path` array (checkpoints toward
eventual block-mode eligibility, with dates through 2027-01-15) — the full narrative, the
"structurally harder" rationale, and the required "Assumed decisions (CEO to veto)" record for
those dates live in `docs/testing/coverage-glide-path.md`. Reaching a domain's final checkpoint
makes it *eligible* for a future phase to flip to block mode — it does not auto-flip it.

**Baseline lifecycle (LOCAL, a PR-committed artifact):**
`coverage-baseline.json` is the ratchet-up-only regression floor. It is **no longer updated by a
CI bot** — the old `update-coverage-baseline` job in `deploy-staging.yml` (which committed a
ratchet back to `main` as `github-actions[bot]`) has been **removed**. That bot-push-to-main was
fragile (needed a write token; 403'd on the repo's read-only default), coupled coverage
bookkeeping to deploying, re-ran the whole suite a third time, and could lock in a fluke-high
measurement.

The floor now moves **only when a human commits it in a PR**:
- The PR-blocking **regression check** is unchanged: `deno task coverage:gate` runs inside
  `test:ci` (so it fires **locally** in `scripts/preflight.sh` AND in `pr-validation.yml`) and
  fails any change that drops a domain below its recorded floor. It never gets `--allow-write`.
- To **raise** the floor after you legitimately improve coverage, run **`deno task
  coverage:update`** (measures unit-domain coverage the same way the gate does, then ratchets
  `coverage-baseline.json` up-only via the still-pure, unit-tested `ratchetBaseline()` in
  `scripts/update-coverage-baseline.ts`). **Review the diff** and commit the updated
  `coverage-baseline.json` **in the same PR** as the change that earned it. Never hand-edit a value
  downward; if real coverage regresses, fix the regression, don't lower the floor.
- **Deleting redundant tests is allowed** when the floor still holds, or when the uncovered lines are
  a pure barrel (only `export ... from` statements). The reviewed exclusion list is planned for Phase 418 (built before the first barrel test is deleted, via `deno coverage --exclude` fed from that list); until then, deleting a test must not drop a domain below its baseline.

Run coverage locally:
```bash
cd apps/api
deno task test:ci              # Unit tests + coverage collection + coverage:gate (blocking for libs/domain, libs/rng, libs/application)
deno task coverage:gate        # Check thresholds (per-domain block/warn) + baseline regression only
deno task coverage:update      # Ratchet coverage-baseline.json up-only; review the diff, commit it IN YOUR PR
deno task coverage:report      # Generate full HTML report
```

For the hardening plan, see `.planning/phases/270-coverage-gate-hardening/` and
`docs/testing/coverage-glide-path.md`.

## Enforcement

- There is NO "open PR anyway" escape hatch
- There is NO "I'll fix it after the PR" path
- Claiming "tests pass" without actually running them is never acceptable
- Each gate must produce visible output proving it ran and passed
- The `git push` hook blocks unless `.preflight-passed` marker exists (< 30 min old)
