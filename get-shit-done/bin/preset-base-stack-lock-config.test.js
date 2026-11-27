'use strict';

// WP20: stack-lock takes its label from the cwd, its lock directory from stack.isolation.lock_dir, and records a lock_wait event.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const SCRIPTS = path.join(__dirname, '..', 'presets', 'base', 'scripts');
const LOCK_SH = path.join(SCRIPTS, 'stack-lock.sh');
const LOCK_MJS = path.join(SCRIPTS, 'stack-lock.mjs');

const tmps = [];
afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});
const mkTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lockcfg-'));
  tmps.push(d);
  return d;
};
const load = () => import(pathToFileURL(LOCK_MJS).href);
const exited = (child) => new Promise((resolve) => child.once('close', (code) => resolve(code)));

test('label defaults to the cwd basename; an explicit label wins', async () => {
  const m = await load();
  assert.strictEqual(m.parseArgs(['--', 'true']).value.label, path.basename(process.cwd()));
  assert.strictEqual(m.parseArgs(['--label', 'x', '--', 'true']).value.label, 'x');
});

test('lockDir places the lock file and owner file; --lock-file and --owner-file still win', async () => {
  const m = await load();
  const dir = mkTmp();
  const fromDir = m.parseArgs(['--', 'true'], dir).value;
  assert.strictEqual(fromDir.lockFile, path.join(dir, 'stack.lock'));
  assert.strictEqual(fromDir.ownerFile, path.join(dir, 'owner.txt'));
  const explicit = m.parseArgs(['--lock-file', '/l', '--owner-file', '/o', '--', 'true'], dir).value;
  assert.strictEqual(explicit.lockFile, '/l');
  assert.strictEqual(explicit.ownerFile, '/o');
});

test('lockDirFromConfig reads stack.isolation.lock_dir; absent, unreadable or non-string is undefined', async () => {
  const m = await load();
  const root = mkTmp();
  assert.strictEqual(m.lockDirFromConfig(root), undefined);
  fs.mkdirSync(path.join(root, '.planning'));
  const cfg = path.join(root, '.planning', 'config.json');
  fs.writeFileSync(cfg, '{not json');
  assert.strictEqual(m.lockDirFromConfig(root), undefined);
  fs.writeFileSync(cfg, JSON.stringify({ stack: { isolation: { lock_dir: 7 } } }));
  assert.strictEqual(m.lockDirFromConfig(root), undefined);
  fs.writeFileSync(cfg, JSON.stringify({ stack: { isolation: { lock_dir: '.tmp/stack.lock.d' } } }));
  assert.strictEqual(m.lockDirFromConfig(root), path.join(root, '.tmp', 'stack.lock.d'));
});

test('lockWaitRecord is null for an immediate acquire and an event for a real wait', async () => {
  const m = await load();
  assert.strictEqual(m.lockWaitRecord('l', 0, 't'), null);
  assert.deepStrictEqual(m.lockWaitRecord('l', 450, 't'), { event: 'lock_wait', label: 'l', waited_ms: 450, at: 't' });
});

test('a waiter appends one lock_wait line next to the lock file; the holder appends none', async () => {
  const dir = mkTmp();
  const lock = path.join(dir, 'lock');
  const owner = path.join(dir, 'owner.txt');
  const run = (label, cmd) =>
    spawn('sh', [LOCK_SH, '--label', label, '--timeout', '20', '--lock-file', lock, '--owner-file', owner, '--', ...cmd], { stdio: 'ignore' });
  const holder = run('holder', ['sleep', '1']);
  await new Promise((r) => setTimeout(r, 300));
  const holderCode = exited(holder);
  const waiter = run('waiter', ['true']);
  assert.strictEqual(await exited(waiter), 0);
  assert.strictEqual(await holderCode, 0);
  const lines = fs.readFileSync(path.join(dir, 'lock-wait.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].event, 'lock_wait');
  assert.strictEqual(lines[0].label, 'waiter');
  assert.ok(lines[0].waited_ms >= 200, String(lines[0].waited_ms));
});
