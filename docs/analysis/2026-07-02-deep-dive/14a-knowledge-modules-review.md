# GSD Knowledge-System Modules Deep Dive
**Date:** 2026-07-02  
**Scope:** 12 knowledge maintenance modules in `/get-shit-done/bin/`  
**Goal:** Audit PURPOSE, STATE, VALUE, and AUTO-WIRING for autonomous overnight roadmap execution

---

## Summary Table

| Module | Purpose (1-2 sentence) | State | Value | Verdict | Auto-Trigger |
|--------|---------|-------|-------|---------|---------------|
| **knowledge-lifecycle.js** | TTL-based cleanup, access tracking, staleness scoring | Complete/Working | **High** | Rework+wire | Every checkpoint; session-end |
| **knowledge-cost.js** | Budget tracking, graduated alerts (50/80/90/100%), circuit breaker | Complete/Working | **High** | Rework+wire | Before costly actions; knowledge.write() |
| **knowledge-permissions.js** | Grant/revoke/check patterns with limits (cost, count, scope) | Complete/Working | **Medium-High** | Rework+wire | Check in knowledge-safety flow |
| **knowledge-feedback.js** | Mark principles wrong/outdated, track confidence, replacement chain | Complete/Working | **Medium** | Rework+wire | Auto-trigger on verification failure |
| **knowledge-checkpoint.js** | Create semantic checkpoints, search, resume with resume-prompt | Complete/Working | **High** | Verify auto; likely already wired | End of each plan step |
| **knowledge-evolution.js** | Insert-or-evolve by similarity (dup 0.88, evolve 0.65-0.88, create <0.65) | Complete/Working | **Medium** | Keep automatic | On every knowledge.write() |
| **knowledge-conflicts.js** | Priority-based principle conflict resolution (safety>security>reliability) | Stubbed | **Low-Medium** | Rework+wire | Call in knowledge-principles.js |
| **knowledge-principles.js** | Check applicable principles for decisions, action classification | Partially stubbed | **Medium** | Rework+wire | Before every agent action |
| **knowledge-qa.js** | Interactive Q&A session to gather preferences and patterns | Complete/Working | **Low** | Rework+wire | Auto-run at project init / new-milestone |
| **knowledge-safety.js** | Classify actions (irreversible/external/costly), require approvals | Complete/Working | **High** | Rework+wire | Every action before execute() |
| **knowledge-scan.js** | Parse session logs, extract knowledge, scan assistant responses | Complete/Working | **Medium** | Rework+wire | Auto-run at session-end hook |
| **knowledge-synthesis.js** | Cluster knowledge, extract principles via similarity (KNOW-24 deferred) | Partially stubbed | **Low-Medium** | Rework+wire | Run daily or at complete-milestone |

---

## Detailed Module Analysis

### 1. knowledge-lifecycle.js

**PURPOSE**  
Implements TTL-based lifecycle management with automatic cleanup, access tracking, and staleness scoring. Prevents unbounded database growth through periodic expiration and pruning of stale entries.

**STATE**  
✅ **Complete and working.** All functions implemented:
- `cleanupExpired()` - removes expired entries from main + vec tables
- `trackAccess()` - increments access_count and last_accessed on retrieval
- `getStalenessScore()` - calculates staleness (0.0 fresh → 1.0 completely stale) using age, dormancy, type volatility, and access count
- `pruneStaleEntries()` - deletes entries above staleness threshold (default 0.7)
- `checkpointWAL()` - truncates WAL after large deletions

Staleness formula factors in:
- Dormancy (time since last access): high dormancy → high staleness
- Access count: frequent use → lower staleness (stays relevant)
- Type volatility: temp_notes (0.9) stale faster; lessons (0.1) stay relevant
- Age: normalized to 30-day scale

**VALUE for solo maintainer in autonomous mode**  
🟢 **HIGH.** Database unbounded growth is a silent killer of long-running systems. Without automatic cleanup:
- Vector table grows with every knowledge write (exponential if evolution happens)
- FTS5 table grows linearly
- Query performance degrades after weeks of continuous autonomous execution
- Overnight roadmap runs that span multiple phases will accumulate 1000s of entries

**AUTO-WIRING PROPOSAL**  
- **Trigger 1:** Every checkpoint completion → call `pruneStaleEntries(db, {threshold: 0.7, limit: 200, vectorEnabled: true})`
- **Trigger 2:** Session-end hook → cleanup expired + checkpoint WAL
- **Trigger 3:** On startup (already implemented in `knowledge-db.js` initialization)
- **Wiring:** Hook into `complete-milestone` workflow and session-end handler

