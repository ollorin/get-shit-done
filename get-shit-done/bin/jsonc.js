'use strict';

// JSON with // and /* */ comments and trailing commas; string contents are left alone. One parser for the deploy engine,
// the upgrade and the doctor, so a settings file one accepts is accepted by all.

function stripJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function parseJsonc(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(stripJsonc(text)) };
    } catch {
      return { ok: false };
    }
  }
}

module.exports = { stripJsonc, parseJsonc };
