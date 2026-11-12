// Findings register: pure parsing and serialising. Results are { ok, value } | { ok, error }; nothing here throws on bad input.
//
// @typedef {{ ok: true, value: any } | { ok: false, error: string }} ParseResult
// @typedef {Record<string, string>} RegisterRow  one string per COLUMNS entry, plus ver_verdicts (the raw cell, memory only)
// @typedef {{ id: string, decision: string, sev: string, evidence: string }} TriageRow
// @typedef {{ name: string, text: string }} SourceFile
// @typedef {{ raw: string, extras: string, triage: string, units: SourceFile[], findings?: string, ownerMap?: object }} RegisterInputs

export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });

export const COLUMNS = [
  'id', 'kind', 'unit', 'src', 'class', 'sev_written', 'sev_ver', 'sev_effective', 'ver_verdict', 'ver_src', 'site',
  'owner_prev', 'disposition', 'disposition_evidence', 'owner_phase', 'related_ids', 'seeded_from', 'verified_at_head', 'status',
];

export const BLANK_ROW = { ...Object.fromEntries(COLUMNS.map((c) => [c, ''])), ver_verdicts: '' };

export const RAW_COLUMNS = ['id', 'unit', 'src', 'class', 'sev_written', 'site', 'owner', 'confidence', 'ver_verdicts'];

const TRIAGE_DECISION = 'NEXT-MILESTONE';

export const normaliseSev = (s) => {
  const sev = s === 'MEDIUM' ? 'MED' : s;
  return ['CRITICAL', 'HIGH', 'MED', 'LOW'].includes(sev) ? sev : '';
};

// A dependency-free TSV reader: tab separator, double-quoted cells with "" as a quote, lazy quotes (a quote inside an unquoted cell
// is literal), CRLF or LF rows. Rows that are a single empty cell are dropped.
export function readTsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i += 1; continue; }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; i += 1; continue; }
    if (ch === '\t') { endCell(); i += 1; continue; }
    if (ch === '\r' && text[i + 1] === '\n') { endRow(); i += 2; continue; }
    if (ch === '\n') { endRow(); i += 1; continue; }
    cell += ch;
    i += 1;
  }
  if (inQuotes) return err('tsv parse failed: unterminated quoted cell');
  if (cell !== '' || row.length > 0) endRow();
  return ok(rows.filter((r) => !(r.length === 1 && r[0] === '')));
}

const toRecord = (keys, cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? '']));
const sameHeader = (header, expected) => header.length === expected.length && header.every((h, i) => h === expected[i]);
const firstDuplicate = (xs) => xs.find((x, i) => xs.indexOf(x) !== i);

function readRecords(text, columns, label) {
  const table = readTsv(text);
  if (!table.ok) return err(`${label}: ${table.error}`);
  const [header = [], ...body] = table.value;
  if (!sameHeader(header, columns)) return err(`${label} header mismatch: ${header.join(',')}`);
  // Trailing empty cells may be dropped by writers, so short rows pad; over-long rows fail.
  const bad = body.findIndex((r) => r.length > columns.length);
  if (bad >= 0) return err(`${label} row ${bad + 2} has ${body[bad].length} fields, expected ${columns.length}`);
  return ok(body.map((cells) => toRecord(columns, cells)));
}

const fromRaw = (raw) => ({
  ...BLANK_ROW, id: raw.id, unit: raw.unit, src: raw.src, class: raw.class, sev_written: raw.sev_written, site: raw.site,
  owner_prev: raw.owner, ver_verdicts: raw.ver_verdicts,
});

export function parseRawRegister(text) {
  const rows = readRecords(text, RAW_COLUMNS, 'raw register');
  if (!rows.ok) return err(rows.error);
  const dup = firstDuplicate(rows.value.map((r) => r.id));
  return dup === undefined ? ok(rows.value.map(fromRaw)) : err(`duplicate raw id ${dup}`);
}

export function parseFindings(text) {
  const rows = readRecords(text, COLUMNS, 'findings');
  return rows.ok ? ok(rows.value.map((r) => ({ ...BLANK_ROW, ...r }))) : err(rows.error);
}

export function parseExtras(text) {
  if (text.trim() === '') return ok([]);
  const rows = readRecords(text, COLUMNS, 'extras');
  if (!rows.ok) return err(rows.error);
  if (rows.value.some((r) => r.id === '')) return err('extras row with empty id');
  return ok(rows.value.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== ''))));
}

const VERDICT_RE = /\b(CONFIRMED|OVERSTATED|DISPROVED|RECLASSIFIED|DUPLICATE)\b/;
const SEV_AFTER_RE = /^[^/\n.;]{0,80}\/\s*(CRITICAL|HIGH|MEDIUM|MED|LOW|none)\b(?:\s*→\s*(CRITICAL|HIGH|MEDIUM|MED|LOW)\b)?/;
const VER_SRC_RE = /\b([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-ver\.md:\d+)/;

// Quoted prose quoting a verdict is not a verdict.
const withoutQuotes = (cell) => cell.replace(/"[^"]*"/g, ' ');

export function parseVerVerdict(cell) {
  const text = withoutQuotes(cell);
  const hit = text.match(VERDICT_RE);
  if (!hit || hit.index === undefined) return { verdict: '', sevVer: '', duplicateHint: false };
  const word = hit[1];
  if (word === 'RECLASSIFIED' || word === 'DUPLICATE') return { verdict: 'RECLASSIFIED', sevVer: '', duplicateHint: true };
  const sev = text.slice(hit.index + word.length).match(SEV_AFTER_RE);
  return { verdict: word, sevVer: sev ? normaliseSev(sev[2] ?? sev[1]) : '', duplicateHint: false };
}

export const verSrc = (cell) => withoutQuotes(cell).match(VER_SRC_RE)?.[1] ?? '';

// "OWNED-BY-<release> [<phase>]" (release = three numeric parts, phase separated by a space or a dot) becomes one canonical value;
// anything else (a plain "this-milestone", or a phase glued to the release digits) is empty or read as part of the release.
export function normaliseOwner(raw) {
  const m = raw.trim().match(/^OWNED-BY-(v?\d+\.\d+\.\d+)\s*\.?\s*(\d[\d.-]*?)?\.?$/);
  return m ? (m[2] ? `OWNED-BY-${m[1]} ${m[2]}` : `OWNED-BY-${m[1]}`) : '';
}

export const collapseUnit = (unit) => unit.replace(/^(.*\d)[ab]$/, '$1');

const severityOf = (cell) => normaliseSev(cell.match(/^(CRITICAL|HIGH|MEDIUM|MED|LOW)\b/)?.[1] ?? '');

// Markdown table rows whose second cell is the triage decision NEXT-MILESTONE; prose mentioning it is ignored.
export const parseTriage = (text) => text.split(/\r?\n/).flatMap((line) => {
  const t = line.trim();
  const cells = t.startsWith('|') ? t.split('|').slice(1, -1).map((c) => c.trim()) : [];
  return cells.length >= 4 && cells[1] === TRIAGE_DECISION
    ? [{ id: cells[0].replaceAll('`', ''), decision: cells[1], sev: severityOf(cells[2]), evidence: cells[3] }]
    : [];
});

const cellOut = (v) => (/["\t\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export const serialiseRegister = (rows) => `${[COLUMNS.join('\t'), ...rows.map((r) => COLUMNS.map((c) => cellOut(r[c])).join('\t'))].join('\n')}\n`;
