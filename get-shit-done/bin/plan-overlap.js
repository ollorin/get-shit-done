'use strict';
// Two executors may share a phase only when their plans cannot collide (D-279). Pure functions plus two small file readers;
// gsd-tools only routes `plan overlap` and `claims check` here, dispatch-lease.js calls `leaseConflict`.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const matter = require('gray-matter');

// Files any two plans may not both list: manifests, lockfiles, planning state and CI/root config are shared by every plan. One owner of this table.
const SHARED_BASENAMES = new Set(['package.json', 'npm-shrinkwrap.json', 'cargo.toml', 'go.mod', 'go.sum', 'pyproject.toml', 'requirements.txt', 'gemfile', 'composer.json']);
const LOCKFILE = /(\.lockb?|-lock\.(json|ya?ml))$/; // yarn.lock, Cargo.lock, package-lock.json, *-lock.yaml, *.lockb
const SHARED_PATHS = new Set(['.planning/state.md', '.planning/roadmap.md', '.planning/requirements.md', '.planning/config.json', 'tsconfig.json', '.gitignore', '.gitlab-ci.yml', '.travis.yml', 'jenkinsfile', 'makefile']);
const SHARED_PREFIXES = ['.github/', '.circleci/'];
const isShared = (f) => { const base = f.split('/').pop(); return SHARED_BASENAMES.has(base) || LOCKFILE.test(base) || SHARED_PATHS.has(f) || SHARED_PREFIXES.some((p) => f.startsWith(p)); };

