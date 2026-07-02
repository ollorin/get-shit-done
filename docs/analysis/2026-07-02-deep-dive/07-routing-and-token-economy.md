# Model Routing & Token Economy — Deep Analysis

**Analysis Date:** 2026-07-02  
**Scope:** Model routing, profiles, token monitoring, savings analytics, compression hooks  
**Status:** Critical issues identified

---

## Inventory

### Core Files

| File | Size | Purpose | Called By |
|------|------|---------|-----------|
| `routing-rules.md` | 3.5 KB | Pattern → model tier lookup table | gsd-task-router.md (documented only) |
| `agents/gsd-task-router.md` | 8.2 KB | Agent that reasons task complexity & quotes quota | gsd-phase-coordinator.md @ line 783-789 (plan-level fallback only) |
| `bin/analytics.js` | 16.4 KB | Report generation from EXECUTION_LOG.md | Undiscovered callers |
| `bin/savings-report.js` | 6.6 KB | Calculate cost vs all-Opus baseline | Undiscovered callers |
| `bin/token-monitor.js` | 11.3 KB | TokenBudgetMonitor class + alerts | Loaded in gsd-tools.js L180, never instantiated in observed code |
| `bin/llm-metrics.js` | 4.8 KB | Cost calculation, pricing table, LLM span creation | Requires OpenTelemetry (optional); not called by core flows |
| `bin/phase-sizer.js` | 8.9 KB | Detect oversized phases, recommend splits | ORPHANED — no callers found |
| `bin/task-chunker.js` | 14.0 KB | Estimate task tokens, split large tasks | gsd-tools.js L183 imported; `task chunk analyze` command calls it, but coordinator doesn't |
| `bin/parallel-executor.js` | 15.0 KB | ParallelPhaseExecutor class, parallel execution logic | ORPHANED — imported in gsd-tools.js L185 but never used |
| `bin/execution-log.js` | 6.2 KB | Append/read event log (routing_decision, task_dispatch, etc.) | gsd-tools.js L178; analytics.js L19-21 lazy-load |
| `bin/gsd-tools.js` | 400.7 KB | Main CLI: config loading, model resolution, command dispatch | Entry point for all GSD operations |

### Config & State

| File | Purpose |
|------|---------|
| `.planning/config.json` | `model_profile` key: "quality" \| "balanced" \| "budget" \| "auto" |
| `.planning/token_budget.json` | TokenBudgetMonitor.toJSON() snapshot (manual or API-populated) |
| `.planning/EXECUTION_LOG.md` | JSONL events: routing_decision, task_dispatch, phase_start, phase_complete |

---

## How Model Selection Flows

### Path 1: Agent-Level Selection (Startup-Time)

**Entry:** gsd-phase-coordinator spawns agents in steps: discuss, research, plan, execute, verify

**Flow:**
1. Coordinator reads `.planning/config.json` → `model_profile`
2. For each agent (gsd-planner, gsd-executor, gsd-verifier, etc.):
   ```javascript
   // gsd-tools.js L200–213: MODEL_PROFILES table
   const MODEL_PROFILES = {
     'gsd-planner': { quality: 'opus', balanced: 'opus', budget: 'sonnet', auto: 'sonnet' },
     'gsd-executor': { quality: 'opus', balanced: 'sonnet', budget: 'sonnet', auto: 'sonnet' },
     // ...
   };
   ```
3. Coordinator calls `resolveModel(agent_name)` which indexes MODEL_PROFILES[agent_name][profile]
4. Agent is spawned with that model — **decision is locked at spawn time, cannot be overridden later**

**Evidence:**
- gsd-tools.js: `resolveModel()` function @ line ~350 (undiscovered in read limits)
- gsd-phase-coordinator.md L635–838 (planner, executor spawn with fixed model per profile)

---

### Path 2: Per-Task Routing (Auto Mode, Execution Time)

**Condition:** `model_profile == "auto"` AND tasks in PLAN.md have explicit tier tags

