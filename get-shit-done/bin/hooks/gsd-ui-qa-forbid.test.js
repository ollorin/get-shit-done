'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'gsd-ui-qa-forbid.js');
const { evaluate } = require('./gsd-ui-qa-forbid.js');

const run = (payload, env = {}, cwd = os.tmpdir()) => {
  const clean = { PATH: process.env.PATH };
  const r = spawnSync('node', [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: { ...clean, ...env }, cwd });
  return { status: r.status, stderr: r.stderr };
};
const call = (tool, input) => ({ hook_event_name: 'PreToolUse', tool_name: `mcp__bladebro__${tool}`, tool_input: input });
const FORBID = { GSD_UI_QA_DRIVER: 'bladebro', GSD_UI_QA_FORBIDDEN_OPS: 'evaluate' };

describe('gsd-ui-qa-forbid', () => {
  test('act eval, batch-nested eval, run-nested js step and wait condition " js" are denied with exit 2', () => {
    const denied = [
      call('act', { action: 'eval', js: '1' }),
      call('act', { action: 'batch', steps: [{ action: 'click', ref: 'a' }, { action: 'eval', js: '1' }] }),
      call('run', { steps: [{ action: 'js', js: '1' }] }),
      call('act', { action: 'wait', condition: ' js', js: 'true' }),
      call('act', { action: 'wait', condition: 'JS', js: 'true' }),
    ];
    for (const p of denied) {
      const r = run(p, FORBID);
      assert.strictEqual(r.status, 2, JSON.stringify(p));
      assert.match(r.stderr, /evaluate/);
    }
  });

  test('navigate and other allowed ops exit 0; other drivers and non-driver tools exit 0', () => {
    assert.strictEqual(run(call('act', { action: 'navigate', url: 'http://x' }), FORBID).status, 0);
    assert.strictEqual(run(call('see', { mode: 'model' }), FORBID).status, 0);
    assert.strictEqual(run({ tool_name: 'Bash', tool_input: { command: 'ls' } }, FORBID).status, 0);
    assert.strictEqual(run({ tool_name: 'mcp__charlotte__charlotte_evaluate', tool_input: {} }, FORBID).status, 0);
  });

  test('no env (or an empty list) is a no-op even for eval and unreadable input', () => {
    assert.strictEqual(run(call('act', { action: 'eval', js: '1' }), { GSD_UI_QA_DRIVER: 'bladebro' }).status, 0);
    assert.strictEqual(run(call('act', { action: 'eval', js: '1' }), { ...FORBID, GSD_UI_QA_FORBIDDEN_OPS: ' , ' }).status, 0);
    assert.strictEqual(run('not json', {}).status, 0);
  });

  test('an unknown op is denied only when the forbid list is non-empty', () => {
    const odd = call('act', { action: 'no-such-action' });
    assert.strictEqual(run(odd, FORBID).status, 2);
    assert.match(run(odd, FORBID).stderr, /unknown/);
    assert.strictEqual(run(odd, { GSD_UI_QA_DRIVER: 'bladebro' }).status, 0);
  });

  test('fails closed with a non-empty list on unreadable payload, unreadable contract and a mistyped op name', () => {
    assert.strictEqual(run('not json', FORBID).status, 2);
    assert.strictEqual(run(call('act', { action: 'navigate', url: 'u' }), { ...FORBID, GSD_UI_QA_FORBIDDEN_OPS: 'evalute' }).status, 2);
    assert.strictEqual(run(call('act', { action: 'navigate', url: 'u' }), { GSD_UI_QA_FORBIDDEN_OPS: 'evaluate' }).status, 2);
    assert.strictEqual(run({ tool_name: 'Bash', tool_input: {} }, { GSD_UI_QA_FORBIDDEN_OPS: 'evaluate' }).status, 0);
  });

  test('without GSD_UI_QA_DRIVER the contract comes from the project at cwd', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-forbid-'));
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { capabilities: { ui_qa: { driver: 'charlotte' } } } }));
    const env = { GSD_UI_QA_FORBIDDEN_OPS: 'evaluate' };
    assert.strictEqual(run({ tool_name: 'mcp__charlotte__charlotte_evaluate', tool_input: {} }, env, root).status, 2);
    assert.strictEqual(run({ tool_name: 'mcp__charlotte__charlotte_navigate', tool_input: { url: 'u' } }, env, root).status, 0);
    assert.strictEqual(evaluate({ tool_name: 'mcp__charlotte__charlotte_evaluate', tool_input: {} }, env, root).exitCode, 2);
  });

  test('GSD installs the hook file but registers it in no settings', () => {
    const repo = path.join(__dirname, '..', '..', '..');
    const installer = fs.readFileSync(path.join(repo, 'bin', 'install.js'), 'utf8');
    assert.ok(!installer.includes('gsd-ui-qa-forbid'));
    assert.ok(fs.existsSync(HOOK));
  });
});
