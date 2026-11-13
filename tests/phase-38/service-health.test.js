import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const GSD_TOOLS = join(ROOT, 'get-shit-done/bin/gsd-tools.js');

test('service-health status returns valid JSON for unknown server', () => {
  const result = execSync(`node "${GSD_TOOLS}" service-health status nonexistent --raw`, {
    cwd: ROOT,
    encoding: 'utf8'
  }).trim();
  const parsed = JSON.parse(result);
  assert.ok(['running', 'stopped'].includes(parsed.status), `status should be running or stopped, got: ${parsed.status}`);
  assert.strictEqual(parsed.name, 'nonexistent', 'name should be nonexistent');
});

test('service-health start returns no_config when the project configures no such service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sh-'));
  const parsed = JSON.parse(execSync(`node "${GSD_TOOLS}" service-health start nonexistent --raw`, { cwd: dir, encoding: 'utf8' }));
  assert.strictEqual(parsed.status, 'no_config');
});
