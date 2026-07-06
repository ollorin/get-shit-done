---
phase: 55-failures-to-regression
verified: 2026-07-06T06:05:00Z
status: passed
score: 14/14 must-haves verified
verifier: gsd-verifier
---

# Phase 55: Failures-to-Regression Pipeline Verification Report

**Phase Goal:** Every failure becomes a permanent regression eval (MILE-32)
**Verified:** 2026-07-06T06:05:00Z
**Status:** passed
**Re-verification:** No — initial verification (no prior 55-VERIFICATION.md existed)

## Goal Achievement

### Observable Truths

All 14 must-have truths across Plans 55-01/55-02/55-03 were verified against the actual codebase — every CLI behavior below was independently reproduced live in a temp project via the real `gsd-tools.js` CLI, not taken from SUMMARY claims.

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | `eval-candidate from-debug` on a debug file with confirmed root_cause writes exactly one candidate JSON to queue/ | ✓ VERIFIED | Live run: `written:true`, 1 file `debug-leak-*.json` with all 7 schema keys, `expected:{type:file_exists, file:src/pool.js}` from files_changed, `status:pending` |
| 2  | `from-debug` on a session with no confirmed root_cause (`[empty until found]` placeholder / INCONCLUSIVE) writes NOTHING | ✓ VERIFIED | Live run: `written:false, reason:"no confirmed root_cause found in debug file"`, exit 0, queue unchanged. Guard at gsd-tools.js:4850 |
| 3  | `from-verification` on `status: gaps_found` with N gaps writes N files; `passed`/`human_needed` writes zero | ✓ VERIFIED | Live run: 2-gap VERIFICATION.md → `written:2` with distinct `-0`/`-1` ids; `status: passed` → `written:0`. Guard `data.status !== 'gaps_found'` at gsd-tools.js:4904 covers human_needed |
| 4  | debugger-detail.md instructs `eval-candidate from-debug` at the Phase 4 CONFIRMED point (shared by both goal modes), never ELIMINATED/INCONCLUSIVE | ✓ VERIFIED | debugger-detail.md:805 — bullet sits under **CONFIRMED:**, BEFORE the find_root_cause_only/find_and_fix branch, with explicit do-NOT-invoke prose for ELIMINATED/INCONCLUSIVE. Digest bullet in gsd-debugger.md:161. Grep-assertion tests at gsd-tools.test.js:9962-9985 enforce placement |
| 5  | gsd-verifier.md instructs `eval-candidate from-verification` gated on `gaps_found`, after VERIFICATION.md template, before "Return to Orchestrator" | ✓ VERIFIED | gsd-verifier.md:224-230 — "Write Regression Candidates (MILE-32)" section, explicit do-NOT for passed/human_needed. Boundary test at gsd-tools.test.js:10010 |
| 6  | Accept moves queue→accepted, sets `status:accepted`, re-validates schema even on hand-edited files; invalid candidate is NOT moved | ✓ VERIFIED | Live run: accept moved file, `status:accepted` + `accepted_at` stamped, gone from queue. Hand-edited `file_contains`-without-needle candidate: exit 2, `invalid_candidate_schema` + needle error, file untouched in queue. `validateEvalCandidateSchema()` called at gsd-tools.js:5061 before the move |
| 7  | Reject moves queue→archived (never deleted), stamps `rejected_at` + reason; existing reason is appended, not overwritten | ✓ VERIFIED | Live run: pre-seeded `reason:"first reason"` + reject `--reason "not reproducible"` → archived file has `"first reason; not reproducible"`, `status:rejected`, `rejected_at` set, gone from queue. Append logic at gsd-tools.js:5098 |
| 8  | `eval-candidate list` accurately reflects queue/accepted/archived after transitions | ✓ VERIFIED | Live run after 1 accept + 1 reject: `list queue` count 1, `list accepted` count 1, `list archived` count 1 — all correct |
| 9  | Malformed JSON handed to accept or reject errors loudly with typed non-zero exit, never silently processed | ✓ VERIFIED | Live run: invalid-JSON queue file → accept exit 2 `malformed_candidate`, reject exit 2 `malformed_candidate`, file left in queue both times |
| 10 | Accepted candidates are loaded+executed by eval-harness loader/executor and `eval regress`, which exits non-zero on any failing assertion | ✓ VERIFIED | Live run: satisfied `file_exists` candidate → exit 0 `pass:true total:1`; after deleting the target file → exit 1 `pass:false`, reason "src/pool.js does not exist" — CI would catch the regression |
| 11 | Malformed/schema-invalid file in accepted/ is an explicit failure entry, never silently skipped, never crashes the run | ✓ VERIFIED | Live run: `broken.json` in accepted/ → exit 1, `malformed:["broken.json"]` with "Malformed JSON:" error, run completed normally. Deviation documented in eval-harness.js header comment (lines 18-24) |
| 12 | Empty accepted/ (only .gitkeep) is an explicit trivial pass | ✓ VERIFIED | Live run against the REAL repo accepted/ dir: `{pass:true, total:0, malformed:[], executed:[]}`, exit 0. Contract tested at eval-harness.test.js:844 |
| 13 | `eval regress` runs in CI on every push/PR (npm test chain AND dedicated eval-harness.yml job) | ✓ VERIFIED | package.json:64 `scripts.test` ends with `&& node get-shit-done/bin/gsd-tools.js eval regress tests/eval-regressions/accepted --project-root .`; eval-harness.yml has an `eval-regress` job (line 29-36) and `tests/eval-regressions/**` in BOTH push.paths and pull_request.paths |
| 14 | Integration tests exercise all 4 MILE-32 scenarios end-to-end via the real CLI | ✓ VERIFIED | gsd-tools.test.js:10284-10524 `describe('MILE-32 end-to-end...')` — scenario (a) generation + inconclusive-inverse, (b) accept/reject transitions, (c) CI pickup with pass→fail flip on target deletion, (d) malformed-loud, plus a full-pipeline chain test. All passing in the live suite run |

