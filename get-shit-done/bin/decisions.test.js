const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { load, validate, answer, checkPlan, digest } = require('./decisions.js');

const TOOL = path.join(__dirname, 'decisions.js');
const FIX = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'decisions');
const LEDGER = path.join(FIX, 'DECISIONS.jsonl');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

function tmpLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-decisions-'));
  const file = path.join(dir, 'DECISIONS.jsonl');
  fs.copyFileSync(LEDGER, file);
  return file;
}

describe('decisions ledger format', () => {
  test('the fixture ledger validates, including --mapped', () => {
    const { records, errors } = load(LEDGER);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(records.length, 4);
    assert.deepStrictEqual(validate(records, { mapped: true }), []);
  });

  test('an assumption without default, reversibility or consuming phase is rejected', () => {
    const { records } = load(LEDGER);
    const bad = { id: 'A-09', kind: 'assumption', ts: '2026-11-10T10:00:00Z', source: 'prd:stage1', question: 'q', phases: [], status: 'open' };
    const errors = validate([...records, bad], { mapped: true });
    assert.ok(errors.some((e) => e.includes('A-09: default is empty')));
    assert.ok(errors.some((e) => e.includes('A-09: reversibility')));
    assert.ok(errors.some((e) => e.includes('A-09: no consuming phase')));
  });

  test('wrong id prefix, bad status and a corrupt line are rejected', () => {
    const file = tmpLedger();
    fs.appendFileSync(file, '{not json\n');
    fs.appendFileSync(file, JSON.stringify({ id: 'A-07', kind: 'decision', ts: 'x', source: 's', question: 'q', answer: 'a', phases: ['1'], status: 'maybe' }) + '\n');
    const r = spawnSync('node', [TOOL, 'validate', '--file', file], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    const res = JSON.parse(r.stdout);
    assert.ok(res.errors.some((e) => e.startsWith('line 5:')));
    assert.ok(res.errors.some((e) => e.includes('A-07: id does not match D-NN')));
    assert.ok(res.errors.some((e) => e.includes('A-07: status "maybe"')));
    assert.ok(res.errors.some((e) => e.includes('A-07: ts is not an ISO timestamp')));
  });
});

describe('planner must cite decision ids', () => {
  test('good plan cites every id that names phase 12', () => {
    const res = checkPlan(load(LEDGER).records, '12', [read('12-01-PLAN.good.md')]);
    assert.deepStrictEqual(res, { pass: true, phase: '12', missing: [], unknown: [], stale: [] });
  });

  test('bad plan fails: missing D-01 and A-01, unknown D-09; exit code 1', () => {
    const r = spawnSync('node', [TOOL, 'check-plan', '--file', LEDGER, '--phase', '12', path.join(FIX, '12-01-PLAN.bad.md')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    const res = JSON.parse(r.stdout);
    assert.deepStrictEqual(res.missing, ['D-01', 'A-01']);
    assert.deepStrictEqual(res.unknown, ['D-09']);
  });

  test('a global decision is listed for the phase but citation is not required', () => {
    const out = execFileSync('node', [TOOL, 'list', '--file', LEDGER, '--phase', '13'], { encoding: 'utf8' });
    assert.match(out, /^D-02 \[all\]/m);
    assert.match(out, /^A-01 \[12,13\]/m);
    assert.doesNotMatch(out, /D-01/);
  });

  test('citing an overridden assumption is stale and names the replacement', () => {
    const file = tmpLedger();
    const res = answer(file, 'A-01', 'Platform fallback cap', { state: { completed: [], inProgress: [] }, ts: '2026-11-11T00:00:00Z' });
    assert.strictEqual(res.outcome, 'applied');
    const check = checkPlan(load(file).records, '12', [read('12-01-PLAN.good.md')]);
    assert.strictEqual(check.pass, false);
    assert.deepStrictEqual(check.stale, [{ id: 'A-01', use: res.decision }]);
    assert.deepStrictEqual(check.missing, [res.decision]);
  });
});

describe('answers and the late-answer rule', () => {
  const ts = '2026-11-11T00:00:00Z';

  test('answer equal to the default confirms, no decision or rework written', () => {
    const file = tmpLedger();
    const res = answer(file, 'A-01', 'refuse the withdrawal (no implicit cap) ', { state: { completed: ['12'], inProgress: [] }, ts });
    assert.strictEqual(res.outcome, 'confirmed');
    const { records } = load(file);
    assert.strictEqual(records.find((r) => r.id === 'A-01').status, 'confirmed');
    assert.strictEqual(records.filter((r) => r.kind === 'rework').length, 0);
    assert.deepStrictEqual(validate(records, { mapped: true }), []);
  });

  test('different answer while the consumer is being planned -> replan', () => {
    const file = tmpLedger();
    const res = answer(file, 'A-01', 'Platform fallback cap', { state: { completed: [], inProgress: ['12'] }, ts });
    assert.strictEqual(res.outcome, 'replan');
    assert.deepStrictEqual(res.phases, ['12']);
  });

  test('different answer after a consumer completed -> rework ticket for the built phases only', () => {
    const file = tmpLedger();
    const res = answer(file, 'A-01', 'Platform fallback cap', { state: { completed: ['12'], inProgress: ['13'] }, ts });
    assert.strictEqual(res.outcome, 'rework');
    assert.deepStrictEqual(res.phases, ['12']);
    assert.deepStrictEqual(res.replan, ['13']);
    const { records } = load(file);
    const r = records.find((x) => x.id === res.rework);
    assert.strictEqual(r.status, 'open');
    assert.strictEqual(r.decision, 'D-03');
    assert.strictEqual(records.find((x) => x.id === 'A-01').resolved_by, 'D-03');
    assert.deepStrictEqual(validate(records, { mapped: true }), []);
  });

  test('--accept-as-built records an accepted ticket instead of rework', () => {
    const file = tmpLedger();
    const out = execFileSync('node', [TOOL, 'answer', 'A-01', '--file', file, '--value', 'Platform fallback cap', '--completed', '12,13', '--accept-as-built'], { encoding: 'utf8' });
    assert.strictEqual(JSON.parse(out).outcome, 'accepted-as-built');
    assert.strictEqual(load(file).records.find((r) => r.kind === 'rework').status, 'accepted');
  });

  test('phase state is read from disk when no flag is given', () => {
    const file = tmpLedger();
    const phases = path.join(path.dirname(file), 'phases');
    fs.mkdirSync(path.join(phases, '12-cap'), { recursive: true });
    fs.writeFileSync(path.join(phases, '12-cap', '12-VERIFICATION.md'), '');
    const out = execFileSync('node', [TOOL, 'answer', 'A-01', '--file', file, '--value', 'Platform fallback cap'], { encoding: 'utf8' });
    assert.strictEqual(JSON.parse(out).outcome, 'rework');
  });

  test('reworks lists open tickets; close marks one done', () => {
    const file = tmpLedger();
    answer(file, 'A-01', 'Platform fallback cap', { state: { completed: ['12'], inProgress: [] }, ts });
    const open = JSON.parse(execFileSync('node', [TOOL, 'reworks', '--file', file], { encoding: 'utf8' }));
    assert.deepStrictEqual(open.map((r) => r.id), ['R-01']);
    execFileSync('node', [TOOL, 'close', 'R-01', '--file', file, '--status', 'done']);
    assert.deepStrictEqual(JSON.parse(execFileSync('node', [TOOL, 'reworks', '--file', file], { encoding: 'utf8' })), []);
  });

  test('answering twice is refused', () => {
    const file = tmpLedger();
    answer(file, 'A-01', 'x', { ts });
    assert.throws(() => answer(file, 'A-01', 'y', { ts }), /already overridden/);
  });
});

describe('non-blocking queue', () => {
  test('gate parks only a phase consuming an open irreversible assumption (exit 2)', () => {
    const park = spawnSync('node', [TOOL, 'gate', '--file', LEDGER, '--phase', '14'], { encoding: 'utf8' });
    assert.strictEqual(park.status, 2);
    assert.deepStrictEqual(JSON.parse(park.stdout).ids, ['A-02']);
    const go = spawnSync('node', [TOOL, 'gate', '--file', LEDGER, '--phase', '12'], { encoding: 'utf8' });
    assert.strictEqual(go.status, 0);
  });

  test('digest lists open questions once: --mark suppresses the repeat', () => {
    const file = tmpLedger();
    const first = execFileSync('node', [TOOL, 'digest', '--file', file, '--mark'], { encoding: 'utf8' });
    assert.match(first, /2 open question/);
    assert.match(first, /A-01 \[phase 12,13, costly\]/);
    assert.match(first, /default: Keep them/);
    assert.strictEqual(digest(load(file).records).text, '');
  });

  test('add assigns the next id and refuses an invalid record without writing', () => {
    const file = tmpLedger();
    const ok = execFileSync('node', [TOOL, 'add', '--file', file, '--kind', 'assumption', '--source', 'prd:stage1', '--question', 'q', '--default', 'd', '--reversibility', 'cheap', '--phases', '12'], { encoding: 'utf8' });
    assert.strictEqual(JSON.parse(ok).id, 'A-03');
    const bad = spawnSync('node', [TOOL, 'add', '--file', file, '--kind', 'assumption', '--source', 'prd:stage1', '--question', 'q', '--default', 'd', '--reversibility', 'maybe'], { encoding: 'utf8' });
    assert.strictEqual(bad.status, 1);
    assert.strictEqual(load(file).records.length, 5);
  });

  test('render writes a readable DECISIONS.md', () => {
    const file = tmpLedger();
    execFileSync('node', [TOOL, 'render', '--file', file]);
    const md = fs.readFileSync(path.join(path.dirname(file), 'DECISIONS.md'), 'utf8');
    assert.match(md, /\| D-01 \| 12 \|/);
    assert.match(md, /\| A-02 \| 14 \|.*\| irreversible \| open \|/);
  });
});

describe('owner title (agnostic-M-06 6.5)', () => {
  const projectWith = (title) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dec-owner-'));
    fs.mkdirSync(path.join(dir, '.planning'));
    if (title !== undefined) fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ project: { slug: 'demo', owner_title: title } }));
    return dir;
  };
  const renderIn = (dir) => {
    const file = path.join(dir, '.planning', 'DECISIONS.jsonl');
    execFileSync('node', [TOOL, 'add', '--file', file, '--kind', 'assumption', '--source', 's', '--question', 'q', '--default', 'd', '--reversibility', 'cheap', '--phases', '1'], { cwd: dir });
    execFileSync('node', [TOOL, 'render', '--file', file], { cwd: dir });
    return fs.readFileSync(path.join(dir, '.planning', 'DECISIONS.md'), 'utf8');
  };

  test('render names the owner_title from the profile, and "owner" when there is none', () => {
    assert.match(renderIn(projectWith('Founder')), /question queued for the Founder\)/);
    assert.match(renderIn(projectWith(undefined)), /question queued for the owner\)/);
  });

  test('answer records source owner-answer', () => {
    const file = path.join(projectWith(undefined), '.planning', 'DECISIONS.jsonl');
    execFileSync('node', [TOOL, 'add', '--file', file, '--kind', 'assumption', '--source', 's', '--question', 'q', '--default', 'd', '--reversibility', 'cheap', '--phases', '1']);
    answer(file, 'A-01', 'something else');
    assert.ok(load(file).records.some((r) => r.kind === 'decision' && r.source === 'owner-answer'));
  });
});

