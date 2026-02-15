# Testing Patterns

**Analysis Date:** 2026-02-15

## Test Framework

**Runner:**
- Node.js built-in test runner (`node:test` module)
- No external test framework (Jest, Vitest, etc.)
- Config: `package.json` script `"test": "node --test get-shit-done/bin/gsd-tools.test.js"`

**Assertion Library:**
- Node.js built-in `node:assert` module with `assert.ok()`, `assert.strictEqual()`, `assert.deepStrictEqual()`
- No external assertion library

**Run Commands:**
```bash
npm test                           # Run all tests
node --test get-shit-done/bin/gsd-tools.test.js  # Direct execution
```

## Test File Organization

**Location:**
- Co-located with implementation: `get-shit-done/bin/gsd-tools.test.js` alongside `get-shit-done/bin/gsd-tools.js`
- Test-only files use `.test.js` suffix
- Single test file covers entire tool suite (2034 lines, 100+ test cases)

**Naming:**
- Describe blocks use imperative titles: `'history-digest command'`, `'phases list command'`, `'roadmap get-phase command'`
- Test titles describe expected behavior: `'empty phases directory returns valid schema'`, `'nested frontmatter fields extracted correctly'`, `'handles malformed SUMMARY.md gracefully'`

**Structure:**
```
test file (2034 lines)
├── Describe block 1: history-digest command
│   ├── beforeEach: setup tmp directory
│   ├── afterEach: cleanup
│   ├── test: empty phases → valid schema
│   ├── test: nested frontmatter → extracted correctly
│   └── ...more tests
├── Describe block 2: phases list command
│   ├── beforeEach/afterEach
│   └── ...tests
└── ...more describe blocks
```

## Test Structure

**Suite Organization:**

```javascript
describe('history-digest command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phases directory returns valid schema', () => {
    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(digest.phases, {}, 'phases should be empty object');
  });
});
```

**Patterns:**
- **Setup:** `beforeEach()` creates temp project with `.planning/phases/` structure
- **Teardown:** `afterEach()` recursively deletes temp directory with `fs.rmSync(tmpDir, { recursive: true, force: true })`
- **Isolation:** Each test gets fresh temp directory, no cross-test dependencies
- **Assertions:** Messages included with every assertion for clarity: `assert.ok(result.success, 'Command failed message')`

## Mocking

**Framework:** File system mocking only (no external mock library)

**Patterns:**
```javascript
// Create mock file structure
const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-'));
fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap v1.0\n...`);

// Execute command against mock
const result = runGsdTools('history-digest', tmpDir);

// Verify files created/modified
assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01.1-fix')), 'directory created');
```

**What to Mock:**
- File system (create temp directories with `fs.mkdtempSync()`)
- File contents (write test data with `fs.writeFileSync()`)
- Current working directory (pass `tmpDir` as `cwd` to `runGsdTools()`)

**What NOT to Mock:**
- Command execution (`execSync` runs real git commands)
- Node.js built-in modules (assert, fs, path)
- Frontmatter parsing logic (test real YAML parsing)

## Fixtures and Factories

**Test Data:**
```javascript
// Helper to run commands consistently
function runGsdTools(args, cwd = process.cwd()) {
  try {
    const result = execSync(`node "${TOOLS_PATH}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}

// Factory to create project structure
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}
```

**Location:**
- Helper functions at top of test file (lines 14-40)
- Reused across all test suites via `beforeEach()` / `afterEach()` hooks
- Inline data creation for test-specific setups

## Coverage

**Requirements:** Not enforced - no coverage reporting

**View Coverage:** Not available - no coverage tool configured

## Test Types

**Unit Tests:**
- **Scope:** Individual command functions
- **Approach:** Input → parse → output validation
- **Example:** Test that `phase next-decimal 06` returns `06.1` when no decimal phases exist
- **Isolation:** Mock file system, no external dependencies

**Integration Tests:**
- **Scope:** Multi-command workflows with file system interactions
- **Approach:** Create realistic phase directory structure, run commands, verify files modified
- **Example:** Test `phase remove 2` renumbers phase 3→2 and updates all files
- **Example:** Test `phase complete 1` updates ROADMAP, STATE, and advances phase counter
- **File verification:** Assert on `fs.existsSync()` and `fs.readFileSync()` outputs

**E2E Tests:**
- **Framework:** Not used
- **Note:** Integration tests function as de facto E2E (real file I/O, real command execution)

## Common Patterns

**Async Testing:**
Not applicable - all tests are synchronous (no promises/async-await)

**Error Testing:**
```javascript
test('returns error for missing file', () => {
  const result = runGsdTools('summary-extract nonexistent.md', tmpDir);
  assert.ok(!result.success, 'should fail');
  assert.ok(result.error.includes('not found'), 'error mentions not found');
});

test('rejects removal of executed phase without --force', () => {
  const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
  fs.mkdirSync(p1, { recursive: true });
  fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary'); // executed

  const result = runGsdTools('phase remove 1', tmpDir);
  assert.ok(!result.success, 'should fail without --force');
  assert.ok(result.error.includes('executed plan'), 'error explains why');
});
```

**State Verification:**
```javascript
test('updates STATE.md after phase complete', () => {
  // Setup: create phase with plan + summary
  fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'),
    '# State\n\n**Current Phase:** 01\n**Status:** In progress\n');

  // Execute
  const result = runGsdTools('phase complete 1', tmpDir);
  assert.ok(result.success);

  // Verify state changed
  const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
  assert.ok(state.includes('**Current Phase:** 02'), 'phase advanced');
  assert.ok(state.includes('**Status:** Ready to plan'), 'status updated');
});
```

**Multiple File Scenarios:**
```javascript
test('handles multiple phases with varying states', () => {
  // Create 3 phases with different completeness
  const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
  fs.mkdirSync(p1, { recursive: true });
  fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
  fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary'); // complete

  const p2 = path.join(tmpDir, '.planning', 'phases', '02-api');
  fs.mkdirSync(p2, { recursive: true });
  fs.writeFileSync(path.join(p2, '02-01-PLAN.md'), '# Plan'); // no summary

  const result = runGsdTools('roadmap analyze', tmpDir);
  assert.ok(result.success);

  const output = JSON.parse(result.output);
  assert.strictEqual(output.phases[0].disk_status, 'complete');
  assert.strictEqual(output.phases[1].disk_status, 'planned');
});
```

**Backward Compatibility:**
```javascript
test('flat provides field still works (backward compatibility)', () => {
  const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
  fs.mkdirSync(phaseDir, { recursive: true });

  // Old format (flat array)
  fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), `---
phase: "01"
provides:
  - "Direct provides"
---`);

  const result = runGsdTools('history-digest', tmpDir);
  const digest = JSON.parse(result.output);
  assert.deepStrictEqual(digest.phases['01'].provides, ['Direct provides']);
});
```

## Test Execution Flow

1. **Setup:** `createTempProject()` → `fs.mkdirSync()` with `.planning/phases/`
2. **Fixture:** Write test data files (ROADMAP.md, SUMMARY.md, STATE.md, etc.)
3. **Execute:** `runGsdTools(command, tmpDir)` → `execSync(node script.js ...)`
4. **Parse:** `JSON.parse(result.output)` or `fs.readFileSync()` for verification
5. **Assert:** `assert.*Equal()` with descriptive messages
6. **Cleanup:** `afterEach()` → `fs.rmSync(tmpDir, { recursive: true, force: true })`

---

*Testing analysis: 2026-02-15*