**VERDICT**  
✅ **Rework+wire.** Already has startup cleanup; add explicit hooks for mid-execution pruning and session-end WAL checkpoint. Modify `knowledge.add()` to prune if DB exceeds 15MB.

---

### 2. knowledge-cost.js

**PURPOSE**  
Cost tracking and budget management. Provides:
- Daily/weekly budget limits
- Graduated alerts at 50%, 80%, 90%, 100%
- Circuit breaker to block costly/external actions at budget ceiling
- Cost estimation for actions (AWS ~$0.10, cloud resources ~$0.10, etc.)

**STATE**  
✅ **Complete and working.** All functions implemented:
- `getTotalCost(db, period)` - sums cost_tracking table for period
- `trackCost(db, {action, cost, metadata})` - inserts and checks alerts
- `checkBudgetAlerts(db, newCost)` - fires alerts per threshold, enables circuit breaker at 100%
- `hasAlertFired(db, threshold, periodStart)` - dedup alerts per period
- Circuit breaker state persistence in DB

Budget limits loaded from `.planning/knowledge/permissions-config.json` with defaults: daily $5, weekly $25.

**STATE ISSUE:** No secrets/PII filtering — this module doesn't filter sensitive data from stored knowledge. (See **knowledge-safety.js** for related issue.)

**VALUE for solo maintainer in autonomous mode**  
🟢 **HIGH.** Autonomous agents can rack up API costs in minutes without budget enforcement:
- LLM embeddings: 1000 knowledge entries × embeddings calls can cost $0.50–$2.00
- Extraction during long sessions can trigger 10+ synthesis cycles
- Network requests if knowledge-qa runs Q&A with external APIs
- Without circuit breaker: single overnight run can exceed week's budget unknowingly

**AUTO-WIRING PROPOSAL**  
- **Trigger 1:** Before any costly action (e.g., API call, cloud deploy) → `checkBudgetAlerts(db, estimatedCost)`
- **Trigger 2:** In `knowledge.write()` / `insertOrEvolve()` when generating embeddings → call `trackCost(db, {action: 'generate_embedding', cost: 0.001})`
- **Trigger 3:** At session-end → log total cost and alert if >70% of daily budget spent
- **Wiring:** Modify `knowledge-evolution.js` to call `trackCost()` after embedding generation. Add budget check in `knowledge-safety.js` before executing costly actions.

**VERDICT**  
✅ **Rework+wire.** Must be automatic; manual CLI commands nobody runs. Hook into knowledge.write() for embedding costs, and into safety checks for action-level costs.

---

### 3. knowledge-permissions.js

**PURPOSE**  
Permission grant/revoke/check infrastructure for bounded autonomous actions. Allows users to pre-approve specific action patterns with optional limits:
- `max_cost` - cap total cost for grant
- `max_count` - limit number of uses
- `path` - restrict to path pattern

Supports pattern matching (exact, wildcard suffix `:*`, glob-style `*`).

**STATE**  
✅ **Complete and working.** All functions implemented:
- `grantPermission(db, {action, scope, limits, ttl})` - creates revocable token
- `revokePermission(db, token)` - soft-delete via timestamp
- `checkPermission(db, action, context)` - tests against active grants using pattern + scope matching
- `recordPermissionUsage(db, grantId, action)` - tracks usage for limits
- `listActivePermissions(db)` - list all non-revoked grants

Supports scopes ('global', 'project', path-based `path:/test/*`).

**STATE ISSUE:** No automatic integration — checks exist but are only called manually from `knowledge-safety.js` when user explicitly calls `executeWithSafetyCheck()`. Not wired into general decision flow.

**VALUE for solo maintainer in autonomous mode**  
🟡 **MEDIUM-HIGH.** Great for pre-approving classes of actions, but only if actually integrated:
- User could grant: `git_push:main:*` with `{max_count: 5}` → agent can push up to 5 times per session
- User could grant: `delete_file:/temp/*` with no limits → agent can safely delete temp files
- Without integration: permissions table is unused, agent always asks for approval

