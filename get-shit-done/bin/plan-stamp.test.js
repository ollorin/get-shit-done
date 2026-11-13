const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, 'gsd-tools.js');
let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (args) => spawnSync('node', [TOOL, ...args, '--raw'], { cwd: dir, encoding: 'utf8' });
const init = () => JSON.parse(run(['init', 'plan-phase', '1', '--legacy']).stdout);
const stamp = () => ({ stamp: init().plan_stamp });
const road = (goal, plans = '**Plans**: 0/1 plans complete\n- [ ] 01-01-PLAN.md', progress = '| 1 | Not started |') =>
  `# Roadmap\n\n### Phase 1: One\n**Goal**: ${goal}\n${plans}\n\n### Phase 2: Two\n**Goal**: g\n\n## Progress\n\n| Phase | Status |\n|---|---|\n${progress}\n`;
const dec = (o) => JSON.stringify({ id: 'D-01', kind: 'decision', status: 'active', source: 'owner-answer', phases: ['1'], ts: '2026-01-01T00:00:00Z', question: 'q', answer: 'a', ...o });
const plan = (n, extra = '') => `---\nphase: 01-one\nplan: ${n}\n${extra}---\n# Plan\n`;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-stamp-')); write('.planning/ROADMAP.md', road('g')); write('.planning/STATE.md', '# s\n'); write('.planning/phases/01-one/.keep', ''); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('plan stamp (init plan-phase plan_stamp / plans_stale)', () => {
  test('12 hex chars; stable across progress, plan-line and checkbox updates', () => {
    const a = stamp();
    assert.match(a.stamp, /^[0-9a-f]{12}$/);
    write('.planning/ROADMAP.md', road('g', '**Plans**: 1/1 plans complete\n- [x] 01-01-PLAN.md', '| 1 | Complete (2026-01-01) |'));
    assert.strictEqual(stamp().stamp, a.stamp);
  });
  test('changes when the goal line, CONTEXT.md, RESEARCH.md or a requirement line changes', () => {
    const base = stamp().stamp;
    write('.planning/ROADMAP.md', road('different goal'));
    const g = stamp().stamp;
    assert.notStrictEqual(g, base);
    write('.planning/phases/01-one/01-CONTEXT.md', 'ctx');
    const c = stamp().stamp;
    assert.notStrictEqual(c, g);
    write('.planning/phases/01-one/01-RESEARCH.md', 'r');
    const r = stamp().stamp;
    assert.notStrictEqual(r, c);
    write('.planning/ROADMAP.md', road('different goal').replace('**Goal**: different goal', '**Goal**: different goal\n**Requirements**: AUTH-01'));
    write('.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in\n- [ ] **PAY-01**: pay\n');
    const q = stamp().stamp;
    write('.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in with passkeys\n- [ ] **PAY-01**: pay\n');
    const q2 = stamp().stamp;
    assert.notStrictEqual(q2, q);
    write('.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in with passkeys\n- [ ] **PAY-01**: pay later\n');
    assert.strictEqual(stamp().stamp, q2);
  });
  test('N8: no ledger row changes the stamp (a D- or A- row mapped to the phase, before or after stamping)', () => {
    const base = stamp().stamp;
    write('.planning/DECISIONS.jsonl', dec({}) + '\n');
    assert.strictEqual(stamp().stamp, base);
    write('.planning/DECISIONS.jsonl', dec({}) + '\n' + dec({ id: 'D-02', status: 'superseded' }) + '\n' + JSON.stringify({ id: 'A-01', kind: 'assumption', status: 'open', phases: ['1'], default: 'cheap', ts: '2026-01-01T00:00:00Z' }) + '\n');
    assert.strictEqual(stamp().stamp, base);
  });
  test('N1: a plan stamped from an init made after CONTEXT and RESEARCH exist is not stale on the next init; the step-1 stamp is', () => {
    const early = stamp().stamp;
    write('.planning/phases/01-one/01-CONTEXT.md', 'ctx');
    write('.planning/phases/01-one/01-RESEARCH.md', 'research');
    const late = stamp().stamp;
    assert.notStrictEqual(late, early);
    write('.planning/phases/01-one/01-01-PLAN.md', plan('01', `plan_stamp: ${late}\n`));
    assert.strictEqual(init().plans_stale, false);
    write('.planning/phases/01-one/01-01-PLAN.md', plan('01', `plan_stamp: ${early}\n`));
    assert.strictEqual(init().plans_stale, true);
  });
  test('N1 prose: plan-phase reads plan_stamp from an init run immediately before the planner spawn', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'plan-phase.md'), 'utf8');
    assert.match(md, /`plan_stamp`[^\n]*(init plan-phase)[^\n]*(immediately before|right before)[^\n]*planner spawn/i);
  });
  test('a rebase cannot stale: nothing time or git based is hashed', () => {
    const a = stamp().stamp;
    fs.utimesSync(path.join(dir, '.planning', 'ROADMAP.md'), new Date(0), new Date(0));
    assert.strictEqual(stamp().stamp, a);
  });
  test('stamped plan is fresh, changed input makes it stale, an unstamped plan is never stale (one notice), executed plans are ignored', () => {
    const s = stamp();
    write('.planning/phases/01-one/01-01-PLAN.md', plan('01', `plan_stamp: ${s.stamp}\n`));
    write('.planning/phases/01-one/01-02-PLAN.md', plan('02'));
    const r = run(['init', 'plan-phase', '1', '--legacy']);
    let o = JSON.parse(r.stdout);
    assert.deepStrictEqual([o.plan_stamp, o.plans_stale], [s.stamp, false]);
    assert.match(r.stderr, /01-02-PLAN\.md carry no plan_stamp/);
    assert.strictEqual(o.plans_unstamped, undefined);
    write('.planning/phases/01-one/01-CONTEXT.md', 'new context');
    assert.strictEqual(init().plans_stale, true);
    write('.planning/phases/01-one/01-01-SUMMARY.md', '# s');
    assert.strictEqual(init().plans_stale, false);
  });
  test('the dispatcher no longer emits plans_stale or the removed plan stamp subcommand', () => {
    write('.planning/phases/01-one/01-01-PLAN.md', plan('01', 'plan_stamp: 000000000000\n'));
    assert.strictEqual(JSON.parse(run(['roadmap', 'next']).stdout).plans_stale, undefined);
    assert.notStrictEqual(run(['plan', 'stamp', '1']).status, 0);
  });
});
