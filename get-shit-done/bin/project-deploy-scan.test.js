'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SECRET_PATTERNS, scanText, scanDir, sliceLine, LINE_CAP, LINE_OVERLAP } = require('./project-deploy-scan.js');

const MODULE_PATH = path.join(__dirname, 'project-deploy-scan.js');
const R = 'a1B2';

const TOKENS = {
  vcs_token: 'gh' + 'p_' + R.repeat(9),
  vcs_fine_grained_token: 'github' + '_pat_' + 'a1B2_'.repeat(5),
  cloud_access_key_id: 'AK' + 'IA' + 'A1B2'.repeat(4),
  chat_token: 'xo' + 'xb-' + '1234567890-abcdef',
  llm_api_key: 's' + 'k-' + R.repeat(6),
  live_api_key: 's' + 'k_live_' + R.repeat(4),
  maps_api_key: 'AI' + 'za' + 'a1B2_'.repeat(7),
  registry_token: 'np' + 'm_' + R.repeat(9),
  signed_token: ['ey' + 'J' + R.repeat(3), 'ey' + 'J' + 'c3D4'.repeat(3), 'e5F6'.repeat(3)].join('.'),
  private_key_block: '-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----',
  url_credentials: 'postgres' + '://' + 'admin' + ':' + 'hunter2pass' + '@db.internal',
  bearer_token: 'Bear' + 'er ' + 'Zq8Lm2VbKx' + 'Tr4PnW7dYs',
  assigned_secret: 'api' + '_key' + '=' + 'Zq8Lm2' + 'VbKxTr4P',
};

const tmps = [];

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deploy-scan-'));
  tmps.push(dir);
  return dir;
}

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

function presetHits(presetsRoot) {
  return scanDir(presetsRoot).hits;
}

