'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const vm = require('vm');

const HOOK = path.join(__dirname, 'gsd-ui-qa-lock.js');
const {
  matchesResetPattern, normalizeCapability, resolveHolderPid, isLockLive, buildLock, handle,
} = require('./gsd-ui-qa-lock.js');
const { commandSegments } = require('./lib/ui-qa-shell.js');
const LANE = require('./lib/ui-qa-legacy-lane.js');
const ORACLE = require('../../../tests/fixtures/agnostic/ui-qa-lock-verdicts.json');
const OLD = require('../../../tests/fixtures/agnostic/gsd-charlotte-lock.0b9c35a.js');
const FIXTURE_TEXT = fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/agnostic/gsd-charlotte-lock.0b9c35a.js'), 'utf8');

const NOW = Date.parse('2026-09-24T12:00:00Z');
const LOCK_REL = path.join('.tmp', 'charlotte.lock');
// The fixture literals reproduce the five built-in patterns of the former hook (see the oracle row checks below).
const FIXTURE_RESET_PATTERNS = [
  'supabase db reset', 'preflight.sh', 'db:reset', 'db-reset', 'supabase:reset', 'supabase-reset', 'test:regression', '--reset-db',
];
const FIXTURE_UI_QA = {
  driver: 'charlotte',
  agent: 'gsd-charlotte-qa',
  tool_prefix: 'mcp__charlotte__',
  reset_patterns: FIXTURE_RESET_PATTERNS,
  lock_wrappers: ['stack-lock.sh', 'stack-lock.ts'],
  lock_file: LOCK_REL,
};
const FIXTURE = { resetPatterns: FIXTURE_RESET_PATTERNS, lockWrappers: FIXTURE_UI_QA.lock_wrappers };

describe('matchesResetPattern (fixture literals)', () => {
  const positives = [
    'supabase db reset',
    'npx supabase db reset',
    'cd apps/api && npx supabase db reset --local',
    'npx -y supabase@2.40.0 db reset',
    'SUPABASE_DEBUG=1 supabase --workdir apps/api db reset',
    './node_modules/.bin/supabase db reset',
    'pnpm exec supabase db reset',
    'nx run api:supabase:reset',
    'npx nx run api:supabase:reset',
    'npm run db:reset',
    'deno task db:reset',
    'bash -c "supabase db reset"',
    'echo start; supabase db reset',
    'scripts/preflight.sh --backend',
    'bash scripts/preflight.sh',
    'timeout 600 supabase db reset',
    'gtimeout 10m npx supabase db reset',
    'nohup supabase db reset',
    '/usr/bin/env supabase db reset',
    'if true; then supabase db reset; fi',
    'eval supabase db reset',
    'nice -n 10 supabase db reset',
    'deno task --cwd apps/api db:reset',
    'npm --prefix apps/api run db:reset',
    'cd apps/e2e-charlotte && deno task test' + ':regression',
    'deno run --allow-all runner/run.ts --tags=regression --reset-db',
    'scripts/stack-lock.sh --label q -- npx supabase db reset',
    'scripts/stack-lock.sh --label q -- scripts/preflight.sh',
    'scripts/stack-lock.sh --label q -- bash scripts/preflight.sh --all',
    'deno run -A scripts/stack-lock.ts --label q -- supabase db reset',
    'cd /repo && ./scripts/stack-lock.sh --label q --timeout 30 -- npx supabase db reset',
    // R3 M1: a trailing backslash glued to the command word is not part of its name.
    'sh -c "bash -c \\"a && ./scripts/preflight.sh\\""',
    'bash -c "echo a; ./scripts/preflight.sh\\""',
    'x; ./preflight.sh\\',
    // R3 L-a: each lock wrapper's ` -- ` is a split point, not only the first one.
    'stack-lock.sh -- stack-lock.sh -- supabase db reset',
    'scripts/stack-lock.sh --label q -- scripts/stack-lock.ts --label r -- npx supabase db reset',
    // R3 M2: combined shell flags (-lc, -ic, -c'x') open a quoted command; a leading quote is not part of the name.
    'bash -lc "supabase db reset"',
    'zsh -ic "npm run db:reset"',
    "sh -c'supabase db reset'",
    'timeout 5 "supabase db reset"',
    '"supabase db reset"',
  ];
  for (const cmd of positives) {
    test(`blocks: ${cmd}`, () => assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true));
  }
  const negatives = [
    'supabase db push',
    'supabase status',
    'npx supabase migration new foo',
    'git commit -m "docs: explain supabase db reset"',
    'grep -rn "supabase db reset" docs',
    'cat docs/db-reset.md',
    'nx run api:test',
    'deno task test' + ':unit',
    'npm run build',
    'git commit -- scripts/preflight.sh',
    'git commit -m x -- scripts/preflight.sh',
    'git add -- scripts/preflight.sh',
    'git diff HEAD -- scripts/preflight.sh',
    'scripts/stack-lock.sh --label q -- git commit -- scripts/preflight.sh',
    'scripts/stack-lock.sh --label q -- npx supabase status',
    'stack-lock.sh --help; git log -- scripts/preflight.sh',
    '',
    undefined,
  ];
  for (const cmd of negatives) {
    test(`allows: ${JSON.stringify(cmd)}`, () => assert.strictEqual(matchesResetPattern(cmd, FIXTURE), false));
  }

  test('m3: a literal dot matches only a dot (preflight.sh does not match preflightXsh)', () => {
    assert.strictEqual(matchesResetPattern('scripts/preflightXsh --all', FIXTURE), false);
    assert.strictEqual(matchesResetPattern('npm run preflightXsh', FIXTURE), false);
  });
  test('m4: wrapper stripping is applied (timeout N in front of the reset)', () => {
    assert.strictEqual(matchesResetPattern('timeout 600 supabase db reset', FIXTURE), true);
  });
  test('m5: segments are split at ; (echo db; echo reset is not a reset)', () => {
    assert.strictEqual(matchesResetPattern('echo db; echo reset', FIXTURE), false);
  });
  test('m5: the lock-wrapper -- split is tied to the wrapper (a git -- is not a split)', () => {
    assert.strictEqual(matchesResetPattern('git commit -- scripts/preflight.sh', FIXTURE), false);
  });
  test('a configured literal that is not in the built-in set is matched as a token sequence', () => {
    assert.strictEqual(matchesResetPattern('deno task wipe:all', { resetPatterns: ['wipe:all'], lockWrappers: [] }), true);
    assert.strictEqual(matchesResetPattern('deno task wipe:all', { resetPatterns: ['db reset'], lockWrappers: [] }), false);
  });
});

