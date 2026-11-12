'use strict';

// agnostic-M-09 R3: W1 worker candidates obey the same project-root / project_pattern scope as W2 and W3.
// Dry-run only (reap-stale.sh without --live sends no signal); every process matched carries a unique sentinel.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REAP = path.join(__dirname, '..', 'presets', 'base', 'scripts', 'reap-stale.sh');
const tmps = [];
const kids = [];
afterEach(() => {
  while (kids.length > 0) kids.pop().kill('SIGKILL');
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});
const mkTmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reap-'))); tmps.push(d); return d; };

function sweep(sentinel, cwd, { projectPattern } = {}) {
  const root = mkTmp();
  const audit = path.join(root, 'audit');
  const config = path.join(root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ stack: { host: { worker_patterns: [sentinel], ...(projectPattern ? { project_pattern: projectPattern } : {}) } } }));
  kids.push(spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)', sentinel], { cwd, stdio: 'ignore' }));
  const env = { ...process.env, STALE_REAPER_CONFIG: config, STALE_REAPER_AUDIT_DIR: audit, STALE_REAPER_PROJECT_ROOT: root, STALE_REAPER_MIN_AGE_SECONDS: '0', STALE_REAPER_CMD_FILTER: sentinel };
  const r = spawnSync('bash', [REAP, '--dry-run'], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const logs = fs.existsSync(audit) ? fs.readdirSync(audit).map((f) => fs.readFileSync(path.join(audit, f), 'utf8')).join('') : '';
  return { root, decisions: logs.split('\n').filter((l) => l.includes(sentinel)).map((l) => JSON.parse(l).decision) };
}

test('R3 a W1 candidate whose cwd is outside the project root is out_of_scope', () => {
  const r = sweep(`reap-sentinel-out-${process.pid}`, mkTmp());
  assert.deepStrictEqual([...new Set(r.decisions)], ['out_of_scope']);
});

test('R3 a W1 candidate with its cwd under the project root is in scope; project_pattern also admits it', () => {
  const sentinel = `reap-sentinel-in-${process.pid}`;
  const root = mkTmp();
  const inside = (() => {
    const config = path.join(root, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ stack: { host: { worker_patterns: [sentinel] } } }));
    kids.push(spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)', sentinel], { cwd: root, stdio: 'ignore' }));
    const env = { ...process.env, STALE_REAPER_CONFIG: config, STALE_REAPER_AUDIT_DIR: path.join(root, 'audit'), STALE_REAPER_PROJECT_ROOT: root, STALE_REAPER_MIN_AGE_SECONDS: '0', STALE_REAPER_CMD_FILTER: sentinel };
    assert.strictEqual(spawnSync('bash', [REAP, '--dry-run'], { env, encoding: 'utf8' }).status, 0);
    const dir = path.join(root, 'audit');
    return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('').split('\n').filter((l) => l.includes(sentinel)).map((l) => JSON.parse(l).decision);
  })();
  assert.ok(inside.length > 0 && !inside.includes('out_of_scope'), inside.join());
  const pat = sweep(`reap-sentinel-pat-${process.pid}`, mkTmp(), { projectPattern: `reap-sentinel-pat-${process.pid}` });
  assert.ok(pat.decisions.length > 0 && !pat.decisions.includes('out_of_scope'), pat.decisions.join());
});
