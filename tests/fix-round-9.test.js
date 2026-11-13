'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeProject, gsd, git, phaseDir, writeEvidence } = require('./helpers/roadmap-fixture.js');

const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('R9-1: phase complete marks the phase requirements', () => {
  const setup = (spike) => {
    const dir = makeProject([{ n: '1', name: 'one' }]);
    dirs.push(dir);
    const rm = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', `${spike ? '**Rigour**: spike (OG2)\n**Spike roots**: spike/\n' : ''}**Requirements:** ADM-01, ADM-02\n**Depends on:** None`));
    fs.writeFileSync(path.join(dir, '.planning', 'REQUIREMENTS.md'), '# R\n\n- [ ] **ADM-01**: a\n- [ ] **ADM-02**: b\n- [ ] **ADM-03**: other phase\n\n| Requirement | Phase | Status |\n|---|---|---|\n| ADM-01 | Phase 1 | Pending |\n| ADM-02 | Phase 1 | Pending |\n| ADM-03 | Phase 2 | Pending |\n');
    if (spike) fs.writeFileSync(path.join(dir, '.planning', 'OWNER-GATES.json'), JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
    const pd = writeEvidence(dir, 1);
    if (spike) {
      fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: passed\nopen_critical_high: 0\n---\n# V\n');
      fs.writeFileSync(path.join(pd, 'SPIKE-RESULT.md'), '# R\n\n| Question | Answer | Capture | Probe | Root cause or search |\n|---|---|---|---|---|\n| Q0 base | inconclusive | | | |\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '--amend', '--no-edit');
    }
    return dir;
  };
  test('the phase ids are ticked, another phase is untouched, and the phase has no form debt afterwards', () => {
    const dir = setup(true);
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    assert.strictEqual(gsd(dir, ['phase', 'complete', '1']).rc, 0);
    const req = fs.readFileSync(path.join(dir, '.planning', 'REQUIREMENTS.md'), 'utf8');
    assert.match(req, /- \[x\] \*\*ADM-01\*\*/);
    assert.match(req, /- \[x\] \*\*ADM-02\*\*/);
    assert.match(req, /- \[ \] \*\*ADM-03\*\*/);
    assert.match(req, /\| ADM-01 \| Phase 1 \| Complete \|/);
    assert.match(req, /\| ADM-03 \| Phase 2 \| Pending \|/);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'docs(01): phase complete');
    const gate = gsd(dir, ['verify', 'phase-gate', '1']);
    assert.deepStrictEqual(gate.json && gate.json.form_errors, []);
  });
  test('a project without REQUIREMENTS.md or a Requirements line still completes', () => {
    const dir = makeProject([{ n: '1', name: 'one' }]);
    dirs.push(dir);
    writeEvidence(dir, 1);
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    assert.strictEqual(gsd(dir, ['phase', 'complete', '1']).rc, 0);
  });
});

describe('R9-2: prose names only commands the CLI has', () => {
  test('every `node .../gsd-tools.js <cmd>` and `gsd-tools <cmd>` in workflows, agents and references is a dispatcher case', () => {
    const files = execFileSync('git', ['ls-files', 'get-shit-done/workflows/*.md', 'agents/*.md', 'get-shit-done/references/*.md'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    const cases = new Set([...doc('get-shit-done/bin/gsd-tools.js').matchAll(/^\s*case '([^']+)'/gm)].map((m) => m[1]));
    const bad = [];
    for (const f of files) {
      for (const m of doc(f).matchAll(/(?:node\s+\S*gsd-tools(?:\.js)?"?|`gsd-tools(?:\.js)?)\s+([a-z][a-z-]*)/g)) if (!cases.has(m[1])) bad.push(`${f}: ${m[1]}`);
    }
    assert.deepStrictEqual(bad, []);
  });
  test('the decisions shorthand is defined as decisions.js and never as a gsd-tools command', () => {
    assert.match(doc('get-shit-done/references/decisions-protocol.md'), /never a `gsd-tools` command/);
    assert.ok(fs.existsSync(path.join(root, 'get-shit-done/bin/decisions.js')));
  });
});

describe('R9-3: files_modified is the files the plan changes', () => {
  test('the plan template says an unchanged listed file warns and conditional files stay out', () => {
    assert.match(doc('get-shit-done/templates/phase-prompt.md'), /claimed_file_not_in_diff/);
  });
});

describe('R9-4: the verification score is not a required field', () => {
  test('frontmatter validate --schema verification does not demand score, and the verifier does not write one', () => {
    const dir = makeProject([{ n: '1', name: 'one' }]);
    dirs.push(dir);
    const p = path.join(dir, 'V.md');
    fs.writeFileSync(p, '---\nphase: 08\nverified: 2026-01-01\nstatus: passed\nui_qa_ran: false\n---\n');
    assert.strictEqual(gsd(dir, ['frontmatter', 'validate', p, '--schema', 'verification']).out.trim(), 'valid');
    for (const f of ['agents/gsd-verifier.md', 'get-shit-done/templates/verification-report.md', 'get-shit-done/workflows/verify-phase.md']) assert.doesNotMatch(doc(f), /^score:|previous_score|"score"|status\/score|, score \(/m, f);
  });
});

describe('R9-5: zero research agents is stated', () => {
  test('plan-phase step 5 says when research is skipped and that the skip is logged', () => {
    const t = doc('get-shit-done/workflows/plan-phase.md');
    const s = t.slice(t.indexOf('## 5. Handle Research'), t.indexOf('## 5.6'));
    assert.match(s, /zero research agents/i);
    assert.match(s, /research: skipped/);
  });
});

describe('R9-6: no runtime path escalates a task to opus', () => {
  test('the ladder ends at sonnet', () => {
    const reg = require('../get-shit-done/bin/model-registry.js');
    assert.strictEqual(reg.getNextTier('sonnet'), null);
    assert.strictEqual(reg.getNextTier('haiku'), 'sonnet');
    assert.deepStrictEqual(reg.DEFAULT_REGISTRY.escalation_ladder, JSON.parse(doc('get-shit-done/config/model-registry.json')).escalation_ladder);
    assert.strictEqual(new (require('../get-shit-done/bin/gsd-escalation.js').ErrorTracker)({ id: 't' }).getNextModel('sonnet'), null);
  });
});

describe('R9-7: the base shared-stack rule shows wrapped stop and reset', () => {
  test('start, stop and reset each appear in the wrapper form', () => {
    const t = doc('get-shit-done/presets/base/rules/shared-stack.md');
    for (const w of ['start', 'stop', 'reset']) assert.match(t, new RegExp(`stack-lock\\.sh --label <lane> -- <${w} command>`));
  });
});
