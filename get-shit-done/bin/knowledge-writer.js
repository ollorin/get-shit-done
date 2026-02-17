#!/usr/bin/env node

/**
 * knowledge-writer.js
 *
 * Bridges Haiku-extracted insights to the Phase 3 knowledge database.
 * Handles deduplication, type mapping, TTL assignment, and auto-init.
 *
 * Used by the session-end analysis pipeline. Called AFTER Haiku Task()
 * subagent returns parsed insights (via session-analyzer.js).
 *
 * Dependencies: knowledge-db.js, knowledge-crud.js, knowledge-dedup.js,
 *               knowledge-evolution.js (all Phase 3/4)
 *
 * CommonJS module - no @anthropic-ai/sdk usage.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Type and TTL Mapping ─────────────────────────────────────────────────

/**
 * Map Haiku insight types to Phase 3 knowledge types and TTL categories.
 *
 * Insight types from session-analyzer.js:
 *   'decision'         -> decision, long_term (90 days)
 *   'reasoning_pattern'-> lesson,   permanent
 *   'meta_knowledge'   -> depends on .category field:
 *     'preference'       -> lesson, permanent
 *     'principle'        -> lesson, permanent
 *     'constraint'       -> decision, long_term
 *     'learning_pattern' -> summary, short_term (7 days)
 */
function mapInsightToKnowledgeType(insight) {
  if (insight.type === 'decision') {
    return { knowledgeType: 'decision', ttlCategory: 'long_term' };
  }

  if (insight.type === 'reasoning_pattern') {
    return { knowledgeType: 'lesson', ttlCategory: 'permanent' };
  }

  if (insight.type === 'meta_knowledge') {
    const category = insight.category || '';
    if (category === 'preference' || category === 'principle') {
      return { knowledgeType: 'lesson', ttlCategory: 'permanent' };
    }
    if (category === 'constraint') {
      return { knowledgeType: 'decision', ttlCategory: 'long_term' };
    }
    if (category === 'learning_pattern') {
      return { knowledgeType: 'summary', ttlCategory: 'short_term' };
    }
    // Unknown sub-category - treat as lesson
    return { knowledgeType: 'lesson', ttlCategory: 'permanent' };
  }

  // Unknown type - default to short_term summary
  return { knowledgeType: 'summary', ttlCategory: 'short_term' };
}

/**
 * Extract the primary content field from a Haiku insight object.
 * Picks the most specific field based on insight type.
 *
 * @param {object} insight - Parsed Haiku output item
 * @returns {string} Content to store in knowledge DB
 */
function extractInsightContent(insight) {
  if (insight.type === 'decision') {
    return insight.decision || insight.description || insight.statement || '';
  }
  if (insight.type === 'reasoning_pattern') {
    return insight.description || insight.decision || insight.statement || '';
  }
  if (insight.type === 'meta_knowledge') {
    return insight.statement || insight.description || insight.decision || '';
  }
  // Fallback
  return insight.decision || insight.description || insight.statement || '';
}

// ─── Database Auto-Initialization ─────────────────────────────────────────

/**
 * Ensure knowledge database is available, creating it if needed.
 *
 * Per locked decision #5: Knowledge database auto-creates on first use
 * if it does not exist. This function handles that bootstrap.
 *
 * @param {string} scope - 'project' or 'global'
 * @returns {{ available: boolean, conn?: object, reason?: string }}
 */
function ensureKnowledgeDB(scope) {
  // 1. Check that better-sqlite3 is installed
  let knowledgeDb;
  try {
    knowledgeDb = require('./knowledge-db.js');
  } catch (err) {
    return { available: false, reason: 'knowledge-db.js not loadable: ' + err.message };
  }

  // 2. Check availability (dependency check)
  const check = knowledgeDb.isKnowledgeDBAvailable(scope);
  if (!check.available) {
    return { available: false, reason: check.reason };
  }

  // 3. Ensure .planning/knowledge/ directory exists for project scope
  if (scope !== 'global') {
    try {
      const dbPath = knowledgeDb.getDBPath(scope);
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    } catch (err) {
      return { available: false, reason: 'Could not create knowledge DB directory: ' + err.message };
    }
  }

  // 4. Open the database (auto-creates schema on first use)
  let conn;
  try {
    conn = knowledgeDb.openKnowledgeDB(scope);
  } catch (err) {
    return { available: false, reason: 'Failed to open knowledge DB: ' + err.message };
  }

  return { available: true, conn };
}

// ─── Core Storage Function ─────────────────────────────────────────────────

