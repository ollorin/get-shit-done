# GSD Self-Testing & CI — Deep Analysis

**Date:** 2026-07-02  
**Auditor:** Claude Code  
**Test Run:** npm test (all suites) + node --test phase-37,38 tests  
**Result:** 155 tests passing, 0 failures

---

## Inventory

| File / Directory | Purpose | Status |
|---|---|---|
| `get-shit-done/bin/gsd-tools.test.js` | Core CLI tooling tests | ✅ 120 tests (30 describe blocks, 2812 lines) |
| `tests/phase-37/prd-trace.test.js` | PRD traceability feature validation | ✅ 9 tests |
| `tests/phase-37/wave-context.test.js` | Wave context assembly validation | ✅ 8 tests |
| `tests/phase-38/kb-feedback.test.js` | KB feedback wiring validation | ✅ 11 tests |
| `tests/phase-38/service-health.test.js` | Service health monitoring validation | ✅ 7 tests |
| `.github/workflows/auto-label-issues.yml` | GitHub issue automation (NOT tests) | ⚠️ Issue triage only |
| `get-shit-done/bin/execution-log.js` | Roadmap execution tracing (JSONL log) | ⚠️ Defined but orphaned |
| `get-shit-done/bin/observability.js` | OpenTelemetry distributed tracing | ⚠️ Defined but orphaned |
| `get-shit-done/bin/session-quality-gates.js` | Session analysis cost control gates | ⚠️ Defined but orphaned |
| `get-shit-done/bin/gsd-validator.js` | LLM-as-judge validation (Haiku→Sonnet) | ⚠️ Defined but not directly tested |
| `test/llmlingua-comparison/` | Compression analysis results (not tests) | — Data artifacts |
| `package.json` test script | `node --test get-shit-done/bin/gsd-tools.test.js` | ✅ Runs main suite |

---

## Test Run Results

### Primary Test Suite (npm test)
```
Command: npm test
File: get-shit-done/bin/gsd-tools.test.js
Result:
  • 120 tests (30 describe blocks)
  • 30 test suites
  • 0 failures
  • Duration: 4835ms
Status: ✅ ALL PASS
```

### Phase-37 Tests
```
Command: node --test tests/phase-37/*.test.js
Files: prd-trace.test.js (9 tests) + wave-context.test.js (8 tests)
Result:
  • 17 tests
  • 0 failures
  • Duration: 55.6ms
Status: ✅ ALL PASS
Note: MODULE_TYPELESS_PACKAGE_JSON warning (ES modules without "type": "module" declaration)
```

### Phase-38 Tests
```
Command: node --test tests/phase-38/*.test.js
Files: kb-feedback.test.js (11 tests) + service-health.test.js (7 tests)
Result:
  • 18 tests
  • 0 failures
  • Duration: 136.4ms
Status: ✅ ALL PASS
Note: Same MODULE_TYPELESS_PACKAGE_JSON warning
```

### Summary
- **Total: 155 tests, 0 failures**
- **All test suites passing**
- **No test suite execution time exceeds 5 seconds**

---

## Coverage Map

