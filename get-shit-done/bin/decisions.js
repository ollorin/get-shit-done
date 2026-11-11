#!/usr/bin/env node
'use strict';
// Decision ledger + non-blocking CEO question queue. Contract: references/decisions-protocol.md.
// Append-only JSONL (.planning/DECISIONS.jsonl); the last line per id wins. No LLM, no deps.

const fs = require('fs');
const path = require('path');

const PREFIX = { decision: 'D', assumption: 'A', rework: 'R' };
const REVERSIBILITY = ['cheap', 'costly', 'irreversible'];
const STATUS = {
  decision: ['active', 'superseded'],
  assumption: ['open', 'confirmed', 'overridden'],
  rework: ['open', 'accepted', 'done'],
};
const PHASE_RE = /^\d+(\.\d+)?$/;
const EXIT_CORRUPT = 3;
const MUTATING = new Set(['add', 'map', 'answer', 'close']);
const CITE_RE = /\b[DA]-\d{2,}\b/g;
const DEFAULT_FILE = path.join('.planning', 'DECISIONS.jsonl');

const str = (v) => typeof v === 'string' && v.trim() !== '';

function load(file) {
  const errors = [];
  const byId = new Map();
  if (!fs.existsSync(file)) return { records: [], errors };
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      const rec = JSON.parse(line);
      if (!rec || typeof rec !== 'object' || !str(rec.id)) throw new Error('record has no id');
      const first = byId.get(rec.id);
      if (first && (first.ts !== rec.ts || first.kind !== rec.kind)) {
        throw new Error(`duplicate id ${rec.id}: a different record (ts/kind differ from the first line)`);
      }
      byId.delete(rec.id);
      byId.set(rec.id, rec);
    } catch (e) {
      errors.push(`line ${i + 1}: ${e.message}`);
    }
  });
  return { records: [...byId.values()], errors };
}

function validate(records, opts = {}) {
  const errors = [];
  const ids = new Map(records.map((r) => [r.id, r]));
  for (const r of records) {
    const e = (m) => errors.push(`${r.id}: ${m}`);
    const prefix = PREFIX[r.kind];
    if (!prefix) { e(`unknown kind "${r.kind}"`); continue; }
    if (!new RegExp(`^${prefix}-\\d{2,}$`).test(r.id)) e(`id does not match ${prefix}-NN for kind ${r.kind}`);
    if (!str(r.ts) || Number.isNaN(Date.parse(r.ts))) e('ts is not an ISO timestamp');
    if (!STATUS[r.kind].includes(r.status)) e(`status "${r.status}" not in ${STATUS[r.kind].join('|')}`);
    if (!Array.isArray(r.phases) || r.phases.some((p) => typeof p !== 'string' || !PHASE_RE.test(p))) {
      e('phases must be an array of phase-number strings');
    }
    if (r.kind !== 'rework') {
      if (!str(r.question)) e('question is empty');
      if (!str(r.source)) e('source is empty');
      if (opts.mapped && Array.isArray(r.phases) && r.phases.length === 0 && r.global !== true
        && r.status !== 'superseded' && r.status !== 'overridden') {
        e('no consuming phase: set phases or global:true (decisions.js map)');
      }
    }
    if (r.kind === 'decision') {
      if (!str(r.answer)) e('answer is empty');
      if (r.status === 'superseded' && !(ids.get(r.superseded_by) || {}).kind) e('superseded without a valid superseded_by');
    }
    if (r.kind === 'assumption') {
      if (!str(r.default)) e('default is empty: an assumption must record the default chosen');
      if (!REVERSIBILITY.includes(r.reversibility)) e(`reversibility not in ${REVERSIBILITY.join('|')}`);
      if (r.status !== 'open' && !str(r.answer)) e(`status ${r.status} without an answer`);
      if (r.status === 'overridden' && (ids.get(r.resolved_by) || {}).kind !== 'decision') {
        e('overridden without resolved_by pointing at a decision');
      }
    }
    if (r.kind === 'rework') {
      if ((ids.get(r.assumption) || {}).kind !== 'assumption') e('assumption id does not exist');
      if ((ids.get(r.decision) || {}).kind !== 'decision') e('decision id does not exist');
      if (!Array.isArray(r.phases) || r.phases.length === 0) e('rework names no phase');
    }
  }
  return errors;
}

