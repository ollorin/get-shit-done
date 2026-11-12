---
paths:
  - '**/*.test.*'
  - '**/*.spec.*'
  - '**/test/**'
  - '**/tests/**'
  - '**/__tests__/**'
---

# Testing Rules

Commands are named by their stack profile key (`stack` block of `.planning/config.json`). The pre-PR gate is `{{stack.commands.pre_pr_gate}}`; the search command is `{{stack.commands.search}}`; the default branch is `{{stack.branch.default}}`. Any other command is named in prose by its profile key ("the full-suite command of the stack profile").

## Why Local Can Pass When CI Fails (and how to prevent it)

A test's real behaviour must never secretly depend on developer-local ambient state that CI does not have: a long-lived local database volume, an untracked dotfile, a shell variable exported once. Such tests pass every local check and fail in CI.

### Rule: tests must not depend on untracked or ambient local env vars

Never build a service client straight from an environment variable inside a test. Either declare and reproduce every variable the CI job needs in that job's env block, or (preferred) inject the client through a factory or override seam so the test never depends on ambient env. Before adding a test that reads a secret from the environment, check the CI job's env block; do not assume parity with local files.

### Rule: local gate must reproduce CI's clean-room guarantees, not just "tests green"

CI replays every committed migration or setup step from an empty state; a long-lived local stack silently accumulates state that no committed step produced. The pre-PR gate `{{stack.commands.pre_pr_gate}}` runs the clean-room checks. If one fails, rebuild the local state from empty before trusting any other local result.

### Rule: test-env variable names are declared once, in one manifest

Every test-env variable NAME (never a value) is declared in the project's test-env manifest before a test reads it. The checker fails the next gate run with a named diff. Fix the manifest, never the checker.

### Rule: the gate runs integration tests in a scrubbed environment

The gate replays the suite in a scrubbed environment: a fresh test config every run, executed under `env -i` that forwards ONLY the variables the manifest allowlists, for the test client and for every server process the suite starts. A server-side-only variable removed from the manifest fails the replay too. Auto-loaded dotenv files are a known leak path for ambient state; the scrubbed run is the proof that nothing leaked.

## Test Failure Policy

**NEVER** add a skip, ignore or exclusion flag, or a quarantine entry, to make a failing test disappear. Read the error, find the root cause, fix it, re-run. The only legitimate skip is a test that genuinely needs infrastructure absent from the unit run: mark it `// ignore: requires <infrastructure> — runs in <job>` and let it enable itself when the infrastructure is present. If you catch yourself adding an ignore flag, stop: that is always the wrong move.

## Test Falsifiability — every test must be able to fail

- **Positive control:** every denial, absence or fault assertion pairs with a control that differs in exactly one condition and passes. Absence is asserted only after the action has settled.
- **The fixture reaches the branch it names:** distinct owner and victim principals, the input that triggers the path, a credential of the right class. Assert that the branch was entered. A fixture that falls back to another subject, a seeded row or ambient state is a defect.
- **Expected values come from the contract,** never from importing the builder under test, and never from a value the test wrote without reading it back from the system.
- **Mutation proof:** a claimed red counts only if the script asserts the file changed where intended (a `sed` can silently no-op after a formatter reflow), the mutant compiles, the log postdates the code, and the failure is the defect's own assertion in the pre-fix tree. A compile error, an import error or a timeout is not a red. Revert the hunk, not the whole file. Mutation runs happen in a throwaway git worktree under `.tmp/wt-<name>`, never in the shared working tree.
- **Mutants run through the mutation tool** `scripts/mutate/mutate.mjs`: one mutants JSON (each entry with `expect_failing_test`), `--dry-run` first, then `--mutants <json> --root .tmp/wt-<name> --out <path>`, never with `--allow-dirty`. A kill counts only as `killed` with `kill_confirmed: true`, in a run whose `<out>.run.json` shows exit code 0 and both baselines green. `killed-typecheck`, `errored` and `timeout` are not kills. Commit the JSONL and the run.json as the evidence. Mutants against a live stack stay manual.
- **Evidence is committed:** every log, mutant and results file that a SUMMARY cites is copied into the plan's evidence directory in the commit that first cites it: an excerpt of the mutant, the runner's count line, the failing assertion lines and the restore check. `.tmp/` is gitignored scratch and is purged.
- **Doubles behave like the real dependency:** fakes apply the filters, limits, ordering and shape selection that production branches rely on, return the real wire types (integers and raw strings where the wire uses them, numbers as strings where the wire does), and model rejection and no-match. Changes to an encoding or a wire shape need a real-backend case. Mocks mirror the real reply shape.
- **A run counts only with its count:** the log shows N greater than zero tests and the runner's own success line. Exit 0 from a filter that matches nothing, from a setup step that printed an error, or from a status-only health probe is not evidence. Every test file is collected by a runner the gate executes. Missing credentials fail loudly; a test never self-skips for them.
- **Contract changes sweep their tests:** changing a gate, a signature, an error code or a key name updates every caller, fixture, fake and assertion of it in the same commit, and runs those suites.
- **A new integration test is run live once, red then green,** before its phase claims it. After editing a served function, confirm the server reloaded before trusting a verdict.
- **Harness helpers never discard evidence:** no error result swallowed by a default-value fallback, no ignored insert, delete or cleanup result, retries bounded and only on a named transient signature, failing-attempt logs kept.
- **Leak-detection opt-outs** need a cited, verified reason. Close channels and stubs in teardown.