describe('verdict oracle: the renamed hook gives the old hook verdict on every recorded command', () => {
  test('the oracle has 78 rows, 55 of them blocked (72/48 original rows kept; 5 H1 rows added; 1 R4 pinned change; 1 R5 GAP pinned change)', () => {
    assert.strictEqual(ORACLE.length, 78);
    assert.strictEqual(ORACLE.filter((r) => r.blocked).length, 55);
  });
  test('every row matches the recorded verdict', () => {
    const mismatches = ORACLE.filter((r) => matchesResetPattern(r.command, FIXTURE) !== r.blocked).map((r) => r.command);
    assert.deepStrictEqual(mismatches, []);
  });
  test('the only rows that differ from the old hook are the pinned R4 and R5 GAP changes, each with its reason', () => {
    const changed = ORACLE.filter((r) => OLD.isDbResetCommand(r.command) !== r.blocked);
    assert.deepStrictEqual(changed.map((r) => r.command).sort(), ['bash -n scripts/preflight.sh', 'echo "--reset-db"']);
    assert.match(changed.find((r) => r.command === 'bash -n scripts/preflight.sh').intentional, /R4 ruling/);
    assert.match(changed.find((r) => r.command === 'echo "--reset-db"').intentional, /R5 GAP/);
  });
});

// R4 differential proof: every command the frozen hook (0b9c35a) blocks is blocked, over the oracle corpus and
// generated mutations: quoted or metacharacter assignments, quoted flags, env/npx prefixes, empty-quote and
// backslash injection into each token.
describe('R4 differential: old-blocked => new-blocked over the oracle corpus and generated mutations', () => {
  const ASSIGNS = ['A=$(pwd) ', 'A=${HOME} ', "A='a|b' ", 'A="x;y" ', 'A=a\\;b ', 'A=`pwd` ', "A=$'x' ", 'A=x""y '];
  const FLAGS = ['npx --registry="a;b" ', "npx --registry='a|b' ", 'npx --tag="x y" '];
  const PREFIXES = ['env A=1 ', 'npx ', 'npx --yes ', 'timeout 5 ', 'nohup ', 'sudo ', '"', "'"];
  const mutations = (cmd) => {
    const out = new Set([cmd, ...[...ASSIGNS, ...FLAGS, ...PREFIXES].map((p) => p + cmd)]);
    const tokens = cmd.split(' ');
    tokens.forEach((t, k) => {
      if (t.length < 2) return;
      for (const v of [`${t[0]}""${t.slice(1)}`, `${t[0]}''${t.slice(1)}`, `\\${t}`]) {
        out.add([...tokens.slice(0, k), v, ...tokens.slice(k + 1)].join(' '));
      }
    });
    return [...out];
  };
  // Round 5 A: no exceptions. `-""-`, `-''-` and `\--` are blocked by the legacy lane (raw command, the old
  // hook's own floor); the tokenizer normalises them to `--` (pinned under KEEP).
  test('no old-blocked mutation is allowed by the new matcher', () => {
    const escapes = [];
    let oldBlocked = 0;
    for (const base of ORACLE.map((r) => r.command)) for (const cmd of mutations(base)) {
      if (!OLD.isDbResetCommand(cmd)) continue;
      oldBlocked += 1;
      if (!matchesResetPattern(cmd, FIXTURE)) escapes.push(cmd);
    }
    assert.ok(oldBlocked > 1000, `old matcher blocked only ${oldBlocked} mutated commands`);
    assert.deepStrictEqual(escapes, []);
    assert.strictEqual(matchesResetPattern('scripts/stack-lock.sh --label q -- git commit -- scripts/preflight.sh', FIXTURE), false);
  });

  // Round 6 proof (ii): the legacy lane alone blocks every command the old hook blocks, over the oracle, these mutations
  // and the round-6 commands.
  test('round 6 (ii): OLD blocks => the legacy lane alone blocks, over the oracle, the mutations and the round-6 commands', () => {
    const escapes = [];
    let oldBlocked = 0;
    const corpus = [...ORACLE.map((r) => r.command).flatMap(mutations), ...ROUND6];
    for (const cmd of corpus) {
      if (!OLD.isDbResetCommand(cmd)) continue;
      oldBlocked += 1;
      if (!LANE.legacyLaneMatches(cmd, FIXTURE)) escapes.push(cmd);
    }
    assert.ok(oldBlocked > 1000, `old matcher blocked only ${oldBlocked}`);
    assert.deepStrictEqual(escapes, []);
  });
});

// Round 6 R6 commands: the old hook blocks them; the round-5 matcher allowed them (red at HEAD before the legacy lane).
const ROUND6 = [
  './preflight.sh${IFS}--x', './preflight.sh$X', './preflight.sh>log', './preflight.sh*', './preflight.sh"$X"',
  'nx run @org/api:supabase:reset', 'nx run apps/api:supabase:reset', 'nx run $P:supabase:reset',
  'npm run --x 2>&1 db:reset', 'deno task --x 1>&2 db-reset', 'bash -c "supabase --x "$(pwd)" db reset"',
];

describe('round 6 R6: named canaries for the eleven commands the old hook blocks and the round-5 matcher allowed', () => {
  for (const cmd of ROUND6) {
    test(`blocks canary: ${cmd}`, () => {
      assert.strictEqual(OLD.isDbResetCommand(cmd), true);
      assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true);
    });
  }
});

