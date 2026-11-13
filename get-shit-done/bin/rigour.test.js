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
const SPIKE = '**Rigour**: spike (OG2)\n**Spike roots**: spike/, scripts/probes/';
const gate = (o = {}) => write('.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', summary: '', rigour: { spike_phases: ['2'], spike_roots: ['spike/', 'scripts/probes/'] }, ...o }] }));

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-rigour-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('resolveRigour', () => {
  const NOTICE = null;
  test('absent line is standard/default; high is retired to standard with a notice; decimal phase and both colon styles', () => {
    write('.planning/ROADMAP.md', roadmap(''));
    assert.deepStrictEqual(resolveRigour(dir, '2'), { rigour: 'standard', rigour_source: 'default', spike_roots: [], rigour_rejected_reason: null, rigour_notice: NOTICE });
    const retired = resolveRigour(dir, '2.1');
    assert.deepStrictEqual([retired.rigour, retired.rigour_source, retired.spike_roots], ['standard', 'rejected', []]);
    assert.match(retired.rigour_rejected_reason, /"high" is retired/);
    write('.planning/ROADMAP.md', roadmap('**Rigour:** high'));
    assert.strictEqual(resolveRigour(dir, '2').rigour, 'standard');
    assert.strictEqual(resolveRigour(dir, '02').rigour_source, 'rejected');
    assert.strictEqual(resolveRigour(dir, '1').rigour_source, 'default');
  });

  test('the approved roadmap gate is the only spike authority; roots come from the gate', () => {
    gate();
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    assert.deepStrictEqual(resolveRigour(dir, '2'), { rigour: 'spike', rigour_source: 'roadmap', spike_roots: ['spike', 'scripts/probes'], rigour_rejected_reason: null, rigour_notice: NOTICE });
    write('.planning/ROADMAP.md', roadmap('**Rigour:** spike (OG2)\n**Spike roots:** spike/, scripts/probes/'));
    assert.strictEqual(resolveRigour(dir, '2').rigour, 'spike');
  });

  test('a D- ledger row never authorises a spike (H3: attestation route deleted)', () => {
    write('.planning/DECISIONS.jsonl', decision({ id: 'D-07' }) + '\n');
    write('.planning/ROADMAP.md', roadmap('**Rigour**: spike (D-07)\n**Spike roots**: spike/'));
    const r = resolveRigour(dir, '2');
    assert.deepStrictEqual([r.rigour, r.rigour_source], ['standard', 'rejected']);
    assert.match(r.rigour_rejected_reason, /approved roadmap gate/);
  });

  test('no gate, pending or rejected gate, phase not listed, gate without roots: all reject; unknown rigour value rejects', () => {
    const rejected = (r) => { assert.strictEqual(r.rigour, 'standard'); assert.strictEqual(r.rigour_source, 'rejected'); assert.ok(r.rigour_rejected_reason); };
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    rejected(resolveRigour(dir, '2'));
    for (const o of [{ status: 'pending' }, { status: 'rejected' }, { rigour: { spike_phases: ['3'], spike_roots: ['spike/'] } }, { rigour: { spike_phases: ['2'], spike_roots: [] } }]) { gate(o); rejected(resolveRigour(dir, '2')); }
    write('.planning/ROADMAP.md', roadmap('**Rigour**: extreme'));
    rejected(resolveRigour(dir, '2'));
  });

  test('M3: the gate is authority for phases and roots; a ROADMAP mismatch is a notice, never authority', () => {
    gate({ rigour: { spike_phases: ['2'], spike_roots: ['spike/'] } });
    write('.planning/ROADMAP.md', roadmap('**Rigour**: spike (OG2)\n**Spike roots**: src/payments/'));
    const a = resolveRigour(dir, '2');
    assert.deepStrictEqual([a.rigour, a.spike_roots], ['spike', ['spike']]);
    assert.match(a.rigour_notice, /differ from the gate/);
    write('.planning/ROADMAP.md', roadmap(''));
    const b = resolveRigour(dir, '2');
    assert.strictEqual(b.rigour, 'spike');
    assert.match(b.rigour_notice, /ROADMAP says rigour standard/);
  });

  test('G3: a gate spike root equal to or containing a production path is rejected', () => {
    write('.planning/config.json', JSON.stringify({ project: {}, stack: { style: { roots: ['src'] }, paths: { source: ['lib/'] } } }));
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    for (const root of ['src/', 'src/spike/', '.', 'lib']) {
      gate({ rigour: { spike_phases: ['2'], spike_roots: [root] } });
      const r = resolveRigour(dir, '2');
      assert.strictEqual(r.rigour_source, 'rejected', root);
      assert.match(r.rigour_rejected_reason, /overlaps/);
    }
    gate();
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
    gate();
    write('.planning/ROADMAP.md', roadmap(`${SPIKE}\n**Requirements**: AUTH-01`));
    for (const cmd of ['plan-phase', 'execute-phase']) {
      const out = JSON.parse(run(['init', cmd, '2', '--legacy', '--raw']).stdout);
      assert.strictEqual(out.rigour, 'spike', cmd);
      assert.strictEqual(out.rigour_source, 'roadmap');
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
    gate();
    write('.planning/ROADMAP.md', roadmap(SPIKE));
    write('.planning/phases/02-spike-it/02-01-PLAN.md', plan(['spike/auth/login.js', 'src/app.js']));
    const out = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-01-PLAN.md', '--raw']).stdout);
    assert.strictEqual(out.high_risk, false);
    assert.deepStrictEqual(out.reasons, ['rigour: spike']);
    assert.deepStrictEqual(out.rigour_violation, ['src/app.js']);
    assert.deepStrictEqual(out.spike_roots, ['spike', 'scripts/probes']);
    write('.planning/phases/02-spike-it/02-02-PLAN.md', plan(['x.js']).replace('02-spike-it', '2.1'));
    const high = JSON.parse(run(['quality', 'assess-risk', '.planning/phases/02-spike-it/02-02-PLAN.md', '--raw']).stdout);
    assert.strictEqual(high.rigour, 'standard');
    assert.strictEqual(high.high_risk, false);
  });

  test('assess-risk: a rejected spike (G3 overlap) is scored as standard and says why', () => {
    gate({ rigour: { spike_phases: ['2'], spike_roots: ['spike/'] } });
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

describe('owner-gate request', () => {
  const req = (...a) => run(['owner-gate', 'request', '--kind', 'roadmap', '--milestone', 'v1.0', '--summary', 's', ...a, '--raw']);
  const RISK = 'x';
  const withRisk = () => write('.planning/ROADMAP.md', '# R\n\n### Phase 1: A\n**Risk domains**: none\n\n### Phase 2: B\n**Risk domains**: auth\n');
  test('stores spike phases and roots, replaces them on a re-request that carries flags, needs roots', () => {
    withRisk();
    const bad = req('--spike-phases', '2');
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /spike phases need --spike-roots/);
    const a = JSON.parse(req('--spike-phases', '2,3', '--spike-roots', 'spike/,probe/').stdout);
    assert.deepStrictEqual(a.gate.rigour, { spike_phases: ['2', '3'], spike_roots: ['spike/', 'probe/'] });
    const b = JSON.parse(req('--spike-phases', '2', '--spike-roots', 'spike/').stdout);
    assert.deepStrictEqual(b.gate.rigour.spike_phases, ['2']);
    assert.strictEqual(b.gate.requested_at, a.gate.requested_at);
  });
  test('M3: a flag-less re-request of a pending gate keeps its rigour', () => {
    withRisk();
    req('--spike-phases', '2', '--spike-roots', 'spike/');
    const again = JSON.parse(req().stdout);
    assert.deepStrictEqual(again.gate.rigour, { spike_phases: ['2'], spike_roots: ['spike/'] });
  });
  test('M2: the request fails when any phase section lacks a Risk domains line; explicit none is fine', () => {
    write('.planning/ROADMAP.md', '# R\n\n### Phase 1: A\n**Goal**: g\n\n### Phase 2: B\n**Risk domains**: none\n');
    const r = req();
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /Phase 1 has no \*\*Risk domains:\*\* line/);
    withRisk();
    assert.strictEqual(req().status, 0);
  });
  test('G4: a phase with executed plans cannot be listed as spike; G3 overlap is refused at request time', () => {
    withRisk();
    write('.planning/phases/02-b/02-01-SUMMARY.md', '# s\n');
    const r = req('--spike-phases', '2', '--spike-roots', 'spike/');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /not relabelled spike/);
    fs.rmSync(path.join(dir, '.planning/phases'), { recursive: true });
    write('.planning/config.json', JSON.stringify({ project: {}, stack: { style: { roots: ['src'] } } }));
    assert.match(req('--spike-phases', '2', '--spike-roots', 'src/x').stderr, /overlaps/);
  });
});

describe('owner-gate request: legacy roadmaps and revisions (N3, N4)', () => {
  const req = (...a) => run(['owner-gate', 'request', '--kind', 'roadmap', '--milestone', 'v1.0', '--summary', 's', ...a, '--raw']);
  const legacy = '# R\n\n- [x] **Phase 1: A**\n- [ ] **Phase 2: B**\n- [ ] **Phase 3: C**\n\n### Phase 1: A\n**Goal**: g\n\n### Phase 2: B\n**Risk domains**: none\n\n### Phase 3: C\n**Risk domains**: auth\n';
  test('N3: a completed phase without the Risk domains line is one notice, not a refusal', () => {
    write('.planning/ROADMAP.md', legacy);
    const r = req();
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /Phase 1[^\n]*no \*\*Risk domains:\*\* line[^\n]*complete/i);
  });
  test('N3: an incomplete phase without the line is refused, naming the phases and the exact line to add', () => {
    write('.planning/ROADMAP.md', legacy.replace('### Phase 2: B\n**Risk domains**: none\n', '### Phase 2: B\n**Goal**: g\n'));
    const r = req();
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /Phase 2 has no \*\*Risk domains:\*\* line/);
    assert.match(r.stderr, /add `\*\*Risk domains:\*\* none`/);
    assert.ok(!/refused:[^\n]*Phase 1/.test(r.stderr), r.stderr);
  });
  test('N4: a revise that adds spike phase 4 passes while spike phase 3 already has a SUMMARY; a newly added phase with a SUMMARY is still refused', () => {
    write('.planning/ROADMAP.md', legacy + '\n### Phase 4: D\n**Risk domains**: none\n');
    write('.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@1.0', kind: 'roadmap', milestone: '1.0', status: 'approved', summary: '', rigour: { spike_phases: ['3'], spike_roots: ['spike/'] } }] }));
    write('.planning/phases/03-c/03-01-SUMMARY.md', '# s\n');
    const ok = req('--spike-phases', '3,4', '--spike-roots', 'spike/', '--revise');
    assert.strictEqual(ok.status, 0, ok.stderr);
    write('.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@1.0', kind: 'roadmap', milestone: '1.0', status: 'approved', summary: '', rigour: { spike_phases: ['4'], spike_roots: ['spike/'] } }] }));
    const bad = req('--spike-phases', '3,4', '--spike-roots', 'spike/', '--revise');
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr, /Phase 3 already has executed plans/);
  });
});

