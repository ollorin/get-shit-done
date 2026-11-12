// mutate/options: command-line parsing. Pure: argv in, validated options (or one error) out. Unknown flags and stray
// positionals fail, so a typo such as --dryrun cannot silently run a real mutation.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fail, ok } from './classify.mjs';

// setTimeout clamps anything above 2^31-1 ms to 1 ms, which would time out every run at once.
const MAX_TIMEOUT_SEC = 2_147_483;
const FLAGS = {
  mutants: { type: 'string' },
  out: { type: 'string' },
  root: { type: 'string' },
  timeout: { type: 'string' },
  'test-cmd': { type: 'string' },
  'error-pattern': { type: 'string' },
  'test-env': { type: 'string', multiple: true },
  'dry-run': { type: 'boolean' },
  'allow-dirty': { type: 'boolean' },
  'allow-primary': { type: 'boolean' },
};

function parseEnvPairs(pairs) {
  const bad = pairs.find((p) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(p));
  if (bad !== undefined) return fail(`--test-env expects KEY=VALUE, got ${bad}`);
  return ok(Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])));
}

/** { ok, value: { mutantsPath, outPath, root, timeoutMs, dryRun, allowDirty, allowPrimary, config } } or { ok: false, error }. */
export function parseOptions(argv, cwd = process.cwd(), now = new Date()) {
  let args;
  try {
    args = parseArgs({ args: argv, options: FLAGS, strict: true, allowPositionals: false }).values;
  } catch (e) {
    return fail(`unknown or malformed argument: ${e.message}`);
  }
  const timeoutSec = Number(args.timeout ?? '120');
  if (typeof args.mutants !== 'string' || args.mutants === '') return fail('--mutants <json> is required');
  if (!(timeoutSec > 0 && timeoutSec <= MAX_TIMEOUT_SEC)) return fail(`--timeout must be seconds in (0, ${MAX_TIMEOUT_SEC}], got ${args.timeout}`);
  if (args['test-cmd'] !== undefined && !args['test-cmd'].includes('{file}')) return fail('--test-cmd must contain {file}, replaced by the mutant\'s test file');
  if (args['error-pattern'] !== undefined) {
    try { new RegExp(args['error-pattern']); } catch (e) { return fail(`--error-pattern is not a valid regular expression: ${e.message}`); }
  }
  const env = parseEnvPairs(args['test-env'] ?? []);
  if (!env.ok) return env;
  const root = typeof args.root === 'string' && args.root !== '' ? args.root : cwd;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return ok({
    mutantsPath: args.mutants,
    outPath: typeof args.out === 'string' && args.out !== '' ? args.out : path.join(root, '.tmp', 'mutate', `${stamp}.jsonl`),
    root,
    timeoutMs: timeoutSec * 1000,
    dryRun: args['dry-run'] === true,
    allowDirty: args['allow-dirty'] === true,
    allowPrimary: args['allow-primary'] === true,
    config: { testCmd: args['test-cmd'] ?? null, testEnv: env.value, errorPattern: args['error-pattern'] ?? null },
  });
}
