# Module Structure Rules

## Parameters

The ceiling and the scan roots are named parameters, not literals in the rules below. A project sets them in its style gate configuration (the gate reads them at run time); the values here are the defaults.

| Parameter | Default | Meaning |
|---|---|---|
| `LOC_CEILING` | 500 | Lines above which a source file counts as oversize |
| `SPLIT_TARGET` | 400 | Line count at which a file should be split before it grows further |
| `TEST_TARGET` | 1500 | Target ceiling for test files, which the gate does not count |
| `SCAN_ROOTS` | the source directories of the project | Only files under these roots are counted |

## The Line Ceiling (enforced, scan roots only)

**Split before `SPLIT_TARGET` lines. Do not wait for the gate to fail at `LOC_CEILING`.**

The style gate's oversize rule is a PURE line-count check: any source file under `SCAN_ROOTS` with more than `LOC_CEILING` lines counts as one oversize violation for its domain. Nothing else about the file's content matters to this check: no parsing, no cohesion awareness, no "is this actually one thing". It is a lagging-indicator proxy, not a design review.

- **Mode:** block. The rule fails the gate; it is not a warning.
- **Ratchet:** DOWN-only. The baseline file seeds the current per-domain oversize count, so pre-existing large files stay green. The gate fails only when a domain's measured count exceeds its recorded ceiling, that is, a genuinely new oversize file.
- **No comment escape hatch for size.** A file avoids counting only by being under `LOC_CEILING` or by being one of the files already absorbed into the baseline.
- **Where it runs:** the pre-PR gate, as a deterministic run-once check.
- **Test files are excluded from this count** but not from the discipline: target `TEST_TARGET` lines, split by concern. Existing larger test files may only shrink.

## Actual Scope: the Scan Roots, Not the Whole Repository

The gate counts only `SCAN_ROOTS`. A large file outside those roots is not caught by this mechanism at all. Do not assume or claim that the ceiling applies everywhere; a project extends `SCAN_ROOTS` deliberately.

### Grandfathered oversize files

The per-domain grandfathered counts live in the style baseline file. Read them there, never from a copy. The ratchet forces no retroactive cleanup, but a change that pushes any file over `LOC_CEILING` is a new violation: split before committing.

## Cohesion Over Line-Count

**A tangled 400-line file is a worse god-module than a cohesive 900-line one.** The line ceiling is a blunt, mechanical backstop, not the quality bar. The real bar is: does this file hold exactly one responsibility, one reason to change?

A file that mixes unrelated concerns (for example HTTP routing, business rules, a lookup table and animation timing) is a maintenance and review hazard regardless of its line count. Watch for:

- Multiple unrelated responsibilities living in one file "because it's still under the ceiling".
- A file that keeps growing because it is the natural-feeling place to add "one more small thing" that belongs to a different concern.
- Splitting purely to dodge the line gate (an arbitrary top-half and bottom-half cut) instead of splitting along a real seam. That satisfies the machine check while making the code harder to navigate, which is the opposite of the goal.

**A line count cannot detect any of this.** Cohesion is a review judgment.

The reusable pattern for any split: identify the seams by responsibility (not by line count), extract each seam into its own file, hook or module, thread shared state via typed parameters and returns (never reach into shared global state to bridge the split), and use a byte-diff or an existing characterization test suite as the proof that the split changed nothing behaviorally.

## References

- Gate implementation: the style gate's oversize rule.
- Gate configuration: the style gate's configuration file (`LOC_CEILING`, `SCAN_ROOTS`, the rule list).
- Gate baseline: the style baseline file (per-domain grandfathered counts).