function nextId(records, kind) {
  const prefix = PREFIX[kind];
  const max = records.filter((r) => r.kind === kind)
    .reduce((m, r) => Math.max(m, parseInt(r.id.slice(prefix.length + 1), 10) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// O_EXCL lock file: serialises read+append across processes sharing one ledger file.
function withLock(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 10000;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock); } catch (_) { /* raced */ }
      if (Date.now() > deadline) throw new Error(`ledger lock ${lock} held for over 10s`);
      sleepMs(25);
    }
  }
  try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch (_) { /* gone */ } }
}

function append(file, rec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + '\n');
}

const binding = (r) => (r.kind === 'decision' && r.status === 'active')
  || (r.kind === 'assumption' && (r.status === 'open' || r.status === 'confirmed'));

function forPhase(records, phase) {
  return records.filter((r) => binding(r) && (r.phases.includes(String(phase)) || r.global === true));
}

function detectPhaseState(phasesDir) {
  const completed = [];
  const inProgress = [];
  if (!fs.existsSync(phasesDir)) return { completed, inProgress };
  for (const d of fs.readdirSync(phasesDir)) {
    const m = /^(\d+(?:\.\d+)?)-/.exec(d);
    if (!m) continue;
    const files = fs.readdirSync(path.join(phasesDir, d));
    if (files.some((f) => f.endsWith('-VERIFICATION.md'))) completed.push(m[1]);
    else if (files.some((f) => f.endsWith('-PLAN.md'))) inProgress.push(m[1]);
  }
  return { completed, inProgress };
}

// Late-answer rule (decisions-protocol.md "Answers"): the outcome is computed, never judged.
function answer(file, id, value, opts = {}) {
  const { records } = load(file);
  const a = records.find((r) => r.id === id);
  if (opts.confirm !== true && String(value).trim() === '') throw new Error('empty answer: pass a value or --confirm');
  if (!a || a.kind !== 'assumption') throw new Error(`${id} is not an assumption in ${file}`);
  if (a.status !== 'open') throw new Error(`${id} is already ${a.status}`);
  const ts = opts.ts || new Date().toISOString();
  const same = opts.confirm === true || value.trim().toLowerCase() === a.default.trim().toLowerCase();
  if (same) {
    append(file, { ...a, status: 'confirmed', answer: a.default, answered_ts: ts });
    return { outcome: 'confirmed', id };
  }
  const d = {
    id: nextId(records, 'decision'), kind: 'decision', ts, source: 'ceo-answer', prd: a.prd || null,
    question: a.question, answer: value.trim(), phases: a.phases, status: 'active', supersedes: id,
    ...(a.global === true ? { global: true } : {}),
  };
  append(file, d);
  append(file, { ...a, status: 'overridden', answer: value.trim(), answered_ts: ts, resolved_by: d.id });
  const state = opts.state || { completed: [], inProgress: [] };
  const built = a.phases.filter((p) => state.completed.includes(p));
  const planning = a.phases.filter((p) => state.inProgress.includes(p));
  if (built.length > 0) {
    const accept = opts.acceptAsBuilt === true;
    const r = {
      id: nextId(records, 'rework'), kind: 'rework', ts, assumption: id, decision: d.id, phases: built,
      reversibility: a.reversibility, status: accept ? 'accepted' : 'open',
    };
    append(file, r);
    return { outcome: accept ? 'accepted-as-built' : 'rework', id, decision: d.id, rework: r.id, phases: built, replan: planning };
  }
  if (planning.length > 0) return { outcome: 'replan', id, decision: d.id, phases: planning };
  return { outcome: 'applied', id, decision: d.id };
}

