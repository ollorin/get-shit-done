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

// Phase 53-02 (MILE-30): gsd-phase-coordinator.md, gsd-planner.md,
// gsd-verifier.md, gsd-debugger.md, and gsd-executor.md were restructured
// hard-rules-first -- a short core preamble followed by
// `<!-- GSD:CORE-PREAMBLE-END -->` and a `@get-shit-done/references/*.md`
// pointer to the relocated detail. Several pre-existing regression tests
// below assert on content that now lives in the reference file rather than
// the agent file directly. Since Claude Code resolves `@`-includes at
// prompt-load time (the agent's EFFECTIVE prompt is core + included
// content), this helper reads an agent .md file and inlines any
// `@get-shit-done/references/*.md` pointer line it finds, so assertions
// against "what the agent actually sees" remain accurate regardless of
// which physical file the content lives in. Falls back to the raw content
// unchanged if no such pointer is present (pre-restructuring behavior).
function readEffectiveAgentContent(agentPath) {
  const raw = fs.readFileSync(agentPath, 'utf8');
  const repoRoot = path.join(__dirname, '..', '..');
  const pointerPattern = /^@(get-shit-done\/references\/[\w-]+\.md)$/m;
  const match = raw.match(pointerPattern);
  if (!match) return raw;
  const refPath = path.join(repoRoot, match[1]);
  if (!fs.existsSync(refPath)) return raw;
  const refContent = fs.readFileSync(refPath, 'utf8');
  return raw + '\n' + refContent;
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

  // ── milestoneAlreadyRecorded (pure function) — MILE-28 crash-point audit ──

  test('milestoneAlreadyRecorded returns false for empty/null content', () => {
    const { milestoneAlreadyRecorded } = require(TOOLS_PATH);
    assert.strictEqual(milestoneAlreadyRecorded('', 'v1.0'), false, 'empty content should return false');
    assert.strictEqual(milestoneAlreadyRecorded(null, 'v1.0'), false, 'null content should return false');
    assert.strictEqual(milestoneAlreadyRecorded('## v1.0 Foo', ''), false, 'empty version should return false');
    assert.strictEqual(milestoneAlreadyRecorded('## v1.0 Foo', null), false, 'null version should return false');
  });

  test('milestoneAlreadyRecorded returns true when content has a matching version heading', () => {
    const { milestoneAlreadyRecorded } = require(TOOLS_PATH);
    assert.strictEqual(
      milestoneAlreadyRecorded('## v1.0 Foo (Shipped: 2026-01-01)\n\nSome details.\n', 'v1.0'),
      true,
      'should detect an existing ## v1.0 heading'
    );
  });

  test('milestoneAlreadyRecorded returns false without a false-positive substring match', () => {
    const { milestoneAlreadyRecorded } = require(TOOLS_PATH);
    // Content has v1.0 heading, but we're checking for v1.1 -- must not match.
    assert.strictEqual(
      milestoneAlreadyRecorded('## v1.0 Foo (Shipped: 2026-01-01)\n', 'v1.1'),
      false,
      'v1.1 should not match a v1.0 heading'
    );
    // v1.0 must not match against a v1.0.1 heading (word boundary check).
    assert.strictEqual(
      milestoneAlreadyRecorded('## v1.0.1 Patch (Shipped: 2026-01-01)\n', 'v1.0'),
      false,
      'v1.0 should not false-positive match a v1.0.1 heading'
    );
    // v1.0.1 must not match against a plain v1.0 heading either.
    assert.strictEqual(
      milestoneAlreadyRecorded('## v1.0 Foo (Shipped: 2026-01-01)\n', 'v1.0.1'),
      false,
      'v1.0.1 should not false-positive match a v1.0 heading'
    );
  });

  test('milestoneAlreadyRecorded handles regex-special characters in version without throwing', () => {
    const { milestoneAlreadyRecorded } = require(TOOLS_PATH);
    assert.doesNotThrow(() => {
      milestoneAlreadyRecorded('## v1.0+beta Foo (Shipped: 2026-01-01)\n', 'v1.0+beta');
    });
    assert.strictEqual(
      milestoneAlreadyRecorded('## v1.0+beta Foo (Shipped: 2026-01-01)\n', 'v1.0+beta'),
      true,
      'should match a version containing regex-special characters like +'
    );
  });

  // ── cmdMilestoneComplete double-invocation idempotency — MILE-28 ──

  test('re-running milestone complete for the same version does not duplicate the MILESTONES.md entry', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n\n### Phase 1: Foundation\n**Goal:** Setup\n`
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

    // First call: normal full entry.
    const first = runGsdTools('milestone complete v2.0 --name Rerun', tmpDir);
    assert.ok(first.success, `First call failed: ${first.error}`);
    const firstOutput = JSON.parse(first.output);
    assert.strictEqual(firstOutput.milestones_appended, true, 'first call should append');
    assert.strictEqual(firstOutput.milestones_updated, true, 'first call should report milestones_updated true');
    assert.ok(
      Array.isArray(firstOutput.accomplishments) && firstOutput.accomplishments.includes('Set up project infrastructure'),
      'first call should include full accomplishments content'
    );

    // Second call, same version: simulates a re-run after a crash between this
    // step and a later one -- must NOT duplicate the MILESTONES.md entry.
    const second = runGsdTools('milestone complete v2.0 --name Rerun', tmpDir);
    assert.ok(second.success, `Second call failed: ${second.error}`);
    const secondOutput = JSON.parse(second.output);
    assert.strictEqual(secondOutput.milestones_appended, false, 'second call should detect duplicate and skip append');

    const milestones = fs.readFileSync(path.join(tmpDir, '.planning', 'MILESTONES.md'), 'utf-8');
    const headingMatches = milestones.match(/^##\s+v2\.0\b/gm) || [];
    assert.strictEqual(headingMatches.length, 1, 'MILESTONES.md should contain exactly one v2.0 heading after both calls');
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
    const content = readEffectiveAgentContent(EXECUTOR_PATH);
    assert.ok(content.includes('<post_plan_test_gate>'), 'Missing <post_plan_test_gate> opening tag');
    assert.ok(content.includes('</post_plan_test_gate>'), 'Missing </post_plan_test_gate> closing tag');
  });

  test('post_plan_test_gate references test command auto-detection', () => {
    const content = readEffectiveAgentContent(EXECUTOR_PATH);
    assert.ok(
      content.includes('testing.test_command') || content.includes('TEST_CMD'),
      'Missing test command reference'
    );
    assert.ok(content.includes('package.json'), 'Missing package.json reference for test detection');
  });

  test('post_plan_test_gate references coverage threshold', () => {
    const content = readEffectiveAgentContent(EXECUTOR_PATH);
    assert.ok(
      content.includes('testing.coverage_threshold') || content.includes('COVERAGE_THRESHOLD'),
      'Missing coverage threshold reference'
    );
  });

  test('post_plan_test_gate blocks SUMMARY.md on failure', () => {
    const content = readEffectiveAgentContent(EXECUTOR_PATH);
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
    const content = readEffectiveAgentContent(EXECUTOR_PATH);
    // Phase 53-02 (MILE-30): use lastIndexOf, not indexOf. The restructured
    // core preamble's <hard_rules_digest> quotes the literal string
    // "`<summary_creation>`" (a verbatim excerpt of the real hard rule
    // "Do NOT proceed to `<summary_creation>`...") ahead of where the real
    // <post_plan_test_gate>/<summary_creation> tags live in the relocated
    // reference file. lastIndexOf finds the real tag occurrence in the
    // reference file, where both tags still appear in their original
    // relative order (verified byte-for-byte at restructuring time).
    const ptgIdx = content.lastIndexOf('<post_plan_test_gate>');
    const scIdx = content.lastIndexOf('<summary_creation>');
    assert.ok(ptgIdx >= 0, 'post_plan_test_gate not found');
    assert.ok(scIdx >= 0, 'summary_creation not found');
    assert.ok(ptgIdx < scIdx, 'post_plan_test_gate must appear before summary_creation');
  });
});

// ─── Phase 35-02: gsd-phase-coordinator web framework detection ───────────────

describe('gsd-phase-coordinator — web framework detection (Phase 35-02)', () => {
  const COORDINATOR_PATH = path.join('/Users/ollorin/get-shit-done', 'agents', 'gsd-phase-coordinator.md');

  test('detect_web_framework section exists in coordinator', () => {
    const content = readEffectiveAgentContent(COORDINATOR_PATH);
    assert.ok(
      content.includes('detect_web_framework') || content.includes('WEB_FRAMEWORK_DETECTED'),
      'Missing detect_web_framework or WEB_FRAMEWORK_DETECTED in coordinator'
    );
  });

  test('web framework detection checks for React/Next.js/Vue/Svelte', () => {
    const content = readEffectiveAgentContent(COORDINATOR_PATH);
    assert.ok(content.includes('react'), 'Missing react framework check');
    assert.ok(
      content.includes('next') || content.includes('vue') || content.includes('svelte'),
      'Missing next/vue/svelte framework check'
    );
  });

  test('post_phase_ux_sweep references WEB_FRAMEWORK_DETECTED', () => {
    const content = readEffectiveAgentContent(COORDINATOR_PATH);
    const start = content.indexOf('post_phase_ux_sweep');
    assert.ok(start >= 0, 'post_phase_ux_sweep not found in coordinator');
    assert.ok(content.includes('WEB_FRAMEWORK_DETECTED'), 'WEB_FRAMEWORK_DETECTED not referenced in coordinator');
  });

  test('detect_web_framework appears before post_phase_ux_sweep', () => {
    const content = readEffectiveAgentContent(COORDINATOR_PATH);
    const detectIdx = content.indexOf('detect_web_framework');
    const sweepIdx = content.indexOf('post_phase_ux_sweep');
    assert.ok(detectIdx >= 0, 'detect_web_framework not found');
    assert.ok(sweepIdx >= 0, 'post_phase_ux_sweep not found');
    assert.ok(detectIdx < sweepIdx, 'detect_web_framework must appear before post_phase_ux_sweep');
  });

  test('sweep trigger uses EITHER condition language', () => {
    const content = readEffectiveAgentContent(COORDINATOR_PATH);
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
    const content = readEffectiveAgentContent(VERIFIER_PATH);
    assert.ok(content.includes('check_charlotte_qa_coverage'), 'Missing check_charlotte_qa_coverage in verifier');
  });

  test('Charlotte QA check is documented as gaps_found not warning', () => {
    const content = readEffectiveAgentContent(VERIFIER_PATH);
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
    const content = readEffectiveAgentContent(VERIFIER_PATH);
    assert.ok(content.includes('check_test_file_coverage'), 'Missing check_test_file_coverage in verifier');
  });

  test('test file check is documented as gaps_found not warning', () => {
    const content = readEffectiveAgentContent(VERIFIER_PATH);
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
    const content = readEffectiveAgentContent(VERIFIER_PATH);
    const charlotteIdx = content.indexOf('check_charlotte_qa_coverage');
    const testIdx = content.indexOf('check_test_file_coverage');
    assert.ok(charlotteIdx >= 0, 'check_charlotte_qa_coverage not found');
    assert.ok(testIdx >= 0, 'check_test_file_coverage not found');
    assert.ok(charlotteIdx < testIdx, 'Charlotte QA check must appear before test file check');
  });

  test('both checks appear before output section', () => {
    // Phase 53-02 (MILE-30): gsd-verifier.md was restructured hard-rules-first
    // -- <output> (the VERIFICATION.md template + return contract) is now
    // part of the CORE preamble (kept near the top, with the other hard
    // rules), while the full <verification_process> (including
    // check_test_file_coverage / Step 8d) was relocated wholesale to
    // @get-shit-done/references/verifier-detail.md, loaded on demand. This
    // means the two sections are no longer in the same linear byte-order in
    // the concatenated effective content -- that is an intentional
    // consequence of the redesign (rules/contract surface early, detail is
    // available on demand), not a regression. What still matters, and what
    // this test now asserts, is that both sections continue to exist
    // somewhere in the agent's effective prompt content.
    const content = readEffectiveAgentContent(VERIFIER_PATH);
    const testIdx = content.indexOf('check_test_file_coverage');
    const outputIdx = content.indexOf('<output>');
    assert.ok(testIdx >= 0, 'check_test_file_coverage not found');
    assert.ok(outputIdx >= 0, '<output> section not found');
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
    const content = readEffectiveAgentContent(EXECUTOR_PATH);
    assert.ok(!content.includes('does NOT block state updates'), 'the removed contradiction must not reappear in gsd-executor.md');
  });

  test('gsd-executor.md\'s <docs_update> block contains the "deferred add" waiver escape hatch', () => {
    const content = readEffectiveAgentContent(EXECUTOR_PATH);
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
    // Phase 53-02 (MILE-30): gsd-phase-coordinator.md's execution_cycle (incl.
    // the discuss step's Step A-fallback) was relocated verbatim to
    // @get-shit-done/references/coordinator-detail.md. Use the effective
    // (core + resolved @-include) content so this still finds the unchanged
    // invocation shape wherever it now physically lives.
    const phaseCoordinator = readEffectiveAgentContent(path.join(REPO_ROOT, 'agents/gsd-phase-coordinator.md'));

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
    // Phase 53-02 (MILE-30): both agents were restructured hard-rules-first;
    // the mark-wrong reference (kb_feedback / Step 11 in the verifier,
    // the "Knowledge feedback on contradiction" bullet in the executor's
    // execute_tasks step) now lives in each agent's relocated reference
    // detail file. Use effective (core + resolved @-include) content.
    const verifierContent = readEffectiveAgentContent(path.join(__dirname, '..', '..', 'agents', 'gsd-verifier.md'));
    const executorContent = readEffectiveAgentContent(path.join(__dirname, '..', '..', 'agents', 'gsd-executor.md'));

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

// Executor Resilience Protocol: scanUsageWindow (task-level extension of the
// Phase 51-02 resilience module -- coordinator-death recovery extended one
// level down to plan-executors, see get-shit-done/references/resilience.md).
describe('Executor Resilience Protocol: scanUsageWindow', () => {
  let projectsDir;

  beforeEach(() => {
    projectsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-usage-window-'));
  });

  afterEach(() => {
    cleanup(projectsDir);
  });

  // mtimeOverride defaults to the latest entry timestamp (real transcript
  // files are last-modified when their last line is appended) -- the real
  // OS clock the test runs under has no fixed relationship to the fictional
  // `referenceNow` timestamps used in these fixtures, so every write must
  // pin its own mtime rather than rely on the OS's real "now".
  function writeTranscript(slug, sessionId, entries, mtimeOverride) {
    const slugDir = path.join(projectsDir, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    const jsonlPath = path.join(slugDir, `${sessionId}.jsonl`);
    fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    const mtime = mtimeOverride || new Date(Math.max(...entries.map((e) => new Date(e.timestamp).getTime())));
    fs.utimesSync(jsonlPath, mtime, mtime);
    return jsonlPath;
  }

  function usageEntry(timestamp, model, usage) {
    return { timestamp, message: { model, usage } };
  }

  test('sums input/output/cache tokens across all entries inside the window, by model family', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    writeTranscript('-Users-foo-bar', 'sess1', [
      usageEntry('2026-07-13T11:00:00Z', 'claude-sonnet-4-5', {
        input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 10,
      }),
      usageEntry('2026-07-13T11:30:00Z', 'claude-opus-4', {
        input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      }),
    ]);

    const result = resilience.scanUsageWindow(5, { projectsDir, referenceNow: now });
    assert.strictEqual(result.messages_count, 2);
    assert.strictEqual(result.input_tokens, 300);
    assert.strictEqual(result.output_tokens, 150);
    assert.strictEqual(result.cache_creation_tokens, 20);
    assert.strictEqual(result.cache_read_tokens, 10);
    assert.strictEqual(result.total_tokens, 480);
    assert.strictEqual(result.by_model_family.sonnet, 180);
    assert.strictEqual(result.by_model_family.opus, 300);
  });

  test('entries outside the window (too old or in the future) are excluded', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    writeTranscript('-Users-foo-bar', 'sess2', [
      usageEntry('2026-07-13T06:00:00Z', 'claude-sonnet-4-5', { input_tokens: 1000, output_tokens: 1000 }), // 6h ago, outside 5h window
      usageEntry('2026-07-13T11:30:00Z', 'claude-sonnet-4-5', { input_tokens: 10, output_tokens: 10 }), // inside window
      usageEntry('2026-07-13T13:00:00Z', 'claude-sonnet-4-5', { input_tokens: 999, output_tokens: 999 }), // in the future relative to referenceNow
    ]);
    // Force the stale entry's file mtime to be old so the mtime prefilter
    // doesn't accidentally exclude it for the wrong reason (it should be
    // excluded by its own timestamp, not by file mtime).
    const filePath = path.join(projectsDir, '-Users-foo-bar', 'sess2.jsonl');
    fs.utimesSync(filePath, now, now);

    const result = resilience.scanUsageWindow(5, { projectsDir, referenceNow: now });
    assert.strictEqual(result.messages_count, 1, 'only the one in-window entry should count');
    assert.strictEqual(result.input_tokens, 10);
  });

  test('malformed JSON lines and entries without a usage block are skipped without throwing', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    const slugDir = path.join(projectsDir, '-Users-foo-bar');
    fs.mkdirSync(slugDir, { recursive: true });
    const jsonlPath = path.join(slugDir, 'sess3.jsonl');
    const goodEntry = usageEntry('2026-07-13T11:45:00Z', 'claude-haiku-4-5', { input_tokens: 5, output_tokens: 5 });
    const noUsageEntry = { timestamp: '2026-07-13T11:46:00Z', message: { model: 'claude-haiku-4-5' } };
    const lines = ['{ not valid json ][', JSON.stringify(goodEntry), JSON.stringify(noUsageEntry), ''];
    fs.writeFileSync(jsonlPath, lines.join('\n'), 'utf-8');
    fs.utimesSync(jsonlPath, now, now);

    assert.doesNotThrow(() => resilience.scanUsageWindow(5, { projectsDir, referenceNow: now }));
    const result = resilience.scanUsageWindow(5, { projectsDir, referenceNow: now });
    assert.strictEqual(result.messages_count, 1);
    assert.strictEqual(result.by_model_family.haiku, 10);
  });

  test('missing projects dir -> zeroed result, no throw', () => {
    const missingDir = path.join(projectsDir, 'does-not-exist');
    assert.doesNotThrow(() => resilience.scanUsageWindow(5, { projectsDir: missingDir }));
    const result = resilience.scanUsageWindow(5, { projectsDir: missingDir });
    assert.strictEqual(result.total_tokens, 0);
    assert.strictEqual(result.messages_count, 0);
    assert.deepStrictEqual(result.by_model_family, {});
  });

  test('a file whose mtime is entirely before the window is skipped by the cheap prefilter', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    const filePath = writeTranscript('-Users-foo-bar', 'sess4', [
      usageEntry('2026-07-13T11:45:00Z', 'claude-sonnet-4-5', { input_tokens: 50, output_tokens: 50 }),
    ]);
    const oldMtime = new Date('2026-07-13T05:00:00Z'); // 7h before referenceNow, well outside 5h window
    fs.utimesSync(filePath, oldMtime, oldMtime);

    const result = resilience.scanUsageWindow(5, { projectsDir, referenceNow: now });
    assert.strictEqual(result.messages_count, 0, 'stale-mtime file must be skipped entirely, even though its one entry has a fabricated in-window timestamp');
  });

  test('non-numeric/absent --hours defaults to 5', () => {
    const result = resilience.scanUsageWindow(NaN, { projectsDir });
    assert.strictEqual(result.window_hours, 5);
  });

  test('CLI: resilience usage-window --hours N against a fake HOME scans ~/.claude/projects', () => {
    const fakeHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-fakehome-usage-'));
    const tmpDir = createTempProject();
    try {
      const slugDir = path.join(fakeHome, '.claude', 'projects', '-fake-project');
      fs.mkdirSync(slugDir, { recursive: true });
      fs.writeFileSync(
        path.join(slugDir, 'sess.jsonl'),
        JSON.stringify(usageEntry(new Date().toISOString(), 'claude-sonnet-4-5', { input_tokens: 42, output_tokens: 8 })) + '\n',
        'utf-8'
      );

      const result = runGsdTools('resilience usage-window --hours 24 --raw', tmpDir, { HOME: fakeHome });
      assert.ok(result.success, `command should succeed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.messages_count, 1);
      assert.strictEqual(parsed.total_tokens, 50);
    } finally {
      cleanup(tmpDir);
      cleanup(fakeHome);
    }
  });
});

// Config plumbing for the Executor Resilience Protocol's proactive
// usage-window pause: default OFF (null), overridable via
// resilience.usage_pause_threshold_tokens in config.json.
describe('Executor Resilience Protocol: usage_pause_threshold_tokens config', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('default (no config.json) -> null, zero behavior change', () => {
    const result = runGsdTools('config get usage_pause_threshold_tokens --raw', tmpDir);
    assert.ok(result.success, `command should succeed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'null');
  });

  test('resilience.usage_pause_threshold_tokens in config.json overrides the null default', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({
      resilience: { usage_pause_threshold_tokens: 500000 },
    }, null, 2));

    const result = runGsdTools('config get usage_pause_threshold_tokens --raw', tmpDir);
    assert.ok(result.success, `command should succeed: ${result.error}`);
    assert.strictEqual(result.output.trim(), '500000');
  });
});

describe('execute-roadmap.md resilience wiring (Phase 51-03)', () => {
  // Prose isn't unit-testable -- these are structural regression guards
  // proving the workflow file's text actually contains the CLI call
  // references and structural pieces this plan's prose wiring claims to add,
  // following the exact precedent set in Phase 48-04's grep-assertion tests.
  // Repo root is two levels up from this test file's __dirname
  // (get-shit-done/bin/ -> get-shit-done/ -> repo root).
  const REPO_ROOT = path.join(__dirname, '..', '..');

  function readExecuteRoadmap() {
    return fs.readFileSync(path.join(REPO_ROOT, 'get-shit-done', 'workflows', 'execute-roadmap.md'), 'utf-8');
  }

  test('pre-flight quota estimate step calls resilience estimate-quota and logs both branches', () => {
    const content = readExecuteRoadmap();

    assert.match(content, /<step name="preflight_quota_estimate">/, 'execute-roadmap.md must have a preflight_quota_estimate step');
    assert.match(content, /resilience estimate-quota/, 'preflight step must call resilience estimate-quota');
    assert.match(content, /quota_preflight_ok/, 'preflight step must log quota_preflight_ok when sufficient');
    assert.match(content, /quota_preflight_insufficient/, 'preflight step must log quota_preflight_insufficient when insufficient');

    const preflightIdx = content.indexOf('<step name="preflight_quota_estimate">');
    const confirmIdx = content.indexOf('<step name="confirm_execution">');
    assert.notStrictEqual(preflightIdx, -1);
    assert.notStrictEqual(confirmIdx, -1);
    assert.ok(preflightIdx < confirmIdx, 'preflight_quota_estimate must be positioned before confirm_execution');
  });

  test('death-detection subsection exists, calls check-staleness/parse-death/resume-brief, and is positioned before step 5', () => {
    const content = readExecuteRoadmap();

    assert.match(content, /4a\. Detect coordinator death/, 'execute_phases must have a labeled 4a death-detection subsection');
    assert.match(content, /resilience check-staleness/, 'death detection must call resilience check-staleness');
    assert.match(content, /resilience parse-death/, 'death detection must call resilience parse-death');
    assert.match(content, /resilience resume-brief/, 'death detection must call resilience resume-brief');

    const fourAIdx = content.indexOf('4a. Detect coordinator death');
    const fiveIdx = content.indexOf('**5. Handle result:**');
    assert.notStrictEqual(fourAIdx, -1);
    assert.notStrictEqual(fiveIdx, -1);
    assert.ok(fourAIdx < fiveIdx, '4a death-detection subsection must be positioned before step 5\'s status branches');
  });

  test('death-detection logs coordinator_death_detected and auto_resume_spawned as literal event-type strings', () => {
    const content = readExecuteRoadmap();

    assert.match(content, /--type coordinator_death_detected/, 'must log coordinator_death_detected via execution-log event');
    assert.match(content, /--type auto_resume_spawned/, 'must log auto_resume_spawned via execution-log event');
  });

  test('wait-until-reset logic documents a capped maximum wait duration (6 hours)', () => {
    const content = readExecuteRoadmap();

    assert.match(content, /6 hours/, 'wait-until-reset logic must document the 6-hour cap');
    assert.match(content, /death_reset_time_implausible/, 'must log death_reset_time_implausible when the reset time exceeds the cap');
  });

  test('respawn re-spawns gsd-phase-coordinator with the resume brief prepended, and requires no human input', () => {
    const content = readExecuteRoadmap();

    const fourAIdx = content.indexOf('4a. Detect coordinator death');
    const fiveIdx = content.indexOf('**5. Handle result:**');
    const section = content.slice(fourAIdx, fiveIdx);

    assert.match(section, /subagent_type="gsd-phase-coordinator"/, '4a must respawn via a fresh gsd-phase-coordinator Agent() call');
    assert.match(section, /BRIEF_TEXT/, '4a must prepend the resume brief text to the respawn prompt');
    assert.match(section, /RESUMING FROM DEATH/, '4a must reuse the "RESUMING FROM DEATH" preamble');
    assert.match(section, /No human input required/, '4a must document that the auto-resume path requires no human input');
  });

  test('handle_failure retains its original execution-state record-failure retry/debug/escalate ladder unchanged (regression guard)', () => {
    const content = readExecuteRoadmap();

    const handleFailureIdx = content.indexOf('<step name="handle_failure">');
    const resumeCapabilityIdx = content.indexOf('<step name="resume_capability">', handleFailureIdx);
    assert.notStrictEqual(handleFailureIdx, -1, 'handle_failure step must still exist');
    assert.notStrictEqual(resumeCapabilityIdx, -1, 'resume_capability step must still exist (used as the section boundary)');

    const section = content.slice(handleFailureIdx, resumeCapabilityIdx);

    assert.match(section, /execution-state record-failure/, 'handle_failure must retain its execution-state record-failure call');
    assert.match(section, /"retry"/, 'handle_failure must retain the retry branch');
    assert.match(section, /"debug"/, 'handle_failure must retain the debug branch');
    assert.match(section, /"escalate"/, 'handle_failure must retain the escalate branch');
    assert.match(section, /entered ONLY for genuine `status: "failed"` task-logic failures/, 'handle_failure must have the new clarifying scope note distinguishing it from coordinator deaths');
  });
});