// Round 6 proof (i): the builder given OLD's fragments (extracted from the fixture text at test time) produces the five
// OLD sources byte for byte; the fragments the lane copies equal the fixture's.
describe('round 6 proof (i): legacy lane templates are byte-equal to the fixture', () => {
  const start = FIXTURE_TEXT.indexOf('const PREFIX');
  const end = FIXTURE_TEXT.indexOf('\n];', FIXTURE_TEXT.indexOf('const RESET_PATTERNS')) + 3;
  const OLD_BLOCK = vm.runInNewContext(`${FIXTURE_TEXT.slice(start, end)}\n({ PREFIX, FLAGS, RUNNER, TASK_FLAGS, RESET_PATTERNS })`);
  test('the fixture block extracts five RESET_PATTERNS', () => assert.strictEqual(OLD_BLOCK.RESET_PATTERNS.length, 5));
  test('fragments: prefix (with the fixture wrapper alternative), RUNNER, FLAGS and TASK_FLAGS equal the fixture text', () => {
    assert.strictEqual(LANE.prefix('stack-lock\\.(?:sh|ts)'), OLD_BLOCK.PREFIX);
    assert.strictEqual(LANE.FLAGS, OLD_BLOCK.FLAGS);
    assert.strictEqual(LANE.RUNNER, OLD_BLOCK.RUNNER);
    assert.strictEqual(LANE.TASK_FLAGS, OLD_BLOCK.TASK_FLAGS);
  });
  test('the five shapes built from the fixture slots have the fixture .source, in the fixture order', () => {
    const built = LANE.buildLegacyShapes({
      wrapperAlt: 'stack-lock\\.(?:sh|ts)',
      multi: [['supabase', 'db', 'reset']],
      nxAlt: '(?:supabase|db)[:-]reset',
      taskAlts: ['[\\w:.-]*\\b(?:supabase|db)[:-]reset', 'test:regression'],
      flags: ['--reset-db'],
      scriptAlt: 'preflight\\.sh',
    });
    assert.deepStrictEqual(built.map((re) => re.source), Array.from(OLD_BLOCK.RESET_PATTERNS, (re) => re.source));
  });
  test('the profile spec produces the same five shapes for the fixture literals (superset of the old literal set)', () => {
    const shapes = LANE.legacyPatterns(FIXTURE);
    assert.strictEqual(shapes.length, 5);
    for (const cmd of ['supabase db reset', 'npx supabase db reset', 'nx run api:supabase:reset', 'deno task db-reset', 'bash scripts/preflight.sh']) {
      assert.ok(shapes.some((re) => re.test(cmd)), cmd);
    }
  });
});

// Round 6 budget: the lane gets LANE_BUDGET_MS; installer timeout 10 s; git rev-parse cap 2 s (gsd-ui-qa-lock.js).
describe('round 6 budget: the legacy lane is time-boxed below the installed hook timeout', () => {
  test('10 s installer timeout minus the 2 s git cap leaves more than the lane budget plus 4 s for startup and other lanes', () => {
    assert.ok(LANE.LANE_BUDGET_MS + 4000 <= 10000 - 2000, `budget ${LANE.LANE_BUDGET_MS} ms`);
  });
  test('a timeout blocks: the lane returns true when the regex cannot finish in the budget', () => {
    assert.strictEqual(LANE.legacyLaneMatches(`npm ${'--a '.repeat(40)}`, FIXTURE), true);
  });
  test('the 210-command benign corpus: at most 15 are blocked by the legacy lane alone', () => {
    const BENIGN = require('../../../tests/fixtures/agnostic/ui-qa-lock-benign.json');
    const blocked = BENIGN.filter((c) => LANE.legacyLaneMatches(c, FIXTURE));
    assert.ok(blocked.length <= 15, `lane blocked: ${JSON.stringify(blocked)}`);
  });
});

// R4 ruling 1 canaries (red at 761e757): a substitution, a quoted operator or an escaped `;` inside a word
// must not split or hide the reset. Quoted data (echo "...") stays allowed.
describe('R4 canaries: quote-aware split and substitution bodies', () => {
  const canaries = [
    'A=$(pwd) supabase db reset',
    'A=${HOME} supabase db reset',
    "env A='a|b' npm run db:reset",
    String.raw`A=a\;b supabase db reset`,
    'npx --registry="a;b" supabase db reset',
    "echo ok; A='x;y' supabase db reset",
  ];
  for (const cmd of canaries) {
    test(`blocks canary: ${cmd}`, () => assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true));
  }
  test('quoted reset text is data, not a command: echo "..." and echo \'...\' stay allowed (as before)', () => {
    assert.strictEqual(matchesResetPattern('echo "supabase db reset"', FIXTURE), false);
    assert.strictEqual(matchesResetPattern("echo 'supabase db reset'", FIXTURE), false);
    assert.strictEqual(matchesResetPattern("git commit -m 'supabase db reset'", FIXTURE), false);
  });
  test('a substitution body is its own segment: (supabase db reset) and `supabase db reset` block', () => {
    assert.strictEqual(matchesResetPattern('(supabase db reset)', FIXTURE), true);
    assert.strictEqual(matchesResetPattern('x=`supabase db reset`', FIXTURE), true);
  });
});

// R4 ruling 2 canaries (red at 761e757): $'' and $"" reduce to empty; empty-quote and leading-backslash
// injection normalise away; an unterminated quote or substitution fails closed.
describe('R4 canaries: quote normalisation and fail-closed on unterminated input', () => {
  const canaries = [
    './scripts/preflight.sh$\'\'',
    './scripts/preflight.sh$""',
    'sup""abase db reset',
    "supa''base db reset",
    '\\supabase db reset',
    "$'supabase db reset'",
    'echo ok && echo it\'s supabase db reset',
    'echo "unterminated supabase db reset',
  ];
  for (const cmd of canaries) {
    test(`blocks canary: ${cmd}`, () => assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true));
  }
  test('an unterminated quote fails closed even when no reset word is present', () => {
    assert.strictEqual(matchesResetPattern("echo it's fine", FIXTURE), true);
  });
  test('guard: echo $\'supabase db reset\' is data and stays allowed', () => {
    assert.strictEqual(matchesResetPattern("echo $'supabase db reset'", FIXTURE), false);
  });
});

// Differential probe against the frozen pre-rename hook (0b9c35a): every generated command the old matcher
// blocks must still be blocked. Bases are the fixture literals; prefixes are wrappers, quotes and subshell openers.
// Round 5 ruling A: the matcher is the union of the round-3 raw-command lane (761e757) and the tokenizer lane.
describe('round 5 A: legacy lane union (never looser than 761e757)', () => {
  test('a newline inside quotes is a command boundary for the old hook: blocked (the tokenizer alone allowed it)', () => {
    const cmd = 'echo "start\nsupabase db reset"';
    assert.strictEqual(OLD.isDbResetCommand(cmd), true);
    assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true);
  });
  test('a heredoc body fed to a shell is code: bash <<EOF with a reset line is blocked', () => {
    assert.strictEqual(matchesResetPattern("bash <<'EOF'\nsupabase db reset\nEOF", FIXTURE), true);
  });
});

// Round 5 ruling A2: a task runner's task word may follow quotes or backslashes (`bash -c "nx run \"api:...\""`).
describe('round 5 A2: task word behind escaped quotes', () => {
  test('bash -c "nx run \\"api:supabase:reset\\"" is blocked', () => {
    assert.strictEqual(matchesResetPattern('bash -c "nx run \\"api:supabase:reset\\""', FIXTURE), true);
  });
  test('quoted data keeps its allowance: echo "nx run api:supabase:reset" and git commit -m "nx supabase:reset fix"', () => {
    assert.strictEqual(matchesResetPattern('echo "nx run api:supabase:reset"', FIXTURE), false);
    assert.strictEqual(matchesResetPattern('git commit -m "nx supabase:reset fix"', FIXTURE), false);
  });
});

