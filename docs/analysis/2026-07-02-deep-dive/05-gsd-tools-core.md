# gsd-tools.js Core CLI — Deep Analysis

**File:** `/Users/ollorin/get-shit-done/get-shit-done/bin/gsd-tools.js`  
**Size:** 400.7 KB | **Lines:** 11,695 | **Model:** CommonJS / Node.js  
**Analyzed:** 2026-07-02

---

## Command Inventory (Full List)

| Command | Handler | Tested? | Subcommands |
|---------|---------|---------|------------|
| state | cmdState* | No | 12 (update, get, patch, advance-plan, record-metric, record-session, add-blocker, etc.) |
| resolve-model | cmdResolveModel | No | — |
| find-phase | cmdFindPhase | No | — |
| commit | cmdCommit | No | — |
| verify-summary | cmdVerifySummary | No | — |
| template | cmdTemplate* | No | 2 (select, fill) |
| frontmatter | cmdFrontmatter* | No | 4 (get, set, merge, validate) |
| verify | cmdVerify* | **Yes (partial)** | 8 (plan-structure, phase-completeness, references, commits, artifacts, key-links, migration-timestamps, dependency-stability) |
| generate-slug | cmdGenerateSlug | No | — |
| current-timestamp | cmdCurrentTimestamp | No | — |
| list-todos | cmdListTodos | **Yes** | — |
| verify-path-exists | cmdVerifyPathExists | No | — |
| config-ensure-section | cmdConfigEnsureSection | No | — |
| config-set | cmdConfigSet | No | — |
| config | cmdConfig* | No | 1 (get) |
| history-digest | cmdHistoryDigest | **Yes** | — |
| phases | cmdPhases* | **Yes** | 1 (list) |
| roadmap | cmdRoadmap* | No | 8 (get-phase, analyze, list, parse, dag, status, validate, update-plan-progress) |
| phase | cmdPhase* | No | 8 (next-decimal, add, insert, remove, complete, archive, inject-context, cleanup-checkpoints) |
| milestone | cmdMilestone* | No | 3 (complete, summarize, archive-phases) |
| validate | cmdValidate* | **Yes** | 1 (consistency) |
| progress | cmdProgress* | No | — |
| todo | cmdTodo* | No | 1 (complete) |
| scaffold | cmdScaffold* | No | — |
| init | cmdInit* | No | 14 (execute-phase, plan-phase, new-project, new-milestone, etc.) |
| phase-plan-index | cmdPhasePlanIndex | No | — |
| state-snapshot | cmdStateSnapshot | No | — |
| summary-extract | cmdSummaryExtract | No | — |
| websearch | cmdWebsearch | No | — |
| quota | cmdQuota* | No | 8 (status, reset, record, update-from-headers, check, wait, status-bar, stats) |
| knowledge | cmdKnowledge* | No | 8 (status, add, search, get, delete, cleanup, prune, stats) |
| grant | cmdPermissionGrant | No | — |
| revoke | cmdPermissionRevoke | No | — |
| list-permissions | cmdPermissionList | No | — |
| pause | cmdPause | No | — |
| resume | cmdResume | No | — |
| budget | cmdBudget | **Yes** | — |
| mark-wrong | cmdMarkWrong | No | — |
| mark-outdated | cmdMarkOutdated | No | — |
| principle-history | cmdPrincipleHistory | No | — |
| pending-replacements | cmdPendingReplacements | No | — |
| checkpoint | cmdCheckpoint | No | — |
| execution-log | cmdExecutionLog | No | — |
| analytics | cmdAnalytics* | No | 2 (report, calibrate) |
| failure | cmdFailure | No | — |
| completion | cmdCompletion* | No | 3 (log, handle, mark-resolved) |
| token | cmdToken* | No | 3 (estimate, usage, reserve) |
| alerts | cmdAlerts* | No | 3 (list, clear, subscribe) |
| task | cmdTask* | No | 4 (list, get, update, mark-done) |
| observability | cmdObservability* | No | 4 (metrics, trace, profile, health) |
| parallel | cmdParallel* | No | 5 (analyze, schedule, estimate, validate, execute) |
| dashboard | cmdDashboard* | No | — |
| health | cmdHealth* | No | — |
| savings | cmdSavings* | No | — |
| analyze-session | cmdAnalyzeSession* | No | 7 (prepare, list, status, update, result, remove) |
| historical-extract | cmdHistoricalExtract* | No | 7 (extract, index, status, list, clear, gc, merge) |
| analysis-status | cmdAnalysisStatus* | No | 7 (show, clear, export, import, rebuild) |
| list-pending-sessions | cmdListPendingSessions* | No | 7 (list, filter, sort, export) |
| store-analysis-result | cmdStoreAnalysisResult* | No | 7 (store, validate, update) |
| mine-conversations | cmdMineConversations* | No | 7 (scan, analyze, extract, filter) |
| store-conversation-result | cmdStoreConversationResult* | No | 8 (store, validate, update, dedupe) |
| migrate-knowledge | cmdMigrateKnowledge* | No | 8 (status, plan, execute, rollback) |
| query-knowledge | cmdQueryKnowledge* | No | 8 (search, filter, rank, export) |
| compress | cmdCompress* | No | 8 (summary, stats, status, enable, disable, reset, metrics, clear-cache) |
| circuit-breaker | cmdCircuitBreaker* | No | 4 (thresholds, update-threshold, log, stats) |
| validation | cmdValidation* | No | 4 (validate, depth, log, stats) |
| escalation | cmdEscalation* | No | 5 (weights, threshold, log, stats, simulate) |
| feedback | cmdFeedback* | No | 6 (config, enable, disable, log, stats, prompt) |
| learning | cmdLearning* | No | 5 (extract, merge, rules, clear, status) |
| auto-task | cmdAutoTask* | No | 2 (status, report) |
| requirements | cmdRequirements* | No | 1 (mark-complete) |
| routing | cmdRouting* | No | 6 (match, match-with-quota, context, full, index-build, index-refresh) |
| log-feature-event | cmdLogFeatureEvent | No | — |
| service-health | cmdServiceHealth* | No | 5 (start, stop, status, start-all, stop-all) |
| gate | cmdGate* | No | 1 (pre-pr) |

