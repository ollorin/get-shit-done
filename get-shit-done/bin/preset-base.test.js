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
      ['docs/gsd/defect-classes.md', 'whole', false],
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

describe('base preset: canary runner (agnostic-M-03 3.4)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const RUNNER_SRC = path.join(BASE, 'canaries', 'run-canaries.sh');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const PROJECT_TERM = /deno|supabase|apps\/api|preflight|igaming|CEO|\/Users\//i;
  // The runner needs only jq and perl. A missing tool fails the test by name; it never skips.
  for (const tool of ['jq', 'perl']) {
    test(`3.4 tool present: ${tool}`, () => {
      const r = spawnSync(tool, [tool === 'jq' ? '--version' : '-v'], { encoding: 'utf8' });
      assert.ok(!r.error && r.status === 0, `missing tool: ${tool}`);
    });
  }
  const runnerOf = (root) => path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
  const runRunner = (root, extra = {}) => {
    const env = { ...process.env };
    delete env.CORPUS;
    delete env.HOOKS_DIR;
    Object.assign(env, extra);
    return spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env });
  };

  test('3.4 after init with the defaults the runner exits 0 over the redirect rows', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const r = runRunner(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('canaries: pass=892 fail=0'), r.stdout);
  });

  test('3.4 with stack.commands.search "rg -n" the runner still exits 0 (rows follow the config)', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {}, commands: { search: 'rg -n' } } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const r = runRunner(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  });

  test('3.4 a flipped row fails the runner and the runner names it', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const first = JSON.parse(rows[0]);
    assert.strictEqual(first.expect, 'deny');
    const flipped = [{ ...first, expect: 'allow' }, ...rows.slice(1).map((l) => JSON.parse(l))];
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${flipped.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const r = runRunner(root, { CORPUS: corpus });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes(`FAIL [redirect-recursive-search.sh] expect=allow got=deny :: ${first.label}`), r.stdout);
  });

  describe('review round 1 batch 2 F1: the runner fails closed', () => {
    const deployedRunner = () => {
      const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
      assert.strictEqual(runInit(root, home()).status, 0);
      return root;
    };
    const run = (root, extra) => {
      const env = { ...process.env, ...extra };
      if (!extra.CORPUS) delete env.CORPUS;
      delete env.HOOKS_DIR;
      return spawnSync('/bin/bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env });
    };
    const corpusOf = (text) => {
      const f = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(f, text);
      return f;
    };
    const goodRows = () => fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const assertRefused = (r, needle) => {
      assert.strictEqual(r.status, 1, r.stdout + r.stderr);
      assert.ok((r.stdout + r.stderr).includes(needle), `${needle}\n${r.stdout}${r.stderr}`);
      assert.ok(!r.stdout.includes('canaries: pass='), 'no pass line is printed on a refusal');
    };

    test('F1 without jq the runner exits 1 naming jq and prints no pass line', () => {
      const root = deployedRunner();
      const bin = mkTmp('gsd-base-nojq-');
      for (const tool of ['perl', 'git']) fs.symlinkSync(spawnSync('/usr/bin/env', ['which', tool], { encoding: 'utf8' }).stdout.trim(), path.join(bin, tool));
      assertRefused(run(root, { PATH: bin }), "required tool 'jq'");
    });
    test('F1 a missing corpus, an empty corpus and a blank-only corpus exit 1', () => {
      const root = deployedRunner();
      assertRefused(run(root, { CORPUS: path.join(mkTmp('gsd-base-corpus-'), 'absent.jsonl') }), 'missing or unreadable');
      assertRefused(run(root, { CORPUS: corpusOf('') }), 'holds no rows');
      assertRefused(run(root, { CORPUS: corpusOf('\n\n') }), 'holds no rows');
    });
    test('F1 a garbage row, a truncated row and a row of the wrong shape each fail the run naming their line', () => {
      const root = deployedRunner();
      const rows = goodRows();
      const withRow = (at, bad) => corpusOf(`${[...rows.slice(0, at), bad, ...rows.slice(at)].join('\n')}\n`);
      assertRefused(run(root, { CORPUS: withRow(2, 'this is not json') }), 'corpus line 3 does not parse');
      assertRefused(run(root, { CORPUS: corpusOf(`${rows.slice(0, 3).join('\n')}\n${rows[3].slice(0, 40)}`) }), 'corpus line 4 does not parse');
      assertRefused(run(root, { CORPUS: withRow(0, '{"hook":"x.sh","expect":"maybe","tool":"Bash","input":{},"label":"l"}') }), 'corpus line 1 does not parse');
      assertRefused(run(root, { CORPUS: withRow(0, '[1,2]') }), 'corpus line 1 does not parse');
      assertRefused(run(root, { CORPUS: withRow(0, '   ') }), 'corpus line 1 does not parse');
    });
    test('F1 a final row without a trailing newline is still run; the pass count equals the row count', () => {
      const root = deployedRunner();
      const r = run(root, { CORPUS: corpusOf(goodRows().slice(0, 5).join('\n')) });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('canaries: pass=5 fail=0'), r.stdout);
    });
    test('F1 hooks-apply does not trust an exit 0 from a runner that prints no count line', () => {
      const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
      assert.strictEqual(runInit(root, home()).status, 0);
      const runner = runnerOf(root);
      fs.writeFileSync(runner, '#!/bin/bash\nexit 0\n');
      const apply = path.join(root, 'scripts', 'hooks-apply.sh');
      const hook = path.join(root, '.claude', 'hooks', 'redirect-recursive-search.sh');
      spawnSync('git', ['-C', root, 'add', '-A']);
      spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'deploy']);
      const original = fs.readFileSync(hook, 'utf8');
      fs.writeFileSync(hook, `${original}# c\n`);
      const diff = spawnSync('git', ['-C', root, 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], { encoding: 'utf8' }).stdout;
      fs.writeFileSync(hook, original);
      const dir = path.join(root, '.planning', 'hook-patches');
      fs.mkdirSync(dir, { recursive: true });
      const hookRel = path.join('.claude', 'hooks', 'redirect-recursive-search.sh');
      const only = diff.split('diff --git').filter((x) => x.includes(hookRel)).map((x) => `diff --git${x}`).join('');
      fs.writeFileSync(path.join(dir, 'stub.patch'), only);
      fs.writeFileSync(path.join(dir, 'stub.review.md'), `patch-sha256: ${crypto.createHash('sha256').update(only).digest('hex')}\nsonnet-zero-findings: yes\nopus-review: not-needed\n`);
      const r = spawnSync('bash', [apply, 'stub', '--dry-run'], { cwd: root, encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stderr.includes('without a'), r.stderr);
    });
    test('F1 mutant killed: the ran-versus-rows check and the shape check are what refuse', () => {
      const src = fs.readFileSync(RUNNER_SRC, 'utf8');
      assert.ok(src.includes('[ "$ran" != "$TOTAL" ]'));
      assert.ok(src.includes('jq -e "$ROW_SHAPE"'));
    });
  });

  test('3.4 the preset corpus holds 84 redirect rows, none carries a project term, and no row is dropped', () => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    const count = (hook) => rows.filter((r) => r.hook === hook).length;
    assert.strictEqual(count('redirect-recursive-search.sh'), 130);
    assert.strictEqual(rows.length, 892, 'per-hook counts are asserted by the hook sections; this is the whole corpus');
    for (const r of rows) assert.doesNotMatch(JSON.stringify(r), PROJECT_TERM, r.label);
  });

  test('3.4 the runner source has no macOS-only date call, no $HOME, and none of Deno, charlotte, drift, igaming, supabase', () => {
    const src = fs.readFileSync(RUNNER_SRC, 'utf8');
    assert.doesNotMatch(src, /date -v/);
    assert.doesNotMatch(src, /\$HOME/);
    assert.doesNotMatch(src, /Deno|charlotte|drift|igaming|supabase/i);
  });
});

