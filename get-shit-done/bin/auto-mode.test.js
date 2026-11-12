'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveAutoMode } = require('./auto-mode.js');

const TOOLS = path.join(__dirname, 'gsd-tools.js');

describe('resolveAutoMode (U1)', () => {
  let dir;
  const writeConfig = (cfg) => fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(cfg));
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-auto-'));
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('each of the five sources alone is true and names itself', () => {
    assert.deepStrictEqual(resolveAutoMode(dir, ['init', 'plan-phase', '1', '--auto'], {}), { auto_mode: true, auto_mode_source: 'flag' });
    assert.deepStrictEqual(resolveAutoMode(dir, [], { GSD_AUTONOMOUS: '1' }), { auto_mode: true, auto_mode_source: 'env' });
    writeConfig({ mode: 'yolo' });
    assert.deepStrictEqual(resolveAutoMode(dir, [], {}), { auto_mode: true, auto_mode_source: 'config_mode' });
    writeConfig({ workflow: { auto_advance: true } });
    assert.deepStrictEqual(resolveAutoMode(dir, [], {}), { auto_mode: true, auto_mode_source: 'config_auto_advance' });
    writeConfig({ workflow: { _auto_chain_active: true } });
    assert.deepStrictEqual(resolveAutoMode(dir, [], {}), { auto_mode: true, auto_mode_source: 'config_auto_chain' });
  });

  test('no source, an interactive mode, or a missing/garbled config is false', () => {
    assert.deepStrictEqual(resolveAutoMode(dir, [], {}), { auto_mode: false, auto_mode_source: null });
    writeConfig({ mode: 'interactive', workflow: { auto_advance: false, _auto_chain_active: false } });
    assert.strictEqual(resolveAutoMode(dir, [], { GSD_AUTONOMOUS: '0' }).auto_mode, false);
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), '{not json');
    assert.strictEqual(resolveAutoMode(dir, [], {}).auto_mode, false);
  });

  test('every init workflow that returns a result emits auto_mode and auto_mode_source', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n### Phase 1: One\n**Goal:** x\n**Depends on:** None\n');
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-one'), { recursive: true });
    const inits = ['execute-phase 1', 'plan-phase 1', 'new-project', 'new-milestone', 'milestone-branch', 'quick fix', 'resume', 'verify-work 1', 'phase-op 1', 'todos', 'milestone-op', 'map-codebase', 'progress', 'execute-roadmap'];
    for (const init of inits) {
      const out = execFileSync('node', [TOOLS, 'init', ...init.split(' '), '--auto', '--raw'], { cwd: dir, encoding: 'utf-8', env: { ...process.env, GSD_LEGACY: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out);
      assert.strictEqual(parsed.auto_mode, true, `init ${init}`);
      assert.strictEqual(parsed.auto_mode_source, 'flag', `init ${init}`);
    }
    const off = JSON.parse(execFileSync('node', [TOOLS, 'init', 'progress', '--raw'], { cwd: dir, encoding: 'utf-8', env: { ...process.env, GSD_LEGACY: '1', GSD_AUTONOMOUS: '' } }));
    assert.strictEqual(off.auto_mode, false);
  });
});
