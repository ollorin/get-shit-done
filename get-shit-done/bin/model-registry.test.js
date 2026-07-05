/**
 * model-registry.test.js — Phase 52-03 (MILE-27)
 *
 * Dedicated BEFORE/AFTER parity suite for the model-registry refactor. The 3
 * consumers (gsd-circuit-breaker.js, gsd-escalation.js, analytics.js) are LIVE —
 * used during real execution — so their tier-keyed behavior must be provably
 * IDENTICAL to the pre-refactor literals, not merely assumed.
 *
 * Parity is proven against INDEPENDENT hardcoded expected constants (the
 * pre-refactor literals), NOT re-derived from model-registry.json or
 * DEFAULT_REGISTRY, so the test cannot trivially pass by comparing the registry
 * to itself.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Independent pre-refactor snapshot literals (source of truth for parity) ---
const EXPECTED_THRESHOLDS = {
  haiku:  { timeout_ms: 1200000, iterations: 15 },
  sonnet: { timeout_ms: 2400000, iterations: 20 },
  opus:   { timeout_ms: 3600000, iterations: 25 },
};
const EXPECTED_LADDER = { haiku: 'sonnet', sonnet: 'opus', opus: null };
const EXPECTED_TIERS = ['haiku', 'sonnet', 'opus'];

const REGISTRY_SRC = path.join(__dirname, 'model-registry.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-registry-test-'));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Copy model-registry.js into an isolated temp bin/ dir so require() yields a
// FRESH module instance (its own module-level cache) whose ../config lookup we
// fully control — the real repo config file is never touched.
function loadIsolatedRegistry(tmpDir, configContent /* string | undefined */) {
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, 'model-registry.js');
  fs.copyFileSync(REGISTRY_SRC, dest);
  if (configContent !== undefined) {
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'model-registry.json'), configContent);
  }
  // configContent === undefined -> no config/ dir created -> ENOENT -> fallback
  return require(dest);
}

// -------------------------------------------------------------------------
describe('Phase 52-03: registry config-drift transcription guard', () => {
  const registry = require('./model-registry.js');

  test('getAllThresholds() deep-equals the independent pre-refactor literals', () => {
    assert.deepStrictEqual(registry.getAllThresholds(), EXPECTED_THRESHOLDS);
  });

  test('getEscalationLadder() deep-equals the independent pre-refactor literal', () => {
    assert.deepStrictEqual(registry.getEscalationLadder(), EXPECTED_LADDER);
  });

  test('getTiers() deep-equals the independent pre-refactor tier list', () => {
    assert.deepStrictEqual(registry.getTiers(), EXPECTED_TIERS);
  });

  test('getThresholds(unknown-tier) falls back to sonnet thresholds (pre-refactor semantic)', () => {
    assert.deepStrictEqual(registry.getThresholds('unknown-tier-xyz'), EXPECTED_THRESHOLDS.sonnet);
  });

  test('getNextTier chain matches the ladder for every tier', () => {
    assert.strictEqual(registry.getNextTier('haiku'), 'sonnet');
    assert.strictEqual(registry.getNextTier('sonnet'), 'opus');
    assert.strictEqual(registry.getNextTier('opus'), null);
  });
});

// -------------------------------------------------------------------------
describe('Phase 52-03: gsd-circuit-breaker parity (BASE_THRESHOLDS via registry)', () => {
  const cb = require('./gsd-circuit-breaker.js');
  let originalCwd;
  let tmpDir;

  // Run from an EMPTY cwd so loadThresholds() finds no on-disk thresholds.json
  // and falls back to the registry-sourced BASE_THRESHOLDS — this isolates the
  // parity assertion to the registry, not whatever thresholds.json happens to
  // sit under the current working directory.
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkTmp();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmTmp(tmpDir);
  });

  for (const tier of EXPECTED_TIERS) {
    test(`getAdaptiveThresholds(neutral, '${tier}') base params equal pre-refactor literals`, () => {
      // "update readme text" contains no complexity keywords (database, migration,
      // architecture, integration, security, schema, payment, transaction), so the
      // final multiplier is 1.0 and base_* equals the raw base threshold.
      const r = cb.getAdaptiveThresholds('update readme text', tier);
      assert.strictEqual(r.base_timeout_ms, EXPECTED_THRESHOLDS[tier].timeout_ms);
      assert.strictEqual(r.base_iterations, EXPECTED_THRESHOLDS[tier].iterations);
    });
  }
});

// -------------------------------------------------------------------------
describe('Phase 52-03: gsd-escalation parity (ESCALATION_LADDER + getNextModel)', () => {
  const esc = require('./gsd-escalation.js');

  test('exported ESCALATION_LADDER deep-equals the pre-refactor literal', () => {
    assert.deepStrictEqual(esc.ESCALATION_LADDER, EXPECTED_LADDER);
  });

  test('ErrorTracker.getNextModel walks haiku -> sonnet -> opus -> null', () => {
    const tracker = new esc.ErrorTracker({ id: 'parity-task' });
    assert.strictEqual(tracker.getNextModel('haiku'), 'sonnet');
    assert.strictEqual(tracker.getNextModel('sonnet'), 'opus');
    assert.strictEqual(tracker.getNextModel('opus'), null);
  });
});

