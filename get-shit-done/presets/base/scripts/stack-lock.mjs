// Serialises shared-stack mutations: runs a command while holding the exclusive stack lock.
// Entry point: scripts/stack-lock.sh (the command hook recognises a wrapped command only by that name).
//
// Design: the lock is the file --lock-file, created with the atomic exclusive create (flag 'wx') and holding one JSON
// line { pid, label, start }, rewritten with childPid once the command is spawned. Waiters retry every 200 ms. A holder is alive while either its wrapper pid or its
// command pid answers kill(pid, 0) (ESRCH means gone; EPERM means alive); only a holder with both gone is taken over: a waiter makes the directory <lock-file>.takeover (atomic), re-reads the lock
// file, unlinks it only if it still holds the same dead holder, removes the directory, then goes back to the
// exclusive create. The lock is never handed over directly. owner.txt is informational and is never read.
//
// Stated limits (exclusion is "at most one live holder under normal scheduling", not a kernel guarantee):
//  1. A recycled pid looks alive: the waiter times out with exit 75 (the safe direction).
//  2. An empty or non-JSON lock file is treated as held until it is older than 10 s (the window between create and
//     write), then as dead. A process paused (stopped, or starved) for more than 10 s inside that window is judged
//     dead, its file is unlinked and a second holder can run beside it.
//  3. Liveness is a local kill(pid, 0): the lock is only valid for processes on one machine and one pid namespace
//     (not across containers, and not on a network filesystem).
//  4. Takeover is not a kernel lock: the <lock-file>.takeover directory is itself treated as stale after 10 s, and a
//     waiter paused for more than 10 s between re-reading the lock file and unlinking it can unlink a live holder's
//     newer lock file. The window needs a stalled waiter and a takeover by another waiter inside it.
//  5. SIGKILL of the wrapper leaves the command running; the lock then stays held while the command pid lives, but
//     not for grandchildren the command leaves behind after it exits.
//  6. A killed wrapper that is a zombie (not yet reaped by its parent) still answers kill(pid, 0), so it keeps the lock
//     until the parent reaps it. A SIGKILL between spawn and the childPid rewrite of the lock file leaves a window in
//     which only the wrapper pid is recorded.
// HUP, INT, QUIT and TERM to the wrapper are forwarded to the command; the lock file is released after it exits.
// A SIGKILLed wrapper leaves the lock file; the next waiter takes over once the wrapper and the command are both gone.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGQUIT: 131 };
const FORWARDED = Object.keys(SIGNAL_EXIT);

const DEFAULT_TIMEOUT_S = 3600;
const EXIT_INTERNAL = 1;
const EXIT_USAGE = 2;
const EXIT_TIMEOUT = 75;
const EXIT_SPAWN_FAILED = 127;
const POLL_MS = 200;
const STALE_MS = 10000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOCK_FILE = path.join(REPO_ROOT, '.tmp', 'stack.lock');
const DEFAULT_OWNER_FILE = path.join(REPO_ROOT, '.tmp', 'stack.lock.d', 'owner.txt');
const FLAG_NAMES = ['--label', '--timeout', '--lock-file', '--owner-file'];

// An empty owner.txt is the idle state (cleared on release); never hand-write or delete it.
export const USAGE = [
  'usage: stack-lock.sh --label <name> [--timeout <seconds>] -- <command> [args...]',
  '  Runs <command> while holding the exclusive stack lock; the only supported way to take it.',
  '  Exit 75 = timed out waiting, 2 = usage error, 127 = spawn failed. Flags: ' + FLAG_NAMES.join(' '),
].join('\n');

const readFlags = (args, acc) =>
  args.length === 0
    ? { ok: true, value: acc }
    : !FLAG_NAMES.includes(args[0])
      ? { ok: false, error: `unknown argument ${args[0]}` }
      : args.length < 2
        ? { ok: false, error: `${args[0]} requires a value` }
        : readFlags(args.slice(2), { ...acc, [args[0]]: args[1] });

export const parseArgs = (args) => {
  const sep = args.indexOf('--');
  if (sep === -1) return { ok: false, error: 'missing -- <command>' };
  const cmd = args.slice(sep + 1);
  if (cmd.length === 0) return { ok: false, error: 'empty command after --' };
  const flags = readFlags(args.slice(0, sep), {});
  if (!flags.ok) return flags;
  const label = flags.value['--label'];
  const timeout = Number(flags.value['--timeout'] ?? DEFAULT_TIMEOUT_S);
  if (!label) return { ok: false, error: '--label is required' };
  if (!Number.isInteger(timeout) || timeout < 1) return { ok: false, error: '--timeout must be a positive integer' };
  return {
    ok: true,
    value: {
      label,
      timeout,
      lockFile: flags.value['--lock-file'] ?? DEFAULT_LOCK_FILE,
      ownerFile: flags.value['--owner-file'] ?? DEFAULT_OWNER_FILE,
      cmd,
    },
  };
};

