'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'legacy', 'risk-keywords.json');
const KEYS = ['doc_signal', 'sensitive_path', 'complexity', 'thorough_validation'];

function load(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bad = KEYS.filter((k) => !Array.isArray(doc[k]) || doc[k].length === 0 || !doc[k].every((w) => typeof w === 'string' && /^[a-z]+$/.test(w)));
  if (bad.length > 0) throw new Error(`legacy risk keywords: ${file} has invalid list(s): ${bad.join(', ')}`);
  return Object.fromEntries(KEYS.map((k) => [k, Object.freeze([...doc[k]])]));
}

const keywords = load(FILE);

module.exports = { ...keywords, load, FILE, KEYS };
