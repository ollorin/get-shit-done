#!/usr/bin/env node
'use strict';
// Demo artifacts: build the manifest from Charlotte's own indexes, render DEMO.md from it, check both.
// Contract: agents/gsd-demo.md. Hashes, timestamps and URLs are never typed by an agent: `build` reads
// them from the files and from .charlotte-screenshots.json / .charlotte-screencasts.json, which the
// Charlotte server writes (charlotte src/state/artifact-store.ts, video-artifact-store.ts).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOLS = ['navigate', 'click', 'type', 'select', 'toggle', 'submit', 'key', 'scroll', 'hover', 'wait_for', 'viewport'];
const STATUSES = ['pass', 'fail', 'skipped'];
const SHOT_ID = /^ss-(\d{14})-[0-9a-f]{6}$/;
const REC_ID = /^rec-\d{14}-[0-9a-f]{6}$/;
const LIMITS = { shotBytes: 400 * 1024, shotsTotalBytes: 4 * 1024 * 1024, videoBytes: 25 * 1024 * 1024, steps: 15 };

const str = (v) => typeof v === 'string' && v.trim() !== '';
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const ext = (format) => (format === 'jpeg' ? 'jpg' : format);

function isImage(file) {
  const b = fs.readFileSync(file);
  if (b.length < 12) return false;
  const hex = b.subarray(0, 4).toString('hex');
  return hex.startsWith('ffd8ff') || hex === '89504e47'
    || (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP');
}

function paths(phaseDir) {
  const demo = path.join(phaseDir, 'demo');
  const md = fs.existsSync(phaseDir) ? fs.readdirSync(phaseDir).find((f) => /(^|-)DEMO\.md$/.test(f)) : undefined;
  return {
    demo,
    scenario: path.join(demo, 'scenario.json'),
    log: path.join(demo, 'steps.jsonl'),
    manifest: path.join(demo, 'manifest.json'),
    shots: path.join(demo, 'shots'),
    shotIndex: path.join(demo, 'shots', '.charlotte-screenshots.json'),
    video: path.join(demo, 'video'),
    videoIndex: path.join(demo, 'video', '.charlotte-screencasts.json'),
    md: md ? path.join(phaseDir, md) : null,
  };
}

function validateScenario(sc) {
  const errors = [];
  if (!sc || typeof sc !== 'object') return ['scenario is not an object'];
  for (const k of ['phase', 'title', 'summary']) if (!str(sc[k])) errors.push(`scenario.${k} is empty`);
  if (!Array.isArray(sc.sources) || sc.sources.length === 0) errors.push('scenario.sources is empty: name the SUMMARY/VERIFICATION lines the demo shows');
  if (!Array.isArray(sc.steps) || sc.steps.length === 0) return [...errors, 'scenario.steps is empty'];
  if (sc.steps.length > LIMITS.steps) errors.push(`scenario has ${sc.steps.length} steps (max ${LIMITS.steps})`);
  const seen = new Set();
  sc.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!str(s.id)) errors.push(`${at}.id is empty`);
    else if (seen.has(s.id)) errors.push(`${at}.id "${s.id}" is repeated`);
    seen.add(s.id);
    if (!str(s.say)) errors.push(`${at}.say is empty`);
    if (!str(s.expect)) errors.push(`${at}.expect is empty: a step with nothing to observe is not evidence`);
    if (!Array.isArray(s.do) || s.do.length === 0) errors.push(`${at}.do is empty`);
    else s.do.forEach((a, j) => { if (!a || !TOOLS.includes(a.tool)) errors.push(`${at}.do[${j}].tool "${a && a.tool}" not in ${TOOLS.join('|')}`); });
  });
  return errors;
}

function readLog(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`steps.jsonl line ${i + 1}: ${e.message}`); }
  });
}

