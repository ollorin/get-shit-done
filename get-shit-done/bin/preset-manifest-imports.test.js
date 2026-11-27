'use strict';

// WP17: every relative import of a deployed base script names a file preset.json also lists.
// Node only; reads presets/base and never runs the scripts.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'presets', 'base');
const RELATIVE_SPEC = /\b(?:from|import|require)\s*\(?\s*(["'])(\.{1,2}\/[^"'\n]+)\1/g;
const relativeSpecs = (src) => [...src.matchAll(RELATIVE_SPEC)].map((m) => m[2]);

const FORMS = [
  ['from double quotes', 'import { a } from "./x.mjs";', ['./x.mjs']],
  ['from single quotes', "import { a } from './x.mjs';", ['./x.mjs']],
  ['side-effect single quotes', "import './x.mjs';", ['./x.mjs']],
  ['side-effect double quotes', 'import "./x.mjs";', ['./x.mjs']],
  ['dynamic import', "const m = await import('./x.mjs');", ['./x.mjs']],
  ['export from', "export { a } from '../x.mjs';", ['../x.mjs']],
  ['require', "const x = require('./x.js');", ['./x.js']],
  ['multi-line import', "import {\n  a,\n  b\n} from './x.mjs';", ['./x.mjs']],
  ['bare package specifiers are not relative', "import fs from 'node:fs';\nconst y = require('lodash');", []],
];

describe('relative import specifier extraction (WP17)', () => {
  for (const [name, src, expected] of FORMS) {
    test(`${name} is recognised`, () => {
      assert.deepStrictEqual(relativeSpecs(src), expected);
    });
  }
});

describe('preset manifest: every relative import of a listed script is listed (WP17)', () => {
  test('a deployed script that imports ./x.mjs or ../x.mjs names a file preset.json also lists', () => {
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const listed = new Set(preset.files.map((f) => f.dest));
    const unlisted = preset.files
      .filter((f) => /\.m?js$/.test(f.src))
      .flatMap((f) => relativeSpecs(fs.readFileSync(path.join(BASE, f.src), 'utf8'))
        .map((spec) => ({ file: f.dest, spec, target: path.posix.normalize(path.posix.join(path.posix.dirname(f.dest), spec)) })))
      .filter((r) => !listed.has(r.target))
      .map((r) => `${r.file} imports ${r.spec} (${r.target}), not listed`);
    assert.deepStrictEqual(unlisted, []);
  });
});
