/**
 * knowledge-writer.test.js
 *
 * Regression coverage for a bug where storeInsights() generated a real
 * embedding for dedup purposes but then discarded it (hardcoded
 * `embedding: null` at both insertOrEvolve call sites), so newly stored
 * knowledge rows never got a matching knowledge_vec entry. A test that only
 * checks the returned stored/evolved counts would NOT catch this — it must
 * inspect actual DB state (LEFT JOIN knowledge <-> knowledge_vec).
 *
 * CRITICAL — SHARED-DB CAUTION: ~/.claude/knowledge/ is a LIVE database
 * written by session hooks in this environment. Every test here sets
 * GSD_KNOWLEDGE_DB_PATH to an isolated temp file before opening anything,
 * and cleans up afterward. Mirrors knowledge-safety.test.js's convention.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('storeInsights embedding persistence (regression)', () => {
  let tmpDbPath;
  let prevOverride;

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      os.tmpdir(),
      `gsd-test-knowledge-writer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
  });

  afterEach(() => {
    const { closeKnowledgeDB } = require('./knowledge-db.js');
    // openKnowledgeDB caches connections by resolved dbPath, so re-opening
    // here returns the same connection storeInsights used.
    try {
      const { openKnowledgeDB } = require('./knowledge-db.js');
      const conn = openKnowledgeDB('global');
      closeKnowledgeDB(conn.db);
    } catch (_) { /* best-effort */ }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('a newly-created insight gets a matching knowledge_vec row, not just a stored count', async () => {
    const { storeInsights } = require('./knowledge-writer.js');
    const { openKnowledgeDB } = require('./knowledge-db.js');
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-test-cwd-'));

    try {
      const uniqueContent = `always verify embeddings are persisted before trusting semantic search ${Date.now()}-${Math.random()}`;

      const result = await storeInsights(
        [{ type: 'reasoning_pattern', description: uniqueContent }],
        { cwd: tmpCwd }
      );

      assert.strictEqual(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
      assert.strictEqual(result.stored, 1, 'a brand-new, unique insight should be stored (created), not evolved/skipped');

      const conn = openKnowledgeDB('global');
      const row = conn.db
        .prepare('SELECT id FROM knowledge WHERE content = ?')
        .get(uniqueContent);
      assert.ok(row, 'expected the inserted knowledge row to exist');

      if (!conn.vectorEnabled) {
        // sqlite-vec unavailable in this environment — the embedding-persistence
        // path this test targets cannot be exercised at all here.
        assert.fail('sqlite-vec extension unavailable — cannot verify embedding persistence in this environment');
      }

      const vecRow = conn.db
        .prepare('SELECT rowid FROM knowledge_vec WHERE rowid = ?')
        .get(row.id);

      assert.ok(
        vecRow,
        `Expected a knowledge_vec row with rowid=${row.id} (the embedding computed for dedup must also be persisted on insert)`
      );
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});