**Flow:**
1. Coordinator reads PLAN.md; parses each task for `<model>` element or legacy `[haiku]` prefix (gsd-phase-coordinator.md L759–779)
2. If tier tags found: PER_TASK_MODE = true
   - Each task spawned with its tagged tier (haiku/sonnet/opus)
   - Before spawn: quota check (gsd-phase-coordinator.md L850–857)
     - `>95%` → downgrade to haiku
     - `>80%` AND model == opus → downgrade to sonnet
     - Else: keep tier
   - Executor spawned per task with tier-specific model (L862–890)
3. If no tier tags: PER_TASK_MODE = false (fallback)
   - Plan treated as single unit
   - Spawn gsd-task-router agent to determine model (L783–789)
   - Router reads plan objective, applies routing-rules.md patterns
   - Returns ROUTING DECISION with model, reasoning, and optional context docs
   - Extracted model used for single executor spawn

**Evidence:**
- gsd-phase-coordinator.md L738–800 (entire execution step with routing logic)
- gsd-task-router.md L32–145 (rubric and quota checking)
- routing-rules.md L5–107 (pattern table)

**Gap 1: Per-Task Routing Accuracy**
- Task-level tags are manually added to PLAN.md by gsd-planner
- gsd-planner receives no guidance on tier selection; defaults apply
- No validation that tier tags are present or correct
- If plan lacks tags, falls back to plan-level router — potentially misrouting multi-subtask plans

---

### Path 3: Plan-Level Routing (Fallback, No Tags)

**Flow:**
1. gsd-task-router agent spawned
2. Router executes step `reason_about_complexity` (gsd-task-router.md L32–85):
   - Reads plan objective from PLAN.md
   - **Applies decision rubric, NOT algorithmic scoring**
   - Rubric defaults to haiku (55% frequency target) unless reason to escalate
   - Checks complexity level (from plan context), done criteria clarity, verification needs, must_haves count
   - Outputs one-sentence reasoning + tier choice
3. Router executes step `check_quota` (L87–98):
   - Runs: `node gsd-tools.js quota status --json`
   - Reads `session.percent`
   - Downgrades: >95% → haiku; >80% + opus → sonnet; else keep tier
4. Router optionally fetches context docs (L100–108) — best-effort, doesn't block
5. Returns structured ROUTING DECISION (L110–127)
6. Coordinator extracts Model: line from response, spawns executor

**Evidence:**
- gsd-task-router.md (complete agent prompt)
- gsd-phase-coordinator.md L783–799 (coordinator invokes router and logs decision)

**Critical Issue 1: Heuristic, Not Algorithmic**
- "Reason about complexity" step uses human judgment rubric
- No actual token estimation or complexity scoring
- Rubric is qualitative ("vague done criteria → escalate", "judgment required → escalate")
- Router is an LLM making subjective decisions, not applying deterministic rules
- Even with consistent prompt, outputs vary by model capacity and input phrasing

---

## Complexity Scoring in Task-Router

### Stated Rubric (gsd-task-router.md L33–84)

**Default: Haiku (~55% of tasks)**
- Well-specified tasks where plan already answers "how"
- Mechanical execution: testing, migrations, refactoring non-critical, renaming, config changes
- If plan specifies signature/behavior, implementation is haiku even if domain sounds complex

**Sonnet (~30% of tasks)**
- Real design decisions not in plan
- Debugging with unknown root cause
- Multi-file changes requiring coherence decisions
- Doc writing (content is clear, structure not)
- Verification tasks, test infra setup

**Opus (~15% of tasks)**
- No right answer, multiple architectures
- Completely unknown root cause across systems
- Breaking changes with tradeoffs

### Reality Check

**Issue 2: Rubric Not Empirically Validated**
- Targets (55/30/15) are aspirational, not measured against actual historical outcomes
- analytics.js L219–242 computes tier distribution from EXECUTION_LOG.md:
  ```javascript
  tierCounts = { haiku: 0, sonnet: 0, opus: 0, unknown: 0 }
  for (ev of routingEvents)
    if (ev.type === 'routing_decision' or 'task_dispatch')
      tierCounts[ev.model]++
  ```
  - **But this counts dispatch decisions, not outcome fitness**
  - No measurement of: haiku tasks that failed, sonnet tasks completed faster than planned, opus tasks that were overkill
- calibrate() function (L283–461) tries to adjust thresholds:
  - Checks haiku failure rate (L312–327)
  - If >25% of haikus fail: lower haiku_max_score
  - But haiku_max_score is never actually used in routing code — **dead variable**

