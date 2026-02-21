#!/usr/bin/env node
/**
 * backfill-embeddings.js
 *
 * One-time script to generate vector embeddings for knowledge DB entries
 * that were inserted when @xenova/transformers was unavailable.
 *
 * Usage:
 *   node scripts/backfill-embeddings.js           # run
 *   node scripts/backfill-embeddings.js --dry-run  # preview only
 */

'use strict'

const path = require('path')
const os = require('os')

const GSD_BIN = path.join(os.homedir(), '.claude', 'get-shit-done', 'bin')

const { openKnowledgeDB } = require(path.join(GSD_BIN, 'knowledge-db.js'))
const { generateEmbedding } = require(path.join(GSD_BIN, 'embeddings.js'))

const isDryRun = process.argv.includes('--dry-run')

function normalizeEmbedding(embedding) {
  const arr = embedding instanceof Float32Array ? embedding : new Float32Array(embedding)
  const norm = Math.sqrt(arr.reduce((sum, val) => sum + val * val, 0))
  if (norm < 1e-12) return arr
  return new Float32Array(arr.map(v => v / norm))
}

async function main() {
  const conn = openKnowledgeDB('global')
  const { db, vectorEnabled } = conn

  if (!vectorEnabled) {
    console.error('Vector support not available (sqlite-vec not loaded). Aborting.')
    process.exit(1)
  }

  // Get all knowledge ids
  const allIds = db.prepare('SELECT id FROM knowledge ORDER BY id').all().map(r => r.id)

  // Get all vec rowids (plain SELECT without MATCH works for rowid-only queries)
  let vecIds
  try {
    vecIds = new Set(db.prepare('SELECT rowid FROM knowledge_vec').all().map(r => r.rowid))
  } catch (err) {
    // Some sqlite-vec versions don't allow full-table scan — fall back to checking per-row
    console.warn('Full vec scan unavailable, using per-row check:', err.message)
    vecIds = null
  }

  // Find missing ids
  let missingIds
  if (vecIds !== null) {
    missingIds = allIds.filter(id => !vecIds.has(id))
  } else {
    // Fall back: try a point-lookup for each id
    missingIds = []
    for (const id of allIds) {
      try {
        const row = db.prepare('SELECT rowid FROM knowledge_vec WHERE rowid = ?').get(id)
        if (!row) missingIds.push(id)
      } catch (_) {
        missingIds.push(id)
      }
    }
  }

  if (missingIds.length === 0) {
    console.log('All knowledge entries already have embeddings. Nothing to do.')
    db.close()
    return
  }

  // Fetch content for missing ids
  const placeholders = missingIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT id, content FROM knowledge WHERE id IN (${placeholders}) ORDER BY id`).all(...missingIds)

  console.log(`Found ${rows.length} entries missing embeddings (total: ${allIds.length}).`)

  if (isDryRun) {
    console.log('Dry run — no changes will be made.')
    rows.forEach(r => console.log(`  id=${r.id}: ${r.content.slice(0, 80).replace(/\n/g, ' ')}…`))
    db.close()
    return
  }

  // sqlite-vec vec0 does not support bound parameters for rowid — use literal SQL per row
  let ok = 0
  let failed = 0

  for (const row of rows) {
    process.stdout.write(`  [${ok + failed + 1}/${rows.length}] id=${row.id} ... `)
    try {
      const raw = await generateEmbedding(row.content)
      if (!raw) {
        console.log('skipped (embedding returned null)')
        failed++
        continue
      }
      const normalized = normalizeEmbedding(raw)
      // Use literal rowid in SQL — bound integer params are rejected by sqlite-vec vec0
      db.prepare(`INSERT INTO knowledge_vec(rowid, embedding) VALUES (${row.id}, ?)`).run(normalized)
      console.log('ok')
      ok++
    } catch (err) {
      console.log(`error: ${err.message}`)
      failed++
    }
  }

  console.log(`\nDone. ${ok} embeddings generated, ${failed} failed/skipped.`)
  db.close()
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
