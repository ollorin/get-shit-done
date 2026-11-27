'use strict';

const { test, describe, afterEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { runCli: runDeploy } = require('./project-deploy.js');
const { upgradeAll, removeSuperseded, runCli, COMMIT_MESSAGE } = require('./project-upgrade.js');
const { migrateConfig } = require('./profile-migrations.js');
const { liveReasons } = require('./project-quiesce.js');
const { readRuns, revertLines } = require('./project-upgrade-log.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const FRAGMENT = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }] } };
const FILES = [
  { src: 'rules/style.md', dest: '.claude/rules/style.md', kind: 'whole' },
  { src: 'hooks/guard.js', dest: '.claude/hooks/guard.js', kind: 'whole' },
];

before(() => {
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  });
});

const tmpDirs = [];
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

const writeAt = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const git = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

function writePreset(dir, version) {
  writeAt(dir, 'rules/style.md', `# Style v${version}\n`);
  writeAt(dir, 'hooks/guard.js', `// guard v${version}\nprocess.exit(0);\n`);
  writeAt(dir, 'settings.fragment.json', JSON.stringify(FRAGMENT));
  writeAt(dir, 'preset.json', JSON.stringify({ name: 'demo', version: String(version), files: FILES, settings_fragment: 'settings.fragment.json' }));
}

// Two initialised, committed projects on preset v1, a registry naming both, and preset v2 waiting in presetsRoot.
function fixture() {
  const home = mkTmp('gsd-home-');
  const presetsRoot = mkTmp('gsd-presets-');
  writePreset(path.join(presetsRoot, 'demo'), 1);
  const roots = ['alpha', 'beta'].map((name, i) => {
    const root = mkTmp(`gsd-${name}-`);
    git(root, 'init', '-q');
    writeAt(root, '.planning/config.json', JSON.stringify({ project: { slug: name }, stack: { preset: 'demo', capabilities: {} } }, null, 2));
    const init = runDeploy(root, ['init', '--root', root], {}, HUMAN, { confirm: () => 'APPLY', presetsRoot });
    assert.strictEqual(init.exitCode, 0, JSON.stringify(init.result));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    return { name, root, port: 55000 + i * 100 };
  });
  writeAt(home, 'projects.json', JSON.stringify({ version: 1, projects: Object.fromEntries(roots.map((r) => [r.name, { root: r.root, port_base: r.port }])) }));
  writePreset(path.join(presetsRoot, 'demo'), 2);
  return { home, presetsRoot, roots, env: { GSD_HOME: home } };
}

function snapshot(root) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (e.name === '.git' && rel === '') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, r))).digest('hex');
    }
  };
  walk('');
  return out;
}

const run = (fx, extra = {}) => {
  const asks = [];
  const result = upgradeAll({
    env: fx.env, session: HUMAN, presetsRoot: fx.presetsRoot, confirm: (text) => { asks.push(text); return 'APPLY'; }, ...extra,
  });
  return { ...result, asks };
};
const head = (root) => git(root, 'rev-parse', 'HEAD');