export const ownerRecord = (pid, label, start, command) => ({ pid, label, start, command });

export const exitCodeFor = (timedOut, code) => (timedOut ? EXIT_TIMEOUT : code);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pidLives = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
};

// 'alive' | 'dead' for a lock file's raw text; mtimeMs only matters for an empty or non-JSON file.
export const classify = (raw, mtimeMs, now = Date.now()) => {
  let pids = [];
  try {
    const parsed = JSON.parse(raw);
    pids = [parsed?.pid, parsed?.childPid].filter((p) => Number.isInteger(p) && p > 0);
  } catch {
    pids = [];
  }
  if (pids.length === 0) return now - mtimeMs > STALE_MS ? 'dead' : 'alive';
  return pids.some(pidLives) ? 'alive' : 'dead';
};

const readLock = (lockFile) => {
  try {
    return { raw: fs.readFileSync(lockFile, 'utf8'), mtimeMs: fs.statSync(lockFile).mtimeMs };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};

const tryCreate = (lockFile, record) => {
  let fd;
  try {
    fd = fs.openSync(lockFile, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
  try {
    fs.writeSync(fd, JSON.stringify(record) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  return true;
};

export const takeover = (lockFile, snapshotRaw) => {
  const dir = `${lockFile}.takeover`;
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmdirSync(dir);
    } catch {
      // another waiter finished first
    }
    return;
  }
  try {
    const again = readLock(lockFile);
    if (again !== null && again.raw === snapshotRaw && classify(again.raw, again.mtimeMs) === 'dead') {
      try {
        fs.unlinkSync(lockFile);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  } finally {
    try {
      fs.rmdirSync(dir);
    } catch {
      // already removed as stale
    }
  }
};

const acquire = async (lockFile, record, timeoutS) => {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    if (tryCreate(lockFile, record)) return 'held';
    const held = readLock(lockFile);
    if (held === null) continue;
    if (classify(held.raw, held.mtimeMs) === 'dead') {
      takeover(lockFile, held.raw);
      if (readLock(lockFile) === null) continue;
    }
    if (Date.now() >= deadline) return 'timeout';
    await sleep(POLL_MS);
  }
};

// Rewrites the lock file we hold with the command pid (temp file + rename: a waiter never reads a partial record).
const recordChild = (lockFile, record, childPid) => {
  const tmp = `${lockFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...record, childPid }) + '\n');
    fs.renameSync(tmp, lockFile);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to remove */ }
  }
};

const release = (lockFile) => {
  try {
    const held = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (held?.pid === process.pid) fs.unlinkSync(lockFile);
  } catch {
    // already gone, or not ours
  }
};

const runChild = (cmd, onChild) =>
  new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, STACK_LOCK_HELD: '1' } });
    child.once('error', (e) => resolve({ ok: false, error: String(e) }));
    child.once('close', (code, signal) =>
      resolve({ ok: true, value: code ?? 128 + (os.constants.signals[signal] ?? 0) }));
    if (child.pid !== undefined) onChild(child);
  });

const run = async (args) => {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    console.error(`stack-lock: ${parsed.error}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const { label, timeout, lockFile, ownerFile, cmd } = parsed.value;
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.mkdirSync(path.dirname(ownerFile), { recursive: true });
  } catch (e) {
    console.error(`stack-lock: ${e.message}`);
    return EXIT_INTERNAL;
  }
  const start = new Date().toISOString();
  let got;
  try {
    got = await acquire(lockFile, { pid: process.pid, label, start }, timeout);
  } catch (e) {
    console.error(`stack-lock: ${e.message}`);
    return EXIT_INTERNAL;
  }
  if (got === 'timeout') {
    console.error(`stack-lock: timed out after ${timeout}s waiting for ${lockFile}`);
    return exitCodeFor(true, 0);
  }

  // Informational only: owner.txt is never read to decide anything, so a failed write is not fatal.
  try {
    fs.writeFileSync(ownerFile, JSON.stringify(ownerRecord(process.pid, label, start, cmd.join(' '))) + '\n');
  } catch {
    // informational
  }
  let received = null;
  let live = null;
  const handlers = FORWARDED.map((s) => {
    const handler = () => {
      received = s;
      if (live) live.kill(s);
    };
    process.on(s, handler);
    return { s, handler };
  });
  const result = await runChild(cmd, (child) => {
    live = child;
    recordChild(lockFile, { pid: process.pid, label, start }, child.pid);
    if (received) child.kill(received);
  });
  handlers.forEach(({ s, handler }) => process.removeListener(s, handler));
  try {
    fs.writeFileSync(ownerFile, '');
  } catch {
    // informational
  }
  release(lockFile);

  if (!result.ok) {
    console.error(`stack-lock: ${result.error}`);
    return EXIT_SPAWN_FAILED;
  }
  return received ? SIGNAL_EXIT[received] : exitCodeFor(false, result.value);
};

const isMain = () => {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
};

if (isMain()) process.exit(await run(process.argv.slice(2)));
