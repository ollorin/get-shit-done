#!/usr/bin/env node
// canary-gate: runs every guard in GUARD_REGISTRY against its own known-bad corpus and fails if a guard reports clean on
// a fixture it must flag. A guard that cannot be shown to fail is a green light of unknown provenance.
//
// Discovery: for each registry id the corpus is canaries/<id>.canaries.mjs (next to this file), loaded with a dynamic
// import; it exports CANARIES, an array of { name, why, detect } where detect() returns exactly `true` when the real
// guard function flags the fixture (false, a truthy non-boolean and a promise are all misses). A missing file, a failed import or a missing export fails the gate naming the id.
// A *.canaries.mjs file whose id is not in the registry is printed as PHANTOM and does not change the exit code.
// Usage: node scripts/validation/canary-gate.mjs [--json]      Exit: 0 clean, 1 any failure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GUARD_REGISTRY, validateRegistry } from './guard-registry.mjs';

/** Minimum fixtures per guard. Enforced, not trusted. */
export const MIN_FIXTURES_PER_GUARD = 3;
const CORPUS_SUFFIX = '.canaries.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Pure: registry ids with no corpus fixture, and corpus ids the registry does not know. */
export function reconcileCorpusCoverage(corpusGuardIds, registryIds) {
  const corpusSet = new Set(corpusGuardIds);
  const registrySet = new Set(registryIds);
  return {
    uncoveredGuards: registryIds.filter((id) => !corpusSet.has(id)),
    phantomCorpusIds: [...new Set(corpusGuardIds)].filter((id) => !registrySet.has(id)),
  };
}

/** Pure: runs every fixture's detect(), reconciles coverage, enforces the floor. Only a result `=== true` counts as
 *  flagged; a throwing detect() is a miss. */
export function evaluateCanaries(corpus, registryIds) {
  const missedFixtures = [];
  for (const fixture of corpus) {
    try {
      const result = fixture.detect();
      if (result !== true) {
        const reason = result === false ? 'reported clean'
          : typeof result?.then === 'function' ? 'detect() returned a promise; it must be synchronous and return true'
            : `detect() did not return true (returned ${JSON.stringify(result) ?? String(result)})`;
        missedFixtures.push({ guardId: fixture.guardId, name: fixture.name, why: fixture.why, reason });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      missedFixtures.push({ guardId: fixture.guardId, name: fixture.name, why: fixture.why, reason: `detect() threw: ${message}` });
    }
  }
  const { uncoveredGuards } = reconcileCorpusCoverage(corpus.map((c) => c.guardId), registryIds);
  const counts = new Map();
  for (const fixture of corpus) counts.set(fixture.guardId, (counts.get(fixture.guardId) ?? 0) + 1);
  const uncovered = new Set(uncoveredGuards);
  const undersizedCorpora = registryIds
    .filter((id) => !uncovered.has(id))
    .map((id) => ({ guardId: id, count: counts.get(id) ?? 0 }))
    .filter((entry) => entry.count < MIN_FIXTURES_PER_GUARD);
  return { missedFixtures, uncoveredGuards, undersizedCorpora };
}

export function exitCodeFor(result) {
  const clean = result.missedFixtures.length === 0 && result.uncoveredGuards.length === 0 && result.undersizedCorpora.length === 0
    && (result.unreadableCorpora ?? []).length === 0 && (result.registryProblems ?? []).length === 0;
  return clean ? 0 : 1;
}

/** Loads canaries/<id>.canaries.mjs for each id. Returns { corpus, unreadableCorpora, phantomCorpusIds }. */
export async function loadCorpus(dir, registryIds) {
  const corpus = [];
  const unreadableCorpora = [];
  for (const id of registryIds) {
    const file = path.join(dir, 'canaries', id + CORPUS_SUFFIX);
    if (!fs.existsSync(file)) { unreadableCorpora.push({ guardId: id, reason: `missing corpus file ${path.relative(dir, file)}` }); continue; }
    let mod;
    try { mod = await import(pathToFileURL(file).href); } catch (err) { unreadableCorpora.push({ guardId: id, reason: `import failed: ${err instanceof Error ? err.message : err}` }); continue; }
    const list = mod.CANARIES;
    const bad = !Array.isArray(list) || list.some((c) => !c || typeof c.name !== 'string' || typeof c.why !== 'string' || typeof c.detect !== 'function');
    if (bad) { unreadableCorpora.push({ guardId: id, reason: 'CANARIES missing or not an array of { name, why, detect }' }); continue; }
    for (const c of list) corpus.push({ guardId: id, name: c.name, why: c.why, detect: c.detect });
  }
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'canaries')); } catch { /* no corpus directory: every id reports a missing file */ }
  const present = files.filter((f) => f.endsWith(CORPUS_SUFFIX)).map((f) => f.slice(0, -CORPUS_SUFFIX.length));
  return { corpus, unreadableCorpora, phantomCorpusIds: reconcileCorpusCoverage(present, registryIds).phantomCorpusIds };
}

function printHumanReport(result, corpus, registryIds, phantomCorpusIds) {
  const counts = new Map();
  for (const f of corpus) counts.set(f.guardId, (counts.get(f.guardId) ?? 0) + 1);
  console.log(`[canary-gate] ${registryIds.length} registry guard(s), ${corpus.length} total canary fixture(s):`);
  for (const id of registryIds) console.log(`  ${id}: ${counts.get(id) ?? 0} fixture(s)`);
  for (const p of result.registryProblems) console.log(`  REGISTRY INVALID: ${p}`);
  for (const u of result.unreadableCorpora) console.log(`  UNREADABLE ${u.guardId}: ${u.reason}`);
  if (result.uncoveredGuards.length > 0) console.log(`  UNCOVERED (zero fixtures, structural gap): ${result.uncoveredGuards.join(', ')}`);
  for (const u of result.undersizedCorpora) console.log(`  UNDERSIZED ${u.guardId}: only ${u.count} fixture(s), needs >= ${MIN_FIXTURES_PER_GUARD}`);
  for (const id of phantomCorpusIds) console.log(`  PHANTOM ${id}: a corpus file with no registry row (not a failure)`);
  if (result.missedFixtures.length > 0) {
    console.log('[canary-gate] FAILED: the following guard(s) did NOT fail their own known-bad canary:');
    for (const m of result.missedFixtures) {
      console.log(`  [${m.guardId}] "${m.name}": ${m.reason}`);
      console.log(`      why this fixture must be caught: ${m.why}`);
    }
  }
  if (exitCodeFor(result) === 0 && registryIds.length === 0) console.log('  OK: nothing registered; there is no guard to run a canary against.');
  else if (exitCodeFor(result) === 0) console.log(`  OK: every guard still fails every fixture in its own corpus; every registry id has >= ${MIN_FIXTURES_PER_GUARD} fixtures.`);
}

async function main() {
  const registryProblems = validateRegistry(GUARD_REGISTRY);
  const registryIds = registryProblems.length === 0 ? GUARD_REGISTRY.map((g) => g.id) : [];
  const { corpus, unreadableCorpora, phantomCorpusIds } = await loadCorpus(HERE, registryIds);
  const result = { ...evaluateCanaries(corpus, registryIds), unreadableCorpora, registryProblems };
  // An unreadable corpus is reported once, as UNREADABLE, not also as UNCOVERED.
  const unreadable = new Set(unreadableCorpora.map((u) => u.guardId));
  result.uncoveredGuards = result.uncoveredGuards.filter((id) => !unreadable.has(id));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...result, phantomCorpusIds }, null, 2));
  else printHumanReport(result, corpus, registryIds, phantomCorpusIds);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