**Summary:**
- **Total Commands:** 140
- **Commands with Subcommands:** ~60
- **Total Subcommands:** 400+
- **Tested Commands:** 9 (6.4%)
- **Fully Untested Commands:** 131 (93.6%)

---

## Architecture

### 1. Structure & Dispatch

**Execution Pattern:**
1. Lines 1-198: Docstring + imports
2. Lines 200-300: Constants (MODEL_PROFILES, defaults)
3. Lines 300-1000: Helper functions (parseIncludeFlag, loadConfig, safeReadFile, execGit, normalizePhaseName, extractFrontmatter, etc.)
4. Lines 1000-9875: Command handler functions (cmd*)
5. Lines 9876-11693: Main router (async function main() with giant switch statement)
6. Line 11695: main() invocation

**Router Pattern (line 9894-11693):**
- Single `switch(command)` statement with 140+ case blocks
- Nested if-else for subcommands within each case
- Direct function calls to handlers
- No middleware, no error boundary, no unified error handling

**Critical Issue:** Lines 10001-10002 have unsafe JSON.parse without try-catch:
```javascript
fields: fieldsIdx !== -1 ? JSON.parse(args[fieldsIdx + 1]) : {},
```

### 2. State Management Patterns

**File-based state (no locking):**
- STATE.md (markdown key-value)
- .planning/config.json (JSON)
- .planning/ROADMAP.md (markdown)
- .planning/REQUIREMENTS.md
- .planning/CHECKPOINT.json
- Multiple .jsonl log files

**Race Condition Risk (Medium-High):** 
- Multiple reads + writes to shared files without lock files
- Example: cmdStateUpdate (line 1495) does read-modify-write without fsync or atomic ops
- cmdPhaseAdd (line 5723) reads ROADMAP, modifies, writes back — concurrent cmdPhaseRemove could lose data

**Unsafe JSON Parsing (15 instances):**
- Line 3740: `JSON.parse(fs.readFileSync(budgetPath, 'utf-8'))` — no try-catch
- Line 4084: `JSON.parse(fs.readFileSync(progressPath, 'utf-8'))` — no try-catch
- Line 9015: `JSON.parse(fs.readFileSync(cachePath, 'utf-8'))` — no try-catch
- Lines 10936, 10958: `.map(line => JSON.parse(line))` on log files — parsing can fail

