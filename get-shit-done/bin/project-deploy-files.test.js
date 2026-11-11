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

describe('block-managed files (agnostic-B4)', () => {
  const M = (id) => [`<!-- gsd:begin ${id} -->`, `<!-- gsd:end ${id} -->`];
  const L = (...xs) => `${xs.join('\n')}\n`;

  test('B4-1 parseBlocks returns ids in order with their inner text, empty inner as empty string', () => {
    const r = F.parseBlocks(L(M('a')[0], 'a1', 'a2', M('a')[1], 'between', M('b')[0], M('b')[1]));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.blocks.map((b) => b.id), ['a', 'b']);
    assert.strictEqual(r.blocks[0].inner, 'a1\na2');
    assert.strictEqual(r.blocks[1].inner, '');
  });

  test('B4-2 malformed markers each fail with the stated reason', () => {
    const cases = [
      [L(M('a')[0], 'x'), 'unclosed block: a'],
      [L('x', M('a')[1]), 'end without begin: a'],
      [L(M('a')[0], M('b')[0], 'x', M('b')[1], M('a')[1]), 'nested begin: b'],
      [L(M('a')[0], 'x', M('b')[1]), 'mismatched end: b'],
      [L(M('a')[0], M('a')[1], M('a')[0], M('a')[1]), 'duplicate block id: a'],
    ];
    for (const [text, reason] of cases) {
      assert.deepStrictEqual(F.parseBlocks(text), { ok: false, reason });
    }
  });

  test('B4-3 marker-like text that is not a whole marker line is ordinary text, CRLF marker is a marker', () => {
    assert.deepStrictEqual(F.parseBlocks(L('  <!-- gsd:begin a -->', '  <!-- gsd:end a -->')), { ok: true, blocks: [] });
    assert.deepStrictEqual(F.parseBlocks(L('text <!-- gsd:begin a -->', 'text <!-- gsd:end a -->')), { ok: true, blocks: [] });
    assert.deepStrictEqual(F.parseBlocks(L('<!-- gsd:begin A_B -->', '<!-- gsd:end A_B -->')), { ok: true, blocks: [] });
    const crlf = F.parseBlocks('x\r\n<!-- gsd:begin a -->\r\n<!-- gsd:end a -->\r\n');
    assert.strictEqual(crlf.ok, true);
    assert.deepStrictEqual(crlf.blocks.map((b) => b.id), ['a']);
  });

  test('B4-4 current null creates the file from next', () => {
    const next = L(M('a')[0], 'n', M('a')[1]);
    const r = F.planBlockFile({ current: null, next, prevBlocks: null });
    assert.strictEqual(r.action, 'create');
    assert.strictEqual(r.content, next);
  });

  test('B4-5 replace changes only the inner text of the matching block', () => {
    const current = L('head', M('a')[0], 'old1', 'old2', M('a')[1], 'mid', M('b')[0], 'bb', M('b')[1], 'tail');
    const next = L(M('a')[0], 'n1', 'n2', 'n3', M('a')[1], M('b')[0], 'bb', M('b')[1]);
    const expected = L('head', M('a')[0], 'n1', 'n2', 'n3', M('a')[1], 'mid', M('b')[0], 'bb', M('b')[1], 'tail');
    const r = F.planBlockFile({ current, next, prevBlocks: null });
    assert.strictEqual(r.action, 'update');
    assert.strictEqual(r.content, expected);
  });

  test('B4-6 an absent block is appended after a separating empty line', () => {
    const current = 'project text';
    const next = L(M('c')[0], 'x1', M('c')[1]);
    const r = F.planBlockFile({ current, next, prevBlocks: null });
    assert.strictEqual(r.action, 'update');
    assert.strictEqual(r.content, `${current}\n\n${M('c')[0]}\nx1\n${M('c')[1]}\n`);
  });

  test('B4-7 identical inner returns unchanged with no content', () => {
    const current = L('p', M('a')[0], 'same', M('a')[1]);
    const next = L(M('a')[0], 'same', M('a')[1]);
    const r = F.planBlockFile({ current, next, prevBlocks: null });
    assert.strictEqual(r.action, 'unchanged');
    assert.strictEqual('content' in r, false);
  });

  test('B4-8 a project-only block is byte-identical in the result', () => {
    const current = L(M('mine')[0], 'my own', 'x', M('mine')[1], M('a')[0], 'old', M('a')[1]);
    const next = L(M('a')[0], 'new', M('a')[1]);
    const expected = L(M('mine')[0], 'my own', 'x', M('mine')[1], M('a')[0], 'new', M('a')[1]);
    const r = F.planBlockFile({ current, next, prevBlocks: null });
    assert.strictEqual(r.action, 'update');
    assert.strictEqual(r.content, expected);
  });

  test('B4-9 malformed current is a conflict, malformed next is an error', () => {
    const conflict = F.planBlockFile({ current: L(M('a')[0], 'x'), next: L(M('a')[0], 'n', M('a')[1]), prevBlocks: null });
    assert.strictEqual(conflict.action, 'conflict');
    assert.strictEqual(conflict.reason, 'malformed markers: unclosed block: a');
    assert.strictEqual('content' in conflict, false);

    const noMarkers = F.planBlockFile({ current: 'x\n', next: 'plain\n', prevBlocks: null });
    assert.strictEqual(noMarkers.action, 'error');
    assert.strictEqual(noMarkers.reason, 'preset block file: no managed blocks');

    const dup = F.planBlockFile({ current: 'x\n', next: L(M('a')[0], 'x', M('a')[1], M('a')[0], 'y', M('a')[1]), prevBlocks: null });
    assert.strictEqual(dup.action, 'error');
    assert.strictEqual(dup.reason, 'preset block file: duplicate block id: a');
  });

  test('B4-10 hand edit overwritten by a new preset inner warns; no warning when current matches the previous preset', () => {
    const next = L(M('a')[0], 'new-preset', M('a')[1]);
    const edited = F.planBlockFile({
      current: L(M('a')[0], 'hand edit', M('a')[1]),
      next,
      prevBlocks: { a: F.sha256(Buffer.from('old-preset')) },
    });
    assert.strictEqual(edited.action, 'update');
    assert.deepStrictEqual(edited.warnings, ['local edit in block overwritten: a']);

    const clean = F.planBlockFile({
      current: L(M('a')[0], 'old-preset', M('a')[1]),
      next,
      prevBlocks: { a: F.sha256(Buffer.from('old-preset')) },
    });
    assert.deepStrictEqual(clean.warnings, []);
  });

  test('B4-11 blocks maps each id of next to the sha256 of its inner text', () => {
    const crypto = require('crypto');
    const r = F.planBlockFile({ current: null, next: L(M('a')[0], 'x', M('a')[1], M('b')[0], 'y\nz', M('b')[1]), prevBlocks: null });
    const hash = (s) => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');
    assert.deepStrictEqual(r.blocks, { a: hash('x'), b: hash('y\nz') });
  });

  test('B4-12 stripMarkerLines removes marker lines with their line breaks and nothing else', () => {
    const text = L('a', M('x')[0], 'b', M('x')[1], 'c', M('y')[0], 'd', M('y')[1]);
    assert.strictEqual(F.stripMarkerLines(text), L('a', 'b', 'c', 'd'));
    assert.strictEqual(F.stripMarkerLines('a\r\n<!-- gsd:begin x -->\r\nb\r\n<!-- gsd:end x -->\r\nc'), 'a\r\nb\r\nc');
  });
});
