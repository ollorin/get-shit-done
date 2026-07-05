/**
 * doc-compression-hook.test.js
 *
 * End-to-end proof that the three stacked bugs in doc-compression-hook.js are fixed:
 *
 *  Bug A: bin/install.js now deploys the repo-root hook-config.json to the exact
 *         path the hook's early-exit guard checks, but only if not already present
 *         (preserves live circuit-breaker state / user tuning across reinstalls).
 *  Bug B: the hook reads tool_name/tool_input (the real Claude Code PreToolUse
 *         protocol shape), not tool/parameters — so the Read-interception check
 *         actually engages.
 *  Bug C: the hook's three top-level requires are guarded — a missing/broken
 *         dependency fails open (stderr log + exit 0) instead of crashing.
 *
 * Every test in this file runs entirely against isolated fs.mkdtempSync() scratch
 * directories. Nothing here ever reads from or writes to the real ~/.claude/.
 *
 * To keep repeated test runs fast/offline-safe, npm install is only ever run for
 * real ONCE (in `before()`) against a shared, disposable "deps cache" directory
 * containing just the light, pure-JS packages the compression hook actually needs
 * (markdown-it, gray-matter, minimatch — no native compilation). The installer's
 * own `npm install` invocation (installHookDependencies()) is intercepted via the
 * same execSync monkey-patch technique bin/install.test.js uses, except instead of
 * a no-op we copy the pre-built cache's node_modules into the install target — so
 * the installed hook copy has REAL, working dependencies without ever hitting the
 * network more than once per test run.
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const INSTALL_JS_PATH = path.join(REPO_ROOT, 'bin', 'install.js');
const HOOK_CONFIG_SRC = path.join(REPO_ROOT, 'hook-config.json');
const HOOKS_SRC_DIR = path.join(__dirname); // get-shit-done/bin/hooks
const COMPRESSION_SRC_DIR = path.join(__dirname, '..', 'compression'); // get-shit-done/bin/compression

let mockExecSyncPath;
let depsCacheDir;

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(srcPath);
      if (fs.statSync(real).isDirectory()) {
        copyDirRecursive(real, destPath);
      } else {
        fs.copyFileSync(real, destPath);
      }
    } else if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

before(() => {
  // Build a shared, disposable node_modules containing just the light deps the
  // compression hook's require chain needs. This is the ONLY real npm install in
  // this test file — every install.js subprocess invocation below reuses it via
  // the mocked execSync (no further network calls).
  depsCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-doc-compression-deps-cache-'));
  fs.writeFileSync(
    path.join(depsCacheDir, 'package.json'),
    JSON.stringify(
      {
        name: 'gsd-hooks-test-deps-cache',
        version: '1.0.0',
        private: true,
        dependencies: {
          'markdown-it': '^14.0.0',
          'gray-matter': '^4.0.3',
          minimatch: '^9.0.0',
        },
      },
      null,
      2
    )
  );
  execSync('npm install --prefer-offline --silent', {
    cwd: depsCacheDir,
    stdio: 'pipe',
    timeout: 120000,
  });

  mockExecSyncPath = path.join(os.tmpdir(), `gsd-doc-compression-mock-execsync-${process.pid}.js`);
  fs.writeFileSync(
    mockExecSyncPath,
    `
    const cp = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const realExecSync = cp.execSync;

    function copyDir(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isSymbolicLink()) {
          const real = fs.realpathSync(s);
          if (fs.statSync(real).isDirectory()) { copyDir(real, d); } else { fs.copyFileSync(real, d); }
        } else if (entry.isDirectory()) {
          copyDir(s, d);
        } else if (entry.isFile()) {
          fs.copyFileSync(s, d);
        }
      }
    }

    cp.execSync = function (command, options) {
      if (typeof command === 'string' && command.indexOf('npm install') === 0) {
        if (process.env.GSD_TEST_MOCK_NPM_FAIL === '1') {
          throw new Error('mock npm install failure (test harness)');
        }
        const cacheDir = process.env.GSD_TEST_DEPS_CACHE_DIR;
        const cwd = (options && options.cwd) || process.cwd();
        if (cacheDir) {
          const srcModules = path.join(cacheDir, 'node_modules');
          const destModules = path.join(cwd, 'node_modules');
          if (fs.existsSync(srcModules)) {
            copyDir(srcModules, destModules);
          }
        }
        return Buffer.from('');
      }
      return realExecSync.apply(this, arguments);
    };
    `
  );
});

after(() => {
  if (mockExecSyncPath && fs.existsSync(mockExecSyncPath)) {
    fs.unlinkSync(mockExecSyncPath);
  }
  if (depsCacheDir && fs.existsSync(depsCacheDir)) {
    fs.rmSync(depsCacheDir, { recursive: true, force: true });
  }
});

function createScratchDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run install.js as a real subprocess, GLOBAL mode, with HOME overridden to a
 * scratch dir (so getGlobalDir()/os.homedir() AND config.js's hardcoded
 * process.env.HOME both resolve to the scratch dir — the plan's explicit
 * requirement for a realistic end-to-end proof).
 */