**AUTO-WIRING PROPOSAL**  
- **Trigger 1:** In `knowledge-safety.js` `executeWithSafetyCheck()` → call `checkPermission()` BEFORE requiring approval
- **Trigger 2:** When permission check succeeds, record usage via `recordPermissionUsage()`
- **Wiring:** Modify line 160 in `knowledge-safety.js` to actually check permissions. Currently it tries but doesn't block if unavailable.

**VERDICT**  
✅ **Rework+wire.** Permission infrastructure is sound but not integrated. Hook into knowledge-safety.js as the primary authorization layer before falling back to user approval.

---

### 4. knowledge-feedback.js

**PURPOSE**  
Principle feedback and invalidation system. Implements:
- `markPrincipleWrong(db, id, {severity, reason})` - degrade confidence by severity (minor 0.2, major 0.5, critical 1.0)
- `markPrincipleOutdated(db, id, {replacement})` - soft-delete with 7-day expiration, link to replacement
- `createReplacementPrinciple(db, oldId, newContent)` - chain old→new
- Feedback history table for audit

Invalidation threshold: confidence < 0.3 → invalidated.

**STATE**  
✅ **Complete and working.** All functions implemented and tested. Feedback history table is created on first call. Confidence degradation is configurable per severity.

**STATE ISSUE:** No automatic triggers — feedback is only recorded when user manually calls `gsd-tools.js mark-wrong <id>`. No integration with verification flow.

**VALUE for solo maintainer in autonomous mode**  
🟡 **MEDIUM.** Feedback learning is valuable IF auto-triggered, but entirely optional:
- When a verifier finds a principle led to a bug, auto-mark it wrong
- When a principle becomes outdated mid-execution, auto-mark outdated
- Prevents repeating same mistakes
- Without auto-trigger: useful only if user remembers to manually mark wrong after discovering failures

**AUTO-WIRING PROPOSAL**  
- **Trigger 1:** In `gsd-verifier` / `gsd-executor` when a principle is contradicted by reality → auto-call `markPrincipleWrong(db, id, {severity: 'major', reason: 'Contradicted by execution'})`
- **Trigger 2:** At end of failed plan step with principle guiding the step → call `markPrincipleWrong()` with step failure reason
- **Trigger 3:** Periodically (weekly?) find lowest-confidence principles and flag for review
- **Wiring:** Add callback in executor error handlers to log principle invalidation. Add to phase completion verification flow.

**VERDICT**  
✅ **Rework+wire.** Auto-trigger on verification failures and execution errors. Currently useful only for manual after-action analysis.

---

### 5. knowledge-checkpoint.js

**PURPOSE**  
Checkpoint storage with semantic search for pause/resume capability. Enables:
- Store execution state (task, plan, progress, decisions, context)
- Search checkpoints by semantic query
- Resume from latest checkpoint with formatted prompt
- Clean up old/completed checkpoints

Checkpoints stored in knowledge table as type='checkpoint', ephemeral TTL (24h).

**STATE**  
✅ **Complete and working.** All functions implemented:
- `createCheckpoint(checkpoint)` - validates, generates semantic context, embeds, inserts
- `searchCheckpoints(query, {phase, limit})` - semantic search with filtering
- `getLatestCheckpoint(phase, planId)` - most recent checkpoint for phase
- `buildResumePrompt(checkpoint)` - formatted prompt for resumption
- Auto-prune DB if >10MB on checkpoint creation

Auto-prune on creation is clever—prevents DB bloat during long runs.

**STATE QUESTION:** Need to verify if checkpoints are automatically created at end of each plan step. Searching gsd-tools.js shows `checkpoint create` is a manual CLI command. Check if executor automatically calls it.

**VALUE for solo maintainer in autonomous mode**  
🟢 **HIGH.** Critical for resuming interrupted work:
- If agent is killed mid-phase → resume prompt shows exactly where to continue
- Prevents repeating completed steps
- Semantic search allows finding checkpoints by task description (e.g., "database setup")
- Auto-prune prevents DB bloat on long multi-day runs

**AUTO-WIRING PROPOSAL**  
- **Verify:** Check if `gsd-executor.js` automatically calls `createCheckpoint()` at end of each task
- **If not:** Add automatic checkpoint creation in executor after each step completes
- **Trigger:** End of every plan step → auto-save checkpoint with current progress
- **Wiring:** Modify executor to call checkpoint.createCheckpoint() in step completion handler

**VERDICT**  
✅ **Verify auto; likely already wired.** Read gsd-executor.js to confirm. If not automatic, add it. Checkpoint system is ready; just needs automation verification.

---

