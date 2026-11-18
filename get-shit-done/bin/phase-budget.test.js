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
  const L = require('./dispatch-lease.js');
  const T0 = Date.parse('2026-01-01T00:00:00Z');
  const iso = (m) => new Date(T0 + m * 60000).toISOString();
  const leased = (id, from, to, phase = '1', role = 'reviewer') => { L.begin({ cwd: dir, phase, role, id, events: [], now: T0 + from * 60000 }); if (to !== null) L.end({ cwd: dir, id, events: [], now: T0 + to * 60000 }); };
  const status = (events = [], phase = '1', cls = 'standard') => b.status({ cwd: dir, phase, cls, events });
  test('budget status at 79 / 80 / 100 percent of the wall minutes; dispatch counts never move pct, warn or breach', () => {
    leased('a', 0, 71.1);
    assert.deepStrictEqual([status().pct, status().warn, status().breach, status().budget_class], [79, false, false, 'standard']);
    fs.rmSync(L.leasePath(dir));
    leased('a', 0, 72);
    assert.deepStrictEqual([status().pct, status().warn, status().breach], [80, true, false]);
    fs.rmSync(L.leasePath(dir));
    leased('a', 0, 90);
    assert.deepStrictEqual([status().pct, status().warn, status().breach], [100, true, true]);
    fs.rmSync(L.leasePath(dir));
    for (let n = 0; n < 50; n += 1) leased(`m${n}`, 0, 1);
    const many = status();
    assert.deepStrictEqual([many.dispatches_spent, many.warn, many.breach, many.budget_dispatches], [50, false, false, undefined]);
  });
  test('a phase with no lease reports spend as unknown (null), never zero, and cannot warn or breach; other phases do not count', () => {
    leased('a', 0, 100, '2');
    const s = json(['budget', 'status', '--phase', '1']);
    assert.deepStrictEqual([s.wall_minutes_spent, s.dispatches_spent, s.total_wall_minutes, s.pct, s.warn, s.breach, s.spend_known], [null, null, null, null, false, false, false]);
    assert.strictEqual(json(['budget', 'status', '--phase', '2']).spend_known, undefined);
  });
  test('an open lease is measured to the last logged event, never to the clock (a dead session stops spending)', () => {
    leased('a', 0, null);
    assert.strictEqual(status().wall_minutes_spent, 0);
    const live = [{ type: 'dispatch_begin', phase: '1', timestamp: iso(12) }];
    assert.deepStrictEqual([status(live, '1', 'spike').wall_minutes_spent, status(live, '1', 'spike').breach], [12, false]);
  });
  test('budget spend is gone: it logs no spend event and no phase_spend type is declared', () => {
    run(['budget', 'spend', '--phase', '1']);
    assert.ok(!fs.existsSync(path.join(dir, '.planning', 'EXECUTION_LOG.md')) || !/phase_spend/.test(fs.readFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), 'utf8')));
    assert.ok(!Object.values(require('./execution-log.js').EVENT_TYPES).includes('phase_spend'));
  });
  test('the window restarts after phase_complete and after a budget_exceeded park (retry); a recorded phase_complete stays readable', () => {
    leased('a', 0, 10);
    const done = [{ type: 'phase_complete', phase: '1', timestamp: iso(11) }];
    const closed = status(done);
    assert.deepStrictEqual([closed.dispatches_spent, closed.wall_minutes_spent], [0, 0]);
    const parked = [{ type: 'phase_parked', phase: '1', reason: 'budget_exceeded', timestamp: iso(12) }];
    assert.deepStrictEqual([status(parked).dispatches_spent, status(parked).total_dispatches], [0, 1]);
    const rec = [{ type: 'phase_complete', phase: '1', timestamp: iso(11), wall_minutes_spent: 10, dispatches_spent: 1, budget_wall_minutes: 90, pct: 11.1 }];
    assert.deepStrictEqual([status(rec).final, status(rec).wall_minutes_spent], [true, 10]);
  });
  test('a record of budget_exceeded parks naming the reason', () => {
    const r = json(['roadmap', 'record', '--phase', '1', '--result', '{"status":"blocked","reason":"budget_exceeded"}']);
    assert.deepStrictEqual([r.action, r.events[0].reason], ['park', 'budget_exceeded']);
  });
  test('roadmap record prints a spawns_without_lease notice (not a refusal) when the log shows spawn events and no lease', () => {
    log({ type: 'task_outcome', phase: '1', timestamp: iso(1) }, { type: 'model_selected', phase: '1', timestamp: iso(2) });
    const r = json(['roadmap', 'record', '--phase', '1', '--result', 'retry']);
    assert.deepStrictEqual(r.notices.map((n) => [n.type, n.spawn_events, n.leases]), [['spawns_without_lease', 2, 0]]);
    leased('a', 0, 5);
    assert.deepStrictEqual(json(['roadmap', 'record', '--phase', '1', '--result', 'retry']).notices.map((n) => [n.spawn_events, n.leases]), []);
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