describe('Executor Resilience Protocol: execute-phase.md coordinator-side wiring', () => {
  // Prose isn't unit-testable -- these are structural regression guards
  // proving execute-phase.md's text actually contains the CLI call
  // references and structural pieces this protocol's coordinator-side
  // handling claims to add, following the exact precedent set by the
  // execute-roadmap.md resilience-wiring tests above.
  const REPO_ROOT = path.join(__dirname, '..', '..');

  function readExecutePhase() {
    return fs.readFileSync(path.join(REPO_ROOT, 'get-shit-done', 'workflows', 'execute-phase.md'), 'utf-8');
  }

  test('execute_waves pre-spawn handoff check exists, checks both artifacts, and is positioned before the executor spawn step', () => {
    const content = readExecutePhase();

    assert.match(content, /EXECUTOR-HANDOFF\.json/, 'must reference EXECUTOR-HANDOFF.json');
    assert.match(content, /TASK-CHECKPOINT\.json/, 'must reference TASK-CHECKPOINT.json');
    assert.match(content, /resolved-handoffs/, 'must archive resolved handoffs');
    assert.match(content, /<prior_executor_handoff>/, 'must document the prior_executor_handoff prompt block');

    const preSpawnIdx = content.indexOf('Check for a prior interrupted executor run');
    const spawnStepIdx = content.indexOf('**Spawn executor agents:**');
    assert.notStrictEqual(preSpawnIdx, -1, 'pre-spawn handoff check must exist');
    assert.notStrictEqual(spawnStepIdx, -1, 'executor spawn step must exist');
    assert.ok(preSpawnIdx < spawnStepIdx, 'pre-spawn handoff check must be positioned before the executor spawn step');
  });

  test('executor death / clean interruption detection exists inside handle_failures and precedes the retry ladder', () => {
    const content = readExecutePhase();

    const handleFailuresIdx = content.indexOf('**Handle failures:**');
    const deathDetectionIdx = content.indexOf('Executor death / clean interruption detection');
    const retryLadderIdx = content.indexOf('For real failures (not the classifyHandoffIfNeeded runtime bug, and not an executor death');

    assert.notStrictEqual(handleFailuresIdx, -1, 'Handle failures step must exist');
    assert.notStrictEqual(deathDetectionIdx, -1, 'executor death/clean interruption detection subsection must exist');
    assert.notStrictEqual(retryLadderIdx, -1, 'retry ladder entry point must still exist, now scoped to exclude death/interruption');

    assert.ok(handleFailuresIdx < deathDetectionIdx, 'death detection must be inside Handle failures');
    assert.ok(deathDetectionIdx < retryLadderIdx, 'death detection must run before the retry ladder');
  });

  test('death detection calls parse-death, check-staleness, and branches on session_limit vs context-overflow', () => {
    const content = readExecutePhase();
    const deathDetectionIdx = content.indexOf('Executor death / clean interruption detection');
    const retryLadderIdx = content.indexOf('For real failures (not the classifyHandoffIfNeeded runtime bug, and not an executor death');
    const section = content.slice(deathDetectionIdx, retryLadderIdx);

    assert.match(section, /resilience parse-death/, 'must call resilience parse-death');
    assert.match(section, /resilience check-staleness/, 'must call resilience check-staleness');
    assert.match(section, /PAUSED\.json/, 'must write PAUSED.json for a session-limit death');
    assert.match(section, /"session_limit"/, 'PAUSED.json type must include session_limit');
    assert.match(section, /paused_session_limit/, 'must be able to bubble up status: paused_session_limit');
    assert.match(section, /30 minutes/, 'must document the 30-minute wait-vs-bubble-up threshold');
    assert.match(section, /## PLAN INTERRUPTED — continuation needed/, 'must recognize the executor clean-interruption completion format');
  });

  test('proactive usage-window pause check exists, is OFF by default, and is positioned before each wave spawns', () => {
    const content = readExecutePhase();

    assert.match(content, /resilience usage-window/, 'must call resilience usage-window');
    assert.match(content, /usage_pause_threshold_tokens/, 'must read the usage_pause_threshold_tokens config key');
    assert.match(content, /skip this check entirely/, 'must document the default-OFF zero-overhead skip path');
    assert.match(content, /"usage_estimate"/, 'PAUSED.json type must include usage_estimate for the proactive path');

    const usageCheckIdx = content.indexOf('Proactive usage-window check');
    const waveDescribeIdx = content.indexOf('Describe what\'s being built (BEFORE spawning)');
    assert.notStrictEqual(usageCheckIdx, -1, 'proactive usage-window check must exist');
    assert.notStrictEqual(waveDescribeIdx, -1, 'per-wave describe step must exist');
    assert.ok(usageCheckIdx < waveDescribeIdx, 'usage-window check must run before wave work begins');
  });

  test('references/resilience.md is linked from execute-phase.md', () => {
    const content = readExecutePhase();
    assert.match(content, /@get-shit-done\/references\/resilience\.md/, 'execute-phase.md must point to the resilience protocol reference doc');
  });
});

describe('Executor Resilience Protocol: agents/gsd-executor.md self-stop wiring', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');

  function readGsdExecutor() {
    return fs.readFileSync(path.join(REPO_ROOT, 'agents', 'gsd-executor.md'), 'utf-8');
  }

  test('executor_resilience_protocol block exists between completion_format and success_criteria', () => {
    const content = readGsdExecutor();

    const completionFormatEndIdx = content.indexOf('</completion_format>');
    // Search starting at completionFormatEndIdx, not from 0 -- task_commit_protocol
    // (earlier in the file) references "<executor_resilience_protocol>" inline in
    // backticks as a forward-pointer, which is a different occurrence than the
    // actual block-opening tag this test is locating.
    const resilienceBlockIdx = content.indexOf('<executor_resilience_protocol>', completionFormatEndIdx);
    const successCriteriaIdx = content.indexOf('<success_criteria>');

    assert.notStrictEqual(completionFormatEndIdx, -1, 'completion_format block must still exist');
    assert.notStrictEqual(resilienceBlockIdx, -1, 'executor_resilience_protocol block must exist');
    assert.notStrictEqual(successCriteriaIdx, -1, 'success_criteria block must still exist');

    assert.ok(completionFormatEndIdx < resilienceBlockIdx, 'resilience protocol must come after completion_format');
    assert.ok(resilienceBlockIdx < successCriteriaIdx, 'resilience protocol must come before success_criteria');
  });

  test('self-stop rule is headroom-based with a 95% ceiling and anti-stall guard, documents stopping as correct behavior (not a failure), and writes EXECUTOR-HANDOFF.json', () => {
    const content = readGsdExecutor();
    const resilienceBlockIdx = content.indexOf('<executor_resilience_protocol>');
    const resilienceBlockEndIdx = content.indexOf('</executor_resilience_protocol>');
    const section = content.slice(resilienceBlockIdx, resilienceBlockEndIdx);

    assert.match(section, /headroom, not a flat percentage/, 'must document the headroom-based stop rule');
    assert.match(section, />= 95%/, 'must document the 95% absolute ceiling');
    assert.match(section, /Anti-stall guard/, 'must include the anti-stall guard so small-window models cannot loop into permanent handoffs');
    assert.match(section, /## PLAN BLOCKED/, 'anti-stall guard must define the PLAN BLOCKED escape for tasks that cannot fit any window');
    assert.match(section, /CORRECT behavior/, 'must state that stopping cleanly is correct behavior');
    assert.match(section, /never a failure/, 'must explicitly state this is never a failure');
    assert.match(section, /EXECUTOR-HANDOFF\.json/, 'must write EXECUTOR-HANDOFF.json');
    assert.match(section, /TASK-CHECKPOINT\.json/, 'must also commit TASK-CHECKPOINT.json alongside the handoff');
    assert.match(section, /## PLAN INTERRUPTED — continuation needed/, 'must return the PLAN INTERRUPTED completion format instead of PLAN COMPLETE');
    assert.match(section, /"reason": "context_pressure"/, 'EXECUTOR-HANDOFF.json schema must include reason: context_pressure');
  });

  test('task_commit_protocol step 6 writes TASK-CHECKPOINT.json after every task commit', () => {
    const content = readGsdExecutor();
    const protocolIdx = content.indexOf('<task_commit_protocol>');
    const protocolEndIdx = content.indexOf('</task_commit_protocol>');
    assert.notStrictEqual(protocolIdx, -1, 'task_commit_protocol block must exist');
    const section = content.slice(protocolIdx, protocolEndIdx);

    assert.match(section, /TASK-CHECKPOINT\.json/, 'task_commit_protocol must write TASK-CHECKPOINT.json');
    assert.match(section, /overwrite-latest/, 'must document the overwrite-latest convention');
    assert.match(section, /NOT committed per-task/, 'must document that this file is not committed per-task');
  });

  test('references/resilience.md is linked from agents/gsd-executor.md', () => {
    const content = readGsdExecutor();
    assert.match(content, /@get-shit-done\/references\/resilience\.md/, 'gsd-executor.md must point to the resilience protocol reference doc');
  });
});

describe('Phase 52-01: skew detection (computeManifestDrift / cmdDoctor)', () => {
  const { computeManifestDrift } = require(TOOLS_PATH);

  test('identical maps -> clean: true, drifted: []', () => {
    const installed = { 'a.js': 'hash1', 'b.js': 'hash2' };
    const current = { 'a.js': 'hash1', 'b.js': 'hash2' };
    const result = computeManifestDrift(installed, current);
    assert.strictEqual(result.clean, true);
    assert.deepStrictEqual(result.drifted, []);
  });

  test('one file with a different hash -> hash_mismatch', () => {
    const installed = { 'a.js': 'hash1', 'b.js': 'hash2' };
    const current = { 'a.js': 'hash1', 'b.js': 'DIFFERENT' };
    const result = computeManifestDrift(installed, current);
    assert.strictEqual(result.clean, false);
    assert.deepStrictEqual(result.drifted, [{ path: 'b.js', reason: 'hash_mismatch' }]);
  });

  test('file present in installed but absent from current -> missing_in_source', () => {
    const installed = { 'a.js': 'hash1', 'gone.js': 'hash2' };
    const current = { 'a.js': 'hash1' };
    const result = computeManifestDrift(installed, current);
    assert.strictEqual(result.clean, false);
    assert.deepStrictEqual(result.drifted, [{ path: 'gone.js', reason: 'missing_in_source' }]);
  });

  test('file present ONLY in current (new file added post-manifest) is NOT reported as drift', () => {
    const installed = { 'a.js': 'hash1' };
    const current = { 'a.js': 'hash1', 'new-file.js': 'hash-new' };
    const result = computeManifestDrift(installed, current);
    assert.strictEqual(result.clean, true);
    assert.deepStrictEqual(result.drifted, []);
  });

  test('reproduces the exact skew class this milestone hit: stale hash vs current hash for one known file', () => {
    const knownFile = 'get-shit-done/workflows/execute-roadmap.md';
    const staleInstalled = { [knownFile]: 'stale-hash-abc123' };
    const driftedCurrent = { [knownFile]: 'current-hash-xyz789' };
    const drift = computeManifestDrift(staleInstalled, driftedCurrent);
    assert.strictEqual(drift.clean, false);
    assert.strictEqual(drift.drifted.length, 1);
    assert.deepStrictEqual(drift.drifted[0], { path: knownFile, reason: 'hash_mismatch' });

    const matchingInstalled = { [knownFile]: 'same-hash-abc123' };
    const matchingCurrent = { [knownFile]: 'same-hash-abc123' };
    const clean = computeManifestDrift(matchingInstalled, matchingCurrent);
    assert.strictEqual(clean.clean, true);
    assert.deepStrictEqual(clean.drifted, []);
  });

  describe('cmdDoctor via CLI', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    test('--config-dir pointed at a tmp dir with no manifest -> exit 0, "No installed manifest found"', () => {
      const emptyConfigDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-doctor-empty-'));
      try {
        const result = runGsdTools(`doctor --config-dir "${emptyConfigDir}"`, tmpDir);
        assert.ok(result.success, `command should exit 0: ${result.error}`);
        assert.match(result.output, /No installed manifest found/);
      } finally {
        cleanup(emptyConfigDir);
      }
    });

    test('fixture with drifted file -> --raw JSON reports clean: false and the drifted path', () => {
      const configDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-doctor-config-'));
      const sourceCheckout = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-doctor-checkout-'));
      try {
        // Sentinel file proving this cwd is treated as a GSD source checkout.
        fs.mkdirSync(path.join(sourceCheckout, 'get-shit-done', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(sourceCheckout, 'get-shit-done', 'bin', 'gsd-tools.js'), '// sentinel\n');
        // A second tracked file whose real hash will differ from the manifest's
        // recorded (deliberately bogus) hash for that same path.
        fs.writeFileSync(path.join(sourceCheckout, 'get-shit-done', 'other.js'), '// real current content\n');

        const manifest = {
          version: '0.0.0-test',
          timestamp: new Date().toISOString(),
          files: {
            'get-shit-done/other.js': '0'.repeat(64), // bogus hash, guaranteed mismatch
          },
          // No source_git_sha -- forces the full-hash-diff path, not the git-SHA fast path.
        };
        fs.writeFileSync(path.join(configDir, 'gsd-file-manifest.json'), JSON.stringify(manifest, null, 2));

        const result = runGsdTools(`doctor --config-dir "${configDir}" --raw`, sourceCheckout);
        assert.ok(result.success, `command should exit 0: ${result.error}`);
        const parsed = JSON.parse(result.output);
        assert.strictEqual(parsed.ok, true);
        assert.strictEqual(parsed.clean, false);
        assert.strictEqual(parsed.method, 'file_hash');
        assert.ok(
          parsed.drifted.some((d) => d.path === 'get-shit-done/other.js' && d.reason === 'hash_mismatch'),
          `expected drifted path get-shit-done/other.js, got: ${JSON.stringify(parsed.drifted)}`
        );
      } finally {
        cleanup(configDir);
        cleanup(sourceCheckout);
      }
    });

    test('cwd that is NOT a GSD source checkout -> reports not_a_source_checkout, never attempts a hash diff', () => {
      const configDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-doctor-config-'));
      const notACheckout = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-doctor-notcheckout-'));
      try {
        const manifest = {
          version: '0.0.0-test',
          timestamp: new Date().toISOString(),
          files: { 'get-shit-done/other.js': '0'.repeat(64) },
        };
        fs.writeFileSync(path.join(configDir, 'gsd-file-manifest.json'), JSON.stringify(manifest, null, 2));

        const result = runGsdTools(`doctor --config-dir "${configDir}" --raw`, notACheckout);
        assert.ok(result.success, `command should exit 0: ${result.error}`);
        const parsed = JSON.parse(result.output);
        assert.strictEqual(parsed.reason, 'not_a_source_checkout');
        assert.strictEqual(parsed.clean, undefined, 'hash diff must never be attempted when not a source checkout');
        assert.strictEqual(parsed.drifted, undefined, 'hash diff must never be attempted when not a source checkout');
      } finally {
        cleanup(configDir);
        cleanup(notACheckout);
      }
    });
  });
});

describe('Phase 52-01: SessionStart skew-check helpers + execute-roadmap.md preflight_skew_check wiring', () => {
  const HOOK_PATH = path.join(__dirname, '..', '..', 'hooks', 'gsd-check-update.js');

  test('shouldCheckSkew(cwd): true when <cwd>/get-shit-done/bin/gsd-tools.js exists', () => {
    const { shouldCheckSkew } = require(HOOK_PATH);
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-skew-cwd-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'get-shit-done', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'get-shit-done', 'bin', 'gsd-tools.js'), '// sentinel\n');
      assert.strictEqual(shouldCheckSkew(tmpDir), true);
    } finally {
      cleanup(tmpDir);
    }
  });

  test('shouldCheckSkew(cwd): false when the sentinel file does not exist', () => {
    const { shouldCheckSkew } = require(HOOK_PATH);
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-skew-cwd-'));
    try {
      assert.strictEqual(shouldCheckSkew(tmpDir), false);
    } finally {
      cleanup(tmpDir);
    }
  });

  test('buildSkewCachePayload: clean doctor result', () => {
    const { buildSkewCachePayload } = require(HOOK_PATH);
    const payload = buildSkewCachePayload({ clean: true, drifted: [] });
    assert.strictEqual(payload.clean, true);
    assert.strictEqual(payload.drifted_count, 0);
    assert.strictEqual(typeof payload.checked, 'number');
  });

  test('buildSkewCachePayload: drifted doctor result with 2 entries', () => {
    const { buildSkewCachePayload } = require(HOOK_PATH);
    const payload = buildSkewCachePayload({ clean: false, drifted: [{ path: 'a' }, { path: 'b' }] });
    assert.strictEqual(payload.clean, false);
    assert.strictEqual(payload.drifted_count, 2);
    assert.strictEqual(typeof payload.checked, 'number');
  });

  test('buildSkewCachePayload: malformed/undefined input never throws, returns a safe default shape', () => {
    const { buildSkewCachePayload } = require(HOOK_PATH);
    const payload = buildSkewCachePayload(undefined);
    assert.strictEqual(payload.clean, false);
    assert.strictEqual(payload.drifted_count, 0);
  });

  test('requiring hooks/gsd-check-update.js does not spawn a child process or throw (require.main guard)', () => {
    assert.doesNotThrow(() => {
      delete require.cache[require.resolve(HOOK_PATH)];
      require(HOOK_PATH);
    });
  });

  describe('execute-roadmap.md preflight_skew_check wiring', () => {
    const REPO_ROOT = path.join(__dirname, '..', '..');

    function readExecuteRoadmap() {
      return fs.readFileSync(path.join(REPO_ROOT, 'get-shit-done', 'workflows', 'execute-roadmap.md'), 'utf-8');
    }

    test('preflight_skew_check step exists and calls gsd-tools.js doctor --raw', () => {
      const content = readExecuteRoadmap();
      assert.match(content, /<step name="preflight_skew_check">/);
      assert.match(content, /doctor --raw/);
    });

    test('preflight_skew_check is positioned after preflight_quota_estimate and before confirm_execution', () => {
      const content = readExecuteRoadmap();
      const quotaIdx = content.indexOf('<step name="preflight_quota_estimate">');
      const skewIdx = content.indexOf('<step name="preflight_skew_check">');
      const confirmIdx = content.indexOf('<step name="confirm_execution">');
      assert.notStrictEqual(quotaIdx, -1);
      assert.notStrictEqual(skewIdx, -1);
      assert.notStrictEqual(confirmIdx, -1);
      assert.ok(quotaIdx < skewIdx, 'preflight_skew_check must come after preflight_quota_estimate');
      assert.ok(skewIdx < confirmIdx, 'preflight_skew_check must come before confirm_execution');
    });

    test('logs --type skew_detected only inside the not-clean branch', () => {
      const content = readExecuteRoadmap();
      const skewIdx = content.indexOf('<step name="preflight_skew_check">');
      const nextStepIdx = content.indexOf('<step name="confirm_execution">');
      const section = content.slice(skewIdx, nextStepIdx);
      assert.match(section, /--type skew_detected/);
      const notCleanIdx = section.indexOf('if [ "$CLEAN" != "true" ]');
      const skewDetectedIdx = section.indexOf('--type skew_detected');
      assert.notStrictEqual(notCleanIdx, -1);
      assert.ok(notCleanIdx < skewDetectedIdx, 'skew_detected event must be logged inside the not-clean branch');
    });

    test('preflight_quota_estimate and confirm_execution sections are otherwise unchanged (regression spot-check)', () => {
      const content = readExecuteRoadmap();
      assert.match(content, /resilience estimate-quota/, 'preflight_quota_estimate content must still be present');
      assert.match(content, /quota_preflight_ok/, 'preflight_quota_estimate content must still be present');
    });
  });
});

describe('Phase 52-02: telemetry append/summarize', () => {
  const { summarizeTelemetryReports, appendTelemetryReport, readTelemetryReports } = require(TOOLS_PATH);

  test('summarizeTelemetryReports([]) returns the safe empty-summary shape', () => {
    const result = summarizeTelemetryReports([]);
    assert.deepStrictEqual(result, {
      count: 0,
      avg_context_pressure: null,
      total_tool_errors_swallowed: 0,
      instructions_not_followed_by_rule: {},
      top_ambiguities: [],
    });
  });

  test('overlapping instructions_not_followed rule names sum per-rule counts across reports', () => {
    const reports = [
      { instructions_not_followed: [{ rule: 'rule-A', why: 'x' }, { rule: 'rule-B', why: 'y' }] },
      { instructions_not_followed: [{ rule: 'rule-A', why: 'z' }] },
      { instructions_not_followed: [{ rule: 'rule-A', why: 'w' }, { rule: 'rule-B', why: 'v' }] },
    ];
    const result = summarizeTelemetryReports(reports);
    assert.strictEqual(result.instructions_not_followed_by_rule['rule-A'], 3);
    assert.strictEqual(result.instructions_not_followed_by_rule['rule-B'], 2);
  });

  test('avg_context_pressure only averages over reports where context_pressure is a number (nulls/missing excluded, not treated as 0)', () => {
    const reports = [
      { context_pressure: 0.5 },
      { context_pressure: null },
      { context_pressure: 0.9 },
      {}, // missing entirely
    ];
    const result = summarizeTelemetryReports(reports);
    assert.strictEqual(result.avg_context_pressure, 0.7);
  });

  test('total_tool_errors_swallowed sums across all reports', () => {
    const reports = [
      { tool_errors_swallowed: 2 },
      { tool_errors_swallowed: 3 },
      { tool_errors_swallowed: 0 },
      {}, // missing -> treated as 0, not skipped
    ];
    const result = summarizeTelemetryReports(reports);
    assert.strictEqual(result.total_tool_errors_swallowed, 5);
  });

  test('top_ambiguities dedupes identical strings across reports, sorts by frequency descending, capped at 5', () => {
    const reports = [
      { ambiguities: ['ambiguous instruction A', 'ambiguous instruction B'] },
      { ambiguities: ['ambiguous instruction A'] },
      { ambiguities: ['ambiguous instruction A', 'ambiguous instruction C'] },
      { ambiguities: ['ambiguous instruction D'] },
      { ambiguities: ['ambiguous instruction E'] },
      { ambiguities: ['ambiguous instruction F'] },
      { ambiguities: ['ambiguous instruction G'] },
    ];
    const result = summarizeTelemetryReports(reports);
    assert.strictEqual(result.top_ambiguities.length, 5);
    assert.strictEqual(result.top_ambiguities[0].text, 'ambiguous instruction A');
    assert.strictEqual(result.top_ambiguities[0].count, 3);
    // Descending order check
    for (let i = 1; i < result.top_ambiguities.length; i++) {
      assert.ok(result.top_ambiguities[i - 1].count >= result.top_ambiguities[i].count);
    }
  });

  describe('appendTelemetryReport / readTelemetryReports round-trip', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    test('appends 2 reports, reads them back with correct shape and field values', () => {
      appendTelemetryReport(tmpDir, 'gsd-executor', '52', {
        context_pressure: 0.4,
        instructions_not_followed: [{ rule: 'Rule 1', why: 'test' }],
        ambiguities: ['unclear thing'],
        tool_errors_swallowed: 1,
      });
      appendTelemetryReport(tmpDir, 'gsd-verifier', '52', {
        context_pressure: 0.6,
        instructions_not_followed: [],
        ambiguities: [],
        tool_errors_swallowed: 0,
      });

      const reports = readTelemetryReports(tmpDir);
      assert.strictEqual(reports.length, 2);
      assert.strictEqual(reports[0].agent, 'gsd-executor');
      assert.strictEqual(reports[0].phase, '52');
      assert.strictEqual(reports[0].context_pressure, 0.4);
      assert.deepStrictEqual(reports[0].instructions_not_followed, [{ rule: 'Rule 1', why: 'test' }]);
      assert.deepStrictEqual(reports[0].ambiguities, ['unclear thing']);
      assert.strictEqual(reports[0].tool_errors_swallowed, 1);
      assert.strictEqual(reports[1].agent, 'gsd-verifier');
      assert.strictEqual(typeof reports[0].timestamp, 'string');
      assert.strictEqual(typeof reports[1].timestamp, 'string');
    });

    test('agent/phase/timestamp are always present even when the caller passes no fields at all', () => {
      appendTelemetryReport(tmpDir, 'gsd-phase-coordinator', '52', undefined);
      const reports = readTelemetryReports(tmpDir);
      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].agent, 'gsd-phase-coordinator');
      assert.strictEqual(reports[0].phase, '52');
      assert.strictEqual(typeof reports[0].timestamp, 'string');
      assert.ok(reports[0].timestamp.length > 0);
    });

    test('omitting instructions_not_followed/ambiguities/tool_errors_swallowed/context_pressure entirely gets safe defaults, never undefined', () => {
      appendTelemetryReport(tmpDir, 'gsd-executor', '52', {});
      const reports = readTelemetryReports(tmpDir);
      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].context_pressure, null);
      assert.deepStrictEqual(reports[0].instructions_not_followed, []);
      assert.deepStrictEqual(reports[0].ambiguities, []);
      assert.strictEqual(reports[0].tool_errors_swallowed, 0);
      // Never undefined
      assert.notStrictEqual(reports[0].context_pressure, undefined);
      assert.notStrictEqual(reports[0].instructions_not_followed, undefined);
      assert.notStrictEqual(reports[0].ambiguities, undefined);
      assert.notStrictEqual(reports[0].tool_errors_swallowed, undefined);
    });

    test('a malformed line manually injected into the JSONL file is skipped (with a warning), remaining valid lines still returned', () => {
      appendTelemetryReport(tmpDir, 'gsd-executor', '52', { context_pressure: 0.3 });
      const telemetryPath = path.join(tmpDir, '.planning', 'telemetry', 'agent-reports.jsonl');
      fs.appendFileSync(telemetryPath, 'NOT VALID JSON\n');
      appendTelemetryReport(tmpDir, 'gsd-verifier', '52', { context_pressure: 0.5 });

      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (msg) => warnings.push(msg);
      let reports;
      try {
        reports = readTelemetryReports(tmpDir);
      } finally {
        console.warn = originalWarn;
      }
      assert.strictEqual(reports.length, 2, 'malformed line must be skipped, not thrown');
      assert.strictEqual(reports[0].agent, 'gsd-executor');
      assert.strictEqual(reports[1].agent, 'gsd-verifier');
      assert.ok(warnings.some((w) => /malformed telemetry/i.test(w)), 'expected a console.warn about the malformed line');
    });
  });

  describe('telemetry CLI smoke test', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    test('telemetry append followed by telemetry summarize reflects appended values', () => {
      const appendResult = runGsdTools(
        `telemetry append --agent gsd-executor --phase 52 --context-pressure 0.4 --tool-errors-swallowed 2`,
        tmpDir
      );
      assert.ok(appendResult.success, `append should exit 0: ${appendResult.error}`);

      const summarizeResult = runGsdTools('telemetry summarize --raw', tmpDir);
      assert.ok(summarizeResult.success, `summarize should exit 0: ${summarizeResult.error}`);
      const summary = JSON.parse(summarizeResult.output);
      assert.strictEqual(summary.count, 1);
      assert.strictEqual(summary.avg_context_pressure, 0.4);
      assert.strictEqual(summary.total_tool_errors_swallowed, 2);
    });
  });
});

describe('Phase 52-02: Self-Report Telemetry (analytics.js section + agent-file wiring)', () => {
  const ANALYTICS_PATH = path.join(__dirname, 'analytics.js');
  const REPO_ROOT = path.join(__dirname, '..', '..');

  describe('analytics.js generateReport() Self-Report Telemetry section', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
      // Base EXECUTION_LOG.md fixture so generateReport doesn't early-return
      // on "no execution history found" before reaching the telemetry section.
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'EXECUTION_LOG.md'),
        '{"type":"phase_start","phase":1,"timestamp":"2026-01-01T00:00:00Z","name":"fixture-phase"}\n' +
        '{"type":"phase_complete","phase":1,"timestamp":"2026-01-01T01:00:00Z","name":"fixture-phase"}\n'
      );
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    test('renders "## Self-Report Telemetry" with correct aggregate values when 2+ reports exist', () => {
      delete require.cache[require.resolve(ANALYTICS_PATH)];
      delete require.cache[require.resolve(TOOLS_PATH)];
      const { appendTelemetryReport } = require(TOOLS_PATH);
      appendTelemetryReport(tmpDir, 'gsd-executor', '1', {
        context_pressure: 0.3,
        instructions_not_followed: [{ rule: 'Rule 1', why: 'test' }],
        ambiguities: ['ambiguity A'],
        tool_errors_swallowed: 1,
      });
      appendTelemetryReport(tmpDir, 'gsd-verifier', '1', {
        context_pressure: 0.7,
        instructions_not_followed: [{ rule: 'Rule 1', why: 'test2' }],
        ambiguities: ['ambiguity A'],
        tool_errors_swallowed: 2,
      });

      const { generateReport } = require(ANALYTICS_PATH);
      const report = generateReport(tmpDir);

      assert.match(report, /## Self-Report Telemetry/);
      assert.match(report, /\| Reports \| 2 \|/);
      assert.match(report, /Avg context pressure \| 0\.50 \|/);
      assert.match(report, /Total tool errors swallowed \| 3 \|/);
      assert.match(report, /Rule 1: 2/);
      assert.match(report, /ambiguity A \(2\)/);
    });

    test('omits "## Self-Report Telemetry" heading entirely when no telemetry file is present', () => {
      delete require.cache[require.resolve(ANALYTICS_PATH)];
      const { generateReport } = require(ANALYTICS_PATH);
      const report = generateReport(tmpDir);

      assert.doesNotMatch(report, /## Self-Report Telemetry/);
    });
  });

  describe('agent-file wiring: grep assertions with regression guards', () => {
    // Phase 53-02 (MILE-30): several of these agents were restructured
    // hard-rules-first, relocating detail (e.g. the PLAN FAILED blocks,
    // the Return to Orchestrator section body) to
    // @get-shit-done/references/*-detail.md. Use effective (core + resolved
    // @-include) content so these assertions still find the unchanged text
    // regardless of which physical file it now lives in.
    function readAgentFile(name) {
      return readEffectiveAgentContent(path.join(REPO_ROOT, 'agents', name));
    }

    test('gsd-phase-coordinator.md: all 4 field names present inside <return_state> section specifically', () => {
      const content = readAgentFile('gsd-phase-coordinator.md');
      const startIdx = content.indexOf('<return_state>');
      const endIdx = content.indexOf('</return_state>');
      assert.notStrictEqual(startIdx, -1, '<return_state> must exist');
      assert.notStrictEqual(endIdx, -1, '</return_state> must exist');
      const section = content.slice(startIdx, endIdx);

      for (const field of ['context_pressure', 'instructions_not_followed', 'ambiguities', 'tool_errors_swallowed']) {
        assert.match(section, new RegExp(field), `${field} must appear inside <return_state>`);
      }
    });

    test('gsd-phase-coordinator.md regression guard: pre-existing status enum literal still present', () => {
      const content = readAgentFile('gsd-phase-coordinator.md');
      assert.match(content, /"status": "completed \| failed \| blocked \| gaps_found \| human_needed"/, 'pre-existing status enum literal must not have been removed');
    });

    test('gsd-executor.md: all 4 field names present in PLAN COMPLETE <completion_format> AND both PLAN FAILED blocks (3 index-bounded checks)', () => {
      const content = readAgentFile('gsd-executor.md');
      const fields = ['context_pressure', 'instructions_not_followed', 'ambiguities', 'tool_errors_swallowed'];

      // Check 1: <completion_format> PLAN COMPLETE template
      const cfStart = content.indexOf('<completion_format>');
      const cfEnd = content.indexOf('</completion_format>');
      assert.notStrictEqual(cfStart, -1, '<completion_format> must exist');
      assert.notStrictEqual(cfEnd, -1, '</completion_format> must exist');
      const completionSection = content.slice(cfStart, cfEnd);
      for (const field of fields) {
        assert.match(completionSection, new RegExp(field), `${field} must appear inside <completion_format>`);
      }

      // Check 2: first PLAN FAILED block (test task blocked execution)
      const pf1Start = content.indexOf('## PLAN FAILED: Test task blocked execution');
      assert.notStrictEqual(pf1Start, -1, 'first PLAN FAILED block must exist');
      const pf1End = content.indexOf('Do NOT log as a "gap" and continue', pf1Start);
      assert.notStrictEqual(pf1End, -1);
      const pf1Section = content.slice(pf1Start, pf1End);
      for (const field of fields) {
        assert.match(pf1Section, new RegExp(field), `${field} must appear inside the first PLAN FAILED block`);
      }

      // Check 3: second PLAN FAILED block (test gate blocked SUMMARY.md creation)
      const pf2Start = content.indexOf('## PLAN FAILED: Test gate blocked SUMMARY.md creation');
      assert.notStrictEqual(pf2Start, -1, 'second PLAN FAILED block must exist');
      const pf2End = content.indexOf('Do NOT proceed to `<summary_creation>`', pf2Start);
      assert.notStrictEqual(pf2End, -1);
      const pf2Section = content.slice(pf2Start, pf2End);
      for (const field of fields) {
        assert.match(pf2Section, new RegExp(field), `${field} must appear inside the second PLAN FAILED block`);
      }
    });

    test('gsd-executor.md regression guard: pre-existing "**Duration:** {time}" literal still present', () => {
      const content = readAgentFile('gsd-executor.md');
      assert.match(content, /\*\*Duration:\*\* \{time\}/, 'pre-existing Duration line must not have been removed');
    });

    test('gsd-verifier.md: all 4 field names present inside "## Return to Orchestrator" section specifically', () => {
      const content = readAgentFile('gsd-verifier.md');
      const startIdx = content.indexOf('## Return to Orchestrator');
      const endIdx = content.indexOf('</output>', startIdx);
      assert.notStrictEqual(startIdx, -1, '## Return to Orchestrator must exist');
      assert.notStrictEqual(endIdx, -1, '</output> boundary after it must exist');
      const section = content.slice(startIdx, endIdx);

      for (const field of ['context_pressure', 'instructions_not_followed', 'ambiguities', 'tool_errors_swallowed']) {
        assert.match(section, new RegExp(field), `${field} must appear inside ## Return to Orchestrator`);
      }
    });

    test('gsd-verifier.md regression guard: pre-existing "**Score:** {N}/{M} must-haves verified" literal still present', () => {
      const content = readAgentFile('gsd-verifier.md');
      assert.match(content, /\*\*Score:\*\* \{N\}\/\{M\} must-haves verified/, 'pre-existing Score line must not have been removed');
    });
  });
});

describe('Phase 52-03: countAssertions namespace-style fix', () => {
  const { countAssertions, countTestCalls } = resilience;

  test('bare assert( is counted', () => {
    assert.strictEqual(countAssertions('assert(x);'), 1);
  });

  test('assert.equal( namespace-style is counted', () => {
    assert.strictEqual(countAssertions('assert.equal(a, b);'), 1);
  });

  test('assert.deepStrictEqual( namespace-style is counted', () => {
    assert.strictEqual(countAssertions('assert.deepStrictEqual(a, b);'), 1);
  });

  test('expect( is still counted', () => {
    assert.strictEqual(countAssertions('expect(x).toBe(y);'), 1);
  });

  test('mixed fixture: 2x assert.equal(, 1x assert(, 3x expect( -> 6', () => {
    const content = [
      'assert.equal(a, b);',
      'assert.equal(c, d);',
      'assert(flag);',
      'expect(one).toBe(1);',
      'expect(two).toEqual(2);',
      'expect(three).toBeTruthy();',
    ].join('\n');
    assert.strictEqual(countAssertions(content), 6);
  });

  test('empty/nullish content -> 0', () => {
    assert.strictEqual(countAssertions(''), 0);
    assert.strictEqual(countAssertions(null), 0);
    assert.strictEqual(countAssertions(undefined), 0);
  });

  // Regression guard: countTestCalls (the neighboring function) must NOT change.
  test('regression: countTestCalls excludes it.skip(', () => {
    assert.strictEqual(countTestCalls('it.skip("x", () => {});'), 0);
  });

  test('regression: countTestCalls excludes test.skip(', () => {
    assert.strictEqual(countTestCalls('test.skip("x", () => {});'), 0);
  });

  test('regression: countTestCalls counts plain it(', () => {
    assert.strictEqual(countTestCalls('it("x", () => {});'), 1);
  });

  test('regression: countTestCalls counts plain test(', () => {
    assert.strictEqual(countTestCalls('test("x", () => {});'), 1);
  });
});

// ─── Phase 53-01: eval CLI (plan/assert) ─────────────────────────────────────
describe('Phase 53-01: eval CLI (plan/assert)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-eval-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Like runGsdTools but also surfaces the real process exit code (needed
  // here because `eval assert` uses distinct exit codes: 0 pass, 1 fail,
  // 2 malformed/missing artifacts input -- mirrors the verify phase-gate
  // test helper's runPhaseGate pattern above).
  function runEvalCli(args, cwd) {
    try {
      const result = execSync(`node "${TOOLS_PATH}" ${args}`, {
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

  function writeMinimalFixtureRoadmap(fixtureDir) {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'ROADMAP.md'),
      '# Roadmap: Tmp Fixture\n\n' +
      '#### Phase 01: Add function\n**Goal**: add works.\n\n' +
      '#### Phase 02: Multiply function\n**Goal**: multiply works.\n'
    );
  }

  function fullyPassingExpectedPlan() {
    return [
      { phase: '01-add-function', agent: 'gsd-phase-researcher', tier: 'haiku' },
      { phase: '01-add-function', agent: 'gsd-planner', tier: 'haiku' },
      { phase: '01-add-function', agent: 'gsd-executor', tier: 'haiku' },
      { phase: '01-add-function', agent: 'gsd-verifier', tier: 'haiku' },
      { phase: '02-multiply-function', agent: 'gsd-phase-researcher', tier: 'haiku' },
      { phase: '02-multiply-function', agent: 'gsd-planner', tier: 'haiku' },
      { phase: '02-multiply-function', agent: 'gsd-executor', tier: 'haiku' },
      { phase: '02-multiply-function', agent: 'gsd-verifier', tier: 'haiku' },
    ];
  }

  function buildArtifactsDir(root, { includeDeferred = true } = {}) {
    fs.mkdirSync(path.join(root, 'phases', '01-add-function'), { recursive: true });
    fs.mkdirSync(path.join(root, 'phases', '02-multiply-function'), { recursive: true });

    fs.writeFileSync(path.join(root, 'phases', '01-add-function', '01-01-VERIFICATION.md'), '**Status:** passed\n');
    fs.writeFileSync(path.join(root, 'phases', '02-multiply-function', '02-01-VERIFICATION.md'), '**Status:** passed\n');

    if (includeDeferred) {
      fs.writeFileSync(path.join(root, 'phases', '02-multiply-function', 'DEFERRED.json'), JSON.stringify([
        { step: 'lookup-shared-constant', reason: 'lookup host unreachable', approver: 'executor', phase: '02', timestamp: '2026-07-05T00:00:00Z' },
      ]));
    }

    const expectedPlan = fullyPassingExpectedPlan();
    fs.writeFileSync(path.join(root, 'spawn-trace.json'), JSON.stringify(
      expectedPlan.map(e => ({ ...e, timestamp: '2026-07-05T00:00:00Z' }))
    ));

    fs.writeFileSync(path.join(root, 'git-log.txt'),
      'abc123 feat(01-01): task 1 implement add\n' +
      'abc456 feat(02-01): task 1 implement multiply\n'
    );

    fs.writeFileSync(path.join(root, 'expectations.json'), JSON.stringify({
      expectedPlan,
      expectSkip: { '01-add-function': false, '02-multiply-function': true },
      expectedCommitCount: 2,
    }));
  }

  describe('eval plan', () => {
    test('--fixture <dir> --raw against a minimal 2-phase ROADMAP.md prints valid JSON matching buildSpawnPlan shape, exits 0', () => {
      const fixtureDir = path.join(tmpDir, 'fixture');
      writeMinimalFixtureRoadmap(fixtureDir);

      const result = runEvalCli('eval plan --fixture fixture --raw', tmpDir);
      assert.ok(result.success, `eval plan should exit 0: ${result.error}`);
      assert.strictEqual(result.exitCode, 0);

      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.length, 8);
      assert.strictEqual(parsed[0].phase, '01-add-function');
      assert.strictEqual(parsed[0].agent, 'gsd-phase-researcher');
      assert.strictEqual(parsed[0].tier, 'haiku');
      assert.strictEqual(parsed[7].agent, 'gsd-verifier');
    });
  });

  describe('eval assert', () => {
    test('artifacts dir built to fully satisfy all four checks -> pass:true, exit 0', () => {
      const artifactsDir = path.join(tmpDir, 'artifacts');
      buildArtifactsDir(artifactsDir);

      const result = runEvalCli('eval assert artifacts --raw', tmpDir);
      assert.ok(result.success, `eval assert should exit 0: ${result.error}`);
      assert.strictEqual(result.exitCode, 0);

      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.pass, true);
      assert.strictEqual(parsed.checks.agents_spawned.pass, true);
      assert.strictEqual(parsed.checks.gates_fired.pass, true);
      assert.strictEqual(parsed.checks.deferred_written.pass, true);
      assert.strictEqual(parsed.checks.commits_atomic.pass, true);
    });

    test('missing DEFERRED.json where one was expected -> pass:false, checks.deferred_written.pass:false, exit 1', () => {
      const artifactsDir = path.join(tmpDir, 'artifacts');
      buildArtifactsDir(artifactsDir, { includeDeferred: false });

      const result = runEvalCli('eval assert artifacts --raw', tmpDir);
      assert.strictEqual(result.success, false, 'eval assert should exit non-zero when a mandatory gate/deferral is missing');
      assert.strictEqual(result.exitCode, 1);

      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.pass, false);
      assert.strictEqual(parsed.checks.deferred_written.pass, false);
    });

    test('against a nonexistent directory -> clear error, no crash, exits non-zero', () => {
      const result = runEvalCli('eval assert does-not-exist --raw', tmpDir);
      assert.strictEqual(result.success, false);
      assert.notStrictEqual(result.exitCode, 0);

      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'artifacts_dir_not_found');
    });
  });

  describe('eval with no/unknown subcommand', () => {
    test('no subcommand -> "Unknown" / "required" style error, exits non-zero', () => {
      const result = runEvalCli('eval', tmpDir);
      assert.strictEqual(result.success, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.match(result.error, /subcommand required/i);
    });

    test('unknown subcommand -> "Unknown eval subcommand" style error, exits non-zero', () => {
      const result = runEvalCli('eval bogus-subcommand', tmpDir);
      assert.strictEqual(result.success, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.match(result.error, /Unknown eval subcommand/i);
    });
  });
});

