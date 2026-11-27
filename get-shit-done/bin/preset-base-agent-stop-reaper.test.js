'use strict';

// WP16: the SubagentStop reaper kills an agent's own wait-loop shells and nothing else.
// Real processes: every shell carries a unique sentinel path so no other process can match.

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
    try { process.kill(-kids.pop().pid, 'SIGKILL'); } catch { /* already gone */ }
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
  kids.push(child);
  return child;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// Async on purpose: the killed shell is our child, so the event loop must reap it before kill(pid, 0) fails.
const waitDead = async (pid) => {
  const until = Date.now() + 5000;
  while (alive(pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
  return !alive(pid);
};
const runHook = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
const stopInput = (transcript) => JSON.stringify({ agent_id: 'agent-1', agent_transcript_path: transcript });

test('kills the shell whose command is in the agent transcript, plus its sleep child; a different loop survives', async () => {
  const dir = mkTmp();
  const mine = loopCmd(path.join(dir, 'mine-never'));
  const other = loopCmd(path.join(dir, 'other-never'));
  const target = startShell(mine);
  const decoy = startShell(other);
  spawnSync('sleep', ['1.2']);
  assert.ok(alive(target.pid) && alive(decoy.pid));
  const r = runHook(stopInput(transcriptOf(dir, ['echo hi', mine])));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(await waitDead(target.pid),'wait-loop shell still alive');
  assert.ok(alive(decoy.pid), 'unrelated loop with a different command was killed');
  const orphans = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n')
    .filter((l) => l.includes(path.join(dir, 'mine-never')));
  assert.deepStrictEqual(orphans, []);
});

test('a shell whose command is only a superstring of the transcript command survives', () => {
  const dir = mkTmp();
  const logged = loopCmd(path.join(dir, 'sup-never'));
  const longer = `${logged}; echo done`;
  const survivor = startShell(longer);
  spawnSync('sleep', ['1.2']);
  const r = runHook(stopInput(transcriptOf(dir, [logged])));
  assert.strictEqual(r.status, 0, r.stderr);
  spawnSync('sleep', ['0.5']);
  assert.ok(alive(survivor.pid));
});

test('exits 0 on garbage stdin, missing fields, an unsafe agent id and an unreadable transcript', () => {
  const dir = mkTmp();
  for (const input of ['', 'not json', '[]', '{}', JSON.stringify({ agent_id: '../x', agent_transcript_path: transcriptOf(dir, []) }),
    JSON.stringify({ agent_id: 'a', agent_transcript_path: path.join(dir, 'missing.jsonl') })]) {
    const r = runHook(input);
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
    { pid: 10, ppid: 1, pgid: 10, command: `sh -c ${cmd}` },
    { pid: 11, ppid: 10, pgid: 10, command: 'sleep 1' },
    { pid: 20, ppid: 1, pgid: 20, command: `sh -c ${cmd}` },
    { pid: 99, ppid: 20, pgid: 20, command: `node hook ${cmd}` },
  ];
  assert.deepStrictEqual(pidsToKill([cmd], procs, 99).sort(), [10, 11]);
});