### 6. knowledge-evolution.js

**PURPOSE**  
Insert-or-evolve strategy based on similarity:
- Similarity **> 0.88**: Skip (exact duplicate)
- Similarity **0.65–0.88**: Evolve (append new content with timestamp, track evolution count)
- Similarity **< 0.65**: Create new entry

Uses per-process write serializer to prevent concurrent check→write races.

**STATE**  
✅ **Complete and working.** All functions implemented:
- `insertOrEvolve(conn, entry)` - dispatches to appropriate action
- `mergeMemories(existing, newContent)` - appends with timestamp, tracks evolution_count and history
- `processExtractionBatch(conn, extractions)` - batch processing with embedding generation
- Serialized write queue prevents races

Evolve-or-create decision is well-researched (thresholds from 0.88/0.65 are empirical).

**STATE ISSUE:** Embedding not updated on evolution (note in code: "Embedding update not supported in sqlite-vec 0.1.6"). This means evolved entries keep original embedding—acceptable trade-off.

**VALUE for solo maintainer in autonomous mode**  
🟡 **MEDIUM.** Consolidates similar knowledge over time, prevents table bloat from near-duplicates:
- Without evolution: 100 similar lessons from different phases → 100 entries
- With evolution: 100 lessons merge into 1–3 evolved entries with history
- Reduces clutter, speeds search

**AUTO-WIRING PROPOSAL**  
- **Status:** Likely already called automatically in `knowledge.add()` flow
- **Verify:** Check `knowledge.js` main API for whether it calls `insertOrEvolve()` or just inserts
- **If not automatic:** Wire into all knowledge writers (scan, extraction, qa, synthesis)

**VERDICT**  
✅ **Keep automatic (verify).** Evolution is already core to knowledge ingestion. Just confirm knowledge.js calls it, don't change flow.

---

### 7. knowledge-conflicts.js

**PURPOSE**  
Priority-based principle conflict resolution. When multiple principles apply to a decision, score each by:
- Category priority weight (safety 1.0, security 0.9, reliability 0.85, speed 0.6, cost 0.5, convenience 0.3)
- Confidence (from principle metadata)
- Formula: `score = confidence × priority`

Detects ambiguous conflicts (top two scores within 20%) and escalates to user.

**STATE**  
❌ **Stubbed.** Functions exist but are NOT called:
- `resolvePrincipleConflict(principles, context)` - takes list, returns scored winner or "ambiguous"
- `loadUserPriorities()` - loads from config
- `validatePriorities()` - checks for invalid weights
- `isAllowlisted(action)` - checks pre-approved actions

However: **Never invoked from anywhere in the codebase.** `knowledge-principles.js` has no integration.

**STATE ISSUE:** Great design, zero adoption. Conflicts are not actually resolved—if multiple principles apply, the code just picks the first one (see `checkPrinciples()` in knowledge-principles.js line 114).

**VALUE for solo maintainer in autonomous mode**  
🟡 **LOW-MEDIUM.** Excellent for safety-critical decisions (e.g., "safety principle says abort, but speed principle says continue → safety wins"). But currently unused.

**AUTO-WIRING PROPOSAL**  
- **Trigger:** In `knowledge-principles.js` `makeDecision()` or `checkPrinciples()` when >1 principle is returned
- **Wiring:** Modify `checkPrinciples()` to call `resolvePrincipleConflict()` if multiple principles apply
- **Change:** Replace "pick first principle" (line 114) with conflict resolution
- **Integration:** Feed chosen principle to decision logic

**VERDICT**  
✅ **Rework+wire.** Conflict resolution is architecturally sound but disconnected. Wire into `knowledge-principles.js` as the decision tiebreaker when multiple principles apply.

---

### 8. knowledge-principles.js

**PURPOSE**  
Principle-guided autonomous decisions:
- `checkPrinciples(context)` - semantic search for applicable principles
- `classifyAction(action)` - category (reversible/irreversible/external/costly)
- `canActAutonomously(action, context)` - check if action is safe or principle-guided
- `makeDecision(action, context)` - full decision flow with autonomy + principle check

ACTION_TYPES classify ~30 keywords for safety (e.g., `delete_*`, `send_email`, `api_call`).

