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

test('3b scopes cover hooks and config json', () => {
  const root = mkRoot();
  configure(root);
  for (const f of ['hooks/h.js', 'hooks/sub/n.js', 'get-shit-done/config/c.json', 'get-shit-done/config/c.txt']) {
    put(root, f, 'deno\n');
  }
  const scoped = lint.listScopeFiles(root);
  assert.deepStrictEqual(scoped.hooks, ['hooks/h.js']);
  assert.deepStrictEqual(scoped.config, ['get-shit-done/config/c.json']);
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

test('13 lowercase security, auth and owner tokens are counted; SES and Resend stay case-sensitive', () => {
  const classes = lint.loadTerms(path.join(__dirname, 'agnostic-lint', 'terms.json'));
  const hits = (line) => lint.countLines(line, classes);
  [
    ['kyc check', 'reg'], ['aml hit', 'reg'], ['jwt verify', 'authtech'], ['totp secret', 'authtech'], ['2fa prompt', 'authtech'],
    ['aws s3', 'cloud'], ['stripe key', 'cloud'], ['vercel deploy', 'cloud'], ['ceo ruling', 'owner'], ['nx run', 'nx'],
  ].forEach(([line, cls]) => assert.strictEqual(hits(line)[cls], 1, `${line} -> ${cls}`));
  assert.deepStrictEqual(hits('ses queue'), {});
  assert.deepStrictEqual(hits('resend mail'), {});
  assert.deepStrictEqual(hits('nexus and ceoless'), {});
});

test('14 pattern flags g and y are rejected by name', () => {
  const root = mkRoot();
  for (const flags of ['g', 'iy']) {
    configure(root, [{ id: 'stateful', label: 'x', pattern: 'deno', flags }]);
    const file = path.join(root, 'scripts/agnostic-lint/terms.json');
    assert.throws(() => lint.loadTerms(file), (e) => e instanceof Error && e.message.includes(file) && /g and y/.test(e.message), flags);
  }
  assert.deepStrictEqual(lint.countLines('Deno', compile([{ id: 'ok', label: 'x', pattern: 'deno', flags: 'i' }])), { ok: 1 });
});

test('15 CLI flag errors exit 2: --root without a value, unknown flag', () => {
  const root = baselinedRoot();
  const noValue = spawnSync(process.execPath, [LINT, 'check', '--root'], { encoding: 'utf8' });
  assert.strictEqual(noValue.status, 2);
  assert.match(noValue.stderr, /--root needs a directory/);
  const unknown = cli(root, 'check', '--allow-rise');
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /unknown flag: --allow-rise/);
  assert.match(unknown.stderr, /git add/);
});

test('16 unknown subcommand exits 2 with usage naming git add', () => {
  const r = spawnSync(process.execPath, [LINT, 'frob'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /^usage: agnostic-lint\.js <check\|report\|write-baseline>/);
  assert.match(r.stderr, /git add a new file before it is counted/);
});

test('17 report subcommand prints the class matrix and totals, exit 0', () => {
  const root = mkRoot();
  configure(root);
  put(root, 'agents/a.md', 'deno\nCEO\n');
  const r = cli(root, 'report');
  assert.strictEqual(r.status, 0);
  const lines = r.stdout.trimEnd().split('\n');
  assert.match(lines[0], /^class\s+agents\s+commands\s+workflows/);
  assert.ok(lines.some((l) => /^deno\s+1\/1\b/.test(l)), r.stdout);
  assert.ok(lines.some((l) => /^owner\s+1\/1\b/.test(l)), r.stdout);
  assert.strictEqual(lines[lines.length - 1], 'denied=2 allowed=0');
});

test('18 bad pattern and bad flags through the CLI exit 2 naming terms.json', () => {
  const root = mkRoot();
  for (const cls of [{ id: 'bad', label: 'x', pattern: '(', flags: '' }, { id: 'bad', label: 'x', pattern: 'a', flags: 'g' }]) {
    configure(root, [cls]);
    const r = cli(root, 'report');
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /agnostic-lint: .*terms\.json/);
  }
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

  test('7.1 the committed baseline holds denied lines for the telegram class only', () => {
    const base = JSON.parse(fs.readFileSync(path.join(DIR, 'baseline.json'), 'utf8'));
    const denied = new Set(Object.values(base.denied).flatMap((byCls) => Object.keys(byCls)));
    assert.deepStrictEqual([...denied], ['telegram']);
  });

  test('7.1 allow-list entries added since 0b9c35a carry a reason and none is an igaming, game, reg, money or abs class', (t) => {
    let before;
    try {
      before = JSON.parse(execFileSync('git', ['show', '0b9c35a:scripts/agnostic-lint/allowlist.json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      t.skip('commit 0b9c35a is not in this clone');
      return;
    }
    const old = new Set(before.entries.map((e) => `${e.file}\0${e.class}`));
    const added = lint.loadAllowlist(ALLOW).filter((e) => !old.has(`${e.file}\0${e.class}`));
    assert.ok(added.length > 0);
    for (const e of added) {
      assert.ok(typeof e.reason === 'string' && e.reason.trim() !== '', `${e.file} ${e.class}: empty reason`);
      assert.ok(!['igaming', 'game', 'reg', 'money', 'abs'].includes(e.class), `${e.file} ${e.class}: class may not be allow-listed`);
    }
  });

  test('H2 the real repo passes `agnostic-lint check` (exit 0), and the same check fails on a fixture with a denied term', () => {
    const real = spawnSync(process.execPath, [LINT, 'check', '--root', ROOT], { encoding: 'utf8' });
    assert.strictEqual(real.status, 0, real.stdout + real.stderr);
    const fx = mkRoot();
    configure(fx);
    put(fx, 'agents/a.md', 'run deno check\n');
    const bad = cli(fx, 'check');
    assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
  });

  test('F1 freeze and lock rules (shared-stack preset rule) name real profile keys; coordinator and execute-phase point at it', () => {
    const rule = fs.readFileSync(path.join(ROOT, 'get-shit-done/presets/base/rules/shared-stack.md'), 'utf8');
    assert.ok(rule.includes('stack.paths.backend'), 'missing stack.paths.backend');
    assert.ok(rule.includes('stack.isolation.lock_dir'), 'missing stack.isolation.lock_dir');
    assert.ok(!rule.includes('stack.paths.<key>'), 'placeholder key left');
    assert.ok(rule.includes('that needs no running stack'), 'entry gate lost its no-stack restriction');
    for (const f of ['agents/gsd-phase-coordinator.md', 'get-shit-done/workflows/execute-phase.md']) {
      const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(txt.includes('stack.isolation.lock_dir') && txt.includes('shared-stack.md'), `${f}: must point at the shared-stack rule under stack.isolation.lock_dir`);
    }
  });

  test('M1 every tracked *.test.js outside tests/fixtures/ is registered in the package.json test script', (t) => {
    let out;
    try {
      out = execFileSync('git', ['-C', ROOT, 'ls-files', '*.test.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      t.skip('not a git checkout');
      return;
    }
    const tracked = out.split('\n').filter((f) => f && !f.startsWith('tests/fixtures/'));
    assert.ok(tracked.length > 20, 'git ls-files returned too few test files');
    const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.test.split(/\s+/);
    // A file run through shard wrappers (tests/helpers/shard.js) counts only when wrappers for every shard 0..N-1 are registered.
    const shardsOf = (f) => tracked.flatMap((w) => {
      const m = fs.readFileSync(path.join(ROOT, w), 'utf8').match(/shard\.js'\)\(require\.resolve\('\.\/([^']+)'\), (\d+), (\d+)\)/);
      return m && path.posix.join(path.posix.dirname(w), m[1]) === f ? [{ w, index: Number(m[2]), count: Number(m[3]) }] : [];
    });
    const sharded = (f) => {
      const ws = shardsOf(f);
      return ws.length > 0 && ws.every((x) => x.count === ws.length && script.includes(x.w)) && new Set(ws.map((x) => x.index)).size === ws.length && ws.every((x) => x.index < ws.length);
    };
    const missing = tracked.filter((f) => !script.includes(f) && !sharded(f));
    assert.deepStrictEqual(missing, [], `unregistered in package.json scripts.test: ${missing.join(', ')}`);
  });

  test('7.1 legacy risk keywords: data file outside every lint scope, loader validates its shape, words reach the five use sites', () => {
    const kw = require('../get-shit-done/bin/legacy-risk-keywords.js');
    assert.ok(fs.existsSync(kw.FILE));
    const rel = path.relative(ROOT, kw.FILE).split(path.sep).join('/');
    assert.ok(!lint.SCOPES.some((sc) => sc.match(rel)), `${rel} must stay outside the lint scopes`);
    assert.ok(Object.values(lint.listScopeFiles(ROOT)).every((fl) => !fl.includes(rel)));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-kw-'));
    made.push(tmp);
    const bad = path.join(tmp, 'k.json');
    fs.writeFileSync(bad, JSON.stringify({ doc_signal: ['payment'], sensitive_path: 'wallet', complexity: ['x'], thorough_validation: ['Pay Ment'] }));
    assert.throws(() => kw.load(bad), /sensitive_path, thorough_validation$/);
    const tools = require('../get-shit-done/bin/gsd-tools.js');
    for (const w of kw.sensitive_path) assert.strictEqual(tools.SENSITIVE_PATH_RE.test(`src/${w}/x.js`), true, w);
    assert.strictEqual(tools.SENSITIVE_PATH_RE.test('src/orange/x.js'), false);
    assert.strictEqual(require('../get-shit-done/bin/gsd-validator.js').selectValidationDepth('add payment retry').depth, 'thorough');
    assert.ok(kw.doc_signal.includes('payment') && kw.complexity.includes('payment') && kw.thorough_validation.includes('payment'));
  });

  test('M2 legacy risk keywords: each list pinned by count and SHA-256 (update the hash deliberately), and an empty list fails closed at load', () => {
    const kw = require('../get-shit-done/bin/legacy-risk-keywords.js');
    const sha = (l) => require('crypto').createHash('sha256').update(JSON.stringify(l)).digest('hex');
    const PIN = {
      doc_signal: [1, 'df807153104158a8cd1c19b671043cf10398471be8f44e382857ae62be2c2ecb'],
      sensitive_path: [7, '088996557475ec3ca7843649ea80a7cd4a0853e17ae303588898f5db86fec220'],
      complexity: [1, 'df807153104158a8cd1c19b671043cf10398471be8f44e382857ae62be2c2ecb'],
      thorough_validation: [1, 'df807153104158a8cd1c19b671043cf10398471be8f44e382857ae62be2c2ecb'],
    };
    for (const [k, [n, h]] of Object.entries(PIN)) {
      assert.strictEqual(kw[k].length, n, `${k}: count changed; if deliberate, update the pin in this test`);
      assert.strictEqual(sha(kw[k]), h, `${k}: list changed; if deliberate, update the SHA-256 pin in this test`);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-kw-'));
    made.push(tmp);
    const empty = path.join(tmp, 'e.json');
    fs.writeFileSync(empty, JSON.stringify({ doc_signal: [], sensitive_path: ['a'], complexity: ['b'], thorough_validation: ['c'] }));
    assert.throws(() => kw.load(empty), /doc_signal/);
  });

  test('R3 L-c: the gsd-demo allow reason says the tool names stay because no pack tool-list mechanism exists', () => {
    const entry = lint.loadAllowlist(ALLOW).find((e) => e.file === 'agents/gsd-demo.md' && e.class === 'charlotte');
    assert.ok(entry, 'entry present');
    assert.match(entry.reason, /driver MCP tool names remain in the agent's tools: frontmatter/);
    assert.match(entry.reason, /there is no pack tool-list mechanism/);
    assert.doesNotMatch(entry.reason, /takes its tool list from the pack/);
  });

  test('12 denylist shape: exactly the 25 spec ids, unique, in order', () => {
    const ids = JSON.parse(fs.readFileSync(TERMS, 'utf8')).classes.map((c) => c.id);
    assert.deepStrictEqual(ids, IDS);
    assert.strictEqual(new Set(ids).size, 25);
  });
});

describe('presets/ is out of scope (agnostic-C1)', () => {
  const ROOT = path.join(__dirname, '..');
  const PRESET_PATHS = [
    'get-shit-done/presets/igaming/CLAUDE.md',
    'get-shit-done/presets/igaming/rules/database.md',
    'get-shit-done/presets/igaming/hooks/check-test-command.sh',
    'get-shit-done/presets/igaming/skills/create-migration/SKILL.md',
    'get-shit-done/presets/igaming/settings.fragment.json',
    'get-shit-done/presets/igaming/PRODUCT-BRIEF.md',
  ];

  test('L1 no scope matches a preset path, and the repo scope listing has none', () => {
    for (const p of PRESET_PATHS) assert.ok(!lint.SCOPES.some((s) => s.match(p)), `a scope matches ${p}`);
    const listed = Object.values(lint.listScopeFiles(ROOT)).flat();
    assert.deepStrictEqual(listed.filter((p) => p.startsWith('get-shit-done/presets/')), []);
    const tracked = execFileSync('git', ['ls-files', 'get-shit-done/presets'], { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n');
    assert.ok(tracked.length >= 50, `expected at least 50 tracked preset files, got ${tracked.length}`);
  });

  test('L2 a scan counts a template file and never a preset file, even one with hits', () => {
    const root = mkRoot();
    configure(root);
    put(root, 'get-shit-done/presets/x/CLAUDE.md', 'deno\nCEO\n');
    put(root, 'get-shit-done/templates/t.md', 'deno\n');
    const res = lint.scan(root, compile(TERMS), []);
    assert.deepStrictEqual(res.denied['get-shit-done/templates/t.md'], { deno: 1 });
    const keys = [...Object.keys(res.denied), ...Object.keys(res.allowed)];
    assert.deepStrictEqual(keys.filter((k) => k.startsWith('get-shit-done/presets/')), []);
  });
});
