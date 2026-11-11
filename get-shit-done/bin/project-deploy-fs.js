'use strict';

const fs = require('fs');
const path = require('path');

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const exists = (abs) => {
  try {
    fs.lstatSync(abs);
    return true;
  } catch {
    return false;
  }
};

function contained(root, rel) {
  try {
    const realRoot = fs.realpathSync(root);
    const tail = [];
    let cur = path.join(root, rel);
    while (!exists(cur)) {
      tail.unshift(path.basename(cur));
      cur = path.dirname(cur);
    }
    const real = path.join(fs.realpathSync(cur), ...tail);
    return real === realRoot || real.startsWith(realRoot + path.sep);
  } catch {
    return false;
  }
}

const fsFold = (s) => s.normalize('NFKD').toUpperCase().toLowerCase();

const toPosix = (p) => p.split(path.sep).join('/');

function canonicalRel(root, rel) {
  try {
    const parts = rel.split('/');
    let abs = root;
    let i = 0;
    for (; i < parts.length; i += 1) {
      const next = path.join(abs, parts[i]);
      let st;
      try {
        st = fs.lstatSync(next);
      } catch (err) {
        if (err.code === 'ENOENT') break;
        throw err;
      }
      if (st.isSymbolicLink()) return { error: 'dest traverses a symlink' };
      abs = next;
    }
    const head = toPosix(path.relative(fs.realpathSync.native(root), fs.realpathSync.native(abs)));
    if (head === '..' || head.startsWith('../') || path.isAbsolute(head)) return { error: 'dest escapes project root' };
    const tail = fsFold(parts.slice(i).join('/'));
    return { canon: [head, tail].filter((s) => s !== '').join('/') };
  } catch {
    return { error: 'dest cannot be resolved' };
  }
}

function sameFile(a, b) {
  try {
    const x = fs.statSync(a);
    const y = fs.statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

function isDirectory(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function readRegular(abs) {
  if (!exists(abs)) return { bytes: null };
  try {
    return fs.statSync(abs).isFile() ? { bytes: fs.readFileSync(abs) } : { error: 'not a regular file' };
  } catch {
    return { error: 'unreadable' };
  }
}

function readJsonObject(abs) {
  try {
    const v = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return isPlainObject(v) ? v : null;
  } catch {
    return null;
  }
}

module.exports = {
  isPlainObject, exists, contained, canonicalRel, sameFile, fsFold, isDirectory, readRegular, readJsonObject,
};