const GLOB_CHARS = /[*?[{]/;
// Backslash to slash, repo-relative, `.` and `..` resolved, lower case, no trailing slash.
function norm(p, root) {
  let s = String(p).trim().replace(/\\/g, '/');
  if (root && path.posix.isAbsolute(s)) {
    const rel = path.posix.relative(root.replace(/\\/g, '/'), path.posix.normalize(s));
    if (rel !== '' && !rel.startsWith('..')) s = rel;
  }
  return path.posix.normalize(s).replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(String);
// The plan's files, or an error text: files_modified must be a non-empty flat list of glob-free strings.
function filesOf(v, root) {
  if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return { error: 'files_modified is empty or missing' };
  if (!Array.isArray(v) || v.some((f) => typeof f !== 'string' || f.trim() === '')) return { error: 'files_modified must be a flat list of path strings (no comma string, no nested map)' };
  const bad = v.find((f) => GLOB_CHARS.test(f));
  return bad ? { error: `files_modified lists the glob ${bad}: list files or directories, not patterns` } : { files: v.map((f) => norm(f, root)) };
}
const isMigration = (f) => f.split('/').includes('migrations');
const isUiSpec = (f) => /\.(spec|e2e)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)e2e\//.test(f);
const within = (a, b) => a === b || b.startsWith(`${a}/`);
// A phase's captures/ directory holds per-plan evidence files: listing the directory is not a claim on its files.
const isCapturesDir = (f) => /^\.planning\/phases\/[^/]+\/captures$/.test(f);

// {id, files, depends_on} of one plan file's text. `id` is `phase-plan` (the form depends_on uses) when both are present.
// A plan whose files cannot be read as a flat list comes back as { error }: it never gets a verdict.
function planInfo(text, fallbackId, root) {
  let fm = {};
  try { fm = matter(text).data || {}; } catch { /* malformed frontmatter reads as no files: refused below */ }
  const id = fm.phase !== undefined && fm.plan !== undefined ? `${String(fm.phase).split('-')[0].replace(/^0+(?=\d)/, '')}-${String(fm.plan).padStart(2, '0')}` : fallbackId;
  const f = filesOf(fm.files_modified, root);
  return f.error ? { id, error: f.error } : { id, files: f.files, depends_on: asList(fm.depends_on) };
}

const idMatches = (dep, plan) => dep === plan.id || (plan.id && String(dep).replace(/^0+/, '') === String(plan.id).replace(/^0+/, ''));

// Reasons plan `a` and plan `b` may not run together; an empty list means they are file-disjoint.
function overlap(a, b) {
  const out = [];
  for (const x of a.files) for (const y of b.files) {
    if ((isCapturesDir(x) || isCapturesDir(y)) && (within(x, y) || within(y, x)) && !(x === y && !isCapturesDir(x))) continue;
    if (x === y) out.push(`shared file ${x}`);
    else if (within(x, y) || within(y, x)) out.push(`directory prefix ${within(x, y) ? x : y} covers ${within(x, y) ? y : x}`);
  }
  const sa = a.files.filter(isShared); const sb = b.files.filter(isShared);
  if (sa.length > 0 && sb.length > 0) out.push(`both plans touch shared files (${[...new Set([...sa, ...sb])].join(', ')})`);
  if (a.files.some(isMigration) && b.files.some(isMigration)) out.push('both plans add migrations');
  if (a.files.some(isUiSpec) && b.files.some(isUiSpec)) out.push('both plans touch UI specs');
  if (a.depends_on.some((d) => idMatches(d, b)) || b.depends_on.some((d) => idMatches(d, a))) out.push('one plan depends on the other');
  return [...new Set(out)];
}

// null = unreadable; { error } = readable but its files cannot be compared.
const readPlan = (cwd, p) => { try { return planInfo(fs.readFileSync(path.resolve(cwd, p), 'utf8'), path.basename(p), cwd); } catch { return null; } };
// Repo-relative form stored in the lease; a path outside the repo stays as given.
const repoRelative = (cwd, p) => { const rel = path.relative(cwd, path.resolve(cwd, p)).replace(/\\/g, '/'); return rel === '' || rel.startsWith('..') ? p : rel; };

// Called by `dispatch begin executor` with the plan paths of the open executor leases. null = allowed, else the refusal text.
function leaseConflict(cwd, newPlan, openPlans) {
  const a = readPlan(cwd, newPlan);
  if (!a) return `plan ${newPlan} is not readable`;
  if (a.error) return `plan ${newPlan}: ${a.error}`;
  for (const p of openPlans) {
    const b = readPlan(cwd, p);
    if (!b) return `plan ${p} of the open executor lease is not readable`;
    if (b.error) return `plan ${p} of the open executor lease: ${b.error}`;
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
  if (a.error || b.error) return { error: `plan overlap: ${a.error ? `${planA}: ${a.error}` : `${planB}: ${b.error}`}` };
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
  if (plan.error) return { error: `claims check: ${plan.error}` };
  let text = '';
  try { text = fs.readFileSync(path.resolve(cwd, claimsFile || '.tmp/phase-file-claims.md'), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return { error: 'claims check: claims file is not readable' }; }
  const conflicts = [];
  for (const r of claimedRows(text)) {
    if (lane && r.lane.startsWith(lane)) continue;
    for (const f of plan.files) if (within(f, r.file) || within(r.file, f)) conflicts.push({ file: f, claimed: r.file, lane: r.lane });
  }
  return { clear: conflicts.length === 0, conflicts };
}

// `plan rebase-check <plan>`: a plan written ahead (plan_base_sha) is stale for the files that changed since then (D-281).
function cmdRebaseCheck(cwd, planPath) {
  const plan = planPath && readPlan(cwd, planPath);
  if (!plan) return { error: 'plan rebase-check: a readable plan file is required' };
  if (plan.error) return { error: `plan rebase-check: ${plan.error}` };
  let sha;
  try { sha = String(matter(fs.readFileSync(path.resolve(cwd, planPath), 'utf8')).data.plan_base_sha || ''); } catch { sha = ''; }
  const diff = /^[0-9a-f]{7,40}$/i.test(sha) ? spawnSync('git', ['diff', '--name-only', sha, 'HEAD'], { cwd, encoding: 'utf8' }) : null;
  if (!diff || diff.status !== 0) return { error: 'plan rebase-check: plan_base_sha is missing or not a commit of this repository' };
  const changed = diff.stdout.split('\n').filter(Boolean).map((f) => norm(f));
  const conflicts = changed.filter((c) => plan.files.some((f) => within(f, c) || within(c, f)));
  return { clean: conflicts.length === 0, conflicts };
}

// Per-plan checkpoint: TASK-CHECKPOINT-<plan_id>.json. A phase checkpointed by an older build only has TASK-CHECKPOINT.json: read it when the per-plan file is absent and its `plan` names this plan.
// With two open executor leases the phase-scoped file belongs to neither plan, and it is a fallback only when its `plan` field names this plan.
const PLAN_CHECKPOINT = /TASK-CHECKPOINT-(.+)\.json$/;
function legacyNamesPlan(legacy, planId) {
  try {
    const { plan } = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    return plan !== undefined && String(plan) === planId;
  } catch { return false; }
}
function resolveTaskCheckpoint(file, openExecutors) {
  if (fs.existsSync(file)) return file;
  const planId = (file.match(PLAN_CHECKPOINT) || [])[1];
  const legacy = path.join(path.dirname(file), 'TASK-CHECKPOINT.json');
  const useLegacy = openExecutors <= 1 && planId !== undefined && fs.existsSync(legacy) && legacyNamesPlan(legacy, planId);
  return useLegacy ? legacy : file;
}

module.exports = { planInfo, overlap, leaseConflict, repoRelative, cmdOverlap, cmdClaimsCheck, cmdRebaseCheck, claimedRows, resolveTaskCheckpoint };
