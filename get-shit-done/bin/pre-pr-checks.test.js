/**
 * pre-pr-checks.test.js — Phase 61-01 (MILE-41)
 *
 * TDD coverage for pre-pr-checks.js's fail-open registry loading, pure
 * manifest-presence detection, node declared-scripts-only derivation, and
 * unknown-type degradation. Mirrors model-registry.test.js's isolated-module
 * strategy exactly: copy the module into a temp bin/ dir alongside a
 * controlled temp config/ dir (or no config/ dir at all) so require() yields
 * a fresh module instance whose ../config lookup is fully controlled -- the
 * real repo config file is never touched.
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODULE_SRC = path.join(__dirname, 'pre-pr-checks.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-pre-pr-checks-test-'));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Copy pre-pr-checks.js into an isolated temp bin/ dir so require() yields a
// FRESH module instance (its own module-level cache) whose ../config lookup
// we fully control -- the real repo config file is never touched.
function loadIsolatedModule(tmpDir, configContent /* string | undefined */) {
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, 'pre-pr-checks.js');
  fs.copyFileSync(MODULE_SRC, dest);
  if (configContent !== undefined) {
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'pre-pr-checks.json'), configContent);
  }
  // configContent === undefined -> no config/ dir created at all -> ENOENT -> fallback
  return require(dest);
}

// -------------------------------------------------------------------------
describe('Phase 61-01: pre-pr-checks.js fails open (never throws over config problems)', () => {
  const tmpDirs = [];
  afterEach(() => { while (tmpDirs.length) rmTmp(tmpDirs.pop()); });

  test('missing config file -> loadRegistry() returns DEFAULT_CHECKS', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    const mod = loadIsolatedModule(tmpDir, undefined); // no config/ dir at all
    assert.doesNotThrow(() => mod.loadRegistry());
    assert.deepStrictEqual(mod.loadRegistry(), mod.DEFAULT_CHECKS);
  });

  test('corrupt (invalid JSON) config file -> loadRegistry() returns DEFAULT_CHECKS', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    const mod = loadIsolatedModule(tmpDir, '{ this is not valid json ');
    assert.doesNotThrow(() => mod.loadRegistry());
    assert.deepStrictEqual(mod.loadRegistry(), mod.DEFAULT_CHECKS);
  });

  test('config missing a required top-level key -> loadRegistry() falls back wholesale to DEFAULT_CHECKS', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    // Valid JSON, but missing "rust" -> must fail open entirely, not partial-merge.
    const partial = {
      node: { manifest: 'package.json', script_checks: ['test'] },
      python: { manifest: 'pyproject.toml', checks: [] },
      go: { manifest: 'go.mod', checks: [] },
      unknown: { checks: [] },
    };
    const mod = loadIsolatedModule(tmpDir, JSON.stringify(partial));
    assert.doesNotThrow(() => mod.loadRegistry());
    assert.deepStrictEqual(mod.loadRegistry(), mod.DEFAULT_CHECKS);
  });

  test('valid config file -> loadRegistry() reads it verbatim (does NOT fall back)', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    const custom = {
      node: { manifest: 'package.json', script_checks: ['test'] },
      python: { manifest: 'pyproject.toml', checks: [{ id: 'custom-python-test', command: 'custom-pytest-runner', required: true }] },
      go: { manifest: 'go.mod', checks: [{ id: 'custom-go-test', command: 'custom-go-runner', required: true }] },
      rust: { manifest: 'Cargo.toml', checks: [{ id: 'custom-rust-test', command: 'custom-cargo-runner', required: true }] },
      unknown: { checks: [{ id: 'custom-unknown', command: 'custom-unknown-command', required: true }] },
    };
    const mod = loadIsolatedModule(tmpDir, JSON.stringify(custom));
    const loaded = mod.loadRegistry();
    assert.deepStrictEqual(loaded, custom);
    assert.notDeepStrictEqual(loaded, mod.DEFAULT_CHECKS);
  });
});

