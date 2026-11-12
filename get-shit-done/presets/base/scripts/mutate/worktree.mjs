// mutate/worktree: the tool edits source in place, so it refuses the primary worktree of a repo (the shared checkout)
// unless that checkout lives under the OS temp directory.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { fail, ok } from './classify.mjs';

const run = promisify(execFile);

const isUnder = (p, dir) => p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

/** A linked worktree has its own git dir (<common>/worktrees/<name>); the primary's equals the common dir. */
export const isPrimaryWorktree = (info) => info.gitDir === info.commonDir;

/** The refusal message, or null when the root is a linked worktree or a temp copy. */
export const primaryRefusal = (info, tempBases) => (!isPrimaryWorktree(info) || tempBases.some((t) => isUnder(info.root, t))
  ? null
  : `${info.root} is the primary worktree of its repo; run in a linked worktree (git worktree add .tmp/wt-<name> HEAD) or a temp copy, or pass --allow-primary`);

/** { gitDir, commonDir, root } resolved through symlinks, or a failure when root is not inside a git worktree. */
export async function inspectRoot(root) {
  let stdout;
  try {
    ({ stdout } = await run('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']));
  } catch {
    return fail(`${root} is not inside a git worktree`);
  }
  const [gitDir, commonDir] = stdout.split('\n');
  if (!gitDir || !commonDir) return fail(`${root} is not inside a git worktree`);
  return ok({ gitDir: await fs.realpath(gitDir), commonDir: await fs.realpath(commonDir), root: await fs.realpath(root) });
}

/** The OS temp directory plus /tmp, resolved through symlinks; unresolvable entries are dropped. */
export async function defaultTempBases() {
  const bases = await Promise.all([os.tmpdir(), '/tmp'].map((p) => fs.realpath(p).catch(() => null)));
  return bases.filter((b) => b !== null);
}
