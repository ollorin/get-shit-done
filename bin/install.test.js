/**
 * Installer Tests
 *
 * Covers the three reliability fixes made in bin/install.js:
 *  1. hooks/dist is built inline (via scripts/build-hooks.js) if missing at install time.
 *  2. PreToolUse hook commands (doc-compression, protect-managed-files) are wrapped
 *     with a POSIX `timeout` guard.
 *  3. The doc-compression hook is only registered when installHookDependencies()
 *     succeeds; a loud warning is printed otherwise instead of a silent partial
 *     registration.
 *  4. install.js is requireable for testing without triggering the interactive/
 *     global install flow (require.main === module guard).
 *
 * installHookDependencies() shells out to `npm install --prefer-offline --silent`.
 * To keep these tests fast, deterministic, and offline-safe (no network calls,
 * no native module compilation), we preload a small script via `node --require`
 * that monkey-patches child_process.execSync in the SAME process as the
 * installer CLI, before install.js's own `require('child_process')` call
 * resolves the module. This lets us simulate npm install success/failure
 * without ever running a real npm install.
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const INSTALL_JS_PATH = path.join(__dirname, 'install.js');
const REPO_ROOT = path.join(__dirname, '..');

let mockExecSyncPath;

before(() => {
  mockExecSyncPath = path.join(os.tmpdir(), `gsd-mock-execsync-${process.pid}.js`);
  fs.writeFileSync(
    mockExecSyncPath,
    `
    const cp = require('child_process');
    const realExecSync = cp.execSync;
    cp.execSync = function (command, options) {
      if (typeof command === 'string' && command.indexOf('npm install') === 0) {
        if (process.env.GSD_TEST_MOCK_NPM_FAIL === '1') {
          throw new Error('mock npm install failure (test harness)');
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
});

function createScratchDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Run install.js (or a given copy of it) as a real subprocess, entry-point style
 * (`node --require <mock> install.js --local --claude`), with npm install mocked
 * via the preloaded execSync monkey-patch.
 */
function runInstall(cwd, { mockNpmFail = false, installJsPath = INSTALL_JS_PATH } = {}) {
  try {
    // Merge stderr into stdout (2>&1) so console.warn() output (stderr) is captured
    // even on the success path -- execSync() only returns stdout by default.
    const output = execSync(
      `node --require "${mockExecSyncPath}" "${installJsPath}" --local --claude 2>&1`,
      {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, GSD_TEST_MOCK_NPM_FAIL: mockNpmFail ? '1' : '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      }
    );
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''),
      error: err.message,
    };
  }
}

function hasCompressionHook(settingsPath) {
  if (!fs.existsSync(settingsPath)) return false;
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const preToolUse = (settings.hooks && settings.hooks.PreToolUse) || [];
  return preToolUse.some(
    (entry) =>
      entry.hooks && entry.hooks.some((h) => h.command && h.command.includes('doc-compression-hook'))
  );
}

describe('installHookDependencies + compression hook gating', () => {
  let scratchDir;

  beforeEach(() => {
    scratchDir = createScratchDir('gsd-install-target-');
  });

  afterEach(() => {
    cleanup(scratchDir);
  });

  test('failed hook dependency install does NOT register compression hook, and warns loudly', () => {
    const result = runInstall(scratchDir, { mockNpmFail: true });
    assert.ok(result.success, `install should still complete overall: ${result.error || ''}\n${result.output}`);
    assert.match(
      result.output,
      /NOT registered/,
      'expected a loud warning that the compression hook was NOT registered'
    );

    const settingsPath = path.join(scratchDir, '.claude', 'settings.json');
    assert.strictEqual(
      hasCompressionHook(settingsPath),
      false,
      'compression hook must NOT be present in settings.json when hook deps failed to install'
    );
  });

  test('successful hook dependency install registers compression hook (regression)', () => {
    const result = runInstall(scratchDir, { mockNpmFail: false });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    const settingsPath = path.join(scratchDir, '.claude', 'settings.json');
    assert.strictEqual(
      hasCompressionHook(settingsPath),
      true,
      'compression hook should be registered when hook deps succeeded'
    );
  });
});

describe('wrapWithTimeout', () => {
  test('wraps a command with a 10s POSIX timeout, preserving the original command verbatim', () => {
    const { wrapWithTimeout } = require(INSTALL_JS_PATH);
    const command = 'node "/some/path/hook.js"';
    const wrapped = wrapWithTimeout(command);

    if (process.platform === 'win32') {
      assert.strictEqual(wrapped, command, 'on win32 the command should be left unwrapped');
    } else {
      assert.ok(
        wrapped.startsWith('timeout 10s '),
        `expected wrapped command to start with "timeout 10s ", got: ${wrapped}`
      );
      assert.ok(wrapped.includes(command), 'original command should be present verbatim inside the wrapped string');
    }
  });
});

