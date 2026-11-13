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

describe('pilot fix D1/D2: dependency parking is recomputed from disk each call', () => {
  const stale = [
    { type: 'phase_parked', phase: '1', reason: 'gaps_after_closure_cycle' },
    { type: 'phase_parked', phase: '2', reason: 'dependency_parked' },
  ];
  test('a dependent parked by a since-completed dependency runs again without --retry-parked', () => {
    const r = nextOf(stale, ['1']);
    assert.strictEqual(r.action, 'spawn_coordinator');
    assert.strictEqual(r.phase, '2');
  });
  test('while the dependency is still parked the dependent stays blocked and the parking is logged once, not every call', () => {
    const first = nextOf([{ type: 'phase_parked', phase: '1', reason: 'x' }], ['3', '4']);
    assert.ok(first.log.some(e => e.type === 'phase_parked' && e.phase === '2'));
    const second = nextOf([{ type: 'phase_parked', phase: '1', reason: 'x' }, ...first.log], ['3', '4']);
    assert.deepStrictEqual(second.parked.sort(), ['1', '2']);
    assert.ok(!second.log.some(e => e.type === 'phase_parked'), 'no repeated dependency_parked event');
  });
  test('a phase parked for its own failure stays parked after its dependency completes', () => {
    const own = [{ type: 'phase_parked', phase: '2', reason: 'gaps_after_closure_cycle' }];
    const r = nextOf(own, ['1', '3', '4']);
    assert.strictEqual(r.action, 'done');
    assert.deepStrictEqual(r.parked, ['2']);
  });
  test('resumeState still lists current dependents of a parked phase as parked, and none once the dependency completed', () => {
    assert.deepStrictEqual(d.resumeState(stale, phases, truthOf()).parked.sort(), ['1', '2']);
    assert.deepStrictEqual(d.resumeState(stale, phases, truthOf('1')).parked, []);
  });
});

describe('pilot fix D1/D2: a dependency-parked phase is still reported incomplete by the pre-PR gate', () => {
  test('incompletePhases lists a phase that only has a dependency_parked event', () => {
    assert.deepStrictEqual(d.incompletePhases([{ type: 'phase_parked', phase: '4', reason: 'dependency_parked' }], () => false), ['4']);
  });
});

describe('CLI-6: a format gap never parks', () => {
  const FORM = { complete: false, errors: ['x'], work_errors: [], form_errors: ['01-01-SUMMARY.md: self_check: missing'] };
  const rec = (result, extra = {}, events = [], truth = { complete: false, errors: [], work_errors: ['Plan 01-01 has no commits'], form_errors: [] }) => d.record({ phase: '1', result, truth, events, ...extra });
  test('a format claim is debt only with zero missing work on disk and a form item; the items come from disk, not from the result', () => {
    const r = rec({ status: 'gaps_found', gap_kind: 'format', form_debt: ['invented'] }, {}, [], FORM);
    assert.deepStrictEqual([r.action, r.form_debt], ['continue_with_debt', FORM.form_errors]);
    assert.deepStrictEqual(r.events, [{ type: 'phase_form_debt', phase: '1', items: FORM.form_errors }]);
  });
  test('the same claim with missing work, or with no form item, is a product gap (gap_cycle first)', () => {
    assert.strictEqual(rec({ status: 'gaps_found', gap_kind: 'format' }).action, 'gap_cycle');
    assert.strictEqual(rec({ status: 'gaps_found', gap_kind: 'format' }, {}, [], { complete: false, errors: [], work_errors: [], form_errors: [] }).action, 'gap_cycle');
    assert.strictEqual(rec({ status: 'gaps_found', gap_kind: 'format' }, {}, [], { complete: false, errors: ['x'] }).action, 'gap_cycle');
  });
  test('blocked with reason form_gate is debt on form-only truth and a park otherwise; budget_exceeded parks and names the reason', () => {
    assert.strictEqual(rec({ status: 'blocked', reason: 'form_gate' }, {}, [], FORM).action, 'continue_with_debt');
    assert.strictEqual(rec({ status: 'blocked', reason: 'form_gate' }).action, 'park');
    const b = rec({ status: 'blocked', reason: 'budget_exceeded' });
    assert.deepStrictEqual([b.action, b.events[0].type, b.events[0].reason], ['park', 'phase_parked', 'budget_exceeded']);
  });
  test('product gap: first time gap_cycle; with gap_cycle_done parks directly', () => {
    assert.strictEqual(rec({ status: 'gaps_found' }).action, 'gap_cycle');
    assert.strictEqual(rec({ status: 'gaps_found', gap_kind: 'product' }).action, 'gap_cycle');
    const done = rec({ status: 'gaps_found', gap_cycle_done: true });
    assert.strictEqual(done.action, 'park');
    assert.ok(done.events.some((e) => e.type === 'phase_parked'));
  });
  test('a phase with form debt is done for its dependents; the next call returns them and lists the debt', () => {
    const events = [{ type: 'phase_start', phase: '1' }, { type: 'phase_form_debt', phase: '1', items: ['x'] }];
    const r = nextOf(events, []);
    assert.deepStrictEqual([r.action, r.phase], ['spawn_coordinator', '2']);
    const fin = nextOf(events, ['2', '3', '4'], { gateMarked: true, prRecorded: true });
    assert.deepStrictEqual([fin.complete, fin.form_debt], [true, [{ phase: '1', items: ['x'] }]]);
    assert.deepStrictEqual(d.incompletePhases(events, () => false), []);
  });
  test('a later failure cancels the debt', () => {
    const events = [{ type: 'phase_form_debt', phase: '1', items: [] }, { type: 'phase_parked', phase: '1', reason: 'x' }];
    assert.strictEqual(nextOf(events, ['3', '4']).action, 'done');
    assert.deepStrictEqual(nextOf(events, ['3', '4']).parked.sort(), ['1', '2']);
  });
});
