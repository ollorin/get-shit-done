'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProject, gsd, writeEvidence, completePhaseLikeWorkflow } = require('./helpers/roadmap-fixture.js');
const tools = require('../get-shit-done/bin/gsd-tools.js');
const box = require('../get-shit-done/bin/roadmap-box.js');
const dispatch = require('../get-shit-done/bin/roadmap-dispatch.js');
const budget = require('../get-shit-done/bin/phase-budget.js');
const formCheck = require('../get-shit-done/bin/form-check.js');
const ledger = require('../get-shit-done/bin/token-usage-ledger.js');
const analytics = require('../get-shit-done/bin/analytics.js');

const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const dirs = [];
const project = (phases = [{ n: '1', name: 'one' }], cfg = {}) => { const d = makeProject(phases, cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

describe('R5-1: phase complete marks only the requirement ids this phase owns', () => {
  const setup = (heading1 = '### Phase 1: one') => {
    const dir = project([{ n: '1', name: 'one' }, { n: '2', name: 'two' }]);
    write(dir, '.planning/ROADMAP.md', `# Roadmap\n\n- [ ] **Phase 1: one** - x\n- [ ] **Phase 2: two** - y\n\n${heading1}\n**Goal:** g\n**Requirements:** ADM-01, ADM-02\n\n### Phase 2: two\n**Goal:** g\n**Requirements:** ADM-02, ADM-03\n`);
    write(dir, '.planning/REQUIREMENTS.md', '# R\n\n- [ ] **ADM-01** a\n- [ ] **ADM-02** b\n- [ ] **ADM-03** c\n- [ ] **ADM-04** d\n\n| ID | Phase | Status |\n|---|---|---|\n| ADM-01 | Phase 1 | Pending |\n| ADM-02 | Phase 2 | Pending |\n| ADM-03 | Phase 2 | Pending |\n');
    writeEvidence(dir, 1);
    return dir;
  };
  test('an id whose traceability row names another phase stays open', () => {
    const dir = setup();
    const r = completePhaseLikeWorkflow(dir, 1);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    const req = read(dir, '.planning/REQUIREMENTS.md');
    assert.match(req, /- \[x\] \*\*ADM-01\*\*/);
    assert.match(req, /- \[ \] \*\*ADM-02\*\*/);
    assert.match(req, /\| ADM-02 \| Phase 2 \| Pending \|/);
    assert.deepStrictEqual(r.json.requirements_marked, ['ADM-01']);
  });
  test('an id with no traceability row is marked; a bold heading is parsed', () => {
    const dir = setup('### **Phase 1: one**');
    write(dir, '.planning/REQUIREMENTS.md', '- [ ] **ADM-01** a\n- [ ] **ADM-02** b\n');
    const r = completePhaseLikeWorkflow(dir, 1);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    assert.deepStrictEqual(r.json.requirements_marked, ['ADM-01', 'ADM-02']);
  });
  test('a heading it cannot parse is a loud error, not a silent no-op', () => {
    const dir = setup('### Phase one - one');
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    const r = gsd(dir, ['phase', 'complete', '1']);
    assert.notStrictEqual(r.rc, 0);
    assert.match(r.err + r.out, /no "### Phase 1" heading/);
  });
});

describe('R5-2 / R5-3: dispatches are counted, never limited', () => {
  test('limits carry wall minutes only; a config dispatches key is ignored', () => {
    const dir = project([{ n: '1', name: 'one' }], { workflow: { budget: { standard: { dispatches: 2 } } } });
    assert.deepStrictEqual(budget.budgetFields(dir, 'standard'), { budget_class: 'standard', budget_wall_minutes: 90 });
    assert.deepStrictEqual(Object.keys(budget.DEFAULTS.spike), ['wall_minutes']);
  });
  test('500 dispatches in one minute: counted, no warn, no breach', () => {
    const t = (m) => new Date(Date.parse('2026-01-01T00:00:00Z') + m * 60000).toISOString();
    const ev = [{ type: 'phase_start', phase: '1', timestamp: t(0) }, ...Array.from({ length: 500 }, () => ({ type: 'phase_spend', phase: '1', timestamp: t(1) }))];
    const s = budget.status({ cwd: project(), phase: '1', cls: 'spike', events: ev });
    assert.deepStrictEqual([s.dispatches_spent, s.total_dispatches, s.warn, s.breach, s.budget_dispatches], [500, 500, false, false, undefined]);
  });
  test('init and the prose carry no dispatch ceiling', () => {
    const o = gsd(project(), ['init', 'plan-phase', '1', '--legacy']).json;
    assert.deepStrictEqual([o.budget_wall_minutes, o.budget_dispatches], [90, undefined]);
    const r = doc('get-shit-done/references/rigour.md');
    assert.doesNotMatch(r, /dispatch budgets|10 as the cap|45 min \/ 10|\{wall_minutes,dispatches\}/);
  });
});

describe('R5-16 / R10-G: both phase_complete writers carry the totals, run not grepped', () => {
  const totals = (e) => [e.total_wall_minutes, e.total_dispatches, e.dispatches_spent];
  test('phase complete and roadmap record each write them', () => {
    const a = project();
    writeEvidence(a, 1);
    for (let i = 0; i < 2; i++) gsd(a, ['budget', 'spend', '--phase', '1']);
    completePhaseLikeWorkflow(a, 1);
    const ev = (d) => read(d, '.planning/EXECUTION_LOG.md').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => e.type === 'phase_complete').pop();
    assert.deepStrictEqual(totals(ev(a)).slice(1), [2, 2]);
    const b = project();
    writeEvidence(b, 1);
    for (let i = 0; i < 3; i++) gsd(b, ['budget', 'spend', '--phase', '1']);
    gsd(b, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    write(b, '.planning/ROADMAP.md', read(b, '.planning/ROADMAP.md').replace('- [ ] **Phase 1', '- [x] **Phase 1'));
    assert.strictEqual(gsd(b, ['roadmap', 'record', '--phase', '1', '--result', '{"status":"completed"}']).json.action, 'complete');
    assert.deepStrictEqual(totals(ev(b)).slice(1), [3, 3]);
  });
});

describe('R5-4: an untagged task runs on sonnet', () => {
  test('routedTier and highestTier default to sonnet; plan index lists task_tiers', () => {
    const tasks = formCheck.planTasks('<tasks><task type="auto"><name>a</name></task><task tier="haiku"><name>b</name></task></tasks>');
    assert.deepStrictEqual(tasks.map(formCheck.routedTier), ['sonnet', 'haiku']);
    assert.strictEqual(formCheck.highestTier(tasks), 'sonnet');
    const dir = project();
    write(dir, '.planning/phases/01-p1/01-01-PLAN.md', '---\nphase: 01\nplan: "01"\nwave: 1\n---\n<tasks>\n<task type="auto"><name>a</name></task>\n<task tier="haiku"><name>b</name></task>\n</tasks>\n');
    const idx = gsd(dir, ['phase-plan-index', '1']).json;
    assert.deepStrictEqual(idx.plans[0].task_tiers, ['sonnet', 'haiku']);
    assert.match(doc('get-shit-done/references/task-routing.md'), /still without a tag at execute time[^.]*runs on `sonnet`/);
  });
});

describe('R5-5: a verifier-owned omission goes back to the verifier, not to a gap cycle', () => {
  const truth = { complete: false, errors: ['01-VERIFICATION.md frontmatter must carry criteria_decided: <n>/<m> (x)'], work_errors: ['01-VERIFICATION.md frontmatter must carry criteria_decided: <n>/<m> (x)'], form_errors: [] };
  const rec = (events, spike = true) => dispatch.record({ phase: '1', result: { status: 'completed' }, truth, events, spike });
  test('first omission: retry at verify; second in the same window: gap path; not at standard', () => {
    const first = rec([{ type: 'phase_start', phase: '1' }]);
    assert.deepStrictEqual([first.action, first.reason, first.resume_step], ['retry', 'verifier_omission', 'verify']);
    assert.strictEqual(first.events[0].type, 'phase_retry');
    assert.strictEqual(rec([{ type: 'phase_start', phase: '1' }, first.events[0]]).action, 'gap_cycle');
    assert.strictEqual(rec([{ type: 'phase_start', phase: '1' }], false).action, 'gap_cycle');
  });
  test('the retry is documented in execute-roadmap and the verifier', () => {
    assert.match(doc('get-shit-done/workflows/execute-roadmap.md'), /reason: verifier_omission/);
    assert.match(doc('agents/gsd-verifier.md'), /the phase is sent back to you/);
  });
});

describe('R5-14: a resumed phase_start does not open a second ruling window', () => {
  const open = { complete: false, errors: ['01-VERIFICATION.md has open_critical_high 2 and no ruling id in ruled_by'], work_errors: ['01-VERIFICATION.md has open_critical_high 2 and no ruling id in ruled_by'], form_errors: [] };
  const rec = (events) => dispatch.record({ phase: '1', result: { status: 'gaps_found', gap_cycle_done: true }, truth: open, events, spike: true }).action;
  test('respawn after the ruling: park; retry after a park: ruling again', () => {
    assert.strictEqual(rec([{ type: 'phase_start', phase: '1' }, { type: 'spike_ruling', phase: '1' }, { type: 'phase_start', phase: '1', resumed: true }]), 'park');
    assert.strictEqual(rec([{ type: 'phase_start', phase: '1' }, { type: 'spike_ruling', phase: '1' }, { type: 'phase_parked', phase: '1', reason: 'gaps_after_closure_cycle' }, { type: 'phase_start', phase: '1' }]), 'ruling');
  });
});

describe('R5-9: Self-Check verdict on the heading line', () => {
  const v = (t) => tools.evaluateSummarySelfCheck(t).status;
  test('a count then a verdict word is read; the first verdict word wins', () => {
    assert.strictEqual(v('## Self-Check: 5/5 passed\n\nFAILED probe row\n'), 'passed');
    assert.strictEqual(v('## Self-Check: 2/5 failed\n\nPASSED row\n'), 'failed');
    assert.strictEqual(v('## Self-Check: PASSED (3 probe FAIL rows)\n'), 'passed');
  });
  test('Dimension 16 starts after a blank line with a capital', () => {
    const c = doc('agents/gsd-plan-checker.md');
    assert.match(c, /\n\n## Dimension 16: /);
    assert.match(c, /rule 11\. Open the source PRD/);
  });
});

describe('R5-6 / R5-7 / R5-8 / R5-12: dead profile and score leftovers are gone', () => {
  test('no AI Models question, no Score line, no opus routed tier, utility default stated', () => {
    assert.doesNotMatch(doc('get-shit-done/workflows/new-project.md'), /AI Models/);
    assert.doesNotMatch(doc('README.md'), /Quota pressure adjusts|40.60% token savings|routing-rules\.md/);
    for (const f of ['agents/gsd-verifier.md', 'get-shit-done/workflows/execute-phase.md']) assert.doesNotMatch(doc(f), /\*\*Score:\*\*/);
    assert.doesNotMatch(doc('get-shit-done/workflows/complete-milestone.md'), /verification scores/);
    assert.doesNotMatch(doc('get-shit-done/references/executor-detail.md'), /haiku\|sonnet\|opus|opus_count/);
    assert.match(doc('get-shit-done/references/models.md'), /`utility_model` from its own \(default `haiku`\)/);
  });
  test('analytics counts routing_decision events only', () => {
    const dir = project();
    write(dir, '.planning/EXECUTION_LOG.md', ['# L', JSON.stringify({ type: 'task_dispatch', model: 'sonnet', phase: '1' }), JSON.stringify({ type: 'routing_decision', model: 'haiku', phase: '1' })].join('\n') + '\n');
    const report = analytics.generateReport(dir);
    assert.match(report, /\|\s*haiku\s*\|\s*1\s*\|/);
    assert.doesNotMatch(report, /\|\s*sonnet\s*\|\s*1\s*\|/);
  });
});

describe('R5-11: the savings baseline is a tier, not a profile', () => {
  test('default opus; report has baseline_tier and no baseline_profile; a legacy profile name falls back to opus', () => {
    const rec = [{ phase: '1', plan: '01', task_index: 1, model: 'sonnet', tokens: { input: 1000, output: 500 }, source: 'estimated' }];
    const r = ledger.computeSavingsFromUsage(rec, [], 'sonnet');
    assert.deepStrictEqual([r.baseline_tier, r.baseline_profile], ['sonnet', undefined]);
    assert.strictEqual(ledger.computeSavingsFromUsage(rec, [], 'quality').baseline_tier, 'opus');
    const cfg = tools.loadConfig(project());
    assert.deepStrictEqual([cfg.savings_baseline_tier, cfg.savings_baseline_profile], ['opus', undefined]);
  });
});

describe('phase add puts the phase in every place a phase lives', () => {
  const PROGRESS = '\n## Progress\n\n**Execution Order:** 1 → 2\n\n| Phase | Milestone | Plans Complete | Status | Completed |\n|-------|-----------|----------------|--------|-----------|\n| 1. one | v1 | 1/1 | Complete | - |\n| 2. two | v1 | 0/0 | Not started | - |\n';
  test('fixture without a Progress table: checklist line, details after the last section, phase complete works', () => {
    const dir = project([{ n: '1', name: 'one' }, { n: '2', name: 'two' }]);
    const r = gsd(dir, ['phase', 'add', 'three']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    const rm = read(dir, '.planning/ROADMAP.md');
    assert.strictEqual(box.checkboxState(rm, 3), false);
    assert.ok(rm.indexOf('- [ ] **Phase 3: three**') < rm.indexOf('### Phase 1: one'), 'checklist line sits with the other phase lines');
    assert.ok(rm.indexOf('- [ ] **Phase 3: three**') > rm.indexOf('- [ ] **Phase 2: two**'));
    assert.ok(rm.indexOf('### Phase 3: three') > rm.indexOf('### Phase 2: two'));
    writeEvidence(dir, 3);
    const c = completePhaseLikeWorkflow(dir, 3);
    assert.strictEqual(c.rc, 0, c.out + c.err);
    assert.strictEqual(c.json.roadmap_checkbox_missing, undefined);
    assert.strictEqual(box.checkboxState(read(dir, '.planning/ROADMAP.md'), 3), true);
  });
  test('fixture with Execution Order and a Progress table: arrow chain, table row, details before ## Progress', () => {
    const dir = project([{ n: '1', name: 'one' }, { n: '2', name: 'two' }]);
    write(dir, '.planning/ROADMAP.md', `${read(dir, '.planning/ROADMAP.md').replace(/\s+$/, '')}\n${PROGRESS}`);
    assert.strictEqual(gsd(dir, ['phase', 'add', 'three']).rc, 0);
    const rm = read(dir, '.planning/ROADMAP.md');
    assert.ok(rm.indexOf('### Phase 3: three') > rm.indexOf('### Phase 2: two'));
    assert.ok(rm.indexOf('### Phase 3: three') < rm.indexOf('## Progress'), 'details precede ## Progress');
    assert.match(rm, /\*\*Execution Order:\*\* 1 → 2 → 3\n/);
    assert.match(rm, /\| 3\. three \| v1 \| 0\/0 \| Not started \| - \|\n?$/);
    assert.strictEqual(box.checkboxState(rm, 3), false);
  });
});
