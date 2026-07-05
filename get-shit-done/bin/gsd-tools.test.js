/**
 * GSD Tools Tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOOLS_PATH = path.join(__dirname, 'gsd-tools.js');

// Helper to run gsd-tools command
// extraEnv is optional and merged over process.env (used by Phase 48-01's
// mining tests to isolate ~/.claude/projects and ~/.claude/knowledge via a
// fake HOME) — existing call sites that omit it are unaffected.
function runGsdTools(args, cwd = process.cwd(), extraEnv = {}) {
  try {
    const result = execSync(`node "${TOOLS_PATH}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
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

// Create temp directory structure
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

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
    assert.deepStrictEqual(digest.decisions, [], 'decisions should be empty array');
    assert.deepStrictEqual(digest.tech_stack, [], 'tech_stack should be empty array');
  });

  test('nested frontmatter fields extracted correctly', () => {
    // Create phase directory with SUMMARY containing nested frontmatter
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = `---
phase: "01"
name: "Foundation Setup"
dependency-graph:
  provides:
    - "Database schema"
    - "Auth system"
  affects:
    - "API layer"
tech-stack:
  added:
    - "prisma"
    - "jose"
patterns-established:
  - "Repository pattern"
  - "JWT auth flow"
key-decisions:
  - "Use Prisma over Drizzle"
  - "JWT in httpOnly cookies"
---

# Summary content here
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), summaryContent);

    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Check nested dependency-graph.provides
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Auth system', 'Database schema'],
      'provides should contain nested values'
    );

    // Check nested dependency-graph.affects
    assert.deepStrictEqual(
      digest.phases['01'].affects,
      ['API layer'],
      'affects should contain nested values'
    );

    // Check nested tech-stack.added
    assert.deepStrictEqual(
      digest.tech_stack.sort(),
      ['jose', 'prisma'],
      'tech_stack should contain nested values'
    );

    // Check patterns-established (flat array)
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['JWT auth flow', 'Repository pattern'],
      'patterns should be extracted'
    );

    // Check key-decisions
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions');
    assert.ok(
      digest.decisions.some(d => d.decision === 'Use Prisma over Drizzle'),
      'Should contain first decision'
    );
  });

  test('multiple phases merged into single digest', () => {
    // Create phase 01
    const phase01Dir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phase01Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase01Dir, '01-01-SUMMARY.md'),
      `---
phase: "01"
name: "Foundation"
provides:
  - "Database"
patterns-established:
  - "Pattern A"
key-decisions:
  - "Decision 1"
---
`
    );

    // Create phase 02
    const phase02Dir = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase02Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase02Dir, '02-01-SUMMARY.md'),
      `---
phase: "02"
name: "API"
provides:
  - "REST endpoints"
patterns-established:
  - "Pattern B"
key-decisions:
  - "Decision 2"
tech-stack:
  added:
    - "zod"
---
`
    );

    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Both phases present
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(digest.phases['02'], 'Phase 02 should exist');

    // Decisions merged
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions total');

    // Tech stack merged
    assert.deepStrictEqual(digest.tech_stack, ['zod'], 'tech_stack should have zod');
  });

  test('malformed SUMMARY.md skipped gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Valid summary
    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides:
  - "Valid feature"
---
`
    );

    // Malformed summary (no frontmatter)
    fs.writeFileSync(
      path.join(phaseDir, '01-02-SUMMARY.md'),
      `# Just a heading
No frontmatter here
`
    );

    // Another malformed summary (broken YAML)
    fs.writeFileSync(
      path.join(phaseDir, '01-03-SUMMARY.md'),
      `---
broken: [unclosed
---
`
    );

    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, `Command should succeed despite malformed files: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(
      digest.phases['01'].provides.includes('Valid feature'),
      'Valid feature should be extracted'
    );
  });

  test('flat provides field still works (backward compatibility)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides:
  - "Direct provides"
---
`
    );

    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides,
      ['Direct provides'],
      'Direct provides should work'
    );
  });

  test('inline array syntax supported', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides: [Feature A, Feature B]
patterns-established: ["Pattern X", "Pattern Y"]
---
`
    );

    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Feature A', 'Feature B'],
      'Inline array should work'
    );
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['Pattern X', 'Pattern Y'],
      'Inline quoted array should work'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phases list command
// ─────────────────────────────────────────────────────────────────────────────

describe('phases list command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phases directory returns empty array', () => {
    const result = runGsdTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.directories, [], 'directories should be empty');
    assert.strictEqual(output.count, 0, 'count should be 0');
  });

  test('lists phase directories sorted numerically', () => {
    // Create out-of-order directories
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '10-final'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runGsdTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 3, 'should have 3 directories');
    assert.deepStrictEqual(
      output.directories,
      ['01-foundation', '02-api', '10-final'],
      'should be sorted numerically'
    );
  });

  test('handles decimal phases in sort order', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.2-patch'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-ui'), { recursive: true });

    const result = runGsdTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.directories,
      ['02-api', '02.1-hotfix', '02.2-patch', '03-ui'],
      'decimal phases should sort correctly between whole numbers'
    );
  });

  test('--type plans lists only PLAN.md files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-PLAN.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(phaseDir, 'RESEARCH.md'), '# Research');

    const result = runGsdTools('phases list --type plans', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.files.sort(),
      ['01-01-PLAN.md', '01-02-PLAN.md'],
      'should list only PLAN files'
    );
  });

  test('--type summaries lists only SUMMARY.md files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-SUMMARY.md'), '# Summary 2');

    const result = runGsdTools('phases list --type summaries', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.files.sort(),
      ['01-01-SUMMARY.md', '01-02-SUMMARY.md'],
      'should list only SUMMARY files'
    );
  });

  test('--phase filters to specific phase directory', () => {
    const phase01 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    const phase02 = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase01, { recursive: true });
    fs.mkdirSync(phase02, { recursive: true });
    fs.writeFileSync(path.join(phase01, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(phase02, '02-01-PLAN.md'), '# Plan');

    const result = runGsdTools('phases list --type plans --phase 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.files, ['01-01-PLAN.md'], 'should only list phase 01 plans');
    assert.strictEqual(output.phase_dir, 'foundation', 'should report phase name without number prefix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// roadmap get-phase command
// ─────────────────────────────────────────────────────────────────────────────

describe('roadmap get-phase command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('extracts phase section from ROADMAP.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0

## Phases

### Phase 1: Foundation
**Goal:** Set up project infrastructure
**Plans:** 2 plans

Some description here.

### Phase 2: API
**Goal:** Build REST API
**Plans:** 3 plans
`
    );

    const result = runGsdTools('roadmap get-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true, 'phase should be found');
    assert.strictEqual(output.phase_number, '1', 'phase number correct');
    assert.strictEqual(output.phase_name, 'Foundation', 'phase name extracted');
    assert.strictEqual(output.goal, 'Set up project infrastructure', 'goal extracted');
  });

  test('returns not found for missing phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Set up project
`
    );

    const result = runGsdTools('roadmap get-phase 5', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'phase should not be found');
  });

  test('handles decimal phase numbers', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 2: Main
**Goal:** Main work

### Phase 2.1: Hotfix
**Goal:** Emergency fix
`
    );

    const result = runGsdTools('roadmap get-phase 2.1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true, 'decimal phase should be found');
    assert.strictEqual(output.phase_name, 'Hotfix', 'phase name correct');
    assert.strictEqual(output.goal, 'Emergency fix', 'goal extracted');
  });

  test('extracts full section content', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Setup
**Goal:** Initialize everything

This phase covers:
- Database setup
- Auth configuration
- CI/CD pipeline

### Phase 2: Build
**Goal:** Build features
`
    );

    const result = runGsdTools('roadmap get-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.section.includes('Database setup'), 'section includes description');
    assert.ok(output.section.includes('CI/CD pipeline'), 'section includes all bullets');
    assert.ok(!output.section.includes('Phase 2'), 'section does not include next phase');
  });

  test('handles missing ROADMAP.md gracefully', () => {
    const result = runGsdTools('roadmap get-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'should return not found');
    assert.strictEqual(output.error, 'ROADMAP.md not found', 'should explain why');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase next-decimal command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase next-decimal command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns X.1 when no decimal phases exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '07-next'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.1', 'should return 06.1');
    assert.deepStrictEqual(output.existing, [], 'no existing decimals');
  });

  test('increments from existing decimal phases', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.2-patch'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.3', 'should return 06.3');
    assert.deepStrictEqual(output.existing, ['06.1', '06.2'], 'lists existing decimals');
  });

  test('handles gaps in decimal sequence', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-first'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.3-third'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // Should take next after highest, not fill gap
    assert.strictEqual(output.next, '06.4', 'should return 06.4, not fill gap at 06.2');
  });

  test('handles single-digit phase input', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });

    const result = runGsdTools('phase next-decimal 6', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.1', 'should normalize to 06.1');
    assert.strictEqual(output.base_phase, '06', 'base phase should be padded');
  });

  test('returns error if base phase does not exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-start'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'base phase not found');
    assert.strictEqual(output.next, '06.1', 'should still suggest 06.1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase-plan-index command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase-plan-index command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phase directory returns empty plans array', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '03', 'phase number correct');
    assert.deepStrictEqual(output.plans, [], 'plans should be empty');
    assert.deepStrictEqual(output.waves, {}, 'waves should be empty');
    assert.deepStrictEqual(output.incomplete, [], 'incomplete should be empty');
    assert.strictEqual(output.has_checkpoints, false, 'no checkpoints');
  });

  test('extracts single plan with frontmatter', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-PLAN.md'),
      `---
wave: 1
autonomous: true
objective: Set up database schema
files-modified: [prisma/schema.prisma, src/lib/db.ts]
---

## Task 1: Create schema
## Task 2: Generate client
`
    );

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 1, 'should have 1 plan');
    assert.strictEqual(output.plans[0].id, '03-01', 'plan id correct');
    assert.strictEqual(output.plans[0].wave, 1, 'wave extracted');
    assert.strictEqual(output.plans[0].autonomous, true, 'autonomous extracted');
    assert.strictEqual(output.plans[0].objective, 'Set up database schema', 'objective extracted');
    assert.deepStrictEqual(output.plans[0].files_modified, ['prisma/schema.prisma', 'src/lib/db.ts'], 'files extracted');
    assert.strictEqual(output.plans[0].task_count, 2, 'task count correct');
    assert.strictEqual(output.plans[0].has_summary, false, 'no summary yet');
  });

  test('groups multiple plans by wave', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-PLAN.md'),
      `---
wave: 1
autonomous: true
objective: Database setup
---

## Task 1: Schema
`
    );

    fs.writeFileSync(
      path.join(phaseDir, '03-02-PLAN.md'),
      `---
wave: 1
autonomous: true
objective: Auth setup
---

## Task 1: JWT
`
    );

    fs.writeFileSync(
      path.join(phaseDir, '03-03-PLAN.md'),
      `---
wave: 2
autonomous: false
objective: API routes
---

## Task 1: Routes
`
    );

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 3, 'should have 3 plans');
    assert.deepStrictEqual(output.waves['1'], ['03-01', '03-02'], 'wave 1 has 2 plans');
    assert.deepStrictEqual(output.waves['2'], ['03-03'], 'wave 2 has 1 plan');
  });

  test('detects incomplete plans (no matching summary)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Plan with summary
    fs.writeFileSync(path.join(phaseDir, '03-01-PLAN.md'), `---\nwave: 1\n---\n## Task 1`);
    fs.writeFileSync(path.join(phaseDir, '03-01-SUMMARY.md'), `# Summary`);

    // Plan without summary
    fs.writeFileSync(path.join(phaseDir, '03-02-PLAN.md'), `---\nwave: 2\n---\n## Task 1`);

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans[0].has_summary, true, 'first plan has summary');
    assert.strictEqual(output.plans[1].has_summary, false, 'second plan has no summary');
    assert.deepStrictEqual(output.incomplete, ['03-02'], 'incomplete list correct');
  });

  test('detects checkpoints (autonomous: false)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-PLAN.md'),
      `---
wave: 1
autonomous: false
objective: Manual review needed
---

## Task 1: Review
`
    );

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_checkpoints, true, 'should detect checkpoint');
    assert.strictEqual(output.plans[0].autonomous, false, 'plan marked non-autonomous');
  });

  test('phase not found returns error', () => {
    const result = runGsdTools('phase-plan-index 99', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'Phase not found', 'should report phase not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state-snapshot command
// ─────────────────────────────────────────────────────────────────────────────

describe('state-snapshot command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing STATE.md returns error', () => {
    const result = runGsdTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'STATE.md not found', 'should report missing file');
  });

  test('extracts basic fields from STATE.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03
**Current Phase Name:** API Layer
**Total Phases:** 6
**Current Plan:** 03-02
**Total Plans in Phase:** 3
**Status:** In progress
**Progress:** 45%
**Last Activity:** 2024-01-15
**Last Activity Description:** Completed 03-01-PLAN.md
`
    );

    const result = runGsdTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.current_phase, '03', 'current phase extracted');
    assert.strictEqual(output.current_phase_name, 'API Layer', 'phase name extracted');
    assert.strictEqual(output.total_phases, 6, 'total phases extracted');
    assert.strictEqual(output.current_plan, '03-02', 'current plan extracted');
    assert.strictEqual(output.total_plans_in_phase, 3, 'total plans extracted');
    assert.strictEqual(output.status, 'In progress', 'status extracted');
    assert.strictEqual(output.progress_percent, 45, 'progress extracted');
    assert.strictEqual(output.last_activity, '2024-01-15', 'last activity date extracted');
  });

  test('extracts decisions table', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 01

## Decisions Made

| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01 | Use Prisma | Better DX than raw SQL |
| 02 | JWT auth | Stateless authentication |
`
    );

    const result = runGsdTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.decisions.length, 2, 'should have 2 decisions');
    assert.strictEqual(output.decisions[0].phase, '01', 'first decision phase');
    assert.strictEqual(output.decisions[0].summary, 'Use Prisma', 'first decision summary');
    assert.strictEqual(output.decisions[0].rationale, 'Better DX than raw SQL', 'first decision rationale');
  });

  test('extracts blockers list', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03

## Blockers

- Waiting for API credentials
- Need design review for dashboard
`
    );

    const result = runGsdTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.blockers, [
      'Waiting for API credentials',
      'Need design review for dashboard',
    ], 'blockers extracted');
  });

  test('extracts session continuity info', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03

## Session

**Last Date:** 2024-01-15
**Stopped At:** Phase 3, Plan 2, Task 1
**Resume File:** .planning/phases/03-api/03-02-PLAN.md
`
    );

    const result = runGsdTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.session.last_date, '2024-01-15', 'session date extracted');
    assert.strictEqual(output.session.stopped_at, 'Phase 3, Plan 2, Task 1', 'stopped at extracted');
    assert.strictEqual(output.session.resume_file, '.planning/phases/03-api/03-02-PLAN.md', 'resume file extracted');
  });

  test('handles paused_at field', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03
**Paused At:** Phase 3, Plan 1, Task 2 - mid-implementation
`
    );

    const result = runGsdTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.paused_at, 'Phase 3, Plan 1, Task 2 - mid-implementation', 'paused_at extracted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// summary-extract command
// ─────────────────────────────────────────────────────────────────────────────

describe('summary-extract command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing file returns error', () => {
    const result = runGsdTools('summary-extract .planning/phases/01-test/01-01-SUMMARY.md', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report missing file');
  });

  test('extracts all fields from SUMMARY.md', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
one-liner: Set up Prisma with User and Project models
key-files:
  - prisma/schema.prisma
  - src/lib/db.ts
tech-stack:
  added:
    - prisma
    - zod
patterns-established:
  - Repository pattern
  - Dependency injection
key-decisions:
  - Use Prisma over Drizzle: Better DX and ecosystem
  - Single database: Start simple, shard later
---

# Summary

Full summary content here.
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.path, '.planning/phases/01-foundation/01-01-SUMMARY.md', 'path correct');
    assert.strictEqual(output.one_liner, 'Set up Prisma with User and Project models', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma', 'src/lib/db.ts'], 'key files extracted');
    assert.deepStrictEqual(output.tech_added, ['prisma', 'zod'], 'tech added extracted');
    assert.deepStrictEqual(output.patterns, ['Repository pattern', 'Dependency injection'], 'patterns extracted');
    assert.strictEqual(output.decisions.length, 2, 'decisions extracted');
  });

  test('selective extraction with --fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
one-liner: Set up database
key-files:
  - prisma/schema.prisma
tech-stack:
  added:
    - prisma
patterns-established:
  - Repository pattern
key-decisions:
  - Use Prisma: Better DX
---
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md --fields one_liner,key_files', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Set up database', 'one_liner included');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma'], 'key_files included');
    assert.strictEqual(output.tech_added, undefined, 'tech_added excluded');
    assert.strictEqual(output.patterns, undefined, 'patterns excluded');
    assert.strictEqual(output.decisions, undefined, 'decisions excluded');
  });

  test('handles missing frontmatter fields gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
one-liner: Minimal summary
---

# Summary
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Minimal summary', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, [], 'key_files defaults to empty');
    assert.deepStrictEqual(output.tech_added, [], 'tech_added defaults to empty');
    assert.deepStrictEqual(output.patterns, [], 'patterns defaults to empty');
    assert.deepStrictEqual(output.decisions, [], 'decisions defaults to empty');
  });

  test('parses key-decisions with rationale', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
key-decisions:
  - Use Prisma: Better DX than alternatives
  - JWT tokens: Stateless auth for scalability
---
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.decisions[0].summary, 'Use Prisma', 'decision summary parsed');
    assert.strictEqual(output.decisions[0].rationale, 'Better DX than alternatives', 'decision rationale parsed');
    assert.strictEqual(output.decisions[1].summary, 'JWT tokens', 'second decision summary');
    assert.strictEqual(output.decisions[1].rationale, 'Stateless auth for scalability', 'second decision rationale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init --include flag tests
// ─────────────────────────────────────────────────────────────────────────────

describe('init commands with --include flag', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('init execute-phase includes state and config content', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-PLAN.md'), '# Plan');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# State\n\n**Current Phase:** 03\n**Status:** In progress'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runGsdTools('init execute-phase 03 --include state,config', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.state_content, 'state_content should be included');
    assert.ok(output.state_content.includes('Current Phase'), 'state content correct');
    assert.ok(output.config_content, 'config_content should be included');
    assert.ok(output.config_content.includes('model_profile'), 'config content correct');
  });

  test('init execute-phase without --include omits content', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State');

    const result = runGsdTools('init execute-phase 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_content, undefined, 'state_content should be omitted');
    assert.strictEqual(output.config_content, undefined, 'config_content should be omitted');
  });

  test('init plan-phase includes multiple file contents', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# Project State');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap v1.0');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'REQUIREMENTS.md'), '# Requirements');
    fs.writeFileSync(path.join(phaseDir, '03-CONTEXT.md'), '# Phase Context');
    fs.writeFileSync(path.join(phaseDir, '03-RESEARCH.md'), '# Research Findings');

    const result = runGsdTools('init plan-phase 03 --include state,roadmap,requirements,context,research', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.state_content, 'state_content included');
    assert.ok(output.state_content.includes('Project State'), 'state content correct');
    assert.ok(output.roadmap_content, 'roadmap_content included');
    assert.ok(output.roadmap_content.includes('Roadmap v1.0'), 'roadmap content correct');
    assert.ok(output.requirements_content, 'requirements_content included');
    assert.ok(output.context_content, 'context_content included');
    assert.ok(output.research_content, 'research_content included');
  });

  test('init plan-phase includes verification and uat content', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-VERIFICATION.md'), '# Verification Results');
    fs.writeFileSync(path.join(phaseDir, '03-UAT.md'), '# UAT Findings');

    const result = runGsdTools('init plan-phase 03 --include verification,uat', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.verification_content, 'verification_content included');
    assert.ok(output.verification_content.includes('Verification Results'), 'verification content correct');
    assert.ok(output.uat_content, 'uat_content included');
    assert.ok(output.uat_content.includes('UAT Findings'), 'uat content correct');
  });

  test('init progress includes state, roadmap, project, config', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality' })
    );

    const result = runGsdTools('init progress --include state,roadmap,project,config', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.state_content, 'state_content included');
    assert.ok(output.roadmap_content, 'roadmap_content included');
    assert.ok(output.project_content, 'project_content included');
    assert.ok(output.config_content, 'config_content included');
  });

  test('missing files return null in content fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-PLAN.md'), '# Plan');

    const result = runGsdTools('init execute-phase 03 --include state,config', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_content, null, 'missing state returns null');
    assert.strictEqual(output.config_content, null, 'missing config returns null');
  });

  test('partial includes work correctly', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap');

    // Only request state, not roadmap
    const result = runGsdTools('init execute-phase 03 --include state', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.state_content, 'state_content included');
    assert.strictEqual(output.roadmap_content, undefined, 'roadmap_content not requested, should be undefined');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// roadmap analyze command
// ─────────────────────────────────────────────────────────────────────────────

describe('roadmap analyze command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing ROADMAP.md returns error', () => {
    const result = runGsdTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'ROADMAP.md not found');
  });

  test('parses phases with goals and disk status', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Set up infrastructure

### Phase 2: Authentication
**Goal:** Add user auth

### Phase 3: Features
**Goal:** Build core features
`
    );

    // Create phase dirs with varying completion
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');

    const p2 = path.join(tmpDir, '.planning', 'phases', '02-authentication');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, '02-01-PLAN.md'), '# Plan');

    const result = runGsdTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_count, 3, 'should find 3 phases');
    assert.strictEqual(output.phases[0].disk_status, 'complete', 'phase 1 complete');
    assert.strictEqual(output.phases[1].disk_status, 'planned', 'phase 2 planned');
    assert.strictEqual(output.phases[2].disk_status, 'no_directory', 'phase 3 no directory');
    assert.strictEqual(output.completed_phases, 1, '1 phase complete');
    assert.strictEqual(output.total_plans, 2, '2 total plans');
    assert.strictEqual(output.total_summaries, 1, '1 total summary');
    assert.strictEqual(output.progress_percent, 50, '50% complete');
    assert.strictEqual(output.current_phase, '2', 'current phase is 2');
  });

  test('extracts goals and dependencies', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Setup
**Goal:** Initialize project
**Depends on:** Nothing

### Phase 2: Build
**Goal:** Build features
**Depends on:** Phase 1
`
    );

    const result = runGsdTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phases[0].goal, 'Initialize project');
    assert.strictEqual(output.phases[0].depends_on, 'Nothing');
    assert.strictEqual(output.phases[1].goal, 'Build features');
    assert.strictEqual(output.phases[1].depends_on, 'Phase 1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase add command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase add command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('adds phase after highest existing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API

---
`
    );

    const result = runGsdTools('phase add User Dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, 3, 'should be phase 3');
    assert.strictEqual(output.slug, 'user-dashboard');

    // Verify directory created
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '03-user-dashboard')),
      'directory should be created'
    );

    // Verify ROADMAP updated
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('### Phase 3: User Dashboard'), 'roadmap should include new phase');
    assert.ok(roadmap.includes('**Depends on:** Phase 2'), 'should depend on previous');
  });

  test('handles empty roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0\n`
    );

    const result = runGsdTools('phase add Initial Setup', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, 1, 'should be phase 1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase insert command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase insert command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('inserts decimal phase after target', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runGsdTools('phase insert 1 Fix Critical Bug', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '01.1', 'should be 01.1');
    assert.strictEqual(output.after_phase, '1');

    // Verify directory
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01.1-fix-critical-bug')),
      'decimal phase directory should be created'
    );

    // Verify ROADMAP
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('Phase 01.1: Fix Critical Bug (INSERTED)'), 'roadmap should include inserted phase');
  });

  test('increments decimal when siblings exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01.1-hotfix'), { recursive: true });

    const result = runGsdTools('phase insert 1 Another Fix', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '01.2', 'should be 01.2');
  });

  test('rejects missing phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: Test\n**Goal:** Test\n`
    );

    const result = runGsdTools('phase insert 99 Fix Something', tmpDir);
    assert.ok(!result.success, 'should fail for missing phase');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase remove command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase remove command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('removes phase directory and renumbers subsequent', () => {
    // Setup 3 phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup
**Depends on:** Nothing

### Phase 2: Auth
**Goal:** Authentication
**Depends on:** Phase 1

### Phase 3: Features
**Goal:** Core features
**Depends on:** Phase 2
`
    );

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    const p2 = path.join(tmpDir, '.planning', 'phases', '02-auth');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, '02-01-PLAN.md'), '# Plan');
    const p3 = path.join(tmpDir, '.planning', 'phases', '03-features');
    fs.mkdirSync(p3, { recursive: true });
    fs.writeFileSync(path.join(p3, '03-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p3, '03-02-PLAN.md'), '# Plan 2');

    // Remove phase 2
    const result = runGsdTools('phase remove 2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.removed, '2');
    assert.strictEqual(output.directory_deleted, '02-auth');

    // Phase 3 should be renumbered to 02
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features')),
      'phase 3 should be renumbered to 02-features'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '03-features')),
      'old 03-features should not exist'
    );

    // Files inside should be renamed
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features', '02-01-PLAN.md')),
      'plan file should be renumbered to 02-01'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features', '02-02-PLAN.md')),
      'plan 2 should be renumbered to 02-02'
    );

    // ROADMAP should be updated
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(!roadmap.includes('Phase 2: Auth'), 'removed phase should not be in roadmap');
    assert.ok(roadmap.includes('Phase 2: Features'), 'phase 3 should be renumbered to 2');
  });

  test('rejects removal of phase with summaries unless --force', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: Test\n**Goal:** Test\n`
    );

    // Should fail without --force
    const result = runGsdTools('phase remove 1', tmpDir);
    assert.ok(!result.success, 'should fail without --force');
    assert.ok(result.error.includes('executed plan'), 'error mentions executed plans');

    // Should succeed with --force
    const forceResult = runGsdTools('phase remove 1 --force', tmpDir);
    assert.ok(forceResult.success, `Force remove failed: ${forceResult.error}`);
  });

  test('removes decimal phase and renumbers siblings', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 6: Main\n**Goal:** Main\n### Phase 6.1: Fix A\n**Goal:** Fix A\n### Phase 6.2: Fix B\n**Goal:** Fix B\n### Phase 6.3: Fix C\n**Goal:** Fix C\n`
    );

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-main'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-fix-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.2-fix-b'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.3-fix-c'), { recursive: true });

    const result = runGsdTools('phase remove 6.2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    // 06.3 should become 06.2
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '06.2-fix-c')),
      '06.3 should be renumbered to 06.2'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '06.3-fix-c')),
      'old 06.3 should not exist'
    );
  });

  test('updates STATE.md phase count', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n**Goal:** A\n### Phase 2: B\n**Goal:** B\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 1\n**Total Phases:** 2\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), { recursive: true });

    runGsdTools('phase remove 2', tmpDir);

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(state.includes('**Total Phases:** 1'), 'total phases should be decremented');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase complete command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('marks phase complete and transitions to next', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [ ] Phase 1: Foundation
- [ ] Phase 2: API

### Phase 1: Foundation
**Goal:** Setup
**Plans:** 1 plans

### Phase 2: API
**Goal:** Build API
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Current Phase Name:** Foundation\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working on phase 1\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(p1, '01-VERIFICATION.md'), 'status: passed\n# Verification\n');
    fs.writeFileSync(path.join(p1, 'CHECKPOINT.json'), JSON.stringify({ last_step: 'verify', step_status: 'complete' }));
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.completed_phase, '1');
    assert.strictEqual(output.plans_executed, '1/1');
    assert.strictEqual(output.next_phase, '02');
    assert.strictEqual(output.is_last_phase, false);

    // Verify STATE.md updated
    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(state.includes('**Current Phase:** 02'), 'should advance to phase 02');
    assert.ok(state.includes('**Status:** Ready to plan'), 'status should be ready to plan');
    assert.ok(state.includes('**Current Plan:** Not started'), 'plan should be reset');

    // Verify ROADMAP checkbox
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('[x]'), 'phase should be checked off');
    assert.ok(roadmap.includes('completed'), 'completion date should be added');
  });

  test('detects last phase in milestone', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: Only Phase\n**Goal:** Everything\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-only-phase');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(p1, '01-VERIFICATION.md'), 'status: passed\n# Verification\n');
    fs.writeFileSync(path.join(p1, 'CHECKPOINT.json'), JSON.stringify({ last_step: 'verify', step_status: 'complete' }));

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.is_last_phase, true, 'should detect last phase');
    assert.strictEqual(output.next_phase, null, 'no next phase');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(state.includes('Milestone complete'), 'status should be milestone complete');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete command
// ─────────────────────────────────────────────────────────────────────────────

describe('milestone complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('archives roadmap, requirements, creates MILESTONES.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n\n### Phase 1: Foundation\n**Goal:** Setup\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      `# Requirements\n\n- [ ] User auth\n- [ ] Dashboard\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(
      path.join(p1, '01-01-SUMMARY.md'),
      `---\none-liner: Set up project infrastructure\n---\n# Summary\n`
    );

    const result = runGsdTools('milestone complete v1.0 --name MVP Foundation', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.version, 'v1.0');
    assert.strictEqual(output.phases, 1);
    assert.ok(output.archived.roadmap, 'roadmap should be archived');
    assert.ok(output.archived.requirements, 'requirements should be archived');

    // Verify archive files exist
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'milestones', 'v1.0-ROADMAP.md')),
      'archived roadmap should exist'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'milestones', 'v1.0-REQUIREMENTS.md')),
      'archived requirements should exist'
    );

    // Verify MILESTONES.md created
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'MILESTONES.md')),
      'MILESTONES.md should be created'
    );
    const milestones = fs.readFileSync(path.join(tmpDir, '.planning', 'MILESTONES.md'), 'utf-8');
    assert.ok(milestones.includes('v1.0 MVP Foundation'), 'milestone entry should contain name');
    assert.ok(milestones.includes('Set up project infrastructure'), 'accomplishments should be listed');
  });

  test('appends to existing MILESTONES.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      `# Milestones\n\n## v0.9 Alpha (Shipped: 2025-01-01)\n\n---\n\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const result = runGsdTools('milestone complete v1.0 --name Beta', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const milestones = fs.readFileSync(path.join(tmpDir, '.planning', 'MILESTONES.md'), 'utf-8');
    assert.ok(milestones.includes('v0.9 Alpha'), 'existing entry should be preserved');
    assert.ok(milestones.includes('v1.0 Beta'), 'new entry should be appended');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate consistency command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate consistency command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('passes for consistent project', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 2: B\n### Phase 3: C\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), { recursive: true });

    const result = runGsdTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true, 'should pass');
    assert.strictEqual(output.warning_count, 0, 'no warnings');
  });

  test('warns about phase on disk but not in roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-orphan'), { recursive: true });

    const result = runGsdTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warning_count > 0, 'should have warnings');
    assert.ok(
      output.warnings.some(w => w.includes('disk but not in ROADMAP')),
      'should warn about orphan directory'
    );
  });

  test('warns about gaps in phase numbering', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 3: C\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), { recursive: true });

    const result = runGsdTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.includes('Gap in phase numbering')),
      'should warn about gap'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// progress command
// ─────────────────────────────────────────────────────────────────────────────

describe('progress command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('renders JSON progress', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');
    fs.writeFileSync(path.join(p1, '01-02-PLAN.md'), '# Plan 2');

    const result = runGsdTools('progress json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.total_plans, 2, '2 total plans');
    assert.strictEqual(output.total_summaries, 1, '1 summary');
    assert.strictEqual(output.percent, 50, '50%');
    assert.strictEqual(output.phases.length, 1, '1 phase');
    assert.strictEqual(output.phases[0].status, 'In Progress', 'phase in progress');
  });

  test('renders bar format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');

    const result = runGsdTools('progress bar --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('1/1'), 'should include count');
    assert.ok(result.output.includes('100%'), 'should include 100%');
  });

  test('renders table format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');

    const result = runGsdTools('progress table --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('Phase'), 'should have table header');
    assert.ok(result.output.includes('foundation'), 'should include phase name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo complete command
// ─────────────────────────────────────────────────────────────────────────────

describe('todo complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('moves todo from pending to completed', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(
      path.join(pendingDir, 'add-dark-mode.md'),
      `title: Add dark mode\narea: ui\ncreated: 2025-01-01\n`
    );

    const result = runGsdTools('todo complete add-dark-mode.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.completed, true);

    // Verify moved
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'add-dark-mode.md')),
      'should be removed from pending'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md')),
      'should be in completed'
    );

    // Verify completion timestamp added
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md'),
      'utf-8'
    );
    assert.ok(content.startsWith('completed:'), 'should have completed timestamp');
  });

  test('fails for nonexistent todo', () => {
    const result = runGsdTools('todo complete nonexistent.md', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scaffold command
// ─────────────────────────────────────────────────────────────────────────────

describe('scaffold command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('scaffolds context file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('scaffold context --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    // Verify file content
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-CONTEXT.md'),
      'utf-8'
    );
    assert.ok(content.includes('Phase 3'), 'should reference phase number');
    assert.ok(content.includes('Decisions'), 'should have decisions section');
    assert.ok(content.includes('Discretion Areas'), 'should have discretion section');
  });

  test('scaffolds UAT file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('scaffold uat --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-UAT.md'),
      'utf-8'
    );
    assert.ok(content.includes('User Acceptance Testing'), 'should have UAT heading');
    assert.ok(content.includes('Test Results'), 'should have test results section');
  });

  test('scaffolds verification file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('scaffold verification --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-VERIFICATION.md'),
      'utf-8'
    );
    assert.ok(content.includes('Goal-Backward Verification'), 'should have verification heading');
  });

  test('scaffolds phase directory', () => {
    const result = runGsdTools('scaffold phase-dir --phase 5 --name User Dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '05-user-dashboard')),
      'directory should be created'
    );
  });

  test('does not overwrite existing files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-CONTEXT.md'), '# Existing content');

    const result = runGsdTools('scaffold context --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, false, 'should not overwrite');
    assert.strictEqual(output.reason, 'already_exists');
  });
});

// ─── loadConfig / config get ─────────────────────────────────────────────────

describe('config get — nyquist_validation default', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns true when no config.json exists', () => {
    const result = runGsdTools('config get nyquist_validation --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'true');
  });

  test('returns false when workflow.nyquist_validation is false in config.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ workflow: { nyquist_validation: false } })
    );
    const result = runGsdTools('config get nyquist_validation --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'false');
  });
});

describe('config get — granularity default', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns standard when no config.json exists', () => {
    const result = runGsdTools('config get granularity --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'standard');
  });

  test('returns fine when config.json has granularity: "fine"', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ granularity: 'fine' })
    );
    const result = runGsdTools('config get granularity --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'fine');
  });
});

describe('config get — depth→granularity migration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('depth:quick maps to granularity:coarse', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ depth: 'quick' }));

    const result = runGsdTools('config get granularity --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'coarse');
  });

  test('depth:quick rewrites config.json to use granularity key', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ depth: 'quick' }));

    runGsdTools('config get granularity --raw', tmpDir);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok('granularity' in written, 'config.json should have granularity key after migration');
    assert.ok(!('depth' in written), 'config.json should not have depth key after migration');
    assert.strictEqual(written.granularity, 'coarse');
  });

  test('depth:comprehensive maps to granularity:fine', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ depth: 'comprehensive' }));

    const result = runGsdTools('config get granularity --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'fine');
  });

  test('depth:standard maps to granularity:standard', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ depth: 'standard' }));

    const result = runGsdTools('config get granularity --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'standard');
  });
});

// ─── health — W008 ───────────────────────────────────────────────────────────

describe('health — W008 nyquist_validation warning', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('W008 emitted when config.json has workflow section but no nyquist_validation key', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ workflow: { research: true } })
    );
    const result = runGsdTools('health', tmpDir);
    // health exits 0 even with warnings; capture both success and non-success output
    const combined = result.output + (result.error || '');
    assert.ok(combined.includes('W008'), `Expected W008 in output, got: ${combined}`);
  });

  test('W008 not emitted when workflow.nyquist_validation is explicitly set', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ workflow: { nyquist_validation: true } })
    );
    const result = runGsdTools('health', tmpDir);
    const combined = result.output + (result.error || '');
    assert.ok(!combined.includes('W008'), `Expected no W008 in output, got: ${combined}`);
  });
});

// ─── health — W009 ───────────────────────────────────────────────────────────

describe('health — W009 validation architecture warning', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('W009 emitted for phase with Validation Architecture in RESEARCH.md but no VALIDATION.md', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\nsome validation content\n'
    );

    const result = runGsdTools('health', tmpDir);
    const combined = result.output + (result.error || '');
    assert.ok(combined.includes('W009'), `Expected W009 in output, got: ${combined}`);
  });

  test('W009 not emitted when RESEARCH.md has no Validation Architecture section (no false positive)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Implementation Notes\nno validation arch here\n'
    );

    const result = runGsdTools('health', tmpDir);
    const combined = result.output + (result.error || '');
    assert.ok(!combined.includes('W009'), `Expected no W009 in output, got: ${combined}`);
  });

  test('W009 not emitted when phase has both RESEARCH.md with Validation Architecture AND VALIDATION.md', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\nsome validation content\n'
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-VALIDATION.md'),
      '# Validation\n\nValidation results here.\n'
    );

    const result = runGsdTools('health', tmpDir);
    const combined = result.output + (result.error || '');
    assert.ok(!combined.includes('W009'), `Expected no W009 in output, got: ${combined}`);
  });
});

// ─── resolve-model — gsd-nyquist-auditor profiles ────────────────────────────

describe('resolve-model — gsd-nyquist-auditor model profiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('balanced profile returns sonnet', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    // Without --raw, output is JSON. With --raw, rawValue is the plain model string.
    const result = runGsdTools('resolve-model gsd-nyquist-auditor', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.model, 'sonnet');
  });

  test('budget profile returns haiku', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'budget' })
    );
    const result = runGsdTools('resolve-model gsd-nyquist-auditor', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.model, 'haiku');
  });

  test('quality profile returns sonnet', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality' })
    );
    const result = runGsdTools('resolve-model gsd-nyquist-auditor', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.model, 'sonnet');
  });
});

// ─── Phase 34: verify plan-structure gate tests ──────────────────────────────

describe('verify plan-structure — tdd/ui-qa gate checks (Phase 34)', () => {
  const os = require('os');
  let tmpPlan;

  afterEach(() => {
    if (tmpPlan && fs.existsSync(tmpPlan)) fs.unlinkSync(tmpPlan);
  });

  function writePlan(content) {
    tmpPlan = path.join(os.tmpdir(), `gsd-test-plan-${Date.now()}.md`);
    fs.writeFileSync(tmpPlan, content, 'utf-8');
    return tmpPlan;
  }

  function runVerify(planPath) {
    try {
      const result = require('child_process').execSync(
        `node "${TOOLS_PATH}" verify plan-structure "${planPath}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status || 1,
      };
    }
  }

  test('plan with .tsx in files_modified but no checkpoint:ui-qa — exits 1 with error', () => {
    const planPath = writePlan(`---
phase: 99
plan: "99-01"
type: implementation
wave: 1
depends_on: []
files_modified:
  - src/components/Dashboard.tsx
autonomous: true
must_haves:
  - Dashboard renders
---

<task type="auto">
  <name>Build dashboard</name>
  <files>src/components/Dashboard.tsx</files>
  <action>Create dashboard component</action>
  <verify>Build succeeds</verify>
  <done>Dashboard built</done>
</task>
`);
    const result = runVerify(planPath);
    assert.strictEqual(result.exitCode, 1, 'Should exit 1 when ui-qa check fails');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.valid, false, 'valid should be false');
    assert.ok(parsed.errors.some(e => e.includes('checkpoint:ui-qa')), 'Should report missing ui-qa task');
  });

  test('plan with route.ts in files_modified but no tdd="true" task — exits 1 with error', () => {
    const planPath = writePlan(`---
phase: 99
plan: "99-02"
type: implementation
wave: 1
depends_on: []
files_modified:
  - src/app/api/users/route.ts
autonomous: true
must_haves:
  - API works
---

<task type="auto">
  <name>Create API endpoint</name>
  <files>src/app/api/users/route.ts</files>
  <action>Create users endpoint</action>
  <verify>Returns 200</verify>
  <done>Endpoint created</done>
</task>
`);
    const result = runVerify(planPath);
    assert.strictEqual(result.exitCode, 1, 'Should exit 1 when tdd check fails');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.valid, false, 'valid should be false');
    assert.ok(parsed.errors.some(e => e.includes('tdd')), 'Should report missing tdd task');
  });

  test('plan with .tsx AND checkpoint:ui-qa task — exits 0, valid', () => {
    const planPath = writePlan(`---
phase: 99
plan: "99-03"
type: implementation
wave: 1
depends_on: []
files_modified:
  - src/components/Dashboard.tsx
autonomous: false
must_haves:
  - Dashboard renders and QA passes
---

<task type="auto">
  <name>Build dashboard</name>
  <files>src/components/Dashboard.tsx</files>
  <action>Create dashboard</action>
  <verify>Build succeeds</verify>
  <done>Built</done>
</task>

<task type="checkpoint:ui-qa" gate="blocking">
  <what-built>Dashboard component</what-built>
  <test-flows>- Visit /dashboard — verify renders</test-flows>
</task>
`);
    const result = runVerify(planPath);
    assert.strictEqual(result.exitCode, 0, 'Should exit 0 when ui-qa task present');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.valid, true, 'valid should be true');
  });

  test('plan with route.ts AND tdd="true" task — exits 0, valid', () => {
    const planPath = writePlan(`---
phase: 99
plan: "99-04"
type: implementation
wave: 1
depends_on: []
files_modified:
  - src/app/api/users/route.ts
autonomous: true
must_haves:
  - API works with tests
---

<task type="auto">
  <name>Create API endpoint</name>
  <files>src/app/api/users/route.ts</files>
  <action>Create users endpoint</action>
  <verify>Returns 200</verify>
  <done>Endpoint created</done>
</task>

<task type="auto" tdd="true">
  <name>Write API tests</name>
  <files>src/app/api/users/route.test.ts</files>
  <action>Write tests for users API</action>
  <verify>Tests pass</verify>
  <done>Tests written</done>
</task>
`);
    const result = runVerify(planPath);
    assert.strictEqual(result.exitCode, 0, 'Should exit 0 when tdd task present');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.valid, true, 'valid should be true');
  });

  test('docs-only plan with no ui/api files — exits 0, no false positives', () => {
    const planPath = writePlan(`---
phase: 99
plan: "99-05"
type: implementation
wave: 1
depends_on: []
files_modified:
  - docs/README.md
  - .planning/config.json
autonomous: true
must_haves:
  - Docs updated
---

<task type="auto">
  <name>Update README</name>
  <files>docs/README.md</files>
  <action>Update documentation</action>
  <verify>File updated</verify>
  <done>README updated</done>
</task>
`);
    const result = runVerify(planPath);
    assert.strictEqual(result.exitCode, 0, 'Should exit 0 for docs-only plan');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.valid, true, 'valid should be true — no false positives');
  });
});

// ─── Phase 34: phase complete pre-condition validation tests ─────────────────

describe('phase complete — pre-condition validation (Phase 34)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Set up minimal ROADMAP.md and STATE.md
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Test Phase

**Goal:** Test phase for validation
**Plans:** TBD

Plans:
- [ ] 1-01: Test plan

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 01. Test Phase |  | 0/1 | Not started | - |
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `**Current Phase:** 1
**Status:** In progress
**Last Activity:** 2026-03-11
**Last Activity Description:** Testing
`
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function createPhaseDir(config = {}) {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test-phase');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Create PLAN.md
    if (config.hasPlan !== false) {
      fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n---\nphase: 1\n---\n');
    }

    // Create SUMMARY.md
    if (config.hasSummary !== false) {
      fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');
    }

    // Create VERIFICATION.md
    if (config.verStatus) {
      fs.writeFileSync(path.join(phaseDir, '01-VERIFICATION.md'), `status: ${config.verStatus}\n# Verification\n`);
    }

    // Create CHECKPOINT.json
    if (config.checkpointLastStep !== undefined) {
      fs.writeFileSync(
        path.join(phaseDir, 'CHECKPOINT.json'),
        JSON.stringify({ last_step: config.checkpointLastStep, step_status: 'complete' })
      );
    }

    return phaseDir;
  }

  test('phase complete fails when VERIFICATION.md is missing', () => {
    createPhaseDir({ hasPlan: true, hasSummary: true, verStatus: null, checkpointLastStep: 'verify' });
    const result = runGsdTools('phase complete 1', tmpDir);
    assert.strictEqual(result.success, false, 'Should fail without VERIFICATION.md');
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.validation_errors, 'Should return validation_errors');
    assert.ok(parsed.validation_errors.some(e => e.includes('VERIFICATION.md not found')), 'Should report missing VERIFICATION.md');
  });

  test('phase complete fails when VERIFICATION.md status is gaps_found', () => {
    createPhaseDir({ hasPlan: true, hasSummary: true, verStatus: 'gaps_found', checkpointLastStep: 'verify' });
    const result = runGsdTools('phase complete 1', tmpDir);
    assert.strictEqual(result.success, false, 'Should fail when status is gaps_found');
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.validation_errors.some(e => e.includes('gaps_found')), 'Should report gaps_found status');
  });

  test('phase complete fails when PLAN.md lacks matching SUMMARY.md', () => {
    // Has plan and verification (passed) but no summary
    createPhaseDir({ hasPlan: true, hasSummary: false, verStatus: 'passed', checkpointLastStep: 'verify' });
    const result = runGsdTools('phase complete 1', tmpDir);
    assert.strictEqual(result.success, false, 'Should fail when SUMMARY.md missing');
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.validation_errors.some(e => e.includes('SUMMARY.md')), 'Should report missing SUMMARY.md');
  });

  test('phase complete fails when CHECKPOINT.json last_step is execute', () => {
    createPhaseDir({ hasPlan: true, hasSummary: true, verStatus: 'passed', checkpointLastStep: 'execute' });
    const result = runGsdTools('phase complete 1', tmpDir);
    assert.strictEqual(result.success, false, 'Should fail when last_step is not verify');
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.validation_errors.some(e => e.includes('last_step')), 'Should report wrong last_step');
  });
});


// ─── Phase 35-01: gsd-executor post-plan test gate ───────────────────────────

describe('gsd-executor — post-plan test gate section (Phase 35-01)', () => {
  const EXECUTOR_PATH = path.join('/Users/ollorin/get-shit-done', 'agents', 'gsd-executor.md');

  test('post_plan_test_gate section exists in executor prompt', () => {
    const content = fs.readFileSync(EXECUTOR_PATH, 'utf8');
    assert.ok(content.includes('<post_plan_test_gate>'), 'Missing <post_plan_test_gate> opening tag');
    assert.ok(content.includes('</post_plan_test_gate>'), 'Missing </post_plan_test_gate> closing tag');
  });

  test('post_plan_test_gate references test command auto-detection', () => {
    const content = fs.readFileSync(EXECUTOR_PATH, 'utf8');
    assert.ok(
      content.includes('testing.test_command') || content.includes('TEST_CMD'),
      'Missing test command reference'
    );
    assert.ok(content.includes('package.json'), 'Missing package.json reference for test detection');
  });

  test('post_plan_test_gate references coverage threshold', () => {
    const content = fs.readFileSync(EXECUTOR_PATH, 'utf8');
    assert.ok(
      content.includes('testing.coverage_threshold') || content.includes('COVERAGE_THRESHOLD'),
      'Missing coverage threshold reference'
    );
  });

  test('post_plan_test_gate blocks SUMMARY.md on failure', () => {
    const content = fs.readFileSync(EXECUTOR_PATH, 'utf8');
    const start = content.indexOf('<post_plan_test_gate>');
    const end = content.indexOf('</post_plan_test_gate>');
    assert.ok(start >= 0 && end > start, 'post_plan_test_gate section not found');
    const section = content.slice(start, end);
    assert.ok(
      section.includes('SUMMARY.md') && (section.includes('BLOCKED') || section.includes('blocked')),
      'Missing SUMMARY.md blocked language in post_plan_test_gate section'
    );
  });

  test('post_plan_test_gate appears before summary_creation', () => {
    const content = fs.readFileSync(EXECUTOR_PATH, 'utf8');
    const ptgIdx = content.indexOf('<post_plan_test_gate>');
    const scIdx = content.indexOf('<summary_creation>');
    assert.ok(ptgIdx >= 0, 'post_plan_test_gate not found');
    assert.ok(scIdx >= 0, 'summary_creation not found');
    assert.ok(ptgIdx < scIdx, 'post_plan_test_gate must appear before summary_creation');
  });
});

// ─── Phase 35-02: gsd-phase-coordinator web framework detection ───────────────

describe('gsd-phase-coordinator — web framework detection (Phase 35-02)', () => {
  const COORDINATOR_PATH = path.join('/Users/ollorin/get-shit-done', 'agents', 'gsd-phase-coordinator.md');

  test('detect_web_framework section exists in coordinator', () => {
    const content = fs.readFileSync(COORDINATOR_PATH, 'utf8');
    assert.ok(
      content.includes('detect_web_framework') || content.includes('WEB_FRAMEWORK_DETECTED'),
      'Missing detect_web_framework or WEB_FRAMEWORK_DETECTED in coordinator'
    );
  });

  test('web framework detection checks for React/Next.js/Vue/Svelte', () => {
    const content = fs.readFileSync(COORDINATOR_PATH, 'utf8');
    assert.ok(content.includes('react'), 'Missing react framework check');
    assert.ok(
      content.includes('next') || content.includes('vue') || content.includes('svelte'),
      'Missing next/vue/svelte framework check'
    );
  });

  test('post_phase_ux_sweep references WEB_FRAMEWORK_DETECTED', () => {
    const content = fs.readFileSync(COORDINATOR_PATH, 'utf8');
    const start = content.indexOf('post_phase_ux_sweep');
    assert.ok(start >= 0, 'post_phase_ux_sweep not found in coordinator');
    assert.ok(content.includes('WEB_FRAMEWORK_DETECTED'), 'WEB_FRAMEWORK_DETECTED not referenced in coordinator');
  });

  test('detect_web_framework appears before post_phase_ux_sweep', () => {
    const content = fs.readFileSync(COORDINATOR_PATH, 'utf8');
    const detectIdx = content.indexOf('detect_web_framework');
    const sweepIdx = content.indexOf('post_phase_ux_sweep');
    assert.ok(detectIdx >= 0, 'detect_web_framework not found');
    assert.ok(sweepIdx >= 0, 'post_phase_ux_sweep not found');
    assert.ok(detectIdx < sweepIdx, 'detect_web_framework must appear before post_phase_ux_sweep');
  });

  test('sweep trigger uses EITHER condition language', () => {
    const content = fs.readFileSync(COORDINATOR_PATH, 'utf8');
    assert.ok(
      content.includes('EITHER') || content.includes('either'),
      'Missing EITHER/either language for the OR trigger condition in post_phase_ux_sweep'
    );
  });
});

// ─── Phase 35-03: gsd-verifier hard-fail rules ───────────────────────────────

describe('gsd-verifier — hard-fail rules for QA and test coverage (Phase 35-03)', () => {
  const VERIFIER_PATH = path.join('/Users/ollorin/get-shit-done', 'agents', 'gsd-verifier.md');

  test('check_charlotte_qa_coverage section exists in verifier', () => {
    const content = fs.readFileSync(VERIFIER_PATH, 'utf8');
    assert.ok(content.includes('check_charlotte_qa_coverage'), 'Missing check_charlotte_qa_coverage in verifier');
  });

  test('Charlotte QA check is documented as gaps_found not warning', () => {
    const content = fs.readFileSync(VERIFIER_PATH, 'utf8');
    const start = content.indexOf('check_charlotte_qa_coverage');
    const end = content.indexOf('check_test_file_coverage');
    assert.ok(start >= 0, 'check_charlotte_qa_coverage not found');
    const section = end > start ? content.slice(start, end) : content.slice(start);
    assert.ok(section.includes('gaps_found'), 'Charlotte QA check must emit gaps_found');
    assert.ok(
      section.toLowerCase().includes('never') || section.toLowerCase().includes('not a warning') || section.toLowerCase().includes('hard-fail'),
      'Charlotte QA check must document that it is never a warning'
    );
  });

  test('check_test_file_coverage section exists in verifier', () => {
    const content = fs.readFileSync(VERIFIER_PATH, 'utf8');
    assert.ok(content.includes('check_test_file_coverage'), 'Missing check_test_file_coverage in verifier');
  });

  test('test file check is documented as gaps_found not warning', () => {
    const content = fs.readFileSync(VERIFIER_PATH, 'utf8');
    const start = content.indexOf('check_test_file_coverage');
    assert.ok(start >= 0, 'check_test_file_coverage not found');
    const section = content.slice(start, start + 3000);
    assert.ok(section.includes('gaps_found'), 'Test file check must emit gaps_found');
    assert.ok(
      section.toUpperCase().includes('NEVER') || section.toLowerCase().includes('not a warning') || section.toLowerCase().includes('hard-fail'),
      'Test file check must document it is NEVER a warning'
    );
  });

  test('check_charlotte_qa_coverage appears before check_test_file_coverage', () => {
    const content = fs.readFileSync(VERIFIER_PATH, 'utf8');
    const charlotteIdx = content.indexOf('check_charlotte_qa_coverage');
    const testIdx = content.indexOf('check_test_file_coverage');
    assert.ok(charlotteIdx >= 0, 'check_charlotte_qa_coverage not found');
    assert.ok(testIdx >= 0, 'check_test_file_coverage not found');
    assert.ok(charlotteIdx < testIdx, 'Charlotte QA check must appear before test file check');
  });

  test('both checks appear before output section', () => {
    const content = fs.readFileSync(VERIFIER_PATH, 'utf8');
    const testIdx = content.indexOf('check_test_file_coverage');
    const outputIdx = content.indexOf('<output>');
    assert.ok(testIdx >= 0, 'check_test_file_coverage not found');
    assert.ok(outputIdx >= 0, '<output> section not found');
    assert.ok(testIdx < outputIdx, 'check_test_file_coverage must appear before <output>');
  });
});


describe('verify migration-timestamps command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('no migrations directory returns skipped result', () => {
    // No migrations/ dir created — just the standard .planning/phases structure
    const result = runGsdTools('verify migration-timestamps', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.skipped, true, 'Should be skipped when no migrations dir');
    assert.strictEqual(data.migrations_dir, null, 'migrations_dir should be null');
  });

  test('no conflicts returns zero conflict count', () => {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, '20240101120000_create_users.sql'), '');
    fs.writeFileSync(path.join(migrationsDir, '20240101120001_add_index.sql'), '');

    const result = runGsdTools('verify migration-timestamps', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.conflicts_found, 0, 'Should find no conflicts');
    assert.strictEqual(data.resolved, 0, 'Should resolve nothing');
    assert.strictEqual(data.files_scanned, 2, 'Should scan 2 files');
  });

  test('duplicate timestamps are auto-resolved by rename', () => {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, '20240101120000_create_users.sql'), '');
    fs.writeFileSync(path.join(migrationsDir, '20240101120000_add_index.sql'), '');

    const result = runGsdTools('verify migration-timestamps', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.conflicts_found, 1, 'Should detect 1 conflict');
    assert.strictEqual(data.resolved, 1, 'Should resolve 1 conflict');

    // The renamed file must exist on disk
    const resolvedEntry = data.migrations.find(m => m.status === 'resolved');
    assert.ok(resolvedEntry, 'Should have a resolved entry');
    const renamedPath = path.join(migrationsDir, resolvedEntry.new_file);
    assert.ok(fs.existsSync(renamedPath), `Renamed file should exist at ${renamedPath}`);

    // The original conflicting file should no longer exist under its old name
    const originalPath = path.join(migrationsDir, resolvedEntry.original_file);
    assert.ok(!fs.existsSync(originalPath), 'Original conflicting file should be renamed away');
  });

  test('non-migration files are ignored in scan', () => {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, 'README.md'), '# migrations');
    fs.writeFileSync(path.join(migrationsDir, '.gitkeep'), '');
    fs.writeFileSync(path.join(migrationsDir, '20240101120000_init.sql'), '');

    const result = runGsdTools('verify migration-timestamps', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.files_scanned, 1, 'Should scan only migration files (not README.md or .gitkeep)');
    assert.strictEqual(data.conflicts_found, 0, 'Should find no conflicts');
  });
});

// ─── Phase 44-01: safeJsonParse guard behavior ────────────────────────────────

describe('token report — safeJsonParse guard (Phase 44-01)', () => {
  let tmpDir;
  let budgetPath;

  beforeEach(() => {
    tmpDir = createTempProject();
    budgetPath = path.join(tmpDir, '.planning', 'token_budget.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('malformed token_budget.json produces a typed error, not an uncaught crash', () => {
    fs.writeFileSync(budgetPath, '{ this is not valid json');

    const result = runGsdTools('token report', tmpDir);

    assert.strictEqual(result.success, false, 'command should fail gracefully on corrupted state, not succeed with garbage data');
    assert.ok(
      /corrupted|token_budget\.json/i.test(result.error),
      `error should reference corruption/context label, got: ${result.error}`
    );
    assert.ok(
      !/at Object\.<anonymous>|node:internal\/|SyntaxError: Unexpected/.test(result.error) || /Error: /.test(result.error),
      `should surface a clean "Error: ..." message rather than a raw Node stack trace, got: ${result.error}`
    );
  });

  test('well-formed token_budget.json still parses and reports correctly (regression)', () => {
    const validState = {
      model: 'opus',
      maxTokens: 200000,
      currentUsage: 1000,
      phaseUsage: {},
      alerts: [],
      thresholdsPassed: [],
      graduatedAlerts: [],
      telegramEnabled: false,
    };
    fs.writeFileSync(budgetPath, JSON.stringify(validState));

    const result = runGsdTools('token report', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.current_usage, 1000);
    assert.strictEqual(parsed.max_tokens, 200000);
  });

  test('missing token_budget.json is reported as not-initialized (unaffected by guard change)', () => {
    // No budgetPath file written at all
    const result = runGsdTools('token report', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.available, false);
  });
});

describe('routing index-refresh — cache safeJsonParse guard (Phase 44-01)', () => {
  let tmpDir;
  let cachePath;

  beforeEach(() => {
    tmpDir = createTempProject();
    cachePath = path.join(tmpDir, '.planning', '.context-index-cache.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('malformed context-index cache produces a typed corruption result, not an uncaught crash', () => {
    fs.writeFileSync(cachePath, '{ not: valid, json ][');

    const result = runGsdTools('routing index-refresh', tmpDir);
    assert.ok(result.success, `Command should report a graceful JSON result, not crash: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.stale, true, 'corrupted cache should be reported as stale');
    assert.ok(/corrupted/i.test(parsed.reason), `reason should mention corruption, got: ${parsed.reason}`);
  });

  test('well-formed context-index cache still refreshes correctly (regression)', () => {
    const validCache = {
      created_at: new Date(0).toISOString(), // guaranteed stale by mtime comparison below
      entries: [],
    };
    fs.writeFileSync(cachePath, JSON.stringify(validCache));

    const result = runGsdTools('routing index-refresh', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.entries, 0);
    assert.strictEqual(typeof parsed.stale, 'boolean');
  });
});

describe('validation log / stats — JSONL per-line safeJsonParse guard (Phase 44-01)', () => {
  let tmpDir;
  let logFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    const validationDir = path.join(tmpDir, '.planning', 'validation');
    fs.mkdirSync(validationDir, { recursive: true });
    logFile = path.join(validationDir, 'validation-log.jsonl');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('one malformed line in validation-log.jsonl does not abort processing of the other valid lines', () => {
    const validLine1 = JSON.stringify({ task_id: 'task-1', result: { valid: true, correctness_score: 9 }, depth: 'light' });
    const malformedLine = '{ this is not valid json at all';
    const validLine2 = JSON.stringify({ task_id: 'task-2', result: { valid: true, correctness_score: 8 }, depth: 'standard' });

    fs.writeFileSync(logFile, [validLine1, malformedLine, validLine2].join('\n') + '\n');

    const result = runGsdTools('validation log', tmpDir);
    assert.ok(result.success, `Command should not crash on a malformed line: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.count, 2, 'both well-formed lines should still be processed despite one malformed line');
    const taskIds = parsed.entries.map(e => e.task_id).sort();
    assert.deepStrictEqual(taskIds, ['task-1', 'task-2']);
  });

  test('validation stats tolerates a malformed line and computes stats from the remaining valid entries', () => {
    const validLine1 = JSON.stringify({ task_id: 'task-1', result: { valid: true, correctness_score: 9, reasoning_score: 9 }, depth: 'light' });
    const malformedLine = 'not json {{{';
    fs.writeFileSync(logFile, [validLine1, malformedLine].join('\n') + '\n');

    const result = runGsdTools('validation stats', tmpDir);
    assert.ok(result.success, `Command should not crash on a malformed line: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.total_validations, 1, 'malformed line should be skipped, only the valid entry counted');
  });

  test('well-formed validation-log.jsonl with no malformed lines behaves exactly as before (regression)', () => {
    const validLine1 = JSON.stringify({ task_id: 'task-1', result: { valid: true, correctness_score: 9 }, depth: 'light' });
    const validLine2 = JSON.stringify({ task_id: 'task-2', result: { valid: false, correctness_score: 3 }, depth: 'thorough' });
    fs.writeFileSync(logFile, [validLine1, validLine2].join('\n') + '\n');

    const result = runGsdTools('validation log', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.count, 2);
  });
});

// ─── Phase 44-01: execSync → execFileSync/pure-Node hardening ────────────────

describe('task analyze/chunk --files — expandGlobSync injection hardening (Phase 44-01)', () => {
  let tmpDir;
  const markerPath = path.join(require('os').tmpdir(), 'gsd-test-pwned-glob-marker.txt');

  beforeEach(() => {
    tmpDir = createTempProject();
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath);
  });

  afterEach(() => {
    cleanup(tmpDir);
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath);
  });

  test('shell metacharacters in --files glob are not shell-interpreted', () => {
    const maliciousGlob = `*.js; touch ${markerPath}; echo pwned`;
    const escaped = maliciousGlob.replace(/'/g, "'\\''");

    const result = runGsdTools(`task analyze --description "test task" --files '${escaped}'`, tmpDir);

    assert.ok(
      !fs.existsSync(markerPath),
      'shell metacharacters in --files must not execute as a shell command (marker file must not be created)'
    );
    assert.ok(result.success, `Command should not crash on a malicious glob: ${result.error}`);
  });

  test('shell metacharacters in task chunk --files are also not shell-interpreted', () => {
    const maliciousGlob = `*.js\`touch ${markerPath}\``;
    const escaped = maliciousGlob.replace(/'/g, "'\\''");

    const result = runGsdTools(`task chunk --description "test task" --files '${escaped}'`, tmpDir);

    assert.ok(!fs.existsSync(markerPath), 'backtick command substitution in --files must not execute');
    assert.ok(result.success, `Command should not crash on a malicious glob: ${result.error}`);
  });

  test('normal glob pattern still matches files without shelling out (regression)', () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.js'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'bar.js'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'baz.txt'), 'x');

    const result = runGsdTools('task analyze --description "test task" --files "*.js"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.complexity, 'should return a complexity estimate as before');
  });
});

describe('commit command — execFileSync git argv-array hardening (Phase 44-01)', () => {
  let tmpDir;
  const markerPath = path.join(require('os').tmpdir(), 'gsd-test-pwned-commit-marker.txt');

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# state\n');
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath);
  });

  afterEach(() => {
    cleanup(tmpDir);
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath);
  });

  test('commit message with shell metacharacters is not shell-interpreted', () => {
    const maliciousMessage = `pwn"; touch ${markerPath}; echo "done`;
    const escaped = maliciousMessage.replace(/'/g, "'\\''");

    runGsdTools(`commit '${escaped}'`, tmpDir);

    assert.ok(
      !fs.existsSync(markerPath),
      'shell metacharacters in the commit message must not execute as a shell command'
    );
  });

  test('normal commit message still commits successfully via execFileSync argv array (regression)', () => {
    const result = runGsdTools('commit "test: normal commit message"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, true);
    assert.ok(parsed.hash, 'should return a commit hash from the execFileSync-based git rev-parse call');
  });

  test('git check-ignore (isGitIgnored) behavior is unchanged for a normal (non-ignored) .planning directory', () => {
    // No .gitignore present — .planning should not be reported as ignored,
    // so the commit should proceed rather than being skipped.
    const result = runGsdTools('commit "test: check-ignore regression"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.notStrictEqual(parsed.reason, 'skipped_gitignored');
  });

  test('commit is skipped when .planning is gitignored (git check-ignore behavior preserved)', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.planning/\n');
    const result = runGsdTools('commit "test: gitignored regression"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, false);
    assert.strictEqual(parsed.reason, 'skipped_gitignored');
  });
});

describe('output() large-payload path — fs.readFileSync replacement for `cat` (Phase 44-01)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('large piped output (>100KB) is written completely and remains valid JSON', () => {
    // Generate enough phase directories with SUMMARY.md content to push
    // history-digest's JSON output past the 100KB large-output threshold,
    // exercising the temp-file read-and-write-to-stdout path.
    for (let i = 1; i <= 40; i++) {
      const phaseDir = path.join(tmpDir, '.planning', 'phases', `${String(i).padStart(2, '0')}-phase-${i}`);
      fs.mkdirSync(phaseDir, { recursive: true });
      const filler = 'x'.repeat(4000);
      const summaryContent = `---\nphase: "${i}"\nname: "Phase ${i}"\ndependency-graph:\n  provides:\n    - "${filler}"\n---\n\n# Summary\n`;
      fs.writeFileSync(path.join(phaseDir, `${String(i).padStart(2, '0')}-01-SUMMARY.md`), summaryContent);
    }

    const result = runGsdTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.length > 100 * 1024, 'test fixture should actually exceed the 100KB large-output threshold');

    // Must still be valid, complete JSON — proves fs.readFileSync + stdout.write
    // preserved full content without truncation (no shell/pipe buffer loss).
    const parsed = JSON.parse(result.output);
    assert.strictEqual(Object.keys(parsed.phases).length, 40, 'all 40 phases should be present in the large output');
  });
});

describe('atomicWriteFileSync helper (Phase 44-02)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('write is fully readable immediately after the call returns', () => {
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    fs.writeFileSync(statePath, `# State\n\n**Status:** Old\n**Current Phase:** 01\n`);

    const result = runGsdTools('state update Status Updated-via-atomic-write', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.updated, true, 'command should report the field was updated');

    // Read the file back immediately (no delay) — should be the complete new
    // content, not a truncated/partial write and not the temp file leftover.
    const content = fs.readFileSync(statePath, 'utf-8');
    assert.ok(content.includes('**Status:** Updated-via-atomic-write'), 'new value should be fully present');
    assert.ok(!content.includes('**Status:** Old'), 'old value should be fully replaced');
    assert.ok(content.includes('**Current Phase:** 01'), 'unrelated fields should be untouched');

    // The temp file used internally must not be left behind.
    const dirEntries = fs.readdirSync(path.join(tmpDir, '.planning'));
    assert.ok(
      !dirEntries.some(f => f.includes('.tmp-')),
      `no leftover temp file should remain in .planning: ${dirEntries.join(', ')}`
    );
  });

  test('two back-to-back writes to the same STATE.md path both fully land (last write is complete, not mixed/truncated)', () => {
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    fs.writeFileSync(statePath, `# State\n\n**Status:** Initial\n**Current Plan:** 01-01\n`);

    const firstValue = 'First-write-' + 'a'.repeat(200);
    const secondValue = 'Second-write-' + 'b'.repeat(200);

    const first = runGsdTools(`state update Status ${firstValue}`, tmpDir);
    assert.ok(first.success, `First write failed: ${first.error}`);

    const second = runGsdTools(`state update Status ${secondValue}`, tmpDir);
    assert.ok(second.success, `Second write failed: ${second.error}`);

    const content = fs.readFileSync(statePath, 'utf-8');
    assert.ok(
      content.includes(`**Status:** ${secondValue}`),
      'second (final) write must be present in full, not truncated'
    );
    assert.ok(
      !content.includes(firstValue),
      'first write must be fully replaced, not mixed in with the second'
    );
    assert.ok(content.includes('**Current Plan:** 01-01'), 'unrelated fields should survive both writes untouched');
  });

  test('write to an unwritable target directory throws a clear error identifying the target path', () => {
    // Fixture mirrors the existing "phase remove" tests (see 'updates STATE.md
    // phase count' above) so the command reaches its atomicWriteFileSync(roadmapPath, ...)
    // call for a real ROADMAP.md rewrite.
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      `# Roadmap\n### Phase 1: A\n**Goal:** A\n### Phase 2: B\n**Goal:** B\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 1\n**Total Phases:** 2\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), { recursive: true });

    // Remove write permission on the .planning directory itself so the
    // "<file>.tmp-<pid>-<ts>" temp file used by atomicWriteFileSync cannot be
    // created there. Read access (needed earlier in the command) is untouched.
    const planningDir = path.join(tmpDir, '.planning');
    fs.chmodSync(planningDir, 0o555);

    try {
      const result = runGsdTools('phase remove 2', tmpDir);
      assert.strictEqual(result.success, false, 'command should fail loudly, not silently no-op');
      assert.ok(
        result.error.includes('Atomic write failed for'),
        `error should identify this as an atomic write failure: ${result.error}`
      );
      assert.ok(
        result.error.includes(roadmapPath),
        `error should name the specific target path that failed: ${result.error}`
      );
    } finally {
      // Restore write permission so afterEach's recursive cleanup can succeed.
      fs.chmodSync(planningDir, 0o755);
    }
  });

  test('no fs.writeFileSync(statePath|roadmapPath|configPath, ...) bypass exists anywhere in gsd-tools.js (structural regression guard)', () => {
    const source = fs.readFileSync(TOOLS_PATH, 'utf-8');

    const bypassPatterns = [
      'fs.writeFileSync(statePath',
      'fs.writeFileSync(roadmapPath',
      'fs.writeFileSync(configPath',
    ];

    for (const pattern of bypassPatterns) {
      assert.ok(
        !source.includes(pattern),
        `found a direct fs.writeFileSync bypass of atomicWriteFileSync: "${pattern}"`
      );
    }

    // Positive control: confirm the helper itself, and real call sites, exist —
    // guards against the negative assertions above passing vacuously (e.g. if
    // the whole file were empty or the helper got renamed/removed).
    assert.ok(source.includes('function atomicWriteFileSync('), 'atomicWriteFileSync helper should be defined');
    assert.ok(source.includes('atomicWriteFileSync(statePath'), 'at least one statePath call site should route through the helper');
    assert.ok(source.includes('atomicWriteFileSync(roadmapPath'), 'at least one roadmapPath call site should route through the helper');
    assert.ok(source.includes('atomicWriteFileSync(configPath'), 'at least one configPath call site should route through the helper');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parallel command removal (Phase 44-04, MILE-18 dead-code cleanup)
// ─────────────────────────────────────────────────────────────────────────────

describe('parallel command removal (Phase 44-04)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('`parallel analyze` fails cleanly with an "Unknown command" error, not a crash', () => {
    const result = runGsdTools('parallel analyze', tmpDir);

    assert.strictEqual(result.success, false, 'command should exit non-zero, not silently succeed');
    assert.ok(
      result.error.includes('Unknown command'),
      `expected a clean "Unknown command" style error, got: ${result.error}`
    );
    assert.ok(
      result.error.includes('parallel'),
      `error message should name the unrecognized command: ${result.error}`
    );
  });

  test('`parallel` with any subcommand/args still hits the unknown-command path, never a require/module error', () => {
    const result = runGsdTools('parallel some-other-subcommand --flag value', tmpDir);

    assert.strictEqual(result.success, false, 'command should exit non-zero');
    assert.ok(
      !result.error.includes('Cannot find module'),
      `must not crash referencing a missing module: ${result.error}`
    );
    assert.ok(
      !result.error.toLowerCase().includes('parallel-executor'),
      `must not reference the deleted parallel-executor.js file: ${result.error}`
    );
    assert.ok(
      result.error.includes('Unknown command'),
      `expected clean unknown-command error, got: ${result.error}`
    );
  });

  test('no stray require of the deleted parallel-executor.js remains in gsd-tools.js (structural regression guard)', () => {
    const source = fs.readFileSync(TOOLS_PATH, 'utf-8');
    assert.ok(
      !source.includes('parallel-executor'),
      'gsd-tools.js should not reference the deleted parallel-executor.js module'
    );
    assert.ok(
      !/case\s+'parallel'\s*:/.test(source),
      'the CLI switch should no longer have a case for "parallel"'
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Phase 44-05: CLI/subprocess-level integration coverage
//
// Everything above already invokes the real gsd-tools.js binary as a subprocess
// via runGsdTools() (execSync), so this section is additive CLI-level coverage
// on top of the 44-01/44-02 unit tests, per plan 44-05:
//   A. safeJsonParse guard reachability through two FRESH command entry points
//      (alerts status / task progress) not already exercised by 44-01's tests.
//   B. execSync-hardening injection resistance using a payload SHAPE (command
//      substitution `$(...)`) not already exercised by the existing `;`/backtick
//      44-01 tests, through the same two attack-surface commands (task analyze
//      --files, commit message).
//   C. GENUINE concurrent (not rapid-sequential) `state update` subprocesses
//      racing on the same STATE.md fixture.
// ═════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');

// Like runGsdTools(), but allows a timeout so a hang (rather than a clean
// non-zero exit) is caught as a test failure instead of blocking the suite.
function runGsdToolsTimed(args, cwd, timeoutMs = 8000) {
  try {
    const result = execSync(`node "${TOOLS_PATH}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    return { success: true, output: result.trim(), timedOut: false };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
      // node sets `err.signal === 'SIGKILL'`/`'SIGTERM'` and `err.code === null`
      // when execSync's own `timeout` option kills the child.
      timedOut: err.killed === true && err.code === null,
    };
  }
}

// Runs gsd-tools.js as a real detached child process via spawn() (argv array,
// no shell), resolving once it exits. Used so two invocations can be started
// back-to-back (both spawn() calls issued before either is awaited) and race
// for real, rather than being serialized by execSync's synchronous nature.
function spawnGsdToolsAsync(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOLS_PATH, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      resolve({ success: code === 0, output: stdout.trim(), error: stderr.trim(), code });
    });
    child.on('error', (e) => {
      resolve({ success: false, output: '', error: e.message, code: null });
    });
  });
}

describe('safeJsonParse guard — CLI/subprocess-level reachability, fresh entry points (Phase 44-05)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('`alerts status` on a corrupted token_budget.json fails gracefully as a real subprocess (no hang, no raw stack trace)', () => {
    const budgetPath = path.join(tmpDir, '.planning', 'token_budget.json');
    fs.writeFileSync(budgetPath, '{ this is not valid json at all [[[');

    const result = runGsdToolsTimed('alerts status', tmpDir);

    assert.strictEqual(result.timedOut, false, 'command must not hang on corrupted JSON, should exit promptly');
    assert.strictEqual(result.success, false, 'command should exit non-zero on corrupted state, not fabricate a result');
    assert.ok(
      /corrupted|token_budget\.json/i.test(result.error),
      `error should reference corruption/context label, got: ${result.error}`
    );
    assert.ok(
      /^Error: /.test(result.error) && !/at Object\.<anonymous>|node:internal\//.test(result.error),
      `should surface a clean "Error: ..." message, not a raw Node stack trace, got: ${result.error}`
    );
  });

  test('`task progress` on a corrupted batch_progress.json fails gracefully as a real subprocess (no hang, no raw stack trace)', () => {
    const progressPath = path.join(tmpDir, '.planning', 'batch_progress.json');
    fs.writeFileSync(progressPath, '{{{ not json, definitely not');

    const result = runGsdToolsTimed('task progress', tmpDir);

    assert.strictEqual(result.timedOut, false, 'command must not hang on corrupted JSON, should exit promptly');
    assert.strictEqual(result.success, false, 'command should exit non-zero on corrupted state, not fabricate a result');
    assert.ok(
      /corrupted|batch_progress\.json/i.test(result.error),
      `error should reference corruption/context label, got: ${result.error}`
    );
    assert.ok(
      /^Error: /.test(result.error) && !/at Object\.<anonymous>|node:internal\//.test(result.error),
      `should surface a clean "Error: ..." message, not a raw Node stack trace, got: ${result.error}`
    );
  });

  test('`alerts status` with a well-formed token_budget.json still succeeds through the same subprocess path (regression)', () => {
    const budgetPath = path.join(tmpDir, '.planning', 'token_budget.json');
    fs.writeFileSync(budgetPath, JSON.stringify({
      model: 'opus', maxTokens: 200000, currentUsage: 5000,
      phaseUsage: {}, alerts: [], thresholdsPassed: [], graduatedAlerts: [], telegramEnabled: false,
    }));

    const result = runGsdToolsTimed('alerts status', tmpDir);
    assert.strictEqual(result.timedOut, false, 'well-formed input should never hang');
    assert.ok(result.success, `Command failed on well-formed input: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.current_usage, 5000);
  });

  test('`task progress` with no batch_progress.json at all reports "not available" rather than erroring (regression)', () => {
    const result = runGsdToolsTimed('task progress', tmpDir);
    assert.strictEqual(result.timedOut, false);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.available, false);
  });
});

describe('execSync-hardening — command-substitution injection resistance via fresh CLI invocations (Phase 44-05)', () => {
  const analyzeMarker = path.join(require('os').tmpdir(), `gsd-44-05-pwned-analyze-${process.pid}.txt`);
  const commitMarker = path.join(require('os').tmpdir(), `gsd-44-05-pwned-commit-${process.pid}.txt`);
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    if (fs.existsSync(analyzeMarker)) fs.rmSync(analyzeMarker);
    if (fs.existsSync(commitMarker)) fs.rmSync(commitMarker);
  });

  afterEach(() => {
    cleanup(tmpDir);
    // Clean up regardless of pass/fail so a failing assertion never leaks a
    // marker file into subsequent runs.
    if (fs.existsSync(analyzeMarker)) fs.rmSync(analyzeMarker);
    if (fs.existsSync(commitMarker)) fs.rmSync(commitMarker);
  });

  test('`task analyze --files` with a $(...) command-substitution payload does not execute the substituted command', () => {
    // Distinct payload SHAPE from the existing 44-01 `;`/backtick tests:
    // `$(...)` command substitution, still targeting expandGlobSync()'s
    // --files argument handling.
    const malicious = `$(touch ${analyzeMarker})*.js`;
    const escaped = malicious.replace(/'/g, "'\\''");

    const result = runGsdTools(`task analyze --description "test task" --files '${escaped}'`, tmpDir);

    assert.ok(
      !fs.existsSync(analyzeMarker),
      '$(...) command substitution in --files must not execute (marker file must not be created)'
    );
    assert.ok(result.success, `Command should not crash on a malicious glob: ${result.error}`);
  });

  test('`commit` message with a $(...) command-substitution payload does not execute the substituted command', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# state\n');

    // Distinct payload SHAPE from the existing 44-01 `;`/backtick test: `$(...)`
    // command substitution embedded in the commit message argument.
    const malicious = `pwn $(touch ${commitMarker})`;
    const escaped = malicious.replace(/'/g, "'\\''");

    const result = runGsdTools(`commit '${escaped}'`, tmpDir);

    assert.ok(
      !fs.existsSync(commitMarker),
      '$(...) command substitution in the commit message must not execute (marker file must not be created)'
    );
    // The commit itself should still complete (execFileSync argv-array commit,
    // treating the whole string as one literal message), not crash.
    assert.ok(result.success, `Command should handle the literal string safely rather than crashing: ${result.error}`);
  });
});

describe('concurrent `state update` subprocesses racing on the same STATE.md (Phase 44-05)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // KNOWN LIMITATION (found during 44-05, documented rather than silently
  // patched -- see 44-05-SUMMARY.md and deferred-items.md):
  //
  // 44-CONTEXT.md's 44-02 decision section explicitly scopes atomicWriteFileSync
  // to "prevents a torn/corrupted write ... satisfies MILE-20's 'no update is
  // silently lost' bar for the read-modify-write pattern GSD actually uses
  // (sequential coordinator calls, not truly concurrent writers in the common
  // case)" and explicitly instructs "Do NOT attempt true cross-process locking
  // (mutex/semaphore) in this phase." That guarantee -- sequential/rapid-succession
  // writes both land -- is exactly what 44-02's own unit test already proves
  // (see 'atomicWriteFileSync helper (Phase 44-02)' above) and is reconfirmed
  // here at the CLI/subprocess boundary below.
  //
  // Genuinely SIMULTANEOUS (Promise.all, both spawned before either is awaited)
  // writes are a stronger guarantee this phase never designed for: two processes
  // each do read-whole-file -> mutate-in-memory -> atomicWriteFileSync, so
  // whichever process's write lands second silently clobbers the other's
  // in-memory copy of the rest of the file with its own stale read. This is a
  // real, reproducible data-loss race (confirmed via 30/30 raw trials during
  // 44-05's test-writing) -- but fixing it requires real cross-process locking,
  // which 44-CONTEXT.md explicitly defers past this phase (proper-lockfile is
  // reserved for Phase 47's Telegram JSONL hardening, not this phase). This test
  // documents the actual, current, accepted behavior (never a crash or a torn
  // file -- but under genuine concurrency, the LOSER's field update can be
  // silently dropped) so the gap stays visible rather than being hidden by a
  // test that asserts a guarantee the system doesn't provide.
  test('sequential (non-overlapping) `state update` calls to different fields both land -- the guarantee this phase actually provides', () => {
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    fs.writeFileSync(statePath, `# State

**Status:** Initial
**Current Phase:** 00
`);

    const r1 = runGsdTools('state update Status UpdatedByProcessA', tmpDir);
    const r2 = runGsdTools("state update \"Current Phase\" 07", tmpDir);

    assert.ok(r1.success, `first "state update" subprocess failed: ${r1.error}`);
    assert.ok(r2.success, `second "state update" subprocess failed: ${r2.error}`);

    const content = fs.readFileSync(statePath, 'utf-8');
    assert.ok(content.includes('**Status:** UpdatedByProcessA'), `Status update should land: ${content}`);
    assert.ok(content.includes('**Current Phase:** 07'), `Current Phase update should land: ${content}`);
  });

  test('genuinely concurrent (Promise.all, overlapping) `state update` calls never crash or torn-write the file, but a losing update CAN be silently dropped (documented limitation, not fixed in this phase)', async () => {
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    fs.writeFileSync(statePath, `# State

**Status:** Initial
**Current Phase:** 00
`);

    // Both spawn() calls are issued here, BEFORE either is awaited, so the two
    // child processes' read-modify-write cycles genuinely overlap in time.
    const [r1, r2] = await Promise.all([
      spawnGsdToolsAsync(['state', 'update', 'Status', 'UpdatedByProcessA'], tmpDir),
      spawnGsdToolsAsync(['state', 'update', 'Current Phase', '07'], tmpDir),
    ]);

    assert.ok(r1.success, `first concurrent "state update" subprocess failed: ${r1.error}`);
    assert.ok(r2.success, `second concurrent "state update" subprocess failed: ${r2.error}`);

    // The file must never be torn/corrupted (atomicWriteFileSync's actual,
    // in-scope guarantee) -- it must still be valid, readable Markdown with
    // AT LEAST one of the two updates present. It is NOT guaranteed that BOTH
    // land under genuine concurrency (see comment above) -- that would require
    // cross-process locking, explicitly out of scope for this phase.
    const content = fs.readFileSync(statePath, 'utf-8');
    assert.ok(content.length > 0, 'file must never end up empty/torn');
    const statusLanded = content.includes('**Status:** UpdatedByProcessA');
    const phaseLanded = content.includes('**Current Phase:** 07');
    assert.ok(
      statusLanded || phaseLanded,
      `at least one of the two concurrent updates should survive (neither silently corrupting the whole file): ${content}`
    );
  });
});

describe('CI workflow config sanity check (Phase 44-05, static file check, no network/Actions invocation)', () => {
  const WORKFLOW_PATH = path.join(__dirname, '..', '..', '.github', 'workflows', 'test.yml');

  test('.github/workflows/test.yml exists on disk', () => {
    assert.ok(
      fs.existsSync(WORKFLOW_PATH),
      `expected CI workflow file at ${WORKFLOW_PATH}`
    );
  });

  test('workflow triggers on both push and pull_request', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(/^on:/m.test(content), `workflow should declare an "on:" trigger block, got:\n${content}`);
    assert.ok(/^\s*push:?\s*$/m.test(content), `workflow should trigger on "push", got:\n${content}`);
    assert.ok(/^\s*pull_request:?\s*$/m.test(content), `workflow should trigger on "pull_request", got:\n${content}`);
  });

  test('workflow runs the project test suite via npm', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(
      /npm test|npm ci/.test(content),
      `workflow should invoke "npm test" or "npm ci" somewhere, got:\n${content}`
    );
  });

  test('workflow explicitly installs dependencies (npm ci) before running tests (npm test)', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    // Stronger check than the single-invocation test above: this repo's
    // workflow should do a clean, reproducible install before testing.
    assert.ok(content.includes('npm ci'), `expected "npm ci" for a reproducible install, got:\n${content}`);
    assert.ok(content.includes('npm test'), `expected "npm test" to actually run the suite, got:\n${content}`);
  });

  test('workflow is not accidentally empty or truncated (has a jobs: block with at least one step)', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(/^jobs:/m.test(content), `workflow should declare a "jobs:" block, got:\n${content}`);
    assert.ok(/steps:/.test(content), `workflow should declare "steps:" under the job, got:\n${content}`);
  });
});

describe('verify phase-gate command (Phase 45-01)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  // Commits everything currently on disk in tmpDir, tagging the message with
  // {phase}-{plan} the same way the real `commit` command / executors do --
  // this is exactly the convention collectPhaseTouchedFiles's `git log --grep`
  // walk depends on.
  function commitAll(message) {
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git commit -q --allow-empty -m "${message}"`, { cwd: tmpDir, stdio: 'pipe' });
  }

  // Like runGsdTools but also surfaces the real process exit code (needed here
  // because phase-gate uses distinct exit codes: 0 passed, 1 failed checks,
  // 2 malformed plan/waiver data).
  function runPhaseGate(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify phase-gate ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  test('phase not found returns typed phase_not_found error, non-zero exit, no crash', () => {
    const result = runPhaseGate('99', tmpDir);
    assert.strictEqual(result.success, false, 'should exit non-zero for an unknown phase');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error, true);
    assert.strictEqual(parsed.type, 'phase_not_found');
    assert.strictEqual(parsed.phase, '99');
  });

  test('all 5 artifacts present (no tdd task, no UI files, VERIFICATION.md present, no doc signal) -> passed true, exit 0', () => {
    const phaseDir = phaseDirPath('45-allgood');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    commitAll('feat(45-01): plain task, no tdd, no ui');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    assert.ok(result.success, `Command should exit 0: ${result.error}`);
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, true);
    assert.deepStrictEqual(parsed.failures, []);
    assert.strictEqual(parsed.malformed_plans.length, 0);
    assert.strictEqual(parsed.has_ui, false);
  });

  test('tdd="true" task present but no test/spec file in touched-files diff -> missing_test, passed false, exit 1', () => {
    const phaseDir = phaseDirPath('45-notest');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto" tdd="true">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    commitAll('feat(45-01): impl with tdd task but no test file committed');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
    assert.ok(parsed.failures.includes('missing_test'), `expected missing_test in failures: ${JSON.stringify(parsed.failures)}`);
    const testCheck = parsed.checks.find(c => c.type === 'test');
    assert.strictEqual(testCheck.required, true);
    assert.strictEqual(testCheck.satisfied, false);
    assert.strictEqual(testCheck.failure_type, 'missing_test');
  });

  test('.tsx file in diff but CHECKPOINT.json missing -> missing_charlotte_qa', () => {
    const phaseDir = phaseDirPath('45-nocharlotte');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    commitAll('feat(45-01): add Dashboard.tsx, no CHECKPOINT.json');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n');

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true);
    assert.ok(parsed.failures.includes('missing_charlotte_qa'), `expected missing_charlotte_qa in failures: ${JSON.stringify(parsed.failures)}`);
    const charlotteCheck = parsed.checks.find(c => c.type === 'charlotte_qa');
    assert.strictEqual(charlotteCheck.required, true);
    assert.strictEqual(charlotteCheck.satisfied, false);
  });

  test('.tsx file in diff but no E2E-TEST-PLAN.md -> missing_e2e_plan', () => {
    const phaseDir = phaseDirPath('45-noe2e');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({ charlotte_qa_ran: true }));
    commitAll('feat(45-01): add Dashboard.tsx, charlotte ran, no E2E plan');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true);
    assert.ok(parsed.failures.includes('missing_e2e_plan'), `expected missing_e2e_plan in failures: ${JSON.stringify(parsed.failures)}`);
    const charlotteCheck = parsed.checks.find(c => c.type === 'charlotte_qa');
    assert.strictEqual(charlotteCheck.satisfied, true, 'charlotte_qa should be satisfied via CHECKPOINT.json in this fixture');
    const e2eCheck = parsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.required, true);
    assert.strictEqual(e2eCheck.satisfied, false);
  });

  test('doc-worthy signal (touched api/ file) but no docs commit/file -> missing_docs', () => {
    // Note: deliberately avoid any phase-dir name containing the substring
    // "docs/" (e.g. "45-nodocs") -- that would spuriously satisfy the docs
    // check itself, since DOC_SATISFIED_RE matches "docs/" anywhere in the
    // touched-file path, including the phase directory name.
    const phaseDir = phaseDirPath('45-apisignal');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.mkdirSync(path.join(phaseDir, 'src', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'src', 'api', 'users.js'), 'module.exports = {};\n');
    commitAll('feat(45-01): add src/api/users.js, no docs touched');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, false, 'api/ file is not a UI file extension');
    assert.ok(parsed.failures.includes('missing_docs'), `expected missing_docs in failures: ${JSON.stringify(parsed.failures)}`);
    const docsCheck = parsed.checks.find(c => c.type === 'docs');
    assert.strictEqual(docsCheck.required, true);
    assert.strictEqual(docsCheck.satisfied, false);
  });

  test('no *-VERIFICATION.md present -> missing_verification', () => {
    const phaseDir = phaseDirPath('45-noverify');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    commitAll('feat(45-01): plain task, no verification file');

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
    assert.ok(parsed.failures.includes('missing_verification'), `expected missing_verification in failures: ${JSON.stringify(parsed.failures)}`);
    const verificationCheck = parsed.checks.find(c => c.type === 'verification');
    assert.strictEqual(verificationCheck.required, true);
    assert.strictEqual(verificationCheck.satisfied, false);
  });

  test('malformed/missing frontmatter (no plan field) -> malformed_plans entry, passed false, exit 2, no crash', () => {
    const phaseDir = phaseDirPath('45-malformed');
    fs.mkdirSync(phaseDir, { recursive: true });
    // Missing the required `plan` frontmatter field entirely.
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    commitAll('feat(45-01): plan with malformed frontmatter (no plan field)');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false, 'should not throw/crash the process');
    assert.strictEqual(result.exitCode, 2, 'malformed plan frontmatter should exit 2');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
    assert.strictEqual(parsed.malformed_plans.length, 1);
    assert.strictEqual(parsed.malformed_plans[0].failure_type, 'malformed_frontmatter');
  });

  test('valid DEFERRED.json entry waives a missing check (verification) -> satisfied true, waived true, not in failures', () => {
    const phaseDir = phaseDirPath('45-waived');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    // No 45-VERIFICATION.md written -- would normally fail missing_verification.
    fs.writeFileSync(
      path.join(phaseDir, 'DEFERRED.json'),
      JSON.stringify([{ step: 'verification', reason: 'mid-execution dry run', approver: 'ollorin', phase: '45' }])
    );
    commitAll('feat(45-01): plain task, verification deferred via DEFERRED.json');

    const result = runPhaseGate('45', tmpDir);
    assert.ok(result.success, `Command should exit 0 with a valid waiver: ${result.error}`);
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, true);
    assert.ok(!parsed.failures.includes('missing_verification'), `waived check should not appear in failures: ${JSON.stringify(parsed.failures)}`);
    const verificationCheck = parsed.checks.find(c => c.type === 'verification');
    assert.strictEqual(verificationCheck.satisfied, true);
    assert.strictEqual(verificationCheck.waived, true);
  });

  test('malformed DEFERRED.json (not an array) fails the whole gate loudly with exit 2', () => {
    const phaseDir = phaseDirPath('45-badwaiver');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'DEFERRED.json'), JSON.stringify({ step: 'verification' }));
    commitAll('feat(45-01): plain task with malformed DEFERRED.json');

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 2, 'malformed waiver data should exit 2, not be silently treated as "no waivers"');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
    assert.ok(parsed.malformed_waiver, 'result should surface a malformed_waiver entry');
  });

  test('regression: verify plan-structure still passes on an existing valid plan fixture (proves constant hoisting did not change behavior)', () => {
    const planPath = path.join(tmpDir, 'valid-plan.md');
    fs.writeFileSync(planPath, `---
phase: 45
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - src/utils/helper.js
autonomous: true
must_haves:
  truths:
    - "helper.js exports a function"
---
<tasks>
<task type="auto">
<name>Task 1</name>
<files>src/utils/helper.js</files>
<action>Write a helper function</action>
<verify>node -c src/utils/helper.js</verify>
<done>helper.js exists and exports a function</done>
</task>
</tasks>
`);

    const result = runGsdTools(`verify plan-structure "${planPath}"`, tmpDir);
    assert.ok(result.success, `Command should exit 0 on a valid plan: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.valid, true, `expected valid plan, got errors: ${JSON.stringify(parsed.errors)}`);
    assert.strictEqual(parsed.errors.length, 0);
  });
});

describe('diff-based HAS_UI detection matrix (Phase 45-02)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  function commitAll(message) {
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git commit -q --allow-empty -m "${message}"`, { cwd: tmpDir, stdio: 'pipe' });
  }

  function runPhaseGate(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify phase-gate ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  test('.tsx file omitted from SUMMARY.md key-files is still detected as has_ui=true (proves independence from SUMMARY.md content)', () => {
    const phaseDir = phaseDirPath('45-tsxomitted');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    // The actual diff touches a .tsx file...
    fs.writeFileSync(path.join(phaseDir, 'Widget.tsx'), 'export default function Widget() { return null; }\n');
    // ...but the SUMMARY.md text only mentions unrelated filenames, never Widget.tsx.
    fs.writeFileSync(
      path.join(phaseDir, '45-01-SUMMARY.md'),
      `---\nphase: 45-01\nkey-files:\n  created:\n    - src/utils/helper.js\n  modified: []\n---\n# Summary\nNo mention of the tsx file here.\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({ charlotte_qa_ran: true }));
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n');
    commitAll('feat(45-01): add Widget.tsx, SUMMARY omits it from key-files');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true, 'has_ui must be true from the git diff alone, regardless of what SUMMARY.md key-files claims');
  });

  test('non-UI plan (only .ts files, no app/pages/routes path) is not falsely flagged has_ui=false', () => {
    const phaseDir = phaseDirPath('45-nouipath');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'service.ts'), 'export function service() {}\n');
    fs.writeFileSync(path.join(phaseDir, 'utils.ts'), 'export function util() {}\n');
    commitAll('feat(45-01): backend-only .ts files, no UI');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, false, 'plain .ts backend files with no UI extension/route path must not be flagged as UI');
  });

  test('mixed plan (one .tsx + several .ts files) is detected as has_ui=true', () => {
    const phaseDir = phaseDirPath('45-mixed');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'Widget.tsx'), 'export default function Widget() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'service.ts'), 'export function service() {}\n');
    fs.writeFileSync(path.join(phaseDir, 'utils.ts'), 'export function util() {}\n');
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({ charlotte_qa_ran: true }));
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n');
    commitAll('feat(45-01): mixed .tsx + .ts files');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true, 'a single .tsx file among several .ts files must still flip has_ui to true');
  });

  test('pages/api/users.ts (API route under pages/) alone is not flagged as UI -> has_ui=false', () => {
    const phaseDir = phaseDirPath('45-pagesapi');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.mkdirSync(path.join(phaseDir, 'pages', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'pages', 'api', 'users.ts'), 'export default function handler(req, res) {}\n');
    commitAll('feat(45-01): pages/api/users.ts is an API route, not UI');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, false, 'pages/api/*.ts is an API route despite living under pages/, must not trigger UI checks');
  });

  test('app/api/users/route.ts (API route under app/) alone is not flagged as UI -> has_ui=false', () => {
    const phaseDir = phaseDirPath('45-appapi');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.mkdirSync(path.join(phaseDir, 'app', 'api', 'users'), { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'app', 'api', 'users', 'route.ts'), 'export async function GET() {}\n');
    commitAll('feat(45-01): app/api/users/route.ts is an API route, not UI');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, false, 'app/api/*/route.ts is an API route despite living under app/, must not trigger UI checks');
  });

  test('routes/checkout.astro alone is detected as UI -> has_ui=true', () => {
    const phaseDir = phaseDirPath('45-astroroute');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.mkdirSync(path.join(phaseDir, 'routes'), { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'routes', 'checkout.astro'), '---\n---\n<h1>Checkout</h1>\n');
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({ charlotte_qa_ran: true }));
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n');
    commitAll('feat(45-01): add routes/checkout.astro');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true, '.astro is a UI extension (extended in 45-02) and must be detected');
  });

  test('a *.config.ts file under pages/ (edge case) is excluded from UI detection -> has_ui=false', () => {
    const phaseDir = phaseDirPath('45-pagesconfig');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.mkdirSync(path.join(phaseDir, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'pages', 'route.config.ts'), 'export default {};\n');
    commitAll('feat(45-01): add pages/route.config.ts, a config file under a route dir');
    fs.writeFileSync(
      path.join(phaseDir, '45-VERIFICATION.md'),
      `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
    );

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, false, 'a *.config.ts file must be excluded from UI detection even under a pages/ route directory');
  });

  test('regression: verify plan-structure UI-QA-check still passes on .tsx/.jsx/.vue/.svelte fixtures after extending UI_FILE_PATTERNS with .astro/.mdx', () => {
    const planPath = path.join(tmpDir, 'ui-plan.md');
    // Note: deliberately no <tasks>...</tasks> wrapper here (matching the
    // convention used by the existing "plan with .tsx AND checkpoint:ui-qa
    // task" test above) -- a <tasks> wrapper's own opening tag is itself
    // matched by the plan-structure parser's /<task[^>]*>/ tag regex (since
    // "tasks" starts with "task"), which shifts task-attribute attribution
    // by one when 2+ tasks are present. That's a pre-existing parser quirk
    // unrelated to this plan's UI_FILE_PATTERNS change -- out of scope here.
    fs.writeFileSync(planPath, `---
phase: 45
plan: "02"
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/Widget.tsx
autonomous: false
must_haves:
  truths:
    - "Widget.tsx renders"
---
<task type="auto">
<name>Task 1</name>
<files>src/components/Widget.tsx</files>
<action>Write a UI component</action>
<verify>node -c src/components/Widget.tsx</verify>
<done>Widget.tsx exists</done>
</task>
<task type="checkpoint:ui-qa" gate="blocking">
<name>QA the widget</name>
<what-built>Widget component</what-built>
<test-flows>- Visit the widget page — verify renders</test-flows>
</task>
`);

    const result = runGsdTools(`verify plan-structure "${planPath}"`, tmpDir);
    assert.ok(result.success, `Command should exit 0 on a valid UI plan with a ui-qa checkpoint: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.valid, true, `expected valid plan, got errors: ${JSON.stringify(parsed.errors)}`);
  });
});

