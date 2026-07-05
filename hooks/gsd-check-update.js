#!/usr/bin/env node
// Check for GSD updates in background, write result to cache
// Called by SessionStart hook - runs once per session

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const homeDir = os.homedir();
const cwd = process.cwd();
const cacheDir = path.join(homeDir, '.claude', 'cache');
const cacheFile = path.join(cacheDir, 'gsd-update-check.json');

// VERSION file locations (check project first, then global)
const projectVersionFile = path.join(cwd, '.claude', 'get-shit-done', 'VERSION');
const globalVersionFile = path.join(homeDir, '.claude', 'get-shit-done', 'VERSION');

// Ensure cache directory exists
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// MILE-25: pure helpers, extracted so they're unit-testable via require()
// without needing to invoke the background spawn below.
function shouldCheckSkew(cwd) {
  return fs.existsSync(path.join(cwd, 'get-shit-done', 'bin', 'gsd-tools.js'));
}

function buildSkewCachePayload(doctorResult) {
  return {
    clean: !!(doctorResult && doctorResult.clean !== false),
    drifted_count: (doctorResult && Array.isArray(doctorResult.drifted)) ? doctorResult.drifted.length : 0,
    checked: Math.floor(Date.now() / 1000)
  };
}

if (require.main === module) {
  // Run check in background (spawn background process, windowsHide prevents console flash)
  const child = spawn(process.execPath, ['-e', `
    const fs = require('fs');
    const { execSync } = require('child_process');

    const cacheFile = ${JSON.stringify(cacheFile)};
    const projectVersionFile = ${JSON.stringify(projectVersionFile)};
    const globalVersionFile = ${JSON.stringify(globalVersionFile)};

    // Check project directory first (local install), then global
    let installed = '0.0.0';
    try {
      if (fs.existsSync(projectVersionFile)) {
        installed = fs.readFileSync(projectVersionFile, 'utf8').trim();
      } else if (fs.existsSync(globalVersionFile)) {
        installed = fs.readFileSync(globalVersionFile, 'utf8').trim();
      }
    } catch (e) {}

    let latest = null;
    try {
      latest = execSync('npm view get-shit-done-cc version', { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
    } catch (e) {}

    const result = {
      update_available: latest && installed !== latest,
      installed,
      latest: latest || 'unknown',
      checked: Math.floor(Date.now() / 1000)
    };

    fs.writeFileSync(cacheFile, JSON.stringify(result));

    // MILE-25: opportunistic skew-check caching, independent of the update
    // check above -- never break SessionStart over a skew-check failure.
    try {
      const { shouldCheckSkew, buildSkewCachePayload } = require(${JSON.stringify(__filename)});
      const cwd = ${JSON.stringify(cwd)};
      if (shouldCheckSkew(cwd)) {
        const { execSync } = require('child_process');
        const projectGsdTools = require('path').join(cwd, '.claude', 'get-shit-done', 'bin', 'gsd-tools.js');
        const globalGsdTools = require('path').join(${JSON.stringify(homeDir)}, '.claude', 'get-shit-done', 'bin', 'gsd-tools.js');
        const gsdToolsPath = fs.existsSync(projectGsdTools) ? projectGsdTools : globalGsdTools;
        if (fs.existsSync(gsdToolsPath)) {
          const doctorRaw = execSync('node "' + gsdToolsPath + '" doctor --raw', { cwd, timeout: 10000, encoding: 'utf8' });
          const doctorResult = JSON.parse(doctorRaw);
          fs.writeFileSync(${JSON.stringify(path.join(cacheDir, 'gsd-skew-check.json'))}, JSON.stringify(buildSkewCachePayload(doctorResult)));
        }
      }
    } catch (e) { /* never break SessionStart over a skew-check failure */ }
  `], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true  // Required on Windows for proper process detachment
  });

  child.unref();
}

module.exports = { shouldCheckSkew, buildSkewCachePayload };
