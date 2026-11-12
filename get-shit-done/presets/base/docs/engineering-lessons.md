# Engineering lessons

Each lesson is two sentences or less, followed by its incident. A rule that the base CLAUDE.md already states is kept here as the incident behind it. Each entry ends with an incident pointer in brackets; replace `<project incident id>` with the project's own incident reference, or delete the pointer where the lesson stands alone.

## Tests and verification

- Treat every red run as a blocker, whatever its origin: a failing test, a lint error or a warning. Collect the details, find the root cause and fix it before the next step. Never carry a failure as someone else's or as pre-existing. Incident: failures were carried for several runs as "not our change". [incident: <project incident id>]
- A security branch is never gated on per-instance cache state. Decide it from the database, the source of truth. Incident: a second-factor verification trusted a per-instance cache key, so a setup-confirmation branch could be replayed on another instance; the flake that exposed it was not a test artifact. [incident: <project incident id>]
- Build a new test harness additively: keep the old tests in the same change. Retire an old test only when the new one proves equal or better coverage and a measured speed-up, with a per-scenario equivalence ledger. Incident: a replacement of the UI suite was proposed on a projection alone and rejected. [incident: <project incident id>]
- Keep the test layers separate: unit and API integration tests run in continuous integration; UI end-to-end tests run locally only. Browser and timing flakiness makes them unfit for shared runners. Incident: UI end-to-end runs were flaky and slow in continuous integration. [incident: <project incident id>]
- Parallel wall time equals the slowest bucket, so balance the buckets rather than adding more. Incident: a test-speed review that six stale session notes repeated. [rescued: stale session notes]
- Do not pass dependency trees between continuous-integration jobs as artifacts; install them in each job. Incident: the same stale session notes. [rescued: stale session notes]

## Requirements and planning

- Hardening a requirements document has two halves: verify every claim against the current code and correct stale scope, then expand the owner's core ideas. Keep the owner's intent as the spine. Incident: a verification-only pass was proposed and rejected because it left the ideas unelevated. [incident: <project incident id>]
- Run a code-review hardening milestone before feature work, and plan it as written, without a further hardening pass. Incident: the owner overruled a feature-first ordering because the next features need a solid base. [incident: <project incident id>]
