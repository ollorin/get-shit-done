'use strict';
// Deterministic form checks of a phase directory (plans and planning-record cites). Contract: references/rigour.md rules 1, 2, 6.
// Summary form (sections, Self-Check, Defect Classes shape) stays in gsd-tools collectPhaseEvidenceErrors.
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const CAPS = { spike: { lines: 150, tasks: 4, plans: 2 }, standard: { lines: 250, tasks: 6, plans: 3 } };
const CITE = /\b(?:DECISIONS|ROADMAP)\.md:\d+/;
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const lineCount = (text) => text.replace(/\n$/, '').split('\n').length;
const taskCount = (text) => (text.match(/<task(?=[\s>])/g) || []).length;
const outsidePlanning = (f) => typeof f === 'string' && !/^(\.\/)?\.planning(\/|$)/.test(f.trim());

function checkPlans(phaseDir, dirFiles, level) {
  const caps = CAPS[level] || CAPS.standard;
  const errors = [];
  const warnings = [];
  const plans = dirFiles.filter((f) => /-\d{2}-PLAN\.md$/i.test(f)).sort();
  if (plans.length > caps.plans) warnings.push({ file: path.basename(phaseDir), check: 'plan_count', message: `${plans.length} plans exceed the ${level} cap of ${caps.plans}: the phase is too big` });
  for (const f of plans) {
    const text = read(path.join(phaseDir, f));
    if (text === null) continue;
    const lines = lineCount(text);
    const tasks = taskCount(text);
    if (lines > caps.lines) errors.push({ file: f, check: 'plan_lines', message: `${lines} lines exceed the ${level} cap of ${caps.lines}` });
    if (tasks > caps.tasks) errors.push({ file: f, check: 'plan_tasks', message: `${tasks} tasks exceed the ${level} cap of ${caps.tasks}` });
    let fm = {};
    try { fm = matter(text).data || {}; } catch { /* malformed frontmatter is reported by plan-structure */ }
    const files = Array.isArray(fm.files_modified) ? fm.files_modified : [];
    if (files.length > 0 && !files.some(outsidePlanning)) errors.push({ file: f, check: 'evidence_only_plan', message: 'no file outside .planning/ in files_modified: evidence belongs to the task that built the behaviour' });
    if (fm.plan_stamp === undefined || fm.plan_stamp === null || fm.plan_stamp === '') warnings.push({ file: f, check: 'plan_stamp_missing', message: 'no plan_stamp in frontmatter (gsd-tools plan stamp <phase>)' });
  }
  return { errors, warnings };
}

// DECISIONS.md:<line> / ROADMAP.md:<line> in a phase-directory .md file or a DECISIONS.jsonl row mapped to the phase.
function checkLineCites(cwd, phaseDir, dirFiles, phaseNumber) {
  const errors = [];
  const rel = (f) => path.relative(cwd, path.join(phaseDir, f));
  for (const f of dirFiles.filter((x) => /\.md$/i.test(x)).sort()) {
    const text = read(path.join(phaseDir, f));
    const m = text && text.match(CITE);
    if (m) errors.push({ file: rel(f), check: 'line_cite', message: `planning-record line cite "${m[0]}": cite the record id instead` });
  }
  const key = String(phaseNumber).replace(/^0+(?=\d)/, '');
  const ledger = read(path.join(cwd, '.planning', 'DECISIONS.jsonl'));
  for (const line of ledger ? ledger.split('\n') : []) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || !Array.isArray(row.phases) || !row.phases.map((p) => String(p).replace(/^0+(?=\d)/, '')).includes(key)) continue;
    const m = line.match(CITE);
    if (m) errors.push({ file: '.planning/DECISIONS.jsonl', check: 'line_cite', message: `${row.id || 'row'}: line cite "${m[0]}": cite the record id instead` });
  }
  return errors;
}

module.exports = { CAPS, checkPlans, checkLineCites };
