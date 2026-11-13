'use strict';

// agnostic-M-03 (base preset). Every test runs `project init --preset base` in a tmp git repo with
// GSD_HOME set to a tmp directory, so no test writes ~/.gsd. Nothing here needs a macOS-only tool.

const { test, describe, afterEach, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./project-deploy-render.js');
const { scanText } = require('./project-deploy-scan.js');

const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
const BASE = path.join(__dirname, '..', 'presets', 'base');

const tmps = [];
afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
};

function gitRepo(config) {
  const root = mkTmp('gsd-base-repo-');
  assert.strictEqual(spawnSync('git', ['init', '-q', root]).status, 0);
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify(config, null, 2));
  return root;
}

function runInit(root, home) {
  const r = spawnSync(process.execPath, [GSD_TOOLS, 'project', 'init', '--root', root, '--preset', 'base'], {
    encoding: 'utf8',
    env: { ...process.env, GSD_HOME: home },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const configOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8'));

const CLAUDE_HEADINGS = [
  '## Path-trace any claim made about code',
  '## Claude Code Behaviour Guidelines',
  '### Use of tools',
  '### Clean code and functional style',
  '### Code Quality',
  '### Token & Length Discipline',
  '## Development Policies',
  '### Before Creating a PR (MANDATORY — no exceptions)',
  '### Investigating a CI failure — use the triage tool FIRST',
  '### Subagent Usage IS MANDATORY',
  '### Orchestration hard rules (any agent that spawns agents)',
  '### Temp Files',
  '### Branch Management',
];

describe('base preset: CLAUDE.md methodology (agnostic-M-03 3.1)', () => {
  test('3.1 preset.json names base, version 1, and one managed block for CLAUDE.md (plus the 3.3 hook files)', () => {
    const loaded = R.loadPreset(BASE);
    assert.strictEqual(loaded.ok, true, loaded.errors.join('; '));
    assert.strictEqual(loaded.preset.name, 'base');
    assert.strictEqual(loaded.preset.version, '1');
    assert.deepStrictEqual(loaded.preset.files.map((f) => [f.dest, f.kind, f.render]), [
      ['CLAUDE.md', 'block', true],
      ['.claude/hooks/redirect-recursive-search.sh', 'whole', false],
      ['.claude/hooks/lib/run-perl.sh', 'whole', false],
      ['.claude/hooks/lib/ShellParse.pm', 'whole', false],
      ['.claude/hooks/lib/HookGuard.pm', 'whole', false],
      ['.claude/hooks/lib/redirect-recursive-search.pl', 'whole', true],
      ['.claude/hooks/check-git-merge-target.sh', 'whole', false],
      ['.claude/hooks/lib/check-git-merge-target.pl', 'whole', true],
      ['.claude/hooks/block-push-without-local-tests.sh', 'whole', false],
      ['.claude/hooks/lib/block-push-without-local-tests.pl', 'whole', true],
      ['.claude/hooks/check-test-command.sh', 'whole', false],
      ['.claude/hooks/lib/check-test-command.pl', 'whole', false],
      ['.claude/hooks/check-denied-command.sh', 'whole', false],
      ['.claude/hooks/lib/check-denied-command.pl', 'whole', true],
      ['.claude/hooks/check-flake-patterns.sh', 'whole', false],
      ['.claude/hooks/lib/flake-gate.mjs', 'whole', false],
      ['scripts/validation/hook-canaries/run-canaries.sh', 'whole', true],
      ['scripts/validation/hook-canaries/canaries.jsonl', 'whole', true],
      ['scripts/hooks-apply.sh', 'whole', false],
      ['scripts/validation/hook-patch-trailer-check.sh', 'whole', false],
      ['.claude/rules/testing.md', 'whole', true],
      ['.claude/skills/finishing-a-development-branch/SKILL.md', 'whole', true],
      ['.claude/rules/shared-stack.md', 'whole', false],
      ['docs/gsd/host-ops.md', 'whole', false],
      ['docs/gsd/file-claims-template.md', 'whole', false],
      ['.planning/cleanup-keep.txt', 'whole', false],
      ['docs/gsd/agent-ops-lessons.md', 'whole', false],
      ['docs/gsd/engineering-lessons.md', 'whole', false],
      ['.claude/rules/guard-authoring.md', 'whole', true],
      ['.claude/rules/pre-pr-gates.md', 'whole', true],
      ['.claude/rules/module-structure.md', 'whole', false],
      ['scripts/stack-lock.sh', 'whole', false],
      ['scripts/stack-lock.mjs', 'whole', false],
      ['scripts/session-supervisor.sh', 'whole', false],
      ['docs/gsd/session-supervisor.md', 'whole', false],
      ['scripts/pre-pr-gate.sh', 'whole', false],
      ['scripts/log-pre-pr-disagreement.sh', 'whole', false],
      ['scripts/validation/canary-gate.mjs', 'whole', false],
      ['scripts/validation/guard-registry.mjs', 'whole', false],
      ['scripts/validation/guards/sample-guard.mjs', 'whole', false],
      ['scripts/validation/canaries/sample-guard.canaries.mjs', 'whole', false],
      ['scripts/validation/guard-registry-reconcile.mjs', 'whole', false],
      ['docs/gsd/guard-estate.md', 'whole', false],
      ['scripts/ci-diagnose.mjs', 'whole', false],
      ['.claude/skills/test-enforcement/SKILL.md', 'whole', false],
      ['.claude/skills/create-unit-test/SKILL.md', 'whole', false],
      ['.claude/skills/create-unit-test/test-outline.md', 'whole', false],
      ['.claude/skills/create-documentation/SKILL.md', 'whole', false],
      ['.claude/skills/create-documentation/templates/api.md', 'whole', false],
      ['.claude/skills/create-documentation/templates/guide.md', 'whole', false],
      ['.claude/rules/handler-correctness.md', 'whole', false],
      ['.claude/rules/data-integrity.md', 'whole', false],
      ['.claude/skills/vibe-security/SKILL.md', 'whole', false],
      ['.claude/rules/e2e-assertions.md', 'whole', false],
      ['.claude/rules/frontend-testability.md', 'whole', false],
      ['.claude/rules/qa-exemptions.md', 'whole', false],
      ['.claude/rules/code-style.md', 'whole', false],
      ['scripts/style-gate.mjs', 'whole', false],
      ['scripts/style-gate/scan.mjs', 'whole', false],
      ['scripts/style-gate/input-mutation.mjs', 'whole', false],
      ['scripts/style-gate/dup.mjs', 'whole', false],
      ['scripts/style-gate/rule-sets/generic.json', 'whole', false],
      ['scripts/style-gate/rule-sets/js-ts.json', 'whole', false],
      ['scripts/style-gate/rule-sets/python.json', 'whole', false],
      ['scripts/validation/canaries/style-gate.canaries.mjs', 'whole', false],
      ['scripts/mutate/classify.mjs', 'whole', false],
      ['scripts/mutate/guards.mjs', 'whole', false],
      ['scripts/mutate/options.mjs', 'whole', false],
      ['scripts/mutate/restore.mjs', 'whole', false],
      ['scripts/mutate/worktree.mjs', 'whole', false],
      ['scripts/mutate/process.mjs', 'whole', false],
      ['scripts/mutate/mutate.mjs', 'whole', false],
      ['docs/gsd/mutation-testing.md', 'whole', false],
      ['scripts/dependency-scan-gate.mjs', 'whole', false],
      ['scripts/memory-guard.sh', 'whole', false],
      ['scripts/container-disk-guard.sh', 'whole', false],
      ['scripts/lib/reap-stale-test-processes.sh', 'whole', false],
      ['scripts/reap-stale.sh', 'whole', false],
      ['scripts/validation/adr-reconcile.mjs', 'whole', false],
      ['scripts/validation/freshness-tracker.mjs', 'whole', false],
      ['scripts/validation/check-assertion-quality.mjs', 'whole', false],
      ['scripts/findings-register.mjs', 'whole', false],
      ['scripts/lib/findings-register/parse.mjs', 'whole', false],
      ['scripts/lib/findings-register/owner.mjs', 'whole', false],
      ['scripts/lib/findings-register/telemetry.mjs', 'whole', false],
    ]);
  });

  test('3.1 init --preset base on an empty git repo exits 0 and writes CLAUDE.md with both markers and the rendered keys', () => {
    const home = mkTmp('gsd-base-home-');
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const r = runInit(root, home);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const md = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.ok(md.includes('<!-- gsd:begin core -->'));
    assert.ok(md.includes('<!-- gsd:end core -->'));
    assert.ok(md.includes('Be a brutally honest advisor to the owner:'), 'owner title rendered');
    assert.ok(md.includes('`git grep -n <pat> -- <path>`'), 'search command rendered in the sweep line');
    assert.ok(md.includes('Branch from `main`'), 'default branch rendered');
    assert.ok(md.includes('Run `scripts/pre-pr-gate.sh` before every PR'), 'pre-PR gate rendered');
    for (const heading of CLAUDE_HEADINGS) assert.ok(md.includes(`\n${heading}\n`), `missing heading: ${heading}`);
    assert.ok(!md.includes('{{'), 'no placeholder survives rendering');
  });

  test('3.1 the rendered CLAUDE.md has no placeholder and its clean-code section names no library and no language', () => {
    const source = fs.readFileSync(path.join(BASE, 'CLAUDE.md'), 'utf8');
    const rendered = R.renderText(source, { project: { owner_title: 'owner' }, stack: { branch: { default: 'main' }, commands: { search: 'git grep -n', pre_pr_gate: 'scripts/pre-pr-gate.sh' } } });
    assert.deepStrictEqual(rendered.missing, []);
    const body = rendered.text;
    assert.ok(!body.includes('{{'));
    assert.ok(source.includes('{{project.owner_title}}'), 'source keeps the placeholder');
    const start = body.indexOf('### Clean code and functional style');
    const end = body.indexOf('### Code Quality');
    assert.ok(start > 0 && end > start, 'clean-code section is bounded by its neighbours');
    const section = body.slice(start, end);
    assert.doesNotMatch(section, /\b(TypeScript|JavaScript|Deno|Node|Python|Rust|Java|Kotlin|Swift|Dart|Zod|Ramda|Lodash|Supabase|React)\b/);
    assert.match(section, /`scripts\/style-gate\.mjs` enforces it\.$/m);
  });
});

const FIXED_DENY = [
  'Bash(rm -rf /:*)', 'Bash(rm -rf ~:*)', 'Bash(rm -rf *:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)',
  'Bash(git reset --hard:*)', 'Bash(git clean -fd:*)', 'Bash(docker rm:*)', 'Bash(docker rmi:*)',
  'Bash(docker system prune:*)', 'Bash(docker container rm:*)', 'Bash(docker image rm:*)', 'Bash(docker volume rm:*)',
  'Bash(docker volume prune:*)', 'Bash(dropdb:*)', 'Bash(> /dev/sda:*)', 'Bash(npm install -g:*)',
  'Bash(npm uninstall -g:*)', 'Bash(npm i -g:*)', 'Bash(npm install --global:*)', 'Bash(npm uninstall --global:*)',
  'Bash(sudo npm:*)', 'Bash(sudo:*)',
  'Read(**/.env)', 'Read(**/.env.local)', 'Read(**/.env.*.local)', 'Read(**/.env.development)', 'Read(**/.env.production)',
  'Read(**/.env.staging)', 'Read(**/.env.test)', 'Read(**/.env.dev)', 'Read(**/.env.prod)', 'Read(**/secrets/**)',
  'Read(~/.ssh/**)', 'Read(~/.a?s/**)', 'Read(~/.config/gh/**)', 'Read(~/.gnupg/**)', 'Read(**/.npmrc)', 'Read(**/.git-credentials)',
  'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/id_rsa*)',
];
const SLOT_NAMES = [1, 2, 3, 4, 5];
const SLOT_ROWS = SLOT_NAMES.map((n) => `Bash({{stack.deploy.slot_${n}}}:*)`);
const INERT_SLOT_ROWS = SLOT_NAMES.map((n) => `Bash(gsd-unused-deploy-entry-${n}:*)`);
const readSettings = (root) => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')).permissions;

describe('base preset: settings fragment (agnostic-M-03 3.2)', () => {
  const FRAGMENT = path.join(BASE, 'settings.fragment.json');
  const perms = () => JSON.parse(fs.readFileSync(FRAGMENT, 'utf8')).permissions;
  const ASK = [
    'Bash(git rebase:*)', 'Bash(npm uninstall:*)', 'Bash(docker stop:*)', 'Bash(npm rm:*)', 'Bash(npm remove:*)',
    'Bash(docker container stop:*)', 'Bash(docker kill:*)',
  ];
  const FORBIDDEN_ALLOW = /\.env|git push|bash:|curl|python|node|xargs|psql|[|;&]|\*[A-Z_]+=\*|\/Users\//;

  test('3.2 init writes .claude/settings.json with exactly the fragment allow, deny and ask sets', () => {
    const home = mkTmp('gsd-base-home-');
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const r = runInit(root, home);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const deployed = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')).permissions;
    const f = perms();
    assert.deepStrictEqual(deployed.allow, f.allow);
    assert.deepStrictEqual(deployed.deny, [...FIXED_DENY, ...INERT_SLOT_ROWS]);
    assert.deepStrictEqual(deployed.ask, f.ask);
  });

  test('3.2 no allow entry matches a secret read, a push, an interpreter, a network tool, a chain or an absolute path', () => {
    for (const rule of perms().allow) assert.doesNotMatch(rule, FORBIDDEN_ALLOW, rule);
  });

  test('3.8 C3 no allow entry is a shell control keyword, and no generic runner or branch writer is allowed', () => {
    const CONTROL = /^Bash\((?:if|then|else|elif|fi|case|esac|for|while|until|do|done|function)\b/;
    const BANNED = ['Bash(git branch:*)', 'Bash(find:*)', 'Bash(sed:*)', 'Bash(sort:*)', 'Bash(uniq:*)', 'Bash(awk:*)', 'Bash(env:*)', 'Bash(tee:*)'];
    for (const rule of perms().allow) assert.doesNotMatch(rule, CONTROL, rule);
    for (const rule of BANNED) assert.ok(!perms().allow.includes(rule), rule);
    assert.strictEqual(perms().allow.length, 77);
  });

  test('3.2 the 42 fixed deny rows, the 5 deploy slot rows (3.12) and the 7 ask rows are the whole deny and ask sets', () => {
    const f = perms();
    assert.deepStrictEqual(f.deny, [...FIXED_DENY, ...SLOT_ROWS]);
    assert.strictEqual(f.deny.length, 47);
    assert.deepStrictEqual(f.ask, ASK);
  });

  test('3.8 C4 no deny entry is a one-directory Read rule, and no secret template is denied by any Read row', () => {
    const f = perms();
    for (const rule of f.deny) assert.doesNotMatch(rule, /^Read\(\.\//, rule);
    // A trailing .* would also match .env.example, .env.sample and .env.template: none of the Read rows may end so.
    for (const row of f.deny.filter((r) => r.startsWith('Read('))) assert.doesNotMatch(row, /\.\*\)$/, row);
  });

  test('F4 the deny set names the key directories, credential files and key files, and still lets every secret template be read', () => {
    const deny = perms().deny;
    for (const row of ['Read(~/.ssh/**)', 'Read(~/.a?s/**)', 'Read(~/.config/gh/**)', 'Read(~/.gnupg/**)', 'Read(**/.npmrc)', 'Read(**/.git-credentials)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/id_rsa*)']) {
      assert.ok(deny.includes(row), row);
    }
    // The settings matcher is case-sensitive: .ENV and SECRETS are caught for Bash readers by the hook (secret_path lowercases); no upper-case Read rows are added.
    assert.ok(!deny.some((r) => /\.ENV|SECRETS/.test(r)));
  });

  test('3.2 the scanner finds no secret-shaped text in the fragment', () => {
    assert.deepStrictEqual(scanText(fs.readFileSync(FRAGMENT)), []);
  });
});

describe('base preset: never-touch deploy commands (agnostic-M-03 3.12)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const configBytes = (root) => fs.readFileSync(path.join(root, '.planning', 'config.json'));

  test('3.12 never_touch entries become deny rows; unused slots are inert rows; the config holds the slots', () => {
    const root = gitRepo({
      project: { slug: 'demo' },
      stack: { capabilities: {}, deploy: { never_touch: ['gh workflow run deploy-prod', 'tools/release.sh prod'] } },
    });
    const r = runInit(root, home());
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const deny = readSettings(root).deny;
    assert.strictEqual(deny.length, 47);
    assert.deepStrictEqual(deny.slice(42), [
      'Bash(gh workflow run deploy-prod:*)', 'Bash(tools/release.sh prod:*)',
      'Bash(gsd-unused-deploy-entry-3:*)', 'Bash(gsd-unused-deploy-entry-4:*)', 'Bash(gsd-unused-deploy-entry-5:*)',
    ]);
    const slots = configOf(root).stack.deploy;
    assert.deepStrictEqual(
      SLOT_NAMES.map((n) => slots[`slot_${n}`]),
      ['gh workflow run deploy-prod', 'tools/release.sh prod', 'gsd-unused-deploy-entry-3', 'gsd-unused-deploy-entry-4', 'gsd-unused-deploy-entry-5'],
    );
  });

  test('3.12 no stack.deploy: five inert rows and exit 0', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const r = runInit(root, home());
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(readSettings(root).deny.slice(42), INERT_SLOT_ROWS);
  });

  test('3.12 stale slots from an earlier list are rewritten from the current list: slot_1 is the list, the rest inert', () => {
    const root = gitRepo({
      project: { slug: 'demo' },
      stack: {
        capabilities: {},
        deploy: { never_touch: ['tools/release.sh prod'], slot_1: 'stale-1', slot_2: 'stale-2', slot_3: 'stale-3', slot_4: 'stale-4', slot_5: 'stale-5' },
      },
    });
    const r = runInit(root, home());
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const slots = configOf(root).stack.deploy;
    assert.strictEqual(slots.slot_1, 'tools/release.sh prod');
    assert.deepStrictEqual(
      [slots.slot_2, slots.slot_3, slots.slot_4, slots.slot_5],
      ['gsd-unused-deploy-entry-2', 'gsd-unused-deploy-entry-3', 'gsd-unused-deploy-entry-4', 'gsd-unused-deploy-entry-5'],
    );
    const deny = readSettings(root).deny;
    assert.strictEqual(deny[42], 'Bash(tools/release.sh prod:*)');
    assert.ok(!deny.some((rule) => rule.includes('stale-')), 'no stale slot value reaches the settings');
  });

  test('3.12 six entries, or an entry outside the pattern, exit 1 naming the key; config, registry and settings are not written', () => {
    const base = { project: { slug: 'demo' }, stack: { capabilities: {} } };
    const cases = [
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['x"; y'],
    ];
    for (const never of cases) {
      const root = gitRepo({ ...base, stack: { capabilities: {}, deploy: { never_touch: never } } });
      const h = home();
      const before = configBytes(root);
      const r = runInit(root, h);
      assert.strictEqual(r.status, 1, JSON.stringify(never));
      assert.ok(JSON.parse(r.stdout).errors.some((e) => e.reason.startsWith('stack.deploy.never_touch')), r.stdout);
      assert.deepStrictEqual(configBytes(root), before, 'config bytes unchanged');
      assert.strictEqual(fs.existsSync(path.join(h, 'projects.json')), false, 'no registry written');
      assert.strictEqual(fs.existsSync(path.join(root, '.claude', 'settings.json')), false, 'no settings written');
    }
  });
});

describe('base preset: redirect-recursive-search hook (agnostic-M-03 3.3)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const SNAPSHOT_LIB = path.join(__dirname, '..', 'presets', 'igaming', 'hooks', 'lib');
  const deployedHook = (root) => path.join(root, '.claude', 'hooks', 'redirect-recursive-search.sh');
  const runHook = (root, input) => spawnSync('bash', [deployedHook(root)], {
    input: typeof input === 'string' ? input : JSON.stringify({ tool_name: 'Bash', tool_input: { command: input.command }, cwd: root }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });

  test('3.3 deployed hook denies a recursive grep naming the configured search command and allows a named-file grep', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    for (const command of ['grep -r x .', 'grep --recursive x .']) {
      const denied = runHook(root, { command });
      assert.strictEqual(denied.status, 2, `${command}: ${denied.stderr}`);
      assert.ok(denied.stderr.includes('git grep -n <pattern>'), denied.stderr);
    }
    assert.strictEqual(runHook(root, { command: 'grep -n x file.txt' }).status, 0);
  });

  test('3.3 the search command in the deny message follows the profile (stack.commands.search)', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {}, commands: { search: 'rg -n' } } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const denied = runHook(root, { command: 'grep -r x .' });
    assert.strictEqual(denied.status, 2, denied.stderr);
    assert.ok(denied.stderr.includes('rg -n <pattern>'), denied.stderr);
    assert.ok(!denied.stderr.includes('{{'), 'no placeholder survives in the message');
  });

  test('3.3 malformed stdin fails closed: exit 2 with the fail-closed message', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const r = runHook(root, '{not json');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('BLOCKED'), r.stderr);
  });

  test('3.3 the deployed ShellParse.pm is byte-equal to the igaming snapshot copy', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const deployed = fs.readFileSync(path.join(root, '.claude', 'hooks', 'lib', 'ShellParse.pm'));
    const snapshot = fs.readFileSync(path.join(SNAPSHOT_LIB, 'ShellParse.pm'));
    assert.ok(deployed.equals(snapshot), 'ShellParse.pm differs from the snapshot');
  });

  test('3.3 the fragment registers the hook on PreToolUse, matcher Bash, with the project-dir path', () => {
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    assert.deepStrictEqual(frag.hooks.PreToolUse[0].hooks[0], { type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/redirect-recursive-search.sh', timeout: 15 });
  });
});

