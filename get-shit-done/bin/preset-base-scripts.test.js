'use strict';

// agnostic-M-08: process-level behaviour tests of the scripts the base preset deploys. Each test runs the preset
// source copy (which is byte-equal to the deployed file, checked by preset-base.test.js 3.7). Node and POSIX shell only.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const SCRIPTS = path.join(__dirname, '..', 'presets', 'base', 'scripts');
const LOCK_SH = path.join(SCRIPTS, 'stack-lock.sh');
const LOCK_MJS = path.join(SCRIPTS, 'stack-lock.mjs');

const tmps = [];
const live = [];
// A failing assertion must not leave a holder (or its child, which waits for the release file) running.
afterEach(() => {
  while (live.length > 0) live.pop().kill('SIGKILL');
  for (const d of tmps) fs.writeFileSync(path.join(d, 'release'), '');
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
};
// Kills a pid together with its direct children (a sentinel shell whose `sleep` child would otherwise be orphaned for hours).
const killTree = (pid) => {
  spawnSync('pkill', ['-9', '-P', String(pid)]);
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (file, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    await sleep(25);
  }
  throw new Error(`no ${file} in ${ms} ms`);
};

describe('stack lock (agnostic-M-08 8.4)', () => {
  const lockDir = () => {
    const d = mkTmp('gsd-lock-');
    return { d, lock: path.join(d, 'lock'), owner: path.join(d, 'owner', 'owner.txt') };
  };
  const wrapperArgs = (l, label, timeout, cmd) => [
    LOCK_SH, '--label', label, '--timeout', String(timeout), '--lock-file', l.lock, '--owner-file', l.owner, '--', ...cmd,
  ];
  const wrap = (l, label, timeout, cmd, opts = {}) => {
    const child = spawn('sh', wrapperArgs(l, label, timeout, cmd), { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    const out = { code: null, stdout: '', stderr: '' };
    child.stdout.on('data', (c) => { out.stdout += c; });
    child.stderr.on('data', (c) => { out.stderr += c; });
    out.exited = new Promise((resolve) => child.on('close', (code, signal) => { out.code = code ?? signal; resolve(out); }));
    out.child = child;
    live.push(child);
    return out;
  };
  // A child that stamps start, waits for the release file (or ms), stamps end. Node only.
  const stampCmd = (l, name, holdMs, releaseFile) => [process.execPath, '-e', `
    const fs = require('fs');
    fs.writeFileSync(${JSON.stringify(path.join(l.d, name + '-start'))}, String(Date.now()));
    setTimeout(() => process.exit(1), 40000).unref();
    const done = () => { fs.writeFileSync(${JSON.stringify(path.join(l.d, name + '-end'))}, String(Date.now())); };
    if (${JSON.stringify(releaseFile || '')}) {
      const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(releaseFile || '')})) { clearInterval(t); done(); } }, 25);
    } else setTimeout(done, ${holdMs});
  `];
  const stamps = (l, name) => ({
    start: Number(fs.readFileSync(path.join(l.d, name + '-start'), 'utf8')),
    end: Number(fs.readFileSync(path.join(l.d, name + '-end'), 'utf8')),
  });
  const holder = async (l, name = 'a') => {
    const rel = path.join(l.d, 'release');
    const a = wrap(l, name, 30, stampCmd(l, name, 0, rel));
    await waitFor(path.join(l.d, name + '-start'));
    return { a, release: () => fs.writeFileSync(rel, '') };
  };

  test('L-a the command runs, its exit code returns, no lock file stays, owner.txt is empty, the child sees STACK_LOCK_HELD and PATH', () => {
    const l = lockDir();
    const probe = path.join(l.d, 'env.json');
    const r = spawnSync('sh', wrapperArgs(l, 'a', 5, [process.execPath, '-e',
      `require('fs').writeFileSync(${JSON.stringify(probe)}, JSON.stringify({ held: process.env.STACK_LOCK_HELD, path: process.env.PATH })); process.exit(7)`]),
    { encoding: 'utf8' });
    assert.strictEqual(r.status, 7, r.stderr);
    const env = JSON.parse(fs.readFileSync(probe, 'utf8'));
    assert.strictEqual(env.held, '1');
    assert.strictEqual(env.path, process.env.PATH);
    assert.strictEqual(fs.existsSync(l.lock), false);
    assert.strictEqual(fs.readFileSync(l.owner, 'utf8'), '');
  });

  test('L-b a second wrapper runs only after the first command ended; a waiter that timed out never runs its child', async () => {
    const l = lockDir();
    const { a, release } = await holder(l, 'a');
    const b = wrap(l, 'b', 1, stampCmd(l, 'b', 0));
    assert.strictEqual((await b.exited).code, 75);
    assert.strictEqual(fs.existsSync(path.join(l.d, 'b-start')), false, 'timed-out waiter ran its child');
    const c = wrap(l, 'c', 20, stampCmd(l, 'c', 0));
    await sleep(500);
    assert.strictEqual(fs.existsSync(path.join(l.d, 'c-start')), false, 'c started while a holds the lock');
    release();
    assert.strictEqual((await a.exited).code, 0);
    assert.strictEqual((await c.exited).code, 0);
    assert.ok(stamps(l, 'c').start >= stamps(l, 'a').end, 'c started before a ended');
  });

  test('L-c with a live holder a waiter with --timeout 1 exits 75 and the holder completes with 0, also with owner.txt emptied', async () => {
    const l = lockDir();
    const { a, release } = await holder(l);
    const w1 = wrap(l, 'w1', 1, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await w1.exited).code, 75);
    assert.match(w1.stderr, /timed out after 1s waiting for/);
    fs.writeFileSync(l.owner, '');
    const w2 = wrap(l, 'w2', 1, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await w2.exited).code, 75);
    assert.strictEqual(fs.existsSync(path.join(l.d, 'a-end')), false, 'holder ended early');
    release();
    assert.strictEqual((await a.exited).code, 0);
  });

  test('L-d an owner.txt rewritten with a dead pid does not grant the lock', async () => {
    const l = lockDir();
    const { a, release } = await holder(l);
    fs.writeFileSync(l.owner, JSON.stringify({ pid: 999999, label: 'ghost', start: '2000-01-01T00:00:00.000Z', command: 'x' }));
    const w = wrap(l, 'w', 1, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await w.exited).code, 75);
    release();
    assert.strictEqual((await a.exited).code, 0);
  });

  test('L-e a SIGKILLed holder is taken over within 2 s; a planted dead-pid lock file is taken over', async () => {
    const l = lockDir();
    const pidFile = path.join(l.d, 'child.pid');
    const a = wrap(l, 'a', 30, ['sh', '-c', `echo $$ > ${pidFile}; exec sleep 30`]);
    const childPid = Number(await waitFor(pidFile));
    await waitFor(l.lock);
    a.child.kill('SIGKILL');
    process.kill(childPid, 'SIGKILL');
    await a.exited;
    assert.strictEqual(fs.existsSync(l.lock), true, 'a killed wrapper leaves its lock file');
    const t0 = Date.now();
    const b = wrap(l, 'b', 10, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await b.exited).code, 0, b.stderr);
    assert.ok(Date.now() - t0 < 2000, `takeover took ${Date.now() - t0} ms`);

    const l2 = lockDir();
    fs.writeFileSync(l2.lock, JSON.stringify({ pid: 999999, label: 'ghost', start: 'x' }) + '\n');
    const c = wrap(l2, 'c', 10, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await c.exited).code, 0, c.stderr);
  });

  test('L-f six wrappers started at once never overlap, also when a dead-pid lock file is planted first', async () => {
    for (const planted of [false, true]) {
      const l = lockDir();
      if (planted) fs.writeFileSync(l.lock, JSON.stringify({ pid: 999999, label: 'ghost', start: 'x' }) + '\n');
      const runs = Array.from({ length: 6 }, (_, i) => wrap(l, `w${i}`, 60, stampCmd(l, `w${i}`, 150)));
      for (const r of runs) assert.strictEqual((await r.exited).code, 0, r.stderr);
      const iv = runs.map((_, i) => stamps(l, `w${i}`)).sort((x, y) => x.start - y.start);
      for (let i = 1; i < iv.length; i++) assert.ok(iv[i].start >= iv[i - 1].end, `overlap (planted=${planted}): ${JSON.stringify(iv)}`);
      assert.strictEqual(fs.existsSync(l.lock), false);
    }
  });

  for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    test(`L-g ${sig} to the wrapper reaches the child, exits ${code}, clears owner.txt, leaves no lock file`, async () => {
      const l = lockDir();
      const marker = path.join(l.d, 'got-signal');
      const started = path.join(l.d, 'started');
      const a = wrap(l, 'a', 30, [process.execPath, '-e', `
        const fs = require('fs');
        process.on(${JSON.stringify(sig)}, () => { fs.writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(0); });
        fs.writeFileSync(${JSON.stringify(started)}, 'x');
        setInterval(() => {}, 1000);
        setTimeout(() => process.exit(1), 40000);
      `]);
      await waitFor(started);
      a.child.kill(sig);
      const r = await Promise.race([a.exited, sleep(10000).then(() => 'hung')]);
      assert.notStrictEqual(r, 'hung', 'wrapper did not exit');
      assert.strictEqual(a.code, code);
      assert.ok(fs.existsSync(marker), 'child did not receive the signal');
      assert.strictEqual(fs.readFileSync(l.owner, 'utf8'), '');
      assert.strictEqual(fs.existsSync(l.lock), false);
    });
  }

  for (const [sig, code] of [['SIGHUP', 129], ['SIGQUIT', 131]]) {
    test(`L-m ${sig} to the wrapper reaches the child, exits ${code}, leaves no lock file`, async () => {
      const l = lockDir();
      const started = path.join(l.d, 'started');
      const marker = path.join(l.d, 'got-signal');
      const a = wrap(l, 'a', 30, [process.execPath, '-e', `
        const fs = require('fs');
        process.on(${JSON.stringify(sig)}, () => { fs.writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(0); });
        fs.writeFileSync(${JSON.stringify(started)}, 'x');
        setInterval(() => {}, 1000);
        setTimeout(() => process.exit(1), 40000);
      `]);
      await waitFor(started);
      a.child.kill(sig);
      const r = await Promise.race([a.exited, sleep(10000).then(() => 'hung')]);
      assert.notStrictEqual(r, 'hung', 'wrapper did not exit');
      assert.strictEqual(a.code, code);
      assert.ok(fs.existsSync(marker), 'child did not receive the signal');
      assert.strictEqual(fs.existsSync(l.lock), false);
    });
  }

  test('L-n a SIGKILLed wrapper whose command lives keeps the lock until the command exits; the lock file records the command pid', async () => {
    const l = lockDir();
    const rel = path.join(l.d, 'release');
    const pidFile = path.join(l.d, 'child.pid');
    const a = wrap(l, 'a', 30, [process.execPath, '-e', `
      const fs = require('fs');
      fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(rel)})) process.exit(0); }, 25);
      setTimeout(() => process.exit(1), 40000).unref();
    `]);
    const childPid = Number(await waitFor(pidFile));
    const end = Date.now() + 10000;
    let rec = {};
    while (Date.now() < end && rec.childPid !== childPid) {
      try { rec = JSON.parse(fs.readFileSync(l.lock, 'utf8')); } catch { /* being rewritten */ }
      await sleep(25);
    }
    assert.strictEqual(rec.childPid, childPid, 'lock file records the command pid');
    assert.strictEqual(rec.pid, a.child.pid);
    // 'close' would wait for the surviving command to release the inherited pipes; 'exit' is the wrapper alone.
    const wrapperGone = new Promise((r) => a.child.once('exit', r));
    a.child.kill('SIGKILL');
    await wrapperGone;
    assert.strictEqual(fs.existsSync(l.lock), true);
    const b = wrap(l, 'b', 1, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await b.exited).code, 75, 'the live command still holds the lock');
    fs.writeFileSync(rel, '');
    const gone = Date.now() + 10000;
    while (Date.now() < gone) { try { process.kill(childPid, 0); await sleep(25); } catch { break; } }
    const c = wrap(l, 'c', 10, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await c.exited).code, 0, c.stderr);
  });

  test('L-o classify counts the holder alive while either the wrapper pid or the command pid lives', async () => {
    const m = await import(pathToFileURL(LOCK_MJS).href);
    const now = Date.now();
    const dead = 999999;
    const rec = (o) => JSON.stringify({ label: 'x', start: 'x', ...o });
    assert.strictEqual(m.classify(rec({ pid: dead, childPid: process.pid }), now, now), 'alive');
    assert.strictEqual(m.classify(rec({ pid: process.pid, childPid: dead }), now, now), 'alive');
    assert.strictEqual(m.classify(rec({ pid: dead, childPid: dead }), now, now), 'dead');
    assert.strictEqual(m.classify(rec({ pid: dead }), now, now), 'dead');
  });

  test('L-p --timeout is honoured when the holder is dead and the takeover directory cannot be removed', async () => {
    const l = lockDir();
    fs.writeFileSync(l.lock, JSON.stringify({ pid: 999999, label: 'ghost', start: 'x' }) + '\n');
    fs.mkdirSync(`${l.lock}.takeover`);
    const t0 = Date.now();
    const w = wrap(l, 'w', 1, ['sh', '-c', 'exit 0']);
    assert.strictEqual((await w.exited).code, 75, w.stderr);
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  });

  test('L-h parseArgs, usage exit 2, child exit code passed through, spawn failure 127', async () => {
    const m = await import(pathToFileURL(LOCK_MJS).href);
    const ok = m.parseArgs(['--label', 'x', '--timeout', '5', '--lock-file', '/l', '--owner-file', '/o', '--', 'echo', 'hi']);
    assert.deepStrictEqual(ok, { ok: true, value: { label: 'x', timeout: 5, lockFile: '/l', ownerFile: '/o', cmd: ['echo', 'hi'] } });
    const dflt = m.parseArgs(['--label', 'x', '--', 'true']).value;
    assert.strictEqual(dflt.timeout, 3600);
    assert.strictEqual(path.basename(dflt.lockFile), 'stack.lock');
    assert.ok(path.basename(dflt.lockFile).startsWith('stack.lock'), 'matches the keep list glob stack.lock*');
    assert.ok(path.basename(path.dirname(dflt.ownerFile)).startsWith('stack.lock'), 'owner dir matches stack.lock*');
    assert.match(m.parseArgs(['--label', 'x']).error, /missing -- <command>/);
    assert.match(m.parseArgs(['--label', 'x', '--']).error, /empty command/);
    assert.match(m.parseArgs(['--', 'true']).error, /--label is required/);
    assert.match(m.parseArgs(['--label', 'x', '--timeout', '0', '--', 'true']).error, /positive integer/);
    assert.match(m.parseArgs(['--label', 'x', '--timeout', '1.5', '--', 'true']).error, /positive integer/);
    assert.match(m.parseArgs(['--bogus', '1', '--', 'true']).error, /unknown argument --bogus/);
    assert.match(m.parseArgs(['--label', '--', 'true']).error, /--label is required|requires a value/);
    assert.deepStrictEqual(m.ownerRecord(1, 'l', 's', 'c'), { pid: 1, label: 'l', start: 's', command: 'c' });
    assert.strictEqual(m.exitCodeFor(true, 3), 75);
    assert.strictEqual(m.exitCodeFor(false, 3), 3);

    const l = lockDir();
    const usage = spawnSync('sh', [LOCK_SH, '--label', 'x'], { encoding: 'utf8' });
    assert.strictEqual(usage.status, 2);
    assert.ok(usage.stderr.includes(m.USAGE), usage.stderr);
    const nolabel = spawnSync('sh', [LOCK_SH, '--', 'true'], { encoding: 'utf8' });
    assert.strictEqual(nolabel.status, 2);
    const pass = spawnSync('sh', wrapperArgs(l, 'x', 5, ['sh', '-c', 'exit 42']), { encoding: 'utf8' });
    assert.strictEqual(pass.status, 42);
    const missing = spawnSync('sh', wrapperArgs(l, 'x', 5, ['/nonexistent/gsd-no-such-command']), { encoding: 'utf8' });
    assert.strictEqual(missing.status, 127);
    assert.strictEqual(fs.existsSync(l.lock), false, 'lock released after a spawn failure');
  });

  test('L-j takeover unlinks the lock file only while it still holds the dead holder it was decided on; its directory is always removed', async () => {
    const m = await import(pathToFileURL(LOCK_MJS).href);
    const l = lockDir();
    const dead = JSON.stringify({ pid: 999999, label: 'ghost', start: 'x' }) + '\n';
    const live = JSON.stringify({ pid: process.pid, label: 'new', start: 'y' }) + '\n';
    fs.writeFileSync(l.lock, live);
    m.takeover(l.lock, dead);
    assert.strictEqual(fs.readFileSync(l.lock, 'utf8'), live, 'a lock file taken since the decision must stay');
    assert.strictEqual(fs.existsSync(`${l.lock}.takeover`), false);
    fs.writeFileSync(l.lock, dead);
    m.takeover(l.lock, dead);
    assert.strictEqual(fs.existsSync(l.lock), false);
    assert.strictEqual(fs.existsSync(`${l.lock}.takeover`), false);
    fs.writeFileSync(l.lock, live);
    fs.mkdirSync(`${l.lock}.takeover`);
    m.takeover(l.lock, dead);
    assert.strictEqual(fs.existsSync(`${l.lock}.takeover`), true, 'a fresh takeover directory means another waiter is working');
    const old = new Date(Date.now() - 20000);
    fs.utimesSync(`${l.lock}.takeover`, old, old);
    m.takeover(l.lock, dead);
    assert.strictEqual(fs.existsSync(`${l.lock}.takeover`), false, 'a takeover directory older than 10 s is removed');
  });

  test('L-k release unlinks the lock file only if it still holds this process pid', async () => {
    const l = lockDir();
    const { a, release } = await holder(l);
    const other = JSON.stringify({ pid: process.pid, label: 'taker', start: 'z' }) + '\n';
    fs.writeFileSync(l.lock, other);
    release();
    assert.strictEqual((await a.exited).code, 0);
    assert.strictEqual(fs.readFileSync(l.lock, 'utf8'), other, 'the holder removed a lock file that was not its own');
  });

  test('L-i the header of stack-lock.mjs states the three limits', () => {
    const head = fs.readFileSync(LOCK_MJS, 'utf8').split('\n').filter((x) => x.startsWith('//')).join('\n');
    assert.match(head, /recycled pid looks alive/);
    assert.match(head, /older than 10 s/);
    assert.match(head, /one machine and one pid namespace/);
  });
});

