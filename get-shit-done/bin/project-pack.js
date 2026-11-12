'use strict';
// agnostic-M-02 2.4: `gsd-tools pack install <name> [--root <dir>]`. Copies a pack's files only where absent.
const fs = require('fs');
const path = require('path');
const { renderPreset } = require('./project-deploy-render.js');

const PACKS_ROOT = path.join(__dirname, '..', 'presets', 'packs');
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const fail = (reason, file = 'pack') => ({ ok: false, errors: [{ file, reason }] });

function writeIfAbsent(root, f) {
  const target = path.join(root, f.dest);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.writeFileSync(target, f.content, { flag: 'wx', mode: f.mode }); return { dest: f.dest, copied: true }; }
  catch (e) { if (e.code !== 'EEXIST') throw e; return { dest: f.dest, copied: false }; }
}

// The directories above a file's dest, relative to the root: '.claude/agents/x.md' -> ['.claude', '.claude/agents'].
const ancestorsOf = (dest) => {
  const parts = path.dirname(dest).split(path.sep).filter((p) => p && p !== '.');
  return parts.map((_, i) => parts.slice(0, i + 1).join(path.sep));
};

// A component that exists must resolve inside the root. A dangling link cannot be proven inside, so it counts as outside.
function resolvesOutside(realRoot, dir) {
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })) return false;
  try {
    const real = fs.realpathSync(dir);
    return real !== realRoot && !real.startsWith(realRoot + path.sep);
  } catch {
    return true;
  }
}

function installPack({ name, root }) {
  if (!NAME_RE.test(name)) return fail(`invalid pack name: ${name}`);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return fail(`root is not a directory: ${root}`, 'root');
  const rendered = renderPreset(path.join(PACKS_ROOT, name), {});
  if (!rendered.ok) return { ok: false, errors: rendered.errors };
  const realRoot = fs.realpathSync(root);
  const escape = rendered.files.find((f) => ancestorsOf(f.dest).some((d) => resolvesOutside(realRoot, path.join(root, d))));
  if (escape) return fail(`${escape.dest} resolves outside the project root through a symlink`, escape.dest);
  try {
    const done = rendered.files.map((f) => writeIfAbsent(root, f));
    const copied = done.filter((o) => o.copied).map((o) => o.dest);
    const skipped = done.filter((o) => !o.copied).map((o) => o.dest);
    return { ok: true, errors: [], pack: name, root, copied, skipped, manual_settings: rendered.settings };
  } catch (e) {
    return fail(`write failed: ${e.message}`);
  }
}

function runCli(args, cwd) {
  const [sub, name, ...flags] = args;
  const rootAt = flags.indexOf('--root');
  const rest = flags.filter((_, i) => rootAt === -1 || (i !== rootAt && i !== rootAt + 1));
  const rootArg = rootAt === -1 ? cwd : flags[rootAt + 1];
  if (sub !== 'install' || !name || rest.length > 0 || !rootArg) {
    return { exitCode: 1, result: fail('usage: pack install <name> [--root <dir>]') };
  }
  const result = installPack({ name, root: path.resolve(cwd, rootArg) });
  return { exitCode: result.ok ? 0 : 1, result };
}

module.exports = { installPack, runCli };