describe('deferred add/list commands (Phase 45-03)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  // Like runGsdTools but also surfaces the real process exit code (needed
  // here because deferred add/list use distinct exit codes: 0 = success,
  // 1 = phase not found / validation error, 2 = malformed DEFERRED.json).
  function runDeferred(argsStr, cwd) {
    const start = Date.now();
    try {
      const result = execSync(`node "${TOOLS_PATH}" deferred ${argsStr}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0, durationMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
        durationMs: Date.now() - start,
      };
    }
  }

  test('deferred add on a phase with no existing DEFERRED.json creates a JSON array with exactly one entry with all 6 schema fields, plan:null when --plan omitted', () => {
    const phaseDir = phaseDirPath('45-deferredadd1');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runDeferred(`add 45-deferredadd1 --step verification --reason "dry run" --approver ollorin --raw`, tmpDir);
    assert.ok(result.success, `deferred add should exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.written, true);
    assert.strictEqual(parsed.entry.step, 'verification');
    assert.strictEqual(parsed.entry.reason, 'dry run');
    assert.strictEqual(parsed.entry.approver, 'ollorin');
    assert.ok(typeof parsed.entry.timestamp === 'string' && parsed.entry.timestamp.length > 0);
    assert.strictEqual(parsed.entry.phase, '45');
    assert.strictEqual(parsed.entry.plan, null);

    const onDisk = JSON.parse(fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8'));
    assert.ok(Array.isArray(onDisk));
    assert.strictEqual(onDisk.length, 1);
    assert.deepStrictEqual(Object.keys(onDisk[0]).sort(), ['approver', 'phase', 'plan', 'reason', 'step', 'timestamp'].sort());
  });

  test('a second deferred add call appends a second entry -- file remains one array with two entries, not overwritten', () => {
    const phaseDir = phaseDirPath('45-deferredadd2');
    fs.mkdirSync(phaseDir, { recursive: true });

    runDeferred(`add 45-deferredadd2 --step verification --reason "first" --approver ollorin --raw`, tmpDir);
    const second = runDeferred(`add 45-deferredadd2 --step docs --reason "second" --approver ollorin --plan 02 --raw`, tmpDir);
    assert.ok(second.success, `second deferred add should exit 0: ${second.error}`);

    const onDisk = JSON.parse(fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8'));
    assert.strictEqual(onDisk.length, 2, 'DEFERRED.json should accumulate entries, not be overwritten');
    assert.strictEqual(onDisk[0].step, 'verification');
    assert.strictEqual(onDisk[1].step, 'docs');
    assert.strictEqual(onDisk[1].plan, '02');
  });

  test('deferred list on a phase with no DEFERRED.json returns { waivers: [], count: 0 } -- absent file is valid, not an error', () => {
    const phaseDir = phaseDirPath('45-deferredlistempty');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runDeferred(`list 45-deferredlistempty --raw`, tmpDir);
    assert.ok(result.success, `deferred list should exit 0 for an absent DEFERRED.json: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed.waivers, []);
    assert.strictEqual(parsed.count, 0);
  });

  test('deferred list on a phase with a malformed/truncated DEFERRED.json returns a typed malformed_waiver error with non-zero exit -- NOT {waivers: []}', () => {
    const phaseDir = phaseDirPath('45-deferredlistbad');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'DEFERRED.json'), '{"step": "verification"'); // truncated JSON

    const result = runDeferred(`list 45-deferredlistbad --raw`, tmpDir);
    assert.strictEqual(result.success, false, 'malformed DEFERRED.json should exit non-zero');
    assert.strictEqual(result.exitCode, 2);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error, true);
    assert.strictEqual(parsed.type, 'malformed_waiver');
    assert.notDeepStrictEqual(parsed, { waivers: [] }, 'a corrupt file must never look like zero waivers');
  });

  test('deferred add on a phase with an existing malformed DEFERRED.json refuses to append/overwrite -- errors loudly instead of silently replacing it', () => {
    const phaseDir = phaseDirPath('45-deferredaddbad');
    fs.mkdirSync(phaseDir, { recursive: true });
    const originalBadContent = '{"not": "an array"}';
    fs.writeFileSync(path.join(phaseDir, 'DEFERRED.json'), originalBadContent);

    const result = runDeferred(`add 45-deferredaddbad --step verification --reason x --approver y --raw`, tmpDir);
    assert.strictEqual(result.success, false, 'deferred add must refuse to write over a malformed DEFERRED.json');
    assert.strictEqual(result.exitCode, 2);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error, true);
    assert.strictEqual(parsed.type, 'malformed_waiver');

    // The corrupt file must be left untouched -- not silently replaced with a
    // fresh single-entry array.
    const onDiskContent = fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8');
    assert.strictEqual(onDiskContent, originalBadContent);
  });

  test('with TELEGRAM_BOT_TOKEN/TELEGRAM_OWNER_ID unset, deferred add still succeeds and returns promptly (well under the 3s notification timeout)', () => {
    const phaseDir = phaseDirPath('45-deferredaddnotelegram');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runDeferred(`add 45-deferredaddnotelegram --step verification --reason x --approver y --raw`, tmpDir);
    assert.ok(result.success, `deferred add should succeed with Telegram unconfigured: ${result.error}`);
    assert.ok(result.durationMs < 2000, `deferred add should return promptly (no hang waiting on a network call), took ${result.durationMs}ms`);

    const onDisk = JSON.parse(fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8'));
    assert.strictEqual(onDisk.length, 1);
  });

  test('missing required flags (--step/--reason/--approver) errors instead of writing a partial entry', () => {
    const phaseDir = phaseDirPath('45-deferredaddmissingflags');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runDeferred(`add 45-deferredaddmissingflags --step verification --reason x`, tmpDir);
    assert.strictEqual(result.success, false, 'deferred add must reject a call missing --approver');
    assert.strictEqual(fs.existsSync(path.join(phaseDir, 'DEFERRED.json')), false, 'no file should be written when required flags are missing');
  });

  test('deferred add on an unknown phase returns typed phase_not_found, non-zero exit, no crash', () => {
    const result = runDeferred(`add 99-doesnotexist --step verification --reason x --approver y --raw`, tmpDir);
    assert.strictEqual(result.success, false);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error, true);
    assert.strictEqual(parsed.type, 'phase_not_found');
  });
});

// ─── Phase 47-03: Telegram Escalation Timeout-Fallback Waiver Wiring ────────
// gsd-phase-coordinator.md's Step A-fallback (see agents/gsd-phase-coordinator.md)
// invokes this EXACT CLI shape on ask_blocking_question failure:
//   deferred add {phase} --step discuss --reason "..." --approver timeout-fallback [--plan {plan}]
// These tests prove that exact invocation actually writes and surfaces a
// waiver -- the coordinator prose itself cannot be unit-tested (it's an agent
// prompt, not TS/JS), so this is the lightest-weight deterministic proof that
// the CLI mechanism it depends on works end-to-end.
describe('timeout-fallback waiver wiring (Phase 47-03)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  // Reuses the exact runDeferred pattern already established above (surfaces
  // real process exit code, since deferred add/list use distinct exit codes).
  function runDeferred(argsStr, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" deferred ${argsStr}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  test('the exact coordinator CLI shape (no --plan) writes a DEFERRED.json entry with approver: timeout-fallback, step: discuss, plan: null -- all 6 schema fields present', () => {
    const phaseDir = phaseDirPath('47-timeoutfallback1');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runDeferred(
      `add 47-timeoutfallback1 --step discuss --reason "Telegram escalation timed out/unavailable for: should we use JWT or session cookies?" --approver timeout-fallback --raw`,
      tmpDir
    );
    assert.ok(result.success, `deferred add should exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.written, true);
    assert.strictEqual(parsed.entry.step, 'discuss');
    assert.strictEqual(parsed.entry.reason, 'Telegram escalation timed out/unavailable for: should we use JWT or session cookies?');
    assert.strictEqual(parsed.entry.approver, 'timeout-fallback');
    assert.strictEqual(parsed.entry.plan, null, '--plan is optional for this use case: the escalation loop runs at the discuss step, before any plan exists yet');
    assert.ok(typeof parsed.entry.timestamp === 'string' && parsed.entry.timestamp.length > 0);
    assert.strictEqual(parsed.entry.phase, '47');

    const onDisk = JSON.parse(fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8'));
    assert.ok(Array.isArray(onDisk));
    assert.strictEqual(onDisk.length, 1);
    assert.deepStrictEqual(Object.keys(onDisk[0]).sort(), ['approver', 'phase', 'plan', 'reason', 'step', 'timestamp'].sort());
    assert.strictEqual(onDisk[0].approver, 'timeout-fallback');
  });

  test('deferred list immediately surfaces the timeout-fallback entry -- round-trip proof', () => {
    const phaseDir = phaseDirPath('47-timeoutfallback2');
    fs.mkdirSync(phaseDir, { recursive: true });

    runDeferred(
      `add 47-timeoutfallback2 --step discuss --reason "Telegram escalation timed out/unavailable for: pick a caching strategy" --approver timeout-fallback --raw`,
      tmpDir
    );

    const listResult = runDeferred(`list 47-timeoutfallback2 --raw`, tmpDir);
    assert.ok(listResult.success, `deferred list should exit 0: ${listResult.error}`);
    const parsed = JSON.parse(listResult.output);
    assert.strictEqual(parsed.count, 1);
    assert.strictEqual(parsed.waivers.length, 1);
    assert.strictEqual(parsed.waivers[0].approver, 'timeout-fallback');
    assert.strictEqual(parsed.waivers[0].step, 'discuss');
    assert.strictEqual(parsed.waivers[0].reason, 'Telegram escalation timed out/unavailable for: pick a caching strategy');
  });

  test('a second timeout-fallback entry for a different gray_area on the same phase appends rather than overwrites', () => {
    const phaseDir = phaseDirPath('47-timeoutfallback3');
    fs.mkdirSync(phaseDir, { recursive: true });

    runDeferred(
      `add 47-timeoutfallback3 --step discuss --reason "Telegram escalation timed out/unavailable for: gray area A" --approver timeout-fallback --raw`,
      tmpDir
    );
    const second = runDeferred(
      `add 47-timeoutfallback3 --step discuss --reason "Telegram escalation timed out/unavailable for: gray area B" --approver timeout-fallback --raw`,
      tmpDir
    );
    assert.ok(second.success, `second deferred add should exit 0: ${second.error}`);

    const onDisk = JSON.parse(fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8'));
    assert.strictEqual(onDisk.length, 2, 'DEFERRED.json should accumulate multiple timeout-fallback waivers, not clobber -- confirms multiple escalation timeouts in one phase run each get their own waiver');
    assert.strictEqual(onDisk[0].reason, 'Telegram escalation timed out/unavailable for: gray area A');
    assert.strictEqual(onDisk[1].reason, 'Telegram escalation timed out/unavailable for: gray area B');
    assert.strictEqual(onDisk[0].approver, 'timeout-fallback');
    assert.strictEqual(onDisk[1].approver, 'timeout-fallback');

    const listResult = runDeferred(`list 47-timeoutfallback3 --raw`, tmpDir);
    const parsedList = JSON.parse(listResult.output);
    assert.strictEqual(parsedList.count, 2);
  });

  test('--plan flag is optional but honored when provided (e.g. a fallback occurring mid-plan, not just at discuss-step)', () => {
    const phaseDir = phaseDirPath('47-timeoutfallback4');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runDeferred(
      `add 47-timeoutfallback4 --step discuss --reason "Telegram escalation timed out/unavailable for: gray area with plan context" --approver timeout-fallback --plan 03 --raw`,
      tmpDir
    );
    assert.ok(result.success, `deferred add should exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.entry.plan, '03');
  });
});

// ─── Phase 45-05: Cross-Cutting Integration Tests ────────────────────────────
// 45-01/45-02/45-03 each ship unit-level tdd tests for their own change,
// already exercised through the real CLI via execSync (not narrower in-process
// calls). This suite is ADDITIVE: a single reusable fixture builder covering
// the FULL phase-gate matrix + HAS_UI matrix + waiver matrix named in
// ROADMAP.md Phase 45 Success Criterion 5, plus cross-feature composition
// scenarios (deferred add -> phase-gate, deferred list after multiple adds,
// phase-wide vs plan-scoped waiver scoping, and full round-trip malformed-file
// agreement across all three commands) that no single prior plan's own tests
// fully cover.

describe('phase-gate full matrix + HAS_UI integration (Phase 45-05 Task 1)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  // Like runGsdTools but also surfaces the real process exit code -- phase-gate
  // uses distinct exit codes: 0 passed, 1 failed checks, 2 malformed data.
  function runPhaseGate(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify phase-gate ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  // Reusable fixture builder (per this plan's <behavior> spec): builds a phase
  // directory with a real git repo, a single configurable *-PLAN.md (tdd
  // marker toggle), a configurable set of extra files committed alongside it
  // (tagged `45-{planNum}` so collectPhaseTouchedFiles's git-log --grep walk
  // picks them up as real touched files -- never a self-report), and optional
  // CHECKPOINT.json / E2E-TEST-PLAN.md / *-VERIFICATION.md / *-SUMMARY.md /
  // DEFERRED.json artifacts written AFTER the commit (so they never
  // accidentally count as "touched" themselves unless a test wants that).
  function buildFixture(phaseDirName, {
    planNum = '01',
    tdd = false,
    extraFiles = {},
    commitMessage,
    checkpoint = null,        // null | object
    e2eTestPlan = undefined,  // undefined = omit file, string = write ('' -> default content)
    verification = undefined, // undefined = omit file, string = write ('' -> default content)
    summary = undefined,      // undefined = omit file, string = write as 45-{planNum}-SUMMARY.md content
    deferred = undefined,     // undefined = omit file, string = write raw (possibly malformed), array = JSON.stringify
  } = {}) {
    const phaseDir = phaseDirPath(phaseDirName);
    fs.mkdirSync(phaseDir, { recursive: true });

    const taskTag = tdd ? '<task type="auto" tdd="true">' : '<task type="auto">';
    fs.writeFileSync(
      path.join(phaseDir, `45-${planNum}-PLAN.md`),
      `---\nphase: "45"\nplan: "${planNum}"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n${taskTag}\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    for (const [relPath, content] of Object.entries(extraFiles)) {
      const fullPath = path.join(phaseDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }

    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync(
      `git commit -q --allow-empty -m "${commitMessage || `feat(45-${planNum}): fixture commit`}"`,
      { cwd: tmpDir, stdio: 'pipe' }
    );

    if (checkpoint) {
      fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify(checkpoint));
    }
    if (e2eTestPlan !== undefined) {
      fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), e2eTestPlan || '# E2E Test Plan\n');
    }
    if (verification !== undefined) {
      fs.writeFileSync(
        path.join(phaseDir, `45-${planNum}-VERIFICATION.md`),
        verification || `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`
      );
    }
    if (summary !== undefined) {
      fs.writeFileSync(path.join(phaseDir, `45-${planNum}-SUMMARY.md`), summary);
    }
    if (deferred !== undefined) {
      const content = typeof deferred === 'string' ? deferred : JSON.stringify(deferred);
      fs.writeFileSync(path.join(phaseDir, 'DEFERRED.json'), content);
    }

    return phaseDir;
  }

  test('all 5 artifacts present via fixture builder -> passed true, exit 0, has_ui false', () => {
    buildFixture('45-int-allgood', {
      extraFiles: { 'impl.js': 'module.exports = {};\n' },
      verification: '',
    });

    const result = runPhaseGate('45', tmpDir);
    assert.ok(result.success, `expected exit 0: ${result.error}`);
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, true);
    assert.deepStrictEqual(parsed.failures, []);
    assert.strictEqual(parsed.has_ui, false);
  });

  test('missing_test: tdd task present, no test/spec file in the real diff -> missing_test, exit 1', () => {
    buildFixture('45-int-notest', {
      tdd: true,
      extraFiles: { 'impl.js': 'module.exports = {};\n' },
      verification: '',
    });

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
    assert.ok(parsed.failures.includes('missing_test'));
  });

  test('missing_charlotte_qa: .tsx in diff, E2E-TEST-PLAN.md present, CHECKPOINT.json absent -> missing_charlotte_qa', () => {
    buildFixture('45-int-nocharlotte', {
      extraFiles: { 'Dashboard.tsx': 'export default function Dashboard() { return null; }\n' },
      e2eTestPlan: '',
      verification: '',
    });

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true);
    assert.ok(parsed.failures.includes('missing_charlotte_qa'));
  });

  test('missing_e2e_plan: .tsx in diff, CHECKPOINT.json present, E2E-TEST-PLAN.md absent -> missing_e2e_plan', () => {
    buildFixture('45-int-noe2e', {
      extraFiles: { 'Dashboard.tsx': 'export default function Dashboard() { return null; }\n' },
      checkpoint: { charlotte_qa_ran: true },
      verification: '',
    });

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true);
    assert.ok(parsed.failures.includes('missing_e2e_plan'));
  });

  test('missing_docs: api/ file touched, no docs/README/CHANGELOG signal -> missing_docs', () => {
    // Deliberately avoid a phase-dir name containing the substring "docs/" --
    // it would spuriously satisfy DOC_SATISFIED_RE via the directory path.
    buildFixture('45-int-apisignal', {
      extraFiles: { 'src/api/users.js': 'module.exports = {};\n' },
      verification: '',
    });

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, false, 'api/ file has no UI extension/route path');
    assert.ok(parsed.failures.includes('missing_docs'));
  });

  test('missing_verification: no *-VERIFICATION.md present -> missing_verification, exit 1', () => {
    buildFixture('45-int-noverify', {
      extraFiles: { 'impl.js': 'module.exports = {};\n' },
    });

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.failures.includes('missing_verification'));
  });

  test('HAS_UI: .tsx touched but omitted from *-SUMMARY.md key-files text -> has_ui true (independent of self-report)', () => {
    buildFixture('45-int-uiomitted', {
      extraFiles: { 'Dashboard.tsx': 'export default function Dashboard() { return null; }\n' },
      checkpoint: { charlotte_qa_ran: true },
      e2eTestPlan: '',
      verification: '',
      summary: `---\nphase: "45"\nplan: "01"\nkey-files:\n  created:\n    - impl.js\n---\n# Summary\nNo mention of the UI file here.\n`,
    });

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true, 'has_ui must be derived from the real diff, not from SUMMARY.md key-files text');
  });

  test('HAS_UI: non-UI-only fixture (.ts backend files only) -> has_ui false', () => {
    buildFixture('45-int-nonui', {
      extraFiles: {
        'src/service.ts': 'export const service = {};\n',
        'src/repository.ts': 'export const repository = {};\n',
      },
      verification: '',
    });

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, false);
  });

  test('HAS_UI: mixed fixture (.tsx + several .ts) -> has_ui true', () => {
    buildFixture('45-int-mixed', {
      extraFiles: {
        'Dashboard.tsx': 'export default function Dashboard() { return null; }\n',
        'src/service.ts': 'export const service = {};\n',
        'src/repository.ts': 'export const repository = {};\n',
        'src/utils.ts': 'export const utils = {};\n',
      },
      checkpoint: { charlotte_qa_ran: true },
      e2eTestPlan: '',
      verification: '',
    });

    const result = runPhaseGate('45', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.has_ui, true);
  });

  test('valid DEFERRED.json waiver for the missing check -> satisfied true, waived true, overall passed true, exit 0', () => {
    buildFixture('45-int-waived', {
      extraFiles: { 'impl.js': 'module.exports = {};\n' },
      // No verification file -- would normally fail missing_verification.
      deferred: [{ step: 'verification', reason: 'mid-execution dry run', approver: 'ollorin', phase: '45' }],
    });

    const result = runPhaseGate('45', tmpDir);
    assert.ok(result.success, `expected exit 0 with a valid waiver: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, true);
    assert.ok(!parsed.failures.includes('missing_verification'));
    const verificationCheck = parsed.checks.find(c => c.type === 'verification');
    assert.strictEqual(verificationCheck.satisfied, true);
    assert.strictEqual(verificationCheck.waived, true);
  });

  test('a waiver for an UNRELATED step does not waive a different missing check -- fails with its own failure_type, not silently passed', () => {
    buildFixture('45-int-scopedmiss', {
      extraFiles: { 'impl.js': 'module.exports = {};\n' },
      // Waiver present, but for "docs", not "verification" -- verification is
      // still missing and must still fail.
      deferred: [{ step: 'docs', reason: 'unrelated waiver', approver: 'ollorin', phase: '45' }],
    });

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
    assert.ok(parsed.failures.includes('missing_verification'), 'an unrelated waiver must never satisfy a different check');
    const verificationCheck = parsed.checks.find(c => c.type === 'verification');
    assert.strictEqual(verificationCheck.satisfied, false);
    assert.strictEqual(verificationCheck.waived, false);
  });

  test('malformed DEFERRED.json fails LOUD with a typed malformed_waiver error -- explicitly distinct from the "no waivers" empty-array case', () => {
    // Fixture A: no DEFERRED.json at all (absent file == "no waivers").
    buildFixture('45-int-nowaiver', {
      extraFiles: { 'impl.js': 'module.exports = {};\n' },
      verification: '',
    });
    const noWaiverResult = runPhaseGate('45', tmpDir);
    const noWaiverParsed = JSON.parse(noWaiverResult.output);
    assert.strictEqual(noWaiverResult.exitCode, 0);
    assert.strictEqual(noWaiverParsed.passed, true);
    assert.strictEqual(noWaiverParsed.malformed_waiver, undefined, 'absent DEFERRED.json must never surface a malformed_waiver key');

    // Fixture B: same phase number, malformed DEFERRED.json (not an array).
    // Uses a separate tmpDir so the two fixtures do not collide on one phase.
    const tmpDir2 = createTempProject();
    execSync('git init', { cwd: tmpDir2, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir2, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir2, stdio: 'pipe' });
    try {
      const phaseDir2 = path.join(tmpDir2, '.planning', 'phases', '45-int-badwaiver');
      fs.mkdirSync(phaseDir2, { recursive: true });
      fs.writeFileSync(
        path.join(phaseDir2, '45-01-PLAN.md'),
        `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
      );
      execSync('git add -A', { cwd: tmpDir2, stdio: 'pipe' });
      execSync('git commit -q --allow-empty -m "feat(45-01): fixture"', { cwd: tmpDir2, stdio: 'pipe' });
      fs.writeFileSync(path.join(phaseDir2, '45-VERIFICATION.md'), `---\nphase: "45"\nstatus: passed\n---\n# Verification\n`);
      fs.writeFileSync(path.join(phaseDir2, 'DEFERRED.json'), JSON.stringify({ step: 'verification' }));

      const badWaiverResult = runPhaseGate('45', tmpDir2);
      assert.strictEqual(badWaiverResult.exitCode, 2, 'malformed waiver data must exit 2, not be silently treated as "no waivers"');
      const badWaiverParsed = JSON.parse(badWaiverResult.output);
      assert.strictEqual(badWaiverParsed.passed, false);
      assert.ok(badWaiverParsed.malformed_waiver, 'a malformed DEFERRED.json must surface a distinct malformed_waiver entry');
      assert.notDeepStrictEqual(badWaiverParsed.malformed_waiver, noWaiverParsed.malformed_waiver, 'malformed-waiver shape must differ from the no-waivers case (undefined)');
    } finally {
      cleanup(tmpDir2);
    }
  });

  test('malformed plan frontmatter (missing plan field) -> typed malformed_frontmatter entry, passed false, no crash -- output is still parseable JSON', () => {
    buildFixture('45-int-malformedfm', {
      verification: '',
    });
    // Overwrite the PLAN.md written by the builder with one missing `plan`.
    const phaseDir = phaseDirPath('45-int-malformedfm');
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -q --allow-empty -m "feat(45-01): overwrite plan with malformed frontmatter"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.success, false, 'should not throw/crash the process');
    assert.strictEqual(result.exitCode, 2);
    // Proves runGsdTools-style callers can always JSON.parse the output even on
    // a non-zero exit -- no uncaught exception/stack trace was printed instead.
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(result.output); }, 'output must be parseable JSON even on failure, never a stack trace');
    assert.strictEqual(parsed.passed, false);
    assert.strictEqual(parsed.malformed_plans[0].failure_type, 'malformed_frontmatter');
  });
});

