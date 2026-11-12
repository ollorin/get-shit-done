/**
 * project-registry.test.js — agnostic-M-02 (G1)
 *
 * Unit tests for slug and port allocation (P-a..P-d, P-g), a concurrency test (P-e),
 * and CLI tests of the `project init` wiring (P-f, P-h, P-i). Every test runs with
 * GSD_HOME set to a temp directory; the guard below proves the real ~/.gsd is untouched.
 */

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  allocate, unregister, planAllocation, applyToConfig, registerForInit, initWithRegistration, planUnderLock,
} = require('./project-registry.js');
const { acquireLock, unlinkLockInstance } = require('./project-lock.js');

const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
const MODULE = path.join(__dirname, 'project-registry.js');
const REAL_REGISTRY = path.join(os.homedir(), '.gsd', 'projects.json');
const tmpDirs = [];
let realBefore;

const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
const stampOf = (file) => {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return 'absent';
  }
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// The PID of a process that has exited: no such process, so the lock owner counts as dead (ESRCH).
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});
before(() => {
  realBefore = stampOf(REAL_REGISTRY);
});
after(() => {
  assert.strictEqual(stampOf(REAL_REGISTRY), realBefore, 'the real ~/.gsd/projects.json changed');
});

function makeProject(config) {
  const root = mkTmp('gsd-registry-proj-');
  fs.mkdirSync(path.join(root, '.planning'));
  if (config !== undefined) {
    const body = typeof config === 'string' ? config : JSON.stringify(config, null, 2);
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), body);
  }
  return root;
}

const configOf = (root) => readJson(path.join(root, '.planning', 'config.json'));
const configBytes = (root) => fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8');
const runProject = (args, home) => spawnSync(process.execPath, [GSD_TOOLS, 'project', ...args], {
  encoding: 'utf8',
  env: { ...process.env, GSD_HOME: home },
});

describe('allocate (unit)', () => {
  test('P-a two slugs get 55000 and 55100; a third gets 55200', () => {
    const dir = mkTmp('gsd-registry-home-');
    assert.deepStrictEqual(allocate({ dir, slug: 'alpha', root: '/r/a' }), { ok: true, port_base: 55000, reused: false });
    assert.deepStrictEqual(allocate({ dir, slug: 'beta', root: '/r/b' }), { ok: true, port_base: 55100, reused: false });
    assert.deepStrictEqual(allocate({ dir, slug: 'gamma', root: '/r/c' }), { ok: true, port_base: 55200, reused: false });
  });

  test('P-b same slug and same root twice: same port, reused, one entry', () => {
    const dir = mkTmp('gsd-registry-home-');
    allocate({ dir, slug: 'alpha', root: '/r/a' });
    const again = allocate({ dir, slug: 'alpha', root: '/r/a' });
    assert.deepStrictEqual(again, { ok: true, port_base: 55000, reused: true });
    assert.deepStrictEqual(Object.keys(readJson(path.join(dir, 'projects.json')).projects), ['alpha']);
  });

  test('P-c same slug with another root is refused and the file is unchanged', () => {
    const dir = mkTmp('gsd-registry-home-');
    allocate({ dir, slug: 'alpha', root: '/r/a' });
    const before = fs.readFileSync(path.join(dir, 'projects.json'), 'utf8');
    const r = allocate({ dir, slug: 'alpha', root: '/r/other' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'slug already registered at /r/a');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8'), before);
  });

  test('P-d wanted 54320 is registered as is; a project wanting 54350 is refused', () => {
    const dir = mkTmp('gsd-registry-home-');
    assert.deepStrictEqual(allocate({ dir, slug: 'alpha', root: '/r/a', wanted: 54320 }), { ok: true, port_base: 54320, reused: false });
    const r = allocate({ dir, slug: 'beta', root: '/r/b', wanted: 54350 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'port_base 54350 is within 100 of alpha');
    assert.strictEqual(allocate({ dir, slug: 'gamma', root: '/r/c' }).port_base, 55000);
  });

  test('P-g malformed projects.json is an error and its bytes are unchanged', () => {
    const dir = mkTmp('gsd-registry-home-');
    const broken = '{"version":1,"projects":{"alpha":{"root":"/r/a"}}}';
    fs.writeFileSync(path.join(dir, 'projects.json'), broken);
    const r = allocate({ dir, slug: 'beta', root: '/r/b' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /needs a root and a valid port_base/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8'), broken);
  });

  test('planAllocation is pure: no port left when the range is full', () => {
    const entries = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, { root: `/r/${i}`, port_base: 55000 + i * 100 }]));
    const r = planAllocation({ version: 1, projects: entries }, { slug: 'late', root: '/r/late' });
    assert.deepStrictEqual(r, { ok: false, reason: 'no free port_base from 55000 to 64900' });
  });
});

describe('allocate (concurrency)', () => {
  test('P-e 8 processes allocate 8 slugs at once: 8 distinct ports, valid JSON', async () => {
    const dir = mkTmp('gsd-registry-home-');
    const child = (i) => new Promise((resolve, reject) => {
      const code = `const r = require(${JSON.stringify(MODULE)}).allocate({ dir: ${JSON.stringify(dir)}, slug: 's${i}', root: '/r/${i}' });`
        + 'process.stdout.write(JSON.stringify(r));';
      const p = spawn(process.execPath, ['-e', code]);
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', reject);
      p.on('close', () => resolve(JSON.parse(out)));
    });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => child(i)));
    assert.ok(results.every((r) => r.ok === true), JSON.stringify(results));
    assert.strictEqual(new Set(results.map((r) => r.port_base)).size, 8);
    assert.strictEqual(Object.keys(readJson(path.join(dir, 'projects.json')).projects).length, 8);
    assert.strictEqual(fs.existsSync(path.join(dir, 'projects.lock')), false);
  });
});