describe('ledger integrity and gate exit codes', () => {
  const rec = (o) => JSON.stringify({ id: 'A-01', kind: 'assumption', ts: '2026-01-01T00:00:00.000Z', source: 's', question: 'q', default: 'd', reversibility: 'irreversible', phases: ['12'], status: 'open', ...o }) + '\n';

  test('H1: a repeated id with a different ts is a parse error and validate fails', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dec-')), 'DECISIONS.jsonl');
    fs.writeFileSync(file, rec({}) + rec({ ts: '2026-02-02T00:00:00.000Z', phases: ['13'], reversibility: 'cheap' }));
    assert.match(load(file).errors.join(), /duplicate id A-01/);
    const v = spawnSync('node', [TOOL, 'validate', '--file', file], { encoding: 'utf8' });
    assert.notStrictEqual(v.status, 0);
    assert.strictEqual(spawnSync('node', [TOOL, 'gate', '--phase', '12', '--file', file], { encoding: 'utf8' }).status, 3);
  });

  test('H1: a same-ts update of the same id is still a legitimate update', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dec-')), 'DECISIONS.jsonl');
    fs.writeFileSync(file, rec({}) + rec({ notified_ts: '2026-03-03T00:00:00.000Z' }));
    assert.deepStrictEqual(load(file).errors, []);
  });

  test('H1: concurrent adds never reuse an id', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dec-')), 'DECISIONS.jsonl');
    const args = ['add', '--file', file, '--kind', 'assumption', '--source', 's', '--question', 'q', '--default', 'd', '--reversibility', 'cheap', '--phases', '1'];
    const { spawn } = require('child_process');
    await Promise.all(Array.from({ length: 8 }, () => new Promise((res) => spawn('node', [TOOL, ...args]).on('close', res))));
    const { records, errors } = load(file);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(records.length, 8);
    assert.strictEqual(fs.existsSync(`${file}.lock`), false);
  });

  test('H2: a conflict-marker line makes gate exit 3 (distinct from park=2), never 0/1', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dec-')), 'DECISIONS.jsonl');
    fs.writeFileSync(file, rec({}) + '<<<<<<< HEAD\n');
    const g = spawnSync('node', [TOOL, 'gate', '--phase', '12', '--file', file], { encoding: 'utf8' });
    assert.strictEqual(g.status, 3);
    assert.strictEqual(spawnSync('node', [TOOL, 'digest', '--file', file], { encoding: 'utf8' }).status, 3);
  });

  test('L1/L2: digest --mark-only marks without printing; empty answer is refused', () => {
    const file = tmpLedger();
    const m = execFileSync('node', [TOOL, 'digest', '--file', file, '--mark-only'], { encoding: 'utf8' });
    assert.strictEqual(m, '');
    assert.strictEqual(digest(load(file).records).text, '');
    const bad = spawnSync('node', [TOOL, 'answer', 'A-02', '--file', file, '--value', ''], { encoding: 'utf8' });
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /empty answer/);
  });

  test('R2: repair renumbers the colliding id, keeps both rows, follows updates, reports the mapping, drops markers', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dec-')), 'DECISIONS.jsonl');
    const other = { ts: '2026-02-02T00:00:00.000Z', question: 'other', phases: ['13'] };
    fs.writeFileSync(file, rec({}) + rec(other) + rec({ ...other, notified_ts: '2026-03-03T00:00:00.000Z' }) + '<<<<<<< HEAD\n' + rec({ id: 'A-02', ts: '2026-01-05T00:00:00.000Z' }));
    const g = spawnSync('node', [TOOL, 'gate', '--phase', '12', '--file', file], { encoding: 'utf8' });
    assert.strictEqual(g.status, 3);
    assert.match(g.stdout, /decisions\.js repair/);
    const r = spawnSync('node', [TOOL, 'repair', '--file', file], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const res = JSON.parse(r.stdout);
    assert.deepStrictEqual(res.renumbered.map((m) => [m.from, m.to]), [['A-01', 'A-03']]);
    assert.deepStrictEqual(res.removedMarkers, [4]);
    const { records, errors } = load(file);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(records.map((x) => x.id).sort(), ['A-01', 'A-02', 'A-03']);
    assert.strictEqual(records.find((x) => x.id === 'A-03').notified_ts, '2026-03-03T00:00:00.000Z');
    assert.strictEqual(records.find((x) => x.id === 'A-01').question, 'q');
    assert.strictEqual(spawnSync('node', [TOOL, 'repair', '--file', file], { encoding: 'utf8' }).status, 0);
    assert.strictEqual(JSON.parse(spawnSync('node', [TOOL, 'repair', '--file', file], { encoding: 'utf8' }).stdout).repaired, false);
  });

  test('N4: a crashed holder (stale lock) is taken over by a waiter, not a failure; a fresh lock still blocks', () => {
    const { LOCK_STALE_MS, LOCK_WAIT_MS } = require('./decisions.js');
    assert.ok(LOCK_STALE_MS <= LOCK_WAIT_MS);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dec-')), 'DECISIONS.jsonl');
    const lock = `${file}.lock`;
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - LOCK_STALE_MS - 2000);
    fs.utimesSync(lock, old, old);
    const args = ['add', '--file', file, '--kind', 'assumption', '--source', 's', '--question', 'q', '--default', 'd', '--reversibility', 'cheap', '--phases', '1'];
    const t0 = Date.now();
    const r = spawnSync('node', [TOOL, ...args], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(Date.now() - t0 < LOCK_WAIT_MS);
    assert.strictEqual(load(file).records.length, 1);
    assert.strictEqual(fs.existsSync(lock), false);
  });
});
