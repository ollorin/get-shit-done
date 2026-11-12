'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const d = require('./roadmap-dispatch.js');

const phases = [
  { number: '1', name: 'one', depends_on: 'None' },
  { number: '2', name: 'two', depends_on: 'Phase 1' },
  { number: '3', name: 'three', depends_on: 'None' },
  { number: '4', name: 'four', depends_on: 'Phase 3' },
];
const truthOf = (...done) => (k) => done.includes(k);
const nextOf = (events, done, extra = {}) => d.next({ phases, events, truth: truthOf(...done), config: { coordinator_model: 'sonnet' }, ...extra });

describe('parseDeps', () => {
  test('free text, lists, None and padded ids', () => {
    assert.deepStrictEqual(d.parseDeps('Phase 1, Phase 2.1'), ['1', '2.1']);
    assert.deepStrictEqual(d.parseDeps('None'), []);
    assert.deepStrictEqual(d.parseDeps(null), []);
    assert.deepStrictEqual(d.parseDeps('01'), ['1']);
  });
});

describe('next', () => {
  test('fresh run spawns the first executable phase and logs phase_start', () => {
    const r = nextOf([], []);
    assert.strictEqual(r.action, 'spawn_coordinator');
    assert.strictEqual(r.phase, '1');
    assert.strictEqual(r.args, '1 --auto');
    assert.strictEqual(r.model, 'sonnet');
    assert.deepStrictEqual(r.log.map(e => e.type), ['phase_start']);
  });
  test('legacy is forwarded; never emits a prompt action', () => {
    assert.strictEqual(nextOf([], [], { config: { legacy: true } }).args, '1 --auto --legacy');
  });
  test('dependents wait on disk truth, not on the log', () => {
    const events = [{ type: 'phase_start', phase: '1' }, { type: 'phase_complete', phase: '1' }];
    assert.strictEqual(nextOf(events, []).phase, '1', 'event without truth re-runs the phase');
    assert.strictEqual(nextOf(events, ['1']).phase, '2');
  });
  test('gap_pending returns one gap_cycle, logged', () => {
    const events = [{ type: 'phase_start', phase: '2' }, { type: 'phase_incomplete', phase: '2', action: 'gap_cycle' }];
    const r = nextOf(events, ['1']);
    assert.strictEqual(r.action, 'gap_cycle');
    assert.strictEqual(r.args, '2 --gaps --auto');
    assert.deepStrictEqual(r.log.map(e => e.type), ['gap_cycle']);
  });
  test('parked phase parks its dependents only; independent phases continue', () => {
    const events = [{ type: 'phase_parked', phase: '1' }];
    const r = nextOf(events, []);
    assert.strictEqual(r.phase, '3');
    const r2 = nextOf([...events, { type: 'phase_complete', phase: '3' }, { type: 'phase_complete', phase: '4' }], ['3', '4']);
    assert.strictEqual(r2.action, 'done');
    assert.strictEqual(r2.complete, false);
    assert.deepStrictEqual(r2.parked.sort(), ['1', '2']);
    assert.ok(r2.log.some(e => e.type === 'phase_parked' && e.phase === '2'));
  });
  test('retryParked re-opens parked phases', () => {
    assert.strictEqual(nextOf([{ type: 'phase_parked', phase: '1' }], [], { retryParked: true }).phase, '1');
  });
  test('all complete: integration_gate, then pr, then done', () => {
    const all = ['1', '2', '3', '4'];
    assert.strictEqual(nextOf([], all).action, 'integration_gate');
    const pr = nextOf([{ type: 'gate_pre_pr_passed' }], all, { gateMarked: true, hasRemote: false });
    assert.strictEqual(pr.action, 'pr');
    assert.strictEqual(pr.has_remote, false);
    const fin = nextOf([], all, { gateMarked: true, prRecorded: true });
    assert.deepStrictEqual([fin.action, fin.complete], ['done', true]);
  });
});

