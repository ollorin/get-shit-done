// Rolling gate after each plan: runs stack.commands.typecheck, stack.commands.lint and every stack.gates[] entry that
// declares needs_stack: false (a missing or non-boolean value counts as needing the stack, so the entry is skipped).
// Every selected command runs even after a failure, each under a 10-minute timeout. Output line per command: "<id>: PASS",
// "<id>: FAIL rc=<n>" or "<id>: FAIL rc=timeout"; a skipped gate prints "<id>: SKIPPED (needs stack or invalid needs_stack)".
// Nothing selected prints "NO GATES RAN" and exits 0: a project without the field is not blocked here. That is not a gate
// pass; the full pre-PR gate still runs every gate.
// Usage: node scripts/no-stack-gates.mjs      Exit: 0 all passed or nothing to run, 1 any failure, 2 config unreadable or malformed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const CONFIG = '.planning/config.json';
const TIMEOUT_MS = 600000;
const isCommand = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== 'none';
const isRunnable = (g) => g && g.needs_stack === false && g.id && isCommand(g.run);

function readStack() {
  try {
    const stack = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).stack ?? {};
    if (stack.gates !== undefined && !Array.isArray(stack.gates)) return { error: 'stack.gates is not an array' };
    return { stack };
  } catch (err) {
    return { error: `${CONFIG} unreadable or not JSON: ${err.code ?? err.message}` };
  }
}

const selected = (stack) => [
  ...['typecheck', 'lint'].filter((k) => isCommand(stack.commands?.[k])).map((k) => ({ id: k, run: stack.commands[k] })),
  ...(stack.gates ?? []).filter(isRunnable).map((g) => ({ id: g.id, run: g.run })),
];

const skipped = (stack) => (stack.gates ?? []).filter((g) => g && g.id && !isRunnable(g)).map((g) => g.id);

function runOne({ id, run }) {
  const r = spawnSync(run, { shell: true, stdio: 'inherit', timeout: TIMEOUT_MS, killSignal: 'SIGKILL' });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const rc = timedOut ? 1 : (r.status ?? 1);
  console.log(rc === 0 ? `${id}: PASS` : `${id}: FAIL rc=${timedOut ? 'timeout' : rc}`);
  return rc;
}

function main() {
  const { stack, error } = readStack();
  if (error) {
    console.error(`no-stack-gates: ${error}`);
    return 2;
  }
  for (const id of skipped(stack)) console.log(`${id}: SKIPPED (needs stack or invalid needs_stack)`);
  const todo = selected(stack);
  if (todo.length === 0) {
    console.log('NO GATES RAN: no stack-free gates configured (this is not a gate pass)');
    return 0;
  }
  return todo.map(runOne).some((rc) => rc !== 0) ? 1 : 0;
}

process.exitCode = main();
