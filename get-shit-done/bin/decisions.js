#!/usr/bin/env node
'use strict';
// Decision ledger + non-blocking owner question queue. Contract: references/decisions-protocol.md.
// Append-only JSONL (.planning/DECISIONS.jsonl); the last line per id wins. No LLM, no deps.

const fs = require('fs');
const path = require('path');
const { loadProfile, getProfileValue } = require('./project-profile.js');

const PREFIX = { decision: 'D', assumption: 'A', rework: 'R' };
const REVERSIBILITY = ['cheap', 'costly', 'irreversible'];
const STATUS = {
  decision: ['active', 'superseded'],
  assumption: ['open', 'confirmed', 'overridden'],
  rework: ['open', 'accepted', 'done'],
};
const PHASE_RE = /^\d+(\.\d+)?$/;
const EXIT_CORRUPT = 3;
const MUTATING = new Set(['add', 'map', 'answer', 'close', 'repair', 'amend', 'supersede']);
const UNSCOPED_SHOWN = 5;
const FLAGS = {
  validate: ['file', 'mapped', 'milestone'],
  repair: ['file'],
  add: ['file', 'kind', 'source', 'prd', 'question', 'phases', 'global', 'milestone', 'answer', 'default', 'options', 'reversibility', 'ts'],
  map: ['file', 'phases', 'global', 'milestone', 'validates'],
  answer: ['file', 'value', 'confirm', 'accept-as-built', 'completed', 'in-progress', 'phases-dir', 'ts'],
  list: ['file', 'phase', 'open', 'json'],
  gate: ['file', 'phase'],
  'check-plan': ['file', 'phase', 'all-unscoped'],
  reworks: ['file'],
  close: ['file', 'status'],
  digest: ['file', 'mark', 'mark-only'],
  render: ['file', 'out'],
  amend: ['file', 'question', 'answer', 'phases', 'global', 'milestone', 'source'],
  supersede: ['file', 'answer', 'question', 'source', 'phases', 'global'],
};
const USAGE = 'usage: decisions.js <command> [flags]\n'
  + Object.entries(FLAGS).map(([c, f]) => `  ${c} ${f.map((x) => `[--${x}]`).join(' ')}`).join('\n')
  + '\n  amend D-NN: rewrite fields of a decision in place; supersede D-NN --answer A --source S: new D- row replaces it'
  + '\n  exit 2 = gate parks the phase, 3 = ledger corrupt (treat as block; ' + 'REPAIR_HINT_PLACEHOLDER' + '), 64 = usage, 1 = error or unknown flag\n';
const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 10000;
const REPAIR_HINT = 'run: node decisions.js repair [--file F] (renumbers colliding ids, drops conflict markers, keeps every row)';
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
    if (r.validates !== undefined
      && (!Array.isArray(r.validates) || r.validates.some((p) => !Array.isArray(r.phases) || !r.phases.includes(p)))) {
      e('validates must be a subset of phases');
    }
    if (r.kind !== 'rework') {
      if (!str(r.question)) e('question is empty');
      if (!str(r.source)) e('source is empty');
      if (opts.mapped && (opts.milestone === undefined || r.milestone === opts.milestone)
        && Array.isArray(r.phases) && r.phases.length === 0 && r.global !== true
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
// A lock older than LOCK_STALE_MS (< LOCK_WAIT_MS) is a crashed holder: a waiter takes it over by an
// atomic rename, so only one waiter wins the takeover.
function withLock(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          const taken = `${lock}.stale.${process.pid}`;
          fs.renameSync(lock, taken);
          fs.unlinkSync(taken);
          continue;
        }
      } catch (_) { /* raced: another waiter took it over or the holder released */ }
      if (Date.now() > deadline) throw new Error(`ledger lock ${lock} held for over ${LOCK_WAIT_MS / 1000}s`);
      sleepMs(25);
    }
  }
  try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch (_) { /* gone */ } }
}