// Phase 54-01: buildHandoffBrief (MILE-40). Pure function, required directly
// off the same `resilience` alias used by the Phase 51-02 suite above (both
// point at the same gsd-tools.js module.exports object).
describe('buildHandoffBrief', () => {
  const FULL_FIELDS = {
    phase_number: 54,
    phase_name: 'structured-handoffs',
    phase_goal: 'stay on-constraint',
    key_decisions: ['locked decision a', 'locked decision b'],
    open_risks: 'a single open risk',
    file_map: ['get-shit-done/bin/gsd-tools.js'],
    hard_rules: ['never throw', 'always render 5 sections'],
  };

  const ALL_LABELS = ['PHASE GOAL', 'KEY DECISIONS', 'OPEN RISKS', 'FILE MAP', 'HARD RULES'];

  // Category 1: Happy path.
  test('happy path: fully-populated fields -> complete:true, all 5 labels + phase number/name present', () => {
    const brief = resilience.buildHandoffBrief(FULL_FIELDS);
    assert.strictEqual(brief.complete, true);
    for (const label of ALL_LABELS) {
      assert.ok(brief.brief_text.includes(label), `expected brief_text to include label "${label}"`);
    }
    assert.ok(brief.brief_text.includes('54'), 'expected phase number to appear in brief_text');
    assert.ok(brief.brief_text.includes('structured-handoffs'), 'expected phase name to appear in brief_text');
  });

  // Category 2: Missing/malformed input.
  test('missing/malformed input: fields={} -> complete:false, all 5 labels still present with "(none provided)"', () => {
    const brief = resilience.buildHandoffBrief({});
    assert.strictEqual(brief.complete, false);
    for (const label of ALL_LABELS) {
      assert.ok(brief.brief_text.includes(label), `expected brief_text to include label "${label}"`);
    }
    const noneProvidedCount = (brief.brief_text.match(/\(none provided\)/g) || []).length;
    assert.strictEqual(noneProvidedCount, 5);
  });

  test('missing/malformed input: fields=null -> complete:false, no throw', () => {
    assert.doesNotThrow(() => resilience.buildHandoffBrief(null));
    const brief = resilience.buildHandoffBrief(null);
    assert.strictEqual(brief.complete, false);
  });

  test('missing/malformed input: fields=undefined -> complete:false, no throw', () => {
    assert.doesNotThrow(() => resilience.buildHandoffBrief(undefined));
    const brief = resilience.buildHandoffBrief(undefined);
    assert.strictEqual(brief.complete, false);
  });

  // Category 3: Edge case -- array-valued sections and mixed string/array input.
  test('edge case: array-valued section renders one bullet per line', () => {
    const brief = resilience.buildHandoffBrief(FULL_FIELDS);
    assert.ok(brief.sections.key_decisions.includes('- locked decision a'));
    assert.ok(brief.sections.key_decisions.includes('- locked decision b'));
    assert.strictEqual(brief.sections.key_decisions.split('\n').length, 2);
  });

  test('edge case: a mix of string and array section inputs both normalize correctly', () => {
    const brief = resilience.buildHandoffBrief(FULL_FIELDS);
    // open_risks was supplied as a plain string -- normalizes to itself, no bullet.
    assert.strictEqual(brief.sections.open_risks, 'a single open risk');
    // file_map was supplied as an array -- normalizes to a bulleted line.
    assert.strictEqual(brief.sections.file_map, '- get-shit-done/bin/gsd-tools.js');
  });

  // Category 4: Boundary conditions.
  test('boundary: exactly one section blank -> complete:false but the other 4 render their real content', () => {
    const fields = { ...FULL_FIELDS, open_risks: '' };
    const brief = resilience.buildHandoffBrief(fields);
    assert.strictEqual(brief.complete, false);
    assert.strictEqual(brief.sections.open_risks, '');
    assert.ok(brief.brief_text.includes('stay on-constraint'));
    assert.ok(brief.brief_text.includes('- locked decision a'));
    assert.ok(brief.brief_text.includes('- get-shit-done/bin/gsd-tools.js'));
    assert.ok(brief.brief_text.includes('- never throw'));
  });

  test('boundary: whitespace-only string section is treated as empty -> complete:false', () => {
    const fields = { ...FULL_FIELDS, hard_rules: '   ' };
    const brief = resilience.buildHandoffBrief(fields);
    assert.strictEqual(brief.complete, false);
    assert.strictEqual(brief.sections.hard_rules, '');
  });

  // Category 5: Wiring/integration -- sections object matches brief_text content.
  test('wiring: sections object exposes all 5 canonical keys, values match what appears in brief_text', () => {
    const brief = resilience.buildHandoffBrief(FULL_FIELDS);
    const canonicalKeys = ['phase_goal', 'key_decisions', 'open_risks', 'file_map', 'hard_rules'];
    for (const key of canonicalKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(brief.sections, key), `expected sections.${key} to exist`);
      assert.ok(brief.brief_text.includes(brief.sections[key]), `expected brief_text to contain sections.${key}'s value`);
    }
  });

  // Category 6: Regression guard -- buildResumeBrief unaffected by the new adjacent builder.
  test('regression guard: buildResumeBrief still returns its expected shape', () => {
    const checkpointData = { found: false, resume_from: null, last_step: null, step_status: null, plans_complete: null, plans_remaining: null, key_context: null };
    const phaseInfo = { phase_number: '54', phase_name: 'structured-handoffs', directory: '.planning/phases/54-structured-handoffs' };
    const brief = resilience.buildResumeBrief(checkpointData, phaseInfo);
    assert.strictEqual(brief.resume_from, 'discuss');
    assert.ok(typeof brief.brief_text === 'string' && brief.brief_text.length > 0);
  });
});

// Phase 54-02 (MILE-40): resume-brief invariant re-injection. getPhaseInvariantsText
// reads a phase's own ROADMAP.md section VERBATIM (never paraphrased from
// CHECKPOINT.json's key_context or any SUMMARY.md); buildResumeBrief's third
// invariantsText param appends that verbatim text to the resume brief so a
// respawned coordinator re-reads hard rules/success criteria from source.
describe('resume-brief invariant re-injection', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  const PHASE_54_SUCCESS_CRITERION = 'Resume brief re-reads hard rules verbatim from ROADMAP.md, never from a paraphrased summary.';

  function writeRoadmapFixture(dir, { includePhase55 = false } = {}) {
    const lines = [
      '# Roadmap',
      '',
      '### Phase 54: Structured Handoffs & Invariant Re-Injection',
      '',
      '**Goal:** Long runs stay on-constraint across agent boundaries and resumes',
      '**Success Criteria** (what must be TRUE):',
      `  1. ${PHASE_54_SUCCESS_CRITERION}`,
      '  2. Prompt budgets still pass for all agents modified.',
      '',
    ];
    if (includePhase55) {
      lines.push(
        '### Phase 55: Failures-to-Regression Pipeline',
        '',
        '**Goal:** Every failure becomes a permanent regression eval',
        '**Success Criteria** (what must be TRUE):',
        '  1. This sentence belongs to Phase 55 and must NEVER appear in Phase 54 invariants.',
        ''
      );
    }
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'ROADMAP.md'), lines.join('\n'));
  }

  const PHASE_INFO = { phase_number: '54', phase_name: 'structured-handoffs', directory: '.planning/phases/54-structured-handoffs' };

  // Category 1: Happy path.
  test('happy path: buildResumeBrief with invariantsText -> PHASE INVARIANTS block + verbatim text + invariants field set', () => {
    writeRoadmapFixture(tmpDir);
    const invariantsText = resilience.getPhaseInvariantsText(tmpDir, '54');
    assert.ok(invariantsText, 'expected getPhaseInvariantsText to return a non-null section');

    const checkpointData = {
      found: true,
      resume_from: 'execute',
      last_step: 'execute',
      step_status: 'in_progress',
      plans_complete: ['54-01'],
      plans_remaining: ['54-02'],
      key_context: 'Some key context.',
    };

    const brief = resilience.buildResumeBrief(checkpointData, PHASE_INFO, invariantsText);
    assert.ok(brief.brief_text.includes('PHASE INVARIANTS (verbatim from ROADMAP.md'));
    assert.ok(brief.brief_text.includes(invariantsText), 'expected brief_text to contain invariantsText verbatim, byte-for-byte');
    assert.strictEqual(brief.invariants, invariantsText);
  });

  // Category 2: Missing/malformed input.
  test('missing/malformed input: no ROADMAP.md -> getPhaseInvariantsText returns null, no throw', () => {
    // tmpDir has no .planning/ROADMAP.md written by this test.
    assert.doesNotThrow(() => resilience.getPhaseInvariantsText(tmpDir, '54'));
    assert.strictEqual(resilience.getPhaseInvariantsText(tmpDir, '54'), null);
  });

  test('missing/malformed input: buildResumeBrief(invariantsText=null) omits PHASE INVARIANTS block, byte-identical to two-arg call', () => {
    const checkpointData = {
      found: true,
      resume_from: 'execute',
      last_step: 'execute',
      step_status: 'in_progress',
      plans_complete: ['54-01'],
      plans_remaining: ['54-02'],
      key_context: 'Some key context.',
    };
    const twoArgBrief = resilience.buildResumeBrief(checkpointData, PHASE_INFO);
    const threeArgNullBrief = resilience.buildResumeBrief(checkpointData, PHASE_INFO, null);
    assert.strictEqual(threeArgNullBrief.brief_text, twoArgBrief.brief_text);
    assert.ok(!threeArgNullBrief.brief_text.includes('PHASE INVARIANTS'));
    assert.strictEqual(threeArgNullBrief.invariants, null);
  });

  // Category 3: Edge case -- verbatim-containment guarantee.
  test('edge case: a success-criterion sentence from the fixture ROADMAP appears exactly (verbatim) in brief_text', () => {
    writeRoadmapFixture(tmpDir);
    const invariantsText = resilience.getPhaseInvariantsText(tmpDir, '54');
    const checkpointData = { found: false, resume_from: null, last_step: null, step_status: null, plans_complete: null, plans_remaining: null, key_context: null };

    const brief = resilience.buildResumeBrief(checkpointData, PHASE_INFO, invariantsText);
    assert.ok(brief.brief_text.includes(PHASE_54_SUCCESS_CRITERION), 'expected the exact success-criterion sentence to appear verbatim (containment, not paraphrase)');
  });

  // Category 4: Boundary conditions.
  test('boundary: found:false (from-scratch) resume STILL appends PHASE INVARIANTS block when invariantsText supplied', () => {
    writeRoadmapFixture(tmpDir);
    const invariantsText = resilience.getPhaseInvariantsText(tmpDir, '54');
    const checkpointData = { found: false, resume_from: null, last_step: null, step_status: null, plans_complete: null, plans_remaining: null, key_context: null };

    const brief = resilience.buildResumeBrief(checkpointData, PHASE_INFO, invariantsText);
    assert.strictEqual(brief.resume_from, 'discuss');
    assert.ok(/from scratch/i.test(brief.brief_text));
    assert.ok(brief.brief_text.includes('PHASE INVARIANTS (verbatim from ROADMAP.md'));
    assert.ok(brief.brief_text.includes(PHASE_54_SUCCESS_CRITERION));
  });

  test('boundary: empty-string invariantsText behaves like null -> no PHASE INVARIANTS block', () => {
    const checkpointData = { found: false, resume_from: null, last_step: null, step_status: null, plans_complete: null, plans_remaining: null, key_context: null };
    const brief = resilience.buildResumeBrief(checkpointData, PHASE_INFO, '');
    assert.ok(!brief.brief_text.includes('PHASE INVARIANTS'));
    assert.strictEqual(brief.invariants, null);
  });

  // Category 5: Wiring/integration -- correct phase-section slicing.
  test('wiring: getPhaseInvariantsText slices only Phase 54\'s section, stopping at the next "### Phase" header', () => {
    writeRoadmapFixture(tmpDir, { includePhase55: true });
    const invariantsText = resilience.getPhaseInvariantsText(tmpDir, '54');
    assert.ok(invariantsText.includes('Phase 54'));
    assert.ok(invariantsText.includes(PHASE_54_SUCCESS_CRITERION));
    assert.ok(!invariantsText.includes('Phase 55'), 'expected the Phase 54 slice to stop before the Phase 55 header');
    assert.ok(!invariantsText.includes('belongs to Phase 55'), 'expected Phase 55 content to be excluded from the Phase 54 slice');
  });

  // Category 6: Regression guard -- pre-existing two-argument buildResumeBrief contract (51-02) intact.
  test('regression guard: two-arg buildResumeBrief(found:false, phaseInfo) -> resume_from "discuss", original brief_text unchanged', () => {
    const checkpointData = { found: false, resume_from: null, last_step: null, step_status: null, plans_complete: null, plans_remaining: null, key_context: null };
    const phaseInfo = { phase_number: '52', phase_name: 'never-started', directory: '.planning/phases/52-never-started' };

    const brief = resilience.buildResumeBrief(checkpointData, phaseInfo);
    assert.strictEqual(brief.resume_from, 'discuss');
    assert.strictEqual(brief.brief_text, 'No prior checkpoint found -- starting phase 52 (never-started) from scratch.');
    assert.ok(!brief.brief_text.includes('PHASE INVARIANTS'));
  });
});

describe('Phase 54 handoff-brief wiring', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const COORDINATOR_DETAIL_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'coordinator-detail.md');
  const HANDOFF_BRIEF_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'handoff-brief.md');
  const COORDINATOR_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-phase-coordinator.md');
  const EXECUTOR_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-executor.md');
  const VERIFIER_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-verifier.md');
  const PLANNER_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-planner.md');
  const DEBUGGER_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-debugger.md');
  const CORE_PREAMBLE_MARKER = '<!-- GSD:CORE-PREAMBLE-END -->';

  // Guarded read helper: fails the assertion loudly (not an unhandled throw)
  // if the expected file has moved/been deleted, per the plan's "missing
  // input" category requirement.
  function readRepoFile(absPath) {
    assert.ok(fs.existsSync(absPath), `expected file to exist: ${absPath}`);
    return fs.readFileSync(absPath, 'utf-8');
  }

  // Category 1: Happy path.
  test('happy path: coordinator-detail.md injects <handoff_brief> at both executor branches and the verifier spawn, @-mentioning handoff-brief.md', () => {
    const content = readRepoFile(COORDINATOR_DETAIL_PATH);

    const executeStepIdx = content.indexOf('<step name="execute">');
    const verifyStepIdx = content.indexOf('<step name="verify">');
    assert.ok(executeStepIdx !== -1, 'expected an <step name="execute"> anchor');
    assert.ok(verifyStepIdx !== -1, 'expected a <step name="verify"> anchor');
    assert.ok(executeStepIdx < verifyStepIdx, 'expected the execute step to precede the verify step');

    const executorRegion = content.slice(executeStepIdx, verifyStepIdx);
    const verifierRegion = content.slice(verifyStepIdx);

    const executorBriefCount = (executorRegion.match(/<handoff_brief>/g) || []).length;
    const verifierBriefCount = (verifierRegion.match(/<handoff_brief>/g) || []).length;

    assert.ok(executorBriefCount >= 2, `expected >= 2 <handoff_brief> occurrences in the executor spawn region (both PER_TASK_MODE branches), got ${executorBriefCount}`);
    assert.ok(verifierBriefCount >= 1, `expected >= 1 <handoff_brief> occurrence in the verifier spawn region, got ${verifierBriefCount}`);

    assert.ok(executorRegion.includes('handoff-brief.md'), 'expected handoff-brief.md to be @-mentioned in the executor spawn region');
    assert.ok(verifierRegion.includes('handoff-brief.md'), 'expected handoff-brief.md to be @-mentioned in the verifier spawn region');
  });

  // Category 2: Missing/malformed input.
  test('missing/malformed input: readRepoFile fails the assertion loudly (not an unhandled throw) for an absent path', () => {
    const bogusPath = path.join(REPO_ROOT, 'get-shit-done', 'references', 'this-file-does-not-exist-54-04.md');
    assert.throws(
      () => readRepoFile(bogusPath),
      /expected file to exist/,
      'expected a clear assertion failure, not an unhandled exception, for a moved/absent file'
    );
  });

  // Category 3: Edge case -- pointer line lives INSIDE the budget-measured preamble.
  test('edge case: each of the 3 agent files carries its handoff-brief line BEFORE its own CORE-PREAMBLE-END marker', () => {
    const agents = [
      { path: COORDINATOR_AGENT_PATH, pattern: /handoff brief/i },
      { path: EXECUTOR_AGENT_PATH, pattern: /handoff_brief/ },
      { path: VERIFIER_AGENT_PATH, pattern: /handoff_brief/ },
    ];

    for (const { path: agentPath, pattern } of agents) {
      const content = readRepoFile(agentPath);
      const markerIdx = content.indexOf(CORE_PREAMBLE_MARKER);
      const matchIdx = content.search(pattern);

      assert.ok(markerIdx !== -1, `expected ${agentPath} to contain the CORE-PREAMBLE-END marker`);
      assert.ok(matchIdx !== -1, `expected ${agentPath} to contain a handoff-brief acknowledgment matching ${pattern}`);
      assert.ok(matchIdx < markerIdx, `expected the handoff-brief line in ${agentPath} to appear BEFORE CORE-PREAMBLE-END (matchIdx=${matchIdx}, markerIdx=${markerIdx})`);
    }
  });

  // Category 4: Boundary -- blast radius confined to coordinator/executor/verifier.
  test('boundary: gsd-planner.md and gsd-debugger.md do NOT contain a <handoff_brief> block', () => {
    const plannerContent = readRepoFile(PLANNER_AGENT_PATH);
    const debuggerContent = readRepoFile(DEBUGGER_AGENT_PATH);

    assert.ok(!plannerContent.includes('<handoff_brief>'), 'expected gsd-planner.md to be untouched by the handoff-brief wiring');
    assert.ok(!debuggerContent.includes('<handoff_brief>'), 'expected gsd-debugger.md to be untouched by the handoff-brief wiring');
  });

  // Category 5: Wiring/integration -- budgets still pass after the preamble additions.
  test('wiring: checkAllBudgets reports pass:true overall and for coordinator/executor/verifier individually', () => {
    const { checkAllBudgets } = require('./prompt-budget.js');
    const result = checkAllBudgets(REPO_ROOT);

    assert.strictEqual(result.pass, true, `expected checkAllBudgets to pass overall, got: ${JSON.stringify(result.results)}`);

    const modifiedAgents = ['agents/gsd-phase-coordinator.md', 'agents/gsd-executor.md', 'agents/gsd-verifier.md'];
    for (const relPath of modifiedAgents) {
      const entry = result.results.find((r) => r.filePath === relPath);
      assert.ok(entry, `expected a budget result entry for ${relPath}`);
      assert.strictEqual(entry.pass, true, `expected ${relPath} to pass its budget, got ${entry.estimatedTokens}/${entry.budget}`);
    }
  });

  // Category 6: Regression guard -- the single-source structure was not diluted by the wiring.
  test('regression guard: handoff-brief.md still defines all 5 canonical section labels', () => {
    const content = readRepoFile(HANDOFF_BRIEF_PATH);
    const labels = ['Phase Goal', 'Key Decisions', 'Open Risks', 'File Map', 'Hard Rules'];
    for (const label of labels) {
      assert.ok(content.includes(label), `expected handoff-brief.md to still define the "${label}" section label`);
    }
  });
});

// Phase 55-01 (MILE-32): eval-candidate generation. Pure builders required
// directly off the same `resilience` alias used by the Phase 51-02/54-01
// suites above (both point at the same gsd-tools.js module.exports object).
// Fixtures are built in a temp dir per test, mirroring createTempProject's
// pattern, so builders are exercised against real files on disk (they read
// via safeReadFile / gray-matter, not in-memory strings).
describe('eval-candidate generation (Phase 55-01)', () => {
  const {
    buildEvalCandidateFromDebugFile,
    buildEvalCandidatesFromVerificationFile,
    writeEvalCandidates,
  } = resilience;

  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writeDebugFixture(relPath, content) {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }

  const CONFIRMED_DEBUG_CONTENT = `---
status: verifying
trigger: "login button does nothing"
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:05:00Z
---

## Current Focus

hypothesis: n/a

## Resolution

root_cause: onClick handler never attached to the button element
fix: attached onClick handler
verification: manually clicked and it worked
files_changed: [src/components/LoginButton.jsx]
`;

  const CONFIRMED_DEBUG_NO_FILES_CONTENT = `---
status: verifying
trigger: "some other trigger"
---

## Resolution

root_cause: a different confirmed root cause
fix: applied a fix
verification: verified
files_changed: []
`;

  const INCONCLUSIVE_DEBUG_CONTENT = `---
status: investigating
trigger: "still looking"
---

## Resolution

root_cause: [empty until found]
fix: [empty until applied]
verification: [empty until verified]
files_changed: []
`;

  const GAPS_FOUND_2_CONTENT = `---
phase: 55-test-phase
verified: 2026-01-01T00:00:00Z
status: gaps_found
score: 3/5 must-haves verified
gaps:
  - truth: "First truth failed"
    status: failed
    failure_type: stub
    reason: "reason one"
    artifacts:
      - path: "src/a.js"
        issue: "missing"
    missing:
      - "thing one"
  - truth: "Second truth failed"
    status: failed
    failure_type: unwired
    reason: "reason two"
    artifacts:
      - path: "src/b.js"
        issue: "missing"
    missing:
      - "thing two"
---

# Verification Report
`;

  const STATUS_PASSED_CONTENT = `---
phase: 55-test-phase
verified: 2026-01-01T00:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Verification Report
`;

  const GAP_NO_ARTIFACTS_CONTENT = `---
phase: 55-test-phase
status: gaps_found
gaps:
  - truth: "No artifacts truth"
    status: failed
    failure_type: missing_artifact
    reason: "no artifacts recorded on this gap"
    missing:
      - "something"
---
`;

  const GAPS_FOUND_EMPTY_ARRAY_CONTENT = `---
phase: 55-test-phase
status: gaps_found
gaps: []
---
`;

  const SAME_TRUTH_3_GAPS_CONTENT = `---
phase: 55-test-phase
status: gaps_found
gaps:
  - truth: "Duplicate truth text"
    status: failed
    failure_type: stub
    reason: "reason a"
    artifacts:
      - path: "src/a.js"
        issue: "missing"
  - truth: "Duplicate truth text"
    status: failed
    failure_type: stub
    reason: "reason b"
    artifacts:
      - path: "src/b.js"
        issue: "missing"
  - truth: "Duplicate truth text"
    status: failed
    failure_type: stub
    reason: "reason c"
    artifacts:
      - path: "src/c.js"
        issue: "missing"
---
`;

  // Category 1: Happy path.
  test('happy path: confirmed root_cause + files_changed -> candidate with all 7 schema keys, correct expected/status', () => {
    const debugPath = writeDebugFixture('.planning/debug/fixture.md', CONFIRMED_DEBUG_CONTENT);
    const candidate = buildEvalCandidateFromDebugFile(tmpDir, debugPath);

    assert.ok(candidate, 'expected a non-null candidate');
    const expectedKeys = ['id', 'source', 'created_at', 'title', 'context', 'expected', 'status'];
    for (const key of expectedKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(candidate, key), `expected candidate to have key "${key}"`);
    }
    assert.strictEqual(candidate.source, 'debugger');
    assert.strictEqual(candidate.status, 'pending');
    assert.deepStrictEqual(candidate.expected, { type: 'file_exists', file: 'src/components/LoginButton.jsx' });
    assert.strictEqual(candidate.context.root_cause, 'onClick handler never attached to the button element');
  });

  test('happy path: status:gaps_found with 2 gaps -> exactly 2 candidates with distinct ids', () => {
    const verificationPath = writeDebugFixture('.planning/phases/55-test-phase/55-VERIFICATION.md', GAPS_FOUND_2_CONTENT);
    const candidates = buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath);

    assert.strictEqual(candidates.length, 2);
    const ids = candidates.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, 2, 'expected 2 distinct ids');
    for (const c of candidates) {
      assert.strictEqual(c.source, 'verifier');
      assert.strictEqual(c.status, 'pending');
    }
  });

  // Category 2: Missing/malformed input.
  test('missing/malformed: debug file with placeholder root_cause "[empty until found]" -> null', () => {
    const debugPath = writeDebugFixture('.planning/debug/inconclusive.md', INCONCLUSIVE_DEBUG_CONTENT);
    const candidate = buildEvalCandidateFromDebugFile(tmpDir, debugPath);
    assert.strictEqual(candidate, null);
  });

  test('missing/malformed: VERIFICATION.md with status:passed (no gaps key) -> []', () => {
    const verificationPath = writeDebugFixture('.planning/phases/55-test-phase/55-VERIFICATION.md', STATUS_PASSED_CONTENT);
    const candidates = buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath);
    assert.deepStrictEqual(candidates, []);
  });

  test('missing/malformed: nonexistent debug/verification file paths -> null/[] respectively, no throw', () => {
    const missingDebugPath = path.join(tmpDir, '.planning', 'debug', 'does-not-exist.md');
    const missingVerificationPath = path.join(tmpDir, '.planning', 'phases', '55-test-phase', '55-VERIFICATION.md');

    assert.doesNotThrow(() => buildEvalCandidateFromDebugFile(tmpDir, missingDebugPath));
    assert.strictEqual(buildEvalCandidateFromDebugFile(tmpDir, missingDebugPath), null);

    assert.doesNotThrow(() => buildEvalCandidatesFromVerificationFile(tmpDir, missingVerificationPath));
    assert.deepStrictEqual(buildEvalCandidatesFromVerificationFile(tmpDir, missingVerificationPath), []);
  });

  // Category 3: Edge case.
  test('edge case: debug file with root_cause set but no files_changed -> expected.file falls back to debug file\'s own relative path', () => {
    const debugPath = writeDebugFixture('.planning/debug/no-files.md', CONFIRMED_DEBUG_NO_FILES_CONTENT);
    const candidate = buildEvalCandidateFromDebugFile(tmpDir, debugPath);

    assert.ok(candidate);
    assert.deepStrictEqual(candidate.expected, { type: 'file_exists', file: path.relative(tmpDir, debugPath) });
  });

  test('edge case: gap with no artifacts entry -> expected.file falls back to VERIFICATION.md\'s own relative path', () => {
    const verificationPath = writeDebugFixture('.planning/phases/55-test-phase/55-VERIFICATION.md', GAP_NO_ARTIFACTS_CONTENT);
    const candidates = buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath);

    assert.strictEqual(candidates.length, 1);
    assert.deepStrictEqual(candidates[0].expected, { type: 'file_exists', file: path.relative(tmpDir, verificationPath) });
  });

  // Category 4: Boundary.
  test('boundary: status:gaps_found with an EMPTY gaps:[] array -> [] (no crash on contradictory-but-defensive case)', () => {
    const verificationPath = writeDebugFixture('.planning/phases/55-test-phase/55-VERIFICATION.md', GAPS_FOUND_EMPTY_ARRAY_CONTENT);
    assert.doesNotThrow(() => buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath));
    const candidates = buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath);
    assert.deepStrictEqual(candidates, []);
  });

  test('boundary: multiple gaps with IDENTICAL truth text in one call still produce non-colliding ids', () => {
    const verificationPath = writeDebugFixture('.planning/phases/55-test-phase/55-VERIFICATION.md', SAME_TRUTH_3_GAPS_CONTENT);
    const candidates = buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath);

    assert.strictEqual(candidates.length, 3);
    const ids = candidates.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'expected all 3 ids to be distinct even with identical truth text');
  });

  // Category 5: Wiring/integration.
  test('wiring: `eval-candidate from-debug` CLI creates exactly one file under tests/eval-regressions/queue/', () => {
    writeDebugFixture('.planning/debug/fixture.md', CONFIRMED_DEBUG_CONTENT);
    const result = runGsdTools('eval-candidate from-debug .planning/debug/fixture.md --raw', tmpDir);
    assert.ok(result.success, `expected CLI success, got: ${result.error}`);

    const queueDir = path.join(tmpDir, 'tests', 'eval-regressions', 'queue');
    const files = fs.readdirSync(queueDir).filter((f) => f.endsWith('.json'));
    assert.strictEqual(files.length, 1);
  });

  test('wiring: `eval-candidate from-debug` CLI on placeholder root_cause creates zero files', () => {
    writeDebugFixture('.planning/debug/inconclusive.md', INCONCLUSIVE_DEBUG_CONTENT);
    const result = runGsdTools('eval-candidate from-debug .planning/debug/inconclusive.md --raw', tmpDir);
    assert.ok(result.success, `expected CLI success (valid no-op), got: ${result.error}`);

    const queueDir = path.join(tmpDir, 'tests', 'eval-regressions', 'queue');
    const files = fs.existsSync(queueDir) ? fs.readdirSync(queueDir).filter((f) => f.endsWith('.json')) : [];
    assert.strictEqual(files.length, 0);
  });

  test('wiring: `eval-candidate from-verification` CLI creates N files matching gap count, zero for status:passed', () => {
    writeDebugFixture('.planning/phases/55-test-phase/55-VERIFICATION.md', GAPS_FOUND_2_CONTENT);
    const gapsResult = runGsdTools('eval-candidate from-verification .planning/phases/55-test-phase/55-VERIFICATION.md --raw', tmpDir);
    assert.ok(gapsResult.success, `expected CLI success, got: ${gapsResult.error}`);

    const queueDir = path.join(tmpDir, 'tests', 'eval-regressions', 'queue');
    const filesAfterGaps = fs.readdirSync(queueDir).filter((f) => f.endsWith('.json'));
    assert.strictEqual(filesAfterGaps.length, 2);

    // Second temp project for the zero-file passed case (isolated queue dir).
    const passedTmpDir = createTempProject();
    try {
      const passedFullPath = path.join(passedTmpDir, '.planning', 'phases', '55-test-phase', '55-VERIFICATION.md');
      fs.mkdirSync(path.dirname(passedFullPath), { recursive: true });
      fs.writeFileSync(passedFullPath, STATUS_PASSED_CONTENT, 'utf-8');
      const passedResult = runGsdTools('eval-candidate from-verification .planning/phases/55-test-phase/55-VERIFICATION.md --raw', passedTmpDir);
      assert.ok(passedResult.success, `expected CLI success (valid no-op), got: ${passedResult.error}`);

      const passedQueueDir = path.join(passedTmpDir, 'tests', 'eval-regressions', 'queue');
      const filesAfterPassed = fs.existsSync(passedQueueDir) ? fs.readdirSync(passedQueueDir).filter((f) => f.endsWith('.json')) : [];
      assert.strictEqual(filesAfterPassed.length, 0);
    } finally {
      cleanup(passedTmpDir);
    }
  });

  // Category 6: Regression guard.
  test('regression guard: buildHandoffBrief still returns its expected shape when required alongside the new eval-candidate builders', () => {
    assert.strictEqual(typeof buildEvalCandidateFromDebugFile, 'function');
    assert.strictEqual(typeof buildEvalCandidatesFromVerificationFile, 'function');
    assert.strictEqual(typeof writeEvalCandidates, 'function');

    const brief = resilience.buildHandoffBrief({ phase_number: 55, phase_name: 'failures-to-regression' });
    assert.strictEqual(typeof brief.complete, 'boolean');
    assert.ok(brief.brief_text.includes('55'));
  });
});

