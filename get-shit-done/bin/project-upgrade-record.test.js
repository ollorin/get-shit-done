'use strict';

const { test, afterEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCli: runDeploy, MANIFEST } = require('./project-deploy.js');
const { upgradeAll } = require('./project-upgrade.js');
const { readRuns } = require('./project-upgrade-log.js');
const { migrationRecordFindings } = require('./profile-doctor-checks.js');

const tmpDirs = [];
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
before(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
});
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});
const writeAt = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const git = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

// One committed project on a one-file preset whose config needs the table-defaults migration (locked_commands, no lock_dir).
function fixture(extraStack = {}) {
  const home = mkTmp('gsd-rec-home-');
  const presetsRoot = mkTmp('gsd-rec-presets-');
  writeAt(presetsRoot, 'demo/rules/style.md', '# Style\n');
  writeAt(presetsRoot, 'demo/preset.json', JSON.stringify({ name: 'demo', version: '1', files: [{ src: 'rules/style.md', dest: '.claude/rules/style.md', kind: 'whole' }] }));
  const root = mkTmp('gsd-rec-proj-');
  git(root, 'init', '-q');
  writeAt(root, '.planning/config.json', JSON.stringify({ project: { slug: 'alpha' }, stack: { preset: 'demo', capabilities: {}, locked_commands: ['x'], ...extraStack } }, null, 2));
  const init = runDeploy(root, ['init', '--root', root], { presetsRoot });
  assert.strictEqual(init.exitCode, 0, JSON.stringify(init.result));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  writeAt(home, 'projects.json', JSON.stringify({ version: 1, projects: { alpha: { root, port_base: 55000 } } }));
  const env = { GSD_HOME: home, HOME: mkTmp('gsd-rec-user-') };
  return { home, root, presetsRoot, env };
}

const upgrade = (fx, forkSha) => upgradeAll({ env: fx.env, presetsRoot: fx.presetsRoot, forkSha });

test('the upgrade records the migrations it applied in manifest.migrations[] and the fork sha with the projects it ran over; a rerun at the same sha writes nothing', () => {
  const fx = fixture();
  const stack = () => JSON.parse(fs.readFileSync(path.join(fx.root, '.planning/config.json'), 'utf8')).stack;
  assert.deepStrictEqual(migrationRecordFindings(fx.root, stack()).map((f) => f.key), ['migration table-defaults']);
  writeAt(fx.presetsRoot, 'demo/rules/style.md', '# Style v2\n');
  const first = upgrade(fx, 'sha-one');
  assert.strictEqual(first.exitCode, 0, first.lines.join('\n'));
  const manifest = () => JSON.parse(fs.readFileSync(path.join(fx.root, MANIFEST), 'utf8'));
  assert.deepStrictEqual(manifest().migrations, ['table-defaults']);
  assert.deepStrictEqual(readRuns(fx.home).map((r) => [r.fork_sha, r.roots]), [['sha-one', [fx.root]]]);
  const bytes = fs.readFileSync(path.join(fx.root, MANIFEST));
  const head = git(fx.root, 'rev-parse', 'HEAD');
  assert.strictEqual(upgrade(fx, 'sha-one').exitCode, 0);
  assert.deepStrictEqual([git(fx.root, 'rev-parse', 'HEAD'), fs.readFileSync(path.join(fx.root, MANIFEST)).equals(bytes), readRuns(fx.home).length], [head, true, 1]);
  assert.strictEqual(upgrade(fx, 'sha-two').exitCode, 0);
  assert.deepStrictEqual(readRuns(fx.home).map((r) => r.fork_sha), ['sha-one', 'sha-two']);
  assert.deepStrictEqual(manifest().migrations, ['table-defaults']);
});

test('the upgrade marks a stack-free gate lacking needs_stack, records the migration, and the doctor reports it needed before and not after', () => {
  const fx = fixture({ gates: [{ id: 'style', run: 'node scripts/style-gate.mjs' }, { id: 'adr', run: 'x', needs_stack: true }] });
  const config = () => JSON.parse(fs.readFileSync(path.join(fx.root, '.planning/config.json'), 'utf8'));
  const needed = () => migrationRecordFindings(fx.root, config().stack).map((f) => f.key);
  assert.deepStrictEqual(needed(), ['migration table-defaults', 'migration gate-needs-stack']);
  const result = upgrade(fx, 'sha-one');
  assert.strictEqual(result.exitCode, 0, result.lines.join('\n'));
  assert.deepStrictEqual(config().stack.gates, [{ id: 'style', run: 'node scripts/style-gate.mjs', needs_stack: false }, { id: 'adr', run: 'x', needs_stack: true }]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fx.root, MANIFEST), 'utf8')).migrations, ['table-defaults', 'gate-needs-stack']);
  assert.deepStrictEqual(needed(), []);
  const head = git(fx.root, 'rev-parse', 'HEAD');
  assert.strictEqual(upgrade(fx, 'sha-one').exitCode, 0);
  assert.strictEqual(git(fx.root, 'rev-parse', 'HEAD'), head);
});