**Issue 3: Disconnected from Planning**
- routing-rules.md is pattern-based lookup, not integrated into router code
- Task-router.md doesn't mention or reference routing-rules.md
- Router uses qualitative rubric; rules table unused
- Rules table exists but has no callers in observed code

---

## Quota Awareness

### Token Budget Monitoring

**TokenBudgetMonitor class (token-monitor.js L16–181)**

```javascript
class TokenBudgetMonitor {
  constructor(model = 'opus', maxTokens = 200000)
  reserve(estimatedTokens, operation) → { canProceed, utilization, recommendation }
  recordUsage(actualTokens, phase) → { recorded, newUtilization }
  getReport() → { utilization_percent, remaining_tokens, phase_breakdown, active_alerts }
  save(projectPath) // Persists to .planning/token_budget.json
}
```

**Alert Thresholds (token-monitor.js L10–14):**
```javascript
ALERT_THRESHOLDS = {
  warn: 0.80,      // Recommend compression
  critical: 0.90,  // Escalate warnings
  stop: 0.95       // Halt execution
}
```

**Graduated Alerts (token-monitor.js L62–104):**
- 50%, 65%, 80%, 90%, 95% thresholds trigger alerts in _checkGraduatedAlerts()
- At 80%: attempts to auto-enable compression via hookConfigPath (L87–102)
  ```javascript
  const hookConfigPath = require('path').join(
    process.env.HOME, '.claude', 'get-shit-done', 'bin', 'hooks', 'config'
  );
  const { loadHookConfig, saveHookConfig } = require(hookConfigPath);
  cfg.compression.enabled = true;
  ```
  - **Gap 2: hookConfigPath does NOT exist in source** (~/.claude/get-shit-done/bin/hooks/config)
  - Only source hooks are gsd-check-update.js and gsd-statusline.js
  - This code path fails silently (caught in try-catch, L99)

### Quota Data Source: Reality vs Theory

**Issue 4: Token Budget Data is Phantom**

Data stored in `.planning/token_budget.json` comes from:
1. Manual initialization: TokenBudgetMonitor.save() is called but only in test/CLI
2. API integration: Would be set via `quota update-from-headers <json>` but no automated collection
3. No actual connection to Claude API usage reporting

**Evidence:**
- token-monitor.js: no code reads from Claude API headers
- gsd-tools.js quota command (L~3000): loads state.json which has:
  ```javascript
  session: { tokens_used, tokens_limit, reset_time }
  weekly: { tokens_used, tokens_limit, reset_time }
  tasks: [ { id, model, tokens_in, tokens_out } ]
  ```
  - But where are tokens_used and tokens_limit set? No automated updates found.
  - Depends on manual calls to `quota record <id> <model> <in> <out>`
  - **In real execution, these are never called**

**Verification:**
- gsd-phase-coordinator.md @ L850-857: calls `quota status --json`
- Extracts session.percent and downgrades models
- But session.percent reflects manually-recorded token counts or stale data
- No real-time instrumentation of agent spawns

**Issue 5: Quota Downgrade is Redundant**
- gsd-task-router already checks quota (L87–98)
- gsd-phase-coordinator also checks quota before per-task executor spawn (L850–857)
- Double-checking, but against stale/phantom data
- Downgrade thresholds (95%, 80%) are conservative but based on non-real data

---

## Savings Analytics

### Claimed Savings

**savings-report.js — calculateSavings()**

```javascript
function calculateSavings(usageData) {
  // usageData: { haiku: {input, output}, sonnet: {...}, opus: {...} }
  actualCost = sum of (input + output tokens by model × pricing)
  opusBaseline = totalTokens × opus_pricing
  savings = opusBaseline - actualCost
  savingsPercent = (savings / opusBaseline) × 100
  return { savings_usd, savings_percent, model_breakdown }
}
```

**Pricing Table (llm-metrics.js L13–21):**
```javascript
const CLAUDE_PRICING = {
  'opus': { input: 5, output: 25, cached: 0.5 },
  'sonnet': { input: 3, output: 15, cached: 0.3 },
  'haiku': { input: 1, output: 5, cached: 0.1 }
  // per 1M tokens
};
```