describe('project init wiring (CLI)', () => {
  test('P-f init writes the registry and the base defaults; existing values are kept; no ui_qa appears', () => {
    const home = mkTmp('gsd-registry-home-');
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    runProject(['init', '--root', root, '--preset', 'igaming'], home);
    const registry = readJson(path.join(home, 'projects.json'));
    assert.deepStrictEqual(registry.projects.demo, { root: fs.realpathSync.native(root), port_base: 55000 });
    const cfg = configOf(root);
    assert.strictEqual(cfg.stack.isolation.port_base, 55000);
    assert.strictEqual(cfg.stack.isolation.container_suffix, 'demo');
    assert.strictEqual(cfg.project.owner_title, 'owner');
    assert.strictEqual(cfg.stack.branch.default, 'main');
    assert.strictEqual(cfg.stack.commands.search, 'git grep -n');
    assert.strictEqual(cfg.stack.commands.pre_pr_gate, 'scripts/pre-pr-gate.sh');
    assert.deepStrictEqual(cfg.stack.capabilities, { backend: {}, web_ui: {} });
    assert.ok(!JSON.stringify(cfg).includes('ui_qa'));

    const kept = makeProject({
      project: { slug: 'kept', owner_title: 'CEO' },
      stack: { capabilities: { web_ui: false }, isolation: { container_suffix: 'api' } },
    });
    runProject(['init', '--root', kept, '--preset', 'igaming'], home);
    const keptCfg = configOf(kept);
    assert.strictEqual(keptCfg.project.owner_title, 'CEO');
    assert.strictEqual(keptCfg.stack.isolation.container_suffix, 'api');
    assert.strictEqual(keptCfg.stack.capabilities.web_ui, false);
    assert.deepStrictEqual(keptCfg.stack.capabilities.backend, {});
  });

  test('P-h a config with a slug and no stack exits 1, naming stack.capabilities; nothing is written', () => {
    const home = mkTmp('gsd-registry-home-');
    const root = makeProject({ project: { slug: 'demo' } });
    const before = configBytes(root);
    const r = runProject(['init', '--root', root, '--preset', 'igaming'], home);
    assert.strictEqual(r.status, 1);
    assert.match(JSON.parse(r.stdout).errors[0].reason, /stack\.capabilities is not set/);
    assert.strictEqual(configBytes(root), before);
    assert.strictEqual(fs.existsSync(path.join(home, 'projects.json')), false);
  });

  test('P-i invalid values exit 1 before any write, naming the key', () => {
    const home = mkTmp('gsd-registry-home-');
    const base = { project: { slug: 'demo' }, stack: { capabilities: {} } };
    const cases = [
      [{ ...base, project: { slug: 'demo', owner_title: 'a"; b' } }, 'project.owner_title'],
      [{ ...base, stack: { capabilities: {}, gates: 'x' } }, 'stack.gates'],
      ...['/tmp/gate.sh', '../gate.sh', 'tools/my gate.sh', '-x'].map((gate) => [
        { ...base, stack: { capabilities: {}, commands: { pre_pr_gate: gate } } },
        'stack.commands.pre_pr_gate',
      ]),
    ];
    for (const [config, key] of cases) {
      const root = makeProject(config);
      const before = configBytes(root);
      const r = runProject(['init', '--root', root, '--preset', 'igaming'], home);
      assert.strictEqual(r.status, 1, key);
      assert.ok(JSON.parse(r.stdout).errors.some((e) => e.reason.startsWith(key)), `${key}: ${r.stdout}`);
      assert.strictEqual(configBytes(root), before, key);
    }
    assert.strictEqual(fs.existsSync(path.join(home, 'projects.json')), false);
  });
});

