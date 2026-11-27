'use strict';

const { test, describe, afterEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { runCli: runDeploy } = require('./project-deploy.js');
const { upgradeAll, planOnly, removeSuperseded, runCli, SUPERSEDED_HOOKS, COMMIT_MESSAGE } = require('./project-upgrade.js');
const { migrateConfig, neededMigrationIds } = require('./profile-migrations.js');
const { readRuns, commitsOfRecord } = require('./project-upgrade-log.js');
const { revertRecord } = require('./project-upgrade-revert.js');
const { openRecord, closeRecord, rollbackAll } = require('../../bin/install-record.js');

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

// A preset shaped like the base preset: its SubagentStop hook is the framework reaper.
const REAPER_FRAGMENT = {
  hooks: { ...FRAGMENT.hooks, SubagentStop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/agent-stop-reaper.mjs' }] }] },
};
const NEIGHBOUR_HOOK = 'deno run --allow-run=ps,kill /x/scripts/host/subagent-stop-record.ts';
const localWithNeighbour = () => ({ env: { A: '1' }, hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: NEIGHBOUR_HOOK }] }] } });

function writePreset(dir, version, fragment = FRAGMENT) {
  writeAt(dir, 'rules/style.md', `# Style v${version}\n`);
  writeAt(dir, 'hooks/guard.js', `// guard v${version}\nprocess.exit(0);\n`);
  writeAt(dir, 'settings.fragment.json', JSON.stringify(fragment));
  writeAt(dir, 'preset.json', JSON.stringify({ name: 'demo', version: String(version), files: FILES, settings_fragment: 'settings.fragment.json' }));
}