describe('session supervisor (agnostic-M-08 8.5)', () => {
  const SUP = path.join(SCRIPTS, 'session-supervisor.sh');
  // Line numbers cite presets/base/scripts/session-supervisor.sh.
  const setup = (resetOffsetS) => {
    const d = mkTmp('gsd-sup-');
    assert.strictEqual(spawnSync('git', ['init', '-q', d]).status, 0);
    const stub = path.join(d, 'gsd-tools-stub.js');
    // Stands in for `resilience parse-death`: the supervisor takes the reset time from the parser only.
    fs.writeFileSync(stub, `const off = ${JSON.stringify(resetOffsetS)};
      const iso = off === null ? '' : new Date(Date.now() + off * 1000).toISOString().replace(/\\.\\d+Z$/, 'Z');
      console.log(JSON.stringify({ is_death: true, reset_time_iso: iso || null, matched_pattern: 'session limit' }));`);
    const log = path.join(d, 'run.jsonl');
    const run = (args) => spawnSync('bash', [SUP, '--gsd-tools', stub, '--log', log, ...args], { cwd: d, encoding: 'utf8' });
    const events = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
    return { d, log, run, events };
  };
  const limitThenOk = ['sh', '-c', 'case "$*" in *--again*) exit 0;; *) echo "You have hit your usage limit"; exit 1;; esac', 'sh'];

  test('S-a --max-resumes 1 -- true exits 0 with one attempt (lines 297-300); a bad invocation exits 1 (lines 195, 199, 188)', () => {
    const t = setup(60);
    const r = t.run(['--max-resumes', '1', '--', 'true']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(t.events().map((e) => e.event), ['start', 'final']);
    assert.strictEqual(t.run(['--max-resumes', '1']).status, 1);
    assert.strictEqual(t.run(['--max-resumes', 'x', '--', 'true']).status, 1);
    assert.strictEqual(t.run(['--bogus', '--', 'true']).status, 1);
  });

  test('S-b a child failing for a non-limit reason returns exit 2 without a resume (lines 335-339)', () => {
    const t = setup(60);
    const r = t.run(['--max-resumes', '3', '--resume-flag', '--again', '--', 'sh', '-c', 'echo boom; exit 3']);
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    const ev = t.events();
    assert.deepStrictEqual(ev.map((e) => e.event), ['start', 'final']);
    assert.strictEqual(ev[1].outcome, 'failed_non_limit');
    assert.strictEqual(ev[1].child_rc, 3);
    assert.strictEqual(fs.existsSync(t.log.replace(/\.jsonl$/, '.attempt-2.output.log')), false);
  });

  test('S-c a limit death with a future reset waits (dry), resumes with the resume flag appended, and exits 0', () => {
    const t = setup(60);
    const r = t.run(['--max-resumes', '2', '--resume-flag', '--again', '--dry-run-wait', '--', ...limitThenOk]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(t.events().map((e) => e.event), ['start', 'limit_detected', 'wait_start', 'wait_end', 'resume', 'final']);
  });

  test('S-d the resume cap exits 4 (line 359); a missing or past reset time exits 3 (lines 367, 386)', () => {
    const capped = setup(60);
    const always = ['sh', '-c', 'echo "usage limit reached"; exit 1'];
    assert.strictEqual(capped.run(['--max-resumes', '1', '--dry-run-wait', '--', ...always]).status, 4);
    const none = setup(null);
    assert.strictEqual(none.run(['--max-resumes', '1', '--dry-run-wait', '--', ...always]).status, 3);
    const past = setup(-3600);
    assert.strictEqual(past.run(['--max-resumes', '1', '--dry-run-wait', '--', ...always]).status, 3);
  });

  test('S-e --cleanup-cmd runs before an attempt and once on exit, and its failure does not change the exit code', () => {
    const t = setup(60);
    const mark = path.join(t.d, 'cleanup.log');
    const r = t.run(['--cleanup-cmd', `echo x >> ${mark}; exit 9`, '--', 'true']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(fs.readFileSync(mark, 'utf8').trim().split('\n').length, 2);
  });
});

describe('pre-PR gate skeleton and disagreement log (agnostic-M-08 8.7)', () => {
  const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
  const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
  const git = (cwd, ...args) => {
    const r = spawnSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  // A project deployed by the engine from the base preset, committed, with the given commands and gates in its profile.
  const project = (commands, gates = []) => {
    const root = mkTmp('gsd-gate-');
    git(root, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities: {} } }));
    const init = spawnSync(process.execPath, [GSD_TOOLS, 'project', 'init', '--root', root, '--preset', 'base'], {
      encoding: 'utf8',
      env: { ...process.env, GSD_HOME: mkTmp('gsd-gate-home-') },
    });
    assert.strictEqual(init.status, 0, init.stdout + init.stderr);
    const cfgPath = path.join(root, '.planning', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.stack = { ...cfg.stack, commands: { ...(cfg.stack.commands || {}), ...commands }, gates };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'deploy');
    return root;
  };
  const GREEN = { typecheck: 'true', lint: 'true', test_all: 'true' };
  const runGate = (root) => spawnSync('sh', [path.join(root, 'scripts', 'pre-pr-gate.sh')], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const gitDirOf = (cwd) => git(cwd, 'rev-parse', '--absolute-git-dir').trim();
  const marker = (cwd) => path.join(gitDirOf(cwd), '.pre-pr-passed');
  const pushHook = (root) => spawnSync('bash', [path.join(root, '.claude', 'hooks', 'block-push-without-local-tests.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin feature/x' }, cwd: root }),
    encoding: 'utf8',
    cwd: root,
  });

  test('G-a all commands true: exit 0, the marker is in the git dir, no new untracked file, and the deployed push hook then allows a push', () => {
    const root = project(GREEN);
    assert.strictEqual(pushHook(root).status, 2, 'blocked before the gate ran');
    const r = runGate(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(marker(root)), 'marker in the git dir');
    assert.strictEqual(fs.existsSync(path.join(root, '.pre-pr-passed')), false, 'no marker in the working tree');
    assert.strictEqual(git(root, 'status', '--porcelain').trim(), '');
    const hook = pushHook(root);
    assert.strictEqual(hook.status, 0, hook.stderr);
  });

  test('G-b in a linked worktree the marker is in that worktree git dir and a push from the main worktree stays blocked', () => {
    const root = project(GREEN);
    const wt = path.join(mkTmp('gsd-gate-wt-'), 'lane');
    git(root, 'worktree', 'add', '-q', '-b', 'lane', wt);
    const r = runGate(wt);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(gitDirOf(wt).includes(`${path.sep}worktrees${path.sep}`), gitDirOf(wt));
    assert.ok(fs.existsSync(marker(wt)), 'marker in the worktree git dir');
    assert.strictEqual(fs.existsSync(marker(root)), false, 'none in the main git dir');
    assert.strictEqual(pushHook(root).status, 2, 'main worktree push still blocked');
    assert.strictEqual(pushHook(wt).status, 0, 'worktree push allowed');
  });

  test('G-c an unset command fails the gate, names stack.commands.lint, runs nothing and writes no marker', () => {
    const root = project({ typecheck: 'touch ran-typecheck', test_all: 'true' });
    const cfgPath = path.join(root, '.planning', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    delete cfg.stack.commands.lint;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    const r = runGate(root);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout, /NOT CONFIGURED: stack\.commands\.lint/);
    assert.strictEqual(fs.existsSync(marker(root)), false);
    assert.strictEqual(fs.existsSync(path.join(root, 'ran-typecheck')), false, 'nothing ran before the gap was reported');
  });

  test('G-n acknowledged none (null or "none") is skipped with a visible warning, never run, and the summary says not configured', () => {
    for (const commands of [
      { typecheck: 'none', lint: 'true', test_all: 'true' },
      { typecheck: 'true', lint: null, test_all: 'true' },
      { typecheck: 'true', lint: 'true', test_all: 'none' },
    ]) {
      const root = project(commands);
      const r = runGate(root);
      const key = Object.keys(commands).find((k) => commands[k] === null || commands[k] === 'none');
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`WARNING: stack\\.commands\\.${key} is not configured yet`));
      assert.match(r.stdout, /PASSED, BUT NOT CONFIGURED \(skipped\):/);
      assert.doesNotMatch(r.stdout, /ALL CHECKS PASSED/);
      assert.doesNotMatch(r.stdout, new RegExp(`PASS .*stack\\.commands\\.${key}\\)`));
    }
  });

  test('G-d test_all passing once and failing the second time fails the gate, writes no marker and appends one log line', () => {
    const root = project({ ...GREEN, test_all: 'if [ -f seen ]; then exit 1; else touch seen; fi' });
    const r = runGate(root);
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.strictEqual(fs.existsSync(marker(root)), false);
    const log = fs.readFileSync(path.join(root, '.planning', 'pre-pr-disagreements.jsonl'), 'utf8').trim().split('\n');
    assert.strictEqual(log.length, 1);
    const row = JSON.parse(log[0]);
    assert.deepStrictEqual([row.stage, row.run1, row.run2, row.run2_exit], ['test_all', 'pass', 'fail', 1]);
  });

  test('G-e a stack.gates entry whose run exits 1 fails the gate and writes no marker; a stale marker from an earlier green run is removed', () => {
    const root = project(GREEN, [{ id: 'style', run: 'exit 1' }]);
    fs.writeFileSync(marker(root), 'stale');
    const r = runGate(root);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout, /FAIL {2}gate style/);
    assert.strictEqual(fs.existsSync(marker(root)), false);
  });

  test('G-e2 a gate that reads stdin cannot swallow the remaining gates: reads-stdin then failing gate fails with no marker; a passing stdin reader still PASSes', () => {
    const root = project(GREEN, [{ id: 'a', run: 'cat >/dev/null' }, { id: 'b', run: 'false' }]);
    const r = runGate(root);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS {2}gate a/);
    assert.match(r.stdout, /FAIL {2}gate b/);
    assert.strictEqual(fs.existsSync(marker(root)), false);
    const ok = project(GREEN, [{ id: 'a', run: 'cat >/dev/null' }]);
    const r2 = runGate(ok);
    assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /PASS {2}gate a/);
  });

  test('G-g a malformed stack.gates entry or a non-array stack.gates fails as NOT CONFIGURED and writes no marker', () => {
    const bad = [
      [{ id: 'sec', cmd: 'exit 1' }],
      [{ id: 'sec', run: '' }],
      [{ id: '', run: 'exit 1' }],
      [{ run: 'true' }],
      ['true'],
      [null],
      { sec: { id: 'sec', run: 'exit 1' } },
      'true',
    ];
    for (const gates of bad) {
      const root = project(GREEN, gates);
      const r = runGate(root);
      const label = JSON.stringify(gates);
      assert.strictEqual(r.status, 1, `${label}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout + r.stderr, /NOT CONFIGURED: stack\.gates/, label);
      assert.doesNotMatch(r.stdout, /Marker written/, label);
      assert.strictEqual(fs.existsSync(marker(root)), false, label);
    }
  });

  test('G-h well-formed stack.gates entries still run and an absent stack.gates is no gate', () => {
    const ok = project(GREEN, [{ id: 'style', run: 'true' }]);
    const r = runGate(ok);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS {2}gate style/);
    const none = project(GREEN);
    const cfgPath = path.join(none, '.planning', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    delete cfg.stack.gates;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    assert.strictEqual(runGate(none).status, 0);
  });

  test('G-i the disagreement log never fails its caller and never writes an empty record: a dangling flag or missing required flags exit 0 under sh and dash', () => {
    const script = path.join(SCRIPTS, 'log-pre-pr-disagreement.sh');
    const shells = ['sh', ...(fs.existsSync('/bin/dash') ? ['/bin/dash'] : [])];
    for (const shell of shells) {
      for (const args of [['--stage'], ['--stage', 's', '--run1', 'pass', '--run2'], [], ['--stage', 's', '--run1', 'pass'], ['--bogus']]) {
        const log = path.join(mkTmp('gsd-gatelog-'), 'log.jsonl');
        const r = spawnSync(shell, [script, ...args], { encoding: 'utf8', timeout: 3000, env: { ...process.env, PRE_PR_DISAGREEMENT_LOG: log } });
        const label = `${shell} ${args.join(' ')}`;
        assert.strictEqual(r.status, 0, `${label}: ${r.stderr}`);
        assert.strictEqual(fs.existsSync(log), false, `${label}: no record written`);
        assert.strictEqual(r.stdout + r.stderr, '', label);
      }
      const log = path.join(mkTmp('gsd-gatelog-'), 'log.jsonl');
      const ok = spawnSync(shell, [script, '--stage', 's', '--run1', 'pass', '--run2', 'fail', '--run2-exit', '1'], { encoding: 'utf8', timeout: 3000, env: { ...process.env, PRE_PR_DISAGREEMENT_LOG: log } });
      assert.strictEqual(ok.status, 0);
      assert.strictEqual(JSON.parse(fs.readFileSync(log, 'utf8')).stage, 's');
    }
  });

  test('G-j every deployed script that starts with a shebang is executable, ci-diagnose.mjs included', () => {
    const root = project(GREEN);
    const scripts = path.join(root, 'scripts');
    const shebang = (f) => fs.readFileSync(f, 'utf8').startsWith('#!');
    const files = fs.readdirSync(scripts).map((f) => path.join(scripts, f)).filter((f) => fs.statSync(f).isFile() && shebang(f));
    assert.ok(files.some((f) => f.endsWith('ci-diagnose.mjs')));
    for (const f of files) assert.ok((fs.statSync(f).mode & 0o111) !== 0, `executable: ${path.basename(f)}`);
  });

  test('G-f the disagreement log appends, never truncates, and exits 0 on an unwritable path', () => {
    const d = mkTmp('gsd-gatelog-');
    const log = path.join(d, 'log.jsonl');
    const script = path.join(SCRIPTS, 'log-pre-pr-disagreement.sh');
    const run = (args, env) => spawnSync('sh', [script, ...args], { cwd: d, encoding: 'utf8', env: { ...process.env, ...env } });
    for (const stage of ['a', 'b']) {
      const r = run(['--stage', stage, '--run1', 'pass', '--run2', 'fail', '--run2-exit', '7', '--failing-tests', 'x\ny,z'], { PRE_PR_DISAGREEMENT_LOG: log });
      assert.strictEqual(r.status, 0, r.stderr);
    }
    const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(rows.map((x) => x.stage), ['a', 'b']);
    assert.deepStrictEqual(rows[0].failing_tests, ['x', 'y', 'z']);
    assert.strictEqual(rows[0].run2_exit, 7);
    assert.strictEqual(run(['--stage', 'a'], { PRE_PR_DISAGREEMENT_LOG: path.join(d, 'no', 'such', 'dir', 'l') }).status, 0);
  });
});

describe('canary gate, guard registry and sample guard (agnostic-M-08 8.8)', () => {
  const VALIDATION = path.join(SCRIPTS, 'validation');
  const GATE = 'canary-gate.mjs';
  // The deployed layout is scripts/validation/ next to everything the gate imports; copy it to a tmp project.
  const deployed = () => {
    const root = mkTmp('gsd-canary-');
    const dir = path.join(root, 'scripts', 'validation');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['canary-gate.mjs', 'guard-registry.mjs']) fs.copyFileSync(path.join(VALIDATION, f), path.join(dir, f));
    for (const sub of ['guards', 'canaries']) {
      fs.mkdirSync(path.join(dir, sub));
      for (const f of fs.readdirSync(path.join(VALIDATION, sub))) fs.copyFileSync(path.join(VALIDATION, sub, f), path.join(dir, sub, f));
    }
    // The style-gate corpus imports the gate's scan modules and reads its rule set.
    fs.cpSync(path.join(SCRIPTS, 'style-gate'), path.join(root, 'scripts', 'style-gate'), { recursive: true });
    return dir;
  };
  const gate = (dir, ...args) => spawnSync(process.execPath, [path.join(dir, GATE), ...args], { encoding: 'utf8' });
  const corpusOf = (dir, id) => path.join(dir, 'canaries', `${id}.canaries.mjs`);
  const mod = () => import(pathToFileURL(path.join(VALIDATION, GATE)).href);

  test('C-a the deployed gate exits 0 and reports the sample guard with three fixtures', () => {
    const r = gate(deployed());
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /sample-guard: 3 fixture\(s\)/);
    assert.strictEqual(JSON.parse(gate(deployed(), '--json').stdout).missedFixtures.length, 0);
  });

  test('C-b two fixtures left names the id as undersized; a detect returning false and one that throws name their fixture', () => {
    const dir = deployed();
    const file = corpusOf(dir, 'sample-guard');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace(/\n  \{ name: 'tab on a CRLF line'.*\n/, '\n'));
    const small = gate(dir);
    assert.notStrictEqual(small.status, 0);
    assert.match(small.stdout, /UNDERSIZED sample-guard: only 2 fixture\(s\)/);
    fs.writeFileSync(file, original.replace("detect: () => hasTab('\\tconst x = 1;\\n')", 'detect: () => false').replace("detect: () => hasTab('const x =\\t1;\\n')", "detect: () => { throw new Error('boom'); }"));
    const bad = gate(dir);
    assert.notStrictEqual(bad.status, 0);
    assert.match(bad.stdout, /\[sample-guard\] "leading tab": reported clean/);
    assert.match(bad.stdout, /\[sample-guard\] "tab inside a line": detect\(\) threw: boom/);
  });

  test('C-c a registry id without a corpus file fails naming the id; a corpus file without a registry id prints PHANTOM and keeps the exit code', () => {
    const dir = deployed();
    const reg = path.join(dir, 'guard-registry.mjs');
    fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace('];\n\nconst ID_RE', "  { id: 'no-corpus', guard: 'g', prevents: 'p', implementedIn: 'scripts/validation/guards/sample-guard.mjs' },\n];\n\nconst ID_RE"));
    const missing = gate(dir);
    assert.notStrictEqual(missing.status, 0);
    assert.match(missing.stdout, /UNREADABLE no-corpus: missing corpus file canaries\/no-corpus\.canaries\.mjs/);
    fs.copyFileSync(corpusOf(dir, 'sample-guard'), corpusOf(dir, 'no-corpus'));
    assert.strictEqual(gate(dir).status, 0);
    fs.copyFileSync(corpusOf(dir, 'sample-guard'), corpusOf(dir, 'stale-id'));
    const phantom = gate(dir);
    assert.strictEqual(phantom.status, 0, phantom.stdout);
    assert.match(phantom.stdout, /PHANTOM stale-id/);
    fs.writeFileSync(corpusOf(dir, 'no-corpus'), 'export const NOT_CANARIES = [];\n');
    assert.match(gate(dir).stdout, /UNREADABLE no-corpus: CANARIES missing/);
    fs.writeFileSync(corpusOf(dir, 'no-corpus'), 'throw new Error("syntax");\n');
    assert.match(gate(dir).stdout, /UNREADABLE no-corpus: import failed: syntax/);
  });

  test('C-d a duplicate registry id or an id that is not a slug fails the gate', () => {
    const dir = deployed();
    const reg = path.join(dir, 'guard-registry.mjs');
    const row = "  { id: 'sample-guard', guard: 'g', prevents: 'p', implementedIn: 'x' },\n";
    fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace('];\n\nconst ID_RE', `${row}];\n\nconst ID_RE`));
    const dup = gate(dir);
    assert.notStrictEqual(dup.status, 0);
    assert.match(dup.stdout, /REGISTRY INVALID: duplicate id sample-guard/);
    fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace(row, "  { id: '../x', guard: 'g', prevents: 'p', implementedIn: 'x' },\n"));
    assert.match(gate(dir).stdout, /not a lower-case slug/);
  });

  // Ports of canary-gate.test.ts (igaming scripts/validation): cases at :41, :50, :63, :72, :85, :104, :110, :116.
  test('C-e evaluateCanaries, reconcileCorpusCoverage and exitCodeFor give the source results on the source fixtures', async () => {
    const { evaluateCanaries, reconcileCorpusCoverage, exitCodeFor, MIN_FIXTURES_PER_GUARD } = await mod();
    const canary = (o = {}) => ({ guardId: 'g1', name: 'fixture canary', why: 'fixture why', detect: () => true, ...o });
    const clean = (ids) => ids.flatMap((guardId) => [0, 1, 2].map((i) => canary({ guardId, name: `${guardId} fixture ${i}` })));
    const THREE = ['g1', 'g2', 'g3'];
    const empty = { missedFixtures: [], uncoveredGuards: [], undersizedCorpora: [] };
    // :41
    assert.deepStrictEqual(evaluateCanaries(clean(THREE), THREE), empty);
    assert.strictEqual(exitCodeFor(empty), 0);
    // :50
    const corpus = clean(THREE);
    const blinded = corpus.map((c, i) => (i === 4 ? { ...c, detect: () => false } : c));
    const missed = evaluateCanaries(blinded, THREE);
    assert.deepStrictEqual(missed.missedFixtures, [{ guardId: blinded[4].guardId, name: blinded[4].name, why: blinded[4].why, reason: 'reported clean' }]);
    assert.strictEqual(exitCodeFor(missed), 1);
    // :63
    const uncovered = evaluateCanaries(clean(['g1', 'g2']), THREE);
    assert.deepStrictEqual([uncovered.missedFixtures, uncovered.uncoveredGuards, uncovered.undersizedCorpora], [[], ['g3'], []]);
    assert.strictEqual(exitCodeFor(uncovered), 1);
    // :72
    const under = evaluateCanaries([...clean(['g1']), canary({ guardId: 'g2', name: 'g2 only fixture' })], ['g1', 'g2']);
    assert.deepStrictEqual(under.undersizedCorpora, [{ guardId: 'g2', count: 1 }]);
    assert.strictEqual(exitCodeFor(under), 1);
    assert.strictEqual(MIN_FIXTURES_PER_GUARD, 3);
    // :85
    const throwing = clean(THREE).map((c, i) => (i === 0 ? { ...c, detect: () => { throw new Error('boom — guard crashed on its own canary'); } } : c));
    const thrown = evaluateCanaries(throwing, THREE);
    assert.strictEqual(thrown.missedFixtures.length, 1);
    assert.ok(thrown.missedFixtures[0].reason.includes('boom — guard crashed on its own canary'));
    assert.strictEqual(exitCodeFor(thrown), 1);
    // :104, :110
    assert.deepStrictEqual(reconcileCorpusCoverage(['g1', 'g1', 'g10'], ['g1', 'g2']), { uncoveredGuards: ['g2'], phantomCorpusIds: ['g10'] });
    assert.deepStrictEqual(reconcileCorpusCoverage(['g1', 'g2'], ['g1', 'g2']), { uncoveredGuards: [], phantomCorpusIds: [] });
    // :116, plus the two fields the base gate adds
    assert.strictEqual(exitCodeFor({ ...empty, missedFixtures: [{ guardId: 'g1', name: 'n', why: 'w', reason: 'reported clean' }] }), 1);
    assert.strictEqual(exitCodeFor({ ...empty, uncoveredGuards: ['g5'] }), 1);
    assert.strictEqual(exitCodeFor({ ...empty, undersizedCorpora: [{ guardId: 'g5', count: 2 }] }), 1);
    assert.strictEqual(exitCodeFor({ ...empty, unreadableCorpora: [{ guardId: 'g5', reason: 'x' }] }), 1);
    assert.strictEqual(exitCodeFor({ ...empty, registryProblems: ['x'] }), 1);
  });

  test('C-g a detect that returns anything other than the boolean true is a miss, so three non-true canaries cannot pass the gate', () => {
    const dir = deployed();
    const file = corpusOf(dir, 'sample-guard');
    const original = fs.readFileSync(file, 'utf8');
    const variants = [
      ['false', 'detect: () => false'],
      ["'no'", "detect: () => 'no'"],
      ['undefined', 'detect: () => undefined'],
      ['a truthy string', "detect: () => 'flagged'"],
      ['a promise', 'detect: async () => true'],
    ];
    for (const [label, repl] of variants) {
      fs.writeFileSync(file, original.replace(/detect: \(\) => hasTab\([^\n]*\) \}/g, `${repl} }`));
      const r = gate(dir);
      assert.strictEqual(r.status, 1, `${label}: ${r.stdout}`);
      assert.match(r.stdout, /FAILED: the following guard/, label);
    }
    assert.match(gate(dir).stdout, /did not return true|returned a promise/, 'the reason names the contract');
    fs.writeFileSync(file, original);
    assert.strictEqual(gate(dir).status, 0);
  });

  test('C-h an empty registry (the sample guard deleted with its corpus) passes and says nothing is registered', () => {
    const dir = deployed();
    const reg = path.join(dir, 'guard-registry.mjs');
    fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace(/export const GUARD_REGISTRY = \[[\s\S]*?\n\];\n\nconst ID_RE/, 'export const GUARD_REGISTRY = [];\n\nconst ID_RE'));
    fs.rmSync(corpusOf(dir, 'sample-guard'));
    const r = gate(dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /nothing registered/);
    assert.doesNotMatch(r.stdout, /every guard still fails every fixture/);
  });

  test('C-f the sample guard flags a tab and passes a clean file; its CLI exits 1 on a tab', () => {
    const d = mkTmp('gsd-sample-');
    fs.writeFileSync(path.join(d, 'bad.txt'), 'a\tb\n');
    fs.writeFileSync(path.join(d, 'ok.txt'), 'a b\n');
    const guard = path.join(VALIDATION, 'guards', 'sample-guard.mjs');
    assert.strictEqual(spawnSync(process.execPath, [guard, path.join(d, 'ok.txt')]).status, 0);
    assert.strictEqual(spawnSync(process.execPath, [guard, path.join(d, 'ok.txt'), path.join(d, 'bad.txt')]).status, 1);
  });
});

describe('guard registry reconcile (agnostic-M-08 8.9)', () => {
  const PRESET = path.join(SCRIPTS, '..');
  const RECONCILE = 'guard-registry-reconcile.mjs';
  // The deployed layout: scripts/validation/*, docs/gsd/guard-estate.md and the file the registry points at.
  const deployed = () => {
    const root = mkTmp('gsd-reconcile-');
    const dir = path.join(root, 'scripts', 'validation');
    fs.mkdirSync(path.join(dir, 'guards'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'gsd'), { recursive: true });
    for (const f of [RECONCILE, 'guard-registry.mjs']) fs.copyFileSync(path.join(SCRIPTS, 'validation', f), path.join(dir, f));
    fs.copyFileSync(path.join(SCRIPTS, 'validation', 'guards', 'sample-guard.mjs'), path.join(dir, 'guards', 'sample-guard.mjs'));
    fs.copyFileSync(path.join(PRESET, 'docs', 'guard-estate.md'), path.join(root, 'docs', 'gsd', 'guard-estate.md'));
    fs.copyFileSync(path.join(SCRIPTS, 'style-gate.mjs'), path.join(root, 'scripts', 'style-gate.mjs'));
    return { root, dir, doc: path.join(root, 'docs', 'gsd', 'guard-estate.md'), reg: path.join(dir, 'guard-registry.mjs') };
  };
  const run = (d) => spawnSync(process.execPath, [path.join(d.dir, RECONCILE)], { encoding: 'utf8' });
  const mod = () => import(pathToFileURL(path.join(SCRIPTS, 'validation', RECONCILE)).href);
  const STYLE_ROW = '| style-gate | Style ratchet: no new throw, input mutation, oversize file or duplicated block | Error-by-exception, in-place mutation, god files and copied logic reaching review | scripts/style-gate.mjs |';
  const ROW = '| sample-guard | No tab character in a checked file | Mixed tab and space indentation reaching review | scripts/validation/guards/sample-guard.mjs |';

  test('R-a the deployed registry and document agree: exit 0', () => {
    const r = run(deployed());
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /2 registry row\(s\), 2 document row\(s\)/);
  });

  test('R-b a row with no doc row, a doc row with no registry row, a differing cell and a missing implementedIn path are each named', () => {
    const d = deployed();
    const regSrc = fs.readFileSync(d.reg, 'utf8');
    const extraRow = "  { id: 'only-registry', guard: 'g', prevents: 'p', implementedIn: 'scripts/validation/guards/missing.mjs' },\n];\n\nconst ID_RE";
    fs.writeFileSync(d.reg, regSrc.replace('];\n\nconst ID_RE', extraRow));
    const docSrc = fs.readFileSync(d.doc, 'utf8');
    fs.writeFileSync(d.doc, docSrc.replace(ROW, `${ROW.replace('Mixed tab and space', 'Something else')}\n| only-doc | g | p | scripts/validation/guards/sample-guard.mjs |`));
    const r = run(d);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout, /MISSING DOC ROW only-registry/);
    assert.match(r.stdout, /PHANTOM DOC ROW only-doc/);
    assert.match(r.stdout, /DIVERGENT sample-guard\.prevents: doc "Something else indentation reaching review"/);
    assert.match(r.stdout, /MISSING PATH only-registry: scripts\/validation\/guards\/missing\.mjs does not exist/);
  });

  test('R-c a missing document and a missing heading both fail; a phantom guard reference fails', () => {
    const d = deployed();
    const original = fs.readFileSync(d.doc, 'utf8');
    fs.writeFileSync(d.doc, original.replace('## Machine-enforced guards', '## Guards'));
    const noHeading = run(d);
    assert.notStrictEqual(noHeading.status, 0);
    assert.match(noHeading.stdout, /TABLE NOT FOUND/);
    fs.writeFileSync(d.doc, `${original}\nSee \`guard:ghost\`.\n`);
    const ghost = run(d);
    assert.notStrictEqual(ghost.status, 0);
    assert.match(ghost.stdout, /PHANTOM REFERENCE guard:ghost/);
    fs.rmSync(d.doc);
    const noDoc = run(d);
    assert.notStrictEqual(noDoc.status, 0);
    assert.match(noDoc.stdout, /DOCUMENT MISSING: docs\/gsd\/guard-estate\.md/);
  });

  // Ports of guard-registry-reconcile.test.ts (igaming scripts/validation): cases at :85, :95, :111, :123, :132, :168 (path
  // extraction replaced by the bare-path registry cell), :180, :268, :276, :288, :310, :322, :329. Dropped with the live
  // export and the matrix: :148, :157 (notInLiveAllGuards), :336-:369 (FM matrix), the real-document cases.
  test('R-e the documented deletion of the sample guard (registry row, doc row, guard file) leaves an empty registry that passes', () => {
    const d = deployed();
    fs.writeFileSync(d.reg, fs.readFileSync(d.reg, 'utf8').replace(/export const GUARD_REGISTRY = \[[\s\S]*?\n\];\n\nconst ID_RE/, 'export const GUARD_REGISTRY = [];\n\nconst ID_RE'));
    fs.writeFileSync(d.doc, fs.readFileSync(d.doc, 'utf8').replace(ROW + '\n', '').replace(STYLE_ROW + '\n', ''));
    fs.rmSync(path.join(d.dir, 'guards', 'sample-guard.mjs'));
    const r = run(d);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 registry row\(s\), 0 document row\(s\)/);
    assert.match(r.stdout, /nothing registered/);
    // The heading and header are still required: without them the empty state is not accepted.
    fs.writeFileSync(d.doc, fs.readFileSync(d.doc, 'utf8').replace('## Machine-enforced guards', '## Other'));
    const gone = run(d);
    assert.strictEqual(gone.status, 1);
    assert.match(gone.stdout, /TABLE NOT FOUND/);
  });

  test('R-f a document row with five cells is reported, and an implementedIn that is a directory is a missing path', () => {
    const d = deployed();
    fs.writeFileSync(d.doc, fs.readFileSync(d.doc, 'utf8').replace(ROW, `${ROW}\n| ghost | g | p | scripts/validation/guards/sample-guard.mjs | extra |`));
    const five = run(d);
    assert.strictEqual(five.status, 1, five.stdout);
    assert.match(five.stdout, /MALFORMED DOC ROW.*ghost/);
    const e = deployed();
    const src = fs.readFileSync(e.reg, 'utf8').replace("implementedIn: 'scripts/validation/guards/sample-guard.mjs'", "implementedIn: 'scripts/validation'");
    fs.writeFileSync(e.reg, src);
    fs.writeFileSync(e.doc, fs.readFileSync(e.doc, 'utf8').replace('guards/sample-guard.mjs |', 'XX |').replace('scripts/validation/XX', 'scripts/validation'));
    const dir = run(e);
    assert.strictEqual(dir.status, 1, dir.stdout);
    assert.match(dir.stdout, /MISSING PATH sample-guard: scripts\/validation does not exist or is not a file/);
  });

  test('R-d parseTableByHeading, parseGuardTable, reconcile, exitCodeFor and scanGuardIdReferences give the source results on the source fixtures', async () => {
    const { parseTableByHeading, parseGuardTable, reconcile, exitCodeFor, scanGuardIdReferences, missingImplementations } = await mod();
    const doc = (rows) => [
      '# Some heading', '', 'Some prose before the table.', '', '## Machine-enforced guards', '', 'Prevention, not detection.', '',
      '| ID | Guard | Prevents | Implemented in |', '| --- | --- | --- | --- |',
      ...rows.map(([id, g, p, i]) => `| ${id} | ${g} | ${p} | ${i} |`),
      '', '## Next section', '', 'Prose after the table: parsing must stop at the first non-`|`-prefixed line.',
    ].join('\n');
    const NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`g${n}`, `Guard ${n} text`, `Prevents ${n}`, `scripts/validation/guard-${n}.mjs`]);
    const registry = NINE.map(([id, guard, prevents, implementedIn]) => ({ id, guard, prevents, implementedIn }));
    const empty = { phantomDocRows: [], missingDocRows: [], divergentFields: [] };
    // :85 and :310
    const rows = parseGuardTable(doc(NINE));
    assert.strictEqual(rows.length, 9);
    assert.deepStrictEqual(rows[0], { id: 'g1', guard: 'Guard 1 text', prevents: 'Prevents 1', implementedIn: 'scripts/validation/guard-1.mjs' });
    assert.strictEqual(rows[8].id, 'g9');
    // :95
    assert.deepStrictEqual(reconcile(rows, registry), empty);
    assert.strictEqual(exitCodeFor(empty), 0);
    // :111
    const phantom = reconcile(parseGuardTable(doc([...NINE, ['g10', 'Phantom', 'Phantom prevents', 'scripts/validation/phantom.mjs']])), registry);
    assert.deepStrictEqual(phantom.phantomDocRows, ['g10']);
    assert.strictEqual(exitCodeFor(phantom), 1);
    // :123
    const missing = reconcile(parseGuardTable(doc(NINE.filter(([id]) => id !== 'g9'))), registry);
    assert.deepStrictEqual(missing.missingDocRows, ['g9']);
    assert.strictEqual(exitCodeFor(missing), 1);
    // :132
    const divergent = reconcile(rows, registry.map((e) => (e.id === 'g3' ? { ...e, prevents: 'A DIFFERENT prevents text' } : e)));
    assert.deepStrictEqual(divergent.divergentFields, [{ id: 'g3', field: 'prevents', docValue: 'Prevents 3', registryValue: 'A DIFFERENT prevents text' }]);
    assert.strictEqual(exitCodeFor(divergent), 1);
    // :180 plus the two fields the base reconcile adds
    assert.strictEqual(exitCodeFor({ ...empty, missingDocRows: ['g9'] }), 1);
    assert.strictEqual(exitCodeFor({ ...empty, divergentFields: [{ id: 'g1', field: 'guard', docValue: 'a', registryValue: 'b' }] }), 1);
    assert.strictEqual(exitCodeFor({ ...empty, missingPaths: [{ id: 'g1', path: 'x' }] }), 1);
    assert.strictEqual(exitCodeFor({ ...empty, phantomReferences: ['g99'] }), 1);
    // :276, :288
    const matrix = [
      '# T', '', '| FM | other table | x | y | z |', '| --- | --- | --- | --- | --- |', '| FM-X | a | b | c | d |', '',
      '## FM coverage matrix', '',
      '| FM | Failure mode | Preventive mechanism(s) | Detective mechanism(s) | Evidence artifact(s) |', '| --- | --- | --- | --- | --- |',
      '| FM-A | Shape/key mismatch | Preventive A | Detective A | Evidence A |',
      '| FM-B | Value-set mismatch | only 3 cells |',
      '| FM-C | Unit/scale | Preventive C | Detective C | Evidence C |', '', '## Next', '',
    ].join('\n');
    const opts = { heading: '## FM coverage matrix', idHeaderPrefix: '| FM', cellCount: 5 };
    const five = parseTableByHeading(matrix, opts);
    assert.deepStrictEqual(five.map((r) => r.id), ['FM-A', 'FM-C']);
    assert.deepStrictEqual(five[0].cells, ['FM-A', 'Shape/key mismatch', 'Preventive A', 'Detective A', 'Evidence A']);
    assert.deepStrictEqual(parseTableByHeading('# No table here\n\njust prose\n', opts), []);
    assert.deepStrictEqual(parseTableByHeading(['# T', '', '## FM coverage matrix', '', '| not the header |', '| --- |', '| x |'].join('\n'), opts), []);
    // :268, :322, :329 (the source's gN tokens become guard:<id> tokens)
    const ids = ['g11', 'g12', 'g13'];
    assert.deepStrictEqual(scanGuardIdReferences('Detective: `guard:g11` diff; backstop `guard:g99` (documented-but-absent).', ids), { referenced: ['g11', 'g99'], phantom: ['g99'] });
    assert.deepStrictEqual(scanGuardIdReferences('Detective: `guard:g11` diff; preventive: `guard:g12` lint.', ids), { referenced: ['g11', 'g12'], phantom: [] });
    assert.deepStrictEqual(scanGuardIdReferences('Plain g11, guard:g11 without backticks, `G11`, and backticked `guard:g13`.', ids), { referenced: ['g13'], phantom: [] });
    // the on-disk check applies to every id
    assert.deepStrictEqual(missingImplementations('/r', registry, (p) => p !== '/r/scripts/validation/guard-2.mjs'), [{ id: 'g2', path: 'scripts/validation/guard-2.mjs' }]);
  });
});

