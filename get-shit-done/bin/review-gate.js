'use strict';
// Disk check for the final review (references/rigour.md rule 10): a phase whose commits touched files outside
// .planning/ needs the review record {N}-REVIEW.md (the newest final pass's findings; at risk add-ons pass 2 appends to pass 1's).
// Frontmatter `format: v2`: `passes` (1; 2 at risk add-ons) and a findings table (| id | sev | state | owner |) whose rows are the
// record; the open count is computed from them, never typed. A row not `closed` carries an owner: a ledger decision id (D-NN, a
// ruling; A-NN for a MED/LOW row) or a phase whose ROADMAP success-criterion or requirement line names the finding id.
// CRITICAL/HIGH and refuted rows need a D- ruling. A record without `format: v2` is judged by the legacy rule (legacyReviewErrors:
// frontmatter open_critical_high, ruled_by), so phases already in flight are not refused on parse.
const fs = require('fs');
const path = require('path');

const RULING_ID = /^D-\d+$/;
const rulings = (data) => (Array.isArray(data.ruled_by) ? data.ruled_by : data.ruled_by ? [data.ruled_by] : []).map((x) => String(x).trim()).filter(Boolean);
// null: absent; a number only for a whole count ("2 high", 1.5 and -1 are invalid)
const countOf = (v) => (v === undefined || v === null || v === '' ? undefined : typeof v === 'number' ? v : /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
const bad = (ids) => ids.filter((x) => !RULING_ID.test(x));

// A `\|` inside a cell is a literal bar, not a column break.
const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
const SEVERITY = { critical: 'ch', crit: 'ch', high: 'ch', med: 'ml', medium: 'ml', low: 'ml' };
// The findings table: the first table whose header names id, sev, state and owner. null: none; else rows { id, sev, state, owner }.
function parseFindings(body) {
  const lines = String(body || '').split('\n');
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+$/.test(lines[i + 1])) continue;
    const head = cells(lines[i]).map((c) => c.toLowerCase());
    const col = { id: head.indexOf('id'), sev: Math.max(head.indexOf('sev'), head.indexOf('severity')), state: head.indexOf('state'), owner: head.indexOf('owner') };
    const fixCol = ['fix', 'evidence', 'fixed_by', 'fixed by'].map((h) => head.indexOf(h)).find((x) => x >= 0);
    if (Object.values(col).some((x) => x < 0)) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j += 1) {
      const c = cells(lines[j]);
      rows.push({ id: c[col.id] || '', sev: (c[col.sev] || '').toLowerCase(), state: (c[col.state] || '').toLowerCase(), owner: c[col.owner] || '', fix: fixCol === undefined ? '' : c[fixCol] || '' });
    }
    return rows;
  }
  return null;
}
const isOpen = (r) => !/^closed\b/.test(r.state);

// Lines of a section that are not inside a ``` / ~~~ fenced block.
function outsideFences(section) {
  let fence = false;
  return section.split('\n').filter((l) => { if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return false; } return !fence; });
}

