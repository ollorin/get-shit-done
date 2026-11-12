/**
 * project-pack.test.js — agnostic-M-02 2.4 (E3)
 *
 * `gsd-tools pack install`: copies a pack's files into a project root, skipping files that exist.
 * Moved here from project-registry.test.js (R2 D3); the assertions are unchanged.
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
const tmpDirs = [];

const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};

afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

describe('pack install (agnostic-M-02 2.4, E3)', () => {
  const PACK_DEST = path.join('.claude', 'agents', 'gsd-charlotte-qa.md');
  const runPack = (args) => spawnSync(process.execPath, [GSD_TOOLS, 'pack', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GSD_HOME: mkTmp('gsd-pack-home-') },
  });

  test('loadPreset accepts the charlotte pack directory and lists its agent file', () => {
    const { loadPreset } = require('./project-deploy-render.js');
    const r = loadPreset(path.join(__dirname, '..', 'presets', 'packs', 'charlotte'));
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.preset.files.map((f) => f.dest), [PACK_DEST]);
    assert.ok(r.preset.settings_fragment, 'the pack carries its settings fragment');
  });

  test('pack install copies the agent; a second run skips it and keeps an edited copy', () => {
    const root = mkTmp('gsd-pack-root-');
    const first = runPack(['install', 'charlotte', '--root', root]);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.deepStrictEqual(JSON.parse(first.stdout).copied, [PACK_DEST]);
    assert.ok(fs.existsSync(path.join(root, PACK_DEST)));
    fs.writeFileSync(path.join(root, PACK_DEST), 'owner edit');
    const second = runPack(['install', 'charlotte', '--root', root]);
    assert.strictEqual(second.status, 0, second.stderr);
    const out = JSON.parse(second.stdout);
    assert.deepStrictEqual(out.copied, []);
    assert.deepStrictEqual(out.skipped, [PACK_DEST]);
    assert.strictEqual(fs.readFileSync(path.join(root, PACK_DEST), 'utf8'), 'owner edit');
  });

  test('pack install ../x exits 1 and writes nothing', () => {
    const root = mkTmp('gsd-pack-root-');
    const r = runPack(['install', '../x', '--root', root]);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(JSON.parse(r.stdout).ok, false);
    assert.strictEqual(fs.existsSync(path.join(root, '.claude')), false);
  });

  describe('R3 L-b: a symlinked target directory that resolves outside the project root is refused', () => {
    const outside = () => mkTmp('gsd-pack-outside-');
    const assertRefused = (root, outsideDir) => {
      const r = runPack(['install', 'charlotte', '--root', root]);
      assert.strictEqual(r.status, 1, r.stdout);
      assert.match(JSON.parse(r.stdout).errors[0].reason, /resolves outside the project root through a symlink/);
      assert.deepStrictEqual(fs.readdirSync(outsideDir), [], 'nothing is written outside the root');
    };

    test('.claude is a symlink to a directory outside the root', () => {
      const root = mkTmp('gsd-pack-root-');
      const out = outside();
      fs.symlinkSync(out, path.join(root, '.claude'));
      assertRefused(root, out);
    });

    test('.claude/agents is a symlink to a directory outside the root', () => {
      const root = mkTmp('gsd-pack-root-');
      const out = outside();
      fs.mkdirSync(path.join(root, '.claude'));
      fs.symlinkSync(out, path.join(root, '.claude', 'agents'));
      assertRefused(root, out);
    });

    test('a dangling symlink in the target path is refused, not followed', () => {
      const root = mkTmp('gsd-pack-root-');
      const out = outside();
      fs.symlinkSync(path.join(out, 'missing'), path.join(root, '.claude'));
      const r = runPack(['install', 'charlotte', '--root', root]);
      assert.strictEqual(r.status, 1, r.stdout);
      assert.deepStrictEqual(fs.readdirSync(out), []);
    });

    test('a symlink that stays inside the root is allowed', () => {
      const root = mkTmp('gsd-pack-root-');
      fs.mkdirSync(path.join(root, 'real-claude'));
      fs.symlinkSync(path.join(root, 'real-claude'), path.join(root, '.claude'));
      const r = runPack(['install', 'charlotte', '--root', root]);
      assert.strictEqual(r.status, 0, r.stdout);
      assert.ok(fs.existsSync(path.join(root, 'real-claude', 'agents', 'gsd-charlotte-qa.md')));
    });
  });
});
