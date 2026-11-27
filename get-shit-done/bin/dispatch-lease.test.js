'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const L = require('./dispatch-lease.js');
const b = require('./phase-budget.js');
const { makeProject, gsd, events: logEvents, writeEvidence } = require('../../tests/helpers/roadmap-fixture.js');

const TOOL = path.join(__dirname, 'gsd-tools.js');
const T0 = Date.parse('2026-01-01T00:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (args) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
const events = (...evs) => evs.map((e) => ({ phase: '1', ...e }));

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lease-')); write('.planning/ROADMAP.md', '# Roadmap\n\n### Phase 1: One\n**Goal**: g\n'); write('.planning/STATE.md', '# s\n'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('dispatch leases', () => {
  test('window role: exclusive; a second window of the phase needs --reason, stored on the lease; other roles unaffected', () => {
    const a = L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w1', events: [], now: T0 });
    assert.ok(a.lease);
    assert.match(L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w2', events: [], now: T0 + 60000 }).error, /already has an open window lease \(w1\)/);
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r1', events: [], now: T0 + 60000 }).lease);
    assert.ok(L.begin({ cwd: dir, phase: '2', role: 'window', id: 'w3', events: [], now: T0 + 60000 }).lease);
    L.end({ cwd: dir, id: 'w1', events: [], now: T0 + 120000 });
    const second = L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w2', events: [], now: T0 + 180000 });
    assert.match(second.error, /already had a window \(w1\); a second window needs --reason/);
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r2', events: [], now: T0 + 180000 }).lease);
    const ok = L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w2', events: [], now: T0 + 180000, reason: 'mutant rerun after fix' });
    assert.strictEqual(ok.lease.begin_reason, 'mutant rerun after fix');
    assert.strictEqual(L.load(dir).find((l) => l.id === 'w2').begin_reason, 'mutant rerun after fix');
  });
  test('windows(): count, minutes and reasons of the phase; CLI logs the reason in dispatch_begin and phase complete reports it', () => {
    assert.deepStrictEqual(L.windows(dir, [], '1'), { count: 0, minutes: 0, reasons: [] });
    L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w1', events: [], now: T0 });
    L.end({ cwd: dir, id: 'w1', events: [], now: T0 + 30 * 60000 });
    L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w2', events: [], now: T0 + 40 * 60000, reason: 'again' });
    L.end({ cwd: dir, id: 'w2', events: [], now: T0 + 55 * 60000 });
    L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r', events: [], now: T0 });
    assert.deepStrictEqual(L.windows(dir, [], '1'), { count: 2, minutes: 45, reasons: ['again'] });
    const d2 = makeProject([{ n: '1', name: 'one' }]);
    try {
      const cli = (args) => gsd(d2, args);
      assert.strictEqual(cli(['dispatch', 'begin', '--phase', '1', '--role', 'window', '--id', 'w1']).rc, 0);
      assert.strictEqual(cli(['dispatch', 'end', '--id', 'w1']).rc, 0);
      assert.notStrictEqual(cli(['dispatch', 'begin', '--phase', '1', '--role', 'window', '--id', 'w2']).rc, 0);
      assert.strictEqual(cli(['dispatch', 'begin', '--phase', '1', '--role', 'window', '--id', 'w2', '--reason', 'probe']).rc, 0);
      assert.ok(logEvents(d2).some((e) => e.type === 'dispatch_begin' && e.id === 'w2' && e.reason === 'probe'));
      cli(['dispatch', 'end', '--id', 'w2']);
      writeEvidence(d2, 1);
      cli(['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
      const r = cli(['phase', 'complete', '1']);
      assert.strictEqual(r.rc, 0, r.out + r.err);
      const out = JSON.parse(r.out);
      assert.strictEqual(out.windows.count, 2);
      assert.deepStrictEqual(out.windows.reasons, ['probe']);
      assert.strictEqual(typeof out.windows.minutes, 'number');
    } finally { fs.rmSync(d2, { recursive: true, force: true }); }
  });
  test('a second open executor lease is refused; other roles and other phases are not', () => {
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
    const bad = L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 60000 });
    assert.match(bad.error, /already has an open executor lease \(a\)/);
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r', events: [], now: T0 + 60000 }).lease);
    assert.ok(L.begin({ cwd: dir, phase: '2', role: 'executor', id: 'c', events: [], now: T0 + 60000 }).lease);
    assert.ok(L.end({ cwd: dir, id: 'a', events: [], now: T0 + 120000 }).lease);
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 180000 }).lease);
  });
  describe('two file-disjoint executors per phase (D-279)', () => {
    const plan = (n, files, extra = '') => { write(`p${n}.md`, `---\nphase: 1\nplan: ${n}\ndepends_on: []\nfiles_modified: [${files}]\n${extra}---\nbody\n`); return `p${n}.md`; };
    const ex = (id, p, t = 0) => L.begin({ cwd: dir, phase: '1', role: 'executor', id, plan: p, events: [], now: T0 + t * 60000 });
    test('a second disjoint lease is allowed, a third is refused', () => {
      assert.ok(ex('a', plan(1, 'src/a.js')).lease);
      assert.strictEqual(ex('b', plan(2, 'src/b.js'), 1).lease.plan, 'p2.md');
      assert.match(ex('c', plan(3, 'src/c.js'), 2).error, /already has 2 open executor leases \(a, b\)/);
    });
    test('an overlapping pair is refused with the reason', () => {
      ex('a', plan(1, 'src/a.js'));
      assert.match(ex('b', plan(2, 'src/a.js'), 1).error, /not file-disjoint \(shared file src\/a\.js\)/);
    });
    test('a lease without --plan is refused while one is open, and when the open lease has no plan', () => {
      ex('a', plan(1, 'src/a.js'));
      assert.match(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 60000 }).error, /second executor needs --plan on both leases/);
      L.end({ cwd: dir, id: 'a', events: [], now: T0 + 120000 });
      L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'c', events: [], now: T0 + 130000 });
      assert.match(ex('d', plan(2, 'src/b.js'), 3).error, /second executor needs --plan on both leases/);
    });
    test('a window lease stays exclusive beside executor leases', () => {
      ex('a', plan(1, 'src/a.js'));
      assert.ok(L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w1', events: [], now: T0 + 60000 }).lease);
      assert.match(L.begin({ cwd: dir, phase: '1', role: 'window', id: 'w2', events: [], now: T0 + 120000 }).error, /already has an open window lease \(w1\)/);
    });
  });
  test('stale close counts to the last event, never to now; the reason is required', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    const ev = events({ type: 'dispatch_begin', timestamp: iso(10) });
    assert.match(L.end({ cwd: dir, id: 'a', stale: true, events: ev, now: T0 + 3000 * 60000 }).error, /--reason/);
    const r = L.end({ cwd: dir, id: 'a', stale: true, reason: 'session died', events: ev, now: T0 + 3000 * 60000 });
    assert.deepStrictEqual([r.lease.closed, r.lease.end], ['stale', iso(10)]);
    assert.strictEqual(L.spend(dir, ev, '1').wall_minutes_spent, 10);
  });
  test('a non-executor lease with no event past the TTL is auto-closed at the next begin, at its last event, with a logged reason', () => {
    L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'a', events: [], now: T0 });
    const ev = events({ type: 'dispatch_begin', timestamp: iso(5) });
    const r = L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'b', events: ev, now: T0 + 500 * 60000, ttlMin: 120 });
    assert.ok(r.lease);
    assert.strictEqual(r.auto_closed.length, 1);
    assert.match(r.auto_closed[0].reason, /no event for 495 min/);
    assert.strictEqual(r.auto_closed[0].at, iso(5));
  });
  test('a quiet executor lease is never closed by the TTL: a second executor stays refused until end or end --stale', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    const r = L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: events({ type: 'dispatch_begin', timestamp: iso(5) }), now: T0 + 500 * 60000, ttlMin: 120 });
    assert.match(r.error, /already has an open executor lease \(a\)/);
    assert.deepStrictEqual(r.auto_closed, []);
  });
  test('a corrupt lease file is renamed to .corrupt-<n>, never overwritten, and reported', () => {
    L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'a', events: [], now: T0 });
    const file = L.leasePath(dir);
    fs.writeFileSync(file, '{not json');
    const r = L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'b', events: [], now: T0 + 60000 });
    assert.ok(r.lease);
    assert.match(r.quarantined, /\.corrupt-1$/);
    assert.strictEqual(fs.readFileSync(`${file}.corrupt-1`, 'utf8'), '{not json');
    fs.writeFileSync(file, '[1');
    assert.match(L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'c', events: [], now: T0 + 120000 }).quarantined, /\.corrupt-2$/);
  });
  test('worktrees of one repo share one lease file (git common dir) and the working tree stays clean', () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i');
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lease-wt-'));
    fs.rmSync(wt, { recursive: true });
    assert.strictEqual(git(dir, 'worktree', 'add', '-q', wt, '-b', 'other').status, 0);
    try {
      assert.strictEqual(fs.realpathSync(path.dirname(L.leasePath(wt))), fs.realpathSync(path.dirname(L.leasePath(dir))));
      assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
      assert.match(L.begin({ cwd: wt, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 1000 }).error, /already has an open executor lease/);
      assert.strictEqual(git(dir, 'status', '--porcelain', '--', '.planning/dispatch-leases.json').stdout, '');
      assert.ok(!fs.existsSync(path.join(dir, '.planning', 'dispatch-leases.json')));
    } finally { fs.rmSync(wt, { recursive: true, force: true }); }
  });
  test('end --stale from another worktree measures to the lease\'s own last event, not to that worktree\'s empty log', () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i');
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lease-wt-'));
    fs.rmSync(wt, { recursive: true });
    assert.strictEqual(git(dir, 'worktree', 'add', '-q', wt, '-b', 'other').status, 0);
    try {
      L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
      const ev = events({ type: 'dispatch_begin', timestamp: iso(25) });
      L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r', events: ev, now: T0 + 30 * 60000 });
      const r = L.end({ cwd: wt, id: 'a', stale: true, reason: 'dead', events: [], now: T0 + 900 * 60000 });
      assert.strictEqual(r.lease.end, iso(25));
    } finally { fs.rmSync(wt, { recursive: true, force: true }); }
  });
  test('an old git that echoes an unknown rev-parse flag does not produce a garbage lease path; the lease lands in the real git dir', () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q');
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-fakegit-'));
    const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ncase "$*" in\n  *"rev-parse"*"--git-common-dir"*) for a in "$@"; do case "$a" in --path-format=*) echo "$a";; esac; done; echo .git; exit 0;;\nesac\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const saved = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${saved}`;
    try {
      const p = L.leasePath(dir);
      assert.strictEqual(fs.realpathSync(path.dirname(p)), fs.realpathSync(path.join(dir, '.git')));
      assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
    } finally { process.env.PATH = saved; fs.rmSync(bin, { recursive: true, force: true }); }
  });
  test('an unwritable git common dir falls back to .planning/ with a notice instead of failing begin', { skip: typeof process.getuid === 'function' && process.getuid() === 0 }, () => {
    const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    git(dir, 'init', '-q');
    fs.chmodSync(path.join(dir, '.git'), 0o555);
    const errs = [];
    const orig = process.stderr.write;
    process.stderr.write = (c) => { errs.push(String(c)); return true; };
    try {
      assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 }).lease);
    } finally { process.stderr.write = orig; fs.chmodSync(path.join(dir, '.git'), 0o755); }
    assert.ok(fs.existsSync(path.join(dir, '.planning', 'dispatch-leases.json')));
    assert.match(errs.join(''), /not writable; leases kept in \.planning/);
  });
  test('an open lease inside the TTL still blocks; a phase close event closes it at that event', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: [], now: T0 + 60 * 60000 }).error);
    const r = L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: events({ type: 'phase_coordinator_death', timestamp: iso(30) }), now: T0 + 60 * 60000 });
    assert.strictEqual(r.auto_closed[0].at, iso(30));
    assert.ok(r.lease);
  });
  test('wall time is the sum of spans and a rate-limit pause adds nothing; a phase without leases has unknown spend', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    L.end({ cwd: dir, id: 'a', events: [], now: T0 + 20 * 60000 });
    fs.writeFileSync(L.leasePath(dir), JSON.stringify({ leases: [...L.load(dir), { id: 'z', role: 'reviewer', phase: '1', begin: iso(3000), end: null }] }));
    const ev = events({ type: 'dispatch_begin', timestamp: iso(3000) }, { type: 'dispatch_begin', timestamp: iso(3015) });
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: ev });
    assert.deepStrictEqual([s.wall_minutes_spent, s.dispatches_spent], [35, 2]);
    assert.strictEqual(b.status({ cwd: dir, phase: '2', cls: 'standard', events: [] }).wall_minutes_spent, null);
  });
  test('phase_complete banks the leases and a later lease opens a new window', () => {
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'a', events: [], now: T0 });
    L.end({ cwd: dir, id: 'a', events: [], now: T0 + 20 * 60000 });
    const done = events({ type: 'phase_complete', timestamp: iso(25), wall_minutes_spent: 20, dispatches_spent: 1, budget_wall_minutes: 90, pct: 22.2 });
    assert.strictEqual(b.status({ cwd: dir, phase: '1', cls: 'standard', events: done }).final, true);
    L.begin({ cwd: dir, phase: '1', role: 'executor', id: 'b', events: done, now: T0 + 40 * 60000 });
    const again = [...done, ...events({ type: 'dispatch_begin', timestamp: iso(40) }, { type: 'dispatch_begin', timestamp: iso(50) })];
    const s = b.status({ cwd: dir, phase: '1', cls: 'standard', events: again });
    assert.deepStrictEqual([s.final, s.wall_minutes_spent, s.total_wall_minutes], [undefined, 10, 30]);
  });
});

describe('dispatch CLI', () => {
  test('begin, refused second executor, stale end with reason; everything lands in the execution log', () => {
    assert.strictEqual(run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'a']).status, 0);
    const bad = run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'b']);
    assert.notStrictEqual(bad.status, 0);
    assert.match(bad.stderr, /already has an open executor lease/);
    assert.notStrictEqual(run(['dispatch', 'end', '--stale', 'a']).status, 0);
    assert.strictEqual(run(['dispatch', 'end', '--stale', 'a', '--reason', 'session died']).status, 0);
    assert.strictEqual(run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'b']).status, 0);
    const log = fs.readFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), 'utf8');
    assert.match(log, /"type":"dispatch_end"[^\n]*"stale":true[^\n]*session died/);
    assert.strictEqual((log.match(/"type":"dispatch_begin"/g) || []).length, 2);
  });
  test('dispatch end over a corrupt lease file logs dispatch_leases_corrupt with the phase of the id from its dispatch_begin event', () => {
    assert.strictEqual(run(['dispatch', 'begin', '--phase', '7', '--role', 'reviewer', '--id', 'z']).status, 0);
    fs.writeFileSync(L.leasePath(dir), '{not json');
    run(['dispatch', 'end', '--id', 'z']);
    const log = fs.readFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), 'utf8');
    assert.match(log, /"type":"dispatch_leases_corrupt"[^\n]*"phase":"7"/);
    assert.doesNotMatch(log, /"type":"dispatch_leases_corrupt"[^\n]*"phase":null/);
  });
  test('roadmap record maps a bare status synonym on an incomplete phase to the real result; only "deferred" is rejected, naming the JSON form', () => {
    const log = path.join(dir, '.planning', 'EXECUTION_LOG.md');
    const r = run(['roadmap', 'record', '--phase', '1', '--result', 'complete']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /gap_cycle|incomplete|"action"/);
    assert.match(fs.readFileSync(log, 'utf8'), /phase_incomplete/);
    assert.ok(!/phase_complete/.test(fs.readFileSync(log, 'utf8')));
    const retry = run(['roadmap', 'record', '--phase', '1', '--result', 'retry']);
    assert.strictEqual(retry.status, 0, retry.stderr);
    const d = run(['roadmap', 'record', '--phase', '1', '--result', 'deferred']);
    assert.notStrictEqual(d.status, 0);
    assert.match(d.stderr, /completed_with_deferrals/);
  });
});

describe('workflow prose matches the lease rule', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'workflows', rel), 'utf8');
  test('execute-phase and plan-phase bracket spawns with dispatch begin|end; budget spend is not mentioned', () => {
    for (const f of ['execute-phase.md', 'plan-phase.md']) {
      const t = read(f);
      assert.match(t, /dispatch begin --phase \{N\}/, f);
      assert.doesNotMatch(t, /budget spend/, f);
    }
  });
  test('DFGATE-01 greps every phase, v2 included; only *-REVIEW.md is excluded (run on a fixture)', () => {
    const item = read('execute-phase.md').match(/<item id="DFGATE-01"[\s\S]*?<\/item>/);
    assert.ok(item, 'DFGATE-01 item present');
    assert.doesNotMatch(item[0], /skips this grep|Phases with no plan carrying/);
    const cmd = item[0].match(/<command>([\s\S]*?)<\/command>/)[1].replace('{phase_dir}', '9-x');
    write('.planning/phases/9-x/9-01-PLAN.md', '---\nformat: v2\n---\nplan\n');
    write('.planning/phases/9-x/9-REVIEW.md', '| F-1 | low | deferred to future phase | owner | x |\n');
    const clean = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(clean.stdout.trim(), 'NONE');
    write('.planning/phases/9-x/9-01-SUMMARY.md', 'tests to be added later\n');
    const hit = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' });
    assert.match(hit.stdout, /9-01-SUMMARY\.md:.*tests to be added later/);
    assert.doesNotMatch(hit.stdout, /REVIEW/);
    write('.planning/phases/9-x/9-01-SUMMARY.md', 'fine\n');
    write('.planning/phases/9-x/deferred-items.md', 'ruled D-3: QA deferred to future phase\n');
    write('.planning/phases/9-x/captures/gates.txt', '$ npm test\nverify later\n');
    write('.planning/phases/9-x/9-VERIFICATION.md', 'D-3 is in deferred-items.md\n');
    assert.strictEqual(spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' }).stdout.trim(), 'NONE', 'deferred-items.md and a command capture are exempt');
    write('.planning/phases/9-x/captures/notes.txt', 'tests to be added later\n');
    assert.match(spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' }).stdout, /captures\/notes\.txt:.*tests to be added later/, 'a hand-written capture with no command line is scanned');
    fs.rmSync(path.join(dir, '.planning/phases/9-x/captures/notes.txt'));
    write('.planning/phases/9-x/9-VERIFICATION.md', 'deferred to future phase\n');
    assert.match(spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' }).stdout, /9-VERIFICATION\.md/, 'VERIFICATION prose still trips');
  });
  test('execute-roadmap sends a bare synonym of completed through 5a/5b before roadmap record, and says what to do on deferred', () => {
    const t = read('execute-roadmap.md');
    const line = t.split('\n').find((l) => l.startsWith('- `completed`'));
    assert.ok(line, 'completed branch present');
    for (const w of ['done', 'ok', 'passed', 'complete']) assert.ok(line.includes(`\`${w}\``), w);
    assert.match(line, /run \*\*5a\*\* then \*\*5b\*\* first/);
    assert.match(line, /bare `deferred`[^.]*re-read the coordinator's JSON/);
  });
  test('rigour rule 7 states the executor TTL exemption and the shared lease file', () => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'references', 'rigour.md'), 'utf8');
    assert.match(t, /a non-executor lease with no event for `workflow\.dispatch\.ttl_minutes`/);
    assert.match(t, /an `executor` lease is closed only by `dispatch end`/);
    assert.match(t, /gsd-dispatch-leases\.json/);
  });
});

