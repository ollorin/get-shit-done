'use strict';
// T5 pins: new-milestone has an unattended path with an input contract, K-class lines at every prompt,
// and hands off to execute-roadmap; new-project ends the same way.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const NM = read('get-shit-done/workflows/new-milestone.md');
const CMD = read('commands/gsd/new-milestone.md');
const NP = read('get-shit-done/workflows/new-project.md');

describe('new-milestone auto mode', () => {
  test('input contract: goals document, MILESTONE-CONTEXT.md or one approved complete PRD; otherwise stop before any write', () => {
    const sec = NM.slice(NM.indexOf('## Auto mode (read first)'), NM.indexOf('## 0. First Milestone'));
    for (const n of ['--auto @goals.md', 'MILESTONE-CONTEXT.md', 'stage: complete', 'approval', 'stop before writing anything']) assert.ok(sec.includes(n), n);
    assert.match(sec, /init new-milestone \$ARGUMENTS/);
  });

  test('every prompt of audit section A has its K-class line', () => {
    const expect = [
      ['Select one as the milestone foundation', 'K2'],
      ['Continue anyway? (yes/no)', 'K3'],
      ['Step 4 (Approval)', 'K3'],
      ['Confirm with user', 'K1'],
      ['Research the domain ecosystem', 'K2'],
      ['**Scope each category**', 'K3'],
      ['**Identify gaps**', 'K3'],
      ['Rigour:', 'K2'],
      ['`## ROADMAP BLOCKED`', 'K5'],
      ['**Ask for approval**', 'K6'],
    ];
    const lines = NM.split('\n');
    for (const [needle, k] of expect) {
      const i = lines.findIndex((l) => l.includes(needle));
      assert.ok(i >= 0, needle);
      const win = lines.slice(Math.max(0, i - 12), i + 13).join('\n');
      assert.ok(win.includes(`references/auto-mode.md ${k})`), `${needle} lacks ${k}`);
    }
  });

  test('an unapproved or in-progress PRD is never approved or used; unanswered scope becomes A- rows; blocked roadmap re-spawns once', () => {
    assert.match(NM, /never used in an unattended run/);
    assert.match(NM, /is never granted by an unattended run/);
    assert.match(NM, /`A-` (assumption )?row/);
    assert.match(NM, /re-spawn the roadmapper once; a second `## ROADMAP BLOCKED` stops the run/);
  });

  test('rigour is standard in auto; spike only with an owner D- decision', () => {
    assert.match(NM, /the answer is `standard` \(no Rigour line\); `spike` only when the goals document names a spike and an owner `D-` decision exists/);
  });

  test('step 11 sets the chain flag and hands off to execute-roadmap --auto; the interactive pointer stays', () => {
    const done = NM.slice(NM.indexOf('## 11. Done'));
    assert.ok(done.includes('config-set workflow._auto_chain_active true'));
    assert.ok(done.includes('/gsd:execute-roadmap --auto'));
    assert.ok(done.indexOf('_auto_chain_active') < done.indexOf('/gsd:execute-roadmap --auto'));
    assert.ok(done.includes('/gsd:discuss-phase [N]'));
  });

  test('the command keeps AskUserQuestion for interactive runs, takes --auto and carries the rule line', () => {
    assert.match(CMD, /- AskUserQuestion/);
    assert.match(CMD, /argument-hint: "\[--auto @goals\.md\]/);
    assert.match(CMD, /references\/auto-mode\.md K1/);
  });

  test('project-context sentences and the shared-file-writes reference survive', () => {
    for (const w of ['risk domain', 'decisions-protocol.md']) assert.ok(NM.includes(w), w);
  });
});

describe('new-project ends an auto run with the roadmap hand-off', () => {
  test('lines 1130-1138 region invokes execute-roadmap, not discuss-phase 1 --auto', () => {
    assert.ok(NP.includes('SlashCommand("/gsd:execute-roadmap --auto")'));
    assert.ok(!NP.includes('/gsd:discuss-phase 1 --auto'));
    assert.match(NP, /references\/auto-mode\.md K1\): hand the whole roadmap/);
    assert.ok(NP.includes('/gsd:discuss-phase 1 — gather context'), 'the interactive pointer stays');
  });
});