function runGlobalInstall(scratchHome, { mockNpmFail = false } = {}) {
  try {
    const output = execSync(`node --require "${mockExecSyncPath}" "${INSTALL_JS_PATH}" --global --claude 2>&1`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: scratchHome,
        GSD_TEST_MOCK_NPM_FAIL: mockNpmFail ? '1' : '0',
        GSD_TEST_DEPS_CACHE_DIR: depsCacheDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
    });
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''),
      error: err.message,
    };
  }
}

function hookConfigDestPath(scratchHome) {
  return path.join(scratchHome, '.claude', 'get-shit-done', 'hook-config.json');
}

function installedHookPath(scratchHome) {
  return path.join(scratchHome, '.claude', 'get-shit-done', 'bin', 'hooks', 'doc-compression-hook.js');
}

function metricsPath(scratchHome) {
  return path.join(scratchHome, '.claude', 'get-shit-done', 'compression-metrics.jsonl');
}

/**
 * Build a realistic, non-trivially-compressible markdown fixture: many H2
 * sections, each with a long single-paragraph body (well over the 300-char
 * preview cap), so HeaderExtractor's per-section truncation produces a real,
 * substantial (non-degenerate 0%/100%) reduction.
 */
function buildFixtureMarkdown(sectionCount = 150) {
  const lines = ['# Scratch Plan Fixture', ''];
  for (let i = 0; i < sectionCount; i++) {
    lines.push(`## Section ${i}`);
    lines.push('');
    const sentence = `This is realistic prose describing section ${i} of the scratch fixture plan, written to simulate real documentation content. `;
    lines.push(sentence.repeat(40));
    lines.push('');
  }
  return lines.join('\n');
}

function runHook(hookPath, home, payload) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: payload,
    encoding: 'utf-8',
    env: { ...process.env, HOME: home },
    timeout: 20000,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('Bug A: hook-config.json deploy-if-absent + reinstall preservation', () => {
  let scratchHome;

  beforeEach(() => {
    scratchHome = createScratchDir('gsd-doc-compression-home-');
  });

  afterEach(() => {
    cleanup(scratchHome);
  });

  test('fresh global install deploys hook-config.json to the exact guard path', () => {
    const result = runGlobalInstall(scratchHome);
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    const dest = hookConfigDestPath(scratchHome);
    assert.ok(fs.existsSync(dest), 'hook-config.json should be deployed to {HOME}/.claude/get-shit-done/hook-config.json');

    const deployed = JSON.parse(fs.readFileSync(dest, 'utf-8'));
    const source = JSON.parse(fs.readFileSync(HOOK_CONFIG_SRC, 'utf-8'));
    assert.strictEqual(deployed.enabled, source.enabled);
    assert.strictEqual(deployed.compression.enabled, source.compression.enabled);
  });

  test('reinstall does NOT overwrite an existing deployed hook-config.json (preserves live tuning)', () => {
    // Pre-seed the deploy path with a mutated config BEFORE ever running install.
    const dest = hookConfigDestPath(scratchHome);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const mutated = {
      enabled: true,
      compression: {
        enabled: true,
        strategy: 'header-extraction',
        min_file_lines: 999,
        target_reduction: 65,
        cache_ttl: 300,
        patterns: ['**/*-PLAN.md'],
        exclude: [],
        fallback: 'pass-through',
        circuit_breaker: {
          enabled: true,
          failure_threshold: 3,
          reset_timeout: 300,
          state: 'closed',
          failure_count: 0,
          last_failure: null,
          opened_at: null,
        },
      },
    };
    fs.writeFileSync(dest, JSON.stringify(mutated, null, 2));

    const result = runGlobalInstall(scratchHome);
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    const afterInstall = JSON.parse(fs.readFileSync(dest, 'utf-8'));
    assert.strictEqual(
      afterInstall.compression.min_file_lines,
      999,
      'reinstall must NOT clobber an existing hook-config.json — the deploy-if-absent guard must have skipped the copy'
    );
  });
});