describe('base preset: testing rule and finishing skill (agnostic-M-03 3.6)', () => {
  const KERNEL_HEADINGS = [
    '## Why Local Can Pass When CI Fails (and how to prevent it)',
    '### Rule: tests must not depend on untracked or ambient local env vars',
    '### Rule: local gate must reproduce CI\'s clean-room guarantees, not just "tests green"',
    '### Rule: test-env variable names are declared once, in one manifest',
    '### Rule: the gate runs integration tests in a scrubbed environment',
    '## Test Failure Policy',
    '## Test Falsifiability — every test must be able to fail',
    '## Test Economy — reuse first, lowest layer, fewest tests',
    '## New coverage lives in an existing wired suite, not a new runner',
    '## Integration Test Isolation',
    '## Flake Prevention Gate',
    '## Parallel Test Execution',
  ];
  test('3.6 init deploys the rule and the skill rendered; the rule holds every kernel heading as its own line', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, mkTmp('gsd-base-home-')).status, 0);
    const rule = fs.readFileSync(path.join(root, '.claude', 'rules', 'testing.md'), 'utf8');
    const lines = rule.split('\n');
    for (const h of KERNEL_HEADINGS) assert.ok(lines.includes(h), `missing kernel heading: ${h}`);
    assert.ok(!rule.includes('{{'), 'no placeholder survives rendering');
    assert.ok(rule.includes('(`git grep -n`)'), 'search command rendered from the profile default');
    const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'finishing-a-development-branch', 'SKILL.md'), 'utf8');
    assert.ok(!skill.includes('{{'), 'no placeholder survives rendering');
    assert.ok(skill.includes('scripts/pre-pr-gate.sh'), 'pre-PR gate rendered');
    assert.ok(skill.includes('git merge-base HEAD main'), 'default branch rendered');
    assert.ok(skill.includes('.pre-pr-passed'), 'marker named in the git directory');
  });

  test('3.6 the rule and the skill are unguarded entries; the rule carries the path frontmatter for test files', () => {
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const mine = preset.files.filter((f) => /^\.claude\/rules\/testing\.md$|^\.claude\/skills\/finishing-a-development-branch\/SKILL\.md$/.test(f.dest));
    assert.deepStrictEqual(mine.map((f) => [f.dest, f.render, f.guarded]), [
      ['.claude/rules/testing.md', true, false],
      ['.claude/skills/finishing-a-development-branch/SKILL.md', true, false],
    ]);
    const rule = fs.readFileSync(path.join(BASE, 'rules', 'testing.md'), 'utf8');
    assert.match(rule, /^---\npaths:\n  - '\*\*\/\*\.test\.\*'\n/);
  });
});