| Component | Type | Tested? | How | Coverage % |
|---|---|---|---|---|
| **CLI Commands** | 161 case statements in gsd-tools.js | Partial | Direct execution in test harness (runGsdTools) | ~30% |
| history-digest | Command | ✅ Yes | 6 tests: empty, nested fields, multiple phases, malformed, backward compat, inline arrays | 100% |
| phases list | Command | ✅ Yes | 6 tests: empty, numeric sort, decimals, type filters, phase filter | 100% |
| roadmap get-phase | Command | ✅ Yes | 5 tests: extraction, not found, decimals, full content, missing file | 100% |
| phase next-decimal | Command | ✅ Yes | 5 tests: new decimal, incrementing, gaps, single-digit, nonexistent | 100% |
| phase-plan-index | Command | ✅ Yes | Multiple tests: empty, single, waves, checkpoints, incomplete | ~80% |
| phase {add,insert,remove,complete} | Commands | ✅ Yes | Partial; complete has pre-condition validation | ~60% |
| milestone {complete,summarize,archive} | Commands | ✅ Yes | Tested | ~70% |
| progress | Command | ✅ Yes | Tested | ~60% |
| validate consistency | Command | ✅ Yes | Tested | ~70% |
| scaffold {context,uat,verification,phase-dir} | Commands | ✅ Yes | Tested | ~70% |
| frontmatter {get,set,merge,validate} | Commands | ✅ Yes | Tested | ~70% |
| verify {plan-structure,phase-completeness,references,commits,artifacts,key-links,migration-timestamps} | Commands | ✅ Yes | Multiple tests per command; TDD/UI-QA gates (Phase 34); Phase 35+ tests | ~80% |
| execution-log | Command | ⚠️ No | Exists in gsd-tools.js (14 case statements), but NO test file | 0% |
| service-health | Command | ⚠️ Partial | Tests check: exists, returns JSON, gsd-tools integration (service-health.test.js) | ~50% |
| **Workflow Files** | Prompts/markdown | Partial | Tests via content string matching | ~40% |
| execute-phase.md | Workflow | ✅ Partial | prd-trace, wave-context tests validate structure | ~30% |
| plan-phase.md | Workflow | ✅ Partial | prd-trace tests validate PRD-TRACE.md integration | ~30% |
| transition.md | Workflow | ✅ Partial | kb-feedback tests validate KB write steps | ~30% |
| audit-milestone.md | Workflow | ✅ Partial | wave-context, kb-feedback tests validate | ~30% |
| **Agent Files** | Prompts/markdown | Partial | Tests via content string matching | ~20% |
| gsd-executor.md | Agent | ✅ Partial | Phase 35-01 test: post_plan_test_gate section | ~10% |
| gsd-phase-coordinator.md | Agent | ✅ Partial | Phase 35-02 test: web framework detection | ~10% |
| gsd-verifier.md | Agent | ✅ Partial | Multiple tests: PRD alignment (Phase 37), KB feedback (Phase 38), hard-fail rules (Phase 35-03) | ~20% |
| gsd-charlotte-qa.md | Agent | ✅ Partial | service-health.test.js validates service_startup integration | ~5% |
| **Observability Tools** | JavaScript modules | ❌ No | Modules defined but never invoked in any test | 0% |
| execution-log.js | Tracing | ❌ No | appendEvent(), getHistory(), getCurrentPhase() exported but never called in tests | 0% |
| observability.js | OpenTelemetry | ❌ No | initTracing(), getTracer(), shutdownTracing() defined but not wired into any workflow/agent/test | 0% |
| session-quality-gates.js | Cost control | ❌ No | Exported functions never tested; shouldAnalyzeSession(), hashContent() never called | 0% |
| **Validators** | JavaScript modules | ❌ No | gsd-validator.js defines validation depth selection but not directly unit-tested | 0% |
| gsd-validator.js | LLM judge | ❌ No | selectValidationDepth(), validationPrompt() exist but no test file | 0% |

---

## Issues Found

### 1. **No CI/CD Pipeline (HIGH)**
- **Evidence:** `.github/workflows/` contains only `auto-label-issues.yml`, which is issue triage automation, NOT a test runner.
- **Impact:** Tests never run automatically on commits, PRs, or schedules. Failures go undetected until manual `npm test`.
- **Consequence:** Regression risk; broken features merged to main.
- **File:** `.github/workflows/auto-label-issues.yml` (GitHub issue automation only)

### 2. **Orphaned Observability Tools (MEDIUM)**
- **Evidence:** 
  - `execution-log.js` (177 lines) exports 5 functions: `appendEvent()`, `getHistory()`, `getCurrentPhase()`, `getExecutionStats()`, `initLog()`
  - `observability.js` (109 lines) exports 5 functions: `initTracing()`, `getTracer()`, `shutdownTracing()`, `getTraceContext()`, `isTracingEnabled()`
  - `session-quality-gates.js` (260 lines) exports 4 functions: `shouldAnalyzeSession()`, `hashContent()`, `wasSessionAnalyzed()`, `recordAnalysis()`
  - **Zero references** in any workflow (`.md` files in `get-shit-done/workflows/`)
  - **Zero references** in any agent (`.md` files in `agents/`)
  - **Zero invocations** from any test file
  - **Zero CLI calls** to `execution-log` subcommand anywhere in codebase
- **Impact:** Tracing and observability infrastructure is dead code. Cannot diagnose autonomous roadmap failures in production.
- **Files:** 
  - `get-shit-done/bin/execution-log.js` (exported but never called)
  - `get-shit-done/bin/observability.js` (exported but never called)
  - `get-shit-done/bin/session-quality-gates.js` (exported but never called)

### 3. **No Prompt Regression Testing (MEDIUM)**
- **Evidence:** Agents and workflows are prompts (`.md` files). Tests validate their *structure* (string matching for sections) but NOT their *semantic correctness*.
  - `prd-trace.test.js` checks: "does plan-phase.md include 'PRD-TRACE.md'?" (not: "does PRD-TRACE.md validation work end-to-end?")
  - `kb-feedback.test.js` checks: "does transition.md call 'knowledge add'?" (not: "are KB entries actually written with correct schema?")
  - `wave-context.test.js` checks: "does execute-phase mention completed_plans_context?" (not: "is context assembled correctly for Wave 2+?")
- **Impact:** Prompt edits can pass string-matching tests but break agent reasoning. No LLM-as-judge validation of prompt quality or output correctness.
- **Consequence:** Silent regressions in agent decision-making, phase execution quality degradation undetected.
- **Files:** All tests in `tests/phase-37/` and `tests/phase-38/` (content validation only, not e2e)

