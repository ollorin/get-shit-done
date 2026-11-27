// SubagentStop hook: kills the wait-loop shells (until/while ... sleep) a stopped subagent left running.
// Input on stdin: { agent_id, agent_transcript_path }. Always exits 0; the hook must never block an agent.
// A process is killed only when its command text equals a Bash command in that agent's own transcript
// (after whitespace normalisation), directly or wrapped as `<shell> -c <cmd>` or `eval '<cmd>'`,
// and only when its parent is the hook's nearest `claude` ancestor (no such ancestor: nothing is killed).
// Residual risk: a sibling subagent of the same session running a byte-identical command is killed too.
// Every descendant and the whole tool-call process group of a matched loop is killed (intended: the agent has stopped).
import { readFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Command patterns (regexes) that also count as reapable, besides wait loops. Project-specific; empty here.
export const RUNNER_PATTERNS = [];

export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
const WAIT_LOOP = /\b(until|while)\b[\s\S]*\bsleep\b/;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

export const normalise = (text) => text.trim().replace(/\s+/g, ' ');

const parseLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

export function extractBashCommands(lines) {
  return lines.flatMap((line) => {
    const content = parseLine(line)?.message?.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((b) => (b?.type === 'tool_use' && b.name === 'Bash' && typeof b.input?.command === 'string' ? [normalise(b.input.command)] : []));
  });
}

export const reapable = (cmd) => WAIT_LOOP.test(cmd) || RUNNER_PATTERNS.some((p) => p.test(cmd));

// The two single-quote escapes a shell wrapper may use: '\'' and '"'"'.
const QUOTERS = [(s) => `'${s.replace(/'/g, `'\\''`)}'`, (s) => `'${s.replace(/'/g, `'"'"'`)}'`];

// True when the ps command text is exactly the transcript command, or that command handed to a shell.
export function commandMatches(psCommand, cmd) {
  const ps = normalise(psCommand);
  if (ps === cmd) return true;
  const wrapped = ps.match(/^(\S+)((?: -\w+)*) -c (.*)$/);
  if (wrapped && SHELLS.has(basename(wrapped[1])) && normalise(wrapped[3]) === cmd) return true;
  return QUOTERS.some((quote) => ps.includes(`eval ${quote(cmd)}`));
}

const isClaude = (command) => basename(command.trim().split(/\s+/)[0] ?? '') === 'claude';

// The pid of the nearest ancestor of ownPid whose executable is `claude`, or undefined.
export function claudePidOf(procs, ownPid) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const seen = new Set([ownPid]);
  for (let p = byPid.get(byPid.get(ownPid)?.ppid); p && p.pid > 1 && !seen.has(p.pid); p = byPid.get(p.ppid)) {
    if (isClaude(p.command)) return p.pid;
    seen.add(p.pid);
  }
  return undefined;
}

// procs: [{pid, ppid, pgid, command}]. Returns the pids to kill; never an own ancestor, itself or pid 0/1.
export function pidsToKill(commands, procs, ownPid, claudePid = claudePidOf(procs, ownPid)) {
  const loops = new Set(commands.filter(reapable));
  if (loops.size === 0 || claudePid === undefined) return [];
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const protectedPids = new Set([0, 1, ownPid]);
  for (let p = byPid.get(ownPid); p && !protectedPids.has(p.ppid); p = byPid.get(p.ppid)) protectedPids.add(p.ppid);
  const ownPgid = byPid.get(ownPid)?.pgid;
  const roots = procs.filter((p) => p.ppid === claudePid && !protectedPids.has(p.pid) && [...loops].some((c) => commandMatches(p.command, c)));
  const found = new Set(roots.map((p) => p.pid));
  const rootGroups = new Set(roots.map((p) => p.pgid).filter((g) => g !== ownPgid && g > 1));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs) {
      if (found.has(p.pid) || protectedPids.has(p.pid)) continue;
      if (found.has(p.ppid) || (rootGroups.has(p.pgid) && found.has(p.pgid))) {
        found.add(p.pid);
        grew = true;
      }
    }
  }
  return [...found];
}

export function listProcs() {
  const r = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return [];
  return r.stdout.split('\n').flatMap((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4] }] : [];
  });
}

function readTailLines(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - MAX_TRANSCRIPT_BYTES);
    const buf = Buffer.alloc(size - start);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, start + off);
      if (n === 0) break;
      off += n;
    }
    const lines = buf.subarray(0, off).toString('utf8').split('\n');
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    closeSync(fd);
  }
}

export function reap(stdinText, { procs = listProcs, kill = (pid) => process.kill(pid, 'SIGTERM'), ownPid = process.pid } = {}) {
  const input = parseLine(stdinText);
  const agentId = input?.agent_id;
  const transcript = input?.agent_transcript_path;
  if (typeof agentId !== 'string' || !/^[\w.-]+$/.test(agentId) || typeof transcript !== 'string' || transcript === '') return [];
  const commands = extractBashCommands(readTailLines(transcript));
  const targets = pidsToKill(commands, procs(), ownPid);
  for (const pid of targets) {
    try {
      kill(pid);
    } catch {
      // process already gone
    }
  }
  return targets;
}

// style-gate:edge process entry point; converts every failure into exit 0
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    reap(readFileSync(0, 'utf8'));
  } catch {
    // a hook must never block the agent
  }
  process.exit(0);
}