describe('CI diagnose, Node port (agnostic-M-08 8.10)', () => {
  const CI_DIAGNOSE = path.join(SCRIPTS, 'ci-diagnose.mjs');
  const loadCi = () => import(pathToFileURL(CI_DIAGNOSE).href);
  // Without tokens, every refusal below happens before the first network call.
  const runCi = (args, extraEnv = {}) => {
    const env = { PATH: process.env.PATH, ...extraEnv };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    if (extraEnv.GH_TOKEN) env.GH_TOKEN = extraEnv.GH_TOKEN;
    return spawnSync(process.execPath, [CI_DIAGNOSE, ...args], { encoding: 'utf8', env, timeout: 15000 });
  };

  test('D-a parseRunResponse: a completed failure parses; an in-progress run is valid; malformed input is { error }', async () => {
    const { parseRunResponse } = await loadCi();
    assert.deepStrictEqual(parseRunResponse({ conclusion: 'failure', status: 'completed', head_sha: 'abc1234def5678' }),
      { conclusion: 'failure', status: 'completed', headSha: 'abc1234def5678' });
    assert.deepStrictEqual(parseRunResponse({ conclusion: null, status: 'in_progress', head_sha: 'abc1234def5678' }),
      { conclusion: null, status: 'in_progress', headSha: 'abc1234def5678' });
    assert.ok('error' in parseRunResponse({}));
    assert.ok('error' in parseRunResponse('not an object'));
    assert.ok('error' in parseRunResponse(null));
  });

  test('D-b parseJobsResponse keeps mixed conclusions in order; an empty or missing jobs array is []', async () => {
    const { parseJobsResponse } = await loadCi();
    const json = { jobs: [{ id: 1, name: 'Unit Tests', conclusion: 'success' }, { id: 2, name: 'Integration Tests', conclusion: 'failure' }, { id: 3, name: 'Lint', conclusion: 'cancelled' }] };
    assert.deepStrictEqual(parseJobsResponse(json), [
      { id: 1, name: 'Unit Tests', conclusion: 'success' }, { id: 2, name: 'Integration Tests', conclusion: 'failure' }, { id: 3, name: 'Lint', conclusion: 'cancelled' },
    ]);
    assert.deepStrictEqual(parseJobsResponse({ jobs: [] }), []);
    assert.deepStrictEqual(parseJobsResponse({}), []);
    assert.deepStrictEqual(parseJobsResponse(null), []);
  });

  test('D-c extractFailingTestLines, classifyLogsAvailability and resolveRunIdFromSha give the source results', async () => {
    const { extractFailingTestLines, classifyLogsAvailability, resolveRunIdFromSha } = await loadCi();
    const log = ['running 3 tests', 'test setup ok', 'FAILED my_cool_test', 'some debug info line', 'error: AssertionError: expected true, got false', 'test finished'].join('\n');
    assert.deepStrictEqual(extractFailingTestLines(log), ['FAILED my_cool_test', 'error: AssertionError: expected true, got false']);
    assert.deepStrictEqual(extractFailingTestLines('running 3 tests\nall tests passed'), []);
    assert.deepStrictEqual(classifyLogsAvailability(410), { available: false, reason: 'expired', httpStatus: 410 });
    assert.deepStrictEqual(classifyLogsAvailability(404), { available: false, reason: 'not_found', httpStatus: 404 });
    assert.deepStrictEqual(classifyLogsAvailability(200), { available: true });
    assert.deepStrictEqual(classifyLogsAvailability(500), { available: false, reason: 'other', httpStatus: 500 });
    assert.strictEqual(resolveRunIdFromSha({ workflow_runs: [{ id: 42 }] }), 42);
    assert.strictEqual(resolveRunIdFromSha({ workflow_runs: [{ id: 999 }, { id: 100 }, { id: 1 }] }), 999);
    for (const bad of [{ workflow_runs: [] }, {}, null]) assert.ok('error' in resolveRunIdFromSha(bad));
  });

  test('D-d buildDiagnosisReport keeps a passing job with no lines apart from a job whose logs are expired', async () => {
    const { buildDiagnosisReport } = await loadCi();
    const run = { conclusion: 'failure', status: 'completed', headSha: 'abc123' };
    const jobs = [{ id: 1, name: 'Passing Job', conclusion: 'success' }, { id: 2, name: 'Expired-Logs Job', conclusion: 'failure' }];
    const results = new Map([
      [1, { availability: { available: true }, logText: 'all good, no failures here' }],
      [2, { availability: { available: false, reason: 'expired', httpStatus: 410 }, logText: '' }],
    ]);
    const report = buildDiagnosisReport(run, jobs, results);
    assert.deepStrictEqual(report.jobs[0], { name: 'Passing Job', conclusion: 'success', failingLines: [] });
    assert.deepStrictEqual(report.jobs[1], { name: 'Expired-Logs Job', conclusion: 'failure', logsUnavailable: { reason: 'expired', httpStatus: 410 } });
  });

  test('D-e parseRepoFromRemoteUrl reads both github remote forms and returns { error } for empty or garbage input', async () => {
    const { parseRepoFromRemoteUrl } = await loadCi();
    assert.deepStrictEqual(parseRepoFromRemoteUrl('https://github.com/ollorin/igaming-platform.git'), { owner: 'ollorin', repo: 'igaming-platform' });
    assert.deepStrictEqual(parseRepoFromRemoteUrl('git@github.com:ollorin/igaming-platform.git'), { owner: 'ollorin', repo: 'igaming-platform' });
    assert.deepStrictEqual(parseRepoFromRemoteUrl('https://github.com/ollorin/igaming-platform'), { owner: 'ollorin', repo: 'igaming-platform' });
    assert.ok('error' in parseRepoFromRemoteUrl(''));
    assert.ok('error' in parseRepoFromRemoteUrl('not a url at all'));
  });

  test('D-f no run id and no token prints the usage and exits 1 before any network call', () => {
    const r = runCi([]);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stdout, /^Usage: ci-diagnose\.mjs \(--run-id <id> \| --sha <sha>\) \[--repo owner\/name\]/);
  });

  test('D-g a run id without a token exits 1 naming GH_TOKEN; a non-integer run id and a malformed --repo exit 1 without a call', () => {
    const noToken = runCi(['--run-id', '1', '--repo', 'a/b']);
    assert.strictEqual(noToken.status, 1);
    assert.match(noToken.stderr, /GH_TOKEN or GITHUB_TOKEN/);
    const badId = runCi(['--run-id', 'abc', '--repo', 'a/b'], { GH_TOKEN: 'x' });
    assert.strictEqual(badId.status, 1);
    assert.match(badId.stderr, /--run-id must be a positive integer/);
    const badRepo = runCi(['--run-id', '1', '--repo', 'nope'], { GH_TOKEN: 'x' });
    assert.strictEqual(badRepo.status, 1);
    assert.match(badRepo.stderr, /--repo must be in the form owner\/name/);
  });
});

