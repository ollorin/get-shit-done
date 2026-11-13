const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { LEVELS, resolveRigour, rigourViolations, phaseReqIds, phaseRiskDomains } = require('./rigour.js');

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
  test('absent line is standard/default; high is retired to standard with a notice; decimal phase and both colon styles', () => {
    write('.planning/ROADMAP.md', roadmap(''));
    assert.deepStrictEqual(resolveRigour(dir, '2'), { rigour: 'standard', rigour_source: 'default', rigour_decision: null, spike_roots: [], rigour_rejected_reason: null });
    const retired = resolveRigour(dir, '2.1');
    assert.deepStrictEqual([retired.rigour, retired.rigour_source, retired.rigour_decision, retired.spike_roots], ['standard', 'rejected', null, []]);
    assert.match(retired.rigour_rejected_reason, /"high" is retired/);
    write('.planning/ROADMAP.md', roadmap('**Rigour:** high'));
    assert.strictEqual(resolveRigour(dir, '2').rigour, 'standard');
    assert.strictEqual(resolveRigour(dir, '02').rigour_source, 'rejected');
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

  test('assess-risk: spike is false with a reason and reports containment violations; high is retired to standard', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    write('.planning/phases/02-spike-it/02-01-PLAN.md', plan(['spike/auth/login.js', 'src/app.js']));
    const out = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-01-PLAN.md', '--raw']).stdout);
    assert.strictEqual(out.high_risk, false);
    assert.deepStrictEqual(out.reasons, ['rigour: spike']);
    assert.deepStrictEqual(out.rigour_violation, ['src/app.js']);
    write('.planning/phases/02-spike-it/02-02-PLAN.md', plan(['x.js']).replace('02-spike-it', '2.1'));
    const high = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-02-PLAN.md', '--raw']).stdout);
    assert.strictEqual(high.rigour, 'standard');
    assert.strictEqual(high.high_risk, false);
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

describe('CLI-1: two levels', () => {
  test('LEVELS has two entries', () => assert.deepStrictEqual(LEVELS, ['standard', 'spike']));
  test('init plan-phase on a high phase exits 0 and carries the reason', () => {
    write('.planning/ROADMAP.md', roadmap('**Rigour**: high'));
    const r = run(['init', 'plan-phase', '2', '--legacy', '--raw']);
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.rigour, 'standard');
    assert.strictEqual(out.rigour_source, 'rejected');
    assert.match(out.rigour_rejected_reason, /retired/);
  });
  test('assess-risk in such a phase is standard and high_risk comes from the path match only', () => {
    write('.planning/ROADMAP.md', roadmap('**Rigour**: high'));
    const p = (f) => `---\nphase: 02-spike-it\nplan: 01\nfiles_modified:\n  - ${f}\n---\n\n# Plan\n`;
    write('.planning/phases/02-spike-it/02-01-PLAN.md', p('src/util.js'));
    const plain = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-01-PLAN.md', '--raw']).stdout);
    assert.strictEqual(plain.rigour, 'standard');
    assert.strictEqual(plain.high_risk, false);
    write('.planning/phases/02-spike-it/02-02-PLAN.md', p('src/auth/login.js'));
    const auth = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-02-PLAN.md', '--raw']).stdout);
    assert.strictEqual(auth.high_risk, true);
    assert.match(auth.reasons[0], /risk domain "auth"/);
  });
});

describe('CLI-2: OG2 authorises a spike through the approved roadmap gate', () => {
  const gates = (o) => write('.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@1.0', kind: 'roadmap', milestone: '1.0', status: 'approved', summary: '', rigour: { spike_phases: ['2'], spike_roots: ['spike/'] }, ...o }] }));
  const og2 = () => write('.planning/ROADMAP.md', roadmap('**Rigour**: spike (og2)\n**Spike roots**: spike/'));
  test('approved gate listing the phase is a spike with rigour_decision OG2 (case-insensitive)', () => {
    og2(); gates({});
    assert.deepStrictEqual(resolveRigour(dir, '2'), { rigour: 'spike', rigour_source: 'roadmap', rigour_decision: 'OG2', spike_roots: ['spike'], rigour_rejected_reason: null });
  });
  test('pending, rejected, and not-listed gates are rejected with the reason', () => {
    og2();
    gates({ status: 'pending' });
    assert.match(resolveRigour(dir, '2').rigour_rejected_reason, /roadmap gate roadmap@1.0 does not authorise a spike for phase 2 \(status pending\)/);
    gates({ status: 'rejected' });
    assert.strictEqual(resolveRigour(dir, '2').rigour_source, 'rejected');
    gates({ rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } });
    assert.strictEqual(resolveRigour(dir, '2').rigour, 'standard');
    assert.strictEqual(resolveRigour(dir, '2').rigour_source, 'rejected');
  });
  test('no gate at all is rejected; OG2 still needs spike roots', () => {
    og2();
    assert.strictEqual(resolveRigour(dir, '2').rigour_source, 'rejected');
    gates({});
    write('.planning/ROADMAP.md', roadmap('**Rigour**: spike (OG2)'));
    assert.match(resolveRigour(dir, '2').rigour_rejected_reason, /spike root/);
  });
  test('D-07 path is unchanged', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    assert.strictEqual(resolveRigour(dir, '2').rigour_decision, 'D-07');
  });
  test('owner-gate request stores spike phases and roots, replaces them on re-request, and needs roots', () => {
    const bad = run(['owner-gate', 'request', '--kind', 'roadmap', '--milestone', 'v1.0', '--summary', 's', '--spike-phases', '2']);
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /spike phases need --spike-roots/);
    const a = JSON.parse(run(['owner-gate', 'request', '--kind', 'roadmap', '--milestone', 'v1.0', '--summary', 's', '--spike-phases', '2,3', '--spike-roots', 'spike/,probe/', '--raw']).stdout);
    assert.deepStrictEqual(a.gate.rigour, { spike_phases: ['2', '3'], spike_roots: ['spike/', 'probe/'] });
    const b = JSON.parse(run(['owner-gate', 'request', '--kind', 'roadmap', '--milestone', 'v1.0', '--summary', 's', '--spike-phases', '2', '--spike-roots', 'spike/', '--raw']).stdout);
    assert.deepStrictEqual(b.gate.rigour.spike_phases, ['2']);
    assert.strictEqual(b.gate.requested_at, a.gate.requested_at);
    const st = JSON.parse(run(['owner-gate', 'status', '--milestone', 'v1.0', '--raw']).stdout);
    assert.deepStrictEqual(st.gates[0].rigour.spike_phases, ['2']);
  });
});

