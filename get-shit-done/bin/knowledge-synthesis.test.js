/**
 * Consolidation must never persist placeholder/unsynthesized principles.
 * Uses an isolated temp DB via GSD_KNOWLEDGE_DB_PATH (never the live DB).
 */
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STUB = 'For database migration rollback: Always write the rollback script before the forward...';

describe('consolidation placeholder guard', () => {
  let tmpDbPath;
  let prev;
  let conn;

  beforeEach(async () => {
    prev = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(os.tmpdir(), `gsd-test-synthesis-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
    const { openKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');
    const { generateEmbedding } = require('./embeddings.js');
    conn = openKnowledgeDB('global');
    const content = 'always write the rollback script before the forward migration';
    const embedding = await generateEmbedding(content);
    for (let i = 0; i < 5; i++) {
      insertKnowledge(conn.db, { content, type: 'lesson', scope: 'global', embedding });
    }
  });

  afterEach(() => {
    const { closeKnowledgeDB } = require('./knowledge-db.js');
    try { closeKnowledgeDB(conn.db); } catch (_) { /* best-effort */ }
    for (const s of ['', '-wal', '-shm']) fs.rmSync(tmpDbPath + s, { force: true });
    if (prev === undefined) delete process.env.GSD_KNOWLEDGE_DB_PATH;
    else process.env.GSD_KNOWLEDGE_DB_PATH = prev;
  });

  const principleCount = () => conn.db.prepare("SELECT COUNT(*) AS n FROM knowledge WHERE type = 'principle'").get().n;

  test('no synthesizer: reports synthesis_not_run, returns clusters, writes nothing', async () => {
    const { synthesizePrinciples } = require('./knowledge-synthesis.js');
    const r = await synthesizePrinciples(conn, {});
    assert.strictEqual(r.reason, 'synthesis_not_run');
    assert.strictEqual(r.synthesized, 0);
    assert.ok(r.clusters_found >= 1 && r.clusters.length === r.clusters_found);
    assert.strictEqual(principleCount(), 0);
  });

  test('synthesizer returning empty or a stub is skipped, not stored', async () => {
    const { synthesizePrinciples } = require('./knowledge-synthesis.js');
    for (const text of ['', undefined, STUB, '{{principle}}']) {
      const r = await synthesizePrinciples(conn, {}, () => text);
      assert.strictEqual(r.synthesized, 0);
      assert.ok(r.skipped_unsynthesized >= 1);
    }
    assert.strictEqual(principleCount(), 0);
  });

  test('real synthesized text is stored with synthesis_source provenance', async () => {
    const { synthesizePrinciples } = require('./knowledge-synthesis.js');
    const r = await synthesizePrinciples(conn, {}, () => 'Write the rollback script before the forward migration so every deploy is reversible.');
    assert.strictEqual(r.synthesized, 1);
    const row = conn.db.prepare("SELECT metadata FROM knowledge WHERE type = 'principle'").get();
    assert.strictEqual(JSON.parse(row.metadata).synthesis_source, 'synthesizer');
  });

  test('write path rejects placeholder principle text and missing provenance', async () => {
    const { insertKnowledge, isPlaceholderPrincipleText } = require('./knowledge-crud.js');
    const { insertOrEvolve } = require('./knowledge-evolution.js');
    assert.ok(isPlaceholderPrincipleText(STUB));
    assert.ok(!isPlaceholderPrincipleText('Write rollback scripts first.'));
    assert.throws(() => insertKnowledge(conn.db, { content: STUB, type: 'principle', scope: 'global' }), /placeholder/);
    await assert.rejects(
      insertOrEvolve(conn, { content: STUB, type: 'principle', scope: 'global', metadata: { synthesis_source: 'x' } }),
      /placeholder/
    );
    await assert.rejects(
      insertOrEvolve(conn, { content: 'Write rollback scripts first.', type: 'principle', scope: 'global', metadata: {} }),
      /provenance/
    );
    assert.strictEqual(principleCount(), 0);
  });

  test('placeholder predicate rejects bare tokens and stubs, accepts real sentences', async () => {
    const { isPlaceholderPrincipleText } = require('./knowledge-crud.js');
    for (const text of ['TODO', 'tbd.', '...', '{{principle}}', '', 'For x y: words...', STUB]) {
      assert.ok(isPlaceholderPrincipleText(text), `expected placeholder: ${JSON.stringify(text)}`);
    }
    for (const text of [
      'Todo comments must carry a ticket id.',
      'Placeholder text in forms must not replace labels.',
      'Use {{var}} in Handlebars templates.',
    ]) {
      assert.ok(!isPlaceholderPrincipleText(text), `expected accepted: ${JSON.stringify(text)}`);
    }
  });

  test('processExtractionBatch skips principle extractions without granting provenance', async () => {
    const { processExtractionBatch } = require('./knowledge-evolution.js');
    const r = await processExtractionBatch(conn, [
      { content: 'Write the rollback script before the forward migration.', type: 'principle' },
      { content: 'Always write rollback scripts first.', type: 'principle' },
    ]);
    assert.strictEqual(r.skipped_principles, 2);
    assert.strictEqual(r.created, 0);
    assert.strictEqual(r.errors.length, 0);
    assert.strictEqual(principleCount(), 0);
  });
});
