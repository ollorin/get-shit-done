const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, 'gsd-tools.js');
let dir;
const cfg = (o) => fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(o));
const run = (args) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
const json = (args) => JSON.parse(run(args).stdout);
const INITS = [['init', 'execute-phase', '1', '--legacy'], ['init', 'plan-phase', '1', '--legacy'], ['init', 'milestone-op'], ['init', 'new-milestone'], ['init', 'new-project'], ['init', 'quick', 'x'], ['init', 'verify-work', '1'], ['init', 'phase-op', '1']];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-top-'));
  fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-a'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n### Phase 1: A\n**Goal**: g\n');
  fs.writeFileSync(path.join(dir, '.planning', 'STATE.md'), '# State\n');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CLI-3: one key for the top model', () => {
  test('default is opus/opus in every init output', () => {
    for (const a of INITS) { const o = json([...a, '--raw']); assert.deepStrictEqual([o.ruling_model, o.ruling_model_fallback], ['opus', 'opus'], a.join(' ')); }
  });
  test('models.top without fallback gives the same value for both; with fallback both are emitted', () => {
    cfg({ models: { top: 'fable' } });
    for (const a of INITS) { const o = json([...a, '--raw']); assert.deepStrictEqual([o.ruling_model, o.ruling_model_fallback], ['fable', 'fable'], a.join(' ')); }
    cfg({ models: { top: 'fable', top_fallback: 'opus' } });
    for (const a of INITS) { const o = json([...a, '--raw']); assert.deepStrictEqual([o.ruling_model, o.ruling_model_fallback], ['fable', 'opus'], a.join(' ')); }
  });
  test('init execute-roadmap carries them too', () => {
    cfg({ models: { top: 'fable', top_fallback: 'opus' } });
    const o = json(['init', 'execute-roadmap', '--raw']);
    assert.deepStrictEqual([o.ruling_model, o.ruling_model_fallback], ['fable', 'opus']);
  });
  test('legacy keys are honoured when models.top is absent, with a stderr notice; models.top wins', () => {
    cfg({ ruling_model: 'fable', ruling_model_fallback: 'opus' });
    const r = run(['init', 'plan-phase', '1', '--legacy', '--raw']);
    const o = JSON.parse(r.stdout);
    assert.deepStrictEqual([o.ruling_model, o.ruling_model_fallback], ['fable', 'opus']);
    assert.match(r.stderr, /legacy/);
    cfg({ ruling_model: 'fable', models: { top: 'opus' } });
    assert.strictEqual(json(['init', 'plan-phase', '1', '--legacy', '--raw']).ruling_model, 'opus');
  });
  test('a model id or a dotted name is rejected with exit 1', () => {
    for (const bad of ['claude-opus-4-1', 'opus.4', 'Opus', '']) {
      cfg({ models: { top: bad } });
      const r = run(['init', 'plan-phase', '1', '--legacy', '--raw']);
      assert.strictEqual(r.status, 1, bad);
      assert.match(r.stderr, /models\.top must be an alias/);
    }
  });
  test('verifier_model equals ruling_model under every profile', () => {
    cfg({ models: { top: 'fable' } });
    for (const profile of ['quality', 'balanced', 'budget', 'auto']) {
      cfg({ model_profile: profile, models: { top: 'fable' } });
      const o = json(['init', 'execute-phase', '1', '--legacy', '--raw']);
      assert.strictEqual(o.verifier_model, 'fable', profile);
      assert.strictEqual(o.verifier_model, o.ruling_model);
    }
  });
  test('resolve-model top / top-fallback / utility; config set models.top works', () => {
    assert.strictEqual(run(['resolve-model', 'top', '--raw']).stdout.trim(), 'opus');
    assert.strictEqual(run(['config-set', 'models.top', 'fable']).status, 0);
    assert.strictEqual(run(['resolve-model', 'top', '--raw']).stdout.trim(), 'fable');
    assert.strictEqual(run(['resolve-model', 'top-fallback', '--raw']).stdout.trim(), 'fable');
    assert.strictEqual(run(['resolve-model', 'gsd-verifier', '--raw']).stdout.trim(), 'fable');
    cfg({ models: { top: 'fable', top_fallback: 'opus' } });
    assert.strictEqual(run(['resolve-model', 'top-fallback', '--raw']).stdout.trim(), 'opus');
  });
});
