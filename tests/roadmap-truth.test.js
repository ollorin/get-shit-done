'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd, writeEvidence, completePhaseLikeWorkflow, events, git } = require('./helpers/roadmap-fixture.js');

const dirs = [];
const project = (phases, cfg) => { const d = makeProject(phases, cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const append = (dir, ev) => fs.appendFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), JSON.stringify(ev) + '\n');
const ROAD = [{ n: '1', name: 'one' }, { n: '2', name: 'two', deps: 'Phase 1' }, { n: '3', name: 'three' }];

describe('U2 init execute-roadmap fields', () => {
  test('no-config project gets the defaults', () => {
    const dir = project(ROAD, {});
    const r = gsd(dir, ['init', 'execute-roadmap']).json;
    assert.strictEqual(r.coordinator_model, 'sonnet');
    assert.strictEqual(r.ruling_model, 'opus');
    assert.strictEqual(r.ruling_model_fallback, 'opus');
    assert.strictEqual(r.utility_model, 'haiku');
    assert.strictEqual(r.reviewer_model, 'sonnet');
    assert.strictEqual(r.legacy, true);
    assert.strictEqual(r.milestone_version, 'v1.0');
    assert.strictEqual(r.milestone_slug, 'test-milestone');
    assert.strictEqual(r.base_branch, null);
    assert.strictEqual(r.auto_mode, false);
  });
  test('config overrides flow through', () => {
    const dir = project(ROAD, { ruling_model: 'fable', ruling_model_fallback: 'opus2', utility_model: 'u', reviewer_model: 'r', coordinator_model: 'c', git: { base_branch: 'trunk' } });
    const r = gsd(dir, ['init', 'execute-roadmap']).json;
    assert.deepStrictEqual([r.ruling_model, r.ruling_model_fallback, r.utility_model, r.reviewer_model, r.coordinator_model, r.base_branch], ['fable', 'opus2', 'u', 'r', 'c', 'trunk']);
  });
});

describe('U3 phaseTruth drives next_executable', () => {
  test('summaries = plans but no VERIFICATION is not complete; its dependent is blocked (B3 pin)', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1, { verification: null });
    const r = gsd(dir, ['init', 'execute-roadmap']).json;
    assert.ok(r.next_executable.includes('1'));
    assert.deepStrictEqual(r.blocked_phases.find(b => b.phase === '2').missing_deps, ['1']);
  });
  test('gaps_found is not complete', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1, { verification: 'gaps_found' });
    const r = gsd(dir, ['init', 'execute-roadmap']).json;
    assert.ok(r.next_executable.includes('1'));
    assert.ok(r.blocked_phases.some(b => b.phase === '2'));
  });
  test('passed + Self-Check + commits + checkbox is complete and unblocks the dependent', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1);
    assert.strictEqual(completePhaseLikeWorkflow(dir, 1).rc, 0);
    const r = gsd(dir, ['init', 'execute-roadmap']).json;
    assert.ok(!r.next_executable.includes('1'));
    assert.ok(r.next_executable.includes('2'));
  });
  test('passed evidence without the ROADMAP checkbox is not complete', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1);
    const r = gsd(dir, ['init', 'execute-roadmap']).json;
    assert.ok(r.next_executable.includes('1'));
  });
});

describe('U4 phase checkpoint', () => {
  test('writes the coordinator checkpoint shape', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1);
    const r = gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed', '--files', 'a.js,b.js']);
    assert.strictEqual(r.rc, 0);
    const cp = JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'phases', '01-p1', 'CHECKPOINT.json'), 'utf-8'));
    assert.deepStrictEqual(Object.keys(cp), ['phase', 'phase_name', 'last_step', 'step_status', 'timestamp', 'files_touched', 'key_context', 'resume_from']);
    assert.strictEqual(cp.phase, 1);
    assert.strictEqual(cp.last_step, 'verify');
    assert.strictEqual(cp.resume_from, 'done');
    assert.deepStrictEqual(cp.files_touched, ['a.js', 'b.js']);
  });
  test('rejects an unknown step and a missing phase', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1);
    assert.notStrictEqual(gsd(dir, ['phase', 'checkpoint', '1', '--step', 'nope', '--status', 'passed']).rc, 0);
    assert.notStrictEqual(gsd(dir, ['phase', 'checkpoint', '9', '--step', 'verify', '--status', 'passed']).rc, 0);
  });
  test('N1: phase complete succeeds after an execute-phase-only run, and still refuses without passed', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1);
    assert.notStrictEqual(gsd(dir, ['phase', 'complete', '1']).rc, 0, 'no CHECKPOINT.json yet');
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    assert.strictEqual(gsd(dir, ['phase', 'complete', '1']).rc, 0);
    writeEvidence(dir, 3, { verification: 'gaps_found' });
    gsd(dir, ['phase', 'checkpoint', '3', '--step', 'verify', '--status', 'gaps_found']);
    assert.notStrictEqual(gsd(dir, ['phase', 'complete', '3']).rc, 0);
  });
});

