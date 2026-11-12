#!/usr/bin/env node
/**
 * GSD UI-QA lock hook (agnostic-M-02, E3).
 *
 * Active only when <cwd>/.planning/config.json has stack.capabilities.ui_qa as an object; without it the
 * hook exits 0 before anything else. With the capability, one file dispatched on hook_event_name:
 *   PreToolUse  <tool_prefix>*      -> take/refresh <repo>/<lock_file>
 *   SubagentStart <agent>           -> take the lock
 *   SubagentStop  <agent>           -> release it if this agent holds it
 *   PreToolUse  Bash                -> exit 2 on a reset command (reset_patterns) while the lock is
 *                                      unexpired AND its PID is alive
 *
 * Fails open (exit 0) on any internal error outside the Bash check. The Bash check reads the lock first and parses
 * only under a live lock; a matcher error or work-budget exhaustion there blocks (exit 2).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { matchesResetPattern } = require('./lib/ui-qa-match.js');

const DEFAULT_LOCK_REL = path.join('.tmp', 'ui-qa.lock');
const DEFAULT_TTL_SEC = 1800;
const WRAPPER_COMMS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'timeout', 'gtimeout', 'env']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The ui_qa capability, normalised. tool_prefix defaults to mcp__<driver>__; an explicit '' takes no PreToolUse lock.
function normalizeCapability(ui) {
  const driver = typeof ui.driver === 'string' ? ui.driver : '';
  return {
    agent: typeof ui.agent === 'string' ? ui.agent : '',
    toolPrefix: typeof ui.tool_prefix === 'string' ? ui.tool_prefix : `mcp__${driver}__`,
    resetPatterns: Array.isArray(ui.reset_patterns) ? ui.reset_patterns : [],
    lockWrappers: Array.isArray(ui.lock_wrappers) ? ui.lock_wrappers : [],
    lockFile: typeof ui.lock_file === 'string' ? ui.lock_file : DEFAULT_LOCK_REL,
  };
}

function readCapability(cwd) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8'));
  } catch {
    return null;
  }
  const ui = isPlainObject(config) && isPlainObject(config.stack) && isPlainObject(config.stack.capabilities)
    ? config.stack.capabilities.ui_qa
    : undefined;
  return isPlainObject(ui) ? normalizeCapability(ui) : null;
}

function ttlSeconds(env) {
  const n = Number(env.GSD_CHARLOTTE_LOCK_TTL_SEC);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function psLookup(pid) {
  const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim();
  const m = out.match(/^(\d+)\s+(.*)$/);
  return m ? { ppid: Number(m[1]), comm: path.basename(m[2].trim()) } : null;
}

// The hook process dies immediately, so the lock records the first ancestor
// that is not a shell/timeout wrapper: the agent host process.
function resolveHolderPid(startPid, lookup = psLookup) {
  let pid = startPid;
  for (let i = 0; i < 6 && pid > 1; i++) {
    let info;
    try { info = lookup(pid); } catch { info = null; }
    if (!info) return pid;
    if (!WRAPPER_COMMS.has(info.comm)) return pid;
    pid = info.ppid;
  }
  return startPid;
}

// Worktrees share the machine's local DB, so all of them use the main
// checkout's lock file.
function resolveProjectRoot(dir) {
  try {
    const common = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (path.basename(common) === '.git') return path.dirname(common);
  } catch { /* not a git repo */ }
  return dir;
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isLockLive(lock, nowMs, pidAlive = isPidAlive) {
  if (!lock || typeof lock !== 'object') return false;
  const expires = Date.parse(lock.expires_at);
  if (!Number.isFinite(expires) || expires <= nowMs) return false;
  return pidAlive(lock.pid);
}

// holders: agent_ids of live capability agents (released on their SubagentStop). main_thread: a driver
// call outside any subagent, which has no stop event and is released only by TTL expiry.
function buildLock({ pid, nowMs, ttlSec, source, agentId, sessionId, holders, mainThread }) {
  return {
    pid,
    acquired_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + ttlSec * 1000).toISOString(),
    source,
    holders: holders || (agentId ? [agentId] : []),
    main_thread: mainThread !== undefined ? mainThread : !agentId,
    session_id: sessionId || null,
  };
}

function writeLock(file, lock) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 2));
  fs.renameSync(tmp, file);
}

