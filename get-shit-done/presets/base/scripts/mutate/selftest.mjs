// mutate/selftest: the run-start harness canary (F4). Three known files are written into the run's root and run through the
// same command, env and pattern as the mutants: a passing test must classify survived (with a passed-test count when the
// runner has a pass_pattern), a failing test must classify killed AND name itself in the output (a runner that crashed without
// running tests names nothing), a syntax error must classify errored through the build pattern. Any mismatch is a harness fault.
// A runner without a `selftest` is skipped. The files are removed in `finally`; failures are values, never thrown.
import fs from 'node:fs/promises';
import path from 'node:path';
import { passedCount } from './classify.mjs';

const KILL_NAME = '__mutate_selftest_kill__';
const fileFor = (st, kind) => `${st.dir}/__mutate_selftest_${kind}__${st.ext}`;

const CHECKS = [
  ['pass', (r, config) => {
    if (r.outcome !== 'survived') return `the classifier labels a known passing test as ${r.outcome}`;
    return config.passPattern && passedCount(r.output, config.passPattern) < 1 ? 'a known passing test shows no passed-test count' : null;
  }],
  ['kill', (r) => {
    if (r.outcome !== 'killed') return `the classifier labels a known kill as ${r.outcome}`;
    return r.output.includes(KILL_NAME) ? null : 'a known kill names no failing test (the runner may have crashed without running tests)';
  }],
  ['build', (r) => (r.outcome === 'errored' && r.buildError === true ? null : `the classifier labels a known build failure as ${r.outcome} (no build_error_pattern matches it)`)],
];

async function checkAll(runTest, root, timeoutMs, config) {
  for (const [kind, verdict] of CHECKS) {
    const written = await fs.writeFile(path.join(root, fileFor(config.selftest, kind)), config.selftest[kind]).then(() => null, (e) => `cannot write the self-test file: ${e.code ?? e.message}`);
    if (written !== null) return `harness fault: ${written}`;
    const problem = verdict(await runTest(root, fileFor(config.selftest, kind), timeoutMs, config), config);
    if (problem !== null) return `harness fault: ${problem}`;
  }
  return null;
}

/** The message of the first mismatch for one runner config, or null (also null when the runner has no selftest). */
export async function selfTestError(runTest, root, timeoutMs, config) {
  if (!config.selftest) return null;
  try {
    return await checkAll(runTest, root, timeoutMs, config);
  } finally {
    await Promise.all(CHECKS.map(([kind]) => fs.rm(path.join(root, fileFor(config.selftest, kind)), { force: true })));
  }
}

/** Every distinct runner config: { problem: first message or null, status: 'passed' | 'failed' | 'skipped' }. */
export async function selfTestAll(runTest, root, timeoutMs, configs) {
  const guarded = [...new Set(configs.values())].filter((c) => c.selftest);
  for (const config of guarded) {
    const problem = await selfTestError(runTest, root, timeoutMs, config);
    if (problem !== null) return { problem, status: 'failed' };
  }
  return { problem: null, status: guarded.length > 0 ? 'passed' : 'skipped' };
}
