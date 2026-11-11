'use strict';

const fs = require('fs');
const path = require('path');

const BASE_DIR = '.planning/.gsd-preset-base';
const MANIFEST = '.planning/gsd-project-manifest.json';
const SETTINGS = '.claude/settings.json';
const GITIGNORE = '.gitignore';
const GITIGNORE_LINES = ['.claude/settings.local.json', '.mcp.json', '.env*', '!.env.example'];

const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

function writeAtomic(file, content, mode = 0o644) {
  const tmp = `${file}.gsd-tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const st = lstatOrNull(file);
    const regular = st !== null && st.isFile();
    if (regular && fs.readFileSync(file).equals(content)) return { ok: true, wrote: false };
    fs.writeFileSync(tmp, content);
    fs.chmodSync(tmp, regular ? st.mode & 0o777 : mode);
    fs.renameSync(tmp, file);
    return { ok: true, wrote: true };
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // the temp file is removed on a best-effort basis; the original failure is what the caller needs
    }
    return { ok: false, reason: e.code || e.message };
  }
}

function ensureGitignore(root) {
  const file = path.join(root, GITIGNORE);
  try {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const present = new Set(existing.split('\n').map((l) => l.trim()));
    const appendEnv = !present.has('.env*');
    const toAdd = GITIGNORE_LINES.filter((line) => !present.has(line)
      || (line === '!.env.example' && appendEnv));
    if (toAdd.length === 0) return { ok: true, wrote: false };
    const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
    return writeAtomic(file, Buffer.from(`${prefix}${toAdd.map((l) => `${l}\n`).join('')}`, 'utf8'));
  } catch (e) {
    return { ok: false, reason: e.code || e.message };
  }
}

function applyPlan(root, plan, command) {
  const { ops } = plan;
  const steps = [
    ...ops.files.map((f) => ({ rel: f.dest, run: () => writeAtomic(path.join(root, f.dest), f.content, f.mode) })),
    ...ops.bases.map((b) => ({
      rel: `${BASE_DIR}/${b.dest}`,
      run: () => writeAtomic(path.join(root, BASE_DIR, b.dest), b.content),
    })),
    ...(ops.settingsText ? [{ rel: SETTINGS, run: () => writeAtomic(path.join(root, SETTINGS), Buffer.from(ops.settingsText, 'utf8')) }] : []),
    ...(command === 'init' ? [{ rel: GITIGNORE, run: () => ensureGitignore(root) }] : []),
    { rel: MANIFEST, run: () => writeAtomic(path.join(root, MANIFEST), Buffer.from(`${JSON.stringify(ops.manifest, null, 2)}\n`, 'utf8')) },
  ];
  const written = [];
  for (const step of steps) {
    const r = step.run();
    if (!r.ok) return { ok: false, written, failed: { path: step.rel, reason: r.reason } };
    if (r.wrote) written.push(step.rel);
  }
  return { ok: true, written };
}

module.exports = { applyPlan, ensureGitignore, writeAtomic };