// -------------------------------------------------------------------------
describe('Phase 52-03: analytics tier-key-set parity (unrecognized model -> unknown)', () => {
  const analytics = require('./analytics.js');
  let tmpDir;

  beforeEach(() => { tmpDir = mkTmp(); });
  afterEach(() => { rmTmp(tmpDir); });

  test('generateReport tier distribution has exactly haiku/sonnet/opus/unknown; gpt-5 lands in unknown', () => {
    const planningDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    const events = [
      '# Execution Log',
      JSON.stringify({ type: 'routing_decision', model: 'haiku', phase: '52' }),
      JSON.stringify({ type: 'routing_decision', model: 'haiku', phase: '52' }),
      JSON.stringify({ type: 'task_dispatch', model: 'sonnet', phase: '52' }),
      JSON.stringify({ type: 'routing_decision', model: 'opus', phase: '52' }),
      JSON.stringify({ type: 'routing_decision', model: 'gpt-5', phase: '52' }),
    ].join('\n');
    fs.writeFileSync(path.join(planningDir, 'EXECUTION_LOG.md'), events + '\n');

    const report = analytics.generateReport(tmpDir);

    assert.match(report, /## Model Tier Distribution/);
    assert.match(report, /\|\s*haiku\s*\|\s*2\s*\|/);
    assert.match(report, /\|\s*sonnet\s*\|\s*1\s*\|/);
    assert.match(report, /\|\s*opus\s*\|\s*1\s*\|/);
    // The unrecognized model must fall into the fixed unknown bucket...
    assert.match(report, /\|\s*unknown\s*\|\s*1\s*\|/);
    // ...and must NOT create a spurious 5th row.
    assert.doesNotMatch(report, /\|\s*gpt-5\s*\|/);

    // Exactly 4 tier rows in the distribution table.
    const tierRows = report.match(/^\|\s*(haiku|sonnet|opus|unknown|gpt-5)\s*\|/gm) || [];
    assert.strictEqual(tierRows.length, 4);
  });
});

// -------------------------------------------------------------------------
describe('Phase 52-03: model-registry.js fails open (never throws over config problems)', () => {
  const tmpDirs = [];
  afterEach(() => { while (tmpDirs.length) rmTmp(tmpDirs.pop()); });

  test('missing config file -> loadRegistry() returns DEFAULT_REGISTRY', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    const mod = loadIsolatedRegistry(tmpDir, undefined); // no config/ dir at all
    assert.doesNotThrow(() => mod.loadRegistry());
    assert.deepStrictEqual(mod.loadRegistry(), mod.DEFAULT_REGISTRY);
    // And the default is itself structurally valid / equal to the snapshot.
    assert.deepStrictEqual(mod.getAllThresholds(), EXPECTED_THRESHOLDS);
    assert.deepStrictEqual(mod.getTiers(), EXPECTED_TIERS);
  });

  test('corrupt (invalid JSON) config file -> loadRegistry() returns DEFAULT_REGISTRY', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    const mod = loadIsolatedRegistry(tmpDir, '{ this is not valid json ');
    assert.doesNotThrow(() => mod.loadRegistry());
    assert.deepStrictEqual(mod.loadRegistry(), mod.DEFAULT_REGISTRY);
  });

  test('config missing a required top-level key -> loadRegistry() returns DEFAULT_REGISTRY', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    // Valid JSON, but no "thresholds" key -> must fail open, not partially load.
    const mod = loadIsolatedRegistry(tmpDir, JSON.stringify({ tiers: ['x'], escalation_ladder: {} }));
    assert.doesNotThrow(() => mod.loadRegistry());
    assert.deepStrictEqual(mod.loadRegistry(), mod.DEFAULT_REGISTRY);
  });

  test('valid config file -> loadRegistry() reads it (does NOT fall back)', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    const custom = {
      tiers: ['haiku', 'sonnet', 'opus'],
      escalation_ladder: { haiku: 'sonnet', sonnet: 'opus', opus: null },
      thresholds: {
        haiku:  { timeout_ms: 111, iterations: 1 },
        sonnet: { timeout_ms: 222, iterations: 2 },
        opus:   { timeout_ms: 333, iterations: 3 },
      },
    };
    const mod = loadIsolatedRegistry(tmpDir, JSON.stringify(custom));
    assert.deepStrictEqual(mod.getAllThresholds(), custom.thresholds);
    assert.notDeepStrictEqual(mod.getAllThresholds(), mod.DEFAULT_REGISTRY.thresholds);
  });
});
