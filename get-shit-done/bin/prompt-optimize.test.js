/**
 * prompt-optimize.test.js — Phase 56-01 (MILE-33)
 *
 * TDD coverage for get-shit-done/bin/prompt-optimize.js's pure,
 * deterministic core: agent-file resolution, telemetry + eval-failure
 * signal collection, template-based diagnosis synthesis, and the
 * hand-rolled unified-diff engine. Mirrors prompt-budget.test.js's
 * mkTmp/rmTmp temp-dir-per-test pattern -- every fixture is constructed
 * fresh in a real temp directory, no mocking of fs.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
  resolveAgentFile,
  readTelemetryForAgent,
  readEvalFailuresForAgent,
  hasSignal,
  buildDiagnosis,
  computeUnifiedDiff,
  isValidUnifiedDiff,
  buildRevisionCandidate,
  checkBudgetForCandidate,
  checkEvalForCandidate,
  executeEvalCandidateAgainstContent,
  writeReviewArtifacts,
  runPromptOptimize,
} = require('./prompt-optimize.js');

const { measurePreamble, measurePreambleFromContent, checkAllBudgets, CORE_PREAMBLE_MARKER } = require('./prompt-budget.js');
const { loadAcceptedEvalCandidates, runEvalRegressions } = require('./eval-harness.js');

const TOOLS_PATH = path.join(__dirname, 'gsd-tools.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-prompt-optimize-test-'));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

function writeAgentFixture(cwd, name, content) {
  const agentsDir = path.join(cwd, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const fullPath = path.join(agentsDir, name);
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function writeTelemetry(cwd, lines) {
  const telemetryDir = path.join(cwd, '.planning', 'telemetry');
  fs.mkdirSync(telemetryDir, { recursive: true });
  fs.writeFileSync(path.join(telemetryDir, 'agent-reports.jsonl'), lines.join('\n') + '\n');
}

function writeQueueCandidate(cwd, filename, candidate) {
  const queueDir = path.join(cwd, 'tests', 'eval-regressions', 'queue');
  fs.mkdirSync(queueDir, { recursive: true });
  fs.writeFileSync(path.join(queueDir, filename), typeof candidate === 'string' ? candidate : JSON.stringify(candidate));
}

function writeAcceptedCandidate(cwd, filename, candidate) {
  const acceptedDir = path.join(cwd, 'tests', 'eval-regressions', 'accepted');
  fs.mkdirSync(acceptedDir, { recursive: true });
  fs.writeFileSync(path.join(acceptedDir, filename), typeof candidate === 'string' ? candidate : JSON.stringify(candidate));
}

function writeBudgetsConfig(cwd, budgets) {
  const configDir = path.join(cwd, 'get-shit-done', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'prompt-budgets.json');
  fs.writeFileSync(configPath, JSON.stringify(budgets));
  return configPath;
}

function runPromptOptimizeCli(args, cwd) {
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
      output: err.stdout ? err.stdout.toString().trim() : '',
      error: err.stderr ? err.stderr.toString().trim() : '',
      exitCode: err.status != null ? err.status : 1,
    };
  }
}

// -------------------------------------------------------------------------
describe('Phase 56-01: prompt-optimize.js pure core functions', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkTmp();
  });

  afterEach(() => {
    rmTmp(tmpDir);
  });

  // === Happy path =========================================================
  describe('happy path', () => {
    test('resolveAgentFile resolves bare name, full name, and explicit path all to the same result', () => {
      writeAgentFixture(tmpDir, 'gsd-executor.md', '# gsd-executor\ncontent here');

      const byBare = resolveAgentFile(tmpDir, 'executor');
      const byFull = resolveAgentFile(tmpDir, 'gsd-executor');
      const byPath = resolveAgentFile(tmpDir, 'agents/gsd-executor.md');

      for (const result of [byBare, byFull, byPath]) {
        assert.strictEqual(result.agentName, 'gsd-executor');
        assert.strictEqual(result.relPath, 'agents/gsd-executor.md');
        assert.ok(!result.error, `unexpected error: ${result.error}`);
      }
    });

    test('readTelemetryForAgent returns exactly the matching entries', () => {
      writeTelemetry(tmpDir, [
        JSON.stringify({ agent: 'gsd-executor', phase: '1', timestamp: 't1' }),
        JSON.stringify({ agent: 'gsd-verifier', phase: '1', timestamp: 't2' }),
        JSON.stringify({ agent: 'gsd-executor', phase: '2', timestamp: 't3' }),
      ]);

      const result = readTelemetryForAgent(tmpDir, 'gsd-executor');
      assert.strictEqual(result.length, 2);
      assert.ok(result.every((r) => r.agent === 'gsd-executor'));
    });

    test('readEvalFailuresForAgent returns matching queue + accepted-regression failures with correct origin tags', () => {
      writeQueueCandidate(tmpDir, 'q1.json', {
        id: 'q1', source: 'debugger', created_at: '2026-01-01', title: 'gsd-executor bug',
        context: { agent: 'gsd-executor', gap_description: 'missing check' },
        expected: { type: 'file_exists', file: 'agents/gsd-executor.md' },
        status: 'pending',
      });

      writeAcceptedCandidate(tmpDir, 'a1.json', {
        id: 'a1', source: 'verifier', created_at: '2026-01-01', title: 'gsd-executor regression',
        context: { agent: 'gsd-executor' },
        expected: { type: 'file_exists', file: 'agents/does-not-exist.md' },
        status: 'accepted',
      });

      const result = readEvalFailuresForAgent(tmpDir, 'gsd-executor');
      assert.strictEqual(result.length, 2);

      const queueEntry = result.find((r) => r.origin === 'queue');
      const acceptedEntry = result.find((r) => r.origin === 'accepted-regression');
      assert.ok(queueEntry, 'expected a queue-origin entry');
      assert.ok(acceptedEntry, 'expected an accepted-regression-origin entry');
      assert.strictEqual(queueEntry.id, 'q1');
      assert.strictEqual(acceptedEntry.id, 'a1');
    });

    test('buildDiagnosis: ambiguity outranks instructions_not_followed and eval-failure for topIssue', () => {
      const telemetryEntries = [
        { agent: 'gsd-executor', instructions_not_followed: [{ rule: 'r1', why: 'did not check X' }], ambiguities: [] },
        { agent: 'gsd-executor', instructions_not_followed: [], ambiguities: ['unclear whether Y applies'] },
      ];
      const evalFailures = [{ id: 'e1', title: 'eval failure title', reason: 'assertion failed' }];

      const diagnosis = buildDiagnosis('gsd-executor', telemetryEntries, evalFailures);
      assert.strictEqual(diagnosis.topIssue, 'unclear whether Y applies');
      assert.ok(diagnosis.text.includes('# Diagnosis for gsd-executor'));
    });

    test('computeUnifiedDiff on two genuinely different multi-line strings passes isValidUnifiedDiff', () => {
      const oldContent = 'line1\nline2\nline3\n';
      const newContent = 'line1\nCHANGED\nline3\nline4\n';
      const diffText = computeUnifiedDiff('a/f.md', 'b/f.md', oldContent, newContent);
      assert.strictEqual(isValidUnifiedDiff(diffText), true);
    });

    test('measurePreambleFromContent matches measurePreamble(filePath) for identical content', () => {
      const content = 'x'.repeat(40) + CORE_PREAMBLE_MARKER + 'y'.repeat(1000);
      const filePath = path.join(tmpDir, 'fixture.md');
      fs.writeFileSync(filePath, content);

      const fromContent = measurePreambleFromContent(content);
      const fromFile = measurePreamble(filePath);

      assert.strictEqual(fromContent.estimatedTokens, fromFile.estimatedTokens);
      assert.strictEqual(fromContent.markerPresent, fromFile.markerPresent);
      assert.strictEqual(fromContent.charCount, fromFile.charCount);
    });
  });

  // === Missing/malformed input ============================================
  describe('missing/malformed input', () => {
    test('resolveAgentFile with a name matching no file returns { error } without throwing', () => {
      let result;
      assert.doesNotThrow(() => {
        result = resolveAgentFile(tmpDir, 'totally-nonexistent-agent');
      });
      assert.strictEqual(typeof result.error, 'string');
      assert.ok(result.error.length > 0);
    });

    test('readTelemetryForAgent against an absent telemetry file returns [] without throwing', () => {
      let result;
      assert.doesNotThrow(() => {
        result = readTelemetryForAgent(tmpDir, 'gsd-executor');
      });
      assert.deepStrictEqual(result, []);
    });

    test('readEvalFailuresForAgent tolerates a malformed JSON file alongside a valid match', () => {
      writeQueueCandidate(tmpDir, 'malformed.json', '{ not valid json');
      writeQueueCandidate(tmpDir, 'valid.json', {
        id: 'q-valid', source: 'debugger', created_at: '2026-01-01', title: 'gsd-executor issue',
        context: { agent: 'gsd-executor', gap_description: 'real gap' },
        expected: { type: 'file_exists', file: 'agents/gsd-executor.md' },
        status: 'pending',
      });

      let result;
      assert.doesNotThrow(() => {
        result = readEvalFailuresForAgent(tmpDir, 'gsd-executor');
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 'q-valid');
    });

    test('isValidUnifiedDiff never throws on garbage input and always returns false', () => {
      for (const garbage of [null, undefined, 123, '']) {
        let result;
        assert.doesNotThrow(() => { result = isValidUnifiedDiff(garbage); });
        assert.strictEqual(result, false);
      }
    });
  });

  // === Edge case ===========================================================
  describe('edge case', () => {
    test('buildDiagnosis with empty telemetry and empty eval failures returns well-formed fallback topIssue', () => {
      const diagnosis = buildDiagnosis('gsd-executor', [], []);
      assert.strictEqual(typeof diagnosis.text, 'string');
      assert.ok(diagnosis.text.length > 0);
      assert.strictEqual(typeof diagnosis.topIssue, 'string');
      assert.ok(diagnosis.topIssue.length > 0);
      assert.ok(diagnosis.topIssue.includes('No specific issue identified for gsd-executor'));
    });

    test('hasSignal returns false for ([],[]) and true when either array is non-empty', () => {
      assert.strictEqual(hasSignal([], []), false);
      assert.strictEqual(hasSignal([{ a: 1 }], []), true);
      assert.strictEqual(hasSignal([], [{ b: 1 }]), true);
    });

    test('buildRevisionCandidate inserts clarification BEFORE the marker when present, appends at end otherwise', () => {
      const withMarkerPath = writeAgentFixture(tmpDir, 'gsd-with-marker.md', `# preamble\n${CORE_PREAMBLE_MARKER}\ndetail section`);
      const withoutMarkerPath = writeAgentFixture(tmpDir, 'gsd-without-marker.md', '# no marker file\njust content');

      const diagnosis = { topIssue: 'some clarification text' };

      const withMarkerResult = buildRevisionCandidate(withMarkerPath, diagnosis);
      assert.ok(!withMarkerResult.error);
      const clarificationIdx = withMarkerResult.revisedContent.indexOf('some clarification text');
      const markerIdx = withMarkerResult.revisedContent.indexOf(CORE_PREAMBLE_MARKER);
      assert.ok(clarificationIdx >= 0 && markerIdx >= 0 && clarificationIdx < markerIdx);

      const withoutMarkerResult = buildRevisionCandidate(withoutMarkerPath, diagnosis);
      assert.ok(!withoutMarkerResult.error);
      assert.ok(withoutMarkerResult.revisedContent.trim().endsWith('some clarification text'));
    });
  });

  // === Boundary ============================================================
  describe('boundary', () => {
    test('resolveAgentFile does not double-prefix a bare name that already starts with gsd-', () => {
      writeAgentFixture(tmpDir, 'gsd-verifier.md', '# gsd-verifier');
      const result = resolveAgentFile(tmpDir, 'gsd-verifier');
      assert.strictEqual(result.agentName, 'gsd-verifier');
      assert.strictEqual(result.relPath, 'agents/gsd-verifier.md');
      assert.ok(!result.error);
    });

    test('substring-heuristic fallback matches title mention; explicit non-matching context.agent excludes despite title match', () => {
      writeQueueCandidate(tmpDir, 'heuristic-match.json', {
        id: 'h1', source: 'debugger', created_at: '2026-01-01', title: 'gsd-executor produced wrong output',
        context: { gap_description: 'no agent field here' },
        expected: { type: 'file_exists', file: 'agents/gsd-executor.md' },
        status: 'pending',
      });
      writeQueueCandidate(tmpDir, 'explicit-mismatch.json', {
        id: 'h2', source: 'debugger', created_at: '2026-01-01', title: 'gsd-executor mentioned here too',
        context: { agent: 'gsd-verifier', gap_description: 'belongs to a different agent' },
        expected: { type: 'file_exists', file: 'agents/gsd-executor.md' },
        status: 'pending',
      });

      const result = readEvalFailuresForAgent(tmpDir, 'gsd-executor');
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 'h1');
    });
  });

  // === Wiring/integration ==================================================
  describe('wiring/integration', () => {
    test('buildRevisionCandidate diffText reflects a real one-line insertion (both - and + content lines present)', () => {
      const fixturePath = writeAgentFixture(tmpDir, 'gsd-wired.md', `# preamble line\n${CORE_PREAMBLE_MARKER}\ndetail`);
      const diagnosis = { topIssue: 'wired clarification' };
      const result = buildRevisionCandidate(fixturePath, diagnosis);

      assert.ok(!result.error);
      assert.strictEqual(isValidUnifiedDiff(result.diffText), true);

      const lines = result.diffText.split('\n');
      const hasAddedLine = lines.some((l) => l.startsWith('+') && !l.startsWith('+++') && l.includes('wired clarification'));
      assert.ok(hasAddedLine, 'expected diffText to contain a + content line with the clarification text');
    });
  });
});

// -------------------------------------------------------------------------
describe('gating + orchestration (Phase 56-02)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkTmp();
  });

  afterEach(() => {
    rmTmp(tmpDir);
  });

  // === Happy path ==========================================================
  describe('happy path', () => {
    test('generous budget + zero-matching accepted candidate -> ready_for_review with real review-dir files on disk', () => {
      writeAgentFixture(tmpDir, 'gsd-happy.md', `# gsd-happy preamble\n${CORE_PREAMBLE_MARKER}\ndetail section`);
      writeTelemetry(tmpDir, [
        JSON.stringify({ agent: 'gsd-happy', ambiguities: ['unclear about X'] }),
      ]);
      writeBudgetsConfig(tmpDir, { 'agents/gsd-happy.md': 5000 });

      const result = runPromptOptimize(tmpDir, 'gsd-happy');

      assert.strictEqual(result.status, 'ready_for_review');
      assert.ok(result.diagnosisPath && result.diffPath, 'expected diagnosisPath/diffPath in result');

      const diagnosisFullPath = path.join(tmpDir, result.diagnosisPath);
      const diffFullPath = path.join(tmpDir, result.diffPath);
      assert.ok(fs.existsSync(diagnosisFullPath), `expected diagnosis file to exist: ${diagnosisFullPath}`);
      assert.ok(fs.existsSync(diffFullPath), `expected diff file to exist: ${diffFullPath}`);

      const diagnosisContent = fs.readFileSync(diagnosisFullPath, 'utf8');
      assert.ok(diagnosisContent.includes('Diagnosis for gsd-happy'), 'diagnosis file should contain diagnosis text');
      const diffContent = fs.readFileSync(diffFullPath, 'utf8');
      assert.strictEqual(isValidUnifiedDiff(diffContent), true, 'diff file should contain a valid unified diff');
    });

    test('checkEvalForCandidate with zero matching accepted candidates returns {pass:true, total:0, executed:[]}', () => {
      const result = checkEvalForCandidate(tmpDir, 'agents/gsd-nothing-matches.md', 'some revised content');
      assert.deepStrictEqual(result, { pass: true, total: 0, executed: [] });
    });

    test('executeEvalCandidateAgainstContent: file_exists/file_not_exists trivially pass; file_contains reflects real content', () => {
      const existsResult = executeEvalCandidateAgainstContent(
        { id: 'e1', expected: { type: 'file_exists' } }, 'agents/gsd-x.md', 'anything'
      );
      assert.strictEqual(existsResult.pass, true);

      const notExistsResult = executeEvalCandidateAgainstContent(
        { id: 'e2', expected: { type: 'file_not_exists' } }, 'agents/gsd-x.md', 'anything'
      );
      assert.strictEqual(notExistsResult.pass, true);

      const containsPass = executeEvalCandidateAgainstContent(
        { id: 'e3', expected: { type: 'file_contains', needle: 'hello' } }, 'agents/gsd-x.md', 'say hello world'
      );
      assert.strictEqual(containsPass.pass, true);

      const containsFail = executeEvalCandidateAgainstContent(
        { id: 'e4', expected: { type: 'file_contains', needle: 'missing-needle' } }, 'agents/gsd-x.md', 'say hello world'
      );
      assert.strictEqual(containsFail.pass, false);
    });

    test('writeReviewArtifacts writes both diagnosis and diff files under the expected review-dir path', () => {
      const written = writeReviewArtifacts(
        tmpDir, 'gsd-direct-write', 'ready',
        { text: '# Diagnosis for gsd-direct-write\nsome text' },
        '--- a/f.md\n+++ b/f.md\n@@ -1,1 +1,1 @@\n-old\n+new\n',
        { budgetResult: { pass: true }, evalResult: { pass: true, total: 0 } }
      );
      assert.ok(fs.existsSync(path.join(tmpDir, written.diagnosisPath)));
      assert.ok(fs.existsSync(path.join(tmpDir, written.diffPath)));
      assert.ok(written.diagnosisPath.includes('gsd-direct-write'));
    });
  });

  // === Missing/malformed input =============================================
  describe('missing/malformed input', () => {
    test('checkBudgetForCandidate against a missing prompt-budgets.json fails OPEN without throwing', () => {
      let result;
      assert.doesNotThrow(() => {
        result = checkBudgetForCandidate(tmpDir, 'agents/gsd-anything.md', 'content');
      });
      assert.strictEqual(result.pass, true);
      assert.strictEqual(typeof result.warning, 'string');
    });

    test('checkBudgetForCandidate against a malformed prompt-budgets.json fails OPEN without throwing', () => {
      const configDir = path.join(tmpDir, 'get-shit-done', 'config');
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'prompt-budgets.json');
      fs.writeFileSync(configPath, '{ not valid json');

      let result;
      assert.doesNotThrow(() => {
        result = checkBudgetForCandidate(tmpDir, 'agents/gsd-anything.md', 'content');
      });
      assert.strictEqual(result.pass, true);
      assert.strictEqual(typeof result.warning, 'string');
    });

    test('runPromptOptimize with an unresolvable agent returns {status:"error", reason} without throwing', () => {
      let result;
      assert.doesNotThrow(() => {
        result = runPromptOptimize(tmpDir, 'totally-nonexistent-agent');
      });
      assert.strictEqual(result.status, 'error');
      assert.strictEqual(typeof result.reason, 'string');
    });
  });

  // === Edge case ============================================================
  describe('edge case', () => {
    test('agent present in budgets config with NO telemetry and NO eval failures -> no_signal, nothing written', () => {
      writeAgentFixture(tmpDir, 'gsd-quiet.md', `# gsd-quiet\n${CORE_PREAMBLE_MARKER}\ndetail`);
      writeBudgetsConfig(tmpDir, { 'agents/gsd-quiet.md': 5000 });

      const result = runPromptOptimize(tmpDir, 'gsd-quiet');
      assert.strictEqual(result.status, 'no_signal');

      const reviewDir = path.join(tmpDir, '.planning', 'prompt-optimize', 'gsd-quiet');
      assert.strictEqual(fs.existsSync(reviewDir), false, 'no_signal path must write nothing to disk');
    });

    test('telemetry signal present but budget too tight for the revision -> rejected/budget_exceeded, rejected files written', () => {
      writeAgentFixture(tmpDir, 'gsd-tight.md', `# gsd-tight\n${CORE_PREAMBLE_MARKER}\ndetail`);
      writeTelemetry(tmpDir, [
        JSON.stringify({ agent: 'gsd-tight', ambiguities: ['some ambiguity'] }),
      ]);
      writeBudgetsConfig(tmpDir, { 'agents/gsd-tight.md': 1 });

      const result = runPromptOptimize(tmpDir, 'gsd-tight');
      assert.strictEqual(result.status, 'rejected');
      assert.strictEqual(result.reason, 'budget_exceeded');

      const diagnosisFullPath = path.join(tmpDir, result.diagnosisPath);
      const diffFullPath = path.join(tmpDir, result.diffPath);
      assert.ok(diagnosisFullPath.endsWith('diagnosis-rejected.md'));
      assert.ok(diffFullPath.endsWith('candidate-rejected.diff'));
      assert.ok(fs.existsSync(diagnosisFullPath), 'rejected diagnosis file must still be written for audit');
      assert.ok(fs.existsSync(diffFullPath), 'rejected diff file must still be written for audit');
    });
  });

  // === Boundary =============================================================
  describe('boundary', () => {
    test('an accepted candidate whose expected.file does not match the target agent is excluded from the matching set', () => {
      writeAcceptedCandidate(tmpDir, 'other-agent.json', {
        id: 'oa1', source: 'verifier', created_at: '2026-01-01', title: 'other agent candidate',
        context: { agent: 'gsd-other' },
        expected: { type: 'file_contains', file: 'agents/gsd-other.md', needle: 'anything' },
        status: 'accepted',
      });

      const result = checkEvalForCandidate(tmpDir, 'agents/gsd-boundary.md', 'revised content with anything present');
      assert.strictEqual(result.total, 0);
      assert.deepStrictEqual(result.executed, []);
      assert.strictEqual(result.pass, true);
    });

    test('a file_contains accepted candidate whose needle is absent -> rejected/eval_failed with a generous budget isolating the eval gate', () => {
      writeAgentFixture(tmpDir, 'gsd-eval-fail.md', `# gsd-eval-fail\n${CORE_PREAMBLE_MARKER}\ndetail`);
      writeTelemetry(tmpDir, [
        JSON.stringify({ agent: 'gsd-eval-fail', ambiguities: ['ambiguous thing'] }),
      ]);
      writeBudgetsConfig(tmpDir, { 'agents/gsd-eval-fail.md': 1000000 });
      writeAcceptedCandidate(tmpDir, 'needle-missing.json', {
        id: 'nm1', source: 'verifier', created_at: '2026-01-01', title: 'needle missing candidate',
        context: { agent: 'gsd-eval-fail' },
        expected: { type: 'file_contains', file: 'agents/gsd-eval-fail.md', needle: 'THIS_NEEDLE_DOES_NOT_EXIST_ANYWHERE' },
        status: 'accepted',
      });

      const result = runPromptOptimize(tmpDir, 'gsd-eval-fail');
      assert.strictEqual(result.status, 'rejected');
      assert.strictEqual(result.reason, 'eval_failed');
      assert.strictEqual(result.budgetResult.pass, true, 'budget gate must pass so only the eval gate is exercised');
    });
  });

  // === Wiring/integration ===================================================
  describe('wiring/integration', () => {
    test('real CLI subprocess seeded for no_signal -> exit 0, status no_signal', () => {
      writeAgentFixture(tmpDir, 'gsd-cli-quiet.md', '# gsd-cli-quiet\nno marker here');

      const result = runPromptOptimizeCli('prompt-optimize --agent gsd-cli-quiet', tmpDir);
      assert.strictEqual(result.exitCode, 0);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.status, 'no_signal');
    });

    test('real CLI subprocess seeded for a rejected (budget) outcome -> exit 1', () => {
      writeAgentFixture(tmpDir, 'gsd-cli-tight.md', `# gsd-cli-tight\n${CORE_PREAMBLE_MARKER}\ndetail`);
      writeTelemetry(tmpDir, [
        JSON.stringify({ agent: 'gsd-cli-tight', ambiguities: ['cli ambiguity'] }),
      ]);
      writeBudgetsConfig(tmpDir, { 'agents/gsd-cli-tight.md': 1 });

      const result = runPromptOptimizeCli('prompt-optimize --agent gsd-cli-tight', tmpDir);
      assert.strictEqual(result.exitCode, 1);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.status, 'rejected');
      assert.strictEqual(parsed.reason, 'budget_exceeded');
    });

    test('real CLI subprocess with no --agent -> exit 1', () => {
      const result = runPromptOptimizeCli('prompt-optimize', tmpDir);
      assert.strictEqual(result.exitCode, 1);
    });
  });

  // === Regression-guard =====================================================
  describe('regression-guard', () => {
    test('checkAllBudgets (prompt-budget.js) still returns its pre-existing shape alongside the new gating functions', () => {
      fs.mkdirSync(path.join(tmpDir, 'agents'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'agents', 'small.md'), 'a'.repeat(40));
      const configPath = writeBudgetsConfig(tmpDir, { 'agents/small.md': 100 });

      const result = checkAllBudgets(tmpDir, configPath);
      assert.strictEqual(result.pass, true);
      assert.strictEqual(result.results.length, 1);
    });

    test('runEvalRegressions (eval-harness.js) still returns its pre-existing trivial-pass shape on an absent accepted dir', () => {
      const acceptedDir = path.join(tmpDir, 'tests', 'eval-regressions', 'accepted');
      const result = runEvalRegressions(acceptedDir, tmpDir);
      assert.deepStrictEqual(result, { pass: true, total: 0, malformed: [], executed: [] });
    });

    test('loadAcceptedEvalCandidates (eval-harness.js) still returns its pre-existing shape on an absent accepted dir', () => {
      const acceptedDir = path.join(tmpDir, 'tests', 'eval-regressions', 'accepted');
      const result = loadAcceptedEvalCandidates(acceptedDir);
      assert.deepStrictEqual(result, { results: [], validCandidates: [] });
    });
  });
});
