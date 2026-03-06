#!/usr/bin/env node
/**
 * Apply GSD header extraction to a document and print the result.
 * Usage: node extract-headers.js <doc_path>
 *
 * Mirrors what doc-compression-hook.js does: extract headers + first paragraph per section.
 */
const fs = require('fs');
const path = require('path');

const docPath = process.argv[2];
if (!docPath) {
  console.error('Usage: extract-headers.js <doc_path>');
  process.exit(1);
}

const content = fs.readFileSync(docPath, 'utf8');

// Replicate HeaderExtractor logic from bin/compression/header-extractor.js
function extractHeaders(content, maxCharsPerSection = 400) {
  const lines = content.split('\n');
  const result = [];
  let currentHeader = null;
  let buffer = [];
  let charCount = 0;

  function flushSection() {
    if (!currentHeader) return;
    const bodyText = buffer.join('\n').trim();
    // Take first maxCharsPerSection chars of body
    const snippet = bodyText.length > maxCharsPerSection
      ? bodyText.slice(0, maxCharsPerSection) + '…'
      : bodyText;
    if (snippet) {
      result.push(currentHeader + '\n' + snippet);
    } else {
      result.push(currentHeader);
    }
  }

  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) {
      flushSection();
      currentHeader = line;
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flushSection();

  return result.join('\n\n');
}

const extracted = extractHeaders(content);
const originalChars = content.length;
const compressedChars = extracted.length;

const meta = {
  original_chars: originalChars,
  compressed_chars: compressedChars,
  original_tokens_est: Math.ceil(originalChars / 4),
  compressed_tokens_est: Math.ceil(compressedChars / 4),
  reduction_pct: Math.round((1 - compressedChars / originalChars) * 100 * 10) / 10,
  method: 'header-extraction',
};

console.log(JSON.stringify(meta));
console.log(extracted);