// Two initialised, committed projects on preset v1, a registry naming both, and preset v2 waiting in presetsRoot.
function fixture(fragment = FRAGMENT) {
  const home = mkTmp('gsd-home-');
  const presetsRoot = mkTmp('gsd-presets-');
  writePreset(path.join(presetsRoot, 'demo'), 1, fragment);
  const roots = ['alpha', 'beta'].map((name, i) => {
    const root = mkTmp(`gsd-${name}-`);
    git(root, 'init', '-q');
    writeAt(root, '.planning/config.json', JSON.stringify({ project: { slug: name }, stack: { preset: 'demo', capabilities: {} } }, null, 2));
    const init = runDeploy(root, ['init', '--root', root], { presetsRoot });
    assert.strictEqual(init.exitCode, 0, JSON.stringify(init.result));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    return { name, root, port: 55000 + i * 100 };
  });
  writeAt(home, 'projects.json', JSON.stringify({ version: 1, projects: Object.fromEntries(roots.map((r) => [r.name, { root: r.root, port_base: r.port }])) }));
  writePreset(path.join(presetsRoot, 'demo'), 2, fragment);
  // HOME is a temp dir with no ~/.claude/projects: the run never looks at the real one.
  return { home, presetsRoot, roots, env: { GSD_HOME: home, HOME: mkTmp('gsd-userhome-'), GSD_FRAMEWORK_RECORD: 'rec1' } };
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

const run = (fx, extra = {}) => upgradeAll({ env: fx.env, presetsRoot: fx.presetsRoot, ...extra });
const head = (root) => git(root, 'rev-parse', 'HEAD');

describe('project upgrade', () => {
  test('a clean run commits once per project with only the upgraded paths, prints doctor, then a second run is a no-op', () => {
    const fx = fixture();
    const [a, b] = fx.roots;
    writeAt(a.root, 'notes.txt', 'mine\n');
    const heads = fx.roots.map((r) => head(r.root));
    const doctored = [];
    const first = run(fx, { doctor: (root) => { doctored.push(root); return { exitCode: 0, text: 'doctor: up to date\n' }; } });
    assert.strictEqual(first.exitCode, 0, first.lines.join('\n'));
    assert.deepStrictEqual(doctored, [a.root, b.root]);
    for (const r of fx.roots) {
      assert.notStrictEqual(head(r.root), heads[fx.roots.indexOf(r)]);
      assert.strictEqual(git(r.root, 'log', '-1', '--format=%s'), COMMIT_MESSAGE);
      assert.strictEqual(fs.readFileSync(path.join(r.root, '.claude/rules/style.md'), 'utf8'), '# Style v2\n');
    }
    assert.match(git(a.root, 'status', '--porcelain'), /^\?\? notes\.txt$/m);
    assert.doesNotMatch(git(a.root, 'show', '--name-only', '--format=', 'HEAD'), /notes\.txt/);
    assert.strictEqual(readRuns(fx.home).at(-1).commits.length, 2);
    assert.deepStrictEqual(commitsOfRecord(fx.home, 'rec1').map((c) => c.sha).sort(), [head(a.root), head(b.root)].sort());
    assert.deepStrictEqual(commitsOfRecord(fx.home, 'other'), []);

    const before = fx.roots.map((r) => [head(r.root), snapshot(r.root)]);
    const second = run(fx);
    assert.strictEqual(second.exitCode, 0, second.lines.join('\n'));
    assert.deepStrictEqual(fx.roots.map((r) => [head(r.root), snapshot(r.root)]), before);
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

  test('an agent-like env (CLAUDECODE=1) upgrades like a terminal', () => {
    const fx = fixture();
    const result = run(fx, { env: { ...fx.env, CLAUDECODE: '1' } });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.commits.length, fx.roots.length);
  });

  test('a blocking doctor result is exit 1', () => {
    const red = run(fixture(), { doctor: () => ({ exitCode: 1, text: 'doctor: NOT up to date\n' }) });
    assert.strictEqual(red.exitCode, 1);
    assert.match(red.lines.join('\n'), /NOT up to date/);
  });

  test('settings.local.json keeps a foreign hook: an unlisted script changes nothing, a listed script is the only removal', () => {
    const fx = fixture();
    const local = { env: { A: '1' }, hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'deno run foreign.ts' }, { type: 'command', command: 'deno run old-reaper.ts' }] }], Stop: [{ hooks: [{ type: 'command', command: 'old-reaper.ts' }] }] }, other: true };
    writeAt(fx.roots[0].root, '.claude/settings.local.json', JSON.stringify(local, null, 2));
    const bytes = fs.readFileSync(path.join(fx.roots[0].root, '.claude/settings.local.json'), 'utf8');
    assert.strictEqual(run(fx).exitCode, 0);
    assert.strictEqual(fs.readFileSync(path.join(fx.roots[0].root, '.claude/settings.local.json'), 'utf8'), bytes);
    assert.deepStrictEqual(removeSuperseded(local), local);
    const neighbour = { hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'deno run --allow-run=ps,kill /x/scripts/host/subagent-stop-record.ts' }] }] }, env: { A: '1' } };
    assert.deepStrictEqual(removeSuperseded(neighbour), { hooks: {}, env: { A: '1' } });
    assert.deepStrictEqual([...SUPERSEDED_HOOKS], ['subagent-stop-record.ts']);
    const pruned = removeSuperseded(local, ['old-reaper.ts']);
    assert.deepStrictEqual(pruned, { env: { A: '1' }, hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'deno run foreign.ts' }] }], Stop: local.hooks.Stop }, other: true });
    assert.deepStrictEqual(Object.keys(pruned), ['env', 'hooks', 'other']);
  });

  test('removeSuperseded removes only the exact script token in SubagentStop; look-alikes and other events stay', () => {
    const hook = (command) => ({ type: 'command', command });
    const keep = [hook('bash my-subagent-stop-record.ts.bak.sh'), hook('deno run not-subagent-stop-record.tsx'), hook('deno run subagent-stop-record.tsx')];
    const mixed = {
      hooks: {
        SubagentStop: [{ hooks: [hook(NEIGHBOUR_HOOK), ...keep] }, { hooks: [hook('subagent-stop-record.ts')] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [hook('cat subagent-stop-record.ts')] }],
      },
    };
    assert.deepStrictEqual(removeSuperseded(mixed), {
      hooks: { SubagentStop: [{ hooks: keep }], PreToolUse: mixed.hooks.PreToolUse },
    });
    const only = { hooks: { SubagentStop: [{ hooks: [hook(NEIGHBOUR_HOOK)] }], PreToolUse: mixed.hooks.PreToolUse } };
    assert.deepStrictEqual(removeSuperseded(only), { hooks: { PreToolUse: mixed.hooks.PreToolUse } });
  });

  test('a project whose preset does not register the reaper keeps its subagent-stop-record hook and asks nothing', () => {
    const fx = fixture();
    const file = path.join(fx.roots[0].root, '.claude/settings.local.json');
    writeAt(fx.roots[0].root, '.claude/settings.local.json', JSON.stringify(localWithNeighbour(), null, 2));
    const bytes = fs.readFileSync(file, 'utf8');
    git(fx.roots[0].root, 'add', '-A');
    git(fx.roots[0].root, 'commit', '-q', '-m', 'local');
    const result = run(fx);
    assert.strictEqual(result.exitCode, 0, result.lines.join('\n'));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
  });

  test('a project whose preset registers the reaper loses the superseded hook', () => {
    const fx = fixture(REAPER_FRAGMENT);
    assert.strictEqual(run(fx).exitCode, 0);
    const { root } = fx.roots[0];
    const file = path.join(root, '.claude/settings.local.json');
    writeAt(root, '.claude/settings.local.json', JSON.stringify(localWithNeighbour(), null, 2));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'local');
    const bytes = fs.readFileSync(file, 'utf8');
    assert.notStrictEqual(bytes, '');
    const applied = run(fx);
    assert.strictEqual(applied.exitCode, 0, applied.lines.join('\n'));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { env: { A: '1' }, hooks: {} });
  });

  test('migrations: error_pattern is left for the owner (no rename), table defaults fill only absent keys', () => {
    const config = { stack: { mutation: { error_pattern: 'E' }, commands: { search: 'rg' } } };
    const on = migrateConfig(config);
    assert.deepStrictEqual(on.stack.mutation, { error_pattern: 'E' });
    assert.deepStrictEqual(migrateConfig(on), on);
    assert.strictEqual(on.stack.commands.search, 'rg');
  });

  test('migrations: gate-needs-stack marks only table stack-free gates that lack the field, keeps explicit values, is idempotent', () => {
    const gates = [
      { id: 'style', run: 'a' }, { id: 'adr', run: 'b', needs_stack: true }, { id: 'hook-canaries', run: 'c', needs_stack: false },
      { id: 'dependency-scan', run: 'd' }, { id: 'guard-canaries', run: 'e' }, { id: 'custom', run: 'f' },
    ];
    const config = { stack: { gates, commands: { lint: 'x' } } };
    const next = migrateConfig(config);
    assert.deepStrictEqual(next.stack.gates, [{ id: 'style', run: 'a', needs_stack: false }, ...gates.slice(1)]);
    assert.deepStrictEqual(Object.keys(next.stack.gates[0]), ['id', 'run', 'needs_stack']);
    assert.deepStrictEqual(next.stack.commands, { lint: 'x' });
    assert.ok(neededMigrationIds(config).includes('gate-needs-stack'));
    assert.deepStrictEqual(migrateConfig(next), next);
    assert.ok(!neededMigrationIds(next).includes('gate-needs-stack'));
  });

  test('the command takes no flags', () => {
    const result = runCli(['--dry-run']);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines[0], /takes no arguments/);
  });
});

