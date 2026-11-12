'use strict';
// L1 prompt-site lint, L2 model-literal lint, L3 ~/.claude trailing-slash lint for the unattended path.
// See get-shit-done/references/auto-mode.md.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GSD = path.join(ROOT, 'get-shit-done');

// Files an unattended run reads. Files owned by a later build step stay out of the list until that step lands.
const SCOPE = [
  'get-shit-done/workflows/plan-phase.md',
  'get-shit-done/workflows/execute-phase.md',
  'get-shit-done/workflows/execute-plan.md',
  'get-shit-done/workflows/transition.md',
  'get-shit-done/workflows/execute-roadmap.md',
  'get-shit-done/references/coordinator-detail.md',
  'agents/gsd-phase-coordinator.md',
  'commands/gsd/execute-roadmap.md',
];
const PENDING = {
  'get-shit-done/workflows/new-milestone.md': 'milestone build step',
  'commands/gsd/new-milestone.md': 'milestone build step',
};

const SITE = /AskUserQuestion|wait for (the )?user|Type "|type "|present .* (and )?wait|\boffer\b/i;
const AUTO_LINE = /Auto \(auto_mode, references\/auto-mode\.md K[1-6](?:\/K[1-6])*\)/;
const WINDOW = 12;

// A site that is not a prompt: a rule statement, a definition of a flag, or a human-only contract. Each needs a reason.
const ALLOW = [
  { file: 'get-shit-done/workflows/execute-plan.md', line: 'After response: verify if specified.', reason: 'checkpoint protocol of an interactive run; under auto_mode the executor returns the structured checkpoint state and execute-phase checkpoint_handling applies K1/K4' },
  { file: 'get-shit-done/workflows/execute-plan.md', line: '`type="checkpoint:*"`: STOP', reason: 'the executor stops and returns the checkpoint to the spawner, which applies K1/K4; the executor never answers it' },
  { file: 'get-shit-done/workflows/execute-plan.md', line: 'Wait for user to authenticate', reason: 'auth gates are human-action: the executor returns them as a checkpoint, execute-phase applies K4' },
  { file: 'get-shit-done/workflows/execute-phase.md', line: 'Checkpoints in parallel waves', reason: 'describes pausing and returning, not a prompt' },
];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').split('\n');

function findSites(rel) {
  const lines = read(rel);
  const bad = [];
  lines.forEach((text, i) => {
    if (!SITE.test(text)) return;
    if (text.includes('references/auto-mode.md')) return; // the rule statements themselves
    if (ALLOW.some((a) => a.file === rel && text.includes(a.line))) return;
    const from = Math.max(0, i - WINDOW);
    const to = Math.min(lines.length, i + WINDOW + 1);
    if (lines.slice(from, to).some((l) => AUTO_LINE.test(l))) return;
    bad.push(`${rel}:${i + 1}: ${text.trim().slice(0, 100)}`);
  });
  return bad;
}

