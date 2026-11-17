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
  test('a lease with no event past the TTL is auto-closed at the next begin, at its last event, with a logged reason', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    const ev = events({ type: 'dispatch_begin', timestamp: iso(5) });
    const r = L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: ev, now: T0 + 500 * 60000, ttlMin: 120 });
    assert.ok(r.lease);
    assert.strictEqual(r.auto_closed.length, 1);
    assert.match(r.auto_closed[0].reason, /no event for 495 min/);
    assert.strictEqual(r.auto_closed[0].at, iso(5));
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
    write('.planning/dispatch-leases.json', JSON.stringify({ leases: [...L.load(dir), { id: 'z', role: 'reviewer', phase: '1', begin: iso(3000), end: null }] }));
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
  test('roadmap record --result completed on a phase not complete is a gap cycle, and complete is a usage error with no event', () => {
    const r = run(['roadmap', 'record', '--phase', '1', '--result', 'complete']);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /not a status/);
    const log = path.join(dir, '.planning', 'EXECUTION_LOG.md');
    assert.ok(!fs.existsSync(log) || !/phase_retry/.test(fs.readFileSync(log, 'utf8')));
  });
});