**Data Source for Savings Report:**

generateReport() reads from token_budget.json:
- `phaseUsage`: map of phase → tokens
- `modelUsage`: map of model → {input, output}
- Assumes 70/30 input/output split if only total available (L96–98)

**Issue 6: Savings Based on Phantom Token Data**

- token_budget.json is never populated in observed execution
- No automatic token collection from agent spawns
- analytics.js line 117: getHistory() reads EXECUTION_LOG.md for routing_decision events
  - These log *routing tier chosen*, not actual tokens spent
  - example line: `{"type":"routing_decision","model":"sonnet","task":"...","score":0.35}`
  - No usage data, no actual token counts

**Evidence of Phantom Data:**
- savings-report.js generateReport() @ L74–115: generates recommendations like:
  ```
  "Excellent savings (45.2%). Auto mode routing is effective."
  ```
  - But this is computed from an empty or placeholder token_budget.json
  - No correlation to actual API usage
  - Savings percentage is marketing-friendly fiction

**Verification:**
- In real GSD execution, token_budget.json starts empty
- savings-report.js default return (L75–76): `{ error: 'No budget data available' }`
- Command `gsd-tools.js analytics report` would show no savings (no data)

---

## Compression Hooks

### Stated Architecture

**token-monitor.js _checkGraduatedAlerts() @ L86–102:**
```javascript
if (alert.threshold === 0.80) {
  const hookConfigPath = require('path').join(
    process.env.HOME, '.claude', 'get-shit-done', 'bin', 'hooks', 'config'
  );
  const { loadHookConfig, saveHookConfig } = require(hookConfigPath);
  cfg = loadHookConfig();
  if (!cfg.compression.enabled) {
    cfg.compression.enabled = true;
    saveHookConfig(cfg);
  }
}
```

**Expected Hook Flow:**
1. At 80% token usage, tokenMonitor auto-enables compression
2. Calls loadHookConfig() from ~/.claude/get-shit-done/bin/hooks/config
3. Sets compression.enabled = true
4. Saves config
5. Hook system picks up this config and compresses subsequent prompts/responses

### Reality

**Issue 7: Compression Wiring is Broken**

1. **hookConfigPath does not exist:**
   - Reference: `~/.claude/get-shit-done/bin/hooks/config`
   - Checked in source: /Users/ollorin/get-shit-done/hooks/ only has gsd-check-update.js and gsd-statusline.js
   - Installed: ~/.claude/get-shit-done/bin/hooks/ doesn't exist (checked)
   - **Code fails silently** (try-catch swallows error, L99)

2. **Hook Compression Claim (60-70% reduction):**
   - Mentioned in task description but never implemented in observed code
   - No compression module found in bin/ directory
   - No compression algorithm integrated anywhere
   - Likely aspirational design, not realized

3. **Alternative: LLM-Lingua or Doc Compression:**
   - skills/llmlingua-comparison/ mentioned in task (skim)
   - Not read; need to verify if alternative compression exists
   - But gsd-tools.js, gsd-phase-coordinator.md show no calls to compression

---

## Dead/Orphaned Code

### Confirmed Orphaned

| Module | Lines | Reason | Impact |
|--------|-------|--------|--------|
| **parallel-executor.js** | 506 | Imported in gsd-tools.js L185; exported functions never called; gsd-phase-coordinator spawns executors sequentially (L862–890), not via ParallelPhaseExecutor | Unused complexity; potential maintenance burden |
| **phase-sizer.js** | 288 | Functions exported; no callers in agents, coordinator, or gsd-tools.js command handlers | Dead code; oversized phase detection never triggered |
| **task-chunker.js (partial)** | 490 | TaskChunker class used by gsd-tools.js `task chunk` and `task batch` commands; but **gsd-phase-coordinator never calls these**; coordinator doesn't split large tasks | Large task handling unavailable in real execution |

### Likely Orphaned

| Module | Reason |
|--------|--------|
| **analytics.js** | generateReport() and calibrate() defined; no entry point found in gsd-tools.js command handlers (searched up to L4200) |
| **savings-report.js** | generateReport() defined; never called; no CLI command that generates savings reports in observed code |
| **phase-sizer.js** | recommendSplit() designed to help split oversized phases; not wired into plan creation or validation |