describe('L1 every prompt site in the unattended path names its auto action', () => {
  for (const rel of SCOPE) {
    test(rel, () => {
      assert.deepStrictEqual(findSites(rel), [], 'add `Auto (auto_mode, references/auto-mode.md K<n>): <action>.` within 12 lines, or an ALLOW entry with a reason');
    });
  }
  test('the lint detects an unmarked site (canary)', () => {
    const tmp = path.join(ROOT, '.tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const rel = '.tmp/auto-lint-canary.md';
    fs.writeFileSync(path.join(ROOT, rel), `x\n${'\n'.repeat(20)}Use AskUserQuestion to ask.\n${'\n'.repeat(20)}`);
    try { assert.strictEqual(findSites(rel).length, 1); } finally { fs.rmSync(path.join(ROOT, rel), { force: true }); }
    fs.writeFileSync(path.join(ROOT, rel), 'Use AskUserQuestion.\nAuto (auto_mode, references/auto-mode.md K2): proceed.\n');
    try { assert.strictEqual(findSites(rel).length, 0); } finally { fs.rmSync(path.join(ROOT, rel), { force: true }); }
  });
  test('every allowlist entry still matches a line (no stale entries) and carries a reason', () => {
    for (const a of ALLOW) {
      assert.ok(a.reason.length > 10, `${a.file}: reason`);
      assert.ok(read(a.file).some((l) => l.includes(a.line)), `stale allowlist entry: ${a.file}: ${a.line}`);
    }
  });
  test('pending files exist', () => {
    for (const rel of Object.keys(PENDING)) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
  });
});

describe('L2 no model literals in the scanned workflows', () => {
  for (const rel of SCOPE) {
    test(rel, () => {
      const hits = read(rel).map((t, i) => [i + 1, t]).filter(([, t]) => /model="(haiku|sonnet|opus|fable)"/.test(t));
      assert.deepStrictEqual(hits, []);
    });
  }
});

describe('L3 ~/.claude paths carry the trailing slash the installer rewrites', () => {
  const dirs = ['get-shit-done/workflows', 'get-shit-done/references', 'agents', 'commands/gsd'];
  test('no bare ~/.claude (or $HOME/.claude) reference', () => {
    const bad = [];
    for (const d of dirs) {
      for (const f of fs.readdirSync(path.join(ROOT, d)).filter((n) => n.endsWith('.md'))) {
        read(path.join(d, f)).forEach((t, i) => {
          if (/(?:~|\$HOME|\$\{HOME\})\/\.claude(?![\w/.-])/.test(t)) bad.push(`${d}/${f}:${i + 1}`);
        });
      }
    }
    assert.deepStrictEqual(bad, []);
  });
});

describe('auto-mode reference', () => {
  test('defines every class and every source', () => {
    const text = fs.readFileSync(path.join(GSD, 'references', 'auto-mode.md'), 'utf-8');
    for (const k of ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']) assert.ok(text.includes(`| ${k} `), k);
    for (const src of ['flag', 'env', 'config_mode', 'config_auto_advance', 'config_auto_chain']) assert.ok(text.includes(`\`${src}\``), src);
  });
});

describe('T3 workflow pins', () => {
  const text = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  test('plan-phase documents --no-advance as the step 14 stop condition and passes --auto to init', () => {
    const t = text('get-shit-done/workflows/plan-phase.md');
    assert.match(t, /`--no-advance`/);
    assert.match(t, /If `--no-advance` is in \$ARGUMENTS:\*\* do not launch execute-phase/);
    assert.match(t, /init plan-phase "\$PHASE" \$LEGACY_FLAG \$AUTO_FLAG/);
  });
  test('execute-phase writes the verify checkpoint before routing on status, and owns the UX sweep and E2E steps', () => {
    const t = text('get-shit-done/workflows/execute-phase.md');
    assert.ok(t.indexOf('phase checkpoint "${PHASE_NUMBER}" --step verify') > t.indexOf('<step name="verify_phase_goal">'));
    assert.ok(t.indexOf('phase checkpoint "${PHASE_NUMBER}" --step verify') < t.indexOf('<step name="update_roadmap">'));
    const sweep = t.indexOf('<step name="post_phase_ux_sweep">');
    const e2e = t.indexOf('<step name="post_phase_e2e">');
    const gates = t.indexOf('<step name="pre_verify_gates">');
    assert.ok(sweep > 0 && sweep < e2e && e2e < gates, 'sweep, then e2e, then pre_verify_gates');
    assert.match(t, /mode=ux-audit/);
    assert.match(t, /init execute-phase "\$\{PHASE_ARG\}" \$LEGACY_FLAG \$AUTO_FLAG/);
  });
  test('execute-phase does not read the two auto config keys itself outside the chain-advance step', () => {
    const t = text('get-shit-done/workflows/execute-phase.md');
    const cp = t.slice(t.indexOf('<step name="checkpoint_handling">'), t.indexOf('<step name="aggregate_results">'));
    assert.doesNotMatch(cp, /config get workflow\.auto_advance/);
  });
});