describe('Bug B + real firing + metrics + passthrough', () => {
  let scratchHome;
  let hookPath;

  before(() => {
    scratchHome = createScratchDir('gsd-doc-compression-firing-');
    const result = runGlobalInstall(scratchHome);
    assert.ok(result.success, `setup install should succeed: ${result.error || ''}\n${result.output}`);
    hookPath = installedHookPath(scratchHome);
    assert.ok(fs.existsSync(hookPath), 'installed hook copy should exist after setup install');
    // Sanity: real, working deps were deployed (not just mocked no-ops)
    assert.ok(
      fs.existsSync(path.join(scratchHome, '.claude', 'get-shit-done', 'node_modules', 'minimatch')),
      'setup install should have deployed a real, working minimatch module'
    );
  });

  after(() => {
    cleanup(scratchHome);
  });

  test('a real Read payload against a 500+ line doc-pattern file fires the hook and returns a real reduction', () => {
    const fixturePath = path.join(scratchHome, 'project', 'SCRATCH-PLAN.md');
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    const content = buildFixtureMarkdown(150);
    assert.ok(content.split('\n').length >= 500, 'fixture must be 500+ lines');
    fs.writeFileSync(fixturePath, content);

    const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: fixturePath } });
    const result = runHook(hookPath, scratchHome, payload);

    assert.strictEqual(result.exitCode, 0, `hook should exit 0; stderr: ${result.stderr}`);
    assert.ok(result.stdout.trim().length > 0, 'hook should print JSON output to stdout');

    const parsed = JSON.parse(result.stdout);
    assert.ok(typeof parsed.additionalContext === 'string' && parsed.additionalContext.length > 0);
    assert.ok(
      parsed.additionalContext.length < content.length,
      'compressed additionalContext must be strictly shorter than the original file content'
    );
    assert.match(parsed.metadata.reduction, /^\d+(\.\d+)?%$/);
  });

  test('metrics file gets a non-empty entry with a real numeric reductionPercent between 0 and 100', () => {
    const mPath = metricsPath(scratchHome);
    assert.ok(fs.existsSync(mPath), 'compression-metrics.jsonl should exist after a real firing');
    const lines = fs.readFileSync(mPath, 'utf-8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'metrics file should have at least one entry');
    const last = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(typeof last.reductionPercent, 'number');
    assert.ok(last.reductionPercent > 0 && last.reductionPercent < 100, `reductionPercent should be a real, non-degenerate value, got ${last.reductionPercent}`);
  });

  test('non-Read tool passes through with no stdout output (regression)', () => {
    const fixturePath = path.join(scratchHome, 'project', 'SCRATCH-PLAN.md');
    const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: fixturePath } });
    const result = runHook(hookPath, scratchHome, payload);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), '', 'non-Read tool should produce no stdout output');
  });

  test('non-doc-pattern file passes through with no stdout output (regression)', () => {
    const otherPath = path.join(scratchHome, 'project', 'random-notes.txt');
    fs.writeFileSync(otherPath, 'x'.repeat(50000));
    const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: otherPath } });
    const result = runHook(hookPath, scratchHome, payload);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), '', 'a Read on a non-doc-pattern file should produce no stdout output');
  });
});

describe('Bug C: guarded requires fail open on a broken dependency', () => {
  let scratchCopyRoot;
  let scratchHome;

  beforeEach(() => {
    scratchCopyRoot = createScratchDir('gsd-doc-compression-broken-copy-');
    scratchHome = createScratchDir('gsd-doc-compression-broken-home-');

    // Mirror the get-shit-done/ directory shape the hook's early-exit guard
    // expects: {root}/hook-config.json, {root}/bin/hooks/*, {root}/bin/compression/*
    fs.mkdirSync(path.join(scratchCopyRoot, 'bin', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(scratchCopyRoot, 'bin', 'compression'), { recursive: true });

    copyDirRecursive(HOOKS_SRC_DIR, path.join(scratchCopyRoot, 'bin', 'hooks'));
    copyDirRecursive(COMPRESSION_SRC_DIR, path.join(scratchCopyRoot, 'bin', 'compression'));

    // Corrupt the COPY only — delete header-extractor.js so the guarded require fails.
    const brokenFile = path.join(scratchCopyRoot, 'bin', 'compression', 'header-extractor.js');
    assert.ok(fs.existsSync(brokenFile), 'fixture must have header-extractor.js before corrupting it');
    fs.unlinkSync(brokenFile);

    fs.writeFileSync(
      path.join(scratchCopyRoot, 'hook-config.json'),
      JSON.stringify({ enabled: true, compression: { enabled: true } }, null, 2)
    );
  });

  afterEach(() => {
    cleanup(scratchCopyRoot);
    cleanup(scratchHome);
  });

  test('a broken compression/header-extractor.js dependency fails open (exit 0, logged error) instead of crashing', () => {
    const brokenHookPath = path.join(scratchCopyRoot, 'bin', 'hooks', 'doc-compression-hook.js');
    const payload = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: path.join(scratchCopyRoot, 'SOMETHING-PLAN.md') },
    });
    const result = runHook(brokenHookPath, scratchHome, payload);

    assert.strictEqual(result.exitCode, 0, `hook must fail open (exit 0) on a broken dependency, got exit ${result.exitCode}; stderr: ${result.stderr}`);
    assert.match(
      result.stderr,
      /\[doc-compression-hook\] dependency load error/,
      'stderr should contain the guarded-require fail-open error message'
    );
  });
});