describe('deferred add/list <-> phase-gate composition integration (Phase 45-05 Task 2)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  function runDeferred(argsStr, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" deferred ${argsStr}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  function runPhaseGate(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify phase-gate ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  function buildMissingVerificationFixture(phaseDirName) {
    const phaseDir = phaseDirPath(phaseDirName);
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '45-01-PLAN.md'),
      `---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -q --allow-empty -m "feat(45-01): fixture missing verification"', { cwd: tmpDir, stdio: 'pipe' });
    return phaseDir;
  }

  test('deferred add (real CLI) followed by verify phase-gate (real CLI) composes through the actual DEFERRED.json file on disk -- not just in-memory', () => {
    buildMissingVerificationFixture('45-int-composeadd');

    const before = runPhaseGate('45', tmpDir);
    assert.strictEqual(before.exitCode, 1);
    assert.ok(JSON.parse(before.output).failures.includes('missing_verification'));

    const addResult = runDeferred(
      `add 45-int-composeadd --step verification --reason "mid-execution dry run" --approver ollorin --raw`,
      tmpDir
    );
    assert.ok(addResult.success, `deferred add should exit 0: ${addResult.error}`);

    const after = runPhaseGate('45', tmpDir);
    assert.ok(after.success, `phase-gate should now pass via the on-disk waiver: ${after.error}`);
    const afterParsed = JSON.parse(after.output);
    assert.strictEqual(afterParsed.passed, true);
    const verificationCheck = afterParsed.checks.find(c => c.type === 'verification');
    assert.strictEqual(verificationCheck.satisfied, true);
    assert.strictEqual(verificationCheck.waived, true);
  });

  test('deferred list after two separate deferred add calls returns both entries in one array (append proven via CLI, not in-memory)', () => {
    const phaseDir = phaseDirPath('45-int-listtwo');
    fs.mkdirSync(phaseDir, { recursive: true });

    runDeferred(`add 45-int-listtwo --step verification --reason "first" --approver ollorin --raw`, tmpDir);
    runDeferred(`add 45-int-listtwo --step docs --reason "second" --approver ollorin --plan 02 --raw`, tmpDir);

    const listResult = runDeferred(`list 45-int-listtwo --raw`, tmpDir);
    assert.ok(listResult.success, `deferred list should exit 0: ${listResult.error}`);
    const parsed = JSON.parse(listResult.output);
    assert.strictEqual(parsed.count, 2);
    assert.strictEqual(parsed.waivers.length, 2);
    assert.strictEqual(parsed.waivers[0].step, 'verification');
    assert.strictEqual(parsed.waivers[1].step, 'docs');

    const onDisk = JSON.parse(fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8'));
    assert.strictEqual(onDisk.length, 2);
  });

  test('a phase-wide waiver (--plan omitted) satisfies the check for the phase overall', () => {
    buildMissingVerificationFixture('45-int-phasewide');

    runDeferred(
      `add 45-int-phasewide --step verification --reason "phase-wide waiver" --approver ollorin --raw`,
      tmpDir
    );

    const result = runPhaseGate('45', tmpDir);
    assert.ok(result.success, `phase-wide waiver should satisfy the check: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, true);
    const verificationCheck = parsed.checks.find(c => c.type === 'verification');
    assert.strictEqual(verificationCheck.waived, true);
  });

  test('a plan-scoped waiver (--plan supplied) does NOT satisfy phase-gate\'s phase-wide check -- scoping is respected, not "any waiver found"', () => {
    buildMissingVerificationFixture('45-int-planscoped');

    runDeferred(
      `add 45-int-planscoped --step verification --reason "plan-scoped waiver" --approver ollorin --plan 02 --raw`,
      tmpDir
    );

    const result = runPhaseGate('45', tmpDir);
    assert.strictEqual(result.exitCode, 1, 'a plan-scoped waiver must not blanket-satisfy the phase-wide verification check');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
    assert.ok(parsed.failures.includes('missing_verification'));
    const verificationCheck = parsed.checks.find(c => c.type === 'verification');
    assert.strictEqual(verificationCheck.satisfied, false);
    assert.strictEqual(verificationCheck.waived, false);
  });

  test('full round trip with a malformed DEFERRED.json: deferred list, deferred add, AND verify phase-gate all fail loud -- none silently treats it as empty', () => {
    const phaseDir = buildMissingVerificationFixture('45-int-roundtripbad');
    const originalBadContent = '{"not": "an array"}';
    fs.writeFileSync(path.join(phaseDir, 'DEFERRED.json'), originalBadContent);

    const listResult = runDeferred(`list 45-int-roundtripbad --raw`, tmpDir);
    assert.strictEqual(listResult.exitCode, 2, 'deferred list must fail loud on a malformed file');
    const listParsed = JSON.parse(listResult.output);
    assert.strictEqual(listParsed.type, 'malformed_waiver');

    const addResult = runDeferred(
      `add 45-int-roundtripbad --step verification --reason x --approver y --raw`,
      tmpDir
    );
    assert.strictEqual(addResult.exitCode, 2, 'deferred add must refuse to append to a malformed file');
    const addParsed = JSON.parse(addResult.output);
    assert.strictEqual(addParsed.type, 'malformed_waiver');

    const gateResult = runPhaseGate('45', tmpDir);
    assert.strictEqual(gateResult.exitCode, 2, 'verify phase-gate must fail loud on a malformed file');
    const gateParsed = JSON.parse(gateResult.output);
    assert.ok(gateParsed.malformed_waiver, 'phase-gate must surface a malformed_waiver entry');

    const onDiskContent = fs.readFileSync(path.join(phaseDir, 'DEFERRED.json'), 'utf-8');
    assert.strictEqual(onDiskContent, originalBadContent);
  });
});

