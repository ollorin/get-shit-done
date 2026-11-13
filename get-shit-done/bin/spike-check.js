'use strict';
// Deterministic spike checks (references/rigour.md, "Spike answer table"): a "no" answer carries a root-cause or search capture,
// a probe is never newer than its capture, and ROADMAP / REQUIREMENTS / STATE agree about a completed phase.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { splitTableCells } = require('./md-table.js');
const { checkboxState } = require('./roadmap-box.js');

// Only these answers need no root cause or search capture; every other answer (no, false, unsupported, blank, ...) does.
const POSITIVE = /^(?:yes|inconclusive)\b/i;
const EMPTY = /^[\s*_`-]*(?:n\/?a|none|-|—)?[\s*_`-]*$/i;
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// Tables whose header has Question, Answer and Root cause / search columns. Shape: | Question | Answer | Capture | Probe | Root cause or search |
function answerRows(text) {
  const lines = text.split('\n');
  const rows = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = splitTableCells(lines[i]);
    if (!head || !/^\s*:?-{2,}/.test((splitTableCells(lines[i + 1]) || [''])[0] || '')) continue;
    const col = (re) => head.findIndex((c) => re.test(c.replace(/[*_`]/g, '').trim()));
    const idx = { q: col(/^question/i), a: col(/^answer/i), c: col(/^capture/i), p: col(/^probe/i), r: col(/root[- ]?cause|search/i) };
    if (idx.a === -1 || idx.q === -1) continue;
    for (let j = i + 2; j < lines.length; j++) {
      const cells = splitTableCells(lines[j]);
      if (!cells) break;
      const at = (k) => (k === -1 ? '' : (cells[k] || '').trim());
      rows.push({ question: at(idx.q), answer: at(idx.a), capture: at(idx.c), probe: at(idx.p), root: at(idx.r), hasRootColumn: idx.r !== -1 });
    }
  }
  return rows;
}

const pathOf = (cell) => {
  const tick = cell.match(/`([^`]+)`/);
  const tok = (tick ? tick[1] : cell).trim().split(/\s+/)[0] || '';
  return tok && !EMPTY.test(tok) ? tok : '';
};

// The first token of a Probe cell that is an existing file ("node spike/probe.js" resolves spike/probe.js, not node).
const probeFile = (cwd, phaseDir, cell) => {
  const toks = cell.split(/\s+/).map((t) => t.replace(/^[`'"(]+|[`'"),;.]+$/g, '')).filter((t) => t && !EMPTY.test(t));
  for (const t of toks) { const f = resolve(cwd, phaseDir, t); if (f && fs.statSync(f).isFile()) return f; }
  return null;
};

const resolve = (cwd, phaseDir, p) => [path.join(cwd, p), path.join(phaseDir, p), path.join(phaseDir, 'captures', p)].find((f) => fs.existsSync(f)) || null;

function git(cwd, args) { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { return null; } }
// Seconds since epoch of the file's content: its last commit when tracked and clean, else its mtime.
function stamp(cwd, file) {
  const rel = path.relative(cwd, file);
  const dirty = git(cwd, ['status', '--porcelain', '--', rel]);
  const ct = git(cwd, ['log', '-1', '--format=%ct', '--', rel]);
  if (ct && !dirty) return Number(ct);
  try { return Math.floor(fs.statSync(file).mtimeMs / 1000); } catch { return null; }
}

function answerTableErrors(cwd, phaseDir, dirFiles, { requireTable = false } = {}) {
  const errors = [];
  let tables = 0;
  for (const f of dirFiles.filter((x) => x === 'SPIKE-RESULT.md' || /-VERIFICATION\.md$/.test(x)).sort()) {
    const text = read(path.join(phaseDir, f));
    if (text === null) continue;
    const rows = answerRows(text);
    if (rows.length > 0) tables += 1;
    for (const r of rows) {
      const tag = `${f}: question "${r.question.slice(0, 60)}"`;
      if (!POSITIVE.test(r.answer.replace(/[*_`\s]+/g, ' ').trim())) {
        const rc = pathOf(r.root);
        if (!rc) errors.push(`${tag} answers "${r.answer.slice(0, 30)}" with no root-cause or search capture (answer yes or inconclusive, or name the capture in the Root cause or search column)`);
        else if (!resolve(cwd, phaseDir, rc)) errors.push(`${tag}: root-cause or search capture ${rc} not found on disk`);
      }
      const probeCell = r.probe.replace(/[*_`\s]+/g, ' ').trim();
      const probeNamed = probeCell !== '' && !EMPTY.test(probeCell) && !/^manual\b/i.test(probeCell);
      const pf = probeNamed ? probeFile(cwd, phaseDir, r.probe) : null;
      if (probeNamed && !pf) errors.push(`${tag}: probe "${probeCell.slice(0, 60)}" not found on disk`);
      const capture = pathOf(r.capture);
      if (pf && capture) {
        const cf = resolve(cwd, phaseDir, capture);
        const ps = stamp(cwd, pf);
        const cs = cf && stamp(cwd, cf);
        if (ps && cs && ps > cs) errors.push(`${tag}: stale capture ${capture} is older than its probe ${path.relative(cwd, pf)}`);
      }
    }
  }
  if (requireTable && tables === 0) errors.push('No answer table (| Question | Answer | Capture | Probe | Root cause or search |) in SPIKE-RESULT.md or the VERIFICATION: at spike it is the only per-phase result record');
  return errors;
}

// A phase ROADMAP marks complete: its requirement ids are checked in REQUIREMENTS.md and STATE.md does not still call it in progress.
function statusAgreementErrors(cwd, phaseNumber) {
  const errors = [];
  const roadmap = read(path.join(cwd, '.planning', 'ROADMAP.md'));
  if (roadmap === null) return errors;
  const n = String(phaseNumber).replace(/^0+(?=\d)/, '').replace('.', '\\.');
  if (checkboxState(roadmap, phaseNumber) !== true) return errors;
  const section = (roadmap.match(new RegExp(`#{2,4}\\s*Phase\\s+0*${n}\\s*:[\\s\\S]*?(?=\\n#{2,4}\\s*Phase\\s|\\n## |$)`, 'i')) || [''])[0];
  const ids = ((section.match(/\*\*Requirements:?\*\*:?\s*([^\n]*)/i) || [])[1] || '').match(/[A-Z][A-Z0-9]*-\d+/g) || [];
  const req = read(path.join(cwd, '.planning', 'REQUIREMENTS.md'));
  if (req !== null) {
    for (const id of new Set(ids)) {
      const box = req.match(new RegExp(`-\\s*\\[( |x)\\]\\s*\\**${id}\\b`, 'i'));
      const row = req.match(new RegExp(`\\|\\s*${id}\\s*\\|[^\\n]*`, 'i'));
      if ((box && box[1] === ' ') || (row && /\bpending\b/i.test(row[0]))) errors.push(`REQUIREMENTS.md shows ${id} pending while ROADMAP.md marks phase ${phaseNumber} complete`);
    }
  }
  const state = read(path.join(cwd, '.planning', 'STATE.md'));
  if (state !== null) {
    const ph = (state.match(/^\s*(?:\*\*)?(?:Current )?Phase:(?:\*\*)?\s*0*(\d+(?:\.\d+)?)/im) || [])[1];
    const status = (state.match(/^\s*(?:\*\*)?Status:(?:\*\*)?\s*(.*)$/im) || [])[1] || '';
    if (ph === String(phaseNumber).replace(/^0+(?=\d)/, '') && /executing|in progress|ready to execute|planning/i.test(status)) errors.push(`STATE.md still reports phase ${phaseNumber} as "${status.trim().slice(0, 40)}" while ROADMAP.md marks it complete`);
  }
  return errors;
}

module.exports = { answerRows, answerTableErrors, statusAgreementErrors };
