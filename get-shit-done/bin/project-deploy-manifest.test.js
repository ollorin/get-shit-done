'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { manifestShapeError } = require('./project-deploy-manifest.js');

const OK_HOOK = { event: 'PreToolUse', matcher: 'Bash', command: 'node x.js' };
const base = (extra) => ({ manifest_version: 1, preset: { name: 'demo', version: '1' }, files: {}, ...extra });

describe('manifest shape (B-FIX1 L6)', () => {
  test('a well-formed manifest passes', () => {
    const m = base({
      files: { '.claude/hooks/a.js': { kind: 'whole', sha256: 'x' } },
      settings: { hooks: [OK_HOOK], permissions: { allow: ['Bash(ls:*)'], deny: [] } },
    });
    assert.strictEqual(manifestShapeError(m), null);
    assert.strictEqual(manifestShapeError(base({ settings: null })), null);
    assert.strictEqual(manifestShapeError(base()), null);
  });

  test('L6 rows: each malformed shape is named', () => {
    assert.strictEqual(manifestShapeError(base({ settings: { hooks: [null] } })), 'settings');
    assert.strictEqual(manifestShapeError(base({ settings: { hooks: [{ event: 1, command: 'x' }] } })), 'settings');
    assert.strictEqual(manifestShapeError(base({ files: { a: null } })), 'files');
    assert.strictEqual(manifestShapeError(base({ settings: 'x' })), 'settings');
    assert.strictEqual(manifestShapeError(base({ settings: { permissions: { allow: [1] } } })), 'settings');
  });
});
