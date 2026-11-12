/**
 * project-registry-lock.test.js — agnostic-M-02 registry lock stress (review round 4, R4)
 *
 * N forked processes allocate at once, behind a ready/go barrier, on a registry whose lock is a stale
 * owner with a dead pid. Every result is ok or the locked refusal; ok port_bases are distinct and at least
 * NEIGHBOUR_DISTANCE apart; the registry holds exactly the ok slugs; no lock, marker or temp file remains.
 * Imports only project-registry.js so it can run against the pre-fix tree (761e757).
 */

'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const MODULE = path.join(__dirname, 'project-registry.js');
const NEIGHBOUR_DISTANCE = 100;
const LOCKED = /locked by another project init/;
const tmpDirs = [];

const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

// One exited process serves every wave: its pid stays dead (ESRCH) for the run.
const DEAD_PID = spawnSync(process.execPath, ['-e', '']).pid;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, what) {
  const until = Date.now() + 20000;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

// Each worker writes ready-<slug>, polls for go, then runs allocate and prints its result as JSON.
const WORKER = `
const fs = require('fs');
const path = require('path');
const { allocate } = require(${JSON.stringify(MODULE)});
const [dir, barrier, slug, root] = process.argv.slice(1);
fs.writeFileSync(path.join(barrier, 'ready-' + slug), '');
while (!fs.existsSync(path.join(barrier, 'go'))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
process.stdout.write(JSON.stringify({ slug, ...allocate({ dir, slug, root }) }));
`;

function runWave(n) {
  const dir = mkTmp('gsd-registry-stress-');
  const barrier = mkTmp('gsd-registry-barrier-');
  const lock = path.join(dir, 'projects.lock');
  fs.writeFileSync(lock, JSON.stringify({ token: 'dead-owner', pid: DEAD_PID }));
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  const slugs = Array.from({ length: n }, (_, i) => `s${i}`);
  const children = slugs.map((slug) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', WORKER, dir, barrier, slug, `/r/${slug}`]);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`worker ${slug} exited ${code}: ${err}`));
      else resolve(JSON.parse(out));
    });
  }));
  return waitFor(() => slugs.every((s) => fs.existsSync(path.join(barrier, `ready-${s}`))), 'ready workers')
    .then(() => fs.writeFileSync(path.join(barrier, 'go'), ''))
    .then(() => Promise.all(children))
    .then((results) => ({ dir, results }));
}

function assertWave({ dir, results }) {
  for (const r of results) {
    assert.ok(r.ok === true || LOCKED.test(r.reason ?? ''), JSON.stringify(r));
  }
  const ok = results.filter((r) => r.ok === true);
  const ports = ok.map((r) => r.port_base);
  assert.strictEqual(new Set(ports).size, ports.length, `duplicate port_base in ${JSON.stringify(ok)}`);
  for (const a of ports) for (const b of ports) if (a !== b) assert.ok(Math.abs(a - b) >= NEIGHBOUR_DISTANCE, `${a} and ${b} are too close`);
  const registryFile = path.join(dir, 'projects.json');
  const projects = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')).projects : {};
  assert.deepStrictEqual(Object.keys(projects).sort(), ok.map((r) => r.slug).sort());
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ok.length > 0 ? ['projects.json'] : []);
}

test('R4 stress: 12 processes x 50 iterations on a pre-staled lock with a dead pid', async () => {
  for (let i = 0; i < 50; i += 1) {
    assertWave(await runWave(12));
  }
});

test('R4 stress: one run at 24 processes on a pre-staled lock with a dead pid', async () => {
  assertWave(await runWave(24));
});
