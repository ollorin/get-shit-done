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
