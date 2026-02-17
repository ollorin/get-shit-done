#!/usr/bin/env node

/**
 * conversation-miner.js
 *
 * Format adapter: converts Claude Code project JSONL entries into session-like
 * entries compatible with the Phase 11 extraction pipeline.
 *
 * Claude Code stores conversations at ~/.claude/projects/{slug}/*.jsonl using
 * entry types: user / assistant / progress / system / file-history-snapshot /
 * queue-operation. The Phase 11 infrastructure (session-analyzer.js,
 * analysis-prompts.js, session-chunker.js, knowledge-writer.js) expects
 * user_message / bot_response types.
 *
 * This module bridges that gap via four exported functions:
 *   discoverProjectConversations  - find JSONL files for a project CWD
 *   convertConversationEntries    - convert raw entries to session-like format
 *   shouldMineConversation        - quality gate tuned for conversation format
 *   prepareConversationForMining  - end-to-end: read → convert → gate → chunk → analyze
 *
 * NO external dependencies beyond Node.js built-ins (os, path, fs).
 * Lazy-requires Phase 11 modules (session-quality-gates, session-chunker,
 * session-analyzer) inside prepareConversationForMining() to match the
 * lazy-loading pattern used throughout gsd-tools.js.
 *
 * CommonJS module.exports pattern (matches all get-shit-done/bin/ files).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Only these Claude Code JSONL entry types contain extractable knowledge.
// progress / system / file-history-snapshot / queue-operation are all noise.
const RELEVANT_TYPES = new Set(['user', 'assistant']);

// Minimum text length to treat a user message as substantive
const MIN_USER_TEXT_CHARS = 20;

// Minimum text length after stripping XML command injections
const MIN_CLEAN_TEXT_CHARS = 10;

// Minimum text length for an assistant response (brief orchestration notes skipped)
const MIN_ASSISTANT_TEXT_CHARS = 30;

// Quality gate: minimum number of assistant responses to be worth mining
const MIN_BOT_RESPONSES = 2;

// Quality gate: minimum total character count across all converted entries
const MIN_TOTAL_CHARS = 500;

// Conversation analysis log filename (separate from Telegram session log)
const CONVERSATION_ANALYSIS_LOG_NAME = '.conversation-analysis-log.jsonl';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the .conversation-analysis-log.jsonl file.
 * Stored at .planning/knowledge/ in the project root.
 *
 * @returns {string} Absolute path to the conversation analysis log
 */
function getConversationAnalysisLogPath() {
  // Walk up from this file's directory to find the project root (.planning/)
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const planningDir = path.join(dir, '.planning');
    if (fs.existsSync(planningDir)) {
      return path.join(planningDir, 'knowledge', CONVERSATION_ANALYSIS_LOG_NAME);
    }
    dir = path.dirname(dir);
  }
  // Fallback: relative to CWD
  return path.join(process.cwd(), '.planning', 'knowledge', CONVERSATION_ANALYSIS_LOG_NAME);
}

/**
 * Read the conversation analysis log. Returns empty array if not found.
 *
 * @param {string} logPath - Absolute path to the JSONL log file
 * @returns {Array<object>} Parsed log entries
 */
function readConversationAnalysisLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const entries = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines silently
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// discoverProjectConversations
// ---------------------------------------------------------------------------

/**
 * Discover Claude Code conversation JSONL files for a given project directory.
 *
 * Claude Code stores conversations at:
 *   ~/.claude/projects/{slug}/*.jsonl
 *
 * The slug is derived from the project CWD by replacing every "/" with "-":
 *   /Users/ollorin/get-shit-done → -Users-ollorin-get-shit-done
 *
 * @param {string} projectCwd - Absolute path to the project directory
 * @param {object} [options]
 * @param {number} [options.maxAgeDays=30] - Skip files older than N days (0 = no limit)
 * @param {boolean} [options.includeSubagents=false] - Also scan subagents/ subdirectories
 * @returns {{ files: Array<{path, sessionId, size, mtime, isSubagent?}>, projectSlugDir: string, error?: string }}
 */