describe('dependency-vulnerability gate (agnostic-M-09 9.7)', () => {
  const GATE = path.join(SCRIPTS, 'dependency-scan-gate.mjs');
  const loadGate = () => import(pathToFileURL(GATE).href);
  const finding = (over = {}) => ({ id: 'ADV-0001', package: 'sample-pkg', version: '1.0.0', ecosystem: 'npm', severity: 'HIGH', summary: 'planted', source: 'package-lock.json', ...over });
  const V2_HELP = 'COMMANDS:\n  scan              scans projects\n  fix               suggests changes\n';
  const V1_HELP = 'OPTIONS:\n  --format value  output format\n  -L value        lockfile path\n';
  const scanOut = (vulns) => JSON.stringify({ results: [{ source: { path: 'package-lock.json' }, packages: [{ package: { name: 'sample-pkg', version: '1.0.0', ecosystem: 'npm' }, vulnerabilities: vulns }] }] });
  const HIGH = [{ id: 'ADV-0001', summary: 'planted', database_specific: { severity: 'HIGH' } }];

  // A project dir with a config and an optional stub scanner dir. The stub prints help.txt for --help, otherwise appends its argv
  // to argv.txt and prints out.txt; /bin/cat keeps it independent of PATH.
  function project(stack, { help = V2_HELP, out = scanOut(HIGH), baseline } = {}) {
    const root = mkTmp('gsd-depscan-');
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack }));
    if (baseline) fs.writeFileSync(path.join(root, '.planning', 'cve-baseline.json'), JSON.stringify(baseline));
    const bin = path.join(root, 'stub-bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'help.txt'), help);
    fs.writeFileSync(path.join(bin, 'out.txt'), out);
    fs.writeFileSync(path.join(bin, 'osv-scanner'), `#!/bin/sh\nif [ "$1" = "--help" ]; then exec /bin/cat '${bin}/help.txt'; fi\nprintf '%s\\n' "$*" >> '${bin}/argv.txt'\nexec /bin/cat '${bin}/out.txt'\n`, { mode: 0o755 });
    return { root, bin, argv: () => fs.readFileSync(path.join(bin, 'argv.txt'), 'utf8').trim().split('\n') };
  }
  const run = (p, pathEnv) => spawnSync(process.execPath, [GATE], { cwd: p.root, encoding: 'utf8', env: { PATH: pathEnv ?? p.bin }, timeout: 20000 });

  test('P-a the evaluation cases of the source test: floor, baseline, key without version, dedupe, fail-closed on a scan failure', async () => {
    const g = await loadGate();
    assert.deepStrictEqual(['low', 'Moderate', 'HIGH', 'critical'].map(g.normalizeSeverity), ['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
    assert.deepStrictEqual([undefined, null, '', 'weird'].map(g.normalizeSeverity), ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    assert.deepStrictEqual(['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'UNKNOWN'].map((s) => g.meetsFloor(s, 'HIGH')), [true, true, false, false, true]);
    assert.strictEqual(g.findingKey(finding()), g.findingKey(finding({ version: '2.0.0' })));
    assert.strictEqual(g.dedupeFindings([finding(), finding()]).length, 1);
    assert.strictEqual(g.dedupeFindings([finding(), finding({ source: 'other.lock' })]).length, 2);
    const planted = g.evaluateScan([finding()], { floor: 'HIGH', baseline: [] });
    assert.deepStrictEqual([planted.blocking, planted.newFindings.length, g.exitCodeFor(planted)], [true, 1, 1]);
    const known = g.evaluateScan([finding()], { floor: 'HIGH', baseline: [g.findingKey(finding())] });
    assert.deepStrictEqual([known.blocking, g.exitCodeFor(known)], [false, 0]);
    const moderate = g.evaluateScan([finding({ severity: 'MODERATE' })], { floor: 'HIGH', baseline: [] });
    assert.deepStrictEqual([moderate.totalFindingsAtFloor, moderate.blocking], [0, false]);
    assert.strictEqual(g.evaluateScan([], { floor: 'HIGH', baseline: [] }).blocking, false);
    assert.strictEqual(g.evaluateScan([], { floor: 'HIGH', baseline: [], scanFailures: [{ source: 'x', reason: 'r' }] }).blocking, true);
    assert.strictEqual(g.evaluateScan([finding()], { floor: 'HIGH', baseline: [g.findingKey(finding())], scanFailures: [{ source: 'x', reason: 'r' }] }).blocking, true);
    assert.strictEqual(g.evaluateScan([], { floor: 'HIGH', baseline: [], scanFailures: [] }).blocking, false);
  });

  test('P-n F4: an advisory with no database severity blocks (UNKNOWN is at-floor); MAL ids, a scanner group max_severity and a CVSS vector are all read; a low score still passes', async () => {
    const g = await loadGate();
    assert.strictEqual(g.cvssV3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'), 9.8);
    assert.strictEqual(g.cvssV3Score('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N'), 3.3);
    assert.ok(Number.isNaN(g.cvssV3Score('garbage')));
    const noisy = (vulns, groups) => JSON.stringify({ results: [{ source: { path: 'package-lock.json' }, packages: [{ package: { name: 'sample-pkg', version: '1.0.0', ecosystem: 'npm' }, vulnerabilities: vulns, groups }] }] });
    const cfg = { cve: { lockfiles: ['package-lock.json'] } };
    const cases = [
      ['malicious package id, no severity', noisy([{ id: 'MAL-2024-1234', summary: 'malware' }], []), 1],
      ['RUSTSEC id, group max_severity 9.8', noisy([{ id: 'RUSTSEC-2024-0001', aliases: ['CVE-2024-1'], summary: 'x' }], [{ ids: ['RUSTSEC-2024-0001'], aliases: ['CVE-2024-1'], max_severity: '9.8' }]), 1],
      ['CVSS vector 9.8, no database severity', noisy([{ id: 'ADV-0002', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] }], []), 1],
      ['MAL id only in aliases', noisy([{ id: 'GHSA-aaaa', aliases: ['MAL-2024-9'], summary: 'malware' }], []), 1],
      ['low v3 score masks an unparsable v4 vector', noisy([{ id: 'ADV-0005', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N' }, { type: 'CVSS_V4', score: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N' }] }], []), 1],
      ['no severity anywhere (UNKNOWN)', noisy([{ id: 'ADV-0003' }], []), 1],
      ['group max_severity 3.1 stays below the floor', noisy([{ id: 'ADV-0004' }], [{ ids: ['ADV-0004'], max_severity: '3.1' }]), 0],
    ];
    for (const [name, out, status] of cases) {
      const r = run(project(cfg, { out }));
      assert.strictEqual(r.status, status, `${name}: ${r.stdout}${r.stderr}`);
    }
  });

  test('L6 stack.cve.severity_floor UNKNOWN is rejected with a clear error', () => {
    const r = run(project({ cve: { lockfiles: ['package-lock.json'], severity_floor: 'UNKNOWN' } }, { out: scanOut([]) }));
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout + r.stderr, /severity_floor UNKNOWN is not one of/);
  });

  test('P-b the parse-or-fail cases of the source test: empty, whitespace, non-JSON, no results, results not an array, array or scalar', async () => {
    const g = await loadGate();
    assert.strictEqual(g.parseScannerOutput('{"results":[{"source":{"path":"a"}}]}').ok, true);
    assert.strictEqual(g.parseScannerOutput('{"results":[]}').ok, true);
    for (const bad of ['', '  \n ', 'usage: osv-scanner', '{"errors":["x"]}', '{"results":{}}', '[]', '3', 'null']) assert.strictEqual(g.parseScannerOutput(bad).ok, false, JSON.stringify(bad));
    const parsed = g.parseScannerOutput('{"results":[{"packages":[{"package":{"name":"a","version":"1","ecosystem":"npm"},"vulnerabilities":[{"id":"X","database_specific":{"severity":"high"}}]}]}]}');
    assert.deepStrictEqual(g.extractFindings(parsed.value).map((f) => [f.id, f.package, f.severity, f.source]), [['X', 'a', 'HIGH', 'unknown']]);
    assert.deepStrictEqual(g.extractFindings({}), []);
    assert.strictEqual(g.scanFailureForExit('s', 1, '', g.parseScannerOutput('{"results":[]}')), null);
    assert.match(g.scanFailureForExit('s', 0, '', g.parseScannerOutput('')).reason, /no output.*exit 0/);
    assert.match(g.scanFailureForExit('s', 127, 'boom\nmore', g.parseScannerOutput('')).reason, /stderr: boom/);
  });

  test('P-c scannerArgs picks the v2 form when the help lists scan and the v1 form otherwise', async () => {
    const g = await loadGate();
    assert.deepStrictEqual(g.scannerArgs(V2_HELP, 'a.lock'), ['scan', 'source', '-L', 'a.lock', '--format', 'json']);
    assert.deepStrictEqual(g.scannerArgs(V1_HELP, 'a.lock'), ['--format', 'json', '-L', 'a.lock']);
  });

  test('P-d no lockfile exits 0 with the line; a lockfile and an empty PATH exits 1 naming the scanner; allow_missing_scanner turns that into SKIPPED', () => {
    const none = project({ cve: { lockfiles: [] } });
    const r0 = run(none);
    assert.strictEqual(r0.status, 0, r0.stderr);
    assert.match(r0.stdout, /^no lockfile, nothing to scan$/m);
    const missing = project({ cve: { lockfiles: ['package-lock.json'] } });
    const r1 = run(missing, '');
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stderr, /NOT INSTALLED: osv-scanner/);
    const allowed = project({ cve: { lockfiles: ['package-lock.json'], allow_missing_scanner: true } });
    const r2 = run(allowed, '');
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /SKIPPED: osv-scanner not installed \(stack\.cve\.allow_missing_scanner\)/);
    const present = project({ cve: { lockfiles: ['package-lock.json'], allow_missing_scanner: true } });
    assert.strictEqual(run(present).status, 1, 'with a scanner present the key changes nothing');
  });

  test('P-e a HIGH finding exits 1 naming the package; the same finding in the baseline exits 0; a different package in the baseline does not', () => {
    const blocked = project({ cve: { lockfiles: ['package-lock.json'] } });
    const r1 = run(blocked);
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stdout, /npm::sample-pkg::ADV-0001/);
    const accepted = project({ cve: { lockfiles: ['package-lock.json'] } }, { baseline: { allowedFindings: ['npm::sample-pkg::ADV-0001'] } });
    const r2 = run(accepted);
    assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
    const widened = project({ cve: { lockfiles: ['package-lock.json'] } }, { baseline: { allowedFindings: ['npm::sample-pkg::ADV-9999', 'npm::other-pkg::ADV-0001'] } });
    assert.strictEqual(run(widened).status, 1);
  });

  test('P-f a MODERATE finding does not block; a severity_floor of MODERATE makes it block', () => {
    const moderate = [{ id: 'ADV-0002', database_specific: { severity: 'MODERATE' } }];
    assert.strictEqual(run(project({ cve: { lockfiles: ['package-lock.json'] } }, { out: scanOut(moderate) })).status, 0);
    assert.strictEqual(run(project({ cve: { lockfiles: ['package-lock.json'], severity_floor: 'MODERATE' } }, { out: scanOut(moderate) })).status, 1);
  });

  test('P-g scanner output that is not JSON, or has no results array, exits 1 even when the scanner exits 0', () => {
    const r1 = run(project({ cve: { lockfiles: ['package-lock.json'] } }, { out: 'usage: osv-scanner [flags]\n' }));
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stderr, /not valid JSON/);
    const r2 = run(project({ cve: { lockfiles: ['package-lock.json'] } }, { out: '{"errors":["x"]}' }));
    assert.strictEqual(r2.status, 1);
    assert.match(r2.stderr, /no "results" array/);
  });

  test('P-h a stub whose help lists scan receives the v2 vector, one whose help does not receives the v1 vector', () => {
    const v2 = project({ cve: { lockfiles: ['package-lock.json'] } }, { out: '{"results":[]}' });
    assert.strictEqual(run(v2).status, 0);
    assert.deepStrictEqual(v2.argv(), ['scan source -L package-lock.json --format json']);
    const v1 = project({ cve: { lockfiles: ['package-lock.json'] } }, { help: V1_HELP, out: '{"results":[]}' });
    assert.strictEqual(run(v1).status, 0);
    assert.deepStrictEqual(v1.argv(), ['--format json -L package-lock.json']);
  });

  test('P-i without stack.cve.lockfiles every tracked lockfile is scanned, an untracked one is not; an unreadable config is a failure', () => {
    const p = project({}, { out: '{"results":[]}' });
    const git = (...a) => spawnSync('git', ['-C', p.root, ...a], { encoding: 'utf8' });
    assert.strictEqual(git('init', '-q').status, 0);
    fs.mkdirSync(path.join(p.root, 'sub'));
    for (const f of ['package-lock.json', 'sub/yarn.lock', 'notes.txt']) fs.writeFileSync(path.join(p.root, f), 'x');
    assert.strictEqual(git('add', 'package-lock.json', 'sub/yarn.lock', 'notes.txt').status, 0);
    fs.writeFileSync(path.join(p.root, 'Cargo.lock'), 'x');
    const r = run(p, `${p.bin}:${process.env.PATH}`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(p.argv().map((l) => l.split(' ')[3]).sort(), ['package-lock.json', 'sub/yarn.lock']);
    fs.writeFileSync(path.join(p.root, '.planning', 'config.json'), '{ not json');
    const bad = run(p, `${p.bin}:${process.env.PATH}`);
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /not valid JSON/);
  });
});

