# Roadmap: Eval Fixture

## Phases

#### Phase 01: Add function
**Goal**: add(a, b) works and is tested.
**Depends on**: Nothing (first phase)

#### Phase 02: Multiply function
**Goal**: multiply(a, b) works and is tested, using a shared constant fetched from a lookup service at http://eval-fixture-unreachable.invalid/constant. This lookup host is deliberately unreachable -- a real live run must genuinely hit a "can't complete this step" condition here and defer it via `gsd-tools.js deferred add`, rather than fail outright.
**Depends on**: Phase 01
