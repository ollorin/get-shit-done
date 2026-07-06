#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Identical shape/values to config/pre-pr-checks.json -- used only if the
// JSON file is missing, corrupt, or missing a required top-level key. The
// pre-PR gate (wired in Plan 61-02) must NEVER crash over a config file
// problem, so this module fails open, always -- mirrors model-registry.js's
// DEFAULT_REGISTRY fail-open contract exactly.
const DEFAULT_CHECKS = {
  node: {
    manifest: 'package.json',
    script_checks: ['test', 'lint', 'build'],
  },
  python: {
    manifest: 'pyproject.toml',
    checks: [
      { id: 'python-test', command: 'pytest', required: true },
    ],
  },
  go: {
    manifest: 'go.mod',
    checks: [
      { id: 'go-test', command: 'go test ./...', required: true },
      { id: 'go-vet', command: 'go vet ./...', required: true },
    ],
  },
  rust: {
    manifest: 'Cargo.toml',
    checks: [
      { id: 'rust-test', command: 'cargo test', required: true },
      { id: 'rust-clippy', command: 'cargo clippy -- -D warnings', required: false },
    ],
  },
  unknown: {
    checks: [
      { id: 'git-status-clean', command: 'test -z "$(git status --porcelain)"', required: true },
      { id: 'branch-not-main', command: '[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] && [ "$(git rev-parse --abbrev-ref HEAD)" != "master" ]', required: true },
    ],
  },
};

// Fixed detection order -- deterministic, never invented, never reordered.
const ORDERED_TYPES = ['node', 'python', 'go', 'rust'];

const REQUIRED_TYPE_KEYS = ['node', 'python', 'go', 'rust', 'unknown'];

let cachedRegistry = null;

function loadRegistry() {
  if (cachedRegistry) return cachedRegistry;
  const configPath = path.join(__dirname, '..', 'config', 'pre-pr-checks.json');
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    const hasAllKeys = parsed && REQUIRED_TYPE_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(parsed, key)
    );
    if (!hasAllKeys) {
      throw new Error('pre-pr-checks.json missing required top-level keys');
    }
    cachedRegistry = parsed;
  } catch (e) {
    cachedRegistry = DEFAULT_CHECKS;
  }
  return cachedRegistry;
}

// PURE: inspects manifest file PRESENCE only, in fixed ORDERED_TYPES order.
// Never reads manifest CONTENT to synthesize commands (content-firewall).
// Returns the union of ALL matching types, never just the first match.
function detectProjectTypes(cwd) {
  const registry = loadRegistry();
  const detected = [];
  for (const type of ORDERED_TYPES) {
    try {
      const typeConfig = registry[type] || DEFAULT_CHECKS[type];
      const manifest = (typeConfig && typeConfig.manifest) || DEFAULT_CHECKS[type].manifest;
      if (manifest && fs.existsSync(path.join(cwd, manifest))) {
        detected.push(type);
      }
    } catch (e) {
      // A filesystem error checking one manifest must never block checking
      // the others -- skip and continue.
    }
  }
  return detected;
}

// Never throws. Returns pkg.scripts if it is a plain object, else {}.
function getDeclaredNodeScripts(cwd) {
  try {
    const content = fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null && !Array.isArray(pkg.scripts)) {
      return pkg.scripts;
    }
    return {};
  } catch (e) {
    return {};
  }
}

// ONLY scripts ACTUALLY declared in package.json's scripts object become
// checks -- never synthesizes a check for an undeclared script.
function checksForNode(cwd, typeConfig) {
  const scripts = getDeclaredNodeScripts(cwd);
  const scriptChecks = (typeConfig && typeConfig.script_checks) || ['test', 'lint', 'build'];
  const checks = [];
  for (const scriptName of scriptChecks) {
    if (Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
      checks.push({ id: 'node-' + scriptName, command: 'npm run ' + scriptName, required: true });
    }
  }
  return checks;
}

// Best-effort "tests-if-discoverable" helper for the unknown-type degraded
// path. Never throws -- any fs error or non-match yields null.
function discoverMakeTestCommand(cwd) {
  try {
    const makefilePath = path.join(cwd, 'Makefile');
    if (!fs.existsSync(makefilePath)) return null;
    const content = fs.readFileSync(makefilePath, 'utf-8');
    if (/^test:/m.test(content)) {
      return { id: 'make-test-discovered', command: 'make test', required: false };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Main derivation entry point -- PURE with respect to process execution
// (reads the filesystem, never spawns/executes any derived check command).
// Never throws regardless of input.
function deriveCheckSet(cwd) {
  try {
    const registry = loadRegistry();
    const types = detectProjectTypes(cwd);

    if (types.length === 0) {
      const unknownEntry = registry.unknown || DEFAULT_CHECKS.unknown;
      const checks = (unknownEntry.checks || DEFAULT_CHECKS.unknown.checks).slice();
      const discovered = discoverMakeTestCommand(cwd);
      if (discovered) checks.push(discovered);
      return {
        checks,
        degraded: true,
        notice: 'No recognized manifest file found (package.json/pyproject.toml/go.mod/Cargo.toml). Falling back to minimal universal checks -- add a manifest file for project-specific checks.',
        detected_types: [],
      };
    }

    let checks = [];
    for (const type of types) {
      const typeConfig = registry[type] || DEFAULT_CHECKS[type];
      if (type === 'node') {
        checks = checks.concat(checksForNode(cwd, typeConfig));
      } else {
        checks = checks.concat(typeConfig.checks || DEFAULT_CHECKS[type].checks || []);
      }
    }
    return { checks, degraded: false, notice: null, detected_types: types };
  } catch (e) {
    // Defensive last resort -- never throw, always degrade gracefully.
    return {
      checks: DEFAULT_CHECKS.unknown.checks.slice(),
      degraded: true,
      notice: 'No recognized manifest file found (package.json/pyproject.toml/go.mod/Cargo.toml). Falling back to minimal universal checks -- add a manifest file for project-specific checks.',
      detected_types: [],
    };
  }
}

module.exports = {
  loadRegistry,
  detectProjectTypes,
  getDeclaredNodeScripts,
  checksForNode,
  discoverMakeTestCommand,
  deriveCheckSet,
  DEFAULT_CHECKS,
  ORDERED_TYPES,
};