// Phase 55-01 (MILE-32): structural grep-assertion + budget wiring tests --
// house convention from Phases 48/52/54 -- proving the debugger/verifier
// agent-wiring additions from Task 3 land at the correct point, are confined
// to the correct blast radius, and do not regress prompt budgets.
describe('Phase 55-01 eval-candidate agent wiring', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const DEBUGGER_DETAIL_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'debugger-detail.md');
  const VERIFIER_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-verifier.md');
  const PLANNER_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-planner.md');
  const EXECUTOR_AGENT_PATH = path.join(REPO_ROOT, 'agents', 'gsd-executor.md');

  // Guarded read helper: fails the assertion loudly (not an unhandled throw)
  // if the expected file has moved/been deleted.
  function readRepoFile(absPath) {
    assert.ok(fs.existsSync(absPath), `expected file to exist: ${absPath}`);
    return fs.readFileSync(absPath, 'utf-8');
  }

  // Category 1: Happy path.
  test('happy path: `eval-candidate from-debug` appears within the "Phase 4: Evaluate" region of debugger-detail.md', () => {
    const content = readRepoFile(DEBUGGER_DETAIL_PATH);

    const phase4Idx = content.indexOf('**Phase 4: Evaluate**');
    assert.ok(phase4Idx !== -1, 'expected a "**Phase 4: Evaluate**" heading');

    const afterHeading = phase4Idx + '**Phase 4: Evaluate**'.length;
    const nextPhaseIdx = content.indexOf('**Phase', afterHeading);
    const stepCloseIdx = content.indexOf('</step>', afterHeading);
    const boundaryCandidates = [nextPhaseIdx, stepCloseIdx].filter((i) => i !== -1);
    const boundaryIdx = boundaryCandidates.length ? Math.min(...boundaryCandidates) : content.length;

    const phase4Region = content.slice(phase4Idx, boundaryIdx);
    assert.ok(phase4Region.includes('eval-candidate from-debug'), 'expected "eval-candidate from-debug" inside the Phase 4: Evaluate region');
  });

  // Category 2: Missing/malformed input.
  test('missing/malformed: guarded read helper fails loudly with a clear message when the real repo path is moved', () => {
    const bogusPath = path.join(REPO_ROOT, 'get-shit-done', 'references', 'does-not-exist-debugger-detail.md');
    assert.throws(() => readRepoFile(bogusPath), /expected file to exist/);
  });

  // Category 3: Edge case -- blast radius confined to the CONFIRMED point.
  test('edge case: `eval-candidate from-debug` does NOT appear in the ELIMINATED bullet or return_diagnosis/request_human_verification step bodies', () => {
    const content = readRepoFile(DEBUGGER_DETAIL_PATH);

    const eliminatedIdx = content.indexOf('- **ELIMINATED:**');
    assert.ok(eliminatedIdx !== -1, 'expected an "- **ELIMINATED:**" bullet');
    const eliminatedLineEnd = content.indexOf('\n', eliminatedIdx);
    const eliminatedBullet = content.slice(eliminatedIdx, eliminatedLineEnd === -1 ? content.length : eliminatedLineEnd);
    assert.ok(!eliminatedBullet.includes('eval-candidate from-debug'), 'expected the ELIMINATED bullet to NOT invoke eval-candidate from-debug');

    const returnDiagIdx = content.indexOf('<step name="return_diagnosis">');
    assert.ok(returnDiagIdx !== -1, 'expected a return_diagnosis step');
    const returnDiagEndIdx = content.indexOf('</step>', returnDiagIdx);
    assert.ok(returnDiagEndIdx !== -1, 'expected return_diagnosis step to close with </step>');
    const returnDiagBody = content.slice(returnDiagIdx, returnDiagEndIdx);
    assert.ok(!returnDiagBody.includes('eval-candidate from-debug'), 'expected return_diagnosis step to NOT invoke eval-candidate from-debug');

    const humanVerifyIdx = content.indexOf('<step name="request_human_verification">');
    assert.ok(humanVerifyIdx !== -1, 'expected a request_human_verification step');
    const humanVerifyEndIdx = content.indexOf('</step>', humanVerifyIdx);
    assert.ok(humanVerifyEndIdx !== -1, 'expected request_human_verification step to close with </step>');
    const humanVerifyBody = content.slice(humanVerifyIdx, humanVerifyEndIdx);
    assert.ok(!humanVerifyBody.includes('eval-candidate from-debug'), 'expected request_human_verification step to NOT invoke eval-candidate from-debug');
  });

  // Category 4: Boundary -- correct placement in gsd-verifier.md's <output> section.
  test('boundary: `eval-candidate from-verification` in gsd-verifier.md appears AFTER the VERIFICATION.md template closing fence and BEFORE "## Return to Orchestrator"', () => {
    const content = readRepoFile(VERIFIER_AGENT_PATH);

    const returnHeadingIdx = content.indexOf('## Return to Orchestrator');
    assert.ok(returnHeadingIdx !== -1, 'expected a "## Return to Orchestrator" heading');

    const evalCandidateIdx = content.indexOf('eval-candidate from-verification');
    assert.ok(evalCandidateIdx !== -1, 'expected "eval-candidate from-verification" to appear in gsd-verifier.md');
    assert.ok(evalCandidateIdx < returnHeadingIdx, 'expected eval-candidate from-verification to appear BEFORE "## Return to Orchestrator"');

    // Closing fence of the VERIFICATION.md template block is the last ``` before "## Return to Orchestrator".
    const templateRegion = content.slice(0, returnHeadingIdx);
    const lastFenceIdx = templateRegion.lastIndexOf('```');
    assert.ok(lastFenceIdx !== -1, 'expected a closing ``` fence before "## Return to Orchestrator"');
    assert.ok(evalCandidateIdx > lastFenceIdx, 'expected eval-candidate from-verification to appear AFTER the VERIFICATION.md template closing fence');
  });

  // Category 5: Wiring/integration -- budgets still pass after the digest/output additions.
  test('wiring: checkAllBudgets reports pass:true overall and for gsd-debugger/gsd-verifier individually', () => {
    const { checkAllBudgets } = require('./prompt-budget.js');
    const result = checkAllBudgets(REPO_ROOT);

    assert.strictEqual(result.pass, true, `expected checkAllBudgets to pass overall, got: ${JSON.stringify(result.results)}`);

    const modifiedAgents = ['agents/gsd-debugger.md', 'agents/gsd-verifier.md'];
    for (const relPath of modifiedAgents) {
      const entry = result.results.find((r) => r.filePath === relPath);
      assert.ok(entry, `expected a budget result entry for ${relPath}`);
      assert.strictEqual(entry.pass, true, `expected ${relPath} to pass its budget, got ${entry.estimatedTokens}/${entry.budget}`);
    }
  });

  // Category 6: Regression guard -- blast radius stayed within debugger/verifier.
  test('regression guard: gsd-planner.md and gsd-executor.md do NOT contain "eval-candidate"', () => {
    const plannerContent = readRepoFile(PLANNER_AGENT_PATH);
    const executorContent = readRepoFile(EXECUTOR_AGENT_PATH);

    assert.ok(!plannerContent.includes('eval-candidate'), 'expected gsd-planner.md to be untouched by the eval-candidate wiring');
    assert.ok(!executorContent.includes('eval-candidate'), 'expected gsd-executor.md to be untouched by the eval-candidate wiring');
  });
});

