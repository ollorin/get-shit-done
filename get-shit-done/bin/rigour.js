'use strict';
// Rigour level of a phase: standard (default) | spike. Contract: references/rigour.md.
// Spike authority is the approved roadmap owner gate only. Fails closed: an unauthorised spike is standard.

const fs = require('fs');
const path = require('path');
const { loadProfile, getProfileValue } = require('./project-profile.js');

const ownerGates = require('./owner-gates.js');

const LEVELS = ['standard', 'spike'];
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

const phaseKey = (p) => String(p).replace(/^0+(?=\d)/, '');

// The single source of truth for spike phases and roots: the newest roadmap owner gate of the milestone, approved.
function approvedSpikeGate(cwd, milestone) {
  const g = ownerGates.find(ownerGates.readAll(cwd), 'roadmap', milestone);
  return { gate: g, ok: !!g && g.status === 'approved' };
}

const standard = (source, reason) => ({
  rigour: 'standard', rigour_source: source, spike_roots: [], rigour_rejected_reason: reason || null, rigour_notice: null,
});

const clashes = (roots, cwd) => roots.flatMap((r) => productionPaths(cwd).filter((p) => overlaps(r, p)).map((p) => `${r} overlaps ${p}`));

// A phase is spike only when the approved gate lists it; the ROADMAP Rigour / Spike roots lines are informational
// (a mismatch is a notice, never authority).
function resolveRigour(cwd, rawPhase, milestone) {
  const phase = String(rawPhase).match(/^\d+(?:\.\d+)?/)?.[0] ?? String(rawPhase);
  const section = phaseSection(cwd, phase);
  const line = section && section.match(/\*\*Rigour:?\*\*:?[ \t]*([^\n]+)/i);
  const claimed = line ? (line[1].trim().toLowerCase().match(/^(\S+)/) || [])[1] : null;
  const { gate, ok } = approvedSpikeGate(cwd, milestone);
  const listed = !!gate && Array.isArray(gate.rigour && gate.rigour.spike_phases) && gate.rigour.spike_phases.map(String).includes(phaseKey(phase));
  if (listed && ok) {
    const roots = (gate.rigour.spike_roots || []).map(normRoot).filter(Boolean);
    const clash = clashes(roots, cwd);
    if (roots.length === 0) return standard('rejected', 'spike needs at least one spike root');
    if (clash.length > 0) return standard('rejected', `spike root overlaps a production path: ${clash.join('; ')}`);
    const rm = section.match(/\*\*Spike roots:?\*\*:?[ \t]*([^\n]+)/i);
    const rmRoots = rm ? rm[1].split(',').map(normRoot).filter(Boolean) : [];
    const notes = [];
    if (claimed !== 'spike') notes.push(`ROADMAP says rigour ${claimed || 'standard (no line)'}; the approved gate ${gate.id} lists phase ${phase} as spike`);
    if (rmRoots.length > 0 && [...rmRoots].sort().join() !== [...roots].sort().join()) notes.push(`ROADMAP spike roots (${rmRoots.join(', ')}) differ from the gate's (${roots.join(', ')}); the gate's apply`);
    return { rigour: 'spike', rigour_source: 'roadmap', spike_roots: roots, rigour_rejected_reason: null, rigour_notice: notes.join('; ') || null };
  }
  if (claimed === 'spike') {
    const why = !gate ? 'no roadmap gate requested' : `roadmap gate ${gate.id} is ${gate.status}${listed ? '' : ' and does not list the phase'}`;
    return standard('rejected', `ROADMAP says spike but the approved roadmap gate is the only authority: ${why}`);
  }
  if (claimed === 'high') return standard('rejected', 'rigour "high" is retired: the phase runs as standard; risk-domain depth comes from the **Risk domains** line');
  if (claimed && claimed !== 'standard') return standard('rejected', `unknown rigour "${line[1].trim()}"`);
  return standard(claimed ? 'roadmap' : 'default');
}

