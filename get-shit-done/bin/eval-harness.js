#!/usr/bin/env node
'use strict';

/**
 * Eval Harness (MILE-29) -- pure assertion/parser functions used to check
 * REAL artifacts produced by a live plan->execute->verify run against the
 * behavioral eval fixture (tests/fixtures/eval-project/), rather than
 * trusting prose. No LLM calls, no network calls -- unit-testable exactly
 * the way get-shit-done/bin/model-registry.js is.
 *
 * Fail-safe convention (mirrors filterContentForSecrets/computeManifestDrift
 * elsewhere in this codebase): every function here degrades gracefully on
 * missing/malformed input, returning `pass: false` (or `ok: false`) with a
 * reason -- it never throws for a data problem. The single intentional
 * exception is buildSpawnPlan's model-registry config-drift guard, which is
 * a deliberate throw on a genuine environment/config bug, not a data
 * problem with the fixture.
 */

const fs = require('fs');
const path = require('path');
const { getTiers } = require('./model-registry.js');

// The fixed sequence of agent spawns a correct live run of plan->execute->
// verify produces for each phase in the fixture's ROADMAP.md.
const AGENT_SEQUENCE = ['gsd-phase-researcher', 'gsd-planner', 'gsd-executor', 'gsd-verifier'];

// Matches this fixture's ROADMAP.md heading convention: `#### Phase 01: Add function`
// (2-4 leading '#' tolerated to match this repo's own ROADMAP.md heading depth
// conventions, e.g. `#### Phase 18: ...`).
const PHASE_HEADING_RE = /^#{2,4}\s*Phase\s+(\d+):\s*(.+)$/gm;

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Derives the ordered list of {phase, agent, tier} spawns a correct live run
// of plan->execute->verify against `fixtureRoadmapPath` SHOULD produce. Tier
// is always forced to 'haiku' regardless of any model_profile config -- eval
// runs must stay cheap. Does not hardcode a literal tier-id string from the
// registry; it only validates 'haiku' is a known tier and throws if the
// registry doesn't recognize it (config drift guard -- an intentional throw,
// not a data-safety violation, since this signals a genuine environment bug).
function buildSpawnPlan(fixtureRoadmapPath) {
  let content;
  try {
    content = fs.readFileSync(fixtureRoadmapPath, 'utf8');
  } catch (_e) {
    return [];
  }

  const tiers = getTiers();
  if (!Array.isArray(tiers) || !tiers.includes('haiku')) {
    throw new Error("eval-harness: model-registry does not recognize tier 'haiku' -- config drift guard tripped");
  }

  const plan = [];
  let match;
  PHASE_HEADING_RE.lastIndex = 0;
  while ((match = PHASE_HEADING_RE.exec(content)) !== null) {
    const phaseNum = match[1];
    const phaseName = match[2].trim();
    const phaseSlug = `${phaseNum.padStart(2, '0')}-${slugify(phaseName)}`;
    for (const agent of AGENT_SEQUENCE) {
      plan.push({ phase: phaseSlug, agent, tier: 'haiku' });
    }
  }
  return plan;
}