function discoverProjectConversations(projectCwd, options = {}) {
  const { maxAgeDays = 30, includeSubagents = false } = options;

  // Build the expected project slug directory
  const slug = projectCwd.replace(/\//g, '-');
  const projectSlugDir = path.join(os.homedir(), '.claude', 'projects', slug);

  if (!fs.existsSync(projectSlugDir)) {
    return { files: [], projectSlugDir, error: 'Project slug directory not found' };
  }

  // Age cutoff in milliseconds (0 means no cutoff)
  const cutoffMs = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86400000 : 0;

  const files = [];

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(projectSlugDir);
  } catch (err) {
    return { files: [], projectSlugDir, error: `Failed to read directory: ${err.message}` };
  }

  for (const entry of dirEntries) {
    if (entry.endsWith('.jsonl')) {
      // Top-level conversation file
      const fullPath = path.join(projectSlugDir, entry);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (cutoffMs > 0 && stat.mtimeMs < cutoffMs) continue;

      files.push({
        path: fullPath,
        sessionId: entry.replace('.jsonl', ''),
        size: stat.size,
        mtime: stat.mtime
      });
    }

    // Optionally scan subagent directories
    if (includeSubagents) {
      const subagentsPath = path.join(projectSlugDir, entry, 'subagents');
      if (fs.existsSync(subagentsPath)) {
        let subFiles;
        try {
          subFiles = fs.readdirSync(subagentsPath).filter(f => f.endsWith('.jsonl'));
        } catch {
          continue;
        }
        for (const sf of subFiles) {
          const fullPath = path.join(subagentsPath, sf);
          let stat;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          if (cutoffMs > 0 && stat.mtimeMs < cutoffMs) continue;
          files.push({
            path: fullPath,
            sessionId: `${entry}-sub-${sf.replace('.jsonl', '')}`,
            size: stat.size,
            mtime: stat.mtime,
            isSubagent: true
          });
        }
      }
    }
  }

  // Sort by modification time, newest first
  files.sort((a, b) => b.mtime - a.mtime);

  return { files, projectSlugDir };
}

// ---------------------------------------------------------------------------
// convertConversationEntries
// ---------------------------------------------------------------------------

/**
 * Convert raw Claude Code JSONL entries to session-like entries compatible
 * with formatEntriesForPrompt() in analysis-prompts.js.
 *
 * Filtering rules:
 * - Skip entries where type is not 'user' or 'assistant' (progress/system/etc.)
 * - For 'user' entries:
 *     - Skip if all content items are type='tool_result' (tool outputs, not human input)
 *     - Extract only type='text' items; skip if result < 20 chars
 *     - Strip XML tags and content (GSD command injections); skip if < 10 chars after
 * - For 'assistant' entries:
 *     - Extract type='text' content items; skip if result < 30 chars
 *
 * Output entries use types 'user_message' and 'bot_response' which are
 * recognised by formatEntriesForPrompt() and getSessionContentHash().
 *
 * @param {Array<object>} jsonlEntries - Raw parsed JSONL entry objects
 * @returns {Array<{type, content, timestamp, original_type}>} Converted entries
 */
