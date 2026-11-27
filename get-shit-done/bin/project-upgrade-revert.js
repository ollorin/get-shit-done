'use strict';

// Reverts the project commits of one framework upgrade record, after the framework itself was rolled back. Every
// project passes the same checks as the upgrade (human session, no live phase) plus a clean tree and a branch that
// holds the commit; a refusal prints the exact command instead and the other projects go on.

const { liveReasons } = require('./project-quiesce.js');
const { git, isRepo } = require('./project-upgrade-git.js');
const { commitsOfRecord, revertCommand } = require('./project-upgrade-log.js');
const { guardRefusal } = require('./project-upgrade.js');

// The reason this commit may not be reverted now, or null.
function refusalFor(c, { live, guard }) {
  if (guard) return guard;
  if (!isRepo(c.root)) return `${c.root} is not a git repository`;
  if (!git(c.root, ['merge-base', '--is-ancestor', c.sha, 'HEAD']).ok) return `the checked-out branch does not contain ${c.sha}`;
  if (git(c.root, ['status', '--porcelain', '--untracked-files=no']).out.length > 0) return 'the working tree has uncommitted changes';
  const reasons = liveReasons(c.root, live);
  return reasons.length > 0 ? `a phase is live (${reasons.join('; ')})` : null;
}

function revertOne(c, ctx) {
  const why = refusalFor(c, ctx);
  if (why !== null) return { ok: false, line: `not reverted ${c.name}: ${why}; run: ${revertCommand(c)}` };
  const done = git(c.root, ['revert', '--no-edit', c.sha]);
  if (done.ok) return { ok: true, line: `reverted ${c.name}: ${c.sha}` };
  git(c.root, ['revert', '--abort']);
  return { ok: false, line: `revert failed ${c.name}: ${done.err}; run: ${revertCommand(c)}` };
}

// { ok, lines }: ok is false when any commit was left for the owner to revert.
function revertRecord({ dir, recordId, env, session, live = {} }) {
  const commits = commitsOfRecord(dir, recordId);
  const ctx = { live, guard: commits.length > 0 ? guardRefusal(env, session, dir) : null };
  const results = commits.map((c) => revertOne(c, ctx));
  return { ok: results.every((r) => r.ok), lines: results.map((r) => r.line) };
}

module.exports = { revertRecord };