describe('dispatch begin: review roles need gates stamped after the last fix commit (rigour rule 12)', () => {
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  const commit = (subject, file, text) => { write(file, text); git('add', '-A', '--', file); assert.strictEqual(git('commit', '-q', '-m', subject).status, 0); };
  const begin = (role, id) => run(['dispatch', 'begin', '--phase', '1', '--role', role, '--id', id]);
  const gates = '.planning/phases/01-one/captures/gates.txt';
  beforeEach(() => {
    git('init', '-q');
    commit('feat(01-01): a', 'src/a.js', 'a\n');
    write('.planning/phases/01-one/01-REVIEW.md', '---\nformat: v2\npasses: 1\n---\n');
  });
  test('a phase with no fix( commit is unaffected', () => {
    assert.strictEqual(begin('reviewer', 'r1').status, 0);
  });
  test('after a fix( commit, reviewer, verifier and recheck are refused until a gates.txt section is stamped at or after it; other roles are not', () => {
    commit('fix(01-review): b', 'src/a.js', 'b\n');
    for (const role of ['reviewer', 'verifier', 'recheck']) {
      const r = begin(role, `x-${role}`);
      assert.notStrictEqual(r.status, 0, role);
      assert.match(r.stderr, /gates\.txt/);
      assert.match(r.stderr, new RegExp(git('rev-parse', '--short', 'HEAD').stdout.trim()));
    }
    assert.strictEqual(begin('executor', 'e1').status, 0);
    assert.strictEqual(run(['capture', 'stamp', gates, '--gate', 'lint']).status, 0);
    assert.strictEqual(begin('reviewer', 'r2').status, 0);
    commit('fix(01-review): c', 'src/a.js', 'c\n');
    assert.match(begin('recheck', 'r3').stderr, /gates\.txt/);
    assert.strictEqual(run(['capture', 'stamp', gates, '--gate', 'lint']).status, 0);
    assert.strictEqual(begin('recheck', 'r3').status, 0);
  });
  test('a section stamped BEFORE the fix commit does not count', () => {
    assert.strictEqual(run(['capture', 'stamp', gates, '--gate', 'lint']).status, 0);
    commit('fix(01-review): b', 'src/a.js', 'b\n');
    assert.match(begin('reviewer', 'r1').stderr, /gates\.txt/);
  });
  test('grandfathered: a record without format: v2 and an unstamped gates.txt is not checked', () => {
    write('.planning/phases/01-one/01-REVIEW.md', '---\nopen_critical_high: 0\n---\n');
    write(gates, '$ npm test\nok\n');
    commit('fix(01-review): b', 'src/a.js', 'b\n');
    assert.strictEqual(begin('reviewer', 'r1').status, 0);
  });
});

