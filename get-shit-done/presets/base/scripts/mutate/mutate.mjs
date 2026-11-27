#!/usr/bin/env node
// mutate: scripted mutate-run-restore, no model per mutant. Each mutant's `old -> new` snippet is applied to one file in
// place, the project's test command runs for it, the original bytes are restored and the restored sha256 is checked.
// Sequential only. It edits the target, so it refuses the primary worktree (use a linked worktree or a temp copy).
// Usage: node scripts/mutate/mutate.mjs --mutants .tmp/m.json --root .tmp/wt-<name> [--out f.jsonl] [--timeout s]
//   [--test-cmd "cmd {file}"] [--test-env K=V]... [--error-pattern re] [--dry-run] [--allow-dirty] [--allow-primary]
//   [--phase N]  required when stack.isolation.lock_dir is set: runs only while phase N has an open `window` lease (window.mjs)
// Test command: --test-cmd, else stack.commands.test_file of .planning/config.json in the current directory.
// Error pattern: --error-pattern, else stack.mutation.build_error_pattern (a missing config is allowed only when --test-cmd is given); the old key error_pattern is refused.
// Runners: stack.mutation.runners[] ({ id, test_cmd with {file}, build_error_pattern? }); a mutant names one by `runner` (optional with a single runner); an unknown id is refused.
// A failing run whose output matches the build error pattern stops the run (restored) and exits 5: a crash is never a kill. Documented in docs/gsd/mutation-testing.md.
// Run start: a runner with a `selftest` first proves the harness tells a kill from a build failure (selftest.mjs); a `lane: db` runner needs STACK_LOCK_HELD=1; every mutant needs expect_failing_test.
// Exit: 0 ok; 1 canary mismatch, inconclusive mutant or red after the run; 2 aborted before mutating (self-test, baseline, lock, option conflict); 3 restore failed; 4 internal; 5 build error pattern matched or errored breaker (harness fault).
import fs from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILD_ERROR_DETAIL, BUILD_ERROR_EXIT, NO_PATTERN_NOTICE, applySnippet, canaryMismatches, configsFor, countOccurrences, fail, firstFailingLine, harnessFault, inconclusive, killReproduced, ok, parseMutants, parseRunners, renderMarkdown, sha256Hex,
} from './classify.mjs';
import { baselineError, dirtyTargets, lockError, outPathError, outsideRootError, primaryError, runSummaryPath, staleBackupError, writeRunSummary } from './guards.mjs';
import { selfTestAll } from './selftest.mjs';
import { parseOptions } from './options.mjs';
import { runTest } from './process.mjs';
import { windowError } from './window.mjs';
import { RestoreError, installSignalRestore, restoreFile, withActiveMutation } from './restore.mjs';

const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function record(m, f) {
  const sha = f.sha ?? '';
  return {
    id: m.id,
    file: m.file,
    test: m.test,
    outcome: f.outcome,
    duration_ms: f.durationMs ?? 0,
    first_failing_line: f.outcome === 'survived' || f.output === undefined ? null : firstFailingLine(f.output, f.outcome === 'errored' ? f.errorPattern ?? null : null),
    source_sha_before: sha,
    source_sha_after: f.shaAfter ?? sha,
    mutated_sha: f.mutatedSha ?? null,
    test_sha: f.testSha ?? null,
    kill_confirmed: f.killConfirmed ?? null,
    exit_code: f.exitCode ?? null,
    ...(m.expect ? { expect: m.expect } : {}),
    ...(f.detail ? { detail: f.detail } : {}),
  };
}
const invalid = (m, detail, sha = '', testSha) => record(m, { outcome: 'invalid-snippet', sha, testSha, detail });
const fileSha = (p) => fs.readFile(p).then(sha256Hex, () => null);

/** Reads and validates the target: a file inside root (symlinks resolved), valid UTF-8. */
async function loadTarget(m, root) {
  const abs = path.join(root, m.file);
  const [real, rootReal] = await Promise.all([fs.realpath(abs).catch(() => null), fs.realpath(root).catch(() => null)]);
  if (real === null || rootReal === null) return fail('file unreadable');
  if (!real.startsWith(rootReal + path.sep)) return fail('file resolves outside root (symlink)');
  const original = await fs.readFile(abs).catch(() => null);
  if (original === null) return fail('file unreadable');
  try {
    return ok({ abs, original, text: strictDecoder.decode(original), sha: sha256Hex(original) });
  } catch {
    return fail('file is not valid UTF-8');
  }
}

