'use strict';
// Two executors may share a phase only when their plans cannot collide (D-279). Pure functions plus two small file readers;
// gsd-tools only routes `plan overlap` and `claims check` here, dispatch-lease.js calls `leaseConflict`.
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const norm = (p) => String(p).trim().replace(/^\.\//, '').replace(/\/+$/, '');
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
const isMigration = (f) => f.split('/').includes('migrations');
const isUiSpec = (f) => /\.(spec|e2e)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)e2e\//.test(f);
const within = (a, b) => a === b || b.startsWith(`${a}/`);

// {id, files, depends_on} of one plan file's text. `id` is `phase-plan` (the form depends_on uses) when both are present.
function planInfo(text, fallbackId) {
  let fm = {};
  try { fm = matter(text).data || {}; } catch { /* malformed frontmatter reads as no files: the caller sees an empty plan */ }
  const id = fm.phase !== undefined && fm.plan !== undefined ? `${String(fm.phase).split('-')[0].replace(/^0+(?=\d)/, '')}-${String(fm.plan).padStart(2, '0')}` : fallbackId;
  return { id, files: asList(fm.files_modified).map(norm), depends_on: asList(fm.depends_on) };
}

const idMatches = (dep, plan) => dep === plan.id || (plan.id && String(dep).replace(/^0+/, '') === String(plan.id).replace(/^0+/, ''));

// Reasons plan `a` and plan `b` may not run together; an empty list means they are file-disjoint.
function overlap(a, b) {
  const out = [];
  for (const x of a.files) for (const y of b.files) {
    if (x === y) out.push(`shared file ${x}`);
    else if (within(x, y) || within(y, x)) out.push(`directory prefix ${within(x, y) ? x : y} covers ${within(x, y) ? y : x}`);
  }
  if (a.files.some(isMigration) && b.files.some(isMigration)) out.push('both plans add migrations');
  if (a.files.some(isUiSpec) && b.files.some(isUiSpec)) out.push('both plans touch UI specs');
  if (a.depends_on.some((d) => idMatches(d, b)) || b.depends_on.some((d) => idMatches(d, a))) out.push('one plan depends on the other');
  return [...new Set(out)];
}

const readPlan = (cwd, p) => { try { return planInfo(fs.readFileSync(path.resolve(cwd, p), 'utf8'), path.basename(p)); } catch { return null; } };

// Called by `dispatch begin executor` with the plan paths of the open executor leases. null = allowed, else the refusal text.
function leaseConflict(cwd, newPlan, openPlans) {
  const a = readPlan(cwd, newPlan);
  if (!a) return `plan ${newPlan} is not readable`;
  for (const p of openPlans) {
    const b = readPlan(cwd, p);
    if (!b) return `plan ${p} of the open executor lease is not readable`;
    const why = overlap(a, b);
    if (why.length > 0) return `plans ${newPlan} and ${p} are not file-disjoint (${why.join('; ')})`;
  }
  return null;
}

// `plan overlap <planA> <planB>`
function cmdOverlap(cwd, planA, planB) {
  const a = planA && readPlan(cwd, planA);
  const b = planB && readPlan(cwd, planB);
  if (!a || !b) return { error: 'plan overlap: two readable plan files required' };
  const reasons = overlap(a, b);
  return { disjoint: reasons.length === 0, reasons };
}

// Rows of CLAIMED sections of a claims file (.tmp/phase-file-claims.md): { lane, file }. PLANNED and released sections do not block.
function claimedRows(text) {
  const rows = [];
  let lane = null;
  for (const line of String(text).split('\n')) {
    const h = line.match(/^##\s+(.*?)\s*(?:\((CLAIMED|PLANNED)[^)]*\))?\s*$/);
    if (h) { lane = h[2] === 'CLAIMED' ? h[1] : null; continue; }
    const r = lane && line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (r) rows.push({ lane, file: norm(r[1]) });
  }
  return rows;
}

// `claims check <plan> [--lane <section title>] [--file <claims file>]`: files of the plan that a CLAIMED row of another lane covers.
function cmdClaimsCheck(cwd, planPath, lane, claimsFile) {
  const plan = planPath && readPlan(cwd, planPath);
  if (!plan) return { error: 'claims check: a readable plan file is required' };
  let text = '';
  try { text = fs.readFileSync(path.resolve(cwd, claimsFile || '.tmp/phase-file-claims.md'), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return { error: 'claims check: claims file is not readable' }; }
  const conflicts = [];
  for (const r of claimedRows(text)) {
    if (lane && r.lane.startsWith(lane)) continue;
    for (const f of plan.files) if (within(f, r.file) || within(r.file, f)) conflicts.push({ file: f, claimed: r.file, lane: r.lane });
  }
  return { clear: conflicts.length === 0, conflicts };
}

// Per-plan checkpoint: TASK-CHECKPOINT-<plan_id>.json. A phase checkpointed by an older build only has TASK-CHECKPOINT.json: read that when the per-plan file is absent.
function resolveTaskCheckpoint(file) {
  if (fs.existsSync(file)) return file;
  const legacy = path.join(path.dirname(file), 'TASK-CHECKPOINT.json');
  return /TASK-CHECKPOINT-.+\.json$/.test(file) && fs.existsSync(legacy) ? legacy : file;
}

module.exports = { planInfo, overlap, leaseConflict, cmdOverlap, cmdClaimsCheck, claimedRows, resolveTaskCheckpoint };
