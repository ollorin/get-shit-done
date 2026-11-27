// Runs one gate command and appends its capture to the phase captures file in a fixed format:
//   $ <id>
//   <output lines>                      (output up to 40 lines inline; longer: first 10, an omission line, last 10)
//   GATE <id> rc=<n> lines=<N> [full=<path>]
// Output above 40 lines is also kept in full in <captures dir>/<id>.log. stdout and stderr are merged. The exit code is the gate's own.
// Usage: node scripts/gate-capture.mjs <captures-file> <id> <command>      Exit: the gate's rc, 2 on usage or write failure.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const INLINE_MAX = 40;
const EDGE = 10;

const linesOf = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

function summary(lines, logPath) {
  if (lines.length <= INLINE_MAX) return lines;
  const omitted = lines.length - 2 * EDGE;
  return [...lines.slice(0, EDGE), `... ${omitted} lines omitted, full output in ${logPath}`, ...lines.slice(-EDGE)];
}

function main([file, id, command]) {
  if (!file || !id || !command) {
    console.error('usage: node scripts/gate-capture.mjs <captures-file> <id> <command>');
    return 2;
  }
  const r = spawnSync(command, { shell: true, encoding: 'utf8', maxBuffer: 1 << 28 });
  const rc = r.status ?? 1;
  const lines = linesOf(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  const big = lines.length > INLINE_MAX;
  const logPath = path.join(path.dirname(file), `${id}.log`);
  const last = `GATE ${id} rc=${rc} lines=${lines.length}${big ? ` full=${logPath}` : ''}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (big) fs.writeFileSync(logPath, `${lines.join('\n')}\n`);
    fs.appendFileSync(file, `${[`$ ${id}`, ...summary(lines, logPath), last].join('\n')}\n`);
  } catch (err) {
    console.error(`gate-capture: cannot write capture: ${err.code ?? err.message}`);
    return 2;
  }
  console.log(last);
  return rc;
}

process.exitCode = main(process.argv.slice(2));
