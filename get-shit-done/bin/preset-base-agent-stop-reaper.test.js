'use strict';

// WP16: the SubagentStop reaper kills an agent's own wait-loop shells and nothing else.
// Real processes: every shell carries a unique sentinel path so no other process can match, and the hook
// runs under a stand-in `claude` process (a symlink to node) that is the parent of the loop shells.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'presets', 'base', 'hooks', 'agent-stop-reaper.mjs');
const tmps = [];
const kids = [];
afterEach(() => {
  while (kids.length > 0) {
    try { process.kill(-kids.pop(), 'SIGKILL'); } catch { /* already gone */ }
  }
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});
const mkTmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reaper-'))); tmps.push(d); return d; };

const loopCmd = (marker) => `until [ -f ${marker} ]; do sleep 1; done`;
const transcriptOf = (dir, commands) => {
  const file = path.join(dir, 'agent.jsonl');
  const lines = commands.map((command) => JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
};
const startShell = (command) => {
  const child = spawn('sh', ['-c', command], { detached: true, stdio: 'ignore' });
  kids.push(child.pid);
  return child.pid;
};
// A killed shell stays a zombie until its parent reaps it, and kill(pid, 0) still succeeds on a zombie.
const running = (pid) => {
  const stat = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  return stat !== '' && !stat.startsWith('Z');
};
const waitDead = async (pid) => {
  const until = Date.now() + 5000;
  while (running(pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
  return !running(pid);
};
const stopInput = (transcript) => JSON.stringify({ agent_id: 'agent-1', agent_transcript_path: transcript });

// The stand-in claude starts the loop shells as its children, waits for them to settle, runs the hook, waits
// for the signals to land, then exits (its orphans are reaped by init).
const FAKE_CLAUDE = `
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const [resultFile, hook, input, ...loops] = process.argv.slice(1);
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const pids = loops.map((c) => { const k = spawn('sh', ['-c', c], { detached: true, stdio: 'ignore' }); k.unref(); return k.pid; });
nap(1200);
const r = spawnSync(process.execPath, [hook], { input, encoding: 'utf8' });
nap(600);
fs.writeFileSync(resultFile, JSON.stringify({ pids, status: r.status, stderr: r.stderr }));
`;
function underClaude(dir, loops, input) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const claude = path.join(bin, 'claude');
  fs.symlinkSync(process.execPath, claude);
  const resultFile = path.join(dir, 'result.json');
  const r = spawnSync(claude, ['-e', FAKE_CLAUDE, resultFile, HOOK, input, ...loops], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  kids.push(...result.pids);
  assert.strictEqual(result.status, 0, result.stderr);
  return result.pids;
}

test('kills the shell whose command is in the agent transcript, plus its sleep child; a different loop survives', async () => {
  const dir = mkTmp();
  const mine = loopCmd(path.join(dir, 'mine-never'));
  const other = loopCmd(path.join(dir, 'other-never'));
  const [target, decoy] = underClaude(dir, [mine, other], stopInput(transcriptOf(dir, ['echo hi', mine])));
  assert.ok(await waitDead(target), 'wait-loop shell still alive');
  assert.ok(running(decoy), 'unrelated loop with a different command was killed');
  const orphans = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n')
    .filter((l) => l.includes(path.join(dir, 'mine-never')));
  assert.deepStrictEqual(orphans, []);
});

test('a shell whose command is only a superstring of the transcript command survives', async () => {
  const dir = mkTmp();
  const logged = loopCmd(path.join(dir, 'sup-never'));
  const [survivor] = underClaude(dir, [`${logged}; echo done`], stopInput(transcriptOf(dir, [logged])));
  assert.ok(running(survivor));
});

test('a process whose transcript command is not a wait loop survives', async () => {
  const dir = mkTmp();
  const plain = `sleep 300; echo ${path.join(dir, 'plain-never')}`;
  const [survivor] = underClaude(dir, [plain], stopInput(transcriptOf(dir, [plain])));
  assert.ok(running(survivor));
});

test('a byte-identical loop that is not a child of the claude ancestor survives', async () => {
  const dir = mkTmp();
  const same = loopCmd(path.join(dir, 'same-never'));
  const foreign = startShell(same);
  spawnSync('sleep', ['1.2']);
  underClaude(dir, [], stopInput(transcriptOf(dir, [same])));
  assert.ok(running(foreign));
});

test('with no claude ancestor nothing is killed', () => {
  const dir = mkTmp();
  const same = loopCmd(path.join(dir, 'noanc-never'));
  const survivor = startShell(same);
  spawnSync('sleep', ['1.2']);
  const r = spawnSync(process.execPath, [HOOK], { input: stopInput(transcriptOf(dir, [same])), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  spawnSync('sleep', ['0.5']);
  assert.ok(running(survivor));
});

test('exits 0 on garbage stdin, missing fields, an unsafe agent id and an unreadable transcript', () => {
  const dir = mkTmp();
  for (const input of ['', 'not json', '[]', '{}', JSON.stringify({ agent_id: '../x', agent_transcript_path: transcriptOf(dir, []) }),
    JSON.stringify({ agent_id: 'a', agent_transcript_path: path.join(dir, 'missing.jsonl') })]) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${input}: ${r.stderr}`);
  }
});

test('commandMatches accepts the shell -c and eval-wrapper forms and rejects a superstring', async () => {
  const { commandMatches } = await import(HOOK);
  const cmd = "until [ -f /x ]; do echo 'a'; sleep 1; done";
  assert.ok(commandMatches(`/bin/zsh -c ${cmd}`, cmd));
  assert.ok(commandMatches(`/bin/zsh -c source s.sh && eval 'until [ -f /x ]; do echo '"'"'a'"'"'; sleep 1; done' < /dev/null`, cmd));
  assert.ok(!commandMatches(`sh -c ${cmd}; true`, cmd));
  assert.ok(!commandMatches(`node -e ${cmd}`, cmd));
});

test('pidsToKill never selects itself or an ancestor, even when their command matches', async () => {
  const { pidsToKill } = await import(HOOK);
  const cmd = loopCmd('/x/never');
  const procs = [
    { pid: 2, ppid: 1, pgid: 2, command: '/usr/local/bin/claude' },
    { pid: 10, ppid: 2, pgid: 10, command: `sh -c ${cmd}` },
    { pid: 11, ppid: 10, pgid: 10, command: 'sleep 1' },
    { pid: 20, ppid: 2, pgid: 20, command: `sh -c ${cmd}` },
    { pid: 99, ppid: 20, pgid: 20, command: `node hook ${cmd}` },
  ];
  assert.deepStrictEqual(pidsToKill([cmd], procs, 99).sort(), [10, 11]);
});

test('pidsToKill kills only children of the nearest claude ancestor; no claude ancestor kills nothing', async () => {
  const { pidsToKill, claudePidOf } = await import(HOOK);
  const cmd = loopCmd('/x/never');
  const procs = [
    { pid: 2, ppid: 1, pgid: 2, command: '/usr/local/bin/claude' },
    { pid: 3, ppid: 1, pgid: 3, command: 'claude --other-session' },
    { pid: 10, ppid: 2, pgid: 10, command: `sh -c ${cmd}` },
    { pid: 30, ppid: 3, pgid: 30, command: `sh -c ${cmd}` },
    { pid: 40, ppid: 1, pgid: 40, command: `sh -c ${cmd}` },
    { pid: 99, ppid: 2, pgid: 99, command: 'node hook' },
  ];
  assert.strictEqual(claudePidOf(procs, 99), 2);
  assert.deepStrictEqual(pidsToKill([cmd], procs, 99), [10]);
  const noClaude = procs.filter((p) => p.pid !== 2 && p.pid !== 3).map((p) => (p.pid === 99 ? { ...p, ppid: 1 } : p));
  assert.strictEqual(claudePidOf(noClaude, 99), undefined);
  assert.deepStrictEqual(pidsToKill([cmd], noClaude, 99), []);
});

test('pidsToKill leaves unrelated members of the hook\'s own process group alone', async () => {
  const { pidsToKill } = await import(HOOK);
  const cmd = loopCmd('/x/never');
  const procs = [
    { pid: 2, ppid: 1, pgid: 2, command: 'claude' },
    { pid: 5, ppid: 2, pgid: 5, command: `sh -c ${cmd}` },
    { pid: 50, ppid: 1, pgid: 5, command: 'unrelated member of the same group' },
    { pid: 99, ppid: 2, pgid: 5, command: 'node hook' },
  ];
  assert.deepStrictEqual(pidsToKill([cmd], procs, 99), [5]);
});
