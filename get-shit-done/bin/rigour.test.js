const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { resolveRigour, rigourViolations, phaseReqIds } = require('./rigour.js');

const TOOL = path.join(__dirname, 'gsd-tools.js');
const decision = (o) => JSON.stringify({ kind: 'decision', status: 'active', source: 'owner-answer', phases: ['2'], ts: '2026-01-01T00:00:00Z', question: 'q', answer: 'a', ...o });
const roadmap = (body) => `# Roadmap\n\n### Phase 1: First\n**Goal**: g\n\n### Phase 2: Spike It\n**Goal**: g\n${body}\n\n### Phase 2.1: Decimal\n**Goal**: g\n**Rigour:** high\n`;

let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (args) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
const SPIKE = '**Rigour**: spike (D-07)\n**Spike roots**: spike/, scripts/probes/';

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-rigour-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('resolveRigour', () => {
  test('absent line is standard/default; high needs no id; decimal phase and both colon styles', () => {
    write('.planning/ROADMAP.md', roadmap(''));
    assert.deepStrictEqual(resolveRigour(dir, '2'), { rigour: 'standard', rigour_source: 'default', rigour_decision: null, spike_roots: [], rigour_rejected_reason: null });
    assert.strictEqual(resolveRigour(dir, '2.1').rigour, 'high');
    write('.planning/ROADMAP.md', roadmap('**Rigour:** high'));
    assert.strictEqual(resolveRigour(dir, '2').rigour, 'high');
    assert.strictEqual(resolveRigour(dir, '02').rigour, 'high');
    assert.strictEqual(resolveRigour(dir, '1').rigour_source, 'default');
  });

  test('valid spike carries decision id and roots, both colon styles', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    assert.deepStrictEqual(resolveRigour(dir, '2'), { rigour: 'spike', rigour_source: 'roadmap', rigour_decision: 'D-07', spike_roots: ['spike', 'scripts/probes'], rigour_rejected_reason: null });
    write('.planning/ROADMAP.md', roadmap('**Rigour:** spike (D-07)\n**Spike roots:** spike/'));
    assert.strictEqual(resolveRigour(dir, '2').rigour, 'spike');
  });

  test('G1 fails closed: no id, unknown id, A- id, superseded id, wrong phase, bad source, no roots', () => {
    const rejected = (r) => { assert.strictEqual(r.rigour, 'standard'); assert.strictEqual(r.rigour_source, 'rejected'); assert.ok(r.rigour_rejected_reason); };
    write('.planning/ROADMAP.md', roadmap('**Rigour**: spike\n**Spike roots**: spike/'));
    rejected(resolveRigour(dir, '2'));
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    rejected(resolveRigour(dir, '2')); // no ledger
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-08' }) + '\n');
    rejected(resolveRigour(dir, '2')); // unknown id
    write('.planning/DECISIONS.jsonl', JSON.stringify({ id: 'A-07', kind: 'assumption', status: 'open', phases: ['2'], source: 'x', ts: '2026-01-01T00:00:00Z' }) + '\n');
    write('.planning/ROADMAP.md', roadmap('**Rigour**: spike (A-07)\n**Spike roots**: spike/'));
    rejected(resolveRigour(dir, '2'));
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n' + decision({ id: 'D-07', status: 'superseded' }) + '\n');
    rejected(resolveRigour(dir, '2'));
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07', phases: ['3'] }) + '\n');
    rejected(resolveRigour(dir, '2'));
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07', source: 'assumed' }) + '\n');
    rejected(resolveRigour(dir, '2'));
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap('**Rigour**: spike (D-07)'));
    rejected(resolveRigour(dir, '2')); // no roots
    write('.planning/ROADMAP.md', roadmap('**Rigour**: extreme'));
    rejected(resolveRigour(dir, '2'));
  });

  test('G3: a spike root equal to or containing a production path is rejected', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/config.json', JSON.stringify({ project: {}, stack: { style: { roots: ['src'] }, paths: { source: ['lib/'] } } }));
    for (const root of ['src/', 'src/spike/', '.', 'lib']) {
      write('.planning/ROADMAP.md', roadmap(`**Rigour**: spike (D-07)\n**Spike roots**: ${root}`));
      const r = resolveRigour(dir, '2');
      assert.strictEqual(r.rigour_source, 'rejected', root);
      assert.match(r.rigour_rejected_reason, /overlaps/);
    }
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    assert.strictEqual(resolveRigour(dir, '2').rigour, 'spike');
  });
});

describe('rigourViolations / phaseReqIds', () => {
  test('paths outside the roots and .planning/ are violations', () => {
    assert.deepStrictEqual(rigourViolations(['spike'], ['spike/a.js', '.planning/x.md', 'src/b.js', 'spikes/c.js']), ['src/b.js', 'spikes/c.js']);
  });
  test('requirement ids are read from the phase Requirements line, brackets stripped', () => {
    write('.planning/ROADMAP.md', roadmap('**Requirements**: [AUTH-01, AUTH-02]'));
    assert.deepStrictEqual(phaseReqIds(dir, '2'), ['AUTH-01', 'AUTH-02']);
    assert.deepStrictEqual(phaseReqIds(dir, '1'), []);
  });
});

