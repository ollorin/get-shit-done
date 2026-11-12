---
paths:
  - "scripts/validation/**"
  - ".github/workflows/**"
---

# Guard Authoring Rules

Applies to: `scripts/validation/**`, `.github/workflows/**`, and any new guard added to the guard registry.

## 1. Comment-stripped, AST-adjacent extraction only

Never first-match on raw source. Every extraction pass reads a comment-stripped view first: a strip helper for each source language the guard reads (one for TypeScript or JavaScript, one for SQL).

Two failure directions:

- A guard that reads raw source is fooled by a doc comment that mentions the compliant shape while the real violation sits below it. Incident: a past canary corpus item caught exactly this.
- A guard that only matches string literals goes blind the moment the house style moves to a `const` built by a helper. Incident: literal-only matching silently blinded three guards to 23 of 24 real declarations.

**Positive rule:** resolve identifiers to their bindings where the binding is statically decidable, using one shared resolver. Where a binding is not statically decidable, surface the failure (an `unresolvedItems` entry) rather than guessing or silently dropping it.

## 2. Parse-or-fail is mandatory

Every guard emits `ResolutionTelemetry` imported from the one shared telemetry module, never forked into a second copy. `totalCount` is counted independently of the pass that produces `resolvedCount`; the rationale is in the guard specification of the project's docs, not re-derived here. `resolvedCount < totalCount` is ALWAYS a FAIL naming every `unresolvedItems[].name`: never a warning, never a skip, and never routed through a baseline or accept-list (a baseline accepts a KNOWN violation; it must never be able to suppress a guard that has stopped being able to see its own input).

- **Good independent counter:** a deliberately broader or simpler pattern over the same comment-stripped text, or a hand-authored expected-field list declared away from the constructor.
- **Bad independent counter:** `totalCount = resolvedCount + skipped.length`, or any count derived from the extraction pass's own output. Both shrink together with the numerator; a guard degraded from 10 of 24 to 1 of 29 and still reported PASS.

**Unreadable is FAIL, unknown is not "no".** This binds every gate, scan, probe and CI step, not only registry guards: a scanner that did not run, a missing input file, or a glob matching zero tracked files is FAIL, never PASS or an empty result (no `|| true` turning a tool failure into "nothing affected"). A result check requires an explicit success value, so a cancel or an unexplained skip is not green. A skip that is the intended result of affected-detection is allowed. A 403 or 404 from a probe means UNKNOWN, never "does not exist". A guard that asserts an N-site invariant counts all N sites over the whole stripped body and anchors identifiers on both boundaries.

## 3. Every new guard ships a canary corpus with a demonstrated failure

A guard change is incomplete without all four:

1. A canary corpus module under `scripts/validation/canaries/`, with at least three fixtures, in house style: real scenario, SQL or metadata shapes run through the guard's real parser, never a hand-built already-parsed object and never a toy string, because the parser is precisely the layer that goes blind.
2. The three fixture classes: one realistic violation in the shape the codebase actually writes; one violation adjacent to comment prose that could fool a comment-blind extractor; one extraction-failure edge case the guard cannot resolve. Plus one violation per syntax form the class can take on disk (for example each keyword variant, any quoting form, and both a hoisted variable and an inline literal).
3. The corpus file is named `scripts/validation/canaries/<id>.canaries.mjs` for the guard's registry id and exports `CANARIES`; the canary gate (`scripts/validation/canary-gate.mjs`) discovers it by that name, so the fixtures run on every pre-PR gate run.
4. Evidence the check was watched RED before the implementation existed: the failing output pasted into the PR or the summary, not a claim that it was run.

**Machine backstop:** the canary gate reconciles corpus coverage against the guard registry and fails the build on a registry id with no corpus (`uncoveredGuards`) or fewer than three fixtures (`undersizedCorpora`). Requirements 1 and 3 therefore cannot be skipped silently. Requirements 2 and 4 are enforced by review: the verifier's test-content rule rejects trivial or absent test content, and it now has a named target for guard changes.

## 4. New-guard checklist

- Add the guard to the guard registry (`scripts/validation/guard-registry.mjs`) AND to the registry's doc table (`docs/gsd/guard-estate.md`). The reconcile check fails on one without the other: both or neither.
- Pure exported decision functions; all I/O and a single process exit confined to `main()`, run under the module-entry check.
- A `--json` mode, matching the project's other guards.
- `ResolutionTelemetry` emitted per section 2.
- Canary corpus per section 3.
- Wire into `{{stack.commands.pre_pr_gate}}` as a deterministic run-once check. Canary corpora are static fixtures, not flake-sensitive: no double run is needed.

## 5. Where a guard's canary corpus and demonstrated-failure proof must live

**In a test file that an existing, wired suite runs**, that is, the suite named by the profile key `stack.commands.test_all`, which the pre-PR gate also runs. **Never in a standalone script, never in a new CI job.** Cover helper logic by adding test cases, not by adding scripts.

Rationale: a corpus or proof that no runner executes is a comment. A set of self-tests that ran in neither CI nor the pre-PR gate was first executed by a later pass, and that first run found two real under-detection bugs.