/** The test file's sha, or null when it is not a readable file (a directory or glob never is). */
async function testFileSha(root, test) {
  const bytes = await fs.readFile(path.join(root, test)).catch(() => null);
  return bytes === null ? null : sha256Hex(bytes);
}

/** One mutant: apply, run (twice on a kill), restore, verify. opts: { root, timeoutMs, dryRun, config, backupDir }. */
export async function runMutant(m, opts) {
  const target = await loadTarget(m, opts.root);
  if (!target.ok) return invalid(m, target.error);
  const { abs, original, text, sha } = target.value;
  const count = countOccurrences(text, m.old);
  if (count !== 1) return invalid(m, `old occurs ${count} times`, sha);
  const testSha = await testFileSha(opts.root, m.test);
  if (testSha === null) return invalid(m, 'test is not a readable file', sha);
  if (opts.dryRun) return record(m, { outcome: 'valid', sha, testSha });
  const mutated = Buffer.from(applySnippet(text, m.old, m.new), 'utf8');
  const mutatedSha = sha256Hex(mutated);
  const backup = path.join(opts.backupDir, `${m.id.replace(/[^A-Za-z0-9._-]/g, '_')}.${path.basename(abs)}.orig`);
  await fs.writeFile(backup, original);
  const restore = () => (opts.restore ?? restoreFile)(abs, original, sha).catch((e) => {
    throw e instanceof RestoreError ? new RestoreError(`${e.message} (backup: ${backup})`) : e;
  });
  const run = await withActiveMutation({ path: abs, original, sha, backup, apply: () => fs.writeFile(abs, mutated), restore }, async () => {
    const first = await runTest(opts.root, m.test, opts.timeoutMs, opts.config);
    const again = first.outcome === 'killed' ? await runTest(opts.root, m.test, opts.timeoutMs, opts.config) : null;
    const [seen, testSeen] = await Promise.all([fileSha(abs), testFileSha(opts.root, m.test)]);
    return { result: first, confirmed: again === null ? null : killReproduced(again.outcome), crashed: first.buildError || again?.buildError === true, seen, testSeen };
  }).catch((e) => (e instanceof RestoreError ? e : Promise.reject(e)));
  if (run instanceof RestoreError) return record(m, { outcome: 'restore-failed', sha, testSha, mutatedSha, detail: run.message });
  await fs.rm(backup, { force: true });
  const shaAfter = (await fileSha(abs)) ?? '';
  const { result, confirmed, crashed, seen, testSeen } = run;
  const voided = crashed ? BUILD_ERROR_DETAIL
    : seen !== mutatedSha ? 'source changed during the run; verdict void'
      : testSeen !== testSha ? 'test file changed during the run; verdict void'
        : confirmed === false ? 'kill not reproduced on a second run (flaky test?); verdict void' : undefined;
  return record(m, {
    outcome: voided === undefined ? result.outcome : 'errored',
    durationMs: result.durationMs,
    output: result.output,
    errorPattern: opts.config.errorPattern ? new RegExp(opts.config.errorPattern) : null,
    exitCode: result.exitCode,
    sha,
    shaAfter,
    testSha,
    mutatedSha,
    ...(confirmed === null ? {} : { killConfirmed: confirmed }),
    ...(voided === undefined ? {} : { detail: voided }),
  });
}

async function loadMutants(file) {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return fail(`cannot read mutants file: ${file}`);
  try { return parseMutants(JSON.parse(text)); } catch { return fail(`mutants file is not valid JSON: ${file}`); }
}