function checkPlan(records, phase, planTexts) {
  const ids = new Map(records.map((r) => [r.id, r]));
  const cited = new Set(planTexts.flatMap((t) => t.match(CITE_RE) || []));
  const required = forPhase(records, phase).filter((r) => r.phases.includes(String(phase)));
  const missing = required.filter((r) => !cited.has(r.id)).map((r) => r.id);
  const unknown = [...cited].filter((id) => !ids.has(id));
  const stale = [...cited].filter((id) => ids.has(id) && !binding(ids.get(id)))
    .map((id) => ({ id, use: ids.get(id).superseded_by || ids.get(id).resolved_by || null }));
  return { pass: missing.length + unknown.length + stale.length === 0, phase: String(phase), missing, unknown, stale };
}

function digest(records) {
  const open = records.filter((r) => r.kind === 'assumption' && r.status === 'open' && !r.notified_ts);
  const lines = open.map((r) => `${r.id} [${r.phases.length ? 'phase ' + r.phases.join(',') : 'milestone'}, ${r.reversibility}] ${r.question}\n  default: ${r.default}${Array.isArray(r.options) && r.options.length ? '\n  options: ' + r.options.join(' / ') : ''}`);
  const head = `GSD: ${open.length} open question(s). Work continues on the defaults. Answer any time: /gsd:decide A-NN <answer> (or "A-NN ok").`;
  return { open, text: open.length ? [head, ...lines].join('\n') : '' };
}

function render(records) {
  const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const ph = (r) => (r.global ? 'all' : r.phases.join(', '));
  const of = (kind) => records.filter((r) => r.kind === kind);
  return [
    '# Decisions', '', 'Generated by `decisions.js render` from DECISIONS.jsonl. Do not edit.', '',
    '## Binding decisions', '', '| id | phases | question | answer | source | status |', '|---|---|---|---|---|---|',
    ...of('decision').map((r) => `| ${r.id} | ${ph(r)} | ${cell(r.question)} | ${cell(r.answer)} | ${cell(r.source)} | ${r.status} |`), '',
    '## Assumptions (open = question queued for the CEO)', '', '| id | phases | question | default | reversibility | status | answer |', '|---|---|---|---|---|---|---|',
    ...of('assumption').map((r) => `| ${r.id} | ${ph(r)} | ${cell(r.question)} | ${cell(r.default)} | ${r.reversibility} | ${r.status} | ${cell(r.answer)} |`), '',
    '## Rework tickets', '', '| id | assumption | decision | phases | status |', '|---|---|---|---|---|',
    ...of('rework').map((r) => `| ${r.id} | ${r.assumption} | ${r.decision} | ${r.phases.join(', ')} | ${r.status} |`), '',
  ].join('\n');
}

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(argv[i]);
  }
  return { flags, pos };
}

const list = (v) => (typeof v === 'string' && v !== '' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, pos } = parseArgs(rest);
  const file = flags.file || DEFAULT_FILE;
  if (MUTATING.has(cmd) || (cmd === 'digest' && (flags.mark === true || flags['mark-only'] === true))) {
    return withLock(file, () => run(cmd, flags, pos, file));
  }
  return run(cmd, flags, pos, file);
}