// Reads a JSON array of {phase, agent, tier, timestamp} entries written by
// whoever actually drove the live run (see get-shit-done/workflows/eval-harness.md).
// Returns { ok: true, entries: [...] } or { ok: false, error } -- never throws.
function parseSpawnTrace(traceFilePath) {
  let content;
  try {
    content = fs.readFileSync(traceFilePath, 'utf8');
  } catch (e) {
    return { ok: false, error: `Could not read spawn trace file: ${e.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: `Malformed JSON in spawn trace file: ${e.message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Spawn trace must be a JSON array' };
  }
  return { ok: true, entries: parsed };
}

// Diffs actual trace entries against the expected plan. Returns
// { pass: boolean, missing: [...], extra: [...], wrong_tier: [...] }.
function assertAgentsSpawned(expectedPlan, actualTrace) {
  const safeExpected = Array.isArray(expectedPlan) ? expectedPlan : [];
  const safeActual = Array.isArray(actualTrace) ? actualTrace : [];

  const missing = [];
  const wrongTier = [];
  const matchedActualIndices = new Set();

  for (const expected of safeExpected) {
    const idx = safeActual.findIndex((entry, i) =>
      !matchedActualIndices.has(i) &&
      entry && entry.phase === expected.phase && entry.agent === expected.agent
    );
    if (idx === -1) {
      missing.push(expected);
      continue;
    }
    matchedActualIndices.add(idx);
    const actual = safeActual[idx];
    if (actual.tier !== expected.tier) {
      wrongTier.push({ expected, actual });
    }
  }

  const extra = safeActual.filter((_entry, i) => !matchedActualIndices.has(i));
  const pass = missing.length === 0 && wrongTier.length === 0 && extra.length === 0;

  return { pass, missing, extra, wrong_tier: wrongTier };
}

// Looks for a *-VERIFICATION.md under each phase dir inside
// `artifactsRoot/phases/` and checks it reports a passed status. Returns
// { pass: boolean, phases: [{ phase, found: bool, status: string|null }] }.
function assertGatesFired(artifactsRoot) {
  const phasesRoot = path.join(artifactsRoot || '', 'phases');
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(phasesRoot, { withFileTypes: true });
  } catch (_e) {
    return { pass: false, phases: [] };
  }

  const dirNames = dirEntries.filter(d => d.isDirectory()).map(d => d.name).sort();
  const phases = [];
  let pass = dirNames.length > 0;

  for (const dirName of dirNames) {
    const dirPath = path.join(phasesRoot, dirName);
    let files;
    try {
      files = fs.readdirSync(dirPath);
    } catch (_e) {
      files = [];
    }
    const verificationFile = files.find(f => /-VERIFICATION\.md$/i.test(f));
    if (!verificationFile) {
      phases.push({ phase: dirName, found: false, status: null });
      pass = false;
      continue;
    }
    let content = '';
    try {
      content = fs.readFileSync(path.join(dirPath, verificationFile), 'utf8');
    } catch (_e) {
      content = '';
    }
    const statusMatch = content.match(/\*\*Status:?\*\*\s*`?([A-Za-z_]+)`?/i) || content.match(/Status:\s*`?([A-Za-z_]+)`?/i);
    const status = statusMatch ? statusMatch[1].toLowerCase() : null;
    const found = status === 'passed';
    if (!found) pass = false;
    phases.push({ phase: dirName, found: true, status });
  }

  return { pass, phases };
}

// `expectSkip` is a map of { [phaseName]: boolean } saying which phases are
// expected to have deferred a step. For each phase where expectSkip is true,
// requires DEFERRED.json to exist under that phase dir with a non-empty
// `reason`. For phases where expectSkip is false/absent, passes trivially
// regardless of whether DEFERRED.json exists. Returns
// { pass: boolean, phases: [{ phase, expected: bool, found: bool }] }.
function assertDeferredWritten(artifactsRoot, expectSkip) {
  const phasesRoot = path.join(artifactsRoot || '', 'phases');
  const safeExpectSkip = (expectSkip && typeof expectSkip === 'object') ? expectSkip : {};

  const phases = [];
  let pass = true;

  for (const phaseName of Object.keys(safeExpectSkip)) {
    const expected = !!safeExpectSkip[phaseName];
    if (!expected) {
      phases.push({ phase: phaseName, expected: false, found: null });
      continue;
    }

    const deferredPath = path.join(phasesRoot, phaseName, 'DEFERRED.json');
    let found = false;
    try {
      const content = fs.readFileSync(deferredPath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        found = parsed.some(e => e && typeof e.reason === 'string' && e.reason.trim().length > 0);
      }
    } catch (_e) {
      found = false;
    }

    if (!found) pass = false;
    phases.push({ phase: phaseName, expected: true, found });
  }

  return { pass, phases };
}

// Parses `git log --oneline` TEXT (not live git -- callers pass in captured
// output, see golden-artifacts/git-log.txt) and checks the commit count
// matches `expectedCommitCount` and no single commit message references more
// than one distinct task. Returns
// { pass: boolean, commitCount: number, multiTaskCommits: [...] }.
function assertCommitsAtomic(gitLogText, expectedCommitCount) {
  if (typeof gitLogText !== 'string') {
    return { pass: false, commitCount: 0, multiTaskCommits: [] };
  }

  const lines = gitLogText.split('\n').map(l => l.trim()).filter(Boolean);
  const commitCount = lines.length;
  const multiTaskCommits = lines.filter(l => /task\s*\d+.*(?:and|,).*task\s*\d+/i.test(l));
  const pass = commitCount === expectedCommitCount && multiTaskCommits.length === 0;

  return { pass, commitCount, multiTaskCommits };
}

// Aggregates all four checks. `options` = { expectedPlan, expectSkip,
// expectedCommitCount }. Returns { pass: boolean, checks: { agents_spawned,
// gates_fired, deferred_written, commits_atomic } } where each value is one
// of the per-check result objects above, each carrying its own `pass`.
function runEvalAssertions(artifactsRoot, options) {
  const safeOptions = (options && typeof options === 'object') ? options : {};
  const { expectedPlan, expectSkip, expectedCommitCount } = safeOptions;

  const traceResult = parseSpawnTrace(path.join(artifactsRoot || '', 'spawn-trace.json'));
  const agentsSpawned = traceResult.ok
    ? assertAgentsSpawned(expectedPlan || [], traceResult.entries)
    : { pass: false, missing: expectedPlan || [], extra: [], wrong_tier: [], error: traceResult.error };

  const gatesFired = assertGatesFired(artifactsRoot);
  const deferredWritten = assertDeferredWritten(artifactsRoot, expectSkip || {});

  let gitLogText = '';
  try {
    gitLogText = fs.readFileSync(path.join(artifactsRoot || '', 'git-log.txt'), 'utf8');
  } catch (_e) {
    gitLogText = '';
  }
  const commitsAtomic = assertCommitsAtomic(gitLogText, expectedCommitCount || 0);

  const checks = {
    agents_spawned: agentsSpawned,
    gates_fired: gatesFired,
    deferred_written: deferredWritten,
    commits_atomic: commitsAtomic,
  };

  const pass = checks.agents_spawned.pass && checks.gates_fired.pass &&
    checks.deferred_written.pass && checks.commits_atomic.pass;

  return { pass, checks };
}

module.exports = {
  buildSpawnPlan,
  parseSpawnTrace,
  assertAgentsSpawned,
  assertGatesFired,
  assertDeferredWritten,
  assertCommitsAtomic,
  runEvalAssertions,
};