**Score:** 14/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `get-shit-done/bin/gsd-tools.js` | Builders + writer + validator + 5 eval-candidate CLI subcommands + `eval regress` branch | ✓ VERIFIED (exists, substantive, wired) | buildEvalCandidateFromDebugFile:4839, buildEvalCandidatesFromVerificationFile:4895, writeEvalCandidates:4946, validateEvalCandidateSchema:4976, cmdEvalCandidateList/Accept/Reject:5018/5043/5078, from-debug/from-verification wrappers:5110/5128, `case 'eval-candidate':`:12872 (all 5 subcommands), `eval regress`:4723 (direct-exit, mirrors `eval assert`). All 4 pure functions exported (verified via `require()`) |
| `get-shit-done/bin/eval-harness.js` | loadAcceptedEvalCandidates, executeEvalCandidate, runEvalRegressions, validateEvalCandidateShape — additive exports, documented deviation | ✓ VERIFIED | Lines 500-655; all 4 in module.exports alongside the 10 pre-existing exports; header comment documents the second fail-safe deviation (MILE-32, Phase 55-03); zero dependency on gsd-tools.js (no circular require) |
| `get-shit-done/references/debugger-detail.md` | CONFIRMED-step invocation of `eval-candidate from-debug` | ✓ VERIFIED | Line 805, correctly scoped (see truth 4) |
| `agents/gsd-debugger.md` | hard_rules_digest surfacing bullet | ✓ VERIFIED | Line 161 |
| `agents/gsd-verifier.md` | "Write Regression Candidates" step gated on gaps_found | ✓ VERIFIED | Lines 224-230 (see truth 5) |
| `tests/eval-regressions/{queue,accepted,archived}/` | Git-tracked dirs with .gitkeep | ✓ VERIFIED | All three .gitkeep files tracked per `git ls-files`; real dirs empty besides .gitkeep |
| `package.json` | npm test chains `eval regress` | ✓ VERIFIED | scripts.test line 64 |
| `.github/workflows/eval-harness.yml` | eval-regress job + paths | ✓ VERIFIED | Job at lines 29-36; `tests/eval-regressions/**` in both trigger path lists; existing eval-assert job untouched |
| `get-shit-done/bin/gsd-tools.test.js` | 55-01/55-02/end-to-end test blocks | ✓ VERIFIED | describe blocks at 9641 (generation, 13 tests), 9947 (agent wiring, 6 tests), 10059 (review queue, 9 tests), 10284 (MILE-32 end-to-end, 7 tests) — all substantive with real fixtures and assertions, all 6 required categories present per block |
| `get-shit-done/bin/eval-harness.test.js` | 55-03 loader/executor tests | ✓ VERIFIED | describe at 752, 10 tests incl. malformed-is-present-not-absent proof, empty-dir trivial-pass contract, real CLI subprocess with non-zero exit, and module.exports-growth regression guard |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| CLI `eval-candidate from-debug` | buildEvalCandidateFromDebugFile + writeEvalCandidates | case dispatch → cmdEvalCandidateFromDebug | ✓ WIRED | Executed live, correct file written |
| CLI `eval-candidate from-verification` | buildEvalCandidatesFromVerificationFile + writeEvalCandidates | case dispatch | ✓ WIRED | Executed live, N files for N gaps |
| debugger-detail.md Phase 4 CONFIRMED | `eval-candidate from-debug` CLI | inline invocation instruction | ✓ WIRED | Correct point, correct exclusions; grep-assertion tests enforce |
| gsd-verifier.md output step | `eval-candidate from-verification` CLI | inline instruction gated on gaps_found | ✓ WIRED | Between template and Return to Orchestrator |
| cmdEvalCandidateAccept | validateEvalCandidateSchema | re-validation before queue→accepted move | ✓ WIRED | gsd-tools.js:5061; proven live with hand-edited invalid candidate |
| cmdEvalCandidateReject | tests/eval-regressions/archived/ | move-not-delete + rejected_at + appended reason | ✓ WIRED | Proven live |
| gsd-tools.js `eval regress` | eval-harness.js runEvalRegressions | cmdEval subcommand, direct process.exit(pass?0:1) | ✓ WIRED | gsd-tools.js:4738; proven live with exit 0/1 both ways |
| package.json npm test + eval-harness.yml | `eval regress` CLI | CI invocation on every push/PR | ✓ WIRED | npm test executed live — suite ends with the trivial-pass regress run, exit 0 |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
| ----------- | ------ | -------------- |
| MILE-32 (all 4 success criteria: debugger→candidate, verifier-gap→candidate, accept→permanent CI eval / reject→archive, 4 integration scenarios + loud malformed handling) | ✓ SATISFIED | None |

