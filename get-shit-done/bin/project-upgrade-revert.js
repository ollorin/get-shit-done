'use strict';

// Reverts the project commits of one framework upgrade record, after the framework itself was rolled back. Every
// project needs a clean tree and a branch that
// holds the commit; a refusal prints the exact command instead and the other projects go on.

const { git, isRepo } = require('./project-upgrade-git.js');
const { commitsOfRecord, revertCommand } = require('./project-upgrade-log.js');

// The reason this commit may not be reverted now, or null.
function refusalFor(c) {
  if (!isRepo(c.root)) return `${c.root} is not a git repository`;
  if (!git(c.root, ['merge-base', '--is-ancestor', c.sha, 'HEAD']).ok) return `the checked-out branch does not contain ${c.sha}`;
  return git(c.root, ['status', '--porcelain', '--untracked-files=no']).out.length > 0 ? 'the working tree has uncommitted changes' : null;
}

function revertOne(c) {
  const why = refusalFor(c);
  if (why !== null) return { ok: false, line: `not reverted ${c.name}: ${why}; run: ${revertCommand(c)}` };
  const done = git(c.root, ['revert', '--no-edit', c.sha]);
  if (done.ok) return { ok: true, line: `reverted ${c.name}: ${c.sha}` };
  git(c.root, ['revert', '--abort']);
  return { ok: false, line: `revert failed ${c.name}: ${done.err}; run: ${revertCommand(c)}` };
}

// { ok, lines }: ok is false when any commit was left for the owner to revert.
function revertRecord({ dir, recordId }) {
  const results = commitsOfRecord(dir, recordId).map(revertOne);
  return { ok: results.every((r) => r.ok), lines: results.map((r) => r.line) };
}

module.exports = { revertRecord };