describe('applyToConfig (pure)', () => {
  test('never creates stack.capabilities and never adds ui_qa', () => {
    const out = applyToConfig({ project: { slug: 'x' }, stack: { capabilities: { web_ui: false } } }, { slug: 'x', port_base: 55000 });
    assert.deepStrictEqual(out.stack.capabilities, { web_ui: false, backend: {} });
    const legacy = applyToConfig({ project: { slug: 'x' }, stack: { capabilities: {} } }, { slug: 'x', port_base: 55000 });
    assert.strictEqual('ui_qa' in legacy.stack.capabilities, false);
  });

  test('3.12 the never-touch list rewrites all five slots; a changed list leaves no old slot value', () => {
    const capabilities = {};
    const first = applyToConfig({ project: { slug: 'x' }, stack: { capabilities, deploy: { never_touch: ['a one', 'b two'] } } }, { slug: 'x', port_base: 55000 });
    assert.deepStrictEqual(first.stack.deploy, {
      never_touch: ['a one', 'b two'], slot_1: 'a one', slot_2: 'b two',
      slot_3: 'gsd-unused-deploy-entry-3', slot_4: 'gsd-unused-deploy-entry-4', slot_5: 'gsd-unused-deploy-entry-5',
    });
    const second = applyToConfig({ ...first, stack: { ...first.stack, deploy: { ...first.stack.deploy, never_touch: ['c three'] } } }, { slug: 'x', port_base: 55000 });
    assert.deepStrictEqual([second.stack.deploy.slot_1, second.stack.deploy.slot_2], ['c three', 'gsd-unused-deploy-entry-2']);
  });
});

