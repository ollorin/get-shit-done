'use strict';

const path = require('path');
const { canonicalRel, sameFile, fsFold } = require('./project-deploy-fs.js');
const { validateDest } = require('./project-deploy-render.js');

const HOOKS = '.claude/hooks';

const isGuardedCanon = (root, canon) => {
  const segs = canon.split('/');
  const hooks = path.join(root, HOOKS);
  return fsFold(canon).startsWith(`${HOOKS}/`)
    || segs.slice(0, -1).some((_, i) => sameFile(path.join(root, ...segs.slice(0, i + 1)), hooks));
};

function resolveOne(root, file, managed) {
  const r = canonicalRel(root, file);
  if (r.error) return { file, error: r.error };
  const shape = managed ? validateDest(r.canon) : null;
  return shape ? { file, error: shape } : { file, canon: r.canon };
}

function resolvePaths(root, { dests, bases, extra }) {
  const managed = dests.map((f) => resolveOne(root, f, true));
  const based = bases.map((f) => resolveOne(root, f, false));
  const others = extra.map((f) => resolveOne(root, f, false));
  const seen = new Set();
  const dupes = [...managed, ...based].filter((r) => r.canon !== undefined).flatMap((r) => {
    const key = fsFold(r.canon);
    if (seen.has(key)) return [{ file: r.file, reason: 'duplicate canonical path' }];
    seen.add(key);
    return [];
  });
  const errors = [...managed, ...based, ...others]
    .filter((r) => r.error)
    .map((r) => ({ file: r.file, reason: r.error }));
  return {
    errors: [...errors, ...dupes],
    guarded: new Set(managed.filter((r) => r.canon !== undefined && isGuardedCanon(root, r.canon)).map((r) => r.file)),
    canons: managed.filter((r) => r.canon !== undefined).map((r) => ({ file: r.file, canon: r.canon })),
  };
}

module.exports = { resolvePaths, isGuardedCanon };
