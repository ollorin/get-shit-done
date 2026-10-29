const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Returns a list of human-readable problems; empty = safe to install.
function preflight(root) {
  const problems = [];
  const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' });
  if (git.status === 0 && git.stdout.trim().length > 0) {
    problems.push('working tree is dirty (git status --porcelain is non-empty); commit or discard changes first');
  }
  const binDir = path.join(root, 'get-shit-done', 'bin');
  const jsFiles = fs.existsSync(binDir) ? fs.readdirSync(binDir).filter(f => f.endsWith('.js')) : [];
  for (const f of jsFiles) {
    if (fs.statSync(path.join(binDir, f)).size === 0) problems.push(`get-shit-done/bin/${f} is 0 bytes`);
  }
  const tools = path.join(binDir, 'gsd-tools.js');
  if (fs.existsSync(tools)) {
    const chk = spawnSync(process.execPath, ['--check', tools], { encoding: 'utf-8' });
    if (chk.status !== 0) problems.push(`node --check get-shit-done/bin/gsd-tools.js failed: ${(chk.stderr || '').split('\n')[0]}`);
  }
  return problems;
}

module.exports = { preflight };