### Partial Usage

| Module | Usage | Gap |
|--------|-------|-----|
| **task-chunker.js** | CLI: `task chunk analyze --description "..." --files F1 F2` | Coordinator doesn't use; large tasks not split during execution |
| **token-monitor.js** | Instantiated in tests; loaded as class; integration-test() @ L237–345 defined | No production code instantiates or uses it; quota state is separate |
| **execution-log.js** | Events appended by coordinator @ L795–797; read by analytics.js @ L19–21 | Events logged, but only routing_decision/task_dispatch/phase_* — no actual token tracking |

---

## Issues Found

### HIGH SEVERITY

**1. Token Savings Reporting is Fiction (Line: savings-report.js L18–67)**
- **Summary:** Savings percentages are computed from missing token data
- **Failure Scenario:** User runs analytics report, sees "45% savings vs all-Opus baseline"; actual token usage is never captured; claim is unverifiable
- **Evidence:** 
  - token_budget.json starts empty
  - No automatic token collection from API
  - savings-report.js assumes modelUsage data that never exists
  - calculateSavings() returns theoretical savings on phantom data
- **Fix:** Integrate actual API usage (cache headers, tool_use tokens, etc.) or remove savings claims

**2. Quota Monitoring is Non-Functional (Line: token-monitor.js L87–102)**
- **Summary:** Auto-compression at 80% tokens fails silently; hook config doesn't exist
- **Failure Scenario:** Token usage hits 80%; system attempts to enable compression; code catches exception; compression never activates; execution may exhaust context
- **Evidence:**
  - hookConfigPath (`~/.claude/get-shit-done/bin/hooks/config`) doesn't exist
  - try-catch @ L99 silently ignores the failure
  - No compression module wired in
- **Fix:** Either (a) implement actual hook/compression system, or (b) remove dead code and rely on upstream API quota controls

**3. Model Routing Decisions Ignore Available Evidence (Line: gsd-task-router.md L32–85)**
- **Summary:** Router uses human judgment rubric instead of analyzing task metadata
- **Failure Scenario:** Router receives plan with 15 must_haves, no done criteria, complex dependencies; rubric is vague ("judge on merit"); two different runs produce different tier assignments for the same task
- **Evidence:**
  - routing-rules.md exists but is never consulted by router
  - Router has no access to: must_haves count, success_criteria, file modification count, task dependencies
  - Relies on one-sentence task description
- **Fix:** 
  - Pass plan metadata to router (must_haves_count, criteria_clarity_score, file_count)
  - Use deterministic scoring function that incorporates routing-rules.md patterns
  - Validate tier assignments post-hoc against actual outcomes

**4. Per-Task Routing Lacks Validation (Line: gsd-phase-coordinator.md L759–779)**
- **Summary:** Tasks with tier tags are assumed correct; no validation or fallback if tags are missing or wrong
- **Failure Scenario:** gsd-planner creates PLAN.md with some tasks tagged [haiku], others untagged; coordinator treats untagged tasks as needing plan-level routing, routes plan as single unit, spawns executor with wrong model
- **Evidence:**
  - gsd-planner receives no instruction on tier selection
  - Coordinator checks for tier tags (L759) but falls back to plan-level routing if sparse/missing
  - No warning or log if tags are partial
- **Fix:**
  - gsd-planner explicitly receives tier expectations (based on plan complexity analysis)
  - Coordinator validates all tasks have tier tags before PER_TASK_MODE = true
  - Log mismatch and route to sonnet (safe fallback) if validation fails

### MEDIUM SEVERITY

**5. parallel-executor.js is Dead Code (Line: parallel-executor.js L1–506)**
- **Summary:** Full parallel execution infrastructure defined but never instantiated
- **Failure Scenario:** User expects phases to execute in parallel per roadmap DAG; coordinator spawns executors sequentially; actual parallelization never happens
- **Evidence:**
  - gsd-phase-coordinator.md @ L705–900 (execute step): spawns executors one per plan, sequentially (L862–890)
  - No call to ParallelPhaseExecutor or executeParallelGroups()
  - gsd-tools.js imports parallel-executor but never calls any function
