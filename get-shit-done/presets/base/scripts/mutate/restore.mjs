// mutate/restore: the boundary of the mutation tool. The target file is edited in place, so everything that puts it back
// lives here: a sha-checked restore, a scope that restores on every exit path, and a signal handler that restores whatever
// is still mutated. process.mjs registers its live test process groups here so a signal can kill them.
import fs from 'node:fs/promises';
import { sha256Hex } from './classify.mjs';

export class RestoreError extends Error {}

const defaultIo = { write: (p, data) => fs.writeFile(p, data), read: (p) => fs.readFile(p) };

/** Writes the original bytes back and asserts the restored sha256 matches; throws RestoreError otherwise. */
export async function restoreFile(path, original, expectedSha, io = defaultIo) {
  let actual;
  try {
    await io.write(path, original);
    actual = sha256Hex(await io.read(path));
  } catch (e) {
    throw new RestoreError(`restore I/O failed for ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (actual !== expectedSha) throw new RestoreError(`restore mismatch for ${path}: expected ${expectedSha}, got ${actual}`);
  return actual;
}

// Process-group ids of live test children, so a signal can kill them.
const liveGroups = new Set();
export const registerGroup = (pgid) => liveGroups.add(pgid);
export const unregisterGroup = (pgid) => liveGroups.delete(pgid);

/** SIGKILLs a whole process group; alsoLeader also targets the pid itself (a child that has not yet become a leader). */
export function killGroup(pgid, alsoLeader = false) {
  for (const target of alsoLeader ? [-pgid, pgid] : [-pgid]) {
    try { process.kill(target, 'SIGKILL'); } catch { /* group already gone */ }
  }
}

// Set when a shutdown signal arrives: no new test run or mutation may start, and the main flow parks (never resumes) so
// the signal handler alone decides the exit code.
let stopping = false;
export const isStopping = () => stopping;
/** Never settles: the signal handler owns the process from here and ends it with process.exit. */
export const parked = () => new Promise(() => {});

// Mutations whose restore is still owed, with their in-flight apply.
const activeMutations = new Map();

/** Applies `m`, runs `body`, and always restores before returning or rethrowing. */
export async function withActiveMutation(m, body) {
  if (stopping) return parked();
  const applied = m.apply();
  activeMutations.set(m, applied);
  try {
    await applied;
    return await body();
  } finally {
    await m.restore();
    activeMutations.delete(m);
  }
}

/** The mutations still owed a restore (read-only view for tests). */
export const activeCount = () => activeMutations.size;

const SIGNALS = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]];
const SIGNAL_SETTLE_MS = 5000;

/**
 * On SIGINT/SIGTERM/SIGHUP: stop the main flow, kill live test process groups, wait for any in-flight mutation write,
 * restore whichever source file is still mutated (sha-checked), exit 128+n (3 if a restore failed).
 * Returns a disposer that removes the listeners.
 */
export function installSignalRestore() {
  const restoreActive = () => Promise.all([...activeMutations.keys()].map((a) => restoreFile(a.path, a.original, a.sha).then(
    async () => {
      if (a.backup) await fs.rm(a.backup, { force: true });
      return `restored ${a.path}`;
    },
    (e) => `RESTORE FAILED ${a.path}: ${e.message}`,
  )));
  const handle = async (name, code) => {
    stopping = true;
    for (const g of liveGroups) killGroup(g, true);
    let timer;
    await Promise.race([Promise.allSettled([...activeMutations.values()]), new Promise((r) => { timer = setTimeout(r, SIGNAL_SETTLE_MS); })]);
    clearTimeout(timer);
    const results = await restoreActive();
    console.error(`[mutate] ${name}: ${results.join('; ') || 'no active mutation'}`);
    process.exit(results.some((r) => r.startsWith('RESTORE FAILED')) ? 3 : code);
  };
  const listeners = SIGNALS.map(([name, code]) => {
    const fn = () => { void handle(name, code); };
    process.on(name, fn);
    return [name, fn];
  });
  return () => listeners.forEach(([name, fn]) => process.removeListener(name, fn));
}