// Round 5 ruling D: a quoted -c argument is parsed once, from its unescaped text (escaped quotes are not kept).
describe('round 5 D: quoted code is parsed from its unescaped text', () => {
  test('bash -c "supabase \\"db\\" reset" is blocked (the escaped quotes are removed before the code parse)', () => {
    assert.strictEqual(matchesResetPattern('bash -c "supabase \\"db\\" reset"', FIXTURE), true);
  });
  test('a substitution inside a quoted -c argument is still parsed (nested "$(...)" reset is blocked)', () => {
    assert.strictEqual(matchesResetPattern('bash -c "echo $(echo ok) && supabase db reset"', FIXTURE), true);
  });
});

// Round 5 ruling C: heredoc bodies and `#` comments are data for the tokenizer lane. An unterminated quote
// inside them does not count; an unterminated quote anywhere else, or a heredoc with no terminator, blocks.
describe('round 5 C: heredoc bodies and # comments are data', () => {
  test('a commit with a quoted heredoc message whose body has an apostrophe is allowed', () => {
    const cmd = "git commit -m \"$(cat <<'EOF'\nfix: it's the docs for nx supabase:reset\nEOF\n)\"";
    assert.strictEqual(matchesResetPattern(cmd, FIXTURE), false);
  });
  test('a tab-stripped heredoc (<<-) body with an apostrophe is allowed', () => {
    assert.strictEqual(matchesResetPattern("cat <<-EOF\n\tit's fine\n\tEOF\n", FIXTURE), false);
  });
  test('a # comment with an apostrophe is data: echo x # it\'s supabase is allowed', () => {
    assert.strictEqual(matchesResetPattern("echo x # it's supabase", FIXTURE), false);
  });
  test('a here-string is not a heredoc: grep x <<< "it\'s fine" is allowed', () => {
    assert.strictEqual(matchesResetPattern('grep x <<< "it\'s fine"', FIXTURE), false);
  });
  test('a reset line inside a heredoc body is blocked (bash may read the body as code)', () => {
    assert.strictEqual(matchesResetPattern("cat <<'EOF'\nsupabase db reset\nEOF", FIXTURE), true);
  });
  test('a heredoc with no terminator is unclosed: blocked', () => {
    assert.strictEqual(matchesResetPattern("cat <<'EOF'\nit's\n", FIXTURE), true);
  });
  test('an unterminated quote outside a heredoc or comment still blocks', () => {
    assert.strictEqual(matchesResetPattern('echo "x" && echo it\'s', FIXTURE), true);
  });
  test('# inside a word or after { is not a comment: echo a#it\'s blocks; echo ${#arr} && supabase db reset blocks', () => {
    assert.strictEqual(matchesResetPattern("echo a#it's", FIXTURE), true);
    assert.strictEqual(matchesResetPattern('echo ${#arr} && supabase db reset', FIXTURE), true);
  });
  test('a comment hides nothing on the next line: echo x # note NEWLINE supabase db reset blocks', () => {
    assert.strictEqual(matchesResetPattern('echo x # note\nsupabase db reset', FIXTURE), true);
  });
});

// Round 5 HIGH-1: a quoted argument of a -c flag or of eval is code wherever the flag stands. Each shape is
// asserted on the matcher (union) and on the tokenizer lane alone, which must read the argument as code.
describe('round 5 HIGH-1: quoted -c and eval arguments are code at any position', () => {
  const shapes = [
    'bash -o pipefail -c "supabase db reset"',
    "sudo -u root bash -c 'supabase db reset'",
    "env -C /tmp bash -c 'supabase db reset'",
    '! bash -c "supabase db reset"',
    "builtin eval 'supabase db reset'",
    'scripts/stack-lock.sh --label q -- bash -c "supabase db reset"',
    'scripts/stack-lock.sh --label q -""- sh -c "supabase db reset"',
  ];
  for (const cmd of shapes) {
    test(`blocks: ${cmd}`, () => assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true));
    test(`the tokenizer lane alone reads the quoted argument as code: ${cmd}`, () => {
      const { segments } = commandSegments(cmd, FIXTURE.lockWrappers);
      assert.ok(segments.includes('supabase db reset'), JSON.stringify(segments));
    });
  }
});

// Round 5 GAP: a `--flag` literal is also tested against the tokenizer's normalised words, so empty-quote
// injection inside the flag (`--reset""-db`, `-""-reset-db`) cannot hide it.
describe('round 5 GAP: --flag literals see the normalised words', () => {
  test('--reset""-db is blocked', () => {
    assert.strictEqual(matchesResetPattern('deno run runner/run.ts --reset""-db', FIXTURE), true);
  });
  test('-""-reset-db is blocked', () => {
    assert.strictEqual(matchesResetPattern('deno run runner/run.ts -""-reset-db', FIXTURE), true);
  });
  test('an unrelated flag with a quoted suffix stays allowed: deno run runner/run.ts --reset""-dbx is not --reset-db', () => {
    assert.strictEqual(matchesResetPattern('deno run runner/run.ts --reset""-dbx', FIXTURE), false);
  });
});

// Round 5 KEEP: -""-, -''- and \-- are the lock-wrapper `--` after quote removal. The tokenizer splits there;
// the matcher still blocks (the legacy lane sees the raw command, as the old hook did).
describe('round 5 KEEP: empty-quote and escaped -- normalise to the lock-wrapper --', () => {
  for (const form of ['-""-', "-''-", '\\--']) {
    const cmd = `scripts/stack-lock.sh --label q ${form} git commit -- scripts/preflight.sh`;
    test(`tokenizer: ${form} splits after the wrapper, leaving git commit -- scripts/preflight.sh as code`, () => {
      const { segments } = commandSegments(cmd, ['stack-lock.sh']);
      assert.ok(segments.includes('git commit -- scripts/preflight.sh'), JSON.stringify(segments));
    });
    test(`matcher: ${form} stays blocked, as the old hook blocks it`, () => {
      assert.strictEqual(OLD.isDbResetCommand(cmd), true);
      assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true);
    });
  }
});

