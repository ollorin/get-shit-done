#!/usr/bin/env node
// Findings register seeder and checker. A register is one TSV row per finding (the COLUMNS of lib/findings-register/parse.mjs),
// seeded once from a raw register, extra rows and a triage table, then checked for drift against its sources.
//   seed     builds the register from the inputs and writes the findings file; create-only (refuses when it exists).
//   --check  every source id in the unit files has a register row; ids are unique; every row has an owner phase; every
//            mutation-proven / fail-first-proven row cites committed evidence (a path holding "-evidence/") and no bare scratch
//            path; every unproven row carries a route ("UNPROVEN <plan>: <why> owner <phase>").
// Inputs (all under --dir, default .planning/phases/findings, each overridable): --raw raw-register.tsv, --units units/ (*.md),
// --triage TRIAGE.md, --extras extras.tsv, --findings FINDINGS.tsv, and the optional --owner-map owner-map.json (see
// lib/findings-register/owner.mjs; absent means a unit owns its findings). An unreadable input is a failure.
// Usage: node scripts/findings-register.mjs seed | --check [--dir <dir>] [--raw <f>] [--units <d>] [--triage <f>] [--extras <f>]
//        [--findings <f>] [--owner-map <f>]
// Exit: 0 ok, 1 a failed check or unreadable input, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BLANK_ROW, collapseUnit, err, normaliseOwner, ok, parseExtras, parseFindings, parseRawRegister, parseTriage, parseVerVerdict,
  serialiseRegister, verSrc,
} from './lib/findings-register/parse.mjs';
import { ownerPhase, triageOwnerPhase, validateOwnerMap } from './lib/findings-register/owner.mjs';
import { buildTelemetry, listSourceIds } from './lib/findings-register/telemetry.mjs';

export { collapseUnit, normaliseOwner, parseFindings, parseRawRegister, parseTriage, parseVerVerdict, serialiseRegister } from './lib/findings-register/parse.mjs';
export { ownerPhase } from './lib/findings-register/owner.mjs';
export { buildTelemetry, countSourceIds, listSourceIds } from './lib/findings-register/telemetry.mjs';
export { COLUMNS } from './lib/findings-register/parse.mjs';

const effectiveSev = (sevVer, sevWritten) => (sevVer !== '' ? sevVer : sevWritten);
const definedOnly = (e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));

export const rawToRows = (raw, ownerMap) => raw.map((r) => {
  const unit = collapseUnit(r.unit);
  const ver = parseVerVerdict(r.ver_verdicts);
  const override = Object.hasOwn(ownerMap?.severity_overrides ?? {}, r.id) ? ownerMap.severity_overrides[r.id] : undefined;
  const sevVer = override?.sev ?? ver.sevVer;
  const owner = ownerPhase(unit, r.class, ownerMap);
  return {
    ...BLANK_ROW, id: r.id, kind: 'register', unit, src: r.src, class: r.class, sev_written: r.sev_written, sev_ver: sevVer,
    sev_effective: effectiveSev(sevVer, r.sev_written), ver_verdict: ver.verdict, ver_src: override?.source ?? verSrc(r.ver_verdicts),
    site: r.site, owner_prev: normaliseOwner(r.owner_prev), owner_phase: owner.ok ? owner.value : '', seeded_from: 'raw-register.tsv',
    status: 'candidate',
  };
});

const withEffective = (row) => ({ ...row, sev_effective: effectiveSev(row.sev_ver, row.sev_written) });

export function mergeExtras(rows, extras) {
  const updated = rows.map((row) => extras.filter((e) => e.id === row.id).reduce((acc, e) => ({ ...acc, ...definedOnly(e) }), row));
  const known = new Set(rows.map((r) => r.id));
  const added = extras.filter((e) => !known.has(e.id)).map((e) => ({ ...BLANK_ROW, ...definedOnly(e) }));
  return [...updated, ...added].map(withEffective);
}

const triageToRows = (triage, ownerMap) => triage.map((t) => {
  const owner = triageOwnerPhase(t.id, t.evidence, ownerMap);
  return {
    ...BLANK_ROW, id: t.id, kind: 'triage', src: 'TRIAGE.md', sev_written: t.sev, sev_effective: t.sev, owner_phase: owner.ok ? owner.value : '',
    seeded_from: 'TRIAGE.md', status: 'candidate',
  };
});

const firstDuplicate = (xs) => xs.find((x, i) => xs.indexOf(x) !== i);