- **Fix:**
  - Either: (a) integrate ParallelPhaseExecutor into coordinator per roadmap DAG analysis, or (b) remove module and simplify
  - If keeping: ensure checkpoints, token reservation, and failure handling are tested

**6. Compression Claim (60–70% reduction) Unsupported (Line: task description "doc compression hooks")**
- **Summary:** Compression hooks mentioned as design feature; no implementation exists
- **Failure Scenario:** Large phases fail due to context exhaustion; user expects compression to mitigate; compression doesn't activate
- **Evidence:**
  - token-monitor.js attempts to load non-existent hook config (L89)
  - No actual compression algorithm integrated
  - No evidence of LLMlingua or similar in core execution flow
- **Fix:**
  - Implement doc compression (or integrate existing like LLMlingua)
  - Wire hook config properly with fallback if compression unavailable
  - Measure actual compression ratio and remove claim if <30%

**7. analytics.js and savings-report.js Have No Entry Points (Line: gsd-tools.js, not found)**
- **Summary:** Analytics and savings report generators defined but unreachable from CLI
- **Failure Scenario:** User wants analytics report; no `gsd-tools.js analytics` or `savings` command found (or not documented)
- **Evidence:**
  - Read gsd-tools.js up to L4200; no case for 'analytics' or 'savings'
  - analytics.js exported (generateReport, calibrate) but main never calls them
  - savings-report.js exported (calculateSavings, generateReport) but no caller
- **Fix:**
  - Add CLI commands: `gsd-tools.js analytics report` and `analytics calibrate`
  - Or remove modules if unwanted

### LOW SEVERITY

**8. Routing Rules Table (routing-rules.md) Unused (Line: routing-rules.md L5–107)**
- **Summary:** 97-line pattern table defined; task-router.md never references or uses it
- **Failure Scenario:** Maintainer updates routing rules; changes have no effect (rules not consulted)
- **Evidence:**
  - routing-rules.md exists with 30+ patterns (testing, architecture, debugging, etc.)
  - gsd-task-router.md uses qualitative rubric; no mention of routing-rules.md
  - Rules table has no callers
- **Fix:**
  - Either: (a) integrate rules into router (compile patterns to scoring function), or (b) deprecate routing-rules.md
  - If keeping: document that rules are reference/design only, not enforced

**9. calibrate() Function References Non-Existent Threshold (analytics.js L319)**
- **Summary:** calibrate() adjusts haiku_max_score config value; no code ever reads this value
- **Failure Scenario:** calibrate() proposes updating routing.haiku_max_score; change is written to config.json; routing decision code ignores it (threshold not used)
- **Evidence:**
  - analytics.js L319: `const currentThreshold = (config.routing && config.routing.haiku_max_score) || 0.35`
  - gsd-task-router.md has no reference to haiku_max_score or config thresholds
  - Router's default behavior is hard-coded rubric, not config-driven
- **Fix:**
  - Either: (a) use config thresholds in router (update rubric to check config), or (b) remove dead calibrate() code

**10. Execution Log Missing Actual Token Usage (Line: execution-log.js + gsd-phase-coordinator.md L795–797)**
- **Summary:** EXECUTION_LOG.md records routing decisions but not actual tokens spent; makes analytics incomplete
- **Failure Scenario:** Phase 3 uses haiku for 10 tasks; execution-log records "task_dispatch: haiku" × 10; no record of actual tokens consumed; analytics can't compute real cost
- **Evidence:**
  - execution-log event format (seen in coordinator logs): `{ type, phase, plan, task_name, tier, quota_pct }`
  - No `tokens_used_actual` field
  - savings-report.js L90: tries to read phaseUsage from token_budget.json, not EXECUTION_LOG.md
- **Fix:**
  - Extend execution log to record actual tokens from agent completions
  - Update savings-report.js to consume this data

---

## Improvement Candidates

### 1. Deterministic Task Routing Scoring (MEDIUM effort)
**Goal:** Replace heuristic rubric with evidence-based scoring function

**Steps:**
- Parse plan metadata: must_haves count, success_criteria count, file modifications, dependencies
- Create scoring function: base_score(requirements, criteria, files) → 0.0–1.0
- Map score to tier: 0.0–0.35 → haiku, 0.35–0.70 → sonnet, 0.70–1.0 → opus
- Validate post-hoc: compare tier recommendation against actual execution success
- Integrate routing-rules.md patterns as scoring multipliers (e.g., "if task is 'design database schema', add +0.3 to score")