// Phase 55-02 (MILE-32): review-queue lifecycle -- validateEvalCandidateSchema
// (pure) plus the list/accept/reject CLI built on top of it. Mirrors the
// 55-01 describe block's createTempProject/cleanup + runGsdTools conventions;
// candidates are hand-seeded as JSON files directly into a temp
// tests/eval-regressions/queue/ dir (rather than generated via from-debug/
// from-verification) so each test controls the exact shape under test,
// including deliberately-invalid hand-edited shapes.
describe('eval-candidate review queue (Phase 55-02)', () => {
  const { validateEvalCandidateSchema } = resilience;

  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function queueDirPath(dir = tmpDir) {
    return path.join(dir, 'tests', 'eval-regressions', 'queue');
  }

  function acceptedDirPath(dir = tmpDir) {
    return path.join(dir, 'tests', 'eval-regressions', 'accepted');
  }

  function archivedDirPath(dir = tmpDir) {
    return path.join(dir, 'tests', 'eval-regressions', 'archived');
  }

  function validCandidate(overrides = {}) {
    return {
      id: 'cand-valid-1',
      source: 'debugger',
      created_at: '2026-01-01T00:00:00.000Z',
      title: 'A valid candidate',
      context: { phase: null, root_cause: 'x', gap_description: null, debug_file: null, verification_file: null },
      expected: { type: 'file_exists', file: 'src/foo.js' },
      status: 'pending',
      ...overrides,
    };
  }

  function seedQueueFile(id, content) {
    const dir = queueDirPath();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${id}.json`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function seedQueueCandidate(candidate) {
    return seedQueueFile(candidate.id, JSON.stringify(candidate, null, 2));
  }

  // Category 1: Happy path.
  test('happy path: fully valid candidate object -> validateEvalCandidateSchema returns {valid:true, errors:[]}', () => {
    const result = validateEvalCandidateSchema(validCandidate());
    assert.deepStrictEqual(result, { valid: true, errors: [] });
  });

  test('happy path: `eval-candidate accept` moves a valid queued candidate to accepted/ with status:"accepted" and removes it from queue/', () => {
    seedQueueCandidate(validCandidate({ id: 'cand-happy' }));

    const result = runGsdTools('eval-candidate accept cand-happy --raw', tmpDir);
    assert.ok(result.success, `expected CLI success, got: ${result.error}`);

    const acceptedPath = path.join(acceptedDirPath(), 'cand-happy.json');
    assert.ok(fs.existsSync(acceptedPath), 'expected candidate to exist in accepted/');
    const accepted = JSON.parse(fs.readFileSync(acceptedPath, 'utf-8'));
    assert.strictEqual(accepted.status, 'accepted');
    assert.ok(accepted.accepted_at, 'expected an accepted_at timestamp');

    const queuePath = path.join(queueDirPath(), 'cand-happy.json');
    assert.ok(!fs.existsSync(queuePath), 'expected candidate to no longer exist in queue/');
  });

  // Category 2: Missing/malformed input.
  test('missing/malformed: candidate missing `expected` -> valid:false with "missing required key: expected"', () => {
    const candidate = validCandidate();
    delete candidate.expected;
    const result = validateEvalCandidateSchema(candidate);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.includes('missing required key: expected'), `expected "missing required key: expected" in ${JSON.stringify(result.errors)}`);
  });

  test('missing/malformed: `eval-candidate accept` on invalid JSON in queue/ exits non-zero, leaves file untouched, stdout mentions malformed_candidate', () => {
    seedQueueFile('cand-broken', '{ not valid json');

    const result = runGsdTools('eval-candidate accept cand-broken --raw', tmpDir);
    assert.strictEqual(result.success, false, 'expected non-zero exit');
    assert.ok(result.output.includes('malformed_candidate'), `expected "malformed_candidate" in output: ${result.output}`);

    const queuePath = path.join(queueDirPath(), 'cand-broken.json');
    assert.ok(fs.existsSync(queuePath), 'expected the malformed file to remain in queue/ untouched');
    assert.strictEqual(fs.readFileSync(queuePath, 'utf-8'), '{ not valid json');
  });

  // Category 3: Edge case.
  test('edge case: expected.type "file_contains" without expected.needle -> valid:false with the needle-specific error', () => {
    const candidate = validCandidate({ expected: { type: 'file_contains', file: 'src/foo.js' } });
    const result = validateEvalCandidateSchema(candidate);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.includes('expected.needle is required for file_contains/file_not_contains'),
      `expected the needle-specific error in ${JSON.stringify(result.errors)}`
    );
  });

  test('edge case: `eval-candidate accept` re-validates and REJECTS a hand-edited candidate that is now schema-invalid, leaving it in queue/', () => {
    // Hand-edited to a previously-valid-looking but now-broken shape: file_contains with no needle.
    seedQueueCandidate(validCandidate({ id: 'cand-hand-edited', expected: { type: 'file_contains', file: 'src/foo.js' } }));

    const result = runGsdTools('eval-candidate accept cand-hand-edited --raw', tmpDir);
    assert.strictEqual(result.success, false, 'expected non-zero exit on schema-invalid hand-edited candidate');
    assert.ok(result.output.includes('invalid_candidate_schema'), `expected "invalid_candidate_schema" in output: ${result.output}`);
    const parsedOutput = JSON.parse(result.output);
    assert.ok(Array.isArray(parsedOutput.errors) && parsedOutput.errors.length > 0, 'expected a non-empty errors array');

    const queuePath = path.join(queueDirPath(), 'cand-hand-edited.json');
    assert.ok(fs.existsSync(queuePath), 'expected the invalid hand-edited candidate to remain in queue/');
    const acceptedPath = path.join(acceptedDirPath(), 'cand-hand-edited.json');
    assert.ok(!fs.existsSync(acceptedPath), 'expected the invalid hand-edited candidate to NOT be promoted to accepted/');
  });

  // Category 4: Boundary.
  test('boundary: `eval-candidate reject` on a candidate that already has a `reason` appends (never overwrites) the new reason', () => {
    seedQueueCandidate(validCandidate({ id: 'cand-reasoned', reason: 'first reason' }));

    const result = runGsdTools('eval-candidate reject cand-reasoned --reason "second reason" --raw', tmpDir);
    assert.ok(result.success, `expected CLI success, got: ${result.error}`);

    const archivedPath = path.join(archivedDirPath(), 'cand-reasoned.json');
    assert.ok(fs.existsSync(archivedPath), 'expected candidate to exist in archived/');
    const archived = JSON.parse(fs.readFileSync(archivedPath, 'utf-8'));
    assert.strictEqual(archived.status, 'rejected');
    assert.strictEqual(archived.reason, 'first reason; second reason');
    assert.ok(archived.rejected_at, 'expected a rejected_at timestamp');

    const queuePath = path.join(queueDirPath(), 'cand-reasoned.json');
    assert.ok(!fs.existsSync(queuePath), 'expected candidate to no longer exist in queue/ (moved, not copied)');
  });

  // Category 5: Wiring/integration.
  test('wiring: `eval-candidate list` reflects queue/accepted/archived contents correctly after one accept and one reject', () => {
    seedQueueCandidate(validCandidate({ id: 'cand-list-accept' }));
    seedQueueCandidate(validCandidate({ id: 'cand-list-reject' }));
    seedQueueCandidate(validCandidate({ id: 'cand-list-remains' }));

    const acceptResult = runGsdTools('eval-candidate accept cand-list-accept --raw', tmpDir);
    assert.ok(acceptResult.success, `expected accept success, got: ${acceptResult.error}`);
    const rejectResult = runGsdTools('eval-candidate reject cand-list-reject --reason "not reproducible" --raw', tmpDir);
    assert.ok(rejectResult.success, `expected reject success, got: ${rejectResult.error}`);

    const queueListResult = runGsdTools('eval-candidate list --raw', tmpDir);
    assert.ok(queueListResult.success, `expected list success, got: ${queueListResult.error}`);
    const queueList = JSON.parse(queueListResult.output);
    assert.strictEqual(queueList.dir, 'queue');
    assert.strictEqual(queueList.count, 1);
    assert.strictEqual(queueList.candidates[0].id, 'cand-list-remains');

    const acceptedListResult = runGsdTools('eval-candidate list accepted --raw', tmpDir);
    assert.ok(acceptedListResult.success, `expected list success, got: ${acceptedListResult.error}`);
    const acceptedList = JSON.parse(acceptedListResult.output);
    assert.strictEqual(acceptedList.count, 1);
    assert.strictEqual(acceptedList.candidates[0].id, 'cand-list-accept');
    assert.strictEqual(acceptedList.candidates[0].status, 'accepted');

    const archivedListResult = runGsdTools('eval-candidate list archived --raw', tmpDir);
    assert.ok(archivedListResult.success, `expected list success, got: ${archivedListResult.error}`);
    const archivedList = JSON.parse(archivedListResult.output);
    assert.strictEqual(archivedList.count, 1);
    assert.strictEqual(archivedList.candidates[0].id, 'cand-list-reject');
    assert.strictEqual(archivedList.candidates[0].status, 'rejected');
  });

  // Category 6: Regression guard.
  test('regression guard: `eval-candidate from-debug`/`from-verification` (55-01) still land fresh candidates in queue/ unmodified', () => {
    const debugFixture = path.join(tmpDir, '.planning', 'debug', 'fixture.md');
    fs.mkdirSync(path.dirname(debugFixture), { recursive: true });
    fs.writeFileSync(debugFixture, `---
status: verifying
trigger: "regression guard trigger"
---

## Resolution

root_cause: still confirmed after 55-02 CLI additions
fix: n/a
verification: n/a
files_changed: [src/regression-guard.js]
`, 'utf-8');

    const fromDebugResult = runGsdTools('eval-candidate from-debug .planning/debug/fixture.md --raw', tmpDir);
    assert.ok(fromDebugResult.success, `expected from-debug CLI success, got: ${fromDebugResult.error}`);
    const queueFilesAfterDebug = fs.readdirSync(queueDirPath()).filter((f) => f.endsWith('.json'));
    assert.strictEqual(queueFilesAfterDebug.length, 1, 'expected exactly one candidate written by from-debug');

    const verificationFixture = path.join(tmpDir, '.planning', 'phases', '55-test-phase', '55-VERIFICATION.md');
    fs.mkdirSync(path.dirname(verificationFixture), { recursive: true });
    fs.writeFileSync(verificationFixture, `---
phase: 55-test-phase
status: gaps_found
gaps:
  - truth: "Regression guard gap"
    status: failed
    failure_type: stub
    reason: "still works after 55-02 CLI additions"
    artifacts:
      - path: "src/regression-guard-gap.js"
        issue: "missing"
---
`, 'utf-8');

    const fromVerificationResult = runGsdTools('eval-candidate from-verification .planning/phases/55-test-phase/55-VERIFICATION.md --raw', tmpDir);
    assert.ok(fromVerificationResult.success, `expected from-verification CLI success, got: ${fromVerificationResult.error}`);
    const queueFilesAfterBoth = fs.readdirSync(queueDirPath()).filter((f) => f.endsWith('.json'));
    assert.strictEqual(queueFilesAfterBoth.length, 2, 'expected a second candidate written by from-verification, alongside the from-debug one');
  });
});

// MILE-32 (Phase 55-03): cross-cutting integration tests. Unlike the 55-01
// and 55-02 describe blocks above (which unit-test individual CLI commands
// in isolation), these tests chain multiple real CLI invocations against ONE
// temp cwd per test (via runGsdTools/execSync, never direct function calls)
// to prove the full "a failure becomes a permanent regression eval" pipeline
// actually works end-to-end: candidate generation from a seeded debug
// session, review-queue accept/reject transitions, CI pickup of an accepted
// fixture (including the regression it exists to catch), and loud handling
// of a malformed committed candidate file.
describe('MILE-32 end-to-end: failures become permanent regression evals (Phase 55)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function queueDirPath(dir = tmpDir) {
    return path.join(dir, 'tests', 'eval-regressions', 'queue');
  }

  function acceptedDirPath(dir = tmpDir) {
    return path.join(dir, 'tests', 'eval-regressions', 'accepted');
  }

  function archivedDirPath(dir = tmpDir) {
    return path.join(dir, 'tests', 'eval-regressions', 'archived');
  }

  function writeDebugFixture(relPath, content) {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }

  function validCandidate(overrides = {}) {
    return {
      id: 'cand-valid-1',
      source: 'debugger',
      created_at: '2026-01-01T00:00:00.000Z',
      title: 'A valid candidate',
      context: { phase: null, root_cause: 'x', gap_description: null, debug_file: null, verification_file: null },
      expected: { type: 'file_exists', file: 'src/foo.js' },
      status: 'pending',
      ...overrides,
    };
  }

  function seedQueueFile(id, content) {
    const dir = queueDirPath();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${id}.json`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function seedQueueCandidate(candidate) {
    return seedQueueFile(candidate.id, JSON.stringify(candidate, null, 2));
  }

  function seedAcceptedCandidate(candidate) {
    const dir = acceptedDirPath();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${candidate.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(candidate, null, 2), 'utf-8');
    return filePath;
  }

  const CONFIRMED_LEAK_DEBUG_CONTENT = `---
status: verifying
trigger: "memory leak in worker pool"
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:05:00Z
---

## Current Focus

hypothesis: n/a

## Resolution

root_cause: worker pool never released event listeners on shutdown
fix: added removeAllListeners on worker.terminate()
verification: ran load test, memory stable
files_changed: [src/workers/pool.js]
`;

  const INCONCLUSIVE_LEAK_DEBUG_CONTENT = `---
status: investigating
trigger: "still looking"
---

## Resolution

root_cause: [empty until found]
fix: [empty until applied]
verification: [empty until verified]
files_changed: []
`;

  // Scenario (a), happy path: a debug session with a confirmed root_cause
  // produces exactly one well-formed candidate in queue/.
  test('scenario (a) happy path: `eval-candidate from-debug` on a confirmed debug session writes exactly one 7-key-schema candidate to queue/', () => {
    writeDebugFixture('.planning/debug/leak.md', CONFIRMED_LEAK_DEBUG_CONTENT);

    const result = runGsdTools('eval-candidate from-debug .planning/debug/leak.md', tmpDir);
    assert.ok(result.success, `expected CLI success, got: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.written, true);
    assert.strictEqual(parsed.paths.length, 1);

    const files = fs.readdirSync(queueDirPath()).filter((f) => f.endsWith('.json'));
    assert.strictEqual(files.length, 1, 'expected exactly one candidate file in queue/');

    const candidate = JSON.parse(fs.readFileSync(path.join(queueDirPath(), files[0]), 'utf-8'));
    const expectedKeys = ['id', 'source', 'created_at', 'title', 'context', 'expected', 'status'];
    assert.deepStrictEqual(Object.keys(candidate).sort(), [...expectedKeys].sort());
    assert.strictEqual(candidate.source, 'debugger');
    assert.strictEqual(candidate.status, 'pending');
    assert.strictEqual(candidate.context.root_cause, 'worker pool never released event listeners on shutdown');
    assert.deepStrictEqual(candidate.expected, { type: 'file_exists', file: 'src/workers/pool.js' });
  });

  // Scenario (a), inverse: an INVESTIGATION INCONCLUSIVE debug session (the
  // root_cause placeholder still intact) must write NOTHING to queue/.
  test('scenario (a) inverse: `eval-candidate from-debug` on an inconclusive debug session (placeholder root_cause) writes nothing to queue/', () => {
    writeDebugFixture('.planning/debug/leak.md', INCONCLUSIVE_LEAK_DEBUG_CONTENT);

    const result = runGsdTools('eval-candidate from-debug .planning/debug/leak.md', tmpDir);
    assert.ok(result.success, `expected CLI success (valid no-op), got: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.written, false);
    assert.strictEqual(parsed.reason, 'no confirmed root_cause found in debug file');

    const files = fs.existsSync(queueDirPath()) ? fs.readdirSync(queueDirPath()).filter((f) => f.endsWith('.json')) : [];
    assert.strictEqual(files.length, 0, 'expected queue/ file count to be unchanged (still zero)');
  });

  // Scenario (b), happy path: a candidate generated by (a) is then accepted
  // via the real CLI -- proves the generation -> review-queue pipeline
  // chains correctly, not just each command in isolation.
  test('scenario (b) happy path: a from-debug-generated candidate is accepted -> moves to accepted/ with status:"accepted", removed from queue/', () => {
    writeDebugFixture('.planning/debug/leak.md', CONFIRMED_LEAK_DEBUG_CONTENT);
    const genResult = runGsdTools('eval-candidate from-debug .planning/debug/leak.md', tmpDir);
    assert.ok(genResult.success, `expected generation CLI success, got: ${genResult.error}`);

    const queueFiles = fs.readdirSync(queueDirPath()).filter((f) => f.endsWith('.json'));
    assert.strictEqual(queueFiles.length, 1);
    const id = queueFiles[0].replace(/\.json$/, '');

    const acceptResult = runGsdTools(`eval-candidate accept ${id}`, tmpDir);
    assert.ok(acceptResult.success, `expected accept CLI success, got: ${acceptResult.error}`);
    const acceptParsed = JSON.parse(acceptResult.output);
    assert.strictEqual(acceptParsed.accepted, true);
    assert.strictEqual(acceptParsed.id, id);

    const acceptedPath = path.join(acceptedDirPath(), `${id}.json`);
    assert.ok(fs.existsSync(acceptedPath), 'expected candidate to exist in accepted/');
    const accepted = JSON.parse(fs.readFileSync(acceptedPath, 'utf-8'));
    assert.strictEqual(accepted.status, 'accepted');
    assert.ok(accepted.accepted_at, 'expected an accepted_at timestamp to have been added');

    const queuePath = path.join(queueDirPath(), `${id}.json`);
    assert.ok(!fs.existsSync(queuePath), 'expected candidate to no longer exist in queue/ (moved, not copied)');
  });

  // Scenario (b), inverse: a hand-seeded queue candidate is rejected via the
  // real CLI -- archived (never fully deleted from disk), status flips to
  // "rejected", and the given --reason text is recorded.
  test('scenario (b) inverse: `eval-candidate reject <id> --reason "flaky"` archives the candidate with status:"rejected" and the given reason, not deleted', () => {
    seedQueueCandidate(validCandidate({ id: 'cand-reject-me' }));

    const result = runGsdTools('eval-candidate reject cand-reject-me --reason "flaky"', tmpDir);
    assert.ok(result.success, `expected reject CLI success, got: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.rejected, true);
    assert.strictEqual(parsed.id, 'cand-reject-me');

    const archivedPath = path.join(archivedDirPath(), 'cand-reject-me.json');
    assert.ok(fs.existsSync(archivedPath), 'expected candidate to exist (archived, not deleted) in archived/');
    const archived = JSON.parse(fs.readFileSync(archivedPath, 'utf-8'));
    assert.strictEqual(archived.status, 'rejected');
    assert.ok(archived.reason.includes('flaky'), `expected reason to contain "flaky", got: ${archived.reason}`);
    assert.ok(archived.rejected_at, 'expected a rejected_at timestamp to have been added');

    const queuePath = path.join(queueDirPath(), 'cand-reject-me.json');
    assert.ok(!fs.existsSync(queuePath), 'expected candidate to no longer exist in queue/');
  });

  // Scenario (c): CI pickup of an accepted fixture actually catches a
  // regression -- the same command reports pass:true while the real file it
  // targets exists, then pass:false (and exits non-zero) the moment that
  // file is removed, proving CI would genuinely fail the build.
  test('scenario (c): `eval regress` reports pass:true while the target file exists, then pass:false/exit-1 once it is deleted', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'marker.txt'), 'marker content', 'utf-8');
    seedAcceptedCandidate(validCandidate({
      id: 'cand-marker',
      status: 'accepted',
      expected: { type: 'file_exists', file: 'src/marker.txt' },
    }));

    const passResult = runGsdTools('eval regress tests/eval-regressions/accepted --project-root .', tmpDir);
    assert.ok(passResult.success, `expected exit 0 while marker.txt exists, got: ${passResult.error}`);
    const passParsed = JSON.parse(passResult.output);
    assert.strictEqual(passParsed.pass, true);
    assert.strictEqual(passParsed.total, 1);
    assert.strictEqual(passParsed.executed[0].pass, true);

    fs.unlinkSync(path.join(tmpDir, 'src', 'marker.txt'));

    const failResult = runGsdTools('eval regress tests/eval-regressions/accepted --project-root .', tmpDir);
    assert.strictEqual(failResult.success, false, 'expected non-zero exit once marker.txt is deleted');
    const failParsed = JSON.parse(failResult.output);
    assert.strictEqual(failParsed.pass, false);
    assert.strictEqual(failParsed.executed[0].pass, false);
    assert.strictEqual(failParsed.executed[0].id, 'cand-marker');
  });

  // Scenario (d): a malformed (invalid JSON) file placed directly in
  // accepted/ is a loud, explicit, non-crashing failure -- named in the
  // `malformed` array, never silently dropped -- and fails the whole run.
  test('scenario (d): a malformed (invalid JSON) file in accepted/ is reported by name in `malformed`, and the CLI exits non-zero without crashing', () => {
    const acceptedDir = acceptedDirPath();
    fs.mkdirSync(acceptedDir, { recursive: true });
    fs.writeFileSync(path.join(acceptedDir, 'bad.json'), '{not valid json', 'utf-8');

    const result = runGsdTools('eval regress tests/eval-regressions/accepted --project-root .', tmpDir);
    assert.strictEqual(result.success, false, 'expected non-zero exit due to the malformed committed candidate');

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.pass, false);
    assert.ok(Array.isArray(parsed.malformed), 'expected a malformed array in the result');
    const malformedEntry = parsed.malformed.find((m) => m.file === 'bad.json');
    assert.ok(malformedEntry, `expected an entry naming bad.json in malformed, got: ${JSON.stringify(parsed.malformed)}`);
    assert.strictEqual(malformedEntry.valid, false);
  });

  // Regression guard: the full loop -- generate from a debug session, accept
  // it, then have `eval regress` pick up the now-accepted fixture and pass --
  // still works end-to-end when every step is chained in one continuous run,
  // proving "a failure becomes a permanent, CI-verified regression eval" is
  // not just true of each command in isolation.
  test('regression guard: full pipeline (from-debug -> accept -> eval regress) chains correctly end-to-end in one continuous run', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'workers'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'workers', 'pool.js'), '// pool implementation\n', 'utf-8');
    writeDebugFixture('.planning/debug/leak.md', CONFIRMED_LEAK_DEBUG_CONTENT);

    const genResult = runGsdTools('eval-candidate from-debug .planning/debug/leak.md', tmpDir);
    assert.ok(genResult.success, `expected generation CLI success, got: ${genResult.error}`);
    const queueFiles = fs.readdirSync(queueDirPath()).filter((f) => f.endsWith('.json'));
    assert.strictEqual(queueFiles.length, 1);
    const id = queueFiles[0].replace(/\.json$/, '');

    const acceptResult = runGsdTools(`eval-candidate accept ${id}`, tmpDir);
    assert.ok(acceptResult.success, `expected accept CLI success, got: ${acceptResult.error}`);
    assert.ok(fs.existsSync(path.join(acceptedDirPath(), `${id}.json`)), 'expected accepted candidate on disk');

    const regressResult = runGsdTools('eval regress tests/eval-regressions/accepted --project-root .', tmpDir);
    assert.ok(regressResult.success, `expected eval regress to pass since src/workers/pool.js exists, got: ${regressResult.error}`);
    const regressParsed = JSON.parse(regressResult.output);
    assert.strictEqual(regressParsed.pass, true);
    assert.strictEqual(regressParsed.total, 1);
    assert.strictEqual(regressParsed.executed[0].id, id);
    assert.strictEqual(regressParsed.executed[0].pass, true);
  });
});

// MILE-33 (Phase 56-03): cross-cutting integration tests. Mirrors the
// MILE-32 block above's pattern exactly -- each test builds its own isolated
// temp project via createTempProject() (a fixture `agents/` dir, temp
// `.planning/telemetry/agent-reports.jsonl`, temp
// `tests/eval-regressions/accepted/`, temp `get-shit-done/config/
// prompt-budgets.json` -- NEVER the real repo's agents/ or .planning/
// trees), then drives the real `prompt-optimize --agent <name>` CLI
// subprocess via runGsdTools. Covers all 5 required MILE-33 scenarios:
// diagnosis generation from seeded telemetry failures, budget-violation
// rejection, eval-failure rejection, the no-signal path, and diff format
// validity on the real written candidate.diff file.
describe('MILE-33 end-to-end: reflective prompt optimization (Phase 56)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  const FIXTURE_AGENT_A_CONTENT = `# GSD Fixture Agent A

This is a short preamble for the fixture agent used by Phase 56-03's
MILE-33 integration tests.

<!-- GSD:CORE-PREAMBLE-END -->

## Detail Section

Extra detail content that lives after the core preamble marker.
`;

  const FIXTURE_AGENT_B_CONTENT = `# GSD Fixture Agent B

A second, unrelated fixture agent with no telemetry or eval signal at all.

<!-- GSD:CORE-PREAMBLE-END -->

## Detail Section

Nothing interesting here.
`;

  const SEEDED_AMBIGUITY_TEXT = 'unclear scope boundary for fixture task X';

  function writeFixtureAgent(fileName, content) {
    const dir = path.join(tmpDir, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
  }

  function seedTelemetryEntry(agentName, extra = {}) {
    const dir = path.join(tmpDir, '.planning', 'telemetry');
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      agent: agentName,
      timestamp: '2026-01-01T00:00:00.000Z',
      ambiguities: [SEEDED_AMBIGUITY_TEXT],
      instructions_not_followed: [],
      tool_errors_swallowed: 0,
      ...extra,
    };
    fs.appendFileSync(path.join(dir, 'agent-reports.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');
  }

  function seedBudgetConfig(map) {
    const dir = path.join(tmpDir, 'get-shit-done', 'config');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompt-budgets.json'), JSON.stringify(map, null, 2), 'utf-8');
  }

  function seedAcceptedEvalCandidate(candidate) {
    const dir = path.join(tmpDir, 'tests', 'eval-regressions', 'accepted');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${candidate.id}.json`), JSON.stringify(candidate, null, 2), 'utf-8');
  }

  function forbiddenStringCandidate() {
    return {
      id: 'cand-fixture-a-never-appears',
      source: 'debugger',
      created_at: '2026-01-01T00:00:00.000Z',
      title: 'gsd-fixture-a must never contain a forbidden string',
      context: { agent: 'gsd-fixture-a', phase: null, root_cause: 'x', gap_description: null, debug_file: null, verification_file: null },
      expected: { type: 'file_contains', file: 'agents/gsd-fixture-a.md', needle: 'THIS_STRING_WILL_NEVER_APPEAR_IN_THE_REVISION' },
      status: 'accepted',
    };
  }

  // Scenario (a): diagnosis generation from seeded telemetry failures.
  test('scenario (a): diagnosis generation from seeded telemetry produces ready_for_review with diagnosis+diff files on disk', () => {
    writeFixtureAgent('gsd-fixture-a.md', FIXTURE_AGENT_A_CONTENT);
    seedTelemetryEntry('gsd-fixture-a');
    seedBudgetConfig({ 'agents/gsd-fixture-a.md': 100000 });

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-a', tmpDir);
    assert.ok(result.success, `expected exit 0, got: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'ready_for_review');
    assert.strictEqual(parsed.agent, 'gsd-fixture-a');

    const diagnosisFullPath = path.join(tmpDir, parsed.diagnosisPath);
    const diffFullPath = path.join(tmpDir, parsed.diffPath);
    assert.ok(fs.existsSync(diagnosisFullPath), `expected diagnosis file to exist at ${diagnosisFullPath}`);
    assert.ok(fs.existsSync(diffFullPath), `expected diff file to exist at ${diffFullPath}`);

    const diagnosisContent = fs.readFileSync(diagnosisFullPath, 'utf-8');
    assert.ok(diagnosisContent.includes('gsd-fixture-a'), 'expected diagnosis file to name the agent');

    const diffContent = fs.readFileSync(diffFullPath, 'utf-8');
    assert.ok(diffContent.includes(SEEDED_AMBIGUITY_TEXT), 'expected candidate diff to contain the seeded ambiguity text');
  });

  // Scenario (a), gate-results check: both gates pass on a generous budget
  // with no conflicting accepted eval candidates.
  test('scenario (a): ready_for_review JSON output reports both gates passing', () => {
    writeFixtureAgent('gsd-fixture-a.md', FIXTURE_AGENT_A_CONTENT);
    seedTelemetryEntry('gsd-fixture-a');
    seedBudgetConfig({ 'agents/gsd-fixture-a.md': 100000 });

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-a', tmpDir);
    assert.ok(result.success, `expected exit 0, got: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.budgetResult.pass, true);
    assert.strictEqual(parsed.evalResult.pass, true);
    assert.strictEqual(parsed.evalResult.total, 0);
  });

  // Scenario (b): budget-violation rejection.
  test('scenario (b): a deliberately tiny budget rejects the candidate with reason budget_exceeded, still writing rejected artifacts', () => {
    writeFixtureAgent('gsd-fixture-a.md', FIXTURE_AGENT_A_CONTENT);
    seedTelemetryEntry('gsd-fixture-a');
    seedBudgetConfig({ 'agents/gsd-fixture-a.md': 1 });

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-a', tmpDir);
    assert.strictEqual(result.success, false, 'expected non-zero exit on budget_exceeded rejection');

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'rejected');
    assert.strictEqual(parsed.reason, 'budget_exceeded');

    const diagnosisFullPath = path.join(tmpDir, parsed.diagnosisPath);
    const diffFullPath = path.join(tmpDir, parsed.diffPath);
    assert.ok(parsed.diagnosisPath.endsWith('diagnosis-rejected.md'), `expected diagnosis-rejected.md, got: ${parsed.diagnosisPath}`);
    assert.ok(parsed.diffPath.endsWith('candidate-rejected.diff'), `expected candidate-rejected.diff, got: ${parsed.diffPath}`);
    assert.ok(fs.existsSync(diagnosisFullPath), 'expected diagnosis-rejected.md to exist on disk');
    assert.ok(fs.existsSync(diffFullPath), 'expected candidate-rejected.diff to exist on disk');
  });

  // Scenario (b), gate-results check: budget genuinely exceeded.
  test('scenario (b): budgetResult in JSON output reports pass:false with estimatedTokens exceeding the tiny budget', () => {
    writeFixtureAgent('gsd-fixture-a.md', FIXTURE_AGENT_A_CONTENT);
    seedTelemetryEntry('gsd-fixture-a');
    seedBudgetConfig({ 'agents/gsd-fixture-a.md': 1 });

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-a', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.budgetResult.pass, false);
    assert.strictEqual(parsed.budgetResult.budget, 1);
    assert.ok(parsed.budgetResult.estimatedTokens > 1, 'expected estimatedTokens to exceed the tiny budget');
  });

  // Scenario (c): eval-failure rejection -- generous budget, ONLY the eval
  // gate is under test.
  test('scenario (c): an accepted eval candidate whose assertion the revision breaks rejects with reason eval_failed', () => {
    writeFixtureAgent('gsd-fixture-a.md', FIXTURE_AGENT_A_CONTENT);
    seedTelemetryEntry('gsd-fixture-a');
    seedBudgetConfig({ 'agents/gsd-fixture-a.md': 100000 });
    seedAcceptedEvalCandidate(forbiddenStringCandidate());

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-a', tmpDir);
    assert.strictEqual(result.success, false, 'expected non-zero exit on eval_failed rejection');

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'rejected');
    assert.strictEqual(parsed.reason, 'eval_failed');
  });

  // Scenario (c), gate-results check: budget passes, only eval fails --
  // proves the rejection is attributable to the eval gate specifically.
  test('scenario (c): evalResult reports pass:false while budgetResult reports pass:true (isolating the eval gate)', () => {
    writeFixtureAgent('gsd-fixture-a.md', FIXTURE_AGENT_A_CONTENT);
    seedTelemetryEntry('gsd-fixture-a');
    seedBudgetConfig({ 'agents/gsd-fixture-a.md': 100000 });
    seedAcceptedEvalCandidate(forbiddenStringCandidate());

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-a', tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.budgetResult.pass, true);
    assert.strictEqual(parsed.evalResult.pass, false);
    assert.ok(parsed.evalResult.total >= 1, 'expected at least one evaluated accepted candidate');
  });

  // Scenario (d): no-signal path -- a separate fixture agent with no
  // telemetry and no matching eval-regression candidates anywhere.
  test('scenario (d): a fixture agent with zero telemetry/eval signal exits 0 with status no_signal and writes nothing to disk', () => {
    writeFixtureAgent('gsd-fixture-b.md', FIXTURE_AGENT_B_CONTENT);

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-b', tmpDir);
    assert.ok(result.success, `expected exit 0 on no_signal, got: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'no_signal');
    assert.strictEqual(parsed.agent, 'gsd-fixture-b');

    const reviewDir = path.join(tmpDir, '.planning', 'prompt-optimize', 'gsd-fixture-b');
    assert.ok(!fs.existsSync(reviewDir), 'expected no review-artifact directory to be written for the no_signal path');
  });

  // Scenario (e): diff format validity -- the real written candidate.diff
  // file (not a unit-level isValidUnifiedDiff call) must be structurally
  // valid unified-diff text.
  test('scenario (e): the real written candidate.diff contains valid unified-diff structure (--- / +++ / @@ headers)', () => {
    writeFixtureAgent('gsd-fixture-a.md', FIXTURE_AGENT_A_CONTENT);
    seedTelemetryEntry('gsd-fixture-a');
    seedBudgetConfig({ 'agents/gsd-fixture-a.md': 100000 });

    const result = runGsdTools('prompt-optimize --agent gsd-fixture-a', tmpDir);
    assert.ok(result.success, `expected exit 0, got: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const diffContent = fs.readFileSync(path.join(tmpDir, parsed.diffPath), 'utf-8');

    assert.ok(/^--- /m.test(diffContent), 'expected a "--- " header line');
    assert.ok(/^\+\+\+ /m.test(diffContent), 'expected a "+++ " header line');
    assert.ok(/^@@ .*@@/m.test(diffContent), 'expected at least one "@@ ... @@" hunk header line');
  });
});

describe('Phase 57-01: routing ledger storage & build', () => {
  const { deriveTaskType, buildRoutingLedger, readRoutingLedger, writeRoutingLedger, loadConfig } = require(TOOLS_PATH);

  describe('deriveTaskType', () => {
    test('first-match-wins ordering: "write" precedes "fix" in the vocabulary', () => {
      assert.strictEqual(deriveTaskType('write and fix the bug'), 'write');
    });

    test('whole-word matching does NOT match "rewrite" as "write"', () => {
      assert.strictEqual(deriveTaskType('rewrite the module entirely'), 'other');
    });

    test('case-insensitive matching', () => {
      assert.strictEqual(deriveTaskType('WRITE the wallet_credit RPC'), 'write');
      assert.strictEqual(deriveTaskType('Fix the failing test'), 'fix');
    });

    test('falls back to "other" when no vocabulary verb matches', () => {
      assert.strictEqual(deriveTaskType('look at the thing'), 'other');
    });

    test('falls back to "other" for empty/non-string input', () => {
      assert.strictEqual(deriveTaskType(''), 'other');
      assert.strictEqual(deriveTaskType(null), 'other');
      assert.strictEqual(deriveTaskType(undefined), 'other');
      assert.strictEqual(deriveTaskType(42), 'other');
    });

    test('matches a later-vocabulary verb when no earlier verb is present', () => {
      assert.strictEqual(deriveTaskType('investigate the root cause'), 'investigate');
      assert.strictEqual(deriveTaskType('commit the staged changes'), 'commit');
    });
  });

  describe('buildRoutingLedger (pure)', () => {
    test('buckets mixed task_outcome events across 2+ task_types and multiple tiers', () => {
      const events = [
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'success' },
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'failure' },
        { type: 'task_outcome', task_type: 'write', tier: 'sonnet', outcome: 'success' },
        { type: 'task_outcome', task_type: 'fix', tier: 'opus', outcome: 'success' },
        { type: 'task_outcome', task_type: 'fix', tier: 'opus', outcome: 'success' },
      ];
      const ledger = buildRoutingLedger(events);
      assert.deepStrictEqual(ledger.task_types.write.haiku, { attempts: 2, successes: 1, failures: 1 });
      assert.deepStrictEqual(ledger.task_types.write.sonnet, { attempts: 1, successes: 1, failures: 0 });
      assert.deepStrictEqual(ledger.task_types.fix.opus, { attempts: 2, successes: 2, failures: 0 });
    });

    test('source_event_count counts only task_outcome events; non-matching event types in the same array are ignored', () => {
      const events = [
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'success' },
        { type: 'phase_start', phase: '57' },
        { type: 'tier_escalation', from_tier: 'haiku', to_tier: 'sonnet' },
        { type: 'task_outcome', task_type: 'fix', tier: 'sonnet', outcome: 'failure' },
      ];
      const ledger = buildRoutingLedger(events);
      assert.strictEqual(ledger.source_event_count, 2);
    });

    test('an empty events array produces {task_types: {}} without throwing', () => {
      assert.doesNotThrow(() => {
        const ledger = buildRoutingLedger([]);
        assert.deepStrictEqual(ledger.task_types, {});
        assert.strictEqual(ledger.source_event_count, 0);
      });
      assert.doesNotThrow(() => {
        const ledger = buildRoutingLedger(null);
        assert.deepStrictEqual(ledger.task_types, {});
      });
    });

    test('min_sample_count defaults to 5 and is overridable via options.minSampleCount', () => {
      assert.strictEqual(buildRoutingLedger([]).min_sample_count, 5);
      assert.strictEqual(buildRoutingLedger([], { minSampleCount: 12 }).min_sample_count, 12);
    });

    test('telemetry-enrichment path folds tool_errors_swallowed into quality_flags only on the matching (phase, plan) bucket', () => {
      const events = [
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'success', phase: '57', plan: '01' },
        { type: 'task_outcome', task_type: 'fix', tier: 'sonnet', outcome: 'success', phase: '58', plan: '01' },
      ];
      const telemetryReports = [
        { phase: '57', plan: '01', tool_errors_swallowed: 3 },
        { phase: '99', plan: '01', tool_errors_swallowed: 7 }, // no matching task_outcome — must not affect any bucket
      ];
      const ledger = buildRoutingLedger(events, { telemetryReports });
      assert.strictEqual(ledger.task_types.write.haiku.quality_flags, 3);
      assert.strictEqual(ledger.task_types.fix.sonnet.quality_flags, undefined);
    });

    test('telemetry enrichment is a no-op when telemetryReports is omitted', () => {
      const events = [
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'success', phase: '57', plan: '01' },
      ];
      const ledger = buildRoutingLedger(events);
      assert.strictEqual(ledger.task_types.write.haiku.quality_flags, undefined);
    });
  });

  describe('readRoutingLedger / writeRoutingLedger', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    test('missing file -> {ok:true, ledger:null, reason:"missing"}, never throws', () => {
      let result;
      assert.doesNotThrow(() => { result = readRoutingLedger(tmpDir); });
      assert.deepStrictEqual(result, { ok: true, ledger: null, reason: 'missing' });
    });

    test('malformed JSON file -> {ok:false, ledger:null, reason:"corrupt"}, never throws', () => {
      const ledgerPath = path.join(tmpDir, '.planning', 'routing-ledger.json');
      fs.writeFileSync(ledgerPath, 'NOT VALID JSON{{{', 'utf-8');
      let result;
      assert.doesNotThrow(() => { result = readRoutingLedger(tmpDir); });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ledger, null);
      assert.strictEqual(result.reason, 'corrupt');
    });

    test('a valid JSON file missing the task_types key -> reason:"corrupt", never throws', () => {
      const ledgerPath = path.join(tmpDir, '.planning', 'routing-ledger.json');
      fs.writeFileSync(ledgerPath, JSON.stringify({ built_at: 'x', source_event_count: 0 }), 'utf-8');
      let result;
      assert.doesNotThrow(() => { result = readRoutingLedger(tmpDir); });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'corrupt');
    });

    test('writeRoutingLedger + readRoutingLedger round-trip: deep equality', () => {
      const ledger = buildRoutingLedger([
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'success' },
      ]);
      writeRoutingLedger(tmpDir, ledger);
      const result = readRoutingLedger(tmpDir);
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.ledger, ledger);
    });
  });

  describe('loadConfig routing_min_sample_count', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    test('defaults to 5 when config.json is absent', () => {
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.routing_min_sample_count, 5);
    });

    test('resolves to 12 when config.json has {"routing": {"min_sample_count": 12}}', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ routing: { min_sample_count: 12 } }),
        'utf-8'
      );
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.routing_min_sample_count, 12);
    });
  });

  describe('CLI integration', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    function seedExecutionLogEvents(events) {
      const logPath = path.join(tmpDir, '.planning', 'EXECUTION_LOG.md');
      const header = '# Autonomous Roadmap Execution Log\n\n';
      const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(logPath, header + lines, 'utf-8');
    }

    test('routing task-type "<desc>" --raw prints the bare derived type', () => {
      const result = runGsdTools('routing task-type "Write the wallet_credit RPC" --raw', tmpDir);
      assert.ok(result.success, `expected exit 0: ${result.error}`);
      assert.strictEqual(result.output, 'write');
    });

    // Integration-test scenario #1 from 57-RESEARCH.md: ledger build from
    // seeded EXECUTION_LOG.md events.
    test('routing ledger build --raw against a seeded EXECUTION_LOG.md writes a valid routing-ledger.json with correct bucket counts', () => {
      seedExecutionLogEvents([
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'success' },
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'failure' },
        { type: 'task_outcome', task_type: 'fix', tier: 'sonnet', outcome: 'success' },
        { type: 'phase_start', phase: '57' },
      ]);

      const result = runGsdTools('routing ledger build --raw', tmpDir);
      assert.ok(result.success, `expected exit 0: ${result.error}`);
      const summary = JSON.parse(result.output);
      assert.strictEqual(summary.ok, true);
      assert.strictEqual(summary.source_event_count, 3);
      assert.strictEqual(summary.task_type_count, 2);

      // Assert the file on disk, not just the CLI's summary output.
      const ledgerPath = path.join(tmpDir, '.planning', 'routing-ledger.json');
      assert.ok(fs.existsSync(ledgerPath), 'expected routing-ledger.json to be written to disk');
      const onDisk = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
      assert.deepStrictEqual(onDisk.task_types.write.haiku, { attempts: 2, successes: 1, failures: 1 });
      assert.deepStrictEqual(onDisk.task_types.fix.sonnet, { attempts: 1, successes: 1, failures: 0 });
    });

    test('routing ledger show --raw returns the built ledger from a project with a valid routing-ledger.json', () => {
      seedExecutionLogEvents([
        { type: 'task_outcome', task_type: 'write', tier: 'haiku', outcome: 'success' },
      ]);
      const buildResult = runGsdTools('routing ledger build --raw', tmpDir);
      assert.ok(buildResult.success);

      const showResult = runGsdTools('routing ledger show --raw', tmpDir);
      assert.ok(showResult.success, `expected exit 0: ${showResult.error}`);
      const shown = JSON.parse(showResult.output);
      assert.deepStrictEqual(shown.task_types.write.haiku, { attempts: 1, successes: 1, failures: 0 });
    });

    // Corrupt-ledger scenario #3 from 57-RESEARCH.md's required coverage list
    // (ledger-consult half deferred to Plan 57-02 — this asserts the `show`
    // half: it never throws / never non-zero exits on a corrupt file).
    test('routing ledger show --raw against a corrupted routing-ledger.json returns ok:false, reason:"corrupt" without a non-zero-exit crash', () => {
      const ledgerPath = path.join(tmpDir, '.planning', 'routing-ledger.json');
      fs.writeFileSync(ledgerPath, 'NOT VALID JSON{{{', 'utf-8');

      const result = runGsdTools('routing ledger show --raw', tmpDir);
      assert.ok(result.success, `show must still exit 0 even on a corrupt ledger: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.reason, 'corrupt');
    });
  });
});

describe('Phase 57-02: ledger consultation & task-router wiring', () => {
  const { consultLedger } = require(TOOLS_PATH);

  describe('consultLedger (pure)', () => {
    test('null ledger -> fail-open heuristic passthrough', () => {
      const result = consultLedger(null, 'write', 'haiku', 5);
      assert.deepStrictEqual(result, { tier: 'haiku', adjusted: false, fail_open: true, reason: 'ledger_unavailable' });
    });

    test('ledger present but no bucket for the requested task_type -> not adjusted, reason no_data_for_task_type', () => {
      const ledger = { task_types: { fix: { haiku: { attempts: 10, successes: 8, failures: 2 } } } };
      const result = consultLedger(ledger, 'write', 'haiku', 5);
      assert.strictEqual(result.adjusted, false);
      assert.strictEqual(result.reason, 'no_data_for_task_type');
      assert.strictEqual(result.tier, 'haiku');
    });

    test('total samples below min_sample_count -> not adjusted, reason insufficient_sample, EVEN when rates would otherwise justify adjustment', () => {
      // haiku 0/2 successes, sonnet 5/5 successes -- total attempts 7 < minSampleCount 10
      const ledger = {
        task_types: {
          write: {
            haiku: { attempts: 2, successes: 0, failures: 2 },
            sonnet: { attempts: 5, successes: 5, failures: 0 },
          },
        },
      };
      const result = consultLedger(ledger, 'write', 'haiku', 10);
      assert.strictEqual(result.adjusted, false);
      assert.strictEqual(result.reason, 'insufficient_sample');
      assert.strictEqual(result.sample_count, 7);
    });

    test('heuristic tier success_rate >= 0.5 -> no adjustment even if a higher tier looks better', () => {
      const ledger = {
        task_types: {
          write: {
            haiku: { attempts: 10, successes: 6, failures: 4 }, // 60% -- not below the 0.5 contradiction threshold
            sonnet: { attempts: 10, successes: 10, failures: 0 }, // 100%
          },
        },
      };
      const result = consultLedger(ledger, 'write', 'haiku', 5);
      assert.strictEqual(result.adjusted, false);
      assert.strictEqual(result.tier, 'haiku');
    });

    test('a genuine contradiction (haiku 20%, sonnet 90%, both >= min sample) -> adjusted:true, tier:sonnet, reason mentions both rates', () => {
      const ledger = {
        task_types: {
          write: {
            haiku: { attempts: 10, successes: 2, failures: 8 },
            sonnet: { attempts: 10, successes: 9, failures: 1 },
          },
        },
      };
      const result = consultLedger(ledger, 'write', 'haiku', 5);
      assert.strictEqual(result.adjusted, true);
      assert.strictEqual(result.tier, 'sonnet');
      assert.match(result.reason, /20%/);
      assert.match(result.reason, /90%/);
    });

    test('heuristic tier is opus (ceiling, getNextTier("opus") === null) -> never adjusts regardless of data', () => {
      const ledger = {
        task_types: {
          write: {
            opus: { attempts: 10, successes: 1, failures: 9 },
          },
        },
      };
      const result = consultLedger(ledger, 'write', 'opus', 5);
      assert.strictEqual(result.adjusted, false);
      assert.strictEqual(result.tier, 'opus');
    });

    test('never adjusts DOWN -- sonnet with a worse rate than haiku still returns adjusted:false', () => {
      const ledger = {
        task_types: {
          write: {
            haiku: { attempts: 10, successes: 9, failures: 1 }, // 90% -- good, no reason to escalate
            sonnet: { attempts: 10, successes: 2, failures: 8 }, // 20% -- worse, but consultLedger only ever compares heuristic vs the tier ABOVE it
          },
        },
      };
      const result = consultLedger(ledger, 'write', 'sonnet', 5);
      assert.strictEqual(result.adjusted, false);
      assert.strictEqual(result.tier, 'sonnet');
    });
  });

  describe('CLI integration: routing ledger consult', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    function seedLedger(ledger) {
      const ledgerPath = path.join(tmpDir, '.planning', 'routing-ledger.json');
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');
    }

    // runGsdTools (execSync-based) only captures stderr on a NON-zero exit --
    // the fail-open path here exits 0 while still writing a stderr warning,
    // so a synchronous spawnSync call (which always returns both streams
    // regardless of exit code) is used instead for these two assertions.
    function runGsdToolsCapturingStderr(args, cwd) {
      const { spawnSync } = require('child_process');
      const result = spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd, encoding: 'utf-8' });
      return { success: result.status === 0, output: (result.stdout || '').trim(), error: (result.stderr || '').trim() };
    }

    // Integration-test scenario #2 from 57-RESEARCH.md: consultLedger
    // changing a tier decision via the real CLI.
    test('adjustment scenario: haiku-poor/sonnet-good bucket at sufficient sample count -> adjusted:true, tier:sonnet', () => {
      seedLedger({
        built_at: '2026-07-06T00:00:00.000Z',
        source_event_count: 20,
        min_sample_count: 5,
        task_types: {
          write: {
            haiku: { attempts: 10, successes: 2, failures: 8 },
            sonnet: { attempts: 10, successes: 9, failures: 1 },
          },
        },
      });
      const result = runGsdTools('routing ledger consult --task-type write --heuristic-tier haiku --raw', tmpDir);
      assert.ok(result.success, `expected exit 0: ${result.error}`);
      const decision = JSON.parse(result.output);
      assert.strictEqual(decision.adjusted, true);
      assert.strictEqual(decision.tier, 'sonnet');
    });

    // Integration-test scenario #3 from 57-RESEARCH.md: absent-ledger fail-open.
    test('fail-open scenario: NO ledger file at all -> stderr WARNING + stdout fail_open:true', () => {
      const result = runGsdToolsCapturingStderr(['routing', 'ledger', 'consult', '--task-type', 'write', '--heuristic-tier', 'haiku', '--raw'], tmpDir);
      assert.ok(result.success, `expected exit 0 (fail-open, not an error): ${result.error}`);
      assert.match(result.error, /WARNING: routing ledger unavailable/);
      const decision = JSON.parse(result.output);
      assert.strictEqual(decision.fail_open, true);
    });

    // Integration-test scenario #3 (corrupt half) from 57-RESEARCH.md's
    // required coverage list.
    test('fail-open scenario: corrupt (non-JSON) routing-ledger.json -> stderr WARNING + stdout fail_open:true', () => {
      const ledgerPath = path.join(tmpDir, '.planning', 'routing-ledger.json');
      fs.writeFileSync(ledgerPath, 'NOT VALID JSON{{{', 'utf-8');
      const result = runGsdToolsCapturingStderr(['routing', 'ledger', 'consult', '--task-type', 'write', '--heuristic-tier', 'haiku', '--raw'], tmpDir);
      assert.ok(result.success, `expected exit 0 (fail-open, not an error): ${result.error}`);
      assert.match(result.error, /WARNING: routing ledger unavailable/);
      const decision = JSON.parse(result.output);
      assert.strictEqual(decision.fail_open, true);
    });

    test('missing --task-type or --heuristic-tier errors', () => {
      const result = runGsdTools('routing ledger consult --heuristic-tier haiku --raw', tmpDir);
      assert.strictEqual(result.success, false);
    });
  });

  describe('gsd-task-router.md grep-assertion (prose wiring lock-in)', () => {
    const routerPath = path.join(__dirname, '..', '..', 'agents', 'gsd-task-router.md');
    const content = fs.readFileSync(routerPath, 'utf-8');

    test('consult_ledger step name is present', () => {
      assert.match(content, /<step name="consult_ledger">/);
    });

    test('ordering lock-in: check_quota < consult_ledger < get_context', () => {
      const checkQuotaIdx = content.indexOf('name="check_quota"');
      const consultLedgerIdx = content.indexOf('name="consult_ledger"');
      const getContextIdx = content.indexOf('name="get_context"');
      assert.ok(checkQuotaIdx !== -1, 'check_quota step not found');
      assert.ok(consultLedgerIdx !== -1, 'consult_ledger step not found');
      assert.ok(getContextIdx !== -1, 'get_context step not found');
      assert.ok(checkQuotaIdx < consultLedgerIdx, 'consult_ledger must come after check_quota');
      assert.ok(consultLedgerIdx < getContextIdx, 'consult_ledger must come before get_context');
    });

    test('routing task-type and routing ledger consult commands are both present inside the consult_ledger step body', () => {
      const stepStart = content.indexOf('<step name="consult_ledger">');
      const stepEnd = content.indexOf('</step>', stepStart);
      const stepBody = content.slice(stepStart, stepEnd);
      assert.match(stepBody, /routing task-type/);
      assert.match(stepBody, /routing ledger consult/);
    });

    test('a Ledger: line template is present in the return_decision step output format section', () => {
      const stepStart = content.indexOf('<step name="return_decision">');
      const stepEnd = content.indexOf('</step>', stepStart);
      const stepBody = content.slice(stepStart, stepEnd);
      assert.match(stepBody, /Ledger:/);
    });
  });
});

// [Rule 1 - Bug] found during Phase 57-02's own mandatory state_updates step:
// `state record-session` used the bold-only `stateReplaceField` for all 4 of
// its fields (Last session/Last Date/Stopped At/Resume File), but the real
// STATE.md's "## Session Continuity" section is plain prose ("Last session:
// ..."), not bold ("**Last session:**") -- every field silently failed to
// match, so every real invocation returned `{recorded: false, reason: "No
// session fields found in STATE.md"}` and STATE.md was never actually
// updated. Fixed by switching to `stateReplaceFieldTolerant` (bold-first,
// plain-prose-fallback), matching the established 51-01 STATE.md-tolerance
// convention already used by `state advance-plan`'s Status/Last-activity
// fields.
describe("Phase 57-02 [Rule 1 fix]: state record-session tolerates plain-prose STATE.md fields", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writePlainProseState() {
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    const content = [
      '# Project State',
      '',
      '## Session Continuity',
      '',
      'Last session: 2026-01-01',
      'Stopped at: some prior stopping point',
      'Resume file: none',
      '',
    ].join('\n');
    fs.writeFileSync(statePath, content, 'utf-8');
    return statePath;
  }

  test('record-session updates plain-prose Last session/Stopped at/Resume file lines (regression guard for the discard bug)', () => {
    const statePath = writePlainProseState();
    const result = runGsdTools('state record-session --stopped-at "Completed 57-02-PLAN.md" --resume-file none', tmpDir);
    assert.ok(result.success, `expected exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.recorded, true);
    assert.ok(parsed.updated.includes('Last session'));
    assert.ok(parsed.updated.includes('Stopped At'));
    assert.ok(parsed.updated.includes('Resume File'));

    const updatedContent = fs.readFileSync(statePath, 'utf-8');
    assert.match(updatedContent, /Stopped at: Completed 57-02-PLAN\.md/);
    assert.doesNotMatch(updatedContent, /some prior stopping point/);
  });

  test('bold-format STATE.md (pre-existing convention) still works after the fix', () => {
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    fs.writeFileSync(statePath, [
      '# Project State',
      '',
      '## Session Continuity',
      '',
      '**Last session:** 2026-01-01',
      '**Stopped At:** old value',
      '**Resume File:** old-resume.md',
      '',
    ].join('\n'), 'utf-8');

    const result = runGsdTools('state record-session --stopped-at "new stopped value"', tmpDir);
    assert.ok(result.success, `expected exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.recorded, true);

    const updatedContent = fs.readFileSync(statePath, 'utf-8');
    assert.match(updatedContent, /\*\*Stopped At:\*\* new stopped value/);
  });
});

// [Rule 1 - Bug] found during Phase 57-01's state_updates step: `roadmap
// update-plan-progress`'s table regex assumed a 4-column progress table
// (Phase | Plans | Status | Completed) but the real table has 5 columns
// (Phase | Milestone | Plans | Status | Completed) -- the Milestone cell was
// silently discarded on every run. Fixed to preserve the Milestone column
// verbatim while only rewriting Plans/Status/Completed.
describe('Phase 57-01 [Rule 1 fix]: roadmap update-plan-progress preserves the Milestone column', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function seedPhaseWithRoadmapRow(rowLine) {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '57-routing-ledger-escalation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '57-01-PLAN.md'), '# plan 1');
    fs.writeFileSync(path.join(phaseDir, '57-02-PLAN.md'), '# plan 2');
    fs.writeFileSync(path.join(phaseDir, '57-01-SUMMARY.md'), '# summary 1');

    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    const content = [
      '# Roadmap',
      '',
      '## Progress',
      '',
      '| Phase | Milestone | Plans | Status | Completed |',
      '|-------|-----------|-------|--------|-----------|',
      rowLine,
      '| 58. Next Phase | v1.15.0 | 0/TBD | Not started | - |',
      '',
    ].join('\n');
    fs.writeFileSync(roadmapPath, content, 'utf-8');
    return roadmapPath;
  }

  test('a well-formed 5-column row keeps its Milestone value after an update (regression guard for the discard bug)', () => {
    const roadmapPath = seedPhaseWithRoadmapRow(
      '| 57. Outcome-Informed Routing Ledger & Bounded Escalation | v1.15.0 | 0/TBD | Not started | - |'
    );

    const result = runGsdTools('roadmap update-plan-progress 57', tmpDir);
    assert.ok(result.success, `expected exit 0: ${result.error}`);

    const updated = fs.readFileSync(roadmapPath, 'utf-8');
    const row = updated.split('\n').find((l) => l.startsWith('| 57.'));
    assert.ok(row, 'expected to find the Phase 57 row in the updated ROADMAP.md');
    assert.ok(row.includes('v1.15.0'), `Milestone column must be preserved, got: ${row}`);
    assert.ok(row.includes('1/2'), `Plans column must reflect 1 summary / 2 plans, got: ${row}`);
    assert.ok(/In Progress/.test(row), `Status column must be In Progress, got: ${row}`);
  });

  test('the neighboring row (Phase 58) is untouched by a Phase 57 update', () => {
    const roadmapPath = seedPhaseWithRoadmapRow(
      '| 57. Outcome-Informed Routing Ledger & Bounded Escalation | v1.15.0 | 0/TBD | Not started | - |'
    );

    runGsdTools('roadmap update-plan-progress 57', tmpDir);

    const updated = fs.readFileSync(roadmapPath, 'utf-8');
    const row58 = updated.split('\n').find((l) => l.startsWith('| 58.'));
    assert.strictEqual(row58, '| 58. Next Phase | v1.15.0 | 0/TBD | Not started | - |');
  });
});

describe('Phase 57-03: failure classification & escalation bound logic', () => {
  const { classifyFailure, decideEscalation, NON_CAPABILITY_PATTERNS } = require(TOOLS_PATH);

  describe('classifyFailure (pure)', () => {
    const denyListCases = [
      ['ENOENT', 'ENOENT: no such file or directory, open \'/tmp/missing.txt\''],
      ['no such file', 'bash: foo: no such file'],
      ['command not found', 'zsh: command not found: rtk'],
      ['permission denied', 'cp: /etc/shadow: Permission denied'],
      ['EACCES', 'Error: EACCES: access refused, open \'/root/secret\''],
      ['ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'],
      ['getaddrinfo', 'Error: getaddrinfo ENOTFOUND example.invalid'],
      ['network error', 'fetch failed: network error'],
      ['env var', 'missing required env var DATABASE_URL'],
      ['environment variable', 'missing required environment variable API_KEY'],
      ['.env', 'could not load .env file'],
      ['ENOSPC', 'ENOSPC: no space left on device, write'],
      ['disk full', 'write failed: disk full'],
      ['git conflict', 'git conflict detected in src/index.js'],
      ['merge conflict', 'CONFLICT (content): merge conflict in README.md'],
    ];

    for (const [pattern, sampleText] of denyListCases) {
      test(`deny-list pattern "${pattern}" -> capability_related:false, matched_pattern:"${pattern}"`, () => {
        const result = classifyFailure(sampleText);
        assert.strictEqual(result.capability_related, false, `expected non-capability for: ${sampleText}`);
        assert.strictEqual(result.matched_pattern, pattern);
      });
    }

    // 57-RESEARCH.md/the plan's prose says "14 patterns" but the actual
    // enumerated list (env var / environment variable counted as two
    // distinct literal strings, per the plan's own code block) has 15
    // entries -- asserting against denyListCases.length (not a hardcoded
    // 14) keeps this test honest about the real array shape while still
    // locking in that every documented pattern is present.
    test('all documented deny-list patterns are present in NON_CAPABILITY_PATTERNS (regression guard against silent list drift)', () => {
      assert.strictEqual(NON_CAPABILITY_PATTERNS.length, denyListCases.length);
      for (const [pattern] of denyListCases) {
        assert.ok(
          NON_CAPABILITY_PATTERNS.some((p) => p.toLowerCase() === pattern.toLowerCase()),
          `expected "${pattern}" to be present in NON_CAPABILITY_PATTERNS`
        );
      }
    });

    test('case-insensitivity: "Permission Denied" (mixed case) still matches', () => {
      const result = classifyFailure('Error: Permission Denied while writing file');
      assert.strictEqual(result.capability_related, false);
      assert.strictEqual(result.matched_pattern, 'permission denied');
    });

    test('a genuine capability-shaped error ("assertion failed: expected true, got false") -> capability_related:true, matched_pattern:null', () => {
      const result = classifyFailure('assertion failed: expected true, got false');
      assert.strictEqual(result.capability_related, true);
      assert.strictEqual(result.matched_pattern, null);
    });

    test('empty string input -> capability_related:true (safe default, never throws)', () => {
      assert.doesNotThrow(() => {
        const result = classifyFailure('');
        assert.strictEqual(result.capability_related, true);
        assert.strictEqual(result.matched_pattern, null);
      });
    });

    test('undefined input -> capability_related:true (safe default, never throws)', () => {
      assert.doesNotThrow(() => {
        const result = classifyFailure(undefined);
        assert.strictEqual(result.capability_related, true);
        assert.strictEqual(result.matched_pattern, null);
      });
    });
  });

  describe('decideEscalation (pure, ladder-bounded)', () => {
    test('non-capability classification -> escalate:false, reason:non_capability_failure, regardless of currentTier/escalationsUsed', () => {
      const classification = { capability_related: false, matched_pattern: 'ENOENT' };
      const result = decideEscalation('haiku', classification, 0);
      assert.deepStrictEqual(result, { escalate: false, next_tier: null, reason: 'non_capability_failure' });
    });

    test('non-capability classification at a high escalationsUsed count still never escalates', () => {
      const classification = { capability_related: false, matched_pattern: 'EACCES' };
      const result = decideEscalation('sonnet', classification, 5);
      assert.strictEqual(result.escalate, false);
      assert.strictEqual(result.reason, 'non_capability_failure');
    });

    test('currentTier haiku, escalationsUsed 0, capability failure -> escalate:true, next_tier:sonnet', () => {
      const classification = { capability_related: true, matched_pattern: null };
      const result = decideEscalation('haiku', classification, 0);
      assert.strictEqual(result.escalate, true);
      assert.strictEqual(result.next_tier, 'sonnet');
      assert.strictEqual(result.reason, 'capability_failure');
    });

    test('currentTier sonnet, escalationsUsed 1, capability failure -> escalate:true, next_tier:opus', () => {
      const classification = { capability_related: true, matched_pattern: null };
      const result = decideEscalation('sonnet', classification, 1);
      assert.strictEqual(result.escalate, true);
      assert.strictEqual(result.next_tier, 'opus');
      assert.strictEqual(result.reason, 'capability_failure');
    });

    test('currentTier opus (ladder ceiling) -> escalate:false, reason:ladder_exhausted -- opus failure never attempts a 4th tier', () => {
      const classification = { capability_related: true, matched_pattern: null };
      const result = decideEscalation('opus', classification, 0);
      assert.strictEqual(result.escalate, false);
      assert.strictEqual(result.next_tier, null);
      assert.strictEqual(result.reason, 'ladder_exhausted');
    });

    test('escalationsUsed already at getTiers().length - 1 (2) with currentTier haiku -> escalate:false, reason:escalation_bound_reached (explicit safety cap fires even though getNextTier(haiku) would otherwise return sonnet)', () => {
      const { getTiers, getNextTier } = require('./model-registry.js');
      const maxEscalations = getTiers().length - 1;
      assert.strictEqual(maxEscalations, 2, 'sanity check: 3-tier ladder (haiku/sonnet/opus) has a bound of 2');
      assert.strictEqual(getNextTier('haiku'), 'sonnet', 'sanity check: getNextTier would otherwise permit escalation');

      const classification = { capability_related: true, matched_pattern: null };
      const result = decideEscalation('haiku', classification, maxEscalations);
      assert.strictEqual(result.escalate, false);
      assert.strictEqual(result.next_tier, null);
      assert.strictEqual(result.reason, 'escalation_bound_reached');
    });

    test('missing/null classification -> treated as non-capability, never escalates (defensive default)', () => {
      const result = decideEscalation('haiku', null, 0);
      assert.strictEqual(result.escalate, false);
      assert.strictEqual(result.reason, 'non_capability_failure');
    });
  });

  describe('CLI integration: routing classify-failure / routing escalation-decision', () => {
    test('routing classify-failure "ENOENT: ..." --raw returns capability_related:false', () => {
      const result = runGsdTools('routing classify-failure "ENOENT: no such file or directory" --raw');
      assert.ok(result.success, `expected exit 0: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.capability_related, false);
      assert.strictEqual(parsed.matched_pattern, 'ENOENT');
    });

    test('routing classify-failure with a capability-shaped error --raw returns capability_related:true', () => {
      const result = runGsdTools('routing classify-failure "assertion failed: expected 200 got 500" --raw');
      assert.ok(result.success, `expected exit 0: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.capability_related, true);
      assert.strictEqual(parsed.matched_pattern, null);
    });

    test('composition: routing escalation-decision --current-tier haiku --error-summary "ENOENT: ..." --escalations-used 0 --raw agrees with classify-failure (non-capability text never escalates via the composed CLI either)', () => {
      const classifyResult = runGsdTools('routing classify-failure "ENOENT: no such file" --raw');
      const classifyParsed = JSON.parse(classifyResult.output);

      const escalationResult = runGsdTools(
        'routing escalation-decision --current-tier haiku --error-summary "ENOENT: no such file" --escalations-used 0 --raw'
      );
      assert.ok(escalationResult.success, `expected exit 0: ${escalationResult.error}`);
      const escalationParsed = JSON.parse(escalationResult.output);

      assert.strictEqual(escalationParsed.capability_related, classifyParsed.capability_related);
      assert.strictEqual(escalationParsed.capability_related, false);
      assert.strictEqual(escalationParsed.escalate, false);
      assert.strictEqual(escalationParsed.reason, 'non_capability_failure');
    });

    test('composition: a capability-shaped error at haiku with 0 escalations used composes to escalate:true, next_tier:sonnet', () => {
      const result = runGsdTools(
        'routing escalation-decision --current-tier haiku --error-summary "assertion failed: expected true, got false" --escalations-used 0 --raw'
      );
      assert.ok(result.success, `expected exit 0: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.capability_related, true);
      assert.strictEqual(parsed.escalate, true);
      assert.strictEqual(parsed.next_tier, 'sonnet');
    });

    test('routing escalation-decision without --current-tier errors', () => {
      const result = runGsdTools('routing escalation-decision --error-summary "assertion failed" --escalations-used 0 --raw');
      assert.strictEqual(result.success, false);
    });
  });

  describe('executor-detail.md grep-assertion + regression guard (failure-signaling block)', () => {
    const executorDetailPath = path.join(__dirname, '..', 'references', 'executor-detail.md');
    const content = fs.readFileSync(executorDetailPath, 'utf-8');

    test('the failure-signaling block calls routing classify-failure', () => {
      const blockStart = content.indexOf('Failure signaling for coordinator escalation');
      assert.ok(blockStart !== -1, 'failure-signaling block not found');
      const blockEnd = content.indexOf('Note: The executor does NOT switch tiers', blockStart);
      const block = content.slice(blockStart, blockEnd !== -1 ? blockEnd : blockStart + 2000);
      assert.match(block, /routing classify-failure/);
    });

    test('the [non-capability] marker string is present', () => {
      assert.match(content, /\[non-capability\]/);
    });

    test('regression guard: the OLD unmarked format string is STILL present verbatim (backward compatibility with the pre-57-03 format for capability-related failures was not accidentally dropped)', () => {
      assert.ok(
        content.includes('"TASK FAILED: {task_name} [tier: {ROUTED_TIER}] — {error_summary}"'),
        'the original unmarked TASK FAILED format string must remain present verbatim'
      );
    });

    test('the new marked format string is present', () => {
      assert.ok(
        content.includes('"TASK FAILED: {task_name} [tier: {ROUTED_TIER}] [non-capability] — {error_summary}"'),
        'the new [non-capability]-marked TASK FAILED format string must be present'
      );
    });
  });
});

describe('Phase 57-04: bounded escalation loop & ledger recording', () => {
  const { getHistory } = require('./execution-log.js');

  describe('coordinator-loop simulation via the real CLI', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    function decide(currentTier, escalationsUsed, errorSummary = 'assertion failed') {
      const result = runGsdTools(
        `routing escalation-decision --current-tier "${currentTier}" --error-summary "${errorSummary}" --escalations-used ${escalationsUsed} --raw`,
        tmpDir
      );
      assert.ok(result.success, `escalation-decision failed: ${result.error}`);
      return JSON.parse(result.output);
    }

    function logTaskOutcome(taskIndex, tier, outcome, capabilityRelated) {
      const data = JSON.stringify({
        phase: 57,
        plan: '57-04-PLAN.md',
        task_index: taskIndex,
        task_name: 'fix the escalation loop',
        task_type: 'fix',
        tier,
        outcome,
        capability_related: capabilityRelated,
      });
      const result = runGsdTools(`execution-log event --type task_outcome --data '${data}'`, tmpDir);
      assert.ok(result.success, `logging task_outcome failed: ${result.error}`);
    }

    function logTierEscalation(taskIndex, fromTier, toTier, reason) {
      const data = JSON.stringify({
        phase: 57,
        plan: '57-04-PLAN.md',
        task_index: taskIndex,
        task_name: 'fix the escalation loop',
        task_type: 'fix',
        from_tier: fromTier,
        to_tier: toTier,
        reason,
      });
      const result = runGsdTools(`execution-log event --type tier_escalation --data '${data}'`, tmpDir);
      assert.ok(result.success, `logging tier_escalation failed: ${result.error}`);
    }

    // Integration-test scenario #5 from 57-RESEARCH.md: the full
    // haiku->sonnet->opus escalation chain, driven through the real
    // escalation-decision CLI and mirrored exactly as coordinator-detail.md's
    // loop instructs (one task_outcome failure event per attempt, one
    // tier_escalation event per hop).
    test('full haiku->sonnet->opus chain: 3 consecutive capability failures produce 3 task_outcome failures + 2 tier_escalation events', () => {
      // Attempt 1: haiku fails, escalates to sonnet.
      let decision = decide('haiku', 0);
      assert.strictEqual(decision.escalate, true);
      assert.strictEqual(decision.next_tier, 'sonnet');
      logTaskOutcome(1, 'haiku', 'failure', true);
      logTierEscalation(1, 'haiku', 'sonnet', decision.reason);

      // Attempt 2: sonnet fails, escalates to opus.
      decision = decide('sonnet', 1);
      assert.strictEqual(decision.escalate, true);
      assert.strictEqual(decision.next_tier, 'opus');
      logTaskOutcome(1, 'sonnet', 'failure', true);
      logTierEscalation(1, 'sonnet', 'opus', decision.reason);

      // Attempt 3: opus fails -- no further escalation. decideEscalation
      // enforces two independent stop conditions (per 57-03): the ladder's
      // own null-terminator (getNextTier('opus') === null -> 'ladder_exhausted')
      // AND the explicit escalationsUsed >= getTiers().length-1 safety cap
      // (-> 'escalation_bound_reached'). At escalationsUsed=2 (the bound),
      // the explicit cap check fires first in decideEscalation's own
      // ordering -- either reason is a correct "stop" signal for this test.
      decision = decide('opus', 2);
      assert.strictEqual(decision.escalate, false);
      assert.ok(
        ['ladder_exhausted', 'escalation_bound_reached'].includes(decision.reason),
        `expected a terminal stop reason, got: ${decision.reason}`
      );
      logTaskOutcome(1, 'opus', 'failure', true);

      const events = getHistory(tmpDir);
      const outcomes = events.filter((e) => e.type === 'task_outcome');
      const escalations = events.filter((e) => e.type === 'tier_escalation');

      assert.strictEqual(outcomes.length, 3, 'expected 3 task_outcome failure events (haiku, sonnet, opus)');
      assert.deepStrictEqual(outcomes.map((e) => e.tier), ['haiku', 'sonnet', 'opus']);
      assert.ok(outcomes.every((e) => e.outcome === 'failure'));

      assert.strictEqual(escalations.length, 2, 'expected exactly 2 tier_escalation events (haiku->sonnet, sonnet->opus)');
      assert.deepStrictEqual(
        escalations.map((e) => `${e.from_tier}->${e.to_tier}`),
        ['haiku->sonnet', 'sonnet->opus']
      );
    });

    // Integration-test scenario #6: bound enforcement -- opus failure never
    // attempts a 4th tier / never issues a 3rd tier_escalation event.
    test('bound enforcement: opus attempt returns escalate:false and the loop never logs a 3rd tier_escalation event', () => {
      decide('haiku', 0);
      logTaskOutcome(2, 'haiku', 'failure', true);
      logTierEscalation(2, 'haiku', 'sonnet', 'capability_failure');

      decide('sonnet', 1);
      logTaskOutcome(2, 'sonnet', 'failure', true);
      logTierEscalation(2, 'sonnet', 'opus', 'capability_failure');

      const opusDecision = decide('opus', 2);
      assert.strictEqual(opusDecision.escalate, false, 'opus must never escalate further');
      assert.strictEqual(opusDecision.next_tier, null);
      logTaskOutcome(2, 'opus', 'failure', true);
      // No further tier_escalation call is ever made for this task -- the
      // coordinator loop's "Else" branch terminates here.

      const escalations = getHistory(tmpDir).filter((e) => e.type === 'tier_escalation');
      assert.strictEqual(escalations.length, 2, 'must never log a 3rd tier_escalation event past opus');
    });

    // Integration-test scenario #7 (coordinator-logic level): a
    // [non-capability]-tagged failure at haiku never triggers a re-spawn --
    // only one task_outcome (capability_related:false) is logged, zero
    // tier_escalation events.
    test('non-capability failure exclusion: an ENOENT-classified haiku failure never escalates, logs exactly one capability_related:false task_outcome, zero tier_escalation events', () => {
      const decision = decide('haiku', 0, 'ENOENT: no such file or directory');
      assert.strictEqual(decision.escalate, false);
      assert.strictEqual(decision.reason, 'non_capability_failure');

      // Coordinator's "Else" branch: record failed, no re-spawn.
      logTaskOutcome(3, 'haiku', 'failure', false);

      const events = getHistory(tmpDir);
      const outcomes = events.filter((e) => e.type === 'task_outcome');
      const escalations = events.filter((e) => e.type === 'tier_escalation');

      assert.strictEqual(outcomes.length, 1);
      assert.strictEqual(outcomes[0].capability_related, false);
      assert.strictEqual(escalations.length, 0, 'a non-capability failure must never produce a tier_escalation event');
    });

    // Integration-test scenario #8: after seeding the full escalation chain's
    // events, `routing ledger build` folds them into routing-ledger.json,
    // reflecting an attempt (and a failure) at each of the 3 tiers.
    test('ledger recording of escalation outcome: routing ledger build folds the full chain into routing-ledger.json with attempts/failures at all 3 tiers', () => {
      decide('haiku', 0);
      logTaskOutcome(4, 'haiku', 'failure', true);
      logTierEscalation(4, 'haiku', 'sonnet', 'capability_failure');

      decide('sonnet', 1);
      logTaskOutcome(4, 'sonnet', 'failure', true);
      logTierEscalation(4, 'sonnet', 'opus', 'capability_failure');

      decide('opus', 2);
      logTaskOutcome(4, 'opus', 'failure', true);

      const buildResult = runGsdTools('routing ledger build --raw', tmpDir);
      assert.ok(buildResult.success, `routing ledger build failed: ${buildResult.error}`);

      const ledgerPath = path.join(tmpDir, '.planning', 'routing-ledger.json');
      assert.ok(fs.existsSync(ledgerPath), 'expected routing-ledger.json to be written');
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));

      const fixBucket = ledger.task_types.fix;
      assert.ok(fixBucket, 'expected a "fix" task_type bucket (task_name "fix the escalation loop")');
      assert.ok(fixBucket.haiku.attempts >= 1);
      assert.ok(fixBucket.sonnet.attempts >= 1);
      assert.ok(fixBucket.opus.attempts >= 1);
      assert.strictEqual(fixBucket.haiku.failures, fixBucket.haiku.attempts);
      assert.strictEqual(fixBucket.sonnet.failures, fixBucket.sonnet.attempts);
      assert.strictEqual(fixBucket.opus.failures, fixBucket.opus.attempts);
      assert.strictEqual(fixBucket.haiku.successes, 0);
      assert.strictEqual(fixBucket.sonnet.successes, 0);
      assert.strictEqual(fixBucket.opus.successes, 0);
    });
  });

  describe('coordinator-detail.md prose wiring (grep-assertion, index-ordered)', () => {
    const coordinatorDetailPath = path.join(__dirname, '..', 'references', 'coordinator-detail.md');
    const content = fs.readFileSync(coordinatorDetailPath, 'utf-8');

    const executeStart = content.indexOf('<step name="execute">');
    const executeEnd = content.indexOf('</step>', executeStart);
    const postUxSweepStart = content.indexOf('<step name="post_phase_ux_sweep">');

    test('the execute step is found and precedes post_phase_ux_sweep (sanity check for index-bounded assertions below)', () => {
      assert.ok(executeStart !== -1, '<step name="execute"> not found');
      assert.ok(executeEnd !== -1, 'execute step closing </step> not found');
      assert.ok(postUxSweepStart !== -1, '<step name="post_phase_ux_sweep"> not found');
      assert.ok(executeEnd < postUxSweepStart, 'execute step must close before post_phase_ux_sweep starts');
    });

    test('routing escalation-decision is called inside the execute step', () => {
      const idx = content.indexOf('routing escalation-decision', executeStart);
      assert.ok(idx !== -1 && idx < executeEnd, 'routing escalation-decision must appear inside <step name="execute">');
    });

    test('task_outcome events are logged inside the execute step', () => {
      const idx = content.indexOf('task_outcome', executeStart);
      assert.ok(idx !== -1 && idx < executeEnd, 'task_outcome must appear inside <step name="execute">');
    });

    test('tier_escalation events are logged inside the execute step', () => {
      const idx = content.indexOf('tier_escalation', executeStart);
      assert.ok(idx !== -1 && idx < executeEnd, 'tier_escalation must appear inside <step name="execute">');
    });

    test('routing ledger build appears inside the execute step AND before post_phase_ux_sweep (ordering lock-in)', () => {
      const idx = content.indexOf('routing ledger build', executeStart);
      assert.ok(idx !== -1, 'routing ledger build not found');
      assert.ok(idx < executeEnd, 'routing ledger build must appear inside <step name="execute">');
      assert.ok(idx < postUxSweepStart, 'routing ledger build must run before post_phase_ux_sweep');
    });

    test('the [non-capability] tag handling (IS_NON_CAPABILITY_TAGGED) is present in the escalation loop', () => {
      const idx = content.indexOf('IS_NON_CAPABILITY_TAGGED', executeStart);
      assert.ok(idx !== -1 && idx < executeEnd, 'IS_NON_CAPABILITY_TAGGED must appear inside <step name="execute">');
    });

    test('the escalation loop is bounded via the ladder (references getNextTier/escalation-decision, never a second hardcoded ladder)', () => {
      const block = content.slice(executeStart, executeEnd);
      assert.doesNotMatch(
        block,
        /\{\s*haiku:\s*['"]sonnet['"]/,
        'the escalation loop must not hardcode a second {haiku: "sonnet", ...} ladder inline'
      );
      assert.match(block, /routing escalation-decision/);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 58-03: token-usage golden-path wiring (MILE-36)
//
// coordinator-detail.md is prose consumed by an LLM subagent, not executable
// code -- so, mirroring Phase 57-04's precedent above, the wiring is locked in
// via grep-assertion tests: read the file from disk once, compute the
// <step name="execute"> boundaries via indexOf, and assert each literal call
// site's index falls where the design says it must.
// ---------------------------------------------------------------------------
describe('Phase 58-03: token-usage golden-path wiring', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const coordinatorDetailPath = path.join(__dirname, '..', 'references', 'coordinator-detail.md');
  const content = fs.readFileSync(coordinatorDetailPath, 'utf-8');

  const executeStart = content.indexOf('<step name="execute">');
  const executeEnd = content.indexOf('</step>', executeStart);
  const executeBlock = content.slice(executeStart, executeEnd);

  // The exact command string each of the 3 task_outcome logging call sites uses.
  const TASK_OUTCOME_CMD = 'execution-log event --type task_outcome';

  // Category: presence + step-boundary.
  test('token-usage record appears inside the execute step (presence + step-boundary)', () => {
    assert.ok(executeStart !== -1, '<step name="execute"> not found');
    assert.ok(executeEnd !== -1, 'execute step closing </step> not found');
    const idx = content.indexOf('token-usage record', executeStart);
    assert.ok(idx !== -1, 'token-usage record not found after executeStart');
    assert.ok(idx < executeEnd, 'token-usage record must appear inside <step name="execute">');
  });

  // Category: count -- exactly 3 call sites, one per task_outcome logging point.
  test('exactly 3 occurrences of token-usage record fall inside the execute step (one per task_outcome call site)', () => {
    const matches = executeBlock.match(/token-usage record/g) || [];
    assert.strictEqual(
      matches.length,
      3,
      `expected exactly 3 token-usage record call sites inside <step name="execute">, found ${matches.length}`
    );
  });

  // Category: adjacency -- each token-usage record call is genuinely adjacent to
  // its corresponding task_outcome log: the nearest following occurrence appears
  // BEFORE the next task_outcome command AND before the next tier_escalation
  // event log (call site 2 sits between its failed-attempt task_outcome log and
  // the escalation loop's tier_escalation log, so this bound is the strict one).
  test('each of the 3 task_outcome call sites is immediately followed by a token-usage record call (adjacency)', () => {
    const cmdIndexes = [];
    let i = executeBlock.indexOf(TASK_OUTCOME_CMD);
    while (i !== -1) {
      cmdIndexes.push(i);
      i = executeBlock.indexOf(TASK_OUTCOME_CMD, i + 1);
    }
    assert.strictEqual(
      cmdIndexes.length,
      3,
      `expected exactly 3 '${TASK_OUTCOME_CMD}' call sites inside the execute step, found ${cmdIndexes.length}`
    );

    for (let k = 0; k < cmdIndexes.length; k++) {
      const tuIdx = executeBlock.indexOf('token-usage record', cmdIndexes[k]);
      const nextCmdIdx = k + 1 < cmdIndexes.length ? cmdIndexes[k + 1] : executeBlock.length;
      let nextEscIdx = executeBlock.indexOf('--type tier_escalation', cmdIndexes[k]);
      if (nextEscIdx === -1) nextEscIdx = executeBlock.length;
      const boundary = Math.min(nextCmdIdx, nextEscIdx);

      assert.ok(tuIdx !== -1, `call site ${k + 1}: no token-usage record found after its task_outcome log`);
      assert.ok(
        tuIdx < boundary,
        `call site ${k + 1}: token-usage record (index ${tuIdx}) must appear before the next task_outcome/tier_escalation call site (index ${boundary}) -- not just somewhere later in the step`
      );
    }
  });

  // Category: design intent -- golden-path calls never pass explicit token counts;
  // the CLI always derives an estimate via estimateTaskTokens (source:'estimated').
  test('no golden-path call site passes --tokens-input or --tokens-output (CLI always estimates)', () => {
    assert.ok(
      !executeBlock.includes('--tokens-input'),
      'golden-path token-usage record calls must not pass --tokens-input'
    );
    assert.ok(
      !executeBlock.includes('--tokens-output'),
      'golden-path token-usage record calls must not pass --tokens-output'
    );
  });

  // Category: budget regression -- mirrors the existing 'wiring: checkAllBudgets
  // reports pass:true...' precedent. coordinator-detail.md itself sits after the
  // CORE_PREAMBLE_MARKER and is not directly budget-measured, but prompt-budget
  // risk was an explicit design constraint, so the regression is verified anyway.
  test('checkAllBudgets still reports pass:true for all agents after the coordinator-detail.md edit', () => {
    const { checkAllBudgets } = require('./prompt-budget.js');
    const result = checkAllBudgets(REPO_ROOT);

    assert.strictEqual(result.pass, true, `expected checkAllBudgets to pass overall, got: ${JSON.stringify(result.results)}`);
    for (const entry of result.results) {
      assert.strictEqual(entry.pass, true, `expected ${entry.filePath} to pass its budget, got ${entry.estimatedTokens}/${entry.budget}`);
    }
  });
});

// Phase 59-01 (MILE-37/MILE-38 foundation): quality config toggles +
// appendVerificationGap + verify append-gap CLI + composition proof that the
// existing Phase 55 eval-candidate reader consumes the newly-appended gap
// unmodified (no second/parallel gap pipeline).
describe('Phase 59-01: quality config toggles + appendVerificationGap', () => {
  const { loadConfig, appendVerificationGap, buildEvalCandidatesFromVerificationFile } = resilience;
  const matter = require('gray-matter');

  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writeVerificationFixture(relPath, content) {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }

  const PASSED_NO_GAPS_CONTENT = `---
phase: 59-test-phase
status: passed
score: 5/5 must-haves verified
---

# Verification Report

## Summary

Everything checked out.

| Truth | Status |
| ----- | ------ |
| Thing works | passed |
`;

  const GAPS_FOUND_1_EXISTING_CONTENT = `---
phase: 59-test-phase
status: gaps_found
gaps:
  - truth: "Pre-existing truth"
    status: failed
    failure_type: stub
    reason: "pre-existing reason"
    artifacts:
      - path: "src/existing.js"
        issue: "missing"
---

# Verification Report
`;

  const MALFORMED_FRONTMATTER_CONTENT = `---
status: [unterminated
this is not valid yaml: : :
---

# Body
`;

  describe('loadConfig defaults', () => {
    test('test_writer_enabled/integration_tester_enabled both default false when config.json is absent (ENOENT branch)', () => {
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.test_writer_enabled, false);
      assert.strictEqual(config.integration_tester_enabled, false);
    });

    test('both default false when config.json exists but omits both keys', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ model_profile: 'balanced' }),
        'utf-8'
      );
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.test_writer_enabled, false);
      assert.strictEqual(config.integration_tester_enabled, false);
    });

    test('flat override {"test_writer_enabled": true} resolves test_writer_enabled:true without affecting integration_tester_enabled', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ test_writer_enabled: true }),
        'utf-8'
      );
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.test_writer_enabled, true);
      assert.strictEqual(config.integration_tester_enabled, false);
    });

    test('nested override {"quality": {"integration_tester": true}} resolves integration_tester_enabled:true without affecting test_writer_enabled', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ quality: { integration_tester: true } }),
        'utf-8'
      );
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.integration_tester_enabled, true);
      assert.strictEqual(config.test_writer_enabled, false);
    });
  });

  describe('appendVerificationGap', () => {
    test('happy path: appends one gap, flips status to gaps_found, preserves markdown body byte-for-byte', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', PASSED_NO_GAPS_CONTENT);
      const bodyBefore = matter(PASSED_NO_GAPS_CONTENT).content;

      const result = appendVerificationGap(tmpDir, verificationPath, {
        truth: 'Cross-phase contract holds',
        reason: 'consumer expected shape X, producer returned shape Y',
        failure_type: 'contract_mismatch',
        artifacts: [{ path: 'src/consumer.js', issue: 'shape mismatch' }],
      });

      assert.strictEqual(result.ok, true);

      const rewritten = fs.readFileSync(verificationPath, 'utf-8');
      const parsed = matter(rewritten);
      assert.strictEqual(parsed.data.status, 'gaps_found');
      assert.strictEqual(parsed.data.gaps.length, 1);
      assert.strictEqual(parsed.data.gaps[0].failure_type, 'contract_mismatch');
      assert.strictEqual(parsed.data.gaps[0].truth, 'Cross-phase contract holds');
      assert.strictEqual(parsed.content, bodyBefore, 'expected markdown body to be byte-identical after the write');
    });

    test('appends (does not replace) an EXISTING gaps array', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', GAPS_FOUND_1_EXISTING_CONTENT);
      const originalParsed = matter(GAPS_FOUND_1_EXISTING_CONTENT);
      const originalGap = originalParsed.data.gaps[0];

      const result = appendVerificationGap(tmpDir, verificationPath, {
        truth: 'Second truth',
        reason: 'second reason',
        failure_type: 'contract_mismatch',
      });

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.gaps_count, 2);

      const rewritten = fs.readFileSync(verificationPath, 'utf-8');
      const parsed = matter(rewritten);
      assert.strictEqual(parsed.data.gaps.length, 2);
      assert.deepStrictEqual(parsed.data.gaps[0], originalGap, 'expected the original gap entry to be unchanged');
      assert.strictEqual(parsed.data.gaps[1].truth, 'Second truth');
    });

    test('never throws on a missing file -- returns {ok:false, error}', () => {
      const missingPath = path.join(tmpDir, '.planning', 'phases', '59-test-phase', 'does-not-exist.md');
      let result;
      assert.doesNotThrow(() => {
        result = appendVerificationGap(tmpDir, missingPath, { truth: 'x', reason: 'y' });
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });

    test('never throws on malformed/corrupt frontmatter -- returns {ok:false, error}', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', MALFORMED_FRONTMATTER_CONTENT);
      let result;
      assert.doesNotThrow(() => {
        result = appendVerificationGap(tmpDir, verificationPath, { truth: 'x', reason: 'y' });
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });
  });

  describe('verify append-gap CLI', () => {
    test('missing --truth/--reason exits non-zero with a JSON error naming the missing flag', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', PASSED_NO_GAPS_CONTENT);
      const relPath = path.relative(tmpDir, verificationPath);
      const result = runGsdTools(`verify append-gap "${relPath}" --raw`, tmpDir);
      assert.ok(!result.success, 'expected non-zero exit when --truth/--reason are missing');
      const parsed = JSON.parse(result.output || result.error);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'missing_flags');
    });

    test('happy path: exits 0, prints {appended:true, gaps_count:1, ...}, file on disk now has status:gaps_found', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', PASSED_NO_GAPS_CONTENT);
      const relPath = path.relative(tmpDir, verificationPath);
      const result = runGsdTools(`verify append-gap "${relPath}" --truth "Some truth" --reason "some reason" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);

      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.appended, true);
      assert.strictEqual(parsed.gaps_count, 1);

      const rewritten = matter(fs.readFileSync(verificationPath, 'utf-8'));
      assert.strictEqual(rewritten.data.status, 'gaps_found');
    });

    test('--artifacts with malformed JSON exits non-zero with malformed_artifacts_json error, WITHOUT writing to the file', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', PASSED_NO_GAPS_CONTENT);
      const contentBefore = fs.readFileSync(verificationPath, 'utf-8');
      const relPath = path.relative(tmpDir, verificationPath);

      const result = runGsdTools(`verify append-gap "${relPath}" --truth "t" --reason "r" --artifacts "{not valid json" --raw`, tmpDir);
      assert.ok(!result.success, 'expected non-zero exit on malformed --artifacts JSON');
      const parsed = JSON.parse(result.output || result.error);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'malformed_artifacts_json');

      const contentAfter = fs.readFileSync(verificationPath, 'utf-8');
      assert.strictEqual(contentAfter, contentBefore, 'expected the file to be untouched when --artifacts JSON is malformed');
    });

    test('--failure-type omitted defaults to contract_mismatch on the written gap', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', PASSED_NO_GAPS_CONTENT);
      const relPath = path.relative(tmpDir, verificationPath);
      const result = runGsdTools(`verify append-gap "${relPath}" --truth "t" --reason "r" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);

      const rewritten = matter(fs.readFileSync(verificationPath, 'utf-8'));
      assert.strictEqual(rewritten.data.gaps[0].failure_type, 'contract_mismatch');
    });
  });

  describe('composition proof: existing eval-candidate reader consumes the appended gap unmodified', () => {
    test('after a real `verify append-gap` CLI call, buildEvalCandidatesFromVerificationFile returns exactly 1 candidate whose context.gap_description matches --reason', () => {
      const verificationPath = writeVerificationFixture('.planning/phases/59-test-phase/59-VERIFICATION.md', PASSED_NO_GAPS_CONTENT);
      const relPath = path.relative(tmpDir, verificationPath);
      const reasonText = 'consumer reads field X but producer never sets it';

      const cliResult = runGsdTools(`verify append-gap "${relPath}" --truth "Consumer/producer contract holds" --reason "${reasonText}" --raw`, tmpDir);
      assert.ok(cliResult.success, `expected exit 0, got: ${cliResult.error}`);

      const candidates = buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath);
      assert.strictEqual(candidates.length, 1, 'expected the existing Phase 55 reader to pick up exactly 1 candidate from the appended gap');
      assert.strictEqual(candidates[0].context.gap_description, reasonText);
    });
  });
});

// Phase 59-01 (MILE-37/MILE-38): structural grep-assertion tests locking in
// the agent drift refresh -- gsd-test-writer.md/gsd-integration-tester.md
// (about to join the golden path for the first time in Plans 59-02/59-03)
// both gain a <content_firewall> block (mirroring gsd-executor.md's exact
// convention) and the MILE-26 4-field telemetry self-report line.
describe('Phase 59-01: agent drift refresh (content_firewall + telemetry)', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const TEST_WRITER_PATH = path.join(REPO_ROOT, 'agents', 'gsd-test-writer.md');
  const INTEGRATION_TESTER_PATH = path.join(REPO_ROOT, 'agents', 'gsd-integration-tester.md');
  const TELEMETRY_LINE = '**Telemetry:** context_pressure={0.0-1.0 estimate}, instructions_not_followed={count}, ambiguities={count}, tool_errors_swallowed={count}';

  function readRepoFile(relPath) {
    return fs.readFileSync(relPath, 'utf-8');
  }

  test('gsd-test-writer.md gains a <content_firewall> block immediately after </role>', () => {
    const content = readRepoFile(TEST_WRITER_PATH);
    assert.ok(content.includes('<content_firewall>'), 'expected gsd-test-writer.md to contain a <content_firewall> block');
    const roleEndIdx = content.indexOf('</role>');
    const firewallIdx = content.indexOf('<content_firewall>');
    assert.ok(roleEndIdx !== -1 && firewallIdx !== -1 && firewallIdx > roleEndIdx, 'expected <content_firewall> to appear after </role>');
    assert.ok(content.includes('content-firewall.md'), 'expected gsd-test-writer.md to point at the content-firewall.md convention');
  });

  test('gsd-integration-tester.md gains a <content_firewall> block immediately after </role>', () => {
    const content = readRepoFile(INTEGRATION_TESTER_PATH);
    assert.ok(content.includes('<content_firewall>'), 'expected gsd-integration-tester.md to contain a <content_firewall> block');
    const roleEndIdx = content.indexOf('</role>');
    const firewallIdx = content.indexOf('<content_firewall>');
    assert.ok(roleEndIdx !== -1 && firewallIdx !== -1 && firewallIdx > roleEndIdx, 'expected <content_firewall> to appear after </role>');
    assert.ok(content.includes('content-firewall.md'), 'expected gsd-integration-tester.md to point at the content-firewall.md convention');
  });

  test('gsd-test-writer.md gains the exact MILE-26 4-field telemetry self-report line', () => {
    const content = readRepoFile(TEST_WRITER_PATH);
    assert.ok(content.includes(TELEMETRY_LINE), 'expected gsd-test-writer.md to contain the exact 4-field telemetry line');
  });

  test('gsd-integration-tester.md gains the exact MILE-26 4-field telemetry self-report line', () => {
    const content = readRepoFile(INTEGRATION_TESTER_PATH);
    assert.ok(content.includes(TELEMETRY_LINE), 'expected gsd-integration-tester.md to contain the exact 4-field telemetry line');
  });

  test('boundary: gsd-planner.md and gsd-debugger.md carry NO <content_firewall> block (blast radius confined to test-writer/integration-tester)', () => {
    const plannerContent = readRepoFile(path.join(REPO_ROOT, 'agents', 'gsd-planner.md'));
    const debuggerContent = readRepoFile(path.join(REPO_ROOT, 'agents', 'gsd-debugger.md'));
    assert.ok(!plannerContent.includes('<content_firewall>'), 'expected gsd-planner.md to be untouched by this plan\'s drift refresh');
    assert.ok(!debuggerContent.includes('<content_firewall>'), 'expected gsd-debugger.md to be untouched by this plan\'s drift refresh');
  });

  test('regression guard: CHANGELOG.md documents both new toggle defaults under Unreleased/Added', () => {
    const changelog = readRepoFile(path.join(REPO_ROOT, 'CHANGELOG.md'));
    const unreleasedIdx = changelog.indexOf('## [Unreleased]');
    const addedIdx = changelog.indexOf('### Added', unreleasedIdx);
    const nextSectionIdx = changelog.indexOf('\n## ', addedIdx);
    const addedSection = changelog.slice(addedIdx, nextSectionIdx === -1 ? changelog.length : nextSectionIdx);

    assert.ok(addedSection.includes('test_writer_enabled'), 'expected CHANGELOG.md Unreleased/Added to mention test_writer_enabled');
    assert.ok(addedSection.includes('integration_tester_enabled'), 'expected CHANGELOG.md Unreleased/Added to mention integration_tester_enabled');
    // [Rule 1 fix, Phase 59-02] Newest-first ordering: the Phase 59-01 bullet should sit ABOVE
    // an older, still-present anchor bullet (Phase 58) rather than assuming it is literally the
    // FIRST bullet ever -- a later phase's own newer entry (e.g. Phase 59-02) is expected to be
    // inserted above it in the future, which is correct newest-first behavior, not a regression.
    const phase5901Idx = addedSection.indexOf('Phase 59-01');
    const phase58Idx = addedSection.indexOf('Phase 58');
    assert.ok(phase5901Idx !== -1 && phase58Idx !== -1 && phase5901Idx < phase58Idx, 'expected the Phase 59-01 bullet to sit above the older Phase 58 bullet under Unreleased/Added');
  });
});

describe('Phase 59-02: post-task quality test-writer spawn (MILE-37)', () => {
  const { isSourceFile, isTestOrSpecFile, computeTouchesSourceCode, loadConfig } = resilience;
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const EXECUTOR_DETAIL_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'executor-detail.md');

  describe('isSourceFile / isTestOrSpecFile / computeTouchesSourceCode (pure functions)', () => {
    test('happy path: recognized source extensions classify as source', () => {
      const sourceFiles = ['src/foo.js', 'lib/bar.ts', 'app/Baz.tsx', 'component.jsx', 'script.py', 'main.go', 'model.rb'];
      for (const f of sourceFiles) {
        assert.strictEqual(isSourceFile(f), true, `expected ${f} to classify as source`);
      }
    });

    test('test/spec exclusion: source-extension files under test paths or with test/spec suffixes are NOT source', () => {
      const excluded = ['src/foo.test.js', 'src/foo.spec.ts', 'test/bar.js', '__tests__/baz.js', 'spec/qux.rb'];
      for (const f of excluded) {
        assert.strictEqual(isTestOrSpecFile(f), true, `expected ${f} to be classified as a test/spec file`);
        assert.strictEqual(isSourceFile(f), false, `expected ${f} to be excluded from isSourceFile despite a source extension`);
      }
    });

    test('non-source extensions (docs/config) are NOT source', () => {
      const nonSource = ['README.md', 'package.json', '.eslintrc'];
      for (const f of nonSource) {
        assert.strictEqual(isSourceFile(f), false, `expected ${f} to classify as NOT source`);
      }
    });

    test('computeTouchesSourceCode: true when at least one source file is present among non-source files', () => {
      assert.strictEqual(computeTouchesSourceCode(['README.md', 'src/foo.js', 'package.json']), true);
    });

    test('computeTouchesSourceCode: false when every file is non-source or test/spec', () => {
      assert.strictEqual(computeTouchesSourceCode(['README.md', 'src/foo.test.js', 'package.json']), false);
    });

    test('computeTouchesSourceCode: false on empty array, never throws', () => {
      assert.strictEqual(computeTouchesSourceCode([]), false);
    });

    test('computeTouchesSourceCode: false on non-array input (null/undefined/string), never throws', () => {
      assert.doesNotThrow(() => {
        assert.strictEqual(computeTouchesSourceCode(null), false);
        assert.strictEqual(computeTouchesSourceCode(undefined), false);
        assert.strictEqual(computeTouchesSourceCode('src/foo.js'), false);
      });
    });
  });

  describe('`quality touches-source` CLI (real subprocess)', () => {
    test('mixed file list returns touches_source_code:true', () => {
      const result = runGsdTools('quality touches-source --files "src/a.js,test/b.test.js" --raw');
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.touches_source_code, true);
      assert.strictEqual(parsed.file_count, 2);
    });

    test('all-test/doc file list returns touches_source_code:false', () => {
      const result = runGsdTools('quality touches-source --files "test/a.test.js,README.md" --raw');
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.touches_source_code, false);
    });

    test('empty --files value returns false, file_count:0 without erroring', () => {
      const result = runGsdTools('quality touches-source --files "" --raw');
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.touches_source_code, false);
      assert.strictEqual(parsed.file_count, 0);
    });

    test('--files flag omitted entirely returns false, file_count:0 without erroring', () => {
      const result = runGsdTools('quality touches-source --raw');
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.touches_source_code, false);
      assert.strictEqual(parsed.file_count, 0);
    });
  });

  describe('prose wiring grep-assertion tests (house convention, mirrors Phase 57-04/58-03)', () => {
    function readExecutorDetail() {
      return fs.readFileSync(EXECUTOR_DETAIL_PATH, 'utf-8');
    }

    test('<post_task_quality_spawn> appears AFTER </inter_task_syntax_check> and BEFORE <test_task_handling> (index-bounded ordering)', () => {
      const content = readExecutorDetail();
      const syntaxCheckCloseIdx = content.indexOf('</inter_task_syntax_check>');
      const spawnBlockIdx = content.indexOf('<post_task_quality_spawn>');
      const testTaskHandlingIdx = content.indexOf('<test_task_handling>');
      assert.ok(syntaxCheckCloseIdx !== -1, 'expected </inter_task_syntax_check> to exist');
      assert.ok(spawnBlockIdx !== -1, 'expected <post_task_quality_spawn> to exist');
      assert.ok(testTaskHandlingIdx !== -1, 'expected <test_task_handling> to exist');
      assert.ok(spawnBlockIdx > syntaxCheckCloseIdx, 'expected <post_task_quality_spawn> to appear after </inter_task_syntax_check>');
      assert.ok(spawnBlockIdx < testTaskHandlingIdx, 'expected <post_task_quality_spawn> to appear before <test_task_handling>');
    });

    test('test_writer_enabled toggle check appears inside the post_task_quality_spawn block', () => {
      const content = readExecutorDetail();
      const spawnBlockIdx = content.indexOf('<post_task_quality_spawn>');
      const spawnBlockCloseIdx = content.indexOf('</post_task_quality_spawn>');
      const toggleIdx = content.indexOf('test_writer_enabled', spawnBlockIdx);
      assert.ok(toggleIdx !== -1 && toggleIdx < spawnBlockCloseIdx, 'expected test_writer_enabled to appear inside post_task_quality_spawn');
    });

    test('[Rule Quality-TW] literal string appears inside the post_task_quality_spawn block', () => {
      const content = readExecutorDetail();
      const spawnBlockIdx = content.indexOf('<post_task_quality_spawn>');
      const spawnBlockCloseIdx = content.indexOf('</post_task_quality_spawn>');
      const ruleIdx = content.indexOf('[Rule Quality-TW]', spawnBlockIdx);
      assert.ok(ruleIdx !== -1 && ruleIdx < spawnBlockCloseIdx, 'expected [Rule Quality-TW] to appear inside post_task_quality_spawn');
    });

    test('continuation language ("Do NOT block") appears inside the post_task_quality_spawn block, distinguishing it from the tdd="true" hard-block contract', () => {
      const content = readExecutorDetail();
      const spawnBlockIdx = content.indexOf('<post_task_quality_spawn>');
      const spawnBlockCloseIdx = content.indexOf('</post_task_quality_spawn>');
      const doNotBlockIdx = content.indexOf('Do NOT block', spawnBlockIdx);
      assert.ok(doNotBlockIdx !== -1 && doNotBlockIdx < spawnBlockCloseIdx, 'expected "Do NOT block" continuation language inside post_task_quality_spawn');
    });
  });

  describe('regression guard: existing tdd="true" hard-block contract in <test_task_handling> is untouched', () => {
    test('exact existing block-language substring is still present, unchanged', () => {
      const content = fs.readFileSync(EXECUTOR_DETAIL_PATH, 'utf-8');
      assert.ok(content.includes('BLOCK — do NOT proceed to the next task'), 'expected the existing tdd="true" hard-block language to still be present verbatim');
    });

    test('surrounding "0 tests written" hard-failure wording is unaffected', () => {
      const content = fs.readFileSync(EXECUTOR_DETAIL_PATH, 'utf-8');
      const testTaskHandlingIdx = content.indexOf('<test_task_handling>');
      const testTaskHandlingCloseIdx = content.indexOf('</test_task_handling>');
      const block = content.slice(testTaskHandlingIdx, testTaskHandlingCloseIdx);
      assert.ok(block.includes('0 tests written'), 'expected "0 tests written" hard-failure wording to still be present inside <test_task_handling>');
      assert.ok(block.includes('BLOCK — do NOT proceed to the next task'), 'expected the hard-block sentence to still be inside <test_task_handling>, not moved elsewhere');
    });
  });

  describe('toggle-off regression proof', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    test('loadConfig(tmpDir).test_writer_enabled is false with no .planning/config.json present', () => {
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.test_writer_enabled, false);
    });

    test('[Rule 1 fix] `config get test_writer_enabled --raw` (the EXACT invocation form the corrected prose block uses) against a temp dir with no config.json prints bare "false", not JSON', () => {
      const result = runGsdTools('config get test_writer_enabled --raw', tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      assert.strictEqual(result.output, 'false', 'expected the --raw invocation to print a bare "false" so the bash comparison against "true" in the prose block resolves correctly');
    });
  });

  describe('regression guard: CHANGELOG.md documents Phase 59-02 (MILE-37)', () => {
    test('Phase 59-02 bullet is present under Unreleased/Added, sits above the Phase 59-01 bullet, and mentions the key deliverables', () => {
      const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8');
      const unreleasedIdx = changelog.indexOf('## [Unreleased]');
      const addedIdx = changelog.indexOf('### Added', unreleasedIdx);
      const nextSectionIdx = changelog.indexOf('\n## ', addedIdx);
      const addedSection = changelog.slice(addedIdx, nextSectionIdx === -1 ? changelog.length : nextSectionIdx);

      const phase5902Idx = addedSection.indexOf('Phase 59-02');
      const phase5901Idx = addedSection.indexOf('Phase 59-01');
      assert.ok(phase5902Idx !== -1, 'expected CHANGELOG.md Unreleased/Added to mention Phase 59-02');
      assert.ok(phase5901Idx !== -1 && phase5902Idx < phase5901Idx, 'expected the Phase 59-02 bullet to sit above the older Phase 59-01 bullet (newest-first)');
      assert.ok(addedSection.includes('computeTouchesSourceCode'), 'expected the Phase 59-02 bullet to mention computeTouchesSourceCode');
      assert.ok(addedSection.includes('post_task_quality_spawn'), 'expected the Phase 59-02 bullet to mention post_task_quality_spawn');
      assert.ok(addedSection.includes('MILE-37'), 'expected the Phase 59-02 bullet to mention MILE-37');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 59-03: declared-dependency integration-tester spawn + gaps_found
// propagation (MILE-38)
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 59-03: declared-dependency integration-tester spawn + gaps_found propagation (MILE-38)', () => {
  const { buildEvalCandidatesFromVerificationFile } = resilience;
  const matter = require('gray-matter');
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const COORDINATOR_DETAIL_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'coordinator-detail.md');
  const VERIFIER_DETAIL_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'verifier-detail.md');
  const PLANNER_DETAIL_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'planner-detail.md');
  const REAL_ROADMAP_PATH = path.join(REPO_ROOT, '.planning', 'ROADMAP.md');

  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('cmdRoadmapGetPhase depends_on fix (both real-world dependency-line styles)', () => {
    test('colon-inside-bold style "**Depends on:** Phase 30" returns depends_on: ["Phase 30"]', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 50: Current\n**Goal:** Do the thing\n**Depends on:** Phase 30\n`
      );
      const result = runGsdTools('roadmap get-phase 50', tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.deepStrictEqual(output.depends_on, ['Phase 30']);
    });

    test('colon-outside-bold style "**Depends on**: Phase 18" (SEPARATE fixture) returns depends_on: ["Phase 18"]', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 51: Current\n**Goal:** Do another thing\n**Depends on**: Phase 18\n`
      );
      const result = runGsdTools('roadmap get-phase 51', tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.deepStrictEqual(output.depends_on, ['Phase 18']);
    });

    test('"**Depends on**: Nothing (first phase of milestone)" returns depends_on: []', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 1: First\n**Goal:** Start\n**Depends on**: Nothing (first phase of milestone)\n`
      );
      const result = runGsdTools('roadmap get-phase 1', tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.deepStrictEqual(output.depends_on, []);
    });

    test('phase with no "Depends on" line at all returns depends_on: []', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 2: NoLine\n**Goal:** Just a goal\n`
      );
      const result = runGsdTools('roadmap get-phase 2', tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.deepStrictEqual(output.depends_on, []);
    });

    test('comma-separated two-phase dependency returns a 2-element array', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 3: TwoDeps\n**Goal:** Depends on two\n**Depends on:** Phase 1, Phase 2\n`
      );
      const result = runGsdTools('roadmap get-phase 3', tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.strictEqual(output.depends_on.length, 2);
      assert.deepStrictEqual(output.depends_on, ['Phase 1', 'Phase 2']);
    });
  });

  describe('real-repo regression proof (against a COPY of the real live .planning/ROADMAP.md, never mutating it)', () => {
    test('roadmap get-phase 59 against a temp copy of the real ROADMAP.md returns a non-empty depends_on array referencing Phase 55', () => {
      const realRoadmap = fs.readFileSync(REAL_ROADMAP_PATH, 'utf-8');
      fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), realRoadmap);

      const result = runGsdTools('roadmap get-phase 59', tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.strictEqual(output.found, true, 'expected Phase 59 to be found in the real live ROADMAP.md');
      assert.ok(Array.isArray(output.depends_on) && output.depends_on.length > 0, 'expected a non-empty depends_on array against the real live ROADMAP.md -- proves the fix is not merely fixture-shaped');
      assert.ok(output.depends_on.some(d => d.includes('Phase 55')), `expected depends_on to reference Phase 55, got: ${JSON.stringify(output.depends_on)}`);
    });
  });

  describe('spawn-decision boolean simulation (mirrors the new coordinator step 3b computation: toggle==="true" && depends_on.length>0)', () => {
    function computeSpawnDecision(cwd, phaseNum) {
      const toggleResult = runGsdTools('config get integration_tester_enabled --raw', cwd);
      const toggle = toggleResult.success ? toggleResult.output.trim() : 'false';
      const phaseResult = runGsdTools(`roadmap get-phase ${phaseNum}`, cwd);
      const phaseOutput = phaseResult.success ? JSON.parse(phaseResult.output) : { depends_on: [] };
      const dependsOn = Array.isArray(phaseOutput.depends_on) ? phaseOutput.depends_on : [];
      return toggle === 'true' && dependsOn.length > 0;
    }

    test('dependent-phase (depends_on non-empty) + toggle on (via config.json) -> spawn decision true', () => {
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ integration_tester_enabled: true }));
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 5: Dependent\n**Goal:** g\n**Depends on:** Phase 1\n`
      );
      assert.strictEqual(computeSpawnDecision(tmpDir, 5), true);
    });

    test('independent-phase (depends_on empty) + toggle on -> spawn decision false regardless of toggle state', () => {
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ integration_tester_enabled: true }));
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 6: Independent\n**Goal:** g\n**Depends on**: Nothing (first phase of milestone)\n`
      );
      assert.strictEqual(computeSpawnDecision(tmpDir, 6), false);
    });

    test('dependent-phase (depends_on non-empty) + toggle off (default, no config.json) -> spawn decision false', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'ROADMAP.md'),
        `# Roadmap\n\n### Phase 7: Dependent\n**Goal:** g\n**Depends on:** Phase 1\n`
      );
      assert.strictEqual(computeSpawnDecision(tmpDir, 7), false);
    });
  });

  describe('gaps_found propagation composition (real CLI, end-to-end, matching the exact new coordinator invocation form)', () => {
    test('verify append-gap --failure-type contract_mismatch flips status to gaps_found, and buildEvalCandidatesFromVerificationFile picks it up unmodified (1 candidate, matching --reason)', () => {
      const verificationDir = path.join(tmpDir, '.planning', 'phases', '59-dependent-phase');
      fs.mkdirSync(verificationDir, { recursive: true });
      const verificationPath = path.join(verificationDir, '59-03-VERIFICATION.md');
      fs.writeFileSync(verificationPath, `---\nphase: 59-dependent-phase\nstatus: passed\n---\n\n# Verification Report\n`);
      const relPath = path.relative(tmpDir, verificationPath);
      const reasonText = 'producer returns {id, name} but consumer destructures {id, label}';

      const cliResult = runGsdTools(
        `verify append-gap "${relPath}" --truth "Cross-phase integration boundary 'UserCard props' matches between producer and consumer" --reason "${reasonText}" --failure-type contract_mismatch --raw`,
        tmpDir
      );
      assert.ok(cliResult.success, `expected exit 0, got: ${cliResult.error}`);

      const rewritten = matter(fs.readFileSync(verificationPath, 'utf-8'));
      assert.strictEqual(rewritten.data.status, 'gaps_found');
      assert.strictEqual(rewritten.data.gaps[rewritten.data.gaps.length - 1].failure_type, 'contract_mismatch');

      const candidates = buildEvalCandidatesFromVerificationFile(tmpDir, verificationPath);
      assert.strictEqual(candidates.length, 1, 'expected exactly 1 candidate from the existing Phase 55 reader');
      assert.strictEqual(candidates[0].context.gap_description, reasonText);
    });
  });

  describe('prose wiring grep-assertion tests (house convention, mirrors Phase 57-04/58-03)', () => {
    function readCoordinatorDetail() {
      return fs.readFileSync(COORDINATOR_DETAIL_PATH, 'utf-8');
    }

    test('integration_tester_enabled and verify append-gap both appear inside <step name="cross_phase_integration">', () => {
      const content = readCoordinatorDetail();
      const stepStartIdx = content.indexOf('<step name="cross_phase_integration">');
      const stepEndIdx = content.indexOf('</step>', stepStartIdx);
      assert.ok(stepStartIdx !== -1 && stepEndIdx !== -1, 'expected cross_phase_integration step to exist');
      const toggleIdx = content.indexOf('integration_tester_enabled', stepStartIdx);
      const gapIdx = content.indexOf('verify append-gap', stepStartIdx);
      assert.ok(toggleIdx !== -1 && toggleIdx < stepEndIdx, 'expected integration_tester_enabled inside the cross_phase_integration step');
      assert.ok(gapIdx !== -1 && gapIdx < stepEndIdx, 'expected verify append-gap inside the cross_phase_integration step');
    });

    test('the new step 3b branch text appears AFTER step 3\'s existing "Spawn gsd-integration-tester:" Agent() block (ordering lock-in)', () => {
      const content = readCoordinatorDetail();
      const step3Idx = content.indexOf('Spawn gsd-integration-tester:');
      const newBranchIdx = content.indexOf('3b. **(NEW, MILE-38, additive)');
      assert.ok(step3Idx !== -1, 'expected step 3\'s existing Agent() block to exist');
      assert.ok(newBranchIdx !== -1, 'expected the new step 3b branch to exist');
      assert.ok(newBranchIdx > step3Idx, 'expected the new step 3b branch to appear after step 3\'s existing Agent() block');
    });

    test('regression guard: step 3\'s EXISTING, untouched overlap-trigger text is still present unchanged', () => {
      const content = readCoordinatorDetail();
      assert.ok(
        content.includes('If overlap found (same API routes, same tables, same component names)'),
        'expected step 3\'s existing overlap-trigger text to be unchanged'
      );
    });

    test('contract_mismatch appears in both verifier-detail.md and planner-detail.md respective tables', () => {
      const verifierContent = fs.readFileSync(VERIFIER_DETAIL_PATH, 'utf-8');
      const plannerContent = fs.readFileSync(PLANNER_DETAIL_PATH, 'utf-8');
      assert.ok(verifierContent.includes('contract_mismatch'), 'expected contract_mismatch in verifier-detail.md');
      assert.ok(plannerContent.includes('contract_mismatch'), 'expected contract_mismatch in planner-detail.md');
    });
  });
});