function run(cmd, flags, pos, file) {
  const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\n');
  const { records, errors: parseErrors } = load(file);

  if (cmd === 'validate') {
    const errors = [...parseErrors, ...validate(records, { mapped: flags.mapped === true })];
    out({ pass: errors.length === 0, records: records.length, errors });
    return errors.length === 0 ? 0 : 1;
  }
  if (parseErrors.length) { out({ pass: false, corrupt: true, errors: parseErrors }); return EXIT_CORRUPT; }

  if (cmd === 'add') {
    const kind = flags.kind;
    if (!PREFIX[kind] || kind === 'rework') throw new Error('--kind decision|assumption');
    const rec = {
      id: nextId(records, kind), kind, ts: flags.ts || new Date().toISOString(), source: flags.source,
      prd: flags.prd || null, question: flags.question, phases: list(flags.phases),
      ...(flags.global === true ? { global: true } : {}),
      ...(kind === 'decision' ? { answer: flags.answer, status: 'active' }
        : { default: flags.default, options: list(flags.options), reversibility: flags.reversibility, status: 'open' }),
    };
    const errs = validate([...records, rec]).filter((m) => m.startsWith(rec.id + ':'));
    if (errs.length) { out({ pass: false, errors: errs }); return 1; }
    append(file, rec);
    out(rec);
    return 0;
  }
  if (cmd === 'map') {
    const rec = records.find((r) => r.id === pos[0]);
    if (!rec) throw new Error(`unknown id ${pos[0]}`);
    const next = { ...rec, phases: list(flags.phases) };
    if (flags.global === true) next.global = true; else delete next.global;
    append(file, next);
    out(next);
    return 0;
  }
  if (cmd === 'answer') {
    const explicit = flags.completed !== undefined || flags['in-progress'] !== undefined;
    const state = explicit
      ? { completed: list(flags.completed), inProgress: list(flags['in-progress']) }
      : detectPhaseState(flags['phases-dir'] || path.join(path.dirname(file), 'phases'));
    out(answer(file, pos[0], String(flags.value === undefined ? '' : flags.value), {
      confirm: flags.confirm === true, acceptAsBuilt: flags['accept-as-built'] === true, state, ts: flags.ts,
    }));
    return 0;
  }
  if (cmd === 'list') {
    let rows = flags.phase ? forPhase(records, flags.phase) : records.filter(binding);
    if (flags.open === true) rows = rows.filter((r) => r.kind === 'assumption' && r.status === 'open');
    if (flags.json === true) { out(rows); return 0; }
    rows.forEach((r) => out(`${r.id} [${r.global ? 'all' : r.phases.join(',')}] ${r.question} => ${r.kind === 'decision' ? r.answer : `${r.default} (assumed, ${r.reversibility}${r.status === 'confirmed' ? ', confirmed' : ''})`}`));
    return 0;
  }
  if (cmd === 'gate') {
    const park = forPhase(records, flags.phase).filter((r) => r.kind === 'assumption' && r.status === 'open' && r.reversibility === 'irreversible').map((r) => r.id);
    out({ phase: String(flags.phase), park: park.length > 0, ids: park });
    return park.length > 0 ? 2 : 0;
  }
  if (cmd === 'check-plan') {
    if (!flags.phase || pos.length === 0) throw new Error('check-plan --phase N <PLAN.md>...');
    const res = checkPlan(records, flags.phase, pos.map((p) => fs.readFileSync(p, 'utf8')));
    out(res);
    return res.pass ? 0 : 1;
  }
  if (cmd === 'reworks') {
    out(records.filter((r) => r.kind === 'rework' && r.status === 'open'));
    return 0;
  }
  if (cmd === 'close') {
    const r = records.find((x) => x.id === pos[0] && x.kind === 'rework');
    if (!r || !['done', 'accepted'].includes(flags.status)) throw new Error('close R-NN --status done|accepted');
    append(file, { ...r, status: flags.status, closed_ts: new Date().toISOString() });
    out({ id: r.id, status: flags.status });
    return 0;
  }
  if (cmd === 'digest') {
    const d = digest(records);
    if (flags.mark === true || flags['mark-only'] === true) {
      const ts = new Date().toISOString();
      d.open.forEach((r) => append(file, { ...r, notified_ts: ts }));
    }
    if (flags['mark-only'] !== true) out(d.text);
    return 0;
  }
  if (cmd === 'render') {
    const target = flags.out || path.join(path.dirname(file), 'DECISIONS.md');
    fs.writeFileSync(target, render(records));
    out({ written: target });
    return 0;
  }
  process.stderr.write('usage: decisions.js validate|add|map|answer|list|gate|check-plan|digest|reworks|close|render [--file F]\n  exit 2 = gate parks the phase, 3 = ledger corrupt (treat as block)\n');
  return 64;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`decisions: ${e.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { EXIT_CORRUPT, withLock, load, validate, answer, checkPlan, digest, render, forPhase, nextId, detectPhaseState, main };