afterEach(() => {
  while (tmps.length) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

describe('project-deploy-scan', () => {
  test('fixture table covers every SECRET_PATTERNS id', () => {
    assert.deepStrictEqual(
      SECRET_PATTERNS.map((p) => p.id),
      Object.keys(TOKENS)
    );
  });

  for (const [id, token] of Object.entries(TOKENS)) {
    test(`1 ${id}: reported once with its pattern id and line, never the matched text`, () => {
      const result = scanText('line one\nline two\nkey = ' + token + '\n');
      assert.deepStrictEqual(result, [{ pattern: id, line: 3 }]);
      assert.ok(!JSON.stringify(result).includes(token));
    });
  }

  test('2 negatives: placeholders, short tokens and non-secret shapes produce no hits', () => {
    const negatives = [
      '"${VCS_TOKEN}"',
      'API_KEY=',
      '0123456789abcdef'.repeat(4),
      'gh' + 'p_' + 'abc',
      'task-' + R.repeat(8),
      '-----BEGIN CERTIFICATE-----',
      'TOKEN=${GITHUB_TOKEN}',
      'https://example.com/a@b',
    ];
    for (const text of negatives) {
      assert.deepStrictEqual(scanText(text), [], `expected no hits for: ${text}`);
    }
  });

  test('3 scanDir walks nested and dotfiles, skips node_modules, and reports sorted relative paths', () => {
    const root = mkTmp();
    const planted = TOKENS.vcs_token;
    writeTree(root, {
      'a/b/conf.txt': 'first line\n' + planted + '\n',
      '.env.example': planted + '\n',
      'node_modules/x.txt': planted + '\n',
      'clean.md': 'nothing here\n',
    });
    const result = scanDir(root);
    assert.strictEqual(result.files_scanned, 3);
    assert.deepStrictEqual(result.hits, [
      { file: '.env.example', pattern: 'vcs_token', line: 1 },
      { file: 'a/b/conf.txt', pattern: 'vcs_token', line: 2 },
    ]);
    assert.deepStrictEqual(scanDir(path.join(root, 'absent')), { files_scanned: 0, hits: [] });
  });

  test('4 a Buffer with non-UTF-8 bytes around a token is scanned without loss', () => {
    const planted = TOKENS.vcs_token;
    const buf = Buffer.from([0xff, 0xfe, ...Buffer.from(' ' + planted + ' '), 0xff]);
    assert.deepStrictEqual(scanText(buf), [{ pattern: 'vcs_token', line: 1 }]);
  });

  test('5 repo presets contain no token-shaped string', () => {
    assert.deepStrictEqual(presetHits(path.join(__dirname, '..', 'presets')), []);
  });

  test('5b demonstrated failure: a token planted under a presets root is reported by file', () => {
    const root = mkTmp();
    writeTree(root, { 'zz-probe/x.txt': TOKENS.vcs_token + '\n' });
    assert.deepStrictEqual(presetHits(root), [
      { file: 'zz-probe/x.txt', pattern: 'vcs_token', line: 1 },
    ]);
  });

  test('6 self-scan: the scanner module and this test file contain no token-shaped string', () => {
    assert.deepStrictEqual(scanText(fs.readFileSync(MODULE_PATH)), []);
    assert.deepStrictEqual(scanText(fs.readFileSync(__filename)), []);
  });

  test('7 ReDoS: every pattern and scanText finish 200k-char runs under 250 ms', () => {
    for (const input of ['a'.repeat(200000), '1'.repeat(200000)]) {
      for (const { id, re } of SECRET_PATTERNS) {
        const t0 = performance.now();
        re.test(input);
        assert.ok(performance.now() - t0 < 250, `pattern ${id} is slow on a run`);
      }
      const t0 = performance.now();
      scanText(input);
      assert.ok(performance.now() - t0 < 250, 'scanText is slow on a run');
    }
  });

  test('8 url_credentials: a scheme longer than 16 chars is not matched; a normal URL still is', () => {
    assert.deepStrictEqual(scanText('x'.repeat(20) + '://' + 'admin:hunter2pass@db.internal'), []);
    assert.deepStrictEqual(scanText(TOKENS.url_credentials), [{ pattern: 'url_credentials', line: 1 }]);
  });

  test('9 sliceLine: slices never exceed LINE_CAP, share LINE_OVERLAP chars, and rebuild the whole line', () => {
    assert.deepStrictEqual(sliceLine('short'), ['short']);
    const line = 'abcdefghijklmnopqrstuvwxyz'.repeat(1800);
    const slices = sliceLine(line);
    assert.ok(slices.length > 1);
    assert.ok(slices.every((s) => s.length <= LINE_CAP));
    const rebuilt = slices.slice(1).reduce((acc, s) => acc + s.slice(LINE_OVERLAP), slices[0]);
    assert.strictEqual(rebuilt, line);
  });

  test('10 a token straddling the LINE_CAP boundary of a long line is found', () => {
    const line = 'a'.repeat(19989) + ' ' + TOKENS.vcs_token + ' ' + 'b'.repeat(10);
    assert.ok(line.length > LINE_CAP);
    assert.deepStrictEqual(scanText(line), [{ pattern: 'vcs_token', line: 1 }]);
  });

  test('11 assigned_secret negatives: calls, env lookups, prose slugs and env placeholders are not secrets', () => {
    const negatives = [
      'password = getPasswordFromVault()',
      'secret: process.env.SECRET_VALUE_X',
      'Token: expiration-policy-document',
      'secret = "env(SOME_NAME)"',
      'TOKEN=${GITHUB_TOKEN}',
      'password = Deno.env.get("SOME_NAME")',
      'password = config.SECRET_VALUE_NAME_X',
      'password = getenvKeyName_1',
    ];
    for (const text of negatives) assert.deepStrictEqual(scanText(text), [], `expected no hits for: ${text}`);
  });

  test('12 assigned_secret positives (runtime-built): quoted mixed value with a digit, 32-hex api key, and a secret after a rejected call', () => {
    const quoted = 'pass' + 'word = "' + 'Qw3rTy7uIoPa5sDf9gHj2kLz' + '"';
    const hex = 'api_' + 'key: ' + '0123456789abcdef'.repeat(2);
    const afterCall = 'password = getPasswordFromVault() ' + TOKENS.assigned_secret;
    const mixedCase = 'to' + 'ken = ' + 'AbCdEfGhIjKlMnOpQrStUvWxYz';
    assert.deepStrictEqual(scanText(quoted), [{ pattern: 'assigned_secret', line: 1 }]);
    assert.deepStrictEqual(scanText(hex), [{ pattern: 'assigned_secret', line: 1 }]);
    assert.deepStrictEqual(scanText(afterCall), [{ pattern: 'assigned_secret', line: 1 }]);
    assert.deepStrictEqual(scanText(mixedCase), [{ pattern: 'assigned_secret', line: 1 }]);
  });
});

describe('B-FIX3 F2 slice boundary overlap', () => {
  const JWT = 'eyJ' + 'a1B2'.repeat(25) + '.eyJ' + 'c3D4'.repeat(25) + '.' + 'e5F6'.repeat(25);
  // A value whose entropy (a digit) sits past the first slice: a truncated prefix alone is not a secret.
  const LATE_VALUE = 'x'.repeat(300) + 'Q9';
  const offsets = () => {
    const out = [];
    for (let p = 19500; p <= 20100; p += 37) out.push(p);
    return out;
  };

  test('F2-a a JWT-shaped token (>= 300 chars) is found at every offset around the LINE_CAP boundary', () => {
    assert.ok(JWT.length >= 300);
    for (const p of offsets()) {
      const line = ' '.repeat(p) + JWT + ' '.repeat(40);
      assert.deepStrictEqual(scanText(line), [{ pattern: 'signed_token', line: 1 }], `offset ${p}`);
    }
  });

  test('F2-b an assigned_secret value whose entropy lies past the boundary is found at every offset', () => {
    for (const p of offsets()) {
      const line = ' '.repeat(p) + 'password = "' + LATE_VALUE + '"';
      assert.deepStrictEqual(scanText(line), [{ pattern: 'assigned_secret', line: 1 }], `offset ${p}`);
    }
  });

  test('F2-c the overlap is 2048 chars, the step between slices is LINE_CAP minus it', () => {
    assert.strictEqual(LINE_OVERLAP, 2048);
    assert.deepStrictEqual(sliceLine('a'.repeat(LINE_CAP + 1)).map((s) => s.length), [LINE_CAP, LINE_OVERLAP + 1]);
  });
});
