# Code Style: Clean Code, DRY, Functional Style

Applies to every source file the project writes. The style gate (`scripts/style-gate.mjs`) enforces what a machine can count; the review checklist in section 8 covers the rest.

## 1. Errors are values

- A function that can fail returns a result type (a value that is either a success or an error), never throws.
- No exception crosses a module boundary. An edge file (a framework callback, a process entry point) may catch and convert; it is tagged `style-gate:edge <reason>` in a comment. A tag without a reason does not exempt.
- Branch on the error by a discriminator field, not by the class of a thrown object.
- Check the error side of a result before reading the value. An error branch never falls through to a success side effect.

## 2. Immutability

- An input or a shared value is never changed in place: build a new value (copy, then change the copy).
- Declare every binding constant unless it is a loop counter in a hot path.
- No array or object mutation of a parameter (`push`, `sort`, `splice`, member assignment, `delete`). A line that is a false positive of the gate (a map-like `set`, a query builder `delete`) carries `style-gate:ignore <reason>`.

## 3. Routing and dispatch

- Dispatch on a value by a match expression or a lookup table, not by an if/else or switch chain.
- A dispatch handles every case or has an explicit default that returns an error value.
- A router with four or more branches is a table.

## 4. Pure logic, effects at the edges

- Domain and application logic are pure functions: same input, same output, no I/O, no clock, no global state.
- Side effects (files, network, database, process) live at the edge and are passed in or called from the edge.
- No asynchronous result is dropped: every one is awaited, chained or returned, so a failure is never invisible to the caller.

## 5. Small single-purpose modules

- One module, one responsibility, under the line ceiling of `.claude/rules/module-structure.md`. Split before the ceiling, not at it.
- A function does one thing and is short enough to read without scrolling.
- Names say what a thing is or does; a comment is for a constraint the name cannot carry.

## 6. DRY

- No duplicated logic. A second copy is extracted into a named function before a third copy appears.
- The gate reports duplicated blocks: a block of `dup_min_lines` consecutive lines that appears twice counts as a violation for the directory of the later copy.
- Duplication of a pattern with different data is a table or a parameter, not a copy.

## 7. Idioms for this stack

The result type, the match tool and the immutable update idioms of this project's language are listed in `.planning/STACK-PROFILE.md`, section Style. The interview fills it from the chosen rule set. This rule holds whichever idioms are named there.

## 8. Review checklist

Ask these in every review round. Each "no" is a finding with `file:line`.

1. Does every function that can fail return a result value, with no exception crossing a module boundary?
2. Is every input and shared value left unchanged, with a new value built instead?
3. Is every dispatch a match expression or a table rather than an if/else chain?
4. Is the logic pure, with side effects only at the edge and no dropped asynchronous result?
5. Is each module small, single-purpose and under the line ceiling?
6. Is the new code free of copied logic that should be a shared function?
7. Is every name self-explanatory without its comment?
8. Does each new function do one thing?

## 9. Enforcement

- `scripts/style-gate.mjs` runs as the gate `style` in `stack.gates[]` of `.planning/config.json`; the rule set and scan roots come from `stack.style`. It checks new throws, input mutations, oversize files and duplicated blocks (and the rules of the chosen rule set).
- Ratchet: the counts per directory and rule are compared with `.planning/style-baseline.json`. A count may only fall. No baseline file means every count is zero.
- A count above the baseline fails the gate and prints each site as `file:line [rule] message`. A count below prints `STALE`; `--write-baseline` lowers the baseline and never raises it.
- A brownfield project seeds its baseline once with `--seed-baseline` (an owner action; it refuses when a baseline exists), then lowers it over time.
- Tag an edge file with `style-gate:edge <reason>`; escape one line with `style-gate:ignore <reason>`. The escape never applies to the oversize and duplicate rules.