describe('lock, GSD_HOME and slug review fixes (M-02 round 1: L1, L2)', () => {
  const lockFile = (dir) => path.join(dir, 'projects.lock');
  // Stale = mtime over 30 s old AND the owner pid dead (ESRCH). agedLock takes a dead pid unless told otherwise.
  const agedLock = (dir, token, pid = deadPid()) => {
    fs.writeFileSync(lockFile(dir), JSON.stringify({ token, pid }));
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockFile(dir), old, old);
  };
  const tokenOf = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).token;

  test('L1 a stale lock (old mtime, dead pid) is taken over and removed after the allocation', () => {
    const dir = mkTmp('gsd-registry-home-');
    agedLock(dir, 'dead-owner');
    assert.deepStrictEqual(allocate({ dir, slug: 'alpha', root: '/r/a' }), { ok: true, port_base: 55000, reused: false });
    assert.strictEqual(fs.existsSync(lockFile(dir)), false);
  });

  test('R4 an old lock whose pid is alive is never taken over: the waiter is refused and the lock stays', () => {
    const dir = mkTmp('gsd-registry-home-');
    agedLock(dir, 'live-slow-owner', process.pid);
    const r = allocate({ dir, slug: 'alpha', root: '/r/a' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /locked by another project init/);
    assert.strictEqual(tokenOf(lockFile(dir)), 'live-slow-owner');
  });

  test('R4 the takeover re-reads the owner under its marker: a lock another acquirer created is kept', () => {
    const dir = mkTmp('gsd-registry-home-');
    agedLock(dir, 'dead-owner');
    fs.writeFileSync(lockFile(dir), JSON.stringify({ token: 'new-owner', pid: process.pid }));
    assert.strictEqual(unlinkLockInstance(dir, 'dead-owner'), true);
    assert.strictEqual(tokenOf(lockFile(dir)), 'new-owner');
    assert.deepStrictEqual(fs.readdirSync(dir), ['projects.lock']);
  });

  test('R4 a stale lock taken over leaves no marker, temp or claim file behind', () => {
    const dir = mkTmp('gsd-registry-home-');
    agedLock(dir, 'dead-owner');
    allocate({ dir, slug: 'alpha', root: '/r/a' });
    assert.deepStrictEqual(fs.readdirSync(dir), ['projects.json']);
  });

  test('R4 a malformed lock is refused with a message naming the lock file, and is not removed', () => {
    const dir = mkTmp('gsd-registry-home-');
    fs.writeFileSync(lockFile(dir), 'not json');
    const r = acquireLock(dir, 'me');
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.includes(lockFile(dir)), r.reason);
    assert.strictEqual(fs.readFileSync(lockFile(dir), 'utf8'), 'not json');
  });

  test('R4 residual: a takeover marker left by a dead taker refuses the acquirer, naming both files; no port is allocated', () => {
    const dir = mkTmp('gsd-registry-home-');
    agedLock(dir, 'dead-owner');
    fs.writeFileSync(path.join(dir, 'projects.lock.dead-owner.takeover'), '');
    const r = allocate({ dir, slug: 'alpha', root: '/r/a' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.includes(lockFile(dir)) && r.reason.includes('projects.lock.dead-owner.takeover'), r.reason);
    assert.strictEqual(fs.existsSync(path.join(dir, 'projects.json')), false);
  });

  test('L1 a fresh lock held by another token is never removed: the waiter times out and the lock stays', () => {
    const dir = mkTmp('gsd-registry-home-');
    fs.writeFileSync(lockFile(dir), JSON.stringify({ token: 'other-owner', pid: 1 }));
    const r = allocate({ dir, slug: 'alpha', root: '/r/a' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /locked by another project init/);
    assert.strictEqual(JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')).token, 'other-owner');
    assert.strictEqual(fs.existsSync(path.join(dir, 'projects.json')), false);
  });

  test('L1 a filesystem error that is not a lock collision returns {ok:false} with no stack trace', () => {
    const notADir = path.join(mkTmp('gsd-registry-home-'), 'file');
    fs.writeFileSync(notADir, 'x');
    const r = allocate({ dir: notADir, slug: 'alpha', root: '/r/a' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(typeof r.reason, 'string');
    assert.doesNotMatch(r.reason, /\n\s+at /);
  });

  test('L2 the same root under a different slug is refused, naming both slugs and the manual-edit hint', () => {
    const dir = mkTmp('gsd-registry-home-');
    allocate({ dir, slug: 'alpha', root: '/r/a' });
    const r = allocate({ dir, slug: 'beta', root: '/r/a' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /"alpha".*"beta"|"beta".*"alpha"/);
    assert.match(r.reason, /by hand/);
    assert.deepStrictEqual(Object.keys(readJson(path.join(dir, 'projects.json')).projects), ['alpha']);
  });

  test('L2 unregister removes a slug; a second unregister is refused', () => {
    const dir = mkTmp('gsd-registry-home-');
    allocate({ dir, slug: 'alpha', root: '/r/a' });
    allocate({ dir, slug: 'beta', root: '/r/b' });
    assert.deepStrictEqual(unregister({ dir, slug: 'alpha' }), { ok: true, removed: 'alpha' });
    assert.deepStrictEqual(Object.keys(readJson(path.join(dir, 'projects.json')).projects), ['beta']);
    assert.deepStrictEqual(unregister({ dir, slug: 'alpha' }), { ok: false, reason: 'slug "alpha" is not registered' });
  });

  test('R2 L2 a failed registry rename removes its temp file and leaves no projects.json', () => {
    const dir = mkTmp('gsd-registry-home-');
    const realRename = fs.renameSync;
    fs.renameSync = () => {
      throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
    };
    let r;
    try {
      r = allocate({ dir, slug: 'alpha', root: '/r/a' });
    } finally {
      fs.renameSync = realRename;
    }
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /registry write failed: injected rename failure/);
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
    assert.strictEqual(fs.existsSync(path.join(dir, 'projects.json')), false);
  });

  test('L2 a relative GSD_HOME is rejected with an error before any write', () => {
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const before = configBytes(root);
    const r = runProject(['init', '--root', root, '--preset', 'igaming'], 'relative/home');
    assert.strictEqual(r.status, 1);
    assert.match(JSON.parse(r.stdout).errors[0].reason, /GSD_HOME must be an absolute path/);
    assert.strictEqual(configBytes(root), before);
  });
});

describe('init rollback (M-02 round 1: M2)', () => {
  const TOOLS_HOME = () => mkTmp('gsd-registry-home-');
  const initArgs = (root) => ['init', '--root', root, '--preset', 'igaming'];
  const engineStub = (exitCode, result) => () => ({ exitCode, result });

  test('M2 a declined confirmation restores the config bytes and leaves the registry unchanged', () => {
    const home = TOOLS_HOME();
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const before = configBytes(root);
    const r = initWithRegistration(root, initArgs(root), { GSD_HOME: home },
      engineStub(1, { ok: false, refused: { reason: 'confirmation declined' }, written: [] }));
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(configBytes(root), before);
    assert.strictEqual(fs.existsSync(path.join(home, 'projects.json')), false);
  });

  test('M2 an engine exception restores the config bytes and the registry bytes', () => {
    const home = TOOLS_HOME();
    allocate({ dir: home, slug: 'other', root: '/r/other' });
    const registryBefore = fs.readFileSync(path.join(home, 'projects.json'), 'utf8');
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const before = configBytes(root);
    const r = initWithRegistration(root, initArgs(root), { GSD_HOME: home }, () => { throw new Error('engine broke'); });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.result.errors[0].reason, /engine error: engine broke/);
    assert.strictEqual(configBytes(root), before);
    assert.strictEqual(fs.readFileSync(path.join(home, 'projects.json'), 'utf8'), registryBefore);
  });

  test('M2 an exit 0 that wrote nothing is rolled back; a guarded CLI refusal is rolled back too', () => {
    const home = TOOLS_HOME();
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const before = configBytes(root);
    initWithRegistration(root, initArgs(root), { GSD_HOME: home }, engineStub(0, { ok: true, written: [] }));
    assert.strictEqual(configBytes(root), before);
    assert.strictEqual(fs.existsSync(path.join(home, 'projects.json')), false);

    const existing = makeProject({ project: { slug: 'kept-out' }, stack: { capabilities: {} } });
    fs.mkdirSync(path.join(existing, '.claude'));
    fs.writeFileSync(path.join(existing, '.claude', 'settings.json'), '{}\n');
    const existingBefore = configBytes(existing);
    const r = runProject(initArgs(existing), home);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(configBytes(existing), existingBefore);
    assert.strictEqual(fs.existsSync(path.join(home, 'projects.json')), false);
  });

  test('M2 a partial conflict (exit 2) that wrote other files keeps the config and the registry slot', () => {
    const home = TOOLS_HOME();
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const r = initWithRegistration(root, initArgs(root), { GSD_HOME: home },
      engineStub(2, { ok: false, written: ['CLAUDE.md'] }));
    assert.strictEqual(r.exitCode, 2);
    assert.strictEqual(configOf(root).stack.isolation.port_base, 55000);
    assert.strictEqual(readJson(path.join(home, 'projects.json')).projects.demo.port_base, 55000);
  });

  test('L1 (R2) an engine exit 1 with written files and rolled_back false keeps the config and the registry slot', () => {
    const home = TOOLS_HOME();
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const r = initWithRegistration(root, initArgs(root), { GSD_HOME: home },
      engineStub(1, { ok: false, written: ['CLAUDE.md'], rolled_back: false, errors: [{ reason: 'write failed' }] }));
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(configOf(root).stack.isolation.port_base, 55000);
    assert.strictEqual(readJson(path.join(home, 'projects.json')).projects.demo.port_base, 55000);
    assert.doesNotMatch(JSON.stringify(r.result.errors), /not rolled back/);
  });

  test('M2 a registry write failing after the config write restores the config', () => {
    const home = TOOLS_HOME();
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const before = configBytes(root);
    // A directory at the registry temp path makes the registry write fail after the config is written.
    fs.mkdirSync(path.join(home, `projects.json.${process.pid}.tmp`));
    const r = registerForInit(root, ['init', '--root', root], { GSD_HOME: home });
    assert.strictEqual(r.ok, false);
    assert.match(r.errors[0].reason, /registry write failed/);
    assert.strictEqual(configBytes(root), before);
    assert.strictEqual(fs.existsSync(path.join(home, 'projects.json')), false);
  });

  test('M2 undo() after a successful registration restores the config bytes and removes the slot', () => {
    const home = TOOLS_HOME();
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const before = configBytes(root);
    const r = registerForInit(root, ['init', '--root', root], { GSD_HOME: home });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.undo().ok, true);
    assert.strictEqual(configBytes(root), before);
    assert.strictEqual(fs.existsSync(path.join(home, 'projects.json')), false);
  });
});

describe('R4 seam: a waiter stalled between observing a stale lock and taking its marker', () => {
  const lockFile = (dir) => path.join(dir, 'projects.lock');
  const registryFile = (dir) => path.join(dir, 'projects.json');
  const tokenOf = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).token;
  const agedLock = (dir, token) => {
    fs.writeFileSync(lockFile(dir), JSON.stringify({ token, pid: deadPid() }));
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lockFile(dir), old, old);
  };

  test('a full successor cycle (takeover, its own lock, a live successor) during the stall keeps the successor lock', () => {
    const dir = mkTmp('gsd-registry-seam-');
    agedLock(dir, 'dead-owner');
    let seamRan = false;
    const waiter = acquireLock(dir, 'waiter', {
      beforeMarker: (observed) => {
        seamRan = true;
        assert.strictEqual(observed.token, 'dead-owner');
        assert.deepStrictEqual(acquireLock(dir, 'successor'), { ok: true });
        assert.strictEqual(unlinkLockInstance(dir, 'successor'), true);
        assert.deepStrictEqual(acquireLock(dir, 'fourth'), { ok: true });
      },
    });
    assert.ok(seamRan, 'the seam runs between the observation and the marker');
    assert.strictEqual(waiter.ok, false);
    assert.match(waiter.reason, /locked by another project init/);
    assert.strictEqual(tokenOf(lockFile(dir)), 'fourth', 'the waiter never unlinks a lock it did not observe');
    assert.deepStrictEqual(fs.readdirSync(dir), ['projects.lock']);
  });

  test('a successor cycle that ends with its lock released lets the stalled waiter take the lock', () => {
    const dir = mkTmp('gsd-registry-seam-');
    agedLock(dir, 'dead-owner');
    const waiter = acquireLock(dir, 'waiter', {
      beforeMarker: () => {
        assert.deepStrictEqual(acquireLock(dir, 'successor'), { ok: true });
        assert.strictEqual(unlinkLockInstance(dir, 'successor'), true);
      },
    });
    assert.deepStrictEqual(waiter, { ok: true });
    assert.strictEqual(tokenOf(lockFile(dir)), 'waiter');
    assert.deepStrictEqual(fs.readdirSync(dir), ['projects.lock']);
  });

  test('the plan is made again when the registry changed between the read and the write', () => {
    const dir = mkTmp('gsd-registry-replan-');
    fs.writeFileSync(registryFile(dir), JSON.stringify({ version: 1, projects: {} }));
    let changed = false;
    const plan = planUnderLock(dir, (data) => planAllocation(data, { slug: 'alpha', root: '/r/a' }), () => {
      if (changed) return;
      changed = true;
      fs.writeFileSync(registryFile(dir), JSON.stringify({ version: 1, projects: { other: { root: '/r/o', port_base: 55000 } } }));
    });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.port_base, 55100, 'planned from the bytes present at the write, not the stale read');
  });

  test('a registry that changes on every check is refused after one re-plan, not looped', () => {
    const dir = mkTmp('gsd-registry-replan-');
    fs.writeFileSync(registryFile(dir), JSON.stringify({ version: 1, projects: {} }));
    let n = 0;
    const plan = planUnderLock(dir, (data) => planAllocation(data, { slug: 'alpha', root: '/r/a' }), () => {
      n += 1;
      fs.writeFileSync(registryFile(dir), JSON.stringify({ version: 1, projects: { [`p${n}`]: { root: `/r/${n}`, port_base: 60000 + n * 100 } } }));
    });
    assert.strictEqual(plan.ok, false);
    assert.match(plan.reason, /changed during the allocation/);
    assert.strictEqual(n, 2, 'one re-plan: the check runs on two passes');
  });
});