describe('host guards (agnostic-M-09 9.8)', () => {
  const MEMORY = path.join(SCRIPTS, 'memory-guard.sh');
  const DISK = path.join(SCRIPTS, 'container-disk-guard.sh');
  // A project dir holding the script copies under scripts/ and a config; the scripts resolve the config from their own location.
  function host(hostCfg) {
    const root = mkTmp('gsd-host-');
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), typeof hostCfg === 'string' ? hostCfg : JSON.stringify({ stack: { host: hostCfg } }));
    for (const f of [MEMORY, DISK]) fs.copyFileSync(f, path.join(root, 'scripts', path.basename(f)));
    fs.mkdirSync(path.join(root, 'scripts', 'lib'));
    fs.copyFileSync(path.join(SCRIPTS, 'lib', 'reap-stale-test-processes.sh'), path.join(root, 'scripts', 'lib', 'reap-stale-test-processes.sh'));
    return root;
  }
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const uniq = (n) => `299.${n}${Date.now() % 100000}`;
  // An orphan sentinel: the shell exits at once so the sleep is re-parented; the unique argument identifies it.
  function sentinel(tag) {
    const r = spawnSync('sh', ['-c', `sleep ${tag} </dev/null >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' });
    const pid = Number(r.stdout.trim());
    assert.ok(pid > 0);
    live.push({ kill: () => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } });
    return pid;
  }
  const ppidOf = (pid) => Number(spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
  const run = (script, root, args = [], env = {}) => spawnSync('bash', [path.join(root, 'scripts', script), ...args], { encoding: 'utf8', cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });

  test('H-a memory-guard with no flag exits 0, prints its report and leaves a matching stale sentinel alive (listed when it is an orphan)', () => {
    const tag = uniq('71');
    const root = host({ worker_patterns: [`sleep ${tag}`] });
    const pid = sentinel(tag);
    const r = run('memory-guard.sh', root, [], { MEMORY_GUARD_STALE_MINUTES: '0' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /HOST MEMORY PRESSURE/);
    assert.match(r.stdout, /Host total RAM: \d+ MiB/);
    assert.match(r.stdout, /AUTOMATIC REAPER VIEW[\s\S]*no W1\/W2\/W3 candidate|AUTOMATIC REAPER VIEW[\s\S]*class=/);
    if (ppidOf(pid) === 1) {
      assert.match(r.stdout, new RegExp(`Stale orphan candidate: PID ${pid}\\b`));
      assert.match(r.stdout, /REPORT ONLY: would send SIGTERM/);
    }
    assert.ok(alive(pid), 'the sentinel survives a report run');
  });

  test('H-b memory-guard: an empty or absent worker list lists nothing; a protected pattern hides a match; a bad config fails', () => {
    const tag = uniq('72');
    const pid = sentinel(tag);
    const none = run('memory-guard.sh', host({}), [], { MEMORY_GUARD_STALE_MINUTES: '0' });
    assert.strictEqual(none.status, 0, none.stderr);
    assert.match(none.stdout, /worker_patterns is empty/);
    assert.doesNotMatch(none.stdout, /Stale orphan candidate/);
    const hidden = run('memory-guard.sh', host({ worker_patterns: [`sleep ${tag}`], protected_patterns: [tag] }), [], { MEMORY_GUARD_STALE_MINUTES: '0' });
    assert.strictEqual(hidden.status, 0, hidden.stderr);
    assert.doesNotMatch(hidden.stdout, /Stale orphan candidate/);
    const bad = run('memory-guard.sh', host('{ not json'));
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /cannot read|not JSON/);
    const badShape = run('memory-guard.sh', host({ worker_patterns: 'sleep' }));
    assert.strictEqual(badShape.status, 1);
    assert.ok(alive(pid));
  });

  test('H-c an unsupported platform prints UNSUPPORTED PLATFORM and exits 0 in report mode', () => {
    const root = host({});
    const fake = mkTmp('gsd-uname-');
    fs.writeFileSync(path.join(fake, 'uname'), '#!/bin/sh\necho Plan9\n', { mode: 0o755 });
    const r = run('memory-guard.sh', root, [], { PATH: `${fake}:${process.env.PATH}` });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /^UNSUPPORTED PLATFORM: Plan9$/m);
  });

  test('H-d --live with stdin not a terminal refuses with exit 1 for both scripts, and the sentinel is alive', () => {
    const tag = uniq('73');
    const root = host({ worker_patterns: [`sleep ${tag}`] });
    const pid = sentinel(tag);
    for (const s of ['memory-guard.sh', 'container-disk-guard.sh']) {
      const r = run(s, root, ['--live'], { MEMORY_GUARD_STALE_MINUTES: '0' });
      assert.strictEqual(r.status, 1, s);
      assert.match(r.stderr, /refused: --live needs an interactive terminal/);
    }
    assert.ok(alive(pid));
  });

  // A stub runtime CLI that answers the calls the script makes and logs every argv line; rmi and prune must never appear in report mode.
  function stubCli(root) {
    const log = path.join(root, 'cli.log');
    const sh = `#!/bin/sh
echo "$*" >> '${log}'
case "$*" in
  "info") exit 0 ;;
  "system df --format "*) printf 'Images|4|9.5GB|8.0GB (84%%)\\nBuild Cache|3|1.0GB|1.0GB\\nLocal Volumes|2|0.5GB|0B\\n' ;;
  "system df -v") printf 'Images space usage:\\n\\nREPOSITORY TAG IMAGE ID CREATED SIZE SHARED SIZE UNIQUE SIZE CONTAINERS\\nold-image 1.0 abc 2 weeks 1GB 0B 1GB 0\\nnew-image 2.0 def 1 day 1GB 0B 1GB 2\\n\\nContainers space usage:\\n' ;;
  "system df") echo "TYPE TOTAL" ;;
  "images -f dangling=true -q") echo abc ;;