function build(phaseDir) {
  const p = paths(phaseDir);
  const sc = readJson(p.scenario);
  const scErrors = validateScenario(sc);
  if (scErrors.length) throw new Error(scErrors.join('; '));
  const log = readLog(p.log);
  const run = log.filter((l) => l.type === 'run').pop();
  if (!run) throw new Error('steps.jsonl has no run line: demo-check start was never called');
  const end = log.filter((l) => l.type === 'run_end').pop();
  if (!end) throw new Error('steps.jsonl has no run_end line: demo-check stop was never called');
  const shotIndex = fs.existsSync(p.shotIndex) ? readJson(p.shotIndex) : [];
  const steps = sc.steps.map((s) => {
    const entry = log.filter((l) => l.type === 'step' && l.step === s.id).pop();
    if (!entry) throw new Error(`step ${s.id} was never logged: a demo cannot skip a step silently`);
    const out = {
      id: s.id, say: s.say, expect: s.expect, must_have: s.must_have || null, status: entry.status,
      observed: entry.observed || '', console_errors: entry.console_errors,
    };
    if (entry.shot) {
      const meta = shotIndex.find((a) => a.id === entry.shot);
      if (!meta) throw new Error(`step ${s.id}: screenshot ${entry.shot} is not in Charlotte's index (${p.shotIndex})`);
      const file = `${meta.id}.${ext(meta.format)}`;
      const abs = path.join(p.shots, file);
      if (!fs.existsSync(abs)) throw new Error(`step ${s.id}: ${abs} does not exist`);
      Object.assign(out, { ts: meta.timestamp, url: meta.url, title: meta.title, shot: { id: meta.id, file, sha256: sha256(abs), bytes: fs.statSync(abs).size } });
    }
    return out;
  });
  let video = null;
  const v = log.filter((l) => l.type === 'video').pop();
  if (v) {
    const meta = (fs.existsSync(p.videoIndex) ? readJson(p.videoIndex) : []).find((a) => a.id === v.id);
    if (!meta) throw new Error(`video ${v.id} is not in Charlotte's index (${p.videoIndex})`);
    const file = `${meta.id}.${meta.format}`;
    const abs = path.join(p.video, file);
    if (!fs.existsSync(abs)) throw new Error(`${abs} does not exist`);
    video = { id: meta.id, file, format: meta.format, fps: meta.fps, ts: meta.timestamp, sha256: sha256(abs), bytes: fs.statSync(abs).size };
  }
  const manifest = {
    schema: 1, phase: sc.phase, title: sc.title,
    run: { started_at: run.started_at, finished_at: end.finished_at, git_sha: run.git_sha, lock_owner: run.lock_owner },
    steps, video,
  };
  fs.writeFileSync(p.manifest, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// Run log writers: the agent passes what it observed; time, commit and lock owner are read here.
function appendLog(phaseDir, rec) {
  const p = paths(phaseDir);
  fs.mkdirSync(p.demo, { recursive: true });
  fs.appendFileSync(p.log, JSON.stringify(rec) + '\n');
  return rec;
}

function start(phaseDir, opts) {
  if (!str(opts.lockFile) || !fs.existsSync(opts.lockFile)) throw new Error(`stack lock not held: ${opts.lockFile || '--lock-file missing'}`);
  const owner = fs.readFileSync(opts.lockFile, 'utf8').trim().split('\n')[0];
  if (!str(owner)) throw new Error(`${opts.lockFile} names no owner`);
  if (!str(opts.owner)) throw new Error('--owner missing: pass the lock owner this recording runs under');
  if (owner !== opts.owner) throw new Error(`stack lock held by "${owner}", not "${opts.owner}"`);
  const sha = require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: phaseDir, encoding: 'utf8' }).trim();
  const p = paths(phaseDir);
  if (fs.existsSync(p.log)) fs.rmSync(p.log);
  return appendLog(phaseDir, { type: 'run', started_at: new Date().toISOString(), git_sha: sha, lock_owner: owner });
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const fm = {};
  if (m) m[1].split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
  return fm;
}

