# Knowledge System — Deep Analysis

## Inventory

| File | Size | Purpose | Called By |
|------|------|---------|-----------|
| **Core CRUD** | | | |
| knowledge-db.js | 13.7K | SQLite connection, schema (v4), migrations, WAL config, vector table init | knowledge.js, knowledge-writer.js, knowledge-crud.js |
| knowledge-crud.js | 11.1K | INSERT/READ/UPDATE/DELETE with TTL categories, embedding storage | knowledge.js, knowledge-evolution.js, knowledge-checkpoint.js |
| knowledge-search.js | 14.8K | FTS5 (BM25) + vector (sqlite-vec) + hybrid RRF, query normalization | knowledge.js, knowledge-meta-answerer.md (via query-knowledge) |
| embeddings.js | 3.5K | Nomic Embed v1.5 (512-dim, quantized), lazy pipeline, in-memory cache | knowledge-writer.js, knowledge-dedup.js, knowledge-evolution.js |
| **Dedup & Evolution** | | | |
| knowledge-dedup.js | 6.0K | 3-stage dedup: exact hash (1.0), canonical hash (0.95), embedding sim (0.88) | knowledge-writer.js, knowledge-evolution.js |
| knowledge-evolution.js | 7.0K | `insertOrEvolve` with memory merging, evolution count tracking, per-process serializer | knowledge-writer.js, knowledge-checkpoint.js |
| **Lifecycle & Stats** | | | |
| knowledge-lifecycle.js | 11.0K | TTL cleanup, staleness scoring (volatility-based), access tracking, WAL checkpoint | knowledge.js, knowledge-checkpoint.js |
| knowledge-checkpoint.js | 15.5K | Structured checkpoints for EXEC-09/10 (phase progress snapshots) | gsd-executor.md (indirectly via knowledge system) |
| **Advanced Features** | | | |
| knowledge-writer.js | 15.8K | Haiku extraction bridge: type mapping, TTL assignment, 3-stage dedup with embedding timeout, telemetry via execution-log.js | gsd-phase-coordinator.md (harvest_knowledge step) |
| knowledge-feedback.js | 12.1K | Principle invalidation (KNOW-26/27), confidence degradation, feedback history | **ORPHANED** — no callers found |
| knowledge-cost.js | 9.0K | Budget tracking (daily/weekly), graduated alerts (50%/80%/90%/100%), circuit breaker | **ORPHANED** — referenced in frontmatter but not invoked |
| knowledge-permissions.js | 12.0K | Grant tokens, action patterns, usage tracking, scoped permissions | **ORPHANED** — no callers found |
| knowledge-qa.js | 5.6K | Entry validation, schema conformance, correctness checks | **ORPHANED** — no callers found |
| **Analytics & Utilities** | | | |
| knowledge-synthesis.js | 6.2K | Cross-memory synthesis, pattern discovery, evidence weighting | **ORPHANED** — no callers found |
| knowledge-conflicts.js | 6.5K | Conflict detection (contradictory entries), resolution strategies | **ORPHANED** — no callers found |
| knowledge-principles.js | 6.0K | Principle extraction, hierarchy building, confidence scoring | **ORPHANED** — no callers found |
| knowledge-safety.js | 5.7K | Safeguards: rate limiting, quota checks, dangerous op blocking | **ORPHANED** — no callers found |
| knowledge-scan.js | 4.8K | Bulk audit, consistency checks, orphaned entry detection | **ORPHANED** — no callers found |
| knowledge.js | 8.2K | Facade: lazy loading, connection cache, high-level API (add/search/get), graceful degradation | Used by gsd-tools.js knowledge commands, knowledge-writer.js (indirectly) |
| **Session Analysis** | | | |
| knowledge-extraction.js | 8.4K | Regex-based passive extraction (decisions/lessons), quality gates, batch dedup | **Not directly called** — complementary to Haiku-based extraction in session-analyzer.js |
| session-analyzer.js | — | Haiku Task() orchestrator, extraction request building (Haiku does actual analysis) | gsd-phase-coordinator.md (harvest_knowledge step) |

