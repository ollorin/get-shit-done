#!/usr/bin/env node
/**
 * GSD Installation Orchestrator
 *
 * Handles installation from multiple scenarios:
 * - Direct clone: git clone && npm run install:gsd
 * - npx from npm: npx get-shit-done-cc (uses bin/install.js)
 * - npx from GitHub fork: npx github:user/get-shit-done
 *
 * CRITICAL: Detect npx github: scenario where node_modules may not exist
 * and the script runs from a temporary npm cache directory.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Detect installation context
function detectContext() {
  const cwd = process.cwd();
  const scriptDir = __dirname;

  // Check if running from npm cache (npx github: scenario)
  const isNpxGithub = scriptDir.includes('_npx') ||
                      scriptDir.includes('.npm/_cacache') ||
                      !fs.existsSync(path.join(scriptDir, '..', 'node_modules'));

  // Check if running from cloned repo
  const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
  const hasGsdDir = fs.existsSync(path.join(cwd, 'get-shit-done'));

  return {
    isNpxGithub,
    isDirectClone: hasPackageJson && hasGsdDir && !isNpxGithub,
    cwd,
    scriptDir,
    projectRoot: isNpxGithub ? cwd : path.resolve(scriptDir, '..')
  };
}

async function main() {
  console.log('\n🚀 GSD Installation\n');

  const context = detectContext();

  if (context.isNpxGithub) {
    console.log('📦 Detected: npx github:user/repo installation');
    console.log('🔀 Redirecting to standard installer...\n');

    // For npx github: scenario, delegate to bin/install.js
    // which handles the interactive installation flow
    const installScript = path.join(context.scriptDir, '..', 'bin', 'install.js');
    if (fs.existsSync(installScript)) {
      require(installScript);
      return;
    } else {
      console.error('❌ Error: bin/install.js not found');
      process.exit(1);
    }
  }

  console.log('📁 Detected: Direct repository installation\n');

  try {
    // Step 1: Install npm dependencies via workspaces
    console.log('📥 1/7 Installing npm dependencies...');
    require('./install-modules.js')();

    // Step 2: Copy GSD files to ~/.claude/
    console.log('📁 2/7 Installing GSD files to ~/.claude/...');
    const installScript = path.join(__dirname, '..', 'bin', 'install.js');
    execSync(`node "${installScript}" --global --claude`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });

    // Step 3: Whisper models (handled by Plan 02)
    console.log('🎙️  3/7 Whisper model installation...');
    const whisperInstaller = path.join(__dirname, 'install-whisper.js');
    if (fs.existsSync(whisperInstaller)) {
      require(whisperInstaller)();
    } else {
      console.log('       ⏭️  (skipped - whisper installer not yet created)');
    }

    // Step 4: Claude Code hooks (handled by Plan 03)
    console.log('🪝 4/7 Installing Claude Code hooks...');
    const hookInstaller = path.join(__dirname, 'install-hooks.js');
    if (fs.existsSync(hookInstaller)) {
      require(hookInstaller)();
    } else {
      console.log('       ⏭️  (skipped - hook installer not yet created)');
    }

    // Step 5: MCP server config (handled by Plan 03)
    console.log('🔌 5/7 Configuring MCP servers...');
    const mcpInstaller = path.join(__dirname, 'install-mcp.js');
    if (fs.existsSync(mcpInstaller)) {
      require(mcpInstaller)();
    } else {
      console.log('       ⏭️  (skipped - MCP installer not yet created)');
    }

    // Step 6: .env template (handled by Plan 04)
    console.log('📝 6/7 Generating .env.template...');
    const envGenerator = path.join(__dirname, 'generate-env-template.js');
    if (fs.existsSync(envGenerator)) {
      require(envGenerator)();
    } else {
      console.log('       ⏭️  (skipped - env generator not yet created)');
    }

    // Step 7: Health check (handled by Plan 02)
    console.log('🩺 7/7 Running health check...');
    const healthCheck = path.join(__dirname, 'health-check.js');
    if (fs.existsSync(healthCheck)) {
      require(healthCheck)();
    } else {
      console.log('       ⏭️  (skipped - health check not yet created)');
    }

    console.log('\n✅ Installation complete!\n');

  } catch (error) {
    console.error('\n❌ Installation failed:', error.message);
    console.error('💡 Run with DEBUG=1 for detailed logs\n');
    process.exit(1);
  }
}

main();
