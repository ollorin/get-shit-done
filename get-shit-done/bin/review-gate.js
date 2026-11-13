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

function reviewErrors(phaseDir, dirFiles, touchedFiles) {
  const code = (touchedFiles || []).filter((f) => !f.startsWith('.planning/'));
  if (code.length === 0) return [];
  const last = newest(dirFiles);
  if (!last) return [`No {N}-REVIEW-{round}.md: the phase changed ${code.length} file(s) outside .planning/ and needs a review by a non-author`];
  let data = {};
  try { data = require('gray-matter')(fs.readFileSync(path.join(phaseDir, last.f), 'utf8')).data || {}; } catch { data = {}; }
  const open = Number(data.open_critical_high);
  const ruled = Array.isArray(data.ruled_by) ? data.ruled_by.filter(Boolean) : data.ruled_by ? [data.ruled_by] : [];
  if (!Number.isInteger(open) || open < 0 || !data.reviewer_role) {
    return [`${last.f} frontmatter must carry reviewer_role and open_critical_high (a count)`];
  }
  if (open > 0 && ruled.length === 0) return [`${last.f} has open_critical_high ${open} and no ruling id in ruled_by`];
  return [];
}

// The merged final review (spike) and every final review: the VERIFICATION frontmatter carries `open_critical_high` and `ruled_by`.
function verificationReviewErrors(verification, spike) {
  if (!verification || !verification.exists) return [];
  const data = verification.data || {};
  const has = data.open_critical_high !== undefined && data.open_critical_high !== null && data.open_critical_high !== '';
  const open = Number(data.open_critical_high);
  const ruled = Array.isArray(data.ruled_by) ? data.ruled_by.filter(Boolean) : data.ruled_by ? [data.ruled_by] : [];
  if (spike && (!has || !Number.isInteger(open) || open < 0)) return [`${verification.fileName} frontmatter must carry open_critical_high (a count): at spike it is the review record`];
  if (has && Number.isInteger(open) && open > 0 && ruled.length === 0) return [`${verification.fileName} has open_critical_high ${open} and no ruling id in ruled_by: fix the finding (one fix dispatch) or rule on it`];
  return [];
}

module.exports = { reviewErrors, verificationReviewErrors };