describe('base preset: merge-target and push-gate hooks (agnostic-M-03 3.5)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const hookPath = (root, name) => path.join(root, '.claude', 'hooks', name);
  const runHook = (root, name, command) => spawnSync('bash', [hookPath(root, name)], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  const RELEASE = { project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {}, branch: { default: 'release/1.x' }, commands: { pre_pr_gate: 'tools/gate.sh' } } };

  test('3.5 with branch release/1.x, owner Founder, gate tools/gate.sh rendered: the runner exits 0 and the merge hook asks only for the literal branch', () => {
    const root = gitRepo(RELEASE);
    assert.strictEqual(runInit(root, home()).status, 0);
    const run = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(run.status, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('canaries: pass=892 fail=0'), run.stdout);
    const asked = runHook(root, 'check-git-merge-target.sh', 'git push origin release/1.x');
    assert.strictEqual(asked.status, 0, asked.stderr);
    assert.match(asked.stdout, /"permissionDecision":"ask"/);
    assert.ok(asked.stdout.includes('Founder approval required'), asked.stdout);
    for (const ref of ['release/1ax', 'feature/x']) {
      const r = runHook(root, 'check-git-merge-target.sh', `git push origin ${ref}`);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /permissionDecision/, `${ref} must not ask (the dot is literal)`);
    }
  });

  test('3.5 review round 1: fetch refspecs and update-ref into a branch named release/1.x ask; the dot is literal and the slash does not break the hook', () => {
    const root = gitRepo(RELEASE);
    assert.strictEqual(runInit(root, home()).status, 0);
    for (const c of ['git fetch origin x:release/1.x', 'git fetch origin +x:refs/heads/release/1.x', 'git update-ref refs/heads/release/1.x HEAD']) {
      const r = runHook(root, 'check-git-merge-target.sh', c);
      assert.strictEqual(r.status, 0, `${c}: ${r.stderr}`);
      assert.match(r.stdout, /"permissionDecision":"ask"/, c);
    }
    for (const c of ['git fetch origin x:release/1ax', 'git update-ref refs/heads/release/1ax HEAD']) {
      const r = runHook(root, 'check-git-merge-target.sh', c);
      assert.strictEqual(r.status, 0, `${c}: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /permissionDecision/, c);
    }
  });

  test('3.5 the push gate names the rendered gate script and blocks a push with no marker', () => {
    const root = gitRepo(RELEASE);
    assert.strictEqual(runInit(root, home()).status, 0);
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools', 'gate.sh'), '#!/bin/bash\n');
    const r = runHook(root, 'block-push-without-local-tests.sh', 'git push origin feature/x');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('tools/gate.sh'), r.stderr);
  });

  test('3.8 C7 with the default main, a merge while the checkout is on master is asked, not granted', () => {
    const root = gitRepo({ project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    assert.strictEqual(spawnSync('git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/master']).status, 0);
    const r = runHook(root, 'check-git-merge-target.sh', 'git merge feature/x');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /"permissionDecision":"ask"/, r.stdout);
    assert.doesNotMatch(r.stdout, /"permissionDecision":"allow"/, 'a grant on master is the defect');
  });
});

describe('base preset: check-test-command hook, profile-driven (agnostic-M-03 3.9)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const PROJECT_TERM = /deno|supabase|apps\/api|preflight|igaming|CEO|\/Users\//i;
  const LOCKED = ['test:e2e', 'run-all-suites.sh'];
  const deploy = (extraStack = {}) => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {}, ...extraStack } });
    assert.strictEqual(runInit(root, home()).status, 0);
    return root;
  };
  const runCheck = (root, command, { cwd = root, projectDir, raw } = {}) => spawnSync('bash', [path.join(hooksDir(root), 'check-test-command.sh')], {
    input: raw ?? JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir ?? os.tmpdir() },
  });
  const WRAP = 'scripts/stack-lock.sh --label x --';

  test('3.9 a listed command run unwrapped is denied with the wrapped form; the same under the lock or supervisor is allowed; node stack-lock.mjs is not the wrapper', () => {
    const root = deploy({ locked_commands: LOCKED });
    const denied = runCheck(root, 'npm run test:e2e');
    assert.strictEqual(denied.status, 2, denied.stderr);
    assert.ok(denied.stderr.includes('scripts/stack-lock.sh --label <x> -- npm run test:e2e'), denied.stderr);
    assert.strictEqual(runCheck(root, './scripts/run-all-suites.sh').status, 2);
    assert.strictEqual(runCheck(root, `${WRAP} npm run test:e2e`).status, 0);
    assert.strictEqual(runCheck(root, 'bash scripts/session-supervisor.sh -- npm run test:e2e').status, 0);
    const viaNode = runCheck(root, 'node scripts/stack-lock.mjs --label x -- npm run test:e2e');
    assert.strictEqual(viaNode.status, 2, viaNode.stderr);
    assert.strictEqual(runCheck(root, 'npm test').status, 0, 'an unlisted command is allowed');
    assert.strictEqual(runCheck(root, 'npm run test:e2e:ci').status, 0, 'a literal is one token, not a prefix');
  });

  test('3.9 a listed literal that is only data is allowed: assignment value, echo, grep, git commit message', () => {
    const root = deploy({ locked_commands: LOCKED });
    for (const c of ['X=test:e2e other-command', 'echo "test:e2e"', 'grep -n test:e2e package.json', 'git commit -m "test:e2e"', 'cat scripts/run-all-suites.sh']) {
      assert.strictEqual(runCheck(root, c).status, 0, c);
    }
  });

  test('3.9 a multi-token literal matches as an ordered subsequence', () => {
    const root = deploy({ locked_commands: ['make integration'] });
    assert.strictEqual(runCheck(root, 'make integration').status, 2);
    assert.strictEqual(runCheck(root, 'make -j4 integration').status, 2, 'option words between the listed tokens are tolerated (review round 1 L7)');
    assert.strictEqual(runCheck(root, 'make clean integration').status, 2, 'locked literals match as an ordered subsequence (90ad823)');
    assert.strictEqual(runCheck(root, 'make clean').status, 0, 'an unrelated make target stays allowed');
    assert.strictEqual(runCheck(root, 'integration make').status, 0, 'not in order');
    assert.strictEqual(runCheck(root, `${WRAP} make integration`).status, 0);
  });

  test('3.9 no locked_commands, no stack block, an empty list or no git toplevel allows; a present config that is not JSON or has the wrong shape fails closed', () => {
    for (const stack of [{}, { locked_commands: [] }]) {
      assert.strictEqual(runCheck(deploy(stack), 'npm run test:e2e').status, 0, JSON.stringify(stack));
    }
    const noRepo = mkTmp('gsd-base-norepo-');
    assert.strictEqual(runCheck(deploy({ locked_commands: LOCKED }), 'npm run test:e2e', { cwd: noRepo }).status, 0, 'not a git repo: no config');
    const bad = deploy({ locked_commands: LOCKED });
    fs.writeFileSync(path.join(bad, '.planning', 'config.json'), '{not json');
    const r = runCheck(bad, 'echo hi');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('fail closed'), r.stderr);
    for (const shape of [{ stack: { locked_commands: 'x' } }, { stack: { locked_commands: [''] } }, { stack: { locked_commands: [1] } }, { stack: 'x' }]) {
      fs.writeFileSync(path.join(bad, '.planning', 'config.json'), JSON.stringify(shape));
      const s = runCheck(bad, 'echo hi');
      assert.strictEqual(s.status, 2, JSON.stringify(shape));
      assert.ok(s.stderr.includes('fail closed'), s.stderr);
    }
  });

  test('3.9 malformed stdin and a non-object tool_input fail closed', () => {
    const root = deploy({ locked_commands: LOCKED });
    const notJson = runCheck(root, '', { raw: '{not json' });
    assert.strictEqual(notJson.status, 2);
    assert.ok(notJson.stderr.includes('BLOCKED'), notJson.stderr);
    const crash = runCheck(root, '', { raw: JSON.stringify({ tool_name: 'Bash', tool_input: 'npm run test:e2e', cwd: root }) });
    assert.strictEqual(crash.status, 2);
    assert.ok(crash.stderr.includes('crashed'), crash.stderr);
  });

  test('3.9 the config comes from the git toplevel of the tool call cwd, never from CLAUDE_PROJECT_DIR', () => {
    const listed = deploy({ locked_commands: LOCKED });
    const empty = gitRepo({ project: { slug: 'other' }, stack: { capabilities: {} } });
    assert.strictEqual(runCheck(listed, 'npm run test:e2e', { cwd: listed, projectDir: empty }).status, 2, 'cwd repo lists it');
    assert.strictEqual(runCheck(listed, 'npm run test:e2e', { cwd: empty, projectDir: listed }).status, 0, 'cwd repo lists nothing');
    const sub = path.join(listed, 'src');
    fs.mkdirSync(sub);
    assert.strictEqual(runCheck(listed, 'npm run test:e2e', { cwd: sub, projectDir: empty }).status, 2, 'a subdirectory finds the toplevel config');
  });

  test('3.9 the corpus rows are not vacuous: a hook that reads CLAUDE_PROJECT_DIR instead of the cwd toplevel fails the runner', () => {
    const root = deploy();
    const mutated = mkTmp('gsd-base-mutant-');
    fs.cpSync(hooksDir(root), mutated, { recursive: true });
    const pl = path.join(mutated, 'lib', 'check-test-command.pl');
    const source = fs.readFileSync(pl, 'utf8');
    const needle = 'my ($root, $why) = toplevel($cwd);';
    assert.ok(source.includes(needle), 'mutation site present');
    fs.writeFileSync(pl, source.replace(needle, "my ($root, $why) = ($ENV{CLAUDE_PROJECT_DIR} // '', '');"));
    const env = { ...process.env, HOOKS_DIR: mutated };
    delete env.CORPUS;
    const r = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes('FAIL [check-test-command.sh] expect=deny got=allow'), r.stdout);
  });

  const writeFlipped = (mutate) => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    const target = rows.findIndex(mutate.pick);
    assert.ok(target >= 0, 'row to flip exists');
    const label = rows[target].label;
    rows[target] = { ...rows[target], expect: rows[target].expect === 'allow' ? 'deny' : 'allow', ...(rows[target].expect === 'allow' ? { reason: 'x' } : {}) };
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    return { corpus, label };
  };
  const runnerWith = (root, corpus) => {
    const env = { ...process.env, CORPUS: corpus };
    delete env.HOOKS_DIR;
    return spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
  };

  test('3.9 the runner exits 0 over the four Bash hooks and the shared rows, also with a project list of its own; a flipped row of this hook and a flipped @bash-all row each fail it', () => {
    const root = deploy({ locked_commands: ['something-else'] });
    const ok = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(ok.stdout.includes('canaries: pass=892 fail=0'), ok.stdout);
    for (const pick of [(r) => r.hook === 'check-test-command.sh' && r.expect === 'deny', (r) => r.hook === '@bash-all']) {
      const { corpus, label } = writeFlipped({ pick });
      const r = runnerWith(root, corpus);
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.ok(r.stdout.includes(`:: ${label}`), r.stdout);
    }
  });

  test('3.9 the corpus holds 105 check-test-command rows and exactly 82 @bash-all rows, none with a project term; the hook is registered on Bash and every entry is guarded', () => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    assert.strictEqual(rows.filter((r) => r.hook === 'check-test-command.sh').length, 175);
    const shared = rows.filter((r) => r.hook === '@bash-all');
    assert.strictEqual(shared.length, 112);
    assert.ok(shared.every((r) => r.expect === 'allow'));
    for (const r of shared) assert.doesNotMatch(JSON.stringify(r), PROJECT_TERM, r.label);
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    const bash = frag.hooks.PreToolUse.find((g) => g.matcher === 'Bash');
    assert.ok(bash.hooks.some((h) => h.command === '"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-test-command.sh'));
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    for (const f of preset.files.filter((x) => x.dest.includes('check-test-command'))) assert.strictEqual(f.guarded, true, f.dest);
  });

  // 3.8 C6: stack.deploy.never_touch read at run time from the config of the git toplevel
  const NEVER = ['gh workflow run deploy-prod', 'tools/release.sh prod', 'git push heroku'];
  const withStack = (root, stack) => {
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities: {}, ...stack } }));
    return root;
  };
  const neverRoot = () => withStack(deploy(), { locked_commands: ['test:e2e'], deploy: { never_touch: NEVER } });

  test('3.8 C6 a never-touch command is denied wrapped, with a flag before the target, behind a ./ or absolute prefix, under the lock; its data forms and neighbours are allowed', () => {
    const root = neverRoot();
    for (const c of ['gh workflow run deploy-prod', 'gh workflow run --ref main deploy-prod', 'gh -R o/r workflow run deploy-prod -f x=1', '/opt/homebrew/bin/gh workflow run deploy-prod',
      './tools/release.sh prod', 'bash tools/release.sh prod', 'bash -c "./tools/release.sh --yes prod"', `${WRAP} tools/release.sh prod`, 'git -C . push heroku main']) {
      const r = runCheck(root, c);
      assert.strictEqual(r.status, 2, c);
      assert.ok(r.stderr.includes('never-touch deploy command'), r.stderr);
    }
    for (const c of ['gh workflow run deploy-staging', 'gh workflow view deploy-prod', 'tools/release.sh staging', 'echo gh workflow run deploy-prod', 'git commit -m "gh workflow run deploy-prod"',
      'grep -n "release.sh prod" README.md', 'git push origin main', `${WRAP} npm run test:e2e`]) assert.strictEqual(runCheck(root, c).status, 0, c);
    assert.strictEqual(runCheck(root, 'npm run test:e2e').status, 2, 'the locked list still applies');
  });

  test('3.8 C6 a changed list takes effect without a sync; a list that is not an array of strings, or a deploy that is not an object, fails closed; no never_touch behaves as before', () => {
    const root = deploy();
    withStack(root, { deploy: { never_touch: ['kubectl apply -f prod'] } });
    assert.strictEqual(runCheck(root, 'kubectl apply -f prod').status, 2);
    assert.strictEqual(runCheck(root, 'kubectl get pods').status, 0);
    for (const stack of [{ deploy: { never_touch: 'x' } }, { deploy: [] }, { deploy: { never_touch: [''] } }, { deploy: { never_touch: [7] } }]) {
      withStack(root, stack);
      const r = runCheck(root, 'ls');
      assert.strictEqual(r.status, 2, JSON.stringify(stack));
      assert.ok(r.stderr.includes('fail closed'), r.stderr);
    }
    withStack(root, { locked_commands: ['test:e2e'] });
    assert.strictEqual(runCheck(root, 'npm run test:e2e').status, 2);
    assert.strictEqual(runCheck(root, 'gh workflow run deploy-prod').status, 0);
    withStack(root, { deploy: { never_touch: [] } });
    assert.strictEqual(runCheck(root, 'gh workflow run deploy-prod').status, 0);
  });

  const NEVER_MUTANTS = [
    ['the never loop moved below the lock skip', "  my $data = $DATA{ base($r[0]) };\n", "  my $data = $DATA{ base($r[0]) };\n  next if $e->{wrapper} || $e->{locked};\n"],
    ['subsequence turned into adjacency', 'for my $w (@r) { $k++ if $k < @$lit && tok_eq($lit->[$k], $w, $e) }', 'for my $w (@r) { if ($k < @$lit) { if (tok_eq($lit->[$k], $w, $e)) { $k++ } else { $k = 0 } } }'],
    ['tok_eq path-suffix branch removed', 'return $lit =~ m{/} ? ($word =~ m{(?:^|/)\\Q$lit\\E$} ? 1 : 0) : (base($word) eq $lit ? 1 : 0);', 'return $lit =~ m{/} ? 0 : (base($word) eq $lit ? 1 : 0);'],
    ['the data-command exception removed', 'next if $data && !tok_eq($lit->[0], $r[0], $e);', ''],
  ];
  for (const [name, needle, replacement] of NEVER_MUTANTS) {
    test(`3.8 C6 mutant killed: ${name}`, () => {
      const root = deploy();
      const mutated = mkTmp('gsd-base-mutant-');
      fs.cpSync(hooksDir(root), mutated, { recursive: true });
      const pl = path.join(mutated, 'lib', 'check-test-command.pl');
      const source = fs.readFileSync(pl, 'utf8');
      assert.ok(source.includes(needle), `mutation site present: ${needle}`);
      fs.writeFileSync(pl, source.replace(needle, () => replacement));
      const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)).filter((r) => r.cwd === '@repo-never');
      assert.strictEqual(rows.length, 37);
      const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(corpus, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
      const env = { ...process.env, HOOKS_DIR: mutated, CORPUS: corpus };
      const r = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
      assert.notStrictEqual(r.status, 0, `mutant survived: ${name}\n${r.stdout}`);
      assert.ok(r.stdout.includes('FAIL [check-test-command.sh]'), r.stdout);
    });
  }
});

describe('base preset: check-denied-command hook (agnostic-M-03 3.8 C5)', () => {
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const HOOK = 'check-denied-command.sh';
  const deploy = () => {
    const root = gitRepo({ project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, mkTmp('gsd-base-home-')).status, 0);
    return root;
  };
  const run = (root, command, raw) => spawnSync('bash', [path.join(hooksDir(root), HOOK)], {
    input: raw ?? JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }),
    encoding: 'utf8',
    cwd: root,
  });
  const ownRows = () => fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)).filter((r) => r.hook === HOOK);

  test('3.8 R1 sudo and doas are denied behind env, command, a path, xargs and bash -c; a data mention is allowed', () => {
    const root = deploy();
    for (const c of ['sudo ls', 'env sudo ls', 'command sudo -n true', '/usr/bin/sudo ls', 'xargs sudo rm', 'bash -c "sudo ls"', 'doas ls']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['echo sudo', 'grep -n sudo README.md', 'X=sudo ls']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('3.8 R2 recursive rm of the root, home, cwd or a bare glob is denied in every flag spelling; a named directory and a non-recursive glob are allowed', () => {
    const root = deploy();
    for (const c of ['rm -rf /', 'rm -rf ~/', 'rm -fr *', 'rm -r -f ./*', 'rm -rf -- *', 'rm -rf "$HOME"', 'rm -rf .', 'rm --recursive --force ../*']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['rm -rf dist', 'rm -rf ./build/*', 'rm *', 'rm -f *.log', 'rm -rf /tmp/scratch/x']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('3.8 R3 force push, reset --hard and a forced clean are denied behind -C, -c, a late flag and bash -c; the safe neighbours are allowed', () => {
    const root = deploy();
    for (const c of ['git push origin x --force', 'git push -uf origin x', 'git push origin +x', 'git -C wt push origin x:y --force', 'bash -c "git push --force"',
      'git -c a.b=c reset --hard', 'git -C /tmp/x reset --hard HEAD~1', 'git clean -xdf', 'git clean -d --force']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['git push --force-with-lease origin x', 'git push -u origin feature', 'git reset --soft HEAD~1', 'git clean -n -f -d', 'git clean --dry-run -fd', 'git clean -fdxn']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('3.8 R4 rebase and pull --rebase answer ask with the rendered owner title; a deny in the same command wins', () => {
    const root = deploy();
    for (const c of ['git rebase main', 'git -C wt rebase -i HEAD~3', 'git pull --rebase', 'git pull -r origin main']) {
      const r = run(root, c);
      assert.strictEqual(r.status, 0, c);
      const out = JSON.parse(r.stdout);
      assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'ask', c);
      assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('Founder approval required'), r.stdout);
    }
    assert.strictEqual(run(root, 'git pull origin main').stdout, '');
    assert.strictEqual(run(root, 'git rebase main && git reset --hard').status, 2);
  });

  test('3.8 R6 a reader command given a .env file, a redirect from one or a path under secrets/ is denied; templates and other names are allowed', () => {
    const root = deploy();
    for (const c of ['cat .env', 'cat ./app/server/.env.local', 'grep -n KEY .env', 'head -3 config/secrets/prod.json', 'jq . secrets/token.json', 'tr a b < .env', 'cut -d= -f1 .env.production']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['cat .env.example', 'grep -c . apps/web/.env.sample', 'cp .env.example .env', 'ls -la .env', 'test -f .env', 'cat src/secretsmanager/client.ts', 'grep -n secrets README.md']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('F3 sudo with no command after it, and su in every form, are denied', () => {
    const root = deploy();
    for (const c of ['sudo', 'sudo -i', 'sudo -s', 'sudo --login', 'env sudo -i', '/usr/bin/sudo -s', 'bash -c "sudo -i"', 'doas -s', 'su', 'su -', 'su root']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['echo su', 'echo sudo -i']) assert.strictEqual(run(root, c).status, 0, c);
    for (const c of ['su -c "id" root', 'su -c id']) assert.strictEqual(run(root, c).status, 2, c);    // R2 L3: su is denied like sudo
    assert.strictEqual(run(root, 'su -c "git push --force" root').status, 2);
  });

  test('F2 git grep -O and every abbreviation of --open-files-in-pager are denied; git -c with a command-running key or a ! value is denied; other -c keys are allowed', () => {
    const root = deploy();
    for (const c of ['git grep -Ovim x', 'git grep -nOvim x', 'git grep --open-files-in-pager=vim x', 'git grep --op x', 'git grep --ope=vim x', 'git -C wt grep -O vim x',
      'git -c core.pager=sh log', 'git -c Core.Pager=sh log', 'git -c alias.x=!sh x', 'git -c core.fsmonitor=sh status', 'git -c core.sshCommand=sh fetch', 'git --config-env=core.pager=V log', 'git -c a.b=!ls status']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['git grep -n foo', 'git grep --only-matching foo', 'git grep --or -e a -e b', 'git grep --o foo', 'git grep -e x -- -O', 'git -c user.name=x status', 'git -c color.ui=never log']) {
      assert.strictEqual(run(root, c).status, 0, c);
    }
    assert.ok(run(root, 'git grep -Ovim x').stderr.includes('git grep -O'));
    assert.ok(run(root, 'git -c core.pager=sh log').stderr.includes('can make git run a command'));
  });

  test('F5 rm -r of $PWD, $HOME, ~user and their globs is denied in every spelling; a named child is allowed', () => {
    const root = deploy();
    for (const c of ['rm -rf $PWD', 'rm -rf "$PWD"', 'rm -rf ${PWD}', 'rm -rf $HOME', 'rm -rf "${HOME}"', 'rm -rf ~root', 'rm -rf $PWD/*', 'rm -rf $OLDPWD', 'rm -r -f ${HOME}/.']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['rm -rf $PWD/build', 'rm -rf "$HOME/.cache/x"', 'rm $PWD']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('F4 and F9 key material, credential files and key directories are not read, in any letter case; look-alike names are', () => {
    const root = deploy();
    for (const c of ['cat ~/.ssh/id_rsa', 'cat ~/.aws/credentials', 'cat ~/.config/gh/hosts.yml', 'head .npmrc', 'cat .git-credentials', 'base64 server.pem', 'xxd tls.key', 'cat id_rsa', 'cat id_ed25519',
      'grep -r x ~/.gnupg', 'cp ~/.ssh/id_rsa /tmp/x', 'source ~/.aws/config', 'jq . ~/.aws/config', 'less ~/.SSH/config', 'cat .ENV', 'cat .Env.Local', 'cat SECRETS/x', 'cat config/Secrets/prod.json', 'cat ./KEYS/ID_RSA.old', 'tr a b < .ENV']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['cat keyboard.md', 'cat ~/.config/other', 'cat docs/pem.md', 'cat .npmrc.example', 'cat .ENV.EXAMPLE', 'cat .env.example', 'ls ~/.ssh', 'test -f ~/.aws/credentials']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('R2 L1 every Bash wrapper resolves its own directory when called by a bare name and exits 2 when lib/run-perl.sh is missing; without the `|| exit 2` it would exit 1', () => {
    const root = deploy();
    const WRAPPERS = ['block-push-without-local-tests', 'check-denied-command', 'check-git-merge-target', 'check-test-command', 'redirect-recursive-search'];
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sudo ls' }, cwd: root });
    const calm = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: root });
    for (const w of WRAPPERS) {
      const bare = spawnSync('bash', [`${w}.sh`], { input: calm, encoding: 'utf8', cwd: hooksDir(root) });
      assert.strictEqual(bare.status, 0, `${w} by bare name: ${bare.stderr}`);
      const copy = mkTmp('gsd-base-wrapper-');
      fs.cpSync(hooksDir(root), copy, { recursive: true });
      fs.rmSync(path.join(copy, 'lib', 'run-perl.sh'));
      const gone = spawnSync('bash', [path.join(copy, `${w}.sh`)], { input, encoding: 'utf8' });
      assert.strictEqual(gone.status, 2, `${w} with no lib: ${gone.stderr}`);
      const goneBare = spawnSync('bash', [`${w}.sh`], { input, encoding: 'utf8', cwd: copy });
      assert.strictEqual(goneBare.status, 2, `${w} bare with no lib: ${goneBare.stderr}`);
      const loose = fs.readFileSync(path.join(copy, `${w}.sh`), 'utf8');
      assert.ok(loose.includes(' || exit 2'), 'mutation site present');
      fs.writeFileSync(path.join(copy, `${w}.sh`), loose.replace(' || exit 2', ''));
      assert.strictEqual(spawnSync('bash', [path.join(copy, `${w}.sh`)], { input, encoding: 'utf8' }).status, 1, `${w} mutant: the missing lib is rc 1 without the guard`);
    }
  });

  test('R2 M1 a quoted sentence given to an option of an arbitrary program is data; a first argument, an evaluator and a bare command word are still judged; a 28 KB chain of finds passes', () => {
    const root = deploy();
    for (const c of ['deno test --filter "denies sudo"', 'npm test -- -t "blocks git reset --hard"', 'gh pr create --title "feat: deny sudo ls"', 'python3 x.py --msg "sudo reboot"',
      'git commit -m "fix sudo handling"', 'gh issue create --body "git reset --hard docs"', 'find . -name x;'.repeat(1900)]) assert.strictEqual(run(root, c).status, 0, c.slice(0, 80));
    for (const c of ['foo "git push --force"', 'foo bash -c "git push --force"', 'foo --x sh -c "git push -f"', 'foo timeout 5 "git push -f"', 'foo xargs "sudo ls"', 'foo env -S "git push -f"',
      'foo nohup "git push -f"', 'foo exec "rm -rf /"', 'foo watch "git reset --hard"', 'foo --flag git clean -f']) assert.strictEqual(run(root, c).status, 2, c);
    assert.strictEqual(run(root, 'find . -name x;'.repeat(2400)).status, 2, 'over the 32 KB input cap');
  });

  test('3.8 malformed stdin and a non-object tool_input fail closed', () => {
    const root = deploy();
    const a = run(root, '', '{not json');
    assert.strictEqual(a.status, 2);
    assert.ok(a.stderr.includes('not valid JSON'), a.stderr);
    const b = run(root, '', JSON.stringify({ tool_name: 'Bash', tool_input: 'x', cwd: root }));
    assert.strictEqual(b.status, 2);
    assert.ok(b.stderr.includes('crashed'), b.stderr);
  });

  const runnerOf = (root) => path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
  const runnerEnv = (extra) => {
    const env = { ...process.env, ...extra };
    if (!extra.CORPUS) delete env.CORPUS;
    if (!extra.HOOKS_DIR) delete env.HOOKS_DIR;
    return env;
  };

  test('3.8 the corpus holds 80 rows of this hook (78 matrix + 2 fail-closed); the runner is green and a flipped row of the hook fails it', () => {
    const rows = ownRows();
    assert.strictEqual(rows.length, 301);
    assert.deepStrictEqual(['allow', 'ask', 'deny'].map((e) => rows.filter((r) => r.expect === e).length), [88, 5, 208]);
    const root = deploy();
    const ok = spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env: runnerEnv({}) });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(ok.stdout.includes('canaries: pass=892 fail=0'), ok.stdout);
    const flipped = rows.map((r, i) => (i === 0 ? { ...r, expect: 'allow' } : r));
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${flipped.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const r = spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env: runnerEnv({ CORPUS: corpus }) });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes(`FAIL [${HOOK}] expect=allow got=deny :: ${rows[0].label}`), r.stdout);
  });

  test('3.8 the hook is the fifth Bash command and every file of it is guarded', () => {
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    const bash = frag.hooks.PreToolUse.find((g) => g.matcher === 'Bash');
    assert.strictEqual(bash.hooks[4].command, '"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-denied-command.sh');
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const mine = preset.files.filter((x) => x.dest.includes('check-denied-command'));
    assert.strictEqual(mine.length, 2);
    for (const f of mine) assert.strictEqual(f.guarded, true, f.dest);
  });

  const MUTANTS = [
    ['R1 sudo prefix check removed', "if grep { base($_) eq 'sudo' } @prefix;", 'if 0;'],
    ['R1 doas removed', "if $h eq 'doas';", 'if 0;'],
    ['R2 recursive forced on (kills rm *)', 'if $recursive && @bad;', 'if @bad;'],
    ['R2 root_like narrowed to /', "return (grep { $_ !~ /^(?:\\.|\\.\\.|\\.\\*|\\*\\*?)$/ } @seg) ? 0 : 1;", "return $_[0] eq '/' ? 1 : 0;"],
    ['R2 split flag cluster not recognised', '$a =~ /^-[A-Za-z0-9]*[rR]/', '$a =~ /^-[rR]/'],
    ['R3 push checks only the first argument', '/^\\+./ } @a;', '/^\\+./ } ($a[0]);'],
    ['R3 +refspec removed', '|| /^\\+./ } @a;', '} @a;'],
    ['R3 -f cluster removed', "|| /^-[A-Za-z]*f[A-Za-z]*$/", ''],
    ['R3 reset --hard removed', "$g->{sub} eq 'reset' && grep", '0 && grep'],
    ['R3 forced clean removed', 'my $force = grep { /^--f(?:o(?:r(?:c(?:e)?)?)?)?$/ || /^-[A-Za-z]*f/ } @a;', 'my $force = 0;'],
    ['R3 clean dry-run exemption removed', 'if $force && !$dry;', 'if $force;'],
    ['R4 ask turned into exit 0', 'sub ask { print', 'sub ask { exit 0; print'],
    ['R4 pull --rebase removed', "$g->{sub} eq 'pull' &&", '0 &&'],
    ['R6 template exemption removed', '$b !~ /^\\.env[^\\/]*\\.(?:example|sample|template|dist)$/', '1'],
    ['R6 redirect targets ignored', ', map { /^<([^<].*)$/ ? $1 : () } @{ $e->{redirs} }', ''],
    ['R6 secrets directory removed', "return 1 if grep { $_ eq 'secrets' } @seg;", 'return 0;'],
    ['R6 bare .env removed', "return 1 if $b eq '.env';", 'return 0 if 0;'],
    ['R6 .env.<name> removed', '($b =~ /^\\.env\\./ &&', '(0 &&'],
    ['R6 reader grep removed', 'qw(cat head tail less more grep egrep', 'qw(cat head tail less more egrep'],
    ['F3 sudo with no command is skipped again', 'my @r = @{ $e->{rest} };\n  my @w', 'my @r = @{ $e->{rest} }; next unless @r;\n  my @w'],
    ['F3 su removed', "if $h eq 'su';", 'if 0;'],
    ['F2 git grep pager option ignored', 'if grep { is_pager_opt($_) } @opts;', 'if 0;'],
    ['F2 pager abbreviation narrowed to the full name', 'index($PAGER_LONG, $x) == 0', '$x eq $PAGER_LONG'],
    ['F2 git -c command keys ignored', 'if ($k =~ $RUNS_COMMAND && !$reset) ||', 'if'],
    ['F2 git -c ! value ignored', '|| (defined $v && $v =~ /^!/);', ';'],
    ['F5 $PWD not a whole-tree target', '(?:HOME|PWD|OLDPWD)', '(?:HOME)'],
    ['F5 ~user not a whole-tree target', '~\\w*|', '~|'],
    ['F4 key directories removed', "return 1 if grep { /^\\.(?:ssh|a[w]s|gnupg)$/ } @seg, $b;", 'return 0 if 0;'],
    ['F4 .config/gh removed', "eq '.config' && ($seg[$_ + 1] // $b) eq 'gh'", "eq '.config' && 0"],
    ['F4 .npmrc and .git-credentials removed', '/^\\.(?:npmrc|git-credentials)$/ ||', '0 ||'],
    ['F4 .pem and .key removed', '$b =~ /\\.(?:pem|key)$/ ||', '0 ||'],
    ['F4 id_rsa-style names removed', '$b =~ /^id_(?:rsa|dsa|ecdsa|ed25519)/;', '0;'],
    ['F9 comparison made case-sensitive', 'map { lc } grep { length }', 'grep { length }'],
  ];
  for (const [name, needle, replacement] of MUTANTS) {
    test(`3.8 mutant killed: ${name}`, () => {
      const root = deploy();
      const mutated = mkTmp('gsd-base-mutant-');
      fs.cpSync(hooksDir(root), mutated, { recursive: true });
      const pl = path.join(mutated, 'lib', 'check-denied-command.pl');
      const source = fs.readFileSync(pl, 'utf8');
      assert.ok(source.includes(needle), `mutation site present: ${needle}`);
      fs.writeFileSync(pl, source.replace(needle, () => replacement));
      const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(corpus, `${ownRows().map((r) => JSON.stringify(r)).join('\n')}\n`);
      const r = spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env: runnerEnv({ HOOKS_DIR: mutated, CORPUS: corpus }) });
      assert.notStrictEqual(r.status, 0, `mutant survived: ${name}\n${r.stdout}`);
      assert.ok(r.stdout.includes(`FAIL [${HOOK}]`), r.stdout);
    });
  }

  // Review round 2: mutants of the shared guard and of the other hooks, killed by the review-r2 rows (own rows of this hook plus the shared ones).
  const R2_MUTANTS = [
    ['M1 any quoted word with a space is a command line again', "elsif ($w[$k] =~ /\\s/ && ($k == 1 || $eval))", "elsif ($w[$k] =~ /\\s/)", 'HookGuard.pm'],
    ['M2 rm flag cluster with a digit not recognised', '$a =~ /^-[A-Za-z0-9]*[rR]/', '$a =~ /^-[A-Za-z]*[rR]/', 'check-denied-command.pl'],
    ['M2 grep cluster stops at a digit', "last if $c =~ /^[ABCmDef]$/;", "last if $c =~ /^[ABCmDef0-9]$/;", 'redirect-recursive-search.pl'],
    ['M2 grep -d value ignored', "$recursive = 1 if $v =~ /^rec(?:u(?:r(?:s(?:e)?)?)?)?$/; last }", "last }", 'redirect-recursive-search.pl'],
    ['L5 find: -maxdepth after -exec counts', "{ $exec = 1; last }", "{ $exec = 1 }", 'redirect-recursive-search.pl'],
    ['L5 find: a value of -name counts as the option', "elsif ($FIND_VAL{ $r[$k] }) { $k++ }", "", 'redirect-recursive-search.pl'],
    ['L5 ag and ack are not searches', "pcre2grep|rg|ag|ack|ack-grep|ugrep", "pcre2grep|rg|ugrep", 'redirect-recursive-search.pl'],
    ['M3 literal match is case-sensitive', "$word = lc norm_word($word); $lit = lc norm_word($lit);", "$word = norm_word($word); $lit = norm_word($lit);", 'check-test-command.pl'],
    ['M3 the cd directory is not tracked', "return 0 unless defined $d && $d ne $cwd && $word !~ /^[-~]/;", "return 0;", 'check-test-command.pl'],
    ['M3 flake globs are case-sensitive', "return new RegExp(`^${re}$`, 'i');", "return new RegExp(`^${re}$`);", 'flake-gate.mjs'],
    ['M3 flake-ignore marker is case-sensitive', "flake-ignore\\b(.*)$/i;", "flake-ignore\\b(.*)$/;", 'flake-gate.mjs'],
    ['L2 new readers removed', 'source . bat rev paste column fold fmt comm join pr ag ack ug ugrep zgrep pcregrep', 'source .', 'check-denied-command.pl'],
    ['L2 template suffix .dist and middle part not accepted', '$b !~ /^\\.env[^\\/]*\\.(?:example|sample|template|dist)$/', '$b !~ /^\\.env\\.(?:example|sample|template)$/', 'check-denied-command.pl'],
    ['L2 empty credential value not exempt', '($k =~ $RUNS_COMMAND && !$reset)', '($k =~ $RUNS_COMMAND)', 'check-denied-command.pl'],
    ['L3 command substitution target not denied', '|| m{^\\$SUB(?:/|$)}', '', 'check-denied-command.pl'],
    ['L3 control characters not denied', '$c =~ /([\\x00-\\x08\\x0b-\\x1f\\x7f])/', '0', 'HookGuard.pm'],
    ['L4 sed --in-place is not a writer', '/^--i(?:n(?:-(?:p(?:l(?:a(?:c(?:e)?)?)?)?)?)?)?(?:=|$)/', '0', 'block-push-without-local-tests.pl'],
    ['L4 find -exec writers are not denied', 'if ($r[$k] =~ /^-(?:exec|execdir|ok|okdir)$/) { my $x', 'if (0) { my $x', 'block-push-without-local-tests.pl'],
    ['L4 reading the marker age is denied again', '($hit && !read_only_code($h, @hitw) && !read_only_awk($h, \\@r, @hitw))', '$hit', 'block-push-without-local-tests.pl'],
    ['L4 code that writes the marker passes the read exemption', 'return 0 if $w =~ /(?:write|append|', 'return 0 if 0 && $w =~ /(?:write|append|', 'block-push-without-local-tests.pl'],
    ['L4 awk write syntax passes the exemption', '{ /[>|]|system\\s*\\(|getline|close\\s*\\(/ }', '{ /(?!)/ }', 'block-push-without-local-tests.pl'],
    // R2-MUTANTS-END
  ];
  for (const [name, needle, replacement, file] of R2_MUTANTS) {
    test(`R2 mutant killed: ${name}`, () => {
      const root = deploy();
      const mutated = mkTmp('gsd-base-mutant-');
      fs.cpSync(hooksDir(root), mutated, { recursive: true });
      const target = path.join(mutated, 'lib', file);
      const source = fs.readFileSync(target, 'utf8');
      assert.ok(source.includes(needle), `mutation site present: ${needle}`);
      fs.writeFileSync(target, source.replace(needle, () => replacement));
      const all = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
      const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(corpus, `${all.filter((r) => r.class === 'review-r2').map((r) => JSON.stringify(r)).join('\n')}\n`);
      const r = spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env: runnerEnv({ HOOKS_DIR: mutated, CORPUS: corpus }) });
      assert.notStrictEqual(r.status, 0, `mutant survived: ${name}\n${r.stdout}`);
      assert.ok(/FAIL \[/.test(r.stdout), r.stdout);
    });
  }
});

describe('base preset: check-flake-patterns hook and gate, profile-driven (agnostic-M-03 3.11)', () => {
  const { pathToFileURL } = require('url');
  const home = () => mkTmp('gsd-base-home-');
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const GATE_SRC = path.join(BASE, 'hooks', 'lib', 'flake-gate.mjs');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const RUNNER_SRC = path.join(BASE, 'canaries', 'run-canaries.sh');
  const PROJECT_TERM = /deno|supabase|apps\/api|preflight|igaming|CEO|\/Users\//i;
  const gate = () => import(pathToFileURL(GATE_SRC).href);
  const Q = '["\']';
  const SHARED = `\\.from\\(\\s*${Q}[\\w.]*[Ss]hared[\\w.]*${Q}(?![\\s\\S]*\\.from\\()`;
  // The three source categories of the igaming flake gate as profile patterns: the worked example.
  const WORKED = [
    { id: 'hardcoded-round-number', match: `round_number\\s*:\\s*(?!${Q})\\d+\\b`, requires_before: SHARED, unless_nearby: '23505', message: 'round_number in a shared table, no retry' },
    { id: 'hardcoded-id', match: `(?:^|[^\\w.])(?:[A-Za-z_]\\w*_id|id)\\s*:\\s*(?!${Q})\\d+\\b`, requires_before: SHARED, unless_nearby: '23505', message: 'id in a shared table, no retry' },
    { id: 'absolute-time-window', match: `(?:end_hour|endHour)\\s*:\\s*(?!${Q})\\d+\\b`, requires_before: `(?:start_hour|startHour)\\s*:\\s*(?!${Q})\\d+\\b`, unless_nearby: 'getUTCHours', message: 'absolute hour window' },
  ];
  const flakeConfig = (extra = {}) => ({ stack: { capabilities: {}, flake_patterns: { test_globs: ['**/*.integration.test.ts'], patterns: WORKED, ...extra } } });
  const deploy = (cfg = flakeConfig()) => {
    const root = gitRepo({ project: { slug: 'demo' }, ...cfg });
    assert.strictEqual(runInit(root, home()).status, 0);
    return root;
  };
  const FILE = 'src/__tests__/x.integration.test.ts';
  const runFlake = (root, tool, toolInput, { cwd = root, projectDir, raw, env = {}, shell = 'bash' } = {}) => spawnSync(shell, [path.join(hooksDir(root), 'check-flake-patterns.sh')], {
    input: raw ?? JSON.stringify({ tool_name: tool, tool_input: toolInput, cwd }),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir ?? os.tmpdir(), ...env },
  });
  const HOUR = 'const w = { start_hour: 0, end_hour: 23 };\n';
  const SHARED_INSERT = '  .from("queue_shared_rounds")\n  .insert({ round_number: 800011 })\n';
  const write = (root, content, file = FILE, opts) => runFlake(root, 'Write', { file_path: file, content }, opts);

  test('3.11 scanFlakePatterns on the three source incident shapes gives the three categories and nothing on the exempt shapes', async () => {
    const { scanFlakePatterns } = await gate();
    const ids = (c) => scanFlakePatterns(c, WORKED).map((v) => v.id);
    assert.deepStrictEqual(ids(SHARED_INSERT), ['hardcoded-round-number']);
    assert.deepStrictEqual(ids('  .from("queue_shared_rounds")\n  .insert({ venue_id: 12 })\n'), ['hardcoded-id']);
    assert.deepStrictEqual(ids(HOUR), ['absolute-time-window']);
    assert.deepStrictEqual(ids('  .from("session_rounds")\n  .insert({ round_number: 800011 })\n'), [], 'session-scoped table is exempt');
    assert.deepStrictEqual(ids(`${SHARED_INSERT}  // retry on 23505\n`), [], 'retry nearby');
    assert.deepStrictEqual(ids('  .from("queue_shared_rounds")\n  .from("session_rounds")\n  .insert({ round_number: 1 })\n'), [], 'the nearest table above decides');
    assert.deepStrictEqual(ids(`const now = new Date().getUTCHours();\n${HOUR}`), [], 'UTC anchor nearby');
    assert.deepStrictEqual(ids('const row = { round_number: "x1" };\n'), [], 'quoted value');
    assert.deepStrictEqual(ids('const row = { round_number: 800011 };\n'), [], 'requires_before absent');
  });

  test('3.11 the window: requires_before looks above, unless_nearby looks both sides, both bounded by the pattern window (default 40)', async () => {
    const { scanFlakePatterns } = await gate();
    const filler = (n) => Array.from({ length: n }, () => 'x;').join('\n');
    const P = (extra) => [{ id: 'p', match: 'TARGET', message: 'm', ...extra }];
    const count = (c, patterns) => scanFlakePatterns(c, patterns).length;
    const above = P({ requires_before: 'NEED', window: 2 });
    assert.strictEqual(count(`NEED\n${filler(1)}\nTARGET`, above), 1, 'evidence exactly 2 lines above');
    assert.strictEqual(count(`NEED\n${filler(2)}\nTARGET`, above), 0, 'evidence 3 lines above is outside');
    assert.strictEqual(count('TARGET NEED', above), 1, 'the line itself counts');
    assert.strictEqual(count(`TARGET\n${filler(1)}\nNEED`, above), 0, 'evidence below does not satisfy requires_before');
    const nearby = P({ unless_nearby: 'OK', window: 2 });
    assert.strictEqual(count(`OK\n${filler(1)}\nTARGET`, nearby), 0, 'exemption 2 above');
    assert.strictEqual(count(`TARGET\n${filler(1)}\nOK`, nearby), 0, 'exemption 2 below');
    assert.strictEqual(count(`OK\n${filler(2)}\nTARGET`, nearby), 1, 'exemption 3 above is outside');
    assert.strictEqual(count(`TARGET\n${filler(2)}\nOK`, nearby), 1, 'exemption 3 below is outside');
    const dflt = P({ requires_before: 'NEED' });
    assert.strictEqual(count(`NEED\n${filler(39)}\nTARGET`, dflt), 1, 'default window 40');
    assert.strictEqual(count(`NEED\n${filler(40)}\nTARGET`, dflt), 0);
  });

  test('3.11 suppression: flake-ignore with a reason on the line or the line above suppresses; without a reason it still blocks', async () => {
    const { scanFlakePatterns, parseSuppressionAt } = await gate();
    const P = [{ id: 'p', match: 'TARGET', message: 'm' }];
    const first = (c) => scanFlakePatterns(c, P)[0];
    assert.strictEqual(first('// flake-ignore: by design\nTARGET').suppressed, true);
    assert.strictEqual(first('TARGET // flake-ignore: by design').suppressed, true);
    assert.strictEqual(first('# flake-ignore: by design\nTARGET').suppressed, true);
    assert.strictEqual(first('/* flake-ignore: by design */\nTARGET').suppressed, true);
    assert.strictEqual(first('// flake-ignore\nTARGET').suppressed, false);
    assert.strictEqual(first('// flake-ignore:\nTARGET').suppressed, false);
    assert.strictEqual(first('// flake-ignore: \nTARGET').suppressed, false);
    assert.strictEqual(first('/* flake-ignore: */\nTARGET').suppressed, false);
    assert.match(first('// flake-ignore\nTARGET').message, /without a reason/);
    assert.strictEqual(first('// flake-ignore: by design\n\nTARGET').suppressed, false, 'two lines above is too far');
    assert.deepStrictEqual(parseSuppressionAt(['TARGET'], 0), { found: false, justified: false });
  });

  test('3.11 deployed hook: a violation in a test file is denied with file, line and pattern id; a justified ignore, a non-test file, an Edit of a clean fragment and other tools are allowed', () => {
    const root = deploy();
    const denied = write(root, HOUR);
    assert.strictEqual(denied.status, 2, denied.stderr);
    assert.ok(denied.stderr.includes(`${FILE}:1: [absolute-time-window]`), denied.stderr);
    assert.ok(denied.stderr.includes('flake-ignore: <reason>'), denied.stderr);
    assert.strictEqual(write(root, `// flake-ignore: by design\n${HOUR}`).status, 0);
    assert.strictEqual(write(root, `// flake-ignore\n${HOUR}`).status, 2);
    assert.strictEqual(write(root, HOUR, 'src/x.test.ts').status, 0, 'outside test_globs');
    assert.strictEqual(write(root, HOUR, path.join(root, 'src', '__tests__', 'y.integration.test.ts')).status, 2, 'an absolute path inside the repo matches the glob');
    assert.strictEqual(write(root, HOUR, 'top.integration.test.ts').status, 2, '**/ also matches the repo root');
    assert.strictEqual(runFlake(root, 'Bash', { command: 'echo hi' }).status, 0, 'other tools');
    assert.strictEqual(runFlake(root, 'Edit', { file_path: FILE, old_string: 'a', new_string: 'const ok = 1;\n' }).status, 0);
  });

  test('3.11 the hook runs when reached through a symlinked path (the CLI must not depend on argv[1] matching the module URL)', () => {
    const root = deploy();
    const link = path.join(mkTmp('gsd-base-link-'), 'hooks-link');
    fs.symlinkSync(hooksDir(root), link);
    const r = spawnSync('bash', [path.join(link, 'check-flake-patterns.sh')], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: FILE, content: HOUR }, cwd: root }),
      encoding: 'utf8',
      cwd: root,
    });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  });

  test('3.11 Write scans content and Edit scans new_string only', () => {
    const root = deploy();
    assert.strictEqual(runFlake(root, 'Edit', { file_path: FILE, old_string: 'a', new_string: SHARED_INSERT }).status, 2, 'Edit fragment is scanned');
    assert.strictEqual(runFlake(root, 'Edit', { file_path: FILE, old_string: HOUR, new_string: 'const ok = 1;\n', content: HOUR }).status, 0, 'Edit ignores a content field');
    assert.strictEqual(runFlake(root, 'Write', { file_path: FILE, content: 'const ok = 1;\n', new_string: HOUR }).status, 0, 'Write ignores new_string');
  });

  test('3.11 no config, no flake_patterns, an empty pattern list, no stack block or no git toplevel allows', () => {
    for (const cfg of [{ stack: { capabilities: {} } }, flakeConfig({ patterns: [] })]) {
      const root = deploy(cfg);
      assert.strictEqual(write(root, HOUR).status, 0, JSON.stringify(cfg).slice(0, 80));
    }
    const inert = deploy();
    fs.writeFileSync(path.join(inert, '.planning', 'config.json'), JSON.stringify(flakeConfig({ patterns: [], test_globs: 'x' })));
    assert.strictEqual(write(inert, HOUR).status, 0, 'an empty pattern list is inert even beside unusable test_globs');
    const root = deploy();
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), '{}');
    assert.strictEqual(write(root, HOUR).status, 0, 'no stack block');
    fs.rmSync(path.join(root, '.planning', 'config.json'));
    assert.strictEqual(write(root, HOUR).status, 0, 'no config file');
    assert.strictEqual(write(deploy(), HOUR, FILE, { cwd: mkTmp('gsd-base-norepo-') }).status, 0, 'not a git repo');
  });

  test('3.11 fail closed: config not JSON or unreadable, a pattern with an invalid regex, wrong shapes, unparseable stdin, a non-string content', () => {
    const root = deploy();
    const cfgFile = path.join(root, '.planning', 'config.json');
    const expectDeny = (r, why) => {
      assert.strictEqual(r.status, 2, `${why}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stderr.includes('fail closed'), `${why}: ${r.stderr}`);
    };
    fs.writeFileSync(cfgFile, '{not json');
    expectDeny(write(root, 'x'), 'not JSON, even for a harmless write');
    fs.rmSync(cfgFile);
    fs.mkdirSync(cfgFile);
    expectDeny(write(root, 'x'), 'config path is a directory (unreadable)');
    fs.rmdirSync(cfgFile);
    const shapes = [
      ['invalid regex', flakeConfig({ patterns: [{ id: 'bad', match: '(unclosed', message: 'm' }] })],
      ['invalid requires_before', flakeConfig({ patterns: [{ id: 'bad', match: 'x', requires_before: '[', message: 'm' }] })],
      ['invalid unless_nearby', flakeConfig({ patterns: [{ id: 'bad', match: 'x', unless_nearby: '*a', message: 'm' }] })],
      ['pattern without match', flakeConfig({ patterns: [{ id: 'bad', message: 'm' }] })],
      ['window 0', flakeConfig({ patterns: [{ id: 'bad', match: 'x', window: 0, message: 'm' }] })],
      ['test_globs not an array', flakeConfig({ test_globs: 'x' })],
      ['patterns not an array', flakeConfig({ patterns: 'x' })],
      ['stack not an object', { stack: 'x' }],
      ['config not an object', ['x']],
    ];
    for (const [why, cfg] of shapes) {
      fs.writeFileSync(cfgFile, JSON.stringify(cfg));
      expectDeny(write(root, 'x'), why);
    }
    fs.writeFileSync(cfgFile, JSON.stringify(flakeConfig()));
    expectDeny(runFlake(root, '', {}, { raw: '{not json' }), 'unparseable stdin');
    expectDeny(runFlake(root, '', {}, { raw: '[1]' }), 'stdin is not an object');
    expectDeny(runFlake(root, 'Write', 'text'), 'tool_input is not an object');
    expectDeny(runFlake(root, 'Write', { file_path: FILE, content: 42 }), 'non-string content');
  });

  test('3.11 the config comes from the git toplevel of the tool call cwd, never from CLAUDE_PROJECT_DIR', () => {
    const configured = deploy();
    const empty = gitRepo({ project: { slug: 'other' }, stack: { capabilities: {} } });
    assert.strictEqual(write(configured, HOUR, FILE, { cwd: configured, projectDir: empty }).status, 2);
    assert.strictEqual(write(configured, HOUR, FILE, { cwd: empty, projectDir: configured }).status, 0);
    const sub = path.join(configured, 'src');
    fs.mkdirSync(sub);
    assert.strictEqual(write(configured, HOUR, FILE, { cwd: sub, projectDir: empty }).status, 2, 'subdirectory finds the toplevel config');
  });

  test('3.11 a missing node is a deny that names the tool (the wrapper uses only builtins)', () => {
    const root = deploy();
    const noPath = mkTmp('gsd-base-nopath-');
    const r = runFlake(root, 'Write', { file_path: FILE, content: 'x' }, { shell: '/bin/bash', env: { PATH: noPath } });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(/node not found/.test(r.stderr), r.stderr);
  });

  const BACKTRACK = flakeConfig({ patterns: [{ id: 'bt', match: '^(a+)+$', message: 'never reached' }] });
  const BT_CONTENT = `${'a'.repeat(40)}!\n`;

  test('3.8 C8 a flake_patterns regex that backtracks is cut at 10 s and denied, fail closed, naming the limit; a normal edit is not delayed', () => {
    const root = deploy(BACKTRACK);
    const t0 = Date.now();
    const r = write(root, BT_CONTENT);
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('10 s'), r.stderr);
    assert.ok(Date.now() - t0 < 15000, `elapsed ${Date.now() - t0} ms`);
    const t1 = Date.now();
    assert.strictEqual(write(root, 'const ok = 1;\n').status, 0);
    assert.ok(Date.now() - t1 < 5000);
  });

  test('3.8 C8 mutant killed: the alarm removed lets a scan that outlives the limit finish instead of failing closed', () => {
    const root = deploy();
    const fakeBin = mkTmp('gsd-base-fakenode-');
    fs.writeFileSync(path.join(fakeBin, 'node'), '#!/bin/bash\nsleep 12\n', { mode: 0o755 });
    const env = { PATH: `${fakeBin}:${process.env.PATH}` };
    const input = { cwd: root, env };
    assert.strictEqual(write(root, 'x', FILE, input).status, 2, 'with the alarm a 12 s scan is cut at 10 s');
    const mutated = mkTmp('gsd-base-mutant-');
    fs.cpSync(hooksDir(root), mutated, { recursive: true });
    const sh = path.join(mutated, 'check-flake-patterns.sh');
    const source = fs.readFileSync(sh, 'utf8');
    const needle = "'alarm shift; exec @ARGV or exit 127'";
    assert.ok(source.includes(needle), 'mutation site present');
    fs.writeFileSync(sh, source.replace(needle, () => "'shift; exec @ARGV or exit 127'"));
    const r = spawnSync('bash', [sh], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: FILE, content: 'x' }, cwd: root }),
      encoding: 'utf8', cwd: root, env: { ...process.env, ...env },
    });
    assert.strictEqual(r.status, 0, 'the mutant lets the slow scan through');
  });

  test('3.11 --all in a tmp repo exits 1 naming file, line and pattern id, and 0 after a justified ignore; no patterns exits 0', () => {
    const root = deploy();
    const gateFile = path.join(hooksDir(root), 'lib', 'flake-gate.mjs');
    const file = path.join(root, 'src', 'a.integration.test.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `const ok = 1;\n${HOUR}`);
    assert.strictEqual(spawnSync('git', ['-C', root, 'add', 'src/a.integration.test.ts']).status, 0);
    const scan = () => spawnSync(process.execPath, [gateFile, '--all'], { cwd: root, encoding: 'utf8' });
    const red = scan();
    assert.strictEqual(red.status, 1, red.stdout + red.stderr);
    assert.ok(red.stderr.includes('src/a.integration.test.ts:2: [absolute-time-window]'), red.stderr);
    fs.writeFileSync(file, `const ok = 1;\n// flake-ignore: window fixed by design\n${HOUR}`);
    const green = scan();
    assert.strictEqual(green.status, 0, green.stdout + green.stderr);
    assert.ok(green.stdout.includes('(suppressed) src/a.integration.test.ts:3'), green.stdout);
    fs.writeFileSync(file, `const ok = 1;\n// flake-ignore\n${HOUR}`);
    assert.strictEqual(scan().status, 1, 'a marker without a reason still fails the gate');
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify(flakeConfig({ patterns: [] })));
    assert.strictEqual(scan().status, 0);
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), '{not json');
    assert.strictEqual(scan().status, 2, 'unusable config fails the gate');
  });

  test('3.11 glob matching: ** crosses directories, a slash-less glob matches the basename, * stays in one segment', async () => {
    const { globToRegExp, matchesGlobs } = await gate();
    assert.ok(matchesGlobs('a/b/x.integration.test.ts', ['**/*.integration.test.ts']));
    assert.ok(matchesGlobs('x.integration.test.ts', ['**/*.integration.test.ts']));
    assert.ok(matchesGlobs('deep/er/x.test.js', ['*.test.js']), 'basename glob');
    assert.ok(!matchesGlobs('a/b/x.test.js', ['b/*.test.js']), 'a glob with a slash is anchored to the repo path');
    assert.ok(matchesGlobs('src/b/x.js', ['src/**/x.js']));
    assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
    assert.ok(globToRegExp('a?.js').test('ab.js'));
    assert.ok(!globToRegExp('a.js').test('axjs'), 'dot is literal');
    assert.ok(matchesGlobs('E2E/A.Integration.Test.ts', ['**/*.integration.test.ts']), 'letter case never matters');
  });

  test('3.11 the runner fixture config is the worked example; the source never evaluates a pattern as code', () => {
    const runner = fs.readFileSync(RUNNER_SRC, 'utf8');
    const blocks = [...runner.matchAll(/<<'JSON'\n(.*)\nJSON\n/g)].map((m) => JSON.parse(m[1]));
    assert.strictEqual(blocks.length, 2);
    assert.deepStrictEqual(blocks[0], flakeConfig().stack.flake_patterns && { stack: { flake_patterns: { test_globs: ['**/*.integration.test.ts'], patterns: WORKED.map((p) => ({ ...p, message: blocks[0].stack.flake_patterns.patterns.find((q) => q.id === p.id).message })) } } });
    const src = fs.readFileSync(GATE_SRC, 'utf8');
    assert.doesNotMatch(src, /\beval\s*\(|new Function|vm\./);
    assert.ok(src.includes('new RegExp(source)'));
  });

  test('3.11 the runner exits 0 over the Write/Edit rows; a flipped own row and a flipped @edit-all row each fail it', () => {
    const root = deploy(flakeConfig({ patterns: [{ id: 'own', match: 'zzz-never', message: 'm' }] }));
    const runner = path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
    const runWith = (corpus) => {
      const env = { ...process.env };
      delete env.HOOKS_DIR;
      if (corpus) env.CORPUS = corpus;
      else delete env.CORPUS;
      return spawnSync('bash', [runner], { cwd: root, encoding: 'utf8', env });
    };
    const ok = runWith();
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(ok.stdout.includes('canaries: pass=892 fail=0'), ok.stdout);
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    for (const pick of [(r) => r.hook === 'check-flake-patterns.sh' && r.expect === 'deny' && r.label === 'absolute hour window', (r) => r.hook === '@edit-all']) {
      const i = rows.findIndex(pick);
      assert.ok(i >= 0);
      const flipped = rows.map((r, k) => (k === i ? { ...r, expect: r.expect === 'allow' ? 'deny' : 'allow', reason: 'x' } : r));
      const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(corpus, `${flipped.map((r) => JSON.stringify(r)).join('\n')}\n`);
      const r = runWith(corpus);
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.ok(r.stdout.includes(`:: ${rows[i].label}`), r.stdout);
    }
  });

  test('3.11 the corpus rows are not vacuous: a hook that reads CLAUDE_PROJECT_DIR instead of the cwd toplevel fails the runner', () => {
    const root = deploy(flakeConfig({ patterns: [] }));
    const mutated = mkTmp('gsd-base-mutant-');
    fs.cpSync(hooksDir(root), mutated, { recursive: true });
    const mjs = path.join(mutated, 'lib', 'flake-gate.mjs');
    const source = fs.readFileSync(mjs, 'utf8');
    const needle = '    root = there.root;';
    assert.ok(source.includes(needle), 'mutation site present');
    fs.writeFileSync(mjs, source.replace(needle, '    root = process.env.CLAUDE_PROJECT_DIR ?? null;'));
    const env = { ...process.env, HOOKS_DIR: mutated };
    delete env.CORPUS;
    const r = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes('FAIL [check-flake-patterns.sh] expect=deny got=allow'), r.stdout);
  });

  test('3.11 the corpus holds 13 own and exactly 12 @edit-all rows, none with a project term; the hook is registered on Write|Edit and guarded', () => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    assert.strictEqual(rows.filter((r) => r.hook === 'check-flake-patterns.sh').length, 28);
    const shared = rows.filter((r) => r.hook === '@edit-all');
    assert.strictEqual(shared.length, 13);
    assert.ok(shared.every((r) => r.expect === 'allow'));
    for (const r of [...shared, ...rows.filter((x) => x.hook === 'check-flake-patterns.sh')]) assert.doesNotMatch(JSON.stringify(r), PROJECT_TERM, r.label);
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    const group = frag.hooks.PreToolUse.find((g) => g.matcher === 'Write|Edit|MultiEdit');
    assert.deepStrictEqual(group.hooks, [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-flake-patterns.sh', timeout: 15 }]);
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const mine = preset.files.filter((x) => /check-flake-patterns|flake-gate/.test(x.dest));
    assert.strictEqual(mine.length, 2);
    for (const f of mine) assert.strictEqual(f.guarded, true, f.dest);
  });
});