describe('project upgrade: review fixes', () => {
  test('a failing pre-commit hook restores every touched file, prints the hook output, exits non-zero, and the next run redoes the upgrade', () => {
    const fx = fixture();
    const [a, b] = fx.roots;
    const hook = path.join(a.root, '.git/hooks/pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho hook-said-no >&2\nexit 1\n', { mode: 0o755 });
    const heads = fx.roots.map((r) => head(r.root));
    const beforeA = snapshot(a.root);
    const first = run(fx);
    assert.strictEqual(first.exitCode, 1);
    assert.match(first.lines.join('\n'), /FAILED alpha: git commit failed.*\n.*hook-said-no|FAILED alpha:[^]*hook-said-no/);
    assert.deepStrictEqual(snapshot(a.root), beforeA);
    assert.strictEqual(git(a.root, 'status', '--porcelain'), '');
    assert.strictEqual(head(a.root), heads[0]);
    assert.strictEqual(head(b.root) === heads[1], false, 'the other project still committed');
    fs.rmSync(hook);
    const second = run(fx);
    assert.strictEqual(second.exitCode, 0, second.lines.join('\n'));
    assert.match(second.lines.join('\n'), /alpha: committed/);
    assert.strictEqual(fs.readFileSync(path.join(a.root, '.claude/rules/style.md'), 'utf8'), '# Style v2\n');
  });

  test('a detached HEAD refuses in the plan, before any write', () => {
    const fx = fixture();
    git(fx.roots[1].root, 'checkout', '-q', '--detach');
    const before = fx.roots.map((r) => [head(r.root), snapshot(r.root)]);
    const result = run(fx);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines.join('\n'), /beta: HEAD is detached/);
    assert.deepStrictEqual(fx.roots.map((r) => [head(r.root), snapshot(r.root)]), before);
  });

  test('planOnly writes nothing: it names a dirty file and writes nothing', () => {
    const fx = fixture();
    assert.deepStrictEqual(Object.keys(planOnly({ env: fx.env, presetsRoot: fx.presetsRoot })).sort(), ['ctx', 'planned', 'read']);
    writeAt(fx.roots[0].root, '.planning/config.json', JSON.stringify({ project: { slug: 'alpha', note: 'mine' }, stack: { preset: 'demo', capabilities: {}, locked_commands: ['x'] } }));
    const before = fx.roots.map((r) => [head(r.root), snapshot(r.root)]);
    const dirty = planOnly({ env: fx.env, presetsRoot: fx.presetsRoot });
    assert.match(dirty.refusal.join('\n'), /alpha: uncommitted changes/);
    assert.deepStrictEqual(fx.roots.map((r) => [head(r.root), snapshot(r.root)]), before);
  });

  test('the installer runs the plan-only pass before its first step', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'install-orchestrator.js'), 'utf8');
    assert.ok(source.indexOf('.planOnly(') > 0);
    assert.ok(source.indexOf('.planOnly(') < source.indexOf("require('./install-modules.js')"));
  });

  test('the commit carries a GSD-Upgrade trailer with the fork sha; settings files with comments are accepted', () => {
    const fx = fixture();
    const [a] = fx.roots;
    const settings = path.join(a.root, '.claude/settings.json');
    fs.writeFileSync(settings, `// kept by hand\n${fs.readFileSync(settings, 'utf8')}`);
    writeAt(a.root, '.claude/settings.local.json', '{\n  // mine\n  "env": { "A": "1" },\n}\n');
    git(a.root, 'add', '-A');
    git(a.root, 'commit', '-q', '-m', 'comments');
    const result = run(fx, { forkSha: 'abc1234' });
    assert.strictEqual(result.exitCode, 0, result.lines.join('\n'));
    assert.strictEqual(git(a.root, 'log', '-1', '--format=%(trailers:key=GSD-Upgrade,valueonly)'), 'abc1234');
    assert.match(git(a.root, 'log', '-1', '--format=%B'), /^chore\(gsd\): upgrade framework files\n\nGSD-Upgrade: abc1234/);
    assert.match(git(fx.roots[1].root, 'log', '-1', '--format=%B'), /GSD-Upgrade: abc1234/);
  });

  test('a blocking doctor result names the project-owned keys apart from framework findings', () => {
    const result = run(fixture(), { doctor: () => ({ exitCode: 1, text: 'MISSING stack.commands.x\n', blockingKeys: { project: ['stack.commands.x'], framework: ['.claude/rules/a.md'] } }) });
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.lines.join('\n'), /commit these in the project: stack\.commands\.x/);
    assert.match(result.lines.join('\n'), /framework findings \(not project-owned\): \.claude\/rules\/a\.md/);
  });
});