describe('Phase 59-04: DEPENDS_ON snippet --raw contract-mismatch regression (MILE-38)', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const COORDINATOR_DETAIL_PATH = path.join(REPO_ROOT, 'get-shit-done', 'references', 'coordinator-detail.md');

  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Reads coordinator-detail.md from disk and extracts the LITERAL DEPENDS_ON=$(...) bash
  // assignment line from inside <step name="cross_phase_integration">...</step>. This is
  // deliberately NOT a hand-rolled equivalent -- 59-03's own computeSpawnDecision() simulation
  // helper (above) calls `roadmap get-phase ${phaseNum}` directly and never caught the --raw
  // bug because it never executed the prose file's actual bash line.
  function extractDependsOnSnippet() {
    const content = fs.readFileSync(COORDINATOR_DETAIL_PATH, 'utf-8');
    const stepStart = content.indexOf('<step name="cross_phase_integration">');
    const stepEnd = content.indexOf('</step>', stepStart);
    assert.ok(stepStart !== -1 && stepEnd !== -1, 'expected cross_phase_integration step to exist in coordinator-detail.md');
    const stepSlice = content.slice(stepStart, stepEnd);
    const match = stepSlice.match(/^DEPENDS_ON=\$\(.*\)\s*$/m);
    assert.ok(match, 'expected a literal DEPENDS_ON=$(...) bash assignment line inside cross_phase_integration -- fails loudly if the snippet\'s shape changes unexpectedly');
    return match[0];
  }

  // Substitutes the installed-copy path for this repo's real gsd-tools.js and the literal
  // {phase_number} placeholder for a real phase number (plain string substitution, not regex --
  // the line contains literal `{`/`}` characters), writes the result to a temp .sh file inside
  // tmpDir, and executes it via bash -- running the ACTUAL extracted pipeline, not a simulation.
  function runExtractedSnippet(dir, phaseNum) {
    const literalLine = extractDependsOnSnippet();
    const substituted = literalLine
      .split('~/.claude/get-shit-done/bin/gsd-tools.js').join(TOOLS_PATH)
      .split('{phase_number}').join(String(phaseNum));
    const scriptPath = path.join(dir, 'depends-on-snippet.sh');
    fs.writeFileSync(scriptPath, `${substituted}\necho "$DEPENDS_ON"\n`);
    const result = execSync(`bash "${scriptPath}"`, { cwd: dir, encoding: 'utf-8' });
    return JSON.parse(result.trim());
  }

  test('extractDependsOnSnippet finds the literal DEPENDS_ON line inside cross_phase_integration', () => {
    const line = extractDependsOnSnippet();
    assert.ok(line.includes('roadmap get-phase'), 'expected the extracted line to call roadmap get-phase');
    assert.ok(line.includes('JSON.parse'), 'expected the extracted line to pipe into a JSON.parse consumer');
  });

  test('literal snippet resolves a declared dependency to a real non-empty array (would have FAILED before the --raw fix)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n\n### Phase 20: Dependent\n**Goal:** g\n**Depends on:** Phase 10\n`
    );
    const result = runExtractedSnippet(tmpDir, 20);
    assert.ok(Array.isArray(result) && result.length > 0, `expected a non-empty array, got: ${JSON.stringify(result)}`);
    assert.deepStrictEqual(result, ['Phase 10']);
  });

  test('literal snippet resolves an independent phase (no Depends on line) to []', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n\n### Phase 21: Independent\n**Goal:** g\n`
    );
    const result = runExtractedSnippet(tmpDir, 21);
    assert.deepStrictEqual(result, []);
  });

  test('regression lock: no `roadmap get-phase` + `--raw` + `JSON.parse` combination remains anywhere inside cross_phase_integration', () => {
    const content = fs.readFileSync(COORDINATOR_DETAIL_PATH, 'utf-8');
    const stepStart = content.indexOf('<step name="cross_phase_integration">');
    const stepEnd = content.indexOf('</step>', stepStart);
    assert.ok(stepStart !== -1 && stepEnd !== -1, 'expected cross_phase_integration step to exist in coordinator-detail.md');
    const lines = content.slice(stepStart, stepEnd).split('\n');
    for (const line of lines) {
      if (line.includes('roadmap get-phase') && line.includes('--raw') && line.includes('JSON.parse')) {
        assert.fail(`found forbidden roadmap get-phase + --raw + JSON.parse combination inside cross_phase_integration: ${line}`);
      }
    }
  });
});