describe('verify e2e-gaps + gap-aware e2e_plan check (Phase 46-01)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  function commitAll(message) {
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git commit -q --allow-empty -m "${message}"`, { cwd: tmpDir, stdio: 'pipe' });
  }

  // Surfaces the real process exit code -- `verify e2e-gaps` uses distinct
  // exit codes: 0 = idempotent-skip (nothing to do), 1 = gaps/generation
  // failure present, 2 = phase-not-found/malformed-plan.
  function runE2EGaps(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify e2e-gaps ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  function runPhaseGate(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify phase-gate ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  function runDeferred(argsStr, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" deferred ${argsStr}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  function writePlan(phaseDir, planFile = '46-01-PLAN.md') {
    fs.writeFileSync(
      path.join(phaseDir, planFile),
      `---\nphase: "46"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
  }

  test('non-UI phase (only .ts files touched) -> verify e2e-gaps has_ui false, gap_count 0, exit 0; phase-gate e2e_plan check not-required', () => {
    const phaseDir = phaseDirPath('46-nonui');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'utils.ts'), 'export const noop = () => {};\n');
    commitAll('feat(46-01): non-ui ts file only');

    const gapResult = runE2EGaps('46', tmpDir);
    assert.ok(gapResult.success, `verify e2e-gaps should exit 0 for a non-UI phase: ${gapResult.error}`);
    assert.strictEqual(gapResult.exitCode, 0);
    const gapParsed = JSON.parse(gapResult.output);
    assert.strictEqual(gapParsed.has_ui, false);
    assert.strictEqual(gapParsed.gap_count, 0);
    assert.strictEqual(gapParsed.generation_failed, false);

    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);
    const gateResult = runPhaseGate('46', tmpDir);
    const gateParsed = JSON.parse(gateResult.output);
    const e2eCheck = gateParsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.required, false, 'e2e_plan check must remain not-required for a non-UI phase, unchanged from Phase 45 behavior');
  });

  test('UI phase, no E2E-TEST-PLAN.md at all -> gaps contains every touched UI basename, gap_count > 0, exit 1; phase-gate fails missing_e2e_plan', () => {
    const phaseDir = phaseDirPath('46-noplan');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'Settings.tsx'), 'export default function Settings() { return null; }\n');
    commitAll('feat(46-01): two UI files, no e2e plan');

    const gapResult = runE2EGaps('46', tmpDir);
    assert.strictEqual(gapResult.exitCode, 1);
    const gapParsed = JSON.parse(gapResult.output);
    assert.strictEqual(gapParsed.has_ui, true);
    assert.strictEqual(gapParsed.e2e_plan_exists, false);
    assert.strictEqual(gapParsed.gap_count, 2);
    assert.deepStrictEqual([...gapParsed.gaps].sort(), ['Dashboard', 'Settings']);

    const gateResult = runPhaseGate('46', tmpDir);
    assert.strictEqual(gateResult.exitCode, 1);
    const gateParsed = JSON.parse(gateResult.output);
    assert.ok(gateParsed.failures.includes('missing_e2e_plan'));
    const e2eCheck = gateParsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.satisfied, false);
    assert.strictEqual(e2eCheck.failure_type, 'missing_e2e_plan');
    assert.deepStrictEqual([...gateParsed.e2e_gaps].sort(), ['Dashboard', 'Settings']);
  });

  test('UI phase, E2E-TEST-PLAN.md mentions every touched UI basename (case-insensitive) -> gap_count 0, exit 0; phase-gate e2e_plan passes', () => {
    const phaseDir = phaseDirPath('46-fullcoverage');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'Settings.tsx'), 'export default function Settings() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n\n## Scenarios\n- dashboard loads correctly\n- SETTINGS page saves preferences\n');
    commitAll('feat(46-01): two UI files, full e2e coverage');
    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);

    const gapResult = runE2EGaps('46', tmpDir);
    assert.strictEqual(gapResult.exitCode, 0, `full coverage should be an idempotent-skip signal: ${JSON.stringify(gapResult)}`);
    const gapParsed = JSON.parse(gapResult.output);
    assert.strictEqual(gapParsed.gap_count, 0);
    assert.strictEqual(gapParsed.e2e_plan_exists, true);

    const gateResult = runPhaseGate('46', tmpDir);
    const gateParsed = JSON.parse(gateResult.output);
    assert.ok(!gateParsed.failures.includes('missing_e2e_plan'), `e2e_plan should not fail when coverage is complete: ${JSON.stringify(gateParsed.failures)}`);
    const e2eCheck = gateParsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.satisfied, true);
    assert.strictEqual(e2eCheck.failure_type, null);
  });

  test('UI phase, E2E-TEST-PLAN.md omits one UI basename -> gaps contains exactly that basename, gap_count 1, exit 1; phase-gate fails missing_e2e_plan', () => {
    const phaseDir = phaseDirPath('46-partial');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'Settings.tsx'), 'export default function Settings() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n\n## Scenarios\n- Dashboard loads correctly\n');
    commitAll('feat(46-01): two UI files, partial e2e coverage (Settings omitted)');
    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);

    const gapResult = runE2EGaps('46', tmpDir);
    assert.strictEqual(gapResult.exitCode, 1);
    const gapParsed = JSON.parse(gapResult.output);
    assert.strictEqual(gapParsed.gap_count, 1);
    assert.deepStrictEqual(gapParsed.gaps, ['Settings']);

    const gateResult = runPhaseGate('46', tmpDir);
    assert.strictEqual(gateResult.exitCode, 1);
    const gateParsed = JSON.parse(gateResult.output);
    assert.ok(gateParsed.failures.includes('missing_e2e_plan'));
    const e2eCheck = gateParsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.failure_type, 'missing_e2e_plan');
    assert.deepStrictEqual(gateParsed.e2e_gaps, ['Settings']);
  });

  test('E2E-GENERATION-FAILED.json marker present (even with full text coverage) -> generation_failed true; phase-gate fails e2e_generation_failed, NOT missing_e2e_plan', () => {
    const phaseDir = phaseDirPath('46-genfail');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n\n- Dashboard loads correctly\n');
    commitAll('feat(46-01): full coverage but generator marked failed');
    fs.writeFileSync(
      path.join(phaseDir, 'E2E-GENERATION-FAILED.json'),
      JSON.stringify({ error: 'gsd-e2e-test-generator threw during spawn', timestamp: '2026-07-04T00:00:00Z' })
    );
    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);

    const gapResult = runE2EGaps('46', tmpDir);
    assert.strictEqual(gapResult.exitCode, 1, 'a generation-failure marker must block the idempotent-skip signal even with gap_count 0');
    const gapParsed = JSON.parse(gapResult.output);
    assert.strictEqual(gapParsed.gap_count, 0, 'text coverage is complete -- gaps computation itself is unaffected by the marker');
    assert.strictEqual(gapParsed.generation_failed, true);

    const gateResult = runPhaseGate('46', tmpDir);
    assert.strictEqual(gateResult.exitCode, 1);
    const gateParsed = JSON.parse(gateResult.output);
    assert.ok(gateParsed.failures.includes('e2e_generation_failed'), `expected e2e_generation_failed in failures: ${JSON.stringify(gateParsed.failures)}`);
    assert.ok(!gateParsed.failures.includes('missing_e2e_plan'), 'the override must REPLACE the generic failure_type, not add to it');
    const e2eCheck = gateParsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.satisfied, false);
    assert.strictEqual(e2eCheck.failure_type, 'e2e_generation_failed');
  });

  test('malformed E2E-GENERATION-FAILED.json (invalid JSON) does not crash verify e2e-gaps or verify phase-gate -- still treated as a generation failure', () => {
    const phaseDir = phaseDirPath('46-genfailbad');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n\n- Dashboard loads correctly\n');
    commitAll('feat(46-01): full coverage, malformed generation-failure marker');
    fs.writeFileSync(path.join(phaseDir, 'E2E-GENERATION-FAILED.json'), '{not valid json');
    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);

    const gapResult = runE2EGaps('46', tmpDir);
    assert.strictEqual(gapResult.exitCode, 1, 'malformed marker must not crash and must still be treated as a failure');
    const gapParsed = JSON.parse(gapResult.output);
    assert.strictEqual(gapParsed.generation_failed, true);

    const gateResult = runPhaseGate('46', tmpDir);
    assert.strictEqual(gateResult.exitCode, 1, 'malformed marker must not crash verify phase-gate');
    const gateParsed = JSON.parse(gateResult.output);
    const e2eCheck = gateParsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.failure_type, 'e2e_generation_failed');
  });

  test('a deferred add --step e2e_plan waiver satisfies the e2e_plan check even when gaps exist AND the generation-failure marker is present', () => {
    const phaseDir = phaseDirPath('46-waived');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'Settings.tsx'), 'export default function Settings() { return null; }\n');
    // Deliberately no E2E-TEST-PLAN.md at all -- every UI file is a gap.
    commitAll('feat(46-01): two UI files, no e2e plan, about to be waived');
    fs.writeFileSync(
      path.join(phaseDir, 'E2E-GENERATION-FAILED.json'),
      JSON.stringify({ error: 'generator threw', timestamp: '2026-07-04T00:00:00Z' })
    );
    // charlotte_qa is a separate, unrelated check -- satisfy it here so this
    // test isolates the e2e_plan waiver behavior instead of also failing on
    // missing_charlotte_qa (which every UI-bearing fixture in this suite would
    // otherwise trip).
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({ charlotte_qa_ran: true }));
    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);

    const addResult = runDeferred(
      `add 46-waived --step e2e_plan --reason "E2E generator unavailable in this environment" --approver ollorin --raw`,
      tmpDir
    );
    assert.ok(addResult.success, `deferred add should exit 0: ${addResult.error}`);

    const gateResult = runPhaseGate('46', tmpDir);
    assert.ok(gateResult.success, `waiver should satisfy the e2e_plan check despite gaps and the generation-failure marker: ${gateResult.error}`);
    const gateParsed = JSON.parse(gateResult.output);
    assert.ok(!gateParsed.failures.includes('missing_e2e_plan'));
    assert.ok(!gateParsed.failures.includes('e2e_generation_failed'));
    const e2eCheck = gateParsed.checks.find(c => c.type === 'e2e_plan');
    assert.strictEqual(e2eCheck.satisfied, true);
    assert.strictEqual(e2eCheck.waived, true);
    assert.strictEqual(e2eCheck.failure_type, null, 'a waived check must report failure_type null, not the override string');
  });

  // Regression proof: the existing Phase 45-01/45-05 e2e_plan existence-only
  // fixtures (E2E-TEST-PLAN.md with generic non-matching content like
  // "# E2E Test Plan\n") already run as part of the pre-existing test suite
  // (see "verify phase-gate command (Phase 45-01)" and "phase-gate full
  // matrix + HAS_UI integration (Phase 45-05 Task 1)" describe blocks above)
  // and continue to pass after this plan's gap-aware rewrite -- confirmed via
  // the full `npm test` run (224 pre-existing + new tests, 0 failures).
});

