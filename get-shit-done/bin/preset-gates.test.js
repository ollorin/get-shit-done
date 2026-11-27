'use strict';

// WP4: the rolling stack-free gate runner and the gate capture script of the base preset.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const SCRIPTS = path.join(__dirname, '..', 'presets', 'base', 'scripts');
const tmps = [];
afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

function project(stack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  tmps.push(dir);
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  if (stack !== undefined) fs.writeFileSync(path.join(dir, '.planning', 'config.json'), typeof stack === 'string' ? stack : JSON.stringify({ stack }));
  return dir;
}
const run = (dir, script, ...args) => spawnSync('node', [path.join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' });
const mark = (dir, name) => path.join(dir, name);
const touch = (name) => `node -e "require('fs').writeFileSync('${name}','x')"`;

describe('no-stack-gates', () => {
  test('runs only needs_stack:false gates; true, absent and non-boolean entries are skipped', () => {
    const dir = project({
      gates: [
        { id: 'free', run: touch('ran-free'), needs_stack: false },
        { id: 'needs', run: touch('ran-needs'), needs_stack: true },
        { id: 'unknown', run: touch('ran-unknown') },
        { id: 'stringy', run: touch('ran-stringy'), needs_stack: 'false' },
      ],
    });
    const r = run(dir, 'no-stack-gates.mjs');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(mark(dir, 'ran-free')));
    for (const n of ['ran-needs', 'ran-unknown', 'ran-stringy']) assert.ok(!fs.existsSync(mark(dir, n)), n);
    assert.match(r.stdout, /free: PASS/);
  });

  test('typecheck and lint commands run; a failing gate exits 1 and the others still run', () => {
    const dir = project({
      commands: { typecheck: touch('ran-tc'), lint: 'none' },
      gates: [
        { id: 'bad', run: 'exit 3', needs_stack: false },
        { id: 'good', run: touch('ran-good'), needs_stack: false },
      ],
    });
    const r = run(dir, 'no-stack-gates.mjs');
    assert.strictEqual(r.status, 1);
    assert.ok(fs.existsSync(mark(dir, 'ran-tc')));
    assert.ok(fs.existsSync(mark(dir, 'ran-good')));
    assert.match(r.stdout, /bad: FAIL rc=3/);
  });

  test('nothing to run prints NO GATES RAN, names each skipped gate and exits 0', () => {
    const r = run(project({ gates: [{ id: 'needs', run: 'exit 1' }, { id: 'odd', run: 'exit 1', needs_stack: 'false' }] }), 'no-stack-gates.mjs');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /NO GATES RAN: no stack-free gates configured \(this is not a gate pass\)/);
    assert.match(r.stdout, /^needs: SKIPPED \(needs stack or invalid needs_stack\)$/m);
    assert.match(r.stdout, /^odd: SKIPPED \(needs stack or invalid needs_stack\)$/m);
  });

  test('a gate command that kills its own shell is a failure, not a pass', () => {
    const r = run(project({ gates: [{ id: 'dies', run: 'kill -9 $$', needs_stack: false }] }), 'no-stack-gates.mjs');
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /dies: FAIL/);
  });

  test('an unreadable or malformed config exits 2', () => {
    assert.strictEqual(run(project(), 'no-stack-gates.mjs').status, 2);
    assert.strictEqual(run(project('{not json'), 'no-stack-gates.mjs').status, 2);
    assert.strictEqual(run(project({ gates: 'x' }), 'no-stack-gates.mjs').status, 2);
  });
});

