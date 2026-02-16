---
phase: 05-knowledge-permissions-safety
plan: 05
subsystem: knowledge-feedback
tags: [feedback, confidence, invalidation, principles, learning]

dependency_graph:
  requires:
    - knowledge-crud (updateKnowledge for metadata updates)
    - knowledge-db (database connection)
  provides:
    - principle feedback system
    - confidence degradation
    - invalidation tracking
    - replacement workflow
  affects:
    - knowledge system (adds feedback loop)
    - principle quality (removes bad principles)

tech_stack:
  added:
    - feedback_history table for event tracking
    - confidence degradation algorithm
    - replacement chain tracking
  patterns:
    - severity-based degradation (minor/major/critical)
    - soft deletion with expiration
    - bidirectional linking (replaces/replaced_by)

key_files:
  created:
    - get-shit-done/bin/knowledge-feedback.js
  modified: []

decisions:
  - Degradation factors: minor 20%, major 50%, critical 100%
  - Invalidation threshold: confidence < 0.3
  - Outdated principles expire in 7 days (soft delete)
  - Feedback history stored in separate table for audit trail
  - Replacement principles maintain bidirectional links

metrics:
  duration_minutes: 3
  tasks_completed: 3
  files_created: 1
  commits: 3
  completed_at: 2026-02-16T05:58:24Z
---

# Phase 05 Plan 05: Principle Feedback & Invalidation Summary

Confidence-based feedback system for principle quality with degradation, invalidation, and replacement workflows.

## Overview

Implemented KNOW-26 (mark wrong/outdated) and KNOW-27 (learn from feedback) by creating a comprehensive feedback system for principles. Users can provide negative feedback on principles with severity levels, causing confidence degradation or immediate invalidation. Feedback history is preserved for audit, and replacement principles can be created with proper linking.

## Tasks Completed

### Task 1: Create principle feedback module
**Commit:** 771917a
**Files:** get-shit-done/bin/knowledge-feedback.js

- Implemented `markPrincipleWrong` with severity-based confidence degradation
  - Minor: 20% reduction (0.8 → 0.64)
  - Major: 50% reduction (0.8 → 0.4)
  - Critical: 100% reduction (0.8 → 0.0, immediate invalidation)
- Added automatic invalidation when confidence drops below 0.3 threshold
- Implemented `markPrincipleOutdated` for soft deletion with 7-day expiration
- Added `getPrincipleMetadata` helper for metadata retrieval
- All metadata updates preserve existing fields while adding feedback context

### Task 2: Add feedback history tracking
**Commit:** bf6c36f
**Files:** get-shit-done/bin/knowledge-feedback.js

- Created `feedback_history` table with comprehensive event tracking
  - Stores: event_type, severity, reason, old/new confidence, timestamp
  - Foreign key relationship to knowledge table
- Implemented `recordFeedbackEvent` to store feedback events with full context
- Added `getPrincipleFeedbackHistory` to retrieve event history (newest first)
- Implemented `getInvalidatedPrinciples` to list all invalidated principles
- Updated `markPrincipleWrong` and `markPrincipleOutdated` to record events in transactions
- Feedback history provides audit trail for principle quality evolution

### Task 3: Add replacement principle workflow
**Commit:** ed9958f
**Files:** get-shit-done/bin/knowledge-feedback.js

- Implemented `promptForReplacement` to generate user prompts for replacements
- Added `createReplacementPrinciple` to create linked replacement principles
  - New principle has `replaces` field pointing to old ID
  - Old principle gets `replaced_by` field pointing to new ID
  - Maintains scope and allows custom confidence level
- Implemented `getReplacementChain` to follow principle evolution history
  - Follows `replaced_by` links from oldest to newest
  - Returns full chain with confidence and invalidation status
- Added `getPendingReplacements` to list invalidated principles without replacements
- Bidirectional linking enables principle evolution tracking

## Deviations from Plan

None - plan executed exactly as written.

## Technical Implementation

### Confidence Degradation Algorithm

```javascript
const DEGRADATION_FACTORS = {
  critical: 1.0,   // Invalidate immediately (confidence -> 0)
  major: 0.5,      // Cut confidence in half
  minor: 0.2       // Reduce by 20%
}

newConfidence = currentConfidence * (1 - DEGRADATION_FACTORS[severity])
invalidated = newConfidence < 0.3
```

### Feedback History Schema

```sql
CREATE TABLE feedback_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  principle_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,           -- 'marked_wrong', 'marked_outdated'
  severity TEXT,                      -- 'minor', 'major', 'critical'
  reason TEXT,
  old_confidence REAL,
  new_confidence REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (principle_id) REFERENCES knowledge(id)
);
```

### Replacement Chain Structure

```
Old Principle (ID: 1)        New Principle (ID: 5)
├─ metadata.replaced_by: 5   ├─ metadata.replaces: 1
├─ confidence: 0.0           ├─ confidence: 0.7
└─ invalidated: true         └─ invalidated: false
```

## Verification Results

All success criteria met:

1. Confidence degrades correctly per severity:
   - Minor: 20% reduction (1.0 → 0.8)
   - Major: 50% reduction (1.0 → 0.5)
   - Critical: 100% reduction (1.0 → 0.0)

2. Invalidation triggers at confidence < 0.3:
   - 0.5 with major degradation → 0.25 → invalidated

3. Outdated principles soft-delete in 7 days:
   - `expires_at` set to 7 days from marking
   - `confidence` set to 0.0

4. Feedback history preserved for audit:
   - All events recorded with full context
   - History retrievable in chronological order

5. Replacement workflow creates linked principles:
   - Bidirectional links maintained
   - Chain traversal works correctly

6. Module exports all required functions:
   - DEGRADATION_FACTORS constant
   - markPrincipleWrong, markPrincipleOutdated
   - recordFeedbackEvent, getPrincipleFeedbackHistory
   - getInvalidatedPrinciples, getPendingReplacements
   - promptForReplacement, createReplacementPrinciple
   - getReplacementChain, getPrincipleMetadata

## Integration Points

### With Knowledge CRUD
- Uses metadata field for storing feedback state
- Leverages transaction support for atomic updates
- Compatible with existing TTL and expiration system

### With Knowledge Database
- Creates feedback_history table on first use
- Uses foreign keys to maintain referential integrity
- Works with existing knowledge schema

### Future CLI Integration
- `gsd knowledge mark-wrong <id> --severity major --reason "..."`
- `gsd knowledge mark-outdated <id> --replacement <new-id>`
- `gsd knowledge feedback-history <id>`
- `gsd knowledge pending-replacements`

## Self-Check: PASSED

Files created:
- FOUND: get-shit-done/bin/knowledge-feedback.js

Commits verified:
- FOUND: 771917a (Task 1: principle feedback module)
- FOUND: bf6c36f (Task 2: feedback history tracking)
- FOUND: ed9958f (Task 3: replacement workflow)

All verification tests passed:
- Confidence degradation factors work correctly
- Invalidation threshold enforced
- Feedback events recorded
- Replacement chains maintained