describe('dispatch reap-dead: an executor lease whose recorded owner process is gone', () => {
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  const reap = () => JSON.parse(run(['dispatch', 'reap-dead', '--phase', '1', '--raw']).stdout);
  const backdate = () => { const f = L.leasePath(dir); const j = JSON.parse(fs.readFileSync(f, 'utf8')); fs.writeFileSync(f, JSON.stringify({ leases: j.leases.map((l) => ({ ...l, begin: iso(0), last_event: undefined })) })); };
  const owner = () => spawn('sleep', ['60']);
  const gone = (p) => new Promise((r) => { p.once('exit', r); p.kill('SIGKILL'); });
  beforeEach(() => { git('init', '-q'); write('src/a.js', 'a\n'); git('add', '-A'); git('commit', '-q', '-m', 'feat(01-01): a'); });
  test('a live owner is left alone; once it is gone the lease is closed stale at its last heartbeat and a new executor can begin', async () => {
    const p = owner();
    assert.strictEqual(run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'a', '--owner-pid', String(p.pid)]).status, 0);
    backdate();
    assert.deepStrictEqual(reap().leases.map((x) => [x.id, x.status]), [['a', 'alive']]);
    await gone(p);
    const r = reap();
    assert.deepStrictEqual(r.leases.map((x) => [x.id, x.status]), [['a', 'reaped']]);
    assert.strictEqual(L.load(dir)[0].closed, 'stale');
    assert.ok(Date.parse(L.load(dir)[0].end) <= Date.now());
    assert.match(fs.readFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), 'utf8'), /"type":"dispatch_end"[^\n]*"stale":true[^\n]*owner pid/);
    assert.strictEqual(run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'b']).status, 0);
  });
  test('a lease with no recorded owner reports unknown and is never reaped', () => {
    fs.writeFileSync(L.leasePath(dir), JSON.stringify({ leases: [{ id: 'z', role: 'executor', phase: '1', begin: iso(0), end: null }] }));
    assert.deepStrictEqual(reap().leases.map((x) => [x.id, x.status]), [['z', 'unknown']]);
    assert.strictEqual(L.load(dir)[0].end, null);
  });
  test('a dead owner with a phase commit newer than the heartbeat is not reaped (recent_activity)', async () => {
    const p = owner();
    run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'a', '--owner-pid', String(p.pid)]);
    await gone(p);
    write('src/b.js', 'b\n'); git('add', '-A');
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feat(01-01): b'], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z' } });
    assert.deepStrictEqual(reap().leases.map((x) => x.status), ['recent_activity']);
    assert.strictEqual(L.load(dir)[0].end, null);
  });
  test('without --owner-pid begin records an owner: the nearest non-shell ancestor of the tool, or none', () => {
    run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', 'a']);
    const l = L.load(dir)[0];
    assert.ok(l.owner === undefined || (Number.isInteger(l.owner.pid) && process.kill(l.owner.pid, 0)));
  });
  test('load (the read-only view) writes nothing, not even a probe file in the git dir, and still finds the shared file', () => {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    assert.ok(L.begin({ cwd: dir, phase: '1', role: 'reviewer', id: 'r1', events: [], now: T0 }).lease);
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-lease-ro-'));
    spawnSync('git', ['init', '-q'], { cwd: fresh });
    const realOpen = fs.openSync;
    const writes = [];
    fs.openSync = (file, flags, ...rest) => { if (typeof flags === 'string' && /[wa]/.test(flags)) writes.push(String(file)); return realOpen(file, flags, ...rest); };
    try {
      assert.deepStrictEqual(L.load(fresh), []);
      assert.strictEqual(L.load(dir).length, 1);
    } finally { fs.openSync = realOpen; fs.rmSync(fresh, { recursive: true, force: true }); }
    assert.deepStrictEqual(writes, []);
  });
  test('watchdogs.md tick prompt calls dispatch reap-dead', () => {
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'references', 'watchdogs.md'), 'utf8'), /dispatch reap-dead --phase/);
  });
});