describe('phase_risk_domains from the ROADMAP', () => {
  test('comma list of single tokens matched against configured names; none; trailing prose ignored; unknown listed and not counted', () => {
    write('.planning/ROADMAP.md', roadmap('**Risk domains**: auth, Payments'));
    assert.deepStrictEqual(phaseRiskDomains(dir, '2', ['auth', 'security']), { domains: ['auth'], unknown: ['payments'], derived: false });
    write('.planning/ROADMAP.md', roadmap('**Risk domains**: auth, security. Plans here follow the owner-ruling route before execution.'));
    assert.deepStrictEqual(phaseRiskDomains(dir, '2', ['auth', 'security']), { domains: ['auth', 'security'], unknown: [], derived: false });
    write('.planning/ROADMAP.md', roadmap('**Risk domains**: none'));
    assert.deepStrictEqual(phaseRiskDomains(dir, '2', ['auth']), { domains: [], unknown: [], derived: false });
  });
  test('M2: no line falls back to configured names found in the Goal/Requirements text (derived)', () => {
    write('.planning/ROADMAP.md', '# R\n\n### Phase 2: B\n**Goal**: harden auth flow\n**Requirements**: PAY-01\n');
    assert.deepStrictEqual(phaseRiskDomains(dir, '2', ['auth', 'payments']), { domains: ['auth'], unknown: [], derived: true });
    assert.deepStrictEqual(phaseRiskDomains(dir, '9', ['auth']), { domains: [], unknown: [], derived: true });
  });
  test('init plan-phase and execute-phase emit them; a missing line prints a notice', () => {
    write('.planning/config.json', JSON.stringify({ project: { risk_domains: ['payments'] }, stack: {} }));
    write('.planning/ROADMAP.md', roadmap('**Risk domains**: auth, payments, odd'));
    for (const cmd of ['plan-phase', 'execute-phase']) {
      const out = JSON.parse(run(['init', cmd, '2', '--legacy', '--raw']).stdout);
      assert.deepStrictEqual(out.phase_risk_domains, ['auth', 'payments'], cmd);
    }
    const r = run(['init', 'plan-phase', '2', '--legacy', '--raw']);
    assert.match(r.stderr, /ignored: odd/);
    const none = run(['init', 'plan-phase', '1', '--legacy', '--raw']);
    assert.match(none.stderr, /no \*\*Risk domains:\*\* line/);
  });
  test('a spike phase still returns the line', () => {
    gate();
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
