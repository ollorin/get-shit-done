'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gates = require('./owner-gates.js');

describe('owner-gates', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-og-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('request writes a durable pending record; a re-request is idempotent', () => {
    const a = gates.request(dir, { kind: 'composition', milestone: 'v1.1', summary: 'PRDs a,b', now: '2026-01-01T00:00:00Z' });
    assert.strictEqual(a.created, true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'OWNER-GATES.json'), 'utf-8'));
    assert.deepStrictEqual(onDisk.gates.map((g) => [g.id, g.status, g.requested_at]), [['composition@1.1', 'pending', '2026-01-01T00:00:00Z']]);
    const b = gates.request(dir, { kind: 'composition', milestone: '1.1', summary: 'changed', now: '2027-01-01T00:00:00Z' });
    assert.strictEqual(b.created, false);
    assert.strictEqual(b.gate.requested_at, '2026-01-01T00:00:00Z');
    assert.strictEqual(gates.readAll(dir).length, 1);
  });

  test('approve and reject record who and when; a decided gate cannot flip; a rejected gate can be re-requested', () => {
    gates.request(dir, { kind: 'roadmap', milestone: 'v1.1' });
    const ok = gates.decide(dir, { kind: 'roadmap', milestone: 'v1.1', status: 'approved', by: 'owner', note: 'ok', via: 'interactive', now: 'T' });
    assert.deepStrictEqual([ok.gate.status, ok.gate.approved_by, ok.gate.approved_at], ['approved', 'owner', 'T']);
    assert.strictEqual(gates.decide(dir, { kind: 'roadmap', milestone: 'v1.1', status: 'approved' }).changed, false);
    assert.strictEqual(gates.decide(dir, { kind: 'roadmap', milestone: 'v1.1', status: 'rejected' }).ok, false);
    gates.request(dir, { kind: 'pr', milestone: 'v1.1' });
    gates.decide(dir, { kind: 'pr', milestone: 'v1.1', status: 'rejected' });
    assert.strictEqual(gates.request(dir, { kind: 'pr', milestone: 'v1.1' }).created, true);
    assert.strictEqual(gates.find(gates.readAll(dir), 'pr', 'v1.1').status, 'pending');
  });

  test('unknown kind and deciding an unrequested gate fail', () => {
    assert.strictEqual(gates.request(dir, { kind: 'bogus' }).ok, false);
    assert.strictEqual(gates.decide(dir, { kind: 'pr', status: 'approved' }).ok, false);
  });

  test('startBlock: auto needs both gates approved; interactive only stops on a requested, unapproved gate; other milestones do not count', () => {
    assert.strictEqual(gates.startBlock(dir, { autoMode: false, milestone: 'v2' }), null);
    assert.strictEqual(gates.startBlock(dir, { autoMode: true, milestone: 'v2' }).status, 'not_requested');
    gates.request(dir, { kind: 'composition', milestone: 'v1' });
    gates.decide(dir, { kind: 'composition', milestone: 'v1', status: 'approved' });
    gates.request(dir, { kind: 'roadmap', milestone: 'v1' });
    assert.deepStrictEqual([gates.startBlock(dir, { autoMode: false, milestone: 'v1' }).kind, gates.startBlock(dir, { autoMode: false, milestone: 'v1' }).status], ['roadmap', 'pending']);
    gates.decide(dir, { kind: 'roadmap', milestone: 'v1', status: 'approved' });
    assert.strictEqual(gates.startBlock(dir, { autoMode: true, milestone: 'v1' }), null);
    assert.strictEqual(gates.startBlock(dir, { autoMode: true, milestone: 'v2' }).kind, 'composition');
  });

  test('a garbled file reads as no gates', () => {
    fs.mkdirSync(path.join(dir, '.planning'));
    fs.writeFileSync(path.join(dir, '.planning', 'OWNER-GATES.json'), '{nope');
    assert.deepStrictEqual(gates.readAll(dir), []);
  });
});

describe('revising an approved roadmap gate', () => {
  const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'og-revise-')); fs.mkdirSync(path.join(d, '.planning')); return d; };
  test('a request that changes the spike phases of an approved gate is refused without --revise', () => {
    const cwd = mk();
    gates.request(cwd, { kind: 'roadmap', milestone: '1.0', summary: 's' });
    gates.decide(cwd, { kind: 'roadmap', milestone: '1.0', status: 'approved', note: 'n', via: 'interactive' });
    const r = gates.request(cwd, { kind: 'roadmap', milestone: '1.0', spikePhases: '3', spikeRoots: 'spike/' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /--revise/);
    assert.strictEqual(gates.request(cwd, { kind: 'roadmap', milestone: '1.0' }).gate.status, 'approved');
  });
  test('--revise replaces the approved gate with a pending one that blocks until approved again', () => {
    const cwd = mk();
    gates.request(cwd, { kind: 'composition', milestone: '1.0', summary: 'c' });
    gates.decide(cwd, { kind: 'composition', milestone: '1.0', status: 'approved', note: 'n', via: 'interactive' });
    gates.request(cwd, { kind: 'roadmap', milestone: '1.0', summary: 's' });
    gates.decide(cwd, { kind: 'roadmap', milestone: '1.0', status: 'approved', note: 'n', via: 'interactive' });
    const r = gates.request(cwd, { kind: 'roadmap', milestone: '1.0', summary: 's2', spikePhases: '3', spikeRoots: 'spike/', revise: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.created, true);
    assert.strictEqual(r.gate.status, 'pending');
    assert.deepStrictEqual(r.gate.rigour.spike_phases, ['3']);
    assert.strictEqual(gates.startBlock(cwd, { autoMode: true, milestone: '1.0' }).kind, 'roadmap');
  });
  test('repeating an approved gate request unchanged stays a no-op', () => {
    const cwd = mk();
    gates.request(cwd, { kind: 'roadmap', milestone: '1.0', spikePhases: '3', spikeRoots: 'spike/' });
    gates.decide(cwd, { kind: 'roadmap', milestone: '1.0', status: 'approved', note: 'n', via: 'interactive' });
    const r = gates.request(cwd, { kind: 'roadmap', milestone: '1.0', spikePhases: '3', spikeRoots: 'spike/' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.created, false);
    assert.strictEqual(r.gate.status, 'approved');
  });
});