// Round 5 proof (i): OLD blocks => new blocks over generated families: wrappers and prefixes x quote styles x
// the fixture literals, and the oracle rows under each wrapper. Zero violations allowed.
describe('round 5 proof (i): OLD blocks => new blocks over generated wrapper x quote x literal families', () => {
  const WRAPPERS = [
    'sudo -u root ', 'env -C /tmp ', '! ', 'builtin ', 'bash -o pipefail -c ', 'setsid ', 'stdbuf -oL ',
    'su -c ', 'flock f -c ', 'find . -exec bash -c ', 'scripts/stack-lock.sh --label q -- ',
    'scripts/stack-lock.sh --label q -- bash -c ', 'scripts/stack-lock.sh --label q -""- sh -c ',
  ];
  const QUOTES = [['', ''], ["'", "'"], ['"', '"'], ['\\"', '\\"'], ["$'", "'"]];
  test('wrappers x quote styles x the 8 fixture literals', () => {
    const escapes = [];
    let oldBlocked = 0;
    for (const w of WRAPPERS) for (const [open, close] of QUOTES) for (const lit of FIXTURE_RESET_PATTERNS) {
      const cmd = `${w}${open}${lit}${close}`;
      if (!OLD.isDbResetCommand(cmd)) continue;
      oldBlocked += 1;
      if (!matchesResetPattern(cmd, FIXTURE)) escapes.push(cmd);
    }
    assert.ok(oldBlocked > 30, `old matcher blocked only ${oldBlocked} family commands`);
    assert.deepStrictEqual(escapes, []);
  });
  const CANARY_BASES = [
    'A=$(pwd) supabase db reset', 'A=${HOME} supabase db reset', "env A='a|b' npm run db:reset",
    String.raw`A=a\;b supabase db reset`, 'npx --registry="a;b" supabase db reset', "echo ok; A='x;y' supabase db reset",
    './scripts/preflight.sh$\'\'', './scripts/preflight.sh$""', 'sup""abase db reset', "supa''base db reset",
    '\\supabase db reset', "$'supabase db reset'", 'bash -c "scripts/preflight.sh"', "sh -c 'scripts/preflight.sh'",
    '(scripts/preflight.sh)', '$(scripts/preflight.sh)', 'echo hi; preflight.sh"', 'x; ./preflight.sh\\',
    'sh -c "bash -c \\"a && ./scripts/preflight.sh\\""', 'bash -lc "supabase db reset"', 'timeout 5 "supabase db reset"',
    'stack-lock.sh -- stack-lock.sh -- supabase db reset', 'bash -c "supabase db reset"', 'npm run db:reset',
  ];
  test('each oracle row and each R2-R5 canary under each wrapper: OLD blocks => new blocks', () => {
    const escapes = [];
    let oldBlocked = 0;
    const bases = [...ORACLE.map((r) => r.command), ...CANARY_BASES];
    for (const command of bases) for (const w of WRAPPERS) {
      const cmd = `${w}${command}`;
      if (!OLD.isDbResetCommand(cmd)) continue;
      oldBlocked += 1;
      if (!matchesResetPattern(cmd, FIXTURE)) escapes.push(cmd);
    }
    assert.ok(oldBlocked > 250, `old matcher blocked only ${oldBlocked} wrapped oracle commands`);
    assert.deepStrictEqual(escapes, []);
  });
});

// Round 5 proof (iii): a committed 210-command benign corpus (git, npm, deno, nx, grep, cat, echo, heredoc commits,
// comments, quoted literals). At most 15 may block; the heredoc commit shape must be allowed.
describe('round 5 proof (iii): benign corpus', () => {
  const BENIGN = require('../../../tests/fixtures/agnostic/ui-qa-lock-benign.json');
  test('the corpus has 210 commands', () => assert.strictEqual(BENIGN.length, 210));
  test('at most 15 of the 210 benign commands block', () => {
    const blocked = BENIGN.filter((c) => matchesResetPattern(c, FIXTURE));
    assert.ok(blocked.length <= 15, `blocked: ${JSON.stringify(blocked)}`);
  });
  test('the heredoc commit shape (git commit -m "$(cat <<\'EOF\' ... EOF)") is allowed', () => {
    const shape = BENIGN.find((c) => c.startsWith('git commit -m "$(cat <<\'EOF\'') && c.includes("it's"));
    assert.ok(shape, 'corpus has the heredoc commit shape');
    assert.strictEqual(matchesResetPattern(shape, FIXTURE), false);
  });
});

describe('differential probe: every command the old hook blocked is still blocked (0b9c35a)', () => {
  const BASES = [
    'supabase db reset', 'scripts/preflight.sh', 'npm run db:reset', 'deno task db-reset',
    'nx run api:supabase:reset', 'nx run api:supabase-reset', 'deno task test:regression', 'deno run runner/run.ts --reset-db',
  ];
  const PREFIXES = [
    '', 'sudo ', 'bash -c "', "sh -c '", '(', '$(', '`', 'echo hi; ', 'eval "', 'then ', 'timeout 10 ', 'env A=1 ',
    'npx ', 'exec ', 'zsh -c "', 'command ', 'nohup ', 'bash ', '{ ', '\n',
    'stack-lock.sh -- stack-lock.sh -- ', 'scripts/stack-lock.ts --label q -- stack-lock.sh --label r -- ',
    'bash -lc "', "zsh -ic '", "sh -c'", '"', "'", 'timeout 5 "',
  ];
  const SUFFIXES = [' ', '"', "'", ')', ';', '\n', ' --backend', '`', '}', '\\', '\\"'];
  test('no old-blocked command is allowed by the new matcher (probe is not vacuous)', () => {
    const escapes = [];
    let oldBlocked = 0;
    for (const base of BASES) for (const p of PREFIXES) for (const s of SUFFIXES) {
      const cmd = `${p}${base}${s}`;
      if (!OLD.isDbResetCommand(cmd)) continue;
      oldBlocked += 1;
      if (!matchesResetPattern(cmd, FIXTURE)) escapes.push(cmd);
    }
    assert.ok(oldBlocked > 1000, `old matcher blocked only ${oldBlocked} probe commands`);
    assert.deepStrictEqual(escapes, []);
  });
  test('the named H1 rows are blocked', () => {
    for (const cmd of [
      'bash -c "scripts/preflight.sh"', "sh -c 'scripts/preflight.sh'", '(scripts/preflight.sh)', '$(scripts/preflight.sh)',
      'echo hi; preflight.sh"',
    ]) assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true, cmd);
  });
});

