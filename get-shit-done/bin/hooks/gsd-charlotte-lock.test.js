'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'gsd-charlotte-lock.js');
const { isDbResetCommand, resolveHolderPid, isLockLive, buildLock, handle, LOCK_REL } = require('./gsd-charlotte-lock.js');

const NOW = Date.parse('2026-09-24T12:00:00Z');

describe('isDbResetCommand', () => {
  const positives = [
    'supabase db reset',
    'npx supabase db reset',
    'cd apps/api && npx supabase db reset --local',
    'npx -y supabase@2.40.0 db reset',
    'SUPABASE_DEBUG=1 supabase --workdir apps/api db reset',
    './node_modules/.bin/supabase db reset',
    'pnpm exec supabase db reset',
    'nx run api:supabase:reset',
    'npx nx run api:supabase:reset',
    'npm run db:reset',
    'deno task db:reset',
    'bash -c "supabase db reset"',
    'echo start; supabase db reset',
    'scripts/preflight.sh --backend',
    'bash scripts/preflight.sh',
  ];
  for (const cmd of positives) {
    test(`blocks: ${cmd}`, () => assert.strictEqual(isDbResetCommand(cmd), true));
  }
  const negatives = [
    'supabase db push',
    'supabase status',
    'npx supabase migration new foo',
    'git commit -m "docs: explain supabase db reset"',
    'grep -rn "supabase db reset" docs',
    'cat docs/db-reset.md',
    'nx run api:test',
    '',
    undefined,
  ];
  for (const cmd of negatives) {
    test(`allows: ${JSON.stringify(cmd)}`, () => assert.strictEqual(isDbResetCommand(cmd), false));
  }
});

describe('resolveHolderPid', () => {
  test('skips shell/timeout wrappers to the first real ancestor', () => {
    const chain = { 100: { ppid: 90, comm: 'timeout' }, 90: { ppid: 80, comm: 'sh' }, 80: { ppid: 1, comm: 'claude' } };
    assert.strictEqual(resolveHolderPid(100, pid => chain[pid]), 80);
  });
  test('lookup failure returns the pid reached so far', () => {
    assert.strictEqual(resolveHolderPid(100, () => { throw new Error('no ps'); }), 100);
  });
});

describe('isLockLive', () => {
  const lock = buildLock({ pid: 42, nowMs: NOW, ttlSec: 60, source: 'mcp' });
  test('live: unexpired and pid alive', () => assert.strictEqual(isLockLive(lock, NOW + 1000, () => true), true));
  test('stale: expired', () => assert.strictEqual(isLockLive(lock, NOW + 61000, () => true), false));
  test('stale: holder pid dead', () => assert.strictEqual(isLockLive(lock, NOW + 1000, () => false), false));
  test('garbage lock is not live', () => {
    assert.strictEqual(isLockLive({ pid: 42, expires_at: 'nope' }, NOW, () => true), false);
    assert.strictEqual(isLockLive(null, NOW, () => true), false);
  });
});

describe('handle', () => {
  let root;
  let lockFile;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-charlotte-lock-'));
    lockFile = path.join(root, LOCK_REL);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const deps = (extra = {}) => ({ nowMs: NOW, env: {}, isPidAlive: () => true, holderPid: 4242, resolveProjectRoot: d => d, ...extra });
  const bash = cmd => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd }, cwd: root });
  const writeLock = lock => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify(lock));
  };

  test('Charlotte MCP call takes the lock with holder pid and TTL', () => {
    const r = handle({ hook_event_name: 'PreToolUse', tool_name: 'mcp__charlotte__charlotte_navigate', cwd: root, agent_id: 'a1' }, deps({ env: { GSD_CHARLOTTE_LOCK_TTL_SEC: '120' } }));
    assert.strictEqual(r.exitCode, 0);
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.strictEqual(lock.pid, 4242);
    assert.strictEqual(lock.agent_id, 'a1');
    assert.strictEqual(Date.parse(lock.expires_at) - NOW, 120000);
  });

  test('SubagentStart for gsd-charlotte-qa takes the lock; other agents do not', () => {
    handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-executor', agent_id: 'x', cwd: root }, deps());
    assert.strictEqual(fs.existsSync(lockFile), false);
    handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-charlotte-qa', agent_id: 'q1', cwd: root }, deps());
    assert.strictEqual(JSON.parse(fs.readFileSync(lockFile, 'utf8')).source, 'subagent');
  });

  test('negative: db reset is blocked (exit 2) while the lock is live, message names the allowed path', () => {
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'subagent', agentId: 'q1' }));
    const r = handle(bash('cd apps/api && npx supabase db reset'), deps());
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /Allowed path: run the suite-start reset BEFORE spawning gsd-charlotte-qa/);
    assert.ok(r.stderr.includes(lockFile));
  });

  test('stale locks are ignored: expired or dead holder pid', () => {
    writeLock(buildLock({ pid: 4242, nowMs: NOW - 700000, ttlSec: 600, source: 'mcp' }));
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 0);
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'mcp' }));
    assert.strictEqual(handle(bash('supabase db reset'), deps({ isPidAlive: () => false })).exitCode, 0);
  });

  test('non-reset commands pass even with a live lock; resets pass with no lock', () => {
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'mcp' }));
    assert.strictEqual(handle(bash('supabase status'), deps()).exitCode, 0);
    fs.rmSync(lockFile);
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 0);
  });

  test('SubagentStop releases only the lock held by the stopping agent', () => {
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'subagent', agentId: 'other' }));
    handle({ hook_event_name: 'SubagentStop', agent_type: 'gsd-charlotte-qa', agent_id: 'q1', cwd: root }, deps());
    assert.strictEqual(fs.existsSync(lockFile), true);
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'subagent', agentId: 'q1' }));
    handle({ hook_event_name: 'SubagentStop', agent_type: 'gsd-charlotte-qa', agent_id: 'q1', cwd: root }, deps());
    assert.strictEqual(fs.existsSync(lockFile), false);
  });

  test('a corrupt lock file fails open', () => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, '{not json');
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 0);
  });
});

describe('hook process (spawned)', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-charlotte-lock-proc-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = input => spawnSync('node', [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });

  test('negative: live lock held by a running pid blocks a real reset command with exit 2', () => {
    fs.mkdirSync(path.join(root, '.tmp'));
    fs.writeFileSync(path.join(root, LOCK_REL), JSON.stringify(buildLock({ pid: process.pid, nowMs: Date.now(), ttlSec: 600, source: 'mcp' })));
    const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npx supabase db reset' }, cwd: root });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: database reset/);
  });

  test('malformed stdin fails open', () => {
    const r = run('not json');
    assert.strictEqual(r.status, 0);
    assert.match(r.stderr, /failing open/);
  });
});