// Errors for the findings of a review record; `ledger` Map id -> kind, `phaseSection(phase)` the ROADMAP section text or null.
function findingErrors(file, rows, { ledger, phaseSection } = {}) {
  const errors = [];
  const noId = rows.filter((r) => !r.id);
  if (noId.length > 0) errors.push(`${file} has ${noId.length} findings row(s) with no id`);
  const unknownSev = rows.filter((r) => r.id && !SEVERITY[r.sev]);
  if (unknownSev.length > 0) errors.push(`${file} findings with an unknown severity (CRITICAL, HIGH, MED, LOW): ${unknownSev.map((r) => r.id).join(', ')}`);
  // A closed row names its proof: a commit sha or a captures/ path in its `fix` (or `evidence`, `fixed_by`) cell, or after `closed` in the state cell.
  const noEvidence = rows.filter((r) => r.id && SEVERITY[r.sev] && !isOpen(r) && !/(^|[^0-9a-z])(?=[0-9a-f]*\d)[0-9a-f]{7,40}($|[^0-9a-z])|captures\//i.test(`${r.fix} ${r.state}`.replace(/^closed\b/i, '')));
  if (noEvidence.length > 0) errors.push(`${file} closed findings without an evidence cell (a commit sha or a captures/ path in the fix column): ${noEvidence.map((r) => r.id).join(', ')}`);
  const unowned = [];
  const unruled = [];
  const unrefuted = [];
  for (const r of rows.filter((x) => x.id && SEVERITY[x.sev] && isOpen(x))) {
    const owner = r.owner.replace(/`/g, '').trim();
    const d = /^D-\d+$/.test(owner);
    const a = /^A-\d+$/.test(owner);
    const inLedger = ledger instanceof Map ? ledger.has(owner) && (!d || ledger.get(owner) === 'decision') : true;
    if (SEVERITY[r.sev] === 'ch' && !(d && inLedger)) { unruled.push(r.id); continue; }
    if (/^refuted\b/.test(r.state) && !(d && inLedger)) { unrefuted.push(r.id); continue; }
    if ((d || a) && inLedger) continue;
    const section = /^\d+(\.\d+)?$/.test(owner) && typeof phaseSection === 'function' ? phaseSection(owner) : null;
    const named = new RegExp(`(^|[^\\w-])${r.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`);
    if (section && outsideFences(section).some((l) => !/^\s*#/.test(l) && /^\s*(\d+[.)]|[-*+])\s/.test(l) && named.test(l))) continue;
    unowned.push(r.id);
  }
  if (unruled.length > 0) errors.push(`${file} open CRITICAL/HIGH findings without a D-NN ruling in the decisions ledger as owner: ${unruled.join(', ')}`);
  if (unrefuted.length > 0) errors.push(`${file} refuted findings without a D-NN ruling in the decisions ledger as owner: ${unrefuted.join(', ')}`);
  if (unowned.length > 0) errors.push(`${file} non-closed findings with no owner: a ledger id (D-NN or A-NN) or a phase whose ROADMAP success-criterion or requirement line names the finding id: ${unowned.join(', ')}`);
  return errors;
}

// `ledger`: Map of decisions-ledger id -> kind (a D- owner must be a kind-decision row); `phaseSection`: phase number -> ROADMAP section text.
function reviewErrors(phaseDir, dirFiles, touchedFiles, { risk = false, phaseNumber, ledger, phaseSection, verificationOpen } = {}) {
  const code = (touchedFiles || []).filter((f) => !f.startsWith('.planning/'));
  if (code.length === 0) return [];
  const file = dirFiles.find((f) => phaseNumber === undefined ? /-REVIEW\.md$/.test(f) : f === `${phaseNumber}-REVIEW.md`);
  if (!file) return [`No {N}-REVIEW.md: the phase changed ${code.length} file(s) outside .planning/ and needs the final review record`];
  let parsed = { data: {}, content: '' };
  try { parsed = require('gray-matter')(fs.readFileSync(path.join(phaseDir, file), 'utf8')); } catch { parsed = { data: {}, content: '' }; }
  if (String((parsed.data || {}).format).trim() !== 'v2') return legacyReviewErrors(file, parsed.data || {}, { risk, ledger, verificationOpen });
  const passes = countOf((parsed.data || {}).passes);
  if (passes !== 1 && passes !== 2) return [`${file} frontmatter must carry passes: 1 or 2 (pass 2 at risk add-ons)`];
  if (risk && passes !== 2) return [`${file} records ${passes} final pass: a phase with risk add-ons needs pass 2 (a fresh independent review of the fixed tree)`];
  const rows = parseFindings(parsed.content);
  if (rows === null) return [`${file} has no findings table: a header row | id | sev | state | owner | (zero findings: the header alone)`];
  return findingErrors(file, rows, { ledger, phaseSection });
}

// Legacy record (no `format: v2`): hand-typed frontmatter open_critical_high and ruled_by; VERIFICATION's count must agree.
function legacyReviewErrors(file, data, { risk, ledger, verificationOpen }) {
  const open = countOf(data.open_critical_high);
  const passes = countOf(data.passes);
  const ruled = rulings(data);
  if (!Number.isInteger(open) || open < 0) return [`${file} frontmatter must carry open_critical_high (a whole count)`];
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

// Records stamped with the git HEAD they were produced at are fresh until a later commit changes a path they prove
// (`git diff <head>..HEAD`), not by file time. `{N}-REVIEW.md` / `{N}-VERIFICATION.md` carry frontmatter `head: <sha>` and prove the
// phase's source files; a `captures/gates.txt` section starts with `# gate=<name> head=<sha> [paths=<a,b>]` (written by
// `gsd-tools capture stamp`) and proves its `paths` (default: the phase's source files); the newest section per gate counts.
// An unstamped record keeps the older file-time rule (mtimeStaleErrors); an unstamped gates.txt is not checked.
const SECTION = /^# gate=(\S+) head=([0-9a-f]{7,40})(?: paths=(\S+))?[ \t\r]*$/gm;
const inScope = (file, paths) => paths.some((p) => file === p || file.startsWith(`${p.replace(/\/+$/, '')}/`));
const proven = (touched) => (touched || []).filter((f) => !f.startsWith('.planning/') && !f.startsWith('docs/'));

function headDrift(execGit, cwd, head, scope) {
  const r = execGit(cwd, ['diff', '--name-only', '--no-renames', `${head}..HEAD`]);
  if (r.exitCode !== 0) return { error: `head ${head} is not a commit of this repository` };
  return { files: (r.stdout || '').split('\n').map((f) => f.trim()).filter((f) => f && scope(f)) };
}

function staleRecordErrors(execGit, cwd, phaseDir, phaseNumber, names, touched, declared = []) {
  // Proven = every file of every phase-tagged commit (plan tags and fix(N-...) tags), so a file first added by a review fix goes stale too,
  // plus the plans' declared `files_modified` (a file or a directory prefix), so a fix commit with no `(N-...)` tag on a declared path still stales it.
  const src = proven([...(touched || []), ...phaseCommits(execGit, cwd, phaseNumber).flatMap((c) => c.files)]);
  const decl = (declared || []).map((p) => String(p).replace(/^\.\//, '')).filter(Boolean);
  const inSrc = (f) => src.includes(f) || (proven([f]).length > 0 && inScope(f, decl));
  const errors = [];
  const unstamped = [];
  for (const n of names) {
    const file = path.join(phaseDir, n);
    if (!fs.existsSync(file)) continue;
    let head = '';
    try { head = String((require('gray-matter')(fs.readFileSync(file, 'utf8')).data || {}).head || '').trim(); } catch { head = ''; }
    if (!head) { unstamped.push(n); continue; }
    const d = headDrift(execGit, cwd, head, inSrc);
    if (d.error) errors.push(`${n} ${d.error}`);
    else if (d.files.length > 0) errors.push(`${n} is stale: ${d.files.slice(0, 3).join(', ')}${d.files.length > 3 ? ' ...' : ''} changed after its head ${head.slice(0, 9)}: the fix re-check agent updates it and re-stamps it with \`gsd-tools capture stamp\` (rigour.md rule 12)`);
  }
  errors.push(...mtimeStaleErrors(execGit, cwd, phaseDir, phaseNumber, unstamped));
  const gates = path.join(phaseDir, 'captures', 'gates.txt');
  if (fs.existsSync(gates)) {
    const newest = new Map();
    const text = fs.readFileSync(gates, 'utf8');
    for (const m of text.matchAll(SECTION)) newest.set(m[1], { head: m[2], paths: m[3] ? m[3].split(',') : null });
    // Parse or fail: a `# gate=` line that does not match the stamp format would otherwise leave its section unchecked.
    const declared = text.split('\n').filter((l) => /^# gate=/.test(l));
    const parsed = [...text.matchAll(SECTION)].length;
    if (declared.length !== parsed) errors.push(`gates.txt has ${declared.length - parsed} "# gate=" line(s) that do not parse (expected \`# gate=<name> head=<lowercase sha> [paths=<a,b>]\`, no spaces in paths): ${declared.filter((l) => !/^# gate=(\S+) head=([0-9a-f]{7,40})(?: paths=(\S+))?[ \t\r]*$/.test(l)).slice(0, 2).join(' | ').slice(0, 160)}`);
    for (const [gate, { head, paths }] of newest) {
      const d = headDrift(execGit, cwd, head, paths ? (f) => inScope(f, paths) : inSrc);
      if (d.error) errors.push(`gates.txt section ${gate} ${d.error}`);
      else if (d.files.length > 0) errors.push(`gates.txt section ${gate} is stale: ${d.files.slice(0, 3).join(', ')}${d.files.length > 3 ? ' ...' : ''} changed after its head ${head.slice(0, 9)}: re-run it and append a newly stamped section`);
    }
  }
  return errors;
}

// `gsd-tools capture stamp <file> [--gate <name>] [--paths a,b]`: refuses while tracked source has uncommitted changes (the stamp
// would name a commit the proof did not run at). An .md record gets frontmatter `head:`; any other file gets a section line.
function stampHead(execGit, cwd, file, { gate = 'gates', paths } = {}) {
  const names = (args) => (execGit(cwd, args).stdout || '').split('\n').map((l) => l.trim()).filter((f) => f && !f.startsWith('.planning/') && !f.startsWith('docs/'));
  const dirty = [...names(['diff', '--name-only', 'HEAD']), ...names(['ls-files', '--others', '--exclude-standard'])];
  if (dirty.length > 0) return { error: `uncommitted source changes (${dirty.slice(0, 3).join(', ')}): commit them first so the stamp names the commit the proof ran at` };
  const head = (execGit(cwd, ['rev-parse', 'HEAD']).stdout || '').trim();
  if (!/^[0-9a-f]{40}$/.test(head)) return { error: 'cannot read HEAD' };
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/\.md$/.test(file)) {
    const nl = /\r\n/.test(text) ? '\r\n' : '\n';
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const next = !m ? `---${nl}head: ${head}${nl}---${nl}${text}`
      : /^head:.*$/m.test(m[1]) ? text.replace(/^head:[^\r\n]*/m, `head: ${head}`)
      : text.replace(m[0], `---${nl}${m[1]}${nl}head: ${head}${nl}---${nl}`);
    fs.writeFileSync(file, next);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}# gate=${gate} head=${head}${paths ? ` paths=${paths}` : ''}\n`);
  }
  return { head };
}

function mtimeStaleErrors(execGit, cwd, phaseDir, phaseNumber, names) {
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

module.exports = { stampHead, reviewErrors, verificationReviewErrors, staleRecordErrors, lastSourceCommitTs, phaseCommits, untaggedPhaseCommits };
