'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planDeploy, CONFIG, MANIFEST, BASE_DIR, SETTINGS } = require('./project-deploy.js');
const { renderPreset } = require('./project-deploy-render.js');
const { sha256, planBlockFile } = require('./project-deploy-files.js');
const { mergeSettings, serializeSettings } = require('./project-deploy-settings.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const DEFAULT_CONFIG = { project: { slug: 'demo' }, stack: { paths: { backend: 'srv' }, capabilities: {} } };
const RULE = '# Style\n\nBackend lives in {{stack.paths.backend}}.\nline three\nline four\nline five\n';
const HOOK = '// guard\nprocess.exit(0);\n';
const CLAUDE_MD = '# Project\n\n<!-- gsd:begin core -->\nRun tests in {{stack.paths.backend}}.\n<!-- gsd:end core -->\n';
const FRAGMENT = {
  permissions: { allow: ['Bash(ls:*)', 'Read({{stack.paths.backend}}/**)'], deny: ['Read(./private/**)'] },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }] },
};
const DEFAULT_FILES = [
  { src: 'rules/style.md', dest: '.claude/rules/style.md', kind: 'whole' },
  { src: 'hooks/guard.js', dest: '.claude/hooks/guard.js', kind: 'whole' },
  { src: 'CLAUDE.md', dest: 'CLAUDE.md', kind: 'block' },
];

const tmpDirs = [];
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

const writeAt = (root, rel, content, mode) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
  if (mode !== undefined) fs.chmodSync(path.join(root, rel), mode);
};

function makeProject(config = DEFAULT_CONFIG) {
  const root = mkTmp('gsd-proj-');
  writeAt(root, CONFIG, typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  return root;
}

function writePreset(dir, {
  name = 'demo', rule = RULE, hook = HOOK, claude = CLAUDE_MD, fragment = FRAGMENT, files = DEFAULT_FILES,
} = {}) {
  writeAt(dir, 'rules/style.md', rule);
  writeAt(dir, 'hooks/guard.js', hook, 0o755);
  writeAt(dir, 'CLAUDE.md', claude);
  writeAt(dir, 'settings.fragment.json', JSON.stringify(fragment));
  writeAt(dir, 'preset.json', JSON.stringify({ name, version: '1', files, settings_fragment: 'settings.fragment.json' }));
  return dir;
}

const makePreset = (overrides) => writePreset(mkTmp('gsd-preset-'), overrides);

function snapshot(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) out.push([r, `link:${fs.readlinkSync(path.join(root, r))}`]);
      else if (e.isDirectory()) walk(r);
      else out.push([r, sha256(fs.readFileSync(path.join(root, r)))]);
    }
  };
  walk('');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const plan = (root, command, presetDir, extra = {}) => planDeploy({
  root, command, presetDir, env: {}, session: HUMAN, ...extra,
});

