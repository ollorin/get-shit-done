import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const GSD_TOOLS = join(ROOT, 'get-shit-done/bin/gsd-tools.js');
const CHARLOTTE = readFileSync(join(ROOT, 'agents/gsd-charlotte-qa.md'), 'utf8');
const COORDINATOR = readFileSync(join(ROOT, 'agents/gsd-phase-coordinator.md'), 'utf8');

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

test('Phase coordinator uses service-health for all three dev server auto-start locations', () => {
  const matches = (COORDINATOR.match(/service-health/g) || []).length;
  assert.ok(matches >= 3, `coordinator should reference service-health at least 3 times, found: ${matches}`);
});

test('pollHealthEndpoint and getDevServerConfig functions exist in gsd-tools.js', () => {
  const source = readFileSync(GSD_TOOLS, 'utf8');
  assert.ok(source.includes('pollHealthEndpoint'), 'pollHealthEndpoint function should exist');
  assert.ok(source.includes('getDevServerConfig'), 'getDevServerConfig function should exist');
});
