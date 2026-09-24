#!/usr/bin/env node
/**
 * GSD Charlotte DB-reset lock.
 *
 * One hook file, dispatched on hook_event_name:
 *   PreToolUse  mcp__charlotte__.*      -> take/refresh <repo>/.tmp/charlotte.lock
 *   SubagentStart gsd-charlotte-qa      -> take the lock
 *   SubagentStop  gsd-charlotte-qa      -> release it if this agent holds it
 *   PreToolUse  Bash                    -> exit 2 on a DB-reset command while the
 *                                          lock is unexpired AND its PID is alive
 *
 * Fails open (exit 0) on any internal error; fails closed only on a positive
 * match against a live lock.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCK_REL = path.join('.tmp', 'charlotte.lock');
const DEFAULT_TTL_SEC = 1800;
const CHARLOTTE_AGENT = 'gsd-charlotte-qa';
const WRAPPER_COMMS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'timeout', 'gtimeout', 'env']);

const PREFIX = String.raw`(?:^|[;&|\n(\x60]|\$\(|(?:-c|eval)\s+["'])\s*`;
const RUNNER = String.raw`(?:(?:npx|pnpx|bunx|sudo|exec|time|command)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*|(?:pnpm|yarn|npm)\s+(?:exec\s+|dlx\s+)?(?:-{1,2}[\w-]+(?:=\S+)?\s+)*|env\s+(?:\w+=\S*\s+)*|\w+=\S*\s+)*`;
const RESET_PATTERNS = [
  new RegExp(PREFIX + RUNNER + String.raw`(?:\S*/)?supabase(?:@\S+)?\s+(?:[^;&|\n]*?\s)?db\s+reset\b`),
  new RegExp(PREFIX + RUNNER + String.raw`(?:\S*/)?nx\s+[^;&|\n]*?\b(?:supabase|db)[:-]reset\b`),
  new RegExp(PREFIX + String.raw`(?:npm|pnpm|yarn|bun|deno)\s+(?:run|task)\s+[\w:.-]*\b(?:supabase|db)[:-]reset\b`),
  new RegExp(PREFIX + String.raw`(?:(?:ba)?sh\s+)?(?:\S*/)?preflight\.sh\b`),
];

function isDbResetCommand(command) {
  if (typeof command !== 'string' || !command) return false;
  return RESET_PATTERNS.some(re => re.test(command));
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
// that is not a shell/timeout wrapper: the Claude Code process.
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

function lockPath(root) {
  return path.join(root, LOCK_REL);
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

function buildLock({ pid, nowMs, ttlSec, source, agentId, sessionId }) {
  return {
    pid,
    acquired_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + ttlSec * 1000).toISOString(),
    source,
    agent_id: agentId || null,
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
    'BLOCKED: database reset while a Charlotte QA run holds the DB lock.',
    '',
    `  Lock:    ${file}`,
    `  Holder:  pid ${lock.pid} (${lock.source}${lock.agent_id ? `, agent ${lock.agent_id}` : ''})`,
    `  Expires: ${lock.expires_at}`,
    '',
    'A reset mid-run wipes the state Charlotte scenarios depend on and turns their results into noise.',
    'Allowed path: run the suite-start reset BEFORE spawning gsd-charlotte-qa or making the first',
    'Charlotte tool call, then wait for the run to finish (the lock is released on SubagentStop,',
    'expires at the time above, or is ignored once the holder PID exits). Do not delete the lock file.',
  ].join('\n');
}

function isCharlotteAgent(input) {
  return typeof input.agent_type === 'string' && input.agent_type.split(':').pop() === CHARLOTTE_AGENT;
}

// Returns { exitCode, stderr } so tests can drive every branch without spawning.
function handle(input, deps = {}) {
  const env = deps.env || process.env;
  const nowMs = deps.nowMs !== undefined ? deps.nowMs : Date.now();
  const pidAlive = deps.isPidAlive || isPidAlive;
  const root = (deps.resolveProjectRoot || resolveProjectRoot)(input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd());
  const file = lockPath(root);
  const holderPid = () => (deps.holderPid !== undefined ? deps.holderPid : resolveHolderPid(process.ppid));
  const event = input.hook_event_name;
  const tool = input.tool_name || '';

  if (event === 'PreToolUse' && tool === 'Bash') {
    const command = input.tool_input && input.tool_input.command;
    if (!isDbResetCommand(command)) return { exitCode: 0 };
    const lock = readLock(file);
    if (!isLockLive(lock, nowMs, pidAlive)) return { exitCode: 0 };
    return { exitCode: 2, stderr: blockMessage(file, lock) };
  }

  const acquire = (event === 'PreToolUse' && tool.startsWith('mcp__charlotte__')) ||
    (event === 'SubagentStart' && isCharlotteAgent(input));
  if (acquire) {
    const existing = readLock(file);
    // Refresh keeps an agent-held lock attributed to that agent so its
    // SubagentStop can release it.
    const keepAgent = existing && isLockLive(existing, nowMs, pidAlive) && !input.agent_id ? existing.agent_id : null;
    writeLock(file, buildLock({
      pid: holderPid(),
      nowMs,
      ttlSec: ttlSeconds(env),
      source: event === 'SubagentStart' ? 'subagent' : 'mcp',
      agentId: input.agent_id || keepAgent,
      sessionId: input.session_id,
    }));
    return { exitCode: 0 };
  }

  if (event === 'SubagentStop' && isCharlotteAgent(input)) {
    const lock = readLock(file);
    if (lock && lock.agent_id && lock.agent_id === input.agent_id) {
      fs.rmSync(file, { force: true });
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
      process.stderr.write(`[gsd-charlotte-lock] internal error, failing open: ${e && e.message}\n`);
      process.exit(0);
    }
    if (result.stderr) process.stderr.write(result.stderr + '\n');
    process.exit(result.exitCode);
  });
}

module.exports = {
  isDbResetCommand,
  resolveHolderPid,
  isLockLive,
  buildLock,
  readLock,
  handle,
  LOCK_REL,
};

if (require.main === module) main();
