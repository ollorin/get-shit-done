'use strict';

// WP4: the rolling stack-free gate runner and the gate capture script of the base preset.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

  test('nothing to run prints the explicit line and exits 0', () => {
    const r = run(project({ gates: [{ id: 'needs', run: 'exit 1' }] }), 'no-stack-gates.mjs');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /no stack-free gates configured/);
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

  test('a second capture appends; missing arguments exit 2', () => {
    const dir = project();
    capture(dir, 'a', 'echo x');
    capture(dir, 'b', 'echo y');
    assert.match(captured(dir), /GATE a rc=0 lines=1\n\$ b\ny\nGATE b rc=0 lines=1\n$/);
    assert.strictEqual(run(dir, 'gate-capture.mjs', 'only-one').status, 2);
  });
});
