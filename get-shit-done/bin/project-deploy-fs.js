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

module.exports = { isPlainObject, exists, contained, isDirectory, readRegular, readJsonObject };
