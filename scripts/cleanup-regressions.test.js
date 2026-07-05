/**
 * Cleanup Regression Tests (Phase 44-04, MILE-18 dead-code cleanup)
 *
 * Covers the parts of Tasks 1/2 (already committed: 928707f, c23814c, 78eeba7)
 * NOT covered by get-shit-done/bin/gsd-tools.test.js's "parallel command
 * removal" describe block:
 *
 *  C. token-monitor.js's TokenBudgetMonitor still fires graduated alerts at
 *     the 0.50/0.65/0.80/0.90/0.95 thresholds after removing the broken
 *     0.80-threshold auto-compression side-effect branch.
 *  D. scripts/health-check.js's rewritten "Core Implementations" category
 *     reports all 5 real get-shit-done/bin/gsd-*.js files as passing.
 *  E. scripts/install-orchestrator.js no longer references the deleted
 *     scripts/install-hooks.js, and still parses cleanly.
 *  F. get-shit-done/modules/ is gone from disk, and no file in the codebase
 *     (excluding .planning/ and docs/) still references
 *     modules/<name>/index.js for any of the 5 deleted modules.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const TOKEN_MONITOR_PATH = path.join(REPO_ROOT, 'get-shit-done', 'bin', 'token-monitor.js');
const HEALTH_CHECK_PATH = path.join(REPO_ROOT, 'scripts', 'health-check.js');
const INSTALL_ORCHESTRATOR_PATH = path.join(REPO_ROOT, 'scripts', 'install-orchestrator.js');
const MODULES_DIR = path.join(REPO_ROOT, 'get-shit-done', 'modules');

// ─────────────────────────────────────────────────────────────────────────────
// C. token-monitor.js — graduated alert thresholds
// ─────────────────────────────────────────────────────────────────────────────

describe('TokenBudgetMonitor graduated alerts (Phase 44-04 regression)', () => {
  test('module still exports TokenBudgetMonitor as a constructor', () => {
    const mod = require(TOKEN_MONITOR_PATH);
    assert.strictEqual(typeof mod.TokenBudgetMonitor, 'function', 'TokenBudgetMonitor should be exported');
    const instance = new mod.TokenBudgetMonitor('opus', 100);
    assert.ok(instance instanceof mod.TokenBudgetMonitor);
  });

  test('recordUsage() fires all 5 graduated alerts (50/65/80/90/95%) as usage crosses each threshold incrementally', () => {
    const { TokenBudgetMonitor } = require(TOKEN_MONITOR_PATH);
    const monitor = new TokenBudgetMonitor('opus', 100);

    // Record usage in 10-token increments up to 100% so each threshold is
    // crossed exactly once, in ascending order.
    for (let i = 0; i < 10; i++) {
      monitor.recordUsage(10, `phase-${i}`);
    }

    assert.deepStrictEqual(
      monitor.thresholdsPassed,
      ['50%', '65%', '80%', '90%', '95%'],
      `expected all 5 thresholds to fire in order, got: ${JSON.stringify(monitor.thresholdsPassed)}`
    );
    assert.strictEqual(monitor.graduatedAlerts.length, 5, 'exactly 5 graduated alert entries should exist');

    const levelsByThreshold = Object.fromEntries(
      monitor.graduatedAlerts.map(a => [a.threshold, a.level])
    );
    assert.strictEqual(levelsByThreshold['50%'], 'INFO');
    assert.strictEqual(levelsByThreshold['65%'], 'INFO');
    assert.strictEqual(levelsByThreshold['80%'], 'WARN');
    assert.strictEqual(levelsByThreshold['90%'], 'ERROR');
    assert.strictEqual(levelsByThreshold['95%'], 'CRITICAL');
  });

  test('recordUsage() does not re-fire a threshold already passed on subsequent calls', () => {
    const { TokenBudgetMonitor } = require(TOKEN_MONITOR_PATH);
    const monitor = new TokenBudgetMonitor('opus', 100);

    monitor.recordUsage(55, 'phase-a'); // crosses 50%
    assert.deepStrictEqual(monitor.thresholdsPassed, ['50%']);

    monitor.recordUsage(1, 'phase-b'); // 56%, still only 50% passed
    assert.deepStrictEqual(
      monitor.thresholdsPassed,
      ['50%'],
      'threshold should not be duplicated on subsequent calls that do not cross a new boundary'
    );
    assert.strictEqual(monitor.graduatedAlerts.length, 1, 'only one alert entry should exist so far');
  });

  test('a single large jump in usage fires every threshold it crosses at once, in order', () => {
    const { TokenBudgetMonitor } = require(TOKEN_MONITOR_PATH);
    const monitor = new TokenBudgetMonitor('opus', 100);

    // Jump straight from 0% to 96% in one call — should fire all 5 thresholds
    // in a single recordUsage(), not just the highest one.
    monitor.recordUsage(96, 'big-jump');

    assert.deepStrictEqual(
      monitor.thresholdsPassed,
      ['50%', '65%', '80%', '90%', '95%'],
      'all thresholds crossed by the jump should fire, in ascending order'
    );
    assert.strictEqual(monitor.graduatedAlerts.length, 5);
  });

  test('graduated alert entries report accurate tokens_used and tokens_remaining at each threshold', () => {
    const { TokenBudgetMonitor } = require(TOKEN_MONITOR_PATH);
    const monitor = new TokenBudgetMonitor('opus', 200);

    monitor.recordUsage(190, 'phase-x'); // 95% of 200

    const critical = monitor.graduatedAlerts.find(a => a.threshold === '95%');
    assert.ok(critical, 'critical (95%) alert should exist');
    assert.strictEqual(critical.tokens_used, 190);
    assert.strictEqual(critical.tokens_remaining, 10);
    assert.strictEqual(critical.phase, 'phase-x');
  });

  test('below 50% utilization, no graduated alerts fire at all', () => {
    const { TokenBudgetMonitor } = require(TOKEN_MONITOR_PATH);
    const monitor = new TokenBudgetMonitor('opus', 200);

    monitor.recordUsage(99, 'phase-low'); // 49.5%

    assert.deepStrictEqual(monitor.thresholdsPassed, [], 'no threshold should have fired below 50%');
    assert.strictEqual(monitor.graduatedAlerts.length, 0);
  });

  test('the removed 0.80-threshold auto-compression side-effect branch is gone from _checkGraduatedAlerts source', () => {
    const source = fs.readFileSync(TOKEN_MONITOR_PATH, 'utf-8');
    // Regression guard: the old auto-compression side effect used to shell
    // out / write files / call another API directly inside the alert-check
    // method as soon as utilization crossed 0.80. The `action: 'Enable
    // compression'` string on the 0.80 entry is just descriptive alert data
    // (asserted elsewhere) and is NOT itself a side effect, so we only assert
    // the method body performs no filesystem writes, process calls, or
    // external requires — just pure bookkeeping (array pushes).
    const methodMatch = source.match(/_checkGraduatedAlerts\([^)]*\)\s*{([\s\S]*?)\n  }/);
    assert.ok(methodMatch, '_checkGraduatedAlerts method should exist and be parseable');
    const methodBody = methodMatch[1];

    const forbiddenPatterns = [
      /fs\.write/, /fs\.append/, /execSync/, /spawn\(/, /require\(/, /process\.exit/,
    ];
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(methodBody),
        `_checkGraduatedAlerts should have no side effects beyond bookkeeping, found match for ${pattern}: ${methodBody}`
      );
    }
    // Positive control: confirm the method still does its real bookkeeping job,
    // so the negative assertions above aren't passing vacuously.
    assert.ok(methodBody.includes('this.graduatedAlerts.push('), 'method should still push graduated alerts');
    assert.ok(methodBody.includes('this.thresholdsPassed.push('), 'method should still track passed thresholds');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. health-check.js — "Core Implementations" category
// ─────────────────────────────────────────────────────────────────────────────

describe('health-check.js Core Implementations checks (Phase 44-04 regression)', () => {
  test('health-check.js exports the healthCheck function when required (not run as main)', () => {
    const healthCheck = require(HEALTH_CHECK_PATH);
    assert.strictEqual(typeof healthCheck, 'function', 'requiring health-check.js should yield the healthCheck function');
  });

  test('all 5 "Core Implementations" checks pass for the real gsd-*.js files on disk', async () => {
    // Reset the require cache so we get a fresh module (defineChecks() runs
    // fresh path.resolve(__dirname, '..') against health-check.js's own
    // location, which is correct regardless of cache state, but re-requiring
    // keeps this test independent of require order in the same process).
    delete require.cache[require.resolve(HEALTH_CHECK_PATH)];
    const healthCheck = require(HEALTH_CHECK_PATH);

    const capturedLines = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...parts) => capturedLines.push(parts.join(' '));
    console.error = (...parts) => capturedLines.push(parts.join(' '));

    let overallResult;
    try {
      overallResult = await healthCheck();
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.strictEqual(typeof overallResult, 'boolean', 'healthCheck() should resolve to a boolean');

    // Isolate just the "Core Implementations" section of the printed report so
    // this test does not depend on unrelated, machine-specific categories
    // (Whisper models, MCP config, etc.) that may legitimately fail/skip on
    // any given dev machine or CI runner.
    const startIdx = capturedLines.findIndex(l => l.includes('Core Implementations:'));
    assert.ok(startIdx !== -1, 'output should include a "Core Implementations:" category header');

    const sectionLines = [];
    for (let i = startIdx + 1; i < capturedLines.length; i++) {
      const line = capturedLines[i];
      if (line.trim() === '') break; // category sections are blank-line terminated
      sectionLines.push(line);
    }

    const expectedNames = ['validator', 'circuit-breaker', 'escalation', 'feedback', 'learning'];
    assert.strictEqual(
      sectionLines.length,
      expectedNames.length,
      `expected exactly ${expectedNames.length} Core Implementations lines, got: ${JSON.stringify(sectionLines)}`
    );

    for (const name of expectedNames) {
      const line = sectionLines.find(l => l.includes(`Implementation: ${name}`));
      assert.ok(line, `expected a "Implementation: ${name}" line, got section: ${JSON.stringify(sectionLines)}`);
      assert.ok(
        line.trim().startsWith('+'),
        `Implementation: ${name} should pass (prefixed with "+"), got: "${line}"`
      );
    }
  });

  test('each Core Implementations check maps to a real gsd-*.js file that actually exists on disk', () => {
    const expectedFiles = [
      'gsd-validator.js',
      'gsd-circuit-breaker.js',
      'gsd-escalation.js',
      'gsd-feedback.js',
      'gsd-learning.js',
    ];
    for (const file of expectedFiles) {
      const fullPath = path.join(REPO_ROOT, 'get-shit-done', 'bin', file);
      assert.ok(fs.existsSync(fullPath), `${file} should exist on disk at ${fullPath}`);
      assert.ok(fs.statSync(fullPath).size > 0, `${file} should be non-empty`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. install-orchestrator.js — no install-hooks.js reference
// ─────────────────────────────────────────────────────────────────────────────

describe('install-orchestrator.js install-hooks.js removal (Phase 44-04 regression)', () => {
  test('source no longer references install-hooks.js anywhere', () => {
    const source = fs.readFileSync(INSTALL_ORCHESTRATOR_PATH, 'utf-8');
    assert.ok(
      !source.includes('install-hooks'),
      'install-orchestrator.js should not reference the deleted scripts/install-hooks.js'
    );
  });

  test('steps are renumbered 1-6 (not 1-7) with no leftover "7" step reference', () => {
    const source = fs.readFileSync(INSTALL_ORCHESTRATOR_PATH, 'utf-8');
    assert.ok(source.includes('/6'), 'step counters should reference a 6-step total');
    assert.ok(!source.includes('/7'), 'no step counter should still reference a 7-step total');
    assert.ok(!/7\/7/.test(source), 'no leftover "7/7" step label should remain');
  });

  test('the script still parses as valid JavaScript (node -c) after edits', () => {
    assert.doesNotThrow(() => {
      execSync(`node -c "${INSTALL_ORCHESTRATOR_PATH}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    }, 'install-orchestrator.js should be syntactically valid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. get-shit-done/modules/ removal — structural regression guard
// ─────────────────────────────────────────────────────────────────────────────

describe('get-shit-done/modules/ removal (Phase 44-04 regression)', () => {
  test('get-shit-done/modules/ directory does not exist on disk', () => {
    assert.strictEqual(fs.existsSync(MODULES_DIR), false, 'get-shit-done/modules/ should have been deleted');
  });

  const deletedModuleNames = ['circuit-breaker', 'escalation', 'feedback', 'learning', 'validator'];

  test('no tracked file (excluding .planning/ and docs/) references modules/<name>/index.js for any deleted module', () => {
    const EXCLUDED_DIR_NAMES = new Set(['.git', 'node_modules', '.planning', 'docs']);
    const patterns = deletedModuleNames.map(name => `modules/${name}/index.js`);
    const offenders = [];

    function walk(dir) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          let content;
          try {
            content = fs.readFileSync(fullPath, 'utf-8');
          } catch {
            continue; // binary or unreadable file, skip
          }
          for (const pattern of patterns) {
            if (content.includes(pattern)) {
              offenders.push({ file: fullPath, pattern });
            }
          }
        }
      }
    }

    walk(REPO_ROOT);

    assert.deepStrictEqual(
      offenders,
      [],
      `found stale references to deleted modules/<name>/index.js: ${JSON.stringify(offenders, null, 2)}`
    );
  });

  test('gsd-tools.js no longer requires ./parallel-executor.js', () => {
    const toolsPath = path.join(REPO_ROOT, 'get-shit-done', 'bin', 'gsd-tools.js');
    const source = fs.readFileSync(toolsPath, 'utf-8');
    assert.ok(
      !source.includes("require('./parallel-executor.js')") && !source.includes('require("./parallel-executor.js")'),
      'gsd-tools.js should not require the deleted parallel-executor.js'
    );
  });

  test('the 5 deleted module directories no longer exist individually', () => {
    for (const name of deletedModuleNames) {
      const dirPath = path.join(MODULES_DIR, name);
      assert.strictEqual(fs.existsSync(dirPath), false, `modules/${name}/ should not exist`);
    }
  });
});
