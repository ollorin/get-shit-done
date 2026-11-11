'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyPlan } = require('./project-deploy-apply.js');
const { planDeploy, CONFIG, MANIFEST } = require('./project-deploy.js');
const { sha256 } = require('./project-deploy-files.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const DEFAULT_CONFIG = { project: { slug: 'demo' }, stack: { paths: { backend: 'srv' }, capabilities: {} } };
const RULE = '# Style\n\nBackend lives in {{stack.paths.backend}}.\n';
const HOOK = '// guard\nprocess.exit(0);\n';
const CLAUDE_MD = '# Project\n\n<!-- gsd:begin core -->\nRun tests in {{stack.paths.backend}}.\n<!-- gsd:end core -->\n';
const FRAGMENT = {
  permissions: { allow: ['Bash(ls:*)'], deny: ['Read(./private/**)'] },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }] },
};
const FILES = [
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

// Files and links with content hash and mode; directories are walked, not listed (empty dirs are checked separately).
function snapshot(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(root, r);
      if (e.isSymbolicLink()) out.push([r, `link:${fs.readlinkSync(abs)}`]);
      else if (e.isDirectory()) walk(r);
      else out.push([r, sha256(fs.readFileSync(abs)), (fs.statSync(abs).mode & 0o777).toString(8)]);
    }
  };
  walk('');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const failAt = (n) => {
  let calls = 0;
  return (from, to) => {
    calls += 1;
    if (calls === n) throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
    fs.renameSync(from, to);
  };
};

// Five writes in order: a, b, deep/c, settings, manifest.
const plan5 = () => ({
  ops: {
    files: [
      { dest: 'a.txt', content: Buffer.from('NEW-A'), mode: 0o644 },
      { dest: 'b.txt', content: Buffer.from('NEW-B'), mode: 0o644 },
      { dest: 'deep/c.txt', content: Buffer.from('NEW-C'), mode: 0o644 },
    ],
    bases: [],
    settingsText: '{"x":1}\n',
    manifest: { manifest_version: 1, preset: { name: 'demo', version: '1' }, files: {} },
  },
});

function makePreset() {
  const dir = mkTmp('gsd-preset-');
  writeAt(dir, 'rules/style.md', RULE);
  writeAt(dir, 'hooks/guard.js', HOOK, 0o755);
  writeAt(dir, 'CLAUDE.md', CLAUDE_MD);
  writeAt(dir, 'settings.fragment.json', JSON.stringify(FRAGMENT));
  writeAt(dir, 'preset.json', JSON.stringify({ name: 'demo', version: '1', files: FILES, settings_fragment: 'settings.fragment.json' }));
  return dir;
}