REQUIREMENTS.md accuracy check: MILE-32 is marked `[x]` (line 144) and mapped "Phase 55 | Complete" (line 238). The 55-02-era deferred item flagged this as premature; 55-03 has since landed the CI-execution half (loader/executor, `eval regress`, npm test chain, eval-harness.yml job) and all 4 integration scenarios pass — the checkbox is now genuinely accurate. deferred-items.md carries the RESOLVED note.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None found | — | No TODO/FIXME/placeholder/stub patterns in the new code; no silent-skip paths (malformed input is loud everywhere by design); no hollow tests (all 45 new tests contain real fixtures and assertions and were exercised in the live 595/595 run) |

### Test Suite (Step 8b)

- Full `npm test`: **595/595 passing, exit 0** (baseline before phase: 550; +45 additive tests across the 5 new describe blocks). The suite itself now ends with `eval regress tests/eval-regressions/accepted --project-root .` → trivial pass `{pass:true, total:0}`.
- `budget check --raw`: overall `pass:true`, all 5 agents individually pass (wiring additions did not breach prompt budgets).
- Charlotte QA / E2E plan: N/A — this repo has no UI and is not a web project (CLI/prompt toolkit); `charlotte_qa_ran=false` is correct.
- Test-file coverage: both modified implementation files have counterpart test files (gsd-tools.test.js, eval-harness.test.js).
- Migrations: none in this phase — timestamp check N/A.
- Docs coverage: CHANGELOG.md lines 15-17 carry accurate, detailed entries for all three plans.
- Deferral language: none — the single deferred item (premature MILE-32 checkbox) was resolved by 55-03, not deferred onward.

### Human Verification Required

None. All phase behavior is programmatically verifiable and was verified live: candidate generation, review-queue lifecycle, CI regression pickup, and loud malformed handling were each reproduced through the real CLI in an isolated temp project.

### Gaps Summary

No gaps. All 14 must-have truths across the three plans verified against the actual codebase; every claimed behavior was independently reproduced via live CLI execution rather than trusted from SUMMARY.md. The MILE-32 loop is provably closed end-to-end: a confirmed debugger root cause or a verifier gap generates a pending candidate in the git-tracked queue; a human accept promotes it (schema-re-validated) to accepted/ where `eval regress` — run on every push/PR via both npm test and a dedicated CI job — continuously re-checks it and fails CI when the guarded condition regresses; a reject archives it with an auditable, append-only reason trail; and an inconclusive debug session or a passed/human_needed verification writes nothing.

Non-blocking observation (orchestrator bookkeeping, not a goal gap): ROADMAP.md's Phase 55 section still reads "**Plans:** 2/3 plans executed" with a stale "- [ ] 55-01: TBD" plan checklist — all 3 plans are in fact executed with SUMMARYs and commits. Recommend the orchestrator refresh this during phase completion.

---

_Verified: 2026-07-06T06:05:00Z_
_Verifier: Claude (gsd-verifier)_
