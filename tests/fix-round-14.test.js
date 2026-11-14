'use strict';
// Review gate (R7-4/5/6/18, R7-2/3 freshness): behaviour of `verify phase-gate`, not prose.
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeProject, gsd, git, phaseDir } = require('./helpers/roadmap-fixture.js');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const fm = (body) => `---\n${body}\n---\n# R\n`;

function executed(riskLine) {
  const dir = makeProject([{ n: '1', name: 'one' }]);
  dirs.push(dir);
  if (riskLine) {
    const f = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\*\*Risk domains:\*\*[^\n]*/, riskLine));
  }
  const pd = path.relative(dir, phaseDir(dir, 1));
  write(dir, `${pd}/01-01-PLAN.md`, '---\nphase: 01\nplan: "01"\nfiles_modified: [src/a.js]\n---\n# Plan\n');
  write(dir, `${pd}/01-01-SUMMARY.md`, '# Summary\n\n## Self-Check: PASSED\n');
  write(dir, `${pd}/01-VERIFICATION.md`, '---\nstatus: passed\n---\n# V\n');
  write(dir, 'src/a.js', 'x');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
  return { dir, pd: phaseDir(dir, 1), rel: pd };
}
const gate = (dir, ...extra) => gsd(dir, ['verify', 'phase-gate', '1', ...extra]).json;
const errs = (j, re) => j.work_errors.filter((e) => re.test(e));

describe('R7-4 the record is exactly {N}-REVIEW.md', () => {
  test('a clean sibling *-REVIEW.md does not mask the real record', () => {
    const { dir, pd } = executed();
    write(pd, '01-REVIEW.md', fm('reviewer_role: final\npasses: 1\nopen_critical_high: 2'));
    write(pd, '01-01-UI-REVIEW.md', fm('reviewer_role: ui\npasses: 1\nopen_critical_high: 0'));
    assert.strictEqual(errs(gate(dir), /01-REVIEW\.md[^\n]*open_critical_high 2/).length, 1);
  });
});

describe('R7-5 ruled_by ids must exist in the ledger; counts agree', () => {
  test('an invented ruling id is a work error, a ledger row makes it pass', () => {
    const { dir, pd } = executed();
    write(pd, '01-REVIEW.md', fm('reviewer_role: final\npasses: 1\nopen_critical_high: 3\nruled_by: [D-9999]'));
    write(pd, '01-VERIFICATION.md', '---\nstatus: passed\nopen_critical_high: 3\nruled_by: [D-9999]\n---\n# V\n');
    assert.ok(errs(gate(dir), /D-9999 not in the decisions ledger/).length >= 1);
    write(dir, '.planning/DECISIONS.jsonl', '{"id":"D-9999","kind":"decision","ts":"2026-01-01T00:00:00.000Z"}\n');
    assert.deepStrictEqual(errs(gate(dir), /REVIEW|ledger|differs/), []);
  });
  test('REVIEW and VERIFICATION counts that differ are a work error', () => {
    const { dir, pd } = executed();
    write(pd, '01-REVIEW.md', fm('reviewer_role: final\npasses: 1\nopen_critical_high: 0'));
    write(pd, '01-VERIFICATION.md', '---\nstatus: passed\nopen_critical_high: 1\nruled_by: [D-1]\n---\n# V\n');
    write(dir, '.planning/DECISIONS.jsonl', '{"id":"D-1","kind":"decision","ts":"2026-01-01T00:00:00.000Z"}\n');
    assert.strictEqual(errs(gate(dir), /differs from VERIFICATION/).length, 1);
  });
  test('a ruled_by id that exists in the ledger but is not kind decision is a work error naming the id', () => {
    const { dir, pd } = executed();
    write(pd, '01-REVIEW.md', fm('reviewer_role: final\npasses: 1\nopen_critical_high: 1\nruled_by: [D-7]'));
    write(dir, '.planning/DECISIONS.jsonl', '{"id":"D-7","kind":"assumption","ts":"2026-01-01T00:00:00.000Z"}\n');
    assert.strictEqual(errs(gate(dir), /D-7[^\n]*not a ruling/).length, 1);
  });
});