describe('base preset: regression guard for the base deployment (agnostic-M-03 3.7)', () => {
  const REPO = path.join(__dirname, '..', '..');
  const EXCEPTIONS_FILE = path.join(REPO, 'tests', 'fixtures', 'agnostic', 'base-deployed-exceptions.json');
  const TERMS_FILE = path.join(REPO, 'scripts', 'agnostic-lint', 'terms.json');
  // Exceptions are for generic tool names only. A class outside this list needs a new reason, not a new entry.
  const GENERIC_TOOL_CLASSES = ['deno', 'pnpm', 'docker'];
  const FORBIDDEN_CLASSES = ['igaming', 'game', 'reg', 'money', 'owner', 'charlotte', 'abs'];
  const GUARDED_SCRIPTS = [
    'scripts/hooks-apply.sh',
    'scripts/validation/hook-canaries/run-canaries.sh',
    'scripts/validation/hook-patch-trailer-check.sh',
    'scripts/stack-lock.sh',
    'scripts/stack-lock.mjs',
    'scripts/pre-pr-gate.sh',
    'scripts/style-gate.mjs',
    'scripts/style-gate/scan.mjs',
    'scripts/style-gate/input-mutation.mjs',
    'scripts/style-gate/dup.mjs',
    'scripts/mutate/classify.mjs',
    'scripts/mutate/guards.mjs',
    'scripts/mutate/options.mjs',
    'scripts/mutate/restore.mjs',
    'scripts/mutate/worktree.mjs',
    'scripts/mutate/process.mjs',
    'scripts/mutate/mutate.mjs',
    'scripts/dependency-scan-gate.mjs',
    'scripts/lib/reap-stale-test-processes.sh',
    'scripts/reap-stale.sh',
  ];
  // The default configuration, after the 2.1 wiring. The gated groups (8.12 backend, 8.13 web_ui) extend these lists.
  const DEPLOYED = [
    '.claude/hooks/block-push-without-local-tests.sh',
    '.claude/hooks/check-denied-command.sh',
    '.claude/hooks/check-flake-patterns.sh',
    '.claude/hooks/check-git-merge-target.sh',
    '.claude/hooks/check-test-command.sh',
    '.claude/hooks/lib/block-push-without-local-tests.pl',
    '.claude/hooks/lib/check-denied-command.pl',
    '.claude/hooks/lib/check-git-merge-target.pl',
    '.claude/hooks/lib/check-test-command.pl',
    '.claude/hooks/lib/flake-gate.mjs',
    '.claude/hooks/lib/HookGuard.pm',
    '.claude/hooks/lib/redirect-recursive-search.pl',
    '.claude/hooks/lib/run-perl.sh',
    '.claude/hooks/lib/ShellParse.pm',
    '.claude/hooks/redirect-recursive-search.sh',
    '.claude/rules/code-style.md',
    '.claude/rules/guard-authoring.md',
    '.claude/rules/module-structure.md',
    '.claude/rules/pre-pr-gates.md',
    '.claude/rules/shared-stack.md',
    '.claude/rules/testing.md',
    '.claude/settings.json',
    '.claude/skills/create-documentation/SKILL.md',
    '.claude/skills/create-documentation/templates/api.md',
    '.claude/skills/create-documentation/templates/guide.md',
    '.claude/skills/create-unit-test/SKILL.md',
    '.claude/skills/create-unit-test/test-outline.md',
    '.claude/skills/finishing-a-development-branch/SKILL.md',
    '.claude/skills/test-enforcement/SKILL.md',
    '.gitignore',
    '.planning/cleanup-keep.txt',
    '.planning/gsd-project-manifest.json',
    'CLAUDE.md',
    'docs/gsd/agent-ops-lessons.md',
    'docs/gsd/engineering-lessons.md',
    'docs/gsd/file-claims-template.md',
    'docs/gsd/guard-estate.md',
    'docs/gsd/host-ops.md',
    'docs/gsd/mutation-testing.md',
    'docs/gsd/session-supervisor.md',
    'scripts/ci-diagnose.mjs',
    'scripts/hooks-apply.sh',
    'scripts/log-pre-pr-disagreement.sh',
    'scripts/mutate/classify.mjs',
    'scripts/mutate/guards.mjs',
    'scripts/mutate/options.mjs',
    'scripts/mutate/restore.mjs',
    'scripts/mutate/worktree.mjs',
    'scripts/mutate/mutate.mjs',
    'scripts/mutate/process.mjs',
    'scripts/pre-pr-gate.sh',
    'scripts/session-supervisor.sh',
    'scripts/stack-lock.mjs',
    'scripts/stack-lock.sh',
    'scripts/style-gate.mjs',
    'scripts/style-gate/dup.mjs',
    'scripts/style-gate/input-mutation.mjs',
    'scripts/style-gate/rule-sets/generic.json',
    'scripts/style-gate/rule-sets/js-ts.json',
    'scripts/style-gate/rule-sets/python.json',
    'scripts/style-gate/scan.mjs',
    'scripts/validation/canaries/sample-guard.canaries.mjs',
    'scripts/validation/canaries/style-gate.canaries.mjs',
    'scripts/validation/canary-gate.mjs',
    'scripts/validation/guard-registry.mjs',
    'scripts/validation/guard-registry-reconcile.mjs',
    'scripts/validation/guards/sample-guard.mjs',
    'scripts/validation/hook-canaries/canaries.jsonl',
    'scripts/validation/hook-canaries/run-canaries.sh',
    'scripts/validation/hook-patch-trailer-check.sh',
    'scripts/dependency-scan-gate.mjs',
    'scripts/memory-guard.sh',
    'scripts/container-disk-guard.sh',
    'scripts/lib/reap-stale-test-processes.sh',
    'scripts/reap-stale.sh',
    'scripts/validation/adr-reconcile.mjs',
    'scripts/validation/freshness-tracker.mjs',
    'scripts/findings-register.mjs',
    'scripts/lib/findings-register/parse.mjs',
    'scripts/lib/findings-register/owner.mjs',
    'scripts/lib/findings-register/telemetry.mjs',
  ];
  // The gated groups. The engine deploys a capability's files only when the key is a plain object
  // (project-deploy-render.js:255); the registry fills an absent key with {} (project-registry.js:109), so an absent
  // key is on and only an explicit false turns a group off.
  const BACKEND_FILES = [
    '.claude/rules/data-integrity.md',
    '.claude/rules/handler-correctness.md',
    '.claude/skills/vibe-security/SKILL.md',
  ];
  const WEB_UI_FILES = [
    '.claude/rules/e2e-assertions.md',
    '.claude/rules/frontend-testability.md',
    '.claude/rules/qa-exemptions.md',
    'scripts/validation/check-assertion-quality.mjs',
  ];
  const expectedFor = (c) => [
    ...DEPLOYED,
    ...(c.backend ? BACKEND_FILES : []),
    ...(c.webUi ? WEB_UI_FILES : []),
  ].sort();
  const CONFIGS = [
    { label: '{} (absent keys are on)', capabilities: {}, backend: true, webUi: true },
    { label: '{backend:false, web_ui:false}', capabilities: { backend: false, web_ui: false }, backend: false, webUi: false },
    { label: '{backend:{}, web_ui:false}', capabilities: { backend: {}, web_ui: false }, backend: true, webUi: false },
    { label: '{backend:{}, web_ui:{}}', capabilities: { backend: {}, web_ui: {} }, backend: true, webUi: true },
  ];
  const TERM_CLASSES = JSON.parse(fs.readFileSync(TERMS_FILE, 'utf8')).classes.map((c) => ({ id: c.id, re: new RegExp(c.pattern, c.flags) }));
  const loadExceptions = () => JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, 'utf8'));
  const exceptionKeys = (exc) => exc.flatMap((e) => e.lines.map((l) => `${e.file}|${e.class}|${l}`));

  function listTree(root) {
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '.git') walk(abs); } else if (e.isFile()) out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    };
    walk(root);
    return out.sort();
  }
  // Engine base copies (.planning/.gsd-preset-base) are checked for byte equality below, not scanned twice.
  const deployedFiles = (root) => listTree(root).filter((f) => f !== '.planning/config.json' && !f.startsWith('.planning/.gsd-preset-base/'));
  function termHits(root, files) {
    const keys = [];
    for (const f of files) {
      fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
        // `_` is a word character, so \bCEO\b misses `ceo_x`: each class is also tried on the line with `_` and `-` read as separators.
        const spaced = line.replace(/[_-]/g, ' ');
        for (const c of TERM_CLASSES) if (c.re.test(line) || c.re.test(spaced)) keys.push(`${f}|${c.id}|${i + 1}`);
      });
    }
    return keys;
  }
  // zg is checked as a literal, not as a terms.json class: the class pattern needs a subcommand after it, and a bare reader-list entry has none.
  function zgHits(root, files) {
    const keys = [];
    for (const f of files) {
      fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => { if (/\bzg\b/.test(line)) keys.push(`${f}|zg|${i + 1}`); });
    }
    return keys;
  }
  const unexcepted = (hits, exc) => hits.filter((k) => !exc.includes(k));
  const stale = (hits, exc) => exc.filter((k) => !hits.includes(k));
  function initWith(capabilities) {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities } });
    const r = spawnSync(process.execPath, [GSD_TOOLS, 'project', 'init', '--root', root, '--preset', 'base'], { encoding: 'utf8', env: { ...process.env, GSD_HOME: mkTmp('gsd-base-home-') } });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    return root;
  }
  // The engine's pure render with the values the 2.1 wiring writes. init refuses --preset-dir outside a terminal, so
  // the positive control renders a preset copy directly and writes the result to a temp root.
  const renderConfig = (capabilities) => ({
    project: { owner_title: 'owner' },
    stack: {
      branch: { default: 'main' },
      commands: { search: 'git grep -n', pre_pr_gate: 'scripts/pre-pr-gate.sh' },
      deploy: { slot_1: 'gsd-unused-deploy-entry-1', slot_2: 'gsd-unused-deploy-entry-2', slot_3: 'gsd-unused-deploy-entry-3', slot_4: 'gsd-unused-deploy-entry-4', slot_5: 'gsd-unused-deploy-entry-5' },
      capabilities,
    },
  });

  test('3.7 the deployed file list equals the literal list plus the gated groups that are on, for each configuration', () => {
    for (const c of CONFIGS) {
      const root = initWith(c.capabilities);
      assert.deepStrictEqual(deployedFiles(root), expectedFor(c), c.label);
    }
  });

  test('3.7 no deployed line matches a term class except the exception triples, and every exception triple still matches', () => {
    const root = initWith({});
    const hits = termHits(root, deployedFiles(root));
    const exc = exceptionKeys(loadExceptions());
    assert.strictEqual(new Set(exc).size, exc.length, 'no duplicate exception triple');
    assert.deepStrictEqual(unexcepted(hits, exc), [], 'unexcepted term-class lines');
    assert.deepStrictEqual(stale(hits, exc), [], 'stale exception triples');
  });

  test('3.7 positive control: an igaming term injected into a copy of the preset is reported by the same check', () => {
    const presetCopy = mkTmp('gsd-base-preset-copy-');
    fs.cpSync(BASE, presetCopy, { recursive: true });
    fs.appendFileSync(path.join(presetCopy, 'CLAUDE.md'), '\nThe igaming product rule.\n');
    const rendered = R.renderPreset(presetCopy, renderConfig({}));
    assert.deepStrictEqual(rendered.errors, []);
    const root = mkTmp('gsd-base-render-');
    for (const f of rendered.files) {
      fs.mkdirSync(path.dirname(path.join(root, f.dest)), { recursive: true });
      fs.writeFileSync(path.join(root, f.dest), f.content);
    }
    const found = unexcepted(termHits(root, listTree(root)), exceptionKeys(loadExceptions()));
    assert.ok(found.some((k) => k.startsWith('CLAUDE.md|igaming|')), found.join('\n'));
  });

  function renderedWith(extra) {
    const presetCopy = mkTmp('gsd-base-preset-copy-');
    fs.cpSync(BASE, presetCopy, { recursive: true });
    fs.appendFileSync(path.join(presetCopy, 'CLAUDE.md'), extra);
    const rendered = R.renderPreset(presetCopy, renderConfig({}));
    assert.deepStrictEqual(rendered.errors, []);
    const root = mkTmp('gsd-base-render-');
    for (const f of rendered.files) {
      fs.mkdirSync(path.dirname(path.join(root, f.dest)), { recursive: true });
      fs.writeFileSync(path.join(root, f.dest), f.content);
    }
    return root;
  }

  test('3.7 positive control: a private memory tag with an underscore term (`[memory: ceo_x]`) is reported by the term check', () => {
    const root = renderedWith('\n- A lesson. [memory: ceo_x]\n');
    const found = unexcepted(termHits(root, listTree(root)), exceptionKeys(loadExceptions()));
    assert.ok(found.some((k) => k.startsWith('CLAUDE.md|owner|')), found.join('\n'));
  });

  test('3.7 no deployed line names zg, and the literal check reports an injected zg', () => {
    const root = initWith({});
    assert.deepStrictEqual(zgHits(root, deployedFiles(root)), [], 'zg in a deployed file');
    const injected = renderedWith('\nSearch with zg.\n');
    assert.ok(zgHits(injected, listTree(injected)).some((k) => k.startsWith('CLAUDE.md|zg|')));
  });

  test('3.7 the deployed lesson docs name no private memory file', () => {
    const root = initWith({});
    for (const f of ['docs/gsd/agent-ops-lessons.md', 'docs/gsd/engineering-lessons.md']) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /\[memory:/, f);
    }
  });

  test('3.7 the exception list names only generic tool classes, each with a reason and integer lines, and no forbidden class', () => {
    for (const e of loadExceptions()) {
      assert.ok(GENERIC_TOOL_CLASSES.includes(e.class), `${e.file} class ${e.class} is not a generic tool class`);
      assert.ok(!FORBIDDEN_CLASSES.includes(e.class), e.class);
      assert.ok(typeof e.reason === 'string' && e.reason.length > 0, `${e.file} reason`);
      assert.ok(Array.isArray(e.lines) && e.lines.length > 0 && e.lines.every(Number.isInteger), `${e.file} lines`);
    }
  });

  test('3.7 each base copy under .planning/.gsd-preset-base is byte-equal to its deployed file', () => {
    const root = initWith({});
    const mirrors = listTree(root).filter((f) => f.startsWith('.planning/.gsd-preset-base/'));
    assert.strictEqual(mirrors.length, 85, 'one base copy per preset file (not the settings, gitignore or manifest)');
    for (const m of mirrors) {
      const dest = m.slice('.planning/.gsd-preset-base/'.length);
      assert.ok(fs.readFileSync(path.join(root, m)).equals(fs.readFileSync(path.join(root, dest))), dest);
    }
  });

  test('3.7 the gate for the gated groups: a capability entry is rendered only when its key is an object, never when false', () => {
    const dir = mkTmp('gsd-base-gated-');
    fs.cpSync(BASE, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'gated.md'), 'gated group fixture\n');
    const preset = JSON.parse(fs.readFileSync(path.join(dir, 'preset.json'), 'utf8'));
    preset.files.push({ src: 'gated.md', dest: '.claude/rules/gated.md', kind: 'whole', render: false, capability: 'backend', guarded: false });
    fs.writeFileSync(path.join(dir, 'preset.json'), JSON.stringify(preset, null, 2));
    const render = (capabilities) => R.renderPreset(dir, renderConfig(capabilities));
    const on = render({ backend: {}, web_ui: {} });
    assert.deepStrictEqual(on.errors, []);
    assert.ok(on.files.some((f) => f.dest === '.claude/rules/gated.md'), 'present with an object');
    const off = render({ backend: false, web_ui: false });
    assert.deepStrictEqual(off.errors, []);
    assert.ok(!off.files.some((f) => f.dest === '.claude/rules/gated.md'), 'absent with false');
  });

  test('3.7 PreToolUse has exactly two groups: Bash with the five Bash hooks, Write|Edit with the flake hook; every command resolves to an executable deployed file', () => {
    const root = initWith({});
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(settings.hooks), ['PreToolUse']);
    const groups = settings.hooks.PreToolUse;
    assert.deepStrictEqual(groups.map((g) => g.matcher), ['Bash', 'Write|Edit|MultiEdit']);
    const rel = groups.map((g) => g.hooks.map((h) => h.command.replace('"$CLAUDE_PROJECT_DIR"/', '')));
    assert.deepStrictEqual(rel, [
      ['.claude/hooks/redirect-recursive-search.sh', '.claude/hooks/check-git-merge-target.sh', '.claude/hooks/block-push-without-local-tests.sh', '.claude/hooks/check-test-command.sh', '.claude/hooks/check-denied-command.sh'],
      ['.claude/hooks/check-flake-patterns.sh'],
    ]);
    for (const p of rel.flat()) {
      const abs = path.join(root, p);
      assert.ok(fs.statSync(abs).isFile(), `deployed: ${p}`);
      assert.ok((fs.statSync(abs).mode & 0o111) !== 0, `executable: ${p}`);
    }
  });

  test('3.7 guarded flags: every entry under .claude/hooks (lib included) and the five scripts is guarded; canaries.jsonl is not', () => {
    const { preset } = R.loadPreset(BASE);
    const mine = preset.files.filter((f) => f.dest.startsWith('.claude/hooks/') || GUARDED_SCRIPTS.includes(f.dest));
    assert.strictEqual(mine.length, 35, '15 hook files and the 20 scripts');
    for (const f of mine) assert.strictEqual(f.guarded, true, f.dest);
    for (const s of GUARDED_SCRIPTS) assert.ok(preset.files.some((f) => f.dest === s), `entry for ${s}`);
    assert.strictEqual(preset.files.find((f) => f.dest === 'scripts/validation/hook-canaries/canaries.jsonl').guarded, false);
  });
});