describe('U5 gate pre-pr set logic', () => {
  test('a phase started twice with one complete passes the count check', () => {
    const dir = project(ROAD);
    writeEvidence(dir, 1);
    completePhaseLikeWorkflow(dir, 1);
    append(dir, { type: 'phase_start', phase: '1' });
    append(dir, { type: 'phase_start', phase: '1' });
    append(dir, { type: 'phase_complete', phase: '1' });
    const r = gsd(dir, ['gate', 'pre-pr']);
    assert.strictEqual(r.json.error, undefined);
    assert.strictEqual(r.json.action_required, true);
  });
  test('started with no complete fails naming it', () => {
    const dir = project(ROAD);
    append(dir, { type: 'phase_start', phase: '3' });
    const r = gsd(dir, ['gate', 'pre-pr']);
    assert.deepStrictEqual(r.json.incomplete_phases, ['3']);
  });
  test('a phase_complete event without disk truth fails', () => {
    const dir = project(ROAD);
    append(dir, { type: 'phase_start', phase: '1' });
    append(dir, { type: 'phase_complete', phase: '1' });
    const r = gsd(dir, ['gate', 'pre-pr']);
    assert.deepStrictEqual(r.json.incomplete_phases, ['1']);
  });
  test('a parked phase blocks the gate', () => {
    const dir = project(ROAD);
    append(dir, { type: 'phase_parked', phase: '3' });
    assert.deepStrictEqual(gsd(dir, ['gate', 'pre-pr']).json.incomplete_phases, ['3']);
  });
});

describe('U6 resume_state', () => {
  test('decimal phases, out-of-order completion and a parked phase', () => {
    const dir = project([{ n: '1', name: 'one' }, { n: '1.1', name: 'ins', deps: 'Phase 1' }, { n: '2', name: 'two' }, { n: '3', name: 'three' }]);
    writeEvidence(dir, 2);
    completePhaseLikeWorkflow(dir, 2);
    append(dir, { type: 'phase_start', phase: '2' });
    append(dir, { type: 'phase_complete', phase: '2' });
    append(dir, { type: 'phase_start', phase: '1.1' });
    append(dir, { type: 'phase_parked', phase: '3' });
    const rs = gsd(dir, ['init', 'execute-roadmap']).json.resume_state;
    assert.deepStrictEqual(rs.completed_phases, ['2']);
    assert.deepStrictEqual(rs.started_incomplete, ['1.1']);
    assert.deepStrictEqual(rs.parked, ['3']);
  });
  test('a complete event with no disk truth is not completed', () => {
    const dir = project(ROAD);
    append(dir, { type: 'phase_start', phase: '1' });
    append(dir, { type: 'phase_complete', phase: '1' });
    const rs = gsd(dir, ['init', 'execute-roadmap']).json.resume_state;
    assert.deepStrictEqual(rs.completed_phases, []);
    assert.deepStrictEqual(rs.started_incomplete, ['1']);
  });
});

describe('U7 quota and doctor fallbacks', () => {
  test('no usage file: unmeasured, never sufficient:false', () => {
    const dir = project(ROAD);
    const r = gsd(dir, ['resilience', 'estimate-quota', '--phases', '500']).json;
    assert.strictEqual(r.unmeasured, true);
    assert.strictEqual(r.sufficient, true);
  });
  test('doctor with no manifest reports skipped', () => {
    const dir = project(ROAD);
    const home = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-home-'));
    dirs.push(home);
    const r = gsd(dir, ['doctor'], { HOME: home });
    assert.strictEqual(r.json.reason, 'no_manifest');
    assert.strictEqual(r.json.skipped, true);
  });
});