/** Test command and error pattern: flags first, then the profile (.planning/config.json; unreadable or non-JSON is a failure). */
export function withProfile(options, cwd = process.cwd()) {
  const c = options.config;
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8')); } catch (e) {
    // With the test command given by flag, an absent config only means no error pattern; any other failure stays one.
    if (!(c.testCmd !== null && e.code === 'ENOENT')) return fail(`.planning/config.json unreadable or not JSON: ${e.code ?? e.message}`);
  }
  const mutation = cfg?.stack?.mutation;
  if (mutation !== null && typeof mutation === 'object' && Object.prototype.hasOwnProperty.call(mutation, 'error_pattern')) {
    return fail('stack.mutation.error_pattern is renamed: use stack.mutation.build_error_pattern (it classifies a build failure, it must not match a test failure)');
  }
  const errorPattern = c.errorPattern ?? mutation?.build_error_pattern ?? null;
  if (errorPattern !== null) { try { new RegExp(errorPattern); } catch { return fail('stack.mutation.build_error_pattern is not a valid regular expression'); } }
  if (mutation?.runners != null) {
    const runners = parseRunners(mutation.runners);
    if (!runners.ok) return fail(runners.error);
    if (c.testCmd !== null) return fail('--test-cmd cannot be combined with stack.mutation.runners (each mutant names its runner); drop the flag or the runners');
    if (c.errorPattern !== null && runners.value.some((r) => r.build_error_pattern !== undefined)) return fail('--error-pattern conflicts with a runner build_error_pattern; drop the flag or the runner pattern');
    return ok({ ...options, config: { ...c, errorPattern, runners: runners.value } });
  }
  const testCmd = c.testCmd ?? cfg?.stack?.commands?.test_file ?? null;
  if (testCmd === 'none') return fail('stack.commands.test_file is "none" (not configured yet): the project has no tests to mutate against; pass --test-cmd or set a real command');
  if (testCmd === null) return fail('no test command: pass --test-cmd "<command with {file}>" or set stack.commands.test_file');
  if (typeof testCmd !== 'string' || !testCmd.includes('{file}')) return fail('the test command must contain {file}');
  return ok({ ...options, config: { ...c, testCmd, errorPattern } });
}

async function runAll(mutants, opts, backupDir, configs) {
  const results = [];
  for (const m of mutants) {
    const rec = await runMutant(m, { root: opts.root, timeoutMs: opts.timeoutMs, dryRun: opts.dryRun, config: configs.get(m.id), backupDir });
    await fs.appendFile(opts.outPath, `${JSON.stringify(rec)}\n`);
    results.push(rec);
    if (rec.outcome === 'restore-failed' || rec.detail === BUILD_ERROR_DETAIL || harnessFault(results)) break;
  }
  return results;
}

/** The first non-green unmutated test over every runner group, or null. */
async function baselineAll(label, mutants, configs, opts) {
  const groups = [...new Set(configs.values())].map((config) => ({ config, tests: [...new Set(mutants.filter((m) => configs.get(m.id) === config).map((m) => m.test))] }));
  for (const g of groups) {
    const problem = await baselineError(runTest, label, opts.root, g.tests, opts.timeoutMs, g.config);
    if (problem !== null) return problem;
  }
  return null;
}

const refuse = (message) => { console.error(`[mutate] refusing: ${message}`); return 2; };

