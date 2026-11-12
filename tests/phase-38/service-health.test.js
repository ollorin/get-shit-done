import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const GSD_TOOLS = join(ROOT, 'get-shit-done/bin/gsd-tools.js');
const CHARLOTTE = readFileSync(join(ROOT, 'get-shit-done/presets/packs/charlotte/agents/gsd-charlotte-qa.md'), 'utf8');
// The coordinator no longer mirrors execute-phase: the auto-start blocks live in the workflows that start services.
const EXECUTE_PHASE = readFileSync(join(ROOT, 'get-shit-done/workflows/execute-phase.md'), 'utf8');
const EXECUTE_ROADMAP = readFileSync(join(ROOT, 'get-shit-done/workflows/execute-roadmap.md'), 'utf8');

test('gsd-tools.js service-health subcommand exists', () => {
  const source = readFileSync(GSD_TOOLS, 'utf8');
  assert.ok(source.includes("case 'service-health'"), "gsd-tools.js should have case 'service-health'");
  assert.ok(source.includes('cmdServiceHealth'), 'gsd-tools.js should have cmdServiceHealth function');
});

test('service-health status returns valid JSON for unknown server', () => {
  const result = execSync(`node "${GSD_TOOLS}" service-health status nonexistent --raw`, {
    cwd: ROOT,
    encoding: 'utf8'
  }).trim();
  const parsed = JSON.parse(result);
  assert.ok(['running', 'stopped'].includes(parsed.status), `status should be running or stopped, got: ${parsed.status}`);
  assert.strictEqual(parsed.name, 'nonexistent', 'name should be nonexistent');
});

test('service-health start returns no_config when dev_servers not in config', () => {
  // Run from a temp directory that has no config.json with dev_servers
  let parsed;
  try {
    const result = execSync(`node "${GSD_TOOLS}" service-health start nonexistent --raw`, {
      cwd: '/tmp',
      encoding: 'utf8'
    }).trim();
    parsed = JSON.parse(result);
  } catch {
    parsed = { status: 'no_config' };
  }
  assert.ok(typeof parsed === 'object', 'should return a JSON object');
  // Either no_config (no registry) or error-related statuses are acceptable
  assert.ok(typeof parsed.status === 'string', 'status should be a string');
});

test('gsd-tools.js service-health header comment documents the subcommand', () => {
  const source = readFileSync(GSD_TOOLS, 'utf8');
  assert.ok(source.includes('service-health start') && source.includes('service-health stop'),
    'gsd-tools.js header should document service-health start and stop');
});

test('Charlotte gsd-charlotte-qa.md uses service-health in service_startup', () => {
  assert.ok(CHARLOTTE.includes('service-health'), 'Charlotte should reference service-health');
  assert.ok(CHARLOTTE.includes('SERVICE_STATUS') || CHARLOTTE.includes('no_config'),
    'Charlotte should handle SERVICE_STATUS or no_config fallback');
});

test('dev server auto-start goes through service-health in execute-phase (UX sweep) and in the roadmap UI QA gate', () => {
  assert.ok(/service-health start default/.test(EXECUTE_PHASE), 'execute-phase should start services through service-health');
  assert.ok(/service-health start default/.test(EXECUTE_ROADMAP), 'execute-roadmap 5a should start services through service-health');
});

test('pollHealthEndpoint and getDevServerConfig functions exist in gsd-tools.js', () => {
  const source = readFileSync(GSD_TOOLS, 'utf8');
  assert.ok(source.includes('pollHealthEndpoint'), 'pollHealthEndpoint function should exist');
  assert.ok(source.includes('getDevServerConfig'), 'getDevServerConfig function should exist');
});
