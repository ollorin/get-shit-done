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
const { execFileSync } = require('child_process');

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAINTENANCE_TIMEOUT_MS = 5000;    // hard wall-clock cap on the child
const WATCHDOG_MS = 8000;               // absolute ceiling on the whole hook

async function main() {
  // Absolute belt-and-suspenders ceiling: even if stdin never ends or an
  // unexpected async path stalls, force a clean stop. .unref() so it never
  // keeps the process alive on its own.
  const watchdog = setTimeout(() => process.exit(0), WATCHDOG_MS);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  // Consume stdin — required by Claude Code hook protocol
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch (_) {}

  // Clean up old temp files left by previous regex-extraction implementation
  cleanupOldTempFiles();

  // Prune stale knowledge entries + checkpoint the WAL, hard-bounded so a grown
  // DB can never hang session end.
  runKnowledgeMaintenanceBounded();

  process.exit(0);
}

/**
 * Run the (synchronous, better-sqlite3) knowledge maintenance in a child
 * process with a hard kill deadline. A Promise.race / setTimeout cannot
 * interrupt synchronous native SQLite work on the single main thread — only an
 * out-of-process kill deadline actually bounds it. On timeout the OS SIGTERMs
 * the child and execFileSync throws; we swallow it (best-effort, never blocks
 * the stop). Also guards the case where `timeout` isn't available on the
 * platform (e.g. stock macOS) — the bound lives here, in-process, regardless.
 */
function runKnowledgeMaintenanceBounded() {
  try {
    execFileSync(process.execPath, [__filename, '--run-maintenance'], {
      timeout: MAINTENANCE_TIMEOUT_MS,
      stdio: 'ignore',
    });
  } catch (err) {
    // ETIMEDOUT / SIGTERM (deadline hit), module absence, or any DB error — all
    // best-effort. Log to stderr only; never fail or hang the stop.
    try {
      process.stderr.write('[session-end] knowledge maintenance skipped/bounded: ' + (err && err.message) + '\n');
    } catch (_) {}
  }
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

// Child-process entry: run only the bounded maintenance, never re-enter main()
// (which would recursively spawn another child and block on stdin).
if (process.argv.includes('--run-maintenance')) {
  runKnowledgeMaintenance();
  process.exit(0);
} else {
  main().catch(() => process.exit(0));
}
