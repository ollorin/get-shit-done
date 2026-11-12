'use strict';

// The shard helper must run every top-level suite of a file in exactly one shard and never report an empty shard as a pass.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SHARD = path.join(__dirname, 'shard.js');
const tmps = [];
afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

// A target with five top-level suites (one nested, one failing on demand) and one top-level test, plus one wrapper per shard.
function fixture(count, { failing = false, suites = 5 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-shard-'));
  tmps.push(dir);
  const body = Array.from({ length: suites }, (_, k) => `describe('suite-${k}', () => { describe('inner-${k}', () => { test('t-${k}', () => { assert.ok(${failing && k === 3 ? 'false' : 'true'}); }); }); });`);
  fs.writeFileSync(path.join(dir, 'target.js'), `const { test, describe } = require('node:test');\nconst assert = require('node:assert');\n${body.join('\n')}\ntest('top-level', () => {});\n`);
  return Array.from({ length: count }, (_, i) => {
    const wrapper = path.join(dir, `shard${i}.test.js`);
    fs.writeFileSync(wrapper, `require(${JSON.stringify(SHARD)})(require.resolve('./target.js'), ${i}, ${count});\n`);
    return wrapper;
  });
}
// NODE_TEST_CONTEXT marks this process as a child of a test run; the nested runner must not inherit it.
const childEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};
const run = (file) => spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env: childEnv() });
const topLevel = (stdout) => stdout.split('\n').filter((l) => /^(ok|not ok) \d+ - /.test(l)).map((l) => l.replace(/^(ok|not ok) \d+ - /, ''));

test('two shards partition the top-level units in source order; nested suites and tests stay with their suite', () => {
  const [a, b] = fixture(2).map(run);
  assert.strictEqual(a.status, 0, a.stdout + a.stderr);
  assert.strictEqual(b.status, 0, b.stdout + b.stderr);
  assert.deepStrictEqual(topLevel(a.stdout), ['suite-0', 'suite-2', 'suite-4']);
  assert.deepStrictEqual(topLevel(b.stdout), ['suite-1', 'suite-3', 'top-level']);
  assert.match(a.stdout, /# tests 3\n/);
  assert.match(b.stdout, /# tests 3\n/);
  assert.match(b.stdout, /ok 1 - t-3/, 'the nested test ran');
});

test('a failing test fails its shard and only its shard', () => {
  const [a, b] = fixture(2, { failing: true }).map(run);
  assert.strictEqual(a.status, 0, a.stdout);
  assert.notStrictEqual(b.status, 0, b.stdout);
  assert.match(b.stdout, /not ok \d+ - suite-3/);
});

test('a shard that holds no suite, and an index outside the count, fail instead of passing with zero tests', () => {
  const empty = run(fixture(8, { suites: 2 })[5]);
  assert.notStrictEqual(empty.status, 0, empty.stdout);
  assert.match(empty.stdout + empty.stderr, /holds no suite/);
  assert.throws(() => require(SHARD)(SHARD, 2, 2), /not valid/);
});
