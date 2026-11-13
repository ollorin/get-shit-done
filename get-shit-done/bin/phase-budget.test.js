const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const b = require('./phase-budget.js');

const TOOL = path.join(__dirname, 'gsd-tools.js');
let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (args) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
const json = (args) => JSON.parse(run([...args, '--raw']).stdout);
const log = (...evs) => write('.planning/EXECUTION_LOG.md', evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
const road = (body) => `# Roadmap\n\n### Phase 1: One\n**Goal**: g\n${body}\n`;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-budget-')); write('.planning/ROADMAP.md', road('')); write('.planning/STATE.md', '# s\n'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CLI-4: budget', () => {
  test('defaults per class and config override', () => {
    assert.deepStrictEqual(b.budgetFields(dir, 'spike'), { budget_class: 'spike', budget_wall_minutes: 45, budget_dispatches: 6 });
    assert.deepStrictEqual(b.budgetFields(dir, 'standard'), { budget_class: 'standard', budget_wall_minutes: 90, budget_dispatches: 12 });
    assert.deepStrictEqual(b.budgetFields(dir, 'risk'), { budget_class: 'risk', budget_wall_minutes: 150, budget_dispatches: 20 });
    write('.planning/config.json', JSON.stringify({ workflow: { budget: { standard: { dispatches: 30 } } } }));
    assert.deepStrictEqual(b.budgetFields(dir, 'standard'), { budget_class: 'standard', budget_wall_minutes: 90, budget_dispatches: 30 });
  });
  test('init plan-phase and execute-phase emit class and limits; risk from domains or a high_risk plan', () => {
    for (const cmd of ['plan-phase', 'execute-phase']) {
      const o = json(['init', cmd, '1', '--legacy']);
      assert.deepStrictEqual([o.budget_class, o.budget_wall_minutes, o.budget_dispatches], ['standard', 90, 12], cmd);
    }
    write('.planning/ROADMAP.md', road('**Risk domains**: auth'));
    assert.strictEqual(json(['init', 'plan-phase', '1', '--legacy']).budget_class, 'risk');
    write('.planning/ROADMAP.md', road(''));
    write('.planning/phases/01-one/01-01-PLAN.md', '---\nphase: 01-one\nplan: 01\nhigh_risk: true\n---\n# p\n');
    assert.strictEqual(json(['init', 'execute-phase', '1', '--legacy']).budget_class, 'risk');
  });
  test('budget status at 79 / 80 / 100 percent', () => {
    write('.planning/config.json', JSON.stringify({ workflow: { budget: { standard: { dispatches: 100 } } } }));
    const at = (n) => { log({ type: 'phase_start', phase: '1', timestamp: new Date().toISOString() }, ...Array.from({ length: n }, () => ({ type: 'phase_spend', phase: 1, step: 'x', model: 'haiku' }))); return json(['budget', 'status', '--phase', '1']); };
    const r79 = at(79);
    assert.deepStrictEqual([r79.pct, r79.warn, r79.breach, r79.dispatches_spent, r79.budget_class], [79, false, false, 79, 'standard']);
    const r80 = at(80);
    assert.deepStrictEqual([r80.pct, r80.warn, r80.breach], [80, true, false]);
    const r100 = at(100);
    assert.deepStrictEqual([r100.pct, r100.warn, r100.breach], [100, true, true]);
  });
  test('wall time counts from the first phase_start of the window', () => {
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const events = [{ type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' }, { type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:30:00Z' }];
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events, now: t0 + 72 * 60000 });
    assert.deepStrictEqual([s.wall_minutes_spent, s.pct, s.warn], [72, 80, true]);
  });
  test('the window restarts after phase_complete and after a budget_exceeded park (retry)', () => {
    const spend = { type: 'phase_spend', phase: '1', timestamp: '2026-01-01T00:10:00Z' };
    const ev = [{ type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' }, spend, spend, { type: 'phase_parked', phase: '1', reason: 'budget_exceeded' },
      { type: 'phase_start', phase: '1', timestamp: '2026-01-02T00:00:00Z' }, spend];
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: ev, now: Date.parse('2026-01-02T00:05:00Z') });
    assert.deepStrictEqual([s.dispatches_spent, s.wall_minutes_spent], [1, 5]);
    const closed = b.status({ cwd: dir, phase: '1', cls: 'standard', events: [...ev, { type: 'phase_complete', phase: '1' }], now: Date.now() });
    assert.deepStrictEqual([closed.dispatches_spent, closed.wall_minutes_spent], [0, 0]);
  });
  test('a phase_spend without a phase is ignored; other phases do not count', () => {
    const s = b.status({ cwd: dir, phase: '1', cls: 'spike', events: [{ type: 'phase_spend', step: 'x' }, { type: 'phase_spend', phase: '2' }, { type: 'phase_spend', phase: '1' }], now: 0 });
    assert.strictEqual(s.dispatches_spent, 1);
  });
  test('execution-log event accepts phase_spend and a record of budget_exceeded parks naming the reason', () => {
    assert.strictEqual(run(['execution-log', 'event', '--type', 'phase_spend', '--data', '{"phase":1,"step":"plan-check","model":"sonnet"}']).status, 0);
    assert.strictEqual(json(['budget', 'status', '--phase', '1']).dispatches_spent, 1);
    const r = json(['roadmap', 'record', '--phase', '1', '--result', '{"status":"blocked","reason":"budget_exceeded"}']);
    assert.deepStrictEqual([r.action, r.events[0].reason], ['park', 'budget_exceeded']);
  });
});