describe('Stop hook timeout wrap and per-turn.js removal', () => {
  test('per-turn.js no longer exists on disk (permanent-absence regression guard)', () => {
    const perTurnPath = path.join(REPO_ROOT, 'get-shit-done', 'bin', 'hooks', 'per-turn.js');
    assert.strictEqual(fs.existsSync(perTurnPath), false, 'get-shit-done/bin/hooks/per-turn.js should be permanently deleted');
  });

  test('a repo-wide grep for per-turn / perTurnHook / createPerTurnMiddleware returns zero matches (outside this permanent-absence guard test itself)', () => {
    let output = '';
    try {
      output = execSync(
        'grep -rln "per-turn\\|perTurnHook\\|createPerTurnMiddleware" bin/ get-shit-done/ agents/ commands/ scripts/ hooks/ 2>/dev/null',
        { cwd: REPO_ROOT, encoding: 'utf-8' }
      );
    } catch (err) {
      // grep exits 1 when there are no matches at all — that's the expected clean state.
      if (err.status === 1) {
        output = err.stdout ? err.stdout.toString() : '';
      } else {
        throw err;
      }
    }
    const matchingFiles = output
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      // This test file itself legitimately contains these strings as part of the
      // permanent-absence assertion — exclude it, not any real production reference.
      .filter((f) => path.resolve(REPO_ROOT, f) !== path.resolve(__filename));
    assert.deepStrictEqual(matchingFiles, [], `expected zero references to per-turn.js outside this test file, got:\n${matchingFiles.join('\n')}`);
  });

  let scratchDir;

  beforeEach(() => {
    scratchDir = createScratchDir('gsd-install-target-');
  });

  afterEach(() => {
    cleanup(scratchDir);
  });

  test('Stop hook command is timeout-wrapped and still targets session-end-standalone.js', () => {
    const result = runInstall(scratchDir, { mockNpmFail: false });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    const settingsPath = path.join(scratchDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const stopHooks = (settings.hooks && settings.hooks.Stop) || [];
    const sessionEndEntry = stopHooks.find(
      (entry) => entry.hooks && entry.hooks.some((h) => h.command && h.command.includes('session-end-standalone'))
    );
    assert.ok(sessionEndEntry, 'Stop hook registration for session-end-standalone.js should exist');
    const sessionEndCommand = sessionEndEntry.hooks.find((h) => h.command && h.command.includes('session-end-standalone')).command;

    if (process.platform === 'win32') {
      assert.ok(sessionEndCommand.includes('session-end-standalone'), 'command should still reference session-end-standalone.js on win32 (no wrap)');
    } else {
      assert.ok(
        sessionEndCommand.startsWith('timeout 10s '),
        `expected Stop hook command to start with "timeout 10s ", got: ${sessionEndCommand}`
      );
      assert.ok(sessionEndCommand.includes('session-end-standalone'), 'wrapped command should still reference session-end-standalone.js');
    }
  });

  test('the Stop hook timeout prefix is byte-identical in shape to the PreToolUse Write/Edit protect-managed-files hook wrap (one shared wrapWithTimeout(), not a second bespoke mechanism)', () => {
    const result = runInstall(scratchDir, { mockNpmFail: false });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    if (process.platform === 'win32') {
      return; // wrapWithTimeout is a no-op on win32 -- nothing to compare
    }

    const settingsPath = path.join(scratchDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    const stopHooks = (settings.hooks && settings.hooks.Stop) || [];
    const sessionEndCommand = stopHooks
      .flatMap((entry) => entry.hooks || [])
      .find((h) => h.command && h.command.includes('session-end-standalone')).command;

    const preToolUseHooks = (settings.hooks && settings.hooks.PreToolUse) || [];
    const protectCommand = preToolUseHooks
      .flatMap((entry) => entry.hooks || [])
      .find((h) => h.command && h.command.includes('gsd-protect-managed-files')).command;

    const timeoutPrefixPattern = /^timeout \d+s /;
    const sessionEndMatch = sessionEndCommand.match(timeoutPrefixPattern);
    const protectMatch = protectCommand.match(timeoutPrefixPattern);

    assert.ok(sessionEndMatch, `Stop hook command should carry a "timeout Ns " prefix, got: ${sessionEndCommand}`);
    assert.ok(protectMatch, `protect-managed-files command should carry a "timeout Ns " prefix, got: ${protectCommand}`);
    assert.strictEqual(
      sessionEndMatch[0],
      protectMatch[0],
      'the Stop hook and the PreToolUse protect-managed-files hook should share the exact same timeout prefix (same seconds value, same shape) -- proving one shared wrapWithTimeout() helper was reused, not a second bespoke wrapping mechanism'
    );
  });
});

describe('missing hooks/dist build-if-missing', () => {
  let scratchRepo;
  let scratchTarget;

  beforeEach(() => {
    // Build an isolated copy of the repo's install-relevant directories WITHOUT
    // ever creating hooks/dist, so install.js sees a genuinely missing dist dir
    // — proving the build-if-missing path, not just inspecting the diff.
    scratchRepo = createScratchDir('gsd-repo-copy-');

    fs.mkdirSync(path.join(scratchRepo, 'hooks'), { recursive: true });
    for (const hookFile of ['gsd-check-update.js', 'gsd-statusline.js']) {
      fs.copyFileSync(
        path.join(REPO_ROOT, 'hooks', hookFile),
        path.join(scratchRepo, 'hooks', hookFile)
      );
    }
    copyDirRecursive(path.join(REPO_ROOT, 'bin'), path.join(scratchRepo, 'bin'));
    copyDirRecursive(path.join(REPO_ROOT, 'scripts'), path.join(scratchRepo, 'scripts'));
    copyDirRecursive(path.join(REPO_ROOT, 'commands'), path.join(scratchRepo, 'commands'));
    copyDirRecursive(path.join(REPO_ROOT, 'get-shit-done'), path.join(scratchRepo, 'get-shit-done'));
    copyDirRecursive(path.join(REPO_ROOT, 'agents'), path.join(scratchRepo, 'agents'));
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(scratchRepo, 'package.json'));
    if (fs.existsSync(path.join(REPO_ROOT, 'CHANGELOG.md'))) {
      fs.copyFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), path.join(scratchRepo, 'CHANGELOG.md'));
    }

    scratchTarget = createScratchDir('gsd-install-target-');
  });

  afterEach(() => {
    cleanup(scratchRepo);
    cleanup(scratchTarget);
  });

  test('missing hooks/dist triggers an inline build and hooks still get installed', () => {
    const scratchInstallJs = path.join(scratchRepo, 'bin', 'install.js');
    assert.strictEqual(
      fs.existsSync(path.join(scratchRepo, 'hooks', 'dist')),
      false,
      'fixture must not have a pre-built hooks/dist (that is the scenario under test)'
    );

    const result = runInstall(scratchTarget, { mockNpmFail: false, installJsPath: scratchInstallJs });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    assert.ok(
      fs.existsSync(path.join(scratchRepo, 'hooks', 'dist', 'gsd-check-update.js')),
      'hooks/dist should have been built inline by build-hooks.js'
    );
    assert.ok(
      fs.existsSync(path.join(scratchTarget, '.claude', 'hooks', 'gsd-check-update.js')),
      'hooks should still have been copied into the install target after the inline build'
    );
  });
});