describe('3.8 C1 rendered values and deploy slots on every engine command', () => {
  // A hash of every file under root, so a refusal that wrote anything is caught.
  const treeHash = (root) => {
    const crypto = require('crypto');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
    const h = crypto.createHash('sha256');
    for (const f of walk(root).sort()) h.update(`${f}\n`).update(fs.readFileSync(f));
    return h.digest('hex');
  };
  const initBase = (root, home) => {
    const r = runProject(['init', '--root', root, '--preset', 'base'], home);
    assert.strictEqual(r.status, 0, r.stdout);
  };
  const withConfig = (root, edit) => {
    const cfg = configOf(root);
    edit(cfg);
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify(cfg, null, 2));
  };
  const diffArgs = (root) => ['diff', '--root', root, '--preset', 'base'];
  const syncArgs = (root) => ['sync', '--root', root, '--preset', 'base'];

  test('C1 an unsafe rendered value is refused by diff and sync, naming the key, with no file changed', () => {
    const cases = [
      [(c) => { c.stack.branch = { default: "x'; system('id'); '" }; }, 'stack.branch.default'],
      [(c) => { c.project.owner_title = 'a"b'; }, 'project.owner_title'],
      [(c) => { c.stack.commands.search = 'x; y'; }, 'stack.commands.search'],
      [(c) => { c.stack.deploy.slot_3 = 'a)b'; }, 'stack.deploy.slot_3'],
      [(c) => { c.stack.deploy = 'x'; }, 'stack.deploy'],
    ];
    for (const [edit, key] of cases) {
      const home = mkTmp('gsd-registry-home-');
      const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {}, commands: { search: 'git grep -n' } } });
      initBase(root, home);
      withConfig(root, edit);
      const before = treeHash(root);
      for (const args of [diffArgs(root), syncArgs(root)]) {
        const r = runProject(args, home);
        assert.strictEqual(r.status, 1, `${key} ${args[0]}: ${r.stdout}`);
        assert.ok(JSON.parse(r.stdout).errors.some((e) => e.reason.startsWith(key)), `${key} ${args[0]}`);
        assert.strictEqual(treeHash(root), before, `${key} ${args[0]} changed a file`);
      }
    }
  });

  test('C1 an init whose config has no slug and a bad stack.branch.default exits 1 naming the key', () => {
    const home = mkTmp('gsd-registry-home-');
    const root = makeProject({ project: {}, stack: { capabilities: {}, branch: { default: 'a"b' } } });
    const before = configBytes(root);
    const r = runProject(['init', '--root', root, '--preset', 'base'], home);
    assert.strictEqual(r.status, 1);
    assert.ok(JSON.parse(r.stdout).errors.some((e) => e.reason.startsWith('stack.branch.default')), r.stdout);
    assert.strictEqual(configBytes(root), before);
  });

  test('C1 a never-touch list changed after init re-derives slot_2 on diff and reaches the deny rows', () => {
    const home = mkTmp('gsd-registry-home-');
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {}, deploy: { never_touch: ['tools/release.sh prod'] } } });
    initBase(root, home);
    withConfig(root, (c) => { c.stack.deploy.never_touch.push('kubectl apply -f prod'); });
    const r = runProject(diffArgs(root), home);
    assert.strictEqual(r.status, 2, r.stdout);
    assert.strictEqual(configOf(root).stack.deploy.slot_2, 'kubectl apply -f prod');
    assert.ok(JSON.parse(r.stdout).settings.added.permissions.deny.includes('Bash(kubectl apply -f prod:*)'));
    withConfig(root, (c) => { c.stack.deploy.never_touch.pop(); });
    runProject(diffArgs(root), home);
    assert.strictEqual(configOf(root).stack.deploy.slot_2, 'gsd-unused-deploy-entry-2');
  });

  test('C1 sync re-derives slots before the engine runs; a refusal without writes restores the config bytes', () => {
    const home = mkTmp('gsd-registry-home-');
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {}, deploy: { never_touch: ['tools/release.sh prod'] } } });
    initBase(root, home);
    withConfig(root, (c) => { c.stack.deploy.never_touch.push('kubectl apply -f prod'); });
    const before = configBytes(root);
    let seen;
    const ok = initWithRegistration(root, syncArgs(root), { GSD_HOME: home }, () => {
      seen = configOf(root).stack.deploy.slot_2;
      return { exitCode: 0, result: { ok: true, written: ['x'] } };
    });
    assert.strictEqual(ok.exitCode, 0);
    assert.strictEqual(seen, 'kubectl apply -f prod', 'the engine saw the re-derived slot');
    assert.strictEqual(configOf(root).stack.deploy.slot_2, 'kubectl apply -f prod');
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), before);
    const refused = initWithRegistration(root, syncArgs(root), { GSD_HOME: home }, () => ({
      exitCode: 1, result: { ok: false, errors: [{ reason: 'refused' }], written: [] },
    }));
    assert.strictEqual(refused.exitCode, 1);
    assert.strictEqual(configBytes(root), before, 'a refusal without writes keeps the config as it was');
  });

  test('C1 a diff with a config that is not JSON is left to the engine and the bytes stay', () => {
    const home = mkTmp('gsd-registry-home-');
    const root = makeProject('<<<<<<< HEAD\n{}');
    const before = configBytes(root);
    runProject(diffArgs(root), home);
    assert.strictEqual(configBytes(root), before);
  });
});

