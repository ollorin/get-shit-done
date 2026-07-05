const fs = require('fs');
const path = require('path');
const { generateEmbedding } = require('./embeddings.js');

const SYNTHESIS_CONFIG = {
  min_cluster_size: 5,       // Minimum examples to form principle
  confidence_threshold: 0.7, // Minimum confidence for valid principle
  similarity_threshold: 0.6, // Similarity for clustering
  max_principles: 20,        // Limit principles per synthesis run
  stale_days: 30             // Refresh synthesis after N days
};

// Cosine similarity between two embeddings
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Infer topic from cluster members (simple keyword extraction)
function inferTopic(members) {
  const words = {};
  for (const m of members) {
    const tokens = m.content.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);

    for (const token of tokens) {
      words[token] = (words[token] || 0) + 1;
    }
  }

  // Get top 3 most common words
  const sorted = Object.entries(words)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  return sorted.join('_') || 'general';
}

function calculateAverageSimilarity(embeddings) {
  if (embeddings.length < 2) return 1.0;

  let totalSim = 0, pairs = 0;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      totalSim += cosineSimilarity(embeddings[i], embeddings[j]);
      pairs++;
    }
  }

  return pairs > 0 ? totalSim / pairs : 0;
}

// Fallback stub — used only when no injectable synthesizer is supplied (or the
// supplied synthesizer returns nothing usable for a given cluster). Real
// synthesis is expected to come from an injected synthesizeFn (e.g. an
// Agent()/Task()-backed Haiku call at the workflow layer).
function generatePrincipleText(patterns, topic) {
  const words = patterns[0].split(' ').slice(0, 10).join(' ');
  return `For ${topic.replace(/_/g, ' ')}: ${words}...`;
}

