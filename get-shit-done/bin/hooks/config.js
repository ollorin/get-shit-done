const fs = require('fs');
const path = require('path');

const DEFAULT_HOOK_CONFIG = {
  enabled: true,                    // HOOK-07: Enable/disable
  timing: 'session-end',            // HOOK-05/06: 'session-end' or 'per-turn'
  quality_gates: {
    min_length: 20,                 // HOOK-04
    require_technical_signal: true  // HOOK-04
  },
  deduplication: {
    exact_threshold: 1.0,
    canonical_threshold: 0.95,
    embedding_threshold: 0.88       // KNOW-16
  },
  evolution: {
    similarity_min: 0.65,           // KNOW-17
    similarity_max: 0.88
  },
  extraction: {
    decisions: true,                // HOOK-02
    lessons: true,                  // HOOK-03
    summaries: false                // Too noisy by default
  },
  scope: 'project'                  // Default extraction scope
};

function getConfigPaths(cwd = process.cwd()) {
  return {
    project: path.join(cwd, '.planning', 'knowledge', 'hooks.json'),
    global: path.join(process.env.HOME, '.claude', 'knowledge', 'hooks.json')
  };
}

function ensureConfigDir(configPath) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadHookConfig(options = {}) {
  const { scope = 'project', cwd = process.cwd() } = options;
  const paths = getConfigPaths(cwd);
  const configPath = paths[scope] || paths.project;

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(raw);
      // Merge with defaults for any missing fields
      return {
        ...DEFAULT_HOOK_CONFIG,
        ...loaded,
        quality_gates: { ...DEFAULT_HOOK_CONFIG.quality_gates, ...loaded.quality_gates },
        deduplication: { ...DEFAULT_HOOK_CONFIG.deduplication, ...loaded.deduplication },
        evolution: { ...DEFAULT_HOOK_CONFIG.evolution, ...loaded.evolution },
        extraction: { ...DEFAULT_HOOK_CONFIG.extraction, ...loaded.extraction }
      };
    }
  } catch (err) {
    console.warn('[hooks] Failed to load config:', err.message);
  }

  return { ...DEFAULT_HOOK_CONFIG };
}

function saveHookConfig(config, options = {}) {
  const { scope = 'project', cwd = process.cwd() } = options;
  const paths = getConfigPaths(cwd);
  const configPath = paths[scope] || paths.project;

  try {
    ensureConfigDir(configPath);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, path: configPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function setHooksEnabled(enabled, options = {}) {
  const config = loadHookConfig(options);
  config.enabled = enabled;
  return saveHookConfig(config, options);
}

function setHooksTiming(timing, options = {}) {
  if (!['session-end', 'per-turn'].includes(timing)) {
    return { success: false, error: `Invalid timing: ${timing}` };
  }
  const config = loadHookConfig(options);
  config.timing = timing;
  return saveHookConfig(config, options);
}

function isHooksEnabled(options = {}) {
  const config = loadHookConfig(options);
  return config.enabled;
}

module.exports = {
  DEFAULT_HOOK_CONFIG,
  getConfigPaths,
  loadHookConfig,
  saveHookConfig,
  setHooksEnabled,
  setHooksTiming,
  isHooksEnabled
};
