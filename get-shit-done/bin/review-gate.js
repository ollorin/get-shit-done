'use strict';
// Disk check for the implementation review (references/rigour.md rule 10): a phase whose commits touched files outside
// .planning/ needs {N}-REVIEW-{round}.md files, and the newest round must carry no open CRITICAL/HIGH finding unless a
// ruling id is recorded. The reviewer writes the frontmatter: round, reviewer_role, open_critical_high, ruled_by.
const fs = require('fs');
const path = require('path');

const newest = (dirFiles) => dirFiles
  .map((f) => ({ f, m: f.match(/-REVIEW-(\d+)\.md$/) }))
  .filter((x) => x.m)
  .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
  .pop();

const RULING_ID = /^D-\d+$/;
const rulings = (data) => (Array.isArray(data.ruled_by) ? data.ruled_by : data.ruled_by ? [data.ruled_by] : []).map((x) => String(x).trim()).filter(Boolean);
// null: absent; a number only for a whole count ("2 high", 1.5 and -1 are invalid)
const countOf = (v) => (v === undefined || v === null || v === '' ? undefined : typeof v === 'number' ? v : /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
const bad = (ids) => ids.filter((x) => !RULING_ID.test(x));

function reviewErrors(phaseDir, dirFiles, touchedFiles) {
  const code = (touchedFiles || []).filter((f) => !f.startsWith('.planning/'));
  if (code.length === 0) return [];
  const last = newest(dirFiles);
  if (!last) return [`No {N}-REVIEW-{round}.md: the phase changed ${code.length} file(s) outside .planning/ and needs a review by a non-author`];
  let data = {};
  try { data = require('gray-matter')(fs.readFileSync(path.join(phaseDir, last.f), 'utf8')).data || {}; } catch { data = {}; }
  const open = countOf(data.open_critical_high);
  const ruled = rulings(data);
  if (!Number.isInteger(open) || open < 0 || !data.reviewer_role) {
    return [`${last.f} frontmatter must carry reviewer_role and open_critical_high (a whole count)`];
  }
  if (bad(ruled).length > 0) return [`${last.f} ruled_by must list ruling ids like D-12, not ${bad(ruled).join(', ')}`];
  if (open > 0 && ruled.length === 0) return [`${last.f} has open_critical_high ${open} and no ruling id in ruled_by`];
  return [];
}

// The merged final review (spike) and every final review: the VERIFICATION frontmatter carries `open_critical_high` and `ruled_by`.
// `closedEarlier`: the phase has a phase_complete event, so the "must carry the field" rule (newer than the phase) is skipped;
// a field that is present is judged always.
function verificationReviewErrors(verification, spike, closedEarlier = false) {
  if (!verification || !verification.exists) return [];
  const data = verification.data || {};
  const open = countOf(data.open_critical_high);
  const ruled = rulings(data);
  const name = verification.fileName;
  if (open === undefined) return spike && !closedEarlier ? [`${name} frontmatter must carry open_critical_high (a whole count): at spike it is the review record`] : [];
  if (!Number.isInteger(open) || open < 0) return [`${name} open_critical_high must be a whole count, not ${JSON.stringify(data.open_critical_high)}`];
  if (bad(ruled).length > 0) return [`${name} ruled_by must list ruling ids like D-12, not ${bad(ruled).join(', ')}`];
  if (open > 0 && ruled.length === 0) return [`${name} has open_critical_high ${open} and no ruling id in ruled_by: after the one fix dispatch close a fixed finding from disk evidence (fixed_by commit + re-run rc) and lower the count, or have ONE ruling dispatch on ruling_model rule on it`];
  return [];
}

module.exports = { reviewErrors, verificationReviewErrors };