describe('require.main === module guard', () => {
  test('requiring install.js does not print the interactive banner or --help text', () => {
    const escapedPath = INSTALL_JS_PATH.replace(/\\/g, '\\\\');
    const output = execSync(`node -e "require('${escapedPath}')"`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    assert.strictEqual(
      output.trim(),
      '',
      'requiring install.js should produce no stdout (no banner, no help text, no install side effects)'
    );
  });

  test('requiring install.js exports installHookDependencies and wrapWithTimeout', () => {
    const mod = require(INSTALL_JS_PATH);
    assert.strictEqual(typeof mod.installHookDependencies, 'function');
    assert.strictEqual(typeof mod.wrapWithTimeout, 'function');
  });
});

describe('Phase 52-01: writeManifest source_git_sha capture', () => {
  const { writeManifest } = require(INSTALL_JS_PATH);
  let scratchConfigDir;

  beforeEach(() => {
    scratchConfigDir = createScratchDir('gsd-manifest-config-');
  });

  afterEach(() => {
    cleanup(scratchConfigDir);
  });

  test('writes a non-null source_git_sha string when sourceRepoPath is a real git repo', () => {
    // This repo's own root is a real git repo -- a solid fixture cwd.
    const manifest = writeManifest(scratchConfigDir, REPO_ROOT);
    assert.strictEqual(typeof manifest.source_git_sha, 'string');
    assert.ok(manifest.source_git_sha.length > 0, 'source_git_sha should be a non-empty string');
    assert.strictEqual(manifest.source_repo_path, REPO_ROOT);

    const written = JSON.parse(fs.readFileSync(path.join(scratchConfigDir, 'gsd-file-manifest.json'), 'utf-8'));
    assert.strictEqual(written.source_git_sha, manifest.source_git_sha);
    assert.strictEqual(written.source_repo_path, REPO_ROOT);
  });

  test('writes source_git_sha: null when sourceRepoPath is a plain non-repo tmp dir', () => {
    const nonRepoDir = createScratchDir('gsd-nonrepo-');
    try {
      const manifest = writeManifest(scratchConfigDir, nonRepoDir);
      assert.strictEqual(manifest.source_git_sha, null);
      assert.strictEqual(manifest.source_repo_path, nonRepoDir);
    } finally {
      cleanup(nonRepoDir);
    }
  });

  test('never throws regardless of sourceRepoPath validity', () => {
    assert.doesNotThrow(() => writeManifest(scratchConfigDir, REPO_ROOT));
    const nonRepoDir = createScratchDir('gsd-nonrepo-');
    try {
      assert.doesNotThrow(() => writeManifest(scratchConfigDir, nonRepoDir));
    } finally {
      cleanup(nonRepoDir);
    }
    assert.doesNotThrow(() => writeManifest(scratchConfigDir, null));
    assert.doesNotThrow(() => writeManifest(scratchConfigDir));
  });
});