describe('stacked wrappers (R2 H2): the old hook had no wrapper cap, the new one fails closed past 200', () => {
  test('3000 stacked sudo before a db reset is blocked (the old hook blocks it)', () => {
    const cmd = `${'sudo '.repeat(3000)}supabase db reset`;
    assert.strictEqual(OLD.isDbResetCommand(cmd), true);
    assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true);
  });
  test('200 stacked wrappers still reach the command word and are matched', () => {
    assert.strictEqual(matchesResetPattern(`${'sudo '.repeat(200)}supabase db reset`, FIXTURE), true);
    assert.strictEqual(matchesResetPattern(`${'sudo '.repeat(200)}echo ok`, FIXTURE), false);
  });
  test('R3 L-a: 5000 chained lock wrappers still reach the reset (no stack overflow, which would fail open)', () => {
    assert.strictEqual(matchesResetPattern(`${'stack-lock.sh -- '.repeat(5000)}supabase db reset`, FIXTURE), true);
  });
  test('past the cap the segment fails closed (201 wrappers over a non-reset command blocks)', () => {
    assert.strictEqual(matchesResetPattern(`${'sudo '.repeat(201)}echo ok`, FIXTURE), true);
    assert.strictEqual(matchesResetPattern(`${'sudo '.repeat(3)}echo ok`, FIXTURE), false);
  });
});

describe('resolveHolderPid', () => {
  test('skips shell/timeout wrappers to the first real ancestor', () => {
    const chain = { 100: { ppid: 90, comm: 'timeout' }, 90: { ppid: 80, comm: 'sh' }, 80: { ppid: 1, comm: 'claude' } };
    assert.strictEqual(resolveHolderPid(100, pid => chain[pid]), 80);
  });
  test('lookup failure returns the pid reached so far', () => {
    assert.strictEqual(resolveHolderPid(100, () => { throw new Error('no ps'); }), 100);
  });
});

describe('isLockLive', () => {
  const lock = buildLock({ pid: 42, nowMs: NOW, ttlSec: 60, source: 'mcp' });
  test('live: unexpired and pid alive', () => assert.strictEqual(isLockLive(lock, NOW + 1000, () => true), true));
  test('stale: expired', () => assert.strictEqual(isLockLive(lock, NOW + 61000, () => true), false));
  test('stale: holder pid dead', () => assert.strictEqual(isLockLive(lock, NOW + 1000, () => false), false));
  test('garbage lock is not live', () => {
    assert.strictEqual(isLockLive({ pid: 42, expires_at: 'nope' }, NOW, () => true), false);
    assert.strictEqual(isLockLive(null, NOW, () => true), false);
  });
});

describe('normalizeCapability defaults', () => {
  test('tool_prefix defaults to mcp__<driver>__ and lock_file to .tmp/ui-qa.lock', () => {
    const n = normalizeCapability({ driver: 'x', agent: 'a' });
    assert.strictEqual(n.toolPrefix, 'mcp__x__');
    assert.strictEqual(n.lockFile, path.join('.tmp', 'ui-qa.lock'));
    assert.deepStrictEqual(n.resetPatterns, []);
    assert.deepStrictEqual(n.lockWrappers, []);
  });
});

