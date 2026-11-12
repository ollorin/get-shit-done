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

describe('skills/ installation (Phase 292.1 gap closure -- 292-VERIFICATION.md SC4)', () => {
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
    copyDirRecursive(path.join(REPO_ROOT, 'skills'), path.join(scratchRepo, 'skills'));
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

  test('install copies skills/task-context/SKILL.md into the install target, with path-prefix replacement applied', () => {
    const scratchInstallJs = path.join(scratchRepo, 'bin', 'install.js');
    const result = runInstall(scratchTarget, { installJsPath: scratchInstallJs });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);
    assert.ok(
      result.output.includes('Installed skills'),
      `install output should report the skills copy: ${result.output}`
    );

    const installedSkillPath = path.join(scratchTarget, '.claude', 'skills', 'task-context', 'SKILL.md');
    assert.ok(
      fs.existsSync(installedSkillPath),
      'skills/task-context/SKILL.md should have been installed -- this is the exact gap ' +
        '292-VERIFICATION.md found (grep for "skills" in bin/install.js/scripts/install-modules.js ' +
        'returned zero matches)'
    );

    const installedContent = fs.readFileSync(installedSkillPath, 'utf-8');
    // Path-prefix replacement: the fork's tracked ~/.claude/ literal must be replaced with
    // the actual install target's absolute path -- mirrors agentsSrc/agentsDest and the
    // pre-existing get-shit-done skill directory's own copyWithPathReplacement behavior.
    assert.ok(
      !installedContent.includes('~/.claude/'),
      'installed SKILL.md should not retain the literal ~/.claude/ placeholder'
    );
    // runInstall() invokes install.js with --local, so pathPrefix is the RELATIVE
    // './.claude/' form (see install()'s isGlobal ternary), not an absolute path --
    // this mirrors exactly what a local install's other copied assets (agents,
    // commands) resolve to as well.
    assert.ok(
      installedContent.includes('./.claude/'),
      'installed SKILL.md should reference the local install target path prefix (./.claude/)'
    );
  });

  test('install does not delete pre-existing sibling skill directories it does not own', () => {
    // Simulate a user who already has OTHER skills installed that this fork's own
    // skills/ tree does not track at all (e.g. a learned-state skill, or an unrelated
    // personal skill) -- the installer must never wipe the whole skills/ directory,
    // only manage the specific subdirectories it ships.
    const preExistingSkillDir = path.join(scratchTarget, '.claude', 'skills', 'unrelated-skill');
    fs.mkdirSync(preExistingSkillDir, { recursive: true });
    fs.writeFileSync(path.join(preExistingSkillDir, 'learned-state.md'), 'do-not-delete-me');

    const scratchInstallJs = path.join(scratchRepo, 'bin', 'install.js');
    const result = runInstall(scratchTarget, { installJsPath: scratchInstallJs });
    assert.ok(result.success, `install should succeed: ${result.error || ''}\n${result.output}`);

    const preservedFile = path.join(preExistingSkillDir, 'learned-state.md');
    assert.ok(fs.existsSync(preservedFile), 'pre-existing sibling skill directory must survive install');
    assert.strictEqual(fs.readFileSync(preservedFile, 'utf-8'), 'do-not-delete-me');

    assert.ok(
      fs.existsSync(path.join(scratchTarget, '.claude', 'skills', 'task-context', 'SKILL.md')),
      'the fork-tracked skill should still be installed alongside the untouched sibling'
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
      for (const d of ['hooks', 'bin', 'scripts', 'commands', 'get-shit-done', 'agents', 'skills']) {
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