// Phase 60-01 (MILE-39, foundation): loadConfig's 3 new adversarial_review
// toggles, the pure computeHighRisk/computePresentationOrder/verdictToIssues
// functions, and the quality assess-risk / quality verdict-to-issues CLI
// subcommands they back. This plan lands the decision layer only -- Plan
// 60-03 wires plan-phase.md's risk-triage step on top of these stable CLI
// contracts.
describe('Phase 60-01: adversarial-review config + assess-risk/verdict-to-issues (MILE-39)', () => {
  const { loadConfig, computeHighRisk, computePresentationOrder, verdictToIssues } = resilience;

  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writeFixture(relPath, content) {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }

  describe('loadConfig defaults', () => {
    test('adversarial_review_enabled:false, adversarial_review_file_threshold:8, adversarial_review_security_patterns 10-entry array when config.json is absent (ENOENT branch)', () => {
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.adversarial_review_enabled, false);
      assert.strictEqual(config.adversarial_review_file_threshold, 8);
      assert.ok(Array.isArray(config.adversarial_review_security_patterns));
      assert.strictEqual(config.adversarial_review_security_patterns.length, 10);
    });

    test('all three defaults hold when config.json exists but omits all three keys', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ model_profile: 'balanced' }),
        'utf-8'
      );
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.adversarial_review_enabled, false);
      assert.strictEqual(config.adversarial_review_file_threshold, 8);
      assert.strictEqual(config.adversarial_review_security_patterns.length, 10);
    });

    test('flat override {"adversarial_review_enabled": true} resolves without affecting the other two defaults', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ adversarial_review_enabled: true }),
        'utf-8'
      );
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.adversarial_review_enabled, true);
      assert.strictEqual(config.adversarial_review_file_threshold, 8);
      assert.strictEqual(config.adversarial_review_security_patterns.length, 10);
    });

    test('nested override {"quality": {"adversarial_review_file_threshold": 3}} resolves without affecting adversarial_review_enabled', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ quality: { adversarial_review_file_threshold: 3 } }),
        'utf-8'
      );
      const config = loadConfig(tmpDir);
      assert.strictEqual(config.adversarial_review_file_threshold, 3);
      assert.strictEqual(config.adversarial_review_enabled, false);
    });
  });

  describe('computeHighRisk (unit)', () => {
    test('explicit high_risk:true (boolean) frontmatter wins even when the toggle is OFF (default config)', () => {
      const config = loadConfig(tmpDir);
      const result = computeHighRisk({ high_risk: true }, '', config);
      assert.deepStrictEqual(result, { high_risk: true, reasons: ['explicit high_risk frontmatter flag'] });
    });

    test('explicit high_risk: "true" (string) frontmatter resolves identically to the boolean case', () => {
      const config = loadConfig(tmpDir);
      const result = computeHighRisk({ high_risk: 'true' }, '', config);
      assert.deepStrictEqual(result, { high_risk: true, reasons: ['explicit high_risk frontmatter flag'] });
    });

    test('no explicit flag, toggle OFF, 20 files_modified entries -> {high_risk:false, reasons:[]} (feature off wins)', () => {
      const config = loadConfig(tmpDir); // toggle off by default
      const filesModified = Array.from({ length: 20 }, (_, i) => `src/file${i}.js`);
      const result = computeHighRisk({ files_modified: filesModified }, '', config);
      assert.deepStrictEqual(result, { high_risk: false, reasons: [] });
    });

    test('no explicit flag, toggle ON, files_modified.length exceeds threshold -> high_risk:true with a threshold-exceeded reason', () => {
      const config = { adversarial_review_enabled: true, adversarial_review_file_threshold: 8, adversarial_review_security_patterns: [] };
      const filesModified = Array.from({ length: 9 }, (_, i) => `src/file${i}.js`);
      const result = computeHighRisk({ files_modified: filesModified }, '', config);
      assert.strictEqual(result.high_risk, true);
      assert.ok(result.reasons.some(r => r.includes('threshold')), `expected a threshold reason, got: ${JSON.stringify(result.reasons)}`);
    });

    test('no explicit flag, toggle ON, a files_modified entry matches a configured security pattern -> high_risk:true with a pattern-match reason', () => {
      const config = { adversarial_review_enabled: true, adversarial_review_file_threshold: 8, adversarial_review_security_patterns: ['auth', 'payment', '/api/'] };
      const result = computeHighRisk({ files_modified: ['src/api/auth/route.ts'] }, '', config);
      assert.strictEqual(result.high_risk, true);
      assert.ok(result.reasons.some(r => r.includes('security pattern')), `expected a pattern-match reason, got: ${JSON.stringify(result.reasons)}`);
    });

    test('no explicit flag, toggle ON, plan content with 3 tdd="true" markers -> high_risk:true with a tdd-count reason; 2 markers -> high_risk:false', () => {
      const config = { adversarial_review_enabled: true, adversarial_review_file_threshold: 8, adversarial_review_security_patterns: [] };
      const threeMarkers = '<task type="auto" tdd="true"></task><task type="auto" tdd="true"></task><task type="auto" tdd="true"></task>';
      const twoMarkers = '<task type="auto" tdd="true"></task><task type="auto" tdd="true"></task>';

      const resultThree = computeHighRisk({}, threeMarkers, config);
      assert.strictEqual(resultThree.high_risk, true);
      assert.ok(resultThree.reasons.some(r => r.includes('tdd')), `expected a tdd-count reason, got: ${JSON.stringify(resultThree.reasons)}`);

      const resultTwo = computeHighRisk({}, twoMarkers, config);
      assert.strictEqual(resultTwo.high_risk, false);
    });

    test('no explicit flag, toggle ON, none of the 3 criteria met -> {high_risk:false, reasons:[]}', () => {
      const config = { adversarial_review_enabled: true, adversarial_review_file_threshold: 8, adversarial_review_security_patterns: ['auth', 'payment'] };
      const result = computeHighRisk({ files_modified: ['src/lib/util.js'] }, '<task tdd="true"></task>', config);
      assert.deepStrictEqual(result, { high_risk: false, reasons: [] });
    });

    test('malformed input never throws: computeHighRisk(null, null, null) returns a well-formed object', () => {
      let result;
      assert.doesNotThrow(() => { result = computeHighRisk(null, null, null); });
      assert.strictEqual(typeof result.high_risk, 'boolean');
      assert.ok(Array.isArray(result.reasons));
    });

    test('malformed input never throws: files_modified is a string (not an array), toggle on', () => {
      let result;
      assert.doesNotThrow(() => {
        result = computeHighRisk({ files_modified: 'not-an-array-but-a-string' }, undefined, { adversarial_review_enabled: true });
      });
      assert.strictEqual(typeof result.high_risk, 'boolean');
      assert.ok(Array.isArray(result.reasons));
    });
  });

  describe('computePresentationOrder (unit)', () => {
    test('determinism: the SAME real plan-content string returns the identical value across repeated calls', () => {
      const content = '---\nphase: 60\nplan: "01"\n---\n\n# Real plan content\n\nSome task details here.\n';
      const first = computePresentationOrder(content);
      const second = computePresentationOrder(content);
      const third = computePresentationOrder(content);
      assert.strictEqual(first, second);
      assert.strictEqual(second, third);
    });

    test('valid enum: return value is always exactly attack_first or defense_first across 10 distinct synthetic content strings', () => {
      for (let i = 0; i < 10; i++) {
        const result = computePresentationOrder(`content-${i}-${'x'.repeat(i)}`);
        assert.ok(result === 'attack_first' || result === 'defense_first', `unexpected value: ${result}`);
      }
    });

    test('not constant: both attack_first and defense_first occur at least once across those same 10 distinct content strings', () => {
      const seen = new Set();
      for (let i = 0; i < 10; i++) {
        seen.add(computePresentationOrder(`content-${i}-${'x'.repeat(i)}`));
      }
      assert.ok(seen.has('attack_first'), 'expected at least one attack_first result');
      assert.ok(seen.has('defense_first'), 'expected at least one defense_first result');
    });
  });

  describe('quality assess-risk CLI (real subprocess)', () => {
    test('missing plan-file argument -> structured JSON error type:missing_argument, high_risk:false', () => {
      const result = runGsdTools('quality assess-risk --raw', tmpDir);
      const parsed = JSON.parse(result.output || result.error);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'missing_argument');
      assert.strictEqual(parsed.high_risk, false);
    });

    test('nonexistent file path -> structured JSON error type:file_not_found', () => {
      const result = runGsdTools('quality assess-risk does-not-exist-60-01.md --raw', tmpDir);
      const parsed = JSON.parse(result.output || result.error);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'file_not_found');
    });

    test('malformed frontmatter (unterminated --- YAML block) -> structured JSON error type:malformed_frontmatter, process exits cleanly', () => {
      const planPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/malformed-PLAN.md',
        '---\nstatus: [unterminated\nthis is not valid yaml: : :\n---\n\n# Body\n'
      );
      const relPath = path.relative(tmpDir, planPath);
      const result = runGsdTools(`quality assess-risk "${relPath}" --raw`, tmpDir);
      const parsed = JSON.parse(result.output || result.error);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'malformed_frontmatter');
    });

    test('real high-risk fixture: high_risk:true frontmatter (default config, toggle off) resolves high_risk:true with the explicit-flag reason', () => {
      const planPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/60-explicit-PLAN.md',
        '---\nphase: 60\nplan: "explicit"\nhigh_risk: true\n---\n\n# Plan\n'
      );
      const relPath = path.relative(tmpDir, planPath);
      const result = runGsdTools(`quality assess-risk "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.high_risk, true);
      assert.ok(parsed.reasons.includes('explicit high_risk frontmatter flag'));
      assert.ok(parsed.presentation_order === 'attack_first' || parsed.presentation_order === 'defense_first');
    });

    test('real criteria-triggered fixture: 9 files_modified entries + temp config toggle ON (default threshold 8) -> high_risk:true with a threshold reason', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ adversarial_review_enabled: true }),
        'utf-8'
      );
      const filesYaml = Array.from({ length: 9 }, (_, i) => `  - src/file${i}.js`).join('\n');
      const planPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/60-criteria-PLAN.md',
        `---\nphase: 60\nplan: "criteria"\nfiles_modified:\n${filesYaml}\n---\n\n# Plan\n`
      );
      const relPath = path.relative(tmpDir, planPath);
      const result = runGsdTools(`quality assess-risk "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.high_risk, true);
      assert.ok(parsed.reasons.some(r => r.includes('threshold')), `expected a threshold reason, got: ${JSON.stringify(parsed.reasons)}`);
    });

    test('real not-high-risk fixture: toggle on, 2 files_modified entries, no security pattern match, 1 tdd="true" task -> {high_risk:false, reasons:[]}', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ adversarial_review_enabled: true }),
        'utf-8'
      );
      const planPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/60-safe-PLAN.md',
        '---\nphase: 60\nplan: "safe"\nfiles_modified:\n  - src/lib/util.js\n  - src/lib/helpers.js\n---\n\n<task type="auto" tdd="true"><name>Task 1</name></task>\n'
      );
      const relPath = path.relative(tmpDir, planPath);
      const result = runGsdTools(`quality assess-risk "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.high_risk, false);
      assert.deepStrictEqual(parsed.reasons, []);
    });

    test('toggle-off default wins: same 9-files_modified fixture WITHOUT the temp adversarial_review_enabled:true config override -> high_risk:false', () => {
      const filesYaml = Array.from({ length: 9 }, (_, i) => `  - src/file${i}.js`).join('\n');
      const planPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/60-criteria-off-PLAN.md',
        `---\nphase: 60\nplan: "criteria-off"\nfiles_modified:\n${filesYaml}\n---\n\n# Plan\n`
      );
      const relPath = path.relative(tmpDir, planPath);
      const result = runGsdTools(`quality assess-risk "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.high_risk, false, 'expected the toggle-off default to win over the file-count criterion');
    });
  });

  describe('verdictToIssues (unit)', () => {
    test('{verdict: "approved"} -> []', () => {
      assert.deepStrictEqual(verdictToIssues({ verdict: 'approved' }, '60-01'), []);
    });

    test('missing/undefined verdict field entirely -> [] (treated as approved-equivalent)', () => {
      assert.deepStrictEqual(verdictToIssues({}, '60-01'), []);
      assert.deepStrictEqual(verdictToIssues({ required_changes: ['x'] }, '60-01'), []);
    });

    test('{verdict: "revise", required_changes: [...], plan: "60-01"} -> 2 warning-severity issues in the exact gsd-plan-checker shape', () => {
      const issues = verdictToIssues({ verdict: 'revise', required_changes: ['Fix A', 'Fix B'], plan: '60-01' });
      assert.strictEqual(issues.length, 2);
      for (const issue of issues) {
        assert.strictEqual(issue.plan, '60-01');
        assert.strictEqual(issue.dimension, 'adversarial_review');
        assert.strictEqual(issue.severity, 'warning');
      }
      assert.strictEqual(issues[0].description, 'Fix A');
      assert.strictEqual(issues[1].description, 'Fix B');
    });

    test('{verdict: "critical", required_changes: [{description, fix_hint}]} -> 1 blocker-severity issue, object-shaped required_changes handled', () => {
      const issues = verdictToIssues({ verdict: 'critical', required_changes: [{ description: 'Fix C', fix_hint: 'Do X' }] });
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].severity, 'blocker');
      assert.strictEqual(issues[0].description, 'Fix C');
      assert.strictEqual(issues[0].fix_hint, 'Do X');
      assert.strictEqual(issues[0].dimension, 'adversarial_review');
    });
  });

  describe('quality verdict-to-issues CLI (real subprocess)', () => {
    test('missing verdict-file argument -> structured JSON error type:missing_argument, issues:[]', () => {
      const result = runGsdTools('quality verdict-to-issues --raw', tmpDir);
      const parsed = JSON.parse(result.output || result.error);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'missing_argument');
      assert.deepStrictEqual(parsed.issues, []);
    });

    test('nonexistent file -> structured JSON error type:file_not_found', () => {
      const result = runGsdTools('quality verdict-to-issues does-not-exist-60-01-VERDICT.md --raw', tmpDir);
      const parsed = JSON.parse(result.output || result.error);
      assert.strictEqual(parsed.error, true);
      assert.strictEqual(parsed.type, 'file_not_found');
    });

    test('real VERDICT.md fixture (verdict:critical, 2 required_changes) -> issues array of length 2, both blocker-severity, adversarial_review dimension', () => {
      const verdictPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/60-01-VERDICT.md',
        '---\nplan: "60-01"\nverdict: critical\nrequired_changes:\n  - "Fix issue A"\n  - "Fix issue B"\n---\n\n# Verdict\n'
      );
      const relPath = path.relative(tmpDir, verdictPath);
      const result = runGsdTools(`quality verdict-to-issues "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.issues.length, 2);
      for (const issue of parsed.issues) {
        assert.strictEqual(issue.severity, 'blocker');
        assert.strictEqual(issue.dimension, 'adversarial_review');
      }
    });
  });
});

