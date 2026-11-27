'use strict';

// The git side of `project upgrade`: which of the paths it would write have uncommitted changes, and the one commit per
// project. Every call names explicit pathspecs, so a change the upgrade did not make is never committed.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

const isRepo = (root) => git(root, ['rev-parse', '--is-inside-work-tree']).out === 'true';

// Porcelain lines of the paths with uncommitted changes (including untracked); [] outside a repo.
function dirtyLines(root, paths) {
  if (paths.length === 0 || !isRepo(root)) return [];
  const r = git(root, ['status', '--porcelain', '--', ...paths]);
  return r.ok && r.out.length > 0 ? r.out.split('\n') : [];
}

// Paths git can take: not ignored, and either on disk or still tracked (a deleted file).
const committable = (root, paths) => paths.filter((p) => !git(root, ['check-ignore', '-q', '--', p]).ok
  && (fs.existsSync(path.join(root, p)) || git(root, ['ls-files', '--', p]).out.length > 0));

// { committed: true, sha } | { committed: false, note } | { error }
function commitPaths(root, paths, message) {
  if (!isRepo(root)) return { committed: false, note: 'not a git repository' };
  if (!git(root, ['symbolic-ref', '-q', 'HEAD']).ok) return { committed: false, note: 'detached HEAD' };
  const tracked = committable(root, paths);
  if (dirtyLines(root, tracked).length === 0) return { committed: false, note: 'nothing to commit' };
  const added = git(root, ['add', '-A', '--', ...tracked]);
  if (!added.ok) return { error: `git add failed: ${added.err}` };
  const done = git(root, ['commit', '-m', message, '--', ...tracked]);
  if (!done.ok) return { error: `git commit failed: ${done.err || done.out}` };
  return { committed: true, sha: git(root, ['rev-parse', 'HEAD']).out };
}

module.exports = { dirtyLines, commitPaths, isRepo };
