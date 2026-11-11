---
paths:
  - "scripts/validation/**"
  - "apps/e2e-charlotte/runner/reset.ts"
  - ".github/workflows/**"
---

# Guard Authoring Rules

Applies to: `scripts/validation/**`, `apps/e2e-charlotte/runner/reset.ts`, and any new guard added
to `GUARD_REGISTRY`

---

## 1. Comment-stripped, AST-adjacent extraction only

Never first-match on raw source. Every extraction pass reads a comment-stripped view FIRST:
`stripComments()` (`scripts/validation/e2e-fixture-guards.ts:181`) for TypeScript,
`stripSqlComments()` (`scripts/validation/e2e-seed-diff-guard.ts:131`) for SQL.

Two failure directions:

- A guard that reads raw source is fooled by a doc comment that mentions the compliant shape
  while the real violation sits below it (commit `f6cfeed4`, see
  `docs/testing/contract-guard-spec.md`'s canary-corpus-list item 2).
- A guard that only matches string LITERALS goes blind the moment the house style moves to a
  `const` built by a helper. `resolveAccountArray()`'s own comment
  (`scripts/validation/e2e-fixture-guards.ts:482-485`) records that `extractQuotedStrings()` alone
  silently blinded G1/G2/G3 to 23 of 24 real declarations.

**Positive rule:** resolve identifiers to their bindings where the binding is statically decidable
— `resolveAccountBindings()` (`scripts/validation/e2e-fixture-guards.ts:982`) is the reference
implementation. Where a binding is not statically decidable, surface the failure (an
`unresolvedItems` entry) rather than guessing or silently dropping it.

## 2. Parse-or-fail is mandatory

Every guard emits `ResolutionTelemetry` imported from
`scripts/qa-schemas/contract-guard-telemetry.ts` — imported, never forked into a second copy.
`totalCount` must be counted independently of the pass that produces `resolvedCount`; see
`docs/testing/contract-guard-spec.md`'s "Parse-or-fail rule (non-negotiable)" for the rationale
rather than re-deriving it. `resolvedCount < totalCount` is ALWAYS a FAIL naming every
`unresolvedItems[].name` — never a warning, never a skip, and never routed through a
baseline/accept-list (a baseline accepts a KNOWN violation; it must never be able to suppress a
guard that has stopped being able to see its own input).

- **Good independent counter:** a deliberately broader/dumber regex over the same
  comment-stripped text, or a hand-authored expected-field list declared away from the
  constructor.
- **Bad independent counter:** `totalCount = resolvedCount + skipped.length`, or any count derived
  from the extraction pass's own output — both shrink together with the numerator, which is the
  exact defect that let a guard degrade from 10/24 to 1/29 while still reporting PASS.

**Unreadable is FAIL, unknown is not "no".** This binds every gate, scan, probe and CI step, not
only registry guards: a scanner that did not run, a missing input file, or a glob matching zero
tracked files is FAIL, never PASS or an empty result (no `|| true` turning a tool failure into
"nothing affected"); a result check requires an explicit success value, so a cancel or an unexplained
skip is not green (a skip that is the intended result of affected-detection, as in
`require_success_or_skipped` in `pr-validation.yml`, is allowed); a 403/404 from a probe means
UNKNOWN, never "does not exist". A guard that asserts an N-site invariant counts all N sites over
the whole stripped body and anchors identifiers on both boundaries.

## 3. Every new guard ships a canary corpus with a demonstrated failure

A guard PR is incomplete without all four:

1. A canary corpus module under `scripts/validation/canaries/`, at least three fixtures, in HOUSE
   STYLE — real scenario/SQL/metadata shapes run through the guard's real parser, never a
   hand-built already-parsed object and never a toy string, because the parser is precisely the
   layer that goes blind.
2. The three fixture classes: one realistic violation in the shape the estate actually writes; one
   violation adjacent to comment prose that could fool a comment-blind extractor; one
   extraction-failure edge case the guard cannot resolve. Plus one violation per syntax form the
   class can take on disk (e.g. `FUNCTION` and `PROCEDURE`, any dollar tag, `ALL PRIVILEGES`,
   a hoisted variable as well as an inline literal).
3. An entry in `scripts/validation/canary-gate.ts`'s corpus aggregation, so the fixtures run on
   every preflight.
4. Evidence the check was watched RED before the implementation existed — the failing output
   pasted into the PR/SUMMARY, not a claim that it was run.

**Machine backstop:** `canary-gate.ts` reconciles corpus coverage against `GUARD_REGISTRY`
(`scripts/validation/guard-registry.ts`) and fails the build on a registry id with no corpus
(`uncoveredGuards`) or fewer than three fixtures (`undersizedCorpora`) — so requirements 1 and 3
cannot be skipped silently. Requirements 2 and 4 are enforced by review — `gsd-verifier`'s
existing test-content rule (which rejects trivial or absent test content) now has a concrete,
named target for guard PRs. That is SC-5.

## 4. New-guard checklist

- Add to `GUARD_REGISTRY` (`scripts/validation/guard-registry.ts`) AND the doc table in
  `docs/testing/e2e-fixture-architecture.md` — they are machine-reconciled by
  `guard-registry-reconcile.ts`, so both or neither.
- Pure exported decision functions; all I/O and a single `Deno.exit()` confined to `main()` under
  `if (import.meta.main)`.
- `--json` dual mode, matching the estate's existing guards.
- `ResolutionTelemetry` emitted per section 2 above.
- Canary corpus per section 3 above.
- Wire into `scripts/preflight.sh` as a deterministic run-once check (canary corpora are static
  fixtures, not flake-sensitive — no double-run needed).

## 5. Where a guard's canary corpus and demonstrated-failure proof must live

**In a test file an existing, wired suite runs** — `deno task test:repo-scripts`
(`apps/api/deno.json:55`), called from `scripts/preflight.sh` run 1 and from the `canary-gate` job
in `pr-validation.yml`. **Never in a standalone script, never in a new CI job.** Cover helper logic
by adding test CASES, not by adding scripts.

Rationale: a corpus or proof that no runner executes is a comment. 53 test files under the repo-root
`scripts/` folder — including `check-env-manifest-parity.test.ts` and every guard self-test — ran in
neither CI nor preflight until this pass, and their first execution immediately found two real
under-detection bugs in the api-contract registry generators.

## 6. Known scope limits, stated honestly

- The guards' own `*.test.ts` files under `scripts/validation/` and the rest of the repo-root
  `scripts/` folder ARE run, by `deno task test:repo-scripts` in both `scripts/preflight.sh` and
  `.github/workflows/pr-validation.yml`.
- G8 (`apps/e2e-charlotte/runner/reset.ts`) is not preflight-wired at all — its only caller is the
  Charlotte runner, which is LOCAL ONLY per `.claude/rules/testing.md`. Its build-blocking coverage
  comes solely from `canary-gate.ts`.
