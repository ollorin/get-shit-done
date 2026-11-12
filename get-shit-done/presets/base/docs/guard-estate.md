# Guard estate

The machine-enforced guards of this project, one row each. `scripts/validation/guard-registry.mjs` is the source of truth
for the rows; `scripts/validation/guard-registry-reconcile.mjs` fails when this table and the registry differ in any
cell, when an `implementedIn` path does not exist, or when this document names a guard as `guard:<id>` that the registry
does not list. Each cell below equals the registry string exactly (no backticks, no `|`).

To add a guard, follow the new-guard checklist in `.claude/rules/guard-authoring.md` (section 4): a registry row, a row
here, a corpus under `scripts/validation/canaries/`, and the gate wiring. That checklist is not repeated in this file.

The sample guard, `sample-guard` (not a `guard:<id>` reference, so deleting it leaves none dangling), is a model for the shape and is safe to delete together with its row, its corpus
and its guard file.

## Machine-enforced guards

| ID | Guard | Prevents | Implemented in |
| --- | --- | --- | --- |
| sample-guard | No tab character in a checked file | Mixed tab and space indentation reaching review | scripts/validation/guards/sample-guard.mjs |
| style-gate | Style ratchet: no new throw, input mutation, oversize file or duplicated block | Error-by-exception, in-place mutation, god files and copied logic reaching review | scripts/style-gate.mjs |
