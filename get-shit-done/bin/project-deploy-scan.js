'use strict';

const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  { id: 'vcs_token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { id: 'vcs_fine_grained_token', re: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { id: 'cloud_access_key_id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'chat_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'llm_api_key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { id: 'live_api_key', re: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { id: 'maps_api_key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { id: 'registry_token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'signed_token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'private_key_block', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { id: 'url_credentials', re: /[a-z][a-z0-9+.-]*:\/\/[^\s\/:@]+:[^\s\/@]+@/i },
  { id: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/ },
  { id: 'assigned_secret', re: /(password|secret|token|api[_-]?key)\s*[:=]\s*['"]?(?![${<])[^\s'"]{12,}/i },
];

const SKIP_DIRS = new Set(['node_modules', '.git']);

function scanText(text) {
  const str = Buffer.isBuffer(text) ? text.toString('latin1') : text;
  const hits = [];
  str.split('\n').forEach((line, i) => {
    for (const { id, re } of SECRET_PATTERNS) {
      if (re.test(line)) hits.push({ pattern: id, line: i + 1 });
    }
  });
  return hits;
}

function listFiles(root, rel, out) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listFiles(root, relPath, out);
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
  return out;
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return { files_scanned: 0, hits: [] };
  const files = listFiles(dir, '', []).sort();
  const hits = files.flatMap((file) =>
    scanText(fs.readFileSync(path.join(dir, file))).map((h) => ({ file, ...h }))
  );
  return { files_scanned: files.length, hits };
}

module.exports = { SECRET_PATTERNS, scanText, scanDir };