describe('base preset: hook-change tooling (agnostic-M-03 3.10)', () => {
  const APPLY_SRC = path.join(BASE, 'scripts', 'hooks-apply.sh');
  const TRAILER_SRC = path.join(BASE, 'scripts', 'validation', 'hook-patch-trailer-check.sh');
  const applyOf = (root) => path.join(root, 'scripts', 'hooks-apply.sh');
  const trailerOf = (root) => path.join(root, 'scripts', 'validation', 'hook-patch-trailer-check.sh');
  const hookOf = (root) => path.join(root, '.claude', 'hooks', 'redirect-recursive-search.sh');
  const HOOK_REL = path.join('.claude', 'hooks', 'redirect-recursive-search.sh');
  const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
  // -c flags keep the fixture commits independent of the machine's git identity and global hooks.
  const git = (root, args) => spawnSync('git', ['-c', 'user.name=gsd-test', '-c', 'user.email=gsd-test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  const gitOk = (root, args) => {
    const r = git(root, args);
    assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r;
  };
  // Deploys base into a fresh repo and commits the deployed tree as the first commit (the deploy commit).
  function deployedRepo() {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const r = runInit(root, mkTmp('gsd-base-home-'));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', 'chore: deploy base']);
    return root;
  }
  // The patch is a real `git diff` of an in-place edit, reverted before returning, so its context matches the commit.
  function patchFor(root, transform) {
    const target = hookOf(root);
    const original = fs.readFileSync(target, 'utf8');
    let diff;
    try {
      fs.writeFileSync(target, transform(original));
      diff = spawnSync('git', ['-C', root, 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', HOOK_REL], { encoding: 'utf8' });
    } finally {
      fs.writeFileSync(target, original);
    }
    assert.strictEqual(diff.status, 0, diff.stderr);
    return diff.stdout;
  }
  // Writes the patch and a review file whose patch-sha256 matches the patch bytes, as hooks-apply requires.
  function writePatch(root, id, patch) {
    const dir = path.join(root, '.planning', 'hook-patches');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.patch`), patch);
    fs.writeFileSync(path.join(dir, `${id}.review.md`), `patch-sha256: ${sha256(patch)}\nsonnet-zero-findings: yes\nopus-review: not-needed\n`);
  }
  const runApply = (root, args) => spawnSync('bash', [applyOf(root), ...args], { cwd: root, encoding: 'utf8' });
  const runTrailer = (root, args = []) => spawnSync('bash', [trailerOf(root), ...args], { cwd: root, encoding: 'utf8' });
  function editHookAndCommit(root, message) {
    fs.appendFileSync(hookOf(root), '# fixture edit\n');
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', message]);
  }

  test('3.10 both scripts are deployed by init, executable, and registered in preset.json as guarded whole files', () => {
    const root = deployedRepo();
    for (const p of [applyOf(root), trailerOf(root)]) assert.ok((fs.statSync(p).mode & 0o111) !== 0, `executable: ${p}`);
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const mine = preset.files.filter((f) => /hooks-apply|hook-patch-trailer/.test(f.dest));
    assert.deepStrictEqual(mine.map((f) => [f.dest, f.kind, f.render, f.guarded]), [
      ['scripts/hooks-apply.sh', 'whole', false, true],
      ['scripts/validation/hook-patch-trailer-check.sh', 'whole', false, true],
    ]);
  });

  test('3.10 neither script names FLOOR_DEFAULT, a 40-hex commit literal or CEO, in the source or in the deployed copy', () => {
    const root = deployedRepo();
    for (const p of [APPLY_SRC, TRAILER_SRC, applyOf(root), trailerOf(root)]) {
      const text = fs.readFileSync(p, 'utf8');
      assert.doesNotMatch(text, /FLOOR_DEFAULT/, p);
      assert.doesNotMatch(text, /\b[0-9a-f]{40}\b/, p);
      assert.doesNotMatch(text, /CEO/, p);
    }
  });

  test('3.10 hooks-apply --dry-run on a patch that adds one comment line exits 0, names the copy, and leaves the deployed hook unchanged', () => {
    const root = deployedRepo();
    const before = fs.readFileSync(hookOf(root), 'utf8');
    writePatch(root, 'tooling-comment', patchFor(root, (s) => `${s}# comment added by fixture\n`));
    const r = runApply(root, ['tooling-comment', '--dry-run']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('dry-run: patched copy at .tmp/hook-try/tooling-comment'), r.stdout);
    assert.ok(r.stdout.includes('canaries: pass=892 fail=0'), r.stdout);
    assert.strictEqual(fs.readFileSync(hookOf(root), 'utf8'), before);
  });

  test('R2 L6 hooks-apply runs the canaries with a clean HOOKS_DIR and CORPUS: inherited values cannot redirect them; without the env -u a bogus CORPUS fails the run', () => {
    const root = deployedRepo();
    writePatch(root, 'tooling-comment', patchFor(root, (s) => `${s}# comment added by fixture\n`));
    const bogus = { ...process.env, HOOKS_DIR: path.join(mkTmp('gsd-base-nohooks-'), 'none'), CORPUS: path.join(mkTmp('gsd-base-nocorpus-'), 'none.jsonl') };
    const ok = spawnSync('bash', [applyOf(root), 'tooling-comment', '--dry-run'], { cwd: root, encoding: 'utf8', env: bogus });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(ok.stdout.includes('canaries: pass=892 fail=0'), ok.stdout);
    const copy = path.join(root, 'scripts', 'hooks-apply-mutant.sh');
    const source = fs.readFileSync(applyOf(root), 'utf8');
    assert.ok(source.includes('env "${ev[@]}" "$1"'), 'mutation site present');
    fs.writeFileSync(copy, source.replace('env "${ev[@]}" "$1"', '"$1"'));
    const bad = spawnSync('bash', [copy, 'tooling-comment', '--dry-run'], { cwd: root, encoding: 'utf8', env: bogus });
    assert.notStrictEqual(bad.status, 0, bad.stdout);
  });

  test('3.10 hooks-apply --dry-run on a patch that makes the deny rows fail exits non-zero, names the failing hook, and leaves the deployed hook unchanged', () => {
    const root = deployedRepo();
    const before = fs.readFileSync(hookOf(root), 'utf8');
    const patch = patchFor(root, (s) => s.replace('PATH="$PATH:/usr/bin:/bin"\n', 'PATH="$PATH:/usr/bin:/bin"\nexit 0\n'));
    assert.ok(patch.includes('+exit 0'), 'fixture patch inserts the allow-all exit');
    writePatch(root, 'tooling-allow-all', patch);
    const r = runApply(root, ['tooling-allow-all', '--dry-run']);
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /FAIL \[redirect-recursive-search\.sh\] expect=deny got=allow/);
    assert.strictEqual(fs.readFileSync(hookOf(root), 'utf8'), before);
  });

  // A patch for new files, made by git itself so quoting and tab-suffixed headers are exactly what git emits.
  function newFilePatch(root, rel, text) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    gitOk(root, ['add', '-N', '--', rel]);
    const diff = spawnSync('git', ['-C', root, 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', rel], { encoding: 'utf8' });
    gitOk(root, ['rm', '-q', '--cached', '--', rel]);
    fs.rmSync(abs);
    assert.strictEqual(diff.status, 0, diff.stderr);
    return diff.stdout;
  }
  const ROOT_DIR = ['.claude', 'hooks'].join('/');

  test('F8 a patch path with a space is kept whole: refused outside the hooks directory by its full name, applied in a dry run inside it', () => {
    const root = deployedRepo();
    writePatch(root, 'space-out', newFilePatch(root, 'scripts/my file.sh', 'x\n'));
    const out = runApply(root, ['space-out', '--dry-run']);
    assert.notStrictEqual(out.status, 0);
    assert.ok(out.stderr.includes("patch touches 'scripts/my file.sh'"), out.stderr);
    writePatch(root, 'space-in', newFilePatch(root, `${ROOT_DIR}/lib/a b.txt`, 'x\n'));
    const ok = runApply(root, ['space-in', '--dry-run']);
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.strictEqual(fs.readFileSync(path.join(root, '.tmp', 'hook-try', 'space-in', 'lib', 'a b.txt'), 'utf8'), 'x\n');
  });

  test('F8 a patch path holding a control character or a newline is refused naming the control character', () => {
    const root = deployedRepo();
    for (const [id, name] of [['ctl-tab', 'a\tb.txt'], ['ctl-nl', 'a\nb.txt']]) {
      writePatch(root, id, newFilePatch(root, `${ROOT_DIR}/lib/${name}`, 'x\n'));
      const r = runApply(root, [id, '--dry-run']);
      assert.notStrictEqual(r.status, 0, id);
      assert.ok(r.stderr.includes('control character or newline'), r.stderr);
    }
  });

  test('F8 the script never expands the path list unquoted', () => {
    const src = fs.readFileSync(APPLY_SRC, 'utf8');
    assert.doesNotMatch(src.replace(/\$\{PATHS\[[@*]\]\}/g, ''), /\$PATHS\b/);
    assert.ok(src.includes('PATHS+=("$f")'));
  });

  test('3.10 trailer check with no flag passes when the only commit touching the guarded paths is the deploy commit (floor = that commit)', () => {
    const root = deployedRepo();
    const r = runTrailer(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /scanned 0 commit\(s\) in .*\.\.HEAD touching .*; 0 without a Hook-Patch trailer/);
  });

  test('3.10 trailer check with no flag fails naming an unreviewed hook commit after the deploy commit', () => {
    const root = deployedRepo();
    editHookAndCommit(root, 'fix(hooks): unreviewed edit');
    const r = runTrailer(root);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes('missing Hook-Patch:'), r.stderr);
    assert.ok(r.stderr.includes('fix(hooks): unreviewed edit'), r.stderr);
  });

  test('3.10 the same hook commit carrying a Hook-Patch trailer passes and is counted as scanned', () => {
    const root = deployedRepo();
    editHookAndCommit(root, 'fix(hooks): reviewed edit\n\nHook-Patch: tooling-reviewed');
    const r = runTrailer(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /scanned 1 commit\(s\) .* 0 without a Hook-Patch trailer/);
  });

  test('3.10 an unresolvable --floor exits 1 and names the floor; a floor that is not an ancestor of HEAD exits 1 and names it', () => {
    const root = deployedRepo();
    const bogus = '0123456789abcdef0123456789abcdef01234567';
    const unresolved = runTrailer(root, ['--floor', bogus]);
    assert.strictEqual(unresolved.status, 1, unresolved.stdout);
    assert.ok(unresolved.stderr.includes(bogus), unresolved.stderr);

    gitOk(root, ['checkout', '-q', '-b', 'tooling-side']);
    gitOk(root, ['commit', '-q', '--allow-empty', '-m', 'side work']);
    const side = gitOk(root, ['rev-parse', 'HEAD']).stdout.trim();
    gitOk(root, ['checkout', '-q', '-']);
    gitOk(root, ['commit', '-q', '--allow-empty', '-m', 'main work']);
    const notAncestor = runTrailer(root, ['--floor', side]);
    assert.strictEqual(notAncestor.status, 1, notAncestor.stdout);
    assert.ok(notAncestor.stderr.includes('is not an ancestor of HEAD'), notAncestor.stderr);
  });

  const RUNNER = path.join('scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
  const CORPUS = path.join('scripts', 'validation', 'hook-canaries', 'canaries.jsonl');
  test('3.8 C9 a commit that edits the canary runner without a trailer fails naming it; with the trailer it passes', () => {
    const root = deployedRepo();
    fs.appendFileSync(path.join(root, RUNNER), '# fixture edit\n');
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', 'chore: runner edit']);
    const bare = runTrailer(root);
    assert.strictEqual(bare.status, 1, bare.stdout + bare.stderr);
    assert.ok(bare.stderr.includes('chore: runner edit'), bare.stderr);
    const other = deployedRepo();
    fs.appendFileSync(path.join(other, RUNNER), '# fixture edit\n');
    gitOk(other, ['add', '-A']);
    gitOk(other, ['commit', '-q', '-m', 'chore: runner edit\n\nHook-Patch: runner-reviewed']);
    assert.strictEqual(runTrailer(other).status, 0);
  });

  test('3.8 C9 a commit that deletes one canary row fails naming the removal; a commit that only appends a row passes', () => {
    const root = deployedRepo();
    const lines = fs.readFileSync(path.join(root, CORPUS), 'utf8').split('\n');
    fs.writeFileSync(path.join(root, CORPUS), lines.slice(1).join('\n'));
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', 'chore: drop a canary row']);
    const removed = runTrailer(root);
    assert.strictEqual(removed.status, 1, removed.stdout + removed.stderr);
    assert.ok(removed.stderr.includes('chore: drop a canary row (removes or rewrites 1 canary row(s))'), removed.stderr);

    const appended = deployedRepo();
    fs.appendFileSync(path.join(appended, CORPUS), '{"hook":"check-denied-command.sh","expect":"allow","tool":"Bash","input":{"command":"true"},"cwd":"@repo-feature","label":"fixture","class":"fixture"}\n');
    gitOk(appended, ['add', '-A']);
    gitOk(appended, ['commit', '-q', '-m', 'chore: add a canary row']);
    assert.strictEqual(runTrailer(appended).status, 0, runTrailer(appended).stderr);
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
    'docs/gsd/defect-classes.md',
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
    assert.strictEqual(mirrors.length, 86, 'one base copy per preset file (not the settings, gitignore or manifest)');
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

describe('base preset: engineering lessons and defect classes (agnostic-M-08 8.3)', () => {
  test('8.3 defect-classes.md has ten class rows and the four column headers; engineering-lessons.md has 6 incident pointers and 2 rescued entries', () => {
    const classes = fs.readFileSync(path.join(BASE, 'docs', 'defect-classes.md'), 'utf8');
    assert.ok(classes.includes('| Defect class | Origin (commit, phase) | Escaped gate | Evidence (file:line; rule or gate cite) |'), 'four column headers');
    const rows = classes.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Defect class') && !l.startsWith('|---'));
    assert.strictEqual(rows.length, 10, 'ten class rows');
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

describe('base preset: default gates run clean in a fresh project (agnostic-M-09 9.13)', () => {
  test('G-d every default gate command exits 0 from the project root of a fresh base init, the style gate included', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const init = runInit(root, mkTmp('gsd-base-home-'));
    assert.strictEqual(init.status, 0, init.stderr);
    // The patch-trailer gate reads HEAD, so the project needs one commit, as every real project has.
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(git('add', '-A').status, 0);
    assert.strictEqual(git('commit', '-q', '-m', 'init').status, 0);
    const gates = configOf(root).stack.gates;
    assert.deepStrictEqual(gates.map((g) => g.id), ['hook-canaries', 'hook-patch-trailer', 'guard-canaries', 'guard-registry', 'style', 'flake-patterns', 'dependency-scan', 'adr', 'assertion-quality']);
    for (const g of gates) {
      const r = spawnSync(g.run, { cwd: root, shell: true, encoding: 'utf8', timeout: 120000 });
      assert.strictEqual(r.status, 0, `${g.id} (${g.run}) exited ${r.status}\n${r.stdout}\n${r.stderr}`);
    }
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
    'docs/gsd/agent-ops-lessons.md', 'docs/gsd/defect-classes.md', 'docs/gsd/engineering-lessons.md', 'docs/gsd/file-claims-template.md',
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
      assert.strictEqual(plan.risk_domains_source, 'brief', k);
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
    write(root, `${dir}/45-01-SUMMARY.md`, '# Summary\n\n## Defect Classes\n\nNone found. (reviewed by: plan-check, verifier)\n\n## Self-Check: PASSED\n');
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