describe('project upgrade: rollback reverts the commits of the rolled-back record', () => {
  function upgradedWithRecord() {
    const fx = fixture();
    const homeDir = mkTmp('gsd-rbhome-');
    const target = path.join(homeDir, '.claude');
    writeAt(target, 'settings.json', '{}\n');
    const recordDir = openRecord({ targetDirs: [target], homeDir });
    writeAt(target, 'settings.json', '{"a":1}\n');
    closeRecord(recordDir, { owned: [path.join(target, 'settings.json')] });
    const env = { ...fx.env, GSD_FRAMEWORK_RECORD: path.basename(recordDir) };
    assert.strictEqual(run({ ...fx, env }).exitCode, 0);
    return { fx, homeDir, env, recordDir };
  }
  const rollback = ({ homeDir, env }, extra = {}) => rollbackAll({ homeDir, env, runNpm: () => true, ...extra });

  test('success: the framework is rolled back and each project commit is reverted', () => {
    const ctx = upgradedWithRecord();
    const heads = ctx.fx.roots.map((r) => head(r.root));
    const result = rollback(ctx);
    assert.strictEqual(result.status, 'rolled-back');
    assert.strictEqual(result.reverted.ok, true, result.reverted.lines.join('\n'));
    for (const [i, r] of ctx.fx.roots.entries()) {
      assert.match(git(r.root, 'log', '-1', '--format=%s'), /^Revert "chore\(gsd\): upgrade framework files"/);
      assert.strictEqual(git(r.root, 'rev-parse', 'HEAD~1'), heads[i]);
      assert.strictEqual(fs.readFileSync(path.join(r.root, '.claude/rules/style.md'), 'utf8'), '# Style v1\n');
    }
    assert.strictEqual(fs.readFileSync(path.join(ctx.homeDir, '.claude/settings.json'), 'utf8'), '{}\n');
  });

  test('a dirty tree refuses that project with the exact command; the other project is still reverted', () => {
    const ctx = upgradedWithRecord();
    const [a] = ctx.fx.roots;
    writeAt(a.root, '.claude/hooks/guard.js', 'edited\n');
    const headA = head(a.root);
    const result = rollback(ctx);
    assert.strictEqual(result.status, 'rolled-back');
    assert.strictEqual(result.reverted.ok, false);
    const text = result.reverted.lines.join('\n');
    assert.match(text, /not reverted alpha: the working tree has uncommitted changes; run: git -C ".*" revert [0-9a-f]{40}/);
    assert.match(text, /^reverted beta: [0-9a-f]{40}/m);
    assert.strictEqual(head(a.root), headA);
  });

  test('an unrelated record reverts nothing', () => {
    const ctx = upgradedWithRecord();
    const heads = ctx.fx.roots.map((r) => head(r.root));
    assert.deepStrictEqual(revertRecord({ dir: ctx.fx.home, recordId: 'someother' }), { ok: true, lines: [] });
    assert.deepStrictEqual(ctx.fx.roots.map((r) => head(r.root)), heads);
  });
});
