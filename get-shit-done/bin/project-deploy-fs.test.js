'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRegular } = require('./project-deploy-fs.js');

const tmps = [];
afterEach(() => {
  while (tmps.length) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

describe('readRegular (B-FIX1 L8)', () => {
  test('L8 a symlink to a regular file is not read as a regular file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-fs-read-'));
    tmps.push(root);
    const target = path.join(root, 'secret.txt');
    fs.writeFileSync(target, 'data\n');
    const link = path.join(root, 'link.txt');
    fs.symlinkSync(target, link);
    assert.deepStrictEqual(readRegular(link), { error: 'not a regular file' });
    assert.deepStrictEqual(readRegular(target), { bytes: Buffer.from('data\n') });
    assert.deepStrictEqual(readRegular(path.join(root, 'absent.txt')), { bytes: null });
  });
});