// Phase 60-02 (MILE-39): structural validation of the three new adversarial-review
// trio agent files (gsd-plan-attacker/gsd-plan-defender/gsd-plan-judge). These tests
// parse frontmatter via gray-matter directly against the real files on disk (not a
// fixture copy) and lock in the house content_firewall/Telemetry conventions plus
// each agent's read-only-vs-Write tool boundary and distinct output contract.
describe('Phase 60-02: adversarial-review trio agent files structural validation (MILE-39)', () => {
  const matter = require('gray-matter');

  const AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');
  const TELEMETRY_LINE = '**Telemetry:** context_pressure={0.0-1.0 estimate}, instructions_not_followed={count}, ambiguities={count}, tool_errors_swallowed={count}';

  const AGENT_FILES = [
    { file: 'gsd-plan-attacker.md', name: 'gsd-plan-attacker' },
    { file: 'gsd-plan-defender.md', name: 'gsd-plan-defender' },
    { file: 'gsd-plan-judge.md', name: 'gsd-plan-judge' },
  ];

  function readAgent(file) {
    const fullPath = path.join(AGENTS_DIR, file);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = matter(raw);
    return { raw, data: parsed.data, content: parsed.content, fullPath };
  }

  // Normalizes gray-matter's `tools` field (comma-separated string OR array) into
  // an array of trimmed tool names, so assertions work regardless of YAML shape.
  function normalizeTools(tools) {
    if (Array.isArray(tools)) return tools.map((t) => String(t).trim());
    if (typeof tools === 'string') return tools.split(',').map((t) => t.trim());
    return [];
  }

  for (const { file, name } of AGENT_FILES) {
    describe(file, () => {
      test('frontmatter parses without throwing; name/description/tools well-formed', () => {
        let agent;
        assert.doesNotThrow(() => { agent = readAgent(file); });
        assert.strictEqual(agent.data.name, name);
        assert.strictEqual(typeof agent.data.description, 'string');
        assert.ok(agent.data.description.length > 0, 'description must be non-empty');
        const tools = normalizeTools(agent.data.tools);
        assert.ok(tools.length > 0, 'tools must be non-empty');
      });

      test('raw content contains exact <content_firewall> substring', () => {
        const agent = readAgent(file);
        assert.ok(agent.raw.includes('<content_firewall>'), `${file} is missing the <content_firewall> tag`);
      });

      test('raw content contains the exact 4-field Telemetry self-report line', () => {
        const agent = readAgent(file);
        assert.ok(agent.raw.includes(TELEMETRY_LINE), `${file} is missing the exact Telemetry line substring`);
      });
    });
  }

  describe('read-only vs Write tool boundary', () => {
    test('gsd-plan-attacker.md tools does NOT include Write or Edit', () => {
      const agent = readAgent('gsd-plan-attacker.md');
      const tools = normalizeTools(agent.data.tools);
      assert.ok(!tools.includes('Write'), 'attacker must not have Write');
      assert.ok(!tools.includes('Edit'), 'attacker must not have Edit');
    });

    test('gsd-plan-defender.md tools does NOT include Write or Edit', () => {
      const agent = readAgent('gsd-plan-defender.md');
      const tools = normalizeTools(agent.data.tools);
      assert.ok(!tools.includes('Write'), 'defender must not have Write');
      assert.ok(!tools.includes('Edit'), 'defender must not have Edit');
    });

    test('gsd-plan-judge.md tools DOES include Write', () => {
      const agent = readAgent('gsd-plan-judge.md');
      const tools = normalizeTools(agent.data.tools);
      assert.ok(tools.includes('Write'), 'judge must have Write');
    });
  });

  describe('per-agent distinct output contract', () => {
    test('gsd-plan-judge.md body documents writing its own VERDICT.md and consuming presentation_order', () => {
      const agent = readAgent('gsd-plan-judge.md');
      assert.ok(agent.content.includes('VERDICT.md'), 'judge must document writing its own VERDICT.md artifact');
      assert.ok(agent.content.includes('presentation_order'), 'judge must document consuming presentation_order');
    });

    test('gsd-plan-attacker.md body has its own flaws: output contract and is not a gsd-plan-checker clone', () => {
      const agent = readAgent('gsd-plan-attacker.md');
      assert.ok(agent.content.includes('flaws:'), 'attacker must document its flaws: structured output');
      assert.ok(!agent.content.includes('## VERIFICATION PASSED'), 'attacker must not be a gsd-plan-checker clone (VERIFICATION PASSED)');
      assert.ok(!agent.content.includes('## ISSUES FOUND'), 'attacker must not be a gsd-plan-checker clone (ISSUES FOUND)');
    });

    test('gsd-plan-defender.md body has its own rebuttals: output contract with the 3 ruling enum values', () => {
      const agent = readAgent('gsd-plan-defender.md');
      assert.ok(agent.content.includes('rebuttals:'), 'defender must document its rebuttals: structured output');
      assert.ok(agent.content.includes('refuted'), 'defender must document the refuted ruling value');
      assert.ok(agent.content.includes('conceded'), 'defender must document the conceded ruling value');
      assert.ok(agent.content.includes('partially-conceded'), 'defender must document the partially-conceded ruling value');
    });
  });
});

// Phase 60-03 (MILE-39): plan-phase.md's risk-triage wiring (Step 9.5's `quality
// assess-risk` decision, Step 10's trio-vs-checker branch with the EXACT
// pre-existing checker spawn preserved byte-identical, Step 11's verdict routing
// into `quality verdict-to-issues`, Step 12's re-triage-on-revision). Prose is
// consumed by an LLM subagent, not executed as code -- coverage splits into
// (a) index-ordered/byte-identical grep-assertions proving the prose
// wiring/ordering (mirrors Phase 59-03/59-04's coordinator-detail.md pattern),
// and (b) integration-style tests driving the real `quality
// assess-risk`/`quality verdict-to-issues` CLI + gray-matter against real
// on-disk fixtures (never a live Agent() spawn).
describe('Phase 60-03: plan-phase.md adversarial-review risk-triage wiring (MILE-39)', () => {
  const matter = require('gray-matter');
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const PLAN_PHASE_PATH = path.join(REPO_ROOT, 'get-shit-done', 'workflows', 'plan-phase.md');

  function readPlanPhase() {
    return fs.readFileSync(PLAN_PHASE_PATH, 'utf-8');
  }

  // Exact pre-Phase-60 checker banner + <verification_context> prompt block +
  // Agent() call, copied verbatim from the checker branch of plan-phase.md's
  // Step 10. Must remain a byte-identical substring of the live file --
  // proves criterion 3 (non-high-risk plans keep the existing single
  // plan-checker path completely unchanged).
  const EXACT_ORIGINAL_CHECKER_BLOCK = [
    'Display banner:',
    '```',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ' GSD ► VERIFYING PLANS',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '◆ Spawning plan checker...',
    '```',
    '',
    'Checker prompt:',
    '',
    '```markdown',
    '<verification_context>',
    '**Phase:** {phase_number}',
    '**Phase Goal:** {goal from ROADMAP}',
    '',
    '<files_to_read>',
    '- {PHASE_DIR}/*-PLAN.md (Plans to verify)',
    '- {roadmap_path} (Roadmap)',
    '- {requirements_path} (Requirements)',
    '- {context_path} (USER DECISIONS from /gsd:discuss-phase)',
    '- {research_path} (Technical Research — includes Validation Architecture)',
    '</files_to_read>',
    '',
    '**Phase requirement IDs (MUST ALL be covered):** {phase_req_ids}',
    '',
    '**Project instructions:** Read ./CLAUDE.md if exists — verify plans honor project guidelines',
    '**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — verify plans account for project skill rules',
    '</verification_context>',
    '',
    '<expected_output>',
    '- ## VERIFICATION PASSED — all checks pass',
    '- ## ISSUES FOUND — structured issue list',
    '</expected_output>',
    '```',
    '',
    '```',
    'Agent(',
    '  prompt=checker_prompt,',
    '  subagent_type="gsd-plan-checker",',
    '  model="{checker_model}",',
    '  description="Verify Phase {phase} plans"',
    ')',
    '```',
  ].join('\n');

  describe('index-ordered + byte-identical grep-assertions (real file on disk)', () => {
    test('Step 9.5 heading exists and appears BEFORE Step 10\'s trio-vs-checker heading', () => {
      const content = readPlanPhase();
      const step95Idx = content.indexOf('## 9.5. Risk Triage (Adversarial Review, MILE-39)');
      const step10Idx = content.indexOf('## 10. Spawn gsd-plan-checker Agent (or Adversarial Review Trio, MILE-39)');
      assert.ok(step95Idx > -1, 'expected Step 9.5 heading to exist');
      assert.ok(step10Idx > -1, 'expected the new Step 10 heading to exist');
      assert.ok(step95Idx < step10Idx, 'expected Step 9.5 to be wired BEFORE Step 10');
    });

    test('fail-open fallback text is present', () => {
      const content = readPlanPhase();
      assert.ok(content.includes('Falling back to standard gsd-plan-checker for the entire phase'));
    });

    test('byte-identical regression guard: the EXACT pre-existing checker banner + prompt + Agent() block is still present unmodified', () => {
      const content = readPlanPhase();
      assert.ok(
        content.includes(EXACT_ORIGINAL_CHECKER_BLOCK),
        'expected the pre-Phase-60 checker spawn block to remain byte-identical inside the checker branch'
      );
    });

    test('Step 11\'s heading appears AFTER Step 10\'s heading (ordering)', () => {
      const content = readPlanPhase();
      const step10Idx = content.indexOf('## 10. Spawn gsd-plan-checker Agent (or Adversarial Review Trio, MILE-39)');
      const step11Idx = content.indexOf('## 11. Handle Checker Return');
      assert.ok(step11Idx > step10Idx, 'expected Step 11 to appear after Step 10');
    });

    test('Step 11 branches on TRIAGE_MODE (checker vs trio) and calls quality verdict-to-issues', () => {
      const content = readPlanPhase();
      const step11Idx = content.indexOf('## 11. Handle Checker Return');
      const step12Idx = content.indexOf('## 12. Revision Loop (Max 3 Iterations)');
      const step11Text = content.slice(step11Idx, step12Idx);
      assert.ok(step11Text.includes('`TRIAGE_MODE` is `checker`'), 'expected the checker-mode branch label');
      assert.ok(step11Text.includes('`TRIAGE_MODE` is `trio`'), 'expected the trio-mode branch label');
      assert.ok(step11Text.includes('quality verdict-to-issues'), 'expected the verdict-to-issues CLI call');
    });

    test('Step 12 re-runs Step 9.5\'s triage before re-spawning step 10, while the existing gsd-planner revision spawn remains unmodified', () => {
      const content = readPlanPhase();
      assert.ok(content.includes('re-run Step 9.5'), 'expected the re-triage-on-revision text');
      assert.ok(
        content.includes('subagent_type="gsd-planner"'),
        'expected the existing Step 12 gsd-planner revision spawn to remain present unmodified'
      );
    });
  });

  describe('integration-style tests via the CLI/pure-function layer (real subprocess, no live Agent() spawn)', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(tmpDir);
    });

    function writeFixture(relPath, content) {
      const fullPath = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      return fullPath;
    }

    function computeTriageMode(highRisk) {
      return highRisk ? 'trio' : 'checker';
    }

    test('trio spawn decision: a real high-risk *-PLAN.md fixture drives quality assess-risk to high_risk:true, resolving TRIAGE_MODE=trio', () => {
      const planPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/60-99-PLAN.md',
        '---\nphase: 60\nplan: "99"\nhigh_risk: true\n---\n\n# Plan\n'
      );
      const relPath = path.relative(tmpDir, planPath);
      const result = runGsdTools(`quality assess-risk "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.high_risk, true);
      assert.strictEqual(computeTriageMode(parsed.high_risk), 'trio');
    });

    test('single-checker path preserved: a real non-high-risk *-PLAN.md fixture (no high_risk flag, few files_modified, default config) drives quality assess-risk to high_risk:false, resolving TRIAGE_MODE=checker', () => {
      const planPath = writeFixture(
        '.planning/phases/60-adversarial-plan-review/60-98-PLAN.md',
        '---\nphase: 60\nplan: "98"\nfiles_modified:\n  - src/lib/util.js\n---\n\n# Plan\n'
      );
      const relPath = path.relative(tmpDir, planPath);
      const result = runGsdTools(`quality assess-risk "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.high_risk, false);
      assert.strictEqual(computeTriageMode(parsed.high_risk), 'checker');
    });

    test('verdict artifact written: a real {plan_id}-VERDICT.md is constructed via matter.stringify, written to disk, and round-trips through a SEPARATE gray-matter parse call', () => {
      const verdictDir = path.join(tmpDir, '.planning', 'phases', '60-adversarial-plan-review');
      fs.mkdirSync(verdictDir, { recursive: true });
      const verdictPath = path.join(verdictDir, '60-99-VERDICT.md');

      const frontmatter = {
        verdict: 'critical',
        plan: '60-99',
        timestamp: '2026-07-06T00:00:00Z',
        presentation_order: 'attack_first',
        required_changes: ['Fix the race condition', 'Add missing null check'],
      };
      const written = matter.stringify('# Verdict\n\nJudge findings go here.\n', frontmatter);
      fs.writeFileSync(verdictPath, written, 'utf-8');

      // Separate read-back parse call -- not reusing the write-time object.
      const readBack = matter(fs.readFileSync(verdictPath, 'utf-8'));
      assert.strictEqual(readBack.data.verdict, 'critical');
      assert.strictEqual(readBack.data.plan, '60-99');
      assert.strictEqual(readBack.data.timestamp, frontmatter.timestamp);
      assert.strictEqual(readBack.data.presentation_order, 'attack_first');
      assert.deepStrictEqual(readBack.data.required_changes, frontmatter.required_changes);
    });

    test('revision-loop routing: quality verdict-to-issues against that same critical VERDICT.md fixture produces one blocker-severity issue per required_changes entry, feeding the existing revision-prompt placeholder with zero shape translation', () => {
      const verdictDir = path.join(tmpDir, '.planning', 'phases', '60-adversarial-plan-review');
      fs.mkdirSync(verdictDir, { recursive: true });
      const verdictPath = path.join(verdictDir, '60-99-VERDICT.md');
      const frontmatter = {
        verdict: 'critical',
        plan: '60-99',
        timestamp: '2026-07-06T00:00:00Z',
        presentation_order: 'attack_first',
        required_changes: ['Fix the race condition', 'Add missing null check'],
      };
      fs.writeFileSync(verdictPath, matter.stringify('# Verdict\n', frontmatter), 'utf-8');

      const relPath = path.relative(tmpDir, verdictPath);
      const result = runGsdTools(`quality verdict-to-issues "${relPath}" --raw`, tmpDir);
      assert.ok(result.success, `expected exit 0, got: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.issues.length, frontmatter.required_changes.length);
      for (const issue of parsed.issues) {
        assert.strictEqual(issue.severity, 'blocker');
        assert.strictEqual(issue.dimension, 'adversarial_review');
      }
    });
  });
});

describe('Phase 61-02: project-aware gate pre-pr (MILE-41)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function createExecutionLog(tmpDir) {
    // Create a minimal balanced EXECUTION_LOG.md with phase_start/phase_complete pairs
    const execLogPath = path.join(tmpDir, '.planning', 'EXECUTION_LOG.md');
    const log = {
      type: 'phase_start',
      phase: '01',
      timestamp: new Date().toISOString(),
    };
    const log2 = {
      type: 'phase_complete',
      phase: '01',
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(execLogPath, JSON.stringify(log) + '\n' + JSON.stringify(log2) + '\n');
  }

  test('node-type fixture (package.json with test+lint, no build): returns node checks only', () => {
    createExecutionLog(tmpDir);

    // Create package.json with test and lint scripts (no build)
    const pkgJson = {
      name: 'test-project',
      scripts: {
        test: 'jest',
        lint: 'eslint .',
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(pkgJson, null, 2),
      'utf-8'
    );

    const result = runGsdTools('gate pre-pr --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.gate, 'pre-pr');
    assert.strictEqual(parsed.action_required, true);

    // Check detected_types
    assert.deepStrictEqual(parsed.detected_types, ['node']);

    // Check degraded absent or false
    assert.ok(parsed.degraded === undefined || parsed.degraded === false);

    // Check checks array contains exactly node-test and node-lint
    assert.strictEqual(parsed.checks.length, 2);
    const ids = parsed.checks.map(c => c.id).sort();
    assert.deepStrictEqual(ids, ['node-lint', 'node-test']);

    const testCheck = parsed.checks.find(c => c.id === 'node-test');
    assert.strictEqual(testCheck.command, 'npm run test');
    assert.strictEqual(testCheck.required, true);

    const lintCheck = parsed.checks.find(c => c.id === 'node-lint');
    assert.strictEqual(lintCheck.command, 'npm run lint');
    assert.strictEqual(lintCheck.required, true);
  });

  test('python-type fixture (pyproject.toml): returns python checks', () => {
    createExecutionLog(tmpDir);

    // Create minimal valid pyproject.toml
    const tomlContent = `[tool.poetry]
name = "test-project"
version = "0.1.0"
description = "Test"
`;
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), tomlContent, 'utf-8');

    const result = runGsdTools('gate pre-pr --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.action_required, true);
    assert.deepStrictEqual(parsed.detected_types, ['python']);
    assert.ok(parsed.degraded === undefined || parsed.degraded === false);

    // Check python checks
    assert.ok(parsed.checks.length > 0);
    const pythonCheck = parsed.checks.find(c => c.id === 'python-test');
    assert.ok(pythonCheck, 'Should have python-test check');
    assert.strictEqual(pythonCheck.command, 'pytest');
  });

  test('unknown-type fixture (no manifests): degrades with notice, exit 0, universal checks', () => {
    createExecutionLog(tmpDir);

    // Create empty directory (no manifests)
    const result = runGsdTools('gate pre-pr --raw', tmpDir);
    assert.ok(result.success, `Command should exit 0, got: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.gate, 'pre-pr');
    assert.strictEqual(parsed.action_required, true);
    assert.strictEqual(parsed.degraded, true);
    assert.ok(typeof parsed.notice === 'string' && parsed.notice.length > 0);
    assert.ok(parsed.notice.includes('manifest'), 'Notice should mention manifest files');
    assert.deepStrictEqual(parsed.detected_types, []);

    // Check universal checks (git-status-clean, branch-not-main)
    assert.ok(parsed.checks.length > 0);
    const checkIds = parsed.checks.map(c => c.id);
    assert.ok(checkIds.includes('git-status-clean'));
    assert.ok(checkIds.includes('branch-not-main'));
  });

  test('multi-manifest fixture (package.json + go.mod): union of checks, detected_types ordered', () => {
    createExecutionLog(tmpDir);

    // Create package.json with test only
    const pkgJson = {
      name: 'test-project',
      scripts: {
        test: 'go test ./...',
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(pkgJson, null, 2),
      'utf-8'
    );

    // Create go.mod
    const goModContent = `module test-project
go 1.21
`;
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), goModContent, 'utf-8');

    const result = runGsdTools('gate pre-pr --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed.detected_types, ['node', 'go']);

    // Check union of checks (node-test + go-test + go-vet)
    const checkIds = parsed.checks.map(c => c.id);
    assert.ok(checkIds.includes('node-test'), 'Should have node-test from package.json');
    assert.ok(checkIds.includes('go-test'), 'Should have go-test');
    assert.ok(checkIds.includes('go-vet'), 'Should have go-vet');
  });

  test('regression: --mark-passed still writes marker and returns {gate, passed:true, marked:true}', () => {
    createExecutionLog(tmpDir);

    const execLogPath = path.join(tmpDir, '.planning', 'EXECUTION_LOG.md');
    const initialContent = fs.readFileSync(execLogPath, 'utf-8');

    const result = runGsdTools('gate pre-pr --mark-passed --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.gate, 'pre-pr');
    assert.strictEqual(parsed.passed, true);
    assert.strictEqual(parsed.marked, true);

    // Check that marker was appended to EXECUTION_LOG.md
    const updatedContent = fs.readFileSync(execLogPath, 'utf-8');
    assert.ok(updatedContent.length > initialContent.length);
    const lines = updatedContent.split('\n').filter(l => l.trim().startsWith('{'));
    const markerFound = lines.some(l => {
      try { return JSON.parse(l).type === 'gate_pre_pr_passed'; } catch { return false; }
    });
    assert.ok(markerFound, 'gate_pre_pr_passed marker should be in EXECUTION_LOG.md');
  });

  test('regression: incomplete-phases error path unchanged', () => {
    // Create UNBALANCED EXECUTION_LOG.md (phase_start without phase_complete)
    const execLogPath = path.join(tmpDir, '.planning', 'EXECUTION_LOG.md');
    const log = {
      type: 'phase_start',
      phase: '42',
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(execLogPath, JSON.stringify(log) + '\n');

    const result = runGsdTools('gate pre-pr --raw', tmpDir);
    // Note: output() function exits with code 0 even on errors, so success is true
    assert.ok(result.success, 'Command exits with code 0 (pre-existing behavior)');

    const parsed = JSON.parse(result.output || '{}');
    assert.strictEqual(parsed.gate, 'pre-pr');
    assert.strictEqual(parsed.passed, false);
    assert.ok(parsed.error && parsed.error.includes('Incomplete phases'));
    assert.ok(parsed.incomplete_phases && parsed.incomplete_phases.includes('42'));
  });

  test('regression: cached gate_pre_pr_passed marker returns {gate, passed:true, cached:true}', () => {
    // Create EXECUTION_LOG.md with balanced phases AND existing gate_pre_pr_passed marker
    const execLogPath = path.join(tmpDir, '.planning', 'EXECUTION_LOG.md');
    const entries = [
      { type: 'phase_start', phase: '01', timestamp: new Date().toISOString() },
      { type: 'phase_complete', phase: '01', timestamp: new Date().toISOString() },
      { type: 'gate_pre_pr_passed', timestamp: new Date().toISOString(), checks_passed: true },
    ];
    const logContent = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(execLogPath, logContent);

    const result = runGsdTools('gate pre-pr --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.gate, 'pre-pr');
    assert.strictEqual(parsed.passed, true);
    assert.strictEqual(parsed.cached, true);
    assert.ok(parsed.message && parsed.message.includes('already passed'));
  });

  test('grep-assertion: execute-roadmap.md still contains exact parsing contract strings', () => {
    const roadmapPath = path.join(
      __dirname,
      '..',
      'workflows',
      'execute-roadmap.md'
    );

    assert.ok(fs.existsSync(roadmapPath), `execute-roadmap.md should exist at ${roadmapPath}`);
    const content = fs.readFileSync(roadmapPath, 'utf-8');

    // Lock in the parsing contract strings -- these are the exact literals consumed by execute-roadmap.md's step
    assert.ok(content.includes('gate pre-pr'), 'Should contain gate pre-pr command');
    assert.ok(content.includes('action_required'), 'Should contain action_required field parse');
    assert.ok(content.includes('checks'), 'Should contain checks array reference');
    assert.ok(content.includes('gate pre-pr --mark-passed'), 'Should contain mark-passed command');
    assert.ok(content.includes('"passed": true'), 'Should contain "passed": true verification (space matches output()\'s JSON.stringify(result, null, 2) pretty-printing)');
  });
});
