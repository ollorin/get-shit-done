'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, 'gsd-tools.js');
let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (args, env = {}) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, STACK_LOCK_HELD: '', ...env } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-sizer-'));
  write('.planning/ROADMAP.md', '# Roadmap\n\n### Phase 1: One\n**Goal**: g\n');
  write('.planning/STATE.md', '# s\n');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const sizerRoad = (extra) => `# Roadmap\n\n### Phase 1: One\n**Goal**: g\n**Risk domains**: auth\n**Requirements**: ${extra.reqs}\n**Success Criteria**:\n${extra.sc}\n`;
const nums = (n) => Array.from({ length: n }, (_, i) => `${i + 1}. criterion ${i + 1}`).join('\n');

test('init plan-phase prints a sizer notice for an oversized risk phase and an override above 2x; a small phase and a standard phase are silent; never a block', () => {
  write('.planning/ROADMAP.md', sizerRoad({ reqs: 'A-01, A-02, A-03, A-04, A-05, A-06, A-07, A-08, A-09, A-10, A-11', sc: nums(7) }));
  const big = run(['init', 'plan-phase', '1', '--legacy', '--raw']);
  assert.strictEqual(big.status, 0);
  assert.match(big.stderr, /Notice: risk phase 1 has 6 plans \(sizer limit/);
  assert.doesNotMatch(big.stderr, /plans \d+ plans/);
  assert.match(big.stderr, /Notice: risk phase 1 has 7 success criteria/);
  assert.strictEqual(JSON.parse(big.stdout).sizer_notice.length, 2);
  write('.planning/ROADMAP.md', sizerRoad({ reqs: 'A-01, A-02', sc: nums(2) }));
  assert.deepStrictEqual(JSON.parse(run(['init', 'plan-phase', '1', '--legacy', '--raw']).stdout).sizer_notice, []);
  write('.planning/config.json', JSON.stringify({ workflow: { budget: { risk: { wall_minutes: 1000 } } } }));
  const over = run(['init', 'plan-phase', '1', '--legacy', '--raw']);
  assert.strictEqual(over.status, 0);
  assert.match(over.stderr, /Notice: budget override 1000 min is 6\.7x the risk default 150/);
  write('.planning/ROADMAP.md', '# Roadmap\n\n### Phase 1: One\n**Goal**: g\n');
  write('.planning/config.json', '{}');
  assert.deepStrictEqual(JSON.parse(run(['init', 'plan-phase', '1', '--legacy', '--raw']).stdout).sizer_notice, []);
});
