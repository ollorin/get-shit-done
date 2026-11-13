'use strict';
// T4 pins: execute-roadmap is a loop over `roadmap next|record`, the coordinator is a thin dispatcher,
// project content lives in presets. Text pins here back the dispatcher dry run (tests/dispatcher-dry-run.test.js).
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd, phaseDir } = require('./helpers/roadmap-fixture.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const ROADMAP = read('get-shit-done/workflows/execute-roadmap.md');
const DETAIL = read('get-shit-done/references/coordinator-detail.md');
const COORD = read('agents/gsd-phase-coordinator.md');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('P1 the coordinator is a thin dispatcher', () => {
  test('detail has no planner, executor or verifier spawn block and stays under 450 lines', () => {
    assert.doesNotMatch(DETAIL, /subagent_type="gsd-(planner|executor|verifier|phase-researcher|plan-checker|charlotte-qa)"/);
    assert.doesNotMatch(DETAIL, /<step name="(research|plan|execute|verify)">/);
    assert.ok(DETAIL.split('\n').length <= 450, `coordinator-detail.md has ${DETAIL.split('\n').length} lines`);
  });

  test('coordinator and detail name both workflow paths and both argument strings', () => {
    const both = COORD + DETAIL;
    assert.ok(both.includes('@get-shit-done/workflows/plan-phase.md'));
    assert.ok(both.includes('@get-shit-done/workflows/execute-phase.md'));
    assert.ok(DETAIL.includes('`{N} --auto --no-advance [--legacy]`'));
    assert.ok(DETAIL.includes('`{N} --auto --no-transition [--legacy]`'));
    assert.ok(DETAIL.includes('`{N} --gaps --auto --no-advance`'));
    assert.ok(DETAIL.includes('`{N} --gaps-only --auto --no-transition`'));
  });

  test('detail keeps only budget monitoring, the dispatch table, the discuss step and the return mapping', () => {
    for (const needle of ['<context_budget_monitoring>', '## Dispatch table', '<step name="discuss">', '## Return mapping', 'phase checkpoint {N} --step']) {
      assert.ok(DETAIL.includes(needle), needle);
    }
    for (const status of ['completed', 'gaps_found', 'human_needed', 'blocked', 'failed']) {
      assert.match(DETAIL, new RegExp(`\\| \`${status}\``), `return mapping row for ${status}`);
    }
    assert.match(DETAIL, /"deferred":\["execute"\]/, 'the 60% hand-back after plan returns an execute deferral');
  });

  test('the coordinator never calls phase complete and writes the checkpoint only through the tool', () => {
    assert.match(DETAIL, /never call `phase complete`/);
    assert.match(COORD, /Never hand-write the file/);
    assert.doesNotMatch(COORD + DETAIL, /gsd-tools[^\n]*phase complete \{N\}/);
  });

  test('no model literal and no live-window or tiering text in the generic coordinator', () => {
    for (const t of [COORD, DETAIL]) {
      assert.doesNotMatch(t, /model="(haiku|sonnet|opus|fable)"/);
      assert.doesNotMatch(t, /model: "fable"/);
      assert.doesNotMatch(t, /Live-window entry gate|Live-window polling|Per-plan live landing|edge-source freeze\./);
      assert.doesNotMatch(t, /<review_tiering>/);
    }
  });

  test('harvest_knowledge is off unless knowledge.harvest is set', () => {
    assert.match(DETAIL, /Off unless `knowledge\.harvest` is true/);
  });
});

describe('P1 execute-roadmap is a loop over roadmap next and roadmap record', () => {
  test('completion is recorded only by the tool: no phase_complete literal outside a roadmap record line', () => {
    const bad = ROADMAP.split('\n').filter((l) => /phase_complete/.test(l) && !/roadmap record/.test(l));
    assert.deepStrictEqual(bad, []);
  });

  test('every action the dispatcher emits is handled by the workflow', () => {
    const src = read('get-shit-done/bin/roadmap-dispatch.js');
    const actions = new Set([...src.matchAll(/action: '(\w+)'/g)].map((m) => m[1]));
    actions.delete('escalate'); // the ladder's own value, handled in handle_failure
    for (const a of ['respawn_death', 'complete', 'park', 'spawn_deferred', 'retry', 'debug', 'fail', 'gap_cycle', 'spawn_coordinator', 'integration_gate', 'pr', 'done']) actions.add(a);
    for (const a of actions) assert.ok(ROADMAP.includes(`\`${a}\``), `workflow does not handle action ${a}`);
  });

  test('the documented commands: roadmap next with --retry-parked, record, record --kind pr, gate pre-pr --mark-passed, roadmap_complete', () => {
    for (const needle of ['roadmap next', '--retry-parked', 'roadmap record --phase {N}', 'roadmap record --kind pr', 'gate pre-pr --mark-passed', '--type roadmap_complete', 'auto_decision']) {
      assert.ok(ROADMAP.includes(needle), needle);
    }
    assert.ok(ROADMAP.indexOf('--mark-passed') > ROADMAP.indexOf('**A. Pre-PR') && ROADMAP.indexOf('--mark-passed') < ROADMAP.indexOf('**B. Pull request'), 'the gate is marked before the pr step');
  });

  test('models come from init: coordinator, ruling (with fallback), utility; no literal; no reviewer pre-verification before the final phase review', () => {
    assert.doesNotMatch(ROADMAP, /model="(haiku|sonnet|opus|fable)"/);
    for (const m of ['{coordinator_model}', '{ruling_model}', '{ruling_model_fallback}']) assert.ok(ROADMAP.includes(m), m);
    assert.ok(!ROADMAP.includes('pre-verification'), 'the final phase review is one dispatch on the top model');
    assert.match(ROADMAP, /`utility_model`/);
  });

  test('the dispatch prompt carries auto and legacy, and is a short dispatch rather than plan-shape rules', () => {
    const start = ROADMAP.indexOf('**4. Spawn the coordinator');
    const block = ROADMAP.slice(start, ROADMAP.indexOf('**4a.'));
    assert.match(block, /auto: true/);
    assert.match(block, /legacy: \{legacy\}/);
    assert.ok(block.split('\n').length < 25, 'dispatch prompt stays short');
    assert.doesNotMatch(ROADMAP, /\.tsx|\.jsx|400 lines|three separate plans|tdd='true'/);
  });

  test('host assumptions have generic fallbacks: mktemp, base branch from init, df of the working dir, no project paths', () => {
    assert.match(ROADMAP, /mktemp/);
    assert.doesNotMatch(ROADMAP, /\/tmp\/gsd-roadmap-init-\$\$/);
    assert.doesNotMatch(ROADMAP, /--base main\b/);
    assert.doesNotMatch(ROADMAP, /df -h \/|sysctl|cleanup-keep|gsd-metrics|session-supervisor\.sh|grep -m1 "\^## Milestone"/);
    assert.match(ROADMAP, /base_branch/);
    assert.match(ROADMAP, /"reason":"no_remote"/);
    assert.match(ROADMAP, /gsd\/roadmap-\{YYYYMMDD\}/);
  });

  test('quota and skew fallbacks: unmeasured proceeds, no_manifest is skipped, watchdogs probe', () => {
    assert.match(ROADMAP, /quota_preflight_unmeasured/);
    assert.match(ROADMAP, /`no_manifest` means GSD is not installed here/);
    assert.match(ROADMAP, /watchdogs_unavailable/);
    const w = read('get-shit-done/references/watchdogs.md');
    assert.match(w, /watchdogs_unavailable/);
    assert.match(w, /stack\.watchdogs/);
  });

  test('the remaining prompt sites name their auto action (K1/K2/K4/K5)', () => {
    for (const k of ['K1', 'K2', 'K4', 'K5']) assert.ok(ROADMAP.includes(`references/auto-mode.md ${k})`), k);
    assert.doesNotMatch(ROADMAP, /"skip \{N\}"|wait for user resolution|present blocker, wait/i);
  });
});

describe('project content moved to presets', () => {
  test('shared-stack rule carries the live-window protocol and names real profile keys', () => {
    const t = read('get-shit-done/presets/base/rules/shared-stack.md');
    assert.match(t, /## Live windows/);
    for (const k of ['stack.isolation.lock_dir', 'stack.paths.backend', 'stack.paths.migrations', 'that needs no running stack', '25 minutes']) assert.ok(t.includes(k), k);
  });

  test('igaming ships watchdog entries as stack.watchdogs[] {name, cron, prompt}', () => {
    const block = JSON.parse(read('get-shit-done/presets/igaming/project.block.json'));
    const w = block.stack.watchdogs;
    assert.ok(Array.isArray(w) && w.length >= 3);
    for (const e of w) {
      assert.ok(e.name && e.prompt && /^\S+( \S+){4}$/.test(e.cron), JSON.stringify(e).slice(0, 80));
    }
    assert.ok(w.some((e) => /vm\.swapusage/.test(e.prompt)), 'the swap line lives in the preset');
  });

  test('execute-phase no longer carries the live-window text itself', () => {
    const t = read('get-shit-done/workflows/execute-phase.md');
    assert.doesNotMatch(t, /Entry gate, no stack|Edge-source freeze/);
    assert.match(t, /shared-stack\.md/);
  });
});

describe('execute-phase branch guard uses the base branch from init', () => {
  test('init execute-phase emits base_branch (config, else null) and the workflow guards on it', () => {
    const none = makeProject([{ n: '1', name: 'one' }]);
    dirs.push(none);
    phaseDir(none, 1);
    assert.strictEqual(gsd(none, ['init', 'execute-phase', '1']).json.base_branch, null);
    const cfg = makeProject([{ n: '1', name: 'one' }], { git: { base_branch: 'trunk' } });
    dirs.push(cfg);
    phaseDir(cfg, 1);
    assert.strictEqual(gsd(cfg, ['init', 'execute-phase', '1']).json.base_branch, 'trunk');
    const t = read('get-shit-done/workflows/execute-phase.md');
    const guard = t.slice(t.indexOf('<step name="handle_branching">'), t.indexOf('<step name="validate_phase">'));
    assert.match(guard, /`base_branch` from init/);
    assert.doesNotMatch(guard, /`CURRENT_BRANCH` is `main` or `master`/);
  });
});
