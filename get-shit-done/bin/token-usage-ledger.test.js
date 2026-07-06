/**
 * token-usage-ledger.test.js
 *
 * Phase 58-01 (MILE-36) unit tests for token-usage-ledger.js: the thin-I/O
 * JSONL append/read pair, the crude estimation heuristic, the configured
 * baseline-tier resolver, the honesty-critical savings computation
 * (full/partial/empty coverage), the table formatter's honesty labeling,
 * and loadConfig's new savings_baseline_profile key.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  getTokenUsagePath,
  appendTaskUsage,
  readTaskUsageRecords,
  estimateTaskTokens,
  resolveBaselineTier,
  computeSavingsFromUsage,
  formatUsageSavingsTable
} = require('./token-usage-ledger.js');

const { loadConfig } = require('./gsd-tools.js');

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-token-usage-test-'));
}

function outcomeEvent(phase, plan, taskIndex) {
  return { type: 'task_outcome', phase, plan, task_index: taskIndex };
}

function usageRecord(phase, plan, taskIndex, overrides = {}) {
  return {
    timestamp: '2026-07-06T00:00:00.000Z',
    phase,
    plan,
    task_index: taskIndex,
    task_name: `task ${taskIndex}`,
    tier: 'sonnet',
    tokens: { input: 10000, output: 2000 },
    source: 'estimated',
    ...overrides
  };
}

describe('Phase 58-01: token usage ledger', () => {
  describe('appendTaskUsage / readTaskUsageRecords', () => {
    let tmpDir;
    let warnings;
    let originalWarn;

    beforeEach(() => {
      tmpDir = makeTempProject();
      warnings = [];
      originalWarn = console.warn;
      console.warn = (msg) => { warnings.push(String(msg)); };
    });

    afterEach(() => {
      console.warn = originalWarn;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('round-trip: 3 appended records read back with deep equality (auto timestamp, defaulted source)', () => {
      const results = [];
      results.push(appendTaskUsage(tmpDir, {
        phase: '58', plan: '01', task_index: 1, task_name: 'Task one',
        tier: 'sonnet', tokens: { input: 8000, output: 2000 }
        // source omitted -> defaults to 'estimated'
      }));
      results.push(appendTaskUsage(tmpDir, {
        phase: '58', plan: '01', task_index: 2, task_name: 'Task two',
        tier: 'haiku', tokens: { input: 3000, output: 800 }, source: 'actual'
      }));
      results.push(appendTaskUsage(tmpDir, {
        phase: '58', plan: '01', task_index: 3, task_name: 'Task three',
        tier: 'opus', tokens: { input: 12000, output: 3000 }, source: 'estimated'
      }));

      for (const r of results) {
        assert.strictEqual(r.ok, true);
        assert.ok(typeof r.record.timestamp === 'string' && r.record.timestamp.length > 0,
          'timestamp auto-populated');
        assert.ok(Number.isFinite(Date.parse(r.record.timestamp)), 'timestamp is a valid ISO date');
      }
      assert.strictEqual(results[0].record.source, 'estimated', 'omitted source defaults to estimated');
      assert.strictEqual(results[1].record.source, 'actual');

      const readBack = readTaskUsageRecords(tmpDir);
      assert.strictEqual(readBack.length, 3);
      assert.deepStrictEqual(readBack, results.map(r => r.record));
    });

    test('absent file reads back []', () => {
      assert.deepStrictEqual(readTaskUsageRecords(tmpDir), []);
    });

    test('malformed JSONL line is skipped with console.warn and does NOT throw', () => {
      appendTaskUsage(tmpDir, { phase: '58', plan: '01', task_index: 1, task_name: 'good one' });
      const usagePath = getTokenUsagePath(tmpDir);
      fs.appendFileSync(usagePath, 'this is { not valid json\n');
      appendTaskUsage(tmpDir, { phase: '58', plan: '01', task_index: 2, task_name: 'good two' });

      // Direct assertion around the call proves it never throws.
      assert.doesNotThrow(() => readTaskUsageRecords(tmpDir));
      const records = readTaskUsageRecords(tmpDir);
      assert.strictEqual(records.length, 2, 'malformed line skipped, good records kept');
      assert.ok(warnings.some(w => w.includes('malformed token-usage line')),
        'a console.warn was emitted for the malformed line');
    });

    test('appendTaskUsage never throws on malformed entry and writes safe defaults', () => {
      const malformedEntries = [
        undefined,
        null,
        {},
        { tokens: 'not-an-object' },
        { tokens: { input: 'NaN-ish', output: null }, source: 'bogus-source', task_name: 42 }
      ];
      for (const entry of malformedEntries) {
        let result;
        assert.doesNotThrow(() => { result = appendTaskUsage(tmpDir, entry); });
        assert.strictEqual(result.ok, true);
        assert.deepStrictEqual(result.record.tokens, { input: 0, output: 0 },
          'wrong-typed/missing tokens default to zero');
        assert.strictEqual(result.record.source, 'estimated',
          'invalid/missing source defaults to estimated');
        assert.strictEqual(result.record.tier, 'sonnet', 'missing tier defaults to sonnet');
      }
      const records = readTaskUsageRecords(tmpDir);
      assert.strictEqual(records.length, malformedEntries.length,
        'every malformed entry still produced a written record');
    });
  });

  describe('estimateTaskTokens', () => {
    test('distinct non-zero estimates per tier: opus > sonnet > haiku (same task name)', () => {
      const name = 'Implement the widget';
      const haiku = estimateTaskTokens(name, 'haiku');
      const sonnet = estimateTaskTokens(name, 'sonnet');
      const opus = estimateTaskTokens(name, 'opus');
      for (const est of [haiku, sonnet, opus]) {
        assert.ok(est.input > 0 && est.output > 0, 'non-zero estimates');
      }
      assert.ok(opus.input > sonnet.input && sonnet.input > haiku.input, 'input ordering opus > sonnet > haiku');
      assert.ok(opus.output > sonnet.output && sonnet.output > haiku.output, 'output ordering opus > sonnet > haiku');
    });

    test('longer task name scales estimate up, capped at 2x', () => {
      const short = estimateTaskTokens('short', 'sonnet');
      const long = estimateTaskTokens('x'.repeat(120), 'sonnet');
      const veryLong = estimateTaskTokens('x'.repeat(10000), 'sonnet');
      assert.ok(long.input > short.input, 'longer name scales input up');
      assert.ok(long.output > short.output, 'longer name scales output up');
      // Cap: lengthFactor is Math.min(2, ...), so an absurdly long name is exactly 2x the base.
      assert.strictEqual(veryLong.input, short.input * 2, 'input capped at 2x base');
      assert.strictEqual(veryLong.output, short.output * 2, 'output capped at 2x base');
    });

    test('unknown tier falls back to the sonnet default', () => {
      const name = 'some task';
      assert.deepStrictEqual(estimateTaskTokens(name, 'mystery-tier'), estimateTaskTokens(name, 'sonnet'));
    });

    test('missing/non-string taskName does not throw and returns base tier default (lengthFactor 1)', () => {
      for (const badName of [undefined, null, 42, {}]) {
        let est;
        assert.doesNotThrow(() => { est = estimateTaskTokens(badName, 'sonnet'); });
        assert.deepStrictEqual(est, { input: 8000, output: 2000 });
      }
    });
  });

  describe('resolveBaselineTier', () => {
    test('quality -> opus', () => {
      assert.strictEqual(resolveBaselineTier('quality'), 'opus');
    });
    test('balanced -> sonnet', () => {
      assert.strictEqual(resolveBaselineTier('balanced'), 'sonnet');
    });
    test('budget -> sonnet', () => {
      assert.strictEqual(resolveBaselineTier('budget'), 'sonnet');
    });
    test('unknown/missing profile falls back to opus (the quality mapping)', () => {
      assert.strictEqual(resolveBaselineTier('nonsense'), 'opus');
      assert.strictEqual(resolveBaselineTier(undefined), 'opus');
      assert.strictEqual(resolveBaselineTier(null), 'opus');
      assert.strictEqual(resolveBaselineTier(''), 'opus');
    });
  });

  describe('computeSavingsFromUsage', () => {
    test('empty usageRecords -> {available:false, reason} exactly, regardless of taskOutcomeEvents', () => {
      const events = [outcomeEvent('58', '01', 1), outcomeEvent('58', '01', 2)];
      assert.deepStrictEqual(
        computeSavingsFromUsage([], events, 'quality'),
        { available: false, reason: 'no recorded usage data' }
      );
      assert.deepStrictEqual(
        computeSavingsFromUsage([], [], 'budget'),
        { available: false, reason: 'no recorded usage data' }
      );
      assert.deepStrictEqual(
        computeSavingsFromUsage(undefined, events, 'quality'),
        { available: false, reason: 'no recorded usage data' }
      );
    });

    test('full coverage: 3 sonnet records matching 3 outcome events, quality baseline', () => {
      const records = [1, 2, 3].map(i => usageRecord('58', '01', i));
      const events = [1, 2, 3].map(i => outcomeEvent('58', '01', i));
      const report = computeSavingsFromUsage(records, events, 'quality');
      assert.strictEqual(report.available, true);
      assert.deepStrictEqual(report.coverage, { matched_tasks: 3, total_tasks: 3, percent: 100 });
      assert.strictEqual(report.baseline_tier, 'opus');
      assert.strictEqual(report.baseline_profile, 'quality');
      assert.ok(report.savings_usd > 0, 'opus baseline costs more than sonnet actual');
      assert.strictEqual(report.data_quality, 'all_estimated');
      assert.strictEqual(report.record_count, 3);
      assert.strictEqual(report.estimated_record_count, 3);
      assert.strictEqual(report.actual_record_count, 0);
    });

    test('partial coverage: 3 outcome events, only 2 matched -> percent is (2/3)*100', () => {
      const records = [1, 2].map(i => usageRecord('58', '01', i));
      const events = [1, 2, 3].map(i => outcomeEvent('58', '01', i));
      const report = computeSavingsFromUsage(records, events, 'quality');
      assert.strictEqual(report.coverage.matched_tasks, 2);
      assert.strictEqual(report.coverage.total_tasks, 3);
      assert.ok(Math.abs(report.coverage.percent - (2 / 3) * 100) < 1e-9,
        `coverage percent ${report.coverage.percent} should equal (2/3)*100`);
    });

    test('zero outcome events with non-empty records -> total_tasks 0, percent explicitly null', () => {
      const records = [usageRecord('58', '01', 1)];
      const report = computeSavingsFromUsage(records, [], 'quality');
      assert.strictEqual(report.available, true);
      assert.strictEqual(report.coverage.total_tasks, 0);
      assert.strictEqual(report.coverage.matched_tasks, 0);
      assert.strictEqual(report.coverage.percent, null,
        'zero-denominator coverage is explicitly null, not 0/100/NaN');
    });

    test('baseline profile switching changes baseline_tier and savings (budget <= quality)', () => {
      const records = [1, 2, 3].map(i => usageRecord('58', '01', i));
      const events = [1, 2, 3].map(i => outcomeEvent('58', '01', i));
      const quality = computeSavingsFromUsage(records, events, 'quality');
      const budget = computeSavingsFromUsage(records, events, 'budget');
      assert.strictEqual(quality.baseline_tier, 'opus');
      assert.strictEqual(budget.baseline_tier, 'sonnet');
      assert.notStrictEqual(quality.savings_usd, budget.savings_usd);
      assert.notStrictEqual(quality.savings_percent, budget.savings_percent);
      assert.ok(budget.savings_usd <= quality.savings_usd,
        'budget (cheaper) baseline yields lower or equal savings than quality');
    });

    test('data_quality: mixed / all_actual / all_estimated', () => {
      const events = [1, 2, 3].map(i => outcomeEvent('58', '01', i));

      const mixedRecords = [
        usageRecord('58', '01', 1, { source: 'actual' }),
        usageRecord('58', '01', 2, { source: 'estimated' }),
        usageRecord('58', '01', 3, { source: 'estimated' })
      ];
      assert.strictEqual(computeSavingsFromUsage(mixedRecords, events, 'quality').data_quality, 'mixed');

      const allActual = [1, 2, 3].map(i => usageRecord('58', '01', i, { source: 'actual' }));
      assert.strictEqual(computeSavingsFromUsage(allActual, events, 'quality').data_quality, 'all_actual');

      const allEstimated = [1, 2, 3].map(i => usageRecord('58', '01', i));
      assert.strictEqual(computeSavingsFromUsage(allEstimated, events, 'quality').data_quality, 'all_estimated');
    });
  });

  describe('formatUsageSavingsTable', () => {
    const events = [1, 2, 3].map(i => outcomeEvent('58', '01', i));

    test('empty-data report renders "No data recorded"', () => {
      const table = formatUsageSavingsTable(computeSavingsFromUsage([], [], 'quality'));
      assert.ok(table.includes('No data recorded'), 'explicit no-data message');
    });

    test('all_estimated report renders the ESTIMATED honesty banner', () => {
      const records = [1, 2, 3].map(i => usageRecord('58', '01', i));
      const table = formatUsageSavingsTable(computeSavingsFromUsage(records, events, 'quality'));
      assert.ok(table.includes('ESTIMATED'), 'ESTIMATED banner present for estimated data');
    });

    test('all_actual report does NOT render the ESTIMATED banner', () => {
      const records = [1, 2, 3].map(i => usageRecord('58', '01', i, { source: 'actual' }));
      const table = formatUsageSavingsTable(computeSavingsFromUsage(records, events, 'quality'));
      assert.ok(table.indexOf('ESTIMATED') === -1, 'no ESTIMATED banner for fully actual data');
    });

    test('coverage line is always present, formatted as "X/Y tasks"', () => {
      const partialRecords = [1, 2].map(i => usageRecord('58', '01', i));
      const partial = computeSavingsFromUsage(partialRecords, events, 'quality');
      const partialTable = formatUsageSavingsTable(partial);
      assert.ok(partialTable.includes('Coverage:'), 'coverage line present');
      assert.ok(partialTable.includes('2/3 tasks'), 'matched/total formatted as X/Y tasks');

      const fullRecords = [1, 2, 3].map(i => usageRecord('58', '01', i));
      const full = computeSavingsFromUsage(fullRecords, events, 'quality');
      const fullTable = formatUsageSavingsTable(full);
      assert.ok(fullTable.includes('Coverage:'), 'coverage line present on full coverage too');
      assert.ok(fullTable.includes('3/3 tasks'), 'full coverage formatted as 3/3 tasks');
    });
  });

  describe('loadConfig savings_baseline_profile', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = makeTempProject();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('defaults to quality when .planning/config.json is absent', () => {
      assert.strictEqual(loadConfig(tmpDir).savings_baseline_profile, 'quality');
    });

    test('nested {"savings":{"baseline_profile":"budget"}} resolves to budget', () => {
      const planningDir = path.join(tmpDir, '.planning');
      fs.mkdirSync(planningDir, { recursive: true });
      fs.writeFileSync(path.join(planningDir, 'config.json'),
        JSON.stringify({ savings: { baseline_profile: 'budget' } }));
      assert.strictEqual(loadConfig(tmpDir).savings_baseline_profile, 'budget');
    });

    test('flat {"savings_baseline_profile":"balanced"} resolves to balanced', () => {
      const planningDir = path.join(tmpDir, '.planning');
      fs.mkdirSync(planningDir, { recursive: true });
      fs.writeFileSync(path.join(planningDir, 'config.json'),
        JSON.stringify({ savings_baseline_profile: 'balanced' }));
      assert.strictEqual(loadConfig(tmpDir).savings_baseline_profile, 'balanced');
    });
  });
});