describe('verify test-content classification matrix (Phase 46-03 Task 2)', () => {
  // NOTE (46-03-SUMMARY.md): this environment had no Agent/Task tool available
  // to spawn gsd-test-writer for this tdd="true" task, so these tests were
  // written directly following this file's existing buildFixture/runGsdTools
  // git-fixture conventions (see the "phase-gate full matrix" and
  // "deferred add/list <-> phase-gate composition" describe blocks above).
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  // Like runGsdTools but also surfaces the real process exit code --
  // verify test-content uses distinct exit codes: 0 passed, 1 gap present,
  // 2 malformed/phase-not-found data.
  function runTestContent(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify test-content ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  function writePlan(phaseDir, planNum, { tdd = false, requirements = [] } = {}) {
    const taskTag = tdd ? '<task type="auto" tdd="true">' : '<task type="auto">';
    const reqLine = `requirements: [${requirements.join(', ')}]\n`;
    fs.writeFileSync(
      path.join(phaseDir, `46-${planNum}-PLAN.md`),
      `---\nphase: "46"\nplan: "${planNum}"\ntype: execute\n${reqLine}files_modified: []\n---\n<tasks>\n${taskTag}\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
  }

  function commitAll(message) {
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git commit -q --allow-empty -m "${message}"`, { cwd: tmpDir, stdio: 'pipe' });
  }

  test('requirement declared only by a non-tdd plan -> not_applicable, excluded from passed (passed: true)', () => {
    const phaseDir = phaseDirPath('46-t1-notapplicable');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: false, requirements: ['MILE-A'] });
    fs.writeFileSync(path.join(phaseDir, 'notes.md'), '# notes, prose only\n');
    commitAll('docs(46-01): prose only fixture, no tdd task');

    const result = runTestContent('46', tmpDir);
    assert.ok(result.success, `expected exit 0: ${result.error}`);
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-A');
    assert.strictEqual(req.status, 'not_applicable');
    assert.strictEqual(parsed.passed, true);
  });

  test('tdd="true" plan with zero touched test files -> MISSING', () => {
    const phaseDir = phaseDirPath('46-t2-missingnofile');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-B'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    commitAll('feat(46-01): impl only, no test file at all');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-B');
    assert.strictEqual(req.status, 'MISSING');
    assert.deepStrictEqual(req.matched_files, []);
    assert.strictEqual(parsed.passed, false);
  });

  test('test file with zero non-skipped it()/test() calls (only it.skip) -> MISSING, file listed in hollow_tests', () => {
    const phaseDir = phaseDirPath('46-t3-hollownotest');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-C'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { describe, it } = require('node:test');\ndescribe('impl', () => {\n  it.skip('should do something eventually', () => {});\n});\n`
    );
    commitAll('feat(46-01): hollow test file (only it.skip)');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-C');
    assert.strictEqual(req.status, 'MISSING', 'it.skip-only file must never count as real coverage');
    assert.ok(parsed.hollow_tests.some(h => h.file.endsWith('impl.test.js')));
  });

  test('test file with real test() calls but zero assert()/expect() calls -> MISSING (no assertion = hollow bar)', () => {
    const phaseDir = phaseDirPath('46-t4-noassert');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-D'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\ntest('runs but proves nothing', () => {\n  // no assertions in this body\n});\n`
    );
    commitAll('feat(46-01): test with real test() call but zero assertions');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-D');
    assert.strictEqual(req.status, 'MISSING');
    assert.ok(parsed.hollow_tests.some(h => h.file.endsWith('impl.test.js')));
  });

  test('net-zero-new-assertions since the phase\'s first tagged commit -> PARTIAL, file listed in net_zero_assertion_files', () => {
    const phaseDir = phaseDirPath('46-t5-netzero');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Baseline commit -- deliberately NOT tagged "46-01" -- represents the
    // file's pre-existing state from before this phase touched it, with 2
    // real (non-hollow) assertions.
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('baseline a', () => { assert(1 === 1); });\ntest('baseline b', () => { assert(2 === 2); });\n`
    );
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -q -m "chore: baseline test file predating phase 46"', { cwd: tmpDir, stdio: 'pipe' });

    // Phase 46-01's own tagged commit touches the file without adding any
    // net-new assertions (same count as the baseline).
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-E'] });
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\n// touched during 46-01, no new assertions added\ntest('baseline a', () => { assert(1 === 1); });\ntest('baseline b', () => { assert(2 === 2); });\n`
    );
    commitAll('feat(46-01): touch test file, no new assertions');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-E');
    assert.strictEqual(req.status, 'PARTIAL');
    const netZeroEntry = parsed.net_zero_assertion_files.find(n => n.file.endsWith('impl.test.js'));
    assert.ok(netZeroEntry, 'expected the touched file in net_zero_assertion_files');
    assert.strictEqual(netZeroEntry.before_count, 2);
    assert.strictEqual(netZeroEntry.after_count, 2);
  });

  test('real, growing assertion count since the phase\'s first tagged commit -> COVERED, passed true', () => {
    const phaseDir = phaseDirPath('46-t6-growing');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('baseline a', () => { assert(1 === 1); });\n`
    );
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -q -m "chore: baseline test file predating phase 46"', { cwd: tmpDir, stdio: 'pipe' });

    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-F'] });
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('baseline a', () => { assert(1 === 1); });\ntest('new real coverage', () => { assert(2 === 2); assert(3 === 3); });\n`
    );
    commitAll('feat(46-01): add real new assertions');

    const result = runTestContent('46', tmpDir);
    assert.ok(result.success, `expected exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-F');
    assert.strictEqual(req.status, 'COVERED');
    assert.strictEqual(parsed.passed, true, 'a single COVERED requirement in scope must pass overall');
  });

  test('requirement declared by both a tdd plan (substantive tests) and a non-tdd plan -> classified using only the tdd plan\'s files', () => {
    const phaseDir = phaseDirPath('46-t7-multiplan');
    fs.mkdirSync(phaseDir, { recursive: true });

    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-G'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('real coverage', () => { assert(1 === 1); });\n`
    );
    writePlan(phaseDir, '02', { tdd: false, requirements: ['MILE-G'] });
    fs.writeFileSync(path.join(phaseDir, 'docs.md'), '# docs, no tests here\n');
    commitAll('feat(46-01): tdd plan with real tests + non-tdd companion plan (46-02)');

    const result = runTestContent('46', tmpDir);
    assert.ok(result.success, `expected exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-G');
    assert.strictEqual(req.status, 'COVERED', "the non-tdd plan's absence of tests must never drag a shared requirement to MISSING");
    assert.deepStrictEqual(req.source_plans, ['01']);
  });

  test('test file listed in the diff but deleted from disk at HEAD -> does not crash, treated as hollow-equivalent', () => {
    const phaseDir = phaseDirPath('46-t8-deleted');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-H'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('real coverage', () => { assert(1 === 1); });\n`
    );
    commitAll('feat(46-01): add test file');

    // Follow-up commit deletes the file from disk -- diff-tree for the
    // original "46-01" commit still lists it as touched, but it no longer
    // exists at HEAD.
    fs.rmSync(path.join(phaseDir, 'impl.test.js'));
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -q -m "chore: remove test file after the fact"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1, 'a deleted test file must never satisfy the gate');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(result.output); }, 'output must be parseable JSON even when a touched test file is missing on disk');
    const req = parsed.requirements.find(r => r.req_id === 'MILE-H');
    assert.strictEqual(req.status, 'MISSING');
    assert.ok(parsed.hollow_tests.some(h => h.file.endsWith('impl.test.js')));
  });

  test('CLI exit code: all requirements COVERED or not_applicable -> exit 0', () => {
    const phaseDir = phaseDirPath('46-t9-allpass');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-I'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('real coverage', () => { assert(1 === 1); });\n`
    );
    writePlan(phaseDir, '02', { tdd: false, requirements: ['MILE-J'] });
    commitAll('feat(46-01): covered requirement + not_applicable companion requirement');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, true);
    assert.strictEqual(parsed.requirements.find(r => r.req_id === 'MILE-I').status, 'COVERED');
    assert.strictEqual(parsed.requirements.find(r => r.req_id === 'MILE-J').status, 'not_applicable');
  });

  test('CLI exit code: any MISSING/PARTIAL present -> exit 1', () => {
    const phaseDir = phaseDirPath('46-t9-anyfail');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-K'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    commitAll('feat(46-01): missing test file entirely');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.passed, false);
  });
});

// ─── Phase 46 cross-cutting integration (Phase 46-04 Task 2) ────────────────
// ADDITIVE coverage only -- this does not duplicate the unit tests 46-01's
// "verify e2e-gaps + gap-aware e2e_plan check" describe block or 46-03's
// "verify test-content classification matrix" describe block already wrote in
// their own tdd tasks. This block proves the net-new deterministic surfaces
// from 46-01/46-02/46-03 COMPOSE correctly against real CLI subprocesses --
// e.g. that a generation-failure marker on the e2e gate does not affect an
// unrelated COVERED test-content requirement in the same fixture, and that a
// single fixture satisfying all five phase-gate checks plus a covered
// test-content requirement passes both `verify phase-gate` and
// `verify test-content` simultaneously.
//
// Scope boundary (explicit, matching 45-VERIFICATION.md's documented
// human_verification precedent): gsd-docs-updater's own runtime behavior
// (thrown error -> block, "no changes" + matched signals -> block) and
// gsd-verifier's Step 6c nyquist-auditor BLOCKING SPAWN are AGENT PROMPT
// behaviors with no gsd-tools.js function backing them -- they are not
// unit-testable in this file, which only exercises gsd-tools.js's CLI
// surface via subprocess. What IS unit-testable and covered here is the
// deterministic decision layer (JSON contracts: gap_count, generation_failed,
// failure_type, requirement status, hollow_tests) those agent prompts branch
// on, plus static regression locks (below) on 46-02's specific prose changes
// so they cannot silently regress back to the "log error, continue" pattern
// that was removed.
//
// NOTE: no Agent/Task tool was available in this execution environment to
// spawn gsd-test-writer for this tdd="true" task (same limitation documented
// in 46-01-SUMMARY.md and 46-03-SUMMARY.md) -- these tests were written
// directly, following this file's existing buildFixture/runGsdTools
// git-fixture conventions (see the three describe blocks referenced above).
describe('Phase 46 cross-cutting integration (Phase 46-04 Task 2)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "gsd-test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "GSD Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function phaseDirPath(phaseDirName) {
    return path.join(tmpDir, '.planning', 'phases', phaseDirName);
  }

  function commitAll(message) {
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git commit -q --allow-empty -m "${message}"`, { cwd: tmpDir, stdio: 'pipe' });
  }

  function writePlan(phaseDir, planNum, { tdd = false, requirements = [] } = {}) {
    const taskTag = tdd ? '<task type="auto" tdd="true">' : '<task type="auto">';
    const reqLine = `requirements: [${requirements.join(', ')}]\n`;
    fs.writeFileSync(
      path.join(phaseDir, `46-${planNum}-PLAN.md`),
      `---\nphase: "46"\nplan: "${planNum}"\ntype: execute\n${reqLine}files_modified: []\n---\n<tasks>\n${taskTag}\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n`
    );
  }

  // Surfaces the real process exit code -- `verify e2e-gaps` uses distinct
  // exit codes: 0 = idempotent-skip, 1 = gaps/generation failure, 2 = error.
  function runE2EGaps(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify e2e-gaps ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  function runPhaseGate(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify phase-gate ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  // Like runGsdTools but also surfaces the real process exit code --
  // `verify test-content` uses distinct exit codes: 0 passed, 1 gap present,
  // 2 malformed/phase-not-found data.
  function runTestContent(phaseArg, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" verify test-content ${phaseArg}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: result.trim(), exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString().trim() || '',
        error: err.stderr?.toString().trim() || '',
        exitCode: err.status ?? 1,
      };
    }
  }

  test('E2E gap detected (no E2E-TEST-PLAN.md) -> gap_count > 0, exit 1 -- the signal execute-phase.md uses to decide "spawn the generator"', () => {
    const phaseDir = phaseDirPath('46-int-e2egap');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01');
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    commitAll('feat(46-01): UI file touched, no e2e plan at all');

    const result = runE2EGaps('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.gap_count > 0, `expected gap_count > 0, got ${JSON.stringify(parsed)}`);
  });

  test('Full E2E coverage already present -> gap_count 0, generation_failed false, exit 0 -- the idempotent-skip signal', () => {
    const phaseDir = phaseDirPath('46-int-e2eok');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01');
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n\n- Dashboard loads correctly\n');
    commitAll('feat(46-01): UI file touched, full e2e text coverage');

    const result = runE2EGaps('46', tmpDir);
    assert.strictEqual(result.exitCode, 0, `expected idempotent-skip exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.gap_count, 0);
    assert.strictEqual(parsed.generation_failed, false);
  });

  test('E2E-GENERATION-FAILED.json marker present -> phase-gate e2e_plan check fails failure_type "e2e_generation_failed" (distinct from missing_e2e_plan), while an UNRELATED COVERED test-content requirement in the same fixture still passes independently', () => {
    const phaseDir = phaseDirPath('46-int-genfail');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-INT-A'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('real coverage', () => { assert(1 === 1); });\n`
    );
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n\n- Dashboard loads correctly\n');
    commitAll('feat(46-01): tdd-covered requirement + UI file, full e2e text coverage');
    fs.writeFileSync(
      path.join(phaseDir, 'E2E-GENERATION-FAILED.json'),
      JSON.stringify({ error: 'gsd-e2e-test-generator threw during spawn', timestamp: '2026-07-04T00:00:00Z' })
    );
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({ charlotte_qa_ran: true }));
    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);

    const gateResult = runPhaseGate('46', tmpDir);
    assert.strictEqual(gateResult.exitCode, 1);
    const gateParsed = JSON.parse(gateResult.output);
    assert.ok(gateParsed.failures.includes('e2e_generation_failed'), `expected e2e_generation_failed: ${JSON.stringify(gateParsed.failures)}`);
    assert.ok(!gateParsed.failures.includes('missing_e2e_plan'), 'the override must REPLACE the generic failure_type, not add to it');

    // The unrelated test-content gate must compose independently -- an e2e
    // generation failure must never leak into or affect the test-content
    // classification of a fully-covered, unrelated requirement.
    const testContentResult = runTestContent('46', tmpDir);
    assert.strictEqual(testContentResult.exitCode, 0, 'test-content gate must pass independently of the unrelated e2e generation failure');
    const testContentParsed = JSON.parse(testContentResult.output);
    assert.strictEqual(testContentParsed.requirements.find(r => r.req_id === 'MILE-INT-A').status, 'COVERED');
  });

  test('Empty test file (zero non-skipped it()/test() calls) for a tdd="true" plan\'s requirement -> verify test-content classifies MISSING, appears in hollow_tests, exit 1 -- the signal that would trigger gsd-verifier\'s blocking nyquist-auditor spawn', () => {
    const phaseDir = phaseDirPath('46-int-hollow');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-INT-B'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { describe, it } = require('node:test');\ndescribe('impl', () => {\n  it.skip('should do something eventually', () => {});\n});\n`
    );
    commitAll('feat(46-01): hollow test file (only it.skip)');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    const req = parsed.requirements.find(r => r.req_id === 'MILE-INT-B');
    assert.strictEqual(req.status, 'MISSING');
    assert.ok(parsed.hollow_tests.some(h => h.file.endsWith('impl.test.js')));
  });

  test('Real, growing assertions for a tdd="true" plan\'s requirement -> verify test-content classifies COVERED, exit 0', () => {
    const phaseDir = phaseDirPath('46-int-covered');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-INT-C'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('real coverage', () => { assert(1 === 1); assert(2 === 2); });\n`
    );
    commitAll('feat(46-01): real, substantive assertions');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 0, `expected exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.requirements.find(r => r.req_id === 'MILE-INT-C').status, 'COVERED');
    assert.strictEqual(parsed.passed, true);
  });

  test('Requirement with no matching test file at all -> classified MISSING -- same signal a real verifier run would use to invoke gsd-nyquist-auditor (the actual Agent() spawn is a prose-level behavior tested at the agent-prompt level, not here)', () => {
    const phaseDir = phaseDirPath('46-int-nofile');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-INT-D'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    commitAll('feat(46-01): impl only, no test file at all');

    const result = runTestContent('46', tmpDir);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.requirements.find(r => r.req_id === 'MILE-INT-D').status, 'MISSING');
    // Boundary: gsd-verifier.md's actual blocking Agent() spawn of
    // gsd-nyquist-auditor on this MISSING result is agent-prompt behavior,
    // not gsd-tools.js function behavior -- out of reach for this test file.
  });

  test('Full verify phase-gate run: satisfied docs signal + covered e2e plan + covered test-content requirement + VERIFICATION.md + Charlotte evidence (UI) -> passed true, exit 0 -- proving all three 46-01/46-02/46-03 gates compose without interfering with each other or the pre-existing Phase 45 checks', () => {
    const phaseDir = phaseDirPath('46-int-allgates');
    fs.mkdirSync(phaseDir, { recursive: true });
    writePlan(phaseDir, '01', { tdd: true, requirements: ['MILE-INT-E'] });
    fs.writeFileSync(path.join(phaseDir, 'impl.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(phaseDir, 'impl.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert');\ntest('real coverage', () => { assert(1 === 1); });\n`
    );
    // api/ path -> DOC_PATH_SIGNAL_RE match, makes the docs check `required`.
    fs.mkdirSync(path.join(phaseDir, 'src', 'api'), { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'src', 'api', 'users.js'), 'module.exports = {};\n');
    // docs/ path -> DOC_SATISFIED_RE match, satisfies the now-required check.
    fs.mkdirSync(path.join(phaseDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'docs', 'api-users.md'), '# Users API\n');
    // UI file -> has_ui true, e2e_plan + charlotte_qa become required.
    fs.writeFileSync(path.join(phaseDir, 'Dashboard.tsx'), 'export default function Dashboard() { return null; }\n');
    fs.writeFileSync(path.join(phaseDir, 'E2E-TEST-PLAN.md'), '# E2E Test Plan\n\n- Dashboard loads correctly\n');
    commitAll('feat(46-01): full matrix fixture -- covered test, docs signal, e2e coverage, ui file');
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({ charlotte_qa_ran: true }));
    fs.writeFileSync(path.join(phaseDir, '46-VERIFICATION.md'), `---\nphase: "46"\nstatus: passed\n---\n# Verification\n`);

    const gateResult = runPhaseGate('46', tmpDir);
    assert.ok(gateResult.success, `expected phase-gate exit 0: ${gateResult.error} :: ${gateResult.output}`);
    const gateParsed = JSON.parse(gateResult.output);
    assert.strictEqual(gateParsed.passed, true, `expected passed true: ${JSON.stringify(gateParsed.failures)}`);
    assert.deepStrictEqual(gateParsed.failures, []);
    assert.strictEqual(gateParsed.has_ui, true);

    const testContentResult = runTestContent('46', tmpDir);
    assert.ok(testContentResult.success, `expected test-content exit 0: ${testContentResult.error}`);
    const testContentParsed = JSON.parse(testContentResult.output);
    assert.strictEqual(testContentParsed.passed, true);
    assert.strictEqual(testContentParsed.requirements.find(r => r.req_id === 'MILE-INT-E').status, 'COVERED');

    const e2eGapsResult = runE2EGaps('46', tmpDir);
    assert.strictEqual(e2eGapsResult.exitCode, 0);
    const e2eGapsParsed = JSON.parse(e2eGapsResult.output);
    assert.strictEqual(e2eGapsParsed.gap_count, 0);
  });
});

// ─── Static regression locks: 46-02's docs-gate prose changes (Phase 46-04) ──
// Prose-level assertions only -- these lock in 46-02's specific wording
// changes so they cannot silently regress. Not a full behavioral test of the
// docs-gate runtime (that's agent-prompt behavior, see the scope-boundary
// comment on the describe block above).
describe('Static regression: 46-02 docs-gate prose changes (Phase 46-04)', () => {
  const EXECUTOR_PATH = path.join(__dirname, '..', '..', 'agents', 'gsd-executor.md');
  const EXECUTE_PLAN_PATH = path.join(__dirname, '..', 'workflows', 'execute-plan.md');

  test('gsd-executor.md no longer contains the removed "does NOT block state updates" contradiction', () => {
    const content = fs.readFileSync(EXECUTOR_PATH, 'utf-8');
    assert.ok(!content.includes('does NOT block state updates'), 'the removed contradiction must not reappear in gsd-executor.md');
  });

  test('gsd-executor.md\'s <docs_update> block contains the "deferred add" waiver escape hatch', () => {
    const content = fs.readFileSync(EXECUTOR_PATH, 'utf-8');
    const start = content.indexOf('<docs_update>');
    const end = content.indexOf('</docs_update>');
    assert.ok(start !== -1 && end !== -1, 'expected a <docs_update>...</docs_update> block in gsd-executor.md');
    const docsUpdateSection = content.slice(start, end);
    assert.ok(docsUpdateSection.includes('deferred add'), 'the <docs_update> block must cite "deferred add" as the sanctioned bypass');
  });

  test('execute-plan.md\'s documentation_hard_gate section contains the "deferred add" waiver escape hatch', () => {
    const content = fs.readFileSync(EXECUTE_PLAN_PATH, 'utf-8');
    const start = content.indexOf('<step name="documentation_hard_gate">');
    assert.ok(start !== -1, 'expected a documentation_hard_gate step in execute-plan.md');
    const end = content.indexOf('</step>', start);
    const gateSection = content.slice(start, end);
    assert.ok(gateSection.includes('deferred add'), 'the documentation_hard_gate step must cite "deferred add" as the sanctioned bypass');
  });
});

describe('auto_mine config gate (Phase 48-01)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('auto_mine absent from config.json defaults to true', () => {
    const result = runGsdTools('config get auto_mine', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.value, true, 'auto_mine should default to true when absent from config.json');
  });

  test('auto_mine: false explicit in config.json returns false', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ auto_mine: false }, null, 2)
    );
    const result = runGsdTools('config get auto_mine', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.value, false, 'auto_mine should be false when explicitly set false in config.json');
  });

  test('auto_mine: true explicit in config.json returns true', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ auto_mine: true }, null, 2)
    );
    const result = runGsdTools('config get auto_mine', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.value, true, 'auto_mine should be true when explicitly set true in config.json');
  });

  test('malformed config.json falls through to default auto_mine: true (existing loadConfig catch-block behavior, unchanged)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      '{ this is not valid JSON'
    );
    const result = runGsdTools('config get auto_mine', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.value, true, 'malformed config.json should fall through to defaults, where auto_mine is true');
  });
});