export function buildRegister(inputs) {
  const raw = parseRawRegister(inputs.raw);
  if (!raw.ok) return err(`raw register: ${raw.error}`);
  const extras = parseExtras(inputs.extras);
  if (!extras.ok) return err(`extras: ${extras.error}`);
  const rows = [...mergeExtras(rawToRows(raw.value, inputs.ownerMap), extras.value), ...triageToRows(parseTriage(inputs.triage), inputs.ownerMap)];
  const dup = firstDuplicate(rows.map((r) => r.id));
  return dup === undefined ? ok(rows) : err(`duplicate id ${dup}`);
}

const idsOf = (r) => (r.ok ? r.value.map((x) => x.id) : []);

// Scratch locations: evidence that lives only there is lost when the scratch is cleaned.
export const SCRATCH_PREFIXES = [
  { contains: '.tmp/', suffix: '', gitignore: '.tmp/' },
  { contains: '.planning/test-runs/', suffix: '.log', gitignore: '.planning/test-runs/*.log' },
];

const PROVEN = new Set(['mutation-proven', 'fail-first-proven']);
const GUARDED = new Set([...PROVEN, 'unproven']);
const UNPROVEN_ROUTE = /^UNPROVEN [0-9]+-[0-9]+: .+ owner [0-9]{3}(-[0-9]+)?(?![0-9])/;
const TOKEN_SPLIT = /[\s;,|]+/;
const TOKEN_EDGE = /^[`"'()[\]{}<>]+|[`"'()[\]{}<>.:]+$/g;

const tokensOf = (cell) => cell.split(TOKEN_SPLIT).map((t) => t.replace(TOKEN_EDGE, '')).filter((t) => t !== '');
const isLost = (token) => token.startsWith('lost:');
const isScratch = (token) => SCRATCH_PREFIXES.some((p) => token.includes(p.contains) && token.includes(p.suffix));

const bareMessages = (row) => tokensOf(row.disposition_evidence).filter((t) => !isLost(t) && isScratch(t)).map((t) => `bare scratch evidence: ${row.id} ${t}`);

function provenMessages(row) {
  const bare = bareMessages(row);
  const committed = tokensOf(row.disposition_evidence).some((t) => !isLost(t) && !isScratch(t) && t.includes('-evidence/'));
  return committed ? bare : [...bare, `no committed evidence: ${row.id}`];
}

const routeMessages = (row) => (row.disposition_evidence.split('|').some((s) => UNPROVEN_ROUTE.test(s.trim())) ? [] : [`unproven without route: ${row.id}`]);
const unprovenMessages = (row) => [...bareMessages(row), ...routeMessages(row)];

export const evidenceMessages = (rows) => rows.flatMap((r) => (PROVEN.has(r.status) ? provenMessages(r) : r.status === 'unproven' ? unprovenMessages(r) : []));

// Deliberately dumber than parseFindings: any tab-delimited cell equal to a guarded status.
function countMessages(findingsText, rows) {
  const raw = findingsText.split('\n').filter((l) => l.split('\t').some((c) => GUARDED.has(c))).length;
  const seen = rows.filter((r) => GUARDED.has(r.status)).length;
  return seen === raw ? [] : [`evidence guard saw ${seen} of ${raw} proven rows`];
}

const ownerMessages = (rows) => rows.filter((r) => r.owner_phase === '').map((r) => `empty owner_phase: ${r.id}`);

function checkRows(rows, findingsText) {
  if (findingsText === undefined) return ownerMessages(rows);
  const committed = parseFindings(findingsText);
  if (!committed.ok) return [`findings: ${committed.error}`];
  const ids = committed.value.map((r) => r.id);
  const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  return [
    ...dups.map((id) => `duplicate id in findings: ${id}`),
    ...rows.filter((r) => !ids.includes(r.id)).map((r) => `unseeded source row: ${r.id}`),
    ...ownerMessages(committed.value),
    ...evidenceMessages(committed.value),
    ...countMessages(findingsText, committed.value),
  ];
}

export function checkRegister(inputs) {
  const sources = listSourceIds(inputs.units);
  const resolved = new Set([...idsOf(parseRawRegister(inputs.raw)), ...idsOf(parseExtras(inputs.extras))]);
  const telemetry = buildTelemetry(sources, resolved);
  const unresolvedMsgs = sources.filter((s) => !resolved.has(s.id)).map((s) => `unresolved: ${s.id} (${s.file}:${s.line}) has no register row`);
  const built = buildRegister(inputs);
  const messages = [...unresolvedMsgs, ...(built.ok ? checkRows(built.value, inputs.findings) : [built.error])];
  return { ok: messages.length === 0, messages, telemetry };
}

export const exitCodeFor = (result) => (result.ok ? 0 : 1);

// Create-only: a seed never overwrites an existing register (its status and disposition cells would revert).
export function writeSeed(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { flag: 'wx' });
    return ok(text.split('\n').filter((l) => l !== '').length - 1);
  } catch (e) {
    return e.code === 'EEXIST' ? err('FINDINGS.tsv exists; seed is first-run only') : err(`cannot write ${file}: ${e.message}`);
  }
}

