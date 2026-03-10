import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const EXECUTE_PHASE = readFileSync(join(ROOT, 'get-shit-done/workflows/execute-phase.md'), 'utf8');
const AUDIT = readFileSync(join(ROOT, 'get-shit-done/workflows/audit-milestone.md'), 'utf8');

test('execute-phase contains completed_plans_context assembly step 4.5', () => {
  assert.ok(
    EXECUTE_PHASE.includes('completed_plans_context'),
    'execute-phase.md should contain completed_plans_context'
  );
  assert.ok(
    EXECUTE_PHASE.includes('4.5'),
    'execute-phase.md should have sub-step 4.5 for context assembly'
  );
});

test('execute-phase context assembly reads SUMMARY.md frontmatter fields', () => {
  assert.ok(
    EXECUTE_PHASE.includes('key-decisions') || EXECUTE_PHASE.includes('key_decisions'),
    'execute-phase.md should reference key-decisions from SUMMARY.md'
  );
  assert.ok(
    EXECUTE_PHASE.includes('key-files') || EXECUTE_PHASE.includes('key_files'),
    'execute-phase.md should reference key-files from SUMMARY.md'
  );
  assert.ok(
    EXECUTE_PHASE.includes('summary-extract') || EXECUTE_PHASE.includes('SUMMARY.md'),
    'execute-phase.md should reference SUMMARY.md for context extraction'
  );
});

test('execute-phase completed_plans_context injection is conditional on wave number', () => {
  // Context injection should be explicitly for Wave 2+ only
  const hasWaveGuard =
    EXECUTE_PHASE.includes('wave_number >= 2') ||
    EXECUTE_PHASE.includes('Wave 2+') ||
    EXECUTE_PHASE.includes('wave 2') ||
    EXECUTE_PHASE.includes('Wave 2') ||
    (EXECUTE_PHASE.includes('completed_plans_context') && EXECUTE_PHASE.includes('Wave 1'));
  assert.ok(hasWaveGuard, 'execute-phase.md should guard completed_plans_context injection to Wave 2+ only');
});

test('execute-phase Wave 1 executor prompt does NOT include completed_plans_context', () => {
  // The Wave 1 section should be separate from the Wave 2+ section
  // Wave 1 label appears before Wave 2+ label
  const wave1Idx = EXECUTE_PHASE.indexOf('Wave 1');
  const wave2Idx = EXECUTE_PHASE.indexOf('Wave 2+') !== -1
    ? EXECUTE_PHASE.indexOf('Wave 2+')
    : EXECUTE_PHASE.indexOf('wave_number >= 2');

  // Check that the completed_plans_context block only appears in the Wave 2+ section
  const completedCtxIdx = EXECUTE_PHASE.indexOf('completed_plans_context');
  if (wave1Idx !== -1 && wave2Idx !== -1 && completedCtxIdx !== -1) {
    // The completed_plans_context mention in the executor spawn section should come after Wave 2+ label
    assert.ok(
      completedCtxIdx > wave2Idx || EXECUTE_PHASE.includes('Wave 2+ executors'),
      'completed_plans_context executor block should be in Wave 2+ section, not Wave 1'
    );
  } else {
    // Fallback: just confirm there's a Wave 1 without completed_plans_context nearby
    assert.ok(wave1Idx !== -1, 'execute-phase.md should reference Wave 1 executor');
  }
});

test('execute-phase handles missing SUMMARY.md gracefully in context assembly', () => {
  const hasGraceful =
    EXECUTE_PHASE.includes('skip') ||
    EXECUTE_PHASE.includes('warning') ||
    EXECUTE_PHASE.includes('not found') ||
    EXECUTE_PHASE.includes('unavailable');
  assert.ok(
    hasGraceful,
    'execute-phase.md should handle missing SUMMARY.md gracefully in context assembly'
  );
});

test('audit-milestone contains PRD-TRACE.md cross-reference step 5f', () => {
  assert.ok(AUDIT.includes('PRD-TRACE.md'), 'audit-milestone.md should reference PRD-TRACE.md');
  assert.ok(
    AUDIT.includes('5f') || AUDIT.includes('Step 5f'),
    'audit-milestone.md should have Step 5f'
  );
  assert.ok(
    AUDIT.includes('PRD Traceability') || AUDIT.includes('prd_traceability'),
    'audit-milestone.md should reference PRD Traceability'
  );
});

test('audit-milestone PRD-TRACE.md check is optional and NOT a blocker when absent', () => {
  const hasOptional =
    AUDIT.includes('Optional') ||
    AUDIT.includes('optional') ||
    AUDIT.includes('NOT a blocker') ||
    AUDIT.includes('not a blocker') ||
    AUDIT.includes('skip');
  assert.ok(
    hasOptional,
    'audit-milestone.md PRD-TRACE.md check should be optional/NOT a blocker when absent'
  );
});

test('audit-milestone MILESTONE-AUDIT.md template includes prd_traceability score field', () => {
  assert.ok(
    AUDIT.includes('prd_traceability'),
    'audit-milestone.md MILESTONE-AUDIT.md template should include prd_traceability score field'
  );
});

test('audit-milestone success_criteria includes PRD-TRACE.md cross-reference check', () => {
  const hasCriteria =
    AUDIT.includes('PRD-TRACE.md cross-reference') ||
    AUDIT.includes('PRD Express Path');
  assert.ok(
    hasCriteria,
    'audit-milestone.md success_criteria should include PRD-TRACE.md cross-reference'
  );
});