// -------------------------------------------------------------------------
describe('Phase 61-01: detectProjectTypes (pure, presence-only, union order)', () => {
  const { detectProjectTypes } = require('./pre-pr-checks.js');
  const tmpDirs = [];
  afterEach(() => { while (tmpDirs.length) rmTmp(tmpDirs.pop()); });

  test('node only -> returns [\'node\']', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    assert.deepStrictEqual(detectProjectTypes(tmpDir), ['node']);
  });

  test('python only -> returns [\'python\']', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
    assert.deepStrictEqual(detectProjectTypes(tmpDir), ['python']);
  });

  test('go only -> returns [\'go\']', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), '');
    assert.deepStrictEqual(detectProjectTypes(tmpDir), ['go']);
  });

  test('rust only -> returns [\'rust\']', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '');
    assert.deepStrictEqual(detectProjectTypes(tmpDir), ['rust']);
  });

  test('multi-manifest union: node + python both present -> [\'node\', \'python\'] (deterministic order, not first-match-only)', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
    assert.deepStrictEqual(detectProjectTypes(tmpDir), ['node', 'python']);
  });

  test('no manifests -> returns []', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    assert.deepStrictEqual(detectProjectTypes(tmpDir), []);
  });

  test('never throws on an unreadable manifest (directory named package.json instead of a file)', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'package.json'));
    let result;
    assert.doesNotThrow(() => { result = detectProjectTypes(tmpDir); });
    assert.ok(Array.isArray(result));
  });
});

// -------------------------------------------------------------------------
describe('Phase 61-01: checksForNode (declared-scripts-only derivation)', () => {
  const { checksForNode } = require('./pre-pr-checks.js');
  const tmpDirs = [];
  afterEach(() => { while (tmpDirs.length) rmTmp(tmpDirs.pop()); });

  test('only declared scripts become checks -- test+lint declared, no build -> exactly 2 checks, no node-build', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test', lint: 'eslint .' },
    }));
    const checks = checksForNode(tmpDir, { manifest: 'package.json', script_checks: ['test', 'lint', 'build'] });
    assert.strictEqual(checks.length, 2);
    assert.deepStrictEqual(checks, [
      { id: 'node-test', command: 'npm run test', required: true },
      { id: 'node-lint', command: 'npm run lint', required: true },
    ]);
    assert.ok(!checks.some((c) => c.id === 'node-build'));
  });

  test('zero scripts declared -> returns [], never invents a default npm test', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'no-scripts-pkg' }));
    const checks = checksForNode(tmpDir, { manifest: 'package.json', script_checks: ['test', 'lint', 'build'] });
    assert.deepStrictEqual(checks, []);
  });

  test('malformed package.json -> returns [] via getDeclaredNodeScripts fail-open, never throws', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ not valid json');
    let checks;
    assert.doesNotThrow(() => {
      checks = checksForNode(tmpDir, { manifest: 'package.json', script_checks: ['test', 'lint', 'build'] });
    });
    assert.deepStrictEqual(checks, []);
  });
});

