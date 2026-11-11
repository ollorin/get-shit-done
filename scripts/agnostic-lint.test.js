'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const lint = require('./agnostic-lint.js');

const LINT = path.join(__dirname, 'agnostic-lint.js');
const made = [];

afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

const DENO = { id: 'deno', label: 'Deno', pattern: '\\bdeno\\b', flags: 'i' };
const OWNER = { id: 'owner', label: 'CEO', pattern: '\\bCEO\\b', flags: '' };
const TERMS = [DENO, OWNER];

function mkRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agnostic-lint-'));
  made.push(d);
  return d;
}

function put(root, rel, text) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

function configure(root, classes = TERMS, entries = []) {
  put(root, 'scripts/agnostic-lint/terms.json', JSON.stringify({ version: 1, classes }));
  put(root, 'scripts/agnostic-lint/allowlist.json', JSON.stringify({ version: 1, entries }));
}

function compile(classes) {
  const root = mkRoot();
  configure(root, classes);
  return lint.loadTerms(path.join(root, 'scripts/agnostic-lint/terms.json'));
}

const cli = (root, ...args) => spawnSync(process.execPath, [LINT, ...args, '--root', root], { encoding: 'utf8' });
const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
const baselinePath = (root) => path.join(root, 'scripts/agnostic-lint/baseline.json');

function baselinedRoot() {
  const root = mkRoot();
  configure(root);
  put(root, 'agents/a.md', 'deno\n');
  assert.strictEqual(cli(root, 'write-baseline').status, 0);
  return root;
}

test('1 countLines counts matching lines, not occurrences', () => {
  const classes = compile([DENO]);
  assert.deepStrictEqual(lint.countLines('deno and deno\n', classes), { deno: 1 });
  assert.deepStrictEqual(lint.countLines('deno and deno\ndeno\nx deno y\n', classes), { deno: 3 });
});

test('2 word boundary and case flags', () => {
  const classes = compile([DENO, OWNER]);
  assert.deepStrictEqual(lint.countLines('denoise', classes), {});
  assert.deepStrictEqual(lint.countLines('Deno task', classes), { deno: 1 });
  assert.deepStrictEqual(lint.countLines('CEO', classes), { owner: 1 });
  assert.deepStrictEqual(lint.countLines('ceo', classes), {});
});

test('3 scopes: disk-walk fallback applies the scope rules', () => {
  const root = mkRoot();
  configure(root);
  const files = [
    'agents/a.md',
    'agents/v2/b.md',
    'get-shit-done/bin/x.js',
    'get-shit-done/bin/x.test.js',
    'get-shit-done/bin/hooks/y.js',
    'bin/install.js',
    'hook-config.json',
    'scripts/z.js',
    'docs/d.md',
    'tests/t.md',
  ];
  for (const f of files) put(root, f, 'deno\n');
  const scoped = lint.listScopeFiles(root);
  assert.deepStrictEqual(scoped.agents, ['agents/a.md']);
  assert.deepStrictEqual(scoped.bin, ['get-shit-done/bin/hooks/y.js', 'get-shit-done/bin/x.js']);
  assert.deepStrictEqual(scoped.install, ['bin/install.js']);
  assert.deepStrictEqual(scoped['hook-config'], ['hook-config.json']);
  const res = lint.scan(root, compile([DENO]), []);
  assert.deepStrictEqual(Object.keys(res.denied), [
    'agents/a.md',
    'bin/install.js',
    'get-shit-done/bin/hooks/y.js',
    'get-shit-done/bin/x.js',
    'hook-config.json',
  ]);
});