function convertConversationEntries(jsonlEntries) {
  if (!Array.isArray(jsonlEntries) || jsonlEntries.length === 0) {
    return [];
  }

  const result = [];

  for (const entry of jsonlEntries) {
    if (!entry || !RELEVANT_TYPES.has(entry.type)) continue;

    const timestamp = entry.timestamp || new Date().toISOString();

    // Content lives at entry.message.content for assistant entries,
    // and at either entry.message.content OR entry.content for user entries.
    const message = entry.message || {};
    const content = message.content !== undefined ? message.content : entry.content;

    if (entry.type === 'user') {
      if (Array.isArray(content)) {
        // If ALL items are tool_result, skip (tool output returned to Claude, not human input)
        const allToolResults = content.length > 0 && content.every(
          item => item && item.type === 'tool_result'
        );
        if (allToolResults) continue;

        // Extract text items only
        const texts = content
          .filter(item => item && item.type === 'text')
          .map(item => item.text || '')
          .join('\n')
          .trim();

        if (texts.length < MIN_USER_TEXT_CHARS) continue;

        // Strip XML tags and their content (GSD workflow injections)
        const cleanText = texts.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();
        if (cleanText.length < MIN_CLEAN_TEXT_CHARS) continue;

        result.push({
          type: 'user_message',
          content: cleanText || texts,
          timestamp,
          original_type: 'user'
        });

      } else if (typeof content === 'string') {
        if (content.trim().length < MIN_USER_TEXT_CHARS) continue;

        const cleanText = content.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();
        if (cleanText.length < MIN_CLEAN_TEXT_CHARS) continue;

        result.push({
          type: 'user_message',
          content: cleanText || content,
          timestamp,
          original_type: 'user'
        });
      }

    } else if (entry.type === 'assistant') {
      // Assistant content is always under message.content as an array
      if (!Array.isArray(content)) continue;

      const texts = content
        .filter(item => item && item.type === 'text')
        .map(item => item.text || '')
        .join('\n')
        .trim();

      if (texts.length < MIN_ASSISTANT_TEXT_CHARS) continue;

      result.push({
        type: 'bot_response',
        content: texts,
        timestamp,
        original_type: 'assistant'
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// shouldMineConversation
// ---------------------------------------------------------------------------

/**
 * Determine whether a converted conversation has enough substantive content
 * to be worth mining via Haiku extraction.
 *
 * IMPORTANT: Do NOT use shouldAnalyzeSession() from session-quality-gates.js
 * on conversation entries. That function requires question/answer types which
 * conversation entries never have — causing every conversation to be rejected.
 * This dedicated function uses thresholds tuned for the conversation format.
 *
 * @param {Array<object>} convertedEntries - Output of convertConversationEntries()
 * @returns {{ mine: boolean, reason: string }}
 */
function shouldMineConversation(convertedEntries) {
  if (!Array.isArray(convertedEntries) || convertedEntries.length === 0) {
    return { mine: false, reason: 'No entries after conversion' };
  }

  const userMsgCount = convertedEntries.filter(e => e.type === 'user_message').length;
  const botRespCount = convertedEntries.filter(e => e.type === 'bot_response').length;
  const totalText = convertedEntries.reduce((sum, e) => sum + (e.content || '').length, 0);

  if (botRespCount < MIN_BOT_RESPONSES) {
    return {
      mine: false,
      reason: `Only ${botRespCount} assistant response(s) - too sparse`
    };
  }

  if (totalText < MIN_TOTAL_CHARS) {
    return {
      mine: false,
      reason: `Only ${totalText} total chars - insufficient content`
    };
  }

  return {
    mine: true,
    reason: `${userMsgCount} user msgs, ${botRespCount} bot responses, ${totalText} chars`
  };
}

// ---------------------------------------------------------------------------
// prepareConversationForMining
// ---------------------------------------------------------------------------

/**
 * End-to-end preparation: read a Claude Code JSONL file, convert entries,
 * apply quality gate, check re-analysis prevention, chunk, and produce
 * extraction requests compatible with the Phase 11 Task() subagent pattern.
 *
 * Phase 11 modules are lazy-required inside this function (not at module top
 * level) to match the lazy-loading pattern used throughout gsd-tools.js.
 *
 * @param {string} filePath - Absolute path to the JSONL file
 * @param {string} sessionId - Session identifier (filename without .jsonl)
 * @returns {{
 *   shouldMine: boolean,
 *   reason: string,
 *   contentHash?: string,
 *   chunkCount?: number,
 *   extractionRequests?: Array<{type, prompt, expectedSchema}>
 * }}
 */
function prepareConversationForMining(filePath, sessionId) {
  // 1. Read and parse the JSONL file
  let rawContent;
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { shouldMine: false, reason: `Failed to read file: ${err.message}` };
  }

  const rawEntries = rawContent
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null; // Skip malformed lines silently
      }
    })
    .filter(Boolean);

  // 2. Convert to session-like format
  const convertedEntries = convertConversationEntries(rawEntries);

  // 3. Apply quality gate
  const qualityResult = shouldMineConversation(convertedEntries);
  if (!qualityResult.mine) {
    return { shouldMine: false, reason: qualityResult.reason };
  }

  // 4. Compute content hash (lazy-require session-quality-gates.js)
  const { getSessionContentHash } = require('./session-quality-gates.js');
  const contentHash = getSessionContentHash(convertedEntries);

  // 5. Check re-analysis prevention using the conversation-specific log
  //    (NOT isAlreadyAnalyzed() which reads the Telegram session log)
  const logPath = getConversationAnalysisLogPath();
  const logEntries = readConversationAnalysisLog(logPath);
  const alreadyAnalyzed = logEntries.some(
    e => e.session_id === sessionId && e.content_hash === contentHash
  );
  if (alreadyAnalyzed) {
    return { shouldMine: false, reason: 'Already analyzed (content hash matches)' };
  }

  // 6. Chunk the converted entries (lazy-require session-chunker.js)
  const { chunkSession } = require('./session-chunker.js');
  const { chunks, chunkCount } = chunkSession(convertedEntries);

  // 7. Build extraction requests for each chunk (lazy-require session-analyzer.js)
  const { analyzeSession } = require('./session-analyzer.js');
  const allRequests = [];
  for (const chunk of chunks) {
    const requests = analyzeSession(chunk);
    allRequests.push(...requests);
  }

  return {
    shouldMine: true,
    reason: qualityResult.reason,
    contentHash,
    chunkCount,
    extractionRequests: allRequests
  };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  discoverProjectConversations,
  convertConversationEntries,
  shouldMineConversation,
  prepareConversationForMining
};
