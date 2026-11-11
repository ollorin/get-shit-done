'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planDeploy, runCli, CONFIG, SETTINGS } = require('./project-deploy.js');
const { guardedSet, hookCommandsOf, triplesCommands } = require('./project-deploy-guard.js');
const { loadPreset } = require('./project-deploy-render.js');
const { sha256 } = require('./project-deploy-files.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const ALL_FAIL = Object.freeze({ stdin_tty: false, stdout_tty: false, agent_ancestor: true });
const AGENT_ENV = Object.freeze({ CLAUDECODE: '1' });
const HOOKS_DIR = ['.claude', 'hooks'].join('/');
const HOOK_DEST = `${HOOKS_DIR}/guard.js`;
const GATE_CMD = '$CLAUDE_PROJECT_DIR/scripts/gate.sh';
const BLOCK = '<!-- gsd:begin core -->\nmanaged line\n<!-- gsd:end core -->\n';

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

const project = (settings) => {
  const root = mkTmp('gsd-h2-proj-');
  writeAt(root, CONFIG, JSON.stringify({ project: { slug: 'demo' }, stack: { paths: {}, capabilities: {} } }));
  if (settings !== undefined) writeAt(root, SETTINGS, JSON.stringify(settings));
  return root;
};

function presetWith(files, fragment = null) {
  const dir = mkTmp('gsd-h2-preset-');
  for (const f of files) writeAt(dir, f.src, f.content);
  if (fragment) writeAt(dir, 'fragment.json', JSON.stringify(fragment));
  const entries = files.map(({ content, ...f }) => f);
  writeAt(dir, 'preset.json', JSON.stringify({
    name: 'demo', version: '1', files: entries, ...(fragment ? { settings_fragment: 'fragment.json' } : {}),
  }));
  return dir;
}

function snapshot(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push([r, sha256(fs.readFileSync(path.join(root, r)))]);
    }
  };
  walk('');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const canonDest = (file, canon, h1 = false) => ({ file, canon, h1 });
const none = { canonDests: [], hookCommands: [], presetFlags: new Set() };

describe('guardedSet (agnostic-B-FIX1 H2)', () => {
  test('H2-a a dest under .husky is guarded by its first segment', () => {
    const g = guardedSet({ ...none, canonDests: [canonDest('.husky/pre-commit', '.husky/pre-commit')] });
    assert.deepStrictEqual([...g], ['.husky/pre-commit']);
  });

  test('H2-b a dest under .githooks is guarded, first segment folded', () => {
    const g = guardedSet({ ...none, canonDests: [canonDest('.GitHooks/x', '.githooks/x')] });
    assert.deepStrictEqual([...g], ['.GitHooks/x']);
  });

  test('H2-c a script referenced by a hook command is guarded, case-folded match', () => {
    const g = guardedSet({
      canonDests: [canonDest('scripts/gate.sh', 'scripts/gate.sh'), canonDest('scripts/other.sh', 'scripts/other.sh')],
      hookCommands: [GATE_CMD.replace('scripts/gate.sh', 'SCRIPTS/Gate.sh')],
      presetFlags: new Set(),
    });
    assert.deepStrictEqual([...g], ['scripts/gate.sh']);
  });

  test('H2-d a preset entry with guarded:true is guarded', () => {
    const g = guardedSet({ ...none, canonDests: [canonDest('docs/a.md', 'docs/a.md')], presetFlags: new Set(['docs/a.md']) });
    assert.deepStrictEqual([...g], ['docs/a.md']);
  });

  test('H2-e an unreferenced dest outside the hook dirs is unguarded', () => {
    const g = guardedSet({
      canonDests: [canonDest('docs/a.md', 'docs/a.md'), canonDest(HOOK_DEST, `${HOOKS_DIR}/guard.js`, true)],
      hookCommands: ['node scripts/other.js'],
      presetFlags: new Set(),
    });
    assert.deepStrictEqual([...g], [HOOK_DEST]);
  });

  test('H2-f the H1 identity flag alone guards a dest', () => {
    const g = guardedSet({ ...none, canonDests: [canonDest('scripts/x.sh', 'scripts/x.sh', true)] });
    assert.deepStrictEqual([...g], ['scripts/x.sh']);
  });

  test('H2-g hookCommandsOf reads command strings from groups and ignores malformed entries', () => {
    const cmds = hookCommandsOf({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: GATE_CMD }, null, { command: 1 }] }, 'x'],
        Stop: 'not-an-array',
      },
    });
    assert.deepStrictEqual(cmds, [GATE_CMD]);
    assert.deepStrictEqual(hookCommandsOf(null), []);
    assert.deepStrictEqual(triplesCommands([{ event: 'E', command: 'c' }, 3, { command: 2 }]), ['c']);
  });
});

