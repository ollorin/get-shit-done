'use strict';
// Disk check for the final review (references/rigour.md rule 10): a phase whose commits touched files outside
// .planning/ needs the review record {N}-REVIEW.md (the newest final pass's findings; at risk add-ons pass 2 overwrites pass 1's).
// Frontmatter: passes (1; 2 at risk add-ons), open_critical_high, ruled_by.
// It must carry no open CRITICAL/HIGH finding unless a ruling id is recorded.
const fs = require('fs');
const path = require('path');

const RULING_ID = /^D-\d+$/;
const rulings = (data) => (Array.isArray(data.ruled_by) ? data.ruled_by : data.ruled_by ? [data.ruled_by] : []).map((x) => String(x).trim()).filter(Boolean);
// null: absent; a number only for a whole count ("2 high", 1.5 and -1 are invalid)
const countOf = (v) => (v === undefined || v === null || v === '' ? undefined : typeof v === 'number' ? v : /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
const bad = (ids) => ids.filter((x) => !RULING_ID.test(x));

// `ledger`: Map of decisions-ledger id -> kind (a ruled_by id must be a kind-decision row); `verificationOpen`: VERIFICATION's count.
function reviewErrors(phaseDir, dirFiles, touchedFiles, { risk = false, phaseNumber, ledger, verificationOpen } = {}) {
  const code = (touchedFiles || []).filter((f) => !f.startsWith('.planning/'));
  if (code.length === 0) return [];
  const file = dirFiles.find((f) => phaseNumber === undefined ? /-REVIEW\.md$/.test(f) : f === `${phaseNumber}-REVIEW.md`);
  if (!file) return [`No {N}-REVIEW.md: the phase changed ${code.length} file(s) outside .planning/ and needs the final review record`];
  let data = {};
  try { data = require('gray-matter')(fs.readFileSync(path.join(phaseDir, file), 'utf8')).data || {}; } catch { data = {}; }
  const open = countOf(data.open_critical_high);
  const passes = countOf(data.passes);
  const ruled = rulings(data);
  if (!Number.isInteger(open) || open < 0) {
    return [`${file} frontmatter must carry open_critical_high (a whole count)`];
  }
  if (passes !== 1 && passes !== 2) return [`${file} frontmatter must carry passes: 1 or 2 (pass 2 at risk add-ons)`];
  if (risk && passes !== 2) return [`${file} records ${passes} final pass: a phase with risk add-ons needs pass 2 (a fresh independent review of the fixed tree)`];
  if (bad(ruled).length > 0) return [`${file} ruled_by must list ruling ids like D-12, not ${bad(ruled).join(', ')}`];
  const ledgerErr = rulingLedgerErrors(file, ruled, ledger);
  if (ledgerErr.length > 0) return ledgerErr;
  if (open > 0 && ruled.length === 0) return [`${file} has open_critical_high ${open} and no ruling id in ruled_by`];
  if (verificationOpen !== undefined && Number.isInteger(verificationOpen) && verificationOpen !== open) return [`${file} open_critical_high ${open} differs from VERIFICATION's ${verificationOpen}: the re-check agent updates both`];
  return [];
}

// A ruling is a ledger row of kind `decision` (decisions-protocol.md: rulings are logged as `decision` rows).
const rulingLedgerErrors = (label, ruled, ledger) => {
  if (!(ledger instanceof Map)) return [];
  const missing = ruled.filter((x) => !ledger.has(x));
  if (missing.length > 0) return [`${label} ruled_by ${missing.join(', ')} not in the decisions ledger`];
  const notRuling = ruled.filter((x) => ledger.get(x) !== 'decision');
  return notRuling.length > 0 ? [`${label} ruled_by ${notRuling.map((x) => `${x} (kind ${ledger.get(x)})`).join(', ')}: not a ruling in the decisions ledger`] : [];
};

// The one matcher for "commits of phase N" (gate commit check, touched files / has_ui, phase_base, freshness; rigour.md rule 12):
// reachable from HEAD, SUBJECT scope starting `(<phase>-` then [0-9a-z] (`(1-01)`, `(01-gates)`, `(1-review-r2)`), the phase a
// whole token (zero-padded and unpadded forms are equal, 36 is not 365, 365 is not 365.1); the body is never searched. With
// `planNum`, only that plan's `(<phase>-NN)` commits. Oldest first, each { sha, ts, subject, files }. `execGit(cwd, args)`
// returns { stdout }.
const trimZeros = (p) => String(p).replace(/^0+(?=\d)/, '');
const reEsc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readLog = (execGit, cwd, phaseNumber) => {
  const out = (execGit(cwd, ['log', 'HEAD', '-F', '--grep', `${trimZeros(phaseNumber)}-`, '--reverse', '--name-only', '--format=%x01%H%x00%ct%x00%s']).stdout) || '';
  return out.split('\x01').filter(Boolean).map((chunk) => {
    const [head, ...files] = chunk.split('\n');
    const [sha, ts, subject] = head.split('\x00');
    return { sha, ts: Number(ts) || 0, subject, files: files.map((f) => f.trim()).filter(Boolean) };
  });
};
function phaseCommits(execGit, cwd, phaseNumber, planNum) {
  const plan = planNum === undefined ? '[0-9a-z]' : `${reEsc(String(planNum).padStart(2, '0'))}(?!\\d)`;
  const tag = new RegExp(`\\(0*${reEsc(trimZeros(phaseNumber))}-${plan}`);
  return readLog(execGit, cwd, phaseNumber).filter((c) => tag.test(c.subject));
}

// HEAD commits whose subject mentions the phase's two-digit plan token (`N-NN`, e.g. `01-03`) outside an accepted scope.
function untaggedPhaseCommits(execGit, cwd, phaseNumber, planNum) {
  const loose = new RegExp(`(^|[^0-9.-])0*${reEsc(trimZeros(phaseNumber))}-${planNum === undefined ? '\\d{2}' : reEsc(String(planNum).padStart(2, '0'))}([^0-9]|$)`);
  const tagged = new Set(phaseCommits(execGit, cwd, phaseNumber, planNum).map((c) => c.sha));
  return readLog(execGit, cwd, phaseNumber).filter((c) => !tagged.has(c.sha) && loose.test(c.subject));
}

// Commit time (s) of the newest phase commit that touched a file outside .planning/ and docs/, or 0.
function lastSourceCommitTs(execGit, cwd, phaseNumber) {
  let ts = 0;
  for (const c of phaseCommits(execGit, cwd, phaseNumber)) {
    if (c.ts > ts && c.files.some((f) => !f.startsWith('.planning/') && !f.startsWith('docs/'))) ts = c.ts;
  }
  return ts;
}

// A record's time: its last commit when tracked and clean, else its mtime.
function recordTs(execGit, cwd, file) {
  const rel = path.relative(cwd, file);
  const dirty = (execGit(cwd, ['status', '--porcelain', '--', rel]).stdout || '').trim() !== '';
  const committed = Number((execGit(cwd, ['log', '-1', '--format=%ct', '--', rel]).stdout || '').trim()) || 0;
  return dirty || !committed ? Math.floor(fs.statSync(file).mtimeMs / 1000) : committed;
}

function staleRecordErrors(execGit, cwd, phaseDir, phaseNumber, names) {
  const src = lastSourceCommitTs(execGit, cwd, phaseNumber);
  if (src === 0) return [];
  return names.filter((n) => fs.existsSync(path.join(phaseDir, n)) && recordTs(execGit, cwd, path.join(phaseDir, n)) < src)
    .map((n) => `${n} is older than the phase's last source commit: the fix re-check agent updates it (status or count) and commits it after the fix (rigour.md rule 12)`);
}

// Spike: `criteria_decided: n/m` (exit criteria with a decided pass or fail); with n = 0 the headline is `undecided`.
function criteriaErrors(data, name) {
  const m = String(data.criteria_decided === undefined ? '' : data.criteria_decided).trim().match(/^(\d+)\/(\d+)$/);
  if (!m || Number(m[2]) === 0 || Number(m[1]) > Number(m[2])) return [`${name} frontmatter must carry criteria_decided: <n>/<m> (decided exit criteria of m >= 1, n <= m): at spike it is the review record`];
  if (Number(m[1]) === 0 && String(data.headline || '').trim().toLowerCase() !== 'undecided') return [`${name} criteria_decided is 0/${m[2]}: the frontmatter must carry headline: undecided`];
  return [];
}

// The merged final review (spike) and every final review: the VERIFICATION frontmatter carries `open_critical_high` and `ruled_by`.
// `closedEarlier`: the phase has a phase_complete event, so the "must carry the field" rule (newer than the phase) is skipped;
// a field that is present is judged always.
function verificationReviewErrors(verification, spike, closedEarlier = false, ledger) {
  if (!verification || !verification.exists) return [];
  const data = verification.data || {};
  const open = countOf(data.open_critical_high);
  const ruled = rulings(data);
  const name = verification.fileName;
  const errors = spike && !closedEarlier ? criteriaErrors(data, name) : [];
  if (open === undefined) return spike && !closedEarlier ? [`${name} frontmatter must carry open_critical_high (a whole count): at spike it is the review record`, ...errors] : [];
  if (!Number.isInteger(open) || open < 0) return [`${name} open_critical_high must be a whole count, not ${JSON.stringify(data.open_critical_high)}`, ...errors];
  if (bad(ruled).length > 0) return [`${name} ruled_by must list ruling ids like D-12, not ${bad(ruled).join(', ')}`, ...errors];
  const ledgerErr = rulingLedgerErrors(name, ruled, ledger);
  if (ledgerErr.length > 0) return [...ledgerErr, ...errors];
  if (open > 0 && ruled.length === 0) return [`${name} has open_critical_high ${open} and no ruling id in ruled_by: after the one fix dispatch close a fixed finding from disk evidence (fixed_by commit + re-run rc) and lower the count, or have ONE ruling dispatch on ruling_model rule on it`, ...errors];
  return errors;
}

module.exports = { reviewErrors, verificationReviewErrors, staleRecordErrors, lastSourceCommitTs, phaseCommits, untaggedPhaseCommits };
