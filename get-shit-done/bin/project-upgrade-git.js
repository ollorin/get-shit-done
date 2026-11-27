'use strict';

// The git side of `project upgrade`: which of the paths it would write have uncommitted changes, and the one commit per
// project. Every call names explicit pathspecs, so a change the upgrade did not make is never committed. A commit that
// fails (a pre-commit hook, say) puts every touched path back as it was.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

const lines = (text) => (text.length > 0 ? text.split('\n') : []);

const isRepo = (root) => git(root, ['rev-parse', '--is-inside-work-tree']).out === 'true';
const onBranch = (root) => git(root, ['symbolic-ref', '-q', 'HEAD']).ok;

// Porcelain lines of the paths with uncommitted changes (including untracked); [] outside a repo.
function dirtyLines(root, paths) {
  if (paths.length === 0 || !isRepo(root)) return [];
  const r = git(root, ['status', '--porcelain', '--', ...paths]);
  return r.ok && r.out.length > 0 ? r.out.split('\n') : [];
}

// Paths git can take: not ignored, and either on disk or still tracked (a deleted file).
const committable = (root, paths) => paths.filter((p) => !git(root, ['check-ignore', '-q', '--', p]).ok
  && (fs.existsSync(path.join(root, p)) || git(root, ['ls-files', '--', p]).out.length > 0));

// Untracked, not-ignored files under the paths: the pre-image of what the upgrade may create. Take it before any write.
const untrackedUnder = (root, paths) => (paths.length === 0 || !isRepo(root) ? []
  : lines(git(root, ['ls-files', '--others', '--exclude-standard', '--', ...paths]).out));

// Puts the paths back: unstage, restore what HEAD tracks, delete what appeared since `before`. Returns the failures.
function restorePaths(root, paths, before) {
  git(root, ['reset', '-q', '--', ...paths]);
  const tracked = lines(git(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', ...paths]).out);
  const restored = tracked.length === 0 ? { ok: true, err: '' } : git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked]);
  const created = untrackedUnder(root, paths).filter((f) => !before.includes(f));
  const removals = created.flatMap((f) => {
    try {
      fs.rmSync(path.join(root, f), { force: true });
      return [];
    } catch (e) {
      return [`${f}: ${e.message}`];
    }
  });
  return [...(restored.ok ? [] : [restored.err]), ...removals];
}

// { committed: true, sha } | { committed: false, note } | { error }. `before` is untrackedUnder(root, paths) from before the writes.
function commitPaths(root, paths, message, before = []) {
  if (!isRepo(root)) return { committed: false, note: 'not a git repository' };
  if (!onBranch(root)) return { committed: false, note: 'detached HEAD' };
  const tracked = committable(root, paths);
  if (dirtyLines(root, tracked).length === 0) return { committed: false, note: 'nothing to commit' };
  const added = git(root, ['add', '-A', '--', ...tracked]);
  const done = added.ok ? git(root, ['commit', '-m', message, '--', ...tracked]) : added;
  if (done.ok) return { committed: true, sha: git(root, ['rev-parse', 'HEAD']).out };
  const left = restorePaths(root, tracked, before);
  const why = [done.err, done.out].filter(Boolean).join('\n');
  const state = left.length === 0 ? "the upgrade's files were restored" : `restoring failed for: ${left.join('; ')}`;
  return { error: `git ${added.ok ? 'commit' : 'add'} failed, ${state}:\n${why}` };
}

// The fork's own HEAD sha, or 'unknown' when `dir` is not the top of a git work tree.
function forkSha(dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  const sha = git(dir, ['rev-parse', 'HEAD']);
  return top.ok && sha.ok && fs.realpathSync(top.out) === fs.realpathSync(dir) ? sha.out : 'unknown';
}

module.exports = { dirtyLines, commitPaths, untrackedUnder, isRepo, onBranch, forkSha, git };