**Owner:** gsd-task-router.md (rewrite rubric), gsd-tools.js (add scoring function)

**Validation:**
- Run on 10 recent plans; compare tier assignments against manual review
- Measure: haiku success rate, sonnet speedup, opus overkill rate
- Adjust weights to match target distribution (55/30/15)

---

### 2. Real Token Accounting (HIGH effort)
**Goal:** Capture actual token usage from agent spawns and update savings analytics

**Steps:**
1. Extend execution-log events with `tokens_input_actual`, `tokens_output_actual` from agent completion
2. Collect from Agent tool response headers (usage field if present)
3. Fallback: estimate from token-monitor if API doesn't report
4. Update savings-report.js to read actual usage from EXECUTION_LOG.md instead of token_budget.json
5. Publish monthly savings summary: "Phase 5: haiku saved $X vs Opus baseline"

**Owner:** gsd-executor (capture tokens at end), execution-log.js (store), savings-report.js (consume)

**Validation:**
- Compare reported savings against actual API bills (if available)
- Ensure no double-counting or data loss across phase boundaries

---

### 3. Parallel Phase Execution (MEDIUM effort)
**Goal:** Enable actual parallel execution of independent phases

**Steps:**
1. gsd-phase-coordinator already has dependency DAG analysis available (roadmap-parser.js)
2. Before execute step, identify parallel groups:
   ```
   parallelGroups = roadmap.parallelGroups // phases with no inter-dependencies
   ```
3. For each group, spawn executor agents concurrently using Promise.allSettled()
4. Integrate token budget checks: `canExecuteInParallel(phaseCount, tokenMonitor)` (already in parallel-executor.js)
5. Fallback to sequential if tokens insufficient
6. Log parallel execution and timing in execution-log

**Owner:** gsd-phase-coordinator.md (execute step), parallel-executor.js (reuse logic)

**Validation:**
- Measure phase completion time: sequential vs parallel (expected speedup = count of parallel phases)
- Verify no file conflicts or state corruption
- Test fallback to sequential on token exhaustion

---

### 4. Compression Hook Implementation (MEDIUM effort)
**Goal:** Actually implement token usage reduction via doc compression

**Steps:**
1. Choose compression strategy: LLMlingua (existing integration in /skills/), prompt compression, or response summarization
2. Implement actual compression module at ~/.claude/get-shit-done/bin/compression/
3. Wire into token-monitor._checkGraduatedAlerts(): instead of setting config flag, call compression.enable()
4. Measure: tokens before/after compression; store ratio in execution log
5. Document actual savings % (claim should be verified, e.g., "25–35% compression" not "60–70%")

**Owner:** New module: bin/compression/ (main), token-monitor.js (integration point)

**Validation:**
- Benchmark on sample phase: measure tokens without vs with compression
- Verify output quality doesn't degrade (spot-check completions)
- Add gauge metric: "compression_ratio_percent" to execution log

---

### 5. CLI Entry Points for Analytics (LOW effort)
**Goal:** Make analytics reports accessible

**Steps:**
1. Add gsd-tools.js command handlers:
   ```javascript
   case 'analytics':
     const subcommand = args[1];
     if (subcommand === 'report') {
       const { generateReport } = require('./analytics.js');
       const report = generateReport(cwd);
       output(report, raw, formatReport(report));
     } else if (subcommand === 'calibrate') {
       const { calibrate } = require('./analytics.js');
       const result = calibrate(cwd, { dryRun: args.includes('--dry-run') });
       // ...
     }
   ```
2. Document new commands in help text (L8–170 docstring)
3. Test: `node gsd-tools.js analytics report` generates report from .planning/EXECUTION_LOG.md

**Owner:** gsd-tools.js (command dispatch)

**Validation:**
- Run on live project; verify report accuracy

---

### 6. Remove or Complete Dead Code (LOW effort)
**Goal:** Clean up orphaned modules or complete their integration

