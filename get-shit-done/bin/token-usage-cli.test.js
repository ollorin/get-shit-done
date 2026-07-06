/**
 * Phase 58-02 (MILE-36): CLI integration tests for the token-usage ledger
 * wiring -- `token-usage record` -> `savings report` end to end.
 *
 * Drives the REAL CLI as a subprocess (mirroring gsd-tools.test.js's
 * runGsdTools/createTempProject/cleanup helpers and Phase 57-04's
 * `execution-log event --type task_outcome --data '...'` pattern) against an
 * isolated temp project per test. This is CLI-level integration coverage --
 * NOT a re-test of token-usage-ledger.js's pure functions, which are already
 * unit-tested in token-usage-ledger.test.js (Plan 58-01).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const TOOLS_PATH = path.join(__dirname, 'gsd-tools.js');

// Helper to run gsd-tools command (mirrors gsd-tools.test.js's runGsdTools)
function runGsdTools(args, cwd = process.cwd(), extraEnv = {}) {
  try {
    const result = execSync(`node "${TOOLS_PATH}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}

// Create temp directory structure (mirrors gsd-tools.test.js's createTempProject)
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('Phase 58-02: token-usage CLI wiring (record -> report)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Logs one task_outcome event via the real CLI, mirroring Phase 57-04's
  // `execution-log event --type task_outcome --data '...'` subprocess shape.
  function logTaskOutcome(taskIndex, tier = 'sonnet') {
    const data = JSON.stringify({
      phase: 58,
      plan: '58-02-PLAN.md',
      task_index: taskIndex,
      task_name: 'wire the token-usage CLI',
      task_type: 'feature',
      tier,
      outcome: 'success',
      capability_related: false,
    });
    const result = runGsdTools(`execution-log event --type task_outcome --data '${data}'`, tmpDir);
    assert.ok(result.success, `logging task_outcome failed: ${result.error}`);
  }

  // Records usage for one task via the real `token-usage record` CLI (no
  // explicit tokens -> estimated).
  function recordUsage(taskIndex, tier = 'sonnet') {
    const result = runGsdTools(
      `token-usage record --phase 58 --plan "58-02-PLAN.md" --task-index ${taskIndex} --task-name "wire the token-usage CLI" --tier ${tier}`,
      tmpDir
    );
    assert.ok(result.success, `token-usage record failed: ${result.error}`);
    return JSON.parse(result.output);
  }

  test('empty coverage: savings report --json returns available:false with exact reason; table mode says "No data recorded"', () => {
    const jsonResult = runGsdTools('savings report --json', tmpDir);
    assert.ok(jsonResult.success, `savings report --json failed: ${jsonResult.error}`);
    const report = JSON.parse(jsonResult.output);
    assert.deepStrictEqual(report, { available: false, reason: 'no recorded usage data' });

    const tableResult = runGsdTools('savings report', tmpDir);
    assert.ok(tableResult.success, `savings report (table) failed: ${tableResult.error}`);
    assert.ok(
      tableResult.output.includes('No data recorded'),
      `expected table output to contain "No data recorded", got: ${tableResult.output}`
    );
  });

  test('token-usage record writes exactly one estimated record to the on-disk ledger', () => {
    const result = runGsdTools(
      'token-usage record --phase 58 --plan "58-02-PLAN.md" --task-index 1 --task-name "Implement the CLI wiring" --tier sonnet',
      tmpDir
    );
    assert.ok(result.success, `token-usage record failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.recorded, true);
    assert.strictEqual(parsed.record.source, 'estimated');
    assert.ok(parsed.record.tokens.input > 0, 'estimated input tokens should be > 0');
    assert.ok(parsed.record.tokens.output > 0, 'estimated output tokens should be > 0');

    // Read the durable ledger directly off disk.
    const ledgerPath = path.join(tmpDir, '.planning', 'telemetry', 'token-usage.jsonl');
    assert.ok(fs.existsSync(ledgerPath), 'token-usage.jsonl should exist after record');
    const lines = fs.readFileSync(ledgerPath, 'utf-8').split('\n').filter(l => l.trim());
    assert.strictEqual(lines.length, 1, 'ledger should contain exactly one record');
    const record = JSON.parse(lines[0]);
    assert.strictEqual(record.task_index, 1);
    assert.strictEqual(record.tier, 'sonnet');
  });

  test('full coverage: 3 task_outcomes + 3 matching records -> 100% coverage, quality/opus baseline, positive savings, all_estimated', () => {
    for (const i of [1, 2, 3]) {
      logTaskOutcome(i);
      recordUsage(i);
    }

    const jsonResult = runGsdTools('savings report --json', tmpDir);
    assert.ok(jsonResult.success, `savings report --json failed: ${jsonResult.error}`);
    const report = JSON.parse(jsonResult.output);
    assert.strictEqual(report.available, true);
    assert.deepStrictEqual(report.coverage, { matched_tasks: 3, total_tasks: 3, percent: 100 });
    assert.strictEqual(report.baseline_profile, 'quality');
    assert.strictEqual(report.baseline_tier, 'opus');
    assert.ok(report.savings_usd > 0, `expected positive savings (sonnet actual vs opus baseline), got ${report.savings_usd}`);
    assert.strictEqual(report.data_quality, 'all_estimated');

    const tableResult = runGsdTools('savings report', tmpDir);
    assert.ok(tableResult.success, `savings report (table) failed: ${tableResult.error}`);
    assert.ok(tableResult.output.includes('ESTIMATED'), 'table output should carry the ESTIMATED honesty banner');
    assert.ok(tableResult.output.includes('3/3 tasks'), 'table output should show 3/3 task coverage');
  });

  test('partial coverage: 3 task_outcomes but only 2 recorded -> honest 2/3 (~66.7%) coverage', () => {
    for (const i of [1, 2, 3]) {
      logTaskOutcome(i);
    }
    recordUsage(1);
    recordUsage(2);

    const jsonResult = runGsdTools('savings report --json', tmpDir);
    assert.ok(jsonResult.success, `savings report --json failed: ${jsonResult.error}`);
    const report = JSON.parse(jsonResult.output);
    assert.strictEqual(report.available, true);
    assert.strictEqual(report.coverage.matched_tasks, 2);
    assert.strictEqual(report.coverage.total_tasks, 3);
    // Tolerance check, not brittle exact-float equality.
    assert.ok(
      Math.abs(report.coverage.percent - 66.7) < 0.5,
      `expected coverage percent ~66.7, got ${report.coverage.percent}`
    );
  });

  test('savings_baseline_profile config wiring: budget profile yields sonnet baseline (not opus)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ savings: { baseline_profile: 'budget' } }, null, 2)
    );
    logTaskOutcome(1);
    recordUsage(1);

    const jsonResult = runGsdTools('savings report --json', tmpDir);
    assert.ok(jsonResult.success, `savings report --json failed: ${jsonResult.error}`);
    const report = JSON.parse(jsonResult.output);
    assert.strictEqual(report.available, true);
    assert.strictEqual(report.baseline_profile, 'budget');
    // Proves the config key changes the COMPUTED report, not just its label:
    // budget's executor tier is sonnet, so the baseline tier must not be opus.
    assert.strictEqual(report.baseline_tier, 'sonnet');
  });

  test('command-namespace separation: token-usage record never touches token_budget.json', () => {
    recordUsage(1);
    const budgetPath = path.join(tmpDir, '.planning', 'token_budget.json');
    assert.strictEqual(
      fs.existsSync(budgetPath),
      false,
      'token-usage record must not create token_budget.json (that file belongs to the separate `token` namespace)'
    );
  });
});