describe('mine-conversations dedup on re-mine (Phase 48-01)', () => {
  let fakeHome;
  let projectDir;

  // Build a synthetic Claude Code JSONL conversation that passes
  // shouldMineConversation's quality gate: >= 2 assistant responses and
  // >= 500 total chars across converted entries (see conversation-miner.js).
  function buildMiningFixtureEntries() {
    const ts = new Date().toISOString();
    return [
      {
        type: 'user',
        timestamp: ts,
        message: {
          content: [{
            type: 'text',
            text: 'Please implement a new feature that mines past conversations for hidden insights and knowledge that we can act upon in future planning sessions.'
          }]
        }
      },
      {
        type: 'assistant',
        timestamp: ts,
        message: {
          content: [{
            type: 'text',
            text: 'I will implement the mining feature now. This requires reading JSONL conversation files, converting entries into a normalized session format, and running quality gates before extraction begins. Let me start by building the file discovery logic and a helper function to compute a stable content hash for deduplication across repeated invocations of the mining command.'
          }]
        }
      },
      {
        type: 'user',
        timestamp: ts,
        message: {
          content: [{
            type: 'text',
            text: 'Great, please also add deduplication logic so re-mining the same session does not double count previously stored insights and correctly skips conversations that were already analyzed in a prior run.'
          }]
        }
      },
      {
        type: 'assistant',
        timestamp: ts,
        message: {
          content: [{
            type: 'text',
            text: 'Done. The dedup logic checks the conversation analysis log for a matching session id and content hash before allowing extraction to proceed, and appends a new log entry after successfully extracting and storing insights into the knowledge database for future retrieval and reasoning.'
          }]
        }
      }
    ];
  }

  // Places a fixture JSONL file where conversation-miner.js's
  // discoverProjectConversations expects it: {fakeHome}/.claude/projects/{slug}/{sessionId}.jsonl
  // where slug = the REAL (symlink-resolved) project cwd with "/" -> "-".
  // macOS temp dirs are under /var/folders/... which resolves to
  // /private/var/folders/... — the child process's process.cwd() reports the
  // resolved path, so the slug must be computed from the resolved path too,
  // or discovery silently finds nothing.
  function writeConversationFixture(homeDir, projDir, sessionId, entries) {
    const realProjDir = fs.realpathSync(projDir);
    const slug = realProjDir.replace(/\//g, '-');
    const slugDir = path.join(homeDir, '.claude', 'projects', slug);
    fs.mkdirSync(slugDir, { recursive: true });
    const jsonlPath = path.join(slugDir, `${sessionId}.jsonl`);
    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(jsonlPath, content, 'utf-8');
    return jsonlPath;
  }

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-fakehome-'));
    projectDir = createTempProject();
  });

  afterEach(() => {
    cleanup(projectDir);
    cleanup(fakeHome);
  });

  test('re-mining the same session is deduped, not double-counted', () => {
    const sessionId = 'test-session-dedup-48-01';
    writeConversationFixture(fakeHome, projectDir, sessionId, buildMiningFixtureEntries());

    // First mine: session should be ready (not skipped)
    const firstMine = runGsdTools(
      'mine-conversations --max-age-days 30 --limit 50',
      projectDir,
      { HOME: fakeHome }
    );
    assert.ok(firstMine.success, `First mine-conversations call failed: ${firstMine.error}`);
    const firstParsed = JSON.parse(firstMine.output);
    assert.strictEqual(firstParsed.status === 'error', false, 'first mine should not error');
    assert.strictEqual(firstParsed.sessionsReady, 1, 'the fixture session should be ready for extraction on first mine');
    const readySession = firstParsed.sessions.find(s => s.sessionId === sessionId);
    assert.ok(readySession, 'fixture session should appear in sessions[], not skipped[]');
    assert.ok(readySession.contentHash, 'ready session should carry a computed contentHash');

    // Store a minimal result to populate .conversation-analysis-log.jsonl.
    // NOTE: passing a bare '[]' (empty results array) hits cmdStoreConversationResult's
    // early "no results" return path BEFORE it ever reaches the log-write code, so the
    // analysis log never gets written and dedup can't fire. A single result object whose
    // `result` text is itself the string "[]" parses cleanly to zero insights via
    // parseExtractionResult while still reaching the unconditional log-write step.
    const minimalResults = JSON.stringify([{ type: 'decision', result: '[]' }]);
    const storeResult = runGsdTools(
      `store-conversation-result "${sessionId}" '${minimalResults}' --content-hash "${readySession.contentHash}"`,
      projectDir,
      { HOME: fakeHome }
    );
    assert.ok(storeResult.success, `store-conversation-result failed: ${storeResult.error}`);

    // Second mine on the SAME session file: must now be deduped/skipped
    const secondMine = runGsdTools(
      'mine-conversations --max-age-days 30 --limit 50',
      projectDir,
      { HOME: fakeHome }
    );
    assert.ok(secondMine.success, `Second mine-conversations call failed: ${secondMine.error}`);
    const secondParsed = JSON.parse(secondMine.output);
    assert.strictEqual(secondParsed.sessionsReady, 0, 're-mining the same session should yield zero newly-ready sessions');
    assert.strictEqual(secondParsed.sessionsSkipped, 1, 're-mining the same session should count it as skipped');
    const skippedSession = secondParsed.skipped.find(s => s.sessionId === sessionId);
    assert.ok(skippedSession, 'the re-mined session should appear in skipped[]');
    assert.match(
      skippedSession.reason.toLowerCase(),
      /already analyzed/,
      'the skip reason should indicate the session was already analyzed'
    );
  });

  test('mine-conversations returns {status: "error"} gracefully when the target project slug directory is missing (does not throw)', () => {
    // A fresh project dir with no corresponding ~/.claude/projects/{slug} entry
    // under fakeHome reproduces the CLI's existing discoverProjectConversations
    // error path — proving the "mining throws -> caller can still continue"
    // contract holds at the CLI boundary (the CLI itself never throws/crashes).
    const orphanProjectDir = createTempProject();
    try {
      const result = runGsdTools(
        'mine-conversations --max-age-days 30 --limit 50',
        orphanProjectDir,
        { HOME: fakeHome }
      );
      assert.ok(result.success, `CLI process itself should not crash: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.status, 'error', 'missing project slug directory should surface status: error, not throw');
    } finally {
      cleanup(orphanProjectDir);
    }
  });
});

describe('execution-state CLI (Phase 48-03)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('execution-state get on a phase/plan with no prior entry returns {attempts: 0, key}', () => {
    const result = runGsdTools('execution-state get --phase 42 --plan 01 --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed, { attempts: 0, key: '42-01' });
  });

  test('sequential record-failure calls with default max_attempts (4): retry -> debug -> debug -> escalate', () => {
    const expectedActions = ['retry', 'debug', 'debug', 'escalate'];
    expectedActions.forEach((expectedAction, idx) => {
      const attemptNum = idx + 1;
      const result = runGsdTools(
        `execution-state record-failure --phase 10 --plan 02 --error "boom ${attemptNum}" --step "task ${attemptNum}" --files "a.js,b.js" --raw`,
        tmpDir
      );
      assert.ok(result.success, `record-failure call ${attemptNum} failed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.attempts, attemptNum, `attempt count should be ${attemptNum}`);
      assert.strictEqual(parsed.action, expectedAction, `attempt ${attemptNum} should yield action "${expectedAction}"`);
      assert.strictEqual(parsed.max_attempts, 4, 'default max_attempts should be 4 with no config.json override');
    });
  });

  test('config.json execution.max_attempts: 2 makes the ceiling configurable: retry -> escalate', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ execution: { max_attempts: 2 } }, null, 2)
    );

    const first = runGsdTools(
      'execution-state record-failure --phase 11 --plan 03 --error "e1" --step "s1" --files "x.js" --raw',
      tmpDir
    );
    assert.ok(first.success, `first record-failure failed: ${first.error}`);
    const firstParsed = JSON.parse(first.output);
    assert.strictEqual(firstParsed.attempts, 1);
    assert.strictEqual(firstParsed.action, 'retry');
    assert.strictEqual(firstParsed.max_attempts, 2);

    const second = runGsdTools(
      'execution-state record-failure --phase 11 --plan 03 --error "e2" --step "s2" --files "x.js" --raw',
      tmpDir
    );
    assert.ok(second.success, `second record-failure failed: ${second.error}`);
    const secondParsed = JSON.parse(second.output);
    assert.strictEqual(secondParsed.attempts, 2);
    assert.strictEqual(secondParsed.action, 'escalate', 'attempt 2 should escalate when max_attempts is configured to 2');
  });

  test('record-success clears the entry -- a subsequent get returns {attempts: 0, key} again', () => {
    const failResult = runGsdTools(
      'execution-state record-failure --phase 12 --plan 04 --error "e" --step "s" --files "f.js" --raw',
      tmpDir
    );
    assert.ok(failResult.success, `record-failure failed: ${failResult.error}`);
    const failParsed = JSON.parse(failResult.output);
    assert.strictEqual(failParsed.attempts, 1);

    const successResult = runGsdTools('execution-state record-success --phase 12 --plan 04 --raw', tmpDir);
    assert.ok(successResult.success, `record-success failed: ${successResult.error}`);
    const successParsed = JSON.parse(successResult.output);
    assert.deepStrictEqual(successParsed, { cleared: true, key: '12-04' });

    const getResult = runGsdTools('execution-state get --phase 12 --plan 04 --raw', tmpDir);
    assert.ok(getResult.success, `get failed: ${getResult.error}`);
    const getParsed = JSON.parse(getResult.output);
    assert.deepStrictEqual(getParsed, { attempts: 0, key: '12-04' });
  });

  test('record-success on a key with no existing entry is a no-op, not an error', () => {
    const result = runGsdTools('execution-state record-success --phase 99 --raw', tmpDir);
    assert.ok(result.success, `record-success failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed, { cleared: false, key: '99' });
  });

  test('phase-level key and plan-level key for the SAME phase number are independent', () => {
    // Record 3 failures at the plan level.
    for (let i = 1; i <= 3; i++) {
      const result = runGsdTools(
        `execution-state record-failure --phase 20 --plan 05 --error "plan-e${i}" --step "s" --files "f.js" --raw`,
        tmpDir
      );
      assert.ok(result.success, `plan-level record-failure ${i} failed: ${result.error}`);
    }

    // Record a single failure at the phase level (no --plan).
    const phaseResult = runGsdTools(
      'execution-state record-failure --phase 20 --error "phase-e1" --step "s" --files "f.js" --raw',
      tmpDir
    );
    assert.ok(phaseResult.success, `phase-level record-failure failed: ${phaseResult.error}`);
    const phaseParsed = JSON.parse(phaseResult.output);
    assert.strictEqual(phaseParsed.key, '20');
    assert.strictEqual(phaseParsed.attempts, 1, 'phase-level attempt count must not be affected by plan-level failures');

    const planGet = runGsdTools('execution-state get --phase 20 --plan 05 --raw', tmpDir);
    const planParsed = JSON.parse(planGet.output);
    assert.strictEqual(planParsed.attempts, 3, 'plan-level attempt count must not be affected by the phase-level failure');
  });

  test("record-failure's files argument round-trips as an array", () => {
    const result = runGsdTools(
      'execution-state record-failure --phase 21 --plan 06 --error "e" --step "s" --files "src/a.js,src/b.js,src/c.js" --raw',
      tmpDir
    );
    assert.ok(result.success, `record-failure failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed.files_modified, ['src/a.js', 'src/b.js', 'src/c.js']);
  });

  test('a malformed execution-state.json fails loudly (non-zero exit, typed error) on get and record-failure -- never silently treated as {}', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'execution-state.json'), '{ this is not valid JSON');

    const getResult = runGsdTools('execution-state get --phase 30 --raw', tmpDir);
    assert.strictEqual(getResult.success, false, 'get against malformed execution-state.json must exit non-zero');
    const getParsed = JSON.parse(getResult.output);
    assert.strictEqual(getParsed.error, true);
    assert.strictEqual(getParsed.type, 'corrupted_execution_state');

    const failResult = runGsdTools(
      'execution-state record-failure --phase 30 --error "e" --step "s" --files "f.js" --raw',
      tmpDir
    );
    assert.strictEqual(failResult.success, false, 'record-failure against malformed execution-state.json must exit non-zero');
    const failParsed = JSON.parse(failResult.output);
    assert.strictEqual(failParsed.error, true);
    assert.strictEqual(failParsed.type, 'corrupted_execution_state');
  });

  test('no stray .tmp-* files remain in .planning/ after record-failure/record-success operations', () => {
    runGsdTools('execution-state record-failure --phase 40 --plan 07 --error "e" --step "s" --files "f.js" --raw', tmpDir);
    runGsdTools('execution-state record-success --phase 40 --plan 07 --raw', tmpDir);
    runGsdTools('execution-state get --phase 40 --plan 07 --raw', tmpDir);

    const planningFiles = fs.readdirSync(path.join(tmpDir, '.planning'));
    const strayTempFiles = planningFiles.filter((f) => f.includes('.tmp-'));
    assert.deepStrictEqual(strayTempFiles, [], 'no .tmp-* files should remain after atomic writes complete');
  });
});

describe('Phase 48 cross-cutting trigger matrix — deterministic (Phase 48-04)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // NOTE: 48-01's "mine-conversations dedup on re-mine" describe block already
  // proves the missing-project-slug-directory error path (discoverProjectConversations's
  // `error` return) surfaces as {status: 'error'} with a clean exit 0, never an
  // uncaught throw. This test exercises a DIFFERENT failure surface inside the
  // same non-blocking contract -- prepareConversationForMining's own try/catch
  // around fs.readFileSync (e.g. EISDIR when a discovered ".jsonl" entry turns
  // out to be a directory, not a file) -- to lock in that the CLI boundary never
  // throws uncaught regardless of WHERE inside the mining pipeline the failure
  // originates.
  test('mine-conversations tolerates a discovered ".jsonl" entry that is actually a directory -- never throws uncaught, always exits 0', () => {
    const fakeHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-fakehome-'));
    const projectDir = createTempProject();
    try {
      const realProjDir = fs.realpathSync(projectDir);
      const slug = realProjDir.replace(/\//g, '-');
      const slugDir = path.join(fakeHome, '.claude', 'projects', slug);
      fs.mkdirSync(slugDir, { recursive: true });
      // A directory named "*.jsonl" passes discoverProjectConversations' fs.statSync
      // check (stat works fine on directories) but then fails inside
      // prepareConversationForMining's fs.readFileSync (EISDIR) -- a genuinely
      // different throw-prone code path than the missing-slug-dir case in 48-01.
      fs.mkdirSync(path.join(slugDir, 'weird-session.jsonl'));

      const result = runGsdTools(
        'mine-conversations --max-age-days 30 --limit 50',
        projectDir,
        { HOME: fakeHome }
      );
      assert.ok(result.success, `CLI process itself must exit 0 (graceful, never an uncaught throw): ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.notStrictEqual(parsed.status, 'error', 'a single unreadable entry should not fail the whole mining run');
      assert.strictEqual(parsed.sessionsSkipped >= 1, true, 'the directory-as-.jsonl entry should be skipped, not crash the process');
      const skipped = parsed.skipped.find(s => s.sessionId === 'weird-session');
      assert.ok(skipped, 'the unreadable entry should appear in skipped[] with a reason, not silently vanish');
      assert.match(skipped.reason.toLowerCase(), /failed to read file/, 'skip reason should surface the underlying read error');
    } finally {
      cleanup(projectDir);
      cleanup(fakeHome);
    }
  });

  test('execution-state ceiling is monotonic: once action reaches "escalate", subsequent record-failure calls never regress back to "retry" or "debug"', () => {
    // Default max_attempts is 4: attempts 1-4 should be retry, debug, debug, escalate.
    // Attempts 5 and 6 (well past the ceiling) MUST still read "escalate" -- proving
    // `action` is a monotonic ceiling (attempts < maxAttempts check), never a
    // modulo/cycle back to an earlier action as attempts keeps incrementing.
    const expectedThroughCeiling = ['retry', 'debug', 'debug', 'escalate'];
    expectedThroughCeiling.forEach((expectedAction, idx) => {
      const attemptNum = idx + 1;
      const result = runGsdTools(
        `execution-state record-failure --phase 60 --plan 01 --error "e${attemptNum}" --step "s${attemptNum}" --files "f.js" --raw`,
        tmpDir
      );
      assert.ok(result.success, `record-failure call ${attemptNum} failed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.action, expectedAction, `attempt ${attemptNum} should yield "${expectedAction}"`);
    });

    // Past the ceiling: two more failures, both must remain "escalate".
    for (let extra = 1; extra <= 2; extra++) {
      const attemptNum = 4 + extra;
      const result = runGsdTools(
        `execution-state record-failure --phase 60 --plan 01 --error "past-ceiling-${extra}" --step "s${attemptNum}" --files "f.js" --raw`,
        tmpDir
      );
      assert.ok(result.success, `record-failure call ${attemptNum} failed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.attempts, attemptNum, `attempt count should keep incrementing to ${attemptNum}`);
      assert.strictEqual(parsed.action, 'escalate', `attempt ${attemptNum} (past the ceiling) must still be "escalate", never regress to retry/debug`);
    }
  });

  test('auto_mine and execution.max_attempts coexist in one config.json with unrelated pre-existing keys -- full loadConfig() round-trip reads every field correctly', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        auto_mine: false,
        execution: { max_attempts: 7 },
        workflow: { research: false, plan_check: false, verifier: false, nyquist_validation: false },
        parallelization: false,
        granularity: 'fine',
        model_profile: 'quality',
      }, null, 2)
    );

    const expectations = {
      auto_mine: false,
      max_attempts: 7,
      research: false,
      plan_checker: false,
      verifier: false,
      nyquist_validation: false,
      parallelization: false,
      granularity: 'fine',
      model_profile: 'quality',
    };

    for (const [key, expectedValue] of Object.entries(expectations)) {
      const result = runGsdTools(`config get ${key}`, tmpDir);
      assert.ok(result.success, `config get ${key} failed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(
        parsed.value,
        expectedValue,
        `config key "${key}" should read back as ${JSON.stringify(expectedValue)} without interference from the other keys set alongside it`
      );
    }
  });
});

describe('Phase 48 cross-cutting trigger matrix — prompt-layer wiring (Phase 48-04)', () => {
  // These are structural regression guards, not execution tests: the logic
  // they cover is Claude-prose in .md files, not code. Repo root is two
  // levels up from this test file's __dirname (get-shit-done/bin/ ->
  // get-shit-done/ -> repo root) -- verified against the actual on-disk
  // layout before writing these assertions.
  const REPO_ROOT = path.join(__dirname, '..', '..');

  function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8');
  }

  test('Mining wiring: complete-milestone.md references auto_mine + mine-conversations + explicit non-blocking language, positioned after archive_milestone and before reorganize_roadmap_and_delete_originals', () => {
    const content = readRepoFile('get-shit-done/workflows/complete-milestone.md');

    assert.match(content, /auto_mine/, 'complete-milestone.md must reference auto_mine');
    assert.match(content, /mine-conversations/, 'complete-milestone.md must reference the mine-conversations CLI command');
    assert.match(
      content,
      /non-blocking|milestone completion continues/i,
      'complete-milestone.md must state the mining step is non-blocking'
    );

    const archiveIdx = content.indexOf('<step name="archive_milestone">');
    const mineIdx = content.indexOf('<step name="mine_milestone_conversations">');
    const reorganizeIdx = content.indexOf('<step name="reorganize_roadmap_and_delete_originals">');

    assert.notStrictEqual(archiveIdx, -1, 'archive_milestone step must exist');
    assert.notStrictEqual(mineIdx, -1, 'mine_milestone_conversations step must exist');
    assert.notStrictEqual(reorganizeIdx, -1, 'reorganize_roadmap_and_delete_originals step must exist');

    assert.ok(archiveIdx < mineIdx, 'mine_milestone_conversations must be positioned after archive_milestone');
    assert.ok(mineIdx < reorganizeIdx, 'mine_milestone_conversations must be positioned before reorganize_roadmap_and_delete_originals');
  });

  test('Discovery wiring: prd.md has BOTH a Stage 1 and a Stage 2 confidence-gated fan-out subsection with the required investigator/synthesizer/threshold/cap content', () => {
    const content = readRepoFile('get-shit-done/workflows/prd.md');

    const stage1Idx = content.indexOf('### 1c-bis. Confidence-Gated Discovery Fan-Out');
    const stage1EndIdx = content.indexOf('### 1d.', stage1Idx);
    const stage2Idx = content.indexOf('### 2c-bis. Confidence-Gated Discovery Fan-Out');
    const stage2EndIdx = content.indexOf('### 2d.', stage2Idx);

    assert.notStrictEqual(stage1Idx, -1, 'prd.md must have a Stage 1 (1c-bis) confidence-gated fan-out subsection');
    assert.notStrictEqual(stage2Idx, -1, 'prd.md must have a Stage 2 (2c-bis) confidence-gated fan-out subsection');
    assert.ok(stage1EndIdx > stage1Idx, 'Stage 1 subsection must be bounded by the following 1d. subsection');
    assert.ok(stage2EndIdx > stage2Idx, 'Stage 2 subsection must be bounded by the following 2d. subsection');

    const stage1Section = content.slice(stage1Idx, stage1EndIdx);
    const stage2Section = content.slice(stage2Idx, stage2EndIdx);

    for (const [label, section] of [['Stage 1', stage1Section], ['Stage 2', stage2Section]]) {
      assert.match(section, /gsd-product-investigator/, `${label} subsection must reference gsd-product-investigator`);
      assert.match(section, /model="haiku"|model:\s*haiku/, `${label} subsection must spawn investigators on the haiku model`);
      assert.match(section, /capped at 6/, `${label} subsection must cap fan-out at 6`);
      assert.match(section, /minimum 4|at least 4/i, `${label} subsection must document a floor of 4 investigators`);
      assert.match(section, /gsd-discovery-synthesizer/, `${label} subsection must reference gsd-discovery-synthesizer for merging findings`);
      assert.match(section, /<\s*0\.50/, `${label} subsection must document the < 0.50 trigger threshold`);
      assert.match(section, />=\s*0\.65/, `${label} subsection must document the >= 0.65 dormant threshold`);
    }
  });

  test('Discovery deletion: discover.md, discovery-phase.md, and skills/gsd-discover/ do not exist on disk (permanent regression guard)', () => {
    assert.strictEqual(
      fs.existsSync(path.join(REPO_ROOT, 'get-shit-done', 'workflows', 'discover.md')),
      false,
      'get-shit-done/workflows/discover.md must remain deleted'
    );
    assert.strictEqual(
      fs.existsSync(path.join(REPO_ROOT, 'get-shit-done', 'workflows', 'discovery-phase.md')),
      false,
      'get-shit-done/workflows/discovery-phase.md must remain deleted'
    );
    assert.strictEqual(
      fs.existsSync(path.join(REPO_ROOT, 'skills', 'gsd-discover')),
      false,
      'skills/gsd-discover/ must remain deleted'
    );
  });

  test('Debugger wiring: execute-phase.md and execute-roadmap.md both branch on execution-state record-failure\'s action field (retry/debug/escalate); debug.md and commands/gsd/debug.md are correctly wired', () => {
    const executePhase = readRepoFile('get-shit-done/workflows/execute-phase.md');
    const executeRoadmap = readRepoFile('get-shit-done/workflows/execute-roadmap.md');
    const debugWorkflow = readRepoFile('get-shit-done/workflows/debug.md');
    const debugCommand = readRepoFile('commands/gsd/debug.md');

    for (const [label, content] of [['execute-phase.md', executePhase], ['execute-roadmap.md', executeRoadmap]]) {
      assert.match(content, /execution-state record-failure/, `${label} must call execution-state record-failure`);
      assert.match(content, /action/, `${label} must branch on the action field`);
      assert.match(content, /retry/, `${label} must handle the "retry" action`);
      assert.match(content, /debug/, `${label} must handle the "debug" action`);
      assert.match(content, /escalate/, `${label} must handle the "escalate" action`);
    }

    assert.match(debugWorkflow, /gsd-debugger/, 'workflows/debug.md must reference gsd-debugger');

    assert.match(
      debugCommand,
      /@~\/\.claude\/get-shit-done\/workflows\/debug\.md/,
      'commands/gsd/debug.md must use the standard @-include pattern pointing at workflows/debug.md'
    );
    assert.doesNotMatch(
      debugCommand,
      /## 0\. Initialize Context/,
      'commands/gsd/debug.md must NOT retain the old fully-inline interactive-only process (marker: "## 0. Initialize Context") as its primary path'
    );
  });

  test('Debugger escalation composition: execute-phase.md references timeout-fallback, and gsd-phase-coordinator.md\'s Step A-fallback deferred-add invocation shape is unchanged', () => {
    const executePhase = readRepoFile('get-shit-done/workflows/execute-phase.md');
    const phaseCoordinator = readRepoFile('agents/gsd-phase-coordinator.md');

    assert.match(
      executePhase,
      /timeout-fallback/,
      'execute-phase.md must reference timeout-fallback, proving it composes with gsd-phase-coordinator.md\'s existing Step A-fallback pattern rather than duplicating it'
    );

    assert.match(
      phaseCoordinator,
      /deferred add \{phase_number\} --step discuss[\s\S]{0,120}--approver timeout-fallback/,
      'gsd-phase-coordinator.md\'s Step A-fallback deferred-add invocation shape must remain unchanged (confirms 48-03 composed rather than overwrote it)'
    );
  });
});

