const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { validateScenario, build, render, check, notifyText } = require('./demo-check.js');

const TOOL = path.join(__dirname, 'demo-check.js');
const SCENARIO = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'demo', '404.1-registration-jurisdiction.scenario.json');
const JPEG = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n), Buffer.from([0xff, 0xd9])]);

// A phase dir shaped like a real recording: Charlotte's screenshot_dir is demo/shots, its video_dir demo/video,
// so the two .charlotte-*.json indexes are the ones the server would have written.
function recordedPhase({ withLog = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-demo-'));
  const demo = path.join(dir, 'demo');
  fs.mkdirSync(path.join(demo, 'shots'), { recursive: true });
  fs.mkdirSync(path.join(demo, 'video'), { recursive: true });
  fs.copyFileSync(SCENARIO, path.join(demo, 'scenario.json'));
  const sc = JSON.parse(fs.readFileSync(SCENARIO, 'utf8'));
  const index = [];
  const log = [{ type: 'run', started_at: '2026-11-10T12:00:00.000Z', git_sha: '1d53f5ffa', lock_owner: 'demo-404.1' }, { type: 'run_end', finished_at: '2026-11-10T12:04:00.000Z' }];
  sc.steps.forEach((s, i) => {
    const id = `ss-2026111012000${i + 1}-00000${i + 1}`;
    fs.writeFileSync(path.join(demo, 'shots', `${id}.jpg`), JPEG(i + 1));
    index.push({ id, format: 'jpeg', selector: 'main', url: `http://localhost:3000/en/wallet/step${i + 1}`, title: 'Wallet', timestamp: `2026-11-10T12:00:0${i + 1}.250Z` });
    log.push({ type: 'step', step: s.id, status: 'pass', shot: id, observed: `saw: ${s.expect}`, console_errors: 0 });
  });
  fs.writeFileSync(path.join(demo, 'shots', '.charlotte-screenshots.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(demo, 'video', 'rec-20261110120000-abcdef.webm'), Buffer.alloc(256, 7));
  fs.writeFileSync(path.join(demo, 'video', '.charlotte-screencasts.json'), JSON.stringify([{ id: 'rec-20261110120000-abcdef', format: 'webm', fps: 5, url: 'http://localhost:3000/en', title: 'Home', timestamp: '2026-11-10T12:00:00.100Z' }]));
  log.push({ type: 'video', id: 'rec-20261110120000-abcdef' });
  if (withLog) fs.writeFileSync(path.join(demo, 'steps.jsonl'), log.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, demo, sc, log };
}

function good() {
  const ph = recordedPhase();
  build(ph.dir);
  render(ph.dir);
  return ph;
}

const editManifest = (ph, fn) => {
  const f = path.join(ph.demo, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  fn(m);
  fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n');
};

describe('demo scenario format', () => {
  test('the real 404.1 scenario is valid', () => {
    assert.deepStrictEqual(validateScenario(JSON.parse(fs.readFileSync(SCENARIO, 'utf8'))), []);
  });

  test('a step with no expectation, an unknown tool or a repeated id is rejected', () => {
    const sc = JSON.parse(fs.readFileSync(SCENARIO, 'utf8'));
    sc.steps[1].expect = '';
    sc.steps[2].do[0].tool = 'sql';
    sc.steps[3].id = 's1';
    const errors = validateScenario(sc);
    assert.ok(errors.some((e) => e.includes('steps[1].expect is empty')));
    assert.ok(errors.some((e) => e.includes('steps[2].do[0].tool "sql"')));
    assert.ok(errors.some((e) => e.includes('"s1" is repeated')));
  });
});

describe('demo-check passes a manifest built from a real-shaped run', () => {
  test('build -> render -> check: pass, recorded, 5 steps, video', () => {
    const ph = good();
    const r = spawnSync('node', [TOOL, 'check', ph.dir], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const res = JSON.parse(r.stdout);
    assert.deepStrictEqual({ pass: res.pass, recorded: res.recorded, result: res.result, errors: res.errors }, { pass: true, recorded: true, result: 'passed', errors: [] });
    const md = fs.readFileSync(path.join(ph.dir, '404.1-DEMO.md'), 'utf8');
    assert.match(md, /demo_recorded: true/);
    assert.match(md, /5\/5 steps passed/);
    assert.match(md, /!\[s2\]\(demo\/shots\/ss-20261110120002-000002\.jpg\)/);
    assert.match(notifyText(ph.dir), /Demo, phase 404\.1: .*\n5\/5 steps passed/);
  });

  test('hashes, timestamps and URLs in the manifest come from the files and Charlotte index, not the step log', () => {
    const ph = recordedPhase();
    const log = ph.log.map((l) => (l.step === 's1' ? { ...l, ts: '1999-01-01T00:00:00Z', url: 'http://made.up', sha256: 'feed' } : l));
    fs.writeFileSync(path.join(ph.demo, 'steps.jsonl'), log.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const m = build(ph.dir);
    assert.strictEqual(m.steps[0].ts, '2026-11-10T12:00:01.250Z');
    assert.strictEqual(m.steps[0].url, 'http://localhost:3000/en/wallet/step1');
    assert.match(m.steps[0].shot.sha256, /^[0-9a-f]{64}$/);
  });

  test('a failed step is reported as failed, not hidden: check passes, result failed', () => {
    const ph = recordedPhase();
    const log = ph.log.map((l) => (l.step === 's4' ? { ...l, status: 'fail', observed: 'link went to /en/verify' } : l));
    fs.writeFileSync(path.join(ph.demo, 'steps.jsonl'), log.map((l) => JSON.stringify(l)).join('\n') + '\n');
    build(ph.dir);
    render(ph.dir);
    const res = check(ph.dir);
    assert.deepStrictEqual([res.pass, res.result, res.failed_steps], [true, 'failed', ['s4']]);
    assert.match(fs.readFileSync(path.join(ph.dir, '404.1-DEMO.md'), 'utf8'), /result: failed/);
  });

  test('deferred demo: script only, no media, passes; --require-recorded fails it', () => {
    const ph = recordedPhase({ withLog: false });
    render(ph.dir, { deferred: true, reason: 'Charlotte deferred to the milestone-end window' });
    const md = fs.readFileSync(path.join(ph.dir, '404.1-DEMO.md'), 'utf8');
    assert.match(md, /demo_recorded: false/);
    assert.match(md, /NOT RECORDED/);
    assert.deepStrictEqual(check(ph.dir), { pass: true, recorded: false, errors: [] });
    assert.strictEqual(spawnSync('node', [TOOL, 'check', ph.dir, '--require-recorded']).status, 1);
  });

  test('a clone without the uncommitted video passes only with --video-optional', () => {
    const ph = good();
    fs.rmSync(path.join(ph.demo, 'video'), { recursive: true });
    assert.ok(check(ph.dir).errors.some((e) => e.includes('video rec-20261110120000-abcdef.webm is missing')));
    assert.strictEqual(check(ph.dir, { videoOptional: true }).pass, true);
  });
});

describe('milestone rollup', () => {
  test('re-checks every phase: passed, script-only and tampered demos are labelled as such; exit 1 on a failed check', () => {
    const a = good();
    const b = recordedPhase({ withLog: false });
    render(b.dir, { deferred: true, reason: 'window not reached' });
    const c = good();
    fs.rmSync(path.join(c.demo, 'shots', 'ss-20261110120001-000001.jpg'));
    const outFile = path.join(a.dir, 'rollup', 'MILESTONE-DEMO.md');
    const r = spawnSync('node', [TOOL, 'rollup', a.dir, b.dir, c.dir, '--out', outFile], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.deepStrictEqual(JSON.parse(r.stdout).rows, ['404.1: passed', '404.1: script only', '404.1: CHECK FAILED']);
    const md = fs.readFileSync(outFile, 'utf8');
    assert.match(md, /1 of 3 phase demos recorded and passed/);
    assert.match(md, /\| 404\.1 \| A player without a confirmed country .* \| passed \| \[read\]\(\.\.\/404\.1-DEMO\.md\) \|/);
  });
});

describe('run log is written by the tool, inside a held stack lock', () => {
  test('start refuses without the lock file; with it, records owner, commit and time; log/stop append', () => {
    const ph = recordedPhase({ withLog: false });
    const no = spawnSync('node', [TOOL, 'start', ph.dir, '--lock-file', path.join(ph.dir, 'nope', 'owner.txt')], { encoding: 'utf8' });
    assert.strictEqual(no.status, 1);
    assert.match(no.stderr, /stack lock not held/);
    assert.strictEqual(fs.existsSync(path.join(ph.demo, 'steps.jsonl')), false);

    const lock = path.join(ph.dir, 'owner.txt');
    fs.writeFileSync(lock, 'phase-404.1-demo\n');
    spawnSync('git', ['init', '-q'], { cwd: ph.dir });
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: ph.dir });
    const ok = spawnSync('node', [TOOL, 'start', ph.dir, '--lock-file', lock], { encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, ok.stderr);
    const run = JSON.parse(ok.stdout);
    assert.strictEqual(run.lock_owner, 'phase-404.1-demo');
    assert.match(run.git_sha, /^[0-9a-f]{7,}$/);
    spawnSync('node', [TOOL, 'log', ph.dir, '--step', 's1', '--status', 'fail', '--shot', 'ss-20261110120001-000001', '--observed', 'it said "no"', '--console-errors', '2']);
    spawnSync('node', [TOOL, 'log', ph.dir, '--video', 'rec-20261110120000-abcdef']);
    spawnSync('node', [TOOL, 'stop', ph.dir]);
    const lines = fs.readFileSync(path.join(ph.demo, 'steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(lines.map((l) => l.type), ['run', 'step', 'video', 'run_end']);
    assert.deepStrictEqual(lines[1], { type: 'step', step: 's1', status: 'fail', shot: 'ss-20261110120001-000001', observed: 'it said "no"', console_errors: 2 });
    assert.strictEqual(spawnSync('node', [TOOL, 'log', ph.dir, '--step', 's1', '--status', 'great']).status, 1);
  });

  test('build refuses a run that was never stopped', () => {
    const ph = recordedPhase();
    fs.writeFileSync(path.join(ph.demo, 'steps.jsonl'), ph.log.filter((l) => l.type !== 'run_end').map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.throws(() => build(ph.dir), /demo-check stop was never called/);
  });
});

describe('demo-check fails a fabricated demo', () => {
  const fails = (ph, re) => {
    const r = spawnSync('node', [TOOL, 'check', ph.dir], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1, 'check must exit 1');
    const res = JSON.parse(r.stdout);
    assert.ok(res.errors.some((e) => re.test(e)), `no error matching ${re}: ${JSON.stringify(res.errors)}`);
  };

  test('hand-written DEMO.md claiming a recording, no manifest', () => {
    const ph = recordedPhase({ withLog: false });
    fs.writeFileSync(path.join(ph.dir, '404.1-DEMO.md'), '---\nphase: "404.1"\ndemo_recorded: true\nresult: passed\n---\n# Demo\nAll five steps worked.\n![s1](demo/shots/s1.png)\n');
    fails(ph, /demo_recorded: true but demo\/manifest\.json is missing/);
  });

  test('referenced screenshot file is missing', () => {
    const ph = good();
    fs.rmSync(path.join(ph.demo, 'shots', 'ss-20261110120003-000003.jpg'));
    fails(ph, /step s3: ss-20261110120003-000003\.jpg is missing/);
    fails(ph, /DEMO\.md references demo\/shots\/ss-20261110120003-000003\.jpg, which does not exist/);
  });

  test('screenshot swapped after the run (sha256 mismatch)', () => {
    const ph = good();
    fs.writeFileSync(path.join(ph.demo, 'shots', 'ss-20261110120002-000002.jpg'), JPEG(99));
    fails(ph, /step s2: sha256 of .* does not match the manifest/);
  });

  test('manifest edited after rendering (fail turned into pass)', () => {
    const ph = good();
    editManifest(ph, (m) => { m.steps[0].observed = 'better story'; });
    fails(ph, /manifest_sha256 does not match/);
  });

  test('image the agent wrote itself: not in the Charlotte index', () => {
    const ph = good();
    fs.writeFileSync(path.join(ph.demo, 'shots', '.charlotte-screenshots.json'), JSON.stringify(JSON.parse(fs.readFileSync(path.join(ph.demo, 'shots', '.charlotte-screenshots.json'), 'utf8')).slice(1)));
    fails(ph, /step s1: ss-20261110120001-000001 is not in Charlotte's screenshot index/);
  });

  test('step with no evidence, pass with no observation, one image for two steps', () => {
    const ph = good();
    editManifest(ph, (m) => {
      delete m.steps[0].shot;
      m.steps[1].observed = '';
      m.steps[3].shot = { ...m.steps[2].shot };
    });
    render(ph.dir);
    fails(ph, /step s1: no screenshot evidence/);
    fails(ph, /step s2: pass without an observation/);
    fails(ph, /step s4: same image as step s3/);
  });

  test('timestamps outside the run window or going backwards', () => {
    const ph = good();
    editManifest(ph, (m) => { m.run.finished_at = '2026-11-10T12:00:02.000Z'; });
    render(ph.dir);
    fails(ph, /step s3: ts is outside the run window/);
  });

  test('no stack-lock owner, text file posing as an image, media not in the manifest', () => {
    const ph = good();
    editManifest(ph, (m) => { m.run.lock_owner = ''; });
    render(ph.dir);
    fs.writeFileSync(path.join(ph.demo, 'shots', 'extra.jpg'), JPEG(50));
    fs.appendFileSync(path.join(ph.dir, '404.1-DEMO.md'), '\n![bonus](demo/shots/extra.jpg)\n');
    fails(ph, /lock_owner is empty/);
    fails(ph, /references demo\/shots\/extra\.jpg, which is not in the manifest/);
  });

  test('build refuses a step that was never logged and a screenshot Charlotte never saved', () => {
    const ph = recordedPhase();
    fs.writeFileSync(path.join(ph.demo, 'steps.jsonl'), ph.log.filter((l) => l.step !== 's5').map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.throws(() => build(ph.dir), /step s5 was never logged/);
    fs.writeFileSync(path.join(ph.demo, 'steps.jsonl'), ph.log.map((l) => (l.step === 's5' ? { ...l, shot: 'ss-20261110120009-ffffff' } : l)).map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.throws(() => build(ph.dir), /is not in Charlotte's index/);
  });
});