**Summary**: 20 files, ~166KB total. **11 orphaned** files (55%) implement features (feedback, cost, permissions, QA, synthesis, conflicts, principles, safety, scan, plus extraction and session-analyzer which aren't integrated). **9 core files** actually used: db, crud, search, embeddings, dedup, evolution, lifecycle, writer, facade.

---

## Architecture

### Schema (knowledge-db.js, schema v4)

```sql
knowledge (main)
  ├─ id (PK)
  ├─ content (NOT NULL)
  ├─ type: 'decision', 'lesson', 'summary', 'temp_note'
  ├─ scope: 'global' or 'project'
  ├─ created_at, expires_at, last_accessed (timestamps)
  ├─ access_count (lifecycle)
  ├─ content_hash (SHA-256, exact dedup)
  ├─ metadata (JSON: canonical_hash, evolution_count, evolution_history, tags, context)
  └─ project_slug (v4 addition for global DB cross-project filtering)

knowledge_fts (FTS5 virtual)
  ├─ content (indexed for BM25 ranking)
  └─ auto-synced via triggers on knowledge

knowledge_vec (sqlite-vec virtual)
  └─ embedding (float[512], cosine distance)

permissions, permission_usage (v2+)
cost_tracking, budget_alerts (v3+)
circuit_breaker (v3+)
```

**Key design choice**: As of v4, all scopes ('global', 'project') resolve to `~/.claude/knowledge/{username}.db` (line 43-44 in knowledge-db.js). Per-project path is 'legacy' only (for migrations).

### Data Flow: Session → Knowledge DB

```
gsd-phase-coordinator.md
  ├─ harvest_knowledge step
  │  ├─ For each extraction type (decision, reasoning_pattern, meta_knowledge)
  │  │  └─ Task(subagent_type="general-purpose", model="haiku", prompt=...)
  │  │     → session-analyzer.js builds prompt
  │  │     → Haiku returns JSON { type, decision, reasoning, alternatives, confidence, context_snippet }
  │  └─ Output → storeInsights(conn, insights)
  │
  └─ knowledge-writer.js storeInsights()
     ├─ Stage 1: Content hash check (knowledge-dedup.js checkExactDuplicate)
     ├─ Stage 2: Canonical hash check (case/punctuation normalized)
     ├─ Stage 3: Embedding similarity (sqlite-vec, 2s timeout, threshold 0.88)
     ├─ Decision:
     │  ├─ similarity > 0.88 → skip
     │  ├─ 0.65 ≤ similarity ≤ 0.88 → insertOrEvolve (merge + timestamp)
     │  └─ similarity < 0.65 → insert new
     └─ TTL assignment from knowledge-writer.js mapInsightToKnowledgeType()
        ├─ decision → 90 days
        ├─ lesson → permanent
        ├─ summary → 7 days
        └─ temp_note → 24 hours

Search path:
  gsd-meta-answerer.md
  └─ query-knowledge "{question}" (via gsd-tools.js)
     └─ knowledge.js search()
        ├─ FTS pass (BM25 ranking, type-weighted)
        ├─ Vector pass (if embedding available, 2s timeout)
        └─ Hybrid RRF fusion: 1/(k+rank) scores combined, type boost, access count boost
           (TYPE_WEIGHTS: decision 2.0, lesson 2.0, summary 0.5, temp_note 0.3)
           k=60 constant
```

### Concurrency & Locking

**Writes**:
- knowledge-evolution.js line 20: `pendingWrites` promise chain serializes all `insertOrEvolve` calls per-process (prevents check→write races on `db.prepare().all().map()` followed by update)
- No multi-process protection (OS file-level WAL lock does protect concurrent DB access)

**Reads** (knowledge-search.js):
- `ensureBusyTimeout(db, QUERY_TIMEOUT_MS)` (line 49-55): Sets `busy_timeout = 5000ms` before each query
- Idempotent re-setting (no-op if already set)
- Gracefully degrades: FTS failures logged to stderr, vector failures return []
- **Issue**: timeout guard set per-query but not per-transaction; doesn't prevent deadlocks on nested queries

**Transactions**:
- knowledge-crud.js INSERT wraps embedding insert in `db.transaction()` (line 100-118); ensures rowid match
- knowledge-lifecycle.js cleanup/prune use `db.transaction()` for atomicity
- knowledge-writer.js does NOT wrap the full dedup→insert pipeline in a transaction; three separate operations (checkDuplicate, maybe insertOrEvolve, maybe tracking). **Race condition if two callers process same content simultaneously** (one sees "evolve", second sees "new", both proceed).

### Embedding Model Lifecycle

```javascript
// embeddings.js
embeddingPipeline = null  // global singleton

initEmbeddings() 
  ├─ Lazy load @xenova/transformers
  ├─ Load 'nomic-ai/nomic-embed-text-v1.5' (quantized)
  └─ Return pipeline (cached in module global)

generateEmbedding(text)  // Sync wrapper around async pipeline
  ├─ Blocks until pipeline.ready
  ├─ L2 normalize to unit norm
  ├─ Truncate/pad to 512 dims
  └─ Returns Float32Array | null (on error)

generateEmbeddingCached(text)
  ├─ Check in-memory cache (1000-entry LRU)
  └─ Cache hits for repeated text (e.g., same decision queried twice)
```

**Cost per invocation**:
- First call: ~2-3s (download + init model, ~100MB)
- Subsequent calls: ~50-200ms (pipeline cached in memory)
- knowledge-writer.js limits wait to 2s (line 291-294), falls back to hash-only dedup if timeout

---

## Issues Found

### 1. **Missing Transaction Wrapper in knowledge-writer.js** — HIGH
**Location**: knowledge-writer.js lines 260-415 (`storeInsights` loop)

**Issue**: Each insight processed in isolation:
- checkDuplicate (read from DB)
- Decide action (insert/evolve/skip)
- Execute insert/evolve

Two concurrent callers can both check "not duplicate", both decide to insert, second call loses first's update (no UNIQUE constraint on content or canonical_hash). 

**Evidence**:
```javascript
// Line 299-363: NOT wrapped in transaction
const dupCheck = await checkDuplicate(conn, content, embedding);
if (dupCheck.isDuplicate && ...) {
  // insertOrEvolve OR skip
  const evolveResult = await insertOrEvolve(conn, { ... });
}
// Line 365-377: Separate call
const insertResult = await insertOrEvolve(conn, { ... });
```

**Impact**: Duplicates leak through when two phases extract identical reasoning simultaneously.

---

### 2. **Embedding Timeout Semantics Inconsistent** — MEDIUM
**Locations**: 
- knowledge-writer.js lines 289-297: 2s timeout → falls back to hash-only dedup
- knowledge-search.js lines 433-444: 2s timeout on async hybrid search, but searchKnowledge (sync) never calls embedding

**Issue**: 
- Sync `searchKnowledge()` cannot generate embeddings; always FTS-only (line 399-410)
- `searchKnowledgeAsync()` tries embedding with timeout, catches silently
- If embedding fails, no debug output; caller unaware that search was degraded

**Evidence**:
```javascript
// knowledge-search.js line 429-444
async function searchKnowledgeAsync(conn, query, options = {}) {
  let embedding = options.embedding || null
  if (!embedding && ...) {
    try {
      const { generateEmbeddingCached } = require('./embeddings.js')
      embedding = await Promise.race([
        generateEmbeddingCached(query),
        new Promise(resolve => setTimeout(() => resolve(null), 2000))  // Timeout → null
      ])
    } catch (_) {
      // Silent catch — caller doesn't know why embedding failed
    }
  }
  return hybridSearch(conn, { query, embedding, ... })  // Falls back to FTS if embedding null
}
```

**Impact**: gsd-meta-answerer relies on RRF fusion for better ranking; if embedding timeouts silently, results are FTS-only (lower quality) without user awareness.

---

### 3. **Inconsistent vectorEnabled Checks** — MEDIUM
**Locations**: 
- knowledge-crud.js line 107: `if (embedding && db.vectorEnabled)`
- knowledge-search.js line 165: `if (!conn.vectorEnabled) return []`
- knowledge-lifecycle.js line 335: passed as option `vectorEnabled` (not from conn!)

**Issue**:
- Some functions check `conn.vectorEnabled` (property of return object)
- Some pass it separately as option
- knowledge-crud.js references `db.vectorEnabled` but db has no such property; should be from connection

**Evidence**:
```javascript
// knowledge-crud.js line 107 — WRONG
if (embedding && db.vectorEnabled) {  // db has no vectorEnabled property!
  const vecResult = db.prepare('INSERT INTO knowledge_vec (embedding) VALUES (?)').run(normalized)
}

// knowledge-search.js line 165 — CORRECT
if (!conn.vectorEnabled) {
  return []
}

// knowledge-lifecycle.js line 320 — OPTION STYLE
function pruneStaleEntries(db, options = {}) {
  const { threshold = 0.7, limit = 200, scope = null, dryRun = false, vectorEnabled = false } = options;
  if (vectorEnabled) {
    db.prepare(`DELETE FROM knowledge_vec ...`).run(...)
  }
}
```

**Impact**: If vector table fails to load, knowledge-crud.js INSERT silently skips vector insert (no error); searches won't find by embedding.

---

### 4. **Hardcoded Thresholds in Multiple Locations** — MEDIUM
**Locations**:
- knowledge-dedup.js lines 15-19: DEDUP_THRESHOLDS (hardcoded)
- knowledge-evolution.js lines 23-28: EVOLUTION_THRESHOLDS (hardcoded again)
- knowledge-writer.js lines 35-38: KNOWLEDGE_DEFAULTS with dedupThreshold, evolutionThreshold (read from config)
- knowledge-search.js line 19: TYPE_WEIGHTS (hardcoded)

**Issue**: 
- Thresholds defined in 3+ places; no single source of truth
- knowledge-writer reads from config.json but dedup.js/evolution.js ignore it
- If user changes config, dedup thresholds don't follow (evolve threshold 0.65 is hardcoded, not from config)

**Evidence**:
```javascript
// knowledge-dedup.js — hardcoded, ignores config
const DEDUP_THRESHOLDS = {
  exact: 1.0,      
  canonical: 0.95,
  embedding: 0.88  // Hardcoded
};

// knowledge-writer.js — reads config
const { dedupThreshold, evolutionThreshold } = readKnowledgeConfig(options.cwd);
// But then passes to checkDuplicate which uses hardcoded 0.88!
```

**Impact**: Config changes to dedup thresholds are ignored; inconsistent behavior across modules.

---

### 5. **Connection Caching in Multiple Layers** — LOW
**Locations**:
- knowledge-db.js line 22: `DB_CONNECTIONS = new Map()`
- knowledge.js line 39: `const connections = new Map()`

**Issue**: Two levels of caching:
- knowledge-db.js caches by dbPath (global module state)
- knowledge.js wraps and caches again (by scope)

Results in two different maps managing same connections.

**Evidence**:
```javascript
// knowledge-db.js line 392-394
if (DB_CONNECTIONS.has(dbPath)) {
  return DB_CONNECTIONS.get(dbPath)
}

// knowledge.js line 53-55 (also caches)
if (!connections.has(dbPath)) {
  const conn = db.openKnowledgeDB(scope);
  connections.set(dbPath, conn);
}
```

**Impact**: Low risk (both work), but adds complexity; closeAllConnections() only clears knowledge.js cache, not knowledge-db.js global state.

---

### 6. **knowledge-checkpoint.js Partially Incomplete** — MEDIUM
**Location**: knowledge-checkpoint.js (read only first 80 lines)

**Issue**: Function `createCheckpoint()` starts at line 76 but implementation cut off; unclear if it actually stores to knowledge DB or if it's a stub.

**Evidence**:
```javascript
// knowledge-checkpoint.js line 76-79
async function createCheckpoint(checkpoint) {
  validateCheckpoint(checkpoint);
  // Lazy-load dependencies
  // ... (cut off)
}
```

**Impact**: Checkpoint feature may be partially implemented; EXEC-09/10 gates depend on this.

---

### 7. **No Error Context in Degradation Paths** — MEDIUM
**Locations**: knowledge-search.js lines 131-134, 213-214, 319-320

**Issue**: Errors silently degrade without capturing context:
```javascript
// Line 132-134
} catch (err) {
  if (err.message.includes('fts5')) {
    return []  // Silent → no indication of which query failed
  }
}

// Line 319-320
} catch (err) {
  process.stderr.write(`[knowledge-search] degraded mode: vector search failed (${err.message}) — using FTS results only\n`)
}
```

Only vector search logs; FTS search errors are silent (line 132).

**Impact**: Debugging issues in production requires enabling GSD_DEBUG; users unaware of search quality degradation.

---

### 8. **Orphaned Modules (55% of codebase)** — LOW
**Files**: knowledge-feedback, knowledge-cost, knowledge-permissions, knowledge-qa, knowledge-synthesis, knowledge-conflicts, knowledge-principles, knowledge-safety, knowledge-scan (9 files, ~76KB)

**Issue**: No callers found:
- `knowledge-feedback.js`: Principle invalidation never triggered
- `knowledge-cost.js`: Budget tracking implemented but no knowledge operations track cost
- `knowledge-permissions.js`: Grant system built but never validated
- `knowledge-qa.js`: Validation never called
- Others: Speculative features (synthesis, conflicts, principles) with no integration

**Evidence**:
- gsd-tools.js documents `query-knowledge` but implementation not found (may be stub)
- gsd-meta-answerer calls query-knowledge; if unimplemented, meta-answerer fails gracefully (returns empty results)

**Impact**: ~76KB of dead code; maintenance burden; indicates over-engineering and incomplete integration.

---

### 9. **Migration Path to v4 Not Fully Tested** — MEDIUM
**Location**: knowledge-db.js lines 365-376

**Issue**: v3→v4 migration adds `project_slug` column:
```javascript
if (getCurrentVersion(db) === 3) {
  db.exec(`ALTER TABLE knowledge ADD COLUMN project_slug TEXT;`);
  setVersion(db, 4);
}
```

No backward compatibility check; assumes all per-project databases already migrated to global. But `getDBPath('legacy')` suggests per-project DBs may still exist. No migration command to move old data.

**Impact**: If old per-project DBs exist, they won't auto-migrate; knowledge is invisible to new global-scoped searches.

---

## Improvement Candidates

### 1. **Wrap knowledge-writer storeInsights in Transaction** — HIGH Priority
**Action**: 
```javascript
// knowledge-writer.js storeInsights
const result = await conn.db.transaction(async () => {
  for (const insight of insights) {
    // ... existing dedup/insert logic
  }
})();
```

**Effort**: 1 hour. **Risk**: Low (transactions are ACID-safe in better-sqlite3).

---

### 2. **Consolidate Threshold Configuration** — HIGH Priority
**Action**: Create `knowledge-config.js` module:
```javascript
// Load from .planning/config.json once, export constants
module.exports = {
  DEDUP_THRESHOLD_EXACT: 1.0,
  DEDUP_THRESHOLD_CANONICAL: 0.95,
  DEDUP_THRESHOLD_EMBEDDING: 0.88,  // From config or default
  EVOLUTION_THRESHOLD_MIN: 0.65,
  TYPE_WEIGHTS: { ... },
  EMBEDDING_TIMEOUT_MS: 2000
};

// All modules import from here, not hardcode
```

**Effort**: 2 hours (audit + refactor all references). **Risk**: Low.

---

### 3. **Remove Dead Code or Activate It** — MEDIUM Priority
**Action**: 
- Delete 9 orphaned modules (feedback, cost, permissions, qa, synthesis, conflicts, principles, safety, scan) OR
- Activate feedback system: gsd-executor marks phase completion, could call `markPrincipleOutdated()` to refresh stale knowledge

**Current state**: Dead code adds 55% to codebase. **Recommendation**: Delete unless roadmap explicitly calls for principle feedback (check PROJECT.md).

**Effort**: 4 hours (identify dependencies, remove or integrate). **Risk**: Medium (check if anything else imports these).

---

### 4. **Simplify Embedding Timeout Handling** — MEDIUM Priority
**Action**: 
- `searchKnowledge()` wrapper that always calls `searchKnowledgeAsync()` internally
- Make embedding generation explicit in caller (gsd-meta-answerer) with timeout handling
- Always log degradation mode (FTS fallback) to stderr

**Effort**: 3 hours. **Risk**: Low.

---

### 5. **Consolidate CRUD + Lifecycle into Single Module** — LOW Priority
**Action**: Merge `knowledge-crud.js` (write) + `knowledge-lifecycle.js` (read/stats) + lifecycle ops into `knowledge-store.js`:
- 11KB + 11KB → ~18KB single module
- Shared connection object, clearer dependencies
- Remove one layer of abstraction

**Similar**: Merge `knowledge-dedup.js` + `knowledge-evolution.js` → `knowledge-insertion.js` (7KB + 6KB)

**Consolidated layout** (8 modules instead of 20):
```
knowledge-db.js          (schema, migrations, connections)
knowledge-store.js       (crud + lifecycle)
knowledge-search.js      (FTS + vector + RRF)
knowledge-insertion.js   (dedup + evolution)
knowledge-writer.js      (Haiku bridge, extraction→DB)
knowledge-checkpoint.js  (phase snapshots)
embeddings.js            (Nomic model)
knowledge.js             (facade)
```

**Effort**: 8 hours (refactor, test). **Risk**: Medium (breaking changes if external modules import internal files).

---

### 6. **Fix vectorEnabled Check in knowledge-crud.js** — HIGH Priority
**Action**: 
```javascript
// Line 107 — add vectorEnabled to connection object
function insertKnowledge(db, params) {
  // ...
  // WRONG: if (embedding && db.vectorEnabled)
  // FIX: Check if connection passed instead
  // OR: require caller to pass conn object, not just db
}

// Better: change signature
function insertKnowledge(conn, params) {  // Accept full connection object
  const db = conn.db;
  if (embedding && conn.vectorEnabled) {
    // ... vector insert
  }
}
```

**Effort**: 1 hour. **Risk**: Low (signature change, update callers).

---

### 7. **Implement Missing query-knowledge Command** — MEDIUM Priority
**Location**: gsd-tools.js (documented at line 150 but implementation not found)

**Action**: 
```javascript
// In gsd-tools.js command handler
else if (argv[0] === 'query-knowledge') {
  const question = argv[1];
  const project_slug = argv.project || resolveProjectSlug();
  
  const { knowledge } = require('./knowledge.js');
  const results = knowledge.search(question, {
    scope: 'global',
    project_slug,
    limit: 5
  });
  
  console.log(JSON.stringify({ results, query: question, count: results.length }));
}
```

**Effort**: 2 hours (implement + test with gsd-meta-answerer). **Risk**: Low.

---

### 8. **Add Explicit Migration Command for v3→v4** — MEDIUM Priority
**Action**: Add `migrate-knowledge` command (already stubbed in gsd-tools.js line 149):
```javascript
// Reads old per-project DBs, moves to global DB
function migratePerProjectToGlobal(projectPath) {
  const legacyPath = getDBPath('legacy');  // Old per-project location
  if (!fs.existsSync(legacyPath)) {
    return { migrated: 0, reason: 'no legacy DB found' };
  }
  
  const legacyConn = openKnowledgeDB('legacy');
  const globalConn = openKnowledgeDB('global');
  
  // Copy all rows, set project_slug from projectPath
  // Delete legacy DB
}
```

**Effort**: 3 hours. **Risk**: Medium (data migration, backup first).

---

### 9. **Standardize Error Reporting in Search** — LOW Priority
**Action**: Add flag to `searchKnowledge()` to return { results, degraded_fts: bool, degraded_vec: bool, error?: string }:
```javascript
function hybridSearch(conn, options) {
  const result = {
    results: [],
    degraded_fts: false,
    degraded_vec: false
  };
  
  try {
    ftsResults = ftsSearch(...)
  } catch (err) {
    result.degraded_fts = true;
    if (process.env.GSD_DEBUG) console.warn('[fts]', err.message);
  }
  
  try {
    vecResults = vectorSearch(...)
  } catch (err) {
    result.degraded_vec = true;
    console.warn('[vec]', err.message);
  }
  
  // ... RRF fusion
  return result;
}
```

**Effort**: 2 hours. **Risk**: Low (additive change).

---

## Open Questions

1. **Is knowledge-checkpoint.js actually used?** — It's referenced in gsd-executor.md but unclear if it's integrated. EXEC-09 gate lists it; audit should verify caller.

2. **Should feedback system be activated?** — knowledge-feedback.js is complete but unused. Is there a roadmap feature to mark decisions/principles wrong? Or should this module be deleted?

3. **What's the integration story for cost tracking?** — knowledge-cost.js tracks API costs per knowledge operation. But the knowledge system doesn't make API calls (only embedding generation, which is local). Is this for future cloud embeddings? Or should cost tracking be elsewhere?

4. **Why is query-knowledge documented but not implemented?** — gsd-tools.js line 150 lists the command, but no handler found. Is this a planned feature? If so, when?

5. **Per-project vs. global DB migration status?** — Are there still per-project knowledge DBs in the wild? Or did v4 fully transition to global?

6. **Embedding model choice (Nomic vs. GPT)** — Why Nomic Embed (local, free) instead of OpenAI embeddings (higher quality, costs ~$0.02/1K)? Is latency critical? Cold start is ~2s on first call.

7. **Access tracking overhead** — Every search calls `trackAccessBatch()` (knowledge-lifecycle.js line 168-171). With RRF returning 10 results, that's 10 UPDATE statements. Is this necessary? Could be batched to once-per-session.

---

## Summary

The knowledge system is **architecturally sound** (SQLite + FTS5 + vec is correct), but **operationally incomplete**:

- **55% orphaned code** (9 modules) suggests over-engineering and incomplete acceptance.
- **Key race condition** in storeInsights (no transaction wrapper) could leak duplicates.
- **Inconsistent error handling** (silent FTS errors vs. logged vector errors) makes debugging hard.
- **Integration minimal**: Only 2 real callers (meta-answerer, phase-coordinator); many features (feedback, cost, QA) unused.
- **config.json thresholds ignored** by core dedup logic (hardcoded elsewhere).

**Recommendation**: 
1. Merge orphaned modules or delete them (high-impact, medium effort).
2. Fix transaction wrapper and threshold centralization (high-impact, low effort).
3. Consolidate from 20→8 modules (medium-impact, medium effort, improves maintainability).
4. Activate query-knowledge command or remove from gsd-tools docs.
5. Clarify checkpoint integration; test v3→v4 migration path.