const phaseNumbers = (cwd) => [...(read(path.join(cwd, '.planning', 'ROADMAP.md')) || '').matchAll(/^###\s*Phase\s+(\d+(?:\.\d+)?):/gim)].map((m) => m[1]);

// Why a roadmap gate request must be refused (errors) or noted (notices): an incomplete phase section without a
// **Risk domains** line (a completed one is a notice: legacy roadmaps start), a phase NEWLY added to spike_phases (not
// listed by the milestone's approved gate) that already has executed plans (no relabelling), a spike root overlapping a
// production path. `isComplete(n)` is supplied by the caller (checked ROADMAP box or complete on disk).
function gateRequestErrors(cwd, { kind, spikePhases, spikeRoots, milestone, isComplete }) {
  const errors = [];
  const notices = [];
  if (kind !== 'roadmap') return { errors, notices };
  const done = typeof isComplete === 'function' ? isComplete : () => false;
  const missing = [];
  for (const n of phaseNumbers(cwd)) {
    const sec = phaseSection(cwd, n);
    if (sec && /\*\*Risk domains:?\*\*:?[ \t]*\S/i.test(sec)) continue;
    if (done(n)) notices.push(`Phase ${n} has no **Risk domains:** line (phase complete, not required)`);
    else missing.push(n);
  }
  if (missing.length > 0) {
    errors.push(`${missing.map((n) => `Phase ${n}`).join(', ')} ${missing.length > 1 ? 'have' : 'has'} no **Risk domains:** line: add \`**Risk domains:** none\` (or a comma list of the project's risk_domains) under ${missing.length > 1 ? 'each of those phase headings' : 'that phase heading'} in .planning/ROADMAP.md`);
  }
  const g = approvedSpikeGate(cwd, milestone);
  const already = new Set(g.ok && g.gate.rigour && Array.isArray(g.gate.rigour.spike_phases) ? g.gate.rigour.spike_phases.map(phaseKey) : []);
  let dirs = [];
  try { dirs = fs.readdirSync(path.join(cwd, '.planning', 'phases')); } catch { /* no phases yet */ }
  for (const n of spikePhases.filter((x) => !already.has(phaseKey(x)))) {
    const d = dirs.find((x) => { const m = x.match(/^(?:phase-)?(\d+(?:\.\d+)?)(?:-|$)/); return m && phaseKey(m[1]) === phaseKey(n); });
    let executed = false;
    try { executed = !!d && fs.readdirSync(path.join(cwd, '.planning', 'phases', d)).some((f) => /-SUMMARY\.md$/i.test(f)); } catch { /* unreadable: not executed */ }
    if (executed) errors.push(`Phase ${n} already has executed plans: a phase is not relabelled spike`);
  }
  const clash = clashes((spikeRoots || []).map(normRoot), cwd);
  if (spikePhases.length > 0 && clash.length > 0) errors.push(`spike root overlaps a production path: ${clash.join('; ')}`);
  return { errors, notices };
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

// phase_risk_domains: the ROADMAP "Risk domains" line as a comma list of single tokens matched against the configured
// names (`known`); `none` = []; trailing prose after the first ". " is ignored. Unknown parts (including comma parts the
// token pattern rejects) are listed in `unknown`; they do not count as domains but make riskAddons fail closed. A phase with no line falls back to configured names found in its Goal/Requirements text
// (`derived: true`).
function phaseRiskDomains(cwd, phase, known) {
  const section = phaseSection(cwd, phase);
  const set = new Set((Array.isArray(known) ? known : []).map((x) => String(x).toLowerCase()));
  const m = section && section.match(/\*\*Risk domains:?\*\*:?[ \t]*([^\n]+)/i);
  if (!m) {
    const text = ((section || '').match(/^\*\*(?:Goal|Requirements):?\*\*:?[^\n]*/gim) || []).join('\n').toLowerCase();
    const hit = [...set].filter((n) => new RegExp(`(^|[^a-z0-9_-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_-]|$)`).test(text));
    return { domains: hit, unknown: [], derived: true };
  }
  const value = m[1].replace(/[`*]/g, '').split(/\.(?:\s|$)/)[0].trim().toLowerCase();
  if (/^(none|nothing|n\/a)$/.test(value)) return { domains: [], unknown: [], derived: false };
  const parts = value.split(',').map((x) => x.trim()).filter(Boolean);
  return { domains: parts.filter((n) => /^[a-z0-9_-]+$/.test(n) && set.has(n)), unknown: parts.filter((n) => !set.has(n)), derived: false };
}

module.exports = { LEVELS, phaseSection, resolveRigour, rigourViolations, phaseReqIds, phaseRiskDomains, gateRequestErrors };