describe('base preset: a corrupt .planning/config.json stays repairable (agnostic-M-03 3.8 C2)', () => {
  const VALID = { project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {}, flake_patterns: { test_globs: ['**/*.integration.test.ts'], patterns: [] } } };
  const hook = (root, name) => path.join(root, '.claude', 'hooks', name);
  const runTool = (root, name, toolName, toolInput) => spawnSync('bash', [hook(root, name)], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd: root }),
    encoding: 'utf8',
    cwd: root,
  });
  const deployCorrupt = () => {
    const root = gitRepo(VALID);
    assert.strictEqual(runInit(root, mkTmp('gsd-base-home-')).status, 0);
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), '<<<<<<< HEAD\n{}');
    return root;
  };

  test('C2 with a conflict marker in the config, Bash is denied and names the repair path; the Edit and Write of the config pass', () => {
    const root = deployCorrupt();
    const bash = runTool(root, 'check-test-command.sh', 'Bash', { command: 'ls' });
    assert.strictEqual(bash.status, 2, bash.stderr);
    assert.match(bash.stderr, /Repair \.planning\/config\.json with the Edit or Write tool/);
    const edit = runTool(root, 'check-flake-patterns.sh', 'Edit', { file_path: '.planning/config.json', old_string: '<<<<<<< HEAD', new_string: '' });
    assert.strictEqual(edit.status, 0, edit.stderr);
    const write = runTool(root, 'check-flake-patterns.sh', 'Write', { file_path: '.planning/config.json', content: '{}\n' });
    assert.strictEqual(write.status, 0, write.stderr);
    const elsewhere = runTool(root, 'check-flake-patterns.sh', 'Write', { file_path: 'README.md', content: 'x\n' });
    assert.strictEqual(elsewhere.status, 2);
    assert.match(elsewhere.stderr, /not valid JSON/);
  });

  test('C2 once the config parses again, Bash is allowed', () => {
    const root = deployCorrupt();
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify(VALID, null, 2));
    assert.strictEqual(runTool(root, 'check-test-command.sh', 'Bash', { command: 'ls' }).status, 0);
  });
});

