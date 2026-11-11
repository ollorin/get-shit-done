'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalRel } = require('./project-deploy-fs.js');

const BASE_DIR = '.planning/.gsd-preset-base';
const MANIFEST = '.planning/gsd-project-manifest.json';
const SETTINGS = '.claude/settings.json';
const GITIGNORE = '.gitignore';
const GITIGNORE_LINES = ['.claude/settings.local.json', '.mcp.json', '.env*', '!.env.example'];
const DEFAULT_MODE = 0o644;

const randomHex = () => crypto.randomBytes(8).toString('hex');
const errReason = (e) => e.code || e.message;
const quiet = (fn) => {
  try {
    fn();
  } catch {
    // best-effort cleanup: the failure being reported is the caller's concern, not this one
  }
};
const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

function gitignoreContent(existing) {
  const present = new Set(existing.split('\n').map((l) => l.trim()));
  const appendEnv = !present.has('.env*');
  const toAdd = GITIGNORE_LINES.filter((line) => !present.has(line)
    || (line === '!.env.example' && appendEnv));
  if (toAdd.length === 0) return null;
  const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
  return Buffer.from(`${prefix}${toAdd.map((l) => `${l}\n`).join('')}`, 'utf8');
}

function readGitignore(root, command) {
  if (command !== 'init') return null;
  const giPath = path.join(root, GITIGNORE);
  return gitignoreContent(fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '');
}

function buildSteps(plan, gitignore) {
  const { ops } = plan;
  return [
    ...ops.files.map((f) => ({ rel: f.dest, content: f.content, mode: f.mode ?? DEFAULT_MODE })),
    ...ops.bases.map((b) => ({ rel: `${BASE_DIR}/${b.dest}`, content: b.content, mode: DEFAULT_MODE })),
    ...(ops.settingsText ? [{ rel: SETTINGS, content: Buffer.from(ops.settingsText, 'utf8'), mode: DEFAULT_MODE }] : []),
    ...(gitignore ? [{ rel: GITIGNORE, content: gitignore, mode: DEFAULT_MODE }] : []),
    { rel: MANIFEST, content: Buffer.from(`${JSON.stringify(ops.manifest, null, 2)}\n`, 'utf8'), mode: DEFAULT_MODE },
  ];
}

// Opens with 'wx' so a planted path is never reused; the name is random, not predictable.
function makeTemp(target, content, mode, rand) {
  const tmp = `${target}.gsd-tmp-${rand()}`;
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeFileSync(fd, content);
    fs.fchmodSync(fd, mode);
  } catch (e) {
    quiet(() => fs.rmSync(tmp, { force: true }));
    throw e;
  } finally {
    fs.closeSync(fd);
  }
  return tmp;
}

function missingDirs(root, dir) {
  const out = [];
  let cur = dir;
  while (cur !== root && lstatOrNull(cur) === null) {
    out.unshift(cur);
    cur = path.dirname(cur);
  }
  return out;
}

// An unchanged file with the rendered mode is skipped. Changed content keeps the file's own mode;
// unchanged content with another mode takes the rendered mode (an update of mode only).
function stageStep(root, step, rand, dirs) {
  const target = path.join(root, step.rel);
  const st = lstatOrNull(target);
  const regular = st !== null && st.isFile();
  const original = regular ? fs.readFileSync(target) : null;
  const currentMode = regular ? st.mode & 0o777 : step.mode;
  const sameBytes = regular && original.equals(step.content);
  if (sameBytes && currentMode === step.mode) return null;
  const mode = sameBytes || !regular ? step.mode : currentMode;
  dirs.push(...missingDirs(root, path.dirname(target)));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = makeTemp(target, step.content, mode, rand);
  return { rel: step.rel, target, tmp, original, mode: currentMode };
}

// Undoes renames in reverse order, then discards staged temps and the directories this apply created.
// Returns the rel paths that could not be restored (empty when the tree is back to its pre-apply state).
function rollback(staged, done, dirs, rand) {
  const restoreFailed = [...done].reverse().flatMap((s) => {
    try {
      if (s.original === null) fs.unlinkSync(s.target);
      else fs.renameSync(makeTemp(s.target, s.original, s.mode, rand), s.target);
      return [];
    } catch {
      return [s.rel];
    }
  });
  for (const s of staged) quiet(() => fs.rmSync(s.tmp, { force: true }));
  for (const d of [...dirs].reverse()) quiet(() => fs.rmdirSync(d));
  return restoreFailed;
}

// Leftovers of a crashed apply: regular files named `.gsd-tmp-` + 16 hex, in this plan's dest directories.
const STALE_TMP_RE = /\.gsd-tmp-[0-9a-f]{16}$/;

function clearStaleTemps(root, steps) {
  const dirs = new Set(steps.map((s) => path.dirname(path.join(root, s.rel))));
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => STALE_TMP_RE.test(n))) {
      const p = path.join(dir, name);
      if (lstatOrNull(p)?.isFile()) quiet(() => fs.unlinkSync(p));
    }
  }
}

// Two phases: stage every changed file as a random-named temp (any failure changes nothing),
// then rename in order with the manifest last. A failed rename restores everything already renamed.
// Result `written`: on success the renamed rel paths; on failure the rel paths NOT restored, which is
// empty exactly when `rolled_back` is true. A file that failed to restore keeps its new content.
function applyPlan(root, plan, command, io = {}) {
  const rand = io.random ?? randomHex;
  const rename = io.rename ?? fs.renameSync;
  const staged = [];
  const dirs = [];
  const bail = (failed, done = []) => {
    const notRestored = rollback(staged, done, dirs, rand);
    return { ok: false, written: notRestored, rolled_back: notRestored.length === 0, failed };
  };

  let gitignore;
  try {
    gitignore = readGitignore(root, command);
  } catch (e) {
    return bail({ path: GITIGNORE, reason: errReason(e) });
  }
  const steps = buildSteps(plan, gitignore);
  const pre = steps.map((s) => ({ path: s.rel, r: canonicalRel(root, s.rel) })).find((x) => x.r.error);
  if (pre) return bail({ path: pre.path, reason: pre.r.error });
  clearStaleTemps(root, steps);

  for (const step of steps) {
    try {
      const s = stageStep(root, step, rand, dirs);
      if (s !== null) staged.push(s);
    } catch (e) {
      return bail({ path: step.rel, reason: errReason(e) });
    }
  }

  const done = [];
  for (const s of staged) {
    const r = canonicalRel(root, s.rel);
    if (r.error) return bail({ path: s.rel, reason: r.error }, done);
    try {
      rename(s.tmp, s.target);
    } catch (e) {
      return bail({ path: s.rel, reason: errReason(e) }, done);
    }
    done.push(s);
  }
  return { ok: true, written: done.map((s) => s.rel) };
}

const applyFailure = (report, applied) => ({
  ...report,
  ok: false,
  errors: [...report.errors, { file: applied.failed.path, reason: `write failed: ${applied.failed.reason}` }],
  written: applied.written,
  rolled_back: applied.rolled_back,
});

module.exports = { applyPlan, applyFailure };
