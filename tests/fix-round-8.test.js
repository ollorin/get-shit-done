'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProject, gsd, git, phaseDir } = require('./helpers/roadmap-fixture.js');
const formCheck = require('../get-shit-done/bin/form-check.js');

const dirs = [];
const project = (cfg = {}) => { const d = makeProject([{ n: '1', name: 'one' }], cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const spikeProject = (cfg = {}) => {
  const dir = project(cfg);
  const rm = path.join(dir, '.planning', 'ROADMAP.md');
  fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', '**Rigour**: spike (OG2)\n**Spike roots**: spike/\n**Depends on:** None'));
  write(dir, '.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
  phaseDir(dir, 1);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'spike setup');
  return dir;
};

describe('R8-1: the planner runs on the top model at every rigour and profile', () => {
  for (const profile of [undefined, 'budget']) {
    test(`profile ${profile}: init plan-phase planner_model = models.top, checker_model = sonnet`, () => {
      const cfg = { models: { top: 'fable', top_fallback: 'opus' }, ...(profile ? { model_profile: profile } : {}) };
      const o = gsd(project(cfg), ['init', 'plan-phase', '1']);
      assert.strictEqual(o.json.planner_model, 'fable');
      assert.strictEqual(o.json.checker_model, 'sonnet');
    });
  }
  test('spike: same', () => {
    const o = gsd(spikeProject({ models: { top: 'fable' }, model_profile: 'budget' }), ['init', 'plan-phase', '1']).json;
    assert.deepStrictEqual([o.planner_model, o.checker_model], ['fable', 'sonnet']);
  });
  test('default top is opus; resolve-model agrees and a legacy model_profile is accepted silently', () => {
    const dir = project({ model_profile: 'budget' });
    assert.strictEqual(gsd(dir, ['init', 'plan-phase', '1']).json.planner_model, 'opus');
    assert.strictEqual(gsd(dir, ['resolve-model', 'gsd-planner']).out.trim(), 'opus');
    assert.strictEqual(gsd(dir, ['resolve-model', 'gsd-plan-checker']).out.trim(), 'sonnet');
    assert.strictEqual(gsd(dir, ['resolve-model', 'gsd-phase-coordinator']).out.trim(), 'sonnet');
  });
  test('config-ensure writes no profile by config-ensure', () => {
    const dir = project();
    fs.rmSync(path.join(dir, '.planning', 'config.json'));
    gsd(dir, ['config-ensure-section']);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '.planning', 'config.json'), 'utf8'), /model_profile/);
  });
});

describe('R8-2: task tags are haiku or sonnet only', () => {
  const FM = '---\nphase: 01\nplan: "01"\nplan_stamp: abc\nfiles_modified: [src/a.js]\n---\n# Plan\n';
  const errs = (tasks) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-r8-'));
    dirs.push(d);
    write(d, '01-01-PLAN.md', `${FM}<tasks>\n${tasks}\n</tasks>\n`);
    return formCheck.checkPlans(d, ['01-01-PLAN.md'], 'standard').filter((e) => e.check === 'task_tier_missing');
  };
  test('opus (element or attribute) and any other value is a form error naming the task and saying to split it', () => {
    const e = errs('<task type="auto"><name>Task 1: big</name><model>opus</model></task>\n<task type="auto" tier="Opus"><name>Task 2: bigger</name></task>\n<task type="auto"><name>Task 3: ok</name><model>sonnet</model></task>');
    assert.strictEqual(e.length, 1);
    assert.match(e[0].message, /Task 1: big; Task 2: bigger/);
    assert.doesNotMatch(e[0].message, /Task 3/);
    assert.match(e[0].message, /split/);
  });
  test('haiku and sonnet pass', () => {
    assert.deepStrictEqual(errs('<task type="auto"><name>a</name><model>haiku</model></task><task type="auto" tier="SONNET"><name>b</name></task>'), []);
  });
  test('spike executor_model: an opus tag does not raise the plan above sonnet', () => {
    const dir = spikeProject();
    write(phaseDir(dir, 1), '01-01-PLAN.md', `${FM}<tasks>\n<task type="auto"><name>n</name><model>haiku</model></task><task type="auto" tier="Opus"><name>n</name></task>\n</tasks>\n`);
    assert.strictEqual(gsd(dir, ['phase-plan-index', '1']).json.plans[0].executor_model, 'sonnet');
  });
  test('escalation: haiku -> sonnet; a failing sonnet task is never escalated to opus', () => {
    const d = project();
    const dec = (tier) => gsd(d, ['routing', 'escalation-decision', '--current-tier', tier, '--error-summary', 'wrong', '--escalations-used', '0']).json;
    assert.deepStrictEqual([dec('haiku').escalate, dec('haiku').next_tier], [true, 'sonnet']);
    assert.deepStrictEqual([dec('sonnet').escalate, dec('sonnet').next_tier], [false, null]);
  });
  test('prose carries no opus-executor tier', () => {
    for (const f of ['get-shit-done/references/task-routing.md', 'agents/gsd-planner.md', 'agents/gsd-plan-checker.md']) assert.doesNotMatch(doc(f), /\bopus\b/i, f);
    const pd = doc('get-shit-done/references/planner-detail.md');
    assert.doesNotMatch(pd.slice(pd.indexOf('Tier Tag Format'), pd.indexOf('## Frontmatter Fields')), /\bopus\b/i);
    assert.doesNotMatch(pd, /haiku\|sonnet\|opus/);
    assert.match(doc('get-shit-done/references/task-routing.md'), /fails twice/);
  });
});

describe('R8-3: profiles are gone', () => {
  test('MODEL_PROFILES, set-profile and the profile table are deleted', () => {
    assert.ok(!fs.existsSync(path.join(root, 'commands/gsd/set-profile.md')));
    assert.ok(!fs.existsSync(path.join(root, 'get-shit-done/workflows/set-profile.md')));
    assert.doesNotMatch(doc('get-shit-done/bin/gsd-tools.js'), /MODEL_PROFILES|model_profile/);
    assert.doesNotMatch(doc('get-shit-done/references/models.md'), /MODEL_PROFILES|set-profile|quality.*budget/);
    for (const f of ['README.md', 'get-shit-done/workflows/help.md', 'get-shit-done/workflows/settings.md', 'get-shit-done/workflows/new-project.md']) assert.doesNotMatch(doc(f), /set-profile|model_profile/, f);
  });
  test('rigour.md: planner on ruling_model, plan-check on sonnet at every rigour', () => {
    const r = doc('get-shit-done/references/rigour.md');
    assert.match(r, /\| Planner \| `ruling_model` \| `ruling_model` \| `ruling_model` \|/);
    assert.doesNotMatch(r, /`planner_model`/);
  });
});
