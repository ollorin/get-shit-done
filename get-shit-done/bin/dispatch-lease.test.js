'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./dispatch-lease.js');
const b = require('./phase-budget.js');

const TOOL = path.join(__dirname, 'gsd-tools.js');
const T0 = Date.parse('2026-01-01T00:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (args) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
const events = (...evs) => evs.map((e) => ({ phase: '1', ...e }));

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lease-')); write('.planning/ROADMAP.md', '# Roadmap\n\n### Phase 1: One\n**Goal**: g\n'); write('.planning/STATE.md', '# s\n'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('dispatch leases', () => {
  test('a second open executor lease is refused; other roles and other phases are not', () => {
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
    const bad = L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 60000 });
    assert.match(bad.error, /already has an open executor lease \(a\)/);
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r', events: [], now: T0 + 60000 }).lease);
    assert.ok(L.begin({ cwd: dir, phase: '2', role: 'executor', id: 'c', events: [], now: T0 + 60000 }).lease);
    assert.ok(L.end({ cwd: dir, id: 'a', events: [], now: T0 + 120000 }).lease);
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 180000 }).lease);
  });
  test('stale close counts to the last event, never to now; the reason is required', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    const ev = events({ type: 'phase_spend', timestamp: iso(10) });
    assert.match(L.end({ cwd: dir, id: 'a', stale: true, events: ev, now: T0 + 3000 * 60000 }).error, /--reason/);
    const r = L.end({ cwd: dir, id: 'a', stale: true, reason: 'session died', events: ev, now: T0 + 3000 * 60000 });
    assert.deepStrictEqual([r.lease.closed, r.lease.end], ['stale', iso(10)]);
    assert.strictEqual(L.spend(dir, ev, '1').wall_minutes_spent, 10);
  });
  test('a non-executor lease with no event past the TTL is auto-closed at the next begin, at its last event, with a logged reason', () => {
    L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'a', events: [], now: T0 });
    const ev = events({ type: 'dispatch_begin', timestamp: iso(5) });
    const r = L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'b', events: ev, now: T0 + 500 * 60000, ttlMin: 120 });
    assert.ok(r.lease);
    assert.strictEqual(r.auto_closed.length, 1);
    assert.match(r.auto_closed[0].reason, /no event for 495 min/);
    assert.strictEqual(r.auto_closed[0].at, iso(5));
  });
  test('a quiet executor lease is never closed by the TTL: a second executor stays refused until end or end --stale', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    const r = L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: events({ type: 'dispatch_begin', timestamp: iso(5) }), now: T0 + 500 * 60000, ttlMin: 120 });
    assert.match(r.error, /already has an open executor lease \(a\)/);
    assert.deepStrictEqual(r.auto_closed, []);
  });
  test('a corrupt lease file is renamed to .corrupt-<n>, never overwritten, and reported', () => {
    L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'a', events: [], now: T0 });
    const file = L.leasePath(dir);
    fs.writeFileSync(file, '{not json');
    const r = L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'b', events: [], now: T0 + 60000 });
    assert.ok(r.lease);
    assert.match(r.quarantined, /\.corrupt-1$/);
    assert.strictEqual(fs.readFileSync(`${file}.corrupt-1`, 'utf8'), '{not json');
    fs.writeFileSync(file, '[1');
    assert.match(L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'c', events: [], now: T0 + 120000 }).quarantined, /\.corrupt-2$/);
  });
  test('worktrees of one repo share one lease file (git common dir) and the working tree stays clean', () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i');
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lease-wt-'));
    fs.rmSync(wt, { recursive: true });
    assert.strictEqual(git(dir, 'worktree', 'add', '-q', wt, '-b', 'other').status, 0);
    try {
      assert.strictEqual(fs.realpathSync(path.dirname(L.leasePath(wt))), fs.realpathSync(path.dirname(L.leasePath(dir))));
      assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
      assert.match(L.begin({ cwd: wt, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 1000 }).error, /already has an open executor lease/);
      assert.strictEqual(git(dir, 'status', '--porcelain', '--', '.planning/dispatch-leases.json').stdout, '');
      assert.ok(!fs.existsSync(path.join(dir, '.planning', 'dispatch-leases.json')));
    } finally { fs.rmSync(wt, { recursive: true, force: true }); }
  });
  test('end --stale from another worktree measures to the lease\'s own last event, not to that worktree\'s empty log', () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i');
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lease-wt-'));
    fs.rmSync(wt, { recursive: true });
    assert.strictEqual(git(dir, 'worktree', 'add', '-q', wt, '-b', 'other').status, 0);
    try {
      L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
      const ev = events({ type: 'phase_spend', timestamp: iso(25) });
      L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r', events: ev, now: T0 + 30 * 60000 });
      const r = L.end({ cwd: wt, id: 'a', stale: true, reason: 'dead', events: [], now: T0 + 900 * 60000 });
      assert.strictEqual(r.lease.end, iso(25));
    } finally { fs.rmSync(wt, { recursive: true, force: true }); }
  });
  test('an old git that echoes an unknown rev-parse flag does not produce a garbage lease path; the lease lands in the real git dir', () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q');
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-fakegit-'));
    const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ncase "$*" in\n  *"rev-parse"*"--git-common-dir"*) for a in "$@"; do case "$a" in --path-format=*) echo "$a";; esac; done; echo .git; exit 0;;\nesac\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const saved = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${saved}`;
    try {
      const p = L.leasePath(dir);
      assert.strictEqual(fs.realpathSync(path.dirname(p)), fs.realpathSync(path.join(dir, '.git')));
      assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
    } finally { process.env.PATH = saved; fs.rmSync(bin, { recursive: true, force: true }); }
  });
  test('an unwritable git common dir falls back to .planning/ with a notice instead of failing begin', { skip: typeof process.getuid === 'function' && process.getuid() === 0 }, () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q');
    fs.chmodSync(path.join(dir, '.git'), 0o555);
    const errs = [];
    const orig = process.stderr.write;
    process.stderr.write = (c) => { errs.push(String(c)); return true; };
    try {
      assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
    } finally { process.stderr.write = orig; fs.chmodSync(path.join(dir, '.git'), 0o755); }
    assert.ok(fs.existsSync(path.join(dir, '.planning', 'dispatch-leases.json')));
    assert.match(errs.join(''), /not writable; leases kept in \.planning/);
  });
  test('a phase that adopts dispatch mid-phase carries its earlier budget spend minutes', () => {
    const pre = events({ type: 'phase_spend', timestamp: iso(0) }, { type: 'phase_spend', timestamp: iso(30) });
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: pre, now: T0 + 40 * 60000 });
    L.end({ cwd: dir, id: 'a', events: pre, now: T0 + 50 * 60000 });
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: pre });
    assert.deepStrictEqual([s.wall_minutes_spent, s.dispatches_spent, s.total_wall_minutes], [40, 3, 40]);
  });
  test('an open lease inside the TTL still blocks; a phase close event closes it at that event', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 60 * 60000 }).error);
    const r = L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: events({ type: 'phase_coordinator_death', timestamp: iso(30) }), now: T0 + 60 * 60000 });
    assert.strictEqual(r.auto_closed[0].at, iso(30));
    assert.ok(r.lease);
  });
  test('wall time is the sum of spans and a rate-limit pause adds nothing; phases without leases keep the legacy spend', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    L.end({ cwd: dir, id: 'a', events: [], now: T0 + 20 * 60000 });
    fs.writeFileSync(L.leasePath(dir), JSON.stringify({ leases: [...L.load(dir), { id: 'z', role: 'reviewer', phase: '1', begin: iso(3000), end: null }] }));
    const ev = events({ type: 'phase_spend', timestamp: iso(3000) }, { type: 'phase_spend', timestamp: iso(3015) });
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: ev });
    assert.deepStrictEqual([s.wall_minutes_spent, s.dispatches_spent], [35, 2]);
    const legacy = b.status({ cwd: dir, phase: '2', cls: 'standard', events: [{ type: 'phase_spend', phase: '2', timestamp: iso(0) }, { type: 'phase_spend', phase: '2', timestamp: iso(7) }] });
    assert.deepStrictEqual([legacy.wall_minutes_spent, legacy.dispatches_spent], [7, 2]);
  });
  test('phase_complete banks the leases and a later lease opens a new window', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    L.end({ cwd: dir, id: 'a', events: [], now: T0 + 20 * 60000 });
    const done = events({ type: 'phase_complete', timestamp: iso(25), wall_minutes_spent: 20, dispatches_spent: 1, budget_wall_minutes: 90, pct: 22.2 });
    assert.strictEqual(b.status({ cwd: dir, phase: '1', cls: 'standard', events: done }).final, true);
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: done, now: T0 + 40 * 60000 });
    const again = [...done, ...events({ type: 'dispatch_begin', timestamp: iso(40) }, { type: 'phase_spend', timestamp: iso(50) })];
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: again });
    assert.deepStrictEqual([s.final, s.wall_minutes_spent, s.total_wall_minutes], [undefined, 10, 30]);
  });
});

describe('dispatch CLI', () => {
  test('begin, refused second executor, stale end with reason; everything lands in the execution log', () => {
    assert.strictEqual(run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'a']).status, 0);
    const bad = run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'b']);
    assert.notStrictEqual(bad.status, 0);
    assert.match(bad.stderr, /already has an open executor lease/);
    assert.notStrictEqual(run(['dispatch', 'end', '--stale', 'a']).status, 0);
    assert.strictEqual(run(['dispatch', 'end', '--stale', 'a', '--reason', 'session died']).status, 0);
    assert.strictEqual(run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'b']).status, 0);
    const log = fs.readFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), 'utf8');
    assert.match(log, /"type":"dispatch_end"[^\n]*"stale":true[^\n]*session died/);
    assert.strictEqual((log.match(/"type":"dispatch_begin"/g) || []).length, 2);
  });
  test('roadmap record maps a bare status synonym on an incomplete phase to the real result; only "deferred" is rejected, naming the JSON form', () => {
    const log = path.join(dir, '.planning', 'EXECUTION_LOG.md');
    const r = run(['roadmap', 'record', '--phase', '1', '--result', 'complete']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /gap_cycle|incomplete|"action"/);
    assert.match(fs.readFileSync(log, 'utf8'), /phase_incomplete/);
    assert.ok(!/phase_complete/.test(fs.readFileSync(log, 'utf8')));
    const retry = run(['roadmap', 'record', '--phase', '1', '--result', 'retry']);
    assert.strictEqual(retry.status, 0, retry.stderr);
    const d = run(['roadmap', 'record', '--phase', '1', '--result', 'deferred']);
    assert.notStrictEqual(d.status, 0);
    assert.match(d.stderr, /completed_with_deferrals/);
  });
});

describe('workflow prose matches the lease rule', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'workflows', rel), 'utf8');
  test('execute-phase and plan-phase bracket spawns with dispatch begin|end; budget spend appears only as the legacy fallback', () => {
    for (const f of ['execute-phase.md', 'plan-phase.md']) {
      const t = read(f);
      assert.match(t, /dispatch begin --phase \{N\}/, f);
      assert.doesNotMatch(t, /Call `gsd-tools budget spend/, f);
    }
  });
  test('DFGATE-01 greps every phase, v2 included; only *-REVIEW.md is excluded (run on a fixture)', () => {
    const item = read('execute-phase.md').match(/<item id="DFGATE-01"[\s\S]*?<\/item>/);
    assert.ok(item, 'DFGATE-01 item present');
    assert.doesNotMatch(item[0], /skips this grep|Phases with no plan carrying/);
    const cmd = item[0].match(/<command>([\s\S]*?)<\/command>/)[1].replace('{phase_dir}', '9-x');
    write('.planning/phases/9-x/9-01-PLAN.md', '---\nformat: v2\n---\nplan\n');
    write('.planning/phases/9-x/9-REVIEW.md', '| F-1 | low | deferred to future phase | owner | x |\n');
    const clean = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(clean.stdout.trim(), 'NONE');
    write('.planning/phases/9-x/9-01-SUMMARY.md', 'tests to be added later\n');
    const hit = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' });
    assert.match(hit.stdout, /9-01-SUMMARY\.md:.*tests to be added later/);
    assert.doesNotMatch(hit.stdout, /REVIEW/);
  });
  test('execute-roadmap sends a bare synonym of completed through 5a/5b before roadmap record, and says what to do on deferred', () => {
    const t = read('execute-roadmap.md');
    const line = t.split('\n').find((l) => l.startsWith('- `completed`'));
    assert.ok(line, 'completed branch present');
    for (const w of ['done', 'ok', 'passed', 'complete']) assert.ok(line.includes(`\`${w}\``), w);
    assert.match(line, /run \*\*5a\*\* then \*\*5b\*\* first/);
    assert.match(line, /bare `deferred`[^.]*re-read the coordinator's JSON/);
  });
  test('rigour rule 7 states the executor TTL exemption and the shared lease file', () => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'references', 'rigour.md'), 'utf8');
    assert.match(t, /a non-executor lease with no event for `workflow\.dispatch\.ttl_minutes`/);
    assert.match(t, /an `executor` lease is closed only by `dispatch end`/);
    assert.match(t, /gsd-dispatch-leases\.json/);
  });
});
