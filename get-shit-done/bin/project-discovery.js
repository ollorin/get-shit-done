'use strict';

// Which GSD projects Claude Code knows (directory names under <config dir>/projects, a path with every separator turned
// into "-") but the registry does not. ~/.claude is shared by every project, so an upgrade must not run while one of
// them is unregistered: its live phase would be invisible to the quiesce check.

const fs = require('fs');
const os = require('os');
const path = require('path');

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const readConfig = (root) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8'));
  } catch {
    return null;
  }
};

// "-Users-me-casino-mall" -> "/Users/me/casino-mall": the dashes are ambiguous, so the filesystem decides, and "--tmp" is ".tmp".
function decode(name, exists) {
  const tokens = name.replace(/^-/, '').split('-');
  const walk = (base, i) => {
    if (i === tokens.length) return base;
    for (let j = i + 1; j <= tokens.length; j += 1) {
      const joined = tokens.slice(i, j).join('-');
      const segment = tokens[i] === '' ? `.${joined.slice(1)}` : joined;
      if (segment === '.' || segment === '') continue;
      const next = path.join(base, segment);
      if (!exists(next)) continue;
      const found = walk(next, j);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(path.sep, 0);
}

const isGsdProject = (root) => {
  const stack = readConfig(root)?.stack;
  return stack !== null && typeof stack === 'object' && typeof stack.preset === 'string' && stack.preset.length > 0;
};

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

// Pure given its inputs: `names` are the directory names, `registered` the registered roots, `exists` and `isProject`
// the filesystem reads. Returns the sorted roots of GSD projects that are not registered (a worktree inside a registered root is covered by it).
function unregisteredRoots({ names, registered, exists = isDir, isProject = isGsdProject }) {
  const known = registered.map(real);
  return [...new Set(names.map((n) => decode(n, exists)).filter((r) => r !== null).map(real))]
    .filter((root) => !known.some((k) => inside(root, k)))
    .filter(isProject)
    .sort();
}

function claudeProjectNames(env) {
  const base = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude');
  try {
    return fs.readdirSync(path.join(base, 'projects'));
  } catch {
    return [];
  }
}

module.exports = { unregisteredRoots, claudeProjectNames, decode };