// Deterministic repair: a row whose id was first used by a different (kind, ts) is renumbered to the
// next free id of its kind; later updates of that same row follow it. Conflict-marker lines are dropped.
function repair(file) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  const removedMarkers = [];
  const rows = [];
  raw.forEach((line, i) => {
    if (line.trim() === '') return;
    if (/^(<{7}|={7}|>{7})/.test(line)) { removedMarkers.push(i + 1); return; }
    let rec;
    try { rec = JSON.parse(line); } catch (e) { throw new Error(`line ${i + 1} is not JSON and not a conflict marker: cannot repair`); }
    if (!rec || typeof rec !== 'object' || !str(rec.id)) throw new Error(`line ${i + 1} has no id: cannot repair`);
    rows.push({ rec, line: i + 1 });
  });
  const used = new Set(rows.map((r) => r.rec.id));
  const owner = new Map();
  const remap = new Map();
  const renumbered = [];
  const out = rows.map(({ rec, line }) => {
    const sig = `${rec.kind}|${rec.ts}`;
    const first = owner.get(rec.id);
    if (first === undefined) { owner.set(rec.id, sig); return rec; }
    if (first === sig) return rec;
    const key = `${rec.id}|${sig}`;
    if (!remap.has(key)) {
      const prefix = PREFIX[rec.kind] || String(rec.id).split('-')[0];
      const max = [...used].filter((id) => id.startsWith(`${prefix}-`))
        .reduce((m, id) => Math.max(m, parseInt(id.slice(prefix.length + 1), 10) || 0), 0);
      const to = `${prefix}-${String(max + 1).padStart(2, '0')}`;
      used.add(to);
      owner.set(to, sig);
      remap.set(key, to);
      renumbered.push({ from: rec.id, to, kind: rec.kind, ts: rec.ts, line });
    }
    return { ...rec, id: remap.get(key) };
  });
  if (renumbered.length === 0 && removedMarkers.length === 0) return { repaired: false, renumbered, removedMarkers };
  fs.copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.repair.${process.pid}`;
  fs.writeFileSync(tmp, out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
  fs.renameSync(tmp, file);
  return { repaired: true, renumbered, removedMarkers, backup: `${file}.bak`,
    note: 'ids referenced inside other rows (supersedes, resolved_by, superseded_by, assumption, decision) are not rewritten: run validate' };
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
    id: nextId(records, 'decision'), kind: 'decision', ts, source: 'owner-answer', prd: a.prd || null,
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
  // Open assumptions with no phase and no global flag never reach forPhase; surface them, informational only.
  const unscopedOpen = records
    .filter((r) => r.kind === 'assumption' && r.status === 'open' && r.global !== true && (!Array.isArray(r.phases) || r.phases.length === 0))
    .map((r) => ({ id: r.id, question: r.question, default: r.default, reversibility: r.reversibility, scope: 'unscoped' }));
  return { pass: missing.length + unknown.length + stale.length === 0, phase: String(phase), missing, unknown, stale, unscoped_open: unscopedOpen };
}

function digest(records) {
  const open = records.filter((r) => r.kind === 'assumption' && r.status === 'open' && !r.notified_ts);
  const lines = open.map((r) => `${r.id} [${r.phases.length ? 'phase ' + r.phases.join(',') : 'milestone'}, ${r.reversibility}] ${r.question}\n  default: ${r.default}${Array.isArray(r.options) && r.options.length ? '\n  options: ' + r.options.join(' / ') : ''}`);
  const head = `GSD: ${open.length} open question(s). Work continues on the defaults. Answer any time: /gsd:decide A-NN <answer> (or "A-NN ok").`;
  return { open, text: open.length ? [head, ...lines].join('\n') : '' };
}

function ownerTitle(cwd) {
  try {
    const title = getProfileValue(loadProfile(cwd), 'project.owner_title');
    return typeof title === 'string' && title.trim() !== '' ? title : 'owner';
  } catch {
    return 'owner';
  }
}

function render(records, title = 'owner') {
  const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const ph = (r) => (r.global ? 'all' : r.phases.join(', '));
  const of = (kind) => records.filter((r) => r.kind === kind);
  return [
    '# Decisions', '', 'Generated by `decisions.js render` from DECISIONS.jsonl. Do not edit.', '',
    '## Binding decisions', '', '| id | phases | question | answer | source | status |', '|---|---|---|---|---|---|',
    ...of('decision').map((r) => `| ${r.id} | ${ph(r)} | ${cell(r.question)} | ${cell(r.answer)} | ${cell(r.source)} | ${r.status} |`), '',
    `## Assumptions (open = question queued for the ${title})`, '', '| id | phases | question | default | reversibility | status | answer |', '|---|---|---|---|---|---|---|',
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
  const known = FLAGS[cmd];
  if (known) {
    const unknown = Object.keys(flags).filter((k) => !known.includes(k));
    if (unknown.length > 0) throw new Error(`unknown flag(s) for ${cmd}: ${unknown.map((k) => `--${k}`).join(', ')} (accepted: ${known.map((k) => `--${k}`).join(' ')})`);
  }
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
    const errors = [...parseErrors, ...validate(records, { mapped: flags.mapped === true, milestone: str(flags.milestone) ? flags.milestone : undefined })];
    out({ pass: errors.length === 0, records: records.length, errors });
    return errors.length === 0 ? 0 : 1;
  }
  if (cmd === 'repair') {
    const res = repair(file);
    const after = load(file);
    const errors = [...after.errors, ...validate(after.records)];
    out({ ...res, pass: errors.length === 0, errors });
    return errors.length === 0 ? 0 : 1;
  }
  if (parseErrors.length) { out({ pass: false, corrupt: true, errors: parseErrors, hint: REPAIR_HINT }); return EXIT_CORRUPT; }

  if (cmd === 'add') {
    const kind = flags.kind;
    if (!PREFIX[kind] || kind === 'rework') throw new Error('--kind decision|assumption');
    const rec = {
      id: nextId(records, kind), kind, ts: flags.ts || new Date().toISOString(), source: flags.source,
      prd: flags.prd || null, question: flags.question, phases: list(flags.phases),
      ...(flags.global === true ? { global: true } : {}),
      ...(str(flags.milestone) ? { milestone: flags.milestone } : {}),
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
    if (str(flags.milestone)) next.milestone = flags.milestone;
    if (str(flags.validates)) next.validates = list(flags.validates); else delete next.validates;
    const errs = validate([next]).filter((m) => m.startsWith(next.id + ': validates'));
    if (errs.length) { out({ pass: false, errors: errs }); return 1; }
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
  if (cmd === 'amend' || cmd === 'supersede') {
    const old = records.find((r) => r.id === pos[0] && r.kind === 'decision');
    if (!old) throw new Error(`${cmd} D-NN: ${pos[0]} is not a decision in ${file}`);
    const ts = new Date().toISOString();
    const edits = {
      ...(str(flags.question) ? { question: flags.question } : {}),
      ...(str(flags.answer) ? { answer: flags.answer } : {}),
      ...(flags.phases !== undefined ? { phases: list(flags.phases) } : {}),
      ...(str(flags.milestone) ? { milestone: flags.milestone } : {}),
      ...(flags.global === true ? { global: true } : {}),
    };
    if (cmd === 'amend') {
      if (Object.keys(edits).length === 0 && !str(flags.source)) throw new Error('amend D-NN needs at least one of --question --answer --phases --global --milestone --source');
      const next = { ...old, ...edits, ...(str(flags.source) ? { source: flags.source } : {}), amended_ts: ts };
      const errs = validate([next]).filter((m) => m.startsWith(next.id + ':'));
      if (errs.length) { out({ pass: false, errors: errs }); return 1; }
      append(file, next);
      out(next);
      return 0;
    }
    if (old.status !== 'active') throw new Error(`${old.id} is already ${old.status}`);
    if (!str(flags.answer) || !str(flags.source)) throw new Error('supersede D-NN --answer A --source S');
    const rec = { ...old, ...edits, id: nextId(records, 'decision'), ts, source: flags.source, status: 'active', supersedes: old.id };
    delete rec.superseded_by; delete rec.amended_ts;
    const errs = validate([...records, rec]).filter((m) => m.startsWith(rec.id + ':'));
    if (errs.length) { out({ pass: false, errors: errs }); return 1; }
    append(file, rec);
    append(file, { ...old, status: 'superseded', superseded_by: rec.id });
    out({ id: rec.id, supersedes: old.id });
    return 0;
  }
  if (cmd === 'gate') {
    if (!str(flags.phase) || !PHASE_RE.test(flags.phase)) throw new Error('gate --phase N (a phase number such as 3 or 3.1)');
    const phase = String(flags.phase);
    const park = forPhase(records, flags.phase)
      .filter((r) => r.kind === 'assumption' && r.status === 'open' && r.reversibility === 'irreversible'
        && !(Array.isArray(r.validates) && r.validates.includes(phase)))
      .map((r) => r.id);
    const ids = new Map(records.map((r) => [r.id, r.question]));
    out({ phase: String(flags.phase), park: park.length > 0, ids: park, questions: park.map((id) => `${id} ${ids.get(id)}`) });
    return park.length > 0 ? 2 : 0;
  }
  if (cmd === 'check-plan') {
    if (!flags.phase || pos.length === 0) throw new Error('check-plan --phase N <PLAN.md>...');
    const res = checkPlan(records, flags.phase, pos.map((p) => fs.readFileSync(p, 'utf8')));
    const { unscoped_open: unscoped, ...head } = res;
    const shown = flags['all-unscoped'] === true ? unscoped : unscoped.slice(0, UNSCOPED_SHOWN);
    out({ ...head, unscoped_open_count: unscoped.length, unscoped_open: shown, ...(shown.length < unscoped.length ? { unscoped_open_note: `first ${shown.length} of ${unscoped.length}; pass --all-unscoped for all` } : {}) });
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
    fs.writeFileSync(target, render(records, ownerTitle(process.cwd())));
    out({ written: target });
    return 0;
  }
  process.stderr.write(USAGE.replace('REPAIR_HINT_PLACEHOLDER', REPAIR_HINT));
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

module.exports = { ownerTitle, EXIT_CORRUPT, LOCK_STALE_MS, LOCK_WAIT_MS, repair, withLock, load, validate, answer, checkPlan, digest, render, forPhase, nextId, detectPhaseState, main };
