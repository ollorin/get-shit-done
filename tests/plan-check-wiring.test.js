'use strict';
// WP3: adversarial plan-check is 3 lens checkers per phase, 2 in flight, delta round after any revision.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'get-shit-done', 'workflows', 'plan-phase.md'), 'utf8');
const checker = fs.readFileSync(path.join(root, 'agents', 'gsd-plan-checker.md'), 'utf8');

test('plan-phase.md: three lens checkers per phase, at most 2 in flight, delta after any revision', () => {
  assert.match(doc, /three adversarial `ruling_model` checkers per phase, one per lens, at most 2 in flight/);
  assert.match(doc, /at most 2 in flight at a time \(the first two together, the third when one returns\)/);
  assert.match(doc, /A delta round follows whenever the planner revised after round 1 \(blocker or warning\): ONE `checker_model` checker/);
  assert.doesNotMatch(doc, /only when a lens returned a BLOCKER|round 1 found a BLOCKER|only after a BLOCKER/);
  assert.doesNotMatch(doc, /except when the checker applied fixes/);
  for (const lens of ['`goal`', '`risk`', '`overlap`']) assert.ok(doc.includes(lens), lens);
});

test('plan-phase.md no longer states the per-plan checker rule', () => {
  assert.doesNotMatch(doc, /PER PLAN/);
  assert.doesNotMatch(doc, /one checker per plan id/);
  assert.doesNotMatch(doc, /one adversarial `ruling_model` dispatch per plan/);
});

const parseNums = (s) => (s.match(/\d+/g) || []).map(Number);
const lensTable = (text) => {
  const m = text.match(/`goal`: ([\d, and]+?);? `risk`: ([\d, and]+?)[ ,]+(?:with|;)[^`]*?`overlap`: ([\d, and]+?),? plus/s)
    || text.match(/`goal` \(Dimensions ([\d, and]+)\), `risk` \(Dimensions ([\d, and]+),[^)]*\), `overlap` \(Dimension ([\d, and]+),? plus/s);
  assert.ok(m, 'lens table not found');
  return [m[1], m[2], m[3]].map(parseNums);
};

test('lens dimensions partition the checker dimensions 1..N, identically in both files', () => {
  const all = [...new Set([...checker.matchAll(/^## Dimension (\d+):/gm)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.ok(all.length >= 17);
  for (const text of [doc, checker]) {
    const lenses = lensTable(text);
    const flat = lenses.flat().sort((a, b) => a - b);
    assert.deepStrictEqual(flat, all, 'every dimension in exactly one lens');
  }
  assert.deepStrictEqual(lensTable(doc).map((l) => [...l].sort((a, b) => a - b)), lensTable(checker).map((l) => [...l].sort((a, b) => a - b)));
});

test('verdict template: lens plan id, plan-id prefix in required_changes, no per-plan verdict', () => {
  assert.match(checker, /plan: \{lens\}\nrequired_changes:/);
  assert.match(checker, /# Adversarial Review Verdict: Lens \{lens\}/);
  assert.match(checker, /"blocker: \[plan_id\] \.\.\."/);
  assert.doesNotMatch(checker, /Write no VERDICT\.md for plans not listed/);
});