function blockMessage(file, lock) {
  return [
    'BLOCKED: database reset while a UI QA run holds the DB lock.',
    '',
    `  Lock:    ${file}`,
    `  Holder:  pid ${lock.pid} (${lock.source}; agents: ${(lock.holders || []).join(', ') || 'none'}${lock.main_thread ? '; main-thread' : ''})`,
    `  Expires: ${lock.expires_at}`,
    '',
    'A reset mid-run wipes the state the UI QA scenarios depend on and turns their results into noise.',
    'Allowed path: run the suite-start reset BEFORE spawning the UI QA agent or making the first',
    'driver call, then wait for the run to finish (the lock is released on SubagentStop,',
    'expires at the time above, or is ignored once the holder PID exits). A main-thread driver',
    'session has no stop event, so its lock lasts until the expiry (GSD_CHARLOTTE_LOCK_TTL_SEC).',
    'Do not delete the lock file.',
  ].join('\n');
}

const isAgent = (input, agent) => typeof input.agent_type === 'string' && input.agent_type.split(':').pop() === agent;

// Returns { exitCode, stderr } so tests can drive every branch without spawning.
function handle(input, deps = {}) {
  const env = deps.env || process.env;
  const cwd = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const capability = readCapability(cwd);
  if (!capability) return { exitCode: 0 };
  const nowMs = deps.nowMs !== undefined ? deps.nowMs : Date.now();
  const pidAlive = deps.isPidAlive || isPidAlive;
  const root = (deps.resolveProjectRoot || resolveProjectRoot)(cwd);
  const file = path.join(root, capability.lockFile);
  const holderPid = () => (deps.holderPid !== undefined ? deps.holderPid : resolveHolderPid(process.ppid));
  const event = input.hook_event_name;
  const tool = input.tool_name || '';

  if (event === 'PreToolUse' && tool === 'Bash') {
    const lock = readLock(file);
    if (!isLockLive(lock, nowMs, pidAlive)) return { exitCode: 0 };
    const command = input.tool_input && input.tool_input.command;
    // A matcher throw under a live lock blocks: the lock is the only thing the parse protects.
    let hit;
    try { hit = matchesResetPattern(command, capability); } catch { hit = true; }
    return hit ? { exitCode: 2, stderr: blockMessage(file, lock) } : { exitCode: 0 };
  }

  const acquire = (event === 'PreToolUse' && capability.toolPrefix !== '' && tool.startsWith(capability.toolPrefix)) ||
    (event === 'SubagentStart' && isAgent(input, capability.agent));
  if (acquire) {
    const existing = readLock(file);
    const live = isLockLive(existing, nowMs, pidAlive);
    const prevHolders = live && Array.isArray(existing.holders) ? existing.holders : [];
    const holders = input.agent_id && !prevHolders.includes(input.agent_id) ? [...prevHolders, input.agent_id] : prevHolders;
    writeLock(file, buildLock({
      pid: holderPid(),
      nowMs,
      ttlSec: ttlSeconds(env),
      source: event === 'SubagentStart' ? 'subagent' : 'mcp',
      sessionId: input.session_id,
      holders,
      mainThread: (live && existing.main_thread === true) || !input.agent_id,
    }));
    return { exitCode: 0 };
  }

  if (event === 'SubagentStop' && isAgent(input, capability.agent)) {
    const lock = readLock(file);
    if (!lock || !Array.isArray(lock.holders) || !lock.holders.includes(input.agent_id)) return { exitCode: 0 };
    const holders = lock.holders.filter(h => h !== input.agent_id);
    if (holders.length === 0 && lock.main_thread !== true) {
      fs.rmSync(file, { force: true });
    } else {
      writeLock(file, { ...lock, holders });
    }
    return { exitCode: 0 };
  }

  return { exitCode: 0 };
}

function main() {
  let raw = '';
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('end', () => {
    let result;
    try {
      result = handle(JSON.parse(raw));
    } catch (e) {
      process.stderr.write(`[gsd-ui-qa-lock] internal error, failing open: ${e && e.message}\n`);
      process.exit(0);
    }
    if (result.stderr) process.stderr.write(result.stderr + '\n');
    process.exit(result.exitCode);
  });
}

module.exports = {
  matchesResetPattern,
  normalizeCapability,
  readCapability,
  resolveHolderPid,
  isLockLive,
  buildLock,
  readLock,
  handle,
  DEFAULT_LOCK_REL,
};

if (require.main === module) main();