test('3a git enumeration: untracked ignored, tracked-and-deleted skipped, git add counts', () => {
  const root = mkRoot();
  git(root, 'init', '-q');
  configure(root);
  put(root, 'agents/a.md', 'deno\n');
  put(root, 'agents/gone.md', 'deno\n');
  git(root, 'add', 'scripts/agnostic-lint', 'agents/a.md', 'agents/gone.md');
  fs.rmSync(path.join(root, 'agents/gone.md'));
  put(root, 'agents/u.md', 'deno\n');
  const res = lint.scan(root, compile([DENO]), []);
  assert.deepStrictEqual(Object.keys(res.denied), ['agents/a.md']);
  assert.strictEqual(cli(root, 'write-baseline').status, 0);
  assert.strictEqual(cli(root, 'check').status, 0);
  git(root, 'add', 'agents/u.md');
  const after = cli(root, 'check');
  assert.strictEqual(after.status, 1);
  assert.match(after.stderr, /RISE denied agents\/u\.md deno baseline=0 current=1/);
  const noGit = mkRoot();
  configure(noGit);
  put(noGit, 'agents/u.md', 'deno\n');
  assert.deepStrictEqual(Object.keys(lint.scan(noGit, compile([DENO]), []).denied), ['agents/u.md']);
});

test('4 allow-list cap: up to max allowed, the rest denied', () => {
  const root = mkRoot();
  put(root, 'agents/a.md', 'deno\ndeno\ndeno\n');
  const capped = lint.scan(root, compile([DENO]), [{ file: 'agents/a.md', class: 'deno', max: 2, reason: 'x' }]);
  assert.deepStrictEqual(capped.allowed, { 'agents/a.md': { deno: 2 } });
  assert.deepStrictEqual(capped.denied, { 'agents/a.md': { deno: 1 } });
  const bare = lint.scan(root, compile([DENO]), []);
  assert.deepStrictEqual(bare.denied, { 'agents/a.md': { deno: 3 } });
  assert.deepStrictEqual(bare.allowed, {});
});

test('5 compare: rises, new-file rises, drops, identity, allowed-kind rises', () => {
  const base = { denied: { 'a.md': { deno: 2 } }, allowed: {} };
  const up = lint.compare({ denied: { 'a.md': { deno: 3 } }, allowed: {} }, base);
  assert.deepStrictEqual(up.rises, [{ file: 'a.md', class: 'deno', kind: 'denied', baseline: 2, current: 3 }]);
  assert.deepStrictEqual(up.drops, []);
  const fresh = lint.compare({ denied: { 'a.md': { deno: 2 }, 'b.md': { deno: 1 } }, allowed: {} }, base);
  assert.deepStrictEqual(fresh.rises, [{ file: 'b.md', class: 'deno', kind: 'denied', baseline: 0, current: 1 }]);
  const down = lint.compare({ denied: { 'a.md': { deno: 1 } }, allowed: {} }, base);
  assert.deepStrictEqual(down.rises, []);
  assert.deepStrictEqual(down.drops, [{ file: 'a.md', class: 'deno', kind: 'denied', baseline: 2, current: 1 }]);
  const same = lint.compare(base, base);
  assert.deepStrictEqual(same, { rises: [], drops: [] });
  const allowedUp = lint.compare({ denied: {}, allowed: { 'a.md': { deno: 1 } } }, { denied: {}, allowed: {} });
  assert.deepStrictEqual(allowedUp.rises, [{ file: 'a.md', class: 'deno', kind: 'allowed', baseline: 0, current: 1 }]);
});

test('6 CLI check: exit 1 with RISE naming the file and class after a new hit', () => {
  const root = baselinedRoot();
  assert.strictEqual(cli(root, 'check').status, 0);
  fs.appendFileSync(path.join(root, 'agents/a.md'), 'deno\n');
  const r = cli(root, 'check');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /RISE denied agents\/a\.md deno/);
});

test('7 CLI stale: falling count, terms edited without regeneration, missing baseline', () => {
  const falling = mkRoot();
  configure(falling);
  put(falling, 'agents/a.md', 'deno\ndeno\n');
  assert.strictEqual(cli(falling, 'write-baseline').status, 0);
  put(falling, 'agents/a.md', 'deno\n');
  const drop = cli(falling, 'check');
  assert.strictEqual(drop.status, 1);
  assert.match(drop.stderr, /STALE denied agents\/a\.md deno baseline=2 current=1/);

  const edited = baselinedRoot();
  configure(edited, [{ ...DENO, label: 'relabelled' }, OWNER]);
  const hash = cli(edited, 'check');
  assert.strictEqual(hash.status, 1);
  assert.match(hash.stderr, /STALE inputs hash/);

  const missing = baselinedRoot();
  fs.rmSync(baselinePath(missing));
  const gone = cli(missing, 'check');
  assert.strictEqual(gone.status, 1);
  assert.match(gone.stderr, /MISSING baseline\.json/);
});

