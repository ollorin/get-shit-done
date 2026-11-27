/**
 * Installer Tests
 *
 * Covers the three reliability fixes made in bin/install.js:
 *  1. hooks/dist is built inline (via scripts/build-hooks.js) if missing at install time.
 *  2. PreToolUse hook commands (doc-compression, protect-managed-files) are wrapped
 *     with a POSIX `timeout` guard.
 *  3. gsd-check-update and the doc-compression hook are no longer registered
 *     (09-hooks-audit RULING R4).
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

describe('check-update and doc-compression hooks are no longer registered (RULING R4)', () => {
  let scratchDir;

  beforeEach(() => {
    scratchDir = createScratchDir('gsd-install-target-');
  });

  afterEach(() => {
    cleanup(scratchDir);
  });

  function allCommands(settings) {
    return Object.values(settings.hooks || {})
      .flat()
      .flatMap((entry) => (entry.hooks || []).map((h) => h.command || ''));
  }

  for (const mockNpmFail of [false, true]) {
    test(`fresh install (npm ${mockNpmFail ? 'fails' : 'ok'}) registers no check-update / doc-compression, keeps protect, charlotte-lock, session-end`, () => {
      const result = runInstall(scratchDir, { mockNpmFail });
      assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);
      const settingsPath = path.join(scratchDir, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const cmds = allCommands(settings);
      assert.ok(!cmds.some((c) => c.includes('gsd-check-update')), 'gsd-check-update must not be registered');
      assert.ok(!cmds.some((c) => c.includes('doc-compression-hook')), 'doc-compression-hook must not be registered');
      assert.strictEqual(hasCompressionHook(settingsPath), false);
      assert.ok(!(settings.hooks.SessionStart || []).length, 'no SessionStart entries expected');
      for (const needle of ['gsd-protect-managed-files', 'gsd-ui-qa-lock', 'session-end-standalone']) {
        assert.ok(cmds.some((c) => c.includes(needle)), `${needle} must still be registered`);
      }
      assert.ok(!cmds.some((c) => c.includes('gsd-guard-bash')), 'gsd-guard-bash stays unregistered');
    });
  }

  test('reinstall does not delete a pre-existing user entry and does not add duplicates', () => {
    const claudeDir = path.join(scratchDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const userEntry = { hooks: [{ type: 'command', command: 'node "/u/hooks/gsd-check-update.js"' }] };
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [userEntry] } }));
    const result = runInstall(scratchDir);
    assert.ok(result.success, result.output);
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
    assert.deepStrictEqual(settings.hooks.SessionStart, [userEntry]);
  });
});

describe('wrapWithTimeout', () => {
  const { wrapWithTimeout, resolveTimeoutBinary, rewrapGsdHookCommands } = require(INSTALL_JS_PATH);
  const command = 'node "/some/path/hook.js"';

  test('wraps with the resolved absolute timeout binary, preserving the command verbatim', () => {
    assert.strictEqual(wrapWithTimeout(command, 10, '/opt/bin/gtimeout'), `"/opt/bin/gtimeout" 10s ${command}`);
  });

  test('negative: no timeout binary -> command left bare (never a wrapper that exits 127)', () => {
    assert.strictEqual(wrapWithTimeout(command, 10, null), command);
  });

  test('resolveTimeoutBinary only returns an executable found on PATH', () => {
    if (process.platform === 'win32') return;
    const dir = createScratchDir('gsd-timeout-bin-');
    try {
      assert.strictEqual(resolveTimeoutBinary(dir), null);
      fs.writeFileSync(path.join(dir, 'gtimeout'), '#!/bin/sh\n', { mode: 0o755 });
      assert.strictEqual(resolveTimeoutBinary(dir), path.join(dir, 'gtimeout'));
    } finally {
      cleanup(dir);
    }
  });

  test('rewrapGsdHookCommands repairs legacy "timeout 10s" GSD entries and leaves foreign hooks alone', () => {
    const settings = { hooks: { PreToolUse: [
      { matcher: 'Write', hooks: [{ type: 'command', command: 'timeout 10s node "/h/.claude/get-shit-done/bin/hooks/gsd-protect-managed-files.js"' }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'timeout 5s /h/.claude/hooks/other.sh' }] },
    ] } };
    rewrapGsdHookCommands(settings, c => c);
    assert.strictEqual(settings.hooks.PreToolUse[0].hooks[0].command, 'node "/h/.claude/get-shit-done/bin/hooks/gsd-protect-managed-files.js"');
    assert.strictEqual(settings.hooks.PreToolUse[1].hooks[0].command, 'timeout 5s /h/.claude/hooks/other.sh');
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
      const { wrapWithTimeout } = require(INSTALL_JS_PATH);
      assert.strictEqual(
        sessionEndCommand,
        wrapWithTimeout(sessionEndCommand.slice(sessionEndCommand.indexOf('node '))),
        `Stop hook command should use the shared wrapper, got: ${sessionEndCommand}`
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

    const { resolveTimeoutBinary } = require(INSTALL_JS_PATH);
    const bin = resolveTimeoutBinary();
    const expectedPrefix = bin ? `"${bin}" 10s ` : '';
    const prefixOf = c => c.slice(0, c.indexOf('node '));

    assert.strictEqual(prefixOf(sessionEndCommand), expectedPrefix, `Stop hook prefix, got: ${sessionEndCommand}`);
    assert.strictEqual(
      prefixOf(sessionEndCommand),
      prefixOf(protectCommand),
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

describe('skills/ installation (retired skills)', () => {
  let scratchRepo;
  let scratchTarget;

  beforeEach(() => {
    // Full scratch repo copy, including skills/ this time (the earlier
    // "missing hooks/dist" describe block above deliberately omits skills/ --
    // it is testing an unrelated code path). hooks/ is copied whole (dist
    // included) so this test exercises ONLY the skills copy step, not the
    // inline hooks/dist build fallback.
    scratchRepo = createScratchDir('gsd-repo-copy-skills-');
    copyDirRecursive(path.join(REPO_ROOT, 'hooks'), path.join(scratchRepo, 'hooks'));
    copyDirRecursive(path.join(REPO_ROOT, 'bin'), path.join(scratchRepo, 'bin'));
    copyDirRecursive(path.join(REPO_ROOT, 'scripts'), path.join(scratchRepo, 'scripts'));
    copyDirRecursive(path.join(REPO_ROOT, 'commands'), path.join(scratchRepo, 'commands'));
    copyDirRecursive(path.join(REPO_ROOT, 'get-shit-done'), path.join(scratchRepo, 'get-shit-done'));
    copyDirRecursive(path.join(REPO_ROOT, 'agents'), path.join(scratchRepo, 'agents'));
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(scratchRepo, 'package.json'));
    if (fs.existsSync(path.join(REPO_ROOT, 'CHANGELOG.md'))) {
      fs.copyFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), path.join(scratchRepo, 'CHANGELOG.md'));
    }

    scratchTarget = createScratchDir('gsd-install-target-skills-');
  });

  afterEach(() => {
    cleanup(scratchRepo);
    cleanup(scratchTarget);
  });

  test('install removes the retired task-context skill from an existing install and keeps sibling skills', () => {
    const retired = path.join(scratchTarget, '.claude', 'skills', 'task-context');
    const sibling = path.join(scratchTarget, '.claude', 'skills', 'unrelated-skill');
    fs.mkdirSync(retired, { recursive: true });
    fs.writeFileSync(path.join(retired, 'SKILL.md'), 'old');
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'learned-state.md'), 'do-not-delete-me');

    const scratchInstallJs = path.join(scratchRepo, 'bin', 'install.js');
    const result = runInstall(scratchTarget, { installJsPath: scratchInstallJs });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    assert.ok(!fs.existsSync(retired), 'the retired skill must be removed from an existing install');
    assert.strictEqual(fs.readFileSync(path.join(sibling, 'learned-state.md'), 'utf-8'), 'do-not-delete-me');
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'skills', 'task-context')), 'the repo no longer ships the skill');
  });

  test('install ships the unattended-run files: auto-mode and watchdogs references, task-routing, the two dispatcher modules', () => {
    const scratchInstallJs = path.join(scratchRepo, 'bin', 'install.js');
    const result = runInstall(scratchTarget, { installJsPath: scratchInstallJs });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);
    for (const rel of [
      'references/auto-mode.md', 'references/watchdogs.md', 'references/task-routing.md', 'references/coordinator-detail.md',
      'bin/auto-mode.js', 'bin/roadmap-dispatch.js',
    ]) {
      assert.ok(fs.existsSync(path.join(scratchTarget, '.claude', 'get-shit-done', rel)), `installed output lacks get-shit-done/${rel}`);
    }
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

describe('UI-QA lock hook registration', () => {
  let scratchDir;
  beforeEach(() => { scratchDir = createScratchDir('gsd-install-charlotte-'); });
  afterEach(() => cleanup(scratchDir));

  function lockEntries(settings) {
    const out = [];
    for (const [event, entries] of Object.entries(settings.hooks || {})) {
      for (const entry of entries) {
        if (entry.hooks && entry.hooks.some(h => h.command && /gsd-charlotte-lock|gsd-ui-qa-lock/.test(h.command))) {
          out.push(`${event}:${entry.matcher ?? ''}`);
        }
      }
    }
    return out.sort();
  }

  test('negative: a stale lock entry under a renamed matcher is removed on reinstall', () => {
    const claudeDir = path.join(scratchDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [
      { matcher: 'mcp__charlotte_old__.*', hooks: [{ type: 'command', command: 'node "/x/get-shit-done/bin/hooks/gsd-charlotte-lock.js"' }] },
    ] } }));
    const result = runInstall(scratchDir);
    assert.ok(result.success, result.output);
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
    assert.ok(!lockEntries(settings).includes('PreToolUse:mcp__charlotte_old__.*'), JSON.stringify(lockEntries(settings)));
  });

  test('registers MCP, Bash, SubagentStart and SubagentStop entries exactly once, idempotently', () => {
    const expected = ['PreToolUse:Bash', 'PreToolUse:mcp__.*', 'SubagentStart:', 'SubagentStop:'];
    for (let i = 0; i < 2; i++) {
      const result = runInstall(scratchDir);
      assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);
      const settings = JSON.parse(fs.readFileSync(path.join(scratchDir, '.claude', 'settings.json'), 'utf-8'));
      assert.deepStrictEqual(lockEntries(settings), expected, `run ${i + 1}`);
    }
    assert.ok(fs.existsSync(path.join(scratchDir, '.claude', 'get-shit-done', 'bin', 'hooks', 'gsd-ui-qa-lock.js')), 'hook file must be deployed');
  });

  test('L-d a local install whose project declares capabilities without ui_qa registers no lock entry', () => {
    fs.mkdirSync(path.join(scratchDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(scratchDir, '.planning', 'config.json'), JSON.stringify({ stack: { capabilities: { backend: {} } } }));
    const result = runInstall(scratchDir);
    assert.ok(result.success, result.output);
    const settings = JSON.parse(fs.readFileSync(path.join(scratchDir, '.claude', 'settings.json'), 'utf-8'));
    assert.deepStrictEqual(lockEntries(settings), []);
  });

  test('L-f an upgrade from the old four entries leaves none under the old name and the four new ones', () => {
    const claudeDir = path.join(scratchDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const oldCommand = 'node "/x/get-shit-done/bin/hooks/gsd-charlotte-lock.js"';
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ hooks: {
      PreToolUse: [
        { matcher: 'mcp__charlotte__.*', hooks: [{ type: 'command', command: oldCommand }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: oldCommand }] },
      ],
      SubagentStart: [{ matcher: 'gsd-charlotte-qa', hooks: [{ type: 'command', command: oldCommand }] }],
      SubagentStop: [{ matcher: 'gsd-charlotte-qa', hooks: [{ type: 'command', command: oldCommand }] }],
    } }));
    const result = runInstall(scratchDir);
    assert.ok(result.success, result.output);
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
    const commands = Object.values(settings.hooks || {}).flat().flatMap((entry) => (entry.hooks || []).map((h) => h.command || ''));
    assert.strictEqual(commands.filter(c => c.includes('gsd-charlotte-lock')).length, 0);
    assert.strictEqual(commands.filter(c => c.includes('gsd-ui-qa-lock')).length, 4);
    assert.deepStrictEqual(lockEntries(settings), ['PreToolUse:Bash', 'PreToolUse:mcp__.*', 'SubagentStart:', 'SubagentStop:']);
  });
});

describe('protect-managed-files hook covers Bash', () => {
  let scratchDir;
  beforeEach(() => { scratchDir = createScratchDir('gsd-install-protect-'); });
  afterEach(() => cleanup(scratchDir));

  test('registers Write, Edit and Bash matchers exactly once each, idempotently', () => {
    for (let i = 0; i < 2; i++) {
      const result = runInstall(scratchDir);
      assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);
      const settings = JSON.parse(fs.readFileSync(path.join(scratchDir, '.claude', 'settings.json'), 'utf-8'));
      const matchers = settings.hooks.PreToolUse
        .filter(e => e.hooks && e.hooks.some(h => h.command && h.command.includes('gsd-protect-managed-files')))
        .map(e => e.matcher)
        .sort();
      assert.deepStrictEqual(matchers, ['Bash', 'Edit', 'Write'], `run ${i + 1}`);
    }
  });
});

describe('registered hook commands actually execute', () => {
  let scratchDir;
  beforeEach(() => { scratchDir = createScratchDir('gsd-install-exec-'); });
  afterEach(() => cleanup(scratchDir));

  test('the installed protect-managed-files command string blocks a settings.json Write with exit 2 (not 127)', () => {
    if (process.platform === 'win32') return;
    const result = runInstall(scratchDir);
    assert.ok(result.success, result.output);
    const settings = JSON.parse(fs.readFileSync(path.join(scratchDir, '.claude', 'settings.json'), 'utf-8'));
    const command = settings.hooks.PreToolUse
      .filter(e => e.matcher === 'Write')
      .flatMap(e => e.hooks)
      .find(h => h.command.includes('gsd-protect-managed-files')).command;
    const r = require('child_process').spawnSync('/bin/sh', ['-c', command], {
      cwd: scratchDir,
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/repo/.claude/settings.json' } }),
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 2, `registered command must run and block: ${command}\n${r.stderr}`);
  });
});

describe('pruneIdenticalPatches: a backup identical to the fresh install is not a local patch', () => {
  const { pruneIdenticalPatches } = require('./install.js');
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-prune-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function seed(files, backups) {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    const pd = path.join(dir, 'gsd-local-patches');
    for (const [rel, content] of Object.entries(backups)) {
      fs.mkdirSync(path.dirname(path.join(pd, rel)), { recursive: true });
      fs.writeFileSync(path.join(pd, rel), content);
    }
    fs.writeFileSync(path.join(pd, 'backup-meta.json'), JSON.stringify({ from_version: '1', files: Object.keys(backups) }));
    return pd;
  }

  test('drops identical and missing backups, keeps a real difference', () => {
    const pd = seed({ 'agents/a.md': 'same', 'agents/b.md': 'new', 'agents/c.md': 'x' }, { 'agents/a.md': 'same', 'agents/b.md': 'old', 'agents/gone.md': 'orphan' });
    fs.unlinkSync(path.join(pd, 'agents/gone.md'));
    pruneIdenticalPatches(dir);
    assert.ok(!fs.existsSync(path.join(pd, 'agents/a.md')), 'identical backup removed');
    assert.ok(fs.existsSync(path.join(pd, 'agents/b.md')), 'real difference kept');
    const meta = JSON.parse(fs.readFileSync(path.join(pd, 'backup-meta.json'), 'utf8'));
    assert.deepStrictEqual(meta.files, ['agents/b.md']);
  });

  test('removes the meta file when nothing remains', () => {
    const pd = seed({ 'agents/a.md': 'same' }, { 'agents/a.md': 'same' });
    pruneIdenticalPatches(dir);
    assert.ok(!fs.existsSync(path.join(pd, 'backup-meta.json')));
  });
});

describe('presets/ is copied byte-for-byte (agnostic-B1)', () => {
  const MD =
    '~/.claude/get-shit-done/x.md\n\nCo-Authored-By: Someone <someone@example.com>\n';
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = createScratchDir('gsd-presets-verbatim-');
  });

  afterEach(() => {
    cleanup(tmpRoot);
  });

  function listFiles(dir, rel = '') {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      return e.isDirectory() ? listFiles(path.join(dir, e.name), r) : [r];
    });
  }

  function writeTree(root, files) {
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
  }

  test('presets/ files survive copyWithPathReplacement byte-equal while other .md files are rewritten', () => {
    const { copyWithPathReplacement } = require(INSTALL_JS_PATH);
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    writeTree(src, {
      'a.md': MD,
      'presets/demo/CLAUDE.md': MD,
      'presets/demo/nested/r.md': MD,
      'presets/demo/h.js': 'module.exports = 1;\n',
    });
    copyWithPathReplacement(src, dest, './.claude/', 'claude', { verbatimDirs: ['presets'] });

    const aOut = fs.readFileSync(path.join(dest, 'a.md'), 'utf8');
    assert.ok(aOut.includes('./.claude/get-shit-done/x.md'), 'top-level .md is path-rewritten');
    assert.ok(!aOut.includes('~/.claude/'), 'top-level .md has no ~/.claude/ left');
    for (const rel of ['presets/demo/CLAUDE.md', 'presets/demo/nested/r.md', 'presets/demo/h.js']) {
      assert.ok(
        fs.readFileSync(path.join(dest, rel)).equals(fs.readFileSync(path.join(src, rel))),
        `${rel} must be byte-equal to its source`
      );
    }
  });

  test('verbatimDirs is top-level only: default call rewrites presets/, nested presets/ dirs are rewritten under the option', () => {
    const { copyWithPathReplacement } = require(INSTALL_JS_PATH);
    const src = path.join(tmpRoot, 'src');
    writeTree(src, {
      'presets/demo/CLAUDE.md': MD,
      'sub/presets/x.md': MD,
    });

    const defaultDest = path.join(tmpRoot, 'dest-default');
    copyWithPathReplacement(src, defaultDest, './.claude/', 'claude');
    const defaultOut = fs.readFileSync(path.join(defaultDest, 'presets/demo/CLAUDE.md'), 'utf8');
    assert.ok(!defaultOut.includes('~/.claude/'), 'without the option presets/ is rewritten as before');

    const optDest = path.join(tmpRoot, 'dest-opt');
    copyWithPathReplacement(src, optDest, './.claude/', 'claude', { verbatimDirs: ['presets'] });
    const nestedOut = fs.readFileSync(path.join(optDest, 'sub/presets/x.md'), 'utf8');
    assert.ok(!nestedOut.includes('~/.claude/'), 'a nested presets/ directory is not verbatim: still rewritten');
    assert.ok(nestedOut.includes('./.claude/get-shit-done/x.md'));
  });

  test('gemini runtime: presets/ keeps its .md file and creates no .toml anywhere', () => {
    const { copyWithPathReplacement } = require(INSTALL_JS_PATH);
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    writeTree(src, { 'presets/demo/CLAUDE.md': MD });
    copyWithPathReplacement(src, dest, './.gemini/', 'gemini', { verbatimDirs: ['presets'] });

    assert.ok(
      fs.readFileSync(path.join(dest, 'presets/demo/CLAUDE.md')).equals(fs.readFileSync(path.join(src, 'presets/demo/CLAUDE.md'))),
      'gemini presets/demo/CLAUDE.md must be byte-equal to its source'
    );
    assert.deepStrictEqual(
      listFiles(dest).filter((f) => f.endsWith('.toml')),
      [],
      'no .toml file may be produced under dest'
    );
  });

  test('CLI install copies get-shit-done/presets/ byte-for-byte and records its sha256 in the manifest', () => {
    const scratchRepo = createScratchDir('gsd-repo-copy-presets-');
    const scratchTarget = createScratchDir('gsd-install-target-presets-');
    try {
      for (const d of ['hooks', 'bin', 'scripts', 'commands', 'get-shit-done', 'agents']) {
        copyDirRecursive(path.join(REPO_ROOT, d), path.join(scratchRepo, d));
      }
      fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(scratchRepo, 'package.json'));
      if (fs.existsSync(path.join(REPO_ROOT, 'CHANGELOG.md'))) {
        fs.copyFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), path.join(scratchRepo, 'CHANGELOG.md'));
      }
      const presetSrc = path.join(scratchRepo, 'get-shit-done', 'presets', 'demo', 'CLAUDE.md');
      writeTree(path.join(scratchRepo, 'get-shit-done'), { 'presets/demo/CLAUDE.md': MD });

      const result = runInstall(scratchTarget, { installJsPath: path.join(scratchRepo, 'bin', 'install.js') });
      assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

      const installed = path.join(scratchTarget, '.claude', 'get-shit-done', 'presets', 'demo', 'CLAUDE.md');
      assert.ok(fs.readFileSync(installed).equals(fs.readFileSync(presetSrc)), 'installed preset must be byte-equal to source');

      const manifest = JSON.parse(fs.readFileSync(path.join(scratchTarget, '.claude', 'gsd-file-manifest.json'), 'utf8'));
      const expected = require('crypto').createHash('sha256').update(fs.readFileSync(presetSrc)).digest('hex');
      assert.strictEqual(manifest.files['get-shit-done/presets/demo/CLAUDE.md'], expected);
    } finally {
      cleanup(scratchRepo);
      cleanup(scratchTarget);
    }
  });
});

describe('driver-neutral UI QA agent ships globally; the old name is a pack alias', () => {
  test('gsd-ui-qa.md is in agents/ with both drivers allowed, and the lock hook name carries no driver', () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'agents', 'gsd-ui-qa.md'), 'utf8');
    assert.match(text, /^name: gsd-ui-qa$/m);
    const tools = text.match(/^tools: (.*)$/m)[1].split(', ');
    assert.ok(tools.includes('mcp__charlotte__charlotte_navigate') && tools.includes('mcp__bladebro__act'));
    assert.deepStrictEqual(tools.filter((t) => t.endsWith('__*')), [], 'no wildcard driver grants');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'get-shit-done', 'bin', 'hooks', 'gsd-ui-qa-lock.js')));
  });
});

describe('UI QA driver agent ships as a pack file, not a global agent (agnostic-M-02 2.4)', () => {
  test('gsd-charlotte-qa.md is absent from agents/ and present in the charlotte pack', () => {
    assert.strictEqual(fs.existsSync(path.join(REPO_ROOT, 'agents', 'gsd-charlotte-qa.md')), false);
    assert.strictEqual(
      fs.existsSync(path.join(REPO_ROOT, 'get-shit-done', 'presets', 'packs', 'charlotte', 'agents', 'gsd-charlotte-qa.md')),
      true,
    );
  });
});

describe('shell blocks using $HOME/.claude are path-rewritten like ~/.claude', () => {
  test('copyWithPathReplacement rewrites ~/.claude/, $HOME/.claude/ and ${HOME}/.claude/', () => {
    const { copyWithPathReplacement } = require(INSTALL_JS_PATH);
    const root = '/tmp/gsd-fix3-home';
    fs.rmSync(root, { recursive: true, force: true });
    try {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'w.md'),
        '@~/.claude/a.md\nnode "$HOME/.claude/get-shit-done/bin/x.js"\nnode ${HOME}/.claude/y.js\n');
      copyWithPathReplacement(path.join(root, 'src'), path.join(root, 'dest'), '/cfg/dir/', 'claude');
      const out = fs.readFileSync(path.join(root, 'dest', 'w.md'), 'utf8');
      assert.strictEqual(out, '@/cfg/dir/a.md\nnode "/cfg/dir/get-shit-done/bin/x.js"\nnode /cfg/dir/y.js\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('rewriteClaudeDir anchors repo-relative @get-shit-done refs', () => {
  const { rewriteClaudeDir } = require('./install.js');
  test('rewrites bare @get-shit-done/ refs and ~/.claude/ paths, leaves already-anchored refs alone', () => {
    const out = rewriteClaudeDir('see @get-shit-done/references/a.md and @~/.claude/get-shit-done/b.md and ~/.claude/x', '/h/.claude/');
    assert.strictEqual(out, 'see @/h/.claude/get-shit-done/references/a.md and @/h/.claude/get-shit-done/b.md and /h/.claude/x');
  });
});

// WP22a: every case runs against a temp home passed in explicitly; nothing reads the real ~/.claude or ~/.gsd.
describe('WP22a installer safety: corrupt settings, backup record, staged swap, rollback', () => {
  const installer = () => require(INSTALL_JS_PATH);
  const recordModule = () => require(path.join(__dirname, 'install-record.js'));

  const filesUnder = (dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? filesUnder(p) : [p];
    })
    : []);
  const snapshotOf = (dir) => Object.fromEntries(filesUnder(dir).map((p) => [p, fs.readFileSync(p, 'base64')]));
  // Stage and prev trees live under <parent>/.gsd-staging, never beside the live tree (WP22a review 3, item 6).
  const stagedOf = (live, suffix) => path.join(path.dirname(live), '.gsd-staging', `${path.basename(live)}.${suffix}`);
  const withHome = (fn) => {
    const home = createScratchDir('gsd-wp22a-');
    try { fn(home); } finally { cleanup(home); }
  };
  const seedClaudeDir = (home) => {
    const claude = path.join(home, '.claude');
    fs.mkdirSync(path.join(claude, 'get-shit-done'), { recursive: true });
    fs.mkdirSync(path.join(claude, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(claude, 'settings.json'), '{"hooks":{}}\n');
    fs.writeFileSync(path.join(claude, 'get-shit-done', 'a.js'), 'original a\n');
    fs.writeFileSync(path.join(claude, 'agents', 'gsd-x.md'), 'original agent\n');
    return claude;
  };
  const simulateInstall = (claude) => {
    fs.writeFileSync(path.join(claude, 'settings.json'), '{"hooks":{"Stop":[]}}\n');
    fs.writeFileSync(path.join(claude, 'get-shit-done', 'a.js'), 'new a\n');
    fs.rmSync(path.join(claude, 'agents', 'gsd-x.md'));
    fs.writeFileSync(path.join(claude, 'get-shit-done', 'new.js'), 'added\n');
  };

  test('corrupt settings.json: install refused, nothing written, the file not overwritten', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    fs.writeFileSync(path.join(claude, 'settings.json'), '{"hooks": ');
    const before = snapshotOf(home);
    const refusal = installer().refuseInstall({ targetDirs: [claude] });
    assert.deepStrictEqual(refusal.paths, [path.join(claude, 'settings.json')]);
    assert.deepStrictEqual(snapshotOf(home), before);
    assert.throws(() => installer().readSettings(path.join(claude, 'settings.json')), /not valid JSON/);
  }));

  test('writeSettings leaves the file untouched when the serialized bytes are unchanged', () => withHome((home) => {
    const file = path.join(home, 'settings.json');
    const settings = { hooks: { Stop: [] } };
    installer().writeSettings(file, settings);
    const past = new Date('2000-01-01T00:00:00Z');
    fs.utimesSync(file, past, past);
    installer().writeSettings(file, settings);
    assert.strictEqual(fs.statSync(file).mtimeMs, past.getTime());
  }));

  test('openRecord copies every file an install may replace and writes a manifest under a UTC stamp', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const settingsBytes = fs.readFileSync(path.join(claude, 'settings.json'));
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date('2026-11-27T10:00:00.123Z') });
    assert.strictEqual(path.basename(recordDir), '2026-11-27T10-00-00-123Z');
    const record = JSON.parse(fs.readFileSync(path.join(recordDir, 'record.json'), 'utf8'));
    assert.strictEqual(record.status, 'open');
    const byPath = new Map(record.entries.map((e) => [e.path, e]));
    assert.strictEqual(byPath.get(path.join(claude, 'settings.json')).pre_sha256,
      require('crypto').createHash('sha256').update(settingsBytes).digest('hex'));
    assert.strictEqual(byPath.get(path.join(claude, 'settings.local.json')).pre_sha256, null);
    assert.strictEqual(fs.readFileSync(path.join(recordDir, 'pre', claude, 'get-shit-done', 'a.js'), 'utf8'), 'original a\n');
  }));

  test('stageAndSwap: a failed build leaves the live tree intact and no .next behind', () => withHome((home) => {
    const live = path.join(home, 'get-shit-done');
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, 'a.js'), 'old\n');
    assert.throws(() => installer().stageAndSwap(live, (stage) => {
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, 'a.js'), 'partial\n');
      throw new Error('simulated copy failure');
    }), /simulated copy failure/);
    assert.strictEqual(fs.readFileSync(path.join(live, 'a.js'), 'utf8'), 'old\n');
    assert.strictEqual(fs.existsSync(stagedOf(live, 'next')), false);
    assert.strictEqual(fs.existsSync(stagedOf(live, 'prev')), false);
  }));

  test('stageAndSwap: a successful build replaces the live tree and keeps the old one as .prev', () => withHome((home) => {
    const live = path.join(home, 'get-shit-done');
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, 'a.js'), 'old\n');
    installer().stageAndSwap(live, (stage) => {
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, 'a.js'), 'new\n');
    });
    assert.strictEqual(fs.readFileSync(path.join(live, 'a.js'), 'utf8'), 'new\n');
    assert.strictEqual(fs.readFileSync(path.join(stagedOf(live, 'prev'), 'a.js'), 'utf8'), 'old\n');
    assert.strictEqual(fs.existsSync(stagedOf(live, 'next')), false);
  }));

  test('rollback restores the pre-images byte for byte, and a second run changes nothing', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const before = snapshotOf(claude);
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    assert.strictEqual(recordModule().closeRecord(recordDir, { owned: [newFileOf(claude)] }).status, 'closed');
    const first = recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(first.status, 'rolled-back');
    assert.deepStrictEqual(snapshotOf(claude), before);
    const second = recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(second.status, 'already-rolled-back');
    assert.deepStrictEqual(snapshotOf(claude), before);
  }));

  test('rollback leaves a file edited since the install alone and reports it', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    recordModule().closeRecord(recordDir);
    fs.writeFileSync(path.join(claude, 'settings.json'), 'edited by owner\n');
    const result = recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(result.status, 'partial');
    assert.deepStrictEqual(result.left, [path.join(claude, 'settings.json')]);
    assert.strictEqual(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'), 'edited by owner\n');
    assert.strictEqual(fs.readFileSync(path.join(claude, 'get-shit-done', 'a.js'), 'utf8'), 'original a\n');
  }));

  test('rollback refuses a record that never closed', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    assert.strictEqual(recordModule().rollbackNewest({ homeDir: home }).status, 'incomplete');
  }));

  // Subprocess cases: HOME is the temp home, so the real ~/.claude and ~/.gsd are never read or written.
  const runCli = (home, args, env) => require('child_process').spawnSync(
    process.execPath, [INSTALL_JS_PATH, ...args],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: '', ...env, HOME: home } },
  );
  const runGlobalCli = (home, env) => runCli(home, ['--global', '--claude'], env);
  const newFileOf = (claude) => path.join(claude, 'get-shit-done', 'new.js');
  const withEnv = (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return fn(); } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  };
  const withCwd = (dir, fn) => {
    const cwd = process.cwd();
    process.chdir(dir);
    try { return fn(); } finally { process.chdir(cwd); }
  };

  test('global install with a corrupt settings.json is refused and the file is not overwritten', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    fs.writeFileSync(path.join(claude, 'settings.json'), '{"hooks": ');
    const before = snapshotOf(home);
    const run = runGlobalCli(home, {});
    assert.strictEqual(run.status, 1);
    assert.match(run.stdout + run.stderr, /not valid JSON/);
    assert.deepStrictEqual(snapshotOf(home), before);
  }));

  // WP22a review: every user-scope path is guarded, every config file is parsed before the first write, the record is complete.
  test('a local install whose target is the global dir is user scope; an agent-like env (CLAUDECODE=1) is not refused', () => withHome((home) => {
    seedClaudeDir(home);
    withEnv({ HOME: home, CLAUDE_CONFIG_DIR: '', CLAUDECODE: '1' }, () => withCwd(home, () => {
      const { refusal, userDirs } = installer().runRefusal({ runtimes: ['claude'], isGlobal: false });
      assert.strictEqual(refusal, null);
      assert.strictEqual(userDirs.length, 1);
    }));
  }));

  test('a corrupt global settings.json refuses a local install before any write', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    fs.writeFileSync(path.join(claude, 'settings.json'), '{"hooks": ');
    const project = createScratchDir('gsd-wp22a-project-');
    try {
      withEnv({ HOME: home, CLAUDE_CONFIG_DIR: '' }, () => withCwd(project, () => {
        const { refusal } = installer().runRefusal({ runtimes: ['claude'], isGlobal: false });
        assert.deepStrictEqual(refusal.paths, [path.join(claude, 'settings.json')]);
      }));
    } finally { cleanup(project); }
  }));

  test('opencode.json: a corrupt file refuses the install; a JSONC file with comments is accepted', () => withHome((home) => {
    const config = path.join(home, 'opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(config));
    const project = createScratchDir('gsd-wp22a-project-');
    try {
      withEnv({ OPENCODE_CONFIG_DIR: path.dirname(config) }, () => withCwd(project, () => {
        const check = () => installer().runRefusal({ runtimes: ['opencode'], isGlobal: false });
        fs.writeFileSync(config, '{ "permission": ');
        assert.deepStrictEqual(check().refusal.paths, [config]);
        fs.writeFileSync(config, '// kept by the owner\n{ "permission": {}, /* jsonc */ "model": "x", }\n');
        assert.strictEqual(check().refusal, null);
        assert.deepStrictEqual(installer().readOpencodeConfig(config), { permission: {}, model: 'x' });
      }));
    } finally { cleanup(project); }
  }));

  test('pre-images cover gsd-local-patches and skills, and skip node_modules', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const patch = path.join(claude, 'gsd-local-patches', 'a.md');
    const skill = path.join(claude, 'skills', 'task-context', 'SKILL.md');
    const dep = path.join(claude, 'get-shit-done', 'node_modules', 'pkg', 'index.js');
    for (const file of [patch, skill, dep]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x\n');
    }
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    const paths = JSON.parse(fs.readFileSync(path.join(recordDir, 'record.json'), 'utf8')).entries.map((e) => e.path);
    assert.ok(paths.includes(patch));
    assert.ok(paths.includes(skill));
    assert.ok(!paths.includes(dep));
  }));

  test('symlinks are recorded, and rollback restores them as links', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const link = path.join(claude, 'get-shit-done', 'link.js');
    fs.symlinkSync('a.js', link);
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    fs.rmSync(link);
    fs.writeFileSync(link, 'replaced\n');
    recordModule().closeRecord(recordDir);
    assert.strictEqual(recordModule().rollbackNewest({ homeDir: home }).status, 'rolled-back');
    assert.strictEqual(fs.readlinkSync(link), 'a.js');
  }));

  test('rollback deletes only files the record lists as created: a foreign file and node_modules written during the install survive', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    const foreign = path.join(claude, 'get-shit-done', 'mine.js');
    const dep = path.join(claude, 'get-shit-done', 'node_modules', 'pkg', 'index.js');
    fs.writeFileSync(foreign, 'mine\n');
    fs.mkdirSync(path.dirname(dep), { recursive: true });
    fs.writeFileSync(dep, 'dep\n');
    recordModule().closeRecord(recordDir, { owned: [newFileOf(claude)] });
    assert.strictEqual(recordModule().rollbackNewest({ homeDir: home }).status, 'rolled-back');
    assert.strictEqual(fs.readFileSync(foreign, 'utf8'), 'mine\n');
    assert.strictEqual(fs.readFileSync(dep, 'utf8'), 'dep\n');
    assert.strictEqual(fs.existsSync(newFileOf(claude)), false);
  }));

  test('ownedFilesOf lists the package files an install writes under the target', () => withHome((home) => {
    const claude = path.join(home, '.claude');
    const owned = recordModule().ownedFilesOf(claude, REPO_ROOT);
    assert.ok(owned.includes(path.join(claude, 'agents', 'gsd-ui-qa.md')));
    assert.ok(owned.includes(path.join(claude, 'settings.json')));
    assert.ok(owned.every((file) => file.startsWith(claude + path.sep)));
  }));

  test('a SIGTERM during an install closes the open record', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const script = `
      const fs = require('fs');
      const r = require(${JSON.stringify(path.join(__dirname, 'install-record.js'))});
      const dir = r.openRecord({ targetDirs: [${JSON.stringify(claude)}], homeDir: ${JSON.stringify(home)} });
      r.closeOnExit(dir, []);
      fs.writeFileSync(${JSON.stringify(path.join(claude, 'settings.json'))}, 'changed\\n');
      process.kill(process.pid, 'SIGTERM');
      setTimeout(() => {}, 10000);
    `;
    require('child_process').spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: home } });
    const upgrades = path.join(home, '.gsd', 'upgrades');
    const [name] = fs.readdirSync(upgrades);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(upgrades, name, 'record.json'), 'utf8')).status, 'closed');
  }));

  test('the upgrades directory keeps the newest five records', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const base = Date.parse('2026-11-27T10:00:00Z');
    for (let i = 0; i < 7; i += 1) {
      recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date(base + i * 1000) });
    }
    const names = fs.readdirSync(path.join(home, '.gsd', 'upgrades')).sort();
    assert.strictEqual(names.length, 5);
    assert.strictEqual(names.at(-1), '2026-11-27T10-00-06-000Z');
  }));

  test('a record whose install changed nothing is removed on close', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    assert.strictEqual(recordModule().closeRecord(recordDir).status, 'unchanged');
    assert.strictEqual(fs.existsSync(recordDir), false);
  }));

  test('stageAndSwap: a failed swap puts the old tree back so a live tree exists', () => withHome((home) => {
    const live = path.join(home, 'get-shit-done');
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, 'a.js'), 'old\n');
    let calls = 0;
    const flakyRename = (from, to) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated swap failure');
      fs.renameSync(from, to);
    };
    assert.throws(() => installer().stageAndSwap(live, (stage) => {
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, 'a.js'), 'new\n');
    }, flakyRename), /simulated swap failure/);
    assert.strictEqual(fs.readFileSync(path.join(live, 'a.js'), 'utf8'), 'old\n');
    assert.strictEqual(fs.existsSync(stagedOf(live, 'next')), false);
  }));

  test('stageAndSwap: a stage without node_modules aborts; the live tree and its node_modules stay', () => withHome((home) => {
    const live = path.join(home, 'get-shit-done');
    fs.mkdirSync(path.join(live, 'node_modules', 'm'), { recursive: true });
    fs.writeFileSync(path.join(live, 'a.js'), 'old\n');
    assert.throws(() => installer().stageAndSwap(live, (stage) => {
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, 'a.js'), 'new\n');
    }), /node_modules/);
    assert.strictEqual(fs.readFileSync(path.join(live, 'a.js'), 'utf8'), 'old\n');
    assert.strictEqual(fs.existsSync(path.join(live, 'node_modules', 'm')), true);
    assert.strictEqual(fs.existsSync(stagedOf(live, 'next')), false);
    assert.strictEqual(fs.existsSync(stagedOf(live, 'prev')), false);
  }));

  test('stageAndSwap: an interrupted build leaves get-shit-done, agents and commands/gsd byte-identical', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    fs.mkdirSync(path.join(claude, 'commands', 'gsd'), { recursive: true });
    fs.writeFileSync(path.join(claude, 'commands', 'gsd', 'c.md'), 'cmd\n');
    fs.writeFileSync(path.join(claude, 'agents', 'mine.md'), 'foreign\n');
    const before = snapshotOf(claude);
    for (const rel of ['get-shit-done', 'agents', path.join('commands', 'gsd')]) {
      assert.throws(() => installer().stageAndSwap(path.join(claude, rel), (stage, adopt) => {
        fs.mkdirSync(stage, { recursive: true });
        fs.writeFileSync(path.join(stage, 'half.md'), 'partial\n');
        adopt();
        throw new Error('simulated interruption');
      }), /simulated interruption/);
    }
    assert.deepStrictEqual(snapshotOf(claude), before);
  }));

  test('buildAgentsStage: foreign agents survive, gsd-*.md are replaced', () => withHome((home) => {
    const live = path.join(home, 'agents');
    const srcDir = path.join(home, 'src-agents');
    fs.mkdirSync(path.join(live, 'sub'), { recursive: true });
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(live, 'mine.md'), 'foreign\n');
    fs.writeFileSync(path.join(live, 'sub', 'x.md'), 'nested\n');
    fs.writeFileSync(path.join(live, 'gsd-old.md'), 'retired\n');
    fs.writeFileSync(path.join(srcDir, 'gsd-new.md'), 'new agent\n');
    installer().stageAndSwap(live, (stage) => installer().buildAgentsStage(live, stage, srcDir, `${home}/`, 'claude'));
    assert.deepStrictEqual(fs.readdirSync(live).sort(), ['gsd-new.md', 'mine.md', 'sub']);
    assert.strictEqual(fs.readFileSync(path.join(live, 'mine.md'), 'utf8'), 'foreign\n');
    assert.strictEqual(fs.readFileSync(path.join(live, 'sub', 'x.md'), 'utf8'), 'nested\n');
    assert.strictEqual(fs.existsSync(path.join(stagedOf(live, 'prev'), 'gsd-old.md')), true);
  }));

  test('stageAndSwap: node_modules moves into the new tree; a failed build or npm step gives it back', () => withHome((home) => {
    const live = path.join(home, 'get-shit-done');
    fs.mkdirSync(path.join(live, 'node_modules', 'm'), { recursive: true });
    fs.writeFileSync(path.join(live, 'node_modules', 'm', 'i.js'), 'deps\n');
    fs.writeFileSync(path.join(live, 'a.js'), 'old\n');
    const before = snapshotOf(live);
    assert.throws(() => installer().stageAndSwap(live, (stage, adopt) => {
      fs.mkdirSync(stage);
      adopt();
      throw new Error('npm failed');
    }), /npm failed/);
    assert.deepStrictEqual(snapshotOf(live), before);
    installer().stageAndSwap(live, (stage, adopt) => {
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, 'a.js'), 'new\n');
      adopt();
    });
    assert.strictEqual(fs.readFileSync(path.join(live, 'a.js'), 'utf8'), 'new\n');
    assert.strictEqual(fs.readFileSync(path.join(live, 'node_modules', 'm', 'i.js'), 'utf8'), 'deps\n');
    assert.strictEqual(fs.existsSync(path.join(stagedOf(live, 'prev'), 'node_modules')), false);
  }));

  test('stageAndSwap: a killed run that stranded node_modules in the stage is repaired by the next run', () => withHome((home) => {
    const live = path.join(home, 'get-shit-done');
    fs.mkdirSync(path.join(live, '.next-dummy'), { recursive: true });
    fs.mkdirSync(path.join(stagedOf(live, 'next'), 'node_modules', 'm'), { recursive: true });
    assert.throws(() => installer().stageAndSwap(live, () => { throw new Error('stop'); }), /stop/);
    assert.strictEqual(fs.existsSync(path.join(live, 'node_modules', 'm')), true);
  }));

  // Item 6: nothing of a staged tree sits beside or inside a directory Claude Code loads recursively.
  test('stageAndSwap: a commands/gsd stage and prev live under .gsd-staging, never inside commands/', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const live = path.join(claude, 'commands', 'gsd');
    fs.mkdirSync(live, { recursive: true });
    const opts = { stagingRoot: path.join(claude, '.gsd-staging'), name: 'commands-gsd' };
    let seenDuringBuild = null;
    installer().stageAndSwap(live, (stage) => {
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, 'c.md'), 'new\n');
      seenDuringBuild = fs.readdirSync(path.join(claude, 'commands'));
    }, fs.renameSync, opts);
    assert.deepStrictEqual(seenDuringBuild, ['gsd']);
    assert.deepStrictEqual(fs.readdirSync(path.join(claude, 'commands')), ['gsd']);
    assert.strictEqual(fs.existsSync(path.join(claude, '.gsd-staging', 'commands-gsd.prev')), true);
  }));

  // Item 1: a kill between the two renames leaves no live tree, only the stage (holding node_modules) and prev.
  test('stageAndSwap: a crash between the two renames is repaired; the stranded node_modules is kept', () => withHome((home) => {
    const live = path.join(home, 'get-shit-done');
    fs.mkdirSync(path.join(stagedOf(live, 'next'), 'node_modules', 'm'), { recursive: true });
    fs.writeFileSync(path.join(stagedOf(live, 'next'), 'node_modules', 'm', 'i.js'), 'deps\n');
    fs.writeFileSync(path.join(stagedOf(live, 'next'), 'a.js'), 'crashed new\n');
    fs.mkdirSync(stagedOf(live, 'prev'), { recursive: true });
    fs.writeFileSync(path.join(stagedOf(live, 'prev'), 'a.js'), 'old\n');
    installer().stageAndSwap(live, (stage, adopt) => {
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, 'a.js'), 'fresh\n');
      adopt();
    });
    assert.strictEqual(fs.readFileSync(path.join(live, 'a.js'), 'utf8'), 'fresh\n');
    assert.strictEqual(fs.readFileSync(path.join(live, 'node_modules', 'm', 'i.js'), 'utf8'), 'deps\n');
    assert.strictEqual(fs.readFileSync(path.join(stagedOf(live, 'prev'), 'a.js'), 'utf8'), 'old\n');
  }));

  // Item 4: every stage is built before any tree is replaced, and a failed swap undoes the trees already swapped.
  const treeSpec = (home, name, content, extra = {}) => {
    const liveDir = path.join(home, name);
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'a.js'), 'old\n');
    return {
      label: name,
      liveDir,
      build: (stage) => { fs.mkdirSync(stage); fs.writeFileSync(path.join(stage, 'a.js'), content); },
      ...extra,
    };
  };
  const contentOf = (spec) => fs.readFileSync(path.join(spec.liveDir, 'a.js'), 'utf8');

  test('swapTrees: a failed build of a later tree replaces no tree at all', () => withHome((home) => {
    const first = treeSpec(home, 'one', 'new\n');
    const second = treeSpec(home, 'two', 'new\n', { build: () => { throw new Error('build two failed'); } });
    const result = installer().swapTrees([first, second]);
    assert.deepStrictEqual(result.errors.map((e) => [e.label, e.message]), [['two', 'build two failed']]);
    assert.strictEqual(contentOf(first), 'old\n');
    assert.strictEqual(contentOf(second), 'old\n');
    assert.strictEqual(fs.existsSync(stagedOf(first.liveDir, 'next')), false);
  }));

  test('swapTrees: a swap that fails on the second tree puts the first tree back', () => withHome((home) => {
    const first = treeSpec(home, 'one', 'new\n');
    const second = treeSpec(home, 'two', 'new\n');
    let calls = 0;
    const flakyRename = (from, to) => {
      calls += 1;
      if (calls === 4) throw new Error('simulated swap failure');
      fs.renameSync(from, to);
    };
    const result = installer().swapTrees([first, second], flakyRename);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(contentOf(first), 'old\n');
    assert.strictEqual(contentOf(second), 'old\n');
  }));

  test('swapTrees: a revert that fails still reverts the other trees and names the stuck path', () => withHome((home) => {
    const specs = ['one', 'two', 'three'].map((name) => treeSpec(home, name, 'new\n'));
    let calls = 0;
    const flakyRename = (from, to) => {
      calls += 1;
      if (calls === 6) throw new Error('simulated third swap failure');
      if (calls > 6 && to === specs[1].liveDir) throw new Error('simulated revert failure');
      fs.renameSync(from, to);
    };
    const result = installer().swapTrees(specs, flakyRename);
    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0].message, new RegExp(`could not revert, check by hand: ${specs[1].liveDir}`));
    assert.doesNotMatch(result.errors[0].message, new RegExp(specs[0].liveDir));
    assert.strictEqual(contentOf(specs[0]), 'old\n');
  }));

  test('swapTrees: every tree is replaced when every build succeeds', () => withHome((home) => {
    const specs = [treeSpec(home, 'one', 'new\n'), treeSpec(home, 'two', 'new\n')];
    assert.deepStrictEqual(installer().swapTrees(specs).errors, []);
    assert.deepStrictEqual(specs.map(contentOf), ['new\n', 'new\n']);
  }));

  // Item 7: a symlinked live tree is refused before any write.
  test('a symlinked agents or get-shit-done tree refuses the install before any write and names which', () => withHome((home) => {
    const claude = path.join(home, '.claude');
    const dotfiles = path.join(home, 'dotfiles-agents');
    fs.mkdirSync(dotfiles);
    fs.mkdirSync(claude);
    fs.symlinkSync(dotfiles, path.join(claude, 'agents'));
    const before = treeOf(home);
    const refusal = installer().refuseInstall({ targetDirs: [claude] });
    assert.match(refusal.reason, /symlink/);
    assert.deepStrictEqual(refusal.paths, [path.join(claude, 'agents')]);
    assert.deepStrictEqual(treeOf(home), before);
    assert.throws(() => installer().stageAndSwap(path.join(claude, 'agents'), (stage) => fs.mkdirSync(stage)), /symlink/);
    assert.strictEqual(fs.lstatSync(path.join(claude, 'agents')).isSymbolicLink(), true);
  }));

  // Item 3: an open newest record means a crashed install; an older record is never reverted past it.
  test('rollback with an open newest record reports incomplete and reverts nothing, even with an older closed record', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const base = Date.parse('2026-11-27T10:00:00Z');
    const closed = recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date(base) });
    simulateInstall(claude);
    recordModule().closeRecord(closed, { owned: [newFileOf(claude)] });
    recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date(base + 1000) });
    const afterInstall = snapshotOf(claude);
    const result = recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(result.status, 'incomplete');
    assert.deepStrictEqual(snapshotOf(claude), afterInstall);
  }));

  // Item 2: the manifest timestamp alone is not a change.
  test('a record whose only change is the manifest timestamp is removed on close; another change keeps it', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const manifest = path.join(claude, 'gsd-file-manifest.json');
    const write = (timestamp) => fs.writeFileSync(manifest, JSON.stringify({ version: '1', timestamp, files: {} }, null, 2));
    write('2026-01-01T00:00:00Z');
    const quiet = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    write('2026-01-02T00:00:00Z');
    assert.strictEqual(recordModule().closeRecord(quiet).status, 'unchanged');
    assert.strictEqual(fs.existsSync(quiet), false);
    const real = recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date(Date.now() + 5000) });
    write('2026-01-03T00:00:00Z');
    fs.writeFileSync(path.join(claude, 'get-shit-done', 'a.js'), 'changed\n');
    assert.strictEqual(recordModule().closeRecord(real).status, 'closed');
  }));

  // Item 8: package.json restored with the old pins while node_modules stays new: one npm install run, injectable.
  test('rollback that restores get-shit-done/package.json runs one npm install there; unchanged package.json runs none', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const pkgFile = path.join(claude, 'get-shit-done', 'package.json');
    fs.writeFileSync(pkgFile, '{"old":1}\n');
    const calls = [];
    const runNpm = (cwd) => { calls.push(cwd); return true; };
    const first = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    fs.writeFileSync(pkgFile, '{"new":1}\n');
    recordModule().closeRecord(first);
    const result = recordModule().rollbackNewest({ homeDir: home, runNpm });
    assert.strictEqual(result.status, 'rolled-back');
    assert.deepStrictEqual(calls, [path.join(claude, 'get-shit-done')]);
    assert.strictEqual(fs.readFileSync(pkgFile, 'utf8'), '{"old":1}\n');
    const second = recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date(Date.now() + 5000) });
    simulateInstall(claude);
    recordModule().closeRecord(second, { owned: [newFileOf(claude)] });
    recordModule().rollbackNewest({ homeDir: home, runNpm });
    assert.strictEqual(calls.length, 1);
  }));

  // Item 9: install:gsd step 4 writes <configDir>/.claude.json after the install closed its record.
  test('rollback restores .claude.json as written by the MCP step after the record closed', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const mcp = path.join(claude, '.claude.json');
    fs.writeFileSync(mcp, '{"mcpServers":{"mine":{}}}\n');
    const dir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    recordModule().closeRecord(dir, { owned: [newFileOf(claude)] });
    fs.writeFileSync(mcp, '{"other":1,"mcpServers":{"mine":{},"telegram":{"command":"node"}}}\n');
    assert.strictEqual(recordModule().noteLateWrite({ homeDir: home, file: mcp }), true);
    assert.strictEqual(recordModule().rollbackNewest({ homeDir: home }).status, 'rolled-back');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(mcp, 'utf8')), { other: 1, mcpServers: { mine: {} } });
  }));

  test('rollback removes a .claude.json the MCP step created', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const mcp = path.join(claude, '.claude.json');
    const dir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    recordModule().closeRecord(dir, { owned: [newFileOf(claude)] });
    fs.writeFileSync(mcp, '{"mcpServers":{"telegram":{}}}\n');
    recordModule().noteLateWrite({ homeDir: home, file: mcp });
    recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(fs.existsSync(mcp), false);
  }));

  const SECRET = 'SECRET-TOKEN-123';
  const contentsUnder = (dir) => filesUnder(dir).map((p) => fs.readFileSync(p, 'utf8')).join('\n');

  test('the record never holds .claude.json content and keeps owner-only modes', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const mcp = path.join(claude, '.claude.json');
    fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { telegram: { env: { TELEGRAM_BOT_TOKEN: SECRET } } }, oauth: SECRET }));
    fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ env: { TOKEN: SECRET } }));
    const dir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    recordModule().closeRecord(dir, { owned: [newFileOf(claude)] });
    recordModule().noteLateWrite({ homeDir: home, file: mcp });
    const modeOf = (p) => fs.statSync(p).mode & 0o777;
    assert.strictEqual(modeOf(dir), 0o700);
    assert.strictEqual(modeOf(path.join(dir, 'pre')), 0o700);
    for (const p of filesUnder(dir)) assert.strictEqual(modeOf(p), 0o600, p);
    const stored = contentsUnder(dir);
    assert.strictEqual(stored.includes(SECRET), true, 'settings.json pre-image is kept (0600) so rollback can restore it');
    assert.strictEqual(filesUnder(dir).some((p) => p.endsWith('.claude.json')), false);
    assert.strictEqual(stored.replace(SECRET, '').includes(SECRET), false, 'the secret occurs once: only in the settings.json pre-image');
  }));

  test('a prior telegram key is stored as a hash only and rollback leaves it for the user when it changed', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const mcp = path.join(claude, '.claude.json');
    fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { telegram: { env: { T: SECRET } } } }));
    const dir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    recordModule().closeRecord(dir, { owned: [newFileOf(claude)] });
    fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { telegram: { env: { T: 'changed' } } } }));
    recordModule().noteLateWrite({ homeDir: home, file: mcp });
    assert.strictEqual(contentsUnder(dir).includes(SECRET), false);
    const result = recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(result.status, 'partial');
    assert.match(result.left[0], /restore it by hand/);
    assert.strictEqual(JSON.parse(fs.readFileSync(mcp, 'utf8')).mcpServers.telegram.env.T, 'changed');
  }));

  test('an install that changed nothing leaves the older closed record alone when the MCP step writes', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    const mcp = path.join(claude, '.claude.json');
    const base = Date.now() - 60000;
    const older = recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date(base) });
    simulateInstall(claude);
    recordModule().closeRecord(older, { owned: [newFileOf(claude)] });
    const olderBytes = fs.readFileSync(path.join(older, 'record.json'), 'utf8');
    const quiet = recordModule().openRecord({ targetDirs: [claude], homeDir: home, now: new Date(base + 30000) });
    assert.strictEqual(recordModule().closeRecord(quiet).status, 'unchanged');
    fs.writeFileSync(mcp, '{"mcpServers":{"telegram":{}}}\n');
    assert.strictEqual(recordModule().noteLateWrite({ homeDir: home, file: mcp }), false);
    assert.strictEqual(fs.readFileSync(path.join(older, 'record.json'), 'utf8'), olderBytes);
    recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(fs.existsSync(mcp), true);
  }));

  // Items 2 and 5 end to end: the real install() under a temp HOME with npm stubbed (the CLI entry is skipped); the record is driven by the same exported functions the CLI uses.
  const treeOf = (dir) => {
    const walk = (current) => fs.readdirSync(current, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(current, e.name);
      const rel = path.relative(dir, p);
      if (e.isSymbolicLink()) return [[rel, `link:${fs.readlinkSync(p)}`]];
      if (e.isDirectory()) return [[rel, 'dir'], ...walk(p)];
      return [[rel, fs.readFileSync(p, 'base64')]];
    });
    return Object.fromEntries(walk(dir).sort());
  };
  const driveInstall = (home, claude, project) => {
    const script = `
      const i = require(${JSON.stringify(INSTALL_JS_PATH)});
      const r = require(${JSON.stringify(path.join(__dirname, 'install-record.js'))});
      const dir = r.openRecord({ targetDirs: [${JSON.stringify(claude)}], homeDir: ${JSON.stringify(home)} });
      const out = i.install(true, 'claude');
      i.finishInstall(out.settingsPath, out.settings, out.statuslineCommand, false, 'claude');
      r.closeRecord(dir, { owned: r.ownedFilesOf(${JSON.stringify(claude)}, ${JSON.stringify(REPO_ROOT)}) });
    `;
    return require('child_process').spawnSync(process.execPath, ['--require', mockExecSyncPath, '-e', script], {
      encoding: 'utf8',
      cwd: project,
      timeout: 120000,
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', GSD_TEST_MOCK_NPM_FAIL: '0' },
    });
  };
  const withInstallSeed = (fn) => withHome((home) => {
    const project = createScratchDir('gsd-wp22a-cwd-');
    try {
      const claude = seedClaudeDir(home);
      fs.mkdirSync(path.join(claude, 'commands', 'mine'), { recursive: true });
      fs.writeFileSync(path.join(claude, 'commands', 'mine', 'x.md'), 'foreign command\n');
      fs.writeFileSync(path.join(claude, 'agents', 'mine.md'), 'foreign agent\n');
      fs.symlinkSync('mine.md', path.join(claude, 'agents', 'linked.md'));
      fs.mkdirSync(path.join(claude, 'get-shit-done', 'node_modules', 'm'), { recursive: true });
      fs.writeFileSync(path.join(claude, 'get-shit-done', 'node_modules', 'm', 'i.js'), 'deps\n');
      fs.writeFileSync(path.join(claude, 'settings.json'),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo foreign' }] }] } }, null, 2) + '\n');
      fn({ home, claude, project });
    } finally { cleanup(project); }
  });

  test('install then rollback leaves the seeded tree exactly as it was; a second identical install records nothing', () => withInstallSeed(({ home, claude, project }) => {
    const seed = treeOf(claude);
    const first = driveInstall(home, claude, project);
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);
    assert.notDeepStrictEqual(treeOf(claude), seed);
    const upgrades = path.join(home, '.gsd', 'upgrades');
    assert.strictEqual(fs.readdirSync(upgrades).length, 1);
    const second = driveInstall(home, claude, project);
    assert.strictEqual(second.status, 0, second.stdout + second.stderr);
    assert.strictEqual(fs.readdirSync(upgrades).length, 1);
    const result = recordModule().rollbackNewest({ homeDir: home });
    assert.strictEqual(result.status, 'rolled-back', JSON.stringify(result.left));
    assert.deepStrictEqual(treeOf(claude), seed);
  }));

  test('install then rollback on a fresh config dir leaves no installed file, staging or empty directory behind', () => withHome((home) => {
    const project = createScratchDir('gsd-wp22a-cwd-');
    try {
      const claude = path.join(home, '.claude');
      fs.mkdirSync(claude);
      const seed = treeOf(claude);
      const run = driveInstall(home, claude, project);
      assert.strictEqual(run.status, 0, run.stdout + run.stderr);
      assert.strictEqual(recordModule().rollbackNewest({ homeDir: home }).status, 'rolled-back');
      assert.deepStrictEqual(treeOf(claude), seed);
    } finally { cleanup(project); }
  }));

  test('rollback refuses when node_modules is gone and no .prev copy exists, changing no file', () => withHome((home) => {
    const claude = seedClaudeDir(home);
    fs.mkdirSync(path.join(claude, 'get-shit-done', 'node_modules'));
    const recordDir = recordModule().openRecord({ targetDirs: [claude], homeDir: home });
    simulateInstall(claude);
    fs.rmSync(path.join(claude, 'get-shit-done', 'node_modules'), { recursive: true });
    assert.strictEqual(recordModule().closeRecord(recordDir, { owned: [newFileOf(claude)] }).status, 'closed');
    const afterInstall = snapshotOf(claude);
    assert.strictEqual(recordModule().rollbackNewest({ homeDir: home }).status, 'deps-missing');
    assert.deepStrictEqual(snapshotOf(claude), afterInstall);
  }));
});
