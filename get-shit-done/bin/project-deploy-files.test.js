'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('./project-deploy-files.js');

const tmps = [];

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deploy-files-'));
  tmps.push(dir);
  return dir;
}

afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

const BASE_TEXT = 'one\ntwo\nthree\nfour\nfive\n';
const BASE = Buffer.from(BASE_TEXT);
const mergeWith = (tmpRoot) => (c, b, n) => F.gitMergeFile(c, b, n, { tmpRoot });

describe('planWholeFile', () => {
  test('1 current null is created with next', () => {
    const next = Buffer.from('N\n');
    const r = F.planWholeFile({ current: null, base: null, manifestHash: null, next });
    assert.strictEqual(r.action, 'create');
    assert.ok(r.content.equals(next));
  });

  test('2 current equal to next is unchanged, with and without a manifest hash', () => {
    const same = Buffer.from('same\n');
    const plain = F.planWholeFile({ current: same, base: null, manifestHash: null, next: same });
    const managed = F.planWholeFile({ current: same, base: BASE, manifestHash: F.sha256(same), next: same });
    assert.deepStrictEqual(plain, { action: 'unchanged' });
    assert.deepStrictEqual(managed, { action: 'unchanged' });
    assert.ok(!('content' in managed));
  });

  test('3 unchanged managed file is overwritten without calling git', () => {
    const next = Buffer.from('one\nTWO\nthree\nfour\nfive\n');
    let calls = 0;
    const mergeFn = () => {
      calls += 1;
      return { ok: false, reason: 'should not run' };
    };
    const r = F.planWholeFile({ current: BASE, base: BASE, manifestHash: F.sha256(BASE), next, mergeFn });
    assert.strictEqual(r.action, 'overwrite');
    assert.ok(r.content.equals(next));
    assert.strictEqual(calls, 0);
  });

  test('4 edited managed file is three-way merged with both changes kept', () => {
    const current = Buffer.from('ONE\ntwo\nthree\nfour\nfive\n');
    const next = Buffer.from('one\ntwo\nthree\nfour\nFIVE\n');
    const r = F.planWholeFile({
      current,
      base: BASE,
      manifestHash: F.sha256(BASE),
      next,
      mergeFn: mergeWith(mkTmp()),
    });
    assert.strictEqual(r.action, 'merge');
    const text = r.content.toString('utf8');
    assert.strictEqual(text, 'ONE\ntwo\nthree\nfour\nFIVE\n');
    assert.ok(!text.includes('<<<<<<<'));
  });

  test('5 conflicting edits produce no content', () => {
    const current = Buffer.from('one\ntwo\nTHREE-A\nfour\nfive\n');
    const next = Buffer.from('one\ntwo\nTHREE-B\nfour\nfive\n');
    const r = F.planWholeFile({
      current,
      base: BASE,
      manifestHash: F.sha256(BASE),
      next,
      mergeFn: mergeWith(mkTmp()),
    });
    assert.strictEqual(r.action, 'conflict');
    assert.strictEqual(r.reason, 'merge conflict');
    assert.ok(!('content' in r));
  });

  test('6 unmanaged existing file and missing merge base are conflicts', () => {
    const current = Buffer.from('edited\n');
    const next = Buffer.from('upstream\n');
    const unmanaged = F.planWholeFile({ current, base: null, manifestHash: null, next });
    assert.deepStrictEqual(unmanaged, { action: 'conflict', reason: 'exists and is not managed' });

    const noBase = F.planWholeFile({
      current,
      base: null,
      manifestHash: F.sha256(BASE),
      next,
    });
    assert.deepStrictEqual(noBase, { action: 'conflict', reason: 'merge base missing' });
  });

  test('7 local edit with unchanged upstream is unchanged', () => {
    const current = Buffer.from('LOCAL\ntwo\nthree\nfour\nfive\n');
    const r = F.planWholeFile({
      current,
      base: BASE,
      manifestHash: F.sha256(BASE),
      next: BASE,
      mergeFn: mergeWith(mkTmp()),
    });
    assert.deepStrictEqual(r, { action: 'unchanged' });
  });

  test('9 a missing git binary is a failed merge and a conflict in the plan', () => {
    const tmpRoot = mkTmp();
    const bad = { gitBin: 'gsd-no-such-binary', tmpRoot };
    assert.deepStrictEqual(F.gitMergeFile(BASE, BASE, BASE, bad), {
      ok: false,
      reason: 'git merge-file failed',
    });
    assert.deepStrictEqual(fs.readdirSync(tmpRoot), []);

    const current = Buffer.from('LOCAL\ntwo\nthree\nfour\nfive\n');
    const r = F.planWholeFile({
      current,
      base: BASE,
      manifestHash: F.sha256(BASE),
      next: Buffer.from('one\ntwo\nthree\nfour\nFIVE\n'),
      mergeFn: (c, b, n) => F.gitMergeFile(c, b, n, bad),
    });
    assert.strictEqual(r.action, 'conflict');
    assert.strictEqual(r.reason, 'git merge-file failed');
  });

  test('10 CRLF bytes survive overwrite, and the sha256 digest is correct', () => {
    const next = Buffer.from('a\r\nb\r\n');
    const r = F.planWholeFile({ current: BASE, base: BASE, manifestHash: F.sha256(BASE), next });
    assert.strictEqual(r.action, 'overwrite');
    assert.ok(r.content.equals(next));
    assert.strictEqual(
      F.sha256(Buffer.from('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('gitMergeFile', () => {
  test('8 temp directory is removed after a clean merge and after a conflict', () => {
    const tmpRoot = mkTmp();
    const merge = (c, b, n) => F.gitMergeFile(c, b, n, { tmpRoot });

    const clean = merge(
      Buffer.from('LOCAL\ntwo\nthree\nfour\nfive\n'),
      BASE,
      Buffer.from('one\ntwo\nthree\nfour\nFIVE\n'),
    );
    assert.strictEqual(clean.ok, true);
    assert.deepStrictEqual(fs.readdirSync(tmpRoot), []);

    const conflict = merge(
      Buffer.from('one\ntwo\nA\nfour\nfive\n'),
      BASE,
      Buffer.from('one\ntwo\nB\nfour\nfive\n'),
    );
    assert.strictEqual(conflict.ok, false);
    assert.strictEqual(conflict.reason, 'merge conflict');
    assert.deepStrictEqual(fs.readdirSync(tmpRoot), []);
  });
});