describe('base preset: hook guards (review round 1: HookGuard, wrapper limits, git environment)', () => {
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const deploy = (config = { project: { slug: 'demo' }, stack: { capabilities: {} } }) => {
    const root = gitRepo(config);
    assert.strictEqual(runInit(root, mkTmp('gsd-base-home-')).status, 0);
    return root;
  };
  const runHook = (root, hook, command, env = process.env) => spawnSync('bash', [path.join(hooksDir(root), hook)], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }),
    encoding: 'utf8',
    cwd: root,
    env,
  });
  const BASH_HOOKS = ['redirect-recursive-search.sh', 'check-git-merge-target.sh', 'block-push-without-local-tests.sh', 'check-test-command.sh', 'check-denied-command.sh'];

  test('F7 a Bash call whose command is a number, null, boolean, array, object or missing is denied by every Bash hook; the string "5" is a command', () => {
    const root = deploy();
    const calls = [{ command: 5 }, { command: null }, { command: true }, { command: ['rm', '-rf', 'x'] }, { command: { a: 1 } }, {}];
    for (const hook of BASH_HOOKS) {
      for (const toolInput of calls) {
        const r = spawnSync('bash', [path.join(hooksDir(root), hook)], { input: JSON.stringify({ tool_name: 'Bash', tool_input: toolInput, cwd: root }), encoding: 'utf8', cwd: root });
        assert.strictEqual(r.status, 2, `${hook} ${JSON.stringify(toolInput)}`);
        assert.ok(r.stderr.includes('not a JSON string'), r.stderr);
      }
      assert.strictEqual(runHook(root, hook, '5').status, 0, hook);
    }
  });

  test('F7 mutant killed: HookGuard::start without the string check lets a numeric command through', () => {
    const root = deploy();
    const mutated = mkTmp('gsd-base-mutant-');
    fs.cpSync(hooksDir(root), mutated, { recursive: true });
    const pm = path.join(mutated, 'lib', 'HookGuard.pm');
    const source = fs.readFileSync(pm, 'utf8');
    const needle = "&& !_is_string($c)) {";
    assert.ok(source.includes(needle));
    fs.writeFileSync(pm, source.replace(needle, () => '&& 0) {'));
    const r = spawnSync('bash', [path.join(mutated, 'check-denied-command.sh')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 5 }, cwd: root }), encoding: 'utf8', cwd: root });
    assert.strictEqual(r.status, 0, 'the mutant allows a numeric command, so the F7 test above fails on it');
  });

  test('F7 the flake hook denies a Write, Edit or MultiEdit whose path or text is not a string, with no config in play', () => {
    const root = deploy();
    const hook = path.join(hooksDir(root), 'check-flake-patterns.sh');
    const cases = [
      ['Write', { file_path: 'README.md', content: 5 }], ['Write', { file_path: 7, content: 'x' }], ['Write', { content: 'x' }],
      ['Edit', { file_path: 'README.md', new_string: null }], ['MultiEdit', { file_path: 'README.md', edits: [{ new_string: 3 }] }],
      ['MultiEdit', { file_path: 'README.md', edits: 'x' }], ['MultiEdit', { file_path: 'README.md', edits: [1] }],
    ];
    for (const [tool, toolInput] of cases) {
      const r = spawnSync('bash', [hook], { input: JSON.stringify({ tool_name: tool, tool_input: toolInput, cwd: root }), encoding: 'utf8', cwd: root });
      assert.strictEqual(r.status, 2, `${tool} ${JSON.stringify(toolInput)}`);
      assert.ok(r.stderr.includes('fail closed'), r.stderr);
    }
    const ok = spawnSync('bash', [hook], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'README.md', content: 'x' }, cwd: root }), encoding: 'utf8', cwd: root });
    assert.strictEqual(ok.status, 0, ok.stderr);
  });

  test('L8a a command of exactly 32768 bytes is judged; one byte more is denied naming the limit, in every Bash hook', () => {
    const root = deploy();
    const at = `echo ${'a'.repeat(32768 - 5)}`;
    for (const h of BASH_HOOKS) {
      assert.strictEqual(runHook(root, h, at).status, 0, `${h} at the limit`);
      const over = runHook(root, h, `${at}a`);
      assert.strictEqual(over.status, 2, `${h} over the limit`);
      assert.match(over.stderr, /over the 32768-byte limit/, h);
    }
  });

  test('L8b a hook that outlives 10 s is cut by the wrapper alarm and denied naming the limit', () => {
    const root = deploy();
    const dir = mkTmp('gsd-base-slow-');
    fs.cpSync(hooksDir(root), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lib', 'slow.pl'), 'sleep 14; exit 0;\n');
    fs.writeFileSync(path.join(dir, 'slow.sh'), '#!/bin/bash\nPATH="$PATH:/usr/bin:/bin"\n. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" slow\n', { mode: 0o755 });
    const t0 = Date.now();
    const r = spawnSync('bash', [path.join(dir, 'slow.sh')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root }), encoding: 'utf8' });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /ran past 10 s/);
    assert.ok(Date.now() - t0 < 13000, 'cut at the alarm, not at the end of the script');
  });

  test('L8c every registered hook carries a numeric timeout above the 10 s wrapper alarm', () => {
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    const hooks = frag.hooks.PreToolUse.flatMap((g) => g.hooks);
    assert.strictEqual(hooks.length, 6);
    for (const h of hooks) assert.ok(typeof h.timeout === 'number' && h.timeout > 10, h.command);
  });

  test('M5 GIT_DIR in the hook environment cannot hide the repository: a locked suite is still denied', () => {
    const root = deploy({ project: { slug: 'demo' }, stack: { capabilities: {}, locked_commands: ['test:e2e'] } });
    const env = { ...process.env, GIT_DIR: path.join(root, 'no-such-git-dir'), GIT_WORK_TREE: '/nonexistent' };
    const r = runHook(root, 'check-test-command.sh', 'npm run test:e2e', env);
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /stack\.locked_commands/);
  });

  test('M5 check-test-command: a cwd that does not exist is denied; an existing directory outside any work tree is allowed', () => {
    const root = deploy({ project: { slug: 'demo' }, stack: { capabilities: {}, locked_commands: ['test:e2e'] } });
    const run = (cwd) => spawnSync('bash', [path.join(hooksDir(root), 'check-test-command.sh')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd }), encoding: 'utf8', cwd: root,
    });
    const gone = run(path.join(root, 'no-such-dir'));
    assert.strictEqual(gone.status, 2, gone.stdout + gone.stderr);
    assert.match(gone.stderr, /does not exist/);
    assert.strictEqual(run(mkTmp('gsd-base-nogit-')).status, 0, 'a real directory outside any work tree stays allowed');
  });

  describe('M5 check-flake-patterns', () => {
    const cfg = { project: { slug: 'demo' }, stack: { capabilities: {}, flake_patterns: { test_globs: ['**/*.int.test.ts'], patterns: [{ id: 'hour', match: 'end_hour\\s*:\\s*\\d+', message: 'absolute hour' }] } } };
    const run = (root, input, extra = {}) => spawnSync('bash', [path.join(hooksDir(root), 'check-flake-patterns.sh')], {
      input: JSON.stringify(input), encoding: 'utf8', cwd: root, env: { ...process.env, ...extra },
    });
    const BAD = 'const w = { end_hour: 23 };\n';

    test('a cwd that does not exist is denied', () => {
      const root = deploy(cfg);
      const r = run(root, { tool_name: 'Write', tool_input: { file_path: 'a.int.test.ts', content: BAD }, cwd: path.join(root, 'no-such-dir') });
      assert.strictEqual(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /does not exist/);
    });

    test('GIT_DIR in the environment cannot hide the repository', () => {
      const root = deploy(cfg);
      const r = run(root, { tool_name: 'Write', tool_input: { file_path: 'a.int.test.ts', content: BAD }, cwd: root }, { GIT_DIR: path.join(root, 'nope'), GIT_WORK_TREE: '/nonexistent' });
      assert.strictEqual(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /hour/);
    });

    test('an absolute path into a configured repository is judged by that repository even from a cwd outside it', () => {
      const root = deploy(cfg);
      const elsewhere = mkTmp('gsd-base-nogit-');
      const r = run(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.int.test.ts'), content: BAD }, cwd: elsewhere });
      assert.strictEqual(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /hour/);
    });

    test('a file outside any work tree is allowed with a note', () => {
      const root = deploy(cfg);
      const outside = mkTmp('gsd-base-nogit-');
      const r = run(root, { tool_name: 'Write', tool_input: { file_path: path.join(outside, 'a.int.test.ts'), content: BAD }, cwd: root });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stderr, /outside any git work tree/);
    });
  });
});