describe('handle', () => {
  let root;
  let lockFile;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ui-qa-lock-'));
    lockFile = path.join(root, LOCK_REL);
    writeConfig({ ui_qa: FIXTURE_UI_QA });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const writeConfig = (capabilities) => {
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { capabilities } }));
  };
  const deps = (extra = {}) => ({ nowMs: NOW, env: {}, isPidAlive: () => true, holderPid: 4242, resolveProjectRoot: d => d, ...extra });
  const bash = cmd => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd }, cwd: root });
  const writeLock = lock => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify(lock));
  };

  test('L-a no ui_qa capability: a reset command exits 0 and SubagentStart creates no lock file', () => {
    writeConfig({ backend: {} });
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 0);
    handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-charlotte-qa', agent_id: 'q1', cwd: root }, deps());
    assert.strictEqual(fs.existsSync(path.join(root, '.tmp')), false, 'no lock directory: nothing was written');
  });

  test('L-a no config at all: the hook is a no-op', () => {
    fs.rmSync(path.join(root, '.planning'), { recursive: true, force: true });
    handle({ hook_event_name: 'PreToolUse', tool_name: 'mcp__charlotte__charlotte_navigate', cwd: root, agent_id: 'a1' }, deps());
    assert.strictEqual(fs.existsSync(path.join(root, '.tmp')), false, 'no lock directory: nothing was written');
  });

  test('L-c a tool with another prefix does not take the lock; the capability prefix does', () => {
    handle({ hook_event_name: 'PreToolUse', tool_name: 'mcp__other__x', cwd: root, agent_id: 'a1' }, deps());
    assert.strictEqual(fs.existsSync(lockFile), false);
    handle({ hook_event_name: 'PreToolUse', tool_name: 'mcp__charlotte__charlotte_navigate', cwd: root, agent_id: 'a1' }, deps());
    assert.strictEqual(fs.existsSync(lockFile), true);
  });

  test('an explicit tool_prefix of "" takes no PreToolUse lock', () => {
    writeConfig({ ui_qa: { ...FIXTURE_UI_QA, tool_prefix: '' } });
    handle({ hook_event_name: 'PreToolUse', tool_name: 'mcp__charlotte__charlotte_navigate', cwd: root }, deps());
    assert.strictEqual(fs.existsSync(lockFile), false);
  });

  test('only the capability agent name takes the lock on SubagentStart', () => {
    writeConfig({ ui_qa: { ...FIXTURE_UI_QA, agent: 'gsd-other-qa' } });
    handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-charlotte-qa', agent_id: 'q1', cwd: root }, deps());
    assert.strictEqual(fs.existsSync(lockFile), false);
    handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-other-qa', agent_id: 'q2', cwd: root }, deps());
    assert.strictEqual(JSON.parse(fs.readFileSync(lockFile, 'utf8')).source, 'subagent');
  });

  test('Charlotte MCP call takes the lock with holder pid and TTL', () => {
    const r = handle({ hook_event_name: 'PreToolUse', tool_name: 'mcp__charlotte__charlotte_navigate', cwd: root, agent_id: 'a1' }, deps({ env: { GSD_CHARLOTTE_LOCK_TTL_SEC: '120' } }));
    assert.strictEqual(r.exitCode, 0);
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.strictEqual(lock.pid, 4242);
    assert.deepStrictEqual(lock.holders, ['a1']);
    assert.strictEqual(lock.main_thread, false);
    assert.strictEqual(Date.parse(lock.expires_at) - NOW, 120000);
  });

  test('SubagentStart for the capability agent takes the lock; other agents do not', () => {
    handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-executor', agent_id: 'x', cwd: root }, deps());
    assert.strictEqual(fs.existsSync(lockFile), false);
    handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-charlotte-qa', agent_id: 'q1', cwd: root }, deps());
    assert.strictEqual(JSON.parse(fs.readFileSync(lockFile, 'utf8')).source, 'subagent');
  });

  test('L-b negative: db reset is blocked (exit 2) while the lock is live, message names the allowed path', () => {
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'subagent', agentId: 'q1' }));
    const r = handle(bash('cd apps/api && npx supabase db reset'), deps());
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /Allowed path: run the suite-start reset BEFORE spawning the UI QA agent/);
    assert.ok(r.stderr.includes(lockFile));
  });

  test('L-b an unlisted command passes even with a live lock', () => {
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'mcp' }));
    assert.strictEqual(handle(bash('supabase status'), deps()).exitCode, 0);
    assert.strictEqual(handle(bash('scripts/preflightXsh --all'), deps()).exitCode, 0);
  });

  test('stale locks are ignored: expired or dead holder pid', () => {
    writeLock(buildLock({ pid: 4242, nowMs: NOW - 700000, ttlSec: 600, source: 'mcp' }));
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 0);
    writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'mcp' }));
    assert.strictEqual(handle(bash('supabase db reset'), deps({ isPidAlive: () => false })).exitCode, 0);
  });

  test('resets pass with no lock', () => {
    fs.rmSync(lockFile, { force: true });
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 0);
  });

  const start = id => handle({ hook_event_name: 'SubagentStart', agent_type: 'gsd-charlotte-qa', agent_id: id, cwd: root }, deps());
  const stop = id => handle({ hook_event_name: 'SubagentStop', agent_type: 'gsd-charlotte-qa', agent_id: id, cwd: root }, deps());

  test('SubagentStop releases only the stopping agent', () => {
    start('other');
    stop('q1');
    assert.strictEqual(fs.existsSync(lockFile), true);
    stop('other');
    assert.strictEqual(fs.existsSync(lockFile), false);
  });

  test('negative: overlapping agents -- the first stop must not release the lock the second still needs', () => {
    start('A');
    start('B');
    stop('B');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(lockFile, 'utf8')).holders, ['A']);
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 2, 'A is still running');
    stop('A');
    assert.strictEqual(fs.existsSync(lockFile), false);
  });

  test('a main-thread driver call keeps the lock after the last agent stops (TTL-only release)', () => {
    start('A');
    handle({ hook_event_name: 'PreToolUse', tool_name: 'mcp__charlotte__charlotte_click', cwd: root }, deps());
    stop('A');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.deepStrictEqual(lock.holders, []);
    assert.strictEqual(lock.main_thread, true);
  });

  // Round 5 ruling B: an input over the work budget (8 KB, nesting 8, a step cap) blocks under a live lock, in
  // well under 200 ms; a matcher throw blocks too. With no live lock the command is never parsed.
  describe('round 5 B: work budget and lock-first order', () => {
    const OVER_BUDGET = {
      'nesting 9': `${'('.repeat(9)}x${')'.repeat(9)}`,
      'nesting 64': `${'('.repeat(64)}x${')'.repeat(64)}`,
      '8 KB + 1 byte': `echo ${'a'.repeat(8193 - 5)}`,
      '1 MB': `echo ${'a'.repeat(1024 * 1024)}`,
    };
    for (const [name, cmd] of Object.entries(OVER_BUDGET)) {
      test(`${name}: the matcher blocks, and a live lock exits 2 within 200 ms`, () => {
        writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'mcp' }));
        assert.strictEqual(matchesResetPattern(cmd, FIXTURE), true);
        const t0 = process.hrtime.bigint();
        const r = handle(bash(cmd), deps());
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        assert.strictEqual(r.exitCode, 2);
        assert.ok(ms < 200, `${name} took ${ms.toFixed(1)} ms`);
      });
    }
    test('R6 budget: npm + 40x --a under a live lock exits 2 within the legacy lane budget', () => {
      writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'mcp' }));
      const t0 = process.hrtime.bigint();
      const r = handle(bash(`npm ${'--a '.repeat(40)}`), deps());
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.strictEqual(r.exitCode, 2);
      assert.ok(ms < LANE.LANE_BUDGET_MS + 500, `took ${ms.toFixed(1)} ms`);
    });
    test('a matcher throw under a live lock exits 2; with no live lock the command is not parsed (exit 0)', () => {
      writeConfig({ ui_qa: { ...FIXTURE_UI_QA, reset_patterns: [42] } });
      assert.strictEqual(handle(bash('echo hi'), deps()).exitCode, 0);
      writeLock(buildLock({ pid: 4242, nowMs: NOW, ttlSec: 600, source: 'mcp' }));
      assert.strictEqual(handle(bash('echo hi'), deps()).exitCode, 2);
    });
  });

  test('a corrupt lock file fails open', () => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, '{not json');
    assert.strictEqual(handle(bash('supabase db reset'), deps()).exitCode, 0);
  });
});

describe('hook process (spawned)', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ui-qa-lock-proc-'));
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { capabilities: { ui_qa: FIXTURE_UI_QA } } }));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = input => spawnSync('node', [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });

  test('negative: live lock held by a running pid blocks a real reset command with exit 2', () => {
    fs.mkdirSync(path.join(root, '.tmp'));
    fs.writeFileSync(path.join(root, LOCK_REL), JSON.stringify(buildLock({ pid: process.pid, nowMs: Date.now(), ttlSec: 600, source: 'mcp' })));
    const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npx supabase db reset' }, cwd: root });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: database reset/);
  });

  test('R6 budget: the spawned hook under a live lock exits 2 for npm + 40x --a, well under the 10 s installer timeout', () => {
    fs.mkdirSync(path.join(root, '.tmp'));
    fs.writeFileSync(path.join(root, LOCK_REL), JSON.stringify(buildLock({ pid: process.pid, nowMs: Date.now(), ttlSec: 600, source: 'mcp' })));
    const t0 = Date.now();
    const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `npm ${'--a '.repeat(40)}` }, cwd: root });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(Date.now() - t0 < 5000, `hook took ${Date.now() - t0} ms`);
  });

  test('malformed stdin fails open', () => {
    const r = run('not json');
    assert.strictEqual(r.status, 0);
    assert.match(r.stderr, /failing open/);
  });
});

// Round 7 (HIGH, fail-open): the flag runs were ambiguous (`-{1,2}[\w-]+` parses a dash run two ways), so the WRAPPER
// timeout alternative backtracked exponentially outside the legacy lane's timer. Every test here is red at 4080ff8.
const { MATCH_BUDGET_MS, WRAPPER } = require('./lib/ui-qa-match.js');

// One call in a fresh context under a test-side ceiling: a hang reads as 'hung' (a failure), not a stuck runner.
const timedWithin = (fn, input, ceilingMs) => {
  const t0 = Date.now();
  try {
    const out = vm.runInNewContext('fn(input)', { fn, input }, { timeout: ceilingMs });
    return { ms: Date.now() - t0, out };
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { ms: Date.now() - t0, out: 'hung' };
    throw e;
  }
};