function render(phaseDir, opts = {}) {
  const p = paths(phaseDir);
  const sc = readJson(p.scenario);
  const target = p.md || path.join(phaseDir, `${sc.phase}-DEMO.md`);
  const head = (fm) => ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', `# Demo: ${sc.title}`, '', sc.summary, ''];
  if (opts.deferred) {
    if (!str(opts.reason)) throw new Error('--deferred needs --reason');
    const lines = [
      ...head({ phase: JSON.stringify(sc.phase), demo_recorded: false, reason: JSON.stringify(opts.reason), steps: sc.steps.length }),
      '**NOT RECORDED.** This is the script only; nothing below was observed in a browser.', '',
      ...sc.steps.flatMap((s, i) => [`### ${i + 1}. ${s.say}`, '', `Expected: ${s.expect}`, '']),
    ];
    fs.writeFileSync(target, lines.join('\n'));
    return target;
  }
  const m = readJson(p.manifest);
  const failed = m.steps.filter((s) => s.status !== 'pass').length;
  const fm = {
    phase: JSON.stringify(m.phase), demo_recorded: true, result: failed === 0 ? 'passed' : 'failed',
    recorded_at: m.run.finished_at, git_sha: m.run.git_sha, steps: m.steps.length,
    manifest: 'demo/manifest.json', manifest_sha256: sha256(p.manifest),
  };
  if (m.video) fm.video = `demo/video/${m.video.file}`;
  const lines = [
    ...head(fm),
    `${m.steps.length - failed}/${m.steps.length} steps passed. Recorded from a real browser run; this is a demo, not QA (\`charlotte_qa_ran\` is set only by gsd-verifier).`,
    ...(m.video ? ['', `Video: \`demo/video/${m.video.file}\` (${(m.video.bytes / 1048576).toFixed(1)} MB, not committed)`] : []), '',
    ...m.steps.flatMap((s, i) => [
      `### ${i + 1}. ${s.say}`, '',
      `Expected: ${s.expect}`, '', `Observed (${s.status}): ${s.observed || 'nothing recorded'}`, '',
      ...(s.shot ? [`![${s.id}](demo/shots/${s.shot.file})`, '', `\`${s.ts}\` ${s.url} · console errors: ${s.console_errors}`, ''] : []),
    ]),
  ];
  fs.writeFileSync(target, lines.join('\n'));
  return target;
}

