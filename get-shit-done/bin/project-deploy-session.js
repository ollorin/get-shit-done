'use strict';

// Steering, not a boundary: an agent with a pty and a scrubbed env can still pass these checks.

const { spawnSync } = require('child_process');

const PS_LINE_RE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/;
const AGENT_RE = /(^|\/)claude(\s|$)|claude-code|@anthropic-ai|^claude/i;
const ENV_RE = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_AGENT_SDK)/;
const MAX_HOPS = 64;

function parsePs(psOutput) {
  const table = new Map();
  for (const line of psOutput.split('\n')) {
    const m = PS_LINE_RE.exec(line);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3], args: m[4] });
  }
  return table;
}

function isAgent(entry) {
  const base = entry.comm.slice(entry.comm.lastIndexOf('/') + 1);
  return AGENT_RE.test(base) || AGENT_RE.test(entry.args);
}

function agentAncestor(psOutput, pid) {
  if (typeof psOutput !== 'string') return true;
  const table = parsePs(psOutput);
  if (table.size === 0 || !table.has(pid)) return true;
  let cur = pid;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const entry = table.get(cur);
    if (entry === undefined) return true;
    if (isAgent(entry)) return true;
    if (cur <= 1) return false;
    cur = entry.ppid;
  }
  return true;
}

function isOrphan(psOutput, pid) {
  if (typeof psOutput !== 'string') return false;
  const entry = parsePs(psOutput).get(pid);
  return entry !== undefined && entry.ppid === 1;
}

function psStdout() {
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : '';
}

function detectSession(io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const pid = io.pid ?? process.pid;
  const psOutput = io.psOutput === undefined ? psStdout() : io.psOutput;
  return {
    stdin_tty: stdin.isTTY === true,
    stdout_tty: stdout.isTTY === true,
    agent_ancestor: agentAncestor(psOutput, pid),
    orphan: isOrphan(psOutput, pid),
  };
}

function guardFailures(env, session) {
  return [
    ...(Object.keys(env).some((k) => ENV_RE.test(k) && env[k] !== undefined) ? ['env'] : []),
    ...(session.stdin_tty !== true ? ['stdin_tty'] : []),
    ...(session.stdout_tty !== true ? ['stdout_tty'] : []),
    ...(session.agent_ancestor !== false ? ['agent_ancestor'] : []),
    ...(session.orphan === true ? ['orphan'] : []),
  ];
}

module.exports = { agentAncestor, detectSession, guardFailures };
