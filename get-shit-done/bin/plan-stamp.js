'use strict';
// Plan stamp: a hash of everything a plan was written from, so a stale plan is detected by comparison, not by guess.
// Inputs (only what planning reads and does not itself write): the phase's ROADMAP section (no progress, no Plans line,
// no plan checkboxes), its requirement lines, the D- decisions mapped to it, CONTEXT.md and RESEARCH.md. No timestamps, no git state.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const decisions = require('./decisions.js');
const { phaseSection, phaseReqIds } = require('./rigour.js');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const short = (text) => sha(text).slice(0, 12);
const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };

function roadmapInput(cwd, phase) {
  const section = phaseSection(cwd, phase);
  if (section === null) return '';
  const cut = section.search(/\n##\s/);
  return (cut === -1 ? section : section.slice(0, cut)).split('\n')
    .filter((l) => !/^\s*\|/.test(l) && !/^\*\*Plans:?\*\*/i.test(l) && !/^\s*[-*]\s*\[[ xX]\]/.test(l))
    .map((l) => l.replace(/\s+$/, '')).join('\n').trim();
}

// D- decisions mapped to the phase. A- rows are excluded: plan-phase writes them itself after stamping.
function decisionsInput(cwd, phase) {
  const { records } = decisions.load(path.join(cwd, '.planning', 'DECISIONS.jsonl'));
  const key = String(phase).replace(/^0+(?=\d)/, '');
  return decisions.forPhase(records, key).filter((r) => r.kind === 'decision')
    .map((r) => `${r.id} ${r.status} ${r.answer}`).sort().join('\n');
}

// REQUIREMENTS.md lines naming one of the phase's requirement ids.
function requirementsInput(cwd, phase) {
  const ids = phaseReqIds(cwd, phase);
  const text = read(path.join(cwd, '.planning', 'REQUIREMENTS.md'));
  if (ids.length === 0 || text === null) return '';
  const has = (l) => ids.some((id) => new RegExp(`(^|[^A-Za-z0-9-])${id}([^A-Za-z0-9-]|$)`).test(l));
  return text.toString().split('\n').filter(has).map((l) => l.trim()).join('\n');
}

// phaseDir: absolute path or null when the phase directory does not exist yet.
function compute(cwd, phase, phaseDir) {
  const names = phaseDir ? fs.readdirSync(phaseDir) : [];
  const file = (re) => { const f = names.filter((n) => re.test(n)).sort()[0]; return f ? read(path.join(phaseDir, f)) : null; };
  const parts = [
    ['roadmap', roadmapInput(cwd, phase)],
    ['requirements', requirementsInput(cwd, phase)],
    ['decisions', decisionsInput(cwd, phase)],
    ['context', file(/-CONTEXT\.md$/)],
    ['research', file(/-RESEARCH\.md$/)],
  ].filter(([, body]) => body !== null);
  return { stamp: short(parts.map(([name, body]) => `${name}\n${sha(body)}\n`).join('')) };
}

// Plans without a SUMMARY: stale when their plan_stamp differs from the current one. A plan with no stamp is
// reported in `unstamped` and is never stale (its age against the inputs is not cheaply deterministic).
function staleness(phaseDir, incompletePlans, current) {
  const stale = [];
  const unstamped = [];
  for (const f of incompletePlans) {
    const text = (read(path.join(phaseDir, f)) || '').toString();
    const fm = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const stamp = (fm.match(/^plan_stamp:[ \t]*["']?([0-9a-f]+)["']?[ \t]*$/m) || [])[1];
    if (!stamp) unstamped.push(f);
    else if (stamp !== current.stamp) stale.push(f);
  }
  return { plans_stale: stale.length > 0, unstamped };
}

module.exports = { compute, staleness };