describe('gate-capture', () => {
  const capture = (dir, id, cmd) => run(dir, 'gate-capture.mjs', path.join(dir, 'captures', 'gates.txt'), id, cmd);
  const captured = (dir) => fs.readFileSync(path.join(dir, 'captures', 'gates.txt'), 'utf8');

  test('short output is kept inline with its rc line, and the rc is the exit code', () => {
    const dir = project();
    const r = capture(dir, 'style', 'echo one; echo two 1>&2; exit 4');
    assert.strictEqual(r.status, 4);
    assert.strictEqual(captured(dir), '$ style\none\ntwo\nGATE style rc=4 lines=2\n');
    assert.match(r.stdout, /^GATE style rc=4 lines=2$/m);
  });

  test('large output is kept in full in a log file and summarised by head and tail', () => {
    const dir = project();
    const r = capture(dir, 'big', 'seq 1 100');
    assert.strictEqual(r.status, 0);
    const log = path.join(dir, 'captures', 'big.log');
    assert.strictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').length, 100);
    const text = captured(dir);
    assert.match(text, /^1\n2\n/m);
    assert.match(text, /\n99\n100\n/);
    assert.ok(!text.includes('\n50\n'));
    assert.match(text, /GATE big rc=0 lines=100 full=.*big\.log\n$/);
  });

  test('a gate command that kills its own shell gives a non-zero rc', () => {
    const dir = project();
    const r = capture(dir, 'dies', 'kill -9 $$');
    assert.notStrictEqual(r.status, 0);
    assert.match(captured(dir), /GATE dies rc=[1-9]/);
  });

  test('output past the buffer adds an OUTPUT TRUNCATED line and a non-zero rc', () => {
    const dir = project();
    const r = capture(dir, 'huge', `node -e "process.stdout.write('x'.repeat(300000000))"`);
    assert.notStrictEqual(r.status, 0);
    assert.match(captured(dir), /OUTPUT TRUNCATED/);
  });

  test('an id outside [A-Za-z0-9._-] exits 2 and writes nothing', () => {
    const dir = project();
    for (const id of ['../x', 'a/b', 'a b', '']) assert.strictEqual(capture(dir, id, 'echo x').status, 2, id);
    assert.ok(!fs.existsSync(path.join(dir, 'captures')));
  });

  test('a second capture appends; missing arguments exit 2', () => {
    const dir = project();
    capture(dir, 'a', 'echo x');
    capture(dir, 'b', 'echo y');
    assert.match(captured(dir), /GATE a rc=0 lines=1\n\$ b\ny\nGATE b rc=0 lines=1\n$/);
    assert.strictEqual(run(dir, 'gate-capture.mjs', 'only-one').status, 2);
  });
});

describe('timeout path', () => {
  test('a timed-out gate is killed with SIGKILL after 600000 ms and reports rc=timeout in both runners', () => {
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-stub-'));
    tmps.push(stubDir);
    const record = path.join(stubDir, 'options.json');
    const stub = path.join(stubDir, 'timeout-stub.mjs');
    fs.writeFileSync(stub, [
      "import cp from 'node:child_process';",
      "import fs from 'node:fs';",
      "import { syncBuiltinESMExports } from 'node:module';",
      'cp.spawnSync = (command, options) => {',
      `  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ timeout: options.timeout, killSignal: options.killSignal }));`,
      "  return { status: null, error: { code: 'ETIMEDOUT' } };",
      '};',
      'syncBuiltinESMExports();',
    ].join('\n'));
    const dir = project({ gates: [{ id: 'x', run: 'echo never', needs_stack: false }] });
    const runWithStub = (script, ...args) => spawnSync('node', ['--import', pathToFileURL(stub).href, path.join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' });
    const recorded = () => JSON.parse(fs.readFileSync(record, 'utf8'));
    const expected = { timeout: 600000, killSignal: 'SIGKILL' };

    const gate = runWithStub('no-stack-gates.mjs');
    assert.strictEqual(gate.status, 1, gate.stderr);
    assert.match(gate.stdout, /^x: FAIL rc=timeout$/m);
    assert.deepStrictEqual(recorded(), expected);

    const capture = runWithStub('gate-capture.mjs', path.join(dir, 'captures', 'gates.txt'), 'x', 'echo never');
    assert.strictEqual(capture.status, 1, capture.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'captures', 'gates.txt'), 'utf8'), /GATE x rc=timeout lines=0\n$/);
    assert.deepStrictEqual(recorded(), expected);
  });
});
