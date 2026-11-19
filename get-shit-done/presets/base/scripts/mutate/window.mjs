// mutate/window: with a shared local stack (stack.isolation.lock_dir) mutants run only inside the phase's open live window.
// The lease file is read with the GSD tool's own reader, found at $GSD_BIN_DIR, ~/.claude/get-shit-done/bin or <cwd>/.claude/get-shit-done/bin.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

function readerDir(cwd, env) {
  const candidates = [env.GSD_BIN_DIR, path.join(os.homedir(), '.claude', 'get-shit-done', 'bin'), path.join(cwd, '.claude', 'get-shit-done', 'bin')].filter(Boolean);
  return candidates.find((d) => { try { readFileSync(path.join(d, 'dispatch-lease.js')); return true; } catch { return false; } }) ?? null;
}

/** null when allowed, else the refusal message. */
export function windowError(phase, cwd = process.cwd(), env = process.env) {
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') return `.planning/config.json unreadable or not JSON: ${e.code ?? e.message}`;
  }
  if (!cfg?.stack?.isolation?.lock_dir) return null;
  if (phase === undefined) return 'stack.isolation.lock_dir is set: pass --phase <N>, the phase whose live window this run belongs to';
  const dir = readerDir(cwd, env);
  if (dir === null) return 'cannot find the GSD tool dispatch-lease.js to read the window lease (set GSD_BIN_DIR to the GSD bin directory)';
  const key = require(path.join(dir, 'roadmap-dispatch.js')).phaseKey(phase);
  const open = require(path.join(dir, 'dispatch-lease.js')).load(cwd).some((l) => l.role === 'window' && l.phase === key && !l.end);
  return open ? null : `stack.isolation.lock_dir is set and phase ${key} has no open window lease: mutants run only inside a live window. Run \`dispatch begin --phase ${key} --role window --id <id>\` (a second window of the phase needs --reason), then re-run`;
}
