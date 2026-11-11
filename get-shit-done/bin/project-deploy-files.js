'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function gitMergeFile(current, base, next, opts = {}) {
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  const gitBin = opts.gitBin ?? 'git';
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(tmpRoot, 'gsd-merge-'));
    const currentPath = path.join(dir, 'current');
    const basePath = path.join(dir, 'base');
    const nextPath = path.join(dir, 'next');
    fs.writeFileSync(currentPath, current);
    fs.writeFileSync(basePath, base);
    fs.writeFileSync(nextPath, next);
    const r = spawnSync(gitBin, ['merge-file', '-p', currentPath, basePath, nextPath]);
    if (r.status === 0) return { ok: true, content: r.stdout };
    if (Number.isInteger(r.status) && r.status >= 1 && r.status <= 127) return { ok: false, reason: 'merge conflict' };
    return { ok: false, reason: 'git merge-file failed' };
  } catch {
    return { ok: false, reason: 'git merge-file failed' };
  } finally {
    if (dir !== null) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function planWholeFile({ current, base, manifestHash, next, mergeFn = gitMergeFile }) {
  if (current === null) return { action: 'create', content: next };
  if (current.equals(next)) return { action: 'unchanged' };
  if (manifestHash && sha256(current) === manifestHash) return { action: 'overwrite', content: next };
  if (manifestHash && base) {
    const r = mergeFn(current, base, next);
    if (!r.ok) return { action: 'conflict', reason: r.reason };
    if (r.content.equals(current)) return { action: 'unchanged' };
    return { action: 'merge', content: r.content };
  }
  if (manifestHash) return { action: 'conflict', reason: 'merge base missing' };
  return { action: 'conflict', reason: 'exists and is not managed' };
}

module.exports = { sha256, gitMergeFile, planWholeFile };
