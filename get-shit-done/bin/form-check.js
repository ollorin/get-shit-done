'use strict';
// Deterministic form checks: plan caps at plan time, planning-record cites after execution. Contract: references/rigour.md.
// Summary form (Self-Check section) stays in gsd-tools collectPhaseEvidenceErrors.
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const CAPS = { spike: { lines: 150, tasks: 4, plans: 2 }, standard: { lines: 250, tasks: 6, plans: 3 } };
const CITE = /\b(?:DECISIONS|ROADMAP)\.md:\d+/;
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const lineCount = (text) => text.replace(/\n$/, '').split('\n').length;
const taskCount = (text) => (text.match(/<task(?=[\s>])/g) || []).length;
const outsidePlanning = (f) => typeof f === 'string' && !/^(\.\/)?\.planning(\/|$)/.test(f.trim());

// Plan-time checks (blocking, planner fixes before plan-check). Executed plans (a SUMMARY exists) are never reported:
// an executor cannot shrink a plan that already ran.
function checkPlans(phaseDir, dirFiles, level) {
  const caps = CAPS[level] || CAPS.standard;
  const errors = [];
  const plans = dirFiles.filter((f) => /-\d{2}-PLAN\.md$/i.test(f) && !dirFiles.includes(f.replace(/-PLAN\.md$/i, '-SUMMARY.md'))).sort();
  if (plans.length > caps.plans) errors.push({ file: path.basename(phaseDir), check: 'plan_count', message: `${plans.length} plans exceed the ${level} cap of ${caps.plans}: the phase is too big` });
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
    if (level !== 'spike' && files.length > 0 && !files.some(outsidePlanning)) errors.push({ file: f, check: 'evidence_only_plan', message: 'no file outside .planning/ in files_modified: evidence belongs to the task that built the behaviour' });
    if (fm.plan_stamp === undefined || fm.plan_stamp === null || fm.plan_stamp === '') errors.push({ file: f, check: 'plan_stamp_missing', message: 'no plan_stamp in frontmatter (copy plan_stamp from the init plan-phase output)' });
  }
  return errors;
}

// DECISIONS.md:<line> / ROADMAP.md:<line> in the phase's own PLAN and SUMMARY files. Not VERIFICATION/REVIEW files
// (they quote findings) and not ledger rows (append-only records the phase cannot rewrite).
function checkLineCites(cwd, phaseDir, dirFiles) {
  const errors = [];
  for (const f of dirFiles.filter((x) => /-(?:PLAN|SUMMARY)\.md$/i.test(x)).sort()) {
    const text = read(path.join(phaseDir, f));
    const m = text && text.match(CITE);
    if (m) errors.push({ file: path.relative(cwd, path.join(phaseDir, f)), check: 'line_cite', message: `planning-record line cite "${m[0]}": cite the record id instead` });
  }
  return errors;
}

module.exports = { CAPS, checkPlans, checkLineCites };