describe('base preset: shared-stack rule (agnostic-M-08 8.1)', () => {
  test('8.1 shared-stack.md names the .sh wrapper and states that a direct stack-lock.mjs call is not recognised', () => {
    const text = fs.readFileSync(path.join(BASE, 'rules', 'shared-stack.md'), 'utf8');
    assert.ok(text.includes('scripts/stack-lock.sh'), 'wrapper named');
    assert.match(text, /direct call[^\n]*stack-lock\.mjs[^\n]*not recognised/);
    assert.ok(!text.includes('{{'), 'no placeholder: the rule names profile keys in prose');
  });
});

describe('base preset: pre-PR, guard and module rules (agnostic-M-08 8.6)', () => {
  test('8.6 pre-pr-gates.md renders the gate path and holds the test cost rule heading; no placeholder survives', () => {
    const source = fs.readFileSync(path.join(BASE, 'rules', 'pre-pr-gates.md'), 'utf8');
    assert.ok(source.includes('{{stack.commands.pre_pr_gate}}'), 'source keeps the placeholder');
    const rendered = R.renderText(source, { project: { owner_title: 'owner' }, stack: { branch: { default: 'main' }, commands: { search: 'git grep -n', pre_pr_gate: 'scripts/pre-pr-gate.sh' } } });
    assert.deepStrictEqual(rendered.missing, []);
    assert.ok(!rendered.text.includes('{{'));
    assert.ok(rendered.text.includes('scripts/pre-pr-gate.sh'), 'gate path rendered');
    assert.match(rendered.text, /^### Test cost: where the gate runs/m);
  });
});

describe('base preset: engineering lessons (agnostic-M-08 8.3)', () => {
  test('8.3 engineering-lessons.md has 6 incident pointers and 2 rescued entries', () => {
    const lessons = fs.readFileSync(path.join(BASE, 'docs', 'engineering-lessons.md'), 'utf8');
    assert.strictEqual((lessons.match(/\[incident: <project incident id>\]/g) || []).length, 6, 'incident pointers');
    assert.strictEqual((lessons.match(/\[rescued: [^\]]+\]/g) || []).length, 2, 'rescued entries');
  });
});

describe('base preset: agent-ops lessons (agnostic-M-08 8.2)', () => {
  test('8.2 the lessons file has one incident pointer per entry (23) and one per finding group (6)', () => {
    const text = fs.readFileSync(path.join(BASE, 'docs', 'agent-ops-lessons.md'), 'utf8');
    const memory = text.match(/\[incident: <project incident id>\]/g) || [];
    const findings = text.match(/\[finding: [^\]]+\]/g) || [];
    assert.strictEqual(memory.length, 23, 'memory entries');
    assert.ok(!text.includes('[memory:'), 'no private memory tag');
    assert.strictEqual(findings.length, 6, 'finding entries: review mining, F1-F4, A/B verdicts');
    assert.ok(!text.includes('{{'), 'no placeholder');
  });
});

describe('base preset: code style rule (agnostic-M-09 9.1)', () => {
  test('9.1 code-style.md has the nine headings and eight checklist items, and names no library or language', () => {
    const text = fs.readFileSync(path.join(BASE, 'rules', 'code-style.md'), 'utf8');
    const HEADINGS = [
      '## 1. Errors are values', '## 2. Immutability', '## 3. Routing and dispatch', '## 4. Pure logic, effects at the edges',
      '## 5. Small single-purpose modules', '## 6. DRY', '## 7. Idioms for this stack', '## 8. Review checklist', '## 9. Enforcement',
    ];
    assert.deepStrictEqual(text.split('\n').filter((l) => l.startsWith('## ')), HEADINGS);
    const checklist = text.split('## 8. Review checklist')[1].split('## 9. Enforcement')[0];
    assert.strictEqual(checklist.split('\n').filter((l) => /^\d+\. /.test(l)).length, 8);
    for (const w of ['neverthrow', 'ts-pattern', 'TypeScript', 'Python']) assert.ok(!text.includes(w), w);
    assert.ok(text.includes('scripts/style-gate.mjs') && text.includes('style-gate:edge <reason>'));
  });
});

