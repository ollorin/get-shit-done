// mutate/process: the process edge. The test command is the project's (stack.commands.test_file or --test-cmd, with {file}
// replaced by the quoted test path), run through `sh -c` in its own process group; a timeout, a signal or the end of the run
// SIGKILLs the whole group, so processes a test left running die too. The verdict is classify()'s, from the exit status.
// Limitation: a test that moves a process out of the group (setsid, a double fork) escapes the kill and survives the run.
import { spawn } from 'node:child_process';
import { classify } from './classify.mjs';
import { isStopping, killGroup, parked, registerGroup, unregisterGroup } from './restore.mjs';

const MAX_OUTPUT = 4 * 1024 * 1024;

/** POSIX single-quote quoting of one argument. */
export const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

const doubleQuoteEscape = (s) => s.replace(/[\\$"`]/g, '\\$&');

/** The command line for a test file: {file} becomes a quoted path, escaped for the double quotes it already sits in. */
export function commandFor(testCmd, testFile) {
  let out = '';
  let inDouble = false;
  for (let i = 0; i < testCmd.length; i += 1) {
    if (testCmd.startsWith('{file}', i)) { out += inDouble ? doubleQuoteEscape(testFile) : shellQuote(testFile); i += 5; continue; }
    if (testCmd[i] === '\\') { out += testCmd.slice(i, i + 2); i += 1; continue; }
    if (testCmd[i] === '"') inDouble = !inDouble;
    out += testCmd[i];
  }
  return out;
}

/**
 * One test command from `root` in its own process group. Resolves { outcome, output, exitCode, durationMs }.
 * config: { testCmd, testEnv, errorPattern (string or null) }.
 */
export async function runTest(root, test, timeoutMs, config) {
  if (isStopping()) return parked();
  const started = performance.now();
  const errorPattern = config.errorPattern ? new RegExp(config.errorPattern) : null;
  const state = { timedOut: false, spawnFailed: false, output: '', exitCode: null };
  // NODE_TEST_CONTEXT marks a process as a child of a running node test runner; inherited, it makes a nested `node --test` report success.
  const { NODE_TEST_CONTEXT: _inherited, ...inherited } = process.env;
  const child = spawn('sh', ['-c', commandFor(config.testCmd, test)], {
    cwd: root,
    detached: true,
    env: { ...inherited, NO_COLOR: '1', ...config.testEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => { if (state.output.length < MAX_OUTPUT) state.output += chunk; };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  registerGroup(child.pid);
  const timer = setTimeout(() => { state.timedOut = true; killGroup(child.pid, true); }, timeoutMs);
  const closed = new Promise((resolve) => child.on('close', resolve));
  await new Promise((resolve) => {
    child.on('error', () => { state.spawnFailed = true; resolve(); });
    // The leader has exited: sweep the group now, so a straggler holding the pipes open cannot hang the run.
    child.on('exit', (code) => { state.exitCode = code; killGroup(child.pid); resolve(); });
  });
  if (!state.spawnFailed) await closed;
  clearTimeout(timer);
  killGroup(child.pid);
  unregisterGroup(child.pid);
  if (isStopping()) return parked();
  return {
    outcome: classify(state, errorPattern),
    output: state.output,
    exitCode: state.exitCode,
    durationMs: Math.round(performance.now() - started),
  };
}
