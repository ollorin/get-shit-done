#!/usr/bin/env node

/**
 * session-end-standalone.js
 * Claude Code Stop hook — lightweight session-end handler.
 *
 * Knowledge extraction now happens at phase start via mine-conversations
 * (Haiku-based, captures all reasoning types — not just technical).
 *
 * This hook:
 * - Reads stdin (Claude Code protocol requirement)
 * - Cleans up /tmp/gsd-session-* temp files from previous implementation
 * - Always exits 0 — never blocks Claude from stopping
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function main() {
  // Consume stdin — required by Claude Code hook protocol
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch (_) {}

  // Clean up old temp files left by previous regex-extraction implementation
  cleanupOldTempFiles();

  // Prune stale knowledge entries + checkpoint the WAL, non-blocking.
  runKnowledgeMaintenance();

  process.exit(0);
}

function cleanupOldTempFiles() {
  try {
    const files = fs.readdirSync(os.tmpdir());
    const now = Date.now();
    for (const f of files) {
      if (!f.startsWith('gsd-session-')) continue;
      if (!f.endsWith('.txt') && !f.endsWith('.done')) continue;
      const fp = path.join(os.tmpdir(), f);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > MAX_AGE_MS) fs.unlinkSync(fp);
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Prune stale knowledge entries and checkpoint the WAL at session end.
 * Entirely best-effort: module absence (e.g. better-sqlite3 not installed),
 * DB unavailability, or any error during prune/checkpoint is swallowed
 * silently (logged to stderr only). This function must NEVER throw and
 * must NEVER be the reason this hook exits non-zero or hangs.
 */
function runKnowledgeMaintenance() {
  try {
    const { openKnowledgeDB } = require('../knowledge-db.js');
    const { pruneStaleEntries, checkpointWAL } = require('../knowledge-lifecycle.js');

    const conn = openKnowledgeDB('global');
    pruneStaleEntries(conn.db, { scope: 'global', vectorEnabled: conn.vectorEnabled });
    checkpointWAL(conn.db);
  } catch (err) {
    try {
      process.stderr.write('[session-end] knowledge maintenance skipped: ' + (err && err.message) + '\n');
    } catch (_) {}
  }
}

main().catch(() => process.exit(0));
