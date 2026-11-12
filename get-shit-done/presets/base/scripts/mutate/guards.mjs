// mutate/guards: the run-level refusals made before anything is edited. Each returns a message, or null when clear.
// Exit 2 in the CLI: leftover <out>.restore/, a dirty/untracked/ignored target, the primary worktree, a target outside
// --root, an --out that would overwrite a source file.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fail, isDirtyPorcelain, ok } from './classify.mjs';
import { defaultTempBases, inspectRoot, primaryRefusal } from './worktree.mjs';

const run = promisify(execFile);

async function gitStatus(root, file) {
  try {
    const { stdout } = await run('git', ['-C', root, 'status', '--porcelain', '--ignored', '--', file]);
    return ok(stdout);
  } catch {
    return fail(`git status failed for ${file}`);
  }
}

/** Result of the target files (relative paths) that are modified, untracked, staged or ignored. */
export async function dirtyTargets(root, mutants) {
  const files = [...new Set(mutants.map((m) => m.file))];
  const statuses = await Promise.all(files.map((f) => gitStatus(root, f)));
  const failed = statuses.find((s) => !s.ok);
  if (failed) return fail(failed.error);
  return ok(files.filter((_, i) => isDirtyPorcelain(statuses[i].value)));
}

export const runSummaryPath = (outPath) => `${outPath}.run.json`;

/** --out is truncated and written beside <out>.run.json and <out>.restore/; it may never be a source file or the mutants file. */
export function outPathError(opts, mutants) {
  const protectedPaths = new Set([
    path.resolve(opts.mutantsPath),
    ...mutants.flatMap((m) => [path.resolve(opts.root, m.file), path.resolve(opts.root, m.test)]),
  ]);
  const clash = [opts.outPath, runSummaryPath(opts.outPath)].find((p) => protectedPaths.has(path.resolve(p)));
  return clash === undefined ? null : `--out ${clash} would overwrite the mutants file, a target or a test file`;
}

/** The primary-worktree refusal, unless --allow-primary or --dry-run. */
export async function primaryError(opts, tempBases) {
  if (opts.dryRun || opts.allowPrimary) return null;
  const info = await inspectRoot(opts.root);
  return info.ok ? primaryRefusal(info.value, tempBases ?? await defaultTempBases()) : info.error;
}

/** A non-empty <out>.restore/ holds original bytes from a run cut short; reusing it would overwrite them. */
export async function staleBackupError(outPath) {
  const dir = `${outPath}.restore`;
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.length === 0 ? null : `${dir} holds backups from a run cut short; restore the targets from it, then delete it`;
}

/** A target (or its test) that is not a plain path inside --root: absolute, `..`, backslash, or a symlink leading out. */
export async function outsideRootError(root, mutants) {
  const rootReal = await fs.realpath(root).catch(() => null);
  if (rootReal === null) return `--root ${root} is not readable`;
  for (const file of new Set(mutants.flatMap((m) => [m.file, m.test]))) {
    if (path.isAbsolute(file) || file.includes('\\') || file.split('/').some((seg) => seg === '..' || seg === '')) return `unsafe path outside --root: ${file}`;
    const real = await fs.realpath(path.join(root, file)).catch(() => null);
    if (real !== null && !real.startsWith(rootReal + path.sep)) return `${file} resolves outside --root (symlink)`;
  }
  return null;
}

/** Runs every distinct test file unmutated through runTest; the message of the first non-green one, or null. */
export async function baselineError(runTest, label, root, tests, timeoutMs, config) {
  for (const test of tests) {
    const baseline = await runTest(root, test, timeoutMs, config);
    if (baseline.outcome !== 'survived') return `baseline red ${label}: ${test} fails unmutated (${baseline.outcome})`;
    console.log(`[mutate] baseline green ${label}: ${test} (${baseline.durationMs} ms)`);
  }
  return null;
}

/** Written when a run finishes: its absence means the run was cut short and its JSONL is not citable. */
export const writeRunSummary = (outPath, summary) => fs.writeFile(runSummaryPath(outPath), `${JSON.stringify(summary, null, 2)}\n`);
