const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, 'gate.py');

function run(rows, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.mkdirSync(path.join(dir, 'results'));
  fs.writeFileSync(path.join(dir, 'results', 'runs.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync('python3', [GATE, 'decide', '--arm', 'F', ...extra], {
    env: { ...process.env, AB_HOME: dir, EVOLVE_HOME: path.join(dir, 'ev') },
    encoding: 'utf8',
  });
  const m = /"verdict": "([^"]*)"/.exec(r.stdout);
  return m && m[1];
}

function rows(tasks, n, hidden) {
  const out = [];
  for (const t of tasks) for (const v of ['A', 'F']) for (let i = 0; i < n; i++) {
    out.push({ status: 'done', task_id: t, variant: v, acceptance_pass: true, first_turn_tok: v === 'F' ? 100 : 200,
      hidden: hidden ? { files: [{ counts: { passed: v === 'F' ? 1 : 0, failed: v === 'F' ? 0 : 1 } }] } : undefined });
  }
  return out;
}

test('empty corpus at n=10 is never ADOPT', () => {
  const v = run(rows(['E6', 'E7'], 10, false), ['--canary', 'E6,E7']);
  assert.match(v, /^INSUFFICIENT/);
});

test('fewer than 3 scorable corpus tasks is never ADOPT', () => {
  const v = run(rows(['E6', 'R1', 'R2'], 10, true), ['--canary', 'E6', '--corpus', 'R1,R2']);
  assert.match(v, /^INSUFFICIENT/);
});

test('enough scorable tasks with a quality gain can still ADOPT', () => {
  const v = run(rows(['E6', 'R1', 'R2', 'R3'], 10, true), ['--canary', 'E6', '--corpus', 'R1,R2,R3']);
  assert.match(v, /^ADOPT/);
});
