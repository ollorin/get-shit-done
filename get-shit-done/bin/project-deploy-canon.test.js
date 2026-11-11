'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planDeploy } = require('./project-deploy.js');
const { canonicalRel, sameFile } = require('./project-deploy-fs.js');
const { resolvePaths, isGuardedCanon } = require('./project-deploy-canon.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const CONFIG = '.planning/config.json';
const SYMLINK_REASON = 'dest traverses a symlink';

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

const makeProject = () => {
  const root = mkTmp('gsd-canon-proj-');
  writeAt(root, CONFIG, JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities: {} } }));
  return root;
};

const makePreset = (dests) => {
  const dir = mkTmp('gsd-canon-preset-');
  writeAt(dir, 'hooks/guard.js', '// guard\n', 0o755);
  const files = dests.map((dest) => ({ src: 'hooks/guard.js', dest, kind: 'whole' }));
  writeAt(dir, 'preset.json', JSON.stringify({ name: 'demo', version: '1', files }));
  return dir;
};

const plan = (root, dests) => planDeploy({
  root, command: 'init', presetDir: makePreset(dests), env: {}, session: HUMAN,
});

const hasError = (res, file, reason) => res.report.errors.some((e) => e.file === file && e.reason === reason);

// APFS (default macOS) folds the long s and case; Linux ext4 does not. Probe before asserting on the fold.
const FOLD_OBSERVABLE = (() => {
  const d = mkTmp('gsd-canon-probe-');
  fs.mkdirSync(path.join(d, 'hooks'));
  return fs.existsSync(path.join(d, 'hookſ'));
})();
const FOLD_SKIP = FOLD_OBSERVABLE ? false : 'long-s fold not observable on this volume';

describe('canonical identity guard (B-FIX1 H1)', () => {
  test('H1-a a long-s alias of an existing hooks dir is guarded (fold observable)', { skip: FOLD_SKIP }, () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    const dest = '.claude/hookſ/x.sh';
    const res = plan(root, [dest]);
    assert.strictEqual(res.report.ok, true);
    assert.deepStrictEqual(res.report.guarded_changes, [dest]);
  });

  test('H1-b a long-s alias with no hooks dir is guarded through the folded tail', () => {
    const root = makeProject();
    const dest = '.claude/hookſ/x.sh';
    const res = plan(root, [dest]);
    assert.strictEqual(res.report.ok, true);
    assert.deepStrictEqual(res.report.guarded_changes, [dest]);
  });

  test('H1-c an upper-case alias with no .claude dir is guarded through the folded tail', () => {
    const root = makeProject();
    const dest = '.CLAUDE/Hooks/x.sh';
    const res = plan(root, [dest]);
    assert.strictEqual(res.report.ok, true);
    assert.deepStrictEqual(res.report.guarded_changes, [dest]);
  });

  test('H1-d a symlink to the hooks dir is refused', () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    fs.symlinkSync(path.join(root, '.claude', 'hooks'), path.join(root, 'linkh'));
    const res = plan(root, ['linkh/x.sh']);
    assert.strictEqual(res.report.ok, false);
    assert.ok(hasError(res, 'linkh/x.sh', SYMLINK_REASON));
  });

  test('H1-e a symlink to the .claude dir is refused (settings alias)', () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(root, '.claude'), path.join(root, 'alias'));
    const res = plan(root, ['alias/settings.json']);
    assert.strictEqual(res.report.ok, false);
    assert.ok(hasError(res, 'alias/settings.json', SYMLINK_REASON));
  });

  test('H1-f a symlinked parent of a hooks dir is refused', () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    fs.symlinkSync(path.join(root, '.claude'), path.join(root, 'alias'));
    const res = plan(root, ['alias/hooks/x.sh']);
    assert.strictEqual(res.report.ok, false);
    assert.ok(hasError(res, 'alias/hooks/x.sh', SYMLINK_REASON));
  });

  test('H1-g a symlinked final file is refused even when its target is inside the root', () => {
    const root = makeProject();
    writeAt(root, 'scripts/real.js', '// real\n');
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    fs.symlinkSync(path.join(root, 'scripts', 'real.js'), path.join(root, '.claude', 'hooks', 'guard.js'));
    const dest = '.claude/hooks/guard.js';
    const res = plan(root, [dest]);
    assert.strictEqual(res.report.ok, false);
    assert.ok(hasError(res, dest, SYMLINK_REASON));
  });

  test('H1-h a plain scripts path is not guarded', () => {
    const root = makeProject();
    const res = plan(root, ['scripts/x.sh']);
    assert.strictEqual(res.report.ok, true);
    assert.deepStrictEqual(res.report.guarded_changes, []);
  });

  test('H1-i a long-s spelling of the settings file is refused after canonicalisation (fold observable)', { skip: FOLD_SKIP }, () => {
    const root = makeProject();
    writeAt(root, '.claude/settings.json', '{}\n');
    const dest = '.claude/ſettings.json';
    const res = plan(root, [dest]);
    assert.strictEqual(res.report.ok, false);
    assert.ok(hasError(res, dest, 'set-managed: use the settings fragment'));
  });

  test('H1-j a long-s settings spelling with no file is refused through the folded tail', () => {
    const root = makeProject();
    const dest = '.claude/ſettings.json';
    const res = plan(root, [dest]);
    assert.strictEqual(res.report.ok, false);
    assert.ok(hasError(res, dest, 'set-managed: use the settings fragment'));
  });

  test('H1-k an upper-case .GIT dest is refused (caught at preset load by destKey, asserted for the row)', () => {
    const root = makeProject();
    const res = plan(root, ['.GIT/x']);
    assert.strictEqual(res.report.ok, false);
    assert.ok(res.report.errors.some((e) => e.reason.includes('never-managed path')));
  });
});