function seedDeployed(root, presetDir) {
  const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG), 'utf8'));
  const rendered = renderPreset(presetDir, config);
  const files = {};
  for (const f of rendered.files) {
    writeAt(root, f.dest, f.content, f.mode);
    writeAt(root, `${BASE_DIR}/${f.dest}`, f.content);
    const entry = { kind: f.kind, sha256: sha256(f.content) };
    if (f.kind === 'block') entry.blocks = planBlockFile({ current: null, next: f.content.toString('utf8'), prevBlocks: null }).blocks;
    files[f.dest] = entry;
  }
  const merged = mergeSettings(null, null, rendered.settings);
  writeAt(root, SETTINGS, serializeSettings(merged.settings));
  const sortedFiles = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  const manifest = {
    manifest_version: 1,
    preset: { name: rendered.name, version: rendered.version },
    files: sortedFiles,
    settings: merged.deployed,
  };
  writeAt(root, MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

const readManifest = (root) => JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
const actionOf = (report, p) => report.files.find((f) => f.path === p).action;

describe('planDeploy (agnostic-B)', () => {
  test('P1 fresh init plans three creates and the settings create, writes nothing', () => {
    const root = makeProject();
    const dir = makePreset();
    const before = snapshot(root);
    const { report } = plan(root, 'init', dir);
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.refused, null);
    assert.strictEqual(report.changes, 4);
    assert.strictEqual(report.conflicts, 0);
    assert.deepStrictEqual(report.guarded_changes, ['.claude/hooks/guard.js', '.claude/settings.json']);
    assert.deepStrictEqual(report.files.map((f) => f.action), ['create', 'create', 'create']);
    assert.strictEqual(report.settings.action, 'create');
    assert.deepStrictEqual(report.settings.added.permissions.allow, ['Bash(ls:*)', 'Read(srv/**)']);
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('P2 config, preset selection and name errors; positive name via presetsRoot and stack.preset', () => {
    const preset = makePreset();
    const noConfig = mkTmp('gsd-empty-');
    assert.deepStrictEqual(plan(noConfig, 'diff', preset).report.errors, [{ reason: 'missing .planning/config.json' }]);

    const badJson = makeProject('{');
    const badRes = plan(badJson, 'diff', preset);
    assert.strictEqual(badRes.report.ok, false);
    assert.strictEqual(badRes.report.errors[0].reason, '.planning/config.json is not valid JSON');

    const root = makeProject();
    const noPreset = planDeploy({ root, command: 'init', env: {}, session: HUMAN });
    assert.strictEqual(noPreset.report.ok, false);
    assert.deepStrictEqual(noPreset.report.errors, [{ reason: 'no preset: pass --preset or set stack.preset' }]);

    assert.deepStrictEqual(
      planDeploy({ root, command: 'diff', presetName: '../x', env: {}, session: HUMAN }).report.errors,
      [{ reason: 'invalid preset name' }],
    );
    const presetsRoot = mkTmp('gsd-presets-');
    fs.mkdirSync(path.join(presetsRoot, 'other'));
    assert.strictEqual(planDeploy({ root, command: 'diff', presetName: 'nope', presetsRoot, env: {}, session: HUMAN }).report.ok, false);

    const named = mkTmp('gsd-presets-');
    writePreset(path.join(named, 'demo'));
    assert.strictEqual(planDeploy({ root, command: 'init', presetName: 'demo', presetsRoot: named, env: {}, session: HUMAN }).report.ok, true);

    const viaConfig = makeProject({ ...DEFAULT_CONFIG, stack: { ...DEFAULT_CONFIG.stack, preset: 'demo' } });
    assert.strictEqual(planDeploy({ root: viaConfig, command: 'init', presetsRoot: named, env: {}, session: HUMAN }).report.ok, true);
  });

  test('P3 init and sync require the right manifest state; manifest preset name must match', () => {
    const dir = makePreset();
    const seeded = makeProject();
    seedDeployed(seeded, dir);
    const before = snapshot(seeded);
    assert.deepStrictEqual(plan(seeded, 'init', dir).report.errors, [{ reason: 'already initialised: run project sync' }]);
    assert.deepStrictEqual(snapshot(seeded), before);

    const fresh = makeProject();
    const freshBefore = snapshot(fresh);
    assert.deepStrictEqual(plan(fresh, 'sync', dir).report.errors, [{ reason: 'not initialised: run project init' }]);
    assert.strictEqual(plan(fresh, 'diff', dir).report.ok, true);
    assert.strictEqual(plan(seeded, 'diff', dir).report.ok, true);
    assert.deepStrictEqual(snapshot(fresh), freshBefore);

    const other = makePreset({ name: 'other' });
    for (const command of ['sync', 'diff']) {
      const res = plan(seeded, command, other);
      assert.strictEqual(res.report.ok, false);
      assert.deepStrictEqual(res.report.errors, [{ reason: 'manifest preset is demo, not other' }]);
    }
    assert.deepStrictEqual(snapshot(seeded), before);
  });

  test('P4 a missing config key is reported with the key path', () => {
    const root = makeProject({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const res = plan(root, 'init', makePreset());
    assert.strictEqual(res.report.ok, false);
    assert.ok(res.report.errors.some((e) => e.reason === 'missing config key: stack.paths.backend'));
  });

  test('P5 secret scan: a token in preset text, and a token in a config value, block the plan', () => {
    const TOKEN = `ghp_${'a'.repeat(36)}`;
    const dirA = makePreset({ rule: `${RULE}token ${TOKEN}\n` });
    const rootA = makeProject();
    const beforeA = snapshot(rootA);
    const resA = plan(rootA, 'init', dirA);
    assert.strictEqual(resA.report.ok, false);
    assert.deepStrictEqual(resA.report.secret_hits, [
      { file: '.claude/rules/style.md', pattern: 'vcs_token', line: RULE.split('\n').length },
    ]);
    assert.strictEqual(JSON.stringify(resA.report).includes(TOKEN), false);
    assert.deepStrictEqual(snapshot(rootA), beforeA);

    const rootB = makeProject({ ...DEFAULT_CONFIG, stack: { ...DEFAULT_CONFIG.stack, paths: { backend: TOKEN } } });
    const resB = plan(rootB, 'init', makePreset());
    assert.strictEqual(resB.report.ok, false);
    const files = resB.report.secret_hits.map((h) => h.file);
    assert.deepStrictEqual([...new Set(files)].sort(), ['.claude/rules/style.md', 'CLAUDE.md', 'settings fragment']);
    assert.strictEqual(JSON.stringify([resB.report.secret_hits, resB.report.errors]).includes(TOKEN), false);
  });

  test('P7 containment: symlinked rules dir, base dir and manifest leaving the root write nothing outside', () => {
    const dir = makePreset();

    const rootA = makeProject();
    const outA = mkTmp('gsd-outside-');
    fs.mkdirSync(path.join(rootA, '.claude'));
    fs.symlinkSync(outA, path.join(rootA, '.claude/rules'));
    const resA = plan(rootA, 'init', dir);
    assert.strictEqual(resA.report.ok, false);
    assert.deepStrictEqual(resA.report.errors, [{ file: '.claude/rules/style.md', reason: 'destination escapes project root' }]);
    assert.deepStrictEqual(fs.readdirSync(outA), []);

    const rootB = makeProject();
    const outB = mkTmp('gsd-outside-');
    fs.symlinkSync(outB, path.join(rootB, BASE_DIR));
    const resB = plan(rootB, 'init', dir);
    assert.strictEqual(resB.report.ok, false);
    assert.ok(resB.report.errors.length > 0);
    for (const e of resB.report.errors) {
      assert.ok(e.file.startsWith(`${BASE_DIR}/`));
      assert.strictEqual(e.reason, 'destination escapes project root');
    }
    assert.deepStrictEqual(fs.readdirSync(outB), []);

    const rootC = makeProject();
    const outC = mkTmp('gsd-outside-');
    writeAt(outC, 'manifest.json', '{}');
    const beforeC = snapshot(outC);
    fs.symlinkSync(path.join(outC, 'manifest.json'), path.join(rootC, MANIFEST));
    const resC = plan(rootC, 'diff', dir);
    assert.deepStrictEqual(resC.report.errors, [{ file: MANIFEST, reason: 'destination escapes project root' }]);
    assert.deepStrictEqual(snapshot(outC), beforeC);
  });

  test('P8 a preset file dropped from the preset is reported as orphan and its manifest entry kept', () => {
    const dir = makePreset();
    const root = makeProject();
    const manifest = seedDeployed(root, dir);
    writePreset(dir, { files: DEFAULT_FILES.filter((f) => f.dest !== '.claude/rules/style.md') });
    const before = snapshot(root);
    const { report, ops } = plan(root, 'sync', dir);
    assert.strictEqual(report.ok, true);
    assert.deepStrictEqual(report.files.find((f) => f.path === '.claude/rules/style.md'), {
      path: '.claude/rules/style.md', kind: 'whole', action: 'orphan',
    });
    assert.deepStrictEqual(ops.manifest.files['.claude/rules/style.md'], manifest.files['.claude/rules/style.md']);
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('P9 an unparseable settings file is reported and nothing is planned for it', () => {
    const root = makeProject();
    writeAt(root, SETTINGS, '{');
    const before = snapshot(root);
    const res = plan(root, 'init', makePreset());
    assert.strictEqual(res.report.ok, false);
    assert.ok(res.report.errors.some((e) => e.file === SETTINGS && e.reason === 'not valid JSON'));
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('P10 unchanged preset: every action unchanged, zero changes, manifest reproduced byte-for-byte', () => {
    const dir = makePreset();
    const root = makeProject();
    const manifest = seedDeployed(root, dir);
    const before = snapshot(root);
    const { report, ops } = plan(root, 'sync', dir);
    assert.strictEqual(report.ok, true);
    assert.deepStrictEqual(report.files.map((f) => f.action), ['unchanged', 'unchanged', 'unchanged']);
    assert.strictEqual(report.settings.action, 'unchanged');
    assert.strictEqual(report.changes, 0);
    assert.deepStrictEqual(ops.manifest, manifest);
    assert.deepStrictEqual(readManifest(root), manifest);
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('P11 three-way states for a whole file: overwrite, merge, conflict (manifest entry kept)', () => {
    const dir = makePreset();
    const root = makeProject();
    const manifest = seedDeployed(root, dir);
    const rulePath = '.claude/rules/style.md';
    const renderedRule = RULE.replace('{{stack.paths.backend}}', 'srv');

    writePreset(dir, { rule: RULE.replace('line five', 'line five preset') });
    const before1 = snapshot(root);
    const r1 = plan(root, 'sync', dir);
    assert.strictEqual(actionOf(r1.report, rulePath), 'overwrite');
    assert.deepStrictEqual(snapshot(root), before1);

    writeAt(root, rulePath, renderedRule.replace('# Style', '# House style'));
    const r2 = plan(root, 'sync', dir);
    assert.strictEqual(actionOf(r2.report, rulePath), 'merge');
    assert.strictEqual(r2.report.conflicts, 0);

    writeAt(root, rulePath, renderedRule.replace('line four', 'line four project'));
    writePreset(dir, { rule: RULE.replace('line four', 'line four preset') });
    const before3 = snapshot(root);
    const r3 = plan(root, 'sync', dir);
    assert.strictEqual(actionOf(r3.report, rulePath), 'conflict');
    assert.strictEqual(r3.report.conflicts, 1);
    assert.strictEqual(r3.ops.files.some((f) => f.dest === rulePath), false);
    assert.deepStrictEqual(r3.ops.manifest.files[rulePath], manifest.files[rulePath]);
    assert.deepStrictEqual(snapshot(root), before3);
  });
});
