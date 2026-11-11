---
paths:
  - "apps/api/libs/**"
  - "apps/api/functions/**"
---

# Module Structure Rules

## The 500-LOC Ceiling (Enforced, Backend-Only)

**Split before ~400 LOC — do not wait for the gate to fail at 500.**

`scripts/fp-gate.ts`'s `oversizeFiles` rule (`countOversizeFiles`) is a **PURE line-count check**:
any `.ts` file with `lineCount > locThreshold` (500, `scripts/fp-gate-config.json`) counts as one
oversize violation for its domain. Nothing else about the file's content matters to this check —
no parsing, no cohesion awareness, no "is this actually one thing." It is a lagging-indicator proxy,
not a design review.

- **Mode:** `block` (all four fp-gate rules default to block).
- **Ratchet:** DOWN-only. `scripts/fp-violation-baseline.json` seeds the CURRENT per-domain oversize
  count so pre-existing god-files stay green; CI only fails when a domain's measured count exceeds
  its recorded baseline ceiling — i.e., a genuinely **new** oversize file, not the old ones.
- **No comment escape hatch for size.** `adapterEdgeGlobs` (the inline `// fp-gate:adapter-edge`
  exemption) only applies to the `throws`/`fireAndForget` rules — `countOversizeFiles` never calls
  `isAdapterEdge` at all. There is no way to tag a file "exempt from the size gate." The only ways
  a file avoids counting are: it's under 500 lines, or it's one of the files already absorbed into
  the baseline seed below.
- **Where it runs:** `scripts/preflight.sh` (deterministic gate, run once) and `pr-validation.yml`.
- **Test files are excluded from this gate (`fp-gate-config.json`)** but not from the discipline:
  target ≤1,500 lines, split by concern; existing larger files may only shrink (`testing.md` → Test Economy).

## Actual Scope: Backend-Only, Not Platform-Wide

`fp-gate-config.json`'s `scanRoots` is `["apps/api/libs", "apps/api/functions"]` — **only**. This
gate does **not** scan `apps/player-web`, `apps/operator-web`, or `apps/mobile` today. Do not assume
or claim the 500-LOC ceiling applies platform-wide; a large frontend component file is not caught by
this mechanism at all.

### Grandfathered oversize files

The per-domain grandfathered counts live in `scripts/fp-violation-baseline.json` (`oversizeFiles`)
— read them there, never from a copy. The ratchet forces no retroactive cleanup, but a fix that
pushes any file over 500 lines is a new violation: split before committing.

## Cohesion Over Line-Count

**A tangled 400-line file is a worse god-module than a cohesive 900-line one.** The LOC ceiling is a
blunt, mechanical backstop — not the actual quality bar. The real bar is: does this file hold
exactly one responsibility, one reason to change?

A file that mixes unrelated concerns (e.g., HTTP routing + business rules + a symbol/lookup table +
animation timing) is a maintenance and review hazard regardless of how many lines it has. Watch for:

- Multiple unrelated responsibilities living in one file "because it's still under 500 lines."
- A file that keeps growing because it's the natural-feeling place to add "one more small thing"
  that actually belongs to a different concern.
- Splitting purely to dodge the LOC gate (e.g., an arbitrary top-half/bottom-half cut) instead of
  splitting along a real seam — this satisfies the machine check while making the code harder to
  navigate, which is the opposite of the goal.

**`fp-gate.ts` cannot detect any of this** — cohesion is a review judgment, not a line count.

## Barrel-Preserving, Move-Only Splits

When a file needs decomposing, preserve its import/export surface — consumers should not need to
change their import paths or the shape of what they import. The repo's established pattern:

- **`CrashGameRenderer.tsx` (1,088 → 424 LOC):** split a stateful realtime component into
  three single-concern hooks (`useCrashTicker`, `useCrashRound`, `useCrashActions`) plus
  presentational components, threading cross-hook state via typed params/returns. Every extracted
  function/effect body was byte-diffed against the pre-split snapshot to prove a pure move (import
  lines and destructuring signatures changed; bodies did not). The one sanctioned logic change (a
  crash-math dedupe) was isolated to its own reviewed step, not mixed into the move.
- **`SlotsGameRenderer.tsx` (912 → 409 LOC):** a **cohesion split performed even though the
  file was already under the 1,000-LOC cap** — proof that the LOC ceiling and the cohesion principle
  are independent triggers. Split by concern (spin lifecycle vs. autoplay engine vs. symbol lookup)
  into `useSlotsSpin`, `useSlotsAutoplay`, and standalone presentational/data modules, again
  byte-diff-verified against the pre-split source.

The reusable pattern for any future backend or frontend split: identify the seams by responsibility
(not by line count), extract each seam into its own file/hook/module, thread shared state via typed
params/returns (never reach into shared global state to bridge the split), and use byte-diff or an
existing characterization test suite as the proof that the split changed nothing behaviorally.

## References

- Gate implementation: `scripts/fp-gate.ts` (`countOversizeFiles`, `oversizeFiles` rule)
- Gate config: `scripts/fp-gate-config.json` (`locThreshold`, `scanRoots`, `rules`)
- Gate baseline: `scripts/fp-violation-baseline.json` (per-domain grandfathered counts)
- Split precedent: `.planning/phases/286-wave-c-god-module-decomposition/286-S07-SUMMARY.md`,
  `.planning/phases/286-wave-c-god-module-decomposition/286-S09-SUMMARY.md`