function makeProject() {
  const root = mkTmp('gsd-proj-');
  writeAt(root, CONFIG, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return root;
}

describe('applyPlan is transactional (B-FIX1 L7)', () => {
  test('a rename failure at step 3 of 5 rolls back: tree byte-identical, original mode kept, created dirs removed', () => {
    const root = mkTmp('gsd-apply-');
    writeAt(root, 'a.txt', 'OLD-A', 0o600);
    const before = snapshot(root);
    const r = applyPlan(root, plan5(), 'sync', { rename: failAt(3) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.failed.path, 'deep/c.txt');
    assert.strictEqual(r.rolled_back, true);
    assert.deepStrictEqual(r.written, []);
    assert.deepStrictEqual(snapshot(root), before);
    assert.strictEqual(fs.statSync(path.join(root, 'a.txt')).mode & 0o777, 0o600);
    assert.strictEqual(fs.existsSync(path.join(root, 'deep')), false);
  });

  test('the manifest is renamed last on success, after every file and the settings', () => {
    const root = mkTmp('gsd-apply-');
    const order = [];
    const rename = (from, to) => {
      order.push(path.relative(root, to));
      fs.renameSync(from, to);
    };
    const r = applyPlan(root, plan5(), 'sync', { rename });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(order, ['a.txt', 'b.txt', 'deep/c.txt', '.claude/settings.json', MANIFEST]);
    assert.strictEqual(order[order.length - 1], MANIFEST);
  });

  test('after a rolled-back init, re-planning and re-running init succeeds', () => {
    const root = makeProject();
    const presetDir = makePreset();
    const first = planDeploy({ root, command: 'init', presetDir, env: {}, session: HUMAN });
    assert.strictEqual(first.report.ok, true);
    const before = snapshot(root);
    const r = applyPlan(root, first, 'init', { rename: failAt(3) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.rolled_back, true);
    assert.deepStrictEqual(snapshot(root), before);
    assert.strictEqual(fs.existsSync(path.join(root, MANIFEST)), false);
    const second = planDeploy({ root, command: 'init', presetDir, env: {}, session: HUMAN });
    assert.strictEqual(second.report.ok, true);
    const rerun = applyPlan(root, second, 'init');
    assert.strictEqual(rerun.ok, true);
    assert.strictEqual(fs.existsSync(path.join(root, MANIFEST)), true);
  });

  test('a temp name that already exists is never reused: the planted file survives and nothing changes', () => {
    const root = mkTmp('gsd-apply-');
    writeAt(root, 'a.txt.gsd-tmp-FIXED', 'SENTINEL');
    const before = snapshot(root);
    const r = applyPlan(root, plan5(), 'sync', { random: () => 'FIXED' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.rolled_back, true);
    assert.deepStrictEqual(r.written, []);
    assert.deepStrictEqual(snapshot(root), before);
  });

  test('a symlink planted at the old predictable temp name is not followed', () => {
    const root = mkTmp('gsd-apply-');
    const outside = mkTmp('gsd-outside-');
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'VICTIM');
    fs.symlinkSync(victim, path.join(root, `a.txt.gsd-tmp-${process.pid}`));
    const r = applyPlan(root, plan5(), 'sync');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'VICTIM');
    assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'NEW-A');
  });
});

describe('applyPlan re-checks containment before each rename (B-FIX2 L5a)', () => {
  test('a dest dir swapped for a symlink between stage and rename is refused: rolled back, outside untouched', () => {
    const root = mkTmp('gsd-apply-');
    const outside = mkTmp('gsd-outside-');
    writeAt(root, 'a.txt', 'OLD-A');
    writeAt(root, 'deep/keep.txt', 'KEEP');
    const rename = (from, to) => {
      fs.renameSync(from, to);
      if (to === path.join(root, 'a.txt')) {
        fs.renameSync(path.join(root, 'deep'), path.join(root, 'deep.moved'));
        fs.symlinkSync(outside, path.join(root, 'deep'));
      }
    };
    const r = applyPlan(root, plan5(), 'sync', { rename });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.failed.path, 'deep/c.txt');
    assert.strictEqual(r.failed.reason, 'dest traverses a symlink');
    assert.strictEqual(r.rolled_back, true);
    assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'OLD-A');
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  });
});

describe('applyPlan reports paths it could not restore (B-FIX2 L5b)', () => {
  test('a restore that itself fails: ok false, rolled_back false, written lists exactly the unrestored path', () => {
    const root = mkTmp('gsd-apply-');
    writeAt(root, 'a.txt', 'OLD-A');
    const aPath = path.join(root, 'a.txt');
    let calls = 0;
    const rename = (from, to) => {
      calls += 1;
      if (calls > 1) throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
      fs.renameSync(from, to);
      fs.unlinkSync(aPath);
      fs.mkdirSync(aPath);
      fs.writeFileSync(path.join(aPath, 'inside.txt'), 'KEEP');
    };
    const r = applyPlan(root, plan5(), 'sync', { rename });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.rolled_back, false);
    assert.deepStrictEqual(r.written, ['a.txt']);
    assert.strictEqual(r.failed.path, 'b.txt');
    assert.strictEqual(fs.statSync(aPath).isDirectory(), true);
    assert.strictEqual(fs.readFileSync(path.join(aPath, 'inside.txt'), 'utf8'), 'KEEP');
  });
});

describe('applyPlan sweeps crash leftovers in its dest directories (B-FIX2 L9b)', () => {
  test('a stale 16-hex temp in a dest dir is removed; a non-matching name and an unrelated dir are untouched', () => {
    const root = mkTmp('gsd-apply-');
    writeAt(root, 'a.txt', 'OLD-A');
    writeAt(root, `a.txt.gsd-tmp-${'0123456789abcdef'}`, 'STALE');
    writeAt(root, 'notes.gsd-tmp-XYZ', 'KEEP-NAME');
    writeAt(root, `other/x.gsd-tmp-${'fedcba9876543210'}`, 'KEEP-DIR');
    const r = applyPlan(root, plan5(), 'sync');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fs.existsSync(path.join(root, `a.txt.gsd-tmp-${'0123456789abcdef'}`)), false);
    assert.strictEqual(fs.readFileSync(path.join(root, 'notes.gsd-tmp-XYZ'), 'utf8'), 'KEEP-NAME');
    assert.strictEqual(fs.readFileSync(path.join(root, `other/x.gsd-tmp-${'fedcba9876543210'}`), 'utf8'), 'KEEP-DIR');
  });
});
