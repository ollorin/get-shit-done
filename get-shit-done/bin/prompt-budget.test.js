/**
 * prompt-budget.test.js — Phase 53-02 (MILE-30)
 *
 * TDD coverage for get-shit-done/bin/prompt-budget.js's pure budget
 * measurement logic. All fixtures are constructed in a temp dir per test
 * case -- these tests prove measurePreamble/checkAllBudgets discriminate
 * pass from fail, including the degradation paths (no marker, missing
 * file) that the real budget check depends on to be trustworthy.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
  measurePreamble,
  checkAllBudgets,
  CORE_PREAMBLE_MARKER,
} = require('./prompt-budget.js');

const TOOLS_PATH = path.join(__dirname, 'gsd-tools.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-prompt-budget-test-'));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

// -------------------------------------------------------------------------
describe('Phase 53-02: prompt-budget.js pure measurement functions', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkTmp();
  });

  afterEach(() => {
    rmTmp(tmpDir);
  });

  // --- measurePreamble ------------------------------------------------------
  describe('measurePreamble', () => {
    test('file WITH the marker -> only counts chars before the marker, markerPresent:true', () => {
      const filePath = path.join(tmpDir, 'with-marker.md');
      const preamble = 'x'.repeat(40); // 40 chars before marker
      const detail = 'y'.repeat(1000); // detail after marker, must NOT count
      fs.writeFileSync(filePath, `${preamble}${CORE_PREAMBLE_MARKER}${detail}`);

      const result = measurePreamble(filePath);
      assert.strictEqual(result.markerPresent, true);
      assert.strictEqual(result.charCount, 40);
      assert.strictEqual(result.estimatedTokens, Math.ceil(40 / 4));
      assert.strictEqual(result.filePath, filePath);
    });

    test('file WITHOUT the marker -> counts the whole file, markerPresent:false', () => {
      const filePath = path.join(tmpDir, 'no-marker.md');
      const content = 'z'.repeat(123);
      fs.writeFileSync(filePath, content);

      const result = measurePreamble(filePath);
      assert.strictEqual(result.markerPresent, false);
      assert.strictEqual(result.charCount, 123);
      assert.strictEqual(result.estimatedTokens, Math.ceil(123 / 4));
    });

    test('token estimate is exactly Math.ceil(charCount/4) on a deliberately-chosen char count', () => {
      const filePath = path.join(tmpDir, 'known-size.md');
      // 101 chars -> 101/4 = 25.25 -> ceil = 26 (deliberately non-divisible by 4
      // to prove ceil-rounding, not truncation, is used).
      const content = 'a'.repeat(101);
      fs.writeFileSync(filePath, content);

      const result = measurePreamble(filePath);
      assert.strictEqual(result.charCount, 101);
      assert.strictEqual(result.estimatedTokens, 26);
    });
  });

  // --- checkAllBudgets --------------------------------------------------------
  describe('checkAllBudgets', () => {
    function writeBudgetsConfig(repoRoot, budgets) {
      const configPath = path.join(repoRoot, 'budgets.json');
      fs.writeFileSync(configPath, JSON.stringify(budgets));
      return configPath;
    }

    test('every fixture file under budget -> aggregate pass:true, each result pass:true', () => {
      fs.mkdirSync(path.join(tmpDir, 'agents'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'agents', 'small-a.md'), 'a'.repeat(40)); // 10 tokens
      fs.writeFileSync(path.join(tmpDir, 'agents', 'small-b.md'), 'b'.repeat(80)); // 20 tokens

      const configPath = writeBudgetsConfig(tmpDir, {
        '_comment': 'test fixture budgets',
        'agents/small-a.md': 100,
        'agents/small-b.md': 100,
      });

      const result = checkAllBudgets(tmpDir, configPath);
      assert.strictEqual(result.pass, true);
      assert.strictEqual(result.results.length, 2);
      for (const r of result.results) {
        assert.strictEqual(r.pass, true);
      }
    });

    test('one fixture file deliberately over its configured budget -> aggregate pass:false, overage visible', () => {
      fs.mkdirSync(path.join(tmpDir, 'agents'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'agents', 'ok.md'), 'a'.repeat(40)); // 10 tokens, budget 100
      fs.writeFileSync(path.join(tmpDir, 'agents', 'over.md'), 'b'.repeat(4000)); // 1000 tokens, budget 100

      const configPath = writeBudgetsConfig(tmpDir, {
        'agents/ok.md': 100,
        'agents/over.md': 100,
      });

      const result = checkAllBudgets(tmpDir, configPath);
      assert.strictEqual(result.pass, false);

      const okResult = result.results.find(r => r.filePath === 'agents/ok.md');
      const overResult = result.results.find(r => r.filePath === 'agents/over.md');
      assert.strictEqual(okResult.pass, true);
      assert.strictEqual(overResult.pass, false);
      assert.ok(overResult.estimatedTokens > overResult.budget, 'overage must be visible: estimatedTokens > budget');
    });

    test('configured file path that does not exist on disk -> that result reports failure without throwing', () => {
      const configPath = writeBudgetsConfig(tmpDir, {
        'agents/does-not-exist.md': 100,
      });

      let result;
      assert.doesNotThrow(() => {
        result = checkAllBudgets(tmpDir, configPath);
      });
      assert.strictEqual(result.pass, false);
      assert.strictEqual(result.results.length, 1);
      assert.strictEqual(result.results[0].pass, false);
      assert.strictEqual(result.results[0].error, 'not found');
    });

    test('malformed budgets config -> reports error, does not throw, pass:false', () => {
      const configPath = path.join(tmpDir, 'malformed.json');
      fs.writeFileSync(configPath, '{ not valid json');

      let result;
      assert.doesNotThrow(() => {
        result = checkAllBudgets(tmpDir, configPath);
      });
      assert.strictEqual(result.pass, false);
      assert.ok(result.error, 'expected an error message describing the parse failure');
    });
  });

  // --- CLI integration ---------------------------------------------------------
  describe('CLI integration: gsd-tools.js budget check --raw', () => {
    function runBudgetCli(args, cwd) {
      try {
        const out = execSync(`node "${TOOLS_PATH}" ${args}`, {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { success: true, output: out.trim(), exitCode: 0 };
      } catch (err) {
        return {
          success: false,
          output: err.stdout?.toString().trim() || '',
          error: err.stderr?.toString().trim() || '',
          exitCode: err.status ?? 1,
        };
      }
    }

    test('against a temp fixture set with all files under budget -> valid JSON, pass:true, exit 0', () => {
      fs.mkdirSync(path.join(tmpDir, 'get-shit-done', 'config'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'agents'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'agents', 'tiny.md'), 'a'.repeat(40));
      fs.writeFileSync(
        path.join(tmpDir, 'get-shit-done', 'config', 'prompt-budgets.json'),
        JSON.stringify({ 'agents/tiny.md': 1000 })
      );

      const result = runBudgetCli('budget check --raw', tmpDir);
      assert.ok(result.success, `budget check should exit 0: ${result.error}`);
      assert.strictEqual(result.exitCode, 0);

      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.pass, true);
      assert.strictEqual(parsed.results[0].pass, true);
    });

    test('against a temp fixture set with one file over budget -> valid JSON, pass:false, exit 1', () => {
      fs.mkdirSync(path.join(tmpDir, 'get-shit-done', 'config'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'agents'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'agents', 'huge.md'), 'a'.repeat(4000));
      fs.writeFileSync(
        path.join(tmpDir, 'get-shit-done', 'config', 'prompt-budgets.json'),
        JSON.stringify({ 'agents/huge.md': 10 })
      );

      const result = runBudgetCli('budget check --raw', tmpDir);
      assert.strictEqual(result.success, false, 'budget check should exit non-zero when a file is over budget');
      assert.strictEqual(result.exitCode, 1);

      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.pass, false);
      assert.strictEqual(parsed.results[0].pass, false);
    });

    test('legacy `budget` cost/spend command (no `check` subcommand) is unaffected by the new dispatch', () => {
      // Sanity: bare `budget --raw` (no positional subcommand) must still
      // route to the pre-existing cost-budget command, not the new
      // prompt-budget path -- this is what makes the `check`-gated dispatch
      // non-breaking. Run against the REAL repo root (not tmpDir) since the
      // legacy path depends on the real knowledge system being reachable
      // (project scope), which tmpDir does not provide.
      const repoRoot = path.join(__dirname, '..', '..');
      const result = runBudgetCli('budget --raw', repoRoot);
      assert.ok(result.success, `legacy budget command should still exit 0: ${result.error}`);
      const parsed = JSON.parse(result.output);
      // Legacy shape: { period, spent, limit, percent, alerts_fired }.
      // Prompt-budget shape (pass/results) must NOT be what comes back here.
      assert.ok('period' in parsed, 'expected legacy cost-budget shape, not the prompt-budget shape');
      assert.ok(!('results' in parsed));
    });
  });
});
