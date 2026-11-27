'use strict';

// WP5 and WP6: the affected-specs and affected-tests selectors of the base preset (scripts/lib/affected.mjs).

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const SCRIPTS = path.join(__dirname, '..', 'presets', 'base', 'scripts');
const load = () => import(pathToFileURL(path.join(SCRIPTS, 'lib', 'affected.mjs')).href);

const SPECS = {
  file_pattern: '^e2e/.*\\.spec\\.ts$',
  always_run: ['e2e/smoke.spec.ts'],
  fallback: ['^app/layout\\.tsx$', '^styles/', '^e2e/helpers/', '^playwright\\.config\\.ts$', '^db/seed\\.sql$'],
  map: [{ match: '^app/([a-z]+)/page\\.tsx$', files: ['e2e/$1.spec.ts'] }],
};
const TESTS = {
  file_pattern: '^tests/.*\\.test\\.ts$',
  always_run: ['tests/scan-sources.test.ts'],
  fallback: ['^package\\.json$'],
  map: [{ match: '^db/migrations/', files: ['tests/db/cycle.test.ts'] }],
};
const ALL_SPECS = ['e2e/smoke.spec.ts', 'e2e/cart.spec.ts', 'e2e/login.spec.ts', 'e2e/helpers/x.ts'];
const ALL_TESTS = ['tests/scan-sources.test.ts', 'tests/db/cycle.test.ts', 'tests/unit/a.test.ts', 'tests/unit/scan-b.test.ts'];

async function select(raw, all, changed) {
  const { parseSelectorConfig, selectAffected } = await load();
  const config = parseSelectorConfig(raw, 'k');
  assert.ok(config.ok, config.error);
  return selectAffected({ changed, all, config: config.value });
}

describe('affected-specs selection', () => {
  test('a changed spec selects itself and the always-run set', async () => {
    const r = await select(SPECS, ALL_SPECS, ['e2e/login.spec.ts']);
    assert.deepStrictEqual(r, { full: false, files: ['e2e/login.spec.ts', 'e2e/smoke.spec.ts'], reason: 'changed paths mapped' });
  });

  test('a route pattern maps a changed page to its spec; an unmapped page and an unknown spec select nothing extra', async () => {
    assert.deepStrictEqual((await select(SPECS, ALL_SPECS, ['app/cart/page.tsx'])).files, ['e2e/cart.spec.ts', 'e2e/smoke.spec.ts']);
    assert.deepStrictEqual((await select(SPECS, ALL_SPECS, ['app/nowhere/page.tsx'])).files, ['e2e/smoke.spec.ts']);
  });

  test('no changes returns the always-run set', async () => {
    assert.deepStrictEqual((await select(SPECS, ALL_SPECS, [])).files, ['e2e/smoke.spec.ts']);
  });

  test('every fallback path selects the full suite', async () => {
    for (const p of ['app/layout.tsx', 'styles/a.css', 'e2e/helpers/x.ts', 'playwright.config.ts', 'db/seed.sql']) {
      const r = await select(SPECS, ALL_SPECS, ['app/cart/page.tsx', p]);
      assert.strictEqual(r.full, true, p);
      assert.deepStrictEqual(r.files, ['e2e/cart.spec.ts', 'e2e/login.spec.ts', 'e2e/smoke.spec.ts']);
    }
  });
});

describe('affected-tests selection', () => {
  test('no-diff base returns the always-run set', async () => {
    const r = await select(TESTS, ALL_TESTS, []);
    assert.deepStrictEqual(r, { full: false, files: ['tests/scan-sources.test.ts'], reason: 'no changes: always-run set' });
  });

  test('a fallback path selects the full suite', async () => {
    const r = await select(TESTS, ALL_TESTS, ['package.json']);
    assert.strictEqual(r.full, true);
    assert.deepStrictEqual(r.files, ALL_TESTS.slice().sort());
  });

  test('a changed migration selects the cycle test', async () => {
    const r = await select(TESTS, ALL_TESTS, ['db/migrations/20260101_x.sql']);
    assert.deepStrictEqual(r.files, ['tests/db/cycle.test.ts', 'tests/scan-sources.test.ts']);
  });

  test('a changed source-scanning test selects itself', async () => {
    const r = await select(TESTS, ALL_TESTS, ['tests/unit/scan-b.test.ts']);
    assert.deepStrictEqual(r.files, ['tests/scan-sources.test.ts', 'tests/unit/scan-b.test.ts']);
  });
});

describe('selector config validation', () => {
  test('missing config, a bad regex and a malformed map are error values', async () => {
    const { parseSelectorConfig } = await load();
    assert.strictEqual(parseSelectorConfig(undefined, 'k').ok, false);
    assert.strictEqual(parseSelectorConfig({ file_pattern: '(' }, 'k').ok, false);
    assert.strictEqual(parseSelectorConfig({ file_pattern: 'x', fallback: ['['] }, 'k').ok, false);
    assert.strictEqual(parseSelectorConfig({ file_pattern: 'x', map: [{ match: 'a' }] }, 'k').ok, false);
  });
});

describe('selector CLIs on a temp git repo', () => {
  const dirs = [];
  afterEach(() => { while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

  function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-affected-'));
    dirs.push(dir);
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    fs.mkdirSync(path.join(dir, '.planning'));
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ stack: { affected: { specs: SPECS, tests: TESTS } } }));
    for (const f of [...ALL_SPECS, ...ALL_TESTS]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), 'x');
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    return dir;
  }
  const run = (dir, script) => spawnSync('node', [path.join(SCRIPTS, script)], { cwd: dir, encoding: 'utf8' });

  test('clean tree prints the always-run set; an edited spec and an untracked spec are selected', () => {
    const dir = repo();
    assert.deepStrictEqual(JSON.parse(run(dir, 'affected-specs.mjs').stdout).files, ['e2e/smoke.spec.ts']);
    fs.writeFileSync(path.join(dir, 'e2e', 'cart.spec.ts'), 'y');
    assert.deepStrictEqual(JSON.parse(run(dir, 'affected-specs.mjs').stdout).files, ['e2e/cart.spec.ts', 'e2e/smoke.spec.ts']);
    fs.mkdirSync(path.join(dir, 'db', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'db', 'migrations', 'm.sql'), 'z');
    assert.deepStrictEqual(JSON.parse(run(dir, 'affected-tests.mjs').stdout).files, ['tests/db/cycle.test.ts', 'tests/scan-sources.test.ts']);
  });

  test('absent selector config exits 2 with a message and no stdout', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), '{"stack":{}}');
    const r = run(dir, 'affected-tests.mjs');
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.stdout, '');
    assert.match(r.stderr, /stack\.affected\.tests is not configured/);
  });
});