test('8 CLI write-baseline refuses to raise unless --allow-raise', () => {
  const root = baselinedRoot();
  const before = fs.readFileSync(baselinePath(root), 'utf8');
  fs.appendFileSync(path.join(root, 'agents/a.md'), 'deno\n');
  const refused = cli(root, 'write-baseline');
  assert.strictEqual(refused.status, 1);
  assert.match(refused.stderr, /RISE denied agents\/a\.md deno/);
  assert.strictEqual(fs.readFileSync(baselinePath(root), 'utf8'), before);
  const allowed = spawnSync(process.execPath, [LINT, 'write-baseline', '--allow-raise', '--root', root], { encoding: 'utf8' });
  assert.strictEqual(allowed.status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(baselinePath(root), 'utf8')).denied['agents/a.md'].deno, 2);
});

test('9 bad pattern: loadTerms throws an Error naming the file', () => {
  const root = mkRoot();
  configure(root, [{ id: 'bad', label: 'bad', pattern: '(', flags: '' }]);
  const file = path.join(root, 'scripts/agnostic-lint/terms.json');
  assert.throws(() => lint.loadTerms(file), (e) => e instanceof Error && e.message.includes(file));
});

describe('repo tree', () => {
  const ROOT = path.join(__dirname, '..');
  const DIR = path.join(ROOT, 'scripts', 'agnostic-lint');
  const TERMS = path.join(DIR, 'terms.json');
  const ALLOW = path.join(DIR, 'allowlist.json');
  const IDS = [
    'igaming', 'game', 'reg', 'money', 'owner', 'supabase', 'deno', 'edgefn', 'redis', 'charlotte', 'nx', 'pnpm', 'postgres',
    'orbstack', 'email', 'telegram', 'docker', 'authtech', 'frontend', 'cloud', 'paths', 'gates', 'zg', 'abs', 'ports',
  ];

  test('10 repo at baseline: no rises, no drops, inputs hash matches', () => {
    const base = JSON.parse(fs.readFileSync(path.join(DIR, 'baseline.json'), 'utf8'));
    const res = lint.scan(ROOT, lint.loadTerms(TERMS), lint.loadAllowlist(ALLOW));
    const { rises, drops } = lint.compare(res, base);
    const lines = [...rises, ...drops].map((r) => `${r.file} ${r.class} ${r.baseline}→${r.current}`);
    assert.strictEqual(lines.length, 0, lines.join('\n'));
    assert.strictEqual(base.inputs_sha256, lint.inputsHash(TERMS, ALLOW));
  });

  test('11 allow-list hygiene: reason, integer max, known class, file on disk in a scope, no duplicates', () => {
    const classes = new Set(lint.loadTerms(TERMS).map((c) => c.id));
    const seen = new Set();
    for (const e of lint.loadAllowlist(ALLOW)) {
      const key = `${e.file} ${e.class}`;
      assert.ok(e.reason, `${key}: empty reason`);
      assert.ok(Number.isInteger(e.max) && e.max >= 1, `${key}: max must be an integer >= 1`);
      assert.ok(classes.has(e.class), `${key}: unknown class`);
      assert.ok(fs.existsSync(path.join(ROOT, e.file)), `${key}: file not on disk`);
      assert.ok(lint.SCOPES.some((s) => s.match(e.file)), `${key}: file in no scope`);
      assert.ok(!seen.has(key), `${key}: duplicate entry`);
      seen.add(key);
    }
  });

  test('12 denylist shape: exactly the 25 spec ids, unique, in order', () => {
    const ids = JSON.parse(fs.readFileSync(TERMS, 'utf8')).classes.map((c) => c.id);
    assert.deepStrictEqual(ids, IDS);
    assert.strictEqual(new Set(ids).size, 25);
  });
});