// Simple clustering based on embedding similarity
async function clusterKnowledge(conn, options = {}) {
  const { types = ['decision', 'lesson'], limit = 100 } = options;
  const { db } = conn;

  // Get recent knowledge entries
  const entries = db.prepare(`
    SELECT id, content, type, metadata, created_at
    FROM knowledge
    WHERE type IN (${types.map(() => '?').join(',')})
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...types, Date.now(), limit);

  if (entries.length < SYNTHESIS_CONFIG.min_cluster_size) {
    return { clusters: [], reason: 'insufficient_knowledge' };
  }

  // Generate embeddings for all entries
  const embeddings = new Map();
  for (const entry of entries) {
    const emb = await generateEmbedding(entry.content);
    if (emb) embeddings.set(entry.id, emb);
  }

  // Simple greedy clustering
  const clusters = [];
  const assigned = new Set();

  for (const entry of entries) {
    if (assigned.has(entry.id)) continue;

    const embedding = embeddings.get(entry.id);
    if (!embedding) continue;

    // Start new cluster
    const cluster = {
      seed: entry,
      members: [entry],
      embeddings: [embedding]
    };
    assigned.add(entry.id);

    // Find similar entries
    for (const other of entries) {
      if (assigned.has(other.id)) continue;

      const otherEmb = embeddings.get(other.id);
      if (!otherEmb) continue;

      // Calculate cosine similarity
      const similarity = cosineSimilarity(embedding, otherEmb);

      if (similarity >= SYNTHESIS_CONFIG.similarity_threshold) {
        cluster.members.push(other);
        cluster.embeddings.push(otherEmb);
        assigned.add(other.id);
      }
    }

    // Only keep clusters meeting minimum size
    if (cluster.members.length >= SYNTHESIS_CONFIG.min_cluster_size) {
      cluster.topic = inferTopic(cluster.members);
      cluster.size = cluster.members.length;
      clusters.push(cluster);
    }
  }

  return { clusters };
}

function extractPrinciple(cluster) {
  const { members, topic } = cluster;

  // Find common patterns in member content
  const patterns = members.map(m => m.content);

  // Calculate confidence based on cluster cohesion
  // More members + more similar = higher confidence
  const avgSimilarity = calculateAverageSimilarity(cluster.embeddings);
  const sizeBonus = Math.min(members.length / 10, 0.2);  // Max 0.2 bonus
  const confidence = Math.min(avgSimilarity + sizeBonus, 1.0);

  // Fallback principle text (real text is substituted in synthesizePrinciples
  // when an injectable synthesizeFn is supplied — see A2 in 49-03-PLAN.md)
  const principleText = generatePrincipleText(patterns, topic);

  return {
    topic,
    rule: principleText,
    confidence,
    examples: patterns.slice(0, 5),  // Store up to 5 examples
    source_count: members.length,
    source_ids: members.map(m => m.id),
    created_at: Date.now()
  };
}

// Build a principle-shaped object suitable for knowledge-conflicts.js's
// resolvePrincipleConflict(). scorePrinciple() already defaults a missing
// metadata.category to 'convenience' internally, so we only need to ensure
// confidence is present — category is left to that built-in default unless
// the row already specifies one.
function buildExistingConflictObject(row) {
  let meta = {};
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : {};
  } catch (_) {
    meta = {};
  }
  return {
    content: row.content,
    metadata: {
      ...meta,
      confidence: meta.confidence !== undefined ? meta.confidence : 0.7
    },
    __existing_id: row.id
  };
}

function buildCandidateConflictObject(principle) {
  return {
    content: principle.rule,
    metadata: {
      confidence: principle.confidence
    },
    __is_candidate: true
  };
}

async function synthesizePrinciples(conn, options = {}, synthesizeFn) {
  const { db } = conn;

  // A1: circuit breaker gate — checked BEFORE any costly clustering/embedding
  // work fires (clusterKnowledge generates embeddings for up to `limit`
  // entries). Both the automatic (workflow) path and the manual `knowledge
  // consolidate` backstop call this same function, so both get this
  // protection for free.
  const { shouldBlockCostlyAction } = require('./knowledge-cost.js');
  const breakerState = shouldBlockCostlyAction(db);
  if (breakerState.blocked) {
    return {
      synthesized: 0,
      reason: 'circuit_breaker_blocked',
      blocked_reason: breakerState.reason,
      clusters_found: 0,
      conflicts_flagged: 0,
      principles: []
    };
  }

  // Get clusters
  const { clusters, reason } = await clusterKnowledge(conn, options);

  if (reason) {
    return { synthesized: 0, reason, clusters_found: 0, conflicts_flagged: 0, principles: [] };
  }

  const principles = [];
  let conflictsFlagged = 0;

  for (const cluster of clusters.slice(0, SYNTHESIS_CONFIG.max_principles)) {
    const principle = extractPrinciple(cluster);

    // Only proceed if confidence meets threshold
    if (principle.confidence < SYNTHESIS_CONFIG.confidence_threshold) {
      continue;
    }

    // A2: injectable synthesizer — if supplied and it returns usable text,
    // that text replaces the stub. If it returns nothing (undefined/null/
    // empty string), fall through to the stub already computed above.
    if (synthesizeFn) {
      const synthesizedText = await synthesizeFn(cluster);
      if (synthesizedText !== undefined && synthesizedText !== null && synthesizedText !== '') {
        principle.rule = synthesizedText;
      }
    }

    // A3: conflict detection — query existing same-topic principles before
    // inserting. If none exist, proceed straight to insertOrEvolve (unchanged
    // behavior). If one or more exist, resolve via knowledge-conflicts.js
    // and never silently overwrite an ambiguous conflict.
    const existingRows = db.prepare(
      "SELECT id, content, metadata FROM knowledge WHERE type = 'principle' AND json_extract(metadata, '$.topic') = ?"
    ).all(principle.topic);

    let skipInsert = false;

    if (existingRows.length > 0) {
      const { resolvePrincipleConflict } = require('./knowledge-conflicts.js');

      const existingObjs = existingRows.map(buildExistingConflictObject);
      const candidateObj = buildCandidateConflictObject(principle);

      const conflictResult = resolvePrincipleConflict([...existingObjs, candidateObj]);

      if (conflictResult.resolved === false) {
        // Ambiguous priority — flag to the review artifact, never overwrite.
        try {
          const conflictsDir = path.join(process.cwd(), '.planning', 'knowledge');
          fs.mkdirSync(conflictsDir, { recursive: true });
          const conflictRecord = {
            topic: principle.topic,
            existing_ids: existingRows.map(r => r.id),
            candidate_text: principle.rule,
            reason: conflictResult.message,
            flagged_at: Date.now()
          };
          fs.appendFileSync(
            path.join(conflictsDir, 'CONFLICTS.jsonl'),
            JSON.stringify(conflictRecord) + '\n'
          );
        } catch (_) {
          // Non-fatal: a conflict-logging failure must never crash synthesis.
        }
        conflictsFlagged++;
        skipInsert = true;
      } else if (conflictResult.resolved === true && !conflictResult.chosen.__is_candidate) {
        // An existing principle wins — the new candidate is skipped, but
        // nothing was overwritten, so this is not a flagged conflict.
        skipInsert = true;
      }
      // else: candidate wins (or resolved === true with __is_candidate) —
      // proceed to insertOrEvolve below, same as the no-existing-rows path.
    }

    if (skipInsert) continue;

    // Store as 'principle' type knowledge
    const { insertOrEvolve } = require('./knowledge-evolution.js');
    const embedding = await generateEmbedding(principle.rule);

    const result = await insertOrEvolve(conn, {
      content: principle.rule,
      type: 'principle',
      scope: 'global',  // Principles are global
      embedding,
      metadata: {
        topic: principle.topic,
        confidence: principle.confidence,
        examples: principle.examples,
        source_count: principle.source_count,
        source_ids: principle.source_ids,
        synthesized_at: Date.now()
      }
    });

    principles.push({
      ...principle,
      action: result.action,
      id: result.id
    });
  }

  return {
    synthesized: principles.length,
    clusters_found: clusters.length,
    conflicts_flagged: conflictsFlagged,
    principles
  };
}

module.exports = {
  SYNTHESIS_CONFIG,
  clusterKnowledge,
  extractPrinciple,
  cosineSimilarity,
  generatePrincipleText,
  synthesizePrinciples
};