describe('9.13 default gates and style config', () => {
  const IDS = ['hook-canaries', 'hook-patch-trailer', 'guard-canaries', 'guard-registry', 'style', 'flake-patterns', 'dependency-scan', 'adr', 'assertion-quality'];
  const idsOf = (cfg) => cfg.stack.gates.map((g) => g.id);
  const initBase = (config) => {
    const home = mkTmp('gsd-registry-home-');
    const root = makeProject(config);
    const r = runProject(['init', '--root', root, '--preset', 'base'], home);
    assert.strictEqual(r.status, 0, r.stderr);
    return configOf(root);
  };
  const withCaps = (capabilities, extra = {}) => ({ project: { slug: 'demo' }, stack: { capabilities, ...extra } });

  test('G-a init appends the nine default gates in order with web_ui an object, eight with web_ui false, nine with web_ui absent', () => {
    assert.deepStrictEqual(idsOf(initBase(withCaps({ web_ui: {} }))), IDS);
    const off = initBase(withCaps({ web_ui: false }));
    assert.deepStrictEqual(idsOf(off), IDS.slice(0, 8));
    assert.strictEqual(off.stack.capabilities.web_ui, false);
    for (const caps of [{ backend: {} }, {}]) {
      const cfg = initBase(withCaps(caps));
      assert.deepStrictEqual(cfg.stack.capabilities.web_ui, {});
      assert.deepStrictEqual(idsOf(cfg), IDS);
    }
    const style = initBase(withCaps({})).stack.gates.find((g) => g.id === 'style');
    assert.deepStrictEqual(style, { id: 'style', run: 'node scripts/style-gate.mjs' });
  });

  test('G-b existing gates keep their entry and position; only the missing defaults are appended', () => {
    const cfg = initBase(withCaps({}, { gates: [{ id: 'style', run: 'custom' }, { id: 'mine', run: 'x' }] }));
    assert.deepStrictEqual(cfg.stack.gates.slice(0, 2), [{ id: 'style', run: 'custom' }, { id: 'mine', run: 'x' }]);
    assert.deepStrictEqual(idsOf(cfg), ['style', 'mine', ...IDS.filter((i) => i !== 'style')]);
    assert.strictEqual(cfg.stack.gates.filter((g) => g.id === 'style').length, 1);
  });

  test('G-c stack.style defaults to the generic rule set and is untouched when present', () => {
    assert.deepStrictEqual(initBase(withCaps({})).stack.style, { rule_set: 'generic', roots: ['.'] });
    const kept = { rule_set: 'js-ts', roots: ['src'] };
    assert.deepStrictEqual(initBase(withCaps({}, { style: kept })).stack.style, kept);
    const pure = applyToConfig({ project: { slug: 'x' }, stack: { capabilities: {} } }, { slug: 'x', port_base: 55000 });
    assert.deepStrictEqual(pure.stack.gates.map((g) => g.id), IDS);
    const again = applyToConfig(pure, { slug: 'x', port_base: 55000 });
    assert.deepStrictEqual(again.stack.gates, pure.stack.gates);
  });
});
