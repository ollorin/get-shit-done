// duplicateBlocks: a line-window detector with no dependency. A window is dup_min_lines consecutive normalised lines
// (comment-stripped, whitespace collapsed, blank and punctuation-only lines dropped) holding at least MIN_CHARS non-space
// characters. The second, non-overlapping occurrence of a window is a duplicate; adjacent duplicate windows merge into one
// block. Stated limit: a copy whose identifiers were renamed is not seen.
import { commentStyleFor, stripComments } from './scan.mjs';

const MIN_CHARS = 200;
const PUNCTUATION_ONLY = /^[^A-Za-z0-9_$]*$/;

/** Pure: [{ n, s }] with the original line number n and the normalised text s of each kept line. */
export function normalise(text, relPath) {
  const out = [];
  stripComments(text, commentStyleFor(relPath), true).split('\n').forEach((line, i) => {
    const s = line.replace(/\s+/g, ' ').trim();
    if (!PUNCTUATION_ONLY.test(s)) out.push({ n: i + 1, s });
  });
  return out;
}

const weight = (window) => window.reduce((sum, l) => sum + l.s.replace(/ /g, '').length, 0);

function merge(dups, minLines, lineOf) {
  const blocks = [];
  for (const d of dups) {
    const last = blocks[blocks.length - 1];
    if (last && last.file === d.file && last.of === d.of && d.i === last.lastI + 1) last.lastI = d.i;
    else blocks.push({ ...d, lastI: d.i });
  }
  return blocks.map((b) => ({
    file: b.file,
    line: lineOf(b.file, b.i),
    message: `duplicates ${b.of}:${lineOf(b.of, b.j)} (${b.lastI - b.i + minLines} lines)`,
  }));
}

/**
 * Pure: files [{ file, lines }] in scan order -> [{ file, line, message }], one per duplicated block, reported at the
 * later occurrence. The first occurrence of a window is the one in the earlier file (or earlier in the same file).
 */
export function findDuplicates(files, minLines = 12) {
  const byFile = new Map(files.map((f) => [f.file, f.lines]));
  const seen = new Map();
  const dups = [];
  for (const { file, lines } of files) {
    for (let i = 0; i + minLines <= lines.length; i += 1) {
      const window = lines.slice(i, i + minLines);
      if (weight(window) < MIN_CHARS) continue;
      const key = window.map((l) => l.s).join('\n');
      const first = seen.get(key);
      if (first === undefined) seen.set(key, { file, i });
      else if (first.file !== file || i >= first.i + minLines) dups.push({ file, i, of: first.file, j: first.i });
    }
  }
  return merge(dups, minLines, (file, idx) => byFile.get(file)[idx].n);
}
