#!/usr/bin/env node

/**
 * session-chunker.js
 *
 * Session chunking and voice message resolution for session-end knowledge extraction.
 *
 * Purpose:
 * - Split large session transcripts at entry boundaries into chunks that fit
 *   within Haiku's effective context window (25k chars default)
 * - Resolve voice message entries to their transcribed text before analysis
 * - Provide a single prepareSessionForAnalysis() convenience function
 *
 * NO external dependencies beyond analysis-prompts.js (already in same package).
 * CommonJS module.exports pattern (matches all get-shit-done/bin/ files).
 */

'use strict';

const { formatEntriesForPrompt } = require('./analysis-prompts');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 25000;
const VOICE_UNAVAILABLE_TEXT = '[Voice message - transcription unavailable]';

// ---------------------------------------------------------------------------
// resolveVoiceEntries
// ---------------------------------------------------------------------------

/**
 * Resolve voice message entries to their transcribed text.
 *
 * Entries with voice_file + transcription: replace content with transcription.
 * Entries with voice_file but no transcription: replace content with placeholder.
 *
 * This is a pre-processing step — Whisper transcription happens at message
 * receipt time (Phase 8). This just ensures the text form is used for analysis.
 *
 * @param {Array<object>} entries - Session JSONL entries (plain objects)
 * @returns {Array<object>} New array with voice entries resolved (input not mutated)
 */
function resolveVoiceEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;

    const isVoiceEntry = entry.type === 'voice_message' || entry.voice_file;

    if (!isVoiceEntry) {
      return entry;
    }

    // Clone the entry to avoid mutating input
    const resolved = { ...entry };

    if (entry.transcription && typeof entry.transcription === 'string' && entry.transcription.trim()) {
      // Voice message with transcription available: use transcription as content
      resolved.content = entry.transcription;
      // Promote type for downstream prompt formatting (user_message is recognized by formatEntriesForPrompt)
      if (resolved.type === 'voice_message') {
        resolved.type = 'user_message';
        resolved.original_type = 'voice_message';
      }
    } else {
      // Voice message without transcription: use placeholder
      resolved.content = VOICE_UNAVAILABLE_TEXT;
      if (resolved.type === 'voice_message') {
        resolved.type = 'user_message';
        resolved.original_type = 'voice_message';
      }
    }

    return resolved;
  });
}

// ---------------------------------------------------------------------------
// chunkSession
// ---------------------------------------------------------------------------

/**
 * Split session entries into chunks that fit under maxCharsPerChunk.
 *
 * Splitting is always at entry boundaries (never mid-entry).
 * Each chunk (beyond the first) gets the session_metadata entry prepended
 * as a context header so Haiku knows it's analyzing a partial session.
 *
 * Algorithm:
 * 1. Format the full session to measure total size
 * 2. If under limit, return single chunk
 * 3. Otherwise, iterate entries accumulating formatted size, starting a new
 *    chunk whenever the limit would be exceeded
 *
 * @param {Array<object>} entries - Session JSONL entries (plain objects)
 * @param {number} [maxCharsPerChunk=25000] - Maximum characters per chunk
 * @returns {{ chunks: Array<Array<object>>, totalChars: number, chunkCount: number }}
 */
function chunkSession(entries, maxCharsPerChunk = DEFAULT_MAX_CHARS) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { chunks: [[]], totalChars: 0, chunkCount: 1 };
  }

  // Measure total formatted size
  const totalFormatted = formatEntriesForPrompt(entries);
  const totalChars = totalFormatted.length;

  // If fits in one chunk, return as-is
  if (totalChars <= maxCharsPerChunk) {
    return { chunks: [entries], totalChars, chunkCount: 1 };
  }

  // Find the session_metadata entry (if any) for use as context header
  const metadataEntry = entries.find(e => e && e.type === 'session_metadata') || null;

  // Split at entry boundaries
  const chunks = [];
  let currentChunk = [];
  let currentChars = 0;

  // If we have a metadata header, account for it in the first chunk
  if (metadataEntry) {
    currentChunk.push(metadataEntry);
    // Metadata entries are non-substantive so formatEntriesForPrompt won't count them,
    // but we track the JSON serialization size as rough overhead
    currentChars = JSON.stringify(metadataEntry).length;
  }

  for (const entry of entries) {
    if (!entry) continue;

    // Skip metadata entries — they're handled separately as headers
    if (entry.type === 'session_metadata') continue;

    // Measure this single entry's formatted contribution
    const entryFormatted = formatEntriesForPrompt([entry]);
    const entryChars = entryFormatted.length;

    // If adding this entry would exceed the limit AND we already have some content,
    // seal the current chunk and start a new one
    if (currentChars + entryChars > maxCharsPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk);

      // New chunk starts with metadata header for context
      currentChunk = metadataEntry ? [metadataEntry] : [];
      currentChars = metadataEntry ? JSON.stringify(metadataEntry).length : 0;
    }

    currentChunk.push(entry);
    currentChars += entryChars;
  }

  // Flush remaining entries
  if (currentChunk.length > 0) {
    // Avoid pushing a chunk that contains ONLY the metadata header
    const hasSubstantiveContent = currentChunk.some(e => e.type !== 'session_metadata');
    if (hasSubstantiveContent) {
      chunks.push(currentChunk);
    }
  }

  // Edge case: if splitting produced no chunks (shouldn't happen), return full session
  if (chunks.length === 0) {
    return { chunks: [entries], totalChars, chunkCount: 1 };
  }

  return { chunks, totalChars, chunkCount: chunks.length };
}

// ---------------------------------------------------------------------------
// prepareSessionForAnalysis
// ---------------------------------------------------------------------------

/**
 * Convenience function combining voice resolution and chunking.
 *
 * 1. Resolve voice entries to text
 * 2. Chunk resolved entries into segments under maxCharsPerChunk
 * 3. Return combined result
 *
 * @param {Array<object>} entries - Session JSONL entries
 * @param {number} [maxCharsPerChunk=25000] - Maximum characters per chunk
 * @returns {{ chunks: Array<Array<object>>, resolvedEntries: Array<object>, totalChars: number, chunkCount: number }}
 */
function prepareSessionForAnalysis(entries, maxCharsPerChunk = DEFAULT_MAX_CHARS) {
  const resolvedEntries = resolveVoiceEntries(entries);
  const { chunks, totalChars, chunkCount } = chunkSession(resolvedEntries, maxCharsPerChunk);

  return {
    chunks,
    resolvedEntries,
    totalChars,
    chunkCount
  };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  resolveVoiceEntries,
  chunkSession,
  prepareSessionForAnalysis
};
