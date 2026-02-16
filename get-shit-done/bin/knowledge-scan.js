const fs = require('fs');
const path = require('path');
const { extractKnowledge } = require('./knowledge-extraction.js');

// Parse session logs (simplified JSONL format)
function parseSessionLog(logPath) {
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    const messages = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role && entry.content) {
          messages.push(entry);
        }
      } catch (parseErr) {
        // Skip invalid lines
      }
    }

    return messages;
  } catch (err) {
    console.warn(`[scan] Failed to parse ${logPath}:`, err.message);
    return [];
  }
}

// Get assistant responses from parsed messages
function getAssistantContent(messages) {
  return messages
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join('\n\n---\n\n');
}

async function scanSession(sessionContent, options = {}) {
  const { source = 'session_scan' } = options;

  // Extract knowledge from session content
  const extraction = extractKnowledge(sessionContent, {
    debug: process.env.GSD_DEBUG
  });

  if (extraction.extractions.length === 0) {
    return {
      success: true,
      extractions: 0,
      stats: {
        raw: extraction.total_raw,
        filtered: extraction.total_filtered
      }
    };
  }

  // Process extractions
  let processResult = { created: 0, evolved: 0, skipped: 0 };

  try {
    const { processExtractionBatch } = require('./knowledge-evolution.js');
    const { knowledge } = require('./knowledge.js');

    if (knowledge.isReady(options.scope || 'project')) {
      const conn = await knowledge._getConnection(options.scope || 'project');
      processResult = await processExtractionBatch(conn, extraction.extractions, {
        scope: options.scope || 'project',
        source
      });
    }
  } catch (err) {
    console.warn('[scan] Processing failed:', err.message);
    processResult.error = err.message;
  }

  return {
    success: true,
    extractions: extraction.total_deduplicated,
    stats: {
      raw: extraction.total_raw,
      filtered: extraction.total_filtered,
      deduplicated: extraction.total_deduplicated,
      ...processResult
    }
  };
}

async function scanSessionLogs(logPaths, options = {}) {
  const { verbose = false } = options;
  const results = {
    scanned: 0,
    skipped: 0,
    total_extractions: 0,
    total_created: 0,
    total_evolved: 0,
    errors: []
  };

  for (const logPath of logPaths) {
    if (!fs.existsSync(logPath)) {
      results.skipped++;
      continue;
    }

    try {
      const messages = parseSessionLog(logPath);
      const content = getAssistantContent(messages);

      if (!content.trim()) {
        results.skipped++;
        continue;
      }

      const scanResult = await scanSession(content, {
        ...options,
        source: `session_scan:${path.basename(logPath)}`
      });

      results.scanned++;
      results.total_extractions += scanResult.extractions;
      results.total_created += scanResult.stats.created || 0;
      results.total_evolved += scanResult.stats.evolved || 0;

      if (verbose) {
        console.log(`[scan] ${path.basename(logPath)}: ${scanResult.extractions} extractions`);
      }
    } catch (err) {
      results.errors.push({ file: logPath, error: err.message });
    }
  }

  return results;
}

async function extractPatternsFromHistory(history, options = {}) {
  // history = array of { role, content } messages
  const assistantContent = history
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join('\n\n---\n\n');

  return scanSession(assistantContent, {
    ...options,
    source: 'history_scan'
  });
}

function findSessionLogs(searchPath = '.', options = {}) {
  const { maxAge = 30 * 24 * 60 * 60 * 1000 } = options;  // 30 days default
  const now = Date.now();
  const logs = [];

  // Common session log locations
  const patterns = [
    '.claude/sessions/*.jsonl',
    '.planning/sessions/*.jsonl',
    '.claude-sessions/*.jsonl'
  ];

  for (const pattern of patterns) {
    const dir = path.dirname(pattern);
    const fullDir = path.join(searchPath, dir);

    if (fs.existsSync(fullDir)) {
      try {
        const files = fs.readdirSync(fullDir);
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = path.join(fullDir, file);
            const stat = fs.statSync(filePath);

            // Filter by age
            if (now - stat.mtimeMs <= maxAge) {
              logs.push(filePath);
            }
          }
        }
      } catch (err) {
        // Skip inaccessible directories
      }
    }
  }

  return logs;
}

module.exports = {
  parseSessionLog,
  getAssistantContent,
  scanSession,
  scanSessionLogs,
  extractPatternsFromHistory,
  findSessionLogs
};