/**
 * Store Haiku-extracted insights in the Phase 3 knowledge database.
 *
 * Applies three-stage deduplication before each insertion:
 *   Stage 1: Content hash (exact match) -> skip
 *   Stage 2: Canonical hash (normalized) -> skip
 *   Stage 3: Embedding similarity > 0.88 -> skip
 *   Similarity 0.65-0.88 -> evolve (insertOrEvolve via knowledge-evolution.js)
 *   Similarity < 0.65 -> insert (insertKnowledge via knowledge-crud.js)
 *
 * @param {Array<object>} insights - Parsed Haiku output objects (from parseExtractionResult)
 * @param {object} options - Storage options
 * @param {string} [options.sessionId] - Session ID for context tracking
 * @param {string} [options.conversationId] - Conversation ID for context tracking
 * @param {string} [options.scope='project'] - Knowledge scope ('project' or 'global')
 * @returns {Promise<{ stored: number, skipped: number, evolved: number, errors: string[] }>}
 */
async function storeInsights(insights, options = {}) {
  const result = { stored: 0, skipped: 0, evolved: 0, errors: [] };
  const scope = options.scope || 'project';

  // Validate input
  if (!Array.isArray(insights) || insights.length === 0) {
    return result;
  }

  // 1. Ensure knowledge DB is available and auto-initialize if needed
  const dbResult = ensureKnowledgeDB(scope);
  if (!dbResult.available) {
    result.errors.push('Knowledge DB unavailable: ' + dbResult.reason);
    process.stderr.write(`[knowledge-writer] Knowledge DB unavailable: ${dbResult.reason}\n`);
    return result;
  }

  const conn = dbResult.conn;

  // 2. Load dedup and evolution modules
  let checkDuplicate, insertOrEvolve, insertKnowledge;
  try {
    const dedup = require('./knowledge-dedup.js');
    checkDuplicate = dedup.checkDuplicate;
  } catch (err) {
    result.errors.push('knowledge-dedup.js not loadable: ' + err.message);
    return result;
  }

  try {
    const evolution = require('./knowledge-evolution.js');
    insertOrEvolve = evolution.insertOrEvolve;
  } catch (err) {
    result.errors.push('knowledge-evolution.js not loadable: ' + err.message);
    return result;
  }

  try {
    const crud = require('./knowledge-crud.js');
    insertKnowledge = crud.insertKnowledge;
  } catch (err) {
    result.errors.push('knowledge-crud.js not loadable: ' + err.message);
    return result;
  }

  // 3. Process each insight
  for (const insight of insights) {
    try {
      // a. Extract content
      const content = extractInsightContent(insight);
      if (!content || content.trim().length < 5) {
        result.errors.push(`Skipped insight with empty/short content (type: ${insight.type})`);
        result.skipped++;
        continue;
      }

      // b. Map insight type to knowledge type and TTL
      const { knowledgeType, ttlCategory } = mapInsightToKnowledgeType(insight);

      // c. Build context metadata
      const contextMetadata = {
        session_id: options.sessionId || null,
        conversation_id: options.conversationId || null,
        confidence: insight.confidence || 'medium',
        context_snippet: insight.context_snippet || '',
        source: 'haiku-extraction',
        insight_type: insight.type,
        insight_category: insight.category || null
      };

      // d. Build tags
      const tags = ['haiku-extracted', insight.type];

      // e. Check for duplicates (three-stage dedup)
      // Note: embedding is not generated here (requires ML model at runtime).
      // We rely on stages 1 and 2 (hash-based) for synchronous dedup.
      // Stage 3 (embedding similarity) requires an active embedding pipeline
      // which may not be available at session close time.
      const dupCheck = await checkDuplicate(conn, content, null);

      if (dupCheck.isDuplicate) {
        const similarity = dupCheck.similarity || 0;

        if (similarity > 0.88) {
          // Exact or near-exact duplicate - skip
          result.skipped++;
          continue;
        }

        if (similarity >= 0.65 && similarity <= 0.88) {
          // Near-duplicate - evolve existing entry via insertOrEvolve
          const evolveResult = await insertOrEvolve(conn, {
            content,
            type: knowledgeType,
            scope,
            embedding: null,
            metadata: {
              ...contextMetadata,
              tags
            }
          });

          if (evolveResult.action === 'evolved') {
            result.evolved++;
          } else if (evolveResult.action === 'skipped') {
            result.skipped++;
          } else if (evolveResult.action === 'created') {
            result.stored++;
          }
          continue;
        }
      }

      // f. Not a duplicate - insert new entry
      // Use insertOrEvolve for canonical handling (it runs full dedup internally)
      const insertResult = await insertOrEvolve(conn, {
        content,
        type: knowledgeType,
        scope,
        embedding: null,
        metadata: {
          ...contextMetadata,
          tags
        }
      });

      if (insertResult.action === 'created') {
        result.stored++;
      } else if (insertResult.action === 'evolved') {
        result.evolved++;
      } else if (insertResult.action === 'skipped') {
        result.skipped++;
      }

    } catch (err) {
      const errorMsg = `Failed to store insight (type: ${insight.type}): ${err.message}`;
      result.errors.push(errorMsg);
      process.stderr.write(`[knowledge-writer] ${errorMsg}\n`);
      // Continue processing remaining insights (non-fatal)
    }
  }

  return result;
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  storeInsights,
  ensureKnowledgeDB,
  mapInsightToKnowledgeType,
  extractInsightContent
};