describe('init and assess-risk emit rigour', () => {
  const plan = (files, extra = '') => `---\nphase: 02-spike-it\nplan: 01\nfiles_modified:\n${files.map((f) => `  - ${f}`).join('\n')}\n${extra}---\n\n# Plan\n`;

  test('init plan-phase and execute-phase emit the rigour fields and phase_req_ids', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap(`${SPIKE}\n**Requirements**: AUTH-01`));
    for (const cmd of ['plan-phase', 'execute-phase']) {
      const out = JSON.parse(run(['init', cmd, '2', '--legacy', '--raw']).stdout);
      assert.strictEqual(out.rigour, 'spike', cmd);
      assert.strictEqual(out.rigour_source, 'roadmap');
      assert.strictEqual(out.rigour_decision, 'D-07');
      assert.deepStrictEqual(out.spike_roots, ['spike', 'scripts/probes']);
      assert.strictEqual(out.rigour_rejected_reason, null);
      assert.deepStrictEqual(out.phase_req_ids, ['AUTH-01']);
    }
  });

  test('regression pin: no Rigour line leaves the pre-existing init keys unchanged apart from rigour: standard', () => {
    write('.planning/ROADMAP.md', roadmap(''));
    const out = JSON.parse(run(['init', 'plan-phase', '2', '--legacy', '--raw']).stdout);
    assert.strictEqual(out.rigour, 'standard');
    assert.strictEqual(out.rigour_source, 'default');
    assert.strictEqual(out.phase_name, 'Spike It');
    assert.strictEqual(out.ruling_model, 'opus');
  });

  test('assess-risk: spike is false with a reason and reports containment violations; high is true', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    write('.planning/phases/02-spike-it/02-01-PLAN.md', plan(['spike/auth/login.js', 'src/app.js']));
    const out = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-01-PLAN.md', '--raw']).stdout);
    assert.strictEqual(out.high_risk, false);
    assert.deepStrictEqual(out.reasons, ['rigour: spike']);
    assert.deepStrictEqual(out.rigour_violation, ['src/app.js']);
    write('.planning/phases/02-spike-it/02-02-PLAN.md', plan(['x.js']).replace('02-spike-it', '2.1'));
    const high = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-02-PLAN.md', '--raw']).stdout);
    assert.strictEqual(high.high_risk, true);
    assert.deepStrictEqual(high.reasons, ['rigour: high']);
  });

  test('assess-risk: a rejected spike (G3 overlap) is scored as standard and says why', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/config.json', JSON.stringify({ project: {}, stack: { style: { roots: ['spike'] } } }));
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    write('.planning/phases/02-spike-it/02-01-PLAN.md', plan(['spike/a.js']));
    const out = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-01-PLAN.md', '--raw']).stdout);
    assert.strictEqual(out.rigour, 'standard');
    assert.match(out.rigour_rejected_reason, /overlaps/);
  });

  test('defect fix: toggle off + a risk-domain path is high_risk true at standard (the early return no longer hides risk domains)', () => {
    write('.planning/ROADMAP.md', roadmap(''));
    write('.planning/phases/02-spike-it/02-01-PLAN.md', plan(['src/auth/login.js']));
    const out = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-01-PLAN.md', '--raw']).stdout);
    assert.strictEqual(out.high_risk, true);
    assert.match(out.reasons[0], /risk domain "auth"/);
    write('.planning/phases/02-spike-it/02-02-PLAN.md', plan(['src/util.js']));
    assert.strictEqual(JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-02-PLAN.md', '--raw']).stdout).high_risk, false);
  });
});

describe('rigour text pins', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const text = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  test('plan-phase and execute-phase carry the spike branches and the round-cap clarification', () => {
    const plan = text('get-shit-done/workflows/plan-phase.md');
    assert.match(plan, /\*\*Spike branches \(`rigour` is `spike`\)/);
    assert.match(plan, /\*\*Which round cap governs what:\*\*/);
    assert.match(plan, /`phase_req_ids`/);
    const exec = text('get-shit-done/workflows/execute-phase.md');
    assert.match(exec, /When `rigour` is `spike`: no test-writer spawn/);
    assert.match(exec, /SPIKE-RESULT\.md/);
  });

  test('planner, checker, verifier and executor reference references/rigour.md and the file ships', () => {
    for (const a of ['gsd-planner', 'gsd-plan-checker', 'gsd-verifier', 'gsd-executor']) {
      assert.match(text(`agents/${a}.md`), /references\/rigour\.md/, a);
    }
    assert.ok(fs.existsSync(path.join(ROOT, 'get-shit-done', 'references', 'rigour.md')));
  });

  test('the checker blocks a non-spike plan that promotes a spike root', () => {
    assert.match(text('agents/gsd-plan-checker.md'), /spike_promotion/);
  });

  test('the base preset scopes the risk-domain rules to standard and high', () => {
    assert.match(text('get-shit-done/presets/base/CLAUDE.md'), /apply at `standard` and `high` rigour/);
  });
});
