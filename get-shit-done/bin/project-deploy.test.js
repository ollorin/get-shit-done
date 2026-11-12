'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { planDeploy, runCli, CONFIG, MANIFEST, BASE_DIR, SETTINGS } = require('./project-deploy.js');
const { applyPlan } = require('./project-deploy-apply.js');
const { agentAncestor, detectSession, guardFailures } = require('./project-deploy-session.js');
const { renderPreset } = require('./project-deploy-render.js');
const { sha256, planBlockFile } = require('./project-deploy-files.js');
const { mergeSettings, serializeSettings } = require('./project-deploy-settings.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const APPLY_IO = Object.freeze({ confirm: () => 'APPLY' });
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

describe('guardrail refusal (agnostic-B7)', () => {
  const CLAUDE_ENV = { CLAUDECODE: '1' };
  const ALL_FAIL = { stdin_tty: false, stdout_tty: false, agent_ancestor: true };
  const HOOK_DEST = '.claude/hooks/guard.js';

  function refusalFixture(state, change) {
    const dir = makePreset();
    const root = makeProject();
    if (state === 'seeded') seedDeployed(root, dir);
    if (state === 'empty-settings') writeAt(root, SETTINGS, '{}');
    if (change === 'H') writePreset(dir, { hook: `${HOOK}// changed\n` });
    if (change === 'R') writePreset(dir, { rule: RULE.replace('line five', 'line five changed') });
    if (change === 'X') {
      writeAt(dir, 'extra.js', '// extra\n');
      writePreset(dir, { files: [...DEFAULT_FILES, { src: 'extra.js', dest: '.claude/Hooks/extra.js', kind: 'whole' }] });
    }
    return { root, dir };
  }

  const ROWS = [
    { id: 'a', name: 'first-time init without settings is allowed', state: 'fresh', change: null, command: 'init', env: CLAUDE_ENV, session: ALL_FAIL, refused: false, ok: true },
    { id: 'b', name: 'init over an existing settings file is refused on env', state: 'empty-settings', change: null, command: 'init', env: CLAUDE_ENV, session: HUMAN, refused: true, paths: [HOOK_DEST, SETTINGS], failed: ['env'] },
    { id: 'c', name: 'sync of a changed hook is refused', state: 'seeded', change: 'H', command: 'sync', env: CLAUDE_ENV, session: HUMAN, refused: true, paths: [HOOK_DEST] },
    { id: 'd', name: 'sync of a rule only is never refused', state: 'seeded', change: 'R', command: 'sync', env: CLAUDE_ENV, session: ALL_FAIL, refused: false, ok: true, guarded: [] },
    { id: 'e', name: 'sync of a changed hook passes when every gate holds', state: 'seeded', change: 'H', command: 'sync', env: {}, session: HUMAN, refused: false, ok: true },
    { id: 'f', name: 'diff is never refused and lists the guarded change', state: 'seeded', change: 'H', command: 'diff', env: CLAUDE_ENV, session: ALL_FAIL, refused: false, ok: true, guarded: [HOOK_DEST] },
    { id: 'g', name: 'present-but-empty CLAUDECODE refuses', state: 'seeded', change: 'H', command: 'sync', env: { CLAUDECODE: '' }, session: HUMAN, refused: true, failed: ['env'] },
    { id: 'h', name: 'stdin not a TTY refuses', state: 'seeded', change: 'H', command: 'sync', env: {}, session: { ...HUMAN, stdin_tty: false }, refused: true, failed: ['stdin_tty'] },
    { id: 'i', name: 'stdout not a TTY refuses', state: 'seeded', change: 'H', command: 'sync', env: {}, session: { ...HUMAN, stdout_tty: false }, refused: true, failed: ['stdout_tty'] },
    { id: 'j', name: 'agent ancestor refuses', state: 'seeded', change: 'H', command: 'sync', env: {}, session: { ...HUMAN, agent_ancestor: true }, refused: true, failed: ['agent_ancestor'] },
    { id: 'm', name: 'a new mixed-case hook dest is guarded', state: 'seeded', change: 'X', command: 'sync', env: CLAUDE_ENV, session: HUMAN, refused: true, paths: ['.claude/Hooks/extra.js'] },
  ];

  for (const row of ROWS) {
    test(`P6${row.id} ${row.name}`, () => {
      const { root, dir } = refusalFixture(row.state, row.change);
      const before = snapshot(root);
      const { report } = planDeploy({ root, command: row.command, presetDir: dir, env: row.env, session: row.session });
      if (row.refused) {
        assert.notStrictEqual(report.refused, null);
        assert.strictEqual(report.ok, false);
        if (row.paths) assert.deepStrictEqual(report.refused.paths, row.paths);
        if (row.failed) assert.deepStrictEqual(report.refused.failed, row.failed);
      } else {
        assert.strictEqual(report.refused, null);
        assert.strictEqual(report.ok, row.ok);
        if (row.guarded) assert.deepStrictEqual(report.guarded_changes, row.guarded);
      }
      assert.deepStrictEqual(snapshot(root), before);
    });
  }

  test('P6k omitted env reads process.env (CLAUDECODE set inside the test, restored after)', () => {
    const { root, dir } = refusalFixture('seeded', 'H');
    const before = snapshot(root);
    const prior = process.env.CLAUDECODE;
    process.env.CLAUDECODE = '1';
    try {
      const { report } = planDeploy({ root, command: 'sync', presetDir: dir, session: HUMAN });
      assert.deepStrictEqual(report.refused.failed, ['env']);
    } finally {
      if (prior === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = prior;
    }
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('P6l omitted session detects the real process; the test runner (piped stdout) is refused', () => {
    const { root, dir } = refusalFixture('seeded', 'H');
    const before = snapshot(root);
    const { report } = planDeploy({ root, command: 'sync', presetDir: dir, env: {} });
    assert.notStrictEqual(report.refused, null);
    assert.ok(report.refused.failed.length > 0);
    assert.deepStrictEqual(snapshot(root), before);
  });

  const ZSH_TABLE = '  300   200 /bin/zsh\n  200     1 /bin/zsh\n    1     0 /sbin/launchd\n';
  const CLAUDE_TABLE = '  300   200 /bin/zsh\n  200     1 /usr/local/bin/claude\n    1     0 /sbin/launchd\n';
  const SPACED_TABLE = '  300   200 /bin/zsh\n  200     1 /Applications/Claude Helper.app/Contents/MacOS/Claude Helper\n';
  const CYCLE_TABLE = '  300   200 /bin/zsh\n  200   300 /bin/zsh\n';

  test('P12 agentAncestor walks the parent chain and fails closed', () => {
    assert.strictEqual(agentAncestor(CLAUDE_TABLE, 300), true);
    assert.strictEqual(agentAncestor(ZSH_TABLE, 300), false);
    assert.strictEqual(agentAncestor(SPACED_TABLE, 300), true);
    assert.strictEqual(agentAncestor('', 300), true);
    assert.strictEqual(agentAncestor(undefined, 300), true);
    assert.strictEqual(agentAncestor(ZSH_TABLE, 999), true);
    assert.strictEqual(agentAncestor(CYCLE_TABLE, 300), true);
  });


  test('P12 detectSession reads tty flags and the ps table; guardFailures orders the ids', () => {
    const session = detectSession({ stdin: { isTTY: true }, stdout: {}, pid: 300, psOutput: ZSH_TABLE });
    assert.deepStrictEqual(session, { stdin_tty: true, stdout_tty: false, agent_ancestor: false, orphan: false });
    assert.deepStrictEqual(guardFailures({}, HUMAN), []);
    assert.deepStrictEqual(
      guardFailures({ CLAUDECODE: '1' }, { stdin_tty: false, stdout_tty: false, agent_ancestor: true }),
      ['env', 'stdin_tty', 'stdout_tty', 'agent_ancestor'],
    );
  });
});

describe('malformed manifest stops planDeploy (B-FIX1 L6)', () => {
  test('a null hook entry in the manifest is refused before any write', () => {
    const dir = makePreset();
    const root = makeProject();
    writeAt(root, '.planning/gsd-project-manifest.json', JSON.stringify({ manifest_version: 1, preset: { name: 'demo', version: '1' }, files: {}, settings: { hooks: [null] } }));
    const before = snapshot(root);
    const { report, ops } = planDeploy({ root, command: 'sync', presetDir: dir, env: {}, session: HUMAN });
    assert.strictEqual(report.ok, false);
    assert.deepStrictEqual(report.errors, [{ reason: 'manifest is malformed' }]);
    assert.strictEqual(ops.manifest, null);
    assert.deepStrictEqual(snapshot(root), before);
  });
});

describe('project init|diff|sync (agnostic-B)', () => {
  const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
  const ENV_AGENT = { ...process.env, CLAUDECODE: '1' };
  const { CLAUDECODE: _drop, ...NO_KEY } = process.env;
  const STYLE_REL = '.claude/rules/style.md';
  const HOOK_DEST = '.claude/hooks/guard.js';
  const STYLE = RULE.replace('{{stack.paths.backend}}', 'srv');
  const CLAUDE_RENDERED = CLAUDE_MD.replace('{{stack.paths.backend}}', 'srv');
  const RULE_V2 = RULE.replace('line five', 'line five v2');
  const HOOK_V2 = '// guard v2\nprocess.exit(0);\n';
  const SETTINGS_RENDERED = {
    permissions: { allow: ['Bash(ls:*)', 'Read(srv/**)'], deny: ['Read(./private/**)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }] },
  };

  const run = (root, presetDir, cmd, env = {}, session = HUMAN) => runCli(root, [cmd, '--preset-dir', presetDir], env, session, APPLY_IO);
  const cli = (args, env) => spawnSync(process.execPath, [GSD_TOOLS, 'project', ...args], { encoding: 'utf8', env: { ...env, GSD_HOME: mkTmp('gsd-home-') } });
  const abs = (root, rel) => path.join(root, rel);
  const readSettings = (root) => JSON.parse(fs.readFileSync(abs(root, SETTINGS), 'utf8'));
  const initialised = () => {
    const root = makeProject();
    const dir = makePreset();
    assert.strictEqual(run(root, dir, 'init').exitCode, 0);
    return { root, dir };
  };

  test('A1 init writes rendered files, base copies, settings, manifest and .gitignore', () => {
    const root = makeProject();
    const dir = makePreset();
    const res = run(root, dir, 'init');
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(fs.readFileSync(abs(root, STYLE_REL), 'utf8'), STYLE);
    assert.strictEqual(fs.readFileSync(abs(root, HOOK_DEST), 'utf8'), HOOK);
    assert.strictEqual(fs.readFileSync(abs(root, 'CLAUDE.md'), 'utf8'), CLAUDE_RENDERED);
    assert.strictEqual(fs.statSync(abs(root, HOOK_DEST)).mode & 0o777, 0o755);
    assert.deepStrictEqual(readSettings(root), SETTINGS_RENDERED);
    assert.ok(fs.readFileSync(abs(root, `${BASE_DIR}/${STYLE_REL}`)).equals(Buffer.from(STYLE)));
    assert.ok(fs.readFileSync(abs(root, `${BASE_DIR}/${HOOK_DEST}`)).equals(Buffer.from(HOOK)));
    assert.ok(fs.readFileSync(abs(root, `${BASE_DIR}/CLAUDE.md`)).equals(Buffer.from(CLAUDE_RENDERED)));
    assert.deepStrictEqual(readManifest(root), {
      manifest_version: 1,
      preset: { name: 'demo', version: '1' },
      files: {
        [HOOK_DEST]: { kind: 'whole', sha256: sha256(Buffer.from(HOOK)) },
        [STYLE_REL]: { kind: 'whole', sha256: sha256(Buffer.from(STYLE)) },
        'CLAUDE.md': { kind: 'block', sha256: sha256(Buffer.from(CLAUDE_RENDERED)), blocks: { core: sha256(Buffer.from('Run tests in srv.')) } },
      },
      settings: {
        permissions: { allow: ['Bash(ls:*)', 'Read(srv/**)'], deny: ['Read(./private/**)'], ask: [] },
        hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: 'node .claude/hooks/guard.js' }],
      },
    });
    const lines = fs.readFileSync(abs(root, '.gitignore'), 'utf8').split('\n');
    for (const line of ['.claude/settings.local.json', '.mcp.json', '.env*', '!.env.example']) {
      assert.strictEqual(lines.filter((l) => l === line).length, 1);
    }
    assert.ok(lines.indexOf('.env*') < lines.indexOf('!.env.example'));
  });

  test('A1b init appends gitignore lines to an existing file without a trailing newline', () => {
    const root = makeProject();
    writeAt(root, '.gitignore', 'node_modules\n!.env.example\n.mcp.json');
    assert.strictEqual(run(root, makePreset(), 'init').exitCode, 0);
    const lines = fs.readFileSync(abs(root, '.gitignore'), 'utf8').split('\n');
    assert.deepStrictEqual(lines.slice(0, 3), ['node_modules', '!.env.example', '.mcp.json']);
    assert.strictEqual(lines.filter((l) => l === '.mcp.json').length, 1);
    assert.ok(lines.includes('.claude/settings.local.json'));
    assert.ok(lines.indexOf('.env*') > 0);
    assert.strictEqual(lines[lines.indexOf('.env*') + 1], '!.env.example');
  });

  test('A2 sync right after init writes nothing; diff reports zero changes', () => {
    const { root, dir } = initialised();
    const before = snapshot(root);
    const s = run(root, dir, 'sync');
    assert.strictEqual(s.exitCode, 0);
    assert.deepStrictEqual(s.result.written, []);
    assert.deepStrictEqual(snapshot(root), before);
    const d = run(root, dir, 'diff');
    assert.strictEqual(d.exitCode, 0);
    assert.strictEqual(d.result.changes, 0);
  });

  test('A3 an unchanged file is overwritten when the preset changes', () => {
    const { root, dir } = initialised();
    writePreset(dir, { rule: RULE_V2 });
    const newRendered = RULE_V2.replace('{{stack.paths.backend}}', 'srv');
    assert.strictEqual(run(root, dir, 'sync').exitCode, 0);
    assert.strictEqual(fs.readFileSync(abs(root, STYLE_REL), 'utf8'), newRendered);
    assert.ok(fs.readFileSync(abs(root, `${BASE_DIR}/${STYLE_REL}`)).equals(Buffer.from(newRendered)));
    assert.strictEqual(readManifest(root).files[STYLE_REL].sha256, sha256(Buffer.from(newRendered)));
  });

  test('A4 an edited file is merged: project and preset changes both survive', () => {
    const { root, dir } = initialised();
    writeAt(root, STYLE_REL, STYLE.replace('# Style', '# House style'));
    writePreset(dir, { rule: RULE_V2 });
    const newRendered = RULE_V2.replace('{{stack.paths.backend}}', 'srv');
    const r = run(root, dir, 'sync');
    assert.strictEqual(r.exitCode, 0);
    const text = fs.readFileSync(abs(root, STYLE_REL), 'utf8');
    assert.ok(text.includes('# House style'));
    assert.ok(text.includes('line five v2'));
    assert.ok(!text.includes('<<<<<<<'));
    assert.ok(fs.readFileSync(abs(root, `${BASE_DIR}/${STYLE_REL}`)).equals(Buffer.from(newRendered)));
    assert.strictEqual(readManifest(root).files[STYLE_REL].sha256, sha256(Buffer.from(newRendered)));
    assert.deepStrictEqual(run(root, dir, 'sync').result.written, []);
  });

  test('A5 a conflicting file is left untouched and exits 2; other files still apply', () => {
    const { root, dir } = initialised();
    writeAt(root, STYLE_REL, STYLE.replace('line four', 'line four project'));
    writePreset(dir, { rule: RULE.replace('line four', 'line four preset'), claude: CLAUDE_MD.replace('Run tests', 'Run all tests') });
    const beforeRule = fs.readFileSync(abs(root, STYLE_REL));
    const beforeBase = fs.readFileSync(abs(root, `${BASE_DIR}/${STYLE_REL}`));
    const beforeEntry = readManifest(root).files[STYLE_REL];
    const r = run(root, dir, 'sync');
    assert.strictEqual(r.exitCode, 2);
    assert.ok(r.result.files.some((f) => f.path === STYLE_REL && f.action === 'conflict'));
    assert.ok(fs.readFileSync(abs(root, STYLE_REL)).equals(beforeRule));
    assert.ok(fs.readFileSync(abs(root, `${BASE_DIR}/${STYLE_REL}`)).equals(beforeBase));
    assert.deepStrictEqual(readManifest(root).files[STYLE_REL], beforeEntry);
    assert.ok(fs.readFileSync(abs(root, 'CLAUDE.md'), 'utf8').includes('Run all tests in srv.'));
  });

  test('A6 a project-added allow rule and hook survive sync; removals are reported by value', () => {
    const { root, dir } = initialised();
    const settings = readSettings(root);
    settings.permissions.allow.push('Bash(project:*)');
    settings.hooks.PostToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo project' }] }];
    writeAt(root, SETTINGS, JSON.stringify(settings, null, 2));
    writePreset(dir, {
      fragment: {
        permissions: { allow: ['Bash(pwd:*)', 'Read({{stack.paths.backend}}/**)'], deny: ['Read(./private/**)'] },
        hooks: FRAGMENT.hooks,
      },
    });
    const r = run(root, dir, 'sync');
    assert.strictEqual(r.exitCode, 0);
    const after = readSettings(root);
    assert.ok(after.permissions.allow.includes('Bash(project:*)'));
    assert.ok(after.permissions.allow.includes('Bash(pwd:*)'));
    assert.ok(!after.permissions.allow.includes('Bash(ls:*)'));
    assert.ok(after.hooks.PostToolUse.some((g) => g.hooks.some((h) => h.command === 'echo project')));
    assert.ok(after.permissions.deny.includes('Read(./private/**)'));
    assert.deepStrictEqual(r.result.settings, {
      action: 'update',
      added: { permissions: { allow: ['Bash(pwd:*)'], deny: [], ask: [] }, hooks: [] },
      removed: { permissions: { allow: ['Bash(ls:*)'], deny: [], ask: [] }, hooks: [] },
    });

    const m = readManifest(root);
    m.settings.permissions.deny.push('Read(./mine/**)');
    writeAt(root, MANIFEST, JSON.stringify(m, null, 2) + '\n');
    const s2 = readSettings(root);
    s2.permissions.deny.push('Read(./mine/**)');
    writeAt(root, SETTINGS, JSON.stringify(s2, null, 2));
    const d = run(root, dir, 'diff');
    assert.deepStrictEqual(d.result.settings.removed.permissions.deny, ['Read(./mine/**)']);
  });

  test('A7 project text around the managed block survives; the block inner is replaced', () => {
    const { root, dir } = initialised();
    writeAt(root, 'CLAUDE.md', `Project intro\n${CLAUDE_RENDERED}Project footer\n`);
    writePreset(dir, { claude: CLAUDE_MD.replace('Run tests', 'Run all tests') });
    assert.strictEqual(run(root, dir, 'sync').exitCode, 0);
    const text = fs.readFileSync(abs(root, 'CLAUDE.md'), 'utf8');
    assert.ok(text.startsWith('Project intro\n'));
    assert.ok(text.endsWith('Project footer\n'));
    assert.ok(text.includes('Run all tests in srv.'));
  });

  const TOKEN = `ghp_${'a'.repeat(36)}`;
  const CAUSES = [
    { name: 'secret-shaped string in a preset file', prep: (root, dir) => writePreset(dir, { rule: `${RULE_V2}token ${TOKEN}\n` }) },
    {
      name: 'stack.paths.backend removed from config',
      prep: (root, dir) => {
        writePreset(dir, { rule: RULE_V2 });
        writeAt(root, CONFIG, JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities: {} } }));
      },
    },
    { name: 'guarded hook change under CLAUDECODE', prep: (root, dir) => writePreset(dir, { rule: RULE_V2, hook: HOOK_V2 }), env: { CLAUDECODE: '1' } },
    {
      name: 'guarded hook change without a TTY',
      prep: (root, dir) => writePreset(dir, { rule: RULE_V2, hook: HOOK_V2 }),
      session: { ...HUMAN, stdin_tty: false },
    },
    {
      name: 'settings file overwritten with invalid JSON',
      prep: (root, dir) => {
        writePreset(dir, { rule: RULE_V2 });
        writeAt(root, SETTINGS, '{');
      },
    },
    {
      name: '.claude/rules replaced by a symlink outside the root',
      prep: (root, dir, outside) => {
        writePreset(dir, { rule: RULE_V2 });
        fs.rmSync(abs(root, '.claude/rules'), { recursive: true, force: true });
        fs.symlinkSync(outside, abs(root, '.claude/rules'));
      },
    },
    {
      name: '.planning/.gsd-preset-base replaced by a symlink outside the root',
      prep: (root, dir, outside) => {
        writePreset(dir, { rule: RULE_V2 });
        fs.renameSync(abs(root, BASE_DIR), abs(root, '.planning/aside'));
        fs.symlinkSync(outside, abs(root, BASE_DIR));
      },
    },
  ];

  for (const cause of CAUSES) {
    test(`A8 abort writes nothing: ${cause.name}`, () => {
      const { root, dir } = initialised();
      const outside = mkTmp('gsd-outside-');
      writeAt(outside, 'keep.txt', 'x');
      const outsideBefore = snapshot(outside);
      cause.prep(root, dir, outside);
      const before = snapshot(root);
      const res = run(root, dir, 'sync', cause.env ?? {}, cause.session ?? HUMAN);
      assert.strictEqual(res.exitCode, 1);
      assert.deepStrictEqual(res.result.written, []);
      assert.deepStrictEqual(snapshot(root), before);
      assert.deepStrictEqual(snapshot(outside), outsideBefore);
    });
  }

  test('A9 CLI: a guarded sync is refused under CLAUDECODE and without a TTY; an agent --preset-dir init is refused', () => {
    const { root, dir } = initialised();
    writePreset(dir, { rule: RULE_V2, hook: HOOK_V2 });
    const before = snapshot(root);
    const withKey = cli(['sync', '--root', root, '--preset-dir', dir], ENV_AGENT);
    assert.strictEqual(withKey.status, 1);
    const body = JSON.parse(withKey.stdout);
    assert.ok(body.refused.paths.includes(HOOK_DEST));
    assert.ok(body.refused.failed.includes('env'));
    assert.deepStrictEqual(snapshot(root), before);

    const noKey = cli(['sync', '--root', root, '--preset-dir', dir], NO_KEY);
    assert.strictEqual(noKey.status, 1);
    assert.ok(JSON.parse(noKey.stdout).refused.failed.includes('stdout_tty'));
    assert.deepStrictEqual(snapshot(root), before);

    const fresh = makeProject();
    const init = cli(['init', '--root', fresh, '--preset-dir', makePreset()], ENV_AGENT);
    assert.strictEqual(init.status, 1);
    assert.strictEqual(JSON.parse(init.stdout).refused.reason, 'preset-dir requires a human terminal');
    assert.ok(!fs.existsSync(abs(fresh, HOOK_DEST)));

    assert.strictEqual(run(root, dir, 'sync', {}, HUMAN).exitCode, 0);
    assert.strictEqual(fs.readFileSync(abs(root, HOOK_DEST), 'utf8'), HOOK_V2);
  });

  test('A10 never-managed files are byte-identical after init and a changed-preset sync', () => {
    const root = makeProject();
    const dir = makePreset();
    const marked = ['.claude/settings.local.json', '.mcp.json', '.env'];
    writeAt(root, marked[0], '{"local":true}\n');
    writeAt(root, marked[1], '{"mcp":1}\n');
    writeAt(root, marked[2], 'MARK=1\n');
    const bytes = marked.map((p) => fs.readFileSync(abs(root, p)));
    assert.strictEqual(run(root, dir, 'init').exitCode, 0);
    writePreset(dir, { rule: RULE_V2 });
    assert.strictEqual(run(root, dir, 'sync').exitCode, 0);
    marked.forEach((p, i) => assert.ok(fs.readFileSync(abs(root, p)).equals(bytes[i])));
  });

  test('A11 CLI: missing or unknown subcommand exits 1; a fresh diff exits 2 and writes nothing', () => {
    const root = makeProject();
    const dir = makePreset();
    for (const args of [[], ['bogus']]) {
      const r = cli(args, ENV_AGENT);
      assert.strictEqual(r.status, 1);
      assert.ok(JSON.parse(r.stdout).errors[0].reason.startsWith('Usage: project'));
    }
    const before = snapshot(root);
    const d = cli(['diff', '--root', root, '--preset-dir', dir], ENV_AGENT);
    assert.strictEqual(d.status, 2);
    assert.ok(JSON.parse(d.stdout).changes > 0);
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('A12 an explicit env argument wins over process.env', () => {
    const { root, dir } = initialised();
    writePreset(dir, { hook: HOOK_V2 });
    const prior = process.env.CLAUDECODE;
    process.env.CLAUDECODE = '1';
    try {
      assert.strictEqual(runCli(root, ['sync', '--preset-dir', dir], {}, HUMAN, APPLY_IO).exitCode, 0);
    } finally {
      if (prior === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = prior;
    }
    assert.strictEqual(fs.readFileSync(abs(root, HOOK_DEST), 'utf8'), HOOK_V2);
  });

  test('A13 CLI: an unknown preset and an invalid preset name exit 1', () => {
    const root = makeProject();
    assert.strictEqual(cli(['diff', '--root', root, '--preset', 'demo'], ENV_AGENT).status, 1);
    const bad = cli(['diff', '--root', root, '--preset', '../x'], ENV_AGENT);
    assert.strictEqual(bad.status, 1);
    assert.strictEqual(JSON.parse(bad.stdout).errors[0].reason, 'invalid preset name');
  });

  test('A14 an I/O failure stops the apply at the failing path; the first write is rolled back; no manifest and no temp file', () => {
    const root = makeProject();
    writeAt(root, 'bad/child.txt', 'x');
    const plan = {
      ops: {
        files: [
          { dest: 'good.txt', content: Buffer.from('ok'), mode: 0o644 },
          { dest: 'bad', content: Buffer.from('y'), mode: 0o644 },
        ],
        bases: [],
        settingsText: null,
        manifest: { manifest_version: 1, preset: { name: 'demo', version: '1' }, files: {} },
      },
    };
    const r = applyPlan(root, plan, 'sync');
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.written, []);
    assert.strictEqual(r.rolled_back, true);
    assert.strictEqual(r.failed.path, 'bad');
    assert.strictEqual(fs.existsSync(abs(root, 'good.txt')), false);
    assert.strictEqual(fs.existsSync(abs(root, MANIFEST)), false);
    assert.deepStrictEqual(snapshot(root).filter(([p]) => p.includes('.gsd-tmp-')), []);
  });
});

describe('adopt of unmanaged files already equal to the render (B-FIX2 L9a)', () => {
  const STYLE = '.claude/rules/style.md';

  test('an unmanaged dest byte-equal to the rendered output is adopted: no conflict, no rewrite, manifest records it', () => {
    const dir = makePreset();
    const root = makeProject();
    const content = plan(root, 'init', dir).ops.files.find((f) => f.dest === STYLE).content;
    writeAt(root, STYLE, content);
    const res = plan(root, 'init', dir);
    assert.strictEqual(res.report.ok, true);
    assert.strictEqual(actionOf(res.report, STYLE), 'adopt');
    assert.strictEqual(res.report.conflicts, 0);
    assert.strictEqual(res.ops.files.some((f) => f.dest === STYLE), false);
    assert.strictEqual(applyPlan(root, res, 'init').ok, true);
    assert.strictEqual(readManifest(root).files[STYLE].sha256, sha256(content));
    assert.ok(fs.readFileSync(path.join(root, STYLE)).equals(content));
  });

  test('an unmanaged dest that differs from the render stays a conflict', () => {
    const dir = makePreset();
    const root = makeProject();
    writeAt(root, STYLE, 'mine\n');
    const res = plan(root, 'init', dir);
    assert.strictEqual(actionOf(res.report, STYLE), 'conflict');
    assert.strictEqual(res.report.conflicts, 1);
  });
});

describe('B-FIX3 F6 adopt counts as a change; a byte-equal file in another mode is an update', () => {
  const STYLE = '.claude/rules/style.md';
  const modeOf = (root, rel) => fs.statSync(path.join(root, rel)).mode & 0o777;

  test('F6-a an adopt is counted in changes and writes no content (diff exits 2)', () => {
    const dir = makePreset();
    const root = makeProject();
    seedDeployed(root, dir);
    const manifest = readManifest(root);
    delete manifest.files[STYLE];
    writeAt(root, MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    const res = plan(root, 'sync', dir);
    assert.strictEqual(res.report.ok, true);
    assert.strictEqual(actionOf(res.report, STYLE), 'adopt');
    assert.strictEqual(res.report.changes, 1);
    assert.strictEqual(res.ops.files.some((f) => f.dest === STYLE), false);
    assert.strictEqual(runCli(root, ['diff', '--preset-dir', dir], {}, HUMAN).exitCode, 2);
  });

  test('F6-b a byte-equal unmanaged file in another mode is an update, not an adopt; apply sets the rendered mode and keeps the bytes', () => {
    const dir = makePreset();
    const root = makeProject();
    const rendered = plan(root, 'init', dir).ops.files.find((f) => f.dest === STYLE);
    writeAt(root, STYLE, rendered.content, rendered.mode === 0o600 ? 0o640 : 0o600);
    const res = plan(root, 'init', dir);
    assert.strictEqual(actionOf(res.report, STYLE), 'update');
    assert.strictEqual(res.report.changes >= 1, true);
    assert.strictEqual(applyPlan(root, res, 'init').ok, true);
    assert.strictEqual(modeOf(root, STYLE), rendered.mode);
    assert.ok(fs.readFileSync(path.join(root, STYLE)).equals(rendered.content));
  });
});