### 4. **gsd-tools.js Too Large to Test Thoroughly (MEDIUM)**
- **Evidence:**
  - 400.7 KB file
  - 10,491 lines
  - 161 case statements (CLI commands/subcommands)
  - Tests cover ~30 describe blocks = ~18% of total commands
  - Monolithic design: no modular exports, all functions in one file
- **Impact:** Hard to reason about coverage. Easy to add functions that go untested. No isolated unit testing possible.
- **Consequence:** Bugs in untested command paths discovered only when manually invoked.
- **File:** `get-shit-done/bin/gsd-tools.js`

### 5. **ES Module Import Warnings Not Fixed (LOW)**
- **Evidence:** `tests/phase-37/wave-context.test.js` and `tests/phase-38/service-health.test.js` use `import` statements but `package.json` lacks `"type": "module"`.
- **Warning:** Node emits `MODULE_TYPELESS_PACKAGE_JSON` on every test run.
- **Impact:** Tests still pass (Node auto-detects modules), but explicit declaration prevents confusion.
- **File:** `package.json` (missing `"type": "module"`)

### 6. **Test Harness Requires CWD Setup (MEDIUM)**
- **Evidence:** `runGsdTools()` in gsd-tools.test.js executes via `execSync()` with a provided `cwd`. Each test manually creates a temp directory and cleans it up.
- **Impact:** Tests are slow (4.8 seconds for 120 tests), file I/O bound. Cannot parallelize easily. Cleanup can fail under race conditions.
- **File:** `get-shit-done/bin/gsd-tools.test.js` (lines 14–40, test setup pattern)

### 7. **Execution-Log Sub-Command Never Called (MEDIUM)**
- **Evidence:**
  - gsd-tools.js defines `cmdExecutionLog()` with 14 sub-commands: `event`, `append`, `history`, `current`, `last-complete`, `stats`
  - No test file for execution-log command
  - Zero calls to `gsd-tools.js execution-log` anywhere in codebase
- **Impact:** Feature is dead code. Autonomous roadmap execution traces are never logged (would be written to `.planning/EXECUTION_LOG.md`).
- **Consequence:** No audit trail for autonomous phases; no way to replay/debug phase execution.
- **File:** `get-shit-done/bin/gsd-tools.js` (lines ~3800–3900, estimated; cmdExecutionLog function never invoked)

### 8. **Validator Module Not Integrated (MEDIUM)**
- **Evidence:**
  - `gsd-validator.js` exports `selectValidationDepth()` and `validationPrompt()` for Haiku→Sonnet validation
  - No unit tests exist
  - No integration: never called from workflows or agents
  - No e2e test showing validation in action
- **Impact:** Validation framework built but not wired. Code reviews on agent outputs never happen.
- **File:** `get-shit-done/bin/gsd-validator.js` (never invoked)

### 9. **Service-Health Command Partial Coverage (LOW)**
- **Evidence:** service-health.test.js covers 7 tests, but:
  - Tests run via `execSync(node gsd-tools.js service-health ...)` 
  - Only validates existence and JSON response format
  - Does NOT test actual dev server start/stop logic
  - Does NOT validate Charlotte/Coordinator integration
- **Impact:** service-health CLI works, but deeper logic (pollHealthEndpoint, getDevServerConfig) is untested.
- **File:** `get-shit-done/bin/gsd-tools.js` (service-health case statements, no deeper tests)

---

## Improvement Candidates

1. **Add GitHub Actions CI workflow (MUST-HAVE)**
   - Create `.github/workflows/test.yml` to run `npm test` on every push and PR
   - Report results in PR status checks
   - Fail PR if tests don't pass
   - Estimated effort: 30 minutes

2. **Wire execution-log into phase workflows (SHOULD-HAVE)**
   - Call `gsd-tools.js execution-log event --type phase_start` at start of execute-phase.md
   - Call `gsd-tools.js execution-log event --type phase_complete` at end
   - Update audit-milestone.md to read EXECUTION_LOG.md for phase timing/status
   - Enables production observability without external dependencies (file-based JSONL)
   - Estimated effort: 2 hours

3. **Enable OpenTelemetry for distributed tracing (SHOULD-HAVE)**
   - Add `--otel` flag to execute-phase and execute-roadmap
   - Wire observability.js initialization into gsd-executor/gsd-phase-coordinator startup
   - Document OTEL_EXPORTER_OTLP_ENDPOINT env var setup
   - Enables trace collection to external APM (Jaeger, Datadog, etc.)
   - Estimated effort: 3 hours