describe('canonicalRel and sameFile (B-FIX1 H1)', () => {
  test('canonicalRel: a dangling symlink component is refused, not treated as missing', () => {
    const root = makeProject();
    fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'dangling'));
    assert.deepStrictEqual(canonicalRel(root, 'dangling/x.sh'), { error: SYMLINK_REASON });
  });

  test('canonicalRel: a file used as a directory fails closed', () => {
    const root = makeProject();
    writeAt(root, 'plain.txt', 'x');
    assert.deepStrictEqual(canonicalRel(root, 'plain.txt/x.sh'), { error: 'dest cannot be resolved' });
  });

  test('canonicalRel: a missing tail is folded and joined to the real head', () => {
    const root = makeProject();
    assert.deepStrictEqual(canonicalRel(root, 'Dir/SUB/File.MD'), { canon: 'dir/sub/file.md' });
  });

  test('sameFile: hard links are the same file, a missing path is not', () => {
    const root = makeProject();
    writeAt(root, 'a.txt', 'x');
    fs.linkSync(path.join(root, 'a.txt'), path.join(root, 'b.txt'));
    assert.strictEqual(sameFile(path.join(root, 'a.txt'), path.join(root, 'b.txt')), true);
    assert.strictEqual(sameFile(path.join(root, 'a.txt'), path.join(root, 'missing')), false);
  });

  test('resolvePaths: two dests that differ only by long-s or case are a duplicate canonical path', () => {
    const root = makeProject();
    const res = resolvePaths(root, { dests: ['q/ſ.md', 'q/s.md'], bases: [], extra: [] });
    assert.deepStrictEqual(res.errors, [{ file: 'q/s.md', reason: 'duplicate canonical path' }]);
  });

  test('resolvePaths: a case-only duplicate is rejected and guarded membership follows the canonical path', () => {
    const root = makeProject();
    const dup = resolvePaths(root, { dests: ['a/b.md', 'a/B.md'], bases: [], extra: [] });
    assert.deepStrictEqual(dup.errors, [{ file: 'a/B.md', reason: 'duplicate canonical path' }]);
    const ok = resolvePaths(root, { dests: ['.claude/hooks/x.sh', 'scripts/x.sh'], bases: [], extra: [] });
    assert.deepStrictEqual(ok.errors, []);
    assert.deepStrictEqual([...ok.guarded], ['.claude/hooks/x.sh']);
    assert.strictEqual(isGuardedCanon(root, 'scripts/x.sh'), false);
  });
});
