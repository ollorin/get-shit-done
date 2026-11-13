'use strict';
// Plan stamp: a hash of everything a plan was written from, so a stale plan is detected by comparison, not by guess.
// Inputs, in order: the phase's ROADMAP section (no progress, no Plans line, no plan checkboxes), the phase's
// decisions (id status answer|default), CONTEXT.md and RESEARCH.md bytes. No timestamps and no git state.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const decisions = require('./decisions.js');
const { phaseSection } = require('./rigour.js');

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

function decisionsInput(cwd, phase) {
  const { records } = decisions.load(path.join(cwd, '.planning', 'DECISIONS.jsonl'));
  const key = String(phase).replace(/^0+(?=\d)/, '');
  return decisions.forPhase(records, key)
    .map((r) => `${r.id} ${r.status} ${r.kind === 'decision' ? r.answer : r.default}`).sort().join('\n');
}

// phaseDir: absolute path or null when the phase directory does not exist yet.
function compute(cwd, phase, phaseDir) {
  const names = phaseDir ? fs.readdirSync(phaseDir) : [];
  const file = (re) => { const f = names.filter((n) => re.test(n)).sort()[0]; return f ? read(path.join(phaseDir, f)) : null; };
  const parts = [
    { name: 'roadmap', body: roadmapInput(cwd, phase) },
    { name: 'decisions', body: decisionsInput(cwd, phase) },
    { name: 'context', body: file(/-CONTEXT\.md$/) },
    { name: 'research', body: file(/-RESEARCH\.md$/) },
  ].filter((p) => p.body !== null);
  const stamp = short(parts.map((p) => `${p.name}\n${sha(p.body)}\n`).join(''));
  return { stamp, inputs: parts.map((p) => ({ name: p.name, sha: short(p.body) })) };
}

// Plans without a SUMMARY: stale when their plan_stamp differs; no stamp is unstamped, never stale.
function staleness(phaseDir, incompletePlans, current) {
  const stale = [];
  const unstamped = [];
  const changed = new Set();
  let unknown = false;
  for (const f of incompletePlans) {
    const text = (read(path.join(phaseDir, f)) || '').toString();
    const fm = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const stamp = (fm.match(/^plan_stamp:[ \t]*["']?([0-9a-f]+)["']?[ \t]*$/m) || [])[1];
    if (!stamp) { unstamped.push(f); continue; }
    if (stamp === current.stamp) continue;
    stale.push(f);
    const recorded = (fm.match(/^plan_stamp_inputs:[ \t]*\[([^\]]*)\]/m) || [])[1];
    if (!recorded) { unknown = true; continue; }
    const old = new Map(recorded.split(',').map((x) => x.replace(/["'\s]/g, '').split(':')));
    for (const i of current.inputs) if (old.get(i.name) !== i.sha) changed.add(i.name);
    for (const n of old.keys()) if (!current.inputs.some((i) => i.name === n)) changed.add(n);
  }
  const reason = stale.length === 0 ? null : changed.size > 0 && !unknown ? [...changed].join(', ') : 'inputs changed';
  return { plans_stale: stale.length > 0, stale_reason: reason, plans_unstamped: unstamped };
}

module.exports = { compute, staleness };
