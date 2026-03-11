import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const TRANSITION = readFileSync(join(ROOT, 'get-shit-done/workflows/transition.md'), 'utf8');
const VERIFIER = readFileSync(join(ROOT, 'agents/gsd-verifier.md'), 'utf8');

// ─── Transition KB feedback tests ────────────────────────────────────────────

test('transition.md has transition-kb-feedback step', () => {
  assert.ok(TRANSITION.includes('transition-kb-feedback'),
    'transition.md should have a transition-kb-feedback step');
});

test('transition-kb-feedback step writes decisions to KB with correct type', () => {
  assert.ok(TRANSITION.includes('knowledge add'), 'transition.md should call knowledge add');
  assert.ok(TRANSITION.includes('--type decision') || TRANSITION.includes('type decision'),
    'transition.md should write decisions with --type decision');
});

test('transition-kb-feedback uses long_term TTL', () => {
  assert.ok(TRANSITION.includes('--ttl long_term') || TRANSITION.includes('long_term'),
    'transition.md should use long_term TTL for decision entries');
});

test('transition-kb-feedback content format includes Phase prefix', () => {
  assert.ok(TRANSITION.includes('[Phase') && TRANSITION.includes('decision]'),
    'transition.md KB entries should use "[Phase N decision]" format');
});

test('transition-kb-feedback is non-blocking on errors', () => {
  assert.ok(TRANSITION.includes('|| true') || TRANSITION.includes('Never block') || TRANSITION.includes('never block'),
    'transition.md KB feedback should be non-blocking on errors (|| true pattern)');
});

test('transition-kb-feedback step comes after evolve_project', () => {
  const evolveIdx = TRANSITION.indexOf('evolve_project');
  const kbIdx = TRANSITION.indexOf('transition-kb-feedback');
  assert.ok(evolveIdx !== -1, 'evolve_project step should exist');
  assert.ok(kbIdx !== -1, 'transition-kb-feedback step should exist');
  assert.ok(kbIdx > evolveIdx, 'transition-kb-feedback should appear after evolve_project');
});

// ─── Verifier KB feedback tests ───────────────────────────────────────────────

test('gsd-verifier.md has kb_feedback section', () => {
  assert.ok(VERIFIER.includes('kb_feedback'),
    'verifier should have kb_feedback section');
});

test('verifier kb_feedback writes anti_pattern type entries', () => {
  assert.ok(VERIFIER.includes('anti_pattern'),
    'verifier should write anti_pattern type KB entries');
  assert.ok(VERIFIER.includes('knowledge add'),
    'verifier should call knowledge add');
});

test('verifier kb_feedback only writes FAILED and STUB gaps', () => {
  assert.ok(VERIFIER.includes('failed') && VERIFIER.includes('stub'),
    'verifier should reference failed and stub gap types for KB writes');
  // Should indicate skipping uncertain/human_needed
  assert.ok(VERIFIER.includes('uncertain') || VERIFIER.includes('human_needed') || VERIFIER.includes('Skip') || VERIFIER.includes('skip'),
    'verifier should skip uncertain/human_needed gaps');
});

test('verifier kb_feedback content format includes Phase prefix and root cause', () => {
  assert.ok(VERIFIER.includes('[Phase') && VERIFIER.includes('anti-pattern]'),
    'verifier KB entries should use "[Phase N anti-pattern]" format');
  assert.ok(VERIFIER.includes('root cause'),
    'verifier KB entries should include root cause in content');
});

test('verifier success_criteria includes anti-pattern KB write', () => {
  const criteriaIdx = VERIFIER.indexOf('success_criteria');
  assert.ok(criteriaIdx !== -1, 'verifier should have success_criteria section');
  const criteriaSection = VERIFIER.slice(criteriaIdx);
  assert.ok(criteriaSection.includes('Anti-patterns written to KB') || criteriaSection.includes('anti-pattern'),
    'success_criteria should include anti-pattern KB write item');
});
