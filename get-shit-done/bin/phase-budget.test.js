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
    assert.deepStrictEqual(b.budgetFields(dir, 'spike'), { budget_class: 'spike', budget_wall_minutes: 45 });
    assert.deepStrictEqual(b.budgetFields(dir, 'standard'), { budget_class: 'standard', budget_wall_minutes: 90 });
    assert.deepStrictEqual(b.budgetFields(dir, 'risk'), { budget_class: 'risk', budget_wall_minutes: 150 });
    write('.planning/config.json', JSON.stringify({ workflow: { budget: { standard: { wall_minutes: 30, dispatches: 3 } } } }));
    assert.deepStrictEqual(b.budgetFields(dir, 'standard'), { budget_class: 'standard', budget_wall_minutes: 30 });
  });
  test('init plan-phase and execute-phase emit class and limits; risk from the phase risk domains', () => {
    for (const cmd of ['plan-phase', 'execute-phase']) {
      const o = json(['init', cmd, '1', '--legacy']);
      assert.deepStrictEqual([o.budget_class, o.budget_wall_minutes, o.budget_dispatches], ['standard', 90, undefined], cmd);
    }
    write('.planning/ROADMAP.md', road('**Risk domains**: auth'));
    assert.strictEqual(json(['init', 'plan-phase', '1', '--legacy']).budget_class, 'risk');
    assert.strictEqual(json(['init', 'execute-phase', '1', '--legacy']).budget_class, 'risk');
  });
  test('budget status at 79 / 80 / 100 percent of the wall minutes; dispatch counts never move pct, warn or breach', () => {
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const at = (min, spends) => b.status({ cwd: dir, phase: '1', cls: 'standard', events: [{ type: 'phase_start', phase: '1', timestamp: new Date(t0).toISOString() }, ...Array.from({ length: spends }, () => ({ type: 'phase_spend', phase: '1' })), { type: 'phase_spend', phase: '1', timestamp: new Date(t0 + min * 60000).toISOString() }] });
    const r79 = at(71.1, 0);
    assert.deepStrictEqual([r79.pct, r79.warn, r79.breach, r79.budget_class], [79, false, false, 'standard']);
    const r80 = at(72, 0);
    assert.deepStrictEqual([r80.pct, r80.warn, r80.breach], [80, true, false]);
    const r100 = at(90, 0);
    assert.deepStrictEqual([r100.pct, r100.warn, r100.breach], [100, true, true]);
    const many = at(1, 500);
    assert.deepStrictEqual([many.dispatches_spent, many.warn, many.breach, many.budget_dispatches], [501, false, false, undefined]);
  });
  test('M1: wall time is the sum of work windows; idle time between sessions never counts', () => {
    const ev = [
      { type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'phase_parked', phase: '1', reason: 'human_needed', timestamp: '2026-01-01T00:10:00Z' },
      { type: 'phase_start', phase: '1', timestamp: '2026-01-03T00:00:00Z' },
      { type: 'phase_spend', phase: '1', timestamp: '2026-01-03T00:05:00Z' },
    ];
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: ev, now: Date.parse('2026-01-03T00:05:00Z') });
    assert.strictEqual(s.wall_minutes_spent, 15);
    const rec = [...ev.slice(0, 1), { type: 'phase_incomplete', phase: '1', action: 'gap_cycle', timestamp: '2026-01-01T00:20:00Z' }, { type: 'gap_cycle', phase: '1', timestamp: '2026-02-01T00:00:00Z' }, { type: 'phase_spend', phase: '1', timestamp: '2026-02-01T00:07:00Z' }];
    assert.strictEqual(b.status({ cwd: dir, phase: '1', cls: 'standard', events: rec, now: Date.parse('2026-02-01T00:07:00Z') }).wall_minutes_spent, 27);
  });
  test('a phase_start while a window is open closes the old one at the last logged event of the phase', () => {
    const ev = [{ type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' }, { type: 'phase_spend', phase: '1', timestamp: '2026-01-01T00:30:00Z' }, { type: 'phase_start', phase: '1', timestamp: '2026-01-05T00:00:00Z' }, { type: 'phase_spend', phase: '1', timestamp: '2026-01-05T00:10:00Z' }];
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: ev, now: Date.parse('2026-01-05T00:10:00Z') });
    assert.deepStrictEqual([s.wall_minutes_spent, s.dispatches_spent], [40, 2]);
  });
  test('an open window is measured to the last logged event, never to the clock (a dead session stops spending)', () => {
    const ev = [{ type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' }];
    assert.strictEqual(b.status({ cwd: dir, phase: '1', cls: 'spike', events: ev, now: Date.parse('2026-01-09T00:00:00Z') }).wall_minutes_spent, 0);
    const live = [...ev, { type: 'phase_spend', phase: '1', timestamp: '2026-01-01T00:12:00Z' }];
    const s = b.status({ cwd: dir, phase: '1', cls: 'spike', events: live, now: Date.parse('2026-01-09T00:00:00Z') });
    assert.deepStrictEqual([s.wall_minutes_spent, s.breach], [12, false]);
  });
  test('N2: a window with no phase_start (standalone plan-phase / execute-phase) opens at the first spend event', () => {
    const t = (m) => new Date(Date.parse('2026-01-01T00:00:00Z') + m * 60000).toISOString();
    const ev = [{ type: 'phase_spend', phase: '1', timestamp: t(0) }, { type: 'phase_spend', phase: '1', timestamp: t(31) }, { type: 'phase_spend', phase: '1', timestamp: t(100) }];
    const s = b.spend(ev, '1');
    assert.deepStrictEqual([s.wall_minutes_spent, s.dispatches_spent], [100, 3]);
    assert.strictEqual(b.spend([{ type: 'phase_spend', phase: '1', timestamp: t(0) }], '1').wall_minutes_spent, 0);
  });
  test('budget spend --phase N logs one dispatch', () => {
    const before = json(['budget', 'status', '--phase', '1']).dispatches_spent;
    json(['budget', 'spend', '--phase', '1', '--step', 'plan-check', '--model', 'sonnet']);
    assert.strictEqual(json(['budget', 'status', '--phase', '1']).dispatches_spent, before + 1);
  });
  test('the window restarts after phase_complete and after a budget_exceeded park (retry)', () => {
    const spend = { type: 'phase_spend', phase: '1', timestamp: '2026-01-01T00:10:00Z' };
    const ev = [{ type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' }, spend, spend, { type: 'phase_parked', phase: '1', reason: 'budget_exceeded' },
      { type: 'phase_start', phase: '1', timestamp: '2026-01-02T00:00:00Z' }, { ...spend, timestamp: '2026-01-02T00:05:00Z' }];
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: ev, now: Date.parse('2026-01-02T00:05:00Z') });
    assert.deepStrictEqual([s.dispatches_spent, s.wall_minutes_spent], [1, 5]);
    const closed = b.status({ cwd: dir, phase: '1', cls: 'standard', events: [...ev, { type: 'phase_complete', phase: '1' }], now: Date.now() });
    assert.deepStrictEqual([closed.dispatches_spent, closed.wall_minutes_spent], [0, 0]);
  });
  test('a retry of a phase parked for its own reason opens a new window; the numbers stay readable until the retry starts', () => {
    const spend = { type: 'phase_spend', phase: '1', timestamp: '2026-01-01T00:10:00Z' };
    const ev = [{ type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' }, spend, spend,
      { type: 'phase_parked', phase: '1', reason: 'gaps_after_closure_cycle', timestamp: '2026-01-01T00:30:00Z' }];
    const parkedStatus = b.status({ cwd: dir, phase: '1', cls: 'spike', events: ev, now: Date.parse('2026-01-03T00:00:00Z') });
    assert.deepStrictEqual([parkedStatus.dispatches_spent, parkedStatus.wall_minutes_spent], [2, 30]);
    const retried = [...ev, { type: 'phase_start', phase: '1', timestamp: '2026-01-02T00:00:00Z' }, { ...spend, timestamp: '2026-01-02T00:04:00Z' }];
    const s = b.status({ cwd: dir, phase: '1', cls: 'spike', events: retried, now: Date.parse('2026-01-02T00:04:00Z') });
    assert.deepStrictEqual([s.dispatches_spent, s.wall_minutes_spent], [1, 4]);
    const dep = [{ type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:00:00Z' }, spend, { type: 'phase_parked', phase: '1', reason: 'dependency_parked', timestamp: '2026-01-01T00:10:00Z' },
      { type: 'phase_start', phase: '1', timestamp: '2026-01-01T00:20:00Z' }, { ...spend, timestamp: '2026-01-01T00:25:00Z' }];
    assert.strictEqual(b.status({ cwd: dir, phase: '1', cls: 'spike', events: dep, now: 0 }).dispatches_spent, 2);
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

describe('CLI-4 does not shadow the existing budget commands', () => {
  test('budget --period daily and budget check still route to the cost and prompt-budget paths', () => {
    const daily = json(['budget', '--period', 'daily', '--scope', 'project']);
    assert.strictEqual(daily.period, 'daily');
    const check = run(['budget', 'check', '--raw']);
    assert.ok(check.stdout.length > 0 && !/phase/.test(check.stderr));
  });
});