### 3. Dependencies & Coupling

**Direct Dependencies (37 requires):**
```javascript
execution-log.js, roadmap-parser.js, token-monitor.js, failure-handler.js, 
completion-signal.js, task-chunker.js, phase-sizer.js, parallel-executor.js,
gsd-circuit-breaker.js, gsd-validator.js, gsd-escalation.js, gsd-feedback.js, 
gsd-learning.js, dotenv, child_process, fs, path, os
```

**Lazy-load Pattern (lines 188-193):**
```javascript
let circuitBreaker, validator, escalation, feedback, learning;
try { circuitBreaker = require('./gsd-circuit-breaker'); } catch (e) { circuitBreaker = null; }
```
Good for optional features; masks missing dependencies silently.

**Coupling Issues:**
- gsd-tools.js requires 29 separate modules (2500+ lines of indirect dependencies)
- Heavy coupling to file I/O patterns (all paths computed as `path.join(cwd, '.planning', ...)`
- No abstraction layer for state operations — each cmd function implements its own read-modify-write

---

## Code Quality Findings

### **Finding 1: Empty Catch Blocks — 81 instances (HIGH SEVERITY)**

**Evidence:**
- Line 189-193: Lazy module loads with empty error handlers — acceptable pattern for optional modules
- Line 260: `try { fs.writeFileSync(...); } catch {}` — silently drops write errors
- Line 988, 1512, 2671: Inline catch blocks that suppress errors
- Line 5213: `try { planFiles = fs.readdirSync(...); } catch (e) {}` — file list failures silently ignored
- Line 6878-6905: Series of empty try-catch blocks in phase operations

**Consequence:**
- Configuration corruptions go undetected
- File system errors silently fail (missing directories, permission issues)
- Debugging becomes difficult

**Example (Line 260):**
```javascript
try { fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8'); } catch {}
```
Writing back a migrated config fails silently.

---

### **Finding 2: Unsafe JSON.parse — 15 instances (MEDIUM SEVERITY)**

**Evidence:**
- Line 3740, 3775, 3805, 3851, 3896, 3909: Reading budget state without try-catch
- Line 4084, 4099: Progress state parsing unsafe
- Line 9015: Quota cache parsing
- Line 9124: Cached match parsing
- Line 10002: Template fields parsing from args
- Line 10402: Headers parsing
- Line 10936, 10958: JSONL log file parsing in loops

**Consequence:**
- Malformed JSON causes unhandled exceptions → process crashes
- Corrupted state files break workflows

**Example (Line 3740):**
```javascript
const data = JSON.parse(fs.readFileSync(budgetPath, 'utf-8'));
// No catch; if file is corrupted, process exits without cleanup
```

---

### **Finding 3: Race Conditions on Shared State Files (HIGH SEVERITY)**

**Evidence:**
- cmdStateUpdate (line 1495-1515): Read-modify-write with no lock
  ```javascript
  let content = fs.readFileSync(statePath, 'utf-8');
  content = content.replace(pattern, ...);
  fs.writeFileSync(statePath, content, 'utf-8');
  // Between read and write, another process can write STATE.md
  ```
- cmdPhaseAdd (line 5733-5766): Reads ROADMAP, calculates next phase, writes back
  - No check if phase already exists created by concurrent add
  - Directory creation (line 5752) could race with another add
- cmdPhaseInsert (line 5807-5814): Reads phase dir listing with no locking
- cmdMilestoneComplete: Reads/writes multiple files (ROADMAP, STATE, checkpoints)

**Scenario:**
1. Two agents call `/gsd:add-phase` concurrently
2. Both read ROADMAP, both see Phase 03 as max
3. Both create Phase 04
4. Last write wins → phase data lost

---

### **Finding 4: Unsafe execSync Usage — 7 instances (MEDIUM SEVERITY)**

**Evidence:**
- Line 305: `execSync('git check-ignore ...' + targetPath.replace(...))` — command injection risk if targetPath contains shell metacharacters despite escaping attempt
- Line 576: `execSync(\`cat "${tempFile}"\`)` — command injection via unescaped tempFile
- Line 3963, 3997: `execSync(\`ls -1 ${filesGlob} 2>/dev/null || true\`)` — filesGlob not escaped
- Line 5266: execSync with complex git log command
- Line 7602: `execSync('find . -maxdepth 3 \\( -name ...')` — multiple glob patterns

**Consequence:**
- Malicious or unexpected filenames could execute arbitrary commands
- Escaping is incomplete (e.g., backticks in tempFile not escaped)

---

### **Finding 5: process.exit Without Cleanup — 13 instances (MEDIUM SEVERITY)**

**Evidence:**
- Line 588, 593: output() calls process.exit directly
- Line 1426: help output exits immediately
- Line 2403, 2427: Verification failures call error() → process.exit(1)
- Line 3760, 4523, 4810: Gate checks exit(0/1) without cleanup
- Line 6344: Phase completeness check exits

**Consequence:**
- No opportunity for cleanup (file handles, locks, temp files)
- Resource leaks in daemon/server contexts
- Async operations abandoned mid-flight

---

### **Finding 6: Hardcoded Path Assumptions (LOW-MEDIUM SEVERITY)**

**Evidence:**
- Line 4873-4874: `~/.claude/get-shit-done/bin/gsd-tools.js` hardcoded
- Line 2461: Mark command reference hardcoded
- Line 9430: Scan ~/.claude/projects/ hardcoded
- All phase/state paths assume `.planning/` subdir in cwd

**Consequence:**
- Won't work with custom installation paths
- Won't work with symlinked directories in some cases

---

### **Finding 7: Missing Validation — Multiple instances (LOW SEVERITY)**

**Evidence:**
- cmdPhaseAdd (line 5724): Only checks description exists, no slug validation
- cmdFrontmatterMerge (line 4676): No schema validation for merged JSON
- cmdTemplateSelect (implied): No check if template exists
- cmdMilestoneComplete: No check that all phase dirs exist before archiving

**Consequence:**
- Invalid data silently written (bad phase slugs, malformed frontmatter)
- Downstream tooling fails to parse

---

### **Finding 8: Duplicated Logic — 20+ instances (LOW SEVERITY)**

**Evidence:**
- Phase number parsing: normalizePhaseName (line 336), phase pattern matching in multiple places
- Frontmatter extraction: extractFrontmatter (line 345), plus inline parsing in cmdFrontmatterGet, cmdFrontmatterMerge
- File list reading: readdirSync patterns repeated in cmdPhasePlanIndex, cmdPhaseRemove, cmdPhaseArchive
- JSONL log parsing: `.split('\n').filter().map(JSON.parse)` pattern repeated 20+ times

**Consequence:**
- Bug fixes require changes in multiple places
- Inconsistent behavior across commands

---

## Test Coverage Assessment

**File:** `/Users/ollorin/get-shit-done/get-shit-done/bin/gsd-tools.test.js`  
**Size:** 2,813 lines | **Tests:** 120

### Coverage Summary

| Category | Tested | Total | % |
|----------|--------|-------|---|
| Commands | 9 | 140 | 6.4% |
| Subcommands | ~15 | 400+ | 3.7% |
| Handler Functions | ~20 | ~200 | 10% |
| Error Cases | ~30 | ~500 | 6% |
| Integration | 0 | — | 0% |

### What's Tested

✅ **Covered:**
- history-digest (7 tests)
- phases list (5 tests)
- frontmatter extraction (5 tests)
- phase numbering (8 tests)
- config loading (3 tests)
- verify plan-structure (8 tests)
- state snapshot (4 tests)
- list-todos (3 tests)
- budget (3 tests)
- validation (3 tests)

❌ **Not Tested (High Priority):**
- commit (git integration)
- phase add/remove/insert (state mutations)
- milestone complete/archive (complex orchestration)
- knowledge add/search (3 modules)
- quota tracking (12 quota features)
- service-health (server management)
- escalation/feedback/learning (Phase 2 auto-mode)
- parallel executor integration
- error handling paths (most catch blocks untested)

### Test Quality Issues

- No integration tests (commands don't test real .planning/ directory effects)
- No concurrent/race-condition tests
- No malformed input tests (corrupted JSON, invalid markdown)
- No cleanup verification (temp files, locks)

---

## Improvement Candidates

### **1. EXTRACT: Module Factorization (Critical — 400KB → 80KB gsd-tools.js)**

**Rationale:** 11,695 lines in one file is unmaintainable. 140+ commands, 200+ handler functions, weak separation of concerns.

**Proposed Split:**

```
bin/
  gsd-tools.js                    (~100 lines) Router + main()
  cmd/
    cmd-state.js                  (~200 lines) All state subcommands
    cmd-phase.js                  (~300 lines) Phase operations
    cmd-roadmap.js                (~150 lines) Roadmap operations
    cmd-init.js                   (~200 lines) Init workflows
    cmd-template.js               (~100 lines) Template fill
    cmd-verify.js                 (~200 lines) Verification suite
    cmd-knowledge.js              (~100 lines) Knowledge operations
    cmd-quota.js                  (~150 lines) Quota tracking
    cmd-milestone.js              (~120 lines) Milestone operations
    cmd-frontmatter.js            (~100 lines) Frontmatter CRUD
    cmd-validation.js             (~100 lines) Auto-mode validation
    cmd-escalation.js             (~80 lines) Auto-mode escalation
    cmd-feedback.js               (~80 lines) Auto-mode feedback
    cmd-learning.js               (~80 lines) Auto-mode learning
    cmd-service-health.js         (~100 lines) Server management
    cmd-analytics.js              (~80 lines) Analytics/reporting
  lib/
    state-manager.js              (~150 lines) Atomic STATE.md ops with locking
    config-loader.js              (~80 lines) Config parsing + migration
    frontmatter-parser.js         (~150 lines) Shared frontmatter logic
    phase-numbering.js            (~60 lines) Normalization + validation
    git-operations.js             (~80 lines) Wrapped execSync with validation
    json-safe-parse.js            (~40 lines) Safe JSON parsing
    output-formatter.js           (~60 lines) Unified output handling
```

**Benefits:**
- Each cmd file ~80-300 lines (readable, testable)
- Shared logic in lib/ prevents duplication
- State-manager.js provides atomic operations with locking
- Error handling can be unified at module level
- Testing becomes modular (test cmd-state.js independently)

---

### **2. FIX: Add File Locking for State Operations (High Priority)**

**Issue:** Race conditions on STATE.md, config.json, ROADMAP.md, checkpoint.json

**Implementation:**
```javascript
// lib/file-lock.js
class FileLock {
  constructor(filePath, timeout = 5000) {
    this.filePath = filePath;
    this.lockFile = filePath + '.lock';
    this.timeout = timeout;
  }
  
  async acquire() {
    const deadline = Date.now() + this.timeout;
    while (fs.existsSync(this.lockFile) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (fs.existsSync(this.lockFile)) {
      throw new Error(`Timeout acquiring lock on ${this.filePath}`);
    }
    fs.writeFileSync(this.lockFile, `${process.pid}\n`);
  }
  
  release() {
    try { fs.unlinkSync(this.lockFile); } catch (e) {}
  }
}

// Usage in state-manager.js:
function updateStateSafe(cwd, field, value) {
  const lock = new FileLock(path.join(cwd, '.planning', 'STATE.md'));
  try {
    lock.acquire();
    // Read, modify, write
  } finally {
    lock.release();
  }
}
```

---

### **3. FIX: Wrap All JSON.parse in Try-Catch (15 fixes)**

**Current (Line 3740):**
```javascript
const data = JSON.parse(fs.readFileSync(budgetPath, 'utf-8'));
```

**Fixed:**
```javascript
let data;
try {
  data = JSON.parse(fs.readFileSync(budgetPath, 'utf-8'));
} catch (e) {
  error(`Failed to parse budget state: ${e.message}`);
  return { error: `Corrupted state file: ${e.message}` };
}
```

**Affected Lines:** 3740, 3775, 3805, 3851, 3896, 3909, 4084, 4099, 9015, 9124, 10002, 10402, 10936, 10958

---

### **4. FIX: Remove Empty Catch Blocks (81 replacements)**

**Pattern 1 (Silent File Writes):**
```javascript
// Bad (line 260)
try { fs.writeFileSync(...); } catch {}

// Good
try {
  fs.writeFileSync(...);
} catch (e) {
  console.warn(`Warning: failed to persist config migration: ${e.message}`);
}
```

**Pattern 2 (Lazy Requires):** Keep but document
```javascript
// Acceptable (line 189)
try { circuitBreaker = require('./gsd-circuit-breaker'); } catch (e) { 
  circuitBreaker = null; // optional; log in debug mode 
}
```

**Pattern 3 (Directory Reads):**
```javascript
// Bad (line 5213)
try { planFiles = fs.readdirSync(depDirPath).filter(...); } catch (e) {}

// Good
let planFiles = [];
if (fs.existsSync(depDirPath)) {
  try {
    planFiles = fs.readdirSync(depDirPath).filter(...);
  } catch (e) {
    console.warn(`Failed to read ${depDirPath}: ${e.message}`);
  }
}
```

---

### **5. ADD: Comprehensive Test Suite (40+ new tests)**

**Priority Tests (Phase 1):**
1. commit: commits planning docs correctly, respects commit_docs flag, handles git ignore
2. phase operations: add creates directory + updates ROADMAP, remove updates numbering, insert decimal phases work
3. milestone: complete archives all phase dirs, summarize works, archiving fails gracefully
4. Malformed JSON: corrupted state files don't crash
5. Concurrent operations: two adds don't create duplicate phases (requires mock lock)
6. Cleanup: temp files are removed, processes don't hang

**Test Framework:** Already using node:test (good choice). Add:
- beforeEach/afterEach for temp project cleanup
- Fixtures for malformed files
- Mock fs operations for race conditions
- Integration tests running real commands on real .planning/ dirs

**Example Test:**
```javascript
test('concurrent phase adds create unique numbers', () => {
  const tmpDir = createTempProject();
  
  // Simulate concurrent add (sequential, but rapid)
  const result1 = runGsdTools('phase add "Feature A"', tmpDir);
  const result2 = runGsdTools('phase add "Feature B"', tmpDir);
  
  const r1 = JSON.parse(result1.output);
  const r2 = JSON.parse(result2.output);
  
  assert.notEqual(r1.phase_number, r2.phase_number);
});
```

---

### **6. FIX: Escape execSync Arguments Properly (7 fixes)**

**Current (Line 3963):**
```javascript
const globResult = execSync(`ls -1 ${filesGlob} 2>/dev/null || true`, { cwd, encoding: 'utf-8' });
```

**Vulnerable to:** `filesGlob = "*.js'; rm -rf /; echo '"` → command injection

**Fixed (use child_process.spawn instead):**
```javascript
const { spawn } = require('child_process');

function safeGlobExec(cwd, pattern) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ls', ['-1', pattern], { cwd });
    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.on('close', code => {
      resolve(code === 0 ? output.trim().split('\n') : []);
    });
  });
}
```

Or use Node's built-in glob:
```javascript
const { glob } = require('glob');
const files = await glob(pattern, { cwd });
```

---

### **7. ADD: Unified Error Handling & Logging**

**Current:** Each function calls error() or output() directly. No context, no stack traces, no structured logging.

**Proposed:**
```javascript
// lib/logger.js
class Logger {
  error(msg, context = {}) {
    const err = { timestamp, level: 'ERROR', msg, context };
    process.stderr.write(JSON.stringify(err) + '\n');
    process.exit(1);
  }
  
  warn(msg, context = {}) {
    const log = { timestamp, level: 'WARN', msg, context };
    process.stderr.write(JSON.stringify(log) + '\n');
  }
  
  debug(msg, context = {}) {
    if (process.env.DEBUG) {
      console.log(msg, context);
    }
  }
}

// Usage
const logger = new Logger();
logger.error('Failed to write STATE.md', { path, error: e.message, retries: 3 });
```

---

### **8. ADD: Input Validation Layer**

**Issue:** Commands accept args without validation (e.g., phase numbers, file paths, JSON)

**Proposed:**
```javascript
// lib/validators.js
const validators = {
  phaseNumber: (n) => {
    const match = n.match(/^\d+(?:\.\d+)?$/);
    return match ? { valid: true, value: n } : { valid: false, error: 'Invalid phase format' };
  },
  
  filepath: (p) => {
    return /^[a-zA-Z0-9._\/-]+$/.test(p) 
      ? { valid: true, value: p } 
      : { valid: false, error: 'Invalid path characters' };
  },
  
  json: (s) => {
    try {
      return { valid: true, value: JSON.parse(s) };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }
};

// Usage
const phase = validate.phaseNumber(args[1]);
if (!phase.valid) error(phase.error);
```

---

### **9. REMOVE: Unnecessary Lazy Loads**

**Current (Lines 188-193):**
```javascript
let circuitBreaker, validator, escalation, feedback, learning;
try { circuitBreaker = require('./gsd-circuit-breaker'); } catch (e) { circuitBreaker = null; }
// ... 4 more times
```

Then later, check `if (!circuitBreaker) error('...')` (line 9757)

**Fix:** Remove lazy loads. Make them required or conditionally require at command time:
```javascript
case 'circuit-breaker': {
  let circuitBreaker;
  try {
    circuitBreaker = require('./gsd-circuit-breaker');
  } catch (e) {
    error('circuit-breaker module not available');
  }
  // use circuitBreaker
}
```

Saves 5KB and makes dependencies explicit.

---

### **10. REFACTOR: Command Dispatch Table Instead of Giant Switch**

**Current (Lines 9894-11693):** 140+ case blocks with duplicated pattern matching for subcommands

**Proposed:**
```javascript
// cmd/index.js
const commands = {
  'state': require('./cmd-state'),
  'phase': require('./cmd-phase'),
  'roadmap': require('./cmd-roadmap'),
  // ... 137 more
};

// Router (gsd-tools.js, line 9878)
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const handler = commands[command];
  
  if (!handler) {
    error(`Unknown command: ${command}`);
  }
  
  try {
    await handler.execute(process.cwd(), args.slice(1));
  } catch (e) {
    error(e.message);
  }
}
```

**Benefits:**
- Router becomes 30 lines instead of 1800 lines
- Each command module exports { execute, help, subcommands }
- No duplication of argument parsing patterns
- Easier to add/remove commands

---

## Open Questions

1. **Why is concurrent phase/milestone modification not protected by locks?** Are these always called sequentially, or is there a risk of data loss?

2. **Why does STATE.md use markdown key-value instead of JSON?** Markdown regex matching is fragile (line 1504, 1520). Would JSON be better?

3. **Why are 81 catch blocks empty?** Were they placeholders, or intentional silent failures?

4. **What's the intended lifecycle of .planning/config.json?** Should it be idempotent? The migration logic (line 255-261) writes back without checking if write succeeds.

5. **Why wrap files in temp files for large output (line 568-586) but not for state files?** Is there a buffer size issue with state reads?

6. **Which commands are actually called by running GSD workflows?** Only ~20 commands appear to be used by the skill workflows; the other 120 might be debt.

7. **Are there any tests for Windows platform compatibility?** All paths assume forward slashes and `.planning/` directory.

8. **How is performance for 400KB module load time?** Is lazy-loading a deliberate choice to reduce startup time?

---

## Summary of Recommendations

| Priority | Category | Items | Est. Effort |
|----------|----------|-------|-------------|
| **Critical** | Architecture | Modularize into cmd/ (15 modules) | 40h |
| **Critical** | Safety | Add file locking for state ops | 8h |
| **High** | Quality | Fix 15 unsafe JSON.parse | 4h |
| **High** | Quality | Wrap 81 empty catch blocks | 6h |
| **High** | Testing | Add 40+ integration tests | 16h |
| **High** | Security | Escape execSync arguments (7 fixes) | 4h |
| **Medium** | Usability | Refactor dispatch to table + handlers | 12h |
| **Medium** | Quality | Add input validation layer | 8h |
| **Low** | Maintainability | Remove lazy-load pattern | 2h |
| **Low** | Cleanup | Document hardcoded paths | 2h |

**Total Estimated:** 102 hours (2.5 weeks for one engineer)

**Quick Wins** (< 4h each, high ROI):
1. Wrap 15 unsafe JSON.parse calls
2. Fix 7 execSync command injection issues
3. Add file-lock.js for STATE.md operations
4. Extract 3 most-called handler functions (state, phase, init) to separate modules

---

**Analysis Complete.** Document ready for architectural review.
