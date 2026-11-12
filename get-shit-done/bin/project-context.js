/**
 * project-context.js — agnostic-M-01
 *
 * Project context fields carried by `init` results (brief and stack profile
 * locations, stack commands, owner title) and the presets a new project can
 * start from. The profile is read through project-profile.js; a broken config
 * yields nulls, never a throw.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadProfile, getProfileValue, validateProfile, KNOWN_CAPABILITY_KEYS } = require('./project-profile.js');

const BRIEF_REL = '.planning/PRODUCT-BRIEF.md';
const ROOT_BRIEF_REL = 'PRODUCT-BRIEF.md';
const PROFILE_REL = '.planning/STACK-PROFILE.md';
const NOT_A_PRESET = 'packs';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readProfile(cwd) {
  try {
    return loadProfile(cwd);
  } catch {
    return { found: false, error: 'unreadable', project: undefined, stack: undefined };
  }
}

// Present = a regular file with at least one non-whitespace character; a directory, empty or whitespace-only file is missing.
function isPresent(file) {
  try {
    return fs.statSync(file).isFile() && /\S/.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

// 'legacy': no plain-object stack.capabilities (or unreadable config). 'none': plain object whose keys are all
// known and none is ui_qa. 'capable': ui_qa present with any value, or any unknown key (fails closed).
function uiQaMode(cwd) {
  const profile = readProfile(cwd);
  if (profile.error) return 'legacy';
  const capabilities = profile.stack?.capabilities;
  if (!isPlainObject(capabilities)) return 'legacy';
  const keys = Object.keys(capabilities);
  const known = keys.every((k) => KNOWN_CAPABILITY_KEYS.includes(k));
  return known && !keys.includes('ui_qa') ? 'none' : 'capable';
}

function substituteRoot(commands, cwd) {
  if (typeof commands !== 'object' || commands === null || Array.isArray(commands)) return null;
  return Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      typeof command === 'string' ? command.split('{root}').join(cwd) : command,
    ]),
  );
}

const ALWAYS_RISK = ['auth', 'security'];

function mergeDomains(always, listed) {
  const seen = new Set();
  return [...always, ...(Array.isArray(listed) ? listed : [])].filter((d) => {
    if (typeof d !== 'string' || d.trim() === '') return false;
    const key = d.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Auth and security are always risk domains; the brief's list is appended. No list: every state mutation is risk-domain.
function effectiveRiskDomains(profile) {
  const listed = mergeDomains([], profile?.project?.risk_domains);
  const source = listed.length > 0 ? 'brief' : 'builtin';
  return {
    risk_domains: mergeDomains(ALWAYS_RISK, listed),
    risk_domains_source: source,
    all_state_mutating: source === 'builtin',
  };
}

const riskDomainsFor = (cwd) => effectiveRiskDomains(readProfile(cwd)).risk_domains;

function contextFields(cwd) {
  const profile = readProfile(cwd);
  const briefExists = isPresent(path.join(cwd, BRIEF_REL));
  const profileExists = isPresent(path.join(cwd, PROFILE_REL));
  const title = getProfileValue(profile, 'project.owner_title');
  return {
    brief_path: briefExists ? BRIEF_REL : null,
    stack_profile_path: profileExists ? PROFILE_REL : null,
    brief_exists: briefExists,
    stack_profile_exists: profileExists,
    stack_commands: substituteRoot(getProfileValue(profile, 'stack.commands'), cwd),
    owner_title: typeof title === 'string' ? title : null,
    ...effectiveRiskDomains(profile),
    ruling_topics: mergeDomains(ALWAYS_RISK, profile.project?.ruling_topics),
  };
}

function availablePresets(presetsRoot) {
  let entries;
  try {
    entries = fs.readdirSync(presetsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== NOT_A_PRESET && fs.existsSync(path.join(presetsRoot, e.name, 'preset.json')))
    .map((e) => e.name)
    .sort();
}

// A root-level PRODUCT-BRIEF.md can be adopted into .planning/ while the .planning/ one is absent.
const adoptableBrief = (cwd) => isPresent(path.join(cwd, ROOT_BRIEF_REL)) && !isPresent(path.join(cwd, BRIEF_REL))
  ? { from: ROOT_BRIEF_REL, to: BRIEF_REL }
  : null;

// Copy-if-absent, never overwrite: wx fails on an existing destination (even an empty one).
function adoptBrief(cwd) {
  const adoptable = adoptableBrief(cwd);
  if (adoptable === null) return { ok: true, adopted: false, reason: 'nothing to adopt' };
  try {
    fs.mkdirSync(path.join(cwd, '.planning'), { recursive: true });
    fs.copyFileSync(path.join(cwd, adoptable.from), path.join(cwd, adoptable.to), fs.constants.COPYFILE_EXCL);
    return { ok: true, adopted: true, ...adoptable };
  } catch (e) {
    return { ok: false, adopted: false, ...adoptable, reason: e.code === 'EEXIST' ? 'destination exists' : e.message };
  }
}

function contextGate(cwd, { legacy }) {
  const report = validateProfile(readProfile(cwd));
  const absent = [BRIEF_REL, PROFILE_REL].filter((rel) => !isPresent(path.join(cwd, rel)));
  const missing = [...absent, ...report.missing];
  const invalid = report.invalid;
  return {
    ok: legacy === true || (missing.length === 0 && invalid.length === 0),
    legacy: legacy === true,
    missing,
    invalid,
    adoptable: { brief: adoptableBrief(cwd) },
  };
}

function gateFailure(gate) {
  return {
    error: 'project_context_missing',
    missing: gate.missing,
    invalid: gate.invalid,
    hint: 'run /gsd:init-project, or pass --legacy to this init call; --legacy does not reach spawned agents or other processes, so export GSD_LEGACY=1 for those',
  };
}

function gateStderr(gate) {
  const keys = [...gate.missing, ...gate.invalid.map((p) => p.key)];
  return `project_context_missing: ${keys.join(', ')}; run /gsd:init-project, pass --legacy to this init call, or export GSD_LEGACY=1 (the flag does not reach spawned agents)`;
}

module.exports = { contextFields, effectiveRiskDomains, riskDomainsFor, availablePresets, adoptBrief, contextGate, gateFailure, gateStderr, uiQaMode };
