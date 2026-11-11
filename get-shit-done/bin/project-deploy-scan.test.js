'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SECRET_PATTERNS, scanText, scanDir } = require('./project-deploy-scan.js');

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
    ];
    for (const text of negatives) {
      assert.deepStrictEqual(scanText(text), [], `expected no hits for: ${text}`);
    }
  });

  test('3 scanDir walks nested and dotfiles, skips node_modules, and reports sorted relative paths', () => {
    const root = mkTmp();
    const token = TOKENS.vcs_token;
    writeTree(root, {
      'a/b/conf.txt': 'first line\n' + token + '\n',
      '.env.example': token + '\n',
      'node_modules/x.txt': token + '\n',
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
    const token = TOKENS.vcs_token;
    const buf = Buffer.from([0xff, 0xfe, ...Buffer.from(' ' + token + ' '), 0xff]);
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
});
