'use strict';
// Rigour level of a phase: standard (default) | spike. Contract: references/rigour.md.
// The level is one ROADMAP.md line per phase; absent means standard. Fails closed: an unauthorised spike is standard.

const fs = require('fs');
const path = require('path');
const { loadProfile, getProfileValue } = require('./project-profile.js');

const ownerGates = require('./owner-gates.js');

const LEVELS = ['standard', 'spike'];
const LEDGER_REL = path.join('.planning', 'DECISIONS.jsonl');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

function phaseSection(cwd, phase) {
  const number = String(phase).match(/^\d+(?:\.\d+)?/)?.[0];
  const content = read(path.join(cwd, '.planning', 'ROADMAP.md'));
  if (!number || !content) return null;
  const escaped = number.replace(/^0+(?=\d)/, '').replace(/\./g, '\\.');
  const header = content.match(new RegExp(`###\\s*Phase\\s+0*${escaped}:[^\\n]*`, 'i'));
  if (!header) return null;
  const rest = content.slice(header.index);
  const next = rest.slice(header[0].length).match(/\n###\s+Phase\s+\d/i);
  return next ? rest.slice(0, header[0].length + next.index) : rest;
}

const normRoot = (p) => String(p).trim().replace(/^\.\//, '').replace(/\/+$/, '');
const inside = (child, root) => root === '' || root === '.' || child === root || child.startsWith(`${root}/`);
const overlaps = (a, b) => inside(a, b) || inside(b, a);

function productionPaths(cwd) {
  let profile;
  try { profile = loadProfile(cwd); } catch { return []; }
  const flat = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : []);
  return [...flat(getProfileValue(profile, 'stack.style.roots')), ...flat(getProfileValue(profile, 'stack.paths'))]
    .filter((p) => typeof p === 'string' && p.trim() !== '').map(normRoot);
}

function authorising(cwd, id, phase) {
  const text = read(path.join(cwd, LEDGER_REL));
  if (text === null) return false;
  const last = new Map();
  for (const line of text.split('\n')) {
    try { const r = JSON.parse(line); if (r && r.id) last.set(r.id, r); } catch { /* unparseable rows authorise nothing */ }
  }
  const r = last.get(id);
  return !!r && r.kind === 'decision' && r.status === 'active' && /^D-\d{2,}$/.test(id)
    && (r.source === 'owner-answer' || r.source === 'opus-ruling' || r.source === 'top-ruling')
    && Array.isArray(r.phases) && r.phases.includes(String(phase).replace(/^0+(?=\d)/, ''));
}

// OG2: the newest roadmap gate of the milestone, approved, lists the phase as a spike.
function gateAuthorises(cwd, phase, milestone) {
  const g = ownerGates.find(ownerGates.readAll(cwd), 'roadmap', milestone);
  const n = String(phase).replace(/^0+(?=\d)/, '');
  if (!g) return { ok: false, reason: `no roadmap gate requested, so OG2 does not authorise a spike for phase ${phase}` };
  const listed = Array.isArray(g.rigour && g.rigour.spike_phases) && g.rigour.spike_phases.map(String).includes(n);
  if (g.status === 'approved' && listed) return { ok: true };
  return { ok: false, reason: `roadmap gate ${g.id} does not authorise a spike for phase ${phase} (status ${g.status}${listed ? '' : ', phase not listed'})` };
}

const standard = (source, reason) => ({
  rigour: 'standard', rigour_source: source, rigour_decision: null, spike_roots: [], rigour_rejected_reason: reason || null,
});

function resolveRigour(cwd, rawPhase, milestone) {
  const phase = String(rawPhase).match(/^\d+(?:\.\d+)?/)?.[0] ?? String(rawPhase);
  const section = phaseSection(cwd, phase);
  const line = section && section.match(/\*\*Rigour:?\*\*:?[ \t]*([^\n]+)/i);
  if (!line) return standard('default');
  const [, level, decision] = line[1].trim().toLowerCase().match(/^(\S+?)(?:\s*\(\s*([^)]*?)\s*\))?$/) || [];
  if (level === 'standard') return standard('roadmap');
  if (level === 'high') return standard('rejected', 'rigour "high" is retired: the phase runs as standard; risk-domain depth comes from the **Risk domains** line and high_risk plans');
  if (level !== 'spike') return standard('rejected', `unknown rigour "${line[1].trim()}"`);
  const id = (decision || '').toUpperCase();
  const rootsLine = section.match(/\*\*Spike roots:?\*\*:?[ \t]*([^\n]+)/i);
  const roots = rootsLine ? rootsLine[1].split(',').map(normRoot).filter(Boolean) : [];
  const reject = (reason) => ({ ...standard('rejected', reason), rigour_decision: id || null });
  if (!id) return reject('spike needs a decision id');
  if (roots.length === 0) return reject('spike needs at least one spike root');
  if (id === 'OG2') {
    const gate = gateAuthorises(cwd, phase, milestone);
    if (!gate.ok) return reject(gate.reason);
  } else if (!authorising(cwd, id, phase)) return reject(`${id} is not an active D- decision (owner answer or opus ruling) naming phase ${phase}`);
  const clash = roots.flatMap((r) => productionPaths(cwd).filter((p) => overlaps(r, p)).map((p) => `${r} overlaps ${p}`));
  if (clash.length > 0) return reject(`spike root overlaps a production path: ${clash.join('; ')}`);
  return { rigour: 'spike', rigour_source: 'roadmap', rigour_decision: id, spike_roots: roots, rigour_rejected_reason: null };
}

// Plan files outside the spike roots and .planning/ (guard G2).
function rigourViolations(roots, files) {
  const allowed = [...roots, '.planning'];
  return (Array.isArray(files) ? files : []).filter((f) => typeof f === 'string' && !allowed.some((r) => inside(normRoot(f), r)));
}

// phase_req_ids: the ROADMAP "Requirements" line of the phase, as an id list.
function phaseReqIds(cwd, phase) {
  const section = phaseSection(cwd, phase);
  const m = section && section.match(/\*\*Requirements:?\*\*:?[ \t]*([^\n]+)/i);
  if (!m || /^(none|nothing|tbd)\b/i.test(m[1].trim())) return [];
  return m[1].split(/[,\s\[\]]+/).map((s) => s.replace(/[`*]/g, '').trim()).filter((s) => /^[A-Za-z][\w]*-\d+$/.test(s));
}

// phase_risk_domains: the ROADMAP "Risk domains" line of the phase (none or absent = []). Names outside the
// known set are kept and listed in `unknown` (never a failure).
function phaseRiskDomains(cwd, phase, known) {
  const section = phaseSection(cwd, phase);
  const m = section && section.match(/\*\*Risk domains:?\*\*:?[ \t]*([^\n]+)/i);
  const names = !m || /^(none|nothing|n\/a)\b/i.test(m[1].trim().replace(/[`*]/g, ''))
    ? [] : m[1].split(',').map((x) => x.replace(/[`*]/g, '').trim().toLowerCase()).filter(Boolean);
  const set = new Set((Array.isArray(known) ? known : []).map((x) => String(x).toLowerCase()));
  return { domains: names, unknown: names.filter((n) => !set.has(n)) };
}

module.exports = { LEVELS, phaseSection, resolveRigour, rigourViolations, phaseReqIds, phaseRiskDomains };
