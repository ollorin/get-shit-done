'use strict';
// One end-to-end dry run of the roadmap state machine: real CLI, real git repo, a stub coordinator.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { makeProject, gsd, writeEvidence, completePhaseLikeWorkflow, events } = require('./helpers/roadmap-fixture.js');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

const PROMPT_ACTIONS = new Set(['ask', 'prompt', 'confirm', 'wait']);

// Stub coordinator: writes what the workflows would leave behind and returns the JSON the real one returns.
function runStub(dir, phase, script, calls) {
  calls.push(phase);
  const outcome = script[phase].shift();
  switch (outcome) {
    case 'pass':
      writeEvidence(dir, phase);
      completePhaseLikeWorkflow(dir, phase);
      return { status: 'completed' };
    case 'lie':
      writeEvidence(dir, phase, { verification: 'gaps_found' });
      gsd(dir, ['phase', 'checkpoint', phase, '--step', 'verify', '--status', 'gaps_found']);
      return { status: 'completed' };
    case 'human':
      return { status: 'human_needed' };
    default:
      throw new Error(`no scripted outcome for phase ${phase}`);
  }
}

// Drives `roadmap next` / `roadmap record` until done; `stopAfter` simulates the process being killed.
function drive(dir, script, calls, { stopAfter = Infinity, retryParked = false } = {}) {
  const actions = [];
  let spawned = 0;
  for (let i = 0; i < 40; i++) {
    const nx = gsd(dir, ['roadmap', 'next', ...(retryParked ? ['--retry-parked'] : [])]).json;
    actions.push(nx.action);
    if (nx.action === 'spawn_coordinator' || nx.action === 'gap_cycle') {
      if (spawned >= stopAfter) return { actions, killed: true };
      spawned += 1;
      const result = runStub(dir, nx.phase, script, calls);
      gsd(dir, ['roadmap', 'record', '--phase', nx.phase, '--result', JSON.stringify(result)]);
    } else if (nx.action === 'integration_gate') {
      gsd(dir, ['gate', 'pre-pr', '--mark-passed']);
    } else if (nx.action === 'pr') {
      assert.strictEqual(nx.has_remote, false);
      gsd(dir, ['roadmap', 'record', '--kind', 'pr', '--result', JSON.stringify({ status: 'skipped', reason: 'no_remote' })]);
    } else if (nx.action === 'done') {
      return { actions, done: nx };
    }
  }
  throw new Error(`dispatcher did not settle: ${actions.join(',')}`);
}

test('roadmap dry run: lying coordinator, parked phase, restart, retry, pr_skipped', () => {
  const dir = makeProject([
    { n: '1', name: 'one' },
    { n: '2', name: 'two', deps: 'Phase 1' },
    { n: '3', name: 'three' },
    { n: '4', name: 'four', deps: 'Phase 3' },
  ], { mode: 'yolo' });
  dirs.push(dir);
  const calls = [];
  const script = { 1: ['pass'], 2: ['lie', 'pass'], 3: ['human', 'pass'], 4: ['pass'] };

  // Run 1 is killed after phase 1; run 2 restarts and must not re-run it.
  const first = drive(dir, script, calls, { stopAfter: 1 });
  assert.strictEqual(first.killed, true);
  assert.deepStrictEqual(calls, ['1']);
  const second = drive(dir, script, calls);
  assert.deepStrictEqual(calls, ['1', '2', '2', '3'], 'restart skips 1; 2 runs, is not trusted on its lie, and gets exactly one gap cycle');

  const all = [...first.actions, ...second.actions];
  assert.ok(all.every(a => !PROMPT_ACTIONS.has(a)), `no prompt action: ${all.join(',')}`);
  assert.strictEqual(second.done.complete, false);
  assert.deepStrictEqual(second.done.parked.sort(), ['3', '4']);
  assert.deepStrictEqual(second.done.completed_phases.sort(), ['1', '2']);

  const ev = events(dir);
  const completes = ev.filter(e => e.type === 'phase_complete').map(e => e.phase);
  assert.deepStrictEqual(completes.sort(), ['1', '2'], 'one phase_complete per verified phase, none for the lie');
  assert.ok(ev.some(e => e.type === 'phase_incomplete' && e.phase === '2' && e.action === 'gap_cycle'));

  const gate = gsd(dir, ['gate', 'pre-pr']);
  assert.deepStrictEqual(gate.json.incomplete_phases.sort(), ['3', '4']);

  // 3 is answered and scripted to pass; the parked phases are retried.
  const third = drive(dir, script, calls, { retryParked: true });
  assert.deepStrictEqual(calls, ['1', '2', '2', '3', '3', '4']);
  assert.strictEqual(third.done.complete, true);
  assert.deepStrictEqual(third.actions.slice(-3), ['integration_gate', 'pr', 'done']);
  const finalEvents = events(dir);
  assert.ok(finalEvents.some(e => e.type === 'pr_skipped' && e.reason === 'no_remote'));
  assert.deepStrictEqual(finalEvents.filter(e => e.type === 'phase_complete').map(e => e.phase).sort(), ['1', '2', '3', '4']);
  assert.strictEqual(gsd(dir, ['gate', 'pre-pr']).json.cached, true);
});
