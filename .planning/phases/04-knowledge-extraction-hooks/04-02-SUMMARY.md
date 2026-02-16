---
phase: 04-knowledge-extraction-hooks
plan: 02
subsystem: knowledge-extraction
tags: [extraction, quality-gates, deduplication, passive-learning]
dependencies:
  requires: []
  provides: [knowledge-extraction-api]
  affects: []
tech_stack:
  added:
    - crypto (sha256 hashing)
  patterns:
    - regex-based pattern matching
    - quality gate filtering
    - canonical hashing for deduplication
key_files:
  created:
    - get-shit-done/bin/knowledge-extraction.js
  modified: []
decisions:
  - Use regex patterns with capture groups for decision/lesson extraction
  - 20-char minimum length threshold for quality gates
  - Technical signals include code backticks, paths, keywords, identifiers
  - All-caps pattern added for technical terms (AUTOINCREMENT, WAL, etc.)
  - Canonical hash normalizes case/punctuation for near-duplicate detection
metrics:
  duration_minutes: 3
  tasks_completed: 3
  files_created: 1
  commits: 3
  completed_at: "2026-02-16T05:17:03Z"
---

# Phase 04 Plan 02: Pattern-Based Knowledge Extraction Summary

**One-liner:** Regex-based extraction of decisions and lessons from Claude responses with quality gates and deduplication

## What Was Built

Created `knowledge-extraction.js` module that passively extracts decisions and lessons from Claude response text using pattern matching with quality gates to prevent noise.

**Core capabilities:**
- **Decision patterns:** Match "let's use X", "decided to Y", "going with Z", "approach: X", "I recommend Y", etc.
- **Lesson patterns:** Match "turns out X", "the trick is Y", "gotcha: Z", "note: X", "X doesn't work because Y", etc.
- **Quality gates:** Filter out short content (<20 chars), generic phrases ("sounds good"), and non-technical content
- **Technical signals:** Detect code backticks, paths, keywords (npm, git, database), identifiers (CamelCase, snake_case, ALL_CAPS)
- **Deduplication:** Canonical hash collapses near-duplicates with different case/punctuation
- **Full pipeline:** extractKnowledge runs extract → filter → dedupe with stats

## Implementation Details

### Decision Patterns (HOOK-02)

6 regex patterns covering:
1. "let's use/go with/implement/choose/try/pick X"
2. "decided/choosing/going with/chose to X"
3. "will use/using/opted for X because/for/to/since"
4. "approach/solution/implementation/strategy/plan: X"
5. "I recommend/suggest X"
6. "X is better/makes more sense/is the way to go/is preferred"

### Lesson Patterns (HOOK-03)

7 regex patterns covering:
1. "learned/discovered/found out/realized that X"
2. "turns out/apparently that X"
3. "the trick/key/secret/solution is X"
4. "gotcha/pitfall/caveat/watch out/warning/caution: X"
5. "note/important/remember/tip/hint: X"
6. "X doesn't work/won't work/fails/breaks because/when/if Y"
7. "instead of X, use/try/do Y"

### Quality Gates (HOOK-04)

Three-stage filtering:
1. **Length check:** Reject content < 20 chars
2. **Generic phrase detection:** Reject "sounds good", "okay", "thanks", etc. (if < 50 chars)
3. **Technical signal requirement:** Must contain code backticks, paths, technical keywords, or identifiers

Technical signals include:
- Code references: backticks, function/class/const/let/var/import/export
- Paths: /path/to/file
- Keywords: npm, git, node, database, schema, API, HTTP, JSON, SQL, etc.
- Identifiers: CamelCase, snake_case, ALL_CAPS (AUTOINCREMENT, WAL, FTS5)
- File extensions: .js, .ts, .md, etc.

### Deduplication

Within-batch deduplication using canonical hashing:
- **Content hash:** SHA-256 of exact content (preserves case/punctuation)
- **Canonical hash:** SHA-256 of normalized content (lowercase, no punctuation, collapsed whitespace)
- Duplicates detected via canonical hash match
- Each extraction includes both hashes for future cross-batch deduplication

### API Surface

**Extraction:**
- `extractFromResponse(text)` → raw matches
- `extractAndFilter(text, options)` → filtered matches
- `extractKnowledge(text, options)` → full pipeline with stats

**Quality gates:**
- `passesQualityGate(content)` → { passed, reason? }
- `filterWithQualityGates(extractions, options)` → filtered array

**Deduplication:**
- `computeContentHash(content)` → sha256 hex
- `computeCanonicalHash(content)` → sha256 hex (normalized)
- `deduplicateExtractions(extractions)` → deduplicated array

**Constants:**
- `DECISION_PATTERNS`, `LESSON_PATTERNS`
- `TECHNICAL_SIGNALS`, `GENERIC_PHRASES`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added ALL_CAPS technical term pattern**
- **Found during:** Task 2 verification
- **Issue:** Quality gate rejected "AUTOINCREMENT" as non-technical because CamelCase pattern required lowercase between uppercase letters
- **Fix:** Added `/\b[A-Z]{2,}\b/` pattern to TECHNICAL_SIGNALS to detect all-caps technical terms like AUTOINCREMENT, WAL, FTS5, API, HTTP, JSON, SQL, etc.
- **Files modified:** get-shit-done/bin/knowledge-extraction.js
- **Commit:** 93caef0

No other deviations - plan executed exactly as written.

## Testing & Verification

**Test 1 - Pattern extraction:**
```bash
Total matches: 5
Decisions: 2 (better-sqlite3, Sonnet)
Lessons: 3 (AUTOINCREMENT, normalize embeddings, transactions)
```

**Test 2 - Quality gates:**
```bash
✓ Short text rejected (9 chars < 20)
✓ Generic phrase rejected ("sounds good to me")
✓ No technical signal rejected ("proceed with the plan")
✓ Valid technical content passed ("better-sqlite3 for database")
```

**Test 3 - Deduplication:**
```bash
✓ Canonical hashes match for "Use SQLite" vs "use sqlite"
✓ Near-duplicates with case/punctuation differences deduplicated
✓ Genuinely different content preserved
```

All verification criteria met.

## Files Modified

| File | Lines | Purpose |
|------|-------|---------|
| get-shit-done/bin/knowledge-extraction.js | 297 | Full extraction pipeline with patterns, quality gates, deduplication |

## Task Breakdown

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 790754c | Created decision and lesson regex patterns with extractFromResponse |
| 2 | 93caef0 | Implemented quality gates with technical signals and generic phrase filtering |
| 3 | 61de437 | Added deduplication with content and canonical hashing, extractKnowledge pipeline |

## Next Steps

Ready for:
- **04-03:** Response detection and triggering (when to extract)
- **04-04:** Batch processing and storage integration (save to knowledge DB)
- **04-05:** Hook integration (wire into execute-plan workflow)

## Self-Check: PASSED

**Created files exist:**
```bash
✓ FOUND: get-shit-done/bin/knowledge-extraction.js
```

**Commits exist:**
```bash
✓ FOUND: 790754c (Task 1 - patterns)
✓ FOUND: 93caef0 (Task 2 - quality gates)
✓ FOUND: 61de437 (Task 3 - deduplication)
```

**Exports verified:**
```bash
✓ DECISION_PATTERNS, LESSON_PATTERNS
✓ TECHNICAL_SIGNALS, GENERIC_PHRASES
✓ extractFromResponse, passesQualityGate, filterWithQualityGates, extractAndFilter
✓ computeContentHash, computeCanonicalHash, deduplicateExtractions, extractKnowledge
```

All claims verified.