const readText = (file) => {
  try { return ok(fs.readFileSync(file, 'utf8')); } catch (e) { return err(`cannot read ${file}: ${e.code ?? e.message}`); }
};

function readUnits(dir) {
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
    return ok(names.map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') })));
  } catch (e) {
    return err(`cannot read units ${dir}: ${e.code ?? e.message}`);
  }
}

function readOwnerMap(file) {
  if (file === undefined) return ok(undefined);
  const text = readText(file);
  if (!text.ok) return text;
  try { return validateOwnerMap(JSON.parse(text.value)); } catch (e) { return err(`owner map ${file} is not valid JSON: ${e.message}`); }
}

export function parseArgs(argv) {
  const opts = { dir: '.planning/phases/findings' };
  const flags = ['--dir', '--raw', '--units', '--triage', '--extras', '--findings', '--owner-map'];
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (flags.includes(argv[i])) {
      if (argv[i + 1] === undefined) return { error: `${argv[i]} needs a value` };
      opts[argv[i].slice(2).replace('-', '_')] = argv[i + 1];
      i += 1;
    } else positional.push(argv[i]);
  }
  const at = (k, name) => opts[k] ?? path.join(opts.dir, name);
  return {
    mode: positional[0],
    extra: positional.slice(1),
    paths: { raw: at('raw', 'raw-register.tsv'), units: at('units', 'units'), triage: at('triage', 'TRIAGE.md'), extras: at('extras', 'extras.tsv'), findings: at('findings', 'FINDINGS.tsv'), ownerMap: opts.owner_map },
  };
}

function loadInputs(p) {
  const [raw, extras, triage, units, ownerMap] = [readText(p.raw), readText(p.extras), readText(p.triage), readUnits(p.units), readOwnerMap(p.ownerMap)];
  const bad = [raw, extras, triage, units, ownerMap].find((r) => !r.ok);
  return bad ? err(bad.error) : ok({ raw: raw.value, extras: extras.value, triage: triage.value, units: units.value, ownerMap: ownerMap.value });
}

function run(argv) {
  const args = parseArgs(argv);
  const usage = { code: 2, out: [], errs: ['usage: findings-register.mjs seed | --check [--dir <dir>] [--raw <f>] [--units <d>] [--triage <f>] [--extras <f>] [--findings <f>] [--owner-map <f>]'] };
  if (args.error) return { code: 2, out: [], errs: [args.error] };
  if (args.extra.length > 0) return usage;
  const inputs = args.mode === 'seed' || args.mode === '--check' ? loadInputs(args.paths) : null;
  if (inputs === null) return usage;
  if (!inputs.ok) return { code: 1, out: [], errs: [inputs.error] };
  if (args.mode === 'seed') {
    const built = buildRegister(inputs.value);
    if (!built.ok) return { code: 1, out: [], errs: [built.error] };
    const written = writeSeed(args.paths.findings, serialiseRegister(built.value));
    return written.ok ? { code: 0, out: [`seeded ${written.value} rows into ${args.paths.findings}`], errs: [] } : { code: 1, out: [], errs: [written.error] };
  }
  const findings = readText(args.paths.findings);
  if (!findings.ok) return { code: 1, out: [], errs: [findings.error] };
  const result = checkRegister({ ...inputs.value, findings: findings.value });
  return { code: exitCodeFor(result), out: [`findings-register: resolved ${result.telemetry.resolvedCount} of ${result.telemetry.totalCount}`], errs: result.messages };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const outcome = run(process.argv.slice(2));
  outcome.out.forEach((l) => console.log(l));
  outcome.errs.forEach((l) => console.error(l));
  process.exitCode = outcome.code;
}