async function execute(opts, deps) {
  const loaded = await loadMutants(opts.mutantsPath);
  if (!loaded.ok) { console.error(`[mutate] ${loaded.error}`); return 2; }
  const mutants = loaded.value;
  if (mutants.length === 0) { console.error('[mutate] mutants file is empty'); return 2; }
  const checks = [
    () => outPathError(opts, mutants),
    () => outsideRootError(opts.root, mutants),
    () => staleBackupError(opts.outPath),
    () => primaryError(opts, deps.tempBases),
  ];
  for (const check of checks) { const problem = await check(); if (problem !== null) return refuse(problem); }
  const dirty = opts.allowDirty ? ok([]) : await dirtyTargets(opts.root, mutants);
  if (!dirty.ok) { console.error(`[mutate] ${dirty.error}`); return 2; }
  if (dirty.value.length > 0) return refuse(`uncommitted or untracked ${dirty.value.join(', ')} (use --allow-dirty)`);
  const resolved = configsFor(mutants, opts.config);
  if (!resolved.ok) { console.error(`[mutate] ${resolved.error}`); return 2; }
  const configs = resolved.value;
  const unlocked = opts.dryRun ? null : lockError(configs, deps.env ?? process.env);
  if (unlocked !== null) return refuse(unlocked);
  await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
  await fs.writeFile(opts.outPath, '');
  await fs.rm(runSummaryPath(opts.outPath), { force: true });
  const baseline = opts.dryRun ? 'skipped' : 'green';
  const selfTest = opts.dryRun ? { problem: null, status: 'skipped' } : await selfTestAll(runTest, opts.root, opts.timeoutMs, configs);
  const finish = async (code, summary, count = 0) => { await writeRunSummary(opts.outPath, { exit_code: code, mutants: count, self_test: selfTest.status, ...summary }); return code; };
  if (selfTest.problem !== null) { console.error(`[mutate] ${selfTest.problem}; aborting`); return finish(2, { baseline_before: 'not-run', baseline_after: 'not-run' }); }
  if (!opts.dryRun) {
    const before = await baselineAll('before', mutants, configs, opts);
    if (before !== null) { console.error(`[mutate] ${before}; aborting`); return finish(2, { baseline_before: 'red', baseline_after: 'not-run' }); }
  }
  const backupDir = `${opts.outPath}.restore`;
  await fs.mkdir(backupDir, { recursive: true });
  const records = await runAll(mutants, opts, backupDir, configs);
  console.log(renderMarkdown(records));
  console.log(`\n[mutate] evidence: ${opts.outPath}`);
  if ([...configs.values()].some((c) => c.errorPattern === null)) console.log(`[mutate] ${NO_PATTERN_NOTICE}`);
  const restoreFailed = records.find((r) => r.outcome === 'restore-failed');
  if (restoreFailed) {
    console.error(`[mutate] RESTORE FAILED: source may be left mutated: ${restoreFailed.detail}`);
    return finish(3, { baseline_before: baseline, baseline_after: 'not-run' }, records.length);
  }
  await fs.rm(backupDir, { recursive: true, force: true });
  const crashed = records.find((r) => r.detail === BUILD_ERROR_DETAIL);
  if (crashed) {
    console.error(`[mutate] REFUSED: ${crashed.id} output matched the runner's build error pattern; no verdict of this run counts`);
    return finish(BUILD_ERROR_EXIT, { baseline_before: baseline, baseline_after: 'not-run', refused: 'build-error-pattern' }, records.length);
  }
  if (harnessFault(records)) {
    console.error('[mutate] HARNESS FAULT: 3 or more rows and over a fifth of them errored; the run stopped and no row counts as a kill or a survivor');
    return finish(BUILD_ERROR_EXIT, { baseline_before: baseline, baseline_after: 'not-run', harness_fault: true }, records.length);
  }
  const bad = opts.dryRun ? inconclusive(records) : [...canaryMismatches(records), ...inconclusive(records)];
  if (!opts.dryRun) {
    const after = await baselineAll('after', mutants, configs, opts);
    if (after !== null) { console.error(`[mutate] ${after}; the run's verdicts are unreliable`); return finish(1, { baseline_before: baseline, baseline_after: 'red' }, records.length); }
  }
  const summary = { baseline_before: baseline, baseline_after: baseline };
  if (bad.length > 0) {
    const ids = [...new Set(bad.map((r) => `${r.id} (expected ${r.expect ?? 'conclusive'}, got ${r.outcome})`))];
    console.error(`[mutate] canary mismatch or inconclusive mutant: ${ids.join('; ')}`);
    return finish(1, summary, records.length);
  }
  return finish(0, summary, records.length);
}

/** Exit codes: 0 ok, 1 canary mismatch / inconclusive / unstable baseline, 2 aborted before mutating, 3 restore failed, 4 internal, 5 build error pattern matched. */
export async function main(argv, deps = {}) {
  const parsed = parseOptions(argv);
  if (!parsed.ok) { console.error(`[mutate] ${parsed.error}`); return 2; }
  const profiled = withProfile(parsed.value);
  if (!profiled.ok) { console.error(`[mutate] ${profiled.error}`); return 2; }
  const closed = windowError(profiled.value.phase);
  if (closed !== null) return refuse(closed);
  const dispose = profiled.value.dryRun ? () => {} : installSignalRestore();
  try {
    return await execute(profiled.value, deps);
  } catch (e) {
    console.error(`[mutate] internal error: ${e instanceof Error ? e.stack : String(e)}`);
    return 4;
  } finally {
    dispose();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
