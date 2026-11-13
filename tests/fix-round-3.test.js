'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeProject, gsd, git, phaseDir, events, writeEvidence, completePhaseLikeWorkflow, TOOLS } = require('./helpers/roadmap-fixture.js');

// JSON-mode runner (the shared helper always passes --raw, which prints bare words for some commands).
const gsdJ = (dir, args, env = {}) => {
  const run = (out, rc, err = '') => { let json = null; try { json = JSON.parse(out); } catch { /* text */ } return { rc, out, err, json }; };
  try { return run(execFileSync('node', [TOOLS, ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GSD_LEGACY: '1', GSD_AUTONOMOUS: '', ...env } }), 0); } catch (e) { return run((e.stdout || '').toString(), e.status ?? 1, (e.stderr || '').toString()); }
};

const FIX = path.join(__dirname, 'fixtures', 'casino-mall');
const dirs = [];
const project = (phases = [{ n: '1', name: 'one' }], config = {}) => { const d = makeProject(phases, config); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const fixture = (dir, name, as) => write(dir, `.planning/${as}`, fs.readFileSync(path.join(FIX, name), 'utf8'));
const plans = (dir, n, plansN, summariesN) => {
  const pd = phaseDir(dir, n);
  const p = String(n).padStart(2, '0');
  for (let i = 1; i <= plansN; i++) {
    write(dir, path.relative(dir, path.join(pd, `${p}-0${i}-PLAN.md`)), `---\nphase: ${p}\nplan: 0${i}\n---\n# p\n`);
    if (i <= summariesN) write(dir, path.relative(dir, path.join(pd, `${p}-0${i}-SUMMARY.md`)), '# S\n\n## Self-Check: PASSED\n');
  }
  return pd;
};

describe('item 6: state and roadmap commands on the shapes this fork and its bench produce', () => {
  test('advance-plan on the "Plan: Not started" line that `phase complete` itself writes counts from disk', () => {
    const dir = project([{ n: '3', name: 'three' }, { n: '4', name: 'four' }]);
    fixture(dir, 'STATE.after-phase-3.md', 'STATE.md');
    plans(dir, 4, 2, 1);
    const r = gsdJ(dir, ['state', 'advance-plan']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    assert.deepStrictEqual([r.json.advanced, r.json.current_plan, r.json.total_plans], [true, 2, 2]);
    assert.match(read(dir, '.planning/STATE.md'), /^Plan: 2 of 2/m);
  });
  test('advance-plan with every plan summarised reports the last plan and writes a parseable line', () => {
    const dir = project([{ n: '4', name: 'four' }]);
    fixture(dir, 'STATE.head.md', 'STATE.md');
    plans(dir, 4, 1, 1);
    const r = gsdJ(dir, ['state', 'advance-plan']);
    assert.deepStrictEqual([r.rc, r.json.advanced, r.json.reason], [0, false, 'last_plan']);
    assert.match(read(dir, '.planning/STATE.md'), /^Plan: 1 of 1/m);
  });
  test('--phase overrides a stale Phase line when counting from disk', () => {
    const dir = project([{ n: '3', name: 'three' }]);
    fixture(dir, 'STATE.mid-phase-3.md', 'STATE.md');
    plans(dir, 3, 2, 1);
    const r = gsdJ(dir, ['state', 'advance-plan', '--phase', '3']);
    assert.deepStrictEqual([r.rc, r.json.advanced, r.json.current_plan, r.json.total_plans], [0, true, 2, 2]);
  });
  test('an unparseable Plan line fails loudly: nonzero exit, the line is quoted', () => {
    const dir = project();
    write(dir, '.planning/STATE.md', '# S\n\nPhase: 1 of 1\nPlan: soon-ish\nStatus: x\n');
    const r = gsdJ(dir, ['state', 'advance-plan']);
    assert.notStrictEqual(r.rc, 0);
    assert.match(r.out + r.err, /Plan: soon-ish/);
  });
  test('record-metric on a Performance Metrics section without a table creates the table and counts the plan', () => {
    const dir = project();
    fixture(dir, 'STATE.head.md', 'STATE.md');
    const r = gsdJ(dir, ['state', 'record-metric', '--phase', '4', '--plan', '01', '--duration', '5min', '--tasks', '3', '--files', '4']);
    assert.deepStrictEqual([r.rc, r.json.recorded], [0, true]);
    const s = read(dir, '.planning/STATE.md');
    assert.match(s, /\| Phase 4 P01 \| 5min \| 3 tasks \| 4 files \|/);
    assert.match(s, /Total plans completed: 1/);
    assert.match(s, /## Accumulated Context/);
  });
  test('record-metric with no Performance Metrics section at all appends one; it never answers false silently', () => {
    const dir = project();
    write(dir, '.planning/STATE.md', '# S\n\nPhase: 1 of 1\n');
    const r = gsdJ(dir, ['state', 'record-metric', '--phase', '1', '--plan', '01', '--duration', '2min']);
    assert.deepStrictEqual([r.rc, r.json.recorded], [0, true]);
    assert.match(read(dir, '.planning/STATE.md'), /## Performance Metrics[\s\S]*\| Phase 1 P01 \| 2min \|/);
  });
  test('update-plan-progress keeps a verification score in the status cell and still updates the Plans cell', () => {
    const dir = project([{ n: '1', name: 'one' }]);
    fixture(dir, 'ROADMAP.head.md', 'ROADMAP.md');
    plans(dir, 1, 5, 5);
    const r = gsd(dir, ['roadmap', 'update-plan-progress', '1']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    const row = read(dir, '.planning/ROADMAP.md').split('\n').find((l) => l.startsWith('| 1. Local base'));
    assert.match(row, /\| 5\/5 \|/);
    assert.match(row, /gaps_found 22\/24/);
  });
  test('phase complete does not stack "Complete" on an "Executed" status cell', () => {
    const dir = project([{ n: '1', name: 'one' }]);
    const rm = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(rm, `${fs.readFileSync(rm, 'utf8')}\n## Progress\n\n| Phase | Milestone | Plans Complete | Status | Completed |\n|---|---|---|---|---|\n| 1. one | v1.0 | 1/1 | Executed (1/1 plans) | - |\n`);
    writeEvidence(dir, 1);
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    const r = gsd(dir, ['phase', 'complete', '1']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    const row = read(dir, '.planning/ROADMAP.md').split('\n').find((l) => l.startsWith('| 1. one'));
    assert.doesNotMatch(row, /Complete Executed/);
    assert.match(row, /\| Complete \(1\/1 plans\)/);
  });
});

const spikeProject = ({ planExtra = '' } = {}) => {
  const dir = project();
  const rm = path.join(dir, '.planning', 'ROADMAP.md');
  fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', '**Rigour**: spike (OG2)\n**Spike roots**: spike/\n**Depends on:** None'));
  write(dir, '.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
  const pd = phaseDir(dir, 1);
  write(dir, '.planning/phases/01-p1/01-01-PLAN.md', `---\nphase: 01\nplan: 01\nplan_stamp: abc\nfiles_modified:\n  - .planning/phases/01-p1/captures/a.txt\n${planExtra}---\n# Plan\n<tasks>\n<task type="auto" tdd="true"><model>sonnet</model>x</task>\n</tasks>\n`);
  write(dir, '.planning/phases/01-p1/01-01-SUMMARY.md', '# S\n\nauth flow probe.\n\n## Self-Check: PASSED\n');
  write(dir, '.planning/phases/01-p1/01-VERIFICATION.md', '---\nstatus: passed\nopen_critical_high: 0\n---\n# V\n');
  write(dir, '.planning/phases/01-p1/SPIKE-RESULT.md', '# R\n\n| Question | Answer | Capture | Probe | Root cause or search |\n|---|---|---|---|---|\n| Q0 base | yes | | | |\n');
  write(dir, 'spike/src/pages/probe.tsx', 'export default 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(01-01): spike probe');
  return { dir, pd };
};
const standardTwin = () => {
  const { dir } = spikeProject();
  fs.rmSync(path.join(dir, '.planning', 'OWNER-GATES.json'));
  return dir;
};

describe('items 1 and 3: spike phases and the pre-verify gates', () => {
  test('at spike the test, docs, UI-QA and E2E checks are not_applicable and the review file is not required', () => {
    const { dir } = spikeProject();
    const r = gsd(dir, ['verify', 'phase-gate', '1']);
    assert.strictEqual(r.rc, 0, r.out);
    assert.deepStrictEqual([r.json.passed, r.json.failures], [true, []]);
    const byType = Object.fromEntries(r.json.checks.map((c) => [c.type, c]));
    for (const t of ['test', 'ui_qa', 'docs', 'e2e_plan']) assert.strictEqual(byType[t].not_applicable, true, t);
    assert.match(byType.docs.detail, /spike/);
  });
  test('the same phase at standard fails on each of them and on the missing review file', () => {
    const dir = standardTwin();
    const r = gsd(dir, ['verify', 'phase-gate', '1']);
    assert.strictEqual(r.rc, 1);
    for (const f of ['missing_test', 'missing_docs', 'missing_charlotte_qa', 'missing_e2e_plan', 'missing_evidence']) assert.ok(r.json.failures.includes(f), f);
    assert.ok(r.json.work_errors.some((e) => /REVIEW/.test(e)));
  });
  test('a spike phase still needs a passed VERIFICATION: it is the review record', () => {
    const { dir, pd } = spikeProject();
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: gaps_found\n---\n# V\n');
    const r = gsd(dir, ['verify', 'phase-gate', '1']);
    assert.strictEqual(r.rc, 1);
    assert.ok(r.json.work_errors.some((e) => /VERIFICATION/.test(e)));
  });
  test('phase complete at spike needs no review file', () => {
    const { dir } = spikeProject();
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    const r = gsd(dir, ['phase', 'complete', '1']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
  });
  test('the spike dispatch budget is 10 and wall stays 45', () => {
    const { dir } = spikeProject();
    const b = gsd(dir, ['budget', 'status', '--phase', '1']).json;
    assert.deepStrictEqual([b.budget_class, b.budget_wall_minutes, b.budget_dispatches], ['spike', 45, 10]);
  });
});

describe('item 4: evidence_only_plan does not apply at spike', () => {
  test('an evidence-only plan passes at spike and still fails at standard', () => {
    const { dir } = spikeProject();
    fs.rmSync(path.join(dir, '.planning', 'phases', '01-p1', '01-01-SUMMARY.md'));
    const s = gsd(dir, ['verify', 'form', '1', '--plans-only']);
    assert.deepStrictEqual([s.rc, s.json.errors.map((e) => e.check)], [0, []]);
  });
  test('standard keeps the check', () => {
    const { dir } = spikeProject();
    fs.rmSync(path.join(dir, '.planning', 'OWNER-GATES.json'));
    fs.rmSync(path.join(dir, '.planning', 'phases', '01-p1', '01-01-SUMMARY.md'));
    const s = gsd(dir, ['verify', 'form', '1', '--plans-only']);
    assert.deepStrictEqual(s.json.errors.map((e) => e.check), ['evidence_only_plan']);
  });
});

describe('item 7: the final spend survives phase completion', () => {
  const completed = () => {
    const dir = project();
    writeEvidence(dir, 1);
    for (let i = 0; i < 3; i++) gsd(dir, ['budget', 'spend', '--phase', '1', '--step', `s${i}`]);
    completePhaseLikeWorkflow(dir, 1);
    const rec = gsd(dir, ['roadmap', 'record', '--phase', '1', '--result', '{"status":"completed"}']);
    return { dir, rec };
  };
  test('the phase_complete event carries wall, dispatches, budget and breach', () => {
    const { dir, rec } = completed();
    assert.strictEqual(rec.json.action, 'complete', rec.out);
    const ev = events(dir).filter((e) => e.type === 'phase_complete').pop();
    assert.strictEqual(ev.dispatches_spent, 3);
    assert.strictEqual(typeof ev.wall_minutes_spent, 'number');
    assert.deepStrictEqual([ev.budget_dispatches, ev.budget_wall_minutes, ev.breach], [37, 90, false]);
  });
  test('budget status --phase on a completed phase returns the recorded spend, not zero', () => {
    const { dir } = completed();
    const b = gsd(dir, ['budget', 'status', '--phase', '1']).json;
    assert.deepStrictEqual([b.dispatches_spent, b.budget_dispatches, b.breach, b.final], [3, 37, false, true]);
  });
  test('a breach is recorded as such', () => {
    const dir = project();
    writeEvidence(dir, 1);
    write(dir, '.planning/config.json', JSON.stringify({ workflow: { budget: { standard: { dispatches: 2 } } } }));
    for (let i = 0; i < 3; i++) gsd(dir, ['budget', 'spend', '--phase', '1']);
    completePhaseLikeWorkflow(dir, 1);
    gsd(dir, ['roadmap', 'record', '--phase', '1', '--result', '{"status":"completed"}']);
    const b = gsd(dir, ['budget', 'status', '--phase', '1']).json;
    assert.deepStrictEqual([b.dispatches_spent, b.budget_dispatches, b.breach], [3, 2, true]);
  });
  test('a new window after completion (a retry) counts from zero again', () => {
    const { dir } = completed();
    gsd(dir, ['budget', 'spend', '--phase', '1']);
    const b = gsd(dir, ['budget', 'status', '--phase', '1']).json;
    assert.strictEqual(b.dispatches_spent, 1);
    assert.notStrictEqual(b.final, true);
  });
});

describe('item 9: an estimate of zero tokens is unmeasured', () => {
  test('observed_history with no token ledger is unmeasured, never "sufficient by evidence"', () => {
    const dir = project();
    write(dir, '.planning/EXECUTION_LOG.md', '{"timestamp":"2026-01-01T00:00:00.000Z","type":"phase_complete","phase":"1"}\n');
    const r = gsd(dir, ['resilience', 'estimate-quota', '--phases', '2']);
    assert.strictEqual(r.json.estimated_tokens, 0, r.out);
    assert.deepStrictEqual([r.json.source, r.json.unmeasured], ['observed_history', true]);
  });
});

describe('item 8: run-state files do not fail git-status-clean', () => {
  const { deriveCheckSet } = require('../get-shit-done/bin/pre-pr-checks.js');
  const statusClean = (dir) => {
    const check = deriveCheckSet(dir).checks.find((c) => c.id === 'git-status-clean');
    try { execFileSync('sh', ['-c', check.command], { cwd: dir, stdio: 'pipe' }); return true; } catch { return false; }
  };
  test("the run's own EXECUTION_LOG and CHECKPOINT files are ignored; any other change still fails", () => {
    const dir = project();
    write(dir, '.planning/EXECUTION_LOG.md', '{"type":"x"}\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'log');
    assert.strictEqual(statusClean(dir), true);
    fs.appendFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), '{"type":"y"}\n');
    write(dir, '.planning/phases/01-p1/CHECKPOINT.json', '{}');
    write(dir, '.planning/phases/01-p1/TASK-CHECKPOINT.json', '{}');
    assert.strictEqual(statusClean(dir), true);
    write(dir, '.planning/phases/01-p1/01-01-SUMMARY.md', 'x');
    assert.strictEqual(statusClean(dir), false);
  });
  test('the committed config and the built-in fallback carry the same command', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'get-shit-done', 'config', 'pre-pr-checks.json'), 'utf8'));
    const src = fs.readFileSync(path.join(__dirname, '..', 'get-shit-done', 'bin', 'pre-pr-checks.js'), 'utf8');
    const cmd = cfg.unknown.checks.find((c) => c.id === 'git-status-clean').command;
    assert.ok(src.includes(cmd.replace(/'/g, "\\'")), 'DEFAULT_CHECKS must match config');
  });
});

describe('items 12, 14, 15: spike answer table, review record in VERIFICATION, stale captures, status agreement', () => {
  const TABLE = (rows) => `\n| Question | Answer | Capture | Probe | Root cause or search |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
  const addTable = (pd, rows, file = 'SPIKE-RESULT.md') => fs.writeFileSync(path.join(pd, file), `# R\n${TABLE(rows)}`);
  const gate = (dir) => gsd(dir, ['verify', 'phase-gate', '1']);
  test('a "no" without a root-cause or search capture is a WORK error; "inconclusive" and "yes" need none', () => {
    const { dir, pd } = spikeProject();
    addTable(pd, ['| Q1 admin on workerd | no | `captures/a.txt` | | |', '| Q2 other | inconclusive | `captures/b.txt` | | |', '| Q3 third | yes | `captures/c.txt` | | - |']);
    const r = gate(dir);
    assert.strictEqual(r.rc, 1);
    assert.ok(r.json.failures.includes('missing_evidence'));
    assert.ok(r.json.work_errors.some((e) => /Q1 admin/.test(e) && /root-cause or search/.test(e)));
    assert.strictEqual(r.json.work_errors.filter((e) => /question/.test(e)).length, 1);
  });
  test('a "no" naming an existing search capture passes; a named capture that does not exist fails', () => {
    const { dir, pd } = spikeProject();
    write(dir, '.planning/phases/01-p1/captures/search.txt', 'grep out\n');
    addTable(pd, ['| Q1 x | No | `captures/a.txt` | | `captures/search.txt` |']);
    assert.strictEqual(gate(dir).rc, 0);
    addTable(pd, ['| Q1 x | No | `captures/a.txt` | | `captures/missing.txt` |']);
    assert.ok(gate(dir).json.work_errors.some((e) => /not found on disk/.test(e)));
  });
  test('a probe committed after its capture is a stale capture; the capture committed later is fine', () => {
    const { dir, pd } = spikeProject();
    const commit = (msg, date) => execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    write(dir, '.planning/phases/01-p1/captures/a.txt', 'out\n');
    write(dir, 'spike/probe.sh', 'echo 1\n');
    git(dir, 'add', '-A'); commit('feat(01-01): probe and capture', '2020-01-01T00:00:00Z');
    addTable(pd, ['| Q1 x | yes | `captures/a.txt` | `spike/probe.sh` | |']);
    git(dir, 'add', '-A'); commit('docs(01-01): table', '2020-01-01T00:00:10Z');
    assert.strictEqual(gate(dir).rc, 0);
    write(dir, 'spike/probe.sh', 'echo 2\n');
    git(dir, 'add', '-A'); commit('feat(01-01): probe changed', '2021-01-01T00:00:00Z');
    const r = gate(dir);
    assert.ok(r.json.work_errors.some((e) => /stale capture/.test(e)), r.out);
    write(dir, '.planning/phases/01-p1/captures/a.txt', 'out2\n');
    git(dir, 'add', '-A'); commit('feat(01-01): re-run', '2021-01-02T00:00:00Z');
    assert.strictEqual(gate(dir).rc, 0);
  });
  test('VERIFICATION is the review record: spike needs open_critical_high; an open CRITICAL/HIGH needs ruled_by (spike and standard)', () => {
    const { dir, pd } = spikeProject();
    const v = (fm) => fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), `---\nstatus: passed\n${fm}---\n# V\n`);
    v('');
    assert.ok(gate(dir).json.work_errors.some((e) => /open_critical_high \(a whole count\)/.test(e)));
    v('open_critical_high: 2\n');
    assert.ok(gate(dir).json.work_errors.some((e) => /no ruling id/.test(e)));
    v('open_critical_high: 2\nruled_by: [D-07]\n');
    assert.strictEqual(gate(dir).rc, 0);
    fs.rmSync(path.join(dir, '.planning', 'OWNER-GATES.json'));
    v('open_critical_high: 1\n');
    assert.ok(gate(dir).json.work_errors.some((e) => /no ruling id/.test(e)));
  });
  test('phase complete refuses while the VERIFICATION lists an open CRITICAL/HIGH', () => {
    const { dir, pd } = spikeProject();
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: passed\nopen_critical_high: 1\n---\n# V\n');
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    assert.notStrictEqual(gsd(dir, ['phase', 'complete', '1']).rc, 0);
  });
  test('a phase ROADMAP marks complete with its requirement still pending, or STATE still executing it, is a form error at spike', () => {
    const { dir } = spikeProject();
    const rm = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('- [ ] **Phase 1', '- [x] **Phase 1').replace('**Depends on:** None', '**Requirements:** ADM-01\n**Depends on:** None'));
    write(dir, '.planning/REQUIREMENTS.md', '# R\n\n- [ ] **ADM-01** thing\n');
    const r = gate(dir);
    const msgs = r.json.form_errors.map((e) => e.message).join('\n');
    assert.match(msgs, /ADM-01 pending/);
    assert.match(msgs, /STATE\.md still reports phase 0?1/);
    assert.ok(r.json.form_errors.every((e) => e.check === 'status_agreement'));
  });
});

describe('prose contracts: spike path, breach behaviour and rule 11 are stated once and pointed to', () => {
  const doc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  test('rigour.md carries the spike budget, the merged review, breach behaviour and rule 11', () => {
    const r = doc('get-shit-done/references/rigour.md');
    assert.match(r, /45 min \/ 10/);
    assert.match(r, /\*\*At `breach` \(100 %\):\*\*/);
    assert.match(r, /Question traceability, negative answers, final-review questions/);
    assert.match(r, /Spike answer table/);
    assert.doesNotMatch(r, /doc waiver inside a spike/);
  });
  test('role files point at rule 11 / the spike column instead of restating it', () => {
    for (const f of ['agents/gsd-planner.md', 'agents/gsd-plan-checker.md', 'agents/gsd-verifier.md', 'get-shit-done/workflows/plan-phase.md', 'get-shit-done/workflows/execute-phase.md']) {
      assert.match(doc(f), /rule 11|rigour\.md/, f);
    }
    assert.match(doc('get-shit-done/workflows/plan-phase.md'), /init `spike_roots`/);
    assert.match(doc('get-shit-done/workflows/execute-phase.md'), /no `implementation_review` step/);
  });
});