4. **Extract gsd-tools.js into modules (SHOULD-HAVE)**
   - Split into:
     - `bin/gsd-tools-cli.js` (CLI dispatcher, main entry)
     - `bin/gsd-tools-phases.js` (phase operations)
     - `bin/gsd-tools-roadmap.js` (roadmap operations)
     - `bin/gsd-tools-validators.js` (validation commands)
     - `bin/gsd-tools-state.js` (state/config operations)
   - Move all requires to index exports
   - Reduces file to ~80 lines; enables per-module unit testing
   - Estimated effort: 4 hours

5. **Add prompt regression tests (SHOULD-HAVE)**
   - For each agent (executor, verifier, coordinator), write e2e test:
     - Setup: Create minimal phase with PLAN.md
     - Run: Spawn agent with gsd-executor, gsd-verifier
     - Assert: Outputs include required sections, valid JSON frontmatter, no errors
   - Example: `tests/agents/gsd-executor.e2e.test.js` spawns executor on dummy phase, verifies SUMMARY.md is valid
   - Estimated effort: 6 hours (1-2 hours per agent)

6. **Integrate gsd-validator into executor (SHOULD-HAVE)**
   - Call gsd-validator for Haiku→Sonnet validation on high-risk tasks (DB, auth, deployment)
   - Wire selectValidationDepth() into executor task routing
   - Estimated effort: 2 hours

7. **Fix ES module configuration (QUICK WIN)**
   - Add `"type": "module"` to package.json (or convert tests to CommonJS)
   - Eliminates MODULE_TYPELESS_PACKAGE_JSON warnings
   - Estimated effort: 15 minutes

8. **Add execution-log test suite (MUST-HAVE)**
   - Create `get-shit-done/bin/execution-log.test.js`
   - Test: event append, history read, current phase detection, stats aggregation
   - Cover: missing file initialization, JSON parse errors, JSONL format validation
   - Estimated effort: 2 hours

9. **Add session-quality-gates tests (SHOULD-HAVE)**
   - Create test suite for shouldAnalyzeSession(), hashContent(), wasSessionAnalyzed()
   - Cover: edge cases (empty sessions, all-metadata, below thresholds)
   - Estimated effort: 1.5 hours

10. **Document test organization (SHOULD-HAVE)**
    - Create `docs/TESTING.md` explaining:
      - How to run tests (`npm test` vs per-phase)
      - What each test file covers
      - How to add tests (especially for new commands)
      - Coverage expectations (CLI commands: 80%+; workflows: 40%+; agents: 30%+)
    - Estimated effort: 1 hour

---

## Open Questions

1. **Is execution-log intentionally orphaned for later implementation, or a forgotten feature?**
   - No comments in code suggest deferred wiring
   - No issue/TODO in git history
   - Recommendation: Either wire it in (see Improvement #2) or remove it

2. **Is OpenTelemetry integration planned, or is file-based execution-log sufficient?**
   - No workflows reference OTEL env vars
   - execution-log.js is lightweight, file-based; observability.js requires external OTLP endpoint
   - Recommendation: Use execution-log (file-based) for MVP; OTEL optional for advanced deployments

3. **Why are prompt tests (Phase 37–38) string-matching only?**
   - Easier to implement than e2e spawning agents
   - Prevents false failures from agent behavior variance
   - But misses semantic regressions
   - Recommendation: Keep string tests (low CI cost); add optional e2e suite triggered on agent changes

4. **Should gsd-tools.js be refactored before more tests are added, or test-driven to refactoring?**
   - Current 400KB file is hard to test thoroughly
   - Refactoring without tests is risky
   - Recommendation: Test-drive extraction of service-health, execution-log, and config modules first

5. **Are the observability modules part of the GSD core promise (autonomous execution), or experimental?**
   - Not mentioned in main README or CLAUDE.md
   - Suggest these are Phase 8+ features (research explored them)
   - Recommendation: Clarify in ROADMAP.md whether tracing is required for autonomy milestone

---

## Summary

GSD has solid **unit test coverage for CLI commands** (120 tests, 100% pass rate) and emerging **workflow structure validation** (35 tests in Phase 37–38). However, critical gaps exist:

1. **No CI/CD**: Tests never run automatically; regressions slip through.
2. **Dead observability code**: execution-log, observability.js, session-quality-gates never wired; autonomous execution has no audit trail.
3. **No prompt regression testing**: Agent behavior changes go undetected.
4. **Monolithic gsd-tools.js**: 400KB file, 161 commands, ~30% tested; refactoring needed for maintainability.

**Recommended priority:**
- **Week 1:** Add GitHub Actions CI (high impact, low effort)
- **Week 1:** Wire execution-log into workflows (enables production observability)
- **Week 2:** Refactor gsd-tools.js into modules (improves testability)
- **Week 2–3:** Add e2e prompt regression tests (prevent agent degradation)

All test suites currently pass; infrastructure is solid for adding new tests.
