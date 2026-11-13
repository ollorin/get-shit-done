'use strict';
// Owner gates: the stops an unattended run never answers itself. State lives in
// .planning/OWNER-GATES.json so a later resume reads it; nothing here prompts or waits.
const fs = require('fs');
const path = require('path');

const KINDS = ['composition', 'roadmap', 'pr'];
const FILE = 'OWNER-GATES.json';
const STATUS_WAITING = 'waiting_owner_approval';

const filePath = (cwd) => path.join(cwd, '.planning', FILE);
const normMilestone = (m) => (m == null || m === '' ? null : String(m).trim().replace(/^v/i, ''));

function readAll(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(cwd), 'utf-8'));
    return Array.isArray(parsed && parsed.gates) ? parsed.gates : [];
  } catch {
    return [];
  }
}

function writeAll(cwd, gates) {
  fs.mkdirSync(path.join(cwd, '.planning'), { recursive: true });
  const tmp = `${filePath(cwd)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, gates }, null, 2) + '\n');
  fs.renameSync(tmp, filePath(cwd));
}

const gateId = (kind, milestone) => `${kind}@${normMilestone(milestone) || 'current'}`;

// A gate recorded without a milestone matches any milestone and the reverse.
function find(gates, kind, milestone) {
  const m = normMilestone(milestone);
  const hits = gates.filter((g) => g.kind === kind && (m === null || g.milestone === null || g.milestone === m));
  return hits.length ? hits[hits.length - 1] : null;
}

function request(cwd, { kind, milestone, summary, now, spikePhases, spikeRoots, revise }) {
  if (!KINDS.includes(kind)) return { ok: false, error: `unknown gate kind: ${kind} (use ${KINDS.join('|')})` };
  const gates = readAll(cwd);
  const m = normMilestone(milestone);
  const list = (v) => (v == null ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean));
  const phases = list(spikePhases).map((x) => x.replace(/^0+(?=\d)/, ''));
  const roots = list(spikeRoots);
  if (phases.length > 0 && roots.length === 0) return { ok: false, error: 'spike phases need --spike-roots' };
  const rigour = phases.length > 0 ? { spike_phases: phases, spike_roots: roots } : null;
  const existing = gates.find((g) => g.id === gateId(kind, m));
  if (existing && existing.status === 'pending' && rigour && JSON.stringify(existing.rigour || null) !== JSON.stringify(rigour)) {
    const next = { ...existing, rigour };
    writeAll(cwd, gates.map((g) => (g.id === next.id ? next : g)));
    return { ok: true, gate: next, created: false };
  }
  // An approved gate is a decision: changing what it authorises needs a new approval.
  const changesApproved = existing && existing.status === 'approved' && rigour
    && JSON.stringify(existing.rigour || null) !== JSON.stringify(rigour);
  if (changesApproved && !revise) return { ok: false, error: `${existing.id} is approved; changing its spike phases needs a new owner approval: repeat the request with --revise` };
  if (existing && existing.status !== 'rejected' && !changesApproved) return { ok: true, gate: existing, created: false };
  const gate = {
    id: gateId(kind, m),
    kind,
    milestone: m,
    requested_at: now || new Date().toISOString(),
    summary: summary || '',
    status: 'pending',
    approved_by: null,
    approved_at: null,
    note: null,
    ...(rigour ? { rigour } : {}),
  };
  writeAll(cwd, [...gates.filter((g) => g.id !== gate.id), gate]);
  return { ok: true, gate, created: true };
}

function decide(cwd, { kind, milestone, status, by, note, via, now }) {
  const gates = readAll(cwd);
  const gate = find(gates, kind, milestone);
  if (!gate) return { ok: false, error: `no ${kind} gate requested` };
  if (gate.status !== 'pending') {
    if (gate.status === status) return { ok: true, gate, changed: false };
    return { ok: false, error: `${gate.id} is already ${gate.status}` };
  }
  const next = { ...gate, status, approved_by: by || 'owner', approved_at: now || new Date().toISOString(), note: note || null, via };
  writeAll(cwd, gates.map((g) => (g.id === gate.id ? next : g)));
  return { ok: true, gate: next, changed: true };
}

// Which required gate stops execute-roadmap from starting a phase. Auto mode requires a
// recorded, approved composition and roadmap gate; an interactive run is stopped only by a
// gate someone actually requested and the owner has not approved.
function startBlock(cwd, { autoMode, milestone }) {
  const gates = readAll(cwd);
  for (const kind of ['composition', 'roadmap']) {
    const g = find(gates, kind, milestone);
    if (g && g.status === 'approved') continue;
    if (!g && !autoMode) continue;
    return { kind, status: g ? g.status : 'not_requested', gate: g };
  }
  return null;
}

function summarise(cwd, { autoMode, milestone }) {
  const gates = readAll(cwd);
  const statusOf = (kind) => { const g = find(gates, kind, milestone); return g ? g.status : null; };
  const block = startBlock(cwd, { autoMode, milestone });
  const pending = gates.filter((g) => g.status === 'pending' && (normMilestone(milestone) === null || g.milestone === null || g.milestone === normMilestone(milestone)));
  return {
    composition: statusOf('composition'),
    roadmap: statusOf('roadmap'),
    pr: statusOf('pr'),
    blocked_by_owner_gate: block ? block.kind : null,
    pending: pending.map((g) => ({ id: g.id, kind: g.kind, requested_at: g.requested_at, summary: g.summary })),
  };
}

module.exports = { KINDS, FILE, STATUS_WAITING, readAll, request, decide, find, startBlock, summarise, normMilestone };