**Options:**
- **Approach A (Remove):** Delete parallel-executor.js, phase-sizer.js, task-chunker.js (if coordination logic remains simple enough)
- **Approach B (Complete):** 
  - phase-sizer.js: integrate into gsd-planner to detect oversized plans before creation
  - task-chunker.js: integrate into gsd-executor to split large tasks mid-execution
  - parallel-executor.js: integrate into gsd-phase-coordinator as shown in Improvement #3

**Owner:** Depends on approach; likely gsd-phase-coordinator.md and individual agent modules

**Validation:**
- If removing: ensure no hidden dependencies
- If completing: measure execution time improvement (parallelization) or success rate improvement (chunking)

---

### 7. Config-Driven Routing Thresholds (LOW effort)
**Goal:** Make routing decisions configurable instead of hard-coded

**Steps:**
1. Define .planning/config.json routing section:
   ```json
   {
     "routing": {
       "haiku_max_score": 0.35,
       "sonnet_max_score": 0.70,
       "opus_min_score": 0.70
     }
   }
   ```
2. Pass config to gsd-task-router in prompt
3. Router uses config thresholds instead of hard-coded values
4. calibrate() function now has real effect (can be re-enabled)

**Owner:** gsd-tools.js (config loading), gsd-task-router.md (use in rubric)

**Validation:**
- Test: adjust thresholds, confirm tier assignments change accordingly
- Measure: do higher thresholds improve success rates?

---

## Open Questions

1. **How is token_budget.json actually populated in production?**
   - No automated token collection found
   - Is there a manual import step or external integration missing?
   - Does the actual GSD execution ever update this file?

2. **Is routing-rules.md actively maintained or purely aspirational?**
   - 97 lines of pattern rules with no callers
   - How often are new patterns added?
   - Should patterns be compiled into a deterministic scoring function?

3. **What is the intended behavior when per-task tier tags are missing?**
   - Fallback to plan-level routing is reasonable but unvalidated
   - Should planner always generate tier tags, or is sparse tagging acceptable?
   - Is there logging/warning when tags are partial?

4. **Why does ParallelPhaseExecutor exist if phases execute sequentially?**
   - Was parallel execution intended for a future phase?
   - Is there a roadmap to enable it?
   - Should it be removed or completed?

5. **What is the actual compression technology that should be implemented?**
   - Task description mentions 60–70% reduction but no algorithm specified
   - Is LLMlingua the intended approach?
   - What compression-actual ratio is acceptable?

6. **How do savings claims align with actual costs?**
   - If savings-report.js uses phantom data, how is the "40–60% savings" claim justified?
   - Is there a baseline measurement (e.g., all-Opus execution logged somewhere)?
   - Should the claim be removed until real data is available?

---

## Summary

**Token economy machinery exists but is largely non-functional:**

1. ✅ **Routing logic is defined** (routing-rules.md, gsd-task-router.md) but **uses heuristic judgment instead of evidence-based scoring**
2. ⚠️ **Quota monitoring is implemented** (TokenBudgetMonitor) but **token data is never collected**, making alerts ineffective
3. ⚠️ **Compression hooks are referenced** but **hook config doesn't exist**; no actual compression is applied
4. ✅ **Savings reporting is coded** but **depends on missing token data**; claims are unverifiable
5. ✅ **Per-task routing exists** but **tier tags lack validation**; partial tagging falls back unpredictably
6. ❌ **Parallel execution is designed** (parallel-executor.js) but **never called**; phases execute sequentially
7. ❌ **Large task chunking is designed** but **never integrated into coordinator**

**Root causes:**
- Design ahead of integration: modules built before wired into main flows
- Phantom data dependencies: savings/quota logic depend on token_budget.json that's never populated
- Dead ends: hooks/compression incomplete, parallel executor unused, analytics unreachable
- Heuristic routing: no scoring function, relies on LLM judgment which isn't validated

**Fixes (priority order):**
1. Real token accounting (high impact, high effort)
2. Deterministic routing scoring (medium impact, medium effort)
3. Parallel execution integration (medium impact, medium effort)
4. Compression implementation or removal (medium impact, medium effort)
5. CLI entry points for analytics (low impact, low effort)
6. Dead code cleanup (low impact, low effort)

---

*Analysis by Claude Code Audit — 2026-07-02*