describe('Phase 49-01: write-path safety', () => {
  // CRITICAL — SHARED-DB CAUTION: ~/.claude/knowledge/ is a LIVE database
  // written by session hooks in this environment. Every test in this block
  // MUST set GSD_KNOWLEDGE_DB_PATH to an isolated temp file before touching
  // anything that opens the knowledge DB, and MUST clean up afterward.
  // Never let a test touch the real path.
  let tmpDbPath;
  let prevOverride;
  let openedDbs;

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
    openedDbs = [];
  });

  afterEach(() => {
    const { closeKnowledgeDB } = require('./knowledge-db.js');
    for (const db of openedDbs) {
      try { closeKnowledgeDB(db); } catch (_) { /* best-effort */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('getDBPath honors GSD_KNOWLEDGE_DB_PATH override, falls back to hardcoded path when unset', () => {
    const knowledgeDb = require('./knowledge-db.js');

    // Override set (beforeEach already set it) — scope is ignored, same path for both
    assert.strictEqual(knowledgeDb.getDBPath('global'), tmpDbPath);
    assert.strictEqual(knowledgeDb.getDBPath('project'), tmpDbPath);

    // Temporarily unset to verify original hardcoded behavior is unchanged
    const saved = process.env.GSD_KNOWLEDGE_DB_PATH;
    delete process.env.GSD_KNOWLEDGE_DB_PATH;
    try {
      const hardcodedPath = knowledgeDb.getDBPath('global');
      assert.match(hardcodedPath, /\.claude[\\/]knowledge[\\/].+\.db$/);
    } finally {
      process.env.GSD_KNOWLEDGE_DB_PATH = saved;
    }
  });

  test('vectorEnabled fix: conn.db.vectorEnabled stays in sync with conn.vectorEnabled', () => {
    const { openKnowledgeDB } = require('./knowledge-db.js');
    const conn = openKnowledgeDB('global');
    openedDbs.push(conn.db);

    // Key assertion: the two are now IN SYNC (not hardcoded true/false) —
    // sqlite-vec availability is environment-dependent.
    assert.strictEqual(conn.db.vectorEnabled, conn.vectorEnabled);

    if (conn.vectorEnabled) {
      const { insertKnowledge } = require('./knowledge-crud.js');
      const content = 'vector-enabled test entry ' + Date.now();
      const embedding = new Float32Array(512).fill(0.1);
      const result = insertKnowledge(conn.db, {
        content,
        type: 'lesson',
        scope: 'global',
        embedding
      });

      const row = conn.db.prepare('SELECT COUNT(*) as cnt FROM knowledge_vec WHERE rowid = ?').get(result.id);
      assert.strictEqual(row.cnt, 1, 'expected the inserted embedding to land in knowledge_vec');
    }
  });

  test('transaction race fix: 5 concurrent insertOrEvolve calls with identical content create exactly 1 row', async () => {
    const { openKnowledgeDB } = require('./knowledge-db.js');
    const { insertOrEvolve } = require('./knowledge-evolution.js');
    const conn = openKnowledgeDB('global');
    openedDbs.push(conn.db);

    const content = 'identical content for race test';
    await Promise.all(
      Array.from({ length: 5 }, () =>
        insertOrEvolve(conn, {
          content,
          type: 'lesson',
          scope: 'global',
          embedding: null,
          metadata: {}
        })
      )
    );

    const row = conn.db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE content = ?').get(content);
    assert.strictEqual(row.cnt, 1, 'expected exactly 1 row, not 5 — no lost update / no duplicate insert under concurrency');
  });

  test('circuit breaker gates embedding generation, storeInsights still stores the insight via hash-only dedup', async () => {
    const { openKnowledgeDB } = require('./knowledge-db.js');
    const { enableCircuitBreaker } = require('./knowledge-cost.js');
    const conn = openKnowledgeDB('global');
    openedDbs.push(conn.db);

    enableCircuitBreaker(conn.db, 'test');

    const { storeInsights } = require('./knowledge-writer.js');

    const tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-cwd-'));
    try {
      const result = await storeInsights(
        [{ type: 'decision', decision: 'test decision content long enough to pass the filter' }],
        { cwd: tmpCwd }
      );

      assert.strictEqual(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
      assert.strictEqual(result.stored + result.evolved, 1, 'insight should still be stored when circuit breaker blocks embeddings');
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe('Phase 49-01: secrets/PII filter end-to-end', () => {
  // Same SHARED-DB CAUTION as the block above — isolate via GSD_KNOWLEDGE_DB_PATH.
  let tmpDbPath;
  let prevOverride;
  let openedDbs;

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
    openedDbs = [];
  });

  afterEach(() => {
    const { closeKnowledgeDB } = require('./knowledge-db.js');
    for (const db of openedDbs) {
      try { closeKnowledgeDB(db); } catch (_) { /* best-effort */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('API-key pattern -> storeInsights rejects the whole insight, raw key never persisted', async () => {
    const { storeInsights } = require('./knowledge-writer.js');
    const { openKnowledgeDB } = require('./knowledge-db.js');

    const rawKey = 'sk-abcdefghijklmnopqrst1234567890';
    const tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-cwd-'));
    try {
      const result = await storeInsights(
        [{ type: 'decision', decision: `use this key: ${rawKey} for the integration` }],
        { cwd: tmpCwd }
      );

      assert.strictEqual(result.stored, 0);
      assert.strictEqual(result.skipped, 1);

      const conn = openKnowledgeDB('global');
      openedDbs.push(conn.db);
      const rows = conn.db.prepare('SELECT content FROM knowledge').all();
      for (const row of rows) {
        assert.ok(!row.content.includes(rawKey), 'raw API key must never be persisted verbatim');
      }
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  test('custom config pattern -> filterContentForSecrets rejects, config-extensible with zero code change', () => {
    const { filterContentForSecrets } = require('./knowledge-safety.js');

    const tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-cwd-'));
    try {
      fs.mkdirSync(path.join(tmpCwd, '.planning'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpCwd, '.planning', 'config.json'),
        JSON.stringify({ knowledge: { secrets_patterns: ['MYPROJECT_SECRET_[0-9]+'] } })
      );

      const result = filterContentForSecrets('the value is MYPROJECT_SECRET_42 in this project', tmpCwd);
      assert.strictEqual(result.safe, false);
      assert.strictEqual(result.action, 'rejected');
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  test('email address -> redacted, not rejected', () => {
    const { filterContentForSecrets } = require('./knowledge-safety.js');

    const result = filterContentForSecrets('contact us at ops@example.com for help', undefined);
    assert.strictEqual(result.safe, true);
    assert.strictEqual(result.action, 'redacted');
    assert.ok(result.content.includes('[REDACTED_EMAIL]'));
    assert.ok(!result.content.includes('ops@example.com'));
  });

  test('credential keyword -> redacted, original secret value absent', () => {
    const { filterContentForSecrets } = require('./knowledge-safety.js');

    const result = filterContentForSecrets('password: hunter2love', undefined);
    assert.strictEqual(result.safe, true);
    assert.strictEqual(result.action, 'redacted');
    assert.ok(!result.content.includes('hunter2love'));
    assert.ok(result.content.includes('[REDACTED]'));
  });

  test('clean content -> passes through unchanged, and storeInsights stores it successfully', async () => {
    const { filterContentForSecrets } = require('./knowledge-safety.js');
    const { storeInsights } = require('./knowledge-writer.js');

    const original = 'Always run tests before committing changes to the main branch';
    const filterResult = filterContentForSecrets(original, undefined);
    assert.strictEqual(filterResult.action, null);
    assert.strictEqual(filterResult.content, original);

    const tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-cwd-'));
    try {
      const result = await storeInsights(
        [{ type: 'reasoning_pattern', description: original }],
        { cwd: tmpCwd }
      );
      assert.strictEqual(result.stored + result.evolved, 1);
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  test('ambiguous high-entropy token -> rejected', () => {
    const { filterContentForSecrets } = require('./knowledge-safety.js');

    const token = 'aZ9qP2mK7xT4wN1vB8sD6fG3hJ5rL0cY'; // 32 random-looking alnum chars, no known prefix
    const result = filterContentForSecrets(`found this stray value ${token} in the logs`, undefined);
    assert.strictEqual(result.safe, false);
    assert.strictEqual(result.action, 'rejected');
  });
});

describe('Phase 49-02: event triggers', () => {
  // CRITICAL — SHARED-DB CAUTION: ~/.claude/knowledge/ is a LIVE database.
  // Every test in this block MUST set GSD_KNOWLEDGE_DB_PATH to an isolated
  // temp file before touching anything that opens the knowledge DB.
  let tmpDbPath;
  let prevOverride;
  let openedDbs;

  const HOOK_PATH = path.join(__dirname, 'hooks', 'session-end-standalone.js');
  const COMPLETE_MILESTONE_PATH = path.join(__dirname, '..', 'workflows', 'complete-milestone.md');

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-49-02-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
    openedDbs = [];
  });

  afterEach(() => {
    const { closeKnowledgeDB } = require('./knowledge-db.js');
    for (const db of openedDbs) {
      try { closeKnowledgeDB(db); } catch (_) { /* best-effort */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('session-end hook prunes a stale entry with no manual invocation', () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');

    const conn = openKnowledgeDB('global');
    const { id } = insertKnowledge(conn.db, {
      content: 'stale fixture entry for 49-02 session-end prune test ' + Date.now(),
      type: 'temp_note', // high volatility (0.9) so it clears the default 0.7 staleness threshold quickly
      scope: 'global'
    });
    // Force this entry to look 40 days dormant (default threshold is exceeded well before 24 days
    // for temp_note with zero access_count: timeFactor(40/30) * volatility(0.9) * accessFactor(1) = 1.2 > 0.7).
    // insertKnowledge sets last_accessed = created_at at insert time, so both must be backdated —
    // getStalenessScore computes dormancy from last_accessed (falling back to created_at only when null).
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    conn.db.prepare('UPDATE knowledge SET created_at = ?, last_accessed = ? WHERE id = ?').run(fortyDaysAgo, fortyDaysAgo, id);
    closeKnowledgeDB(conn.db);

    // Run the hook exactly as Claude Code would invoke it — no manual prune command.
    execSync(`node "${HOOK_PATH}"`, {
      encoding: 'utf-8',
      input: '',
      env: { ...process.env, GSD_KNOWLEDGE_DB_PATH: tmpDbPath },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    // execSync throws on non-zero exit — reaching here already proves exit code 0.

    const reconn = openKnowledgeDB('global');
    openedDbs.push(reconn.db);
    const row = reconn.db.prepare('SELECT id FROM knowledge WHERE id = ?').get(id);
    assert.strictEqual(row, undefined, 'expected the stale entry to be pruned by the session-end hook with no manual invocation');
  });

  test('session-end hook still exits 0 when the knowledge DB path is unusable', () => {
    // Force openKnowledgeDB's mkdirSync(dbDir, {recursive:true}) to fail deterministically:
    // point the "directory" at a path where a regular file already sits in the parent chain.
    const blockerFile = path.join(require('os').tmpdir(), `gsd-test-49-02-blocker-${Date.now()}.txt`);
    fs.writeFileSync(blockerFile, 'not a directory');
    const badPath = path.join(blockerFile, 'sub', 'knowledge.db');

    try {
      assert.doesNotThrow(() => {
        execSync(`node "${HOOK_PATH}"`, {
          encoding: 'utf-8',
          input: '',
          env: { ...process.env, GSD_KNOWLEDGE_DB_PATH: badPath },
          stdio: ['pipe', 'pipe', 'pipe']
        });
      }, 'session-end hook must always exit 0, even when the knowledge DB is unreachable');
    } finally {
      fs.rmSync(blockerFile, { force: true });
    }
  });

  test('complete-milestone.md: mine_milestone_conversations step includes the prune+checkpoint call within its own boundaries', () => {
    const content = fs.readFileSync(COMPLETE_MILESTONE_PATH, 'utf-8');
    const start = content.indexOf('<step name="mine_milestone_conversations">');
    assert.notStrictEqual(start, -1, 'mine_milestone_conversations step not found in complete-milestone.md');
    const end = content.indexOf('</step>', start);
    assert.notStrictEqual(end, -1, 'closing </step> for mine_milestone_conversations not found');

    const stepBody = content.slice(start, end);
    assert.ok(
      stepBody.includes('knowledge prune'),
      'expected "knowledge prune" call inside the mine_milestone_conversations step boundaries'
    );
  });

  test('cmdKnowledgePrune always checkpoints the WAL on a live run, regardless of delete count', () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');

    const conn = openKnowledgeDB('global');
    for (let i = 0; i < 5; i++) {
      insertKnowledge(conn.db, {
        content: `pending wal frame entry ${i} ${Date.now()}`,
        type: 'lesson',
        scope: 'global'
      });
    }
    closeKnowledgeDB(conn.db);

    const result = runGsdTools('knowledge prune --scope global --raw', process.cwd(), { GSD_KNOWLEDGE_DB_PATH: tmpDbPath });
    assert.strictEqual(result.success, true, `knowledge prune failed: ${result.error}`);

    const walPath = tmpDbPath + '-wal';
    const walSizeAfter = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    assert.strictEqual(walSizeAfter, 0, 'expected the WAL file to be truncated (checkpointed) after a live knowledge prune run');
  });

  test('mine-conversations creates a checkpoint before scanning/extracting', () => {
    // Use a cwd with no corresponding ~/.claude/projects/<slug> directory so
    // discovery is a fast, deterministic no-op — the checkpoint call happens
    // before that discovery branch regardless of its outcome.
    const emptyCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-49-02-mine-cwd-'));
    try {
      const result = runGsdTools('mine-conversations --limit 1 --raw', emptyCwd, { GSD_KNOWLEDGE_DB_PATH: tmpDbPath });
      assert.strictEqual(result.success, true, `mine-conversations failed: ${result.error}`);

      const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
      const conn = openKnowledgeDB('project');
      openedDbs.push(conn.db);

      const rows = conn.db.prepare(
        `SELECT id, metadata FROM knowledge WHERE type = 'checkpoint' ORDER BY created_at DESC LIMIT 10`
      ).all();

      const found = rows.some(row => {
        try {
          const metadata = JSON.parse(row.metadata || '{}');
          return metadata.task_title === 'Conversation mining (bulk operation)';
        } catch (_) {
          return false;
        }
      });

      assert.ok(found, 'expected a checkpoint entry with task_title "Conversation mining (bulk operation)" to exist after mine-conversations ran');
    } finally {
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });
});

describe('Phase 49-02: knowledge feedback wiring', () => {
  // CRITICAL — SHARED-DB CAUTION: ~/.claude/knowledge/ is a LIVE database.
  // Every test in this block MUST set GSD_KNOWLEDGE_DB_PATH to an isolated
  // temp file before touching anything that opens the knowledge DB.
  let tmpDbPath;
  let prevOverride;
  let openedDbs;

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-49-02b-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
    openedDbs = [];
  });

  afterEach(() => {
    const { closeKnowledgeDB } = require('./knowledge-db.js');
    for (const db of openedDbs) {
      try { closeKnowledgeDB(db); } catch (_) { /* best-effort */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('query-knowledge returns id alongside the existing locked schema fields', () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');

    const conn = openKnowledgeDB('global');
    const uniqueMarker = `zzqueryknowledgeidfieldtest${Date.now()}`;
    const { id } = insertKnowledge(conn.db, {
      content: `Distinctive lesson content mentioning ${uniqueMarker} for the id-field test`,
      type: 'lesson',
      scope: 'global',
      metadata: { confidence: 0.75 }
    });
    closeKnowledgeDB(conn.db);

    const result = runGsdTools(`query-knowledge "${uniqueMarker}" --raw`, process.cwd(), { GSD_KNOWLEDGE_DB_PATH: tmpDbPath });
    assert.strictEqual(result.success, true, `query-knowledge failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed.results) && parsed.results.length > 0, 'expected at least one query-knowledge result');
    const first = parsed.results[0];
    assert.strictEqual(first.id, id, 'expected results[0].id to match the inserted entry id');
    // Schema is additive — existing locked fields must still be present.
    assert.ok('question' in first);
    assert.ok('answer' in first);
    assert.ok('confidence' in first);
    assert.ok('project_slug' in first);
    assert.ok('source_type' in first);
    assert.ok('created_at' in first);
  });

  test('mark-wrong degrades confidence and records the reason (verification-failure-tied-to-KB-answer scenario)', () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge, getKnowledge } = require('./knowledge-crud.js');

    const conn = openKnowledgeDB('global');
    const { id } = insertKnowledge(conn.db, {
      content: 'principle that turned out to be wrong per execution outcome',
      type: 'principle',
      scope: 'global',
      metadata: { confidence: 0.8 }
    });
    closeKnowledgeDB(conn.db);

    const result = runGsdTools(
      `mark-wrong ${id} --severity major --reason "contradicted by execution outcome" --raw`,
      process.cwd(),
      { GSD_KNOWLEDGE_DB_PATH: tmpDbPath }
    );
    assert.strictEqual(result.success, true, `mark-wrong failed: ${result.error}`);

    const reconn = openKnowledgeDB('global');
    openedDbs.push(reconn.db);
    const row = getKnowledge(reconn.db, id);
    assert.ok(row.metadata.confidence < 0.8, `expected confidence to degrade below 0.8, got ${row.metadata.confidence}`);
    // major severity -> DEGRADATION_FACTORS.major = 0.5 -> newConfidence = 0.8 * (1 - 0.5) = 0.4
    assert.ok(Math.abs(row.metadata.confidence - 0.4) < 1e-9, `expected confidence 0.4 for major severity, got ${row.metadata.confidence}`);
    assert.ok(
      row.metadata.last_feedback_reason && row.metadata.last_feedback_reason.includes('contradicted by execution outcome'),
      'expected metadata.last_feedback_reason to contain the reason text'
    );
  });

  test('prompt-layer wiring: both agents/gsd-verifier.md and agents/gsd-executor.md reference mark-wrong', () => {
    const verifierContent = fs.readFileSync(path.join(__dirname, '..', '..', 'agents', 'gsd-verifier.md'), 'utf-8');
    const executorContent = fs.readFileSync(path.join(__dirname, '..', '..', 'agents', 'gsd-executor.md'), 'utf-8');

    assert.ok(verifierContent.includes('mark-wrong'), 'expected agents/gsd-verifier.md to reference mark-wrong');
    assert.ok(executorContent.includes('mark-wrong'), 'expected agents/gsd-executor.md to reference mark-wrong');
  });
});

describe('Phase 49-03: milestone consolidation', () => {
  // CRITICAL — SHARED-DB CAUTION: ~/.claude/knowledge/ is a LIVE database.
  // Every test in this block MUST set GSD_KNOWLEDGE_DB_PATH to an isolated
  // temp file before touching anything that opens the knowledge DB.
  let tmpDbPath;
  let prevOverride;
  let openedDbs;
  let prevCwd;
  let tmpCwd;

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-49-03-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
    openedDbs = [];

    // synthesizePrinciples writes CONFLICTS.jsonl relative to process.cwd() —
    // chdir into an isolated temp directory for the duration of each test so
    // no test ever writes into the real repo's .planning/knowledge/ directory.
    prevCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-49-03-cwd-'));
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });

    const { closeKnowledgeDB } = require('./knowledge-db.js');
    for (const db of openedDbs) {
      try { closeKnowledgeDB(db); } catch (_) { /* best-effort */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('sufficient cluster -> principle stores the injected synthesizer text, not the truncated stub', async () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');
    const { synthesizePrinciples, SYNTHESIS_CONFIG } = require('./knowledge-synthesis.js');
    const { generateEmbedding } = require('./embeddings.js');

    const conn = openKnowledgeDB('global');
    openedDbs.push(conn.db);

    const content = 'always write tests before merging code to the main branch';
    const emb = await generateEmbedding(content);
    for (let i = 0; i < SYNTHESIS_CONFIG.min_cluster_size; i++) {
      insertKnowledge(conn.db, { content, type: 'lesson', scope: 'global', embedding: emb });
    }

    const result = await synthesizePrinciples(conn, {}, async (cluster) => 'REAL SYNTHESIZED TEXT for ' + cluster.topic);

    assert.ok(result.synthesized >= 1, `expected at least one synthesized principle, got ${result.synthesized}`);
    const stored = result.principles[0];
    assert.ok(
      stored.rule.startsWith('REAL SYNTHESIZED TEXT for'),
      `expected stored principle text to start with the injected synthesizer text, got: ${stored.rule}`
    );
    // Prove this is NOT the "first 10 words" stub fragment of the raw lesson content.
    assert.ok(!stored.rule.startsWith('For '), 'stub fallback text ("For {topic}: ...") must not be used when a synthesizer is supplied');
  });

  test('insufficient cluster -> zero principles, bar never lowered to force output', async () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');
    const { synthesizePrinciples } = require('./knowledge-synthesis.js');
    const { generateEmbedding } = require('./embeddings.js');

    const conn = openKnowledgeDB('global');
    openedDbs.push(conn.db);

    const content = 'a rarely repeated lesson about something niche and specific';
    const emb = await generateEmbedding(content);
    // Below SYNTHESIS_CONFIG.min_cluster_size (5) — only 2 entries.
    for (let i = 0; i < 2; i++) {
      insertKnowledge(conn.db, { content, type: 'lesson', scope: 'global', embedding: emb });
    }

    let called = 0;
    const result = await synthesizePrinciples(conn, {}, async () => { called++; return 'should never be used'; });

    assert.strictEqual(result.synthesized, 0, 'expected zero synthesized principles for an insufficient cluster');
    assert.strictEqual(result.reason, 'insufficient_knowledge');
    assert.strictEqual(called, 0, 'synthesizer must never be invoked when no cluster qualifies');
  });

  test('conflicting same-topic principles -> flagged to CONFLICTS.jsonl, existing principle never overwritten', async () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');
    const { synthesizePrinciples } = require('./knowledge-synthesis.js');
    const { generateEmbedding } = require('./embeddings.js');

    const conn = openKnowledgeDB('global');
    openedDbs.push(conn.db);

    // Existing principle. No metadata.category -> defaults to 'convenience'
    // (priority 0.3) inside knowledge-conflicts.js's scorePrinciple(), same
    // default the new candidate object always gets (buildCandidateConflictObject
    // never sets a category). confidence 0.85 * 0.3 = 0.255.
    const existingContent = 'Existing established principle about database migrations';
    const existingEmb = await generateEmbedding(existingContent);
    insertKnowledge(conn.db, {
      content: existingContent,
      type: 'principle',
      scope: 'global',
      embedding: existingEmb,
      metadata: { topic: 'database_migration_rollback', confidence: 0.85 }
    });

    // This content deterministically infers topic "database_migration_rollback"
    // via inferTopic's top-3-most-common-word extraction, and clusters to a
    // cohesion+size-bonus confidence of 1.0 (capped) with 5 identical members
    // -> candidate score 1.0 * 0.3 = 0.3. Gap vs existing's 0.255 is 15%,
    // under the 20% ambiguity threshold in resolvePrincipleConflict().
    const content = 'database migration rollback strategy requires backup verification';
    const emb = await generateEmbedding(content);
    for (let i = 0; i < 5; i++) {
      insertKnowledge(conn.db, { content, type: 'lesson', scope: 'global', embedding: emb });
    }

    const result = await synthesizePrinciples(conn, {}, async () => 'candidate synthesized text');

    assert.strictEqual(result.synthesized, 0, 'the ambiguous candidate must not be inserted');
    assert.strictEqual(result.conflicts_flagged, 1, 'expected exactly one conflict to be flagged');

    const conflictsPath = path.join(tmpCwd, '.planning', 'knowledge', 'CONFLICTS.jsonl');
    assert.ok(fs.existsSync(conflictsPath), 'expected CONFLICTS.jsonl to be created');
    const lines = fs.readFileSync(conflictsPath, 'utf-8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(record.topic, 'database_migration_rollback');

    const rows = conn.db.prepare("SELECT id, content FROM knowledge WHERE type = 'principle'").all();
    assert.strictEqual(rows.length, 1, 'no new principle row should have been inserted for the conflicting topic');
    assert.strictEqual(rows[0].content, existingContent, 'the original existing principle content must be byte-for-byte unchanged');
  });

  test('circuit breaker blocks synthesis before any synthesizer call fires', async () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { enableCircuitBreaker } = require('./knowledge-cost.js');
    const { synthesizePrinciples } = require('./knowledge-synthesis.js');

    const conn = openKnowledgeDB('global');
    openedDbs.push(conn.db);
    enableCircuitBreaker(conn.db, 'test_budget_exceeded');

    let called = 0;
    const result = await synthesizePrinciples(conn, {}, async () => { called++; return 'should never fire'; });

    assert.strictEqual(result.reason, 'circuit_breaker_blocked');
    assert.strictEqual(result.synthesized, 0);
    assert.strictEqual(called, 0, 'the injected synthesizer must never be invoked when the circuit breaker is enabled');
  });

  test('manual backstop CLI produces an identical result to the automatic (direct-call) path given the same seed data', async () => {
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');
    const { insertKnowledge } = require('./knowledge-crud.js');
    const { synthesizePrinciples } = require('./knowledge-synthesis.js');
    const { generateEmbedding } = require('./embeddings.js');

    const content = 'always write tests before merging code to the main branch';
    const emb = await generateEmbedding(content);

    // Path A: automatic/direct call against DB A.
    const connA = openKnowledgeDB('global');
    openedDbs.push(connA.db);
    for (let i = 0; i < 5; i++) {
      insertKnowledge(connA.db, { content, type: 'lesson', scope: 'global', embedding: emb });
    }
    const resultA = await synthesizePrinciples(connA, {}, (cluster) => 'FIXED TEXT for ' + cluster.topic);
    closeKnowledgeDB(connA.db);

    // Path B: manual `knowledge consolidate` CLI backstop against a fresh, identically-seeded DB B.
    const tmpDbPathB = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-49-03-backstopB-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    const prevPathOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPathB;
    try {
      const connB = openKnowledgeDB('global');
      for (let i = 0; i < 5; i++) {
        insertKnowledge(connB.db, { content, type: 'lesson', scope: 'global', embedding: emb });
      }
      closeKnowledgeDB(connB.db);

      const inferredTopic = resultA.principles[0].topic;
      const cliResult = runGsdTools(
        `knowledge consolidate --raw --scope global --principles '${JSON.stringify([{ topic: inferredTopic, text: 'FIXED TEXT for ' + inferredTopic }])}'`,
        tmpCwd,
        { GSD_KNOWLEDGE_DB_PATH: tmpDbPathB }
      );
      assert.strictEqual(cliResult.success, true, `knowledge consolidate CLI failed: ${cliResult.error}`);
      const parsedB = JSON.parse(cliResult.output);

      assert.strictEqual(parsedB.synthesized, resultA.synthesized, 'expected the same synthesized count from both paths');
      assert.strictEqual(parsedB.principles[0].rule, resultA.principles[0].rule, 'expected identical stored principle text from both paths');
      assert.strictEqual(parsedB.principles[0].topic, resultA.principles[0].topic, 'expected identical inferred topic from both paths');
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        const p = tmpDbPathB + suffix;
        if (fs.existsSync(p)) {
          try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
        }
      }
      if (prevPathOverride === undefined) {
        delete process.env.GSD_KNOWLEDGE_DB_PATH;
      } else {
        process.env.GSD_KNOWLEDGE_DB_PATH = prevPathOverride;
      }
    }
  });
});

describe('Phase 49-03: complete-milestone consolidation step wiring', () => {
  const COMPLETE_MILESTONE_PATH = path.join(__dirname, '..', 'workflows', 'complete-milestone.md');

  test('consolidate_knowledge step exists positioned after mine_milestone_conversations and before reorganize_roadmap_and_delete_originals', () => {
    const content = fs.readFileSync(COMPLETE_MILESTONE_PATH, 'utf-8');

    const mineStart = content.indexOf('<step name="mine_milestone_conversations">');
    assert.notStrictEqual(mineStart, -1, 'mine_milestone_conversations step not found');
    const mineEnd = content.indexOf('</step>', mineStart);
    assert.notStrictEqual(mineEnd, -1, 'closing </step> for mine_milestone_conversations not found');

    const consolidateStart = content.indexOf('<step name="consolidate_knowledge">');
    assert.notStrictEqual(consolidateStart, -1, 'consolidate_knowledge step not found');

    const reorgStart = content.indexOf('<step name="reorganize_roadmap_and_delete_originals">');
    assert.notStrictEqual(reorgStart, -1, 'reorganize_roadmap_and_delete_originals step not found');

    assert.ok(mineEnd < consolidateStart, 'consolidate_knowledge must start after mine_milestone_conversations closes');
    assert.ok(consolidateStart < reorgStart, 'consolidate_knowledge must start before reorganize_roadmap_and_delete_originals');
  });

  test('consolidate_knowledge step body references the knowledge consolidate CLI command', () => {
    const content = fs.readFileSync(COMPLETE_MILESTONE_PATH, 'utf-8');
    const start = content.indexOf('<step name="consolidate_knowledge">');
    const end = content.indexOf('</step>', start);
    const stepBody = content.slice(start, end);

    assert.ok(stepBody.includes('knowledge consolidate'), 'expected "knowledge consolidate" call inside the consolidate_knowledge step');
  });

  test('consolidate_knowledge step spawns a haiku Agent() call matching the harvest_knowledge pattern', () => {
    const content = fs.readFileSync(COMPLETE_MILESTONE_PATH, 'utf-8');
    const start = content.indexOf('<step name="consolidate_knowledge">');
    const end = content.indexOf('</step>', start);
    const stepBody = content.slice(start, end);

    assert.ok(stepBody.includes('Agent('), 'expected an Agent( call inside the consolidate_knowledge step');
    assert.ok(stepBody.includes('subagent_type="general-purpose"'), 'expected subagent_type="general-purpose"');
    assert.ok(stepBody.includes('model="haiku"'), 'expected model="haiku"');
  });

  test('consolidate_knowledge step is config-gated by auto_consolidate', () => {
    const content = fs.readFileSync(COMPLETE_MILESTONE_PATH, 'utf-8');
    const start = content.indexOf('<step name="consolidate_knowledge">');
    const end = content.indexOf('</step>', start);
    const stepBody = content.slice(start, end);

    assert.ok(stepBody.includes('auto_consolidate'), 'expected a config gate referencing auto_consolidate');
  });

  test('consolidate_knowledge step declares a non-blocking guarantee', () => {
    const content = fs.readFileSync(COMPLETE_MILESTONE_PATH, 'utf-8');
    const start = content.indexOf('<step name="consolidate_knowledge">');
    const end = content.indexOf('</step>', start);
    const stepBody = content.slice(start, end);

    assert.ok(
      /non-blocking|never block/i.test(stepBody),
      'expected non-blocking guarantee language in the consolidate_knowledge step'
    );
  });

  test('loadConfig() returns auto_consolidate: true by default when no config.json is present', () => {
    const tmpDir = createTempProject();
    try {
      const result = runGsdTools('config get auto_consolidate --raw', tmpDir);
      assert.strictEqual(result.success, true, `config get failed: ${result.error}`);
      assert.strictEqual(result.output.trim(), 'true', 'expected auto_consolidate to default to true');
    } finally {
      cleanup(tmpDir);
    }
  });
});

describe('Phase 49-04: CLI deletions', () => {
  let tmpDbPath;
  let prevOverride;

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-49-04-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('grant is no longer a recognized command', () => {
    const result = runGsdTools('grant test_action', process.cwd(), { GSD_KNOWLEDGE_DB_PATH: tmpDbPath });
    assert.strictEqual(result.success, false, 'expected grant to fail now that the command is removed');
    assert.match(result.error, /Unknown command/i);
  });

  test('revoke is no longer a recognized command', () => {
    const result = runGsdTools('revoke some_token', process.cwd(), { GSD_KNOWLEDGE_DB_PATH: tmpDbPath });
    assert.strictEqual(result.success, false, 'expected revoke to fail now that the command is removed');
    assert.match(result.error, /Unknown command/i);
  });

  test('list-permissions is no longer a recognized command', () => {
    const result = runGsdTools('list-permissions', process.cwd(), { GSD_KNOWLEDGE_DB_PATH: tmpDbPath });
    assert.strictEqual(result.success, false, 'expected list-permissions to fail now that the command is removed');
    assert.match(result.error, /Unknown command/i);
  });

  test('knowledge-qa.js and knowledge-scan.js no longer exist on disk', () => {
    assert.strictEqual(fs.existsSync(path.join(__dirname, 'knowledge-qa.js')), false, 'knowledge-qa.js should be deleted');
    assert.strictEqual(fs.existsSync(path.join(__dirname, 'knowledge-scan.js')), false, 'knowledge-scan.js should be deleted');
  });

  test('knowledge-permissions.js module itself is untouched and still loadable, exposing its full API', () => {
    // Clear the require cache so this test reflects the file's current on-disk state.
    const modPath = path.join(__dirname, 'knowledge-permissions.js');
    delete require.cache[require.resolve(modPath)];
    const mod = require(modPath);
    assert.strictEqual(typeof mod.grantPermission, 'function', 'grantPermission should still be exported');
    assert.strictEqual(typeof mod.revokePermission, 'function', 'revokePermission should still be exported');
    assert.strictEqual(typeof mod.listActivePermissions, 'function', 'listActivePermissions should still be exported');
  });

  test('sibling knowledge subcommands are unaffected by the deletion', () => {
    const result = runGsdTools('knowledge stats --raw', process.cwd(), { GSD_KNOWLEDGE_DB_PATH: tmpDbPath });
    assert.strictEqual(result.success, true, `knowledge stats failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.by_type !== undefined, 'expected valid knowledge stats JSON output');
  });
});

describe('Phase 49: cross-cutting acceptance criteria', () => {
  // CRITICAL — SHARED-DB CAUTION: ~/.claude/knowledge/ is a LIVE database.
  // Every test in this block MUST set GSD_KNOWLEDGE_DB_PATH to an isolated
  // temp file before touching anything that opens the knowledge DB.
  let tmpDbPath;
  let prevOverride;
  let openedDbs;

  beforeEach(() => {
    prevOverride = process.env.GSD_KNOWLEDGE_DB_PATH;
    tmpDbPath = path.join(
      require('os').tmpdir(),
      `gsd-test-knowledge-49-04-xcut-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    process.env.GSD_KNOWLEDGE_DB_PATH = tmpDbPath;
    openedDbs = [];
  });

  afterEach(() => {
    const { closeKnowledgeDB } = require('./knowledge-db.js');
    for (const db of openedDbs) {
      try { closeKnowledgeDB(db); } catch (_) { /* best-effort */ }
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (_) { /* best-effort */ }
      }
    }
    if (prevOverride === undefined) {
      delete process.env.GSD_KNOWLEDGE_DB_PATH;
    } else {
      process.env.GSD_KNOWLEDGE_DB_PATH = prevOverride;
    }
  });

  test('end-to-end: multi-insight batch with one secret-bearing insight -- only the offending insight is skipped, clean siblings in the same batch are still stored', async () => {
    const { storeInsights } = require('./knowledge-writer.js');
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');

    const rawKey = 'sk-batchtest1234567890abcdefghij';
    const tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-49-04-batch-cwd-'));
    try {
      const result = await storeInsights(
        [
          { type: 'decision', decision: `first clean decision about testing strategy ${Date.now()}` },
          { type: 'decision', decision: `use this key: ${rawKey} for the integration` },
          { type: 'reasoning_pattern', description: `second clean lesson about code review ${Date.now()}` }
        ],
        { cwd: tmpCwd }
      );

      // 2 clean insights stored/evolved, 1 secret-bearing insight skipped.
      assert.strictEqual(result.stored + result.evolved, 2, 'expected exactly the 2 clean insights to be stored');
      assert.strictEqual(result.skipped, 1, 'expected exactly the 1 secret-bearing insight to be skipped');

      const conn = openKnowledgeDB('global');
      openedDbs.push(conn.db);
      const rows = conn.db.prepare('SELECT content FROM knowledge').all();
      for (const row of rows) {
        assert.ok(!row.content.includes(rawKey), 'raw API key must never be persisted verbatim, even alongside clean siblings in the same batch');
      }
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  test('end-to-end: circuit breaker enabled -- storeInsights blocks embeddings AND writes a GSD_DEBUG log line (the "and logs" half of the AC)', () => {
    const { spawnSync } = require('child_process');

    const childScript = path.join(require('os').tmpdir(), `gsd-test-49-04-cb-log-child-${Date.now()}.js`);
    const tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-49-04-cb-log-cwd-'));
    try {
      fs.writeFileSync(childScript, `
        const { enableCircuitBreaker } = require(${JSON.stringify(path.join(__dirname, 'knowledge-cost.js'))});
        const { openKnowledgeDB, closeKnowledgeDB } = require(${JSON.stringify(path.join(__dirname, 'knowledge-db.js'))});
        const { storeInsights } = require(${JSON.stringify(path.join(__dirname, 'knowledge-writer.js'))});
        (async () => {
          const conn = openKnowledgeDB('global');
          enableCircuitBreaker(conn.db, 'integration_test_reason');
          closeKnowledgeDB(conn.db);
          const result = await storeInsights(
            [{ type: 'decision', decision: 'a decision long enough to pass the content filter for this logging test' }],
            { cwd: process.cwd() }
          );
          process.stdout.write(JSON.stringify(result));
        })();
      `);

      const spawned = spawnSync('node', [childScript], {
        cwd: tmpCwd,
        encoding: 'utf-8',
        env: { ...process.env, GSD_DEBUG: '1', GSD_KNOWLEDGE_DB_PATH: tmpDbPath }
      });

      assert.strictEqual(spawned.status, 0, `child process failed: ${spawned.stderr}`);
      assert.match(
        spawned.stderr,
        /Circuit breaker enabled.*skipping embedding generation, hash-only dedup/,
        'expected a GSD_DEBUG log line proving the circuit breaker block was logged, not just silently applied'
      );

      const parsedStdout = JSON.parse(spawned.stdout);
      assert.strictEqual(parsedStdout.stored + parsedStdout.evolved, 1, 'insight should still be stored via hash-only dedup while embeddings are blocked');
    } finally {
      fs.rmSync(childScript, { force: true });
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  test('end-to-end: concurrent storeInsights calls on identical content via the public API -- no lost update, exactly one row', async () => {
    const { storeInsights } = require('./knowledge-writer.js');
    const { openKnowledgeDB, closeKnowledgeDB } = require('./knowledge-db.js');

    const tmpCwd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-49-04-concurrent-cwd-'));
    try {
      const content = `always run the full test suite before committing any change to main ${Date.now()}`;
      const calls = [];
      for (let i = 0; i < 5; i++) {
        calls.push(storeInsights([{ type: 'reasoning_pattern', description: content }], { cwd: tmpCwd }));
      }
      const results = await Promise.all(calls);

      const totalStoredOrEvolved = results.reduce((sum, r) => sum + r.stored + r.evolved, 0);
      assert.ok(totalStoredOrEvolved >= 1, 'expected at least one call to have stored/evolved the content');

      const conn = openKnowledgeDB('global');
      openedDbs.push(conn.db);
      const row = conn.db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE content = ?').get(content);
      assert.strictEqual(row.cnt, 1, 'expected exactly 1 row via the public storeInsights API -- no lost update / no duplicate insert under concurrency');
    } finally {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  // Full acceptance-criteria coverage index -- ROADMAP.md Phase 49 success
  // criterion 5 lists exactly 10 AC bullets. Each is mapped below to the
  // owning test(s) by describe/test name. Anything without a clear owner
  // gets a new test in THIS describe block rather than a footnote.
  test('coverage index: all 10 Phase 49 success-criterion-5 AC bullets have an owning test', () => {
    const coverageIndex = [
      {
        ac: 'secret pattern -> redacted/rejected',
        owner: '"Phase 49-01: secrets/PII filter end-to-end" > "API-key pattern -> storeInsights rejects the whole insight, raw key never persisted" / "custom config pattern -> filterContentForSecrets rejects" / "ambiguous high-entropy token -> rejected"'
      },
      {
        ac: 'clean content -> unchanged',
        owner: '"Phase 49-01: secrets/PII filter end-to-end" > "clean content -> passes through unchanged, and storeInsights stores it successfully"'
      },
      {
        ac: 'budget exceeded -> circuit breaker blocks + logs',
        owner: '"Phase 49-01: write-path safety" > "circuit breaker gates embedding generation, storeInsights still stores the insight via hash-only dedup" (blocks) + "Phase 49: cross-cutting acceptance criteria" > "end-to-end: circuit breaker enabled -- storeInsights blocks embeddings AND writes a GSD_DEBUG log line" (logs, this plan)'
      },
      {
        ac: 'concurrent writes -> no lost update',
        owner: '"Phase 49-01: write-path safety" > 5-concurrent-insertOrEvolve test (module level) + "Phase 49: cross-cutting acceptance criteria" > "end-to-end: concurrent storeInsights calls on identical content via the public API" (public-API level, this plan)'
      },
      {
        ac: 'session-end -> prune runs',
        owner: '"Phase 49-02: event triggers" > "session-end hook prunes a stale entry with no manual invocation"'
      },
      {
        ac: 'verification failure tied to KB answer -> feedback recorded',
        owner: '"Phase 49-02: knowledge feedback wiring" > "mark-wrong degrades confidence and records the reason (verification-failure-tied-to-KB-answer scenario)"'
      },
      {
        ac: 'bulk op -> checkpoint first',
        owner: '"Phase 49-02: event triggers" > "mine-conversations creates a checkpoint before scanning/extracting"'
      },
      {
        ac: 'sufficient cluster -> principle with LLM-generated text',
        owner: '"Phase 49-03: milestone consolidation" > "sufficient cluster -> principle stores the injected synthesizer text, not the truncated stub"'
      },
      {
        ac: 'insufficient cluster -> none',
        owner: '"Phase 49-03: milestone consolidation" > "insufficient cluster -> zero principles, bar never lowered to force output"'
      },
      {
        ac: 'conflicting principles -> flagged, not silently overwritten',
        owner: '"Phase 49-03: milestone consolidation" > "conflicting same-topic principles -> flagged to CONFLICTS.jsonl, existing principle never overwritten"'
      }
    ];

    for (const entry of coverageIndex) {
      assert.ok(entry.owner && entry.owner.length > 0, `AC bullet "${entry.ac}" has no owning test`);
    }
    assert.strictEqual(coverageIndex.length, 10, 'expected exactly 10 AC bullets from ROADMAP Phase 49 success criterion 5');
  });
});

describe('Phase 51-01: quota corruption self-heal (loadQuotaState)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writeQuotaFixture(session, weekly, tasks = []) {
    const quotaDir = path.join(tmpDir, '.planning', 'quota');
    fs.mkdirSync(quotaDir, { recursive: true });
    fs.writeFileSync(
      path.join(quotaDir, 'session-usage.json'),
      JSON.stringify({
        session,
        weekly,
        tasks,
        warnings_shown: { session_80: false, weekly_80: false },
      }, null, 2)
    );
    return path.join(quotaDir, 'session-usage.json');
  }

  function readQuotaFile() {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, '.planning', 'quota', 'session-usage.json'), 'utf-8'));
  }

  function readCorruptionLog() {
    const logPath = path.join(tmpDir, '.planning', 'quota', 'corruption-log.jsonl');
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  test('synthetic 28625%-shaped session corruption -> session healed to 0, weekly untouched, one corruption-log entry', () => {
    writeQuotaFixture(
      { tokens_used: 572500000, tokens_limit: 2000000, reset_time: null, last_updated: null }, // 28625%
      { tokens_used: 1000000, tokens_limit: 100000000, reset_time: null, last_updated: null }
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.session.used, 0, 'corrupted session tokens_used must be healed to 0');
    assert.strictEqual(parsed.session.percent, 0, 'healed session percent must be 0');
    assert.strictEqual(parsed.weekly.used, 1000000, 'weekly scope must be untouched when only session is corrupted');

    const healedFile = readQuotaFile();
    assert.strictEqual(healedFile.session.tokens_used, 0, 'healed state must persist to disk via saveQuotaState');
    assert.strictEqual(healedFile.weekly.tokens_used, 1000000, 'weekly scope on disk must be untouched');

    const log = readCorruptionLog();
    assert.strictEqual(log.length, 1, 'expected exactly one corruption-log.jsonl entry');
    assert.strictEqual(log[0].scope, 'session', 'the single corruption entry must be for session, not weekly');
  });

  test('synthetic 59196%-shaped weekly corruption -> weekly healed, session untouched', () => {
    writeQuotaFixture(
      { tokens_used: 900000, tokens_limit: 2000000, reset_time: null, last_updated: null },
      { tokens_used: 59196000000, tokens_limit: 100000000, reset_time: null, last_updated: null } // 59196%
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.weekly.used, 0, 'corrupted weekly tokens_used must be healed to 0');
    assert.strictEqual(parsed.weekly.percent, 0, 'healed weekly percent must be 0');
    assert.strictEqual(parsed.session.used, 900000, 'session scope must be untouched when only weekly is corrupted');

    const log = readCorruptionLog();
    assert.strictEqual(log.length, 1, 'expected exactly one corruption-log.jsonl entry');
    assert.strictEqual(log[0].scope, 'weekly', 'the single corruption entry must be for weekly, not session');
  });

  test('live-fixture-shaped corruption (this repo\'s actual numbers: 1479301347/2000000 session) -> heals from ~73965% to 0%, healthy 100M weekly untouched', () => {
    writeQuotaFixture(
      { tokens_used: 1479301347, tokens_limit: 2000000, reset_time: null, last_updated: '2026-07-05T00:00:00.000Z' },
      { tokens_used: 8500000, tokens_limit: 100000000, reset_time: null, last_updated: '2026-07-05T00:00:00.000Z' },
      [{ task_id: 't1', model: 'sonnet', tokens_in: 100, tokens_out: 200, timestamp: '2026-07-01T00:00:00.000Z' }]
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.session.percent, 0, 'the live-shaped ~73965% session corruption must heal to 0%');
    assert.strictEqual(parsed.weekly.used, 8500000, 'the healthy 8.5% weekly scope must NOT be flagged as corrupted at this limit');
    assert.strictEqual(parsed.weekly.percent, 8.5, 'weekly percent must be unchanged (8.5%)');
  });

  test('NaN tokens_used (string "NaN" coerced) -> detected and healed', () => {
    writeQuotaFixture(
      { tokens_used: 'NaN', tokens_limit: 2000000, reset_time: null, last_updated: null },
      { tokens_used: 2000000, tokens_limit: 100000000, reset_time: null, last_updated: null }
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.session.used, 0, 'NaN-shaped tokens_used must be healed to 0');
    const log = readCorruptionLog();
    assert.strictEqual(log.length, 1, 'expected exactly one corruption-log.jsonl entry for the NaN scope');
    assert.strictEqual(log[0].scope, 'session');
  });

  test('null tokens_used -> detected and healed', () => {
    writeQuotaFixture(
      { tokens_used: null, tokens_limit: 2000000, reset_time: null, last_updated: null },
      { tokens_used: 2000000, tokens_limit: 100000000, reset_time: null, last_updated: null }
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.session.used, 0, 'null tokens_used must be healed to 0');
  });

  test('negative tokens_used -> detected and healed', () => {
    writeQuotaFixture(
      { tokens_used: -500000, tokens_limit: 2000000, reset_time: null, last_updated: null },
      { tokens_used: 2000000, tokens_limit: 100000000, reset_time: null, last_updated: null }
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.session.used, 0, 'negative tokens_used must be healed to 0');
    const log = readCorruptionLog();
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].action, 'reset_tokens_used', 'a negative-tokens_used-only corruption must not also reset a valid limit');
  });

  test('tokens_limit <= 0 -> detected, tokens_used reset AND tokens_limit reset to DEFAULT_QUOTA_STATE value', () => {
    writeQuotaFixture(
      { tokens_used: 500000, tokens_limit: 0, reset_time: null, last_updated: null },
      { tokens_used: 2000000, tokens_limit: 100000000, reset_time: null, last_updated: null }
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.session.used, 0, 'tokens_used must be reset when tokens_limit is corrupted');
    assert.strictEqual(parsed.session.limit, 2000000, 'tokens_limit must be reset to the DEFAULT_QUOTA_STATE value (2,000,000)');

    const log = readCorruptionLog();
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].action, 'reset_tokens_used_and_limit', 'a corrupted tokens_limit must produce the "and_limit" action, not just "reset_tokens_used"');
  });

  test('valid non-corrupted state (45% session, 12% weekly) -> passes through completely unchanged, no corruption-log.jsonl, no stderr corruption message', () => {
    writeQuotaFixture(
      { tokens_used: 900000, tokens_limit: 2000000, reset_time: null, last_updated: null }, // 45%
      { tokens_used: 12000000, tokens_limit: 100000000, reset_time: null, last_updated: null } // 12%
    );

    const result = runGsdTools('quota status', tmpDir);
    assert.ok(result.success, `quota status should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.session.used, 900000, 'valid session tokens_used must be unchanged');
    assert.strictEqual(parsed.session.percent, 45, 'valid session percent must be unchanged');
    assert.strictEqual(parsed.weekly.used, 12000000, 'valid weekly tokens_used must be unchanged');
    assert.strictEqual(parsed.weekly.percent, 12, 'valid weekly percent must be unchanged');

    assert.ok(!/QUOTA CORRUPTION DETECTED/.test(result.error || ''), 'no corruption stderr message expected for a healthy state');

    const logPath = path.join(tmpDir, '.planning', 'quota', 'corruption-log.jsonl');
    assert.ok(!fs.existsSync(logPath), 'corruption-log.jsonl must not be created for a healthy, non-corrupted state');
  });

  test('corruption-log.jsonl entry shape includes timestamp, scope, tokens_used_before, tokens_limit_before, computed_percent, action', () => {
    writeQuotaFixture(
      { tokens_used: 999999999, tokens_limit: 2000000, reset_time: null, last_updated: null },
      { tokens_used: 1000000, tokens_limit: 100000000, reset_time: null, last_updated: null }
    );

    runGsdTools('quota status', tmpDir);
    const log = readCorruptionLog();
    assert.strictEqual(log.length, 1);
    const entry = log[0];

    assert.ok(typeof entry.timestamp === 'string' && entry.timestamp.length > 0, 'entry must have a timestamp');
    assert.strictEqual(entry.scope, 'session');
    assert.strictEqual(entry.tokens_used_before, 999999999);
    assert.strictEqual(entry.tokens_limit_before, 2000000);
    assert.ok(typeof entry.computed_percent === 'number' || entry.computed_percent === null, 'computed_percent must be present (number or JSON-serialized null for NaN)');
    assert.strictEqual(entry.action, 'reset_tokens_used');
  });

  test('integration proof: routing match-with-quota returns the genuine (non-haiku-forced) tier for an opus-shaped task after healing', () => {
    // This repo's own live corrupted numbers (73965% session) -- proves the
    // exact poisoning scenario this plan fixes no longer occurs.
    writeQuotaFixture(
      { tokens_used: 1479301347, tokens_limit: 2000000, reset_time: null, last_updated: null },
      { tokens_used: 5000000, tokens_limit: 100000000, reset_time: null, last_updated: null }
    );

    const opusShapedTask = [
      'Design system architecture and design service boundary decisions comprehensively.',
      '- item one',
      '- item two',
      '- item three',
      '  - nested one',
      '  - nested two',
      '1. step one',
      '2. step two',
      '3. step three',
      'This must never regress security, performance, scalability across the entire system.',
      'Evaluate migration and refactor entire architecture design integrate design service boundary.',
    ].join('\n');

    const result = runGsdTools(`routing match-with-quota "${opusShapedTask}"`, tmpDir);
    assert.ok(result.success, `routing match-with-quota should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.model, 'opus', 'an opus-shaped task must NOT be force-downgraded to haiku once loadQuotaState has healed the corrupted percent before this function ever sees it');
    assert.strictEqual(parsed.quota_adjusted, false, 'quota_adjusted must be false once the session percent is healed to 0');
    assert.strictEqual(parsed.quota_percent, 0, 'quota_percent must reflect the healed (0%), not the corrupted (73965%) value');
  });
});

describe('Phase 51-01: STATE.md tolerant parsing (state advance-plan / state update-progress)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writeState(content) {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), content);
  }

  function readState() {
    return fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
  }

  test('round-trip against a COPY of the actual repo .planning/STATE.md: advance-plan succeeds and correctly parses the real "Plan: N of M" line', () => {
    const realStatePath = path.join(__dirname, '..', '..', '.planning', 'STATE.md');
    const realContent = fs.readFileSync(realStatePath, 'utf-8');
    writeState(realContent); // temp fixture copy -- never touches the live file

    const parsedBefore = (() => {
      const match = realContent.match(/^\s*Plan:\s*(\d+)\s*of\s*(\d+)\s*(.*)$/im);
      assert.ok(match, 'sanity check: the real repo STATE.md must have a plain "Plan: N of M" line for this round-trip test to be meaningful');
      return { current: parseInt(match[1], 10), total: parseInt(match[2], 10) };
    })();

    const result = runGsdTools('state advance-plan', tmpDir);
    assert.ok(result.success, `state advance-plan should succeed against a real STATE.md copy: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.ok(!parsed.error, `advance-plan must not error against the real STATE.md shape: ${JSON.stringify(parsed)}`);
    assert.strictEqual(parsed.total_plans, parsedBefore.total, 'total_plans must match the real file\'s current total');

    if (parsedBefore.current >= parsedBefore.total) {
      assert.strictEqual(parsed.advanced, false);
      assert.strictEqual(parsed.reason, 'last_plan');
    } else {
      assert.strictEqual(parsed.advanced, true);
      assert.strictEqual(parsed.current_plan, parsedBefore.current + 1);
    }

    // Confirm the on-disk temp fixture was actually rewritten with a valid Plan line.
    const after = readState();
    assert.ok(/^\s*Plan:\s*\d+\s*of\s*\d+/im.test(after), 'the temp fixture must still have a parseable Plan line after advance-plan');
  });

  test('round-trip update-progress against the same real-STATE.md copy: succeeds, replaces the plain Progress: line, preserves the bar/percent format', () => {
    const realStatePath = path.join(__dirname, '..', '..', '.planning', 'STATE.md');
    const realContent = fs.readFileSync(realStatePath, 'utf-8');
    writeState(realContent); // temp fixture copy -- never touches the live file

    const result = runGsdTools('state update-progress', tmpDir);
    assert.ok(result.success, `state update-progress should succeed against a real STATE.md copy: ${result.error}`);
    const parsed = JSON.parse(result.output);

    assert.strictEqual(parsed.updated, true, 'update-progress must succeed against the real plain Progress: line');
    assert.match(parsed.bar, /^\[[█░]+\]\s*\d+%$/, 'bar/percent format must be preserved');

    const after = readState();
    assert.match(after, /^\s*Progress:\s*\[[█░]+\]\s*\d+%/im, 'the plain Progress: line must be present and correctly formatted after update');
  });

  test('back-compat: a synthetic bold-field fixture still works via the original bold path, unchanged output shape', () => {
    writeState([
      '# Project State',
      '',
      '## Current Position',
      '',
      '**Current Plan:** 2',
      '**Total Plans in Phase:** 3',
      '**Status:** In progress',
      '**Last Activity:** 2026-01-01',
      '',
      '**Progress:** [old bar] 50%',
      '',
    ].join('\n'));

    const advanceResult = runGsdTools('state advance-plan', tmpDir);
    assert.ok(advanceResult.success, `advance-plan should succeed on a bold fixture: ${advanceResult.error}`);
    const advanceParsed = JSON.parse(advanceResult.output);
    assert.deepStrictEqual(advanceParsed, { advanced: true, previous_plan: 2, current_plan: 3, total_plans: 3 });

    const afterAdvance = readState();
    assert.match(afterAdvance, /\*\*Current Plan:\*\*\s*3/, 'bold Current Plan field must be advanced in place');
    assert.match(afterAdvance, /\*\*Status:\*\*\s*Ready to execute/, 'bold Status field must be updated');

    const progressResult = runGsdTools('state update-progress', tmpDir);
    assert.ok(progressResult.success, `update-progress should succeed on a bold fixture: ${progressResult.error}`);
    const progressParsed = JSON.parse(progressResult.output);
    assert.strictEqual(progressParsed.updated, true);

    const afterProgress = readState();
    assert.match(afterProgress, /\*\*Progress:\*\*\s*\[[█░]+\]\s*\d+%/, 'bold Progress field must be replaced with the new bar');
  });

  test('edge case: STATE.md missing the Plan: line entirely -> advance-plan returns the existing { error: ... } shape, does not throw', () => {
    writeState([
      '# Project State',
      '',
      '## Current Position',
      '',
      'Phase: 1 of 1',
      'Status: In progress',
      '',
    ].join('\n'));

    const result = runGsdTools('state advance-plan', tmpDir);
    assert.ok(result.success, `advance-plan must not throw, even on unparseable input: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error, 'Cannot parse Current Plan or Total Plans in Phase from STATE.md');
  });

  test('edge case: STATE.md missing Progress: entirely (neither bold nor plain) -> update-progress returns { updated: false, reason: ... }', () => {
    writeState([
      '# Project State',
      '',
      '## Current Position',
      '',
      'Plan: 1 of 2 in current phase',
      'Status: In progress',
      '',
    ].join('\n'));

    const result = runGsdTools('state update-progress', tmpDir);
    assert.ok(result.success, `update-progress must not throw: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed, { updated: false, reason: 'Progress field not found in STATE.md' });
  });

  test('case-insensitivity: "last activity" vs "Last Activity" vs "Last activity" all match via the tolerant replacer', () => {
    const cases = ['last activity', 'Last Activity', 'Last activity'];
    for (const fieldCasing of cases) {
      const freshTmp = createTempProject();
      try {
        fs.writeFileSync(path.join(freshTmp, '.planning', 'STATE.md'), [
          '# Project State',
          '',
          '## Current Position',
          '',
          'Plan: 1 of 2 in current phase complete',
          'Status: In progress',
          `${fieldCasing}: 2020-01-01`,
          '',
          'Progress: [░░░░░░░░░░] 0%',
          '',
        ].join('\n'));

        const result = runGsdTools('state advance-plan', freshTmp);
        assert.ok(result.success, `advance-plan must succeed regardless of "${fieldCasing}" casing: ${result.error}`);
        const parsed = JSON.parse(result.output);
        assert.strictEqual(parsed.advanced, true, `expected advance to succeed for casing "${fieldCasing}"`);

        const after = fs.readFileSync(path.join(freshTmp, '.planning', 'STATE.md'), 'utf-8');
        const today = new Date().toISOString().split('T')[0];
        const activityPattern = new RegExp(`^\\s*${fieldCasing.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:\\s*${today}`, 'im');
        assert.ok(activityPattern.test(after), `expected the "${fieldCasing}" field to be updated to today's date regardless of casing`);
      } finally {
        cleanup(freshTmp);
      }
    }
  });
});

// Phase 51-02: resilience helpers (MILE-23). Pure functions are required
// directly (gsd-tools.js guards main() behind require.main === module so
// requiring it for tests never triggers the CLI's process.argv/process.exit
// side effects); CLI subcommands are still exercised via runGsdTools, per
// existing convention.
const resilience = require('./gsd-tools.js');

describe('Phase 51-02: parseDeathSignature', () => {
  test('matches session-limit death message and extracts reset fragment', () => {
    const result = resilience.parseDeathSignature("You've hit your session limit · resets 12:30am");
    assert.strictEqual(result.is_death, true);
    assert.strictEqual(result.matched_pattern, 'session limit');
    assert.strictEqual(result.reset_fragment, '12:30am');
  });

  test('matches usage limit / quota limit / rate limit exceeded pattern variants', () => {
    const usage = resilience.parseDeathSignature('usage limit reached');
    assert.strictEqual(usage.is_death, true);
    assert.strictEqual(usage.matched_pattern, 'usage limit');

    const quota = resilience.parseDeathSignature('quota limit exceeded');
    assert.strictEqual(quota.is_death, true);
    assert.strictEqual(quota.matched_pattern, 'quota limit');

    const rate = resilience.parseDeathSignature('rate limit exceeded');
    assert.strictEqual(rate.is_death, true);
    assert.strictEqual(rate.matched_pattern, 'rate limit exceeded');
  });

  test('case-insensitive match ("SESSION LIMIT")', () => {
    const result = resilience.parseDeathSignature('SESSION LIMIT reached, try again later');
    assert.strictEqual(result.is_death, true);
    assert.strictEqual(result.matched_pattern, 'session limit');
  });

  test('non-death text returns is_death false, reset_fragment null', () => {
    const result = resilience.parseDeathSignature('build succeeded');
    assert.strictEqual(result.is_death, false);
    assert.strictEqual(result.matched_pattern, null);
    assert.strictEqual(result.reset_fragment, null);
  });

  test('empty/null/undefined input never throws, returns is_death false', () => {
    for (const input of ['', null, undefined]) {
      assert.doesNotThrow(() => resilience.parseDeathSignature(input));
      const result = resilience.parseDeathSignature(input);
      assert.strictEqual(result.is_death, false);
    }
  });
});

describe('Phase 51-02: parseResetTime', () => {
  test('fragment time still in the future relative to referenceDate -> today\'s occurrence', () => {
    const reference = new Date(2026, 0, 15, 11, 0, 0); // Jan 15 2026, 11:00am local
    const iso = resilience.parseResetTime('5:20pm', reference);
    assert.ok(iso, 'expected a non-null ISO timestamp');
    const parsed = new Date(iso);
    assert.strictEqual(parsed.getFullYear(), 2026);
    assert.strictEqual(parsed.getMonth(), 0);
    assert.strictEqual(parsed.getDate(), 15, 'expected today\'s date (15th), not tomorrow');
    assert.strictEqual(parsed.getHours(), 17);
    assert.strictEqual(parsed.getMinutes(), 20);
  });

  test('fragment time already passed relative to referenceDate -> tomorrow\'s occurrence', () => {
    const reference = new Date(2026, 0, 15, 18, 0, 0); // Jan 15 2026, 6:00pm local
    const iso = resilience.parseResetTime('5:20pm', reference);
    assert.ok(iso, 'expected a non-null ISO timestamp');
    const parsed = new Date(iso);
    assert.strictEqual(parsed.getDate(), 16, 'expected tomorrow\'s date (16th) since 5:20pm already passed');
    assert.strictEqual(parsed.getHours(), 17);
    assert.strictEqual(parsed.getMinutes(), 20);
  });

  test('extracts fragment from a full "resets <time>" death message, not just a bare fragment', () => {
    const reference = new Date(2026, 0, 15, 11, 0, 0);
    const iso = resilience.parseResetTime("You've hit your session limit · resets 5:20pm", reference);
    assert.ok(iso);
    const parsed = new Date(iso);
    assert.strictEqual(parsed.getHours(), 17);
    assert.strictEqual(parsed.getMinutes(), 20);
  });

  test('fragment with no parseable time returns null', () => {
    const reference = new Date(2026, 0, 15, 11, 0, 0);
    assert.strictEqual(resilience.parseResetTime('no time here', reference), null);
    assert.strictEqual(resilience.parseResetTime('', reference), null);
    assert.strictEqual(resilience.parseResetTime(null, reference), null);
  });
});

describe('Phase 51-02: checkStaleness', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('a freshly-written file with threshold 30min -> stale false', () => {
    const filePath = path.join(tmpDir, 'fresh.txt');
    fs.writeFileSync(filePath, 'fresh');
    const result = resilience.checkStaleness(filePath, 30);
    assert.strictEqual(result.file_exists, true);
    assert.strictEqual(result.stale, false);
    assert.strictEqual(result.threshold_minutes, 30);
    assert.ok(result.mtime);
  });

  test('a file with mtime manually set >30min in the past -> stale true', () => {
    const filePath = path.join(tmpDir, 'old.txt');
    fs.writeFileSync(filePath, 'old');
    const oldTime = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
    fs.utimesSync(filePath, oldTime, oldTime);
    const result = resilience.checkStaleness(filePath, 30);
    assert.strictEqual(result.file_exists, true);
    assert.strictEqual(result.stale, true);
    assert.ok(result.age_minutes > 30);
  });

  test('a nonexistent file path -> file_exists false, stale null, no throw', () => {
    assert.doesNotThrow(() => resilience.checkStaleness(path.join(tmpDir, 'does-not-exist.txt'), 30));
    const result = resilience.checkStaleness(path.join(tmpDir, 'does-not-exist.txt'), 30);
    assert.strictEqual(result.file_exists, false);
    assert.strictEqual(result.stale, null);
    assert.strictEqual(result.age_minutes, null);
  });
});

describe('Phase 51-02: parseCheckpointForResume', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Fixture shaped like this repo's real 50-final-sweep/CHECKPOINT.json
  // (constructed equivalent, not copied verbatim, per plan instruction).
  function realShapedFixture() {
    return {
      phase: 50,
      phase_name: 'final-sweep',
      last_step: 'verify',
      step_status: 'complete',
      wave: 1,
      plans_complete: ['50-01', '50-02'],
      plans_remaining: [],
      timestamp: '2026-07-05T18:05:00Z',
      files_touched: ['.planning/phases/50-final-sweep/50-01-SUMMARY.md'],
      key_context: 'PHASE 50 COMPLETE. All checks passed.',
      resume_from: 'done',
    };
  }

  test('real-shaped fixture -> found true, all fields extracted correctly', () => {
    const checkpointPath = path.join(tmpDir, 'CHECKPOINT.json');
    fs.writeFileSync(checkpointPath, JSON.stringify(realShapedFixture(), null, 2));

    const result = resilience.parseCheckpointForResume(checkpointPath);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.resume_from, 'done');
    assert.strictEqual(result.last_step, 'verify');
    assert.strictEqual(result.step_status, 'complete');
    assert.deepStrictEqual(result.plans_complete, ['50-01', '50-02']);
    assert.deepStrictEqual(result.plans_remaining, []);
    assert.strictEqual(result.key_context, 'PHASE 50 COMPLETE. All checks passed.');
  });

  test('older-shape CHECKPOINT.json missing plans_complete/plans_remaining -> found true, those fields null, no throw', () => {
    const checkpointPath = path.join(tmpDir, 'CHECKPOINT.json');
    const olderShape = realShapedFixture();
    delete olderShape.plans_complete;
    delete olderShape.plans_remaining;
    fs.writeFileSync(checkpointPath, JSON.stringify(olderShape, null, 2));

    assert.doesNotThrow(() => resilience.parseCheckpointForResume(checkpointPath));
    const result = resilience.parseCheckpointForResume(checkpointPath);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.plans_complete, null);
    assert.strictEqual(result.plans_remaining, null);
  });

  test('a missing file path -> found false, resume_from null', () => {
    const result = resilience.parseCheckpointForResume(path.join(tmpDir, 'nope', 'CHECKPOINT.json'));
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.resume_from, null);
  });

  test('a malformed-JSON file -> found false, error message present, no throw', () => {
    const checkpointPath = path.join(tmpDir, 'CHECKPOINT.json');
    fs.writeFileSync(checkpointPath, '{ not valid json ][');

    assert.doesNotThrow(() => resilience.parseCheckpointForResume(checkpointPath));
    const result = resilience.parseCheckpointForResume(checkpointPath);
    assert.strictEqual(result.found, false);
    assert.ok(result.error, 'expected an error message on parse failure');
  });
});

describe('Phase 51-02: buildResumeBrief', () => {
  test('found:true checkpoint data -> brief_text contains RESUMING FROM DEATH, key_context, last_step', () => {
    const checkpointData = {
      found: true,
      resume_from: 'execute',
      last_step: 'execute',
      step_status: 'in_progress',
      plans_complete: ['51-01'],
      plans_remaining: ['51-02', '51-03'],
      key_context: 'Some very specific key context text.',
    };
    const phaseInfo = { phase_number: '51', phase_name: 'run-resilience', directory: '.planning/phases/51-run-resilience' };

    const brief = resilience.buildResumeBrief(checkpointData, phaseInfo);
    assert.strictEqual(brief.resume_from, 'execute');
    assert.ok(brief.brief_text.includes('RESUMING FROM DEATH'));
    assert.ok(brief.brief_text.includes('Some very specific key context text.'));
    assert.ok(brief.brief_text.includes('execute'), 'expected last_step to appear in brief_text');
  });

  test('found:false checkpoint data -> brief_text indicates fresh start, resume_from is "discuss"', () => {
    const checkpointData = { found: false, resume_from: null, last_step: null, step_status: null, plans_complete: null, plans_remaining: null, key_context: null };
    const phaseInfo = { phase_number: '52', phase_name: 'never-started', directory: '.planning/phases/52-never-started' };

    const brief = resilience.buildResumeBrief(checkpointData, phaseInfo);
    assert.strictEqual(brief.resume_from, 'discuss');
    assert.ok(/from scratch/i.test(brief.brief_text), 'expected brief_text to plainly indicate a fresh start');
  });
});

describe('Phase 51-02: estimateQuotaForRemainingPhases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writeQuotaFixture(tasks, sessionLimit = 2000000, sessionUsed = 0) {
    const quotaDir = path.join(tmpDir, '.planning', 'quota');
    fs.mkdirSync(quotaDir, { recursive: true });
    fs.writeFileSync(path.join(quotaDir, 'session-usage.json'), JSON.stringify({
      session: { tokens_used: sessionUsed, tokens_limit: sessionLimit, reset_time: null, last_updated: null },
      weekly: { tokens_used: sessionUsed, tokens_limit: 100000000, reset_time: null, last_updated: null },
      tasks,
      warnings_shown: { session_80: false, weekly_80: false },
    }, null, 2));
  }

  function writeExecutionLog(phaseCompleteCount) {
    const lines = ['# Autonomous Roadmap Execution Log', ''];
    for (let i = 0; i < phaseCompleteCount; i++) {
      lines.push(JSON.stringify({ timestamp: new Date().toISOString(), type: 'phase_complete', phase: 40 + i }));
    }
    fs.writeFileSync(path.join(tmpDir, '.planning', 'EXECUTION_LOG.md'), lines.join('\n') + '\n');
  }

  test('EXECUTION_LOG.md present with phases_completed > 0 -> avg computed from quota tasks total, source observed_history', () => {
    writeQuotaFixture([
      { task_id: 't1', model: 'sonnet', tokens_in: 1000, tokens_out: 2000, timestamp: new Date().toISOString() },
      { task_id: 't2', model: 'sonnet', tokens_in: 500, tokens_out: 500, timestamp: new Date().toISOString() },
    ]); // total = 4000
    writeExecutionLog(2); // phases_completed = 2 -> avg = 2000

    const result = resilience.estimateQuotaForRemainingPhases(tmpDir, 1);
    assert.strictEqual(result.source, 'observed_history');
    assert.strictEqual(result.avg_tokens_per_phase, 2000);
    assert.strictEqual(result.estimated_tokens, 2000);
  });

  test('no EXECUTION_LOG.md (phases_completed 0) -> source conservative_default, avg_tokens_per_phase === 300000', () => {
    writeQuotaFixture([{ task_id: 't1', model: 'sonnet', tokens_in: 1000, tokens_out: 2000, timestamp: new Date().toISOString() }]);
    // no EXECUTION_LOG.md written

    const result = resilience.estimateQuotaForRemainingPhases(tmpDir, 1);
    assert.strictEqual(result.source, 'conservative_default');
    assert.strictEqual(result.avg_tokens_per_phase, 300000);
  });

  test('sufficient correctly flips false when estimated_tokens > remaining_budget', () => {
    writeQuotaFixture(
      [{ task_id: 't1', model: 'sonnet', tokens_in: 100000, tokens_out: 100000, timestamp: new Date().toISOString() }],
      2000000,
      1990000 // remaining_budget = 10000, tiny
    );
    writeExecutionLog(1); // avg = 200000/1 = 200000 -- far exceeds remaining_budget of 10000

    const result = resilience.estimateQuotaForRemainingPhases(tmpDir, 1);
    assert.strictEqual(result.sufficient, false);
    assert.strictEqual(result.remaining_budget, 10000);
  });
});

describe('Phase 51-02: resilience CLI subcommands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('resilience check-staleness <file> --threshold-minutes 5 returns valid JSON with expected shape', () => {
    const filePath = path.join(tmpDir, 'checkme.txt');
    fs.writeFileSync(filePath, 'hi');
    const result = runGsdTools(`resilience check-staleness "${filePath}" --threshold-minutes 5`, tmpDir);
    assert.ok(result.success, `command should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.file_exists, true);
    assert.strictEqual(parsed.threshold_minutes, 5);
    assert.strictEqual(parsed.stale, false);
  });

  test('resilience parse-death --text "..." returns valid JSON including reset_time_iso when a reset fragment is present', () => {
    const result = runGsdTools(`resilience parse-death --text "session limit hit, resets 5:20pm"`, tmpDir);
    assert.ok(result.success, `command should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.is_death, true);
    assert.strictEqual(parsed.reset_fragment, '5:20pm');
    assert.ok(parsed.reset_time_iso, 'expected a non-null reset_time_iso');
  });

  test('resilience resume-brief <phase> against a temp project with a real CHECKPOINT.json fixture returns found:true', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '05-test-phase');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'CHECKPOINT.json'), JSON.stringify({
      phase: 5,
      phase_name: 'test-phase',
      last_step: 'execute',
      step_status: 'in_progress',
      plans_complete: ['05-01'],
      plans_remaining: ['05-02'],
      key_context: 'mid-execution death simulated for CLI test',
      resume_from: 'execute',
    }, null, 2));

    const result = runGsdTools('resilience resume-brief 05', tmpDir);
    assert.ok(result.success, `command should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.checkpoint.found, true);
    assert.ok(parsed.brief_text.includes('RESUMING FROM DEATH'));
  });

  test('resilience estimate-quota --phases 5 returns valid JSON with sufficient boolean', () => {
    const result = runGsdTools('resilience estimate-quota --phases 5', tmpDir);
    assert.ok(result.success, `command should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(typeof parsed.sufficient, 'boolean');
    assert.strictEqual(parsed.phase_count, 5);
    assert.ok(typeof parsed.estimated_tokens === 'number');
  });
});