esac
exit 0
`;
    fs.writeFileSync(path.join(root, 'stub-cli'), sh, { mode: 0o755 });
    return { cli: path.join(root, 'stub-cli'), calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
  }

  test('H-e container-disk-guard with no flag exits 0, reports the plan and runs no rmi and no prune', () => {
    const root = host({});
    const stub = stubCli(root);
    const r = run('container-disk-guard.sh', root, [], { CONTAINER_CLI: stub.cli });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /dangling images: 1; build cache entries: 3; zero-container image tags: 1/);
    assert.match(r.stdout, /would run: .*rmi old-image:1\.0/);
    assert.match(r.stdout, /REPORT ONLY: no changes were made/);
    assert.doesNotMatch(stub.calls(), /rmi|prune/);
  });

  test('H-f container-disk-guard with no reachable runtime exits 0 in report mode', () => {
    const root = host({});
    const r = run('container-disk-guard.sh', root, [], { CONTAINER_CLI: 'no-such-runtime-cli' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /no reachable container runtime/);
  });
});

describe('stale test-process reaper (agnostic-M-09 9.9)', () => {
  const LIB = path.join(SCRIPTS, 'lib', 'reap-stale-test-processes.sh');
  const REAP = path.join(SCRIPTS, 'reap-stale.sh');
  const bash = (snippet, env = {}) => spawnSync('bash', ['-c', `set -uo pipefail\nsource '${LIB}'\n${snippet}`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 60000 });
  // One snapshot line: pid|ppid|pgid|tty|stat|etime|cputime|rss|command
  const line = (pid, ppid, cmd, { tty = '??', stat = 'S' } = {}) => `${pid}|${ppid}|${pid}|${tty}|${stat}|01:00|00:00:00|1000|${cmd}`;
  const walk = (ppid, lines, pre = '') => {
    const r = bash(`${pre}\nSNAP=$(cat <<'EOS'\n${lines.join('\n')}\nEOS\n)\nif reap_walk_owner '${ppid}' "$SNAP"; then echo ORPHAN; else echo PROTECTED; fi\necho "chain=$REAP_CHAIN"`);
    assert.strictEqual(r.status, 0, r.stderr);
    return { verdict: r.stdout.split('\n')[0], chain: r.stdout.split('\n')[1] };
  };

  test('X-a snapshot walk: a live owner, an unrecognised ancestor, a live terminal, a cycle, the depth cap and a vanished ancestor are each PROTECTED; only pass-through ancestors are an ORPHAN', () => {
    assert.strictEqual(walk(10, [line(10, 1, '/bin/sh -c run'), line(11, 10, '/bin/bash -c more')]).verdict, 'ORPHAN', 'a pass-through chain ending at pid 1');
    assert.strictEqual(walk(1, []).verdict, 'ORPHAN', 'reparented to pid 1');
    assert.strictEqual(walk(10, [line(10, 1, '/bin/sh scripts/session-supervisor.sh --x')]).verdict, 'PROTECTED', 'owner script');
    assert.strictEqual(walk(10, [line(10, 11, '/bin/sh -c a'), line(11, 1, '/usr/bin/some-daemon --serve')]).verdict, 'PROTECTED', 'unrecognised ancestor');
    assert.strictEqual(walk(10, [line(10, 1, '/bin/sh -c a', { tty: 'null' })]).verdict, 'PROTECTED', 'a shell on a live terminal device');
    const cycle = walk(10, [line(10, 11, '/bin/sh -c a'), line(11, 10, '/bin/sh -c b')]);
    assert.deepStrictEqual([cycle.verdict, /:cycle$/.test(cycle.chain)], ['PROTECTED', true]);
    const deep = Array.from({ length: 40 }, (_, i) => line(100 + i, i === 39 ? 1 : 101 + i, '/bin/sh -c a'));
    const capped = walk(100, deep);
    assert.deepStrictEqual([capped.verdict, /depth-cap-exceeded$/.test(capped.chain)], ['PROTECTED', true]);
    const gone = walk(10, [line(10, 77, '/bin/sh -c a')]);
    assert.deepStrictEqual([gone.verdict, /77:vanished-ancestor$/.test(gone.chain)], ['PROTECTED', true]);
    assert.strictEqual(walk(10, [line(10, 11, '/bin/sh -c a', { stat: 'Z' }), line(11, 1, '/bin/sh -c b')]).verdict, 'ORPHAN', 'a zombie ancestor passes through');
  });

  test('X-b classification: worker_patterns make the W1 class, a wrapper stays pass-through, protected_patterns make an owner, an empty list matches nothing', () => {
    const cls = (cmd, pre) => {
      const r = bash(`${pre}\nreap_classify '${cmd}' '??'\necho $REAP_CLASS`);
      assert.strictEqual(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const workers = "REAP_WORKER_PATTERNS=('runner-x --run' 'other-runner')";
    assert.strictEqual(cls('/opt/bin/runner-x --run file.js', workers), 'CANDIDATE_W1');
    assert.strictEqual(cls('/bin/sh -c runner-x --run file.js', workers), 'PASS_THROUGH');
    assert.strictEqual(cls('/opt/bin/runner-x --run file.js', ''), 'UNKNOWN', 'no pattern, no candidate');
    assert.strictEqual(cls('/opt/bin/runner-x --run file.js', `${workers}; REAP_PROTECTED_PATTERNS=('file.js')`), 'OWNER');
    assert.strictEqual(cls('claude --print hi', ''), 'CANDIDATE_W2');
    assert.strictEqual(cls('claude', ''), 'OWNER');
    assert.strictEqual(cls('/home/u/.cache/puppeteer/chrome/x/chrome --user-data-dir=/tmp/puppeteer_dev_chrome_profile-ab', ''), 'CANDIDATE_W3');
    assert.strictEqual(cls('/home/u/.cache/puppeteer/chrome/x/chrome --type=renderer', ''), 'UNKNOWN');
  });

  test('X-c the etime, time and lstart parsers accept the live output of this platform\'s own ps', () => {
    const r = bash(`
reap_platform_supported || { echo UNSUPPORTED; exit 3; }
e="$(ps -o etime= -p $$)"; t="$(ps -o time= -p $$)"
echo "etime=$(reap_etime_to_seconds "$e") time=$(reap_etime_to_seconds "$t")"
a="$(ps -o lstart= -p $$)"; b="$(ps -o lstart= -p $$)"
[ -n "$a" ] && [ "$a" = "$b" ] && echo LSTART_STABLE
reap_ps_snapshot | while IFS='|' read -r pid ppid pgid tty stat etimes cputime rss cmd; do
  [ "$pid" = "$$" ] && echo "snap=$(reap_etime_to_seconds "$etimes") rss=$rss tty=$tty"
done
echo "dd=$(reap_etime_to_seconds '2-01:02:03') mm=$(reap_etime_to_seconds '08:09') frac=$(reap_etime_to_seconds '0:01.50')"`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /etime=\d+ time=\d+/);
    assert.match(r.stdout, /LSTART_STABLE/);
    assert.match(r.stdout, /snap=\d+ rss=\d+ tty=\S+/);
    assert.match(r.stdout, /dd=176523 mm=489 frac=1/);
  });

  // A project dir with the config the reaper reads and its own audit dir. Every env carries a STALE_REAPER_CMD_FILTER (the
  // sentinel's unique tag, or a tag that matches nothing) so a test sweep can never match a process outside the test.
  function project(host, tag = `gsd-reap-nomatch-${process.pid}-${Date.now()}`) {
    const root = mkTmp('gsd-reap-');
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), typeof host === 'string' ? host : JSON.stringify({ stack: { host } }));
    return { root, env: { STALE_REAPER_CONFIG: path.join(root, '.planning', 'config.json'), STALE_REAPER_AUDIT_DIR: path.join(root, 'audit'), STALE_REAPER_MIN_AGE_SECONDS: '1', STALE_REAPER_GRACE_SECONDS: '1', STALE_REAPER_CMD_FILTER: tag, STALE_REAPER_PROJECT_ROOT: root } };
  }
  // Report-only unless the test passes --live; a live sweep also requires the env to carry the filter.
  const reap = (p, args = [], extra = {}) => {
    const env = { PATH: process.env.PATH, ...p.env, ...extra };
    assert.ok(env.STALE_REAPER_CMD_FILTER, 'a reaper test env must set STALE_REAPER_CMD_FILTER');
    return spawnSync('bash', [REAP, ...(args.includes('--live') ? args : ['--dry-run', ...args])], { encoding: 'utf8', env, timeout: 60000 });
  };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const uniq = (n) => `299.${n}${Date.now() % 100000}`;
  // An orphan whose only ancestor is a pass-through shell: the outer shell exits, the inner one is re-parented.
  function orphan(tag) {
    const r = spawnSync('sh', ['-c', `(sh -c 'sleep ${tag}; true' </dev/null >/dev/null 2>&1 &) ; sleep 0.5; pgrep -f '^sleep ${tag}'`], { encoding: 'utf8' });
    const pid = Number(r.stdout.trim().split('\n')[0]);
    assert.ok(pid > 0, `sentinel ${tag} did not start: ${r.stdout}${r.stderr}`);
    live.push({ kill: () => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } });
    return pid;
  }
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  test('X-d reap-stale --dry-run lists an orphaned worker with only pass-through ancestors and leaves it alive; with no worker_patterns it lists nothing', async () => {
    const tag = uniq('81');
    const pid = orphan(tag);
    await sleepMs(1200);
    const none = project({});
    const r0 = reap(none, ['--dry-run']);
    assert.strictEqual(r0.status, 0, r0.stderr);
    assert.doesNotMatch(r0.stdout, /would_kill/);
    const p = project({ worker_patterns: [`sleep ${tag}`], project_pattern: tag }, tag);
    const r = reap(p, ['--dry-run']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`would_kill pid=${pid} class=CANDIDATE_W1`));
    assert.ok(alive(pid), 'a dry run sends no signal');
  });

  test('X-e a real sweep reaps that orphan; a protected_patterns entry that matches it spares it', async () => {
    const tag = uniq('82');
    const pid = orphan(tag);
    await sleepMs(1200);
    const spared = reap(project({ worker_patterns: [`sleep ${tag}`], project_pattern: tag, protected_patterns: [tag] }, tag), ['--live']);
    assert.strictEqual(spared.status, 0, spared.stderr);
    assert.ok(alive(pid), 'an owner pattern protects the worker');
    const r = reap(project({ worker_patterns: [`sleep ${tag}`], project_pattern: tag }, tag), ['--live']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    await sleepMs(500);
    assert.ok(!alive(pid), 'the orphan is reaped');
  });

  test('X-f a worker under a live owner script is protected across sweeps', async () => {
    const tag = uniq('83');
    const p = project({ worker_patterns: [`sleep ${tag}`] }, tag);
    fs.mkdirSync(path.join(p.root, 'scripts'));
    fs.writeFileSync(path.join(p.root, 'scripts', 'session-supervisor.sh'), `#!/bin/sh\nsleep ${tag}\ntrue\n`, { mode: 0o755 });
    const owner = spawn('sh', [path.join(p.root, 'scripts', 'session-supervisor.sh')], { stdio: 'ignore' });
    live.push({ kill: () => killTree(owner.pid) });
    await sleepMs(1500);
    const child = Number(spawnSync('pgrep', ['-P', String(owner.pid)], { encoding: 'utf8' }).stdout.trim().split('\n')[0]);
    assert.ok(child > 0, 'the worker started under the owner');
    for (let i = 0; i < 2; i += 1) {
      const dry = reap(p, ['--dry-run']);
      assert.doesNotMatch(dry.stdout, new RegExp(`would_kill pid=${child}\\b`));
      assert.strictEqual(reap(p, ['--live']).status, 0);
      assert.ok(alive(child), `sweep ${i}: the worker under a live owner survives`);
    }
    spawnSync('kill', ['-9', String(child)]);
  });

  // A sentinel whose argv0 is `claude` (W2) or a puppeteer chrome path (W3), re-parented to PID 1, cwd as given.
  function agentSentinel(kind, tag, cwd, script, env = {}) {
    const dir = mkTmp('gsd-agent-');
    const bin = kind === 'w2' ? path.join(dir, 'claude') : path.join(dir, '.cache', 'puppeteer', 'chrome', 'linux', 'chrome');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.symlinkSync('/bin/sh', bin);
    const run = path.join(dir, `run-${tag}.sh`);
    fs.writeFileSync(run, `${script || `sleep ${tag}; true`}\n`);
    const tail = kind === 'w2' ? '--print' : `--user-data-dir=${dir}/puppeteer_dev_chrome_profile-${tag}`;
    spawnSync('sh', ['-c', `(cd '${cwd}' && exec '${bin}' '${run}' ${tail}) </dev/null >/dev/null 2>&1 & sleep 0.5`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    const pid = Number(spawnSync('pgrep', ['-f', `^${bin} ${run}`], { encoding: 'utf8' }).stdout.trim().split('\n')[0]);
    assert.ok(pid > 0, `agent sentinel ${tag} did not start`);
    live.push({ kill: () => killTree(pid) });
    return { pid, dir, run };
  }

  test('Y-a F1: an agent or browser sentinel with parent 1 and another project\'s cwd is never matched; in scope it is report-only by default and --live kills only it', async () => {
    for (const kind of ['w2', 'w3']) {
      const tag = uniq(kind === 'w2' ? '91' : '92');
      const p = project({}, tag);
      const foreign = agentSentinel(kind, tag, mkTmp('gsd-other-project-'));
      await sleepMs(1200);
      for (const args of [['--dry-run'], ['--live']]) {
        const r = reap(p, args);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stdout, /would_kill/, `${kind} ${args}: other-project process not listed`);
      }
      assert.ok(alive(foreign.pid), `${kind}: other-project process survives --live`);
      assert.match(fs.readFileSync(path.join(p.root, 'audit', fs.readdirSync(path.join(p.root, 'audit'))[0]), 'utf8'), /out_of_scope/);
      const mine = agentSentinel(kind, tag, p.root);
      await sleepMs(1200);
      const dry = reap(p);
      const bare = spawnSync('bash', [REAP], { encoding: 'utf8', env: { PATH: process.env.PATH, ...p.env }, timeout: 60000 });
      assert.match(bare.stdout, new RegExp(`would_kill pid=${mine.pid}\\b`), 'no flag is report-only');
      assert.match(dry.stdout, new RegExp(`would_kill pid=${mine.pid} class=CANDIDATE_W${kind === 'w2' ? 2 : 3}`));
      assert.doesNotMatch(dry.stdout, new RegExp(`pid=${foreign.pid}\\b`));
      assert.ok(alive(mine.pid), 'report-only by default sends no signal');
      assert.strictEqual(reap(p, ['--live']).status, 0);
      await sleepMs(500);
      assert.ok(!alive(mine.pid), `${kind}: the in-scope orphan is reaped by --live`);
      assert.ok(alive(foreign.pid), `${kind}: the other-project process is still alive`);
    }
  });

  test('Y-b F1: a project_pattern config match puts an out-of-cwd agent in scope', async () => {
    const tag = uniq('93');
    const p = project({ project_pattern: tag }, tag);
    const s = agentSentinel('w2', tag, mkTmp('gsd-other-project-'));
    await sleepMs(1200);
    assert.match(reap(p).stdout, new RegExp(`would_kill pid=${s.pid} class=CANDIDATE_W2`));
  });

  test('Y-c F1: the reaper never kills its own ancestor, even a qualifying headless agent that launched it', async () => {
    const tag = uniq('94');
    const p = project({}, tag);
    const out = path.join(p.root, 'ran.txt');
    agentSentinel('w2', tag, p.root, `sleep 2\nbash '${REAP}' --live > '${out}' 2>&1\necho done >> '${out}'`, p.env);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !(fs.existsSync(out) && /done/.test(fs.readFileSync(out, 'utf8')))) await sleepMs(300);
    const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    assert.match(text, /done/, `the launching agent survived its own sweep: ${text}`);
    assert.doesNotMatch(text, /killed=[1-9]/);
  });

  test('Y-d F2 guard: every reaper test env carries STALE_REAPER_CMD_FILTER; reap() refuses an env without it (positive control)', () => {
    const p = project({});
    assert.ok(p.env.STALE_REAPER_CMD_FILTER && p.env.STALE_REAPER_PROJECT_ROOT);
    assert.throws(() => reap({ env: { ...p.env, STALE_REAPER_CMD_FILTER: '' } }), /STALE_REAPER_CMD_FILTER/);
    assert.throws(() => reap({ env: {} }), /STALE_REAPER_CMD_FILTER/);
    const r = reap(p, ['--live']);
    assert.strictEqual(r.status, 0, r.stderr);
  });

  test('X-g an unsupported platform prints UNSUPPORTED PLATFORM and reaps nothing; an unreadable config exits 1; an unknown flag exits 2', async () => {
    const tag = uniq('84');
    const pid = orphan(tag);
    await sleepMs(1200);
    const fake = mkTmp('gsd-uname-');
    fs.writeFileSync(path.join(fake, 'uname'), '#!/bin/sh\necho Plan9\n', { mode: 0o755 });
    const p = project({ worker_patterns: [`sleep ${tag}`] }, tag);
    const r = spawnSync('bash', [REAP, '--live'], { encoding: 'utf8', env: { PATH: `${fake}:${process.env.PATH}`, ...p.env } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /^UNSUPPORTED PLATFORM: Plan9$/m);
    assert.ok(alive(pid));
    const bad = reap(project('{ not json'), ['--live']);
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /config unreadable or not JSON/);
    assert.strictEqual(reap(p, ['--nope']).status, 2);
    assert.ok(alive(pid));
  });
});

