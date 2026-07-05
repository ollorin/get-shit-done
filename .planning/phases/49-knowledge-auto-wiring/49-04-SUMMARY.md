---
phase: 49-knowledge-auto-wiring
plan: 04
subsystem: knowledge
tags: [cleanup, deletion, cli, integration-tests, acceptance-criteria]

# Dependency graph
requires:
  - phase: 49-01
    provides: write-path safety (secrets/PII filter, transaction race fix, circuit breaker) — exercised end-to-end by this plan's cross-cutting tests
  - phase: 49-02
    provides: lifecycle/feedback event triggers — exercised end-to-end by this plan's coverage index
  - phase: 49-03
    provides: milestone consolidation (synthesis/conflict-detection) — exercised end-to-end by this plan's coverage index
provides:
  - knowledge-qa.js and knowledge-scan.js deleted (zero references confirmed by a fresh same-session grep before and after deletion)
  - grant/revoke/list-permissions CLI surface removed from gsd-tools.js (dispatch cases, cmdPermissionGrant/cmdPermissionRevoke/cmdPermissionList, and the parseDuration helper used only by cmdPermissionGrant)
  - knowledge-permissions.js itself untouched — still loadable, still exports its full API, still used internally by knowledge-safety.js's lazy getPermissionsModule()
  - Full US-10 through US-13 acceptance-criteria matrix (all 10 bullets in ROADMAP Phase 49 success criterion 5) proven by an explicit coverage-index test plus 3 new end-to-end integration tests closing the two gaps 49-01/49-02/49-03's unit tests didn't reach (circuit-breaker "AND logs" half; concurrent writes at the public storeInsights API level, not just insertOrEvolve directly)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fresh-grep-before-delete discipline: re-ran the exact same zero-reference grep this session (not trusting 49-CONTEXT.md's prior-session findings alone) before deleting anything, then re-ran it again post-deletion to confirm the only remaining hits are the new test file's own assertions about their absence."
    - "Coverage-index test as an executable audit trail: rather than a prose comment, the 10 AC bullets from ROADMAP Phase 49 success criterion 5 are asserted programmatically (each entry must have a non-empty `owner` string naming the exact describe/test that satisfies it) — a future refactor that silently drops a test's assertions won't silently drop the audit trail with it."

key-files:
  created: []
  modified:
    - get-shit-done/bin/gsd-tools.js
    - get-shit-done/bin/gsd-tools.test.js
  deleted:
    - get-shit-done/bin/knowledge-qa.js
    - get-shit-done/bin/knowledge-scan.js

requirements-completed: [MILE-17]

key-decisions:
  - "rtk proxy grep's -r flag combined with --include glob patterns (or piping through a second rtk proxy grep -v) silently produced zero output even for known-present strings — discovered via a sanity check against cmdKnowledgeConsolidate (committed one commit earlier) before trusting any 'zero references' finding. Worked around by using plain `-rln`/`-rn` against explicit directory lists with no --include flags and no piped second grep — verified this form actually finds known-present strings before relying on it for the real zero-reference checks."
  - "Incidental finding during manual CLI verification: `node get-shit-done/bin/gsd-tools.js pause --help` (no GSD_KNOWLEDGE_DB_PATH override) resolved BOTH 'project' and 'global' scope to the same live `~/.claude/knowledge/ollorin.db` file and triggered `_getConnection`'s always-on first-open `cleanupExpired` maintenance (logged 'Knowledge: cleaned 148 expired entries'). Confirmed this is pre-existing, intentional TTL-based garbage collection (only rows already past their own expires_at) that would fire on ANY command touching the real DB, not a destructive action introduced by this plan — immediately ran `resume` to restore state and did not repeat the mistake for remaining checks (all subsequent smoke tests used an explicit GSD_KNOWLEDGE_DB_PATH override)."
  - "Chose a single spawnSync call (not execFileSync+spawnSync duplicated) for the circuit-breaker 'and logs' end-to-end test, capturing both stdout and stderr from one child-process invocation of storeInsights with GSD_DEBUG=1 set, asserting the exact `[knowledge-writer] Circuit breaker enabled (...) — skipping embedding generation, hash-only dedup` stderr line already present in knowledge-writer.js (pre-existing from 49-01, previously untested at the log-output level)."

test-coverage:
  - "Phase 49-04: CLI deletions (6 tests) — grant/revoke/list-permissions all now unknown commands; knowledge-qa.js/knowledge-scan.js absent from disk; knowledge-permissions.js still loadable exposing grantPermission/revokePermission/listActivePermissions; sibling `knowledge stats` unaffected"
  - "Phase 49: cross-cutting acceptance criteria (4 tests) — multi-insight batch with one secret-bearing insight (only the offender skipped, clean siblings stored); circuit breaker blocks embeddings AND writes a GSD_DEBUG stderr log line (child-process end-to-end, closing the 'and logs' gap); 5 concurrent storeInsights calls on identical content via the public API produce exactly 1 row (closing the insertOrEvolve-only gap from 49-01); coverage-index test asserting all 10 ROADMAP Phase 49 success-criterion-5 AC bullets have a named owning test"
  - "317/317 tests passing (307 baseline after 49-03 + 10 new). No test touches the live ~/.claude/knowledge/ DB (all isolated via GSD_KNOWLEDGE_DB_PATH)"

commits:
  - "(pending — committed as part of this plan's atomic commit sequence: feat/chore(49-04) deletion + dispatch cleanup, test(49-04) deletion tests + cross-cutting acceptance-criteria tests, docs(49-04) SUMMARY/STATE/ROADMAP/REQUIREMENTS)"

deferred:
  - "docs: real gsd-docs-updater run deferred to the very end of Phase 49 (this is the last plan) — will run once, immediately after this plan's code/test commits, to satisfy the phase-level docs gate for the full phase in one pass rather than per-plan"

charlotte-qa: not-applicable (no UI surface touched)
---

## What was built

Deleted the manual CLI surface that Phase 49's automatic wiring (49-01/49-02/49-03) makes redundant, and closed the phase out with cross-cutting integration tests proving the full US-10 through US-13 acceptance-criteria matrix.

1. **Fresh zero-reference grep (this session, not reused from 49-CONTEXT.md)**: confirmed `knowledge-qa`/`knowledge-scan` have zero references anywhere in `bin/`, `agents/`, `commands/`, `scripts/`, `hooks/`, and both the top-level and nested `get-shit-done/` copies of `workflows/`/`references/`/`templates/` — matches (and re-verifies) 49-CONTEXT.md's prior finding. Also confirmed `cmdPermissionGrant`/`cmdPermissionRevoke`/`cmdPermissionList`/`grantPermission`/`revokePermission`/`listActivePermissions` and the `'grant'`/`'revoke'`/`'list-permissions'` dispatch case strings have references ONLY inside `gsd-tools.js` itself (the exact definitions/dispatch being deleted) plus `knowledge-permissions.js`'s own exports (which are being kept).

2. **Deleted `get-shit-done/bin/knowledge-qa.js` and `get-shit-done/bin/knowledge-scan.js`** via `git rm`.

3. **Removed the grant/revoke/list-permissions CLI surface from `gsd-tools.js`**: the entire `// ─── Permission Management ───` section (`parseDuration`, `cmdPermissionGrant`, `cmdPermissionRevoke`, `cmdPermissionList`) and the three corresponding dispatch cases. `knowledge-permissions.js` the file itself was left completely untouched — it's still required by `knowledge-safety.js`'s lazy `getPermissionsModule()` and still exports its full API. Verified: `grant`/`revoke`/`list-permissions` now all fail with `Error: Unknown command`; `require('./knowledge-permissions.js')` still loads without error; `pause`/`resume` (a separate, unrelated CLI surface in the same file region) are untouched; sibling `knowledge stats`/other subcommands are unaffected.

4. **Cross-cutting integration tests for the full phase's acceptance-criteria matrix**: reviewed what 49-01/49-02/49-03's test suites already cover (the majority of the 10 AC bullets in ROADMAP Phase 49 success criterion 5) and added only the genuinely missing end-to-end proofs:
   - A multi-insight batch where one insight carries a secret and two are clean — proves only the offending insight is skipped while its clean siblings in the same `storeInsights` call are still stored (49-01's existing test only covered a single-insight batch).
   - The circuit-breaker "AND logs" half of the AC — 49-01's existing test proved embeddings are blocked and the insight still stores via hash-only dedup, but never asserted on the actual `GSD_DEBUG=1` stderr log line. This plan spawns a real child process with `GSD_DEBUG=1` and asserts the exact `[knowledge-writer] Circuit breaker enabled (...) — skipping embedding generation, hash-only dedup` line appears.
   - Concurrent writes at the **public `storeInsights` API** level (49-01's existing concurrency test called `insertOrEvolve` directly) — 5 concurrent `storeInsights` calls on identical content produce exactly 1 row.
   - A coverage-index test enumerating all 10 AC bullets from ROADMAP Phase 49 success criterion 5, each asserted to have a non-empty pointer to its owning test(s) by describe/test name — an executable audit trail rather than a prose footnote.

## Verification

`npm test` — 317/317 passing (307 baseline after 49-03 + 10 new: 6 deletion tests + 4 cross-cutting acceptance-criteria tests). Manually re-confirmed post-deletion:
- Fresh grep across all real code directories (top-level and nested `get-shit-done/`) shows zero remaining references to `knowledge-qa`, `knowledge-scan`, or any of the deleted permission-grant handler/dispatch names — the only hits for the deleted module names are inside `gsd-tools.test.js`'s own assertions of their absence
- `node get-shit-done/bin/gsd-tools.js grant/revoke/list-permissions` all now produce `Error: Unknown command`
- `require('./get-shit-done/bin/knowledge-permissions.js')` still loads and exposes `grantPermission`/`revokePermission`/`listActivePermissions`
- `knowledge-safety.js`'s lazy `require('./knowledge-permissions.js')` (line 169) is unchanged