## Test Economy — reuse first, lowest layer, fewest tests

- **Reuse before add:** search the test files for the behaviour's entry point first (`{{stack.commands.search}}`). Choose REUSE, UPDATE, MERGE or ADD and record the choice in the SUMMARY's test delta. There are no test-count minimums or per-category quotas.
- **Lowest layer that can fail for the real reason:** storage, permission, signature, idempotency, concurrency and rounding behaviour are tested against the real backend; pure logic is unit-tested; a browser is used only for what needs one. No unit tests on a file of only re-exports, or on handlers whose logic lives elsewhere. Never assert one contract at two layers unless the second covers the wire shape (for example the HTTP status mapping).
- **Risk tiers:** T0 is the risk domains of `.planning/PRODUCT-BRIEF.md` plus authentication and security. T0 runs against the real backend, has one test per threat, is mutation-proven (one mutant per guarded condition), uses real concurrency (parallel calls behind a barrier) for race claims, and has a positive control. T1 is the default. T2 is low-risk: parametrise literal-only variants.
- **Hollow tests fail review:** no assertion; only existence, `assert(true)` or status-only checks; a refusal check that matches any error (assert the code AND the message); a concurrency test that runs sequentially; a "table or view exists" test; a schedule test that never reads the schedule; a literal compared with itself.
- **Merging and deleting are first-class:** a DELETE or MERGE row needs a cited covering test path and line, or a mutant id. Tests of sensitive paths (the risk domains above) need a MERGE backed by a verified mutant.
- **Size and time:** test files stay within the size and cohesion rule of `.claude/rules/module-structure.md`. Report the suite time before and after a change that moves it.

## New coverage lives in an existing wired suite, not a new runner

A check (a canary corpus, a mutation proof, a helper case) is a test case inside a test file that an existing gate task runs: the repo-tooling test suite that the pre-PR gate executes. Never a standalone script nobody runs, never a new CI job. Cover helper logic by adding test cases. Details: `.claude/rules/guard-authoring.md`.

## Integration Test Isolation

Tests that create shared mutable state (fixtures, configs, events) clean up their non-seeded records before any test body runs. Accumulated data causes cascading timeouts in processing loops.

A test that mutates a shared config or seed row snapshots the real row, restores exactly that snapshot in `finally`, then reads it back. Never restore to a hard-coded default. Assert only on rows the test created, never on global counts it does not own. A leak that dirties a shared row is a test defect, fixed in the phase that finds it.

**A per-site restore handle is not a cross-process guarantee.** When several test processes share one stack, two scopes can each read the pristine row, and the first to exit silently reverts the second's change. Every write to a shared configuration key therefore goes through one lock helper, which holds a cross-process lock across the whole body and restores every key it saw written. A write outside such a scope is refused, so an unwrapped write fails at its call site; use that refusal to find the writes that need wrapping.

## Flake Prevention Gate

A test value that is correct only by luck is a flake. A literal id or number written into a shared table, or a fixed time window, collides across runs. The stack profile's `stack.flake_patterns` list flags these. A flagged line is exempt when evidence of handling is nearby (a retry on the unique-violation code, a clock anchor), or when the same or the previous line carries `flake-ignore: <justification>`. A marker without a justification still blocks. The previous-line form also covers a violation on the next line that has nothing to do with the marker's reason, so write each marker directly above the line it justifies.

The hook on Write, Edit and MultiEdit and the whole-suite `--all` scan read the same list. Example entry, names neutral:

```json
{ "id": "fixed-id-shared-table", "match": "id: [0-9]+", "requires_before": "insert\\(", "unless_nearby": "unique-violation", "window": 40, "message": "fixed id written to a shared table; handle the collision or justify it" }
```

## Parallel Test Execution

Every test file is assigned to exactly one run bucket or suite that the gate executes. The runner's own completeness self-check fails the run and names any file that is in none, or in more than one. A new test file is added to the right bucket when it is created.


## Known limits of the command hooks

The Bash hooks are a steer for honest agents, not a boundary. Their shell tokeniser is frozen, so these shapes are not judged:

- an arithmetic expansion holding a substitution: `(( $(sudo ls) ))`
- nested escaped backticks
- brace expansion that builds a command word: `{sudo,ls}`
- ANSI-C quoting that spells a character: `$'\x2df'`
- a glob in the command word: `su[d]o`