describe('round 7 budget constant: the shared matcher budget sits below the installed hook timeout', () => {
  test('MATCH_BUDGET_MS + 2 s git cap + 2.5 s node startup and lock reads <= the 10 s installer timeout', () => {
    assert.ok(MATCH_BUDGET_MS + 2000 + 2500 <= 10000, `MATCH_BUDGET_MS = ${MATCH_BUDGET_MS}`);
  });
  test('the legacy lane budget is inside the shared budget', () => {
    assert.ok(LANE.LANE_BUDGET_MS < MATCH_BUDGET_MS);
  });
});

describe('round 7 language: the one-dash flag form accepts exactly the old two-dash language', () => {
  // Exhaustive over every string of length <= 6 on an alphabet that includes the dash, underscore, equals and space.
  test('^-{1,2}[\\w-]+$ and ^-[\\w-]+$ agree on every string of length <= 6', () => {
    const alphabet = ['-', 'a', '_', '=', ' ', '/'];
    let cases = [''];
    const all = [''];
    for (let len = 1; len <= 6; len += 1) {
      cases = cases.flatMap((s) => alphabet.map((c) => s + c));
      all.push(...cases);
    }
    const oldRe = /^-{1,2}[\w-]+$/;
    const newRe = /^-[\w-]+$/;
    const diffs = all.filter((s) => oldRe.test(s) !== newRe.test(s));
    assert.deepStrictEqual(diffs, []);
  });
});

describe('round 7 spawned: timeout-flag shapes exit 2 within the matcher budget plus startup', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ui-qa-lock-r7-'));
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { capabilities: { ui_qa: FIXTURE_UI_QA } } }));
    fs.mkdirSync(path.join(root, '.tmp'));
    fs.writeFileSync(path.join(root, LOCK_REL), JSON.stringify(buildLock({ pid: process.pid, nowMs: Date.now(), ttlSec: 600, source: 'mcp' })));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const CASES = [
    ['the review command, 148 bytes', `timeout ${'--a '.repeat(30)}x; supabase db reset`],
    ['N=24 flags', `timeout ${'--a '.repeat(24)}x; supabase db reset`],
    ['N=26 flags', `timeout ${'--a '.repeat(26)}x; supabase db reset`],
    ['N=28 flags', `timeout ${'--a '.repeat(28)}x; supabase db reset`],
    ['N=2000 flags, 8 KB', `timeout ${'--a '.repeat(2000)}x; supabase db reset`],
  ];
  for (const [name, command] of CASES) {
    test(`${name} is blocked (exit 2) by the real hook under a live lock, within 6 s`, () => {
      const t0 = Date.now();
      // spawnSync timeout: a hung hook at 4080ff8 reads as status null (red), not a stuck runner.
      const r = spawnSync('node', [HOOK], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: root }),
        encoding: 'utf8',
        timeout: 12000,
      });
      const elapsed = Date.now() - t0;
      assert.strictEqual(r.status, 2, `status ${r.status} signal ${r.signal} after ${elapsed} ms`);
      assert.ok(elapsed < 6000, `hook took ${elapsed} ms (5 s matcher budget plus startup)`);
    });
  }
});

describe('round 7 ReDoS sweep: WRAPPER alternatives and the matcher, 8 KB pathological inputs', () => {
  // One prefix per WRAPPER alternative (and the lock wrapper); bodies are the flag, quote, equals, slash and space shapes.
  const PREFIXES = ['npx ', 'pnpx ', 'bunx ', 'sudo ', 'exec ', 'time ', 'command ', 'nohup ', 'eval ', 'xargs ', 'sh ', 'bash ',
    'zsh ', 'timeout ', 'gtimeout ', '/usr/bin/timeout ', 'nice ', 'npm ', 'pnpm ', 'yarn ', 'env ', 'A=1 ', 'stack-lock.sh -- '];
  const BODIES = ['--a ', '--a=b ', '--a x ', '-n ', '-c ', '"', "'", '=', '/', '\\', ' ', '-"'];
  const eightKb = (unit) => unit.repeat(Math.ceil(8192 / unit.length)).slice(0, 8192);
  const FLAGS_TAIL = 'x; supabase db reset';

  // Stops at the first violation, so a hang at an old revision fails in one ceiling, not one per case.
  const firstViolation = (check) => {
    for (const p of PREFIXES) for (const b of BODIES) {
      const found = check(p, b);
      if (found) return found;
    }
    return null;
  };

  test('WRAPPER alone: every alternative finishes under 200 ms on 8 KB inputs (no hang, no budget needed)', () => {
    const found = firstViolation((p, b) => {
      const input = `${p}${eightKb(b).slice(0, 8192 - p.length - 1)}x`;
      const { ms, out } = timedWithin((s) => WRAPPER.test(s), input, 1000);
      return out === 'hung' || ms >= 200 ? [p, b, ms] : null;
    });
    assert.strictEqual(found, null);
  });

  test('the whole matcher: every prefix x body finishes under 200 ms, or it is slow and blocks', () => {
    const FIXTURE_LIT = { resetPatterns: FIXTURE_RESET_PATTERNS, lockWrappers: FIXTURE_UI_QA.lock_wrappers };
    const found = firstViolation((p, b) => {
      const input = `${p}${eightKb(b).slice(0, 8192 - p.length - FLAGS_TAIL.length)}${FLAGS_TAIL}`;
      const { ms, out } = timedWithin((s) => matchesResetPattern(s, FIXTURE_LIT), input, 6500);
      if (out === 'hung' || ms > 6000) return [p, b, ms, 'over budget'];
      return ms >= 200 && out !== true ? [p, b, ms, 'slow but allowed'] : null;
    });
    assert.strictEqual(found, null);
  });
});

describe('round 7 budget: one shared deadline covers every lane, not only the legacy lane', () => {
  test('40000 literals: the whole matcher is cut at MATCH_BUDGET_MS and blocks (unbounded it takes ~13 s)', () => {
    const literals = Array.from({ length: 40000 }, (_, i) => `task-${i} stage-${i}`);
    const t0 = Date.now();
    const r = matchesResetPattern('echo ' + 'a '.repeat(4000) + 'z', { resetPatterns: literals, lockWrappers: ['stack-lock.sh'] });
    const elapsed = Date.now() - t0;
    assert.strictEqual(r, true);
    assert.ok(elapsed < MATCH_BUDGET_MS + 1500, `took ${elapsed} ms against a ${MATCH_BUDGET_MS} ms budget`);
  });
});
