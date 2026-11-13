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
const stamp = () => JSON.parse(run(['plan', 'stamp', '1']).stdout);
const init = () => JSON.parse(run(['init', 'plan-phase', '1', '--legacy']).stdout);
const road = (goal, plans = '**Plans**: 0/1 plans complete\n- [ ] 01-01-PLAN.md', progress = '| 1 | Not started |') =>
  `# Roadmap\n\n### Phase 1: One\n**Goal**: ${goal}\n${plans}\n\n### Phase 2: Two\n**Goal**: g\n\n## Progress\n\n| Phase | Status |\n|---|---|\n${progress}\n`;
const dec = (o) => JSON.stringify({ id: 'D-01', kind: 'decision', status: 'active', source: 'owner-answer', phases: ['1'], ts: '2026-01-01T00:00:00Z', question: 'q', answer: 'a', ...o });
const plan = (n, extra = '') => `---\nphase: 01-one\nplan: ${n}\n${extra}---\n# Plan\n`;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-stamp-')); write('.planning/ROADMAP.md', road('g')); write('.planning/STATE.md', '# s\n'); write('.planning/phases/01-one/.keep', ''); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CLI-7: plan stamp', () => {
  test('12 hex chars with named inputs; stable across progress, plan-line and checkbox updates', () => {
    const a = stamp();
    assert.match(a.stamp, /^[0-9a-f]{12}$/);
    assert.deepStrictEqual(a.inputs.map((i) => i.name), ['roadmap', 'decisions']);
    write('.planning/ROADMAP.md', road('g', '**Plans**: 1/1 plans complete\n- [x] 01-01-PLAN.md', '| 1 | Complete (2026-01-01) |'));
    assert.strictEqual(stamp().stamp, a.stamp);
  });
  test('changes when the goal line, CONTEXT.md, RESEARCH.md or a mapped decision changes', () => {
    const base = stamp().stamp;
    write('.planning/ROADMAP.md', road('different goal'));
    const g = stamp().stamp;
    assert.notStrictEqual(g, base);
    write('.planning/phases/01-one/01-CONTEXT.md', 'ctx');
    const c = stamp().stamp;
    assert.notStrictEqual(c, g);
    write('.planning/phases/01-one/01-RESEARCH.md', 'r');
    assert.notStrictEqual(stamp().stamp, c);
    write('.planning/DECISIONS.jsonl', dec({}) + '\n');
    const d1 = stamp().stamp;
    write('.planning/DECISIONS.jsonl', dec({}) + '\n' + dec({ status: 'superseded' }) + '\n');
    assert.notStrictEqual(stamp().stamp, d1);
  });
  test('a decision of another phase does not change the stamp', () => {
    const base = stamp().stamp;
    write('.planning/DECISIONS.jsonl', dec({ phases: ['2'] }) + '\n');
    assert.strictEqual(stamp().stamp, base);
  });
  test('a rebase cannot stale: nothing time or git based is hashed', () => {
    const a = stamp().stamp;
    fs.utimesSync(path.join(dir, '.planning', 'ROADMAP.md'), new Date(0), new Date(0));
    assert.strictEqual(stamp().stamp, a);
  });
  test('init plan-phase: stamped plan is fresh, changed input makes it stale, unstamped is reported not stale, executed plans are ignored', () => {
    const s = stamp();
    write('.planning/phases/01-one/01-01-PLAN.md', plan('01', `plan_stamp: ${s.stamp}\n`));
    write('.planning/phases/01-one/01-02-PLAN.md', plan('02'));
    let o = init();
    assert.deepStrictEqual([o.plan_stamp, o.plans_stale, o.plans_unstamped, o.stale_reason], [s.stamp, false, ['01-02-PLAN.md'], null]);
    write('.planning/phases/01-one/01-CONTEXT.md', 'new context');
    o = init();
    assert.deepStrictEqual([o.plans_stale, o.stale_reason], [true, 'inputs changed']);
    write('.planning/phases/01-one/01-01-SUMMARY.md', '# s');
    o = init();
    assert.strictEqual(o.plans_stale, false);
  });
  test('stale_reason names the inputs whose sha changed when the plan keeps plan_stamp_inputs', () => {
    const s = stamp();
    const inputs = `plan_stamp_inputs: [${s.inputs.map((i) => `"${i.name}:${i.sha}"`).join(', ')}]\n`;
    write('.planning/phases/01-one/01-01-PLAN.md', plan('01', `plan_stamp: ${s.stamp}\n${inputs}`));
    write('.planning/phases/01-one/01-CONTEXT.md', 'x');
    assert.deepStrictEqual([init().plans_stale, init().stale_reason], [true, 'context']);
  });
  test('roadmap next adds plans_stale to the spawn_coordinator action', () => {
    write('.planning/phases/01-one/01-01-PLAN.md', plan('01', 'plan_stamp: 000000000000\n'));
    const r = JSON.parse(run(['roadmap', 'next']).stdout);
    assert.deepStrictEqual([r.action, r.plans_stale], ['spawn_coordinator', true]);
  });
});