describe('H2 through planDeploy and runCli', () => {
  test('H2-h a script named by a project-added settings hook is guarded (current settings are scanned)', () => {
    const root = project({ hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/gate.sh' }] }] } });
    const dir = presetWith([{ src: 'gate.sh', dest: 'scripts/gate.sh', kind: 'whole', content: 'x\n' }],
      { permissions: { allow: ['Bash(ls:*)'] } });
    const { report } = planDeploy({ root, command: 'init', presetDir: dir, env: AGENT_ENV, session: ALL_FAIL });
    assert.deepStrictEqual(report.guarded_changes, [SETTINGS, 'scripts/gate.sh']);
    assert.strictEqual(report.refused.reason, 'guardrail paths change only from a terminal outside an agent session');
  });

  test('H2-i an agent init that updates an existing .husky file is refused and writes nothing', () => {
    const root = project();
    writeAt(root, '.husky/pre-commit', 'echo hi\n');
    const dir = presetWith([{ src: 'hook.sh', dest: '.husky/pre-commit', kind: 'block', content: BLOCK }]);
    const before = snapshot(root);
    const res = runCli(root, ['init', '--preset-dir', dir], AGENT_ENV, ALL_FAIL);
    assert.strictEqual(res.exitCode, 1);
    assert.deepStrictEqual(res.result.refused.paths, ['.husky/pre-commit']);
    assert.deepStrictEqual(res.result.written, []);
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('H2-p an agent init that would update an existing .husky file is refused by the exemption check alone', () => {
    const root = project();
    writeAt(root, '.husky/pre-commit', 'echo hi\n');
    const dir = presetWith([{ src: 'hook.sh', dest: '.husky/pre-commit', kind: 'block', content: BLOCK }]);
    const { report } = planDeploy({ root, command: 'init', presetDir: dir, env: AGENT_ENV, session: ALL_FAIL });
    assert.deepStrictEqual(report.guarded_changes, ['.husky/pre-commit']);
    assert.strictEqual(report.files[0].action, 'update');
    assert.strictEqual(report.refused.reason, 'guardrail paths change only from a terminal outside an agent session');
  });

  test('H2-j an agent init with --preset-dir is refused when hooks would be written', () => {
    const root = project();
    const dir = presetWith([{ src: 'guard.js', dest: HOOK_DEST, kind: 'whole', content: 'x\n' }]);
    const before = snapshot(root);
    const res = runCli(root, ['init', '--preset-dir', dir], AGENT_ENV, ALL_FAIL);
    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.result.refused.reason, 'preset-dir requires a human terminal');
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('H2-k a human init with --preset-dir writes the guarded hook', () => {
    const root = project();
    const dir = presetWith([{ src: 'guard.js', dest: HOOK_DEST, kind: 'whole', content: 'x\n' }]);
    const res = runCli(root, ['init', '--preset-dir', dir], {}, HUMAN);
    assert.strictEqual(res.exitCode, 0);
    assert.ok(fs.existsSync(path.join(root, HOOK_DEST)));
  });

  test('H2-l diff is never refused, with or without --preset-dir', () => {
    const root = project();
    const dir = presetWith([{ src: 'guard.js', dest: HOOK_DEST, kind: 'whole', content: 'x\n' }]);
    const res = runCli(root, ['diff', '--preset-dir', dir], AGENT_ENV, ALL_FAIL);
    assert.strictEqual(res.result.refused, null);
    assert.strictEqual(res.exitCode, 2);
  });

  test('H2-m an agent init whose guarded files are all created is still exempt without --preset-dir', () => {
    const root = project();
    const dir = presetWith([{ src: 'guard.js', dest: HOOK_DEST, kind: 'whole', content: 'x\n' }]);
    const { report } = planDeploy({ root, command: 'init', presetDir: dir, env: AGENT_ENV, session: ALL_FAIL });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.refused, null);
  });

  test('H2-n a non-boolean guarded key is a preset error', () => {
    const dir = presetWith([{ src: 'a.md', dest: 'docs/a.md', kind: 'whole', content: 'x' }]);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'preset.json'), 'utf8'));
    doc.files[0].guarded = 'yes';
    writeAt(dir, 'preset.json', JSON.stringify(doc));
    const r = loadPreset(dir);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.errors, ['guarded must be a boolean: a.md']);
  });

  test('H2-o a guarded:true preset file that is not in a hook dir is refused for an agent sync', () => {
    const root = project({});
    const dir = presetWith([{ src: 'a.md', dest: 'docs/a.md', kind: 'whole', content: 'x\n', guarded: true }]);
    const { report } = planDeploy({ root, command: 'init', presetDir: dir, env: AGENT_ENV, session: ALL_FAIL });
    assert.deepStrictEqual(report.guarded_changes, ['docs/a.md']);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.refused.reason, 'guardrail paths change only from a terminal outside an agent session');
  });
});
