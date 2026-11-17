'use strict';
// review-gate.js: the findings table is the record (open count computed from rows); each gate is shown failing on a bad fixture.
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rg = require('../get-shit-done/bin/review-gate.js');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const ledger = new Map([['D-12', 'decision'], ['D-13', 'assumption'], ['A-5', 'assumption']]);
const sections = { 406: '#### Phase 406: next\n**Success Criteria**\n1. Closes F-7 and IR-2.', 407: '#### Phase 407: other\n#### F-7 heading only\nNothing here.' };
const phaseSection = (p) => sections[p] || null;

function errorsFor(rows, { frontmatter = 'format: v2\npasses: 1', header = '| id | sev | state | owner |\n|---|---|---|---|\n', ...opts } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rgf-'));
  dirs.push(d);
  fs.writeFileSync(path.join(d, '01-REVIEW.md'), `---\n${frontmatter}\n---\n# R\n\n${header}${rows}`);
  return rg.reviewErrors(d, ['01-REVIEW.md'], ['src/a.js'], { phaseNumber: '01', ledger, phaseSection, ...opts });
}

describe('findings table: the open count is computed from rows', () => {
  test('a typed open_critical_high: 0 cannot hide an open HIGH row', () => {
    const e = errorsFor('| F-1 | HIGH | open | |\n', { frontmatter: 'format: v2\npasses: 1\nopen_critical_high: 0' });
    assert.strictEqual(e.length, 1);
    assert.match(e[0], /CRITICAL\/HIGH[^\n]*F-1/);
  });
  test('no findings table is an error; the header alone (zero findings) passes', () => {
    assert.match(errorsFor('', { header: 'no table here\n' })[0], /no findings table/);
    assert.deepStrictEqual(errorsFor(''), []);
  });
  test('closed rows pass in any severity', () => {
    assert.deepStrictEqual(errorsFor('| F-1 | CRITICAL | closed | |\n| F-2 | low | Closed | |\n'), []);
  });
  test('CRITICAL/HIGH needs a D- ruling that is a decision row; A- ids and phase owners do not rule', () => {
    assert.deepStrictEqual(errorsFor('| F-1 | HIGH | open | D-12 |\n'), []);
    assert.strictEqual(errorsFor('| F-1 | HIGH | open | D-99 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-1 | HIGH | open | D-13 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-1 | CRITICAL | open | A-5 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-7 | HIGH | open | 406 |\n').length, 1);
  });
  test('MED/LOW non-closed needs an owner: ledger D-/A- id, or a phase whose ROADMAP section names the finding id', () => {
    assert.deepStrictEqual(errorsFor('| F-2 | MED | open | A-5 |\n| F-3 | LOW | partial | D-12 |\n'), []);
    assert.deepStrictEqual(errorsFor('| F-7 | MED | open | 406 |\n'), []);
    assert.strictEqual(errorsFor('| F-2 | MED | open | |\n').length, 1);
    assert.strictEqual(errorsFor('| F-2 | MED | open | A-77 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-7 | MED | open | 407 |\n').length, 1, 'a heading naming the id does not count');
    assert.strictEqual(errorsFor('| F-7 | MED | open | 999 |\n').length, 1, 'phase not in ROADMAP');
    assert.strictEqual(errorsFor('| IR-20 | MED | open | 406 |\n').length, 1, 'IR-2 in the section must not satisfy IR-20');
    assert.deepStrictEqual(errorsFor('| IR-2 | MED | open | 406 |\n'), []);
  });
  test('refuted needs a D- ruling; unknown severity and a row with no id are errors', () => {
    assert.strictEqual(errorsFor('| F-4 | MED | refuted | A-5 |\n').length, 1);
    assert.deepStrictEqual(errorsFor('| F-4 | MED | refuted | D-12 |\n'), []);
    assert.match(errorsFor('| F-5 | URGENT | open | D-12 |\n')[0], /unknown severity[^\n]*F-5/);
    assert.match(errorsFor('| | LOW | closed | |\n')[0], /no id/);
  });
  test('passes still required; risk add-ons still need pass 2', () => {
    assert.match(errorsFor('', { frontmatter: 'format: v2\nreviewer_role: final' })[0], /passes: 1 or 2/);
    assert.match(errorsFor('', { risk: true })[0], /needs pass 2/);
    assert.deepStrictEqual(errorsFor('', { risk: true, frontmatter: 'format: v2\npasses: 2' }), []);
  });
});

describe('grandfathering: a record without `format: v2` is judged by the legacy rule', () => {
  test('legacy frontmatter count passes with an open HIGH row in an unmarked table; v2 refuses the same body', () => {
    const legacy = 'passes: 1\nopen_critical_high: 0';
    assert.deepStrictEqual(errorsFor('| F-1 | HIGH | open | |\n', { frontmatter: legacy }), []);
    assert.strictEqual(errorsFor('| F-1 | HIGH | open | |\n', { frontmatter: `format: v2\n${legacy}` }).length, 1);
  });
  test('legacy rules still bite: an open count without ruled_by, a missing count, a count differing from VERIFICATION', () => {
    assert.match(errorsFor('', { frontmatter: 'passes: 1\nopen_critical_high: 2' })[0], /no ruling id/);
    assert.match(errorsFor('', { frontmatter: 'passes: 1' })[0], /open_critical_high/);
    assert.match(errorsFor('', { frontmatter: 'passes: 1\nopen_critical_high: 0', verificationOpen: 1 })[0], /differs from VERIFICATION/);
    assert.deepStrictEqual(errorsFor('', { frontmatter: 'passes: 1\nopen_critical_high: 1\nruled_by: [D-12]' }), []);
  });
});