describe('doc freshness tracker and ADR reconcile (agnostic-M-09 9.10)', () => {
  const ADR = path.join(SCRIPTS, 'validation', 'adr-reconcile.mjs');
  const FRESH = path.join(SCRIPTS, 'validation', 'freshness-tracker.mjs');
  const load = (f) => import(pathToFileURL(f).href);
  const repo = () => {
    const root = mkTmp('gsd-adr-');
    assert.strictEqual(spawnSync('git', ['init', '-q', root]).status, 0);
    return root;
  };
  const put = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const runNode = (script, root, args = []) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', timeout: 20000 });

  test('A-a the pure functions of the source test: prose, path and comment forms, dedupe, boundaries, allowlist, the canary 0014 against 0001..0013', async () => {
    const { extractAdrMentions, findMissingAdrFiles, allowMissingWithReason } = await load(ADR);
    const nums = (text) => extractAdrMentions(text, 'doc.md').map((m) => m.number);
    assert.deepStrictEqual(nums('ADR-0010 is the money convention'), ['0010']);
    assert.deepStrictEqual(nums('see [x](docs/adr/0010-money-units.md)'), ['0010']);
    assert.deepStrictEqual(nums('// per docs/adr/0010-money-units-and-more'), ['0010']);
    assert.deepStrictEqual(extractAdrMentions('a\nADR-0010 and docs/adr/0010-x ADR-0010 ADR-0010 ADR-0010', 'd.md'), [{ number: '0010', context: 'd.md:2' }]);
    assert.deepStrictEqual(nums('ADR-0000 and ADR-9999 and ADR-00100 and ADR-123'), ['0000', '9999']);
    assert.deepStrictEqual(extractAdrMentions('x docs/records/0003-a', 'd.md', 'docs/records').map((m) => m.number), ['0003'], 'the path form follows --adr-dir');
    const disk = Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(4, '0'));
    const m14 = extractAdrMentions('ADR-0014', 'd.md');
    assert.deepStrictEqual(findMissingAdrFiles(m14, disk, []), ['0014']);
    assert.deepStrictEqual(findMissingAdrFiles(extractAdrMentions(disk.map((n) => `ADR-${n}`).join(' '), 'd.md'), disk, []), []);
    assert.deepStrictEqual(findMissingAdrFiles(m14, disk, [allowMissingWithReason('0014', 'planned')]), []);
  });

  test('A-b adr-reconcile: no docs exits 0; a doc citing ADR-0007 with no file exits 1 naming it; with the file exits 0; a reference with no ADR directory exits 1', () => {
    const empty = repo();
    const r0 = runNode(ADR, empty);
    assert.strictEqual(r0.status, 0, r0.stdout + r0.stderr);
    const root = repo();
    put(root, 'docs/guide.md', 'We follow ADR-0007 here.\n');
    const r1 = runNode(ADR, root);
    assert.strictEqual(r1.status, 1);
    assert.match(r1.stdout, /MISSING ADR-0007.*docs\/guide\.md:1/);
    assert.match(r1.stdout, /ADR directory docs\/adr does not exist/);
    put(root, 'docs/adr/0007-the-decision.md', '# ADR-0007\n');
    const r2 = runNode(ADR, root);
    assert.strictEqual(r2.status, 0, r2.stdout);
    put(root, 'docs/adr/0007-the-decision.md', '# decision\nSelf reference ADR-0099 is inside the excluded subtree\n');
    assert.strictEqual(runNode(ADR, root).status, 0, 'the ADR directory itself is not scanned');
  });

  test('A-c adr-reconcile: --docs and --adr-dir move the roots, .claude/rules and CLAUDE.md are scanned, --allow-missing needs a reason, a bad flag exits 1', () => {
    const root = repo();
    put(root, 'notes/a.md', 'ADR-0002\n');
    put(root, 'records/0002-x.md', 'x\n');
    assert.strictEqual(runNode(ADR, root, ['--docs', 'notes', '--adr-dir', 'records']).status, 0);
    put(root, 'CLAUDE.md', 'cites ADR-0003\n');
    const rule = runNode(ADR, root, ['--docs', 'notes', '--adr-dir', 'records']);
    assert.strictEqual(rule.status, 1);
    assert.match(rule.stdout, /MISSING ADR-0003.*CLAUDE\.md:1/);
    put(root, '.claude/rules/r.md', 'ADR-0004\n');
    assert.match(runNode(ADR, root, ['--docs', 'notes', '--adr-dir', 'records']).stdout, /MISSING ADR-0004.*\.claude\/rules\/r\.md:1/);
    const allowed = runNode(ADR, root, ['--docs', 'notes', '--adr-dir', 'records', '--allow-missing', '0003#planned', '--allow-missing', '0004#planned']);
    assert.strictEqual(allowed.status, 0, allowed.stdout);
    const noReason = runNode(ADR, root, ['--allow-missing', '0003']);
    assert.strictEqual(noReason.status, 1);
    assert.match(noReason.stderr, /reason is required/);
    assert.strictEqual(runNode(ADR, root, ['--nope', 'x']).status, 1);
  });

  test('A-d freshness pure functions: glob match, most specific mapping, front-matter tags (inline and block), tag patterns, staleness arithmetic', async () => {
    const f = await load(FRESH);
    assert.strictEqual(f.matchesGlob('docs/api/**', 'docs/api/a/b.md'), true);
    assert.strictEqual(f.matchesGlob('docs/*.md', 'docs/a/b.md'), false);
    assert.strictEqual(f.matchesGlob('docs/api/**', 'other/docs/api/a.md'), false);
    const maps = [{ docPattern: 'docs/**', codePatterns: ['src/**'] }, { docPattern: 'docs/api/**', codePatterns: ['src/api/**'] }];
    assert.strictEqual(f.findMapping(maps, 'docs/api/x.md').docPattern, 'docs/api/**', 'the longest glob wins');
    assert.strictEqual(f.findMapping(maps, 'readme.md'), null);
    assert.deepStrictEqual(f.readFrontmatterTags('---\ntitle: x\ntags: [Games, "cache"]\n---\nbody'), ['Games', 'cache']);
    assert.deepStrictEqual(f.readFrontmatterTags('---\ntags:\n  - one\n  - two\nother: 1\n---\n'), ['one', 'two']);
    assert.deepStrictEqual(f.readFrontmatterTags('no front matter\ntags: [x]'), []);
    assert.deepStrictEqual(f.readFrontmatterTags('---\ntitle: x\n---\n'), []);
    const mapping = { codePatterns: ['src/api/**'], tagMappings: { games: ['src/games/**'] } };
    assert.deepStrictEqual(f.codePatternsFor(mapping, ['Games', 'none']), ['src/api/**', 'src/games/**']);
    const d = (iso) => ({ commit: 'abc1234def', date: new Date(iso) });
    assert.strictEqual(f.staleResult('d.md', ['p'], d('2026-01-01T00:00:00Z'), d('2026-02-01T00:00:00Z')), null);
    assert.strictEqual(f.staleResult('d.md', ['p'], null, d('2026-02-01T00:00:00Z')), null);
    assert.strictEqual(f.staleResult('d.md', ['p'], d('2026-03-11T00:00:00Z'), d('2026-03-01T12:00:00Z')).staleByDays, 9);
    assert.deepStrictEqual(f.parseMapFlags(['--map', 'docs/a/**=src/a/**,src/b/**', '--tag-map', 'docs/a/**#X=src/x/**', 'docs/a/one.md']), {
      mappings: [{ docPattern: 'docs/a/**', codePatterns: ['src/a/**', 'src/b/**'], tagMappings: { x: ['src/x/**'] } }], docs: ['docs/a/one.md'],
    });
    assert.match(f.parseMapFlags(['--map', 'nothing']).error, /needs/);
  });

  test('A-e the freshness tracker exits 0 with a stale doc and prints it, and exits 0 on a fresh one, with no map, and on no docs', () => {
    const root = repo();
    const commit = (date, msg) => spawnSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '-m', msg], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    put(root, 'docs/guide.md', 'guide\n');
    put(root, 'src/api/code.js', 'a\n');
    spawnSync('git', ['add', '-A'], { cwd: root });
    assert.strictEqual(commit('2026-01-01T00:00:00Z', 'first').status, 0);
    put(root, 'src/api/code.js', 'b\n');
    spawnSync('git', ['add', '-A'], { cwd: root });
    assert.strictEqual(commit('2026-03-01T00:00:00Z', 'code change').status, 0);
    const stale = runNode(FRESH, root, ['--map', 'docs/**=src/api/**']);
    assert.strictEqual(stale.status, 0, stale.stderr);
    assert.match(stale.stdout, /docs\/guide\.md stale \(src\/api\/\*\* changed 59 days ago, commit [0-9a-f]{7}\)/);
    put(root, 'docs/guide.md', 'guide v2\n');
    spawnSync('git', ['add', '-A'], { cwd: root });
    assert.strictEqual(commit('2026-03-02T00:00:00Z', 'doc update').status, 0);
    const fresh = runNode(FRESH, root, ['--map', 'docs/**=src/api/**']);
    assert.strictEqual(fresh.status, 0);
    assert.match(fresh.stdout, /All documents are fresh/);
    assert.match(runNode(FRESH, root).stdout, /No --map given/);
    assert.strictEqual(runNode(FRESH, repo(), ['--map', 'docs/**=src/**']).status, 0);
    assert.strictEqual(runNode(FRESH, root, ['--bogus']).status, 1);
  });
});