**STATE**  
⚠️ **Partially stubbed.** Functions exist but:
- `checkPrinciples()` works (searches knowledge DB)
- `canActAutonomously()` works (classifies + checks principles)
- `makeDecision()` exists but is only a wrapper; doesn't actually integrate with execution flow
- No feedback loop to apply principle outcomes back (see `applyPrinciple()` line 134 — just tracks usage, doesn't update confidence)

**STATE ISSUE:** Principles are checked but never influence actual execution. Executor doesn't call `makeDecision()` before acting.

**VALUE for solo maintainer in autonomous mode**  
🟡 **MEDIUM.** When working correctly, principles guide decisions without human approval. But currently:
- Principles are stored but not consulted
- Executor ignores returned decision
- No feedback to strengthen/weaken principles

**AUTO-WIRING PROPOSAL**  
- **Trigger 1:** Before executor acts on any non-reversible action → call `makeDecision(action, context)`
- **Trigger 2:** If decision.autonomous = false → escalate to user
- **Trigger 3:** If decision.autonomous = true → continue (principle-guided)
- **Trigger 4:** At action completion → call `applyPrinciple()` to record outcome
- **Integration:** Modify executor to call `makeDecision()` in pre-execution hook
- **Conflict:** When >1 principle applies, call `resolvePrincipleConflict()` (from knowledge-conflicts.js) instead of picking first
- **Enhancement:** Update `applyPrinciple()` to actually adjust principle confidence based on outcome (success → +confidence, failure → apply feedback.js)

**VERDICT**  
✅ **Rework+wire.** Principles exist but executor doesn't use them. Wire into executor's decision flow. Integrate conflict resolution (knowledge-conflicts.js). Add feedback loop to adjust principle confidence on outcome.

---

### 9. knowledge-qa.js

**PURPOSE**  
Interactive Q&A session to gather user preferences and workflow patterns. Generates ~5 questions per session across categories:
- preferences: testing strategy, error handling, commit style, naming conventions
- architecture: database connections, shared utilities, logging, config handling
- workflow: pre-push practices, patterns to avoid, documentation style, breaking changes

Stores answers as lesson-type knowledge entries.

**STATE**  
✅ **Complete and working.** All functions implemented:
- `analyzeKnowledgeGaps()` - count lessons/decisions to identify missing topics
- `generateQuestions()` - select from templates based on gaps
- `processAnswer(question, answer)` - store as lesson via `insertOrEvolve()`
- `runQASession({askUser, onComplete})` - interactive prompt loop

Requires callback `askUser(question)` to get user input.

**STATE ISSUE:** Manual only. Exposed via `gsd-tools.js` CLI but no automatic invocation. Nobody runs CLI sessions during autonomous work.

**VALUE for solo maintainer in autonomous mode**  
🔴 **LOW.** Great for onboarding but not for overnight execution:
- Once user answers Q&A once at project init → no need to repeat
- Useful to run again if project style changes (rare)
- Blocking interactive prompts during autonomous runs would kill parallelization

**AUTO-WIRING PROPOSAL**  
- **Trigger 1:** At `new-project` time → auto-run Q&A session to gather initial preferences (before first roadmap)
- **Trigger 2:** At `new-milestone` time → offer (non-blocking) to re-run if project scope changed
- **NOT:** During autonomous phase execution (would block)
- **Integration:** Hook into `gsd-project-researcher` or workflow orchestrator at project init

**VERDICT**  
✅ **Rework+wire.** Move from "manual CLI nobody runs" to "automatic at project initialization". Still non-blocking for autonomous phases.

---

### 10. knowledge-safety.js

**PURPOSE**  
Safety checks before execution. For every action:
1. Classify: reversible / irreversible / external / costly
2. If reversible: auto-proceed
3. If not: check permissions, estimate cost, require user approval or permission grant
4. Provide formatted prompts ("This action will delete files. Approve? [y/N]")

No execution gates—just checks and prompts. Approval logic is caller's responsibility.

**STATE**  
✅ **Complete and working.** All functions implemented:
- `shouldStopAndAsk(action, context)` - classify + decide if needs approval
- `estimateActionCost(action, context)` - rough cost estimate (AWS $0.10, openai $0.05, etc.)
- `executeWithSafetyCheck(action, context, options)` - full check flow with permission lookup
- Action classification covers 30+ keywords

**STATE ISSUE 1:** No secrets/PII filtering. Function decides if action needs approval, but doesn't filter sensitive data from knowledge that might leak in prompts. (Cross-cutting concern: should be in knowledge.add() or knowledge-scan.js, not here.)

**STATE ISSUE 2:** Not called automatically. Executor would need to call `executeWithSafetyCheck()` before every action, but there's no indication it does.

**VALUE for solo maintainer in autonomous mode**  
🟢 **HIGH.** Critical safety layer:
- Prevents accidental destructive actions (delete with no confirmation)
- Blocks expensive cloud operations without approval
- Stops external communications (Slack, email) without user sign-off
- With permissions integration: can pre-approve safe action classes

**AUTO-WIRING PROPOSAL**  
- **Trigger:** Every action before execution → call `executeWithSafetyCheck()`
- **Integration:** Modify executor to wrap all actions (git, file ops, API calls, etc.) with safety check
- **Permission flow:** Integrate with knowledge-permissions.js — check permissions BEFORE requiring user approval
- **Cost flow:** Integrate with knowledge-cost.js — estimate cost and check circuit breaker
- **Secret filtering:** Add PII/secret detection (regex patterns: API keys, passwords, email) before logging/prompting
- **Escalation:** If check returns `requires_approval: true`, escalate to user (or automated decision system)

**VERDICT**  
✅ **Rework+wire.** Safety check infrastructure is solid but not integrated. Wire into executor as a pre-action gate. Add missing secret/PII filtering. Integrate with permissions and cost modules.

---

### 11. knowledge-scan.js

**PURPOSE**  
Parse session logs and extract knowledge patterns:
- `scanSession(content)` - extract knowledge from assistant responses
- `scanSessionLogs(logPaths)` - batch scan files
- `extractPatternsFromHistory(history)` - scan conversation history
- `findSessionLogs(path)` - locate .claude/sessions/*.jsonl, .planning/sessions/*.jsonl, etc.

Uses `knowledge-extraction.js` to identify patterns (decisions, lessons, assumptions).

**STATE**  
✅ **Complete and working.** All functions implemented:
- JSONL parsing robust (skips invalid entries)
- Batch processing with error handling
- Returns stats: raw, filtered, deduplicated, created/evolved/skipped

Integration chain: session logs → parse → extract patterns → processExtractionBatch() → insertOrEvolve()

**STATE ISSUE:** Manual only. Exposed via CLI but not called automatically. Conversations happen, valuable knowledge sits in transcript, never extracted.

**VALUE for solo maintainer in autonomous mode**  
🟡 **MEDIUM.** Automatic knowledge extraction is powerful:
- Dozens of conversations over weeks generate hundreds of micro-lessons
- Without extraction: knowledge is inaccessible (buried in transcripts)
- With extraction: becomes part of knowledge DB, influences future decisions
- Multiplier effect: early sessions inform later sessions

**AUTO-WIRING PROPOSAL**  
- **Trigger:** At session-end hook → auto-call `scanSession()` on transcript
- **Timing:** After conversation closed, before process exit
- **Scope:** Extract to 'project' scope (session-specific) or 'global' (patterns useful across projects)
- **Integration:** Add to Claude Code session-end hook (if exists) or executor shutdown handler
- **Filtering:** Only extract high-confidence patterns (decisions, lessons with confidence > 0.6)

**VERDICT**  
✅ **Rework+wire.** Knowledge extraction is architecturally clean. Move from "manual CLI" to "automatic at session-end". Add confidence filtering to reduce noise.

---

### 12. knowledge-synthesis.js

**PURPOSE**  
Cluster knowledge entries and extract higher-level principles. Deferred feature (KNOW-24) for consolidating lessons into actionable rules:
1. Cluster similar knowledge by embedding similarity (threshold 0.6)
2. Extract principle from cluster (consensus across examples)
3. Store as type='principle' with confidence based on cluster cohesion

**STATE**  
⚠️ **Partially stubbed.** Functions exist but:
- `clusterKnowledge(conn)` - similarity-based clustering WORKS
- `extractPrinciple(cluster)` - confidence calculation WORKS
- `synthesizePrinciples(conn)` - orchestration WORKS
- **BUT:** `generatePrincipleText()` is simplified (line 60): just extracts first 10 words from first cluster member
  - Designed for LLM call but uses fallback (hardcoded text generation)
  - Real synthesis would call Claude to write principle rule

**STATE ISSUE:** Clustering works perfectly. Principle text is stubbed. Needs LLM call to actually synthesize readable principles.

**CONFIG:**
- `min_cluster_size: 5` - minimum examples to form principle
- `confidence_threshold: 0.7` - minimum confidence for stored principle
- `similarity_threshold: 0.6` - cluster similarity cutoff
- `max_principles: 20` - per synthesis run

**VALUE for solo maintainer in autonomous mode**  
🟡 **LOW-MEDIUM.** Principle synthesis is aspirational:
- Without synthesis: knowledge DB grows to 1000s of entries, no pattern abstraction
- With synthesis: 1000 lessons → 10–20 principles, executable patterns
- Prevents decision paralysis ("100 similar lessons say different things")
- BUT: Needs LLM call to write principles; stubbed implementation is incomplete

**AUTO-WIRING PROPOSAL**  
- **Trigger 1:** At `complete-milestone` time → run full synthesis over all project knowledge
- **Trigger 2:** Daily (e.g., via cron at 2am) → incremental synthesis of new entries
- **Trigger 3:** Manual command with `--force` flag
- **Integration:** Modify `generatePrincipleText()` to call Claude API:
  ```javascript
  const { client } = require('./knowledge-db.js');
  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Synthesize a single actionable principle from these examples:\n${examples.join('\n')}`
    }]
  });
  return response.content[0].text;
  ```
- **Wiring:** Hook into complete-milestone workflow + optional daily cron job

**VERDICT**  
✅ **Rework+wire.** Clustering architecture is sound. Replace stubbed `generatePrincipleText()` with LLM call. Wire into complete-milestone and optional daily synthesis. Start with weekly synthesis (less API cost than daily).

---

## Summary of Automation Opportunities

### Immediate Priority (HIGH value, Low complexity)
1. **knowledge-lifecycle.js**: Add automatic pruning triggers → prevents DB bloat
2. **knowledge-cost.js**: Auto-track embedding costs in knowledge.write() → enforce budgets automatically
3. **knowledge-safety.js**: Wrap all executor actions with safety checks → enable permissions-based autonomy

### Medium Priority (MEDIUM value, Medium complexity)
4. **knowledge-checkpoint.js**: Verify/enable automatic creation at step end → support resumption
5. **knowledge-feedback.js**: Auto-trigger on verification failures → learn from mistakes
6. **knowledge-principles.js**: Wire into executor decision flow → principle-guided actions
7. **knowledge-conflicts.js**: Integrate as tiebreaker when >1 principle applies → intelligent conflict resolution
8. **knowledge-scan.js**: Auto-run at session-end → extract knowledge without manual intervention

### Lower Priority (LOW value or high complexity)
9. **knowledge-qa.js**: Auto-run at project init → gathering preferences once, not during execution
10. **knowledge-synthesis.js**: Add LLM call + weekly synthesis → consolidate knowledge into principles (needs API cost approval)
11. **knowledge-evolution.js**: Verify already automatic → likely already working

### Missing/Cross-cutting
- **Secret/PII filtering**: NOT implemented in any module. Should add regex-based filtering in knowledge-scan.js and knowledge-safety.js prompts before logging.
- **Principle confidence adjustment**: knowledge-feedback.js marks wrong, but never feeds back to principle confidence dynamically.

---

## Recommended Execution Plan

### Phase 1: Foundation (Session-end hooks)
1. Enable knowledge-lifecycle.js pruning at session-end + checkpoint WAL
2. Enable knowledge-scan.js extraction at session-end
3. Add secret/PII filtering to knowledge-scan.js

### Phase 2: Safety & Budgets (Execution time)
4. Integrate knowledge-safety.js checks into executor pre-action hook
5. Integrate knowledge-cost.js budget tracking into knowledge.write() flow
6. Integrate knowledge-permissions.js as authorization layer in safety checks

### Phase 3: Learning Loop (Decision flow)
7. Wire knowledge-principles.js into executor decision path
8. Integrate knowledge-conflicts.js for multi-principle scenarios
9. Wire knowledge-feedback.js into executor error handlers

### Phase 4: Consolidation (Periodic)
10. Add LLM call to knowledge-synthesis.js
11. Schedule weekly synthesis runs
12. Enable knowledge-qa.js at project init only

---

## Verdict Tally

| Rework+wire | Keep auto | Verify auto | Delete |
|-----------|-----------|-----------|--------|
| 9 modules | 1 module | 1 module | 0 modules |
| lifecycle, cost, permissions, feedback, principles, conflicts, qa, safety, synthesis | evolution | checkpoint | — |

**Total:** 12/12 modules have actionable paths to automatic integration. None are candidates for deletion.