function check(phaseDir, opts = {}) {
  const p = paths(phaseDir);
  const errors = [];
  const e = (m) => errors.push(m);
  if (!p.md) return { pass: false, recorded: false, errors: ['no *DEMO.md in the phase directory'] };
  const text = fs.readFileSync(p.md, 'utf8');
  const fm = frontmatter(text);
  if (!fs.existsSync(p.scenario)) return { pass: false, recorded: false, errors: ['demo/scenario.json is missing'] };
  let sc;
  try { sc = readJson(p.scenario); } catch (err) { return { pass: false, recorded: false, errors: [`scenario.json: ${err.message}`] }; }
  validateScenario(sc).forEach(e);
  const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:\/\//.test(l));

  if (fm.demo_recorded !== 'true') {
    if (fm.demo_recorded !== 'false') e('DEMO frontmatter demo_recorded must be true or false');
    if (!str(fm.reason)) e('demo_recorded: false needs a reason');
    if (links.length) e(`an unrecorded demo must not embed media: ${links.join(', ')}`);
    if (opts.requireRecorded) e('demo was not recorded (--require-recorded)');
    return { pass: errors.length === 0, recorded: false, errors };
  }

  if (!fs.existsSync(p.manifest)) return { pass: false, recorded: false, errors: [...errors, 'demo_recorded: true but demo/manifest.json is missing'] };
  let m;
  try { m = readJson(p.manifest); } catch (err) { return { pass: false, recorded: false, errors: [...errors, `manifest.json: ${err.message}`] }; }
  if (fm.manifest_sha256 !== sha256(p.manifest)) e('DEMO.md manifest_sha256 does not match demo/manifest.json: re-render, never edit either by hand');
  const run = m.run || {};
  const t0 = Date.parse(run.started_at);
  const t1 = Date.parse(run.finished_at);
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) e('manifest.run started_at/finished_at are not a valid window');
  if (!/^[0-9a-f]{7,40}$/.test(String(run.git_sha))) e('manifest.run.git_sha is not a commit sha');
  if (!str(run.lock_owner)) e('manifest.run.lock_owner is empty: a demo is recorded only while holding the stack lock');

  const shotIndex = fs.existsSync(p.shotIndex) ? readJson(p.shotIndex) : null;
  if (!shotIndex) e("demo/shots/.charlotte-screenshots.json is missing: screenshots were not saved by Charlotte into this directory");
  const steps = Array.isArray(m.steps) ? m.steps : [];
  const ids = steps.map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(sc.steps.map((s) => s.id))) e(`manifest steps [${ids}] differ from scenario steps [${sc.steps.map((s) => s.id)}]`);
  const seenSha = new Map();
  let total = 0;
  let prev = -Infinity;
  const used = new Set();
  steps.forEach((s) => {
    const at = `step ${s.id}`;
    const want = sc.steps.find((x) => x.id === s.id) || {};
    if (!STATUSES.includes(s.status)) e(`${at}: status "${s.status}" not in ${STATUSES.join('|')}`);
    if (s.status === 'pass' && !str(s.observed)) e(`${at}: pass without an observation`);
    if (s.status !== 'skipped' && !Number.isInteger(s.console_errors)) e(`${at}: console_errors is not an integer`);
    if (!s.shot) { if (s.status !== 'skipped' && want.shot !== false) e(`${at}: no screenshot evidence`); return; }
    const abs = path.join(p.shots, String(s.shot.file));
    used.add(`demo/shots/${s.shot.file}`);
    const idm = SHOT_ID.exec(String(s.shot.id));
    if (!idm) e(`${at}: ${s.shot.id} is not a Charlotte screenshot id`);
    if (!fs.existsSync(abs)) { e(`${at}: ${s.shot.file} is missing`); return; }
    const bytes = fs.statSync(abs).size;
    total += bytes;
    if (sha256(abs) !== s.shot.sha256) e(`${at}: sha256 of ${s.shot.file} does not match the manifest`);
    if (bytes !== s.shot.bytes) e(`${at}: size of ${s.shot.file} does not match the manifest`);
    if (!isImage(abs)) e(`${at}: ${s.shot.file} is not a JPEG/PNG/WebP image`);
    if (bytes > LIMITS.shotBytes) e(`${at}: ${s.shot.file} is ${bytes} bytes (max ${LIMITS.shotBytes}; use jpeg quality 70 and a selector)`);
    const meta = (shotIndex || []).find((a) => a.id === s.shot.id);
    if (shotIndex && !meta) e(`${at}: ${s.shot.id} is not in Charlotte's screenshot index`);
    if (meta && (meta.url !== s.url || meta.timestamp !== s.ts)) e(`${at}: url/ts differ from Charlotte's index`);
    const ts = Date.parse(s.ts);
    if (Number.isNaN(ts)) e(`${at}: ts is not a timestamp`);
    else {
      if (ts < t0 || ts > t1) e(`${at}: ts is outside the run window`);
      if (ts < prev) e(`${at}: ts is earlier than the previous step`);
      prev = ts;
      if (idm && Math.abs(Date.parse(idm[1].replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$1-$2-$3T$4:$5:$6Z')) - ts) > 5000) e(`${at}: id time and ts disagree`);
    }
    if (seenSha.has(s.shot.sha256)) e(`${at}: same image as step ${seenSha.get(s.shot.sha256)}: one screenshot cannot evidence two steps`);
    seenSha.set(s.shot.sha256, s.id);
  });
  if (total > LIMITS.shotsTotalBytes) e(`screenshots total ${total} bytes (max ${LIMITS.shotsTotalBytes})`);

  if (sc.record && sc.record.video === true && !m.video) e('scenario asks for a video but the manifest has none');
  if (m.video) {
    const abs = path.join(p.video, String(m.video.file));
    used.add(`demo/video/${m.video.file}`);
    if (!REC_ID.test(String(m.video.id))) e(`video ${m.video.id} is not a Charlotte screencast id`);
    const vIndex = fs.existsSync(p.videoIndex) ? readJson(p.videoIndex) : null;
    if (fs.existsSync(abs)) {
      if (sha256(abs) !== m.video.sha256) e('video sha256 does not match the manifest');
      if (fs.statSync(abs).size > LIMITS.videoBytes) e(`video is larger than ${LIMITS.videoBytes} bytes`);
      if (!vIndex || !vIndex.some((a) => a.id === m.video.id)) e("video is not in Charlotte's screencast index");
    } else if (!opts.videoOptional) e(`video ${m.video.file} is missing (pass --video-optional on a clone: videos are not committed)`);
  }

  links.forEach((l) => {
    if (!fs.existsSync(path.join(phaseDir, l))) { if (!(opts.videoOptional && l.startsWith('demo/video/'))) e(`DEMO.md references ${l}, which does not exist`); }
    else if (l.startsWith('demo/') && !used.has(l)) e(`DEMO.md references ${l}, which is not in the manifest`);
  });
  steps.forEach((s) => { if (s.shot && !links.includes(`demo/shots/${s.shot.file}`)) e(`DEMO.md does not show the screenshot of step ${s.id}`); });
  const failed = steps.filter((s) => s.status !== 'pass').map((s) => s.id);
  if ((fm.result === 'passed') !== (failed.length === 0)) e(`DEMO result "${fm.result}" contradicts the manifest (${failed.length} step(s) not passed)`);
  return { pass: errors.length === 0, recorded: true, result: failed.length === 0 ? 'passed' : 'failed', failed_steps: failed, shots_bytes: total, errors };
}

function notifyText(phaseDir) {
  const p = paths(phaseDir);
  const m = readJson(p.manifest);
  const ok = m.steps.filter((s) => s.status === 'pass').length;
  return [
    `Demo, phase ${m.phase}: ${m.title}`,
    `${ok}/${m.steps.length} steps passed (demo, not QA)`,
    ...m.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.say}`),
    `Read: ${p.md}`,
    ...(m.video ? [`Video: ${path.join(p.video, m.video.file)}`] : []),
  ].join('\n');
}

// Milestone rollup: one index over the phase demos; every row is re-checked, nothing is copied from a claim.
function rollup(phaseDirs, outFile, opts = {}) {
  const rows = phaseDirs.map((dir) => {
    const p = paths(dir);
    if (!p.md) return { dir, phase: path.basename(dir), title: '', state: 'no demo', md: '' };
    const text = fs.readFileSync(p.md, 'utf8');
    const fm = frontmatter(text);
    const res = check(dir, opts);
    const state = !res.pass ? 'CHECK FAILED' : !res.recorded ? 'script only' : `${res.result}${res.failed_steps.length ? ` (${res.failed_steps.join(', ')})` : ''}`;
    return { dir, phase: String(fm.phase || '').replace(/"/g, ''), title: (/^# Demo: (.*)$/m.exec(text) || [])[1] || '', state, md: path.relative(path.dirname(outFile), p.md), video: fm.video ? path.relative(path.dirname(outFile), path.join(dir, fm.video)) : '' };
  });
  const lines = ['# Milestone demo', '', `${rows.filter((r) => r.state === 'passed').length} of ${rows.length} phase demos recorded and passed.`, '',
    '| phase | what it shows | state | demo | video |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.phase} | ${r.title} | ${r.state} | ${r.md ? `[read](${r.md})` : ''} | ${r.video ? `\`${r.video}\`` : ''} |`), ''];
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.join('\n'));
  return rows;
}

function main(argv) {
  const [cmd, phaseDir, ...rest] = argv;
  const flag = (n) => rest.includes(`--${n}`);
  const val = (n) => (rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : undefined);
  const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\n');
  if (!phaseDir) { process.stderr.write('usage: demo-check.js scenario|start|log|stop|build|render|check|notify|rollup <phase_dir>\n'); return 64; }
  if (cmd === 'scenario') {
    const errors = validateScenario(readJson(paths(phaseDir).scenario));
    out({ pass: errors.length === 0, errors });
    return errors.length === 0 ? 0 : 1;
  }
  if (cmd === 'start') { out(start(phaseDir, { lockFile: val('lock-file'), owner: val('owner') })); return 0; }
  if (cmd === 'stop') { out(appendLog(phaseDir, { type: 'run_end', finished_at: new Date().toISOString() })); return 0; }
  if (cmd === 'log') {
    if (val('video')) { out(appendLog(phaseDir, { type: 'video', id: val('video') })); return 0; }
    if (!str(val('step')) || !STATUSES.includes(val('status'))) throw new Error('log --step ID --status pass|fail|skipped [--shot ID] --observed TEXT --console-errors N');
    const n = parseInt(val('console-errors'), 10);
    out(appendLog(phaseDir, { type: 'step', step: val('step'), status: val('status'), ...(val('shot') ? { shot: val('shot') } : {}), observed: val('observed') || '', ...(Number.isInteger(n) ? { console_errors: n } : {}) }));
    return 0;
  }
  if (cmd === 'build') { const m = build(phaseDir); out({ built: paths(phaseDir).manifest, steps: m.steps.length, video: m.video ? m.video.file : null }); return 0; }
  if (cmd === 'render') { out({ written: render(phaseDir, { deferred: flag('deferred'), reason: val('reason') }) }); return 0; }
  if (cmd === 'check') {
    const res = check(phaseDir, { videoOptional: flag('video-optional'), requireRecorded: flag('require-recorded') });
    out(res);
    return res.pass ? 0 : 1;
  }
  if (cmd === 'rollup') {
    const dirs = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--out');
    if (!val('out')) throw new Error('rollup <phase_dir> [<phase_dir>...] --out FILE');
    const rows = rollup([phaseDir, ...dirs], val('out'), { videoOptional: flag('video-optional') });
    out({ written: val('out'), rows: rows.map((r) => `${r.phase}: ${r.state}`) });
    return rows.some((r) => r.state === 'CHECK FAILED') ? 1 : 0;
  }
  if (cmd === 'notify') { out(notifyText(phaseDir)); return 0; }
  process.stderr.write(`unknown command ${cmd}\n`);
  return 64;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`demo-check: ${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { validateScenario, start, build, render, check, notifyText, rollup, LIMITS };
