'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, 'gsd-tools.js');
let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (args, env = {}) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, STACK_LOCK_HELD: '', ...env } });
const cfg = (extra = {}) => write('.planning/config.json', JSON.stringify({ stack: { isolation: { lock_dir: '.tmp' } }, ...extra }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-stack-'));
  write('.planning/ROADMAP.md', '# Roadmap\n\n### Phase 1: One\n**Goal**: g\n');
  write('.planning/STATE.md', '# s\n');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('missing rule file with lock_dir set: notice without opt-in, error with opt-in; present file or no lock_dir: silent', () => {
  cfg();
  const r = run(['init', 'execute-phase', '1', '--legacy', '--raw']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /Notice: stack\.isolation\.lock_dir is set but \.claude\/rules\/shared-stack\.md is missing/);
  assert.strictEqual(JSON.parse(r.stdout).stack_rule_missing, true);
  cfg({ workflow: { stack_lock: { enforce: true } } });
  const bad = run(['init', 'execute-phase', '1', '--legacy', '--raw']);
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /shared-stack\.md is missing/);
  write('.claude/rules/shared-stack.md', '# rule\n');
  assert.strictEqual(run(['init', 'execute-phase', '1', '--legacy', '--raw']).status, 0);
  write('.planning/config.json', '{}');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const none = run(['init', 'execute-phase', '1', '--legacy', '--raw']);
  assert.strictEqual(none.status, 0);
  assert.doesNotMatch(none.stderr, /shared-stack/);
});

test('stack require-lock passes without opt-in; with opt-in it fails unless STACK_LOCK_HELD=1', () => {
  assert.strictEqual(run(['stack', 'require-lock']).status, 0);
  write('.planning/config.json', JSON.stringify({ workflow: { stack_lock: { enforce: true } } }));
  const bad = run(['stack', 'require-lock']);
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /stack lock not held/);
  assert.strictEqual(run(['stack', 'require-lock'], { STACK_LOCK_HELD: '1' }).status, 0);
});
