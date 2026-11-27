// Runs one gate command and appends its capture to the phase captures file in a fixed format:
//   $ <id>
//   <output lines>                      (output up to 40 lines inline; longer: first 10, an omission line, last 10)
//   GATE <id> rc=<n> lines=<N> [full=<path>]
// Output above 40 lines is also kept in full in <captures dir>/<id>.log. stdout and stderr are merged. The exit code is the gate's own.
// A gate over 10 minutes is killed and reports rc=timeout (exit 1); output over the buffer adds an OUTPUT TRUNCATED line (exit 1).
// Usage: node scripts/gate-capture.mjs <captures-file> <id> <command>      Exit: the gate's rc, 2 on usage, bad id or write failure.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const INLINE_MAX = 40;
const EDGE = 10;
const TIMEOUT_MS = 600000;
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const linesOf = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

function summary(lines, logPath) {
  if (lines.length <= INLINE_MAX) return lines;
  const omitted = lines.length - 2 * EDGE;
  return [...lines.slice(0, EDGE), `... ${omitted} lines omitted, full output in ${logPath}`, ...lines.slice(-EDGE)];
}

function main([file, id, command]) {
  if (!file || !id || !command || !ID_PATTERN.test(id)) {
    console.error('usage: node scripts/gate-capture.mjs <captures-file> <id matching [A-Za-z0-9._-]+> <command>');
    return 2;
  }
  const r = spawnSync(command, { shell: true, encoding: 'utf8', maxBuffer: 1 << 28, timeout: TIMEOUT_MS, killSignal: 'SIGKILL' });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const truncated = r.error?.code === 'ENOBUFS';
  const rc = timedOut || truncated ? 1 : (r.status ?? 1);
  const lines = [...linesOf(`${r.stdout ?? ''}${r.stderr ?? ''}`), ...(truncated ? ['OUTPUT TRUNCATED'] : [])];
  const big = lines.length > INLINE_MAX;
  const logPath = path.join(path.dirname(file), `${id}.log`);
  const last = `GATE ${id} rc=${timedOut ? 'timeout' : rc} lines=${lines.length}${big ? ` full=${logPath}` : ''}`;
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