// -------------------------------------------------------------------------
describe('Phase 61-01: deriveCheckSet (main derivation entry point)', () => {
  const pkg = require('./pre-pr-checks.js');
  const tmpDirs = [];
  afterEach(() => { while (tmpDirs.length) rmTmp(tmpDirs.pop()); });

  test('known type (node): test+build declared -> degraded:false, detected_types [\'node\'], node-test+node-build, no node-lint', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test', build: 'tsc' },
    }));
    const result = pkg.deriveCheckSet(tmpDir);
    assert.strictEqual(result.degraded, false);
    assert.deepStrictEqual(result.detected_types, ['node']);
    const ids = result.checks.map((c) => c.id);
    assert.ok(ids.includes('node-test'));
    assert.ok(ids.includes('node-build'));
    assert.ok(!ids.includes('node-lint'));
  });

  test('known type (python) -> degraded:false, checks deep-equal registry\'s python.checks', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
    const result = pkg.deriveCheckSet(tmpDir);
    assert.strictEqual(result.degraded, false);
    assert.deepStrictEqual(result.detected_types, ['python']);
    assert.deepStrictEqual(result.checks, pkg.loadRegistry().python.checks);
  });

  test('multi-manifest union: node + go both present -> concatenation of both types\' checks in [\'node\',\'go\'] order', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), '');
    const result = pkg.deriveCheckSet(tmpDir);
    assert.strictEqual(result.degraded, false);
    assert.deepStrictEqual(result.detected_types, ['node', 'go']);
    assert.deepStrictEqual(result.checks, [
      { id: 'node-test', command: 'npm run test', required: true },
      ...pkg.loadRegistry().go.checks,
    ]);
  });

  test('unknown/degraded: empty dir -> degraded:true, non-empty notice mentioning manifest files, checks deep-equal registry unknown.checks, no crash', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    let result;
    assert.doesNotThrow(() => { result = pkg.deriveCheckSet(tmpDir); });
    assert.strictEqual(result.degraded, true);
    assert.strictEqual(typeof result.notice, 'string');
    assert.ok(result.notice.length > 0);
    assert.match(result.notice, /manifest/i);
    assert.deepStrictEqual(result.checks, pkg.loadRegistry().unknown.checks);
    assert.deepStrictEqual(result.detected_types, []);
  });

  test('discoverMakeTestCommand integration: Makefile with test: target -> extra make-test-discovered entry appended', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), 'test:\n\techo running tests\n');
    const result = pkg.deriveCheckSet(tmpDir);
    assert.strictEqual(result.degraded, true);
    const ids = result.checks.map((c) => c.id);
    assert.ok(ids.includes('make-test-discovered'));
    const entry = result.checks.find((c) => c.id === 'make-test-discovered');
    assert.deepStrictEqual(entry, { id: 'make-test-discovered', command: 'make test', required: false });
  });

  test('discoverMakeTestCommand integration: Makefile with NO test: target -> no extra entry added', () => {
    const tmpDir = mkTmp(); tmpDirs.push(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'Makefile'), 'build:\n\techo building\n');
    const result = pkg.deriveCheckSet(tmpDir);
    assert.strictEqual(result.degraded, true);
    const ids = result.checks.map((c) => c.id);
    assert.ok(!ids.includes('make-test-discovered'));
  });

  test('never throws regardless of input -- cwd that does not exist at all -> returns degraded/unknown shape', () => {
    const tmpDir = mkTmp();
    const nonExistentDir = path.join(tmpDir, 'does-not-exist-at-all');
    rmTmp(tmpDir); // remove parent too, so nonExistentDir's parent is also gone
    let result;
    assert.doesNotThrow(() => { result = pkg.deriveCheckSet(nonExistentDir); });
    assert.strictEqual(result.degraded, true);
    assert.ok(Array.isArray(result.checks));
    assert.deepStrictEqual(result.detected_types, []);
  });
});

// -------------------------------------------------------------------------
describe('Phase 61-03: GSD self-hosting proof (MILE-41) - real repo root derivation', () => {
  test('real repo root: detected_types===["node"], exactly one node-test check, degraded:false, package.json has test+no lint/build', () => {
    const { deriveCheckSet } = require('./pre-pr-checks.js');

    // Real repo root is two levels up from this file (get-shit-done/bin/pre-pr-checks.test.js)
    const realRepoRoot = path.resolve(__dirname, '..', '..');

    // Verify that the path resolves to a directory containing the real package.json
    assert.ok(
      fs.existsSync(realRepoRoot),
      `Expected repo root to exist: ${realRepoRoot}`
    );
    const pkgJsonPath = path.join(realRepoRoot, 'package.json');
    assert.ok(
      fs.existsSync(pkgJsonPath),
      `Expected package.json at: ${pkgJsonPath}`
    );

    // Verify that package.json is a valid, parseable manifest
    let pkgJson;
    assert.doesNotThrow(() => {
      const content = fs.readFileSync(pkgJsonPath, 'utf8');
      pkgJson = JSON.parse(content);
    }, 'package.json must be valid JSON');

    assert.ok(pkgJson.scripts, 'package.json must have a scripts object');
    assert.ok(pkgJson.scripts.test, 'package.json must have a test script');

    // Verify the repo's declared scripts: should have test, no lint/build
    assert.strictEqual(
      pkgJson.scripts.lint,
      undefined,
      'package.json must NOT declare a lint script (this test will fail if lint is ever added)'
    );
    assert.strictEqual(
      pkgJson.scripts.build,
      undefined,
      'package.json must NOT declare a build script (this test will fail if build is ever added)'
    );

    // Call deriveCheckSet against the real repo root
    const result = deriveCheckSet(realRepoRoot);

    // Assert detected_types is exactly ['node']
    assert.deepStrictEqual(
      result.detected_types,
      ['node'],
      'Real repo root should be detected as node-only'
    );

    // Assert degraded is false (known type)
    assert.strictEqual(
      result.degraded,
      false,
      'Known project type (node) should not degrade'
    );

    // Assert checks is exactly one entry: {id:'node-test', command:'npm run test', required:true}
    assert.deepStrictEqual(
      result.checks,
      [{ id: 'node-test', command: 'npm run test', required: true }],
      'Real repo root declares only test script, so exactly one node-test check expected'
    );
  });
});
