'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { mergeSettings, serializeSettings } = require('./project-deploy-settings.js');

const deepFreeze = (x) => {
  if (x !== null && typeof x === 'object') {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
};

const merge = (current, prev, fragment) => mergeSettings(deepFreeze(current), deepFreeze(prev), deepFreeze(fragment));

const grp = (matcher, ...commands) => ({ matcher, hooks: commands.map((command) => ({ type: 'command', command })) });
const trip = (event, matcher, command) => ({ event, matcher, command });
const emptyPerms = { allow: [], deny: [], ask: [] };

describe('settings set-merge (agnostic-B5)', () => {
  test('1 null current and null prev: settings equal the fragment and everything is added', () => {
    const fragment = { permissions: { allow: ['A'], deny: ['D'], ask: ['K'] }, hooks: { PreToolUse: [grp('Bash', 'h1')] } };
    const r = merge(null, null, fragment);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.settings, fragment);
    const shape = { permissions: { allow: ['A'], deny: ['D'], ask: ['K'] }, hooks: [trip('PreToolUse', 'Bash', 'h1')] };
    assert.deepStrictEqual(r.deployed, shape);
    assert.deepStrictEqual(r.added, shape);
    assert.deepStrictEqual(r.removed, { permissions: emptyPerms, hooks: [] });
    assert.strictEqual(r.changed, true);
  });

  test('2 a project-added allow rule survives and a previously deployed one is removed', () => {
    const r = merge(
      { permissions: { allow: ['A1', 'PROJECT', 'A2'] } },
      { permissions: { allow: ['A1', 'A2'], deny: [], ask: [] }, hooks: [] },
      { permissions: { allow: ['A1', 'A3'] } },
    );
    assert.deepStrictEqual(r.settings.permissions.allow, ['A1', 'PROJECT', 'A3']);
    assert.deepStrictEqual(r.removed, { permissions: { allow: ['A2'], deny: [], ask: [] }, hooks: [] });
    assert.deepStrictEqual(r.added, { permissions: { allow: ['A3'], deny: [], ask: [] }, hooks: [] });
  });

  test('3 project deny and ask entries survive; a deployed deny entry is removed and named', () => {
    const r = merge(
      { permissions: { deny: ['PD_PROJECT', 'PD_OLD'], ask: ['ASK_PROJECT'] } },
      { permissions: { allow: [], deny: ['PD_OLD'], ask: [] }, hooks: [] },
      { permissions: { deny: [], ask: [] } },
    );
    assert.deepStrictEqual(r.settings.permissions.deny, ['PD_PROJECT']);
    assert.deepStrictEqual(r.settings.permissions.ask, ['ASK_PROJECT']);
    assert.deepStrictEqual(r.removed.permissions.deny, ['PD_OLD']);
    assert.strictEqual('allow' in r.settings.permissions, false);
  });

  test('4 with no prev, a fragment entry already in current appears once', () => {
    const r = merge({ permissions: { allow: ['X', 'Y'] } }, null, { permissions: { allow: ['X', 'Z'] } });
    assert.deepStrictEqual(r.settings.permissions.allow, ['X', 'Y', 'Z']);
  });

  test('5 preset hooks come first in preset order; a removed preset hook is named by value', () => {
    const current = { hooks: { PreToolUse: [grp('Bash', 'preset-old'), grp('Write', 'project-hook')] } };
    const prev = { permissions: emptyPerms, hooks: [trip('PreToolUse', 'Bash', 'preset-old')] };
    const fragment = { hooks: { PreToolUse: [grp('Bash', 'preset-new'), grp('Edit', 'preset-2')] } };
    const r = merge(current, prev, fragment);
    assert.deepStrictEqual(r.settings.hooks.PreToolUse, [grp('Bash', 'preset-new'), grp('Edit', 'preset-2'), grp('Write', 'project-hook')]);
    assert.deepStrictEqual(r.removed.hooks, [trip('PreToolUse', 'Bash', 'preset-old')]);
    assert.deepStrictEqual(r.added.hooks, [trip('PreToolUse', 'Bash', 'preset-new'), trip('PreToolUse', 'Edit', 'preset-2')]);
  });

  test('6 a mixed group keeps the project handler when the preset handler is dropped', () => {
    const r = merge(
      { hooks: { PreToolUse: [grp('Bash', 'preset-old', 'project-cmd')] } },
      { permissions: emptyPerms, hooks: [trip('PreToolUse', 'Bash', 'preset-old')] },
      {},
    );
    assert.deepStrictEqual(r.settings.hooks.PreToolUse, [grp('Bash', 'project-cmd')]);
  });

  test('7 with no prev, a current handler equal to a fragment handler appears once, in the fragment position', () => {
    const r = merge(
      { hooks: { PreToolUse: [grp('Bash', 'shared')] } },
      null,
      { hooks: { PreToolUse: [grp('Bash', 'shared')] } },
    );
    assert.deepStrictEqual(r.settings.hooks.PreToolUse, [grp('Bash', 'shared')]);
  });

  test('8 the same command under another event or matcher is a different handler and survives', () => {
    const r = merge(
      { hooks: { PostToolUse: [grp('Bash', 'preset-new')], PreToolUse: [grp('Write', 'preset-new')] } },
      null,
      { hooks: { PreToolUse: [grp('Bash', 'preset-new')] } },
    );
    assert.deepStrictEqual(r.settings.hooks.PostToolUse, [grp('Bash', 'preset-new')]);
    assert.deepStrictEqual(r.settings.hooks.PreToolUse, [grp('Bash', 'preset-new'), grp('Write', 'preset-new')]);
  });

  test('9 other top-level keys, permission extras and non-command handlers are preserved in key order', () => {
    const current = {
      env: { A: '1' },
      statusLine: { type: 'command', command: 'sl' },
      permissions: { defaultMode: 'acceptEdits', additionalDirectories: ['/x'], allow: ['P'] },
      hooks: { Notification: [{ hooks: [{ type: 'prompt', prompt: 'p' }] }] },
    };
    const r = merge(current, null, { permissions: { allow: ['F'] }, hooks: { PreToolUse: [grp('Bash', 'f')] } });
    assert.deepStrictEqual(r.settings.env, current.env);
    assert.deepStrictEqual(r.settings.statusLine, current.statusLine);
    assert.strictEqual(r.settings.permissions.defaultMode, 'acceptEdits');
    assert.deepStrictEqual(r.settings.permissions.additionalDirectories, ['/x']);
    assert.deepStrictEqual(r.settings.hooks.Notification, current.hooks.Notification);
    assert.deepStrictEqual(Object.keys(r.settings), Object.keys(current));
  });

  test('10 a second merge over its own output changes nothing', () => {
    const current = {
      permissions: { allow: ['P'] },
      hooks: { PreToolUse: [grp('Bash', 'preset-old'), grp('Write', 'project-hook')] },
    };
    const prev = { permissions: { allow: ['F-OLD'], deny: [], ask: [] }, hooks: [trip('PreToolUse', 'Bash', 'preset-old')] };
    const fragment = { permissions: { allow: ['F'] }, hooks: { PreToolUse: [grp('Bash', 'preset-new'), grp('Edit', 'preset-2')] } };
    const r1 = merge(current, prev, fragment);
    const r2 = merge(r1.settings, r1.deployed, fragment);
    assert.strictEqual(r2.changed, false);
    assert.deepStrictEqual(r2.added, { permissions: emptyPerms, hooks: [] });
    assert.deepStrictEqual(r2.removed, { permissions: emptyPerms, hooks: [] });
    assert.strictEqual(serializeSettings(r2.settings), serializeSettings(r1.settings));
  });

  test('11 inputs are frozen for every merge above and are left deep-equal to their pristine copies', () => {
    const current = { permissions: { allow: ['P', 'OLD'] }, hooks: { PreToolUse: [grp('Bash', 'old'), grp('Write', 'p')] } };
    const prev = { permissions: { allow: ['OLD'], deny: [], ask: [] }, hooks: [trip('PreToolUse', 'Bash', 'old')] };
    const fragment = { permissions: { allow: ['F'] }, hooks: { PreToolUse: [grp('Bash', 'new')] } };
    const pristine = [structuredClone(current), structuredClone(prev), structuredClone(fragment)];
    const r = merge(current, prev, fragment);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual([current, prev, fragment], pristine);
  });

  test('12 a null fragment removes every previously deployed entry, keeps project entries, and omits emptied events', () => {
    const current = {
      permissions: { allow: ['PROJ', 'OLD_PRESET'] },
      hooks: { PreToolUse: [grp('Bash', 'old-preset')], PostToolUse: [grp('Write', 'project')] },
    };
    const prev = {
      permissions: { allow: ['OLD_PRESET'], deny: [], ask: [] },
      hooks: [trip('PreToolUse', 'Bash', 'old-preset')],
    };
    const r = merge(current, prev, null);
    assert.deepStrictEqual(r.settings.permissions.allow, ['PROJ']);
    assert.deepStrictEqual(r.settings.hooks, { PostToolUse: [grp('Write', 'project')] });
    assert.deepStrictEqual(r.removed, { permissions: { allow: ['OLD_PRESET'], deny: [], ask: [] }, hooks: [trip('PreToolUse', 'Bash', 'old-preset')] });
  });

  test('13 an invalid current is rejected with a reason and no settings', () => {
    const invalid = [
      { permissions: 'x' },
      { permissions: { allow: 'x' } },
      [],
      { hooks: [] },
      { hooks: { PreToolUse: {} } },
      { hooks: { PreToolUse: ['x'] } },
      { hooks: { PreToolUse: [null] } },
      { hooks: { PreToolUse: [[]] } },
      { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: 'cmd' }] } },
      { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: {} }] } },
    ];
    for (const current of invalid) {
      const r = merge(current, null, null);
      assert.strictEqual(r.ok, false, JSON.stringify(current));
      assert.strictEqual(typeof r.reason, 'string');
      assert.ok(r.reason.length > 0);
      assert.strictEqual('settings' in r, false);
    }
  });

  test('14 serializeSettings ends with exactly one newline and parses back to the same value', () => {
    const s = { permissions: { allow: ['a'] }, hooks: {} };
    const out = serializeSettings(s);
    assert.ok(out.endsWith('\n'));
    assert.ok(!out.endsWith('\n\n'));
    assert.deepStrictEqual(JSON.parse(out), s);
  });
});
