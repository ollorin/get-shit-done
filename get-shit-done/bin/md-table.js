'use strict';

// The one markdown table-row splitter. A `|` inside a backtick code span or escaped as `\|` is cell
// text, not a separator (project convention; strict GFM would split inside a code span, and the pre-splitter code was a plain split("|") that was not GFM either). A backtick run with no closing run of the same length is a literal backtick.

function splitRowRaw(inner) {
  const cells = [];
  let cur = '';
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') { cur += '\\|'; i += 2; continue; }
    if (ch === '`') {
      let n = 0;
      while (inner[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      let search = i + n;
      let close = -1;
      while (search < inner.length) {
        const at = inner.indexOf('`', search);
        if (at === -1) break;
        let m = 0;
        while (inner[at + m] === '`') m++;
        if (m === n) { close = at; break; }
        search = at + m;
      }
      if (close === -1) { cur += fence; i += n; continue; }
      cur += inner.slice(i, close + n);
      i = close + n;
      continue;
    }
    if (ch === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += ch;
    i++;
  }
  cells.push(cur);
  return cells;
}

// Strict: the line must start and end with `|`; returns the raw (untrimmed) cells or null.
function splitTableCells(line) {
  const trimmed = String(line).trim();
  if (trimmed.length < 2 || !trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  if (trimmed.endsWith('\\|') && !trimmed.endsWith('\\\\|')) return null;
  return splitRowRaw(trimmed.slice(1, -1));
}

// Lenient: optional leading and trailing pipe; returns trimmed cells (empty cells kept).
function splitRowCells(line) {
  let t = String(line).trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return splitRowRaw(t).map((c) => c.trim());
}

module.exports = { splitTableCells, splitRowCells };
