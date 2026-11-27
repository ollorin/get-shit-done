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

  test('a route pattern maps a changed page to its spec; a path that expands to no known file, or matches nothing, selects the full suite', async () => {
    assert.deepStrictEqual((await select(SPECS, ALL_SPECS, ['app/cart/page.tsx'])).files, ['e2e/cart.spec.ts', 'e2e/smoke.spec.ts']);
    const noSpec = await select(SPECS, ALL_SPECS, ['app/nowhere/page.tsx']);
    assert.strictEqual(noSpec.full, true);
    assert.strictEqual(noSpec.reason, 'unmapped path app/nowhere/page.tsx');
    const wallet = await select(TESTS, ALL_TESTS, ['src/wallet.ts']);
    assert.strictEqual(wallet.full, true);
    assert.strictEqual(wallet.reason, 'unmapped path src/wallet.ts');
    assert.deepStrictEqual(wallet.files, ALL_TESTS.slice().sort());
  });

  test('a deleted candidate (in no file list) is a candidate itself, not an unmapped path', async () => {
    const r = await select(SPECS, ALL_SPECS, ['e2e/gone.spec.ts']);
    assert.strictEqual(r.full, false);
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
  const run = (dir, script, ...args) => spawnSync('node', [path.join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' });
  const gitIn = (dir, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  const write = (dir, rel, text = 'n') => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const filesOf = (r) => JSON.parse(r.stdout).files;

  test('clean tree prints the always-run set; an edited spec and an untracked spec are selected', () => {
    const dir = repo();
    assert.deepStrictEqual(filesOf(run(dir, 'affected-specs.mjs', 'HEAD')), ['e2e/smoke.spec.ts']);
    fs.writeFileSync(path.join(dir, 'e2e', 'cart.spec.ts'), 'y');
    assert.deepStrictEqual(filesOf(run(dir, 'affected-specs.mjs', 'HEAD')), ['e2e/cart.spec.ts', 'e2e/smoke.spec.ts']);
    write(dir, 'e2e/new.spec.ts');
    assert.deepStrictEqual(filesOf(run(dir, 'affected-specs.mjs', 'HEAD')), ['e2e/cart.spec.ts', 'e2e/new.spec.ts', 'e2e/smoke.spec.ts']);
    const other = repo();
    write(other, 'db/migrations/m.sql', 'z');
    assert.deepStrictEqual(filesOf(run(other, 'affected-tests.mjs', 'HEAD')), ['tests/db/cycle.test.ts', 'tests/scan-sources.test.ts']);
  });

  test('the base argument is required', () => {
    const r = run(repo(), 'affected-tests.mjs');
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.stdout, '');
  });

  test('a committed branch change is seen through the merge-base, and an unknown base exits 2', () => {
    const dir = repo();
    gitIn(dir, 'branch', 'base0');
    write(dir, 'src/wallet.ts');
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', 'feature');
    const r = run(dir, 'affected-tests.mjs', 'base0');
    assert.strictEqual(JSON.parse(r.stdout).full, true);
    assert.strictEqual(run(dir, 'affected-tests.mjs', 'no-such-ref').status, 2);
  });

  test('a renamed file counts both its old and new path as changed', () => {
    const dir = repo();
    gitIn(dir, 'mv', 'tests/unit/a.test.ts', 'tests/unit/b.test.ts');
    const r = run(dir, 'affected-tests.mjs', 'HEAD');
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(filesOf(r), ['tests/scan-sources.test.ts', 'tests/unit/b.test.ts']);
    fs.mkdirSync(path.join(dir, 'src'));
    gitIn(dir, 'mv', 'tests/unit/scan-b.test.ts', 'src/c.ts');
    assert.strictEqual(JSON.parse(run(dir, 'affected-tests.mjs', 'HEAD').stdout).full, true);
  });

  test('non-ASCII and spaced paths arrive unquoted', () => {
    const dir = repo();
    write(dir, 'tests/unit/é.test.ts');
    write(dir, 'tests/unit/a b.test.ts');
    assert.deepStrictEqual(filesOf(run(dir, 'affected-tests.mjs', 'HEAD')),
      ['tests/scan-sources.test.ts', 'tests/unit/a b.test.ts', 'tests/unit/é.test.ts']);
  });

  test('an option-shaped base exits 2 and creates nothing', () => {
    const dir = repo();
    const target = path.join(dir, 'pwned.txt');
    const r = run(dir, 'affected-tests.mjs', `--output=${target}`);
    assert.strictEqual(r.status, 2);
    assert.strictEqual(fs.existsSync(target), false);
  });

  test('the config is found from a subdirectory', () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, 'sub'));
    assert.strictEqual(run(path.join(dir, 'sub'), 'affected-tests.mjs', 'HEAD').status, 0);
  });

  test('an always_run entry that is absolute, climbs out, or names no known file exits 2', () => {
    for (const bad of ['/etc/passwd', '../x.test.ts', 'tests/missing.test.ts']) {
      const dir = repo();
      fs.writeFileSync(path.join(dir, '.planning', 'config.json'),
        JSON.stringify({ stack: { affected: { tests: { ...TESTS, always_run: [bad] } } } }));
      assert.strictEqual(run(dir, 'affected-tests.mjs', 'HEAD').status, 2, bad);
    }
  });

  test('absent selector config exits 2 with a message and no stdout', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), '{"stack":{}}');
    const r = run(dir, 'affected-tests.mjs', 'HEAD');
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.stdout, '');
    assert.match(r.stderr, /stack\.affected\.tests is not configured/);
  });
});

describe('stack.affected profile shape', () => {
  const keys = require('./project-profile-keys.js');
  const check = keys.NEW_SHAPE_CHECKS.find(([k]) => k === 'stack.affected');

  test('is registered, accepts a valid block and reports a malformed selector as an error', () => {
    assert.ok(check, 'stack.affected has a shape check');
    assert.ok(keys.NEW_STACK_KEYS.includes('affected'));
    assert.deepStrictEqual(check[1]('stack.affected', { specs: SPECS, tests: TESTS }), []);
    const bad = check[1]('stack.affected', { tests: { file_pattern: '(', map: 'bad' } });
    assert.ok(bad.length > 0);
    assert.match(bad[0].key, /stack\.affected\.tests/);
  });
});
