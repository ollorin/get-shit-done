#!/usr/bin/env node
// mutate: scripted mutate-run-restore, no model per mutant. Each mutant's `old -> new` snippet is applied to one file in
// place, the project's test command runs for it, the original bytes are restored and the restored sha256 is checked.
// Sequential only. It edits the target, so it refuses the primary worktree (use a linked worktree or a temp copy).
// Usage: node scripts/mutate/mutate.mjs --mutants .tmp/m.json --root .tmp/wt-<name> [--out f.jsonl] [--timeout s]
//   [--test-cmd "cmd {file}"] [--test-env K=V]... [--error-pattern re] [--dry-run] [--allow-dirty] [--allow-primary]
// Test command: --test-cmd, else stack.commands.test_file of .planning/config.json in the current directory.
// Error pattern: --error-pattern, else stack.mutation.error_pattern (a missing config is allowed only when --test-cmd is given). Documented in docs/gsd/mutation-testing.md.
// Exit: 0 ok; 1 canary mismatch, inconclusive mutant or red after the run; 2 aborted before mutating; 3 restore failed; 4 internal.
import fs from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NO_PATTERN_NOTICE, applySnippet, canaryMismatches, countOccurrences, fail, firstFailingLine, inconclusive, killReproduced, ok, parseMutants, renderMarkdown, sha256Hex,
} from './classify.mjs';
import { baselineError, dirtyTargets, outPathError, outsideRootError, primaryError, runSummaryPath, staleBackupError, writeRunSummary } from './guards.mjs';
import { parseOptions } from './options.mjs';
import { runTest } from './process.mjs';
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
    first_failing_line: f.outcome === 'survived' || f.output === undefined ? null : firstFailingLine(f.output, f.errorPattern ?? null),
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
    return { result: first, confirmed: again === null ? null : killReproduced(again.outcome), seen, testSeen };
  }).catch((e) => (e instanceof RestoreError ? e : Promise.reject(e)));
  if (run instanceof RestoreError) return record(m, { outcome: 'restore-failed', sha, testSha, mutatedSha, detail: run.message });
  await fs.rm(backup, { force: true });
  const shaAfter = (await fileSha(abs)) ?? '';
  const { result, confirmed, seen, testSeen } = run;
  const voided = seen !== mutatedSha ? 'source changed during the run; verdict void'
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
  if (c.testCmd !== null && c.errorPattern !== null) return ok(options);
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8')); } catch (e) {
    // With the test command given by flag, an absent config only means no error pattern; any other failure stays one.
    if (!(c.testCmd !== null && e.code === 'ENOENT')) return fail(`.planning/config.json unreadable or not JSON: ${e.code ?? e.message}`);
  }
  const testCmd = c.testCmd ?? cfg?.stack?.commands?.test_file ?? null;
  const errorPattern = c.errorPattern ?? cfg?.stack?.mutation?.error_pattern ?? null;
  if (testCmd === 'none') return fail('stack.commands.test_file is "none" (not configured yet): the project has no tests to mutate against; pass --test-cmd or set a real command');
  if (testCmd === null) return fail('no test command: pass --test-cmd "<command with {file}>" or set stack.commands.test_file');
  if (typeof testCmd !== 'string' || !testCmd.includes('{file}')) return fail('the test command must contain {file}');
  if (errorPattern !== null) { try { new RegExp(errorPattern); } catch { return fail('stack.mutation.error_pattern is not a valid regular expression'); } }
  return ok({ ...options, config: { ...c, testCmd, errorPattern } });
}

async function runAll(mutants, opts, backupDir) {
  const results = [];
  for (const m of mutants) {
    const rec = await runMutant(m, { root: opts.root, timeoutMs: opts.timeoutMs, dryRun: opts.dryRun, config: opts.config, backupDir });
    await fs.appendFile(opts.outPath, `${JSON.stringify(rec)}\n`);
    results.push(rec);
    if (rec.outcome === 'restore-failed') break;
  }
  return results;
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
  const tests = [...new Set(mutants.map((m) => m.test))];
  await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
  await fs.writeFile(opts.outPath, '');
  await fs.rm(runSummaryPath(opts.outPath), { force: true });
  const baseline = opts.dryRun ? 'skipped' : 'green';
  const finish = async (code, summary, count = 0) => { await writeRunSummary(opts.outPath, { exit_code: code, mutants: count, ...summary }); return code; };
  if (!opts.dryRun) {
    const before = await baselineError(runTest, 'before', opts.root, tests, opts.timeoutMs, opts.config);
    if (before !== null) { console.error(`[mutate] ${before}; aborting`); return finish(2, { baseline_before: 'red', baseline_after: 'not-run' }); }
  }
  const backupDir = `${opts.outPath}.restore`;
  await fs.mkdir(backupDir, { recursive: true });
  const records = await runAll(mutants, opts, backupDir);
  console.log(renderMarkdown(records));
  console.log(`\n[mutate] evidence: ${opts.outPath}`);
  if (opts.config.errorPattern === null) console.log(`[mutate] ${NO_PATTERN_NOTICE}`);
  const restoreFailed = records.find((r) => r.outcome === 'restore-failed');
  if (restoreFailed) {
    console.error(`[mutate] RESTORE FAILED: source may be left mutated: ${restoreFailed.detail}`);
    return finish(3, { baseline_before: baseline, baseline_after: 'not-run' }, records.length);
  }
  await fs.rm(backupDir, { recursive: true, force: true });
  const bad = opts.dryRun ? inconclusive(records) : [...canaryMismatches(records), ...inconclusive(records)];
  if (!opts.dryRun) {
    const after = await baselineError(runTest, 'after', opts.root, tests, opts.timeoutMs, opts.config);
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

/** Exit codes: 0 ok, 1 canary mismatch / inconclusive / unstable baseline, 2 aborted before mutating, 3 restore failed, 4 internal. */
export async function main(argv, deps = {}) {
  const parsed = parseOptions(argv);
  if (!parsed.ok) { console.error(`[mutate] ${parsed.error}`); return 2; }
  const profiled = withProfile(parsed.value);
  if (!profiled.ok) { console.error(`[mutate] ${profiled.error}`); return 2; }
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