describe('CLI-8: phase_risk_domains from the ROADMAP', () => {
  test('line present, absent, none; unknown names are kept and listed', () => {
    write('.planning/ROADMAP.md', roadmap('**Risk domains**: auth, Payments'));
    assert.deepStrictEqual(phaseRiskDomains(dir, '2', ['auth', 'security']), { domains: ['auth', 'payments'], unknown: ['payments'] });
    assert.deepStrictEqual(phaseRiskDomains(dir, '1', ['auth']), { domains: [], unknown: [] });
    write('.planning/ROADMAP.md', roadmap('**Risk domains**: none'));
    assert.deepStrictEqual(phaseRiskDomains(dir, '2', ['auth']).domains, []);
  });
  test('init plan-phase and execute-phase emit them (configured domains are known); roadmap next carries them', () => {
    write('.planning/config.json', JSON.stringify({ project: { risk_domains: ['payments'] }, stack: {} }));
    write('.planning/ROADMAP.md', roadmap('**Risk domains**: auth, payments, odd'));
    for (const cmd of ['plan-phase', 'execute-phase']) {
      const out = JSON.parse(run(['init', cmd, '2', '--legacy', '--raw']).stdout);
      assert.deepStrictEqual(out.phase_risk_domains, ['auth', 'payments', 'odd'], cmd);
      assert.deepStrictEqual(out.phase_risk_domains_unknown, ['odd'], cmd);
    }
    const next = JSON.parse(run(['roadmap', 'next', '--raw']).stdout);
    assert.ok(Array.isArray(next.phase_risk_domains));
  });
  test('a spike phase still returns the line', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap(`${SPIKE}\n**Risk domains**: auth`));
    const out = JSON.parse(run(['init', 'plan-phase', '2', '--legacy', '--raw']).stdout);
    assert.deepStrictEqual([out.rigour, out.phase_risk_domains], ['spike', ['auth']]);
  });
});

describe('rigour text pins', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const text = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  test('plan-phase and execute-phase carry the spike branches and the round-cap clarification', () => {
    const plan = text('get-shit-done/workflows/plan-phase.md');
    assert.match(plan, /\*\*Spike branches \(`rigour` is `spike`\)/);
    assert.match(plan, /\*\*Risk-domain add-ons \(`standard` only\):\*\*/);
    assert.doesNotMatch(plan + text('get-shit-done/workflows/execute-phase.md'), /`rigour` is `high`/);
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

  test('the base preset scopes the risk-domain rules to standard', () => {
    assert.match(text('get-shit-done/presets/base/CLAUDE.md'), /apply at `standard` rigour/);
    assert.doesNotMatch(text('get-shit-done/presets/base/CLAUDE.md'), /`standard` and `high`/);
  });
});
