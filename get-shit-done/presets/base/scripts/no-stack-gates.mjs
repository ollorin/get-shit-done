// Rolling gate after each plan: runs stack.commands.typecheck, stack.commands.lint and every stack.gates[] entry that
// declares needs_stack: false (a missing or non-boolean value counts as needing the stack, so the entry is skipped).
// Every selected command runs even after a failure. Output line per command: "<id>: PASS" or "<id>: FAIL rc=<n>".
// Nothing selected prints "no stack-free gates configured" and exits 0: a project without the field is not blocked here;
// the full pre-PR gate still runs every gate.
// Usage: node scripts/no-stack-gates.mjs      Exit: 0 all passed or nothing to run, 1 any failure, 2 config unreadable or malformed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const CONFIG = '.planning/config.json';
const isCommand = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== 'none';

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
  ...(stack.gates ?? []).filter((g) => g && g.needs_stack === false && g.id && isCommand(g.run)).map((g) => ({ id: g.id, run: g.run })),
];

function runOne({ id, run }) {
  const r = spawnSync(run, { shell: true, stdio: 'inherit' });
  const rc = r.status ?? 1;
  console.log(rc === 0 ? `${id}: PASS` : `${id}: FAIL rc=${rc}`);
  return rc;
}

function main() {
  const { stack, error } = readStack();
  if (error) {
    console.error(`no-stack-gates: ${error}`);
    return 2;
  }
  const todo = selected(stack);
  if (todo.length === 0) {
    console.log('no stack-free gates configured');
    return 0;
  }
  return todo.map(runOne).some((rc) => rc !== 0) ? 1 : 0;
}

process.exitCode = main();
