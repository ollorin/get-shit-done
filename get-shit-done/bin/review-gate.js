'use strict';
// Disk check for the final review (references/rigour.md rule 10): a phase whose commits touched files outside
// .planning/ needs the review record {N}-REVIEW.md (the newest final pass's findings; at risk add-ons pass 2 overwrites pass 1's).
// Frontmatter: reviewer_role, passes (1; 2 at risk add-ons), open_critical_high, ruled_by.
// It must carry no open CRITICAL/HIGH finding unless a ruling id is recorded.
const fs = require('fs');
const path = require('path');

const RULING_ID = /^D-\d+$/;
const rulings = (data) => (Array.isArray(data.ruled_by) ? data.ruled_by : data.ruled_by ? [data.ruled_by] : []).map((x) => String(x).trim()).filter(Boolean);
// null: absent; a number only for a whole count ("2 high", 1.5 and -1 are invalid)
const countOf = (v) => (v === undefined || v === null || v === '' ? undefined : typeof v === 'number' ? v : /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
const bad = (ids) => ids.filter((x) => !RULING_ID.test(x));

function reviewErrors(phaseDir, dirFiles, touchedFiles, { risk = false } = {}) {
  const code = (touchedFiles || []).filter((f) => !f.startsWith('.planning/'));
  if (code.length === 0) return [];
  const file = dirFiles.find((f) => /-REVIEW\.md$/.test(f));
  if (!file) return [`No {N}-REVIEW.md: the phase changed ${code.length} file(s) outside .planning/ and needs the final review record`];
  let data = {};
  try { data = require('gray-matter')(fs.readFileSync(path.join(phaseDir, file), 'utf8')).data || {}; } catch { data = {}; }
  const open = countOf(data.open_critical_high);
  const passes = countOf(data.passes);
  const ruled = rulings(data);
  if (!Number.isInteger(open) || open < 0 || !data.reviewer_role) {
    return [`${file} frontmatter must carry reviewer_role and open_critical_high (a whole count)`];
  }
  if (passes !== 1 && passes !== 2) return [`${file} frontmatter must carry passes: 1 or 2 (pass 2 at risk add-ons)`];
  if (risk && passes !== 2) return [`${file} records ${passes} final pass: a phase with risk add-ons needs pass 2 (a fresh independent review of the fixed tree)`];
  if (bad(ruled).length > 0) return [`${file} ruled_by must list ruling ids like D-12, not ${bad(ruled).join(', ')}`];
  if (open > 0 && ruled.length === 0) return [`${file} has open_critical_high ${open} and no ruling id in ruled_by`];
  return [];
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
function verificationReviewErrors(verification, spike, closedEarlier = false) {
  if (!verification || !verification.exists) return [];
  const data = verification.data || {};
  const open = countOf(data.open_critical_high);
  const ruled = rulings(data);
  const name = verification.fileName;
  const errors = spike && !closedEarlier ? criteriaErrors(data, name) : [];
  if (open === undefined) return spike && !closedEarlier ? [`${name} frontmatter must carry open_critical_high (a whole count): at spike it is the review record`, ...errors] : [];
  if (!Number.isInteger(open) || open < 0) return [`${name} open_critical_high must be a whole count, not ${JSON.stringify(data.open_critical_high)}`, ...errors];
  if (bad(ruled).length > 0) return [`${name} ruled_by must list ruling ids like D-12, not ${bad(ruled).join(', ')}`, ...errors];
  if (open > 0 && ruled.length === 0) return [`${name} has open_critical_high ${open} and no ruling id in ruled_by: after the one fix dispatch close a fixed finding from disk evidence (fixed_by commit + re-run rc) and lower the count, or have ONE ruling dispatch on ruling_model rule on it`, ...errors];
  return errors;
}

module.exports = { reviewErrors, verificationReviewErrors };