describe('base preset: pilot, three throwaway projects (agnostic-M-07 7.2)', () => {
  const REPO = path.join(__dirname, '..', '..');
  const slowTest = (name, fn) => test(name, { timeout: 600000 }, fn);
  const OWN = [];
  const own = (prefix) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    OWN.push(d);
    return d;
  };
  const gateIds = (assertionQuality) => ['hook-canaries', 'hook-patch-trailer', 'guard-canaries', 'guard-registry', 'style', 'flake-patterns', 'dependency-scan', 'adr', ...(assertionQuality ? ['assertion-quality'] : [])];
  // Deployed files for every project, from the summaries of M-03, M-08 and M-09 (the plan's literal list differs, see M-07-SUMMARY).
  const ALWAYS = [
    '.claude/hooks/block-push-without-local-tests.sh', '.claude/hooks/check-denied-command.sh', '.claude/hooks/check-flake-patterns.sh',
    '.claude/hooks/check-git-merge-target.sh', '.claude/hooks/check-test-command.sh', '.claude/hooks/lib/HookGuard.pm',
    '.claude/hooks/lib/ShellParse.pm', '.claude/hooks/lib/block-push-without-local-tests.pl', '.claude/hooks/lib/check-denied-command.pl',
    '.claude/hooks/lib/check-git-merge-target.pl', '.claude/hooks/lib/check-test-command.pl', '.claude/hooks/lib/flake-gate.mjs',
    '.claude/hooks/lib/redirect-recursive-search.pl', '.claude/hooks/lib/run-perl.sh', '.claude/hooks/redirect-recursive-search.sh',
    '.claude/rules/code-style.md', '.claude/rules/guard-authoring.md', '.claude/rules/module-structure.md', '.claude/rules/pre-pr-gates.md',
    '.claude/rules/shared-stack.md', '.claude/rules/testing.md', '.claude/settings.json',
    '.claude/skills/create-documentation/SKILL.md', '.claude/skills/create-documentation/templates/api.md', '.claude/skills/create-documentation/templates/guide.md',
    '.claude/skills/create-unit-test/SKILL.md', '.claude/skills/create-unit-test/test-outline.md',
    '.claude/skills/finishing-a-development-branch/SKILL.md', '.claude/skills/test-enforcement/SKILL.md',
    '.gitignore', '.planning/cleanup-keep.txt', '.planning/gsd-project-manifest.json', 'CLAUDE.md',
    'docs/gsd/agent-ops-lessons.md', 'docs/gsd/engineering-lessons.md', 'docs/gsd/file-claims-template.md',
    'docs/gsd/guard-estate.md', 'docs/gsd/host-ops.md', 'docs/gsd/mutation-testing.md', 'docs/gsd/session-supervisor.md',
    'scripts/ci-diagnose.mjs', 'scripts/container-disk-guard.sh', 'scripts/dependency-scan-gate.mjs', 'scripts/findings-register.mjs',
    'scripts/hooks-apply.sh', 'scripts/lib/findings-register/owner.mjs', 'scripts/lib/findings-register/parse.mjs',
    'scripts/lib/findings-register/telemetry.mjs', 'scripts/lib/reap-stale-test-processes.sh', 'scripts/log-pre-pr-disagreement.sh',
    'scripts/memory-guard.sh', 'scripts/mutate/classify.mjs', 'scripts/mutate/guards.mjs', 'scripts/mutate/mutate.mjs',
    'scripts/mutate/options.mjs', 'scripts/mutate/process.mjs', 'scripts/mutate/restore.mjs', 'scripts/mutate/worktree.mjs',
    'scripts/pre-pr-gate.sh', 'scripts/reap-stale.sh', 'scripts/session-supervisor.sh', 'scripts/stack-lock.mjs', 'scripts/stack-lock.sh',
    'scripts/style-gate.mjs', 'scripts/style-gate/dup.mjs', 'scripts/style-gate/input-mutation.mjs',
    'scripts/style-gate/rule-sets/generic.json', 'scripts/style-gate/rule-sets/js-ts.json', 'scripts/style-gate/rule-sets/python.json',
    'scripts/style-gate/scan.mjs', 'scripts/validation/adr-reconcile.mjs', 'scripts/validation/canaries/sample-guard.canaries.mjs',
    'scripts/validation/canaries/style-gate.canaries.mjs', 'scripts/validation/canary-gate.mjs', 'scripts/validation/freshness-tracker.mjs',
    'scripts/validation/guard-registry-reconcile.mjs', 'scripts/validation/guard-registry.mjs', 'scripts/validation/guards/sample-guard.mjs',
    'scripts/validation/hook-canaries/canaries.jsonl', 'scripts/validation/hook-canaries/run-canaries.sh', 'scripts/validation/hook-patch-trailer-check.sh',
  ];
  const BACKEND = ['.claude/rules/data-integrity.md', '.claude/rules/handler-correctness.md', '.claude/skills/vibe-security/SKILL.md'];
  const WEB_UI = ['.claude/rules/e2e-assertions.md', '.claude/rules/frontend-testability.md', '.claude/rules/qa-exemptions.md', 'scripts/validation/check-assertion-quality.mjs'];
  const MIRROR = '.planning/.gsd-preset-base/';
  const SETTINGS_REL = ['.claude', 'settings.json'].join('/');
  const templateBody = (name) => fs.readFileSync(path.join(REPO, 'get-shit-done', 'templates', name), 'utf8').match(/```markdown\n([\s\S]*?)\n```/)[1] + '\n';
  const write = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const sh = (root, cmd, args = [], opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 240000, ...opts });
  const git = (root, ...a) => sh(root, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a]);
  const commitAll = (root, msg) => {
    assert.strictEqual(git(root, 'add', '-A').status, 0);
    assert.strictEqual(git(root, 'commit', '-q', '-m', msg).status, 0);
  };
  const styleGate = (root) => sh(root, process.execPath, ['scripts/style-gate.mjs']);
  const treeOf = (root) => {
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '.git') walk(abs); } else if (e.isFile()) out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    };
    walk(root);
    return out.sort();
  };
  const cfg = (slug, capabilities, stack = {}) => ({
    project: { slug, owner_title: 'Founder', risk_domains: ['billing'], ruling_topics: [] },
    stack: { preset: 'base', commands: { test_file: 'node --test {file}', test_all: 'true', typecheck: 'true', lint: 'true' }, capabilities, ...stack },
  });
  const PROJECTS = {
    a: cfg('pilot-a', {}, { style: { rule_set: 'js-ts', roots: ['src'] }, deploy: { never_touch: ['tools/release.sh prod'] } }),
    b: cfg('pilot-b', { backend: {}, web_ui: false }),
    c: cfg('pilot-c', { backend: false, web_ui: false }),
  };
  const env = (home) => {
    const e = { ...process.env, GSD_HOME: home };
    delete e.GSD_LEGACY;
    return e;
  };
  const state = { roots: {}, runs: {}, outputs: [], wallMs: 0, home: null };

  before(() => {
    state.home = own('gsd-pilot-home-');
    const start = Date.now();
    for (const [key, config] of Object.entries(PROJECTS)) {
      const root = own(`gsd-pilot-${key}-`);
      assert.strictEqual(spawnSync('git', ['init', '-q', root]).status, 0);
      write(root, '.planning/config.json', JSON.stringify(config, null, 2));
      write(root, '.planning/PRODUCT-BRIEF.md', templateBody('product-brief.md'));
      write(root, '.planning/STACK-PROFILE.md', templateBody('stack-profile.md'));
      write(root, '.planning/ROADMAP.md', '# Roadmap\n\n## Phase 1: Pilot\n\nGoal: pilot.\n');
      state.roots[key] = root;
      const run = (args) => {
        const r = spawnSync(process.execPath, [GSD_TOOLS, ...args], { cwd: root, encoding: 'utf8', env: env(state.home) });
        state.outputs.push(`${r.stdout}\n${r.stderr}`);
        return r;
      };
      state.runs[key] = {
        init: run(['project', 'init', '--root', root, '--preset', 'base']),
        profile: run(['profile', 'check']),
        diff: run(['project', 'diff', '--root', root, '--preset', 'base']),
        newProject: run(['init', 'new-project']),
        plan: run(['init', 'plan-phase', '1']),
        exec: run(['init', 'execute-phase', '1']),
      };
    }
    state.wallMs = Date.now() - start;
  });
  after(() => {
    while (OWN.length > 0) fs.rmSync(OWN.pop(), { recursive: true, force: true });
  });
  const expectedFor = (key) => [...ALWAYS, ...(key === 'c' ? [] : BACKEND), ...(key === 'a' ? WEB_UI : [])].sort();
  const json = (r) => JSON.parse(r.stdout);

  slowTest('P-a all commands of step 2 exit 0 in the three projects, in under 60 s in total', (t) => {
    for (const [key, runs] of Object.entries(state.runs)) {
      for (const [name, r] of Object.entries(runs)) assert.strictEqual(r.status, 0, `${key} ${name}: ${r.stdout}${r.stderr}`);
    }
    t.diagnostic(`step 2 wall time ${state.wallMs} ms for 18 commands in 3 projects`);
    assert.ok(state.wallMs < 60000, `${state.wallMs} ms`);
  });

  slowTest('P-b the init report and the disk hold exactly the expected files per project; gated groups only where on', () => {
    for (const key of ['a', 'b', 'c']) {
      const root = state.roots[key];
      const onDisk = treeOf(root).filter((f) => !f.startsWith(MIRROR) && !['.planning/config.json', '.planning/PRODUCT-BRIEF.md', '.planning/STACK-PROFILE.md', '.planning/ROADMAP.md'].includes(f));
      assert.deepStrictEqual(onDisk, expectedFor(key), `disk ${key}`);
      const reported = json(state.runs[key].init).files.map((f) => f.path).filter((p) => !p.startsWith(MIRROR)).sort();
      const missing = expectedFor(key).filter((p) => !reported.includes(p) && !['.gitignore', '.planning/gsd-project-manifest.json', SETTINGS_REL].includes(p));
      assert.deepStrictEqual(missing, [], `report ${key}`);
      assert.deepStrictEqual(reported.filter((p) => !expectedFor(key).includes(p)), [], `report extra ${key}`);
      for (const [group, files, on] of [['backend', BACKEND, key !== 'c'], ['web_ui', WEB_UI, key === 'a']]) {
        for (const f of files) assert.strictEqual(fs.existsSync(path.join(root, f)), on, `${key} ${group} ${f}`);
      }
    }
  });

  slowTest('P-c the rendered CLAUDE.md of pilot-a holds the methodology headings and the code-style rule its 8-item checklist', () => {
    const text = fs.readFileSync(path.join(state.roots.a, 'CLAUDE.md'), 'utf8');
    for (const h of CLAUDE_HEADINGS) assert.ok(text.includes(h), h);
    for (const w of ['| Tier', '**Review loop:**', 'Haiku']) assert.ok(text.includes(w), w);
    const style = fs.readFileSync(path.join(state.roots.a, '.claude/rules/code-style.md'), 'utf8');
    const checklist = style.split('## 8. Review checklist')[1].split('## 9. Enforcement')[0];
    assert.strictEqual(checklist.split('\n').filter((l) => /^\d+\. /.test(l)).length, 8);
  });

  slowTest('P-d default gates: nine in pilot-a, eight in pilot-b and pilot-c, style rule set written by the wiring', () => {
    assert.deepStrictEqual(configOf(state.roots.a).stack.gates.map((g) => g.id), gateIds(true));
    for (const key of ['b', 'c']) {
      const stack = configOf(state.roots[key]).stack;
      assert.deepStrictEqual(stack.gates.map((g) => g.id), gateIds(false), key);
      assert.deepStrictEqual(stack.style, { rule_set: 'generic', roots: ['.'] }, key);
    }
    assert.deepStrictEqual(configOf(state.roots.a).stack.style, { rule_set: 'js-ts', roots: ['src'] });
  });

  slowTest('P-e deny rows, ask rows and hooks: the never-touch row in pilot-a, inert slots in pilot-b, five Bash hooks and one Write|Edit hook everywhere', () => {
    const ask = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8')).permissions.ask;
    assert.strictEqual(FIXED_DENY.length, 42);
    assert.strictEqual(ask.length, 7);
    assert.deepStrictEqual(readSettings(state.roots.a).deny, [...FIXED_DENY, 'Bash(tools/release.sh prod:*)', ...INERT_SLOT_ROWS.slice(1)]);
    for (const key of ['b', 'c']) assert.deepStrictEqual(readSettings(state.roots[key]).deny, [...FIXED_DENY, ...INERT_SLOT_ROWS], key);
    for (const key of ['a', 'b', 'c']) {
      const settings = JSON.parse(fs.readFileSync(path.join(state.roots[key], '.claude', 'settings.json'), 'utf8'));
      assert.deepStrictEqual(settings.permissions.ask, ask, key);
      assert.deepStrictEqual(settings.hooks.PreToolUse.map((g) => [g.matcher, g.hooks.length]), [['Bash', 5], ['Write|Edit|MultiEdit', 1]], key);
    }
  });

  slowTest('P-f three different port_base values, container_suffix equal to the slug, the four engine .gitignore lines', () => {
    const ports = ['a', 'b', 'c'].map((k) => configOf(state.roots[k]).stack.isolation.port_base);
    assert.strictEqual(new Set(ports).size, 3, ports.join(','));
    for (const k of ['a', 'b', 'c']) {
      assert.strictEqual(configOf(state.roots[k]).stack.isolation.container_suffix, PROJECTS[k].project.slug);
      const ignore = fs.readFileSync(path.join(state.roots[k], '.gitignore'), 'utf8').split('\n');
      for (const line of ['.claude/settings.local.json', '.mcp.json', '.env*', '!.env.example']) assert.ok(ignore.includes(line), `${k} ${line}`);
    }
  });

  slowTest('P-g project diff reports nothing left to deploy in all three; init plan-phase 1 names the brief risk domains', () => {
    for (const k of ['a', 'b', 'c']) {
      const d = json(state.runs[k].diff);
      assert.ok(d.files.every((f) => f.action === 'unchanged'), `${k}: ${JSON.stringify(d.files.filter((f) => f.action !== 'unchanged'))}`);
      const plan = json(state.runs[k].plan);
      assert.deepStrictEqual(plan.risk_domains, ['auth', 'security', 'billing'], k);
      assert.strictEqual(plan.risk_domains_source, 'config', k);
    }
  });

  slowTest('P-h a fourth repo holding a different testing.md gets exit 2, a conflict row for it, and its bytes unchanged', () => {
    const root = own('gsd-pilot-d-');
    assert.strictEqual(spawnSync('git', ['init', '-q', root]).status, 0);
    write(root, '.planning/config.json', JSON.stringify(cfg('pilot-d', {}), null, 2));
    write(root, '.claude/rules/testing.md', 'my own testing rule\n');
    const r = spawnSync(process.execPath, [GSD_TOOLS, 'project', 'init', '--root', root, '--preset', 'base'], { encoding: 'utf8', env: env(state.home) });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    const rows = json(r).files.filter((f) => f.action === 'conflict');
    assert.deepStrictEqual(rows.map((f) => f.path), ['.claude/rules/testing.md']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/testing.md'), 'utf8'), 'my own testing rule\n');
  });

  const CLEAN_MODULE = 'export const add = (a, b) => a + b;\n';
  const BLOCK = Array.from({ length: 15 }, (_, i) => `  const step${i} = compute${i}(input.value${i}, input.other${i});`).join('\n');
  const BLOCK_FILE = `export function compute(input) {\n${BLOCK}\n  return [step0, step1];\n}\n`;

  slowTest('P-i style gate in pilot-a: green on the clean tree, red and named on each planted throw, input mutation and duplicate block, green again after each removal', () => {
    const root = state.roots.a;
    write(root, 'src/ok.js', CLEAN_MODULE);
    write(root, 'src/block.js', BLOCK_FILE);
    commitAll(root, 'deployed tree and clean module');
    const green = styleGate(root);
    assert.strictEqual(green.status, 0, green.stdout + green.stderr);
    const plants = [
      ['src/bad-throw.js', "export function f(x) {\n  if (!x) throw new Error('no');\n  return x;\n}\n", 'throws'],
      ['src/bad-mutation.js', 'export function g(items) {\n  items.push(1);\n  return items;\n}\n', 'inputMutation'],
      ['src/block-copy.js', BLOCK_FILE.replace('compute', 'computeCopy'), 'duplicateBlocks'],
    ];
    for (const [rel, text, name] of plants) {
      write(root, rel, text);
      const red = styleGate(root);
      assert.strictEqual(red.status, 1, `${name}: ${red.stdout}${red.stderr}`);
      assert.ok((red.stdout + red.stderr).includes(name), `${name} named: ${red.stdout}${red.stderr}`);
      fs.rmSync(path.join(root, rel));
      const back = styleGate(root);
      assert.strictEqual(back.status, 0, `after removing ${rel}: ${back.stdout}${back.stderr}`);
    }
  });

  slowTest('P-j default style config with no project source: exit 0 in pilot-b and pilot-c; pilot-c fails on a copied block and on a 501-line file', () => {
    for (const k of ['b', 'c']) {
      commitAll(state.roots[k], 'deployed tree');
      const r = styleGate(state.roots[k]);
      assert.strictEqual(r.status, 0, `${k}: ${r.stdout}${r.stderr}`);
    }
    const root = state.roots.c;
    write(root, 'src/block.js', BLOCK_FILE);
    write(root, 'src/block-copy.js', BLOCK_FILE.replace('compute', 'computeCopy'));
    const dup = styleGate(root);
    assert.strictEqual(dup.status, 1, dup.stdout + dup.stderr);
    assert.ok((dup.stdout + dup.stderr).includes('duplicateBlocks'), dup.stdout + dup.stderr);
    fs.rmSync(path.join(root, 'src'), { recursive: true });
    write(root, 'src/big.js', Array.from({ length: 501 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
    const big = styleGate(root);
    assert.strictEqual(big.status, 1, big.stdout + big.stderr);
    assert.ok((big.stdout + big.stderr).includes('oversizeFiles'), big.stdout + big.stderr);
    fs.rmSync(path.join(root, 'src'), { recursive: true });
    assert.strictEqual(styleGate(root).status, 0);
  });

  slowTest('P-k pilot-a gate and push: pre-PR gate green (the canary runner is its first gate) naming every gate id, marker inside the git dir, tree clean, push allowed; a planted throw turns the gate red with no marker', (t) => {
    const root = state.roots.a;
    const gate = sh(root, 'sh', ['scripts/pre-pr-gate.sh']);
    t.diagnostic(gate.stdout.split('\n').filter((l) => /PASS|FAIL/.test(l)).join(' | '));
    assert.strictEqual(gate.status, 0, gate.stdout + gate.stderr);
    for (const id of gateIds(true)) assert.match(gate.stdout, new RegExp(`PASS  gate ${id} `), id);
    const gitDir = git(root, 'rev-parse', '--absolute-git-dir').stdout.trim();
    assert.ok(fs.existsSync(path.join(gitDir, '.pre-pr-passed')), 'marker in the git dir');
    assert.strictEqual(git(root, 'status', '--porcelain').stdout, '');
    const push = spawnSync('bash', [path.join(root, '.claude/hooks/block-push-without-local-tests.sh')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin feature/x' }, cwd: root }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    assert.strictEqual(push.status, 0, push.stderr);
    write(root, 'src/bad-throw.js', "export function f(x) {\n  if (!x) throw new Error('no');\n  return x;\n}\n");
    // The red run keeps only the style gate: the 83 s canary runner already passed above, and the script runs every gate either way.
    const configPath = path.join(root, '.planning', 'config.json');
    const original = fs.readFileSync(configPath, 'utf8');
    const narrowed = JSON.parse(original);
    narrowed.stack.gates = narrowed.stack.gates.filter((g) => g.id === 'style');
    fs.writeFileSync(configPath, JSON.stringify(narrowed, null, 2));
    const red = sh(root, 'sh', ['scripts/pre-pr-gate.sh']);
    fs.writeFileSync(configPath, original);
    fs.rmSync(path.join(root, 'src/bad-throw.js'));
    assert.notStrictEqual(red.status, 0, red.stdout);
    assert.match(red.stdout, /FAIL  gate style /);
    assert.ok(!fs.existsSync(path.join(gitDir, '.pre-pr-passed')), 'no marker after a red run');
  });

  slowTest('P-l a phase with a touched .tsx file and no QA evidence passes verify phase-gate in pilot-a (capabilities object, no ui_qa); own 25-line fixture, the builder in gsd-tools.test.js is private to its describe', () => {
    const root = state.roots.a;
    const dir = '.planning/phases/45-pilot';
    write(root, `${dir}/45-01-PLAN.md`, '---\nphase: "45"\nplan: "01"\ntype: execute\nfiles_modified: []\n---\n<tasks>\n<task type="auto">\n<name>Task 1</name>\n<action>do stuff</action>\n</task>\n</tasks>\n');
    write(root, `${dir}/Dashboard.tsx`, 'export default function Dashboard() { return null; }\n');
    commitAll(root, 'feat(45-01): fixture commit');
    write(root, `${dir}/E2E-TEST-PLAN.md`, '# E2E Test Plan\n- Dashboard\n');
    write(root, `${dir}/45-VERIFICATION.md`, '---\nphase: "45"\nstatus: passed\n---\n# Verification\n');
    write(root, `${dir}/45-01-SUMMARY.md`, '# Summary\n\nDone.\n\n## Self-Check: PASSED\n');
    const r = spawnSync(process.execPath, [GSD_TOOLS, 'verify', 'phase-gate', '45'], { cwd: root, encoding: 'utf8', env: env(state.home) });
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(parsed.passed, true, r.stdout);
    assert.strictEqual(parsed.ui_qa_required, false);
    assert.strictEqual(parsed.ui_qa_mode, 'none');
  });

  slowTest('P-m dispatch set: no line names the old QA driver, runtime or database outside the allow-list lines and the deployed-exception triples; command outputs have none', (t) => {
    const classes = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'agnostic-lint', 'terms.json'), 'utf8')).classes
      .filter((c) => ['charlotte', 'deno', 'supabase'].includes(c.id)).map((c) => ({ id: c.id, re: new RegExp(c.pattern, c.flags) }));
    assert.strictEqual(classes.length, 3);
    const allow = new Map(JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'agnostic-lint', 'allowlist.json'), 'utf8')).entries.map((e) => [`${e.file}\0${e.class}`, e.max]));
    const walk = (rel) => {
      const abs = path.join(REPO, rel);
      return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : [`${rel}/${e.name}`]));
    };
    const core = [
      ...fs.readdirSync(path.join(REPO, 'agents')).filter((f) => f.endsWith('.md')).map((f) => `agents/${f}`),
      ...['commands', 'get-shit-done/workflows', 'get-shit-done/references', 'get-shit-done/templates'].flatMap(walk),
    ];
    let excepted = 0;
    for (const rel of core) {
      const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
      for (const c of classes) {
        const n = lines.filter((l) => c.re.test(l)).length;
        const cap = allow.get(`${rel}\0${c.id}`) || 0;
        assert.ok(n <= cap, `${rel} ${c.id}: ${n} lines, allow-list permits ${cap}`);
        excepted += n;
      }
    }
    const exc = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'agnostic', 'base-deployed-exceptions.json'), 'utf8'))
      .flatMap((e) => e.lines.map((l) => `${e.file}|${e.class}|${l}`)));
    let deployedExcepted = 0;
    for (const key of ['a', 'b', 'c']) {
      const root = state.roots[key];
      for (const f of treeOf(root).filter((p) => !p.startsWith(MIRROR) && p !== '.planning/config.json')) {
        fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
          for (const c of classes) {
            if (!c.re.test(line)) continue;
            assert.ok(exc.has(`${f}|${c.id}|${i + 1}`), `${key} ${f}:${i + 1} ${c.id}: ${line.slice(0, 120)}`);
            deployedExcepted += 1;
          }
        });
      }
    }
    for (const out of state.outputs) for (const c of classes) assert.ok(!out.split('\n').some((l) => c.re.test(l)), `command output names ${c.id}`);
    t.diagnostic(`excepted lines in the dispatch set: core ${excepted}, deployed ${deployedExcepted}`);
  });

  slowTest('P-n deployed file and line counts per project (diagnostic)', (t) => {
    for (const k of ['a', 'b', 'c']) {
      const root = state.roots[k];
      const files = treeOf(root).filter((p) => !p.startsWith(MIRROR) && !p.startsWith('src/') && !p.startsWith('.planning/phases/'));
      const lines = files.reduce((n, f) => n + fs.readFileSync(path.join(root, f), 'utf8').split('\n').length, 0);
      t.diagnostic(`pilot-${k}: ${files.length} files, ${lines} lines (with config, brief, profile, roadmap)`);
    }
  });
});