describe('risk token fail-closed: init risk_addons for a **Risk domains:** value', () => {
  const riskAddonsFor = (line) => {
    const dir = makeProject([{ n: '1', name: 'one' }]);
    dirs.push(dir);
    const f = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\*\*Risk domains:\*\*[^\n]*/, line));
    return gsd(dir, ['init', 'execute-phase', '1']).json.risk_addons;
  };
  const rows = [
    ['**Risk domains:** auth and payments', true],
    ['**Risk domains:** auth; payments', true],
    ['**Risk domains:** auth, payments', true],
    ['**Risk domains:** none', false],
    ['**Risk domains:** ', false],
    ['', false],
  ];
  for (const [line, want] of rows) {
    test(`${JSON.stringify(line)} -> risk_addons ${want}`, () => {
      assert.strictEqual(riskAddonsFor(line), want);
    });
  }
});

describe('R7-6 / R7-18 risk add-ons wiring', () => {
  test('**Risk domains:** authn: passes 1 fails the gate, --pre-verifier skips it, passes 2 passes', () => {
    const { dir, pd } = executed('**Risk domains:** authn');
    write(pd, '01-REVIEW.md', fm('reviewer_role: final\npasses: 1\nopen_critical_high: 0'));
    assert.strictEqual(errs(gate(dir), /needs pass 2/).length, 1);
    assert.deepStrictEqual(errs(gate(dir, '--pre-verifier'), /REVIEW/), []);
    write(pd, '01-REVIEW.md', fm('reviewer_role: final\npasses: 2\nopen_critical_high: 0'));
    assert.deepStrictEqual(errs(gate(dir), /REVIEW/), []);
  });
});

describe('R7-2/3 records older than the last source commit are stale; docs-only commits do not stale them', () => {
  const commitAt = (dir, msg, plusSeconds) => {
    const d = `${Math.floor(Date.now() / 1000) + plusSeconds} +0000`;
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  };
  test('a fix commit after the record stales it until the record is rewritten; a docs commit does not', () => {
    const { dir, pd, rel } = executed();
    write(pd, '01-REVIEW.md', fm('reviewer_role: final\npasses: 1\nopen_critical_high: 0'));
    git(dir, 'add', '-A');
    commitAt(dir, 'docs(phase-1): record verification', 3600);
    write(dir, 'docs/guide.md', 'd');
    git(dir, 'add', '-A');
    commitAt(dir, 'docs(01-01): guide', 7200);
    assert.deepStrictEqual(errs(gate(dir), /older than/), [], 'docs-only commit');
    write(dir, 'src/a.js', 'fixed');
    git(dir, 'add', '-A');
    commitAt(dir, 'fix(01-review): finding', 10800);
    const j = gate(dir);
    assert.strictEqual(errs(j, /01-REVIEW\.md is older/).length, 1);
    assert.strictEqual(errs(j, /01-VERIFICATION\.md is older/).length, 1);
    write(dir, `${rel}/01-REVIEW.md`, fm('reviewer_role: final\npasses: 1\nopen_critical_high: 0') + 'F-1 closed fixed_by: abc\n');
    write(dir, `${rel}/01-VERIFICATION.md`, '---\nstatus: passed\n---\n# V\nre-checked\n');
    git(dir, 'add', '-A');
    commitAt(dir, 'docs(phase-1): re-check', 14400);
    assert.deepStrictEqual(errs(gate(dir), /older than/), []);
  });
});

describe('R7-7 init execute-phase phase_base', () => {
  test('is the parent of the oldest commit tagged with the phase; null before any', () => {
    const dir = makeProject([{ n: '1', name: 'one' }]);
    dirs.push(dir);
    assert.strictEqual(gsd(dir, ['init', 'execute-phase', '1']).json.phase_base, null);
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    write(dir, 'src/a.js', 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
    write(dir, 'src/b.js', 'y');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix(01-review): f');
    assert.strictEqual(gsd(dir, ['init', 'execute-phase', '1']).json.phase_base, base);
  });
});
