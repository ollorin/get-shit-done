#!/usr/bin/env node
/**
 * NPM Workspace Dependency Installer
 *
 * Uses npm workspaces to install dependencies for all modules:
 * - Root package.json
 * - mcp-servers/*
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function installModules() {
  const projectRoot = path.resolve(__dirname, '..');
  const hasLockfile = fs.existsSync(path.join(projectRoot, 'package-lock.json'));

  // Check npm version (workspaces require npm 7+)
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
    const majorVersion = parseInt(npmVersion.split('.')[0], 10);

    if (majorVersion < 7) {
      console.log('       📊 npm version:', npmVersion);
      console.log('       ⚠️  Warning: npm workspaces require npm 7+');
      console.log('       🔄 Falling back to sequential install...');
      return fallbackInstall(projectRoot);
    }
  } catch (e) {
    console.log('       ⚠️  Warning: Could not determine npm version');
  }

  // Use npm workspaces for unified install
  // Prefer npm ci if lockfile exists (reproducible), fall back to npm install (first install)
  const command = hasLockfile ? 'npm ci' : 'npm install --prefer-offline';
  console.log(`       🔄 Running ${command} with workspaces...`);

  try {
    execSync(command, {
      cwd: projectRoot,
      stdio: process.env.DEBUG ? 'inherit' : 'pipe',
      timeout: 300000 // 5 minutes
    });
    console.log('       ✅ Done');
  } catch (error) {
    if (process.env.DEBUG) {
      console.error('       ❌ npm install failed:', error.message);
    }
    throw new Error('npm install failed - check node_modules permissions');
  }
}

function fallbackInstall(projectRoot) {
  // Install root dependencies
  console.log('       📦 Installing root dependencies...');
  const hasRootLock = fs.existsSync(path.join(projectRoot, 'package-lock.json'));
  const rootCommand = hasRootLock ? 'npm ci' : 'npm install --prefer-offline';
  execSync(rootCommand, { cwd: projectRoot, stdio: 'pipe' });

  // Install MCP server dependencies
  const mcpDir = path.join(projectRoot, 'mcp-servers', 'telegram-mcp');
  if (fs.existsSync(path.join(mcpDir, 'package.json'))) {
    console.log('       📦 Installing telegram-mcp dependencies...');
    const hasMcpLock = fs.existsSync(path.join(mcpDir, 'package-lock.json'));
    const mcpCommand = hasMcpLock ? 'npm ci' : 'npm install --prefer-offline';
    execSync(mcpCommand, { cwd: mcpDir, stdio: 'pipe' });
  }

  console.log('       ✅ Done');
}

module.exports = installModules;

// Allow direct execution
if (require.main === module) {
  installModules();
}
