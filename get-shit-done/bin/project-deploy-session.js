'use strict';

const { spawnSync } = require('child_process');

const PS_LINE_RE = /^\s*(\d+)\s+(\d+)\s+(.*)$/;
const AGENT_RE = /^claude/i;
const MAX_HOPS = 64;

function parsePs(psOutput) {
  const table = new Map();
  for (const line of psOutput.split('\n')) {
    const m = PS_LINE_RE.exec(line);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3] });
  }
  return table;
}

function agentAncestor(psOutput, pid) {
  if (typeof psOutput !== 'string') return true;
  const table = parsePs(psOutput);
  if (table.size === 0 || !table.has(pid)) return true;
  let cur = pid;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const entry = table.get(cur);
    if (entry === undefined) return false;
    const name = entry.comm.slice(entry.comm.lastIndexOf('/') + 1);
    if (AGENT_RE.test(name)) return true;
    if (cur <= 1) return false;
    cur = entry.ppid;
  }
  return true;
}

function psStdout() {
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' });
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
  };
}

function guardFailures(env, session) {
  return [
    ...(env.CLAUDECODE !== undefined ? ['env'] : []),
    ...(session.stdin_tty !== true ? ['stdin_tty'] : []),
    ...(session.stdout_tty !== true ? ['stdout_tty'] : []),
    ...(session.agent_ancestor !== false ? ['agent_ancestor'] : []),
  ];
}

module.exports = { agentAncestor, detectSession, guardFailures };
