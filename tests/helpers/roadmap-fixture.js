'use strict';
// Temp-repo fixtures for the roadmap truth/dispatcher tests: real git repo, real CLI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TOOLS = path.join(__dirname, '..', '..', 'get-shit-done', 'bin', 'gsd-tools.js');
const SUMMARY_OK = '# Summary\n\n## Defect Classes\n\nNone found. (reviewed by: plan-check, verifier)\n\n## Self-Check: PASSED\n';

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
}

// phases: [{ n: '1', name: 'one', deps: 'None' | 'Phase 1' }]
function makeProject(phases, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-rm-'));
  fs.mkdirSync(path.join(dir, '.planning', 'phases'), { recursive: true });
  const checks = phases.map(p => `- [ ] **Phase ${p.n}: ${p.name}** - ${p.name}`).join('\n');
  const sections = phases.map(p => `### Phase ${p.n}: ${p.name}\n**Goal:** ${p.name} goal\n**Depends on:** ${p.deps || 'None'}\n`).join('\n');
  fs.writeFileSync(path.join(dir, '.planning', 'ROADMAP.md'), `# Roadmap\n\n## Milestones\n- **v1.0 Test Milestone**\n\n${checks}\n\n${sections}`);
  fs.writeFileSync(path.join(dir, '.planning', 'STATE.md'), '# State\n\n**Current Phase:** 1\n**Status:** executing\n');
  fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(config));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'gsd-test@example.com');
  git(dir, 'config', 'user.name', 'GSD Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function gsd(dir, args, env = {}) {
  try {
    const out = execFileSync('node', [TOOLS, ...args, '--raw'], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GSD_LEGACY: '1', GSD_AUTONOMOUS: '', ...env } });
    let json = null;
    try { json = JSON.parse(out); } catch { /* plain text */ }
    return { rc: 0, out, json };
  } catch (e) {
    const out = (e.stdout || '').toString();
    let json = null;
    try { json = JSON.parse(out); } catch { /* plain text */ }
    return { rc: e.status ?? 1, out, err: (e.stderr || '').toString(), json };
  }
}

function phaseDir(dir, n) {
  const padded = String(n).padStart(2, '0');
  const existing = fs.readdirSync(path.join(dir, '.planning', 'phases')).find(d => d.startsWith(`${padded}-`));
  const full = path.join(dir, '.planning', 'phases', existing || `${padded}-p${n}`);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

// Writes the artifacts an executed phase leaves behind. verification: 'passed' | 'gaps_found' | null.
function writeEvidence(dir, n, { verification = 'passed', summary = true } = {}) {
  const padded = String(n).padStart(2, '0');
  const pd = phaseDir(dir, n);
  fs.writeFileSync(path.join(pd, `${padded}-01-PLAN.md`), `---\nphase: ${padded}\n---\n# Plan\n`);
  if (summary) fs.writeFileSync(path.join(pd, `${padded}-01-SUMMARY.md`), SUMMARY_OK);
  if (verification) fs.writeFileSync(path.join(pd, `${padded}-VERIFICATION.md`), `---\nstatus: ${verification}\n---\n# Verification\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', `feat(${padded}-01): work`);
  return pd;
}

// What execute-phase does on a clean run: checkpoint at verify, then `phase complete` on passed.
function completePhaseLikeWorkflow(dir, n) {
  gsd(dir, ['phase', 'checkpoint', String(n), '--step', 'verify', '--status', 'passed']);
  const r = gsd(dir, ['phase', 'complete', String(n)]);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', `docs(${String(n).padStart(2, '0')}): phase complete`);
  return r;
}

const events = (dir) => fs.readFileSync(path.join(dir, '.planning', 'EXECUTION_LOG.md'), 'utf-8')
  .split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));

module.exports = { makeProject, gsd, writeEvidence, completePhaseLikeWorkflow, events, git, phaseDir, TOOLS };