describe('assertion-quality lint (agnostic-M-09 9.11)', () => {
  const LINT = path.join(SCRIPTS, 'validation', 'check-assertion-quality.mjs');
  const load = () => import(pathToFileURL(LINT).href);
  // The house scenario shape: a steps template literal and an assertions array inside an object literal, optionally a prepare block.
  function makeSource({ steps, assertions, prepareBody } = {}) {
    const lines = [];
    if (prepareBody !== undefined) lines.push(`    prepare: async () => { ${prepareBody} },`);
    if (steps !== undefined) lines.push(`    steps: \`${steps}\`,`);
    if (assertions) lines.push(`    assertions: [${assertions.map((a) => JSON.stringify(a)).join(', ')}],`);
    return `\nexport const scenario = {\n  name: "synthetic",\n  toScenarioData: (extra) => ({\n    name: "synthetic",\n${lines.join('\n')}\n  }),\n};\n`;
  }
  const kinds = (ev, id, src) => ev(id, src).map((i) => i.kind);

  test('Q-a the five anti-patterns are each flagged on their positive case and not on their negative case', async () => {
    const { evaluateScenarioAssertionQuality: ev } = await load();
    const bypass = makeSource({ steps: '1. Navigate\n2. IF the widget is present: verify content\n3. IF NOT present: expected', assertions: ['After step 2: heading is visible'] });
    assert.ok(kinds(ev, 's', bypass).includes('conditional-bypass'));
    assert.ok(!kinds(ev, 's', makeSource({ steps: '1. Navigate\n2. Click Submit to save', assertions: ["After step 2: banner text is exactly 'Saved.'"] })).includes('conditional-bypass'));
    assert.ok(kinds(ev, 's', makeSource({ steps: '1. Navigate', assertions: ['page loaded (heading visible)'] })).includes('status-only'));
    assert.ok(!kinds(ev, 's', makeSource({ steps: '1. Navigate', assertions: ['page loaded (heading visible)', 'remaining.textContent matches /^\\d/'] })).includes('status-only'));
    const order = makeSource({ steps: '1. Open the order page\n2. Submit an order of 25.50\n3. Wait for the banner', assertions: ['order accepted (success banner is visible)', 'order page renders without error after submission'] });
    assert.ok(kinds(ev, 'orders/weak-demo', order).includes('status-only'), 'a status-only scenario that moves a value is weak');
    assert.ok(kinds(ev, 's', makeSource({ steps: '1. Open the edit form\n2. Click Cancel to close the form', assertions: ['After step 2: the form closes and the previous value persists'] })).includes('submit-and-skip'));
    assert.ok(!kinds(ev, 's', makeSource({ steps: '1. Open\n2. Click Cancel on a dialog\n3. Submit the form', assertions: ['After step 3: the value has changed from the previous one'] })).includes('submit-and-skip'));
    assert.ok(kinds(ev, 's', makeSource({ steps: '1. Navigate', assertions: ['the widget is visible'] })).includes('existence-without-value'));
    assert.ok(!kinds(ev, 's', makeSource({ steps: '1. Navigate', assertions: ['the widget is visible', 'widget.textContent matches /^\\d/'] })).includes('existence-without-value'));
    assert.ok(kinds(ev, 's', makeSource({ steps: '1. Navigate', assertions: ['page renders without error'] })).includes('renders-without-error'));
    assert.ok(!kinds(ev, 's', makeSource({ steps: '1. Navigate', assertions: ['page renders without error', 'After step 2: the total is 7'] })).includes('renders-without-error'));
  });

  test('Q-b the behaviour floor: missing without a behaviour assertion, satisfied by after-step and persists-after-reload wording, and a clean scenario has zero issues', async () => {
    const { evaluateScenarioAssertionQuality: ev, isWeak } = await load();
    assert.ok(kinds(ev, 's', makeSource({ steps: '1. Navigate', assertions: ['remaining is visible', 'remaining.textContent matches /^\\d/'] })).includes('missing-tier-3-4'));
    assert.ok(!kinds(ev, 'a', makeSource({ steps: '1. Navigate\n2. Submit the form', assertions: ["After step 3: banner text is exactly 'Updated.'"] })).includes('missing-tier-3-4'));
    assert.ok(!kinds(ev, 'b', makeSource({ steps: '1. Navigate\n2. Reload', assertions: ['The limit still shows the updated value after page reload'] })).includes('missing-tier-3-4'));
    const clean = makeSource({ steps: '1. Navigate\n2. Submit the form\n3. Wait for the save banner', assertions: ["After step 3: the save banner text is exactly 'Updated.'", "The value's textContent matches /^\\d+$/ and has changed from the previous value"] });
    assert.deepStrictEqual(ev('clean', clean), []);
    assert.strictEqual(isWeak([]), false);
    assert.strictEqual(isWeak(ev('s', makeSource({ steps: '1. Navigate', assertions: ['x is visible'] }))), true);
  });

  test('Q-c conditional state: flagged without a seeded fixture, not flagged with one, not read from a source comment; an IF-present inside an assertion is flagged', async () => {
    const { evaluateScenarioAssertionQuality: ev } = await load();
    const stateA = makeSource({ steps: '1. Navigate\n2. Check which state the table is in: state A or state B', assertions: ["After step 2: the table's total is numeric and not NaN"], prepareBody: 'await loginAsOperator();' });
    assert.ok(kinds(ev, 'v1', stateA).includes('conditional-state'));
    const rendered = makeSource({ steps: '1. Navigate\n2. Wait for the chart', assertions: ['After step 2: the chart is rendered and its label contains a digit'], prepareBody: 'await loginAsOperator();' });
    assert.ok(kinds(ev, 'v2', rendered).includes('conditional-state'));
    const seeded = makeSource({ steps: '1. Navigate\n2. Check the table is in state A', assertions: ["After step 2: the table's total is numeric and not NaN"], prepareBody: "const p = await provisionAccount({ x: 1 }); await seedPendingOffer(p.id);" });
    assert.ok(!kinds(ev, 'c1', seeded).includes('conditional-state'));
    const base = makeSource({ steps: '1. Navigate\n2. Submit the form', assertions: ["After step 2: the banner text is exactly 'Saved.'"], prepareBody: 'await loginAsOperator();' });
    const commented = kinds(ev, 'c2', `${base}\n// state A is rendered when IF the widget is present: a developer note, not a scenario claim\n`);
    assert.ok(!commented.includes('conditional-state') && !commented.includes('conditional-bypass'));
    const inAssertion = makeSource({ steps: '1. Navigate\n2. Submit the form', assertions: ['After step 2: IF the widget is present, the amount is numeric and not NaN'], prepareBody: 'await loginAsOperator();' });
    assert.ok(kinds(ev, 'a1', inAssertion).includes('conditional-bypass'));
  });

  test('Q-d parseAssertions ignores a commented-out field and brackets inside string literals; scenarioIdFromFilePath drops the extension', async () => {
    const { parseAssertions, scenarioIdFromFilePath, extractTemplateField } = await load();
    const src = `// assertions: ["old one"]\nconst x = { assertions: [ "keeps [brackets] and /[\\\\d,]+/ inside", 'second' ], steps: "a // b" }`;
    assert.deepStrictEqual(parseAssertions(src), ['keeps [brackets] and /[\\\\d,]+/ inside', 'second']);
    assert.strictEqual(extractTemplateField(src, 'steps').text, 'a // b');
    assert.strictEqual(scenarioIdFromFilePath('.tmp/demo/weak-scenario.ts'), 'weak-scenario');
    assert.strictEqual(scenarioIdFromFilePath('x/y.mjs'), 'y');
  });

  function project(scenarios, e2e = 'scenarios') {
    const root = mkTmp('gsd-aq-');
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { paths: e2e === null ? {} : { e2e_scenarios: e2e } } }));
    for (const [rel, text] of Object.entries(scenarios)) {
      fs.mkdirSync(path.dirname(path.join(root, 'scenarios', rel)), { recursive: true });
      fs.writeFileSync(path.join(root, 'scenarios', rel), text);
    }
    return root;
  }
  const lint = (root, args = []) => spawnSync(process.execPath, [LINT, ...args], { cwd: root, encoding: 'utf8', timeout: 20000 });
  const CLEAN = makeSource({ steps: '1. Navigate\n2. Submit the form', assertions: ["After step 2: the banner text is exactly 'Saved.'"] });
  const WEAK = makeSource({ steps: '1. Navigate', assertions: ['page loaded (heading visible)'] });

  test('Q-e CLI: an unset scenarios path exits 0 with the line; clean scenarios exit 0; a weak one exits 1 naming it; helpers and indexes are skipped; a missing dir or config exits 2', () => {
    const unset = lint(project({}, null));
    assert.strictEqual(unset.status, 0, unset.stderr);
    assert.match(unset.stdout, /^no e2e scenarios path \(stack\.paths\.e2e_scenarios\)$/m);
    const clean = lint(project({ 'a/ok.ts': CLEAN }));
    assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /No issues found across 1 scenario/);
    const weak = lint(project({ 'a/ok.ts': CLEAN, 'a/bad.ts': WEAK, 'a/_helper.ts': WEAK, 'index.ts': WEAK }));
    assert.strictEqual(weak.status, 1);
    assert.match(weak.stdout, /^a\/bad:/m);
    assert.match(weak.stdout, /\[status-only\]/);
    assert.doesNotMatch(weak.stdout, /_helper|index/);
    assert.strictEqual(lint(project({}, 'no-such-dir')).status, 2);
    const noCfg = mkTmp('gsd-aq-');
    assert.strictEqual(lint(noCfg).status, 2);
    const json = lint(project({ 'bad.ts': WEAK }), ['--json']);
    assert.strictEqual(json.status, 1);
    assert.ok(JSON.parse(json.stdout).some((i) => i.kind === 'status-only'));
  });

  test('Q-f CLI: --file lints one scenario without the config, and an unreadable file exits 2', () => {
    const root = mkTmp('gsd-aq-');
    fs.writeFileSync(path.join(root, 'one.ts'), WEAK);
    const r = lint(root, ['--file', 'one.ts']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /^one:/m);
    assert.strictEqual(lint(root, ['--file', 'missing.ts']).status, 2);
  });
});

// agnostic-M-09 task 9.12: findings register.
describe('9.12 findings register', () => {
  const FR = path.join(SCRIPTS, 'findings-register.mjs');
  const FIX = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'agnostic', 'findings-register');
  const mod = () => import(pathToFileURL(FR).href);
  const parseMod = () => import(pathToFileURL(path.join(SCRIPTS, 'lib', 'findings-register', 'parse.mjs')).href);
  const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
  const units = () => fs.readdirSync(path.join(FIX, 'units')).map((name) => ({ name, text: fs.readFileSync(path.join(FIX, 'units', name), 'utf8') }));
  const ownerMap = () => JSON.parse(fixture('owner-map.json'));
  const inputs = (extra = {}) => ({ raw: fixture('raw-register.tsv'), extras: fixture('extras.tsv'), triage: fixture('TRIAGE.md'), units: units(), ownerMap: ownerMap(), ...extra });
  const project = () => {
    const root = mkTmp('gsd-fr-');
    fs.cpSync(FIX, path.join(root, 'findings'), { recursive: true });
    return root;
  };
  const run = (root, args) => spawnSync(process.execPath, [FR, ...args, '--dir', 'findings', '--owner-map', 'findings/owner-map.json'], { cwd: root, encoding: 'utf8' });

  test('F-a parse: a quoted verdict cell survives, a wrong header is an error, quoted prose is not a verdict, owners and units normalise', async () => {
    const p = await parseMod();
    const raw = p.parseRawRegister(fixture('raw-register.tsv'));
    assert.ok(raw.ok);
    assert.strictEqual(raw.value.length, 9);
    assert.match(raw.value.find((r) => r.id === 'U1-Q3-2').ver_verdicts, /"profile_changed"/);
    assert.strictEqual(p.parseRawRegister('id\tunit\n').ok, false);
    assert.match(p.parseRawRegister(`${fixture('raw-register.tsv')}${fixture('raw-register.tsv').split('\n')[1]}\n`).error, /duplicate raw id/);
    const prose = p.parseRawRegister(fixture('raw-register.verdict-prose.tsv')).value[0];
    assert.deepStrictEqual(p.parseVerVerdict(prose.ver_verdicts), { verdict: 'OVERSTATED', sevVer: 'LOW', duplicateHint: false });
    assert.deepStrictEqual(p.parseVerVerdict('draft "CONFIRMED / HIGH" rejected; U1-ver.md:9 OVERSTATED / LOW'), { verdict: 'OVERSTATED', sevVer: 'LOW', duplicateHint: false });
    assert.strictEqual(p.parseVerVerdict('x OVERSTATED / MEDIUM (was HIGH)').sevVer, 'MED');
    assert.strictEqual(p.parseVerVerdict('x CONFIRMED / LOW → HIGH').sevVer, 'HIGH');
    assert.strictEqual(p.parseVerVerdict('pending verdict').verdict, '');
    assert.strictEqual(p.normaliseOwner('OWNED-BY-v1.2.3.'), 'OWNED-BY-v1.2.3');
    assert.strictEqual(p.normaliseOwner('OWNED-BY-v1.2.3.387.1-14'), 'OWNED-BY-v1.2.3 387.1-14');
    assert.strictEqual(p.normaliseOwner('this-milestone'), '');
    assert.deepStrictEqual(['U3a', 'U3b', 'P1'].map(p.collapseUnit), ['U3', 'U3', 'P1']);
  });

  test('F-b rows: the verdict sets sev_effective, the class sweep wins over the unit, an unmapped unit leaves the owner empty, triage keeps only table rows', async () => {
    const m = await mod();
    const built = m.buildRegister(inputs());
    assert.ok(built.ok, built.error);
    const by = (id) => built.value.find((r) => r.id === id);
    assert.strictEqual(by('U1-S9-2').sev_written, 'HIGH');
    assert.strictEqual(by('U1-S9-2').sev_effective, 'MED');
    assert.strictEqual(by('U1-S9-2').owner_phase, '110');
    assert.strictEqual(by('U1-Q3-1').owner_phase, '101');
    assert.strictEqual(by('U3a-Q3-2').owner_phase, '102');
    assert.strictEqual(by('U1-S5-1').owner_prev, 'OWNED-BY-v1.2.3 387.1');
    assert.deepStrictEqual(built.value.filter((r) => r.kind === 'triage').map((r) => [r.id, r.owner_phase, r.sev_effective]), [['T-1', '101', 'HIGH'], ['T-2', '105', 'MED']]);
    const noUnit = m.buildRegister(inputs({ ownerMap: { unit_phase: { U1: '101' } } }));
    assert.strictEqual(noUnit.value.find((r) => r.id === 'P1-Q3-4').owner_phase, '');
    assert.strictEqual(m.ownerPhase('U9', 'Q3', ownerMap()).ok, false);
    assert.strictEqual(m.ownerPhase('U9a', 'Q3', undefined).value, 'U9');
  });

  test('F-c evidence guard: a bare scratch token or missing committed path is red, lost: plus an -evidence/ path is green, an unproven row needs a route', async () => {
    const m = await mod();
    const row = (status, disposition_evidence) => ({ id: 'X-1', status, disposition_evidence });
    assert.deepStrictEqual(m.evidenceMessages([row('mutation-proven', 'see .tmp/run.log')]), ['bare scratch evidence: X-1 .tmp/run.log', 'no committed evidence: X-1']);
    assert.deepStrictEqual(m.evidenceMessages([row('mutation-proven', 'lost:.tmp/run.log docs/a-evidence/run.txt')]), []);
    assert.deepStrictEqual(m.evidenceMessages([row('fail-first-proven', 'prose lost:.tmp/run.log')]), ['no committed evidence: X-1']);
    assert.deepStrictEqual(m.evidenceMessages([row('mutation-proven', 'lost:docs/a-evidence/run.txt')]), ['no committed evidence: X-1']);
    assert.deepStrictEqual(m.evidenceMessages([row('mutation-proven', '.planning/test-runs/a.log docs/a-evidence/b.txt')]), ['bare scratch evidence: X-1 .planning/test-runs/a.log']);
    assert.deepStrictEqual(m.evidenceMessages([row('unproven', 'UNPROVEN 12-03: needs a fixture owner 405')]), []);
    assert.deepStrictEqual(m.evidenceMessages([row('unproven', 'UNPROVEN 12-03: needs a fixture owner 4056789')]), ['unproven without route: X-1']);
    assert.deepStrictEqual(m.evidenceMessages([row('unproven', 'later')]), ['unproven without route: X-1']);
    assert.deepStrictEqual(m.evidenceMessages([row('candidate', '.tmp/x')]), []);
  });

  test('F-d process: seed then check exits 0; a second seed is refused with the file unchanged; unit ids, owners and duplicates are checked', () => {
    const root = project();
    const seeded = run(root, ['seed']);
    assert.strictEqual(seeded.status, 0, seeded.stderr);
    assert.match(seeded.stdout, /seeded 11 rows/);
    const file = path.join(root, 'findings', 'FINDINGS.tsv');
    const before = fs.readFileSync(file, 'utf8');
    const ok = run(root, ['--check']);
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /resolved 9 of 9/);
    const again = run(root, ['seed']);
    assert.strictEqual(again.status, 1);
    assert.match(again.stderr, /seed is first-run only/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    // A source id with no register row: the raw row is deleted.
    const rawFile = path.join(root, 'findings', 'raw-register.tsv');
    const rawText = fs.readFileSync(rawFile, 'utf8');
    fs.writeFileSync(rawFile, rawText.split('\n').filter((l) => !l.startsWith('P1-S5-2\t')).join('\n'));
    const lost = run(root, ['--check']);
    assert.strictEqual(lost.status, 1);
    assert.match(lost.stderr, /unresolved: P1-S5-2 \(P1\.md:\d+\)/);
    fs.writeFileSync(rawFile, rawText);
    assert.strictEqual(run(root, ['--check']).status, 0);
    // A blank owner_phase in the committed register.
    fs.writeFileSync(file, before.replace('\t101\t', '\t\t'));
    const blank = run(root, ['--check']);
    assert.strictEqual(blank.status, 1);
    assert.match(blank.stderr, /empty owner_phase: /);
    // A duplicate id in the committed register.
    const lines = before.split('\n');
    fs.writeFileSync(file, [...lines.slice(0, -1), lines[1], ''].join('\n'));
    const dup = run(root, ['--check']);
    assert.strictEqual(dup.status, 1);
    assert.match(dup.stderr, /duplicate id in findings: U1-Q3-1/);
  });

  test('F-e process: a proven row with a bare scratch path fails --check; usage and unreadable inputs have their own exits', () => {
    const root = project();
    assert.strictEqual(run(root, ['seed']).status, 0);
    const file = path.join(root, 'findings', 'FINDINGS.tsv');
    const cols = fs.readFileSync(file, 'utf8').split('\n');
    const cells = cols[1].split('\t');
    cells[13] = 'seen in .tmp/out.log';
    cells[18] = 'mutation-proven';
    fs.writeFileSync(file, [cols[0], cells.join('\t'), ...cols.slice(2)].join('\n'));
    const bad = run(root, ['--check']);
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /bare scratch evidence: U1-Q3-1 \.tmp\/out\.log/);
    assert.strictEqual(spawnSync(process.execPath, [FR, 'frobnicate'], { cwd: root, encoding: 'utf8' }).status, 2);
    assert.strictEqual(spawnSync(process.execPath, [FR, '--check', '--dir'], { cwd: root, encoding: 'utf8' }).status, 2);
    const missing = spawnSync(process.execPath, [FR, '--check', '--dir', 'nowhere'], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stderr, /cannot read/);
    fs.writeFileSync(path.join(root, 'findings', 'owner-map.json'), '{"unit_phase": 3}');
    assert.match(run(root, ['--check']).stderr, /owner map unit_phase must map names/);
  });
});