describe('record', () => {
  const rec = (result, truth, events = [], ladder) => d.record({ phase: '2', result, truth, events, ladder });
  test('completed with disk truth logs phase_complete', () => {
    const r = rec({ status: 'completed' }, { complete: true, errors: [] });
    assert.strictEqual(r.action, 'complete');
    assert.strictEqual(r.events[0].type, 'phase_complete');
  });
  test('completed without truth: one gap cycle, then park', () => {
    const lie = { status: 'completed' };
    const first = rec(lie, { complete: false, errors: ['x'] });
    assert.strictEqual(first.action, 'gap_cycle');
    assert.ok(!first.events.some(e => e.type === 'phase_complete'));
    const second = rec(lie, { complete: false, errors: ['x'] }, [{ type: 'gap_cycle', phase: '2' }]);
    assert.strictEqual(second.action, 'park');
    assert.ok(second.events.some(e => e.type === 'phase_parked'));
  });
  test('gaps_found follows the same one-cycle rule', () => {
    assert.strictEqual(rec({ status: 'gaps_found' }, { complete: false, errors: [] }).action, 'gap_cycle');
  });
  test('human_needed and blocked park', () => {
    for (const status of ['human_needed', 'blocked']) {
      const r = rec({ status }, { complete: false, errors: [] });
      assert.strictEqual(r.action, 'park');
      assert.strictEqual(r.events[0].type, 'phase_parked');
    }
  });
  test('completed_with_deferrals asks for a deferred respawn and logs nothing', () => {
    const r = rec({ status: 'completed_with_deferrals', deferred: ['execute'] }, { complete: false, errors: [] });
    assert.deepStrictEqual([r.action, r.deferred, r.events], ['spawn_deferred', ['execute'], []]);
  });
  test('failed walks the ladder: retry, debug, then fail', () => {
    const ladder = (action) => () => ({ action, attempts: 1 });
    assert.strictEqual(rec({ status: 'failed', error: 'e' }, {}, [], ladder('retry')).action, 'retry');
    assert.strictEqual(rec({ status: 'failed', error: 'e' }, {}, [], ladder('debug')).action, 'debug');
    const esc = rec({ status: 'failed', error: 'e' }, {}, [], ladder('escalate'));
    assert.strictEqual(esc.action, 'fail');
    assert.strictEqual(esc.events[0].type, 'phase_failed');
  });
  test('death text respawns without touching the failure ladder', () => {
    let called = false;
    const r = rec('You have hit your limit, resets at 5pm', {}, [], () => { called = true; return { action: 'retry' }; });
    assert.strictEqual(r.action, 'respawn_death');
    assert.strictEqual(called, false);
  });
  test('unparseable non-death text is a failure', () => {
    assert.strictEqual(rec('gibberish', {}, [], () => ({ action: 'escalate' })).action, 'fail');
  });
});

describe('incompletePhases', () => {
  test('names started/parked phases without truth, ignores duplicates of a completed one', () => {
    const events = [{ type: 'phase_start', phase: '1' }, { type: 'phase_start', phase: '1' }, { type: 'phase_complete', phase: '1' }, { type: 'phase_parked', phase: '3' }];
    assert.deepStrictEqual(d.incompletePhases(events, (k) => k === '1'), ['3']);
  });
});

describe('next with owner gates', () => {
  test('a pending start gate starts nothing and logs nothing; the status is distinct from blocked and done', () => {
    const r = nextOf([], [], { ownerGate: { blocked_by: 'composition', status: 'pending' } });
    assert.deepStrictEqual([r.action, r.status, r.blocked_by_owner_gate, r.gate_status, r.log], ['waiting_owner_approval', 'waiting_owner_approval', 'composition', 'pending', []]);
    assert.strictEqual(r.complete, undefined);
  });
  test('after the PR is requested the run waits on the pr gate; once approved it is done', () => {
    const all = ['1', '2', '3', '4'];
    const base = { gateMarked: true, prRecorded: true };
    const waiting = nextOf([], all, { ...base, ownerGate: { blocked_by: 'pr', status: 'pending', pr_waiting: true } });
    assert.deepStrictEqual([waiting.action, waiting.blocked_by_owner_gate], ['waiting_owner_approval', 'pr']);
    const done = nextOf([], all, { ...base, ownerGate: { blocked_by: null, pr_waiting: false } });
    assert.deepStrictEqual([done.action, done.complete], ['done', true]);
  });
});