describe('project upgrade', () => {
  test('a clean run commits once per project with only the upgraded paths, asks once, prints doctor, then a second run is a no-op', () => {
    const fx = fixture();
    const [a, b] = fx.roots;
    writeAt(a.root, 'notes.txt', 'mine\n');
    const heads = fx.roots.map((r) => head(r.root));
    const doctored = [];
    const first = run(fx, { doctor: (root) => { doctored.push(root); return { exitCode: 0, text: 'doctor: up to date\n' }; } });
    assert.strictEqual(first.exitCode, 0, first.lines.join('\n'));
    assert.strictEqual(first.asks.length, 1);
    assert.match(first.asks[0], /project alpha/);
    assert.match(first.asks[0], /project beta/);
    assert.deepStrictEqual(doctored, [a.root, b.root]);
    for (const r of fx.roots) {
      assert.notStrictEqual(head(r.root), heads[fx.roots.indexOf(r)]);
      assert.strictEqual(git(r.root, 'log', '-1', '--format=%s'), COMMIT_MESSAGE);
      assert.strictEqual(fs.readFileSync(path.join(r.root, '.claude/rules/style.md'), 'utf8'), '# Style v2\n');
    }
    assert.match(git(a.root, 'status', '--porcelain'), /^\?\? notes\.txt$/m);
    assert.doesNotMatch(git(a.root, 'show', '--name-only', '--format=', 'HEAD'), /notes\.txt/);
    assert.strictEqual(readRuns(fx.home).at(-1).commits.length, 2);
    assert.match(revertLines(fx.home).join('\n'), new RegExp(`git -C .*${path.basename(a.root)}.* revert ${head(a.root)}`));

    const before = fx.roots.map((r) => [head(r.root), snapshot(r.root)]);
    const second = run(fx);
    assert.strictEqual(second.exitCode, 0, second.lines.join('\n'));
    assert.strictEqual(second.asks.length, 0);
    assert.deepStrictEqual(fx.roots.map((r) => [head(r.root), snapshot(r.root)]), before);
  });

  test('a live lease in one project refuses the whole upgrade, names the project and writes nothing', () => {
    const fx = fixture();
    const [a, b] = fx.roots;
    writeAt(b.root, '.git/gsd-dispatch-leases.json', JSON.stringify({ leases: [{ id: 'x', role: 'executor', phase: '3', begin: new Date().toISOString(), end: null, owner: { pid: process.pid, start: 's' } }] }));
    const before = fx.roots.map((r) => [head(r.root), snapshot(r.root)]);
    const result = run(fx);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines.join('\n'), /beta: open dispatch lease x/);
    assert.doesNotMatch(result.lines.join('\n'), /alpha:/);
    assert.strictEqual(result.asks.length, 0);
    assert.deepStrictEqual(fx.roots.map((r) => [head(r.root), snapshot(r.root)]), before);
    assert.strictEqual(a.name, 'alpha');
  });

  test('liveReasons: a held lock and a fresh event each refuse; a closed window and an old event pass', () => {
    const root = mkTmp('gsd-live-');
    const now = Date.parse('2026-11-27T12:00:00Z');
    const event = (type, minutesAgo) => writeAt(root, '.planning/EXECUTION_LOG.md', `${JSON.stringify({ timestamp: new Date(now - minutesAgo * 60000).toISOString(), type, phase: '1' })}\n`);
    assert.deepStrictEqual(liveReasons(root, { now }), []);
    event('dispatch_begin', 5);
    assert.match(liveReasons(root, { now })[0], /younger than 45 minutes/);
    event('phase_complete', 5);
    assert.deepStrictEqual(liveReasons(root, { now }), []);
    event('dispatch_begin', 50);
    assert.deepStrictEqual(liveReasons(root, { now }), []);
    writeAt(root, '.tmp/stack.lock.d/owner.txt', JSON.stringify({ pid: 4242 }));
    assert.match(liveReasons(root, { now, alive: (pid) => pid === 4242 })[0], /stack lock held by pid 4242/);
    assert.deepStrictEqual(liveReasons(root, { now, alive: () => false }), []);
  });

  test('corrupt settings.local.json in one project refuses before any write', () => {
    const fx = fixture();
    writeAt(fx.roots[1].root, '.claude/settings.local.json', '{ not json');
    const before = fx.roots.map((r) => [head(r.root), snapshot(r.root)]);
    const result = run(fx);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines.join('\n'), /beta: \.claude\/settings\.local\.json not valid JSON/);
    assert.deepStrictEqual(fx.roots.map((r) => [head(r.root), snapshot(r.root)]), before);
  });

  test('an uncommitted edit in a file the upgrade writes refuses before any write', () => {
    const fx = fixture();
    writeAt(fx.roots[0].root, '.planning/config.json', JSON.stringify({ project: { slug: 'alpha', note: 'mine' }, stack: { preset: 'demo', capabilities: {}, locked_commands: ['x'] } }));
    const before = fx.roots.map((r) => snapshot(r.root));
    const result = run(fx);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines.join('\n'), /alpha: uncommitted changes.*config\.json/);
    assert.deepStrictEqual(fx.roots.map((r) => snapshot(r.root)), before);
  });

  test('an agent session is refused and nothing is written', () => {
    const fx = fixture();
    const before = fx.roots.map((r) => [head(r.root), snapshot(r.root)]);
    const result = run(fx, { env: { ...fx.env, CLAUDECODE: '1' } });
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines.join('\n'), /refused: guardrail paths change only from a terminal/);
    assert.deepStrictEqual(fx.roots.map((r) => [head(r.root), snapshot(r.root)]), before);
  });

  test('a declined confirmation and a blocking doctor result are exit 1', () => {
    const declined = fixture();
    const before = declined.roots.map((r) => snapshot(r.root));
    assert.strictEqual(run(declined, { confirm: () => 'no' }).exitCode, 1);
    assert.deepStrictEqual(declined.roots.map((r) => snapshot(r.root)), before);
    const red = run(fixture(), { doctor: () => ({ exitCode: 1, text: 'doctor: NOT up to date\n' }) });
    assert.strictEqual(red.exitCode, 1);
    assert.match(red.lines.join('\n'), /NOT up to date/);
  });

  test('settings.local.json keeps a foreign hook: the empty table changes nothing, a listed script is the only removal', () => {
    const fx = fixture();
    const local = { env: { A: '1' }, hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'deno run foreign.ts' }, { type: 'command', command: 'deno run old-reaper.ts' }] }], Stop: [{ hooks: [{ type: 'command', command: 'old-reaper.ts' }] }] }, other: true };
    writeAt(fx.roots[0].root, '.claude/settings.local.json', JSON.stringify(local, null, 2));
    const bytes = fs.readFileSync(path.join(fx.roots[0].root, '.claude/settings.local.json'), 'utf8');
    assert.strictEqual(run(fx).exitCode, 0);
    assert.strictEqual(fs.readFileSync(path.join(fx.roots[0].root, '.claude/settings.local.json'), 'utf8'), bytes);
    assert.strictEqual(removeSuperseded(local), local);
    const pruned = removeSuperseded(local, ['old-reaper.ts']);
    assert.deepStrictEqual(pruned, { env: { A: '1' }, hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'deno run foreign.ts' }] }] }, other: true });
    assert.deepStrictEqual(Object.keys(pruned), ['env', 'hooks', 'other']);
  });

  test('migrations: the error_pattern rename is behind the WP9 flag, table defaults fill only absent keys', () => {
    const config = { stack: { mutation: { error_pattern: 'E' }, commands: { search: 'rg' } } };
    const off = migrateConfig(config, { refusesErrorPattern: false });
    assert.strictEqual(off.stack.mutation.error_pattern, 'E');
    const on = migrateConfig(config, { refusesErrorPattern: true });
    assert.deepStrictEqual(on.stack.mutation, { build_error_pattern: 'E' });
    assert.deepStrictEqual(migrateConfig(on, { refusesErrorPattern: true }), on);
    assert.strictEqual(on.stack.commands.search, 'rg');
  });

  test('the command takes no flags', () => {
    const result = runCli(['--dry-run']);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines[0], /takes no arguments/);
  });
});
