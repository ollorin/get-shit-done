#!/usr/bin/env node

/**
 * GSD Tools — CLI utility for GSD workflow operations
 *
 * Replaces repetitive inline bash patterns across ~50 GSD command/workflow/agent files.
 * Centralizes: config parsing, model resolution, phase lookup, git commits, summary verification.
 *
 * Usage: node gsd-tools.js <command> [args] [--raw]
 *
 * Atomic Commands:
 *   state load                         Load project config + state
 *   state update <field> <value>       Update a STATE.md field
 *   state get [section]                Get STATE.md content or section
 *   state patch --field val ...        Batch update STATE.md fields
 *   resolve-model <agent-type>         Get model for agent based on profile
 *   find-phase <phase>                 Find phase directory by number
 *   commit <message> [--files f1 f2] [--trailer "Token: value"]...   Commit planning docs
 *   verify-summary <path>              Verify a SUMMARY.md file
 *   generate-slug <text>               Convert text to URL-safe slug
 *   current-timestamp [format]         Get timestamp (full|date|filename)
 *   list-todos [area]                  Count and enumerate pending todos
 *   verify-path-exists <path>          Check file/directory existence
 *   config-ensure-section              Initialize .planning/config.json
 *   history-digest                     Aggregate all SUMMARY.md data
 *   summary-extract <path> [--fields]  Extract structured data from SUMMARY.md
 *   state-snapshot                     Structured parse of STATE.md
 *   phase-plan-index <phase>           Index plans with waves and status
 *   websearch <query>                  Search web via Brave API (if configured)
 *     [--limit N] [--freshness day|week|month]
 *
 * Phase Operations:
 *   phase next-decimal <phase>         Calculate next decimal phase number
 *   phase add <description>            Append new phase to roadmap + create dir
 *   phase insert <after> <description> Insert decimal phase after existing
 *   phase remove <phase> [--force]     Remove phase, renumber all subsequent
 *   phase complete <phase>             Mark phase done, update state + roadmap
 *
 * Roadmap Operations:
 *   roadmap get-phase <phase>          Extract phase section from ROADMAP.md
 *   roadmap analyze                    Full roadmap parse with disk status
 *   roadmap update-plan-progress <N>   Update progress table row from disk (PLAN vs SUMMARY counts)
 *
 * Requirements Operations:
 *   requirements mark-complete <ids>   Mark requirement IDs as complete in REQUIREMENTS.md
 *
 * Milestone Operations:
 *   milestone complete <version>       Archive milestone, create MILESTONES.md
 *     [--name <name>]
 *   milestone summarize <version>      Generate {version}-SUMMARY.md (one-liner per phase,
 *     [--phases N-M]                   plan count, duration, key decisions)
 *   milestone archive-phases <version> Move completed phase dirs to milestones/{version}/phases/
 *     [--phases N-M] [--dry-run]
 * Validation:
 *   validate consistency               Check phase numbering, disk/roadmap sync
 *
 * Progress:
 *   progress [json|table|bar]          Render progress in various formats
 *
 * Todos:
 *   todo complete <filename>           Move todo from pending to completed
 *
 * Scaffolding:
 *   scaffold context --phase <N>       Create CONTEXT.md template
 *   scaffold uat --phase <N>           Create UAT.md template
 *   scaffold verification --phase <N>  Create VERIFICATION.md template
 *   scaffold phase-dir --phase <N>     Create phase directory
 *     --name <name>
 *
 * Frontmatter CRUD:
 *   frontmatter get <file> [--field k] Extract frontmatter as JSON
 *   frontmatter set <file> --field k   Update single frontmatter field
 *     --value jsonVal
 *   frontmatter merge <file>           Merge JSON into frontmatter
 *     --data '{json}'
 *   frontmatter validate <file>        Validate required fields
 *     --schema plan|summary|verification
 *
 * Verification Suite:
 *   verify plan-structure <file>       Check PLAN.md structure + tasks (tdd/ui-qa gates; exits 1 on error)
 *   verify phase-completeness <phase>  Check all plans have summaries
 *   verify references <file>           Check @-refs + paths resolve
 *   verify commits <h1> [h2] ...      Batch verify commit hashes
 *   verify artifacts <plan-file>       Check must_haves.artifacts
 *   verify key-links <plan-file>       Check must_haves.key_links
 *   verify migration-timestamps         Scan migrations/ for duplicate timestamps; auto-resolve by rename
 *   verify phase-gate <phase> [--pre-verifier]  (--pre-verifier: skip verification+ui_qa artifacts the verifier writes)
 *   verify phase-gate <phase>          Deterministic 5-artifact phase gate (test/ui_qa/docs/
 *                                       e2e_plan/verification); honors DEFERRED.json waivers; exits
 *                                       1 on failed checks, 2 on malformed plan/waiver data
 *   deferred add <phase> --step X       Append a waiver entry to DEFERRED.json (the ONLY sanctioned
 *     --reason Y --approver Z            way to satisfy a phase-gate check without the real artifact);
 *     [--plan M]                         fires a best-effort Telegram notification; exits 2 if the
 *                                       existing DEFERRED.json is malformed (refuses to overwrite)
 *   deferred list <phase>              List waiver entries for a phase; exits 2 (not empty array) if
 *                                       DEFERRED.json is malformed
 *   execution-state record-failure     Increment the retry counter for a phase (+ optional plan) in
 *     --phase N [--plan M]               .planning/execution-state.json; returns {action: retry|debug|
 *     --error "msg" --step "..."         escalate} based on attempts vs config-driven max_attempts
 *     --files "a,b,c"                    (default 4); exits 2 if execution-state.json is malformed
 *   execution-state record-success     Clear the retry counter for a phase (+ optional plan); no-op
 *     --phase N [--plan M]               (not an error) if no entry existed; exits 2 if malformed
 *   execution-state get                Read-only lookup; returns {attempts: 0, key} if no entry exists
 *     --phase N [--plan M]               (a valid default, not an error); exits 2 if malformed
 *
 * Template Fill:
 *   template fill summary --phase N    Create pre-filled SUMMARY.md
 *     [--plan M] [--name "..."]
 *     [--fields '{json}']
 *   template fill plan --phase N       Create pre-filled PLAN.md
 *     [--plan M] [--type execute|tdd]
 *     [--wave N] [--fields '{json}']
 *   template fill verification         Create pre-filled VERIFICATION.md
 *     --phase N [--fields '{json}']
 *
 * State Progression:
 *   state advance-plan                 Increment plan counter
 *   state record-metric --phase N      Record execution metrics
 *     --plan M --duration Xmin
 *     [--tasks N] [--files N]
 *   state update-progress              Recalculate progress bar
 *   state add-decision --summary "..."  Add decision to STATE.md
 *     [--phase N] [--rationale "..."]
 *   state add-blocker --text "..."     Add blocker
 *   state resolve-blocker --text "..." Remove blocker
 *   state record-session               Update session continuity
 *     --stopped-at "..."
 *     [--resume-file path]
 *
 * Quota Operations:
 *   quota status                       Show current quota usage
 *   quota status-bar [--json]          Format status bar string
 *   quota stats [--table]              Show detailed session statistics
 *   quota record <id> <model>          Record task usage
 *     <tokens_in> <tokens_out>
 *   quota reset                        Reset quota state
 *   quota update-from-headers <json>   Update from API headers
 *   quota check                        Check warnings and wait status
 *   quota wait                         Check if should wait for quota
 *
 * Resilience Operations (coordinator + executor death/recovery — see
 * get-shit-done/references/resilience.md for the full protocol):
 *   resilience check-staleness <file>  Report whether a checkpoint file's
 *     [--threshold-minutes N]            mtime exceeds the staleness threshold
 *   resilience parse-death --text ..   Detect a session/usage/quota/rate-limit
 *                                         death message, extract reset time
 *   resilience resume-brief <phase>    Assemble a resume brief from a phase's
 *                                         CHECKPOINT.json for a respawned agent
 *   resilience estimate-quota          Estimate token cost of N remaining
 *     [--phases N]                       phases against the current quota budget
 *   resilience usage-window            Sum actual token usage across all
 *     [--hours N]                        ~/.claude/projects/ transcripts in
 *                                         the last N hours (default 5) — an
 *                                         ESTIMATE, not a billed-usage source of truth
 *
 * Knowledge Operations:
 *   knowledge status [--scope project|global]   Show knowledge DB status
 *   knowledge add <content> --type <type>       Add knowledge entry
 *     [--scope project|global]
 *     [--ttl permanent|long_term|short_term|ephemeral]
 *   knowledge search <query>                    Search knowledge
 *     [--scope project|global] [--limit N]
 *   knowledge get <id> [--scope project|global] Get knowledge by ID
 *   knowledge delete <id>                       Delete knowledge entry
 *     [--scope project|global]
 *   knowledge cleanup [--scope project|global]  Remove expired entries
 *   knowledge prune [--dry-run]                  Prune stale low-utility entries
 *     [--scope project|global]
 *     [--threshold N]                            Staleness threshold 0.0-1.0 (default 0.7)
 *   knowledge stats [--scope project|global]    Show access statistics
 *
 * Session Analysis:
 *   analyze-session <path>                      Prepare session for Haiku analysis
 *   historical-extract <path>                   Extract knowledge from existing project
 *   analysis-status                             Show analysis statistics
 *   list-pending-sessions                       Find sessions awaiting Haiku analysis
 *   store-analysis-result <id> <json>           Store Haiku extraction results
 *   mine-conversations                          Discover and prepare conversation mining
 *     [--max-age-days N] [--include-subagents] [--limit N] [--all-projects]
 *   store-conversation-result <id> <json>       Store conversation mining results
 *     [--content-hash <hash>]
 *   migrate-knowledge                           Migrate per-project DBs to global DB
 *   query-knowledge <question> [--project <slug>]  Search global knowledge DB (top 5 JSON)
 *
 * Compound Commands (workflow-specific initialization):
 *   init execute-phase <phase>         All context for execute-phase workflow
 *   init plan-phase <phase>            All context for plan-phase workflow
 *   init new-project                   All context for new-project workflow
 *   init new-milestone                 All context for new-milestone workflow
 *   init quick <description>           All context for quick workflow
 *   init resume                        All context for resume-project workflow
 *   init verify-work <phase>           All context for verify-work workflow
 *   init phase-op <phase>              Generic phase operation context
 *   init todos [area]                  All context for todo workflows
 *   init milestone-op                  All context for milestone operations
 *   init map-codebase                  All context for map-codebase workflow
 *   init progress                      All context for progress workflow
 *
 * Service Health:
 *   service-health start <name>        Start named server from stack.services (profile), else dev_servers (config);
 *     [--raw]                          poll health endpoint until ready or 60s timeout
 *   service-health stop <name>         Stop named server by PID; SIGTERM then SIGKILL after 5s
 *   service-health status <name>       Check if named server is running (JSON output)
 *   service-health start-all           Start all servers in stack.services and dev_servers
 *   service-health stop-all            Stop all running servers (by PID files)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { EVENT_TYPES, appendEvent, getHistory, getCurrentPhase, getExecutionStats } = require('./execution-log.js');
const { parseRoadmap, buildDAG, getExecutionOrder, detectParallelOpportunities } = require('./roadmap-parser.js');
const { TokenBudgetMonitor } = require('./token-monitor.js');
const { FailureHandler, executeWithRetry } = require('./failure-handler.js');
const { CompletionSignal, COMPLETION_STATUS } = require('./completion-signal.js');
const { TaskChunker, BatchCoordinator, analyzeTask, estimateTaskTokens } = require('./task-chunker.js');
const { estimatePhaseSize, detectOversizedPhases, recommendSplit, validateSplitPreservesDependencies, LIMITS: PHASE_LIMITS } = require('./phase-sizer.js');
const evalHarness = require('./eval-harness.js');
const promptBudget = require('./prompt-budget.js');
const promptOptimize = require('./prompt-optimize.js');
const { getNextTier, getTiers } = require('./model-registry.js');
const { deriveCheckSet } = require('./pre-pr-checks.js');
const projectProfile = require('./project-profile.js');
const projectDeploy = require('./project-deploy.js');
const projectRegistry = require('./project-registry.js');
const projectPack = require('./project-pack.js');
const projectContext = require('./project-context.js');
const { resolveAutoMode } = require('./auto-mode.js');
const dispatch = require('./roadmap-dispatch.js');
const ownerGates = require('./owner-gates.js');
const autoModeFields = (cwd) => resolveAutoMode(cwd, process.argv.slice(2), process.env);
const rigour = require('./rigour.js');
const topModel = require('./top-model.js');
const phaseBudget = require('./phase-budget.js');
const formCheck = require('./form-check.js');
const reviewGate = require('./review-gate.js');
const spikeCheck = require('./spike-check.js');
const roadmapBox = require('./roadmap-box.js');
const planStamp = require('./plan-stamp.js');

// Phase 2: Auto Mode safety modules (lazy — gracefully absent if not installed)
let circuitBreaker, validator, escalation, feedback, learning;
try { circuitBreaker = require('./gsd-circuit-breaker'); } catch (e) { circuitBreaker = null; }
try { validator = require('./gsd-validator'); } catch (e) { validator = null; }
try { escalation = require('./gsd-escalation'); } catch (e) { escalation = null; }
try { feedback = require('./gsd-feedback'); } catch (e) { feedback = null; }
try { learning = require('./gsd-learning'); } catch (e) { learning = null; }

// Load environment variables from project root .env
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

// ─── Role model table ────────────────────────────────────────────────────────
// One model per role. The planner and verifier run on the configured top model (resolveModelInternal).

const ROLE_MODELS = {
  'gsd-roadmapper': 'sonnet',
  'gsd-executor': 'haiku',
  'gsd-phase-researcher': 'sonnet',
  'gsd-project-researcher': 'sonnet',
  'gsd-research-synthesizer': 'sonnet',
  'gsd-debugger': 'sonnet',
  'gsd-codebase-mapper': 'haiku',
  'gsd-plan-checker': 'sonnet',
  'gsd-test-writer': 'sonnet',
  'gsd-docs-updater': 'haiku',
  'gsd-phase-coordinator': 'sonnet',
  'gsd-integration-checker': 'sonnet',
};

// ─── Shared File-Pattern Constants ───────────────────────────────────────────
// Hoisted from cmdVerifyPlanStructure (Phase 44) so cmdVerifyPhaseGate (Phase 45)
// can reuse the exact same UI/API file-classification rules without duplicating
// the pattern lists. Behavior for existing plan-structure checks is unchanged.

const UI_FILE_PATTERNS = ['.tsx', '.jsx', '.vue', '.svelte', '.astro', '.mdx'];
const API_FILE_PATTERNS = ['route.ts', 'route.js', '/api/', '/routes/', '/functions/', 'controller.ts', 'controller.js', 'handler.ts', 'handler.js'];

// ─── Diff-Based HAS_UI Detection (Phase 45-02) ───────────────────────────────
// isUIFile/computeHasUI are pure functions -- no I/O, no SUMMARY.md read --
// so HAS_UI is always derived from the actual git diff (touchedFiles), never
// from self-reported SUMMARY.md key-files metadata. See 45-02-PLAN.md.

function isUIFile(filePath) {
  const isConfigOrDeclaration = /\.(config|d)\.[jt]sx?$/.test(filePath) ||
    /^(vite|next|tailwind|jest|vitest|webpack|babel|eslint|prettier)\./.test(path.basename(filePath));
  if (isConfigOrDeclaration) return false;
  if (UI_FILE_PATTERNS.some(ext => filePath.endsWith(ext))) return true;
  const isRoutePath = /(^|\/)(app|pages|routes)\//.test(filePath);
  const isApiPath = /(^|\/)api\//.test(filePath);
  // Plain script/data files under a route dir are endpoints or helpers, not UI; only markup-like files count.
  const isScriptOrData = /\.(ts|js|mjs|cjs|json)$/.test(filePath);
  if (isRoutePath && !isApiPath && !isScriptOrData) {
    // A route-directory file with a non-standard-UI extension (rare -- most
    // route files already carry a UI extension caught above). Still excludes
    // api/ sub-paths and config/declaration files handled above.
    return true;
  }
  return false;
}

function computeHasUI(touchedFiles) {
  return touchedFiles.some(isUIFile);
}

// Server endpoints whose behaviour a UI QA run exercises through the UI.
const GENERIC_API_PATTERNS = [
  /(^|\/)(app|pages)\/api\//,
];
// Legacy-project API patterns, applied only without a stack profile (uiQaMode 'legacy').
const LEGACY_API_PATTERNS = [
  /^apps\/api\/functions\//,
  /(^|\/)supabase\/functions\//,
];

// Glob subset for stack.paths.api_globs: ** (any depth), * (one segment), ? (one char).
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

// opts: { legacy: boolean (default true), apiGlobs: string[] }. The default keeps the legacy behaviour.
function isApiFile(filePath, opts = {}) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (isTestOrSpecFile(filePath) || /\.md$/i.test(filePath)) return false;
  const legacy = opts.legacy !== false;
  const globs = Array.isArray(opts.apiGlobs) ? opts.apiGlobs : [];
  return GENERIC_API_PATTERNS.some(re => re.test(filePath))
    || (legacy && LEGACY_API_PATTERNS.some(re => re.test(filePath)))
    || globs.some(g => typeof g === 'string' && globToRegExp(g).test(filePath));
}

function computeHasApi(touchedFiles, opts = {}) {
  return touchedFiles.some(f => isApiFile(f, opts));
}

function apiDetectionOpts(cwd) {
  const loaded = projectProfile.loadProfile(cwd);
  const globs = loaded.error ? undefined : projectProfile.getProfileValue(loaded, 'stack.paths.api_globs');
  return { legacy: projectContext.uiQaMode(cwd) === 'legacy', apiGlobs: Array.isArray(globs) ? globs : [] };
}

// ─── Source-Touch Detection (Phase 59-02, MILE-37) ──────────────────────────
// isSourceFile/computeTouchesSourceCode are pure functions -- no I/O -- gating the new
// post-task gsd-test-writer spawn point in executor-detail.md. Mirrors isUIFile/
// computeHasUI's pure extension+path-pattern style exactly (Phase 45-02): derived only
// from a passed-in file list, never from a SUMMARY.md self-report.
const SOURCE_FILE_EXTENSIONS = ['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rb'];

function isTestOrSpecFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const base = path.basename(filePath);
  if (/\.(test|spec)\.[a-zA-Z0-9]+$/.test(base)) return true;
  if (/(^|\/)(test|tests|__tests__|spec)\//.test(filePath)) return true;
  return false;
}

function isSourceFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (isTestOrSpecFile(filePath)) return false;
  return SOURCE_FILE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

function computeTouchesSourceCode(fileList) {
  const files = Array.isArray(fileList) ? fileList : [];
  return files.some(isSourceFile);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseIncludeFlag(args) {
  const includeIndex = args.indexOf('--include');
  if (includeIndex === -1) return new Set();
  const includeValue = args[includeIndex + 1];
  if (!includeValue) return new Set();
  return new Set(includeValue.split(',').map(s => s.trim()));
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// Shared JSON.parse guard: never throws. Returns { ok: true, value } on success
// or { ok: false, error: { error: true, type: 'corrupted_state', context, message } }
// on failure. Use at every call site that parses external/user/file input with
// no surrounding try/catch (do NOT use for JSON.parse(JSON.stringify(...)) idioms
// or sites already wrapped in their own try/catch).
function safeJsonParse(content, contextLabel) {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (e) {
    return { ok: false, error: { error: true, type: 'corrupted_state', context: contextLabel, message: e.message } };
  }
}

// Atomic write-temp-then-rename helper. Guarantees a write to targetPath is
// either fully complete or fully absent -- never torn/partial -- because
// fs.renameSync is atomic on POSIX for same-filesystem renames (the temp file
// is created in the same directory as the target). This does NOT implement
// cross-process locking; it only guarantees each individual write is
// complete-or-absent. Use for every STATE.md/ROADMAP.md/config.json write.
function atomicWriteFileSync(targetPath, content) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, targetPath);
  } catch (e) {
    try { fs.unlinkSync(tempPath); } catch (_) { /* tempPath may not exist yet */ }
    throw new Error(`Atomic write failed for ${targetPath}: ${e.message}`);
  }
}

function loadConfig(cwd) {
  const configPath = path.join(cwd, '.planning', 'config.json');
  const defaults = {
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'phase-{phase}-{slug}',
    milestone_branch_template: 'feature/{slug}',
    research: true,
    plan_checker: true,
    verifier: true,
    parallelization: true,
    nyquist_validation: true,
    granularity: 'standard',
    brave_search: false,
    auto_mine: true,
    auto_consolidate: true,
    max_attempts: 4,
    execution: { max_attempts: 4 },
    staleness_threshold_minutes: 30,
    usage_pause_threshold_tokens: null,
    resilience: { staleness_threshold_minutes: 30, usage_pause_threshold_tokens: null },
    savings_baseline_tier: 'opus',
    savings: { baseline_tier: 'opus' },
    test_writer_enabled: false,
    quality: {
      test_writer: false,
    },
  };

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Migrate deprecated "depth" key to "granularity"
    if ('depth' in parsed && !('granularity' in parsed)) {
      const depthToGranularity = { quick: 'coarse', standard: 'standard', comprehensive: 'fine' };
      parsed.granularity = depthToGranularity[parsed.depth] || parsed.depth;
      delete parsed.depth;
      try { atomicWriteFileSync(configPath, JSON.stringify(parsed, null, 2)); } catch (e) { console.warn(`Warning: failed to persist config migration: ${e.message}`); }
    }

    const get = (key, nested) => {
      if (parsed[key] !== undefined) return parsed[key];
      if (nested && parsed[nested.section] && parsed[nested.section][nested.field] !== undefined) {
        return parsed[nested.section][nested.field];
      }
      return undefined;
    };

    const parallelization = (() => {
      const val = get('parallelization');
      if (typeof val === 'boolean') return val;
      if (typeof val === 'object' && val !== null && 'enabled' in val) return val.enabled;
      return defaults.parallelization;
    })();

    return {
      commit_docs: get('commit_docs', { section: 'planning', field: 'commit_docs' }) ?? defaults.commit_docs,
      search_gitignored: get('search_gitignored', { section: 'planning', field: 'search_gitignored' }) ?? defaults.search_gitignored,
      branching_strategy: get('branching_strategy', { section: 'git', field: 'branching_strategy' }) ?? defaults.branching_strategy,
      phase_branch_template: get('phase_branch_template', { section: 'git', field: 'phase_branch_template' }) ?? defaults.phase_branch_template,
      milestone_branch_template: get('milestone_branch_template', { section: 'git', field: 'milestone_branch_template' }) ?? defaults.milestone_branch_template,
      research: get('research', { section: 'workflow', field: 'research' }) ?? defaults.research,
      plan_checker: get('plan_checker', { section: 'workflow', field: 'plan_check' }) ?? defaults.plan_checker,
      verifier: get('verifier', { section: 'workflow', field: 'verifier' }) ?? defaults.verifier,
      parallelization,
      nyquist_validation: get('nyquist_validation', { section: 'workflow', field: 'nyquist_validation' }) ?? defaults.nyquist_validation,
      granularity: get('granularity') ?? defaults.granularity,
      brave_search: get('brave_search') ?? defaults.brave_search,
      auto_mine: get('auto_mine') ?? defaults.auto_mine,
      auto_consolidate: get('auto_consolidate') ?? defaults.auto_consolidate,
      max_attempts: get('max_attempts', { section: 'execution', field: 'max_attempts' }) ?? defaults.max_attempts,
      staleness_threshold_minutes: get('staleness_threshold_minutes', { section: 'resilience', field: 'staleness_threshold_minutes' }) ?? defaults.staleness_threshold_minutes,
      usage_pause_threshold_tokens: get('usage_pause_threshold_tokens', { section: 'resilience', field: 'usage_pause_threshold_tokens' }) ?? defaults.usage_pause_threshold_tokens,
      savings_baseline_tier: get('savings_baseline_tier', { section: 'savings', field: 'baseline_tier' }) ?? defaults.savings_baseline_tier,
      test_writer_enabled: get('test_writer_enabled', { section: 'quality', field: 'test_writer' }) ?? defaults.test_writer_enabled,
      coordinator_model: get('coordinator_model') ?? null,
      ruling_model: get('ruling_model') ?? null,
      dev_servers: parsed.dev_servers || null,
    };
  } catch (e) {
    // Only suppress file-not-found; surface parse errors so broken config is visible
    if (e.code === 'ENOENT') return defaults;
    process.stderr.write('Warning: config.json parse error: ' + e.message + '\n');
    return defaults;
  }
}

function isGitIgnored(cwd, targetPath) {
  try {
    // git check-ignore exits non-zero when the path is NOT ignored — execFileSync
    // throws on non-zero exit, so the catch branch preserves that boolean logic.
    execFileSync('git', ['check-ignore', '-q', '--', targetPath], {
      cwd,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function execGit(cwd, args) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
    };
  }
}

function normalizePhaseName(phase) {
  const match = phase.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return phase;
  const num = match[1];
  const parts = num.split('.');
  const padded = parts[0].padStart(2, '0');
  return parts.length > 1 ? `${padded}.${parts[1]}` : padded;
}

function extractFrontmatter(content) {
  const frontmatter = {};
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) return frontmatter;

  const yaml = match[1];
  const lines = yaml.split('\n');

  // Stack to track nested objects: [{obj, key, indent}]
  // obj = object to write to, key = current key collecting array items, indent = indentation level
  let stack = [{ obj: frontmatter, key: null, indent: -1 }];

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') continue;

    // Calculate indentation (number of leading spaces)
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // Pop stack back to appropriate level
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];

    // Check for key: value pattern
    const keyMatch = line.match(/^(\s*)([a-zA-Z0-9_-]+):\s*(.*)/);
    if (keyMatch) {
      const key = keyMatch[2];
      const value = keyMatch[3].trim();

      if (value === '' || value === '[') {
        // Key with no value or opening bracket — could be nested object or array
        // We'll determine based on next lines, for now create placeholder
        current.obj[key] = value === '[' ? [] : {};
        current.key = null;
        // Push new context for potential nested content
        stack.push({ obj: current.obj[key], key: null, indent });
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array: key: [a, b, c]
        current.obj[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        current.key = null;
      } else {
        // Simple key: value
        current.obj[key] = value.replace(/^["']|["']$/g, '');
        current.key = null;
      }
    } else if (line.trim().startsWith('- ')) {
      // Array item
      const itemValue = line.trim().slice(2).replace(/^["']|["']$/g, '');

      // If current context is an empty object, convert to array
      if (typeof current.obj === 'object' && !Array.isArray(current.obj) && Object.keys(current.obj).length === 0) {
        // Find the key in parent that points to this object and convert it
        const parent = stack.length > 1 ? stack[stack.length - 2] : null;
        if (parent) {
          for (const k of Object.keys(parent.obj)) {
            if (parent.obj[k] === current.obj) {
              parent.obj[k] = [itemValue];
              current.obj = parent.obj[k];
              break;
            }
          }
        }
      } else if (Array.isArray(current.obj)) {
        current.obj.push(itemValue);
      }
    }
  }

  return frontmatter;
}

function reconstructFrontmatter(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (value.every(v => typeof v === 'string') && value.length <= 3 && value.join(', ').length < 60) {
        lines.push(`${key}: [${value.join(', ')}]`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${typeof item === 'string' && (item.includes(':') || item.includes('#')) ? `"${item}"` : item}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [subkey, subval] of Object.entries(value)) {
        if (subval === null || subval === undefined) continue;
        if (Array.isArray(subval)) {
          if (subval.length === 0) {
            lines.push(`  ${subkey}: []`);
          } else if (subval.every(v => typeof v === 'string') && subval.length <= 3 && subval.join(', ').length < 60) {
            lines.push(`  ${subkey}: [${subval.join(', ')}]`);
          } else {
            lines.push(`  ${subkey}:`);
            for (const item of subval) {
              lines.push(`    - ${typeof item === 'string' && (item.includes(':') || item.includes('#')) ? `"${item}"` : item}`);
            }
          }
        } else if (typeof subval === 'object') {
          lines.push(`  ${subkey}:`);
          for (const [subsubkey, subsubval] of Object.entries(subval)) {
            if (subsubval === null || subsubval === undefined) continue;
            if (Array.isArray(subsubval)) {
              if (subsubval.length === 0) {
                lines.push(`    ${subsubkey}: []`);
              } else {
                lines.push(`    ${subsubkey}:`);
                for (const item of subsubval) {
                  lines.push(`      - ${item}`);
                }
              }
            } else {
              lines.push(`    ${subsubkey}: ${subsubval}`);
            }
          }
        } else {
          const sv = String(subval);
          lines.push(`  ${subkey}: ${sv.includes(':') || sv.includes('#') ? `"${sv}"` : sv}`);
        }
      }
    } else {
      const sv = String(value);
      if (sv.includes(':') || sv.includes('#') || sv.startsWith('[') || sv.startsWith('{')) {
        lines.push(`${key}: "${sv}"`);
      } else {
        lines.push(`${key}: ${sv}`);
      }
    }
  }
  return lines.join('\n');
}

function spliceFrontmatter(content, newObj) {
  const yamlStr = reconstructFrontmatter(newObj);
  const match = content.match(/^---\n[\s\S]+?\n---/);
  if (match) {
    return `---\n${yamlStr}\n---` + content.slice(match[0].length);
  }
  return `---\n${yamlStr}\n---\n\n` + content;
}

function parseMustHavesBlock(content, blockName) {
  // Extract a specific block from must_haves in raw frontmatter YAML
  // Handles 3-level nesting: must_haves > artifacts/key_links > [{path, provides, ...}]
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!fmMatch) return [];

  const yaml = fmMatch[1];
  // Find the block (e.g., "truths:", "artifacts:", "key_links:")
  const blockPattern = new RegExp(`^\\s{4}${blockName}:\\s*$`, 'm');
  const blockStart = yaml.search(blockPattern);
  if (blockStart === -1) return [];

  const afterBlock = yaml.slice(blockStart);
  const blockLines = afterBlock.split('\n').slice(1); // skip the header line

  const items = [];
  let current = null;

  for (const line of blockLines) {
    // Stop at same or lower indent level (non-continuation)
    if (line.trim() === '') continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= 4 && line.trim() !== '') break; // back to must_haves level or higher

    if (line.match(/^\s{6}-\s+/)) {
      // New list item at 6-space indent
      if (current) items.push(current);
      current = {};
      // Check if it's a simple string item
      const simpleMatch = line.match(/^\s{6}-\s+"?([^"]+)"?\s*$/);
      if (simpleMatch && !line.includes(':')) {
        current = simpleMatch[1];
      } else {
        // Key-value on same line as dash: "- path: value"
        const kvMatch = line.match(/^\s{6}-\s+(\w+):\s*"?([^"]*)"?\s*$/);
        if (kvMatch) {
          current = {};
          current[kvMatch[1]] = kvMatch[2];
        }
      }
    } else if (current && typeof current === 'object') {
      // Continuation key-value at 8+ space indent
      const kvMatch = line.match(/^\s{8,}(\w+):\s*"?([^"]*)"?\s*$/);
      if (kvMatch) {
        const val = kvMatch[2];
        // Try to parse as number
        current[kvMatch[1]] = /^\d+$/.test(val) ? parseInt(val, 10) : val;
      }
      // Array items under a key
      const arrMatch = line.match(/^\s{10,}-\s+"?([^"]+)"?\s*$/);
      if (arrMatch) {
        // Find the last key added and convert to array
        const keys = Object.keys(current);
        const lastKey = keys[keys.length - 1];
        if (lastKey && !Array.isArray(current[lastKey])) {
          current[lastKey] = current[lastKey] ? [current[lastKey]] : [];
        }
        if (lastKey) current[lastKey].push(arrMatch[1]);
      }
    }
  }
  if (current) items.push(current);

  return items;
}

function output(result, raw, rawValue, exitCode = 0) {
  const outputStr = raw && rawValue !== undefined
    ? String(rawValue)
    : JSON.stringify(result, null, 2);

  // For large outputs piped to another process, use a temp file to avoid
  // pipe buffer limits causing data truncation
  const LARGE_OUTPUT_THRESHOLD = 100 * 1024; // 100KB

  if (outputStr.length > LARGE_OUTPUT_THRESHOLD && !process.stdout.isTTY) {
    // Large output being piped - use temp file to prevent truncation
    const os = require('os');
    const tempFile = path.join(os.tmpdir(), `gsd-output-${process.pid}.json`);

    try {
      fs.writeFileSync(tempFile, outputStr, 'utf-8');
      // Read the file back and write directly to stdout - avoids buffer limits
      // without shelling out to `cat` for a known local file. Uses a blocking
      // fs.writeSync loop (not process.stdout.write, which is async on pipes
      // and can be truncated by the process.exit(0) below before it flushes).
      writeStdoutSync(fs.readFileSync(tempFile, 'utf-8'));
      // Clean up temp file
      fs.unlinkSync(tempFile);
    } catch (err) {
      // Fallback to direct write if temp file approach fails
      writeStdoutSync(outputStr);
    }
  } else {
    // Normal sized output or terminal output - write directly
    writeStdoutSync(outputStr);
  }

  process.exit(exitCode);
}

// Synchronous, complete write to stdout (fd 1). process.stdout.write() is
// asynchronous when stdout is a pipe, so an immediately-following
// process.exit(0) can truncate output before the OS write completes.
// fs.writeSync blocks until the data is actually written, looping to handle
// partial writes. When stdout is a non-blocking pipe with a full buffer,
// fs.writeSync throws EAGAIN instead of blocking — retry with a brief
// synchronous pause until the reader drains the pipe.
function writeStdoutSync(content) {
  const buffer = Buffer.from(content, 'utf-8');
  let written = 0;
  while (written < buffer.length) {
    try {
      written += fs.writeSync(1, buffer, written, buffer.length - written);
    } catch (err) {
      if (err.code === 'EAGAIN') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      throw err;
    }
  }
}

function error(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exit(1);
}

// ─── Quota Tracking ───────────────────────────────────────────────────────────

const DEFAULT_QUOTA_STATE = {
  session: {
    tokens_used: 0,
    tokens_limit: 2000000, // Default ITPM limit
    reset_time: null,
    last_updated: null
  },
  weekly: {
    tokens_used: 0,
    tokens_limit: 100000000, // Default weekly estimate
    reset_time: null,
    last_updated: null
  },
  tasks: [],  // Array of { task_id, model, tokens_in, tokens_out, timestamp }
  warnings_shown: {
    session_80: false,
    weekly_80: false
  }
};

function getQuotaPath(cwd) {
  return path.join(cwd, '.planning', 'quota', 'session-usage.json');
}

function loadQuotaState(cwd) {
  const quotaPath = getQuotaPath(cwd);
  if (!fs.existsSync(quotaPath)) {
    // Deep copy to avoid shared nested objects (session, weekly, tasks, warnings_shown)
    return JSON.parse(JSON.stringify(DEFAULT_QUOTA_STATE));
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(quotaPath, 'utf-8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_QUOTA_STATE));
  }

  // Corruption detection + self-heal. The try/catch above only guards against
  // structurally-invalid JSON -- a structurally-valid file can still have a
  // numerically corrupted session/weekly scope (e.g. tokens_used accumulated
  // forever with no reset, vastly exceeding tokens_limit, or NaN/negative
  // values from a bad arithmetic path). This is the single read choke point
  // every consumer (quota status/stats, phase-coordinator's
  // per-task quota check) goes through, so healing here protects all of them
  // for free. Each scope is checked/healed independently -- corruption in one
  // scope never resets the other.
  let healedAny = false;
  for (const scopeName of ['session', 'weekly']) {
    const scope = state && state[scopeName];
    if (!scope || typeof scope !== 'object') continue;

    const tokensUsed = scope.tokens_used;
    const tokensLimit = scope.tokens_limit;
    const percent = (typeof tokensLimit === 'number' && tokensLimit !== 0)
      ? (tokensUsed / tokensLimit) * 100
      : NaN;

    const limitCorrupted = !Number.isFinite(tokensLimit) || tokensLimit <= 0;
    const corrupted = !Number.isFinite(percent) || percent > 100 ||
      !Number.isFinite(tokensUsed) || tokensUsed < 0 || limitCorrupted;

    if (!corrupted) continue;

    healedAny = true;
    const action = limitCorrupted ? 'reset_tokens_used_and_limit' : 'reset_tokens_used';

    process.stderr.write(
      `QUOTA CORRUPTION DETECTED (${scopeName}): tokens_used=${tokensUsed}, tokens_limit=${tokensLimit}, computed_percent=${percent} — resetting tokens_used to 0\n`
    );

    try {
      const quotaDir = path.dirname(quotaPath);
      fs.mkdirSync(quotaDir, { recursive: true });
      const logPath = path.join(quotaDir, 'corruption-log.jsonl');
      const logEntry = {
        timestamp: new Date().toISOString(),
        scope: scopeName,
        tokens_used_before: tokensUsed,
        tokens_limit_before: tokensLimit,
        computed_percent: percent,
        action,
      };
      fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    } catch (e) {
      process.stderr.write(`Warning: failed to write corruption-log.jsonl: ${e.message}\n`);
    }

    scope.tokens_used = 0;
    if (limitCorrupted) {
      scope.tokens_limit = DEFAULT_QUOTA_STATE[scopeName].tokens_limit;
    }
  }

  if (healedAny) {
    saveQuotaState(cwd, state);
  }

  return state;
}

function saveQuotaState(cwd, state) {
  const quotaPath = getQuotaPath(cwd);
  fs.mkdirSync(path.dirname(quotaPath), { recursive: true });
  fs.writeFileSync(quotaPath, JSON.stringify(state, null, 2));
}

function parseQuotaHeaders(headers) {
  // Headers from Claude API (as documented)
  // Note: In practice, headers may come as object or need parsing
  return {
    input: {
      remaining: parseInt(headers['anthropic-ratelimit-input-tokens-remaining'] || '0'),
      limit: parseInt(headers['anthropic-ratelimit-input-tokens-limit'] || '2000000'),
      reset: headers['anthropic-ratelimit-input-tokens-reset'] || null
    },
    output: {
      remaining: parseInt(headers['anthropic-ratelimit-output-tokens-remaining'] || '0'),
      limit: parseInt(headers['anthropic-ratelimit-output-tokens-limit'] || '500000'),
      reset: headers['anthropic-ratelimit-output-tokens-reset'] || null
    }
  };
}

function recordTaskUsage(cwd, taskId, model, tokensIn, tokensOut) {
  const state = loadQuotaState(cwd);

  // Add to tasks array
  state.tasks.push({
    task_id: taskId,
    model: model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    timestamp: new Date().toISOString()
  });

  // Update session totals
  state.session.tokens_used += tokensIn + tokensOut;
  state.session.last_updated = new Date().toISOString();

  // Update weekly totals
  state.weekly.tokens_used += tokensIn + tokensOut;
  state.weekly.last_updated = new Date().toISOString();

  saveQuotaState(cwd, state);
  return state;
}

function checkQuotaWarning(cwd) {
  const state = loadQuotaState(cwd);
  const warnings = [];

  const sessionPercent = state.session.tokens_limit > 0
    ? (state.session.tokens_used / state.session.tokens_limit) * 100
    : 0;
  const weeklyPercent = state.weekly.tokens_limit > 0
    ? (state.weekly.tokens_used / state.weekly.tokens_limit) * 100
    : 0;

  // 80% session warning (only show once per session)
  if (sessionPercent >= 80 && !state.warnings_shown.session_80) {
    warnings.push({
      type: 'session',
      level: 'warning',
      message: `Session quota at ${sessionPercent.toFixed(1)}%`,
      percent: sessionPercent
    });
    state.warnings_shown.session_80 = true;
    saveQuotaState(cwd, state);
  }

  // 80% weekly warning
  if (weeklyPercent >= 80 && !state.warnings_shown.weekly_80) {
    warnings.push({
      type: 'weekly',
      level: 'warning',
      message: `Weekly quota at ${weeklyPercent.toFixed(1)}%`,
      percent: weeklyPercent
    });
    state.warnings_shown.weekly_80 = true;
    saveQuotaState(cwd, state);
  }

  return warnings;
}

function checkQuotaAndWait(cwd) {
  const state = loadQuotaState(cwd);

  const sessionPercent = state.session.tokens_limit > 0
    ? (state.session.tokens_used / state.session.tokens_limit) * 100
    : 0;
  const weeklyPercent = state.weekly.tokens_limit > 0
    ? (state.weekly.tokens_used / state.weekly.tokens_limit) * 100
    : 0;

  const result = {
    should_wait: false,
    wait_type: null,
    wait_until: null,
    wait_seconds: 0,
    percent: 0
  };

  // Check session quota (98-99% threshold per user decision)
  if (sessionPercent >= 98 && state.session.reset_time) {
    const resetTime = new Date(state.session.reset_time);
    const waitMs = Math.max(0, resetTime.getTime() - Date.now());
    result.should_wait = true;
    result.wait_type = 'session';
    result.wait_until = state.session.reset_time;
    result.wait_seconds = Math.ceil(waitMs / 1000) + 5; // +5s buffer
    result.percent = sessionPercent;
  }

  // Check weekly quota
  if (weeklyPercent >= 98 && state.weekly.reset_time) {
    const resetTime = new Date(state.weekly.reset_time);
    const waitMs = Math.max(0, resetTime.getTime() - Date.now());
    // If weekly wait is longer than session wait, use weekly
    if (!result.should_wait || waitMs > result.wait_seconds * 1000) {
      result.should_wait = true;
      result.wait_type = 'weekly';
      result.wait_until = state.weekly.reset_time;
      result.wait_seconds = Math.ceil(waitMs / 1000) + 5;
      result.percent = weeklyPercent;
    }
  }

  return result;
}

function formatStatusBar(quotaState) {
  // Calculate tokens delegated to smaller models — last 24h sliding window
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const tasks = (quotaState.tasks || []).filter(t => {
    const ts = t.timestamp ? new Date(t.timestamp).getTime() : 0;
    return ts >= cutoff;
  });
  const totalTokens = tasks.reduce((sum, t) =>
    sum + (t.tokens_in || 0) + (t.tokens_cache_create_1h || 0)
        + (t.tokens_cache_create_5m || 0) + (t.tokens_cache_read || 0)
        + (t.tokens_out || 0), 0);

  // Pricing per million tokens (anthropic.com/pricing, Feb 2026)
  // cache_create_1h = 2x input  |  cache_create_5m = 1.25x input  |  cache_read = 0.1x input
  const RATES = {
    haiku:  { in: 1,  out: 5,  cc1h: 2,   cc5m: 1.25, cr: 0.10 },
    sonnet: { in: 3,  out: 15, cc1h: 6,   cc5m: 3.75, cr: 0.30 },
    opus:   { in: 5,  out: 25, cc1h: 10,  cc5m: 6.25, cr: 0.50 }
  };
  const modelTokens = { haiku: 0, sonnet: 0, opus: 0 };
  let actualCost = 0;
  let opusCost = 0;

  for (const task of tasks) {
    const model = task.model.toLowerCase();
    const R = RATES[model] || RATES.sonnet;
    const hasBreakdown = task.tokens_cache_read !== undefined;
    let tIn, tCc1h, tCc5m, tCr, tOut;
    if (hasBreakdown) {
      tIn   = task.tokens_in              || 0;
      tCc1h = task.tokens_cache_create_1h || 0;
      tCc5m = task.tokens_cache_create_5m || 0;
      tCr   = task.tokens_cache_read      || 0;
      tOut  = task.tokens_out             || 0;
    } else {
      // Old format: tokens_in is the raw total — treat as regular input (slight overestimate)
      tIn = task.tokens_in || 0; tCc1h = 0; tCc5m = 0; tCr = 0;
      tOut = task.tokens_out || 0;
    }

    if (modelTokens[model] !== undefined)
      modelTokens[model] += tIn + tCc1h + tCc5m + tCr + tOut;

    // Savings: haiku vs sonnet baseline, sonnet vs opus baseline, opus vs itself = 0
    const SR = model === 'haiku' ? RATES.sonnet : model === 'sonnet' ? RATES.opus : R;
    actualCost += (tIn * R.in  + tCc1h * R.cc1h  + tCc5m * R.cc5m  + tCr * R.cr  + tOut * R.out)  / 1e6;
    opusCost   += (tIn * SR.in + tCc1h * SR.cc1h + tCc5m * SR.cc5m + tCr * SR.cr + tOut * SR.out) / 1e6;
  }

  const totalByModel = modelTokens.haiku + modelTokens.sonnet + modelTokens.opus || 1;
  const hPercent = Math.round((modelTokens.haiku  / totalByModel) * 100);
  const sPercent = Math.round((modelTokens.sonnet / totalByModel) * 100);
  const oPercent = Math.round((modelTokens.opus   / totalByModel) * 100);

  // Format token count: B / M / K
  const tokFmt = totalTokens >= 1e9 ? `${(totalTokens / 1e9).toFixed(1)}B`
    : totalTokens >= 1e6            ? `${(totalTokens / 1e6).toFixed(1)}M`
    : totalTokens >= 1000           ? `${Math.round(totalTokens / 1000)}K`
    :                                  String(totalTokens);
  const tokensStr = tokFmt + '/24h';

  // Last model by timestamp — includes subagent turns recorded in quota state
  const lastTask = tasks.length ? tasks.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b
  ) : null;
  const lastModelStr = lastTask ? ` last:${lastTask.model}` : '';

  // Savings: haiku vs sonnet + sonnet vs opus (tier-by-tier, not all-vs-opus)
  const saved = opusCost - actualCost;
  const savedStr = saved < 0.01  ? '<$0.01 saved'
    : saved < 1                  ? `$${saved.toFixed(2)} saved`
    : saved < 1000               ? `$${Math.round(saved)} saved`
    :                              `$${(saved / 1000).toFixed(1)}K saved`;

  return `Tokens: ${tokensStr}${lastModelStr} | ${savedStr} | H:${hPercent}% S:${sPercent}% O:${oPercent}%`;
}

function getUsageStats(quotaState) {
  const tasks = quotaState.tasks || [];

  // Calculate per-model breakdown (include cache token fields for accuracy)
  const models = { haiku: { tokens: 0, tasks: 0 }, sonnet: { tokens: 0, tasks: 0 }, opus: { tokens: 0, tasks: 0 } };
  for (const task of tasks) {
    const model = task.model.toLowerCase();
    if (models[model]) {
      models[model].tokens += (task.tokens_in || 0) + (task.tokens_out || 0)
        + (task.tokens_cache_create_1h || 0) + (task.tokens_cache_create_5m || 0)
        + (task.tokens_cache_read || 0);
      models[model].tasks += 1;
    }
  }

  // Calculate estimated cost savings using per-token pricing (anthropic.com/pricing, Feb 2026)
  // Uses blended avg of input ($X/M) and output ($Y/M) per model
  // Aligned with RATES in formatStatusBar: haiku in:$1 out:$5, sonnet in:$3 out:$15, opus in:$5 out:$25
  const BLENDED_RATES = { haiku: 3, sonnet: 9, opus: 15 }; // $/M tokens blended avg
  const opusCost = (models.opus.tokens / 1000000) * BLENDED_RATES.opus;
  const sonnetCost = (models.sonnet.tokens / 1000000) * BLENDED_RATES.sonnet;
  const haikuCost = (models.haiku.tokens / 1000000) * BLENDED_RATES.haiku;

  // If all tasks were Opus
  const totalTokens = models.haiku.tokens + models.sonnet.tokens + models.opus.tokens;
  const allOpusCost = (totalTokens / 1000000) * BLENDED_RATES.opus;
  const actualCost = opusCost + sonnetCost + haikuCost;
  const savings = allOpusCost - actualCost;
  const savingsPercent = allOpusCost > 0 ? (savings / allOpusCost) * 100 : 0;

  return {
    session_total: {
      tokens: totalTokens,
      tasks: tasks.length,
      duration_minutes: tasks.length > 0
        ? Math.round((new Date() - new Date(tasks[0].timestamp)) / 60000)
        : 0
    },
    per_model: {
      haiku: models.haiku,
      sonnet: models.sonnet,
      opus: models.opus
    },
    cost_estimate: {
      actual_cost: `$${actualCost.toFixed(4)}`,
      if_all_opus: `$${allOpusCost.toFixed(4)}`,
      savings: `$${savings.toFixed(4)}`,
      savings_percent: `${savingsPercent.toFixed(1)}%`
    },
    quota: {
      session_used: quotaState.session.tokens_used,
      session_limit: quotaState.session.tokens_limit,
      session_percent: ((quotaState.session.tokens_used / quotaState.session.tokens_limit) * 100).toFixed(1) + '%',
      weekly_used: quotaState.weekly.tokens_used,
      weekly_limit: quotaState.weekly.tokens_limit,
      weekly_percent: ((quotaState.weekly.tokens_used / quotaState.weekly.tokens_limit) * 100).toFixed(1) + '%'
    }
  };
}

// ─── Resilience: Auto-Resume (MILE-23, Phase 51-02) ──────────────────────────
//
// Deterministic, pure-function core consumed by execute-roadmap.md prose
// (wired in 51-03) to detect a dead coordinator (session/quota-limit death or
// checkpoint staleness), assemble a resume brief from its CHECKPOINT.json, and
// estimate quota cost before a run -- all unit-tested here so the (untestable)
// workflow prose plan can stay small and low-risk.

// Detects a session/usage/quota/rate-limit death message, case-insensitively,
// and extracts an optional "resets <time>" fragment. Never throws on
// empty/null/undefined input.
function parseDeathSignature(text) {
  if (!text || typeof text !== 'string') {
    return { is_death: false, matched_pattern: null, reset_fragment: null };
  }

  const patterns = [
    { regex: /session limit/i, label: 'session limit' },
    { regex: /usage limit/i, label: 'usage limit' },
    { regex: /quota limit/i, label: 'quota limit' },
    { regex: /rate limit exceeded/i, label: 'rate limit exceeded' },
  ];

  let matchedPattern = null;
  for (const p of patterns) {
    if (p.regex.test(text)) {
      matchedPattern = p.label;
      break;
    }
  }

  if (!matchedPattern) {
    return { is_death: false, matched_pattern: null, reset_fragment: null };
  }

  // Tolerate any separator before "resets" (e.g. "· resets 12:30am") -- match
  // on "resets" regardless of what precedes it.
  const resetMatch = text.match(/resets\s+(\d{1,2}:\d{2}\s*(?:am|pm))/i);

  return {
    is_death: true,
    matched_pattern: matchedPattern,
    reset_fragment: resetMatch ? resetMatch[1].replace(/\s+/g, '').toLowerCase() : null,
  };
}

// Parses a 12-hour-clock fragment (e.g. "12:30am", "5:20pm") -- or a full
// death message containing "resets <time>" -- into the next real occurrence
// as an ISO timestamp relative to referenceDate (today if still in the
// future, tomorrow otherwise). Returns null if no valid time can be parsed.
function parseResetTime(text, referenceDate) {
  const refDate = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
    ? referenceDate
    : new Date();

  if (!text || typeof text !== 'string') return null;

  // Accept either a raw fragment ("12:30am") or a full message ("... resets 12:30am").
  const resetsMatch = text.match(/resets\s+(\d{1,2}:\d{2}\s*(?:am|pm))/i);
  const timeSource = resetsMatch ? resetsMatch[1] : text;

  const timeMatch = timeSource.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!timeMatch) return null;

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3].toLowerCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

  if (meridiem === 'am') {
    hour = hour === 12 ? 0 : hour;
  } else {
    hour = hour === 12 ? 12 : hour + 12;
  }

  const candidate = new Date(
    refDate.getFullYear(), refDate.getMonth(), refDate.getDate(),
    hour, minute, 0, 0
  );

  // Still in the future (strictly after referenceDate) -> today's occurrence.
  // Already passed (equal to or before referenceDate) -> tomorrow's occurrence.
  if (candidate.getTime() <= refDate.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.toISOString();
}

// Reports whether a file's mtime exceeds thresholdMinutes. Returns a clear
// stale:null / file_exists:false result (never throws) when the file is
// missing -- distinct from stale:true/false, so callers can branch on
// "never wrote a first checkpoint" as its own case.
function checkStaleness(filePath, thresholdMinutes) {
  const threshold = typeof thresholdMinutes === 'number' && Number.isFinite(thresholdMinutes)
    ? thresholdMinutes
    : 30;

  if (!fs.existsSync(filePath)) {
    return { stale: null, file_exists: false, mtime: null, age_minutes: null, threshold_minutes: threshold };
  }

  const stat = fs.statSync(filePath);
  const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;

  return {
    stale: ageMinutes > threshold,
    file_exists: true,
    mtime: new Date(stat.mtimeMs).toISOString(),
    age_minutes: ageMinutes,
    threshold_minutes: threshold,
  };
}

function cmdResilienceCheckStaleness(cwd, filePath, thresholdMinutes, raw) {
  if (!filePath) {
    error('resilience check-staleness: <file> required');
  }
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const threshold = (thresholdMinutes !== null && thresholdMinutes !== undefined && Number.isFinite(thresholdMinutes))
    ? thresholdMinutes
    : loadConfig(cwd).staleness_threshold_minutes;
  const result = checkStaleness(resolvedPath, threshold);
  output(result, raw);
}

function cmdResilienceParseDeath(text, raw) {
  if (!text) {
    error('resilience parse-death: --text required');
  }
  const result = parseDeathSignature(text);
  result.reset_time_iso = (result.is_death && result.reset_fragment)
    ? parseResetTime(result.reset_fragment, new Date())
    : null;
  output(result, raw);
}

// Extracts resume_from/last_step/step_status/plans_complete/plans_remaining/
// key_context from a phase's real CHECKPOINT.json shape. Tolerates missing
// fields (older checkpoints predate plans_complete/plans_remaining) and a
// missing/malformed file (never throws) -- both are the "restart from
// scratch" signal callers must treat as such, never a silent no-op.
function parseCheckpointForResume(checkpointPath) {
  const notFoundShape = {
    found: false,
    resume_from: null,
    last_step: null,
    step_status: null,
    plans_complete: null,
    plans_remaining: null,
    key_context: null,
  };

  if (!fs.existsSync(checkpointPath)) {
    return { ...notFoundShape };
  }

  let rawContent;
  try {
    rawContent = fs.readFileSync(checkpointPath, 'utf-8');
  } catch (e) {
    return { ...notFoundShape, error: e.message };
  }

  const parseResult = safeJsonParse(rawContent, checkpointPath);
  if (!parseResult.ok) {
    return { ...notFoundShape, error: parseResult.error.message };
  }

  const data = parseResult.value;
  return {
    found: true,
    resume_from: data.resume_from ?? null,
    last_step: data.last_step ?? null,
    step_status: data.step_status ?? null,
    plans_complete: data.plans_complete ?? null,
    plans_remaining: data.plans_remaining ?? null,
    key_context: data.key_context ?? null,
  };
}

// Assembles a resume-brief text/object from checkpoint data + phase info,
// suitable for injecting directly into a respawned coordinator's Agent()
// prompt string (plain text, no markdown tables).
//
// invariantsText (optional, third arg, default null) carries VERBATIM
// phase-invariant text read straight from ROADMAP.md by getPhaseInvariantsText
// (see below). Design rationale (MILE-40 criterion 2): key_context above is an
// LLM-authored summary written at checkpoint time -- it can drift, be
// paraphrased, or omit a hard rule. On resume, the hard rules/success criteria
// that actually govern the phase MUST be re-read byte-for-byte from their
// source (ROADMAP.md), never reconstructed from a summary. key_context is
// NOT removed -- it stays for narrative continuity -- but it is demoted from
// being the resume brief's sole "what matters" authority. When invariantsText
// is omitted/null/empty, behavior is 100% unchanged from before this
// parameter existed (backward compatible with all two-arg callers/tests).
function buildResumeBrief(checkpointData, phaseInfo, invariantsText = null) {
  const phaseNumber = phaseInfo && phaseInfo.phase_number;
  const phaseName = phaseInfo && phaseInfo.phase_name;
  const hasInvariants = typeof invariantsText === 'string' && invariantsText.trim() !== '';

  if (!checkpointData || !checkpointData.found) {
    const briefLines = [`No prior checkpoint found -- starting phase ${phaseNumber} (${phaseName}) from scratch.`];
    if (hasInvariants) {
      briefLines.push('');
      briefLines.push('PHASE INVARIANTS (verbatim from ROADMAP.md -- DO NOT paraphrase):');
      briefLines.push(invariantsText);
    }
    return {
      resume_from: 'discuss',
      brief_text: briefLines.join('\n'),
      checkpoint: checkpointData || null,
      invariants: hasInvariants ? invariantsText : null,
    };
  }

  const lines = [];
  lines.push('RESUMING FROM DEATH');
  lines.push(`Phase ${phaseNumber} (${phaseName})`);
  lines.push(`Last step: ${checkpointData.last_step ?? 'unknown'} (status: ${checkpointData.step_status ?? 'unknown'})`);
  if (checkpointData.plans_complete !== null && checkpointData.plans_complete !== undefined) {
    lines.push(`Plans complete: ${JSON.stringify(checkpointData.plans_complete)}`);
  }
  if (checkpointData.plans_remaining !== null && checkpointData.plans_remaining !== undefined) {
    lines.push(`Plans remaining: ${JSON.stringify(checkpointData.plans_remaining)}`);
  }
  if (checkpointData.key_context) {
    lines.push('');
    lines.push('Key context:');
    lines.push(checkpointData.key_context);
  }
  if (hasInvariants) {
    lines.push('');
    lines.push('PHASE INVARIANTS (verbatim from ROADMAP.md -- DO NOT paraphrase):');
    lines.push(invariantsText);
  }

  return {
    resume_from: checkpointData.resume_from,
    brief_text: lines.join('\n'),
    checkpoint: checkpointData,
    invariants: hasInvariants ? invariantsText : null,
  };
}

function cmdResilienceResumeBrief(cwd, phase, raw) {
  if (!phase) {
    error('resilience resume-brief: <phase> required');
  }
  const phaseInfo = findPhaseInternal(cwd, phase);
  if (!phaseInfo) {
    output({ error: 'phase not found', phase }, raw);
    return;
  }
  const checkpointPath = path.join(cwd, phaseInfo.directory, 'CHECKPOINT.json');
  const checkpointData = parseCheckpointForResume(checkpointPath);
  const invariantsText = getPhaseInvariantsText(cwd, phaseInfo.phase_number);
  const brief = buildResumeBrief(checkpointData, phaseInfo, invariantsText);
  output(brief, raw);
}

// Normalizes a single handoff-brief section value into a plain-text form.
// Accepts a string or an array of strings; arrays render as one bullet per
// line. Never throws -- any other input (null/undefined/number/object) or an
// all-whitespace/all-empty-items value normalizes to '' (treated as missing
// by buildHandoffBrief).
function normalizeHandoffSection(value) {
  if (Array.isArray(value)) {
    const items = value.filter((v) => typeof v === 'string' && v.trim() !== '');
    if (items.length === 0) return '';
    return items.map((v) => `- ${v.trim()}`).join('\n');
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return '';
}

// Assembles the fixed 5-section handoff brief (see
// get-shit-done/references/handoff-brief.md for the canonical structure this
// mirrors) as plain text, suitable for injecting directly into a coordinator
// -> executor or executor -> verifier spawn prompt. Fail-safe like
// buildResumeBrief: never throws, degrades on missing/malformed input by
// reporting complete:false rather than raising -- a fixed structure is
// guaranteed (all 5 labels always render), only completeness varies.
function buildHandoffBrief(fields) {
  const safeFields = (fields && typeof fields === 'object') ? fields : {};
  const phaseNumber = safeFields.phase_number !== undefined && safeFields.phase_number !== null
    ? safeFields.phase_number
    : 'unknown';
  const phaseName = safeFields.phase_name !== undefined && safeFields.phase_name !== null && safeFields.phase_name !== ''
    ? safeFields.phase_name
    : 'unknown';

  const sectionDefs = [
    { key: 'phase_goal', label: 'PHASE GOAL' },
    { key: 'key_decisions', label: 'KEY DECISIONS' },
    { key: 'open_risks', label: 'OPEN RISKS' },
    { key: 'file_map', label: 'FILE MAP' },
    { key: 'hard_rules', label: 'HARD RULES' },
  ];

  const sections = {};
  let complete = true;

  const lines = [];
  lines.push('HANDOFF BRIEF');
  lines.push(`Phase ${phaseNumber} (${phaseName})`);

  for (const { key, label } of sectionDefs) {
    const normalized = normalizeHandoffSection(safeFields[key]);
    sections[key] = normalized;
    if (normalized === '') complete = false;
    lines.push('');
    lines.push(`${label}:`);
    lines.push(normalized === '' ? '(none provided)' : normalized);
  }

  return {
    brief_text: lines.join('\n'),
    sections,
    complete,
  };
}

function cmdHandoffBrief(jsonArg, raw) {
  if (!jsonArg) {
    error('handoff brief: --json required');
  }
  const parseResult = safeJsonParse(jsonArg, '--json');
  if (!parseResult.ok) {
    error(`handoff brief: invalid JSON in --json (${parseResult.error.message})`);
  }
  const brief = buildHandoffBrief(parseResult.value);
  output(brief, raw);
}

// Estimates the token cost of phaseCount remaining phases against the
// current (self-healed via loadQuotaState) quota budget. Reuses
// loadQuotaState -- never reads the raw quota file itself -- so this
// composes with 51-01's self-heal automatically.
function estimateQuotaForRemainingPhases(cwd, phaseCount) {
  const quotaState = loadQuotaState(cwd);

  // Deliberately conservative placeholder, not a measured value -- used only
  // when no execution history exists yet (brand new project, or
  // EXECUTION_LOG.md absent).
  const CONSERVATIVE_DEFAULT_TOKENS_PER_PHASE = 300000;

  let avgTokensPerPhase = CONSERVATIVE_DEFAULT_TOKENS_PER_PHASE;
  let source = 'conservative_default';

  try {
    const { getExecutionStats } = require('./execution-log.js');
    const stats = getExecutionStats(cwd);
    if (stats && stats.phases_completed > 0) {
      const totalTokensAcrossTasks = (quotaState.tasks || []).reduce(
        (sum, t) => sum + (t.tokens_in || 0) + (t.tokens_out || 0), 0
      );
      avgTokensPerPhase = totalTokensAcrossTasks / stats.phases_completed;
      source = 'observed_history';
    }
  } catch (e) {
    // require failure or getExecutionStats throwing -- fall back to the
    // conservative default above.
  }

  const estimatedTokens = avgTokensPerPhase * phaseCount;
  const remainingBudget = quotaState.session.tokens_limit - quotaState.session.tokens_used;
  // A placeholder estimate against an unmeasured budget is no evidence of a shortfall: never block on it.
  const unmeasured = source === 'conservative_default' || !(estimatedTokens > 0);
  const sufficient = unmeasured ? true : estimatedTokens <= remainingBudget;

  return {
    estimated_tokens: estimatedTokens,
    avg_tokens_per_phase: avgTokensPerPhase,
    remaining_budget: remainingBudget,
    sufficient,
    phase_count: phaseCount,
    source,
    unmeasured,
  };
}

function cmdResilienceEstimateQuota(cwd, phaseCount, raw) {
  const count = Number.isFinite(phaseCount) && phaseCount > 0 ? phaseCount : 1;
  const result = estimateQuotaForRemainingPhases(cwd, count);
  output(result, raw);
}

// Scans ~/.claude/projects/**/*.jsonl (every project, not just cwd's) for
// assistant message entries with a `timestamp` inside the trailing
// `hours`-hour window, summing their `message.usage` token fields. This is
// an ESTIMATE of real usage, not a billed-usage source of truth -- Claude
// Code transcript `usage` blocks are per-API-call, may double-count retried
// calls, and this function has no visibility into weekly/plan-level limits.
// The caller (execute-phase.md) treats a threshold miss as a signal to
// pause proactively, never as an authoritative quota figure.
//
// `options.projectsDir` and `options.referenceNow` (both optional) exist
// purely for deterministic unit testing -- the CLI entry point
// (cmdResilienceUsageWindow) never passes them, so real usage always scans
// the real ~/.claude/projects/ against the real current time.
function scanUsageWindow(hours, options = {}) {
  const windowHours = typeof hours === 'number' && Number.isFinite(hours) && hours > 0 ? hours : 5;
  const projectsDir = options.projectsDir || path.join(require('os').homedir(), '.claude', 'projects');
  const nowMs = options.referenceNow instanceof Date && !Number.isNaN(options.referenceNow.getTime())
    ? options.referenceNow.getTime()
    : Date.now();
  const cutoffMs = nowMs - windowHours * 3600 * 1000;

  const result = {
    window_hours: windowHours,
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    by_model_family: {},
    messages_count: 0,
  };

  if (!fs.existsSync(projectsDir)) return result;

  let slugDirs;
  try {
    slugDirs = fs.readdirSync(projectsDir).filter((d) => {
      try { return fs.statSync(path.join(projectsDir, d)).isDirectory(); } catch { return false; }
    });
  } catch {
    return result;
  }

  const familyOf = (model) => {
    if (typeof model !== 'string') return 'unknown';
    const m = model.toLowerCase();
    if (m.includes('opus')) return 'opus';
    if (m.includes('sonnet')) return 'sonnet';
    if (m.includes('haiku')) return 'haiku';
    if (m.includes('fable')) return 'fable';
    return 'other';
  };

  for (const slug of slugDirs) {
    const slugPath = path.join(projectsDir, slug);
    let files;
    try {
      files = fs.readdirSync(slugPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(slugPath, file);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      // A file's mtime is its last-written line's write time -- if that is
      // already before the window, every line in it is too. Cheap prefilter
      // that avoids reading files that can't possibly contribute.
      if (stat.mtimeMs < cutoffMs) continue;

      let content;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }

        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : NaN;
        if (!Number.isFinite(ts) || ts < cutoffMs || ts > nowMs) continue;

        const usage = entry.message && entry.message.usage;
        if (!usage || typeof usage !== 'object') continue;

        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cacheCreate = usage.cache_creation_input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;

        result.input_tokens += inputTokens;
        result.output_tokens += outputTokens;
        result.cache_creation_tokens += cacheCreate;
        result.cache_read_tokens += cacheRead;
        result.messages_count += 1;

        const family = familyOf(entry.message && entry.message.model);
        const msgTotal = inputTokens + outputTokens + cacheCreate + cacheRead;
        result.by_model_family[family] = (result.by_model_family[family] || 0) + msgTotal;
      }
    }
  }

  result.total_tokens = result.input_tokens + result.output_tokens
    + result.cache_creation_tokens + result.cache_read_tokens;

  return result;
}

function cmdResilienceUsageWindow(hours, raw) {
  const result = scanUsageWindow(hours);
  output(result, raw);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdGenerateSlug(text, raw) {
  if (!text) {
    error('text required for slug generation');
  }

  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const result = { slug };
  output(result, raw, slug);
}

function cmdCurrentTimestamp(format, raw) {
  const now = new Date();
  let result;

  switch (format) {
    case 'date':
      result = now.toISOString().split('T')[0];
      break;
    case 'filename':
      result = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
      break;
    case 'full':
    default:
      result = now.toISOString();
      break;
  }

  output({ timestamp: result }, raw, result);
}

function cmdListTodos(cwd, area, raw) {
  const pendingDir = path.join(cwd, '.planning', 'todos', 'pending');

  let count = 0;
  const todos = [];

  try {
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
        const createdMatch = content.match(/^created:\s*(.+)$/m);
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        const areaMatch = content.match(/^area:\s*(.+)$/m);

        const todoArea = areaMatch ? areaMatch[1].trim() : 'general';

        // Apply area filter if specified
        if (area && todoArea !== area) continue;

        count++;
        todos.push({
          file,
          created: createdMatch ? createdMatch[1].trim() : 'unknown',
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          area: todoArea,
          path: path.join('.planning', 'todos', 'pending', file),
        });
      } catch {}
    }
  } catch {}

  const result = { count, todos };
  output(result, raw, count.toString());
}

function cmdVerifyPathExists(cwd, targetPath, raw) {
  if (!targetPath) {
    error('path required for verification');
  }

  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);

  try {
    const stats = fs.statSync(fullPath);
    const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
    const result = { exists: true, type };
    output(result, raw, 'true');
  } catch {
    const result = { exists: false, type: null };
    output(result, raw, 'false');
  }
}

function cmdConfigEnsureSection(cwd, raw) {
  const configPath = path.join(cwd, '.planning', 'config.json');
  const planningDir = path.join(cwd, '.planning');

  // Ensure .planning directory exists
  try {
    if (!fs.existsSync(planningDir)) {
      fs.mkdirSync(planningDir, { recursive: true });
    }
  } catch (err) {
    error('Failed to create .planning directory: ' + err.message);
  }

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    const result = { created: false, reason: 'already_exists' };
    output(result, raw, 'exists');
    return;
  }

  // Detect Brave Search API key availability
  const homedir = require('os').homedir();
  const braveKeyFile = path.join(homedir, '.gsd', 'brave_api_key');
  const hasBraveSearch = !!(process.env.BRAVE_API_KEY || fs.existsSync(braveKeyFile));

  // Create default config
  const defaults = {
    models: { top: 'opus' },
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'phase-{phase}-{slug}',
    milestone_branch_template: 'feature/{slug}',
    workflow: {
      research: true,
      plan_check: true,
      verifier: true,
    },
    parallelization: true,
    brave_search: hasBraveSearch,
  };

  try {
    atomicWriteFileSync(configPath, JSON.stringify(defaults, null, 2));
    const result = { created: true, path: '.planning/config.json' };
    output(result, raw, 'created');
  } catch (err) {
    error('Failed to create config.json: ' + err.message);
  }
}

function cmdConfigSet(cwd, keyPath, value, raw) {
  const configPath = path.join(cwd, '.planning', 'config.json');

  if (!keyPath) {
    error('Usage: config-set <key.path> <value>');
  }

  // Parse value (handle booleans and numbers)
  let parsedValue = value;
  if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;
  else if (!isNaN(value) && value !== '') parsedValue = Number(value);

  if ((keyPath === 'models.top' || keyPath === 'models.top_fallback') && !topModel.isAlias(parsedValue)) {
    error(`${keyPath} must be a model alias (e.g. opus), not a model id`);
  }

  // Load existing config or start with empty object
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    error('Failed to read config.json: ' + err.message);
  }

  // Set nested value using dot notation (e.g., "workflow.research")
  const keys = keyPath.split('.');
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = parsedValue;

  // Write back
  try {
    atomicWriteFileSync(configPath, JSON.stringify(config, null, 2));
    const result = { updated: true, key: keyPath, value: parsedValue };
    output(result, raw, `${keyPath}=${parsedValue}`);
  } catch (err) {
    error('Failed to write config.json: ' + err.message);
  }
}

// Read a dotted key path (e.g. "workflow.auto_advance") straight out of the
// raw config.json, mirroring how cmdConfigSet WRITES nested paths. loadConfig()
// only surfaces a normalized whitelist of keys, so nested/opt-in keys such as
// workflow.auto_advance, workflow._auto_chain_active and testing.test_command
// are invisible to it — this fallback makes get/set symmetric. Returns
// undefined for a missing path or unreadable/corrupt config (loadConfig already
// prints a parse warning to stderr in the corrupt case).
function readRawConfigPath(cwd, keyPath) {
  const configPath = path.join(cwd, '.planning', 'config.json');
  try {
    if (!fs.existsSync(configPath)) return undefined;
    let current = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    for (const k of keyPath.split('.')) {
      if (current === null || typeof current !== 'object' || !(k in current)) {
        return undefined;
      }
      current = current[k];
    }
    return current;
  } catch {
    return undefined;
  }
}

function cmdConfigGet(cwd, key, raw, defaultValue) {
  if (!key) {
    error('Usage: config get <key> [--default <value>]');
  }
  const config = loadConfig(cwd);
  let value = config[key];
  // Fall back to a raw nested lookup for dotted paths the normalized config
  // doesn't expose (workflow.auto_advance, git.branching_strategy, etc.).
  if (value === undefined && key.includes('.')) {
    value = readRawConfigPath(cwd, key);
  }
  if (value === undefined) {
    // A supplied default lets callers express "unset means this" without the
    // `|| echo "false"` shell mask that also swallowed genuine dispatch/crash
    // failures — a real error now surfaces as a non-zero exit + empty stdout.
    if (defaultValue !== undefined) {
      output({ key, value: defaultValue }, raw, defaultValue);
      return;
    }
    error(`Unknown config key: ${key}`);
  }
  const strValue = value !== null && typeof value === 'object'
    ? JSON.stringify(value)
    : String(value);
  output({ key, value }, raw, strValue);
}

function cmdHistoryDigest(cwd, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const digest = { phases: {}, decisions: [], tech_stack: new Set() };

  if (!fs.existsSync(phasesDir)) {
    digest.tech_stack = [];
    output(digest, raw);
    return;
  }

  try {
    const phaseDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();

    for (const dir of phaseDirs) {
      const dirPath = path.join(phasesDir, dir);
      const summaries = fs.readdirSync(dirPath).filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');

      for (const summary of summaries) {
        try {
          const content = fs.readFileSync(path.join(dirPath, summary), 'utf-8');
          const fm = extractFrontmatter(content);
          
          const phaseNum = fm.phase || dir.split('-')[0];
          
          if (!digest.phases[phaseNum]) {
            digest.phases[phaseNum] = {
              name: fm.name || dir.split('-').slice(1).join(' ') || 'Unknown',
              provides: new Set(),
              affects: new Set(),
              patterns: new Set(),
            };
          }

          // Merge provides
          if (fm['dependency-graph'] && fm['dependency-graph'].provides) {
            fm['dependency-graph'].provides.forEach(p => digest.phases[phaseNum].provides.add(p));
          } else if (fm.provides) {
            fm.provides.forEach(p => digest.phases[phaseNum].provides.add(p));
          }

          // Merge affects
          if (fm['dependency-graph'] && fm['dependency-graph'].affects) {
            fm['dependency-graph'].affects.forEach(a => digest.phases[phaseNum].affects.add(a));
          }

          // Merge patterns
          if (fm['patterns-established']) {
            fm['patterns-established'].forEach(p => digest.phases[phaseNum].patterns.add(p));
          }

          // Merge decisions
          if (fm['key-decisions']) {
            fm['key-decisions'].forEach(d => {
              digest.decisions.push({ phase: phaseNum, decision: d });
            });
          }

          // Merge tech stack
          if (fm['tech-stack'] && fm['tech-stack'].added) {
            fm['tech-stack'].added.forEach(t => digest.tech_stack.add(typeof t === 'string' ? t : t.name));
          }

        } catch (e) {
          // Skip malformed summaries
        }
      }
    }

    // Convert Sets to Arrays for JSON output
    Object.keys(digest.phases).forEach(p => {
      digest.phases[p].provides = [...digest.phases[p].provides];
      digest.phases[p].affects = [...digest.phases[p].affects];
      digest.phases[p].patterns = [...digest.phases[p].patterns];
    });
    digest.tech_stack = [...digest.tech_stack];

    output(digest, raw);
  } catch (e) {
    error('Failed to generate history digest: ' + e.message);
  }
}

function cmdPhasesList(cwd, options, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const { type, phase } = options;

  // If no phases directory, return empty
  if (!fs.existsSync(phasesDir)) {
    if (type) {
      output({ files: [], count: 0 }, raw, '');
    } else {
      output({ directories: [], count: 0 }, raw, '');
    }
    return;
  }

  try {
    // Get all phase directories
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    let dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    // Sort numerically (handles decimals: 01, 02, 02.1, 02.2, 03)
    dirs.sort((a, b) => {
      const aNum = parseFloat(a.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      const bNum = parseFloat(b.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      return aNum - bNum;
    });

    // If filtering by phase number
    if (phase) {
      const normalized = normalizePhaseName(phase);
      const match = dirs.find(d => d.startsWith(normalized));
      if (!match) {
        output({ files: [], count: 0, phase_dir: null, error: 'Phase not found' }, raw, '');
        return;
      }
      dirs = [match];
    }

    // If listing files of a specific type
    if (type) {
      const files = [];
      for (const dir of dirs) {
        const dirPath = path.join(phasesDir, dir);
        const dirFiles = fs.readdirSync(dirPath);

        let filtered;
        if (type === 'plans') {
          filtered = dirFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');
        } else if (type === 'summaries') {
          filtered = dirFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
        } else {
          filtered = dirFiles;
        }

        files.push(...filtered.sort());
      }

      const result = {
        files,
        count: files.length,
        phase_dir: phase ? dirs[0].replace(/^\d+(?:\.\d+)?-?/, '') : null,
      };
      output(result, raw, files.join('\n'));
      return;
    }

    // Default: list directories
    output({ directories: dirs, count: dirs.length }, raw, dirs.join('\n'));
  } catch (e) {
    error('Failed to list phases: ' + e.message);
  }
}

// Reads a phase's own ROADMAP.md section VERBATIM (byte-for-byte, no
// reformatting/summarizing) for injection into a checkpoint resume brief.
// Design rationale (MILE-40 criterion 2): the resume path must re-read hard
// rules/invariants from a real source file, never from an LLM-authored
// summary (CHECKPOINT.json's key_context, or any SUMMARY.md). ROADMAP.md's
// phase section already contains the phase Goal + numbered Success Criteria
// -- these ARE the phase invariants. Reuses the exact section-slice logic
// cmdRoadmapGetPhase uses (phase header -> next "### Phase" header or EOF)
// rather than duplicating a second regex convention. A pure helper (no
// output()/process side effects) so it composes directly into
// buildResumeBrief's third argument. Never throws: any failure (missing
// ROADMAP.md, missing phase section, read/regex error) returns null, and
// callers must treat null as "no invariants available" (graceful
// degradation), never as an error to surface.
function getPhaseInvariantsText(cwd, phaseNum) {
  try {
    const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
    if (!fs.existsSync(roadmapPath)) return null;

    const content = fs.readFileSync(roadmapPath, 'utf-8');
    const escapedPhase = String(phaseNum).replace(/\./g, '\\.');
    // Capture the actual heading level (##, ###, ####, ...) used for this
    // phase's header rather than hardcoding 3 hashes: this repo's own live
    // ROADMAP.md uses "#### Phase N:" (4 hashes), not "### Phase N:" (3) --
    // hardcoding 3 would either mis-slice (partial match starting mid-hash-run)
    // or fail to find a same-level boundary, running the "section" all the
    // way to EOF. Reusing the SAME captured hash-run for the next-header
    // boundary guarantees the slice stops at the next phase heading
    // regardless of which heading level a given ROADMAP.md happens to use.
    const phasePattern = new RegExp(`(#{2,6})\\s*Phase\\s+${escapedPhase}:\\s*([^\\n]+)`, 'i');
    const headerMatch = content.match(phasePattern);
    if (!headerMatch) return null;

    const hashRun = headerMatch[1];
    const headerIndex = headerMatch.index;
    const restOfContent = content.slice(headerIndex);
    const nextHeaderMatch = restOfContent.match(new RegExp(`\\n${hashRun}\\s+Phase\\s+\\d`, 'i'));
    const sectionEnd = nextHeaderMatch
      ? headerIndex + nextHeaderMatch.index
      : content.length;

    const section = content.slice(headerIndex, sectionEnd).trim();
    return section || null;
  } catch (e) {
    return null;
  }
}

function cmdRoadmapGetPhase(cwd, phaseNum, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  if (!fs.existsSync(roadmapPath)) {
    output({ found: false, error: 'ROADMAP.md not found' }, raw, '');
    return;
  }

  try {
    const content = fs.readFileSync(roadmapPath, 'utf-8');

    // Escape special regex chars in phase number, handle decimal
    const escapedPhase = phaseNum.replace(/\./g, '\\.');

    // Match "### Phase X:" or "### Phase X.Y:" with optional name
    const phasePattern = new RegExp(
      `###\\s*Phase\\s+${escapedPhase}:\\s*([^\\n]+)`,
      'i'
    );
    const headerMatch = content.match(phasePattern);

    if (!headerMatch) {
      output({ found: false, phase_number: phaseNum }, raw, '');
      return;
    }

    const phaseName = headerMatch[1].trim();
    const headerIndex = headerMatch.index;

    // Find the end of this section (next ### or end of file)
    const restOfContent = content.slice(headerIndex);
    const nextHeaderMatch = restOfContent.match(/\n###\s+Phase\s+\d/i);
    const sectionEnd = nextHeaderMatch
      ? headerIndex + nextHeaderMatch.index
      : content.length;

    const section = content.slice(headerIndex, sectionEnd).trim();

    // Extract goal if present
    const goalMatch = section.match(ROADMAP_GOAL_RE);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    // Phase 59-03 (MILE-38): extract depends_on the same way parseRoadmapPhases does (~L7274),
    // normalized into an array (empty when absent/"None"/"Nothing"), tolerant of BOTH real-world
    // ROADMAP.md styles ("**Depends on:**" colon-inside-bold AND "**Depends on**:" colon-outside-
    // bold -- the live .planning/ROADMAP.md uses both across different phases). This field was
    // PREVIOUSLY MISSING from this function's return value entirely -- coordinator-detail.md's
    // existing DEPENDS_ON bash parse (`d.depends_on||[]`) has therefore always silently resolved
    // to "[]" regardless of the real ROADMAP.md content. This fix makes that pre-existing,
    // unchanged bash snippet functionally correct for the first time.
    const dependsMatch = section.match(/\*\*Depends on:?\*\*:?\s*([^\n]+)/i);
    const dependsOnRaw = dependsMatch ? dependsMatch[1].trim() : null;
    const depends_on = (!dependsOnRaw || /^(none|nothing)\b/i.test(dependsOnRaw))
      ? []
      : dependsOnRaw.split(',').map(s => s.trim()).filter(Boolean);

    output(
      {
        found: true,
        phase_number: phaseNum,
        phase_name: phaseName,
        goal,
        depends_on,
        section,
      },
      raw,
      section
    );
  } catch (e) {
    error('Failed to read ROADMAP.md: ' + e.message);
  }
}

function cmdPhaseNextDecimal(cwd, basePhase, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(basePhase);

  // Check if phases directory exists
  if (!fs.existsSync(phasesDir)) {
    output(
      {
        found: false,
        base_phase: normalized,
        next: `${normalized}.1`,
        existing: [],
      },
      raw,
      `${normalized}.1`
    );
    return;
  }

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    // Check if base phase exists
    const baseExists = dirs.some(d => d.startsWith(normalized + '-') || d === normalized);

    // Find existing decimal phases for this base
    const decimalPattern = new RegExp(`^${normalized}\\.(\\d+)`);
    const existingDecimals = [];

    for (const dir of dirs) {
      const match = dir.match(decimalPattern);
      if (match) {
        existingDecimals.push(`${normalized}.${match[1]}`);
      }
    }

    // Sort numerically
    existingDecimals.sort((a, b) => {
      const aNum = parseFloat(a);
      const bNum = parseFloat(b);
      return aNum - bNum;
    });

    // Calculate next decimal
    let nextDecimal;
    if (existingDecimals.length === 0) {
      nextDecimal = `${normalized}.1`;
    } else {
      const lastDecimal = existingDecimals[existingDecimals.length - 1];
      const lastNum = parseInt(lastDecimal.split('.')[1], 10);
      nextDecimal = `${normalized}.${lastNum + 1}`;
    }

    output(
      {
        found: baseExists,
        base_phase: normalized,
        next: nextDecimal,
        existing: existingDecimals,
      },
      raw,
      nextDecimal
    );
  } catch (e) {
    error('Failed to calculate next decimal phase: ' + e.message);
  }
}

function cmdStateLoad(cwd, raw) {
  const config = loadConfig(cwd);
  const planningDir = path.join(cwd, '.planning');

  let stateRaw = '';
  try {
    stateRaw = fs.readFileSync(path.join(planningDir, 'STATE.md'), 'utf-8');
  } catch {}

  const configExists = fs.existsSync(path.join(planningDir, 'config.json'));
  const roadmapExists = fs.existsSync(path.join(planningDir, 'ROADMAP.md'));
  const stateExists = stateRaw.length > 0;

  const result = {
    config,
    state_raw: stateRaw,
    state_exists: stateExists,
    roadmap_exists: roadmapExists,
    config_exists: configExists,
  };

  // For --raw, output a condensed key=value format
  if (raw) {
    const c = config;
    const lines = [
      `commit_docs=${c.commit_docs}`,
      `branching_strategy=${c.branching_strategy}`,
      `phase_branch_template=${c.phase_branch_template}`,
      `milestone_branch_template=${c.milestone_branch_template}`,
      `parallelization=${c.parallelization}`,
      `research=${c.research}`,
      `plan_checker=${c.plan_checker}`,
      `verifier=${c.verifier}`,
      `config_exists=${configExists}`,
      `roadmap_exists=${roadmapExists}`,
      `state_exists=${stateExists}`,
    ];
    process.stdout.write(lines.join('\n'));
    process.exit(0);
  }

  output(result);
}

function cmdStateGet(cwd, section, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    
    if (!section) {
      output({ content }, raw, content);
      return;
    }

    // Try to find markdown section or field
    const fieldEscaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Check for **field:** value
    const fieldPattern = new RegExp(`\\*\\*${fieldEscaped}:\\*\\*\\s*(.*)`, 'i');
    const fieldMatch = content.match(fieldPattern);
    if (fieldMatch) {
      output({ [section]: fieldMatch[1].trim() }, raw, fieldMatch[1].trim());
      return;
    }

    // Check for ## Section
    const sectionPattern = new RegExp(`##\\s*${fieldEscaped}\\s*\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
    const sectionMatch = content.match(sectionPattern);
    if (sectionMatch) {
      output({ [section]: sectionMatch[1].trim() }, raw, sectionMatch[1].trim());
      return;
    }

    output({ error: `Section or field "${section}" not found` }, raw, '');
  } catch {
    error('STATE.md not found');
  }
}

function cmdStatePatch(cwd, patches, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  try {
    let content = fs.readFileSync(statePath, 'utf-8');
    const results = { updated: [], failed: [] };

    for (const [field, value] of Object.entries(patches)) {
      const fieldEscaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(\\*\\*${fieldEscaped}:\\*\\*\\s*)(.*)`, 'i');
      
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${value}`);
        results.updated.push(field);
      } else {
        results.failed.push(field);
      }
    }

    if (results.updated.length > 0) {
      atomicWriteFileSync(statePath, content);
    }

    output(results, raw, results.updated.length > 0 ? 'true' : 'false');
  } catch {
    error('STATE.md not found');
  }
}

function cmdStateUpdate(cwd, field, value) {
  if (!field || value === undefined) {
    error('field and value required for state update');
  }

  const statePath = path.join(cwd, '.planning', 'STATE.md');
  try {
    let content = fs.readFileSync(statePath, 'utf-8');
    const fieldEscaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(\\*\\*${fieldEscaped}:\\*\\*\\s*)(.*)`, 'i');
    if (pattern.test(content)) {
      content = content.replace(pattern, `$1${value}`);
      atomicWriteFileSync(statePath, content);
      output({ updated: true });
    } else {
      output({ updated: false, reason: `Field "${field}" not found in STATE.md` });
    }
  } catch {
    output({ updated: false, reason: 'STATE.md not found' });
  }
}

// ─── State Progression Engine ────────────────────────────────────────────────

function stateExtractField(content, fieldName) {
  const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function stateReplaceField(content, fieldName, newValue) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(\\*\\*${escaped}:\\*\\*\\s*)(.*)`, 'i');
  if (pattern.test(content)) {
    return content.replace(pattern, `$1${newValue}`);
  }
  return null;
}

// Tolerant field replacer: tries the bold pattern first (unchanged behavior for
// bold-field STATE.md), falls back to a plain multiline `Field: value` line
// replacement. Returns null if neither pattern matched (matching stateReplaceField's
// existing null-on-no-match contract).
function stateReplaceFieldTolerant(content, fieldName, newValue) {
  const bold = stateReplaceField(content, fieldName, newValue);
  if (bold !== null) return bold;
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^\\s*${escaped}:\\s*).*$`, 'im');
  if (pattern.test(content)) {
    return content.replace(pattern, `$1${newValue}`);
  }
  return null;
}

// Composite parser for the real STATE.md "Plan: {N} of {M}{suffix}" line, which
// encodes both the current plan number and the total in a single plain-prose
// line (there is no separate bold "Total Plans in Phase" field in the real file).
function parsePlanProgressLine(content) {
  const pattern = /^\s*Plan:\s*(\d+)\s*of\s*(\d+)\s*(.*)$/im;
  const match = content.match(pattern);
  if (!match) return null;
  return {
    currentPlan: parseInt(match[1], 10),
    totalPlans: parseInt(match[2], 10),
    suffix: match[3].trim(),
    lineText: match[0],
  };
}

// Reconstructs and replaces the "Plan: {N} of {M}{suffix}" line, preserving the
// suffix prose verbatim (only the current-plan number is this command's job --
// the suffix's narrative text is not this command's responsibility to rewrite).
function replacePlanProgressLine(content, newCurrentPlan, totalPlans, suffix) {
  const pattern = /^\s*Plan:\s*(\d+)\s*of\s*(\d+)\s*(.*)$/im;
  if (!pattern.test(content)) return null;
  const newLine = `Plan: ${newCurrentPlan} of ${totalPlans}${suffix ? ' ' + suffix : ''}`;
  return content.replace(pattern, newLine);
}

// Plan counts of the phase STATE.md names ("Phase: 2 of 4 ..." / "**Current Phase:** 2"), from disk.
function stateDiskPlanCounts(cwd, content, phaseOverride) {
  const m = phaseOverride ? [null, String(phaseOverride)] : content.match(/^\s*(?:\*\*)?(?:Current )?Phase:(?:\*\*)?\s*(\d+(?:\.\d+)?)/im);
  if (!m) return null;
  const info = findPhaseInternal(cwd, m[1]);
  if (!info || !info.plans || info.plans.length === 0) return null;
  return { plans: info.plans.length, summaries: info.summaries.length };
}

function cmdStateAdvancePlan(cwd, raw, opts = {}) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];

  // Try the existing bold-field path FIRST -- if both bold fields parse to
  // valid numbers, keep the exact existing behavior unchanged (back-compat
  // with any STATE.md already using bold fields, and with existing tests).
  const boldCurrentPlan = parseInt(stateExtractField(content, 'Current Plan'), 10);
  const boldTotalPlans = parseInt(stateExtractField(content, 'Total Plans in Phase'), 10);

  if (!isNaN(boldCurrentPlan) && !isNaN(boldTotalPlans)) {
    const currentPlan = boldCurrentPlan;
    const totalPlans = boldTotalPlans;
    const boldDisk = stateDiskPlanCounts(cwd, content, opts.phase);

    if (currentPlan >= totalPlans || (boldDisk !== null && boldDisk.summaries >= boldDisk.plans)) {
      content = stateReplaceField(content, 'Status', 'Phase complete — ready for verification') || content;
      content = stateReplaceField(content, 'Last Activity', today) || content;
      atomicWriteFileSync(statePath, content);
      output({ advanced: false, reason: 'last_plan', current_plan: currentPlan, total_plans: totalPlans, status: 'ready_for_verification' }, raw, 'false');
    } else {
      const newPlan = currentPlan + 1;
      content = stateReplaceField(content, 'Current Plan', String(newPlan)) || content;
      content = stateReplaceField(content, 'Status', 'Ready to execute') || content;
      content = stateReplaceField(content, 'Last Activity', today) || content;
      atomicWriteFileSync(statePath, content);
      output({ advanced: true, previous_plan: currentPlan, current_plan: newPlan, total_plans: totalPlans }, raw, 'true');
    }
    return;
  }

  // Fall back to the real plain-prose "Plan: {N} of {M}{suffix}" line shape.
  // `phase complete` writes "Plan: Not started" and a plan-phase may leave no Plan line: the disk counts of the
  // named phase (--phase, else the Phase line) stand in. A line that is neither shape fails loudly, quoted.
  const disk = stateDiskPlanCounts(cwd, content, opts.phase);
  let parsed = parsePlanProgressLine(content);
  if (!parsed) {
    const planLine = (content.match(/^\s*Plan:.*$/im) || [null])[0];
    const unstarted = planLine === null || /^\s*Plan:\s*(?:not started|none|-|—)?\s*$/i.test(planLine);
    if (!disk || !unstarted) {
      output({ error: `Cannot parse STATE.md ${planLine === null ? 'no "Plan:" line found' : `line "${planLine.trim()}"`}: expected "Plan: N of M ..." or bold Current Plan and Total Plans in Phase fields${disk ? '' : ' (and no plans on disk for the phase named by --phase or the Phase line)'}` }, raw, undefined, 1);
      return;
    }
    const done = disk.summaries;
    const stub = `Plan: ${done} of ${disk.plans}`;
    content = planLine === null ? content.replace(/^(\s*Phase:.*)$/im, `$1\n${stub}`) : content.replace(/^\s*Plan:.*$/im, stub);
    parsed = { currentPlan: done, totalPlans: disk.plans, suffix: '' };
  } else if (opts.phase && disk) {
    // An explicit --phase is the caller's statement of which phase just advanced: the disk beats a stale Plan line.
    parsed = { currentPlan: disk.summaries, totalPlans: disk.plans, suffix: parsed.suffix };
  }

  const { currentPlan, totalPlans, suffix } = parsed;
  // Disk truth: every plan of the phase has a SUMMARY, so the counter's value is irrelevant, this was the last plan.
  const allExecuted = disk !== null && disk.summaries >= disk.plans;

  if (currentPlan >= totalPlans || allExecuted) {
    // Preserve the parsed suffix verbatim if it already indicates completion --
    // do not double up wording (e.g. "in current phase complete" appearing twice).
    const completionSuffix = /complete/i.test(suffix) && !allExecuted ? suffix : 'in current phase complete';
    content = replacePlanProgressLine(content, allExecuted ? totalPlans : currentPlan, totalPlans, completionSuffix) || content;
    content = stateReplaceFieldTolerant(content, 'Status', 'Phase complete — ready for verification') || content;
    content = stateReplaceFieldTolerant(content, 'Last activity', today) || content;
    atomicWriteFileSync(statePath, content);
    output({ advanced: false, reason: 'last_plan', current_plan: allExecuted ? totalPlans : currentPlan, total_plans: totalPlans, status: 'ready_for_verification' }, raw, 'false');
  } else {
    const newPlan = currentPlan + 1;
    // The old suffix narrates the plan just finished; with disk counts available restate it from them.
    const freshSuffix = disk ? `(${disk.summaries} of ${disk.plans} plans executed)` : suffix;
    content = replacePlanProgressLine(content, newPlan, totalPlans, freshSuffix) || content;
    content = stateReplaceFieldTolerant(content, 'Status', 'Ready to execute') || content;
    content = stateReplaceFieldTolerant(content, 'Last activity', today) || content;
    atomicWriteFileSync(statePath, content);
    output({ advanced: true, previous_plan: currentPlan, current_plan: newPlan, total_plans: totalPlans }, raw, 'true');
  }
}

function cmdStateRecordMetric(cwd, options, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const { phase, plan, duration, tasks, files } = options;

  if (!phase || !plan || !duration) {
    output({ error: 'phase, plan, and duration required' }, raw);
    return;
  }

  const newRow = `| Phase ${phase} P${plan} | ${duration} | ${tasks || '-'} tasks | ${files || '-'} files |`;
  const bump = (text) => text.replace(/(Total plans completed:\s*)(\d+)/i, (_m, h, n) => `${h}${Number(n) + 1}`);
  const TABLE_HEAD = '| Plan | Duration | Tasks | Files |\n|------|----------|-------|-------|';

  // Find Performance Metrics section and its table
  const metricsPattern = /(##\s*Performance Metrics[\s\S]*?\n\|[^\n]+\n\|[-|\s]+\n)([\s\S]*?)(?=\n##|\n$|$)/i;
  const metricsMatch = content.match(metricsPattern);

  if (metricsMatch) {
    const tableHeader = metricsMatch[1];
    let tableBody = metricsMatch[2].trimEnd();
    if (tableBody.trim() === '' || tableBody.includes('None yet')) {
      tableBody = newRow;
    } else {
      tableBody = tableBody + '\n' + newRow;
    }
    content = content.replace(metricsPattern, () => `${bump(tableHeader)}${tableBody}\n`);
    atomicWriteFileSync(statePath, content);
    output({ recorded: true, phase, plan, duration }, raw, 'true');
    return;
  }

  // The roadmapper writes a Velocity-only section (no table), and a hand-trimmed STATE.md may have none: create what is missing.
  const section = content.match(/^##\s*Performance Metrics[^\n]*\n[\s\S]*?(?=\n##\s|(?![\s\S]))/im);
  if (section) {
    const body = section[0].replace(/\n+$/, '');
    content = content.replace(section[0], () => `${bump(body)}\n\n${TABLE_HEAD}\n${newRow}\n`);
  } else {
    content = `${content.replace(/\n*$/, '\n')}\n## Performance Metrics\n\n**Velocity:**\n- Total plans completed: 1\n\n${TABLE_HEAD}\n${newRow}\n`;
  }
  atomicWriteFileSync(statePath, content);
  output({ recorded: true, phase, plan, duration, created_table: true }, raw, 'true');
}

// Roadmap phases (unchecked) that have no PLAN.md in any phase directory.
function countUnplannedRoadmapPhases(cwd) {
  let roadmap;
  try { roadmap = fs.readFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), 'utf-8'); } catch { return 0; }
  const nums = new Set();
  for (const m of roadmap.matchAll(/^#{2,4}\s*Phase\s+(\d+(?:\.\d+)?)\s*[:\u2014-]/gim)) nums.add(m[1]);
  let unplanned = 0;
  for (const n of nums) {
    const done = new RegExp(`^\\s*-\\s*\\[x\\].*Phase\\s+${n.replace('.', '\\.')}[:\\s]`, 'im').test(roadmap);
    if (done) continue;
    const info = findPhaseInternal(cwd, n);
    if (!info || !info.plans || info.plans.length === 0) unplanned++;
  }
  return unplanned;
}

function cmdStateUpdateProgress(cwd, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');

  // Count summaries across all phases
  const phasesDir = path.join(cwd, '.planning', 'phases');
  let totalPlans = 0;
  let totalSummaries = 0;

  if (fs.existsSync(phasesDir)) {
    const phaseDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
    for (const dir of phaseDirs) {
      const files = fs.readdirSync(path.join(phasesDir, dir));
      totalPlans += files.filter(f => f.match(/-PLAN\.md$/i)).length;
      totalSummaries += files.filter(f => f.match(/-SUMMARY\.md$/i)).length;
    }
  }

  // A roadmap phase with no plan on disk still has work: count it as one plan (a lower bound) so unplanned phases keep the percentage below 100.
  const unplannedPhases = countUnplannedRoadmapPhases(cwd);
  totalPlans += unplannedPhases;

  const percent = totalPlans > 0 ? Math.round(totalSummaries / totalPlans * 100) : 0;
  const barWidth = 10;
  const filled = Math.round(percent / 100 * barWidth);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
  const progressStr = `[${bar}] ${percent}%`;

  // Try the existing bold `**Progress:**` pattern first (unchanged behavior),
  // fall back to the real plain (non-bold) `Progress:` line.
  const boldProgressPattern = /(\*\*Progress:\*\*\s*).*/i;
  const plainProgressPattern = /^(\s*Progress:\s*).*/im;

  // Some projects track progress in a non-percentage convention (e.g.
  // "N/M phases \u00b7 N/M requirements (notes...)") instead of a "[bar] N%"
  // string. totalPlans/totalSummaries here counts PLAN.md/SUMMARY.md files
  // across every phase directory on disk -- an entirely different metric
  // from that convention. Blindly overwriting a non-percentage line with a
  // computed percentage silently destroys real content (observed: a
  // hand-maintained "1/22 phases * 1/32 requirements (...)" note replaced
  // with a bogus "103%"/"104%" on repeated calls). Detect this up front and
  // skip rather than guess -- callers that want the percent format can still
  // get it by writing an initial "[bar] N%"-shaped line themselves.
  const existingBoldMatch = content.match(/\*\*Progress:\*\*\s*(.*)/i);
  const existingPlainMatch = content.match(/^\s*Progress:\s*(.*)$/im);
  const existingValue = existingBoldMatch ? existingBoldMatch[1] : (existingPlainMatch ? existingPlainMatch[1] : null);
  const looksLikePercentFormat = existingValue === null
    || /^\s*$/.test(existingValue)
    || /\d+%/.test(existingValue);

  if (existingValue !== null && !looksLikePercentFormat) {
    output({
      updated: false,
      reason: 'Progress line uses a non-percentage format -- skipped to avoid overwriting it with a computed percentage. Update it manually or with a project-specific mutator.',
      existing: existingValue,
    }, raw, 'false');
    return;
  }

  if (boldProgressPattern.test(content)) {
    content = content.replace(boldProgressPattern, `$1${progressStr}`);
    atomicWriteFileSync(statePath, content);
    output({ updated: true, percent, completed: totalSummaries, total: totalPlans, unplanned_phases: unplannedPhases, bar: progressStr }, raw, progressStr);
  } else if (plainProgressPattern.test(content)) {
    content = content.replace(plainProgressPattern, `$1${progressStr}`);
    atomicWriteFileSync(statePath, content);
    output({ updated: true, percent, completed: totalSummaries, total: totalPlans, unplanned_phases: unplannedPhases, bar: progressStr }, raw, progressStr);
  } else {
    output({ updated: false, reason: 'Progress field not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateAddDecision(cwd, options, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  const { phase, summary, rationale } = options;
  if (!summary) { output({ error: 'summary required' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const entry = `- [Phase ${phase || '?'}]: ${summary}${rationale ? ` — ${rationale}` : ''}`;

  // Find Decisions section (various heading patterns)
  const sectionPattern = /(###?\s*(?:Decisions|Decisions Made|Accumulated.*Decisions)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    // Remove placeholders
    sectionBody = sectionBody.replace(/None yet\.?\s*\n?/gi, '').replace(/No decisions yet\.?\s*\n?/gi, '');
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, `${match[1]}${sectionBody}`);
    atomicWriteFileSync(statePath, content);
    output({ added: true, decision: entry }, raw, 'true');
  } else {
    output({ added: false, reason: 'Decisions section not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateAddBlocker(cwd, text, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }
  if (!text) { output({ error: 'text required' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const entry = `- ${text}`;

  const sectionPattern = /(###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    sectionBody = sectionBody.replace(/None\.?\s*\n?/gi, '').replace(/None yet\.?\s*\n?/gi, '');
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, `${match[1]}${sectionBody}`);
    atomicWriteFileSync(statePath, content);
    output({ added: true, blocker: text }, raw, 'true');
  } else {
    output({ added: false, reason: 'Blockers section not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateResolveBlocker(cwd, text, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }
  if (!text) { output({ error: 'text required' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');

  const sectionPattern = /(###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    const sectionBody = match[2];
    const lines = sectionBody.split('\n');
    const filtered = lines.filter(line => {
      if (!line.startsWith('- ')) return true;
      return !line.toLowerCase().includes(text.toLowerCase());
    });

    let newBody = filtered.join('\n');
    // If section is now empty, add placeholder
    if (!newBody.trim() || !newBody.includes('- ')) {
      newBody = 'None\n';
    }

    content = content.replace(sectionPattern, `${match[1]}${newBody}`);
    atomicWriteFileSync(statePath, content);
    output({ resolved: true, blocker: text }, raw, 'true');
  } else {
    output({ resolved: false, reason: 'Blockers section not found in STATE.md' }, raw, 'false');
  }
}

function cmdStateRecordSession(cwd, options, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) { output({ error: 'STATE.md not found' }, raw); return; }

  let content = fs.readFileSync(statePath, 'utf-8');
  const now = new Date().toISOString();
  const updated = [];

  // Update Last session / Last Date -- stateReplaceFieldTolerant (bold-first,
  // plain-prose-fallback, per the 51-01 STATE.md-tolerance convention) since
  // the real STATE.md's "## Session Continuity" section is plain prose
  // ("Last session: ..."), not bold ("**Last session:**"). The bold-only
  // stateReplaceField silently no-ops against the real file's shape.
  let result = stateReplaceFieldTolerant(content, 'Last session', now);
  if (result) { content = result; updated.push('Last session'); }
  result = stateReplaceFieldTolerant(content, 'Last Date', now);
  if (result) { content = result; updated.push('Last Date'); }

  // Update Stopped at
  if (options.stopped_at) {
    result = stateReplaceFieldTolerant(content, 'Stopped At', options.stopped_at);
    if (!result) result = stateReplaceFieldTolerant(content, 'Stopped at', options.stopped_at);
    if (result) { content = result; updated.push('Stopped At'); }
  }

  // Update Resume file
  const resumeFile = options.resume_file || 'None';
  result = stateReplaceFieldTolerant(content, 'Resume File', resumeFile);
  if (!result) result = stateReplaceFieldTolerant(content, 'Resume file', resumeFile);
  if (result) { content = result; updated.push('Resume File'); }

  if (updated.length > 0) {
    atomicWriteFileSync(statePath, content);
    output({ recorded: true, updated }, raw, 'true');
  } else {
    output({ recorded: false, reason: 'No session fields found in STATE.md' }, raw, 'false');
  }
}

function cmdResolveModel(cwd, agentType, raw) {
  if (!agentType) {
    error('agent-type required');
  }
  if (agentType === 'top' || agentType === 'top-fallback') {
    const t = topModelFields(cwd);
    const model = agentType === 'top' ? t.ruling_model : t.ruling_model_fallback;
    output({ model, role: agentType }, raw, model);
    return;
  }
  const model = resolveModelInternal(cwd, agentType);
  const result = ROLE_MODELS[agentType] || TOP_ROLES.has(agentType) ? { model } : { model, unknown_agent: true };
  output(result, raw, model);
}

function cmdFindPhase(cwd, phase, raw) {
  if (!phase) {
    error('phase identifier required');
  }

  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(phase);

  const notFound = { found: false, directory: null, phase_number: null, phase_name: null, plans: [], summaries: [] };

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    // Prefer exact match (e.g., "01-name") over prefix match (e.g., "01.1-name")
    // to prevent phase "1" resolving to "1.1" when both exist
    const exactMatch = dirs.find(d => d === normalized || d.startsWith(normalized + '-'));
    const prefixMatch = dirs.find(d => d.startsWith(normalized));
    const match = exactMatch || prefixMatch;
    if (!match) {
      output(notFound, raw, '');
      return;
    }

    const dirMatch = match.match(/^(\d+(?:\.\d+)?)-?(.*)/);
    const phaseNumber = dirMatch ? dirMatch[1] : normalized;
    const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;

    const phaseDir = path.join(phasesDir, match);
    const phaseFiles = fs.readdirSync(phaseDir);
    const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').sort();
    const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').sort();

    const result = {
      found: true,
      directory: path.join('.planning', 'phases', match),
      phase_number: phaseNumber,
      phase_name: phaseName,
      plans,
      summaries,
    };

    output(result, raw, result.directory);
  } catch {
    output(notFound, raw, '');
  }
}

const COMMIT_USAGE = 'Usage: gsd-tools commit "<message>" [--files <path...>] [--trailer "Token: value"]... [--amend] [--cwd <dir>]';

function cmdCommit(cwd, message, files, raw, amend, trailers = []) {
  if (!message && !amend) {
    error('commit message required');
  }
  const badTrailer = trailers.find(t => !/^[A-Za-z][A-Za-z0-9-]*:\s*\S/.test(t));
  if (badTrailer !== undefined) {
    error(`--trailer expects "Token: value", got: ${badTrailer}`);
  }
  if (amend && trailers.length > 0) {
    error('--trailer cannot be combined with --amend');
  }

  // Resolve the repo explicitly: the git toplevel of cwd must also hold the .planning this commit is about.
  const top = execGit(cwd, ['rev-parse', '--show-toplevel']);
  if (top.exitCode !== 0) {
    error(`commit: ${cwd} is not inside a git repository (pass --cwd <project> or cd into the project)`);
  }
  const repoRoot = top.stdout;
  if (!fs.existsSync(path.join(findProjectRoot(cwd), '.planning')) && !fs.existsSync(path.join(repoRoot, '.planning'))) {
    error(`commit: no .planning found in ${cwd} or above (git repo ${repoRoot}); pass --cwd <project> or cd into the project`);
  }
  const resolved = { repo_root: repoRoot };

  const config = loadConfig(cwd);

  // Check commit_docs config
  if (!config.commit_docs) {
    const result = { committed: false, hash: null, reason: 'skipped_commit_docs_false', ...resolved };
    output(result, raw, 'skipped');
    return;
  }

  // Check if .planning is gitignored
  if (isGitIgnored(cwd, '.planning')) {
    const result = { committed: false, hash: null, reason: 'skipped_gitignored', ...resolved };
    output(result, raw, 'skipped');
    return;
  }

  // Stage files
  const filesToStage = files && files.length > 0 ? files : ['.planning/'];
  for (const file of filesToStage) {
    execGit(cwd, ['add', file]);
  }

  // Nothing staged for these paths (including untracked clutter elsewhere) is an idempotent no-op, not a failure.
  if (!amend && execGit(cwd, ['diff', '--cached', '--quiet', '--', ...filesToStage]).exitCode === 0) {
    output({ committed: false, hash: null, reason: 'nothing_to_commit', ...resolved }, raw, 'nothing');
    return;
  }

  // Commit
  const commitArgs = amend
    ? ['commit', '--amend', '--no-edit']
    : ['commit', '-m', message, ...(trailers.length > 0 ? ['-m', trailers.join('\n')] : []), '--', ...filesToStage];
  const commitResult = execGit(cwd, commitArgs);
  if (commitResult.exitCode !== 0) {
    error(`commit: git commit failed in ${repoRoot}: ${commitResult.stderr || commitResult.stdout}`);
  }

  // Get short hash
  const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  const hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
  const result = { committed: true, hash, reason: 'committed', ...resolved };
  output(result, raw, hash || 'committed');
}

// Returns { status: 'passed'|'failed'|'not_found', source: 'self_check'|'legacy'|null }.
// The executor's contract is an explicit `## Self-Check: PASSED|FAILED` heading
// (last one wins, since it is appended); only that source counts as on-disk
// evidence for phase completion. Without it, falls back to the legacy
// Verification/Quality Check heuristic, which false-fails on any "fail" word.
function evaluateSummarySelfCheck(content) {
  const text = typeof content === 'string' ? content : '';
  const headings = [...text.matchAll(/^##[ \t]*Self[- ]?Check\b[^\n]*/gim)];
  if (headings.length > 0) {
    const last = headings[headings.length - 1];
    const rest = text.slice(last.index + last[0].length);
    const next = rest.search(/\n#{1,2}[ \t]/);
    const body = next >= 0 ? rest.slice(0, next) : rest;
    const heading = last[0];
    let status = 'not_found';
    // The verdict is the FIRST PASS/FAIL word on the heading line (`PASSED`, `(PASSED)`, `5/5 passed`); later words are free text; else the body decides.
    const word = (heading.replace(/^##[ \t]*Self[- ]?Check\b/i, '').match(/\b(?:FAIL(?:ED|S|URE)?|PASS(?:ED)?)\b|❌|✗|✅|✓/i) || [''])[0];
    if (/^(?:FAIL|❌|✗)/i.test(word)) status = 'failed';
    else if (/^(?:PASS|✅|✓)/i.test(word)) status = 'passed';
    else if (/\bFAILED\b|❌|✗/.test(body)) status = 'failed';
    else if (/\bPASSED\b|✅|✓/.test(body)) status = 'passed';
    return { status, source: 'self_check' };
  }
  const legacyPattern = /##\s*(?:Verification|Quality Check)/i;
  if (!legacyPattern.test(text)) return { status: 'not_found', source: null };
  const checkSection = text.slice(text.search(legacyPattern));
  if (/(?:fail|✗|❌|incomplete|blocked)/i.test(checkSection)) return { status: 'failed', source: 'legacy' };
  if (/(?:all\s+)?(?:pass|✓|✅|complete|succeeded)/i.test(checkSection)) return { status: 'passed', source: 'legacy' };
  return { status: 'not_found', source: 'legacy' };
}

function cmdVerifySummary(cwd, summaryPath, checkFileCount, raw) {
  if (!summaryPath) {
    error('summary-path required');
  }

  const fullPath = path.join(cwd, summaryPath);
  const checkCount = checkFileCount || 2;

  // Check 1: Summary exists
  if (!fs.existsSync(fullPath)) {
    const result = {
      passed: false,
      checks: {
        summary_exists: false,
        files_created: { checked: 0, found: 0, missing: [] },
        commits_exist: false,
        self_check: 'not_found',
      },
      errors: ['SUMMARY.md not found'],
    };
    output(result, raw, 'failed');
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const errors = [];

  // Check 2: Spot-check files mentioned in summary
  const mentionedFiles = new Set();
  const patterns = [
    /`([^`]+\.[a-zA-Z]+)`/g,
    /(?:Created|Modified|Added|Updated|Edited):\s*`?([^\s`]+\.[a-zA-Z]+)`?/gi,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const filePath = m[1];
      if (filePath && !filePath.startsWith('http') && filePath.includes('/')) {
        mentionedFiles.add(filePath);
      }
    }
  }

  const filesToCheck = Array.from(mentionedFiles).slice(0, checkCount);
  const missing = [];
  for (const file of filesToCheck) {
    if (!fs.existsSync(path.join(cwd, file))) {
      missing.push(file);
    }
  }

  // Check 3: Commits exist
  const commitHashPattern = /\b[0-9a-f]{7,40}\b/g;
  const hashes = content.match(commitHashPattern) || [];
  let commitsExist = false;
  if (hashes.length > 0) {
    for (const hash of hashes.slice(0, 3)) {
      const result = execGit(cwd, ['cat-file', '-t', hash]);
      if (result.exitCode === 0 && result.stdout === 'commit') {
        commitsExist = true;
        break;
      }
    }
  }

  // Check 4: Self-check section
  const selfCheck = evaluateSummarySelfCheck(content).status;

  if (missing.length > 0) errors.push('Missing files: ' + missing.join(', '));
  if (!commitsExist && hashes.length > 0) errors.push('Referenced commit hashes not found in git history');
  if (selfCheck === 'failed') errors.push('Self-check section indicates failure');

  const checks = {
    summary_exists: true,
    files_created: { checked: filesToCheck.length, found: filesToCheck.length - missing.length, missing },
    commits_exist: commitsExist,
    self_check: selfCheck,
  };

  const passed = missing.length === 0 && selfCheck !== 'failed';
  const result = { passed, checks, errors };
  output(result, raw, passed ? 'passed' : 'failed');
}

function cmdTemplateSelect(cwd, planPath, raw) {
  if (!planPath) {
    error('plan-path required');
  }

  try {
    const fullPath = path.join(cwd, planPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    // Simple heuristics
    const taskMatch = content.match(/###\s*Task\s*\d+/g) || [];
    const taskCount = taskMatch.length;
    
    const decisionMatch = content.match(/decision/gi) || [];
    const hasDecisions = decisionMatch.length > 0;
    
    // Count file mentions
    const fileMentions = new Set();
    const filePattern = /`([^`]+\.[a-zA-Z]+)`/g;
    let m;
    while ((m = filePattern.exec(content)) !== null) {
      if (m[1].includes('/') && !m[1].startsWith('http')) {
        fileMentions.add(m[1]);
      }
    }
    const fileCount = fileMentions.size;

    let template = 'templates/summary-standard.md';
    let type = 'standard';

    if (taskCount <= 2 && fileCount <= 3 && !hasDecisions) {
      template = 'templates/summary-minimal.md';
      type = 'minimal';
    } else if (hasDecisions || fileCount > 6 || taskCount > 5) {
      template = 'templates/summary-complex.md';
      type = 'complex';
    }

    const result = { template, type, taskCount, fileCount, hasDecisions };
    output(result, raw, template);
  } catch (e) {
    // Fallback to standard
    output({ template: 'templates/summary-standard.md', type: 'standard', error: e.message }, raw, 'templates/summary-standard.md');
  }
}

function cmdTemplateFill(cwd, templateType, options, raw) {
  if (!templateType) { error('template type required: summary, plan, or verification'); }
  if (!options.phase) { error('--phase required'); }

  const phaseInfo = findPhaseInternal(cwd, options.phase);
  if (!phaseInfo || !phaseInfo.found) { output({ error: 'Phase not found', phase: options.phase }, raw); return; }

  const padded = normalizePhaseName(options.phase);
  const today = new Date().toISOString().split('T')[0];
  const phaseName = options.name || phaseInfo.phase_name || 'Unnamed';
  const phaseSlug = phaseInfo.phase_slug || generateSlugInternal(phaseName);
  const phaseId = `${padded}-${phaseSlug}`;
  const planNum = (options.plan || '01').padStart(2, '0');
  const fields = options.fields || {};

  let frontmatter, body, fileName;

  switch (templateType) {
    case 'summary': {
      frontmatter = {
        phase: phaseId,
        plan: planNum,
        subsystem: '[primary category]',
        tags: [],
        provides: [],
        affects: [],
        'tech-stack': { added: [], patterns: [] },
        'key-files': { created: [], modified: [] },
        'key-decisions': [],
        'patterns-established': [],
        duration: '[X]min',
        completed: today,
        ...fields,
      };
      body = [
        `# Phase ${options.phase}: ${phaseName} Summary`,
        '',
        '**[Substantive one-liner describing outcome]**',
        '',
        '## Performance',
        '- **Duration:** [time]',
        '- **Tasks:** [count completed]',
        '- **Files modified:** [count]',
        '',
        '## Accomplishments',
        '- [Key outcome 1]',
        '- [Key outcome 2]',
        '',
        '## Task Commits',
        '1. **Task 1: [task name]** - `hash`',
        '',
        '## Files Created/Modified',
        '- `path/to/file.ts` - What it does',
        '',
        '## Decisions & Deviations',
        '[Key decisions or "None - followed plan as specified"]',
        '',
        '## Next Phase Readiness',
        '[What\'s ready for next phase]',
      ].join('\n');
      fileName = `${padded}-${planNum}-SUMMARY.md`;
      break;
    }
    case 'plan': {
      const planType = options.type || 'execute';
      const wave = parseInt(options.wave) || 1;
      frontmatter = {
        phase: phaseId,
        plan: planNum,
        type: planType,
        wave,
        depends_on: [],
        files_modified: [],
        autonomous: true,
        user_setup: [],
        must_haves: { truths: [], artifacts: [], key_links: [] },
        ...fields,
      };
      body = [
        `# Phase ${options.phase} Plan ${planNum}: [Title]`,
        '',
        '## Objective',
        '- **What:** [What this plan builds]',
        '- **Why:** [Why it matters for the phase goal]',
        '- **Output:** [Concrete deliverable]',
        '',
        '## Context',
        '@.planning/PROJECT.md',
        '@.planning/ROADMAP.md',
        '@.planning/STATE.md',
        '',
        '## Tasks',
        '',
        '<task type="code">',
        '  <name>[Task name]</name>',
        '  <files>[file paths]</files>',
        '  <action>[What to do]</action>',
        '  <verify>[How to verify]</verify>',
        '  <done>[Definition of done]</done>',
        '</task>',
        '',
        '## Verification',
        '[How to verify this plan achieved its objective]',
        '',
        '## Success Criteria',
        '- [ ] [Criterion 1]',
        '- [ ] [Criterion 2]',
      ].join('\n');
      fileName = `${padded}-${planNum}-PLAN.md`;
      break;
    }
    case 'verification': {
      frontmatter = {
        phase: phaseId,
        verified: new Date().toISOString(),
        status: 'pending',
        ...fields,
      };
      body = [
        `# Phase ${options.phase}: ${phaseName} — Verification`,
        '',
        '## Observable Truths',
        '| # | Truth | Status | Evidence |',
        '|---|-------|--------|----------|',
        '| 1 | [Truth] | pending | |',
        '',
        '## Required Artifacts',
        '| Artifact | Expected | Status | Details |',
        '|----------|----------|--------|---------|',
        '| [path] | [what] | pending | |',
        '',
        '## Key Link Verification',
        '| From | To | Via | Status | Details |',
        '|------|----|----|--------|---------|',
        '| [source] | [target] | [connection] | pending | |',
        '',
        '## Requirements Coverage',
        '| Requirement | Status | Blocking Issue |',
        '|-------------|--------|----------------|',
        '| [req] | pending | |',
        '',
        '## Result',
        '[Pending verification]',
      ].join('\n');
      fileName = `${padded}-VERIFICATION.md`;
      break;
    }
    default:
      error(`Unknown template type: ${templateType}. Available: summary, plan, verification`);
      return;
  }

  const fullContent = `---\n${reconstructFrontmatter(frontmatter)}\n---\n\n${body}\n`;
  const outPath = path.join(cwd, phaseInfo.directory, fileName);

  if (fs.existsSync(outPath)) {
    output({ error: 'File already exists', path: path.relative(cwd, outPath) }, raw);
    return;
  }

  fs.writeFileSync(outPath, fullContent, 'utf-8');
  const relPath = path.relative(cwd, outPath);
  output({ created: true, path: relPath, template: templateType }, raw, relPath);
}

function phaseNum(planId) { return String(planId).split('-')[0]; }

function cmdPhasePlanIndex(cwd, phase, raw) {
  if (!phase) {
    error('phase required for phase-plan-index');
  }

  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(phase);

  // Find phase directory
  let phaseDir = null;
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    const match = dirs.find(d => d.startsWith(normalized));
    if (match) {
      phaseDir = path.join(phasesDir, match);
    }
  } catch {
    // phases dir doesn't exist
  }

  if (!phaseDir) {
    output({ phase: normalized, error: 'Phase not found', plans: [], waves: {}, incomplete: [], has_checkpoints: false }, raw);
    return;
  }

  // Get all files in phase directory
  const phaseFiles = fs.readdirSync(phaseDir);
  const planFiles = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').sort();
  const summaryFiles = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');

  // Build set of plan IDs with summaries
  const completedPlanIds = new Set(
    summaryFiles.map(s => s.replace('-SUMMARY.md', '').replace('SUMMARY.md', ''))
  );

  const plans = [];
  const waves = {};
  const incomplete = [];
  let hasCheckpoints = false;
  // Spike runs one executor per plan, on its highest task tag but never below the executor floor; other rigours route per task.
  const spikeFloor = rigour.resolveRigour(cwd, normalized, getMilestoneInfo(cwd).version).rigour === 'spike' ? executorModelFor(cwd, normalized) : null;

  for (const planFile of planFiles) {
    const planId = planFile.replace('-PLAN.md', '').replace('PLAN.md', '');
    const planPath = path.join(phaseDir, planFile);
    const content = fs.readFileSync(planPath, 'utf-8');
    const fm = extractFrontmatter(content);

    // Same task grammar as `verify plan-structure`: <task> elements; legacy `## Task N` headings as fallback
    const xmlTasks = content.match(/<task[\s>]/g) || [];
    const taskCount = xmlTasks.length || (content.match(/##\s*Task\s*\d+/gi) || []).length;
    const objectiveTag = content.match(/<objective>([\s\S]*?)<\/objective>/);
    const objective = fm.objective || (objectiveTag ? (objectiveTag[1].trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ')) : null);

    // Parse wave as integer
    const wave = parseInt(fm.wave, 10) || 1;

    // Parse autonomous (default true if not specified)
    let autonomous = true;
    if (fm.autonomous !== undefined) {
      autonomous = fm.autonomous === 'true' || fm.autonomous === true;
    }

    if (!autonomous) {
      hasCheckpoints = true;
    }

    // Parse files-modified
    let filesModified = [];
    const rawFiles = fm.files_modified !== undefined ? fm.files_modified : fm['files-modified'];
    if (rawFiles) {
      filesModified = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    }

    const hasSummary = completedPlanIds.has(planId);
    if (!hasSummary) {
      incomplete.push(planId);
    }

    const plan = {
      id: planId,
      wave,
      autonomous,
      objective,
      files_modified: filesModified,
      task_count: taskCount,
      task_tiers: Array.from({ length: Math.max(taskCount, formCheck.planTasks(content).length) }, (_, i) => (formCheck.planTasks(content).map(formCheck.routedTier)[i] || formCheck.DEFAULT_TIER)),
      has_summary: hasSummary,
      gap_closure: fm.gap_closure === true || fm.gap_closure === 'true',
      executor_model: spikeFloor ? formCheck.TIERS[Math.max(formCheck.TIERS.indexOf(spikeFloor), formCheck.TIERS.indexOf(formCheck.highestTier(formCheck.planTasks(content))))] : null,
      depends_on: Array.isArray(fm.depends_on) ? fm.depends_on.map(String) : (fm.depends_on ? [String(fm.depends_on)] : []),
    };

    plans.push(plan);
  }

  // A plan runs after everything it depends_on, whatever its declared wave says.
  const planByKey = new Map();
  for (const p of plans) {
    planByKey.set(p.id, p);
    planByKey.set(p.id.replace(/^\d+-/, ''), p);
    planByKey.set(`${phaseNum(p.id)}-${p.id.replace(/^\d+-/, '')}`, p);
  }
  const resolving = new Set();
  const effectiveWave = (p) => {
    if (p.effective_wave) return p.effective_wave;
    if (resolving.has(p.id)) return p.wave;
    resolving.add(p.id);
    let w = p.wave;
    for (const dep of p.depends_on) {
      const target = planByKey.get(String(dep).replace(/-PLAN(\.md)?$/i, ''));
      if (target && target !== p) w = Math.max(w, effectiveWave(target) + 1);
    }
    resolving.delete(p.id);
    p.effective_wave = w;
    return w;
  };
  for (const p of plans) {
    p.declared_wave = p.wave;
    p.wave = effectiveWave(p);
    delete p.effective_wave;
    const waveKey = String(p.wave);
    if (!waves[waveKey]) waves[waveKey] = [];
    waves[waveKey].push(p.id);
  }

  const result = {
    phase: normalized,
    plans,
    waves,
    incomplete,
    has_checkpoints: hasCheckpoints,
  };

  output(result, raw);
}

function cmdStateSnapshot(cwd, raw) {
  const statePath = path.join(cwd, '.planning', 'STATE.md');

  if (!fs.existsSync(statePath)) {
    output({ error: 'STATE.md not found' }, raw);
    return;
  }

  const content = fs.readFileSync(statePath, 'utf-8');

  // Helper to extract **Field:** value patterns
  const extractField = (fieldName) => {
    const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
    const match = content.match(pattern);
    return match ? match[1].trim() : null;
  };

  // Extract basic fields
  const currentPhase = extractField('Current Phase');
  const currentPhaseName = extractField('Current Phase Name');
  const totalPhasesRaw = extractField('Total Phases');
  const currentPlan = extractField('Current Plan');
  const totalPlansRaw = extractField('Total Plans in Phase');
  const status = extractField('Status');
  const progressRaw = extractField('Progress');
  const lastActivity = extractField('Last Activity');
  const lastActivityDesc = extractField('Last Activity Description');
  const pausedAt = extractField('Paused At');

  // Parse numeric fields
  const totalPhases = totalPhasesRaw ? parseInt(totalPhasesRaw, 10) : null;
  const totalPlansInPhase = totalPlansRaw ? parseInt(totalPlansRaw, 10) : null;
  const progressPercent = progressRaw ? parseInt(progressRaw.replace('%', ''), 10) : null;

  // Extract decisions table
  const decisions = [];
  const decisionsMatch = content.match(/##\s*Decisions Made[\s\S]*?\n\|[^\n]+\n\|[-|\s]+\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (decisionsMatch) {
    const tableBody = decisionsMatch[1];
    const rows = tableBody.trim().split('\n').filter(r => r.includes('|'));
    for (const row of rows) {
      const cells = splitRowCells(row).filter(Boolean);
      if (cells.length >= 3) {
        decisions.push({
          phase: cells[0],
          summary: cells[1],
          rationale: cells[2],
        });
      }
    }
  }

  // Extract blockers list
  const blockers = [];
  const blockersMatch = content.match(/##\s*Blockers\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (blockersMatch) {
    const blockersSection = blockersMatch[1];
    const items = blockersSection.match(/^-\s+(.+)$/gm) || [];
    for (const item of items) {
      blockers.push(item.replace(/^-\s+/, '').trim());
    }
  }

  // Extract session info
  const session = {
    last_date: null,
    stopped_at: null,
    resume_file: null,
  };

  const sessionMatch = content.match(/##\s*Session\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (sessionMatch) {
    const sessionSection = sessionMatch[1];
    const lastDateMatch = sessionSection.match(/\*\*Last Date:\*\*\s*(.+)/i);
    const stoppedAtMatch = sessionSection.match(/\*\*Stopped At:\*\*\s*(.+)/i);
    const resumeFileMatch = sessionSection.match(/\*\*Resume File:\*\*\s*(.+)/i);

    if (lastDateMatch) session.last_date = lastDateMatch[1].trim();
    if (stoppedAtMatch) session.stopped_at = stoppedAtMatch[1].trim();
    if (resumeFileMatch) session.resume_file = resumeFileMatch[1].trim();
  }

  const result = {
    current_phase: currentPhase,
    current_phase_name: currentPhaseName,
    total_phases: totalPhases,
    current_plan: currentPlan,
    total_plans_in_phase: totalPlansInPhase,
    status,
    progress_percent: progressPercent,
    last_activity: lastActivity,
    last_activity_desc: lastActivityDesc,
    decisions,
    blockers,
    paused_at: pausedAt,
    session,
  };

  output(result, raw);
}

function cmdGatePrePr(cwd, args, raw) {
  const markPassed = args.includes('--mark-passed');
  const planningDir = path.join(cwd, '.planning');
  const execLogPath = path.join(planningDir, 'EXECUTION_LOG.md');

  if (markPassed) {
    // Write gate passed marker to execution log
    const event = JSON.stringify({
      type: 'gate_pre_pr_passed',
      timestamp: new Date().toISOString(),
      checks_passed: true
    });
    fs.appendFileSync(execLogPath, event + '\n');
    output({ gate: 'pre-pr', passed: true, marked: true }, raw);
    return;
  }

  // Check if execution log exists
  if (!fs.existsSync(execLogPath)) {
    output({ error: 'No EXECUTION_LOG.md found. Run execute-roadmap first.', gate: 'pre-pr', passed: false }, raw);
    process.exit(1);
  }

  // Check all phases are complete
  const logContent = fs.readFileSync(execLogPath, 'utf-8');
  const lines = logContent.split('\n').filter(l => l.trim().startsWith('{'));

  // Set comparison by phase id: every phase the run started, parked or failed must have a
  // phase_complete event AND on-disk truth. A phase started twice (retry, respawn) needs one complete.
  const incomplete = dispatch.incompletePhases(readExecutionEvents(cwd), makeTruthFn(cwd));
  if (incomplete.length > 0) {
    output({
      error: `Incomplete phases: ${incomplete.join(', ')}. All started phases must be verified complete (event and on-disk evidence) before PR; parked or failed phases mean no PR.`,
      gate: 'pre-pr',
      passed: false,
      incomplete_phases: incomplete
    }, raw);
    process.exit(1);
  }

  // Check for existing gate marker
  const hasGateMarker = lines.some(l => {
    try { return JSON.parse(l).type === 'gate_pre_pr_passed'; } catch { return false; }
  });

  if (hasGateMarker) {
    output({ gate: 'pre-pr', passed: true, cached: true, message: 'Gate already passed in this execution.', form_debt: milestoneFormDebt(cwd) }, raw);
    return;
  }

  // Derive checks from project type
  const { checks, degraded, notice, detected_types } = deriveCheckSet(cwd);

  const result = {
    gate: 'pre-pr',
    passed: false,
    action_required: true,
    checks,
    instructions: 'Run each check. If ALL pass, call: gsd-tools gate pre-pr --mark-passed. If any fail, fix and re-run.',
    mark_command: 'node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr --mark-passed',
    detected_types,
    form_debt: milestoneFormDebt(cwd),
  };
  if (degraded) {
    result.degraded = true;
    result.notice = notice;
  }
  output(result, raw);
}

function cmdSummaryExtract(cwd, summaryPath, fields, raw) {
  if (!summaryPath) {
    error('summary-path required for summary-extract');
  }

  const fullPath = path.join(cwd, summaryPath);

  if (!fs.existsSync(fullPath)) {
    output({ error: 'File not found', path: summaryPath }, raw);
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const fm = extractFrontmatter(content);

  // Parse key-decisions into structured format
  const parseDecisions = (decisionsList) => {
    if (!decisionsList || !Array.isArray(decisionsList)) return [];
    return decisionsList.map(d => {
      const colonIdx = d.indexOf(':');
      if (colonIdx > 0) {
        return {
          summary: d.substring(0, colonIdx).trim(),
          rationale: d.substring(colonIdx + 1).trim(),
        };
      }
      return { summary: d, rationale: null };
    });
  };

  // Build full result
  const fullResult = {
    path: summaryPath,
    one_liner: fm['one-liner'] || null,
    key_files: fm['key-files'] || [],
    tech_added: (fm['tech-stack'] && fm['tech-stack'].added) || [],
    patterns: fm['patterns-established'] || [],
    decisions: parseDecisions(fm['key-decisions']),
  };

  // If fields specified, filter to only those fields
  if (fields && fields.length > 0) {
    const filtered = { path: summaryPath };
    for (const field of fields) {
      if (fullResult[field] !== undefined) {
        filtered[field] = fullResult[field];
      }
    }
    output(filtered, raw);
    return;
  }

  output(fullResult, raw);
}

// ─── Knowledge Commands ──────────────────────────────────────────────────────

function cmdKnowledgeStatus(args, raw) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';
  const { knowledge } = require('./knowledge.js');

  const status = knowledge.isAvailable(scope);
  const result = {
    scope,
    available: status.available,
    reason: status.reason || null,
    db_path: status.available ? require('./knowledge-db.js').getDBPath(scope) : null
  };

  output(result, raw);
}

async function cmdKnowledgeAdd(cwd, args, raw) {
  const content = args[0];
  if (!content) {
    error('knowledge add: content required');
  }

  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'summary';
  const ttl = args.includes('--ttl') ? args[args.indexOf('--ttl') + 1] : null;

  const { resolveProjectSlug } = require('./knowledge-writer.js');
  const project_slug = resolveProjectSlug(cwd);

  // Generate an embedding so manually-added entries are semantic-search
  // reachable, same as any other knowledge insert. Falls back to null on
  // failure — never blocks the add.
  let embedding = null;
  try {
    const { generateEmbeddingCached } = require('./embeddings.js');
    embedding = await generateEmbeddingCached(content);
  } catch (_) { /* embeddings unavailable — fall back to null */ }

  const { knowledge } = require('./knowledge.js');
  const result = knowledge.add({
    content,
    type,
    scope,
    ttlCategory: ttl,
    embedding,
    project_slug
  });

  output(result, raw);
}

function cmdKnowledgeSearch(args, raw) {
  const query = args[0];
  if (!query) {
    error('knowledge search: query required');
  }

  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;
  const project_slug = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;

  const { knowledge } = require('./knowledge.js');
  const results = knowledge.search(query, { scope, limit, project_slug });

  output(results, raw);
}

function cmdKnowledgeGet(args, raw) {
  const id = parseInt(args[0]);
  if (isNaN(id)) {
    error('knowledge get: id required (integer)');
  }

  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  const { knowledge } = require('./knowledge.js');
  const result = knowledge.get(id, scope);

  output(result, raw);
}

function cmdKnowledgeDelete(args, raw) {
  const id = parseInt(args[0]);
  if (isNaN(id)) {
    error('knowledge delete: id required (integer)');
  }

  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  const { knowledge } = require('./knowledge.js');
  const result = knowledge.delete(id, scope);

  output(result, raw);
}

function cmdKnowledgeCleanup(args, raw) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  const { knowledge } = require('./knowledge.js');
  const result = knowledge.cleanup(scope);

  output(result, raw);
}

function cmdKnowledgePrune(args, raw) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'global';
  const dryRun = args.includes('--dry-run');
  const threshold = args.includes('--threshold')
    ? parseFloat(args[args.indexOf('--threshold') + 1])
    : 0.7;

  const { knowledge } = require('./knowledge.js');
  const { pruneStaleEntries, checkpointWAL } = require('./knowledge-lifecycle.js');

  const conn = knowledge._getConnection(scope);
  if (conn.available === false) {
    error('knowledge prune: DB unavailable — ' + (conn.reason || 'unknown'));
  }

  const result = pruneStaleEntries(conn.db, {
    threshold,
    scope,
    dryRun,
    vectorEnabled: conn.vectorEnabled || false
  });

  // Always checkpoint the WAL after a live prune, regardless of delete count.
  // Skip in dry-run mode — dry-run must not mutate WAL state.
  if (!dryRun) {
    checkpointWAL(conn.db);
  }

  const summary = {
    mode: dryRun ? 'dry-run' : 'live',
    scope,
    threshold,
    candidates: result.candidates,
    deleted: result.deleted,
    entries: result.entries.map(e => ({
      id: e.id,
      type: e.type,
      staleness_score: e.staleness_score,
      dormant_days: Math.round(e.dormant_days),
      access_count: e.access_count
    }))
  };

  output(summary, raw);
}

function cmdKnowledgeStats(cwd, args, raw) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'global';

  const { knowledge } = require('./knowledge.js');
  const dbStats = knowledge.getStats({ scope });

  // Load configured thresholds so users can see what's active
  let thresholds;
  try {
    const { readKnowledgeConfig, KNOWLEDGE_DEFAULTS } = require('./knowledge-writer.js');
    thresholds = readKnowledgeConfig(cwd);
    thresholds._defaults = KNOWLEDGE_DEFAULTS;
    thresholds._from_config = (
      thresholds.dedupThreshold !== KNOWLEDGE_DEFAULTS.dedupThreshold ||
      thresholds.evolutionThreshold !== KNOWLEDGE_DEFAULTS.evolutionThreshold
    );
  } catch (_) {
    thresholds = { dedupThreshold: 0.88, evolutionThreshold: 0.65, _from_config: false };
  }

  // Aggregate totals across types
  const totals = (dbStats || []).reduce((acc, row) => {
    acc.total_count += row.total_count || 0;
    acc.total_accesses += row.total_accesses || 0;
    return acc;
  }, { total_count: 0, total_accesses: 0 });

  output({
    scope,
    thresholds: {
      dedup_threshold: thresholds.dedupThreshold,
      evolution_threshold: thresholds.evolutionThreshold,
      source: thresholds._from_config ? 'config.json' : 'defaults'
    },
    totals,
    by_type: dbStats || [],
    hint: 'Set knowledge.dedup_threshold / knowledge.evolution_threshold in .planning/config.json to tune. Enable GSD_DEBUG=1 to log per-entry dedup decisions.'
  }, raw);
}

// Manual backstop for milestone knowledge consolidation. Calls the exact same
// synthesizePrinciples() function the automatic complete-milestone.md
// `consolidate_knowledge` step calls — never a parallel implementation.
// --principles '<json array>' lets a caller with real Haiku-synthesized text
// (i.e. the workflow step, AFTER it has spawned Agent() calls per cluster)
// feed that text into this same function. Without --principles, every cluster
// falls back to the stub inside synthesizePrinciples — useful for ad hoc
// manual exercising of clustering/confidence/conflict-detection logic.
async function cmdKnowledgeConsolidate(cwd, args, raw) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'global';

  let principlesByTopic = null;
  if (args.includes('--principles')) {
    const rawPrinciplesJson = args[args.indexOf('--principles') + 1];
    try {
      const parsed = JSON.parse(rawPrinciplesJson);
      if (Array.isArray(parsed)) {
        principlesByTopic = {};
        for (const p of parsed) {
          if (p && p.topic) principlesByTopic[p.topic] = p.text;
        }
      }
    } catch (_) {
      // Malformed --principles JSON: proceed with no synthesizer override.
      principlesByTopic = null;
    }
  }

  const { knowledge } = require('./knowledge.js');
  const conn = knowledge._getConnection(scope);
  if (conn.available === false) {
    error('knowledge consolidate: DB unavailable — ' + (conn.reason || 'unknown'));
  }

  const { synthesizePrinciples } = require('./knowledge-synthesis.js');
  const synthesizeFn = principlesByTopic
    ? (cluster) => principlesByTopic[cluster.topic]
    : undefined;

  const result = await synthesizePrinciples(conn, {}, synthesizeFn);
  output(result, raw);
}

// ─── Emergency Stop & Budget ─────────────────────────────────────────────────

function cmdPause(args, raw) {
  const reason = args.includes('--reason') ? args[args.indexOf('--reason') + 1] : 'user_requested';
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  const { knowledge } = require('./knowledge.js');
  const { enableCircuitBreaker } = require('./knowledge-cost.js');

  const conn = knowledge._getConnection(scope);
  if (!conn.available) {
    error(`Knowledge system not available: ${conn.reason}`);
  }

  enableCircuitBreaker(conn.db, reason);

  output({ paused: true, reason }, raw, 'Emergency stop enabled. Costly and external actions will be blocked.');
}

function cmdResume(args, raw) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  const { knowledge } = require('./knowledge.js');
  const { disableCircuitBreaker } = require('./knowledge-cost.js');

  const conn = knowledge._getConnection(scope);
  if (!conn.available) {
    error(`Knowledge system not available: ${conn.reason}`);
  }

  disableCircuitBreaker(conn.db);

  output({ resumed: true }, raw, 'Emergency stop disabled. Normal operation resumed.');
}

function cmdBudget(args, raw) {
  const period = args.includes('--period') ? args[args.indexOf('--period') + 1] : 'daily';
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  if (period !== 'daily' && period !== 'weekly') {
    error('budget: period must be "daily" or "weekly"');
  }

  const { knowledge } = require('./knowledge.js');
  const { getTotalCost, getBudgetLimit, getStartOfPeriod, hasAlertFired } = require('./knowledge-cost.js');

  const conn = knowledge._getConnection(scope);
  if (!conn.available) {
    error(`Knowledge system not available: ${conn.reason}`);
  }

  const totalCost = getTotalCost(conn.db, period);
  const limit = getBudgetLimit(period);
  const percent = limit > 0 ? ((totalCost / limit) * 100).toFixed(1) : 0;
  const periodStart = getStartOfPeriod(period);

  // Check which alerts have fired
  const ALERT_THRESHOLDS = [0.5, 0.8, 0.9, 1.0];
  const firedLevels = [];
  for (const threshold of ALERT_THRESHOLDS) {
    if (hasAlertFired(conn.db, threshold, periodStart)) {
      firedLevels.push(`${(threshold * 100).toFixed(0)}%`);
    }
  }

  if (raw) {
    output({
      period,
      spent: totalCost,
      limit,
      percent: parseFloat(percent),
      alerts_fired: firedLevels
    }, raw);
  } else {
    console.log(`\n=== Budget Status (${period}) ===\n`);
    console.log(`Spent: $${totalCost.toFixed(2)} / $${limit.toFixed(2)} (${percent}%)`);
    if (firedLevels.length > 0) {
      console.log(`Alerts fired: ${firedLevels.join(', ')}`);
    }
  }
}

// ─── Principle Feedback ──────────────────────────────────────────────────────

function cmdMarkWrong(args, raw) {
  const id = parseInt(args[0]);
  if (isNaN(id)) {
    error('mark-wrong: principle-id required (integer)');
  }

  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';
  const severity = args.includes('--severity') ? args[args.indexOf('--severity') + 1] : 'minor';
  const reason = args.includes('--reason') ? args[args.indexOf('--reason') + 1] : null;

  if (!['minor', 'major', 'critical'].includes(severity)) {
    error('mark-wrong: severity must be "minor", "major", or "critical"');
  }

  const { knowledge } = require('./knowledge.js');
  const { markPrincipleWrong } = require('./knowledge-feedback.js');

  const conn = knowledge._getConnection(scope);
  if (!conn.available) {
    error(`Knowledge system not available: ${conn.reason}`);
  }

  const result = markPrincipleWrong(conn.db, id, { severity, reason });

  output(result, raw);
}

async function cmdMarkOutdated(args, raw) {
  const id = parseInt(args[0]);
  if (isNaN(id)) {
    error('mark-outdated: principle-id required (integer)');
  }

  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';
  const replacement = args.includes('--replacement') ? args[args.indexOf('--replacement') + 1] : null;

  const { knowledge } = require('./knowledge.js');
  const { markPrincipleOutdated, createReplacementPrinciple } = require('./knowledge-feedback.js');

  const conn = knowledge._getConnection(scope);
  if (!conn.available) {
    error(`Knowledge system not available: ${conn.reason}`);
  }

  const result = markPrincipleOutdated(conn.db, id);

  if (replacement) {
    const replacementResult = await createReplacementPrinciple(conn.db, id, replacement);
    result.replacement_id = replacementResult.new_principle_id;
  }

  output(result, raw);
}

function cmdPrincipleHistory(args, raw) {
  const id = parseInt(args[0]);
  if (isNaN(id)) {
    error('principle-history: principle-id required (integer)');
  }

  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  const { knowledge } = require('./knowledge.js');
  const { getPrincipleFeedbackHistory } = require('./knowledge-feedback.js');

  const conn = knowledge._getConnection(scope);
  if (!conn.available) {
    error(`Knowledge system not available: ${conn.reason}`);
  }

  const history = getPrincipleFeedbackHistory(conn.db, id);

  if (raw) {
    output({ principle_id: id, history }, raw);
  } else {
    console.log(`\n=== Feedback History for Principle ${id} ===\n`);
    if (history.length === 0) {
      console.log('No feedback recorded.');
    } else {
      for (const event of history) {
        console.log(`Type: ${event.event_type}`);
        console.log(`Date: ${new Date(event.created_at).toISOString()}`);
        console.log(`Severity: ${event.severity || 'N/A'}`);
        console.log(`Reason: ${event.reason || 'N/A'}`);
        console.log('---');
      }
    }
  }
}

function cmdPendingReplacements(args, raw) {
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'project';

  const { knowledge } = require('./knowledge.js');
  const { getPendingReplacements } = require('./knowledge-feedback.js');

  const conn = knowledge._getConnection(scope);
  if (!conn.available) {
    error(`Knowledge system not available: ${conn.reason}`);
  }

  const pending = getPendingReplacements(conn.db);

  if (raw) {
    output({ pending }, raw);
  } else {
    console.log('\n=== Principles Needing Replacement ===\n');
    if (pending.length === 0) {
      console.log('No pending replacements.');
    } else {
      for (const item of pending) {
        console.log(`ID: ${item.id}`);
        console.log(`Content: ${item.content.substring(0, 100)}...`);
        console.log(`Confidence: ${item.confidence}`);
        console.log('---');
      }
    }
  }
}

// ─── Checkpoint Operations ───────────────────────────────────────────────────

function cmdCheckpoint(args, raw) {
  const subcommand = args[0];

  if (!subcommand) {
    error('checkpoint: subcommand required (create|search|latest|cleanup)');
  }

  const checkpoint = require('./knowledge-checkpoint.js');

  switch (subcommand) {
    case 'create': {
      // Parse args
      const phase = parseInt(args[args.indexOf('--phase') + 1]);
      const planId = args.includes('--plan-id') ? args[args.indexOf('--plan-id') + 1] : null;
      const taskTitle = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;
      const planStr = args.includes('--plan') ? args[args.indexOf('--plan') + 1] : '';
      const completedStr = args.includes('--completed') ? args[args.indexOf('--completed') + 1] : '';
      const current = args.includes('--current') ? args[args.indexOf('--current') + 1] : null;
      const keyContext = args.includes('--key-context') ? args[args.indexOf('--key-context') + 1] : '';
      const filesStr = args.includes('--files') ? args[args.indexOf('--files') + 1] : '';
      const decisionsStr = args.includes('--decisions') ? args[args.indexOf('--decisions') + 1] : '';
      const nextStepsStr = args.includes('--next-steps') ? args[args.indexOf('--next-steps') + 1] : '';

      if (isNaN(phase) || !taskTitle) {
        error('checkpoint create: --phase and --task are required');
      }

      // Parse comma-separated arrays
      const plan = planStr ? planStr.split(',').map(s => s.trim()).filter(Boolean) : [];
      const completed = completedStr ? completedStr.split(',').map(s => s.trim()).filter(Boolean) : [];
      const files = filesStr ? filesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
      const decisions = decisionsStr ? decisionsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
      const nextSteps = nextStepsStr ? nextStepsStr.split(',').map(s => s.trim()).filter(Boolean) : [];

      // Calculate remaining steps
      const remaining = plan.filter(step => !completed.includes(step) && step !== current);

      const checkpointData = {
        task_title: taskTitle,
        plan,
        progress: {
          completed,
          current: current || (plan.length > 0 ? plan[0] : 'not started'),
          remaining
        },
        files_touched: files,
        decisions,
        key_context: keyContext,
        next_steps: nextSteps,
        phase,
        plan_id: planId
      };

      checkpoint.createCheckpoint(checkpointData)
        .then(result => {
          output(result, raw);
        })
        .catch(err => {
          error(`Failed to create checkpoint: ${err.message}`);
        });
      break;
    }

    case 'search': {
      const query = args.includes('--query') ? args[args.indexOf('--query') + 1] : '';
      const phase = args.includes('--phase') ? parseInt(args[args.indexOf('--phase') + 1]) : undefined;
      const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;

      if (!query && phase === undefined) {
        error('checkpoint search: --query or --phase required');
      }

      const searchQuery = query || `phase ${phase}`;

      checkpoint.searchCheckpoints(searchQuery, { phase, limit })
        .then(results => {
          if (raw) {
            output({ results }, raw);
          } else {
            console.log(`\n=== Checkpoint Search Results (${results.length}) ===\n`);
            for (const result of results) {
              const cp = result.checkpoint;
              console.log(`ID: ${result.id}`);
              console.log(`Task: ${cp.task_title}`);
              console.log(`Phase: ${cp.phase} - Plan: ${cp.plan_id || 'N/A'}`);
              console.log(`Progress: ${cp.progress.completed.length}/${cp.plan.length}`);
              console.log(`Current: ${cp.progress.current}`);
              console.log(`Similarity: ${(result.similarity * 100).toFixed(1)}%`);
              console.log('---');
            }
          }
        })
        .catch(err => {
          error(`Failed to search checkpoints: ${err.message}`);
        });
      break;
    }

    case 'latest': {
      const phase = parseInt(args[args.indexOf('--phase') + 1]);
      const planId = args.includes('--plan-id') ? args[args.indexOf('--plan-id') + 1] : null;

      if (isNaN(phase)) {
        error('checkpoint latest: --phase required');
      }

      checkpoint.getLatestCheckpoint(phase, planId)
        .then(result => {
          if (!result) {
            if (raw) {
              output({ found: false }, raw);
            } else {
              console.log('No checkpoint found.');
            }
            return;
          }

          if (raw) {
            output({ found: true, checkpoint: result }, raw);
          } else {
            const cp = result.checkpoint;
            console.log('\n=== Latest Checkpoint ===\n');
            console.log(`ID: ${result.id}`);
            console.log(`Task: ${cp.task_title}`);
            console.log(`Phase: ${cp.phase} - Plan: ${cp.plan_id || 'N/A'}`);
            console.log(`Progress: ${cp.progress.completed.length}/${cp.plan.length}`);
            console.log(`Current: ${cp.progress.current}`);
            console.log(`Created: ${new Date(result.created_at).toISOString()}`);
            console.log(`\nNext Steps:`);
            for (const step of cp.next_steps || []) {
              console.log(`  - ${step}`);
            }
          }
        })
        .catch(err => {
          error(`Failed to get latest checkpoint: ${err.message}`);
        });
      break;
    }

    case 'cleanup': {
      const phase = args.includes('--phase') ? parseInt(args[args.indexOf('--phase') + 1]) : undefined;
      const all = args.includes('--all');
      const olderThanStr = args.includes('--older-than') ? args[args.indexOf('--older-than') + 1] : null;

      let olderThan = null;
      if (olderThanStr) {
        // Parse duration (e.g., "24h", "7d")
        const match = olderThanStr.match(/^(\d+)(h|d)$/);
        if (!match) {
          error('checkpoint cleanup: --older-than must be in format "24h" or "7d"');
        }
        const value = parseInt(match[1]);
        const unit = match[2];
        const hours = unit === 'h' ? value : value * 24;
        olderThan = Date.now() - (hours * 60 * 60 * 1000);
      }

      if (!all && phase === undefined && !olderThan) {
        error('checkpoint cleanup: specify --phase, --older-than, or --all');
      }

      const options = {
        phase: all ? undefined : phase,
        older_than: olderThan,
        completed_only: false
      };

      checkpoint.cleanupCheckpoints(options)
        .then(result => {
          output(result, raw);
        })
        .catch(err => {
          error(`Failed to cleanup checkpoints: ${err.message}`);
        });
      break;
    }

    default:
      error(`Unknown checkpoint subcommand: ${subcommand}`);
  }
}

// ─── Execution Log ───────────────────────────────────────────────────────────

/**
 * Walk up from dir until we find a real GSD project root (contains .planning/ with phases/ or ROADMAP.md).
 * A bare .planning/ with only EXECUTION_LOG.md is not considered a real root — it may be an artifact
 * from incorrect logging when cwd was a subdirectory (e.g. services/api/.planning/).
 * Falls back to the first .planning/ found if no proper root is found.
 */
function findProjectRoot(dir) {
  let current = dir;
  let firstPlanningDir = null;
  while (true) {
    const planningDir = path.join(current, '.planning');
    if (fs.existsSync(planningDir)) {
      const isRealRoot =
        fs.existsSync(path.join(planningDir, 'phases')) ||
        fs.existsSync(path.join(planningDir, 'ROADMAP.md'));
      if (isRealRoot) return current;
      if (!firstPlanningDir) firstPlanningDir = current;
    }
    const parent = path.dirname(current);
    if (parent === current) return firstPlanningDir || dir; // reached fs root
    current = parent;
  }
}

function cmdExecutionLog(cwd, args, raw) {
  cwd = findProjectRoot(cwd);
  const subcommand = args[0];

  if (!subcommand) {
    error('execution-log: subcommand required (event|append|history|current|last-complete|stats)');
  }

  switch (subcommand) {
    case 'event': {
      // Alias: execution-log event --type <type> --data '<json>'
      // Accepts a JSON blob via --data for flexible event logging from workflows
      const typeIndex = args.indexOf('--type');
      if (typeIndex === -1) {
        error('execution-log event: --type required');
      }
      const type = args[typeIndex + 1];
      const dataIndex = args.indexOf('--data');
      let extra = {};
      if (dataIndex !== -1) {
        try { extra = JSON.parse(args[dataIndex + 1]); } catch (e) { /* ignore malformed JSON */ }
      }
      const result = appendEvent(cwd, { type, ...extra });
      output(result, raw, 'Event appended to EXECUTION_LOG.md');
      break;
    }

    case 'append': {
      // Parse event type
      const typeIndex = args.indexOf('--type');
      if (typeIndex === -1) {
        error('execution-log append: --type required');
      }
      const type = args[typeIndex + 1];

      // Build event object from args
      const event = { type };

      // Parse optional fields
      const parseArg = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : undefined;
      };

      const phase = parseArg('--phase');
      const name = parseArg('--name');
      const status = parseArg('--status');
      const duration = parseArg('--duration');
      const checkpointId = parseArg('--checkpoint-id');
      const totalPhases = parseArg('--total-phases');

      if (phase !== undefined) event.phase = parseInt(phase);
      if (name !== undefined) event.name = name;
      if (status !== undefined) event.status = status;
      if (duration !== undefined) event.duration = parseInt(duration);
      if (checkpointId !== undefined) event.checkpoint_id = checkpointId;
      if (totalPhases !== undefined) event.total_phases = parseInt(totalPhases);

      const result = appendEvent(cwd, event);
      output(result, raw, 'Event appended to EXECUTION_LOG.md');
      break;
    }

    case 'history': {
      const events = getHistory(cwd);

      if (raw || args.includes('--json')) {
        output(events, true);
      } else {
        console.log('\n=== Execution History ===\n');
        if (events.length === 0) {
          console.log('No events in log.');
        } else {
          for (const event of events) {
            console.log(`[${event.timestamp}] ${event.type}${event.phase ? ` (Phase ${event.phase})` : ''}`);
            if (event.name) console.log(`  Name: ${event.name}`);
            if (event.status) console.log(`  Status: ${event.status}`);
            console.log('');
          }
        }
      }
      break;
    }

    case 'current': {
      const current = getCurrentPhase(cwd);
      output(current || { phase: null }, raw, current ? `Currently executing: Phase ${current.phase}` : 'No active phase');
      break;
    }

    case 'last-complete': {
      const events = getHistory(cwd);
      const completeEvents = events.filter(e => e.type === EVENT_TYPES.PHASE_COMPLETE);
      const lastComplete = completeEvents.length > 0 ? completeEvents[completeEvents.length - 1] : null;

      if (raw) {
        output({ phase: lastComplete ? lastComplete.phase : null }, raw);
      } else {
        if (lastComplete) {
          console.log(`Last completed phase: ${lastComplete.phase}`);
        } else {
          console.log('No completed phases yet.');
        }
      }
      break;
    }

    case 'stats': {
      const stats = getExecutionStats(cwd);

      if (raw) {
        output(stats, raw);
      } else {
        console.log('\n=== Execution Statistics ===\n');
        console.log(`Phases completed: ${stats.phases_completed}`);
        console.log(`Phases failed: ${stats.phases_failed}`);
        console.log(`Checkpoints: ${stats.checkpoint_count}`);
        if (stats.total_duration_ms > 0) {
          const hours = Math.floor(stats.total_duration_ms / 3600000);
          const mins = Math.floor((stats.total_duration_ms % 3600000) / 60000);
          console.log(`Total duration: ${hours}h ${mins}m`);
        }
      }
      break;
    }

    default:
      error(`execution-log: unknown subcommand "${subcommand}"`);
  }
}

// ─── Failure Handler Commands ────────────────────────────────────────────────

function cmdFailure(cwd, args, raw) {
  const subcommand = args[0];

  if (!subcommand) {
    error('failure: subcommand required (test-retry|classify|backoff|log-failure)');
  }

  switch (subcommand) {
    case 'test-retry': {
      const failCount = parseInt(args[1] || '2', 10);
      let attempts = 0;

      const operation = async () => {
        attempts++;
        if (attempts <= failCount) {
          throw new Error(`Simulated failure ${attempts}/${failCount}`);
        }
        return { success: true, attempts };
      };

      executeWithRetry(operation, { operation: 'test-retry', verbose: true })
        .then(result => {
          if (raw) {
            output(result, true);
          } else {
            if (result.success) {
              console.log(`✓ Operation succeeded after ${result.retries} retries`);
              console.log(`Result: ${JSON.stringify(result.result)}`);
            } else {
              console.log(`✗ Operation failed after ${result.retries} retries`);
              console.log(`Error: ${result.error.message}`);
            }
          }
        })
        .catch(err => error(`test-retry failed: ${err.message}`));
      break;
    }

    case 'classify': {
      const errorMsg = args[1];
      if (!errorMsg) {
        error('classify: error message required');
      }

      const handler = new FailureHandler();
      const retryable = handler.isRetryable({ message: errorMsg });

      // Find which pattern matched (if any)
      let patternMatched = null;
      if (retryable) {
        for (const pattern of FailureHandler.RETRYABLE_PATTERNS) {
          if (pattern.test(errorMsg)) {
            patternMatched = pattern.toString();
            break;
          }
        }
      }

      const result = {
        retryable,
        pattern_matched: patternMatched,
      };

      output(result, raw, `Error is ${retryable ? 'retryable' : 'NOT retryable'}${patternMatched ? ` (matched: ${patternMatched})` : ''}`);
      break;
    }

    case 'backoff': {
      const attempt = parseInt(args[1], 10);
      const baseDelay = args[2] ? parseInt(args[2], 10) : undefined;

      if (isNaN(attempt)) {
        error('backoff: attempt number required (0-indexed)');
      }

      const handler = new FailureHandler(baseDelay ? { baseDelay } : {});
      const delayMs = handler.calculateBackoff(attempt);

      const result = {
        attempt,
        delay_ms: delayMs,
        delay_readable: formatDuration(delayMs),
      };

      output(result, raw, `Attempt ${attempt}: delay ${delayMs}ms (${result.delay_readable})`);
      break;
    }

    case 'log-failure': {
      const phase = args[1];
      const errorMsg = args[2];
      const action = args[3];

      if (!phase || !errorMsg || !action) {
        error('log-failure: phase, error, and action required');
      }

      if (!['retry', 'skip', 'escalate'].includes(action)) {
        error(`log-failure: action must be retry|skip|escalate, got "${action}"`);
      }

      const event = {
        type: 'failure',
        phase: parseInt(phase),
        error: errorMsg,
        action,
      };

      const result = appendEvent(cwd, event);
      output(result, raw, 'Failure logged to EXECUTION_LOG.md');
      break;
    }

    default:
      error(`failure: unknown subcommand "${subcommand}"`);
  }
}

// Helper for formatting duration in human-readable form
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ─── Completion Signals ──────────────────────────────────────────────────────

function cmdCompletion(cwd, args, raw) {
  const subcommand = args[0];

  if (!subcommand) {
    error('completion: subcommand required (create|log|parse|handle)');
  }

  switch (subcommand) {
    case 'create': {
      // Create completion signal JSON
      const status = args[1];
      const phase = args[2];
      const detailsArg = args[3];

      if (!status || !phase) {
        error('completion create: status and phase required');
      }

      // Parse details from JSON string or key=value pairs
      let details = {};
      if (detailsArg) {
        try {
          // Try parsing as JSON first
          details = JSON.parse(detailsArg);
        } catch (e) {
          // Parse key=value pairs
          for (let i = 3; i < args.length; i++) {
            const [key, value] = args[i].split('=');
            if (key && value !== undefined) {
              // Try to parse value as JSON, otherwise use as string
              try {
                details[key] = JSON.parse(value);
              } catch {
                details[key] = value;
              }
            }
          }
        }
      }

      // Create appropriate signal using factory method
      let signal;
      const phaseNum = parseInt(phase);

      switch (status.toLowerCase()) {
        case 'success':
          signal = CompletionSignal.success(phaseNum, details);
          break;
        case 'failure':
          const error = new Error(details.error || 'Unknown error');
          if (details.stack) error.stack = details.stack;
          signal = CompletionSignal.failure(phaseNum, error, details);
          break;
        case 'blocked':
          signal = CompletionSignal.blocked(phaseNum, details.reason || 'Unknown reason', details);
          break;
        case 'skipped':
          signal = CompletionSignal.skipped(phaseNum, details.reason || 'User skipped');
          break;
        default:
          error(`completion create: unknown status "${status}"`);
      }

      output(signal.toJSON(), raw);
      break;
    }

    case 'log': {
      // Log completion signal to EXECUTION_LOG.md
      const signalArg = args[1];

      if (!signalArg) {
        error('completion log: signal JSON required');
      }

      let signalData;
      try {
        signalData = JSON.parse(signalArg);
      } catch (e) {
        error(`completion log: invalid JSON - ${e.message}`);
      }

      // Append to EXECUTION_LOG.md as NDJSON event
      const event = {
        type: EVENT_TYPES.PHASE_COMPLETE,
        phase: signalData.phase,
        status: signalData.status,
        timestamp: signalData.timestamp,
        ...signalData
      };

      appendEvent(cwd, event);
      output({ logged: true }, raw, 'Completion signal logged');
      break;
    }

    case 'parse': {
      // Parse completion signal from JSON
      const signalArg = args[1];

      if (!signalArg) {
        error('completion parse: signal JSON required');
      }

      let signalData;
      try {
        signalData = JSON.parse(signalArg);
      } catch (e) {
        error(`completion parse: invalid JSON - ${e.message}`);
      }

      // Reconstruct signal object to get helper methods
      const signal = new CompletionSignal(
        signalData.status,
        signalData.phase,
        signalData
      );

      output({
        status: signal.status,
        phase: signal.phase,
        isTerminal: signal.isTerminal(),
        canRetry: signal.canRetry()
      }, raw);
      break;
    }

    case 'handle': {
      // Process completion signal and output decision
      const signalArg = args[1];

      if (!signalArg) {
        error('completion handle: signal JSON required');
      }

      let signalData;
      try {
        signalData = JSON.parse(signalArg);
      } catch (e) {
        error(`completion handle: invalid JSON - ${e.message}`);
      }

      // Reconstruct signal to use helper methods
      const signal = new CompletionSignal(
        signalData.status,
        signalData.phase,
        signalData
      );

      let decision;

      switch (signal.status) {
        case COMPLETION_STATUS.SUCCESS:
          decision = {
            continue: true,
            nextPhase: signal.phase + 1
          };
          break;

        case COMPLETION_STATUS.FAILURE:
          if (signal.canRetry()) {
            decision = {
              continue: false,
              action: 'retry',
              backoff: signal.details.retryOptions?.backoffMs || 2000
            };
          } else {
            decision = {
              continue: false,
              action: 'escalate'
            };
          }
          break;

        case COMPLETION_STATUS.BLOCKED:
          if (signal.details.userInputRequired) {
            decision = {
              continue: false,
              action: 'await_user'
            };
          } else if (signal.details.blockingDependencies && signal.details.blockingDependencies.length > 0) {
            decision = {
              continue: false,
              action: 'await_dependency',
              deps: signal.details.blockingDependencies
            };
          } else {
            decision = {
              continue: false,
              action: 'blocked',
              reason: signal.details.reason
            };
          }
          break;

        case COMPLETION_STATUS.SKIPPED:
          decision = {
            continue: true,
            nextPhase: signal.phase + 1,
            skipped: true
          };
          break;

        default:
          error(`completion handle: unknown status "${signal.status}"`);
      }

      output(decision, raw);
      break;
    }

    default:
      error(`completion: unknown subcommand "${subcommand}"`);
  }
}

// ─── Token Budget Monitoring ─────────────────────────────────────────────────

function cmdToken(cwd, args, raw) {
  const subcommand = args[0];

  if (!subcommand) {
    error('token: subcommand required (init|reserve|record|report|reset)');
  }

  const budgetPath = path.join(cwd, '.planning', 'token_budget.json');

  switch (subcommand) {
    case 'init': {
      // Initialize token budget file
      const model = args[1] || 'opus';
      const graduated = args.includes('--graduated');
      const telegramEnabled = args.includes('--telegram');

      let monitor;
      if (graduated) {
        const { GraduatedBudgetMonitor } = require('./graduated-alerts.js');
        monitor = new GraduatedBudgetMonitor(model, 200000, { telegramEnabled });
      } else {
        monitor = new TokenBudgetMonitor(model, 200000);
      }

      // Ensure .planning directory exists
      const planningDir = path.join(cwd, '.planning');
      if (!fs.existsSync(planningDir)) {
        fs.mkdirSync(planningDir, { recursive: true });
      }

      fs.writeFileSync(budgetPath, JSON.stringify(monitor.toJSON(), null, 2));
      output({ initialized: true, model, max_tokens: 200000, graduated, telegram: telegramEnabled }, raw, `Token budget initialized for ${model} (200k limit, graduated=${graduated}, telegram=${telegramEnabled})`);
      break;
    }

    case 'reserve': {
      // Reserve tokens before operation
      const estimatedTokens = parseInt(args[1]);
      const operation = args[2] || 'unknown-operation';

      if (isNaN(estimatedTokens)) {
        error('token reserve: estimatedTokens (number) required');
      }

      // Load existing budget
      let monitor;
      if (fs.existsSync(budgetPath)) {
        const parseResult = safeJsonParse(fs.readFileSync(budgetPath, 'utf-8'), 'token_budget.json');
        if (!parseResult.ok) {
          error(`token reserve: ${parseResult.error.message} (corrupted ${budgetPath})`);
        }
        monitor = TokenBudgetMonitor.fromJSON(parseResult.value);
      } else {
        // Auto-initialize if not exists
        monitor = new TokenBudgetMonitor();
      }

      const canProceed = monitor.reserve(estimatedTokens, operation);

      // Update budget file
      fs.writeFileSync(budgetPath, JSON.stringify(monitor.toJSON(), null, 2));

      const report = monitor.getReport();
      output({
        can_proceed: canProceed,
        alerts: report.active_alerts,
        utilization: report.utilization_percent
      }, raw);

      // Exit code: 0 if can proceed, 1 if blocked
      process.exit(canProceed ? 0 : 1);
    }

    case 'record': {
      // Record actual usage after operation
      const actualTokens = parseInt(args[1]);
      const phase = args[2] || 'unknown-phase';

      if (isNaN(actualTokens)) {
        error('token record: actualTokens (number) required');
      }

      // Load existing budget
      let monitor;
      if (fs.existsSync(budgetPath)) {
        const parseResult = safeJsonParse(fs.readFileSync(budgetPath, 'utf-8'), 'token_budget.json');
        if (!parseResult.ok) {
          error(`token record: ${parseResult.error.message} (corrupted ${budgetPath})`);
        }
        const data = parseResult.value;

        // Detect if graduated state exists
        if (data.thresholdsPassed !== undefined) {
          const { GraduatedBudgetMonitor } = require('./graduated-alerts.js');
          monitor = GraduatedBudgetMonitor.fromJSON(data);
        } else {
          monitor = TokenBudgetMonitor.fromJSON(data);
        }
      } else {
        // Auto-initialize if not exists
        monitor = new TokenBudgetMonitor();
      }

      monitor.recordUsage(actualTokens, phase);

      // Update budget file
      fs.writeFileSync(budgetPath, JSON.stringify(monitor.toJSON(), null, 2));

      output({ recorded: true, tokens: actualTokens, phase }, raw, `Recorded ${actualTokens} tokens for ${phase}`);
      break;
    }

    case 'report': {
      // Display token usage report
      if (!fs.existsSync(budgetPath)) {
        output({ available: false, reason: 'Token budget not initialized' }, raw, 'Token budget not initialized (run: token init)');
        break;
      }

      const reportParseResult = safeJsonParse(fs.readFileSync(budgetPath, 'utf-8'), 'token_budget.json');
      if (!reportParseResult.ok) {
        error(`token report: ${reportParseResult.error.message} (corrupted ${budgetPath})`);
      }
      const data = reportParseResult.value;

      // Detect if graduated state exists
      let monitor, report;
      if (data.thresholdsPassed !== undefined) {
        const { GraduatedBudgetMonitor } = require('./graduated-alerts.js');
        monitor = GraduatedBudgetMonitor.fromJSON(data);
        report = monitor.getGraduatedReport();
      } else {
        monitor = TokenBudgetMonitor.fromJSON(data);
        report = monitor.getReport();
      }

      output(report, raw);
      break;
    }

    case 'reset': {
      // Reset for new session
      const monitor = new TokenBudgetMonitor();
      fs.writeFileSync(budgetPath, JSON.stringify(monitor.toJSON(), null, 2));
      output({ reset: true }, raw, 'Token budget reset');
      break;
    }

    default:
      error(`token: unknown subcommand "${subcommand}"`);
  }
}

// ─── Token Usage Ledger CLI (MILE-36, Phase 58) ──────────────────────────────
// Thin CLI dispatch onto token-usage-ledger.js's appendTaskUsage/estimateTaskTokens.
// Deliberately a SEPARATE top-level command from `token` (init/reserve/record/
// report/reset), which stays pointed at the live-session TokenBudgetMonitor
// (session-window reserve-before-op/halt-at-95% guardrail) -- this command is
// the durable, per-project, per-task HISTORICAL usage ledger the coordinator's
// golden path (Plan 58-03) records into, and `savings report` (below) reads
// back. See 58-RESEARCH.md's "don't conflate two systems" note. Never touches
// token_budget.json.
function cmdTokenUsage(cwd, args, raw) {
  const subcommand = args[0];
  if (subcommand !== 'record') {
    error('token-usage: unknown subcommand (expected "record")');
    return;
  }

  const { appendTaskUsage, estimateTaskTokens } = require('./token-usage-ledger.js');
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const phaseArg = getArg('--phase');
  const planArg = getArg('--plan');
  const taskIndexArg = getArg('--task-index');
  const taskName = getArg('--task-name') || '';
  const tier = getArg('--tier') || 'sonnet';
  const tokensInputArg = getArg('--tokens-input');
  const tokensOutputArg = getArg('--tokens-output');
  const sourceArg = getArg('--source');

  // No explicit --tokens-input/--tokens-output: this is the golden-path call
  // shape (Plan 58-03) -- the harness exposes no real per-spawn token counts
  // (see token-usage-ledger.js's HONESTY CONTRACT), so we estimate via the
  // crude, clearly-labeled heuristic and ALWAYS tag source:'estimated'.
  // Explicit tokens (manual/testing use) may be tagged 'actual' via
  // --source actual; omitted tokens are never 'actual' regardless of --source.
  let tokens, source;
  if (tokensInputArg !== undefined && tokensOutputArg !== undefined) {
    tokens = {
      input: parseInt(tokensInputArg, 10) || 0,
      output: parseInt(tokensOutputArg, 10) || 0
    };
    source = sourceArg === 'actual' ? 'actual' : 'estimated';
  } else {
    tokens = estimateTaskTokens(taskName, tier);
    source = 'estimated';
  }

  const parsedPhase = phaseArg !== undefined
    ? (isNaN(parseInt(phaseArg, 10)) ? phaseArg : parseInt(phaseArg, 10))
    : null;
  const parsedTaskIndex = taskIndexArg !== undefined
    ? (isNaN(parseInt(taskIndexArg, 10)) ? null : parseInt(taskIndexArg, 10))
    : null;

  const entry = {
    phase: parsedPhase,
    plan: planArg !== undefined ? planArg : null,
    task_index: parsedTaskIndex,
    task_name: taskName,
    tier,
    tokens,
    source
  };

  const result = appendTaskUsage(cwd, entry);
  output(
    { recorded: result.ok, record: result.record },
    raw,
    result.ok
      ? `Recorded token usage for task ${parsedTaskIndex} (${source})`
      : `Warning: failed to record token usage: ${result.error}`
  );
}

// ─── Graduated Budget Alerts ──────────────────────────────────────────────────

function cmdAlerts(cwd, args, raw) {
  const subcommand = args[0];
  const { GraduatedBudgetMonitor, GRADUATED_THRESHOLDS } = require('./graduated-alerts.js');
  const budgetPath = path.join(cwd, '.planning', 'token_budget.json');

  if (!subcommand) {
    error('alerts: subcommand required (status|test|reset|history)');
  }

  switch (subcommand) {
    case 'status': {
      // Load existing budget state if available
      let monitor;
      if (fs.existsSync(budgetPath)) {
        const statusParseResult = safeJsonParse(fs.readFileSync(budgetPath, 'utf8'), 'token_budget.json');
        if (!statusParseResult.ok) {
          error(`alerts status: ${statusParseResult.error.message} (corrupted ${budgetPath})`);
        }
        monitor = GraduatedBudgetMonitor.fromJSON(statusParseResult.value);
      } else {
        monitor = new GraduatedBudgetMonitor();
      }

      const utilization = monitor.currentUsage / monitor.maxTokens;
      output({
        current_usage: monitor.currentUsage,
        max_tokens: monitor.maxTokens,
        utilization_percent: (utilization * 100).toFixed(1),
        thresholds: GRADUATED_THRESHOLDS,
        thresholds_passed: Array.from(monitor.thresholdsPassed),
        alerts_fired: monitor.graduatedAlerts.length
      }, raw);
      break;
    }

    case 'test': {
      const utilizationPercent = parseFloat(args[1]) || 0;
      const testMonitor = new GraduatedBudgetMonitor('opus', 200000);
      const testTokens = Math.floor(200000 * (utilizationPercent / 100));

      if (!raw) {
        console.log(`Testing ${utilizationPercent}% utilization (${testTokens} tokens)...`);
      }

      try {
        testMonitor.recordUsage(testTokens, 'test-phase');
      } catch (error) {
        if (!raw) {
          console.log(`Halt triggered: ${error.message}`);
        }
      }

      output({
        utilization_tested: `${utilizationPercent}%`,
        thresholds_triggered: Array.from(testMonitor.thresholdsPassed),
        alerts: testMonitor.graduatedAlerts
      }, raw);
      break;
    }

    case 'reset': {
      if (fs.existsSync(budgetPath)) {
        const resetParseResult = safeJsonParse(fs.readFileSync(budgetPath, 'utf8'), 'token_budget.json');
        if (!resetParseResult.ok) {
          error(`alerts reset: ${resetParseResult.error.message} (corrupted ${budgetPath})`);
        }
        const data = resetParseResult.value;
        data.thresholdsPassed = [];
        data.graduatedAlerts = [];
        fs.writeFileSync(budgetPath, JSON.stringify(data, null, 2));
        output({ reset: true }, raw, 'Graduated alert state reset');
      } else {
        output({ reset: false, reason: 'No budget file found' }, raw, 'No budget file to reset');
      }
      break;
    }

    case 'history': {
      if (fs.existsSync(budgetPath)) {
        const historyParseResult = safeJsonParse(fs.readFileSync(budgetPath, 'utf8'), 'token_budget.json');
        if (!historyParseResult.ok) {
          error(`alerts history: ${historyParseResult.error.message} (corrupted ${budgetPath})`);
        }
        const data = historyParseResult.value;
        const alerts = data.graduatedAlerts || [];

        if (args.includes('--json') || raw) {
          output(alerts, raw);
        } else {
          if (alerts.length === 0) {
            console.log('No graduated alerts recorded');
          } else {
            console.log('Level      | Threshold | Utilization | Phase        | Timestamp');
            console.log('-'.repeat(75));
            alerts.forEach(a => {
              console.log(`${a.level.padEnd(10)} | ${a.threshold.padEnd(9)} | ${a.utilization.padEnd(11)} | ${(a.phase || '').padEnd(12)} | ${a.timestamp}`);
            });
          }
        }
      } else {
        output({ available: false, reason: 'No budget history' }, raw, 'No budget history available');
      }
      break;
    }

    default:
      error(`alerts: unknown subcommand "${subcommand}"`);
  }
}

// ─── Task Chunking ────────────────────────────────────────────────────────────

// Pure-Node glob expansion for a single directory level (matches the scope of
// what shell globbing via `ls -1 <pattern>` provided previously — no shell
// interpolation, so unsanitized --files input cannot be shell-interpreted).
// Supports `*` and `?` wildcards in the final path segment only.
function expandGlobSync(cwd, globPattern) {
  try {
    const normalizedPattern = (globPattern || '').trim();
    if (!normalizedPattern) return [];

    const lastSlash = normalizedPattern.lastIndexOf('/');
    const dirPart = lastSlash === -1 ? '.' : normalizedPattern.slice(0, lastSlash);
    const filePattern = lastSlash === -1 ? normalizedPattern : normalizedPattern.slice(lastSlash + 1);

    // No wildcard in the final segment: treat as a literal path, matching
    // shell behavior when a glob doesn't match anything (echoes the literal).
    if (!/[*?]/.test(filePattern)) {
      return fs.existsSync(path.join(cwd, normalizedPattern)) ? [normalizedPattern] : [];
    }

    const regexSource = '^' + filePattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$';
    const regex = new RegExp(regexSource);

    const dirAbs = path.join(cwd, dirPart);
    if (!fs.existsSync(dirAbs)) return [];

    return fs.readdirSync(dirAbs)
      .filter(name => regex.test(name))
      .map(name => (dirPart === '.' ? name : `${dirPart}/${name}`))
      .sort();
  } catch {
    return [];
  }
}

// ─── Eval Harness CLI (MILE-29, Phase 53-01) ─────────────────────────────────
// Thin CLI dispatch onto get-shit-done/bin/eval-harness.js's pure functions,
// mirroring the existing `case 'task':` -> cmdTask(cwd, args.slice(1), raw)
// pattern. `eval assert` deliberately bypasses the shared output() helper
// (which always exits 0) and instead mirrors cmdVerifyPhaseGate's direct
// process.exit(result.pass ? 0 : 1) so CI can fail the job on a real
// assertion failure.
function cmdEval(cwd, args, raw) {
  const subcommand = args[0];

  if (!subcommand) {
    error('eval: subcommand required (plan|assert|regress)');
    return;
  }

  if (subcommand === 'plan') {
    const fixtureIdx = args.indexOf('--fixture');
    const fixtureDir = fixtureIdx !== -1 ? args[fixtureIdx + 1] : null;
    if (!fixtureDir) {
      error('eval plan: --fixture <dir> required');
      return;
    }
    const roadmapPath = path.join(cwd, fixtureDir, 'ROADMAP.md');
    const plan = evalHarness.buildSpawnPlan(roadmapPath);
    output(plan, raw, JSON.stringify(plan));
    return;
  }

  if (subcommand === 'assert') {
    const artifactsDirArg = args[1];
    if (!artifactsDirArg) {
      error('eval assert: <artifacts-dir> required');
      return;
    }
    const artifactsRoot = path.join(cwd, artifactsDirArg);

    if (!fs.existsSync(artifactsRoot)) {
      const result = { error: true, type: 'artifacts_dir_not_found', path: artifactsDirArg };
      process.stdout.write(JSON.stringify(result, null, 2));
      process.exit(2);
      return;
    }

    // `expectations.json` at the root of artifactsRoot is the independent
    // manifest of what SHOULD be true (expectedPlan/expectSkip/
    // expectedCommitCount) -- deliberately NOT derived from the artifacts
    // being checked (spawn-trace.json/VERIFICATION.md/DEFERRED.json/
    // git-log.txt), since deriving expectations from the same files being
    // validated would make every check trivially self-satisfying and unable
    // to catch a real regression (e.g. a dropped DEFERRED.json would just
    // silently lower the expectation instead of failing the check).
    const expectationsPath = path.join(artifactsRoot, 'expectations.json');
    if (!fs.existsSync(expectationsPath)) {
      const result = { error: true, type: 'missing_expectations', message: 'expectations.json not found in artifacts dir -- cannot determine expected plan/skips/commit count' };
      process.stdout.write(JSON.stringify(result, null, 2));
      process.exit(2);
      return;
    }
    let expectations;
    try {
      expectations = JSON.parse(fs.readFileSync(expectationsPath, 'utf-8'));
    } catch (e) {
      const result = { error: true, type: 'malformed_expectations', message: `Could not parse expectations.json: ${e.message}` };
      process.stdout.write(JSON.stringify(result, null, 2));
      process.exit(2);
      return;
    }
    const { expectedPlan, expectSkip, expectedCommitCount, expectedFileSet } = expectations || {};

    const assertOptions = {
      expectedPlan: expectedPlan || [],
      expectSkip: expectSkip || {},
      expectedCommitCount: expectedCommitCount || 0,
    };
    // MILE-31: additive -- only include expectedFileSet (and therefore the
    // injection_resisted check) when expectations.json actually supplies it.
    // Older/other expectations.json manifests without this field are
    // unaffected (53-01 behavior preserved).
    if (Array.isArray(expectedFileSet)) {
      assertOptions.expectedFileSet = expectedFileSet;
    }

    const result = evalHarness.runEvalAssertions(artifactsRoot, assertOptions);
    process.stdout.write(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
    return;
  }

  if (subcommand === 'regress') {
    const acceptedDirArg = args[1];
    if (!acceptedDirArg) {
      error('eval regress: <accepted-dir> required');
      return;
    }
    const acceptedDir = path.isAbsolute(acceptedDirArg) ? acceptedDirArg : path.join(cwd, acceptedDirArg);

    const projectRootIdx = args.indexOf('--project-root');
    const projectRootArg = projectRootIdx !== -1 ? args[projectRootIdx + 1] : cwd;
    const projectRoot = path.isAbsolute(projectRootArg) ? projectRootArg : path.join(cwd, projectRootArg);

    // Bypass output() (which always exits 0) and write the full JSON result
    // directly to stdout, mirroring `assert`'s pattern exactly -- CI needs
    // the real exit code (MILE-32, Phase 55-03).
    const result = evalHarness.runEvalRegressions(acceptedDir, projectRoot);
    process.stdout.write(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
    return;
  }

  error('Unknown eval subcommand. Available: plan, assert, regress');
}

// ─── Eval Regression Candidates (MILE-32, Phase 55) ──────────────────────────
// Design decision: candidate fixtures are stored under
// tests/eval-regressions/{queue,accepted,archived}/ (git-tracked, NOT under
// .planning/ which is gitignored) so accepted candidates survive as
// permanent, CI-visible artifacts. queue/accepted/archived are created now
// with an empty .gitkeep each -- queue and archived start empty forever
// until a human reviews a candidate; accepted starts empty until the first
// candidate is promoted (Plan 55-02).
//
// Uses gray-matter (already a package.json dependency, unused elsewhere in
// bin/*.js until now) to parse BOTH the debug file's frontmatter and
// VERIFICATION.md's frontmatter, because the existing hand-rolled
// extractFrontmatter (~line 434) only handles flat arrays of scalar strings
// and cannot reliably parse VERIFICATION.md's nested array-of-objects `gaps:
// [{artifacts: [...], missing: [...]}]` schema. extractFrontmatter itself is
// left untouched.
const EVAL_REGRESSIONS_ROOT = 'tests/eval-regressions';

function getEvalRegressionsQueueDir(cwd) {
  return path.join(cwd, EVAL_REGRESSIONS_ROOT, 'queue');
}

function getEvalRegressionsAcceptedDir(cwd) {
  return path.join(cwd, EVAL_REGRESSIONS_ROOT, 'accepted');
}

function getEvalRegressionsArchivedDir(cwd) {
  return path.join(cwd, EVAL_REGRESSIONS_ROOT, 'archived');
}

// Lowercase, replace non-alphanumerics with `-`, trim leading/trailing `-`,
// truncate to maxLen. Never throws -- coerces non-string input to ''.
function slugifyCandidateText(text, maxLen = 40) {
  const str = typeof text === 'string' ? text : '';
  const slug = str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLen);
}

// Extracts the `## Resolution` section body from a debug file's markdown
// BODY (not frontmatter) per gsd-debugger.md's <debug_file_protocol> File
// Structure. Stops at the next `##` heading or end of string. Returns '' if
// no Resolution section is present.
function extractDebugResolutionSection(bodyMarkdown) {
  const match = /##\s*Resolution\s*\n([\s\S]*?)(?=\n##\s|\n?$)/.exec(bodyMarkdown || '');
  return match ? match[1] : '';
}

// Line-anchored field extraction from a Resolution section, e.g.
// `root_cause: the thing` -> 'the thing'. Multiline flag matches any line
// start, not just the string start (Resolution section has multiple
// `field: value` lines).
function parseResolutionField(sectionText, fieldName) {
  const re = new RegExp(`^${fieldName}:\\s*(.*)$`, 'm');
  const match = re.exec(sectionText || '');
  return match ? match[1].trim() : '';
}

// Supports BOTH inline `files_changed: [a, b]` and multi-line
// `files_changed:\n  - a\n  - b` forms. Returns [] if neither form matches
// or the array is empty.
function parseResolutionFilesChanged(sectionText) {
  const text = sectionText || '';

  const inlineMatch = /^files_changed:\s*\[(.*)\]\s*$/m.exec(text);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const multilineMatch = /^files_changed:\s*\n((?:^[ \t]*-[ \t]*.+$\n?)+)/m.exec(text);
  if (multilineMatch) {
    return multilineMatch[1]
      .split('\n')
      .map((line) => line.replace(/^[ \t]*-[ \t]*/, '').trim())
      .filter(Boolean);
  }

  return [];
}

// Reads a debug file (frontmatter + `## Resolution` body section) and builds
// a single candidate regression fixture from its confirmed root_cause.
// Returns `null` (writes NOTHING) when root_cause is absent, whitespace-only,
// or still the literal `[empty until found]` placeholder -- this is the
// must-have guarantee that an INVESTIGATION INCONCLUSIVE session (root_cause
// never confirmed) produces zero candidates. Never throws -- any read/parse
// failure returns `null`.
function buildEvalCandidateFromDebugFile(cwd, debugFilePath) {
  try {
    const content = safeReadFile(debugFilePath);
    if (content === null) return null;

    const matter = require('gray-matter');
    const parsed = matter(content);

    const section = extractDebugResolutionSection(parsed.content);
    const rootCause = parseResolutionField(section, 'root_cause');

    if (!rootCause || !rootCause.trim() || rootCause.trim() === '[empty until found]') {
      return null;
    }
    const trimmedRootCause = rootCause.trim();

    const filesChanged = parseResolutionFilesChanged(section);
    const expected = filesChanged.length > 0
      ? { type: 'file_exists', file: filesChanged[0] }
      // Weak fallback for a human reviewer to replace: no files_changed was
      // recorded on this session, so the only thing we can assert existence
      // of is the debug file itself.
      : { type: 'file_exists', file: path.relative(cwd, debugFilePath) };

    const title = (parsed.data && typeof parsed.data.trigger === 'string' && parsed.data.trigger.trim())
      ? parsed.data.trigger.trim()
      : trimmedRootCause.slice(0, 80);

    const slug = slugifyCandidateText(path.basename(debugFilePath, '.md'));

    return {
      id: `debug-${slug}-${Date.now()}`,
      source: 'debugger',
      created_at: new Date().toISOString(),
      title,
      context: {
        phase: null,
        root_cause: trimmedRootCause,
        gap_description: null,
        debug_file: path.relative(cwd, debugFilePath),
        verification_file: null,
      },
      expected,
      status: 'pending',
    };
  } catch (e) {
    return null;
  }
}

// Reads a VERIFICATION.md (frontmatter per gsd-verifier.md's <output>
// "Create VERIFICATION.md" schema) and builds one candidate regression
// fixture per gap when `status: gaps_found`. Returns [] for `status:
// passed`/`status: human_needed`, or an empty/absent `gaps` array (defensive
// against the contradictory-but-possible gaps_found + empty-array case).
// Never throws -- malformed frontmatter degrades to [].
function buildEvalCandidatesFromVerificationFile(cwd, verificationFilePath) {
  try {
    const content = safeReadFile(verificationFilePath);
    if (content === null) return [];

    const matter = require('gray-matter');
    const parsed = matter(content);
    const data = parsed.data || {};

    if (data.status !== 'gaps_found' || !Array.isArray(data.gaps) || data.gaps.length === 0) {
      return [];
    }

    const ts = Date.now(); // computed ONCE so multiple gaps get distinct, stable-ordered ids via the -${i} suffix
    const relVerificationFile = path.relative(cwd, verificationFilePath);

    return data.gaps.map((gap, i) => {
      const gapObj = gap || {};
      const expected = (gapObj.artifacts && gapObj.artifacts[0] && gapObj.artifacts[0].path)
        ? { type: 'file_exists', file: gapObj.artifacts[0].path }
        // Weak fallback for a human reviewer to replace: no artifacts path
        // recorded on this gap, so the only thing we can assert existence
        // of is the VERIFICATION.md file itself.
        : { type: 'file_exists', file: relVerificationFile };

      const id = `verify-${slugifyCandidateText(data.phase || 'unknown')}-${slugifyCandidateText(gapObj.truth)}-${ts}-${i}`;

      return {
        id,
        source: 'verifier',
        created_at: new Date().toISOString(),
        title: gapObj.truth || null,
        context: {
          phase: data.phase || null,
          root_cause: null,
          gap_description: gapObj.reason || null,
          debug_file: null,
          verification_file: relVerificationFile,
        },
        expected,
        status: 'pending',
      };
    });
  } catch (e) {
    return [];
  }
}

// ─── Verification Gap Append (Phase 59-01, MILE-38 support) ────────────────
// appendVerificationGap composes with buildEvalCandidatesFromVerificationFile above --
// reads the SAME VERIFICATION.md frontmatter shape via gray-matter, appends one gap
// object, flips status to 'gaps_found', writes back preserving the markdown BODY
// untouched. Never throws -- returns {ok:false, error} instead, so a CLI caller can
// decide its own exit code (mirrors cmdEvalCandidateAccept's structured-error
// convention, not the generic error() helper). This is the ONLY new gap-write path in
// the codebase; execute-roadmap step 5b calls this (via the CLI below) on a
// blocking cross-phase integration mismatch, and the EXISTING
// buildEvalCandidatesFromVerificationFile / `eval-candidate from-verification` reader
// picks up the appended gap unmodified -- no second/parallel gap pipeline.
function appendVerificationGap(cwd, verificationFilePath, gapEntry) {
  try {
    const content = safeReadFile(verificationFilePath);
    if (content === null) {
      return { ok: false, error: `VERIFICATION.md not found at ${verificationFilePath}` };
    }

    const matter = require('gray-matter');
    const parsed = matter(content);
    const data = parsed.data || {};

    const gap = {
      truth: (gapEntry && gapEntry.truth) || null,
      status: 'failed',
      failure_type: (gapEntry && gapEntry.failure_type) || 'contract_mismatch',
      reason: (gapEntry && gapEntry.reason) || null,
    };
    if (gapEntry && Array.isArray(gapEntry.artifacts) && gapEntry.artifacts.length > 0) {
      gap.artifacts = gapEntry.artifacts;
    }

    const existingGaps = Array.isArray(data.gaps) ? data.gaps : [];
    const updatedData = { ...data, status: 'gaps_found', gaps: [...existingGaps, gap] };

    const rebuilt = matter.stringify(parsed.content, updatedData);
    atomicWriteFileSync(verificationFilePath, rebuilt);
    return { ok: true, gap, gaps_count: updatedData.gaps.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Thin CLI wrapper. Structured JSON error + explicit exit code on failure (mirrors
// cmdEvalCandidateAccept's convention) -- NOT the generic error() helper, so callers
// can distinguish "missing required flag" (exit 2) from "write failed" (exit 1).
function cmdVerifyAppendGap(cwd, verificationFileArg, options, raw) {
  if (!verificationFileArg) {
    process.stdout.write(JSON.stringify({ error: true, type: 'missing_argument', message: 'verify append-gap: <verification-file-path> required' }, null, 2));
    process.exit(2);
    return;
  }
  const opts = options || {};
  if (!opts.truth || !opts.reason) {
    process.stdout.write(JSON.stringify({ error: true, type: 'missing_flags', message: 'verify append-gap: --truth and --reason are required' }, null, 2));
    process.exit(2);
    return;
  }

  let artifacts;
  if (opts.artifactsJson) {
    try {
      artifacts = JSON.parse(opts.artifactsJson);
    } catch (e) {
      process.stdout.write(JSON.stringify({ error: true, type: 'malformed_artifacts_json', message: e.message }, null, 2));
      process.exit(2);
      return;
    }
  }

  const verificationFilePath = path.isAbsolute(verificationFileArg) ? verificationFileArg : path.join(cwd, verificationFileArg);
  const result = appendVerificationGap(cwd, verificationFilePath, {
    truth: opts.truth,
    reason: opts.reason,
    failure_type: opts.failureType || 'contract_mismatch',
    artifacts,
  });

  if (!result.ok) {
    process.stdout.write(JSON.stringify({ error: true, type: 'append_gap_failed', message: result.error }, null, 2));
    process.exit(1);
    return;
  }
  output({ appended: true, gaps_count: result.gaps_count, gap: result.gap }, raw);
}

// ─── Plan containment check ─────────────────────────────────────────────────
// `quality assess-risk <plan>`: at spike rigour, lists files_modified entries outside the spike roots
// (rigour_violation). The risk-domain add-ons are phase-level (`risk_addons`), not decided per plan.
function cmdQualityAssessRisk(cwd, filePath, raw) {
  if (!filePath) {
    output({ error: true, type: 'missing_argument', message: 'quality assess-risk: <plan-file> required' }, raw);
    return;
  }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (content === null) {
    output({ error: true, type: 'file_not_found', message: `Plan file not found: ${filePath}` }, raw);
    return;
  }

  let fm = {};
  try {
    const matter = require('gray-matter');
    fm = matter(content).data || {};
  } catch (e) {
    output({ error: true, type: 'malformed_frontmatter', message: e.message }, raw);
    return;
  }

  const level = rigour.resolveRigour(cwd, String(fm.phase ?? ''), getMilestoneInfo(cwd).version);
  if (level.rigour === 'spike') {
    const files = Array.isArray(fm.files_modified) ? fm.files_modified : (fm.files_modified ? [String(fm.files_modified)] : []);
    output({ rigour: 'spike', rigour_violation: rigour.rigourViolations(level.spike_roots, files), spike_roots: level.spike_roots }, raw);
    return;
  }
  output({
    rigour: 'standard',
    ...(level.rigour_source === 'rejected' ? { rigour_rejected_reason: level.rigour_rejected_reason } : {}),
  }, raw);
}

// verdictToIssues converts the plan-checker adversarial pass's {plan}-VERDICT.md frontmatter into the EXACT
// issues: shape gsd-plan-checker's ## ISSUES FOUND output already produces
// ({ plan, dimension, severity, description, fix_hint }), so the EXISTING
// plan-phase.md revision loop (step 12) can consume adversarial-review verdicts
// without any new revision mechanism. approved (or missing verdict) -> [].
// One issue per distinct required_change. A `blocker:` / `warning:` prefix on the entry sets its severity;
// otherwise revise -> warning, critical -> blocker.
function unavailableVerdictIssue(planId, reason) {
  return {
    plan: planId || null,
    dimension: 'adversarial_review',
    severity: 'blocker',
    description: `adversarial pass unavailable on a plan that requires it: ${reason}`,
    fix_hint: 'Re-run the plan-checker adversarial pass; a plan under the adversarial pass is not approved without a valid VERDICT.md.',
  };
}

// opts.required (plan under the adversarial pass): a missing or unrecognised verdict fails closed with a blocker
// issue instead of passing; without it the lenient pre-existing behaviour is kept.
function verdictToIssues(verdictFrontmatter, planId, opts) {
  const fm = verdictFrontmatter || {};
  const verdict = fm.verdict;
  if (opts && opts.required === true && !['approved', 'revise', 'critical'].includes(verdict)) {
    return [unavailableVerdictIssue(planId || fm.plan, verdict ? `unrecognised verdict "${verdict}"` : 'no verdict in VERDICT.md')];
  }
  if (verdict === 'approved' || !verdict) return [];

  const requiredChanges = Array.isArray(fm.required_changes) ? fm.required_changes : [];
  const defaultSeverity = verdict === 'critical' ? 'blocker' : 'warning';
  const resolvedPlanId = planId || fm.plan || null;

  const seen = new Set();
  const issues = [];
  for (const change of requiredChanges) {
    const text = typeof change === 'string' ? change : ((change && change.description) || JSON.stringify(change));
    const prefixed = /^\s*(blocker|warning):\s*/i.exec(text);
    const severity = prefixed ? prefixed[1].toLowerCase() : (change && change.severity === 'blocker' ? 'blocker' : defaultSeverity);
    const description = prefixed ? text.slice(prefixed[0].length) : text;
    if (seen.has(description)) continue;
    seen.add(description);
    issues.push({ plan: resolvedPlanId, dimension: 'adversarial_review', severity, description, fix_hint: typeof change === 'string' ? description : ((change && change.fix_hint) || null) });
  }
  return issues;
}

// Thin CLI wrapper over verdictToIssues. Never throws -- missing/malformed verdict
// file reported as {error:true, issues:[]}.
function cmdQualityVerdictToIssues(cwd, filePath, raw, required) {
  const planId = filePath ? path.basename(String(filePath)).replace(/-VERDICT\.md$/, '') : null;
  if (!filePath) {
    output({ error: true, type: 'missing_argument', message: 'quality verdict-to-issues: <verdict-file> required', issues: [] }, raw);
    return;
  }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (content === null) {
    output({ error: true, type: 'file_not_found', message: `Verdict file not found: ${filePath}`, issues: required ? [unavailableVerdictIssue(planId, 'VERDICT.md not found')] : [] }, raw);
    return;
  }

  let fm = {};
  try {
    const matter = require('gray-matter');
    fm = matter(content).data || {};
  } catch (e) {
    output({ error: true, type: 'malformed_frontmatter', message: e.message, issues: required ? [unavailableVerdictIssue(planId, 'VERDICT.md frontmatter unreadable')] : [] }, raw);
    return;
  }

  const issues = verdictToIssues(fm, fm.plan || planId, { required });
  output({ issues, verdict: fm.verdict || null }, raw);
}

// Writes candidate(s) to the queue directory. Accepts a single candidate
// object or an array; normalizes to an array. Skips any candidate without a
// truthy `id`. Returns the array of cwd-relative paths actually written.
function evalRegressionsConfigured(cwd) {
  try { return fs.statSync(path.join(cwd, EVAL_REGRESSIONS_ROOT)).isDirectory(); } catch { return false; }
}

function writeEvalCandidates(cwd, candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  // A project without tests/eval-regressions has not opted in: never create the tree inside it.
  if (!evalRegressionsConfigured(cwd)) return [];
  const queueDir = getEvalRegressionsQueueDir(cwd);
  fs.mkdirSync(queueDir, { recursive: true });

  const written = [];
  for (const candidate of list) {
    if (!candidate || !candidate.id) continue;
    const targetPath = path.join(queueDir, `${candidate.id}.json`);
    atomicWriteFileSync(targetPath, JSON.stringify(candidate, null, 2));
    written.push(path.relative(cwd, targetPath));
  }
  return written;
}

// ─── Eval Candidate Review Queue (MILE-32, Phase 55-02) ──────────────────────
// Human-in-the-loop lifecycle on top of Plan 55-01's queue/ writers:
// list/accept/reject. A candidate is only "pending" until a human reviews
// it; accept promotes it to a permanent, CI-visible fixture under accepted/;
// reject archives it (never deletes) with an appended reason trail.
const EVAL_CANDIDATE_REQUIRED_KEYS = ['id', 'source', 'created_at', 'title', 'context', 'expected', 'status'];
const EVAL_CANDIDATE_ALLOWED_SOURCES = ['debugger', 'verifier'];
const EVAL_CANDIDATE_ALLOWED_STATUSES = ['pending', 'accepted', 'rejected'];
const EVAL_CANDIDATE_ALLOWED_EXPECTED_TYPES = ['file_exists', 'file_not_exists', 'file_contains', 'file_not_contains'];

// Pure validator -- never throws. This is intentionally re-implemented
// (identical rule set) by Plan 55-03's eval-harness.js loader for the
// accepted-dir, to preserve eval-harness.js's zero-dependency-on-gsd-tools.js
// convention. Keep both copies in sync: a candidate that passes here must
// also pass there.
function validateEvalCandidateSchema(candidate) {
  const errors = [];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['candidate is not an object'] };
  }

  for (const key of EVAL_CANDIDATE_REQUIRED_KEYS) {
    const value = candidate[key];
    if (value === undefined || value === null || value === '') {
      errors.push(`missing required key: ${key}`);
    }
  }

  if (candidate.source !== undefined && candidate.source !== null && candidate.source !== '' && !EVAL_CANDIDATE_ALLOWED_SOURCES.includes(candidate.source)) {
    errors.push(`invalid source: ${candidate.source}`);
  }

  if (candidate.status !== undefined && candidate.status !== null && candidate.status !== '' && !EVAL_CANDIDATE_ALLOWED_STATUSES.includes(candidate.status)) {
    errors.push(`invalid status: ${candidate.status}`);
  }

  if (candidate.expected && typeof candidate.expected === 'object' && !Array.isArray(candidate.expected)) {
    const expected = candidate.expected;
    if (!EVAL_CANDIDATE_ALLOWED_EXPECTED_TYPES.includes(expected.type)) {
      errors.push(`invalid expected.type: ${expected.type}`);
    }
    if (!expected.file || typeof expected.file !== 'string') {
      errors.push('expected.file is required');
    }
    if ((expected.type === 'file_contains' || expected.type === 'file_not_contains') && !expected.needle) {
      errors.push('expected.needle is required for file_contains/file_not_contains');
    }
  }

  return { valid: errors.length === 0, errors };
}

// Reads every `*.json` file in the resolved dir (queue/accepted/archived,
// defaulting to queue for an unrecognized dirArg). Never throws, never skips
// a malformed file silently -- it is surfaced in the candidates array with an
// `error` field instead.
function cmdEvalCandidateList(cwd, dirArg, raw) {
  const dir = ['queue', 'accepted', 'archived'].includes(dirArg) ? dirArg : 'queue';
  const dirPath = path.join(cwd, EVAL_REGRESSIONS_ROOT, dir); // dir is validated above against the same three names getEvalRegressions*Dir() hardcode

  if (!fs.existsSync(dirPath)) {
    output({ dir, count: 0, candidates: [] }, raw);
    return;
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
  const candidates = [];
  for (const file of files) {
    const content = safeReadFile(path.join(dirPath, file));
    const parsed = content === null ? { ok: false, error: { message: 'could not read file' } } : safeJsonParse(content, file);
    if (parsed.ok) {
      const value = parsed.value || {};
      candidates.push({ file, id: value.id, title: value.title, status: value.status });
    } else {
      candidates.push({ file, error: 'malformed JSON' });
    }
  }

  output({ dir, count: candidates.length, candidates }, raw);
}

function cmdEvalCandidateAccept(cwd, id, raw) {
  if (!id) { error('eval-candidate accept: <id> required'); return; }

  const queuePath = path.join(getEvalRegressionsQueueDir(cwd), `${id}.json`);
  const content = safeReadFile(queuePath);
  if (content === null) {
    process.stdout.write(JSON.stringify({ error: true, type: 'candidate_not_found', id }, null, 2));
    process.exit(1);
    return;
  }

  const parsed = safeJsonParse(content, queuePath);
  if (!parsed.ok) {
    process.stdout.write(JSON.stringify({ error: true, type: 'malformed_candidate', id, message: parsed.error.message }, null, 2));
    process.exit(2);
    return;
  }

  const validation = validateEvalCandidateSchema(parsed.value);
  if (!validation.valid) {
    process.stdout.write(JSON.stringify({ error: true, type: 'invalid_candidate_schema', id, errors: validation.errors }, null, 2));
    process.exit(2);
    return;
  }

  const accepted = { ...parsed.value, status: 'accepted', accepted_at: new Date().toISOString() };
  const acceptedDir = getEvalRegressionsAcceptedDir(cwd);
  fs.mkdirSync(acceptedDir, { recursive: true });
  const acceptedPath = path.join(acceptedDir, `${id}.json`);
  atomicWriteFileSync(acceptedPath, JSON.stringify(accepted, null, 2));
  fs.unlinkSync(queuePath);

  output({ accepted: true, id, path: path.relative(cwd, acceptedPath) }, raw);
}

function cmdEvalCandidateReject(cwd, id, reason, raw) {
  if (!id) { error('eval-candidate reject: <id> required'); return; }
  if (!reason || !reason.trim()) { error('eval-candidate reject requires --reason'); return; }

  const queuePath = path.join(getEvalRegressionsQueueDir(cwd), `${id}.json`);
  const content = safeReadFile(queuePath);
  if (content === null) {
    process.stdout.write(JSON.stringify({ error: true, type: 'candidate_not_found', id }, null, 2));
    process.exit(1);
    return;
  }

  const parsed = safeJsonParse(content, queuePath);
  if (!parsed.ok) {
    process.stdout.write(JSON.stringify({ error: true, type: 'malformed_candidate', id, message: parsed.error.message }, null, 2));
    process.exit(2);
    return;
  }

  const existing = parsed.value;
  const combinedReason = existing.reason ? `${existing.reason}; ${reason}` : reason;
  const rejected = { ...existing, status: 'rejected', reason: combinedReason, rejected_at: new Date().toISOString() };

  const archivedDir = getEvalRegressionsArchivedDir(cwd);
  fs.mkdirSync(archivedDir, { recursive: true });
  const archivedPath = path.join(archivedDir, `${id}.json`);
  atomicWriteFileSync(archivedPath, JSON.stringify(rejected, null, 2));
  fs.unlinkSync(queuePath);

  output({ rejected: true, id, path: path.relative(cwd, archivedPath) }, raw);
}

function cmdEvalCandidateFromDebug(cwd, debugFileArg, raw) {
  if (!debugFileArg) {
    error('eval-candidate from-debug: <debug-file-path> required');
    return;
  }
  const debugFilePath = path.isAbsolute(debugFileArg) ? debugFileArg : path.join(cwd, debugFileArg);

  const candidate = buildEvalCandidateFromDebugFile(cwd, debugFilePath);
  if (candidate === null) {
    // Valid no-op (INVESTIGATION INCONCLUSIVE / no confirmed root_cause yet) -- exit 0, not a failure.
    output({ written: false, reason: 'no confirmed root_cause found in debug file' }, raw);
    return;
  }

  if (!evalRegressionsConfigured(cwd)) {
    output({ written: false, skipped: 'no tests/eval-regressions directory in this project', paths: [] }, raw);
    return;
  }
  const paths = writeEvalCandidates(cwd, candidate);
  output({ written: true, paths, candidate }, raw);
}

function cmdEvalCandidateFromVerification(cwd, verificationFileArg, raw) {
  if (!verificationFileArg) {
    error('eval-candidate from-verification: <verification-file-path> required');
    return;
  }
  const verificationFilePath = path.isAbsolute(verificationFileArg) ? verificationFileArg : path.join(cwd, verificationFileArg);

  const candidates = buildEvalCandidatesFromVerificationFile(cwd, verificationFilePath);
  if (candidates.length === 0) {
    output({ written: 0, paths: [] }, raw);
    return;
  }

  if (!evalRegressionsConfigured(cwd)) {
    output({ written: 0, skipped: 'no tests/eval-regressions directory in this project', paths: [] }, raw);
    return;
  }
  const paths = writeEvalCandidates(cwd, candidates);
  output({ written: paths.length, paths }, raw);
}

// ─── Prompt Budget CLI (MILE-30, Phase 53-02) ────────────────────────────────
// Thin CLI dispatch onto get-shit-done/bin/prompt-budget.js's pure functions.
// NOTE: named cmdPromptBudget (not cmdBudget) because `budget` is already an
// existing top-level command (cost/spend budget: `budget --period daily`,
// see cmdBudget(args, raw) above at knowledge-cost.js's Emergency Stop &
// Budget section). `gsd-tools.js budget check` is dispatched as a subcommand
// of the EXISTING `case 'budget':` (args[1] === 'check'), which routes here
// instead of falling through to the legacy cost-budget path -- see that case
// block for the routing logic. Mirrors cmdEval's `assert` subcommand:
// bypasses the shared output() helper (which always exits 0) and instead
// calls process.exit(result.pass ? 0 : 1) directly so CI can fail the job on
// a real budget violation.
function cmdPromptBudget(cwd, raw) {
  const result = promptBudget.checkAllBudgets(cwd);
  process.stdout.write(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

// ─── Reflective Prompt Optimization CLI (MILE-33, Phase 56-02) ──────────────
// Thin CLI dispatch onto get-shit-done/bin/prompt-optimize.js's
// runPromptOptimize orchestrator. Bypasses the shared output() helper (which
// always exits 0) and calls process.exit() directly, EXACT pattern as
// cmdEval's assert/regress subcommands and cmdPromptBudget above -- CI/human
// review needs the real exit code. Exit 0 for no_signal/ready_for_review,
// exit 1 for rejected/error. NEVER writes to agents/*.md -- runPromptOptimize
// itself is the only orchestration layer, and its only write path is
// writeReviewArtifacts under .planning/prompt-optimize/.
function cmdPromptOptimize(cwd, args, raw) {
  const agentIdx = args.indexOf('--agent');
  const agentArg = agentIdx !== -1 ? args[agentIdx + 1] : null;
  if (!agentArg) {
    error('prompt-optimize: --agent <name> required');
    return;
  }
  const result = promptOptimize.runPromptOptimize(cwd, agentArg);
  process.stdout.write(JSON.stringify(result, null, 2));
  const exitCode = (result.status === 'no_signal' || result.status === 'ready_for_review') ? 0 : 1;
  process.exit(exitCode);
}

function cmdTask(cwd, args, raw) {
  const subcommand = args[0];

  if (!subcommand) {
    error('task: subcommand required (analyze|chunk|batch|estimate|progress|resume)');
  }

  const progressPath = path.join(cwd, '.planning', 'batch_progress.json');

  switch (subcommand) {
    case 'analyze': {
      // Analyze a task for chunking requirements
      const descIdx = args.indexOf('--description');
      const description = descIdx !== -1 ? args[descIdx + 1] : null;
      const filesIdx = args.indexOf('--files');
      const filesGlob = filesIdx !== -1 ? args[filesIdx + 1] : null;

      if (!description) {
        error('task analyze: --description required');
      }

      // Expand glob if provided
      let files = [];
      if (filesGlob) {
        files = expandGlobSync(cwd, filesGlob);
      }

      const task = { description, files };
      const result = analyzeTask(task);

      const humanMsg = result.needsChunking
        ? `Task requires chunking: ${result.chunkCount} chunks via ${result.strategy} strategy`
        : `Task is manageable: ${result.complexity} complexity (${result.estimatedTokens} estimated tokens)`;

      output(result, raw, humanMsg);
      break;
    }

    case 'chunk': {
      // Get chunk definitions for a task
      const descIdx = args.indexOf('--description');
      const description = descIdx !== -1 ? args[descIdx + 1] : null;
      const filesIdx = args.indexOf('--files');
      const filesGlob = filesIdx !== -1 ? args[filesIdx + 1] : null;
      const strategyIdx = args.indexOf('--strategy');
      const strategyOverride = strategyIdx !== -1 ? args[strategyIdx + 1] : null;

      if (!description) {
        error('task chunk: --description required');
      }

      let files = [];
      if (filesGlob) {
        files = expandGlobSync(cwd, filesGlob);
      }

      const chunker = new TaskChunker();
      const task = { description, files };
      const estimate = chunker.estimateTaskTokens(task);
      const strategy = strategyOverride || chunker.selectChunkingStrategy(task, estimate);
      const chunkCount = chunker.calculateChunkCount(estimate.tokens, strategy, estimate.signals);
      const chunks = chunker.createChunks(task, strategy, chunkCount, estimate.signals);

      output({
        strategy,
        chunkCount,
        chunks
      }, raw, `Created ${chunkCount} chunks using ${strategy} strategy`);
      break;
    }

    case 'batch': {
      // Get batch breakdown for repetitive operations
      const descIdx = args.indexOf('--description');
      const description = descIdx !== -1 ? args[descIdx + 1] : null;
      const countIdx = args.indexOf('--count');
      const batchCount = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 10;

      if (!description) {
        error('task batch: --description required');
      }

      const chunker = new TaskChunker();
      const operationCount = chunker.extractOperationCount(description);
      const opsPerBatch = Math.ceil(operationCount / batchCount);

      const batches = [];
      for (let i = 0; i < batchCount; i++) {
        const start = i * opsPerBatch + 1;
        const end = Math.min((i + 1) * opsPerBatch, operationCount);
        if (start <= operationCount) {
          batches.push({
            batch: i + 1,
            range: `items ${start}-${end}`,
            count: end - start + 1
          });
        }
      }

      output({
        totalOperations: operationCount,
        batchCount: batches.length,
        batches
      }, raw, batches.map(b => `Batch ${b.batch}: ${b.range} (${b.count} items)`).join('\n'));
      break;
    }

    case 'estimate': {
      // Quick token estimate without full analysis
      const descIdx = args.indexOf('--description');
      const description = descIdx !== -1 ? args[descIdx + 1] : null;
      const filesIdx = args.indexOf('--files');
      const fileCount = filesIdx !== -1 ? parseInt(args[filesIdx + 1], 10) : 0;

      if (!description) {
        error('task estimate: --description required');
      }

      // Create minimal task object
      const task = {
        description,
        files: Array(fileCount || 0).fill('file.js')
      };

      const result = estimateTaskTokens(task);
      output(result, raw, `Estimated ${result.tokens} tokens (${result.complexity})`);
      break;
    }

    case 'progress': {
      // Show batch progress from checkpoint file
      if (!fs.existsSync(progressPath)) {
        output({ available: false, reason: 'No batch progress file found' }, raw, 'No active batch execution');
        break;
      }

      const progressParseResult = safeJsonParse(fs.readFileSync(progressPath, 'utf-8'), 'batch-progress.json');
      if (!progressParseResult.ok) {
        error(`task progress: ${progressParseResult.error.message} (corrupted ${progressPath})`);
      }
      const coordinator = BatchCoordinator.fromJSON(progressParseResult.value);
      const progress = coordinator.getProgress();

      output(progress, raw, `Progress: ${progress.completed}/${progress.total} chunks (${progress.percentComplete}%)`);
      break;
    }

    case 'resume': {
      // Resume from batch checkpoint
      if (!fs.existsSync(progressPath)) {
        output({ available: false, reason: 'No batch progress file found' }, raw, 'No batch to resume');
        break;
      }

      const resumeParseResult = safeJsonParse(fs.readFileSync(progressPath, 'utf-8'), 'batch-progress.json');
      if (!resumeParseResult.ok) {
        error(`task resume: ${resumeParseResult.error.message} (corrupted ${progressPath})`);
      }
      const coordinator = BatchCoordinator.fromJSON(resumeParseResult.value);
      const nextChunk = coordinator.getNextChunk();

      if (!nextChunk) {
        output({ complete: true, progress: coordinator.getProgress() }, raw, 'All chunks complete');
        break;
      }

      output({
        nextChunk,
        progress: coordinator.getProgress()
      }, raw, `Next chunk: ${nextChunk.id} - ${nextChunk.description}`);
      break;
    }

    default:
      error(`task: unknown subcommand "${subcommand}"`);
  }
}

// ─── Observability Commands ──────────────────────────────────────────────────

async function cmdObservability(args, raw) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'init': {
      const obs = require('./observability.js');
      obs.initTracing({ serviceName: 'gsd-cli' });
      break;
    }

    case 'status': {
      const obs = require('./observability.js');
      output({
        enabled: obs.isTracingEnabled(),
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'not configured'
      }, raw);
      break;
    }

    case 'cost': {
      const llm = require('./llm-metrics.js');
      const model = args[1] || 'opus';
      const input = parseInt(args[2]) || 0;
      const output_tokens = parseInt(args[3]) || 0;
      const cachedIdx = args.indexOf('--cached');
      const cached = cachedIdx > -1 ? parseInt(args[cachedIdx + 1]) : 0;

      const cost = llm.calculateCost(model, {
        input_tokens: input,
        output_tokens: output_tokens,
        cache_read_input_tokens: cached
      });

      output({
        model,
        input_tokens: input,
        output_tokens: output_tokens,
        cached_tokens: cached,
        ...cost
      }, raw);
      break;
    }

    case 'shutdown': {
      const obs = require('./observability.js');
      await obs.shutdownTracing();
      break;
    }

    default:
      error('Usage: observability init|status|cost|shutdown');
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function cmdDashboard(args) {
  const subcommand = args[0];
  const { startDashboard, stopDashboard } = require('./dashboard-server.js');

  switch (subcommand) {
    case 'start': {
      const httpPort = parseInt(args[args.indexOf('--http') + 1]) || 3000;
      const wsPort = parseInt(args[args.indexOf('--ws') + 1]) || 8080;
      startDashboard({ httpPort, wsPort });
      console.log('Dashboard server running. Press Ctrl+C to stop.');
      // Keep process alive
      await new Promise(() => {}); // Never resolves
      break;
    }

    case 'stop': {
      stopDashboard();
      break;
    }

    default:
      error('Usage: dashboard start [--http PORT] [--ws PORT] | stop');
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────

async function cmdHealth(args) {
  console.log('GSD Phase 8 Health Check\n');
  console.log('='.repeat(50));

  const checks = [];

  // Check 1: Telegram credentials
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramOwner = process.env.TELEGRAM_OWNER_ID;
  checks.push({
    name: 'Telegram Credentials',
    status: telegramToken && telegramOwner ? 'PASS' : 'FAIL',
    message: telegramToken && telegramOwner ?
      'Bot token and owner ID configured' :
      'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID in .env'
  });

  // Check 2: Anthropic API key
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  checks.push({
    name: 'Anthropic API Key',
    status: anthropicKey ? 'PASS' : 'FAIL',
    message: anthropicKey ?
      'API key configured for Haiku' :
      'Missing ANTHROPIC_API_KEY in .env'
  });

  // Check 3: Whisper model
  const { checkWhisperModel } = require('./whisper-transcribe.js');
  const whisperStatus = await checkWhisperModel();
  checks.push({
    name: 'Whisper Model',
    status: whisperStatus.available ? 'PASS' : 'WARN',
    message: whisperStatus.available ?
      `Model ready: ${whisperStatus.path}` :
      'Model not downloaded (voice messages disabled)'
  });

  // Check 4: OpenTelemetry
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  checks.push({
    name: 'OpenTelemetry',
    status: otelEndpoint ? 'PASS' : 'WARN',
    message: otelEndpoint ?
      `Exporting to: ${otelEndpoint}` :
      'No endpoint configured (tracing disabled)'
  });

  // Check 5: Session logs directory
  const fs = require('fs');
  const logsDir = '.planning/telegram-sessions';
  const logsDirExists = fs.existsSync(logsDir);
  checks.push({
    name: 'Session Logs',
    status: logsDirExists ? 'PASS' : 'WARN',
    message: logsDirExists ?
      `Directory exists: ${logsDir}` :
      `Directory will be created on first session`
  });

  // Check 6: Dashboard ports
  const isDashboardPortFree = await checkPort(8765);
  checks.push({
    name: 'Dashboard Port 8765',
    status: isDashboardPortFree ? 'PASS' : 'WARN',
    message: isDashboardPortFree ?
      'Port available' :
      'Port in use (use --http flag for custom port)'
  });

  // W008: detect absent nyquist_validation key in config.json
  const repairs = [];
  const configPath = path.join(process.cwd(), '.planning', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const configRaw = fs.readFileSync(configPath, 'utf-8');
      const configParsed = JSON.parse(configRaw);
      if (configParsed.workflow && configParsed.workflow.nyquist_validation === undefined) {
        checks.push({
          name: 'W008: nyquist_validation config',
          status: 'WARN',
          message: 'config.json: workflow.nyquist_validation absent (defaults to enabled but agents may skip). Run with --repair to add key.',
        });
        repairs.push('addNyquistKey');
      }
    } catch {}
  }

  // Print results
  let allPass = true;
  checks.forEach(check => {
    const symbol = check.status === 'PASS' ? '✓' :
                    check.status === 'WARN' ? '⚠' : '✗';
    const color = check.status === 'PASS' ? '\x1b[32m' :
                   check.status === 'WARN' ? '\x1b[33m' : '\x1b[31m';
    console.log(`${color}${symbol}\x1b[0m ${check.name}: ${check.message}`);

    if (check.status === 'FAIL') allPass = false;
  });

  console.log('\n' + '='.repeat(50));

  if (allPass) {
    console.log('\x1b[32m✓ All critical checks passed!\x1b[0m\n');
    console.log('Ready to use:');
    console.log('  Telegram MCP server    - Configure via .mcp.json (Phase 14 daemon architecture)');
    console.log('  dashboard start        - Launch real-time dashboard');
  } else {
    console.log('\x1b[31m✗ Some checks failed\x1b[0m\n');
    console.log('See SETUP.md for configuration instructions');
  }

  // Handle --repair flag
  if (args.includes('--repair') && repairs.length > 0) {
    console.log('\nRunning repairs...');
    for (const repair of repairs) {
      switch (repair) {
        case 'addNyquistKey': {
          if (fs.existsSync(configPath)) {
            try {
              const configRaw = fs.readFileSync(configPath, 'utf-8');
              const configParsed = JSON.parse(configRaw);
              if (!configParsed.workflow) configParsed.workflow = {};
              if (configParsed.workflow.nyquist_validation === undefined) {
                configParsed.workflow.nyquist_validation = true;
                atomicWriteFileSync(configPath, JSON.stringify(configParsed, null, 2));
                console.log('  ✓ Added workflow.nyquist_validation = true to config.json');
              }
            } catch {}
          }
          break;
        }
      }
    }
  }
}

async function checkPort(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// ─── Savings Report ───────────────────────────────────────────────────────────

function cmdSavings(cwd, args, raw) {
  const subcommand = args[0] || 'report';

  switch (subcommand) {
    case 'report': {
      // Phase 58 (MILE-36): retargeted from the old token_budget.json-based
      // generateReport() (phantom-file path, see 58-RESEARCH.md's audit
      // finding) onto the durable recorded-usage ledger. NEVER falls back to
      // the old path -- zero recorded usage means available:false, not a
      // silent empty-defaults report.
      const { readTaskUsageRecords, computeSavingsFromUsage, formatUsageSavingsTable } = require('./token-usage-ledger.js');
      const { getHistory } = require('./execution-log.js');
      const config = loadConfig(cwd);
      const usageRecords = readTaskUsageRecords(cwd);
      const taskOutcomeEvents = getHistory(cwd).filter(e => e && e.type === 'task_outcome');
      const report = computeSavingsFromUsage(usageRecords, taskOutcomeEvents, config.savings_baseline_tier);

      if (args.includes('--json')) {
        output(report, raw);
      } else {
        console.log(formatUsageSavingsTable(report));
      }
      break;
    }

    case 'calculate': {
      const { calculateSavings } = require('./savings-report.js');
      // Manual calculation: savings calculate --haiku 50000 --sonnet 100000 --opus 20000
      const haikuIdx = args.indexOf('--haiku');
      const sonnetIdx = args.indexOf('--sonnet');
      const opusIdx = args.indexOf('--opus');

      const haiku = haikuIdx > -1 ? parseInt(args[haikuIdx + 1]) : 0;
      const sonnet = sonnetIdx > -1 ? parseInt(args[sonnetIdx + 1]) : 0;
      const opus = opusIdx > -1 ? parseInt(args[opusIdx + 1]) : 0;

      const result = calculateSavings({
        haiku: { input: Math.floor(haiku * 0.7), output: Math.floor(haiku * 0.3) },
        sonnet: { input: Math.floor(sonnet * 0.7), output: Math.floor(sonnet * 0.3) },
        opus: { input: Math.floor(opus * 0.7), output: Math.floor(opus * 0.3) }
      });

      output(result, raw);
      break;
    }

    default:
      error('Usage: savings report [--json] | calculate --haiku N --sonnet N --opus N');
  }
}


// ─── Web Search (Brave API) ──────────────────────────────────────────────────

async function cmdWebsearch(query, options, raw) {
  const apiKey = process.env.BRAVE_API_KEY;

  if (!apiKey) {
    // No key = silent skip, agent falls back to built-in WebSearch
    output({ available: false, reason: 'BRAVE_API_KEY not set' }, raw, '');
    return;
  }

  if (!query) {
    output({ available: false, error: 'Query required' }, raw, '');
    return;
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options.limit || 10),
    country: 'us',
    search_lang: 'en',
    text_decorations: 'false'
  });

  if (options.freshness) {
    params.set('freshness', options.freshness);
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        }
      }
    );

    if (!response.ok) {
      output({ available: false, error: `API error: ${response.status}` }, raw, '');
      return;
    }

    const data = await response.json();

    const results = (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      age: r.age || null
    }));

    output({
      available: true,
      query,
      count: results.length,
      results
    }, raw, results.map(r => `${r.title}\n${r.url}\n${r.description}`).join('\n\n'));
  } catch (err) {
    output({ available: false, error: err.message }, raw, '');
  }
}

// ─── Frontmatter CRUD ────────────────────────────────────────────────────────

function cmdFrontmatterGet(cwd, filePath, field, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }
  const fm = extractFrontmatter(content);
  if (field) {
    const value = fm[field];
    if (value === undefined) { output({ error: 'Field not found', field }, raw); return; }
    output({ [field]: value }, raw, JSON.stringify(value));
  } else {
    output(fm, raw);
  }
}

function cmdFrontmatterSet(cwd, filePath, field, value, raw) {
  if (!filePath || !field || value === undefined) { error('file, field, and value required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(fullPath)) { output({ error: 'File not found', path: filePath }, raw); return; }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const fm = extractFrontmatter(content);
  let parsedValue;
  try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
  fm[field] = parsedValue;
  const newContent = spliceFrontmatter(content, fm);
  fs.writeFileSync(fullPath, newContent, 'utf-8');
  output({ updated: true, field, value: parsedValue }, raw, 'true');
}

function cmdFrontmatterMerge(cwd, filePath, data, raw) {
  if (!filePath || !data) { error('file and data required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(fullPath)) { output({ error: 'File not found', path: filePath }, raw); return; }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const fm = extractFrontmatter(content);
  let mergeData;
  try { mergeData = JSON.parse(data); } catch { error('Invalid JSON for --data'); return; }
  Object.assign(fm, mergeData);
  const newContent = spliceFrontmatter(content, fm);
  fs.writeFileSync(fullPath, newContent, 'utf-8');
  output({ merged: true, fields: Object.keys(mergeData) }, raw, 'true');
}

const FRONTMATTER_SCHEMAS = {
  plan: { required: ['phase', 'plan', 'type', 'wave', 'depends_on', 'files_modified', 'autonomous', 'requirements', 'must_haves'] },
  summary: { required: ['phase', 'plan', 'subsystem', 'tags', 'duration', 'completed'] },
  verification: { required: ['phase', 'verified', 'status'], any_of: [['ui_qa_ran', 'charlotte_qa_ran']] },
};

function cmdFrontmatterValidate(cwd, filePath, schemaName, raw) {
  if (!filePath || !schemaName) { error('file and schema required'); }
  const schema = FRONTMATTER_SCHEMAS[schemaName];
  if (!schema) { error(`Unknown schema: ${schemaName}. Available: ${Object.keys(FRONTMATTER_SCHEMAS).join(', ')}`); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }
  const fm = extractFrontmatter(content);
  const missingAnyOf = (schema.any_of || []).filter(group => !group.some(f => fm[f] !== undefined)).map(group => group[0]);
  const missing = [...schema.required.filter(f => fm[f] === undefined), ...missingAnyOf];
  const present = schema.required.filter(f => fm[f] !== undefined);
  output({ valid: missing.length === 0, missing, present, schema: schemaName }, raw, missing.length === 0 ? 'valid' : 'invalid');
}

// ─── Verification Suite ──────────────────────────────────────────────────────

// Phase 299 (SC-2): P0 tier-assignment plan gate. Runs the project's ONE frozen classifier engine
// (the `tier-assignment` entry of stack.gates[]) and never reimplements it in JS, because two
// independent copies would drift and the planning-time and verification-time hooks would then
// disagree about whether the same route is P0.
//
// LOAD-BEARING: the runner THROWS on the gate's exit-1 violations path, so the violations JSON
// arrives on the thrown error's `.stdout`. The catch block below MUST distinguish a real
// violation (status 1 + parseable {violations:[...]}) from every other failure shape (exit 127,
// ENOENT, status 2, unparseable stdout): with a profile gate every such shape is an error (a gap:
// a missing runtime or an unreadable verdict never silently neuters the gate); only the legacy
// script path keeps them as warnings[].
// The gate's `run` is a command string: `{root}` becomes cwd and the plan path travels as an
// argument to `sh -c`, never inside the string.
function runP0TierAssignmentGate(cwd, fullPath, deps = {}) {
  const exec = deps.exec || execFileSync;
  const exists = deps.existsSync || fs.existsSync;
  const errors = [];
  const warnings = [];
  let loaded;
  try { loaded = projectProfile.loadProfile(cwd); } catch { loaded = { error: 'unreadable' }; }
  const gates = loaded.error ? undefined : projectProfile.getProfileValue(loaded, 'stack.gates');
  const gate = Array.isArray(gates) ? gates.find(g => g && g.id === 'tier-assignment') : undefined;
  let file;
  let args;
  let notFound;
  let missingMsg = 'P0 tier-assignment gate: gate command or runtime not found — skipping check';
  if (gate && typeof gate.run === 'string') {
    const run = gate.run.split('{root}').join(cwd);
    file = 'sh';
    args = ['-c', run + ' "$@"', 'sh', '--plan', fullPath, '--json'];
    notFound = err => err && (err.code === 'ENOENT' || err.status === 127);
    missingMsg = 'P0 tier-assignment gate: gate command or runtime not found — a missing runtime is a gap, not a skip';
  } else if (gate) {
    errors.push('P0 tier-assignment gate: the stack.gates[] entry has no string `run` — a configured gate that cannot run is a gap');
    return { errors, warnings };
  } else if (projectContext.uiQaMode(cwd) !== 'legacy') {
    return { errors, warnings, status: 'not_configured' };
  } else {
    const scriptRel = 'scripts/check-p0-tier-assignment.ts';
    if (!exists(path.join(cwd, scriptRel))) return { errors, warnings };  // legacy repo without the classifier: inert
    file = 'deno';
    args = ['run', '--allow-read', scriptRel, '--plan', fullPath, '--json'];
    notFound = err => err && err.code === 'ENOENT';
    missingMsg = 'P0 tier-assignment gate: deno binary not found on PATH — skipping check';
  }

  const sink = gate && typeof gate.run === 'string' ? errors : warnings;
  const formatViolation = (v) =>
    `P0 surface class "${v.p0SurfaceClass}" touched (${v.path}) with no tier-assignment work — ${v.issue}`;

  let stdout;
  try {
    stdout = exec(file, args, { cwd, encoding: 'utf8' });
  } catch (err) {
    if (err && err.status === 1 && typeof err.stdout === 'string') {
      try {
        const parsed = JSON.parse(err.stdout);
        if (Array.isArray(parsed.violations)) {
          for (const v of parsed.violations) errors.push(formatViolation(v));
          if (parsed.violations.length === 0) sink.push('P0 tier-assignment gate: script exited 1 but reported zero violations — a failing gate with no finding is a gap');
        } else {
          sink.push('P0 tier-assignment gate: script exited 1 but stdout had no violations array — treating as unparseable');
        }
      } catch (parseErr) {
        sink.push('P0 tier-assignment gate: script exited 1 but stdout was not valid JSON — treating as unparseable');
      }
    } else if (notFound(err)) {
      sink.push(missingMsg);
    } else {
      sink.push(`P0 tier-assignment gate: gate command failed unexpectedly (${err && err.message ? err.message : 'unknown error'})`);
    }
    return { errors, warnings };
  }

  // Success path (no throw) — parse stdout for the clean/violation-free contract.
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed.violations)) {
      for (const v of parsed.violations) errors.push(formatViolation(v));
    } else {
      sink.push('P0 tier-assignment gate: script output had no violations array — treating as unparseable');
    }
  } catch (parseErr) {
    sink.push('P0 tier-assignment gate: script output was not valid JSON — treating as unparseable');
  }

  return { errors, warnings };
}

// Phase 299 (SC-5). Pure — no I/O. `required` is the consuming repo's declared list
// (.planning/config.json quality.required_gsd_gates — absent/null/[] all mean "no
// requirement"); `provided` is this fork's config/gate-capabilities.json manifest.
// Returns {ok, missing} on success paths (exact shape — no extra keys, so callers can
// deepStrictEqual against it), or {ok:false, missing:[], reason} when `required` itself
// is malformed (not an array) — a bad declaration must be loud, never a silent pass.
function compareGateCapabilities(required, provided) {
  if (required === undefined || required === null) {
    return { ok: true, missing: [] };
  }
  if (!Array.isArray(required)) {
    return { ok: false, missing: [], reason: 'quality.required_gsd_gates must be an array of capability IDs' };
  }
  const providedList = Array.isArray(provided) ? provided : [];
  const providedSet = new Set(providedList);
  const missing = [];
  const seen = new Set();
  for (const id of required) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!providedSet.has(id)) missing.push(id);
  }
  return { ok: missing.length === 0, missing };
}

// Phase 299 (SC-5): the launch-time version handshake. A consuming repo's
// .planning/config.json can declare quality.required_gsd_gates -- a list of
// capability IDs it depends on. This command fails loudly (non-zero exit) when
// the INSTALLED fork's config/gate-capabilities.json manifest doesn't provide
// one of them, closing the silent-pass class where a repo runs
// audit-milestone/complete-milestone against an old fork whose gate never
// existed and gets a green result anyway. Absent/null/[] required list is
// always a clean pass -- existing non-QA GSD projects are unaffected.
function cmdVerifyGateHandshake(cwd, raw) {
  // model-registry.js:25 convention -- resolves from the INSTALLED copy
  // (~/.claude/get-shit-done/bin/) as well as the fork source tree.
  const manifestPath = path.join(__dirname, '..', 'config', 'gate-capabilities.json');
  let provided = [];
  let manifestReason = null;
  try {
    const parsedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (Array.isArray(parsedManifest.capabilities)) {
      provided = parsedManifest.capabilities;
    } else {
      manifestReason = 'gate-capabilities.json missing a capabilities array -- treating installed fork as providing zero capabilities';
    }
  } catch (err) {
    // Missing/unparseable manifest must never crash this command -- degrade to
    // "provides nothing" and say why, same fail-open discipline as model-registry.js.
    manifestReason = `gate-capabilities.json unreadable or unparseable -- treating installed fork as providing zero capabilities (${err && err.message ? err.message : 'unknown error'})`;
  }

  // readRawConfigPath, NOT `config get` -- cmdConfigGet errors on an undefined
  // dotted key with no --default, which would make "field absent" (a clean
  // pass) indistinguishable from a crash. See design_decisions #2 in
  // 299-02-PLAN.md.
  const required = readRawConfigPath(cwd, 'quality.required_gsd_gates');
  const comparison = compareGateCapabilities(required, provided);

  const messages = [];
  if (comparison.reason) messages.push(comparison.reason);
  if (manifestReason) messages.push(manifestReason);
  for (const id of comparison.missing) {
    messages.push(
      `Installed GSD fork lacks required gate capability: ${id}. Roll out the fork with ` +
      `\`npm run install:gsd\` from ~/get-shit-done, or remove the requirement from ` +
      `.planning/config.json quality.required_gsd_gates.`
    );
  }

  const resultData = {
    ok: comparison.ok,
    missing: comparison.missing,
    required: required === undefined || required === null ? [] : required,
    provided,
    messages,
  };
  process.stdout.write(JSON.stringify(resultData, null, 2));
  process.exit(comparison.ok ? 0 : 1);
}

function cmdVerifyPlanStructure(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const fm = extractFrontmatter(content);
  const errors = [];
  const warnings = [];

  // Check required frontmatter fields
  const required = ['phase', 'plan', 'type', 'wave', 'depends_on', 'files_modified', 'autonomous', 'must_haves'];
  for (const field of required) {
    if (fm[field] === undefined) errors.push(`Missing required frontmatter field: ${field}`);
  }

  // Parse and check task elements
  const taskPattern = /<task[^>]*>([\s\S]*?)<\/task>/g;
  const taskTagPattern = /<task([^>]*)>/g;
  const tasks = [];
  let taskMatch;
  let taskTagMatch;
  const taskOpenTags = [];
  while ((taskTagMatch = taskTagPattern.exec(content)) !== null) {
    taskOpenTags.push(taskTagMatch[1] || '');
  }
  let taskIdx = 0;
  taskPattern.lastIndex = 0;
  while ((taskMatch = taskPattern.exec(content)) !== null) {
    const taskAttrs = taskOpenTags[taskIdx] || '';
    taskIdx++;
    // Checkpoint tasks have different structure — skip <name>/<action> checks for them
    const isCheckpointTask = /type=["']?checkpoint:/.test(taskAttrs);
    const taskContent = taskMatch[1];
    const nameMatch = taskContent.match(/<name>([\s\S]*?)<\/name>/);
    const taskName = nameMatch ? nameMatch[1].trim() : (isCheckpointTask ? '(checkpoint)' : 'unnamed');
    const hasFiles = /<files>/.test(taskContent);
    const hasAction = /<action>/.test(taskContent) || isCheckpointTask;
    const hasVerify = /<verify>/.test(taskContent);
    const hasDone = /<done>/.test(taskContent);
    const hasAutomated = /<automated>/.test(taskContent);

    if (!isCheckpointTask) {
      if (!nameMatch) errors.push('Task missing <name> element');
      if (!hasAction) errors.push(`Task '${taskName}' missing <action>`);
      if (!hasVerify) warnings.push(`Task '${taskName}' missing <verify>`);
      if (!hasDone) warnings.push(`Task '${taskName}' missing <done>`);
      if (!hasFiles) warnings.push(`Task '${taskName}' missing <files>`);
    }

    tasks.push({ name: taskName, isCheckpoint: isCheckpointTask, hasFiles, hasAction, hasVerify, hasDone, hasAutomated });
  }

  if (tasks.length === 0) warnings.push('No <task> elements found');

  // Wave/depends_on consistency
  if (fm.wave && parseInt(fm.wave) > 1 && (!fm.depends_on || (Array.isArray(fm.depends_on) && fm.depends_on.length === 0))) {
    warnings.push('Wave > 1 but depends_on is empty');
  }

  // Autonomous/checkpoint consistency
  const hasCheckpoints = /<task\s+type=["']?checkpoint/.test(content);
  if (hasCheckpoints && fm.autonomous !== 'false' && fm.autonomous !== false) {
    errors.push('Has checkpoint tasks but autonomous is not false');
  }

  // Dimension 9a (plan-checker): a <verify> needs an <automated> command or a Wave 0 dependency.
  // Wave 0 linkage is not resolvable here, so absence is a warning, not an error.
  if (loadConfig(cwd).nyquist_validation !== false) {
    for (const t of tasks) {
      if (t.hasVerify && !t.hasAutomated) warnings.push(`Task '${t.name}' <verify> has no <automated> command (needs one or a Wave 0 dependency)`);
    }
  }

  // UI-QA check: plans that modify UI files must have a checkpoint:ui-qa task, unless the project
  // declares stack capabilities without ui_qa (UI_FILE_PATTERNS is a shared top-level constant — see "Shared File-Pattern Constants")
  const filesModified = Array.isArray(fm.files_modified)
    ? fm.files_modified
    : (fm.files_modified ? [String(fm.files_modified)] : []);
  const hasUiFiles = filesModified.some(f =>
    UI_FILE_PATTERNS.some(ext => f.endsWith(ext))
  );
  const hasUiQaTask = /<task[^>]+type=["']?checkpoint:ui-qa/.test(content);
  if (hasUiFiles && !hasUiQaTask && projectContext.uiQaMode(cwd) !== 'none') {
    errors.push('Plan modifies UI files (.tsx/.jsx/.vue/.svelte) but has no checkpoint:ui-qa task');
  }

  // Test check: plans that modify API/route files must carry <acceptance> rows (or a tdd="true" task)
  // (API_FILE_PATTERNS is a shared top-level constant — see "Shared File-Pattern Constants")
  const hasApiFiles = filesModified.some(f =>
    API_FILE_PATTERNS.some(pat => f.includes(pat))
  );
  const hasTddTask = /tdd=["']?true|<acceptance>/.test(content);
  if (hasApiFiles && !hasTddTask) {
    errors.push('Plan modifies API/route files but has no <acceptance> rows (or tdd="true" task)');
  }

  // P0 tier-assignment check (Phase 299 SC-2): shells out to the target repo's frozen classifier
  // engine, if it ships one. Inert (zero errors, zero warnings) for repos without the script.
  const p0Gate = runP0TierAssignmentGate(cwd, fullPath);
  errors.push(...p0Gate.errors);
  warnings.push(...p0Gate.warnings);

  // Output result and exit with code reflecting validation status
  // Exit 1 when errors exist so bash callers can gate on this
  const resultData = {
    valid: errors.length === 0,
    errors,
    warnings,
    task_count: tasks.length,
    tasks,
    frontmatter_fields: Object.keys(fm),
  };
  process.stdout.write(JSON.stringify(resultData, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

function cmdVerifyPhaseCompleteness(cwd, phase, raw) {
  if (!phase) { error('phase required'); }
  const phaseInfo = findPhaseInternal(cwd, phase);
  if (!phaseInfo || !phaseInfo.found) {
    output({ error: 'Phase not found', phase }, raw);
    return;
  }

  const errors = [];
  const warnings = [];
  const phaseDir = path.join(cwd, phaseInfo.directory);

  // List plans and summaries
  let files;
  try { files = fs.readdirSync(phaseDir); } catch { output({ error: 'Cannot read phase directory' }, raw); return; }

  const plans = files.filter(f => f.match(/-PLAN\.md$/i));
  const summaries = files.filter(f => f.match(/-SUMMARY\.md$/i));

  // Extract plan IDs (everything before -PLAN.md)
  const planIds = new Set(plans.map(p => p.replace(/-PLAN\.md$/i, '')));
  const summaryIds = new Set(summaries.map(s => s.replace(/-SUMMARY\.md$/i, '')));

  // Plans without summaries
  const incompletePlans = [...planIds].filter(id => !summaryIds.has(id));
  if (incompletePlans.length > 0) {
    errors.push(`Plans without summaries: ${incompletePlans.join(', ')}`);
  }

  // Summaries without plans (orphans)
  const orphanSummaries = [...summaryIds].filter(id => !planIds.has(id));
  if (orphanSummaries.length > 0) {
    warnings.push(`Summaries without plans: ${orphanSummaries.join(', ')}`);
  }

  output({
    complete: errors.length === 0,
    phase: phaseInfo.phase_number,
    plan_count: plans.length,
    summary_count: summaries.length,
    incomplete_plans: incompletePlans,
    orphan_summaries: orphanSummaries,
    errors,
    warnings,
  }, raw, errors.length === 0 ? 'complete' : 'incomplete');
}

// ─── Phase Gate (MILE-05, Phase 45-01) ───────────────────────────────────────
// Deterministic replacement for scattered self-reported prose checklists:
// computes which of 5 expected artifacts (test, ui_qa, docs, e2e_plan,
// verification) a phase's plans were expected to produce, cross-references
// against what actually landed (via collectPhaseTouchedFiles -- git-diff
// based, never frontmatter-based), and honors DEFERRED.json waivers. Exits
// non-zero (1 = failed checks, 2 = malformed plan/waiver data) so callers can
// gate on this deterministically instead of trusting self-reported prose.

const DOC_PATH_SIGNAL_RE = /(api|route|handler|endpoint|router|page|pages\/|screen|view|frontend|migration|schema|prisma|model)/i;
const LEGACY_RISK = require('./legacy-risk-keywords.js');
const DOC_KEYWORD_SIGNAL_RE = new RegExp(`(${['new service', 'middleware', 'new schema', 'auth', 'onboarding', 'flow', ...LEGACY_RISK.doc_signal].join('|')})`, 'i');
const DOC_SATISFIED_RE = /(docs\/|README|CHANGELOG\.md)/i;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js)$/;
const E2E_GENERATION_FAILED_FILENAME = 'E2E-GENERATION-FAILED.json';

// Pure regex-based test-content counters (MILE-10, Phase 46-03). Deliberately
// NOT AST-based -- regex counting is the accepted MVP bar for this milestone
// (see 46-03-PLAN.md's scope boundary). countTestCalls intentionally does NOT
// match `it.skip(`/`test.skip(`/`it.todo(` forms -- those have a `.`
// immediately after `it`/`test`, not `(`, so the regex naturally excludes
// them with no extra logic.
function countTestCalls(content) {
  if (!content) return 0;
  // Also counts camelCase wrappers around test( (pausedTest(, integrationTest(); an in-file `function xTest(` definition is not a call.
  const matches = content.match(/(?<!function\s)\b(?:it|test|[a-z]\w*Test)\s*\(/g);
  return matches ? matches.length : 0;
}
function countAssertions(content) {
  if (!content) return 0;
  // Recognize namespace-style calls (assert.equal(, assert.deepStrictEqual(, ...)
  // in addition to bare expect(/assert( -- the optional (?:\.\w+)? group matches
  // a single method segment after `assert` before the opening paren (MILE-27).
  // Runner-native assertEquals(/assertExists(/helper assertFoo2( and expect*/verify*/check*/should* helpers count too.
  const matches = content.match(/\b(?:expect|assert\w*(?:\.\w+)?|(?:expect|verify|check|should)[A-Z_]\w*)\s*\(/g);
  return matches ? matches.length : 0;
}

// Pure gap-detection function (MILE-08, Phase 46-01): given the phase's
// touched files and the raw text content of E2E-TEST-PLAN.md (or null if the
// file doesn't exist), returns which UI files' basenames are NOT mentioned
// anywhere in the plan text. No I/O -- callers (cmdVerifyPhaseGate and
// cmdVerifyE2EGaps) both read the file themselves and pass the content in, so
// both agree on the exact same gap-detection logic. A missing plan means
// every UI file is a gap.
function computeE2ECoverageGaps(touchedFiles, e2ePlanContent) {
  const uiFiles = touchedFiles.filter(isUIFile);
  if (e2ePlanContent === null || e2ePlanContent === undefined) {
    return { uiFiles, gaps: uiFiles.map(f => path.basename(f, path.extname(f))) };
  }
  const lowerPlan = e2ePlanContent.toLowerCase();
  const gaps = uiFiles
    .map(f => path.basename(f, path.extname(f)))
    .filter(basename => !lowerPlan.includes(basename.toLowerCase()));
  return { uiFiles, gaps };
}

// Reads the phase's E2E-GENERATION-FAILED.json marker (written by
// execute-phase.md's e2e_coverage_closure step when gsd-e2e-test-generator
// fails or leaves residual gaps). Absent file -> null (no failure recorded).
// Malformed JSON -> treated as a failure anyway (fail-loud-but-graceful,
// matching safeJsonParse's established convention) rather than crashing or
// silently ignoring a marker that clearly indicates something went wrong.
function readE2EGenerationFailure(phaseDir) {
  const markerPath = path.join(phaseDir, E2E_GENERATION_FAILED_FILENAME);
  const content = safeReadFile(markerPath);
  if (content === null) return null;
  const parsed = safeJsonParse(content, E2E_GENERATION_FAILED_FILENAME);
  if (!parsed.ok) {
    return { error: 'marker file malformed', timestamp: null };
  }
  return parsed.value;
}

// Shared malformed-JSON-safe reader for a phase's DEFERRED.json waiver file.
// Single source of truth for: cmdVerifyPhaseGate's waiver lookup, `deferred
// add`, and `deferred list` (Phase 45-03). An absent file is NOT an error --
// it means zero waivers. A malformed file (invalid JSON, not an array, or any
// entry missing step/reason/approver/phase) is ALWAYS surfaced as a typed
// `malformed_waiver` error -- never silently treated as "no waivers", per
// 45-01's US-3 acceptance criteria.
function readDeferredWaivers(cwd, phaseDirRelative) {
  const deferredPath = path.join(cwd, phaseDirRelative, 'DEFERRED.json');
  if (!fs.existsSync(deferredPath)) {
    return { ok: true, waivers: [] };
  }
  const content = safeReadFile(deferredPath);
  if (content === null) {
    return { ok: false, error: { error: true, type: 'malformed_waiver', context: 'DEFERRED.json', message: 'Could not read DEFERRED.json' } };
  }
  const parsed = safeJsonParse(content, 'DEFERRED.json');
  if (!parsed.ok) {
    return { ok: false, error: { error: true, type: 'malformed_waiver', context: 'DEFERRED.json', message: parsed.error.message } };
  }
  if (!Array.isArray(parsed.value)) {
    return { ok: false, error: { error: true, type: 'malformed_waiver', context: 'DEFERRED.json', message: 'DEFERRED.json must be an array of waiver entries' } };
  }
  const invalidEntry = parsed.value.find(e => !e || typeof e !== 'object' || !e.step || !e.reason || !e.approver || !e.phase);
  if (invalidEntry !== undefined) {
    return { ok: false, error: { error: true, type: 'malformed_waiver', context: 'DEFERRED.json', message: 'One or more DEFERRED.json entries missing required fields (step, reason, approver, phase)' } };
  }
  return { ok: true, waivers: parsed.value };
}

// Best-effort, fire-and-forget Telegram notification fired after a waiver is
// successfully written by `deferred add`. Never blocks or fails the caller:
// missing env vars, network errors, and timeouts are all swallowed (logged to
// stderr at most). Uses Node's built-in `https` module -- no new dependency.
function notifyTelegramWaiver(entry) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.TELEGRAM_OWNER_ID;
  if (!token || !ownerId) {
    process.stderr.write('Telegram not configured — skipping waiver notification\n');
    return;
  }
  try {
    const https = require('https');
    const text = `GSD Waiver Recorded\nPhase: ${entry.phase}${entry.plan ? ` (plan ${entry.plan})` : ''}\nStep: ${entry.step}\nReason: ${entry.reason}\nApprover: ${entry.approver}`;
    const body = JSON.stringify({ chat_id: ownerId, text });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 3000,
    }, (res) => {
      res.on('data', () => {});
      res.on('error', () => {});
    });
    req.on('error', () => { /* swallow -- best-effort, never fail the caller */ });
    req.on('timeout', () => { req.destroy(); });
    req.write(body);
    req.end();
  } catch (_e) {
    // Swallow -- best-effort notification must never affect deferred add's outcome.
  }
}

// Returns the first waiver entry (from DEFERRED.json) matching this check's
// `step`, the current phase number, and either no plan-scoping or a matching
// plan. Phase-wide waivers (no `plan` field) match any plan.
function findPhaseGateWaiver(waivers, step, phaseNumber, planNum) {
  return waivers.find(entry =>
    entry && entry.step === step &&
    String(entry.phase) === String(phaseNumber) &&
    (!entry.plan || entry.plan === planNum)
  );
}

// Evaluates a single expected-artifact check. `computeSatisfied` is only
// invoked when `required` is true (avoids unnecessary fs/git work for
// not-required checks).
function evaluatePhaseGateCheck(type, required, computeSatisfied, waivers, phaseNumber, failureTypeOverride) {
  if (!required) {
    return { type, required: false, satisfied: true, waived: false, failure_type: null, detail: 'not required for this phase' };
  }
  const satisfied = computeSatisfied();
  if (satisfied) {
    return { type, required: true, satisfied: true, waived: false, failure_type: null, detail: 'satisfied' };
  }
  // A DEFERRED.json entry written before the check was renamed uses the old step name; both names waive it.
  const steps = type === 'ui_qa' ? ['ui_qa', 'charlotte_qa'] : [type];
  const waiver = steps.map(step => findPhaseGateWaiver(waivers, step, phaseNumber, null)).find(Boolean);
  if (waiver) {
    return { type, required: true, satisfied: true, waived: true, failure_type: null, detail: 'waived: DEFERRED.json entry found' };
  }
  return { type, required: true, satisfied: false, waived: false, failure_type: failureTypeOverride || `missing_${type}`, detail: `${type} check failed` };
}

// Shared plan-collection / touched-files / HAS_UI computation used by both
// cmdVerifyPhaseGate and cmdVerifyE2EGaps (Phase 46-01) -- a single source of
// truth so the pre-check (`verify e2e-gaps`) and the actual gate
// (`verify phase-gate`) can never disagree about what counts as touched or
// UI-bearing for a given phase. Returns `{ error }` on phase-not-found or
// unreadable phase dir; callers must check for that before using other
// fields.
function loadPhaseGateInputs(cwd, phaseArg) {
  const phaseInfo = findPhaseInternal(cwd, phaseArg);
  // findPhaseInternal prefix-matches ("38" -> "381-..."); gate only the exact phase.
  if (!phaseInfo || !phaseInfo.found ||
      normalizePhaseName(String(phaseInfo.phase_number)) !== normalizePhaseName(String(phaseArg))) {
    return { error: { error: true, type: 'phase_not_found', phase: phaseArg } };
  }

  const phaseDir = path.join(cwd, phaseInfo.directory);

  let dirFiles;
  try {
    dirFiles = fs.readdirSync(phaseDir);
  } catch (e) {
    return { error: { error: true, type: 'phase_dir_unreadable', phase: phaseArg, message: e.message } };
  }

  // Collect plans -- malformed-tolerant: a broken PLAN.md is recorded and
  // skipped for artifact computation, never a hard crash of the whole command.
  // Deliberately requires a 2-digit plan number directly before "-PLAN.md"
  // (matching the real `{phase}-{planNN}-PLAN.md` naming convention) rather
  // than a bare `/-PLAN\.md$/i`, which would incidentally also match
  // artifact filenames like "E2E-TEST-PLAN.md" and misclassify them as a
  // malformed task-plan file (missing `plan:` frontmatter) purely because
  // of their name. Bug found via 46-01's e2e-gaps tests (Phase 46-01 Task 2).
  const planFileNames = dirFiles.filter(f => f.match(/-\d{2}-PLAN\.md$/i));
  const malformedPlans = [];
  const validPlans = [];

  for (const file of planFileNames) {
    try {
      const fullPath = path.join(phaseDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const fm = extractFrontmatter(content);
      if (!fm.plan || typeof fm.plan !== 'string' || fm.plan.trim() === '') {
        malformedPlans.push({ plan: file, failure_type: 'malformed_frontmatter', message: 'Missing or invalid `plan` field in frontmatter' });
        continue;
      }
      validPlans.push({ file, fm, content, planNum: fm.plan });
    } catch (e) {
      malformedPlans.push({ plan: file, failure_type: 'malformed_frontmatter', message: e.message });
    }
  }

  // Touched files -- derived purely from git history, never from frontmatter.
  const { files: touchedFiles, warnings: touchedWarnings, filesByPlan } = collectPhaseTouchedFiles(cwd, phaseInfo.phase_number, validPlans);

  // HAS_UI: diff-derived, independent of SUMMARY.md self-reports. Detects both
  // UI-extension files and UI-only-by-path route files (app/pages/routes,
  // excluding api/ sub-paths and config/declaration files). See 45-02-PLAN.md.
  const hasUi = computeHasUI(touchedFiles);

  return { phaseInfo, phaseDir, dirFiles, touchedFiles, touchedWarnings, filesByPlan, hasUi, malformedPlans, validPlans };
}

// Parses {N}-VERIFICATION.md. Frontmatter via gray-matter; a file without a
// frontmatter block falls back to the first `status:` line (legacy format).
function readPhaseVerification(phaseDir, phaseNumber) {
  const fileName = `${phaseNumber}-VERIFICATION.md`;
  const content = safeReadFile(path.join(phaseDir, fileName));
  if (content === null) return { exists: false, fileName, status: null, data: {} };
  let data = {};
  try {
    data = require('gray-matter')(content).data || {};
  } catch (e) {
    return { exists: true, fileName, status: 'unparseable', data: {}, parseError: e.message };
  }
  let status = data.status !== undefined ? String(data.status).trim() : null;
  if (status === null) {
    const m = content.match(/^status:\s*(\S+)/m);
    status = m ? m[1].trim() : 'unknown';
  }
  return { exists: true, fileName, status, data };
}

// On-disk evidence a phase must carry before it can be gated or completed:
// every numbered PLAN has a SUMMARY whose Self-Check is PASSED, every plan has
// at least one commit tagged {N}-{NN}, and {N}-VERIFICATION.md says passed.
// Shared by cmdPhaseComplete and cmdVerifyPhaseGate so they cannot disagree.
function collectPhaseEvidenceErrors(cwd, phaseNumber, phaseDir, dirFiles, opts = {}) {
  const errors = [];
  // Form findings (Self-Check section) are also kept as {file, check, message}; `errors` stays the full list.
  const formErrors = [];
  const pushForm = (file, check, message) => { errors.push(message); formErrors.push({ file, check, message }); };
  const planFiles = dirFiles.filter(f => /-\d{2}-PLAN\.md$/i.test(f)).sort();
  if (planFiles.length === 0) {
    errors.push('No numbered {N}-{NN}-PLAN.md files — a phase with no plans has no evidence to complete');
  }
  for (const planFile of planFiles) {
    const summaryFile = planFile.replace(/-PLAN\.md$/i, '-SUMMARY.md');
    const summary = dirFiles.includes(summaryFile) ? safeReadFile(path.join(phaseDir, summaryFile)) : null;
    if (summary === null) {
      errors.push(`Plan ${planFile} has no matching SUMMARY.md`);
      continue;
    }
    const selfCheck = evaluateSummarySelfCheck(summary);
    if (selfCheck.source !== 'self_check' || selfCheck.status !== 'passed') {
      const found = selfCheck.source === 'self_check' ? selfCheck.status : 'missing';
      // A missing section is form; a recorded FAILED is the executor reporting unfinished work.
      const selfCheckMsg = `${summaryFile} Self-Check is ${found} — must contain "## Self-Check: PASSED"`;
      if (found === 'missing') pushForm(summaryFile, 'self_check', selfCheckMsg); else errors.push(selfCheckMsg);
    }
  }
  const plans = planFiles.map(f => ({ planNum: f.match(/-(\d{2})-PLAN\.md$/i)[1] }));
  const { warnings, files: touched } = collectPhaseTouchedFiles(cwd, phaseNumber, plans);
  for (const w of warnings) {
    if (w.warning === 'no_commits_found') {
      errors.push(`Plan ${phaseNumber}-${w.plan} has no commits (git log --all --grep "${phaseNumber}-${w.plan}" is empty)`);
    }
  }
  // A spike has no separate review file: its {N}-VERIFICATION.md (the merged final review) is the record, checked below.
  const spike = rigour.resolveRigour(cwd, phaseNumber, getMilestoneInfo(cwd).version).rigour === 'spike';
  // A phase closed earlier (a `phase_complete` event, or checked in the ROADMAP when the one-time `gate_baseline` was taken) was
  // closed under the rules of its time: the review and answer-table rules judge only phases still open.
  const closedEarlier = closedPhaseKeys(cwd).has(dispatch.phaseKey(phaseNumber));
  if (!spike && !closedEarlier && !opts.preVerifier) errors.push(...reviewGate.reviewErrors(phaseDir, dirFiles, touched, { risk: riskAddons(cwd, phaseNumber, 'standard') }));
  // The verifier writes the answer table, so the pre-verifier gate cannot demand it; the final gate does.
  if (spike && !closedEarlier) errors.push(...spikeCheck.answerTableErrors(cwd, phaseDir, dirFiles, { requireTable: !opts.preVerifier }));
  const verification = readPhaseVerification(phaseDir, phaseNumber);
  if (!opts.preVerifier) errors.push(...reviewGate.verificationReviewErrors(verification, spike, closedEarlier));
  // Pre-verifier mode: the verifier produces this artifact, so demanding it earlier is circular.
  if (opts.preVerifier) {
    // intentionally no verification-artifact error
  } else if (!verification.exists) {
    errors.push(`${verification.fileName} not found — verifier must run before phase can be marked complete`);
  } else if (verification.status !== 'passed') {
    errors.push(`${verification.fileName} status is ${verification.status} — must be passed before phase complete`);
  }
  return {
    errors,
    formErrors,
    workErrors: errors.filter(m => !formErrors.some(f => f.message === m)),
    verification,
  };
}

// The one split of a phase's open errors: missing WORK (workErrors) vs FORM (Self-Check section missing, a
// planning-record line cite in the phase's own PLAN/SUMMARY). phaseTruth, `phase complete` and `verify phase-gate`
// all read it, so they cannot disagree. Plan caps are plan-time only (`verify form --plans-only`).
function collectPhaseFormErrors(cwd, phaseInfo, phaseDir, dirFiles, opts = {}) {
  const evidence = opts.evidence || collectPhaseEvidenceErrors(cwd, phaseInfo.phase_number, phaseDir, dirFiles, { preVerifier: opts.preVerifier === true });
  const spike = rigour.resolveRigour(cwd, phaseInfo.phase_number, getMilestoneInfo(cwd).version).rigour === 'spike';
  const agreement = spike ? spikeCheck.statusAgreementErrors(cwd, phaseInfo.phase_number).map((message) => ({ file: '.planning', check: 'status_agreement', message })) : [];
  return { errors: [...evidence.formErrors, ...formCheck.checkLineCites(cwd, phaseDir, dirFiles), ...agreement], workErrors: evidence.workErrors, evidence };
}

// verify form <phase> [--plans-only] [--raw]: the blocking plan-time check (post-execution form is `verify phase-gate`).
function cmdVerifyForm(cwd, args, raw) {
  const phase = args.find((a) => !a.startsWith('--'));
  if (!phase) error('verify form: phase required');
  const info = findPhaseInternal(cwd, phase);
  if (!info) error(`Phase ${phase} not found`);
  const phaseDir = path.join(cwd, info.directory);
  const dirFiles = fs.readdirSync(phaseDir);
  const errors = formCheck.checkPlans(phaseDir, dirFiles, rigour.resolveRigour(cwd, info.phase_number, getMilestoneInfo(cwd).version).rigour);
  output({ phase: info.phase_number, passed: errors.length === 0, errors }, raw, undefined, errors.length === 0 ? 0 : 1);
}

function cmdVerifyPhaseGate(cwd, phaseArg, raw, opts = {}) {
  const inputs = loadPhaseGateInputs(cwd, phaseArg);
  if (inputs.error) {
    process.stdout.write(JSON.stringify(inputs.error, null, 2));
    process.exit(inputs.error.type === 'phase_not_found' ? 1 : 1);
    return;
  }
  const { phaseInfo, phaseDir, dirFiles, touchedFiles, touchedWarnings, hasUi, malformedPlans, validPlans } = inputs;
  const form = collectPhaseFormErrors(cwd, phaseInfo, phaseDir, dirFiles, { preVerifier: opts.preVerifier === true });
  const evidence = form.evidence;
  const preVerifier = opts.preVerifier === true;
  const hasApi = computeHasApi(touchedFiles, apiDetectionOpts(cwd));
  const uiQaMode = projectContext.uiQaMode(cwd);
  const spike = rigour.resolveRigour(cwd, phaseInfo.phase_number, getMilestoneInfo(cwd).version).rigour === 'spike';
  const uiQaRequired = !spike && (hasUi || hasApi) && uiQaMode !== 'none';
  // ui_qa_ran is written by the verifier (Step 8c), so the pre-verifier gate cannot require it either.
  const uiQaCheckRequired = uiQaRequired && !preVerifier;

  // Waiver lookup -- shared with `deferred add`/`deferred list` (45-03) via
  // readDeferredWaivers(), so all three code paths agree on what counts as a
  // malformed DEFERRED.json.
  let waivers = [];
  let malformedWaiver = null;
  const deferredResult = readDeferredWaivers(cwd, phaseInfo.directory);
  if (!deferredResult.ok) {
    malformedWaiver = { type: 'malformed_waiver', message: deferredResult.error.message };
  } else {
    waivers = deferredResult.waivers;
  }

  // Docs signal: path-based patterns against touched files, OR keyword
  // patterns against the phase's own *-SUMMARY.md text.
  const summaryFileNames = dirFiles.filter(f => f.match(/-SUMMARY\.md$/i));
  let summaryText = '';
  for (const sf of summaryFileNames) {
    summaryText += (safeReadFile(path.join(phaseDir, sf)) || '');
  }
  const docsRequired = touchedFiles.some(f => DOC_PATH_SIGNAL_RE.test(f)) || DOC_KEYWORD_SIGNAL_RE.test(summaryText);

  // E2E coverage gap detection (MILE-08, Phase 46-01): gap-aware, not just
  // existence-based -- computeE2ECoverageGaps is the same pure function
  // `verify e2e-gaps` uses, so the pre-check execute-phase.md runs BEFORE
  // Gate 1 and this actual gate always agree on what counts as a gap.
  const e2ePlanContent = safeReadFile(path.join(phaseDir, 'E2E-TEST-PLAN.md'));
  const e2eGapResult = computeE2ECoverageGaps(touchedFiles, e2ePlanContent);
  const e2eGenFailure = readE2EGenerationFailure(phaseDir);

  // Five expected-artifact checks.
  const tddPlanned = validPlans.some(p => /tdd=["']?true/.test(p.content));
  // No test command configured ("none" for test_file and test_all): there is nothing to run a test with, so the
  // requirement is not applicable rather than failed.
  const testNotApplicable = tddPlanned && !projectContext.testCommandConfigured(cwd);
  const testRequired = tddPlanned && !testNotApplicable;
  const spikeNa = (type) => ({ type, required: false, satisfied: true, waived: false, failure_type: null, not_applicable: true, detail: 'not applicable: spike rigour (references/rigour.md)' });
  const checks = [
    spike ? spikeNa('test') : testNotApplicable
      ? { type: 'test', required: false, satisfied: true, waived: false, failure_type: null, not_applicable: true, detail: 'not applicable: no test command configured (stack.commands.test_file and test_all are none)' }
      : evaluatePhaseGateCheck(
        'test', testRequired,
        () => touchedFiles.some(f => TEST_FILE_RE.test(f)),
        waivers, phaseInfo.phase_number
      ),
    // Evidence comes from the verifier's {N}-VERIFICATION.md frontmatter, not
    // the coordinator-written CHECKPOINT.json; only a YAML boolean true counts. Alias group: any true key wins.
    spike ? spikeNa('ui_qa') : evaluatePhaseGateCheck(
      'ui_qa', uiQaCheckRequired,
      () => evidence.verification.data.charlotte_qa_ran === true || evidence.verification.data.ui_qa_ran === true,
      waivers, phaseInfo.phase_number,
      'missing_charlotte_qa'
    ),
    spike ? spikeNa('docs') : evaluatePhaseGateCheck(
      'docs', docsRequired,
      () => touchedFiles.some(f => DOC_SATISFIED_RE.test(f)),
      waivers, phaseInfo.phase_number
    ),
    spike ? spikeNa('e2e_plan') : evaluatePhaseGateCheck(
      'e2e_plan', hasUi && uiQaMode !== 'none',
      () => !e2eGenFailure && e2ePlanContent !== null && e2eGapResult.gaps.length === 0,
      waivers, phaseInfo.phase_number,
      e2eGenFailure ? 'e2e_generation_failed' : undefined
    ),
    evaluatePhaseGateCheck(
      'verification', !preVerifier,
      () => evidence.verification.exists,
      waivers, phaseInfo.phase_number
    ),
  ];

  // Evidence is never waivable: DEFERRED.json cannot stand in for commits,
  // Self-Check PASSED summaries, or a passed verification.
  const failures = checks.filter(c => c.failure_type).map(c => c.failure_type);
  if (evidence.workErrors.length > 0) failures.push('missing_evidence');
  const passed = failures.length === 0 && form.errors.length === 0 && malformedPlans.length === 0 && !malformedWaiver;

  const result = {
    phase: phaseInfo.phase_number,
    passed,
    pre_verifier: preVerifier,
    checks,
    failures,
    malformed_plans: malformedPlans,
    touched_files_count: touchedFiles.length,
    has_ui: hasUi,
    has_api: hasApi,
    charlotte_qa_required: uiQaRequired,
    ui_qa_required: uiQaRequired,
    ui_qa_mode: uiQaMode,
    e2e_gaps: e2eGapResult.gaps,
    work_errors: evidence.workErrors,
    form_errors: form.errors,
  };
  if (malformedWaiver) result.malformed_waiver = malformedWaiver;
  if (touchedWarnings.length > 0) result.touched_file_warnings = touchedWarnings;

  process.stdout.write(JSON.stringify(result, null, 2));

  if (malformedWaiver) {
    process.exit(2);
  } else if (malformedPlans.length > 0) {
    process.exit(2);
  } else if (!passed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// ─── E2E Coverage Pre-Check (MILE-08, Phase 46-01) ───────────────────────────
// `verify e2e-gaps {phase}` is the deterministic pre-check execute-phase.md's
// e2e_coverage_closure step calls BEFORE Gate 1 (verify phase-gate) evaluates
// the e2e_plan artifact -- this is what makes the generator auto-run instead
// of phase-gate merely demanding an artifact nothing produces (Loophole 5).
// Shares loadPhaseGateInputs + computeE2ECoverageGaps with cmdVerifyPhaseGate
// so the pre-check and the actual gate can never disagree about gaps.
function cmdVerifyE2EGaps(cwd, phaseArg, raw) {
  const inputs = loadPhaseGateInputs(cwd, phaseArg);
  if (inputs.error) {
    process.stdout.write(JSON.stringify(inputs.error, null, 2));
    process.exit(2);
    return;
  }
  const { phaseInfo, phaseDir, touchedFiles, hasUi, malformedPlans } = inputs;

  if (malformedPlans.length > 0) {
    process.stdout.write(JSON.stringify({ error: true, type: 'malformed_plan', phase: phaseInfo.phase_number, malformed_plans: malformedPlans }, null, 2));
    process.exit(2);
    return;
  }

  const e2ePlanPath = path.join(phaseDir, 'E2E-TEST-PLAN.md');
  const e2ePlanContent = safeReadFile(e2ePlanPath);
  const e2ePlanExists = e2ePlanContent !== null;
  const e2eGapResult = computeE2ECoverageGaps(touchedFiles, e2ePlanContent);
  const e2eGenFailure = readE2EGenerationFailure(phaseDir);
  const generationFailed = !!e2eGenFailure;

  const result = {
    phase: phaseInfo.phase_number,
    has_ui: hasUi,
    e2e_plan_exists: e2ePlanExists,
    gaps: e2eGapResult.gaps,
    gap_count: e2eGapResult.gaps.length,
    generation_failed: generationFailed,
  };

  process.stdout.write(JSON.stringify(result, null, 2));

  // Idempotent-skip condition: nothing to do when there's no UI, or the plan
  // already covers everything and there's no stale generation-failure marker.
  if (!hasUi || (e2eGapResult.gaps.length === 0 && !generationFailed)) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// ─── Test-bloat helpers: Test Delta parsing, per-test hollow scan, impl coverage ─
// Parses a SUMMARY's `## Test Delta` section: declared added/updated/merged/
// deleted counts (`added: 3` or `3 added`) plus per-file disposition rows
// (a line carrying REUSE|UPDATE|MERGE|DELETE|ADD and file paths / cites).
function parseTestDelta(text) {
  const out = { found: false, added: 0, updated: 0, merged: 0, deleted: 0, net_test_loc: null, bucket_seconds: [], rows: [] };
  if (!text) return out;
  const sec = text.match(/^##\s+Test Delta\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/mi);
  if (!sec) return out;
  out.found = true;
  const KEYS = ['added', 'updated', 'merged', 'deleted'];
  const countText = [];
  for (const line of sec[1].split('\n')) {
    const bm = line.match(/^\s*[-*]?\s*bucket_seconds\s*:\s*(\S+)\s+(\d+(?:\.\d+)?)\s*(?:->|\u2192)\s*(\d+(?:\.\d+)?)/i);
    if (bm) { out.bucket_seconds.push({ bucket: bm[1], before: parseFloat(bm[2]), after: parseFloat(bm[3]) }); continue; }
    const nm = line.match(/^\s*[-*]?\s*net_test_loc\s*[:=]\s*(-?\d+)/i);
    if (nm) { out.net_test_loc = parseInt(nm[1], 10); continue; }
    if (/^\s*\|/.test(line)) continue;
    const sl = line.match(/\b(added|updated|merged|deleted)\s*\/\s*(updated|merged|deleted)(?:\s*\/\s*(merged|deleted))?(?:\s*\/\s*(deleted))?\s*[:=]\s*(\d+(?:\s*\/\s*\d+)+)/i);
    if (sl) {
      const names = [sl[1], sl[2], sl[3], sl[4]].filter(Boolean).map(n => n.toLowerCase());
      const nums = sl[5].split('/').map(n => parseInt(n.trim(), 10));
      if (names.length === nums.length) { names.forEach((n, i) => { out[n] += nums[i]; }); continue; }
    }
    countText.push(line);
  }
  for (const key of KEYS) {
    const re = new RegExp(`\\b${key}\\b\\s*[:=|]\\s*(\\d+)|\\b(\\d+)[ \\t]+${key}\\b`, 'gi');
    let m;
    while ((m = re.exec(countText.join('\n'))) !== null) out[key] += parseInt(m[1] || m[2], 10);
  }
  for (const line of sec[1].split('\n')) {
    const kind = line.match(/\b(REUSE|UPDATE|MERGE|DELETE|ADD)\b/);
    if (!kind) continue;
    const tokens = (line.match(/[\w@.\/-]+\.[A-Za-z]{1,4}(?::\d+)?/g) || []).map(t => t.replace(/:\d+$/, ''));
    if (tokens.length === 0) continue;
    out.rows.push({ kind: kind[1], line, paths: tokens });
  }
  out.outside_text = text.replace(sec[0], '');
  return out;
}

const COVER_TEST_RE = /\.(?:test|spec)\.[A-Za-z]+$|_test\.(?:ts|js)$/;
// A cite path is valid only if it is an existing test file (*.test.*, incl.
// *.integration.test.*) other than the file being deleted/merged/reused.
function isValidCoverCite(cwd, p, file) {
  if (p === file || path.basename(p) === path.basename(file)) return false;
  if (!COVER_TEST_RE.test(p)) return false;
  return fs.existsSync(path.join(cwd, p)) || fs.existsSync(path.join(cwd, path.dirname(file), p));
}
// Ids: mLD1, mS3, mC-SW3, M-PAR, M-CANCEL-1 (house table: a project's own SUMMARY.md).
const MUTANT_TOKEN_RE = /\bm[A-Z]+\d+\b|\bm[A-Z]+(?:-[A-Z0-9]+)+\b|\bM-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;
const RED_SHA_RE = /\bRED\s+([0-9a-f]{7,40})\b/g;
// Killed = killed/RED vocabulary OR the house "Failing assertion" cell naming a test file:line.
const MUTANT_KILLED_RE = /\bkilled\b|\bRED\b|\bred\s*(?:->|\u2192)\s*green\b|(?:\.(?:test|spec)\.[A-Za-z]+|_test\.[A-Za-z]+):\d+/i;
const reEscape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MERGE_ASSERTION_FLOOR = 0.5;
const TEST_DIR_SEGMENTS = new Set(['__tests__', '__test__', 'tests', 'test']);
// Package/domain root of a test file: everything above its test dir (null when it has none).
function testPackageRoot(file) {
  const segs = file.split('/');
  const i = segs.findIndex(sg => TEST_DIR_SEGMENTS.has(sg));
  return i > 0 ? segs.slice(0, i).join('/') : null;
}
// DELETE/MERGE cite: an existing, different *.test.* file in the deleted file's
// own directory or its package/domain root (a far-away test proves nothing).
function isValidDispositionCite(cwd, p, file) {
  if (!isValidCoverCite(cwd, p, file)) return false;
  const resolved = fs.existsSync(path.join(cwd, p)) ? p : path.posix.join(path.posix.dirname(file), p);
  const dir = path.posix.dirname(resolved);
  const root = testPackageRoot(file);
  return dir === path.posix.dirname(file) || (root !== null && (dir === root || dir.startsWith(`${root}/`)));
}
function rowNamesFile(l, file) {
  const base = path.posix.basename(file);
  return [file, base, base.split('.')[0]].some(n => new RegExp(`(?<![\\w-])${reEscape(n)}(?![\\w-])`).test(l));
}
// A RED sha counts only if it is one of the plan's own tagged commits AND that commit's diff touches `file`.
function isPlanRedCommitTouching(cwd, ctx, sha, file) {
  if (!ctx) return false;
  const log = execGit(cwd, ['log', '--format=%H', '--all', '-E', '--grep', planTagGrepPattern(ctx.phaseNumber, ctx.planNum)]);
  const full = (log.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).find(h => h.startsWith(sha.toLowerCase()));
  if (!full) return false;
  return (execGit(cwd, ['show', '--name-only', '--format=', full]).stdout || '').split('\n').map(s => s.trim()).includes(file);
}
// A mutant id counts only from a killed-result row of the SAME SUMMARY's mutation
// table (outside Test Delta) that names `file` (path, basename or stem); a RED sha only per isPlanRedCommitTouching.
function hasVerifiedMutantCite(cwd, delta, line, file, ctx) {
  const tableLines = (delta.outside_text || '').split('\n').filter(l => /^\s*\|/.test(l) && MUTANT_KILLED_RE.test(l) && rowNamesFile(l, file));
  const ids = line.match(MUTANT_TOKEN_RE) || [];
  if (ids.some(id => tableLines.some(l => new RegExp(`(?<![\\w-])${reEscape(id)}(?![\\w-])`).test(l)))) return true;
  for (const m of line.matchAll(RED_SHA_RE)) if (isPlanRedCommitTouching(cwd, ctx, m[1], file)) return true;
  return false;
}
const ASSERTION_MAP_RE = /\b\d+\b[^|\n]*?(?:->|\u2192|=>)\s*\d+/;
function rowNamesFoldedTests(row) {
  const rest = row.paths.reduce((t, p) => t.split(p).join(' '), row.line).replace(RED_SHA_RE, ' ').replace(MUTANT_TOKEN_RE, ' ').replace(/\b(?:MERGE|DELETE)\b/g, ' ');
  return /[A-Za-z]{3,}/.test(rest);
}
// Verdict for one MERGE/DELETE row on `file`. Sensitive paths need a MERGE row with a
// verified cite; a DELETE row alone is never enough. counts = {before, after}: under a
// MERGE a >50% assertion drop needs an "N -> M" mapping or a verified cite plus prose naming the folded cases.
function dispositionRowVerdict(cwd, delta, row, file, counts, ctx) {
  const sensitive = SENSITIVE_PATH_RE.test(file);
  if (sensitive && row.kind !== 'MERGE') return { ok: false, reason: 'sensitive_path_requires_merge_row' };
  const verified = row.kind === 'MERGE' && hasVerifiedMutantCite(cwd, delta, row.line, file, ctx);
  if (row.kind === 'MERGE' && counts && counts.before > 0 && counts.after < counts.before * MERGE_ASSERTION_FLOOR) {
    const mapped = ASSERTION_MAP_RE.test(row.paths.reduce((t, p) => t.split(p).join(' '), row.line));
    if (!mapped && !(verified && rowNamesFoldedTests(row))) return { ok: false, reason: 'assertion_drop_over_50pct_without_mapping' };
  }
  if (sensitive) return verified ? { ok: true } : { ok: false, reason: 'sensitive_merge_without_verified_cite_for_this_file' };
  if (row.paths.some(p => p !== file && isValidDispositionCite(cwd, p, file))) return { ok: true };
  return verified ? { ok: true } : { ok: false, reason: 'no_valid_cite' };
}
// A MERGE/DELETE row (matched by full relative path) for `file` with a verified cite.
function findCitedDispositionRow(cwd, delta, file, kinds, counts, ctx) {
  for (const row of (delta && delta.rows) || []) {
    if (!kinds.includes(row.kind) || !row.paths.includes(file)) continue;
    if (dispositionRowVerdict(cwd, delta, row, file, counts, ctx).ok) return row;
  }
  return null;
}

// Blanks string-aware // and /* */ comments.
function stripJsComments(src) {
  return (src || '').replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str || ' ');
}

// Extracts the balanced `(...)` call text starting at the `(` at/after idx.
function extractBalancedCall(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  return src.slice(openIdx);
}
function splitTopLevelArgs(callText) {
  const inner = callText.slice(1, -1);
  const args = [];
  let depth = 0; let cur = '';
  for (const c of inner) {
    if ('([{'.includes(c)) depth += 1;
    if (')]}'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim().length > 0) args.push(cur);
  return args;
}

function splitTestCases(content) {
  const re = /^[ \t]*((?:Deno\.)?(?:test|it)\s*\()/gm;
  const starts = [];
  let m;
  while ((m = re.exec(content || '')) !== null) {
    starts.push(m.index + m[0].length - m[1].length);
  }
  return starts.map((s, i) => {
    const body = content.slice(s, i + 1 < starts.length ? starts[i + 1] : content.length);
    const nameM = body.match(/^[^(]*\(\s*(['"`])(.*?)\1/) || body.slice(0, 300).match(/name\s*:\s*(['"`])(.*?)\1/);
    return { name: nameM ? nameM[2] : `<anonymous@${s}>`, body };
  });
}

const WEAK_ASSERT_RES = [
  /^assertExists\s*\(/,
  /^assert\s*\(\s*true\s*\)/,
  /\.(?:toBeDefined|toBeTruthy)\s*\(|\.not\.toBeUndefined\s*\(|\.not\.toBeNull\s*\(/,
  /\bArray\.isArray\b|\bisArray\b/,
  /\.error\s*(?:===?|,)\s*null\b|\.error\)\.toBeNull/,
  /!==?\s*undefined/,
];
// Status-code-only assertion: weak ONLY when no other assertion exists on the
// response body/headers (any non-status assertion in the test makes the whole
// test non-weak via the every() below).
const STATUS_ASSERT_RE = /\b(?:status|statusCode)\b[^\n]*\b[1-5]\d\d\b/;
const LITERAL_RE = /^(?:-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|true|false|null|undefined)$/;
function isLiteralSelfComparison(stmt) {
  if (/^assert/.test(stmt.name)) {
    const args = splitTopLevelArgs(stmt.call).map(x => x.trim());
    return args.length >= 2 && LITERAL_RE.test(args[0]) && args[0] === args[1];
  }
  const m = stmt.text.match(/^expect\s*\(\s*([^()]+?)\s*\)\s*\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*([^()]+?)\s*\)/);
  return !!m && LITERAL_RE.test(m[1]) && m[1] === m[2];
}

// Report-only reasons: listed with severity 'info', never a gap/PARTIAL.
const HOLLOW_INFO_REASONS = new Set(['status_only_assertions', 'concurrency_title_without_concurrency']);
// Per-test hollow-pattern scan: returns the reasons a single test body is
// hollow (empty list = fine). Regex-based like countAssertions (accepted bar).
function scanHollowReasons(testCase) {
  const body = testCase.body;
  const reasons = [];
  const stmts = [];
  const re = /\b(?:(?:expect|verify|check|should)[A-Z_]\w*|(?:expect|assert\w*)(?:\.\w+)?)\s*\(/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const call = extractBalancedCall(body, openIdx);
    const tail = body.slice(openIdx + call.length).split('\n')[0];
    stmts.push({ head: m[0], text: m[0] + call.slice(1) + tail, call, name: m[0].replace(/\s*\($/, '') });
  }
  if (stmts.length === 0) {
    reasons.push('no_assertion');
  } else if (stmts.every(s => WEAK_ASSERT_RES.some(r => r.test(s.text)) || isLiteralSelfComparison(s))) {
    reasons.push('weak_assertions_only');
  } else if (stmts.every(s => WEAK_ASSERT_RES.some(r => r.test(s.text)) || STATUS_ASSERT_RE.test(s.text) || isLiteralSelfComparison(s))) {
    reasons.push('status_only_assertions');
  }
  const refusal = stmts.filter(s => /^assert(?:Rejects|Throws)$/.test(s.name));
  if (refusal.some(s => splitTopLevelArgs(s.call).length === 1) || /\.toThrow\s*\(\s*\)/.test(body)) {
    reasons.push('refusal_passes_on_any_error');
  }
  if (/\bP0001\b/.test(body) && !/message|\.hint|\.detail|toMatch|assertMatch|assertStringIncludes|toContain|\.includes\(/.test(body)) {
    reasons.push('bare_sqlstate_refusal');
  }
  if (/\b(race|concurren\w*|parallel|simultaneous)\b/i.test(testCase.name) && !/Promise\.(?:all|allSettled|race)\b/.test(body)) {
    reasons.push('concurrency_title_without_concurrency');
  }
  return reasons;
}

// Hollow cases among tests that are NEW or CHANGED relative to beforeContent
// (null = new file, every test is new). Pre-existing untouched tests are not
// this plan's findings.
function scanNewHollowCases(afterContent, beforeContent) {
  const before = new Map(splitTestCases(beforeContent || '').map(t => [t.name, t.body.trim()]));
  const out = [];
  for (const tc of splitTestCases(afterContent)) {
    if (before.has(tc.name) && before.get(tc.name) === tc.body.trim()) continue;
    const reasons = scanHollowReasons(tc);
    if (reasons.length > 0) out.push({ test: tc.name, reasons, severity: reasons.every(r => HOLLOW_INFO_REASONS.has(r)) ? 'info' : 'gap' });
  }
  return out;
}

const IMPL_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Implementation files from the phase diff with no covering test. Covered when
// ANY test in the repo (unit OR integration) imports the module, or references
// one of its exported symbols / its basename as a quoted RPC/route name, or a
// touched test shares its stem, or a SUMMARY REUSE row cites an existing test.
// Only pure `export ... from` barrels outside risk-domain paths are exempt.
// Comments are stripped before matching; generic stems (index/mod/main) only
// match a same-directory test or a parent-qualified import.
const SENSITIVE_LONG_RE = new RegExp(['auth', 'ledger', 'settle', 'balance', 'payout', 'session', 'totp', 'credit', 'debit', 'cashout', 'refund', 'login', 'jwt', 'password', 'token', ...LEGACY_RISK.sensitive_path].join('|'), 'i');
// bet/stake match only as a path word or camelCase word ('better', 'orange' do not).
const SENSITIVE_SHORT_RE = /(?:^|[^A-Za-z])(?:[Bb]et(?:ting)?|BET|[Ss]take|STAKE)s?(?![a-z])|[a-z](?:Bet(?:ting)?|Stake)s?(?![a-z])/;
const SENSITIVE_PATH_RE = { test: f => SENSITIVE_LONG_RE.test(f) || SENSITIVE_SHORT_RE.test(f) };
const GENERIC_STEMS = new Set(['index', 'mod', 'main']);
function isPureReexportBarrel(f, src) {
  if (SENSITIVE_PATH_RE.test(f)) return false;
  const rest = stripJsComments(src).replace(/\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"][^'"]+['"]\s*;?/g, '');
  return rest.trim().length === 0;
}
const IMPORT_SPEC_RE = /(?:\bfrom|\brequire\s*\(|\bimport\s*\(?)\s*['"]([^'"\n]+)['"]/g;
const stripSpecExt = s => s.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, '');
// True iff some import specifier in testText resolves to exactly implFile (relative specifiers by
// directory arithmetic; aliased ones by a >=2-segment path suffix). Same-stem files elsewhere never match.
function importsExactFile(testFile, testText, implFile) {
  const target = stripSpecExt(implFile);
  const targets = /(^|\/)(index|mod|main)$/.test(target) ? [target, path.posix.dirname(target)] : [target];
  for (const m of testText.matchAll(IMPORT_SPEC_RE)) {
    const spec = stripSpecExt(m[1]);
    if (spec.startsWith('.')) {
      if (targets.includes(path.posix.normalize(path.posix.join(path.posix.dirname(testFile), spec)))) return true;
      continue;
    }
    const segs = spec.split('/');
    for (let k = 0; k < segs.length - 1; k++) {
      const tail = segs.slice(k).join('/');
      if (targets.some(t => t === tail || t.endsWith(`/${tail}`))) return true;
    }
  }
  return false;
}
// E2E scenario files are not implementation: stack.paths.e2e_scenarios, plus the legacy location in a project without a stack profile.
function e2eScenarioExcludeRes(cwd) {
  let loaded;
  try { loaded = projectProfile.loadProfile(cwd); } catch { loaded = { error: 'unreadable' }; }
  const dir = loaded.error ? undefined : projectProfile.getProfileValue(loaded, 'stack.paths.e2e_scenarios');
  const res = [];
  if (typeof dir === 'string' && dir.trim()) res.push(new RegExp('^' + reEscape(dir.replace(/^\.?\//, '').replace(/\/+$/, '')) + '/'));
  if (projectContext.uiQaMode(cwd) === 'legacy') res.push(/^apps\/e2e-charlotte\/scenarios\//);
  return res;
}
function computeImplTestCoverage(cwd, touchedFiles, testDeltaRows, outsideText) {
  const e2eRes = e2eScenarioExcludeRes(cwd);
  const isTest = f => TEST_FILE_RE.test(f) || /(^|\/)__tests__\//.test(f) || /_test\.(ts|js)$/.test(f);
  const impls = touchedFiles.filter(f => IMPL_FILE_RE.test(f) && !isTest(f) && !/\.d\.ts$/.test(f) &&
    !/(^|\/)(\.planning|node_modules|dist|build|testing-utils)\//.test(f) && !e2eRes.some(re => re.test(f)) &&
    !/\.types\.ts$/.test(f) && !/\.config\.\w+$/.test(f) && fs.existsSync(path.join(cwd, f)));
  if (impls.length === 0) return { impl_files_without_tests: [], impl_files_covered: [], impl_files_exempt: [] };
  const ls = execGit(cwd, ['ls-files']);
  const testFiles = (ls.stdout || '').split('\n').map(l => l.trim()).filter(f => f && isTest(f));
  const corpus = testFiles.map(f => ({ file: f, text: stripJsComments(safeReadFile(path.join(cwd, f)) || '') }));
  const without = []; const covered = []; const exempt = [];
  for (const f of impls) {
    const src = stripJsComments(safeReadFile(path.join(cwd, f)) || '');
    const stem = path.basename(f).replace(/\.[^.]+$/, '');
    if (isPureReexportBarrel(f, src)) { exempt.push(f); continue; }
    const generic = GENERIC_STEMS.has(stem);
    const sensitive = SENSITIVE_PATH_RE.test(f);
    const esc = reEscape(stem);
    const quotedRe = generic ? /(?!)/ : new RegExp(`['"\`]${esc}['"\`]`);
    const symbols = [];
    const symRe = /export\s+(?:async\s+)?(?:function\*?|const|class|let)\s+([A-Za-z_$][\w$]*)/g;
    let sm;
    while ((sm = symRe.exec(src)) !== null) if (sm[1].length >= 5) symbols.push(sm[1]);
    // Sensitive files: ONLY an exact-path import or a verified REUSE row; stem/quoted-word/symbol matches never count.
    const by = corpus.find(t => importsExactFile(t.file, t.text, f)) || (sensitive ? null
      : corpus.find(t => (!generic || path.dirname(t.file) === path.dirname(f)) && (path.basename(t.file).startsWith(`${stem}.`) || path.basename(t.file).startsWith(`${stem}_`)))
        || corpus.find(t => quotedRe.test(t.text))
        || corpus.find(t => symbols.some(s => new RegExp(`\\b${s.replace(/\$/g, '\\$')}\\b`).test(t.text))));
    let via = by ? by.file : null;
    if (!via) {
      const reuse = (testDeltaRows || []).find(r => r.kind === 'REUSE' && (r.line.includes(f) || r.line.includes(path.basename(f))) &&
        r.paths.some(pp => isValidCoverCite(cwd, pp, f) && (!sensitive || hasVerifiedMutantCite(cwd, { outside_text: outsideText }, r.line, pp, null))));
      if (reuse) via = 'SUMMARY Test Delta REUSE';
    }
    if (via) covered.push({ file: f, covered_by: via }); else without.push(f);
  }
  return { impl_files_without_tests: without, impl_files_covered: covered, impl_files_exempt: exempt };
}

// ─── Test-Content Coverage & Hollow-Test Detection (MILE-10, Phase 46-03) ────
// Closes Loophole 7 / Issue 8: the verifier's existing Step 8d test-file
// coverage check only proves a `.test.ts` file EXISTS -- it never checks
// whether the file actually tests anything. computeTestContentCoverage is a
// pure classifier (COVERED/PARTIAL/MISSING/not_applicable per requirement)
// built on top of collectPhaseTouchedFiles's per-plan filesByPlan breakdown,
// countTestCalls/countAssertions regex counting (accepted MVP bar -- no
// mutation testing, no coverage percentages, no AST analysis), and a
// net-zero-new-assertions check against the plan's first tagged commit.
//
// Scope boundary (per PRD Assumption #15 / this plan's <context>): only
// requirements whose declaring plan(s) contain at least one tdd="true" task
// are classified -- a requirement declared solely by a prose/workflow-editing
// plan (no tdd task) is `not_applicable` and excluded from `passed`.
function computeTestContentCoverage(cwd, phaseNumber, validPlans, filesByPlan, phaseDir) {
  // Per-plan SUMMARY Test Delta (declared counts + MERGE/DELETE/REUSE rows).
  const deltaByPlan = {};
  const declared = { added: 0, updated: 0, merged: 0, deleted: 0 };
  const allRows = [];
  const bucketSeconds = [];
  for (const plan of validPlans || []) {
    const planNum = plan.planNum || (plan.fm && plan.fm.plan);
    if (!planNum || !phaseDir || !plan.file) continue;
    const delta = parseTestDelta(safeReadFile(path.join(phaseDir, plan.file.replace(/-PLAN\.md$/i, '-SUMMARY.md'))));
    deltaByPlan[planNum] = delta;
    for (const k of Object.keys(declared)) declared[k] += delta[k];
    allRows.push(...delta.rows);
    bucketSeconds.push(...delta.bucket_seconds);
  }
  const mergedFiles = [];
  const deletedFiles = [];
  const hollowCaseList = [];
  const legacyHollowList = [];
  const isChecked = pn => !!(deltaByPlan[pn] && deltaByPlan[pn].found);
  // reqId -> [{ planNum, hasTdd }] -- every declaring plan, tdd or not.
  const reqToPlans = {};
  for (const plan of validPlans || []) {
    const planNum = plan.planNum || (plan.fm && plan.fm.plan);
    if (!planNum) continue;
    const hasTdd = /tdd=["']?true/.test(plan.content || '');
    const reqIds = Array.isArray(plan.fm && plan.fm.requirements) ? plan.fm.requirements : [];
    for (const reqId of reqIds) {
      if (!reqToPlans[reqId]) reqToPlans[reqId] = [];
      reqToPlans[reqId].push({ planNum, hasTdd });
    }
  }

  const requirements = [];
  const hollowFilesMap = new Map();
  const netZeroFilesMap = new Map();
  const legacyNetZeroMap = new Map();

  for (const reqId of Object.keys(reqToPlans)) {
    const declaringPlans = reqToPlans[reqId];
    const tddPlans = declaringPlans.filter(p => p.hasTdd);

    if (tddPlans.length === 0) {
      requirements.push({
        req_id: reqId,
        status: 'not_applicable',
        source_plans: declaringPlans.map(p => p.planNum),
        matched_files: [],
      });
      continue;
    }

    const matchedFiles = [];
    let hollowCount = 0;
    let netZeroCount = 0;
    let hollowCaseCount = 0;

    for (const tddPlan of tddPlans) {
      const planTestFiles = (filesByPlan[tddPlan.planNum] || []).filter(f => TEST_FILE_RE.test(f));
      for (const file of planTestFiles) {
        if (!matchedFiles.includes(file)) matchedFiles.push(file);

        const content = safeReadFile(path.join(cwd, file));
        if (content === null) {
          // Deleted/unreadable at HEAD -- never crash. A deletion the plan's
          // SUMMARY lists as DELETE/MERGE with a covering cite that exists on
          // disk is a legitimate consolidation, not hollow; otherwise it
          // contributes nothing, equivalent to hollow.
          const delRow = findCitedDispositionRow(cwd, deltaByPlan[tddPlan.planNum], file, ['DELETE', 'MERGE'], null, { phaseNumber, planNum: tddPlan.planNum });
          if (delRow) {
            if (!deletedFiles.some(d => d.file === file)) deletedFiles.push({ file, source_plan: tddPlan.planNum, cite: delRow.line.trim() });
            continue;
          }
          hollowCount += 1;
          if (!hollowFilesMap.has(file)) hollowFilesMap.set(file, { file, source_plan: tddPlan.planNum });
          continue;
        }

        const nonSkippedCount = countTestCalls(content);
        const assertionCount = countAssertions(content);
        // "Hollow" for gate purposes combines both bars from this plan's
        // <context>: zero non-skipped test()/it() calls, OR real test calls
        // with zero real assertions (no assertion = same bar as hollow).
        const hollow = nonSkippedCount === 0 || assertionCount === 0;

        if (hollow) {
          hollowCount += 1;
          if (!hollowFilesMap.has(file)) hollowFilesMap.set(file, { file, source_plan: tddPlan.planNum });
          continue;
        }

        // Per-test hollow scan (new/changed tests only): a file with real
        // assertions can still carry individual hollow tests.
        const grepTagH = `${phaseNumber}-${tddPlan.planNum}`;
        const logH = execGit(cwd, ['log', '--oneline', '--all', '--grep', grepTagH, '--reverse']);
        const firstH = ((logH.stdout || '').split('\n').map(l => l.trim()).filter(l => l.length > 0)[0] || '').split(/\s+/)[0];
        const beforeH = firstH ? execGit(cwd, ['show', `${firstH}^:${file}`]) : null;
        const beforeText = beforeH && beforeH.exitCode === 0 ? beforeH.stdout : null;
        const planChecked = !!(deltaByPlan[tddPlan.planNum] && deltaByPlan[tddPlan.planNum].found);
        for (const hc of scanNewHollowCases(content, beforeText)) {
          const entry = { file, source_plan: tddPlan.planNum, test: hc.test, reasons: hc.reasons, severity: hc.severity };
          if (!planChecked) { legacyHollowList.push(entry); continue; }
          if (hc.severity === 'gap') hollowCaseCount += 1;
          hollowCaseList.push(entry);
        }

        // Net-zero-new-assertions check: only meaningful for a non-hollow
        // file that already has real assertions -- compare against the
        // content as of the plan's earliest tagged commit.
        const grepTag = `${phaseNumber}-${tddPlan.planNum}`;
        const logResult = execGit(cwd, ['log', '--oneline', '--all', '--grep', grepTag, '--reverse']);
        const commitLines = (logResult.stdout || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);

        let netZero = false;
        let beforeCount = null;
        if (commitLines.length > 0) {
          const firstHash = commitLines[0].split(/\s+/)[0];
          const beforeResult = execGit(cwd, ['show', `${firstHash}^:${file}`]);
          if (beforeResult.exitCode === 0 && beforeResult.stdout) {
            // File existed before this plan's first commit -- a real
            // regression candidate. Missing/errored (new file in this phase,
            // or root commit with no parent) => not a regression candidate.
            beforeCount = countAssertions(beforeResult.stdout);
            // Consolidation is not regression: only a FALL in assertion
            // count with no cited MERGE/DELETE row is flagged. Equal count
            // (table-driven rewrite, touched file) is fine.
            const mergeRow = findCitedDispositionRow(cwd, deltaByPlan[tddPlan.planNum], file, ['MERGE', 'DELETE'], { before: beforeCount, after: assertionCount }, { phaseNumber, planNum: tddPlan.planNum });
            netZero = assertionCount < beforeCount && !mergeRow;
            if (mergeRow && assertionCount < beforeCount && !mergedFiles.some(d => d.file === file)) {
              mergedFiles.push({ file, source_plan: tddPlan.planNum, before_count: beforeCount, after_count: assertionCount, cite: mergeRow.line.trim() });
            }
          }
        }

        if (netZero) {
          const entry = { file, source_plan: tddPlan.planNum, before_count: beforeCount, after_count: assertionCount };
          if (!planChecked) {
            // Legacy plan (no Test Delta): no cite can exist, so informational only.
            if (!legacyNetZeroMap.has(file)) legacyNetZeroMap.set(file, entry);
          } else {
            netZeroCount += 1;
            if (!netZeroFilesMap.has(file)) netZeroFilesMap.set(file, entry);
          }
        }
      }
    }

    let status;
    if (matchedFiles.length === 0) {
      status = 'MISSING';
    } else if (hollowCount === matchedFiles.length) {
      // Every matched test file is hollow -- no real, non-hollow assertion
      // exists anywhere for this requirement.
      status = 'MISSING';
    } else if (hollowCount > 0 || netZeroCount > 0 || hollowCaseCount > 0) {
      status = 'PARTIAL';
    } else {
      status = 'COVERED';
    }

    requirements.push({
      req_id: reqId,
      status,
      source_plans: tddPlans.map(p => p.planNum),
      matched_files: matchedFiles,
    });
  }

  // Declared merged/deleted counts are FILE counts: one MERGE/DELETE row per file (its first path).
  const rowCount = k => new Set(allRows.filter(r => r.kind === k).map(r => r.paths[0])).size;
  const uncitedRows = [];
  for (const planNum of Object.keys(deltaByPlan)) {
    if (!isChecked(planNum)) continue;
    for (const row of deltaByPlan[planNum].rows) {
      if (row.kind !== 'MERGE' && row.kind !== 'DELETE') continue;
      const v = dispositionRowVerdict(cwd, deltaByPlan[planNum], row, row.paths[0], null, { phaseNumber, planNum });
      if (!v.ok) uncitedRows.push({ file: row.paths[0], kind: row.kind, source_plan: planNum, reason: v.reason });
    }
  }
  const declaredRowsMismatch = declared.merged !== rowCount('MERGE') || declared.deleted !== rowCount('DELETE');
  if (declaredRowsMismatch) for (const r of requirements) if (r.status === 'COVERED') r.status = 'PARTIAL';
  const t0MutantRowsMissing = [];
  const legacyT0Missing = [];
  for (const plan of validPlans || []) {
    const planNum = plan.planNum || (plan.fm && plan.fm.plan);
    const t0List = isChecked(planNum) ? t0MutantRowsMissing : legacyT0Missing;
    const outside = ((deltaByPlan[planNum] || {}).outside_text || '').split('\n').filter(l => /^\s*\|/.test(l) && (MUTANT_KILLED_RE.test(l) || /mutant|mutation/i.test(l) || (l.match(MUTANT_TOKEN_RE) || []).length > 0));
    for (const f of (filesByPlan[planNum] || []).filter(x => TEST_FILE_RE.test(x) && SENSITIVE_PATH_RE.test(x))) {
      const names = [f, path.basename(f), path.basename(f).split('.')[0]];
      if (!outside.some(l => names.some(n => l.includes(n))) && !t0List.includes(f)) t0List.push(f);
    }
  }

  const hollow_tests = [...hollowFilesMap.values()];
  const net_zero_assertion_files = [...netZeroFilesMap.values()];
  const passed = requirements.filter(r => r.status !== 'not_applicable').every(r => r.status === 'COVERED');

  const planNumOf = p => p.planNum || (p.fm && p.fm.plan);
  const checkedPlans = (validPlans || []).filter(p => isChecked(planNumOf(p)));
  const legacyPlans = (validPlans || []).filter(p => !isChecked(planNumOf(p)));
  const metrics = computeTestDeltaMetrics(cwd, phaseNumber, checkedPlans, declared, deletedFiles, mergedFiles, bucketSeconds, { declared_rows_mismatch: declaredRowsMismatch, t0_mutant_rows_missing: t0MutantRowsMissing, uncited_rows: uncitedRows });
  const touchedOf = plans => [...new Set(plans.flatMap(p => filesByPlan[planNumOf(p)] || []))];
  const outsideOf = plans => plans.map(p => (deltaByPlan[planNumOf(p)] || {}).outside_text || '').join('\n');
  const impl = computeImplTestCoverage(cwd, touchedOf(checkedPlans), allRows, outsideOf(checkedPlans));
  const legacy = { legacy_unchecked: legacyPlans.length > 0 };
  if (legacyPlans.length > 0) {
    const legacyMetrics = computeTestDeltaMetrics(cwd, phaseNumber, legacyPlans, declared, [], [], [], {});
    const legacyImpl = computeImplTestCoverage(cwd, touchedOf(legacyPlans), [], outsideOf(legacyPlans));
    legacy.legacy_data = {
      plans: legacyPlans.map(planNumOf),
      hollow_test_cases: legacyHollowList,
      net_zero_assertion_files: [...legacyNetZeroMap.values()],
      t0_mutant_rows_missing: legacyT0Missing,
      net_test_loc: legacyMetrics.net_test_loc,
      net_test_loc_over_threshold: legacyMetrics.net_test_loc_over_threshold,
      impl_files_without_tests: legacyImpl.impl_files_without_tests,
    };
  }

  return { requirements, hollow_tests, net_zero_assertion_files, hollow_test_cases: hollowCaseList, test_delta: metrics, ...impl, ...legacy, passed };
}

// Net test LOC (git numstat over each plan's tagged commits, test files only)
// plus the SUMMARY-declared added/updated/merged/deleted counts. Reported, not
// gated here: a positive delta over TEST_LOC_JUSTIFY_THRESHOLD needs a cited
// T0 justification per file (verifier Step 8j).
const TEST_LOC_JUSTIFY_THRESHOLD = 3000;
const BUCKET_REGRESSION_FACTOR = 1.1;
function computeTestDeltaMetrics(cwd, phaseNumber, validPlans, declared, deletedFiles, mergedFiles, bucketSeconds, extra) {
  let added = 0; let deleted = 0;
  const seen = new Set();
  for (const plan of validPlans || []) {
    const planNum = plan.planNum || (plan.fm && plan.fm.plan);
    if (!planNum) continue;
    const log = execGit(cwd, ['log', '--format=%h', '--all', '-E', '--grep', planTagGrepPattern(phaseNumber, planNum)]);
    for (const hash of (log.stdout || '').split('\n').map(l => l.trim()).filter(Boolean)) {
      if (seen.has(hash)) continue;
      seen.add(hash);
      const ns = execGit(cwd, ['show', '--numstat', '--format=', hash]);
      for (const line of (ns.stdout || '').split('\n')) {
        const [a, d, f] = line.split('\t');
        if (!f || !(TEST_FILE_RE.test(f) || /(^|\/)__tests__\//.test(f) || /_test\.(ts|js)$/.test(f))) continue;
        if (/^\d+$/.test(a)) added += parseInt(a, 10);
        if (/^\d+$/.test(d)) deleted += parseInt(d, 10);
      }
    }
  }
  const net = added - deleted;
  return {
    net_test_loc: net,
    test_loc_added: added,
    test_loc_deleted: deleted,
    net_test_loc_over_threshold: net > TEST_LOC_JUSTIFY_THRESHOLD,
    declared_tests: declared,
    deleted_test_files: deletedFiles,
    merged_test_files: mergedFiles,
    bucket_seconds: bucketSeconds || [],
    bucket_time_regressed_threshold: BUCKET_REGRESSION_FACTOR,
    bucket_time_regressed: (bucketSeconds || []).some(b => b.after > b.before * BUCKET_REGRESSION_FACTOR),
    declared_rows_mismatch: !!(extra && extra.declared_rows_mismatch),
    t0_mutant_rows_missing: (extra && extra.t0_mutant_rows_missing) || [],
    uncited_rows: (extra && extra.uncited_rows) || [],
  };
}

// `verify test-content {phase}` -- CLI entry point for the classifier above.
// Exit codes: 0 = passed; 1 = any requirement MISSING/PARTIAL or any
// hollow_tests/net_zero_assertion_files entries exist; 2 = phase-not-found or
// malformed-plan errors (matching the existing verify subcommand convention).
function cmdVerifyTestContent(cwd, phaseArg, raw) {
  const inputs = loadPhaseGateInputs(cwd, phaseArg);
  if (inputs.error) {
    writeStdoutSync(JSON.stringify(inputs.error, null, 2));
    process.exit(2);
    return;
  }
  const { phaseInfo, phaseDir, validPlans, malformedPlans, filesByPlan } = inputs;

  if (malformedPlans.length > 0) {
    writeStdoutSync(JSON.stringify({ error: true, type: 'malformed_plan', phase: phaseInfo.phase_number, malformed_plans: malformedPlans }, null, 2));
    process.exit(2);
    return;
  }

  const coverage = computeTestContentCoverage(cwd, phaseInfo.phase_number, validPlans, filesByPlan, phaseDir);

  const result = {
    phase: phaseInfo.phase_number,
    requirements: coverage.requirements,
    hollow_tests: coverage.hollow_tests,
    net_zero_assertion_files: coverage.net_zero_assertion_files,
    hollow_test_cases: coverage.hollow_test_cases,
    test_delta: coverage.test_delta,
    impl_files_without_tests: coverage.impl_files_without_tests,
    impl_files_covered: coverage.impl_files_covered,
    impl_files_exempt: coverage.impl_files_exempt,
    legacy_unchecked: coverage.legacy_unchecked,
    ...(coverage.legacy_data ? { legacy_data: coverage.legacy_data } : {}),
    passed: coverage.passed,
  };

  writeStdoutSync(JSON.stringify(result, null, 2));

  process.exit(coverage.passed ? 0 : 1);
}

// ─── Deferred Waiver Protocol (MILE-07, Phase 45-03) ─────────────────────────
// `deferred add`/`deferred list` are the ONLY sanctioned way to satisfy a
// phase-gate check without producing the real artifact -- every waiver is
// machine-readable ({step, reason, approver, timestamp, phase, plan}),
// appended atomically, and fires a best-effort Telegram notification.

// Valid --step values: the phase-gate checks plus the lifecycle steps coordinators defer (entries written under a legacy alias still waive).
const DEFERRED_STEPS = ['test', 'ui_qa', 'docs', 'e2e_plan', 'verification', 'discuss', 'research', 'plan', 'execution', 'verify'];
const DEFERRED_USAGE = 'usage: deferred add <phase> --step <step> --reason <text> --approver <name> [--plan <NN>]';

function cmdDeferredAdd(cwd, phaseArg, options, raw) {
  const { step, reason, approver, plan } = options;
  if (typeof step === 'string' && step.trim() && !DEFERRED_STEPS.includes(step.trim())) {
    error(`deferred add: unknown --step "${step}". Valid steps: ${DEFERRED_STEPS.join(', ')}. ${DEFERRED_USAGE}`);
  }
  if (!step || typeof step !== 'string' || !step.trim()) { error(`deferred add requires --step, --reason, --approver. Valid steps: ${DEFERRED_STEPS.join(', ')}. ${DEFERRED_USAGE}`); }
  if (!reason || typeof reason !== 'string' || !reason.trim()) { error('deferred add requires --step, --reason, --approver'); }
  if (!approver || typeof approver !== 'string' || !approver.trim()) { error('deferred add requires --step, --reason, --approver'); }

  const phaseInfo = findPhaseInternal(cwd, phaseArg);
  if (!phaseInfo || !phaseInfo.found) {
    process.stdout.write(JSON.stringify({ error: true, type: 'phase_not_found', phase: phaseArg }, null, 2));
    process.exit(1);
    return;
  }

  const existing = readDeferredWaivers(cwd, phaseInfo.directory);
  if (!existing.ok) {
    process.stdout.write(JSON.stringify({ ...existing.error, message: `${existing.error.message} — fix DEFERRED.json before adding a new entry` }, null, 2));
    process.exit(2);
    return;
  }

  const newEntry = {
    step,
    reason,
    approver,
    timestamp: new Date().toISOString(),
    phase: phaseInfo.phase_number,
    plan: plan || null,
  };

  const deferredPath = path.join(cwd, phaseInfo.directory, 'DEFERRED.json');
  atomicWriteFileSync(deferredPath, JSON.stringify([...existing.waivers, newEntry], null, 2));

  // Fire-and-forget -- must not delay or affect this command's exit.
  notifyTelegramWaiver(newEntry);

  output({ written: true, entry: newEntry }, raw);
}

function cmdDeferredList(cwd, phaseArg, raw) {
  const phaseInfo = findPhaseInternal(cwd, phaseArg);
  if (!phaseInfo || !phaseInfo.found) {
    process.stdout.write(JSON.stringify({ error: true, type: 'phase_not_found', phase: phaseArg }, null, 2));
    process.exit(1);
    return;
  }

  const result = readDeferredWaivers(cwd, phaseInfo.directory);
  if (!result.ok) {
    process.stdout.write(JSON.stringify(result.error, null, 2));
    process.exit(2);
    return;
  }

  output({ phase: phaseInfo.phase_number, waivers: result.waivers, count: result.waivers.length }, raw);
}

// ─── Execution State Protocol (MILE-13, Phase 48-03) ─────────────────────────
// `.planning/execution-state.json` is a per-phase/per-plan retry counter that
// drives autonomous execution's self-healing failure path: `record-failure`
// increments the counter and returns an `action` of retry (1st failure),
// debug (2nd failure, below the configurable `max_attempts` ceiling: the one
// rescue), or escalate (every later failure -- never spawn another debug attempt).
// `record-success` clears the counter. `get` is a read-only lookup. All three
// share the same malformed-JSON-safe contract as `deferred add`/`deferred
// list` (readDeferredWaivers): an absent file means no history (not an
// error); a malformed file is ALWAYS a loud, typed, non-zero-exit error --
// never silently reset to `{}`.

function getExecutionStatePath(cwd) {
  return path.join(cwd, '.planning', 'execution-state.json');
}

// Phase-level and plan-level entries for the SAME phase number are
// independent keys (e.g. "5" vs "5-01") -- recording a failure at one
// granularity never affects the other's attempt count.
function computeStateKey(phase, plan) {
  return plan ? `${phase}-${plan}` : `${phase}`;
}

function readExecutionState(cwd) {
  const statePath = getExecutionStatePath(cwd);
  if (!fs.existsSync(statePath)) {
    return { ok: true, state: {} };
  }
  const content = safeReadFile(statePath);
  if (content === null) {
    return { ok: false, error: { error: true, type: 'corrupted_execution_state', message: 'Could not read execution-state.json' } };
  }
  const parsed = safeJsonParse(content, 'execution-state.json');
  if (!parsed.ok) {
    return { ok: false, error: { error: true, type: 'corrupted_execution_state', message: parsed.error.message } };
  }
  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    return { ok: false, error: { error: true, type: 'corrupted_execution_state', message: 'execution-state.json must be a JSON object keyed by phase/plan' } };
  }
  return { ok: true, state: parsed.value };
}

function writeExecutionState(cwd, state) {
  atomicWriteFileSync(getExecutionStatePath(cwd), JSON.stringify(state, null, 2));
}

// Pure-ish core of `record-failure`: returns {ok:false,error} on a corrupt state file.
function applyExecutionStateFailure(cwd, options) {
  const { phase, plan, errorMsg, step, files } = options;
  const existing = readExecutionState(cwd);
  if (!existing.ok) return existing;

  const key = computeStateKey(phase, plan);
  const state = existing.state;
  const entry = state[key] || { attempts: 0, history: [] };
  entry.attempts = (entry.attempts || 0) + 1;
  entry.last_error = errorMsg || null;
  entry.last_step = step || null;
  entry.files_modified = files ? files.split(',').map((f) => f.trim()).filter(Boolean) : [];
  entry.history = entry.history || [];
  entry.history.push({ attempts: entry.attempts, error: errorMsg || null, timestamp: new Date().toISOString() });
  // Cap history at 10 entries, dropping the oldest.
  if (entry.history.length > 10) {
    entry.history = entry.history.slice(entry.history.length - 10);
  }
  state[key] = entry;

  const maxAttempts = loadConfig(cwd).max_attempts;
  // The rescue debugger runs once per plan: only the 2nd failure returns `debug`; every later one escalates.
  const action = entry.attempts === 1 ? 'retry' : (entry.attempts === 2 && entry.attempts < maxAttempts ? 'debug' : 'escalate');

  writeExecutionState(cwd, state);
  return {
    ok: true,
    result: {
      key,
      attempts: entry.attempts,
      action,
      max_attempts: maxAttempts,
      error: entry.last_error,
      last_step: entry.last_step,
      files_modified: entry.files_modified,
    },
  };
}

function cmdExecutionStateRecordFailure(cwd, options, raw) {
  if (!options.phase) { error('execution-state record-failure requires --phase'); }
  const applied = applyExecutionStateFailure(cwd, options);
  if (!applied.ok) {
    process.stdout.write(JSON.stringify({ ...applied.error, message: `${applied.error.message} — fix execution-state.json before recording another failure` }, null, 2));
    process.exit(2);
    return;
  }
  output(applied.result, raw);
}

function applyExecutionStateSuccess(cwd, options) {
  const existing = readExecutionState(cwd);
  if (!existing.ok) return existing;
  const key = computeStateKey(options.phase, options.plan);
  if (Object.prototype.hasOwnProperty.call(existing.state, key)) {
    delete existing.state[key];
    writeExecutionState(cwd, existing.state);
  }
  return { ok: true };
}

function cmdExecutionStateRecordSuccess(cwd, options, raw) {
  const { phase, plan } = options;
  if (!phase) { error('execution-state record-success requires --phase'); }

  const existing = readExecutionState(cwd);
  if (!existing.ok) {
    process.stdout.write(JSON.stringify({ ...existing.error, message: `${existing.error.message} — fix execution-state.json before recording success` }, null, 2));
    process.exit(2);
    return;
  }

  const key = computeStateKey(phase, plan);
  const state = existing.state;
  const cleared = Object.prototype.hasOwnProperty.call(state, key);
  if (cleared) {
    delete state[key];
    writeExecutionState(cwd, state);
  }

  output({ cleared, key }, raw);
}

function cmdExecutionStateGet(cwd, options, raw) {
  const { phase, plan } = options;
  if (!phase) { error('execution-state get requires --phase'); }

  const existing = readExecutionState(cwd);
  if (!existing.ok) {
    process.stdout.write(JSON.stringify(existing.error, null, 2));
    process.exit(2);
    return;
  }

  const key = computeStateKey(phase, plan);
  const entry = existing.state[key];
  if (!entry) {
    output({ attempts: 0, key }, raw);
    return;
  }

  output({ ...entry, key }, raw);
}

function cmdVerifyReferences(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const found = [];
  const missing = [];

  // Find @-references: @path/to/file (must contain / to be a file path)
  const atRefs = content.match(/@([^\s\n,)]+\/[^\s\n,)]+)/g) || [];
  for (const ref of atRefs) {
    const cleanRef = ref.slice(1); // remove @
    const resolved = cleanRef.startsWith('~/')
      ? path.join(process.env.HOME || '', cleanRef.slice(2))
      : path.join(cwd, cleanRef);
    if (fs.existsSync(resolved)) {
      found.push(cleanRef);
    } else {
      missing.push(cleanRef);
    }
  }

  // Find backtick file paths that look like real paths (contain / and have extension)
  const backtickRefs = content.match(/`([^`]+\/[^`]+\.[a-zA-Z]{1,10})`/g) || [];
  for (const ref of backtickRefs) {
    const cleanRef = ref.slice(1, -1); // remove backticks
    if (cleanRef.startsWith('http') || cleanRef.includes('${') || cleanRef.includes('{{')) continue;
    if (found.includes(cleanRef) || missing.includes(cleanRef)) continue; // dedup
    const resolved = path.join(cwd, cleanRef);
    if (fs.existsSync(resolved)) {
      found.push(cleanRef);
    } else {
      missing.push(cleanRef);
    }
  }

  output({
    valid: missing.length === 0,
    found: found.length,
    missing,
    total: found.length + missing.length,
  }, raw, missing.length === 0 ? 'valid' : 'invalid');
}

function cmdVerifyCommits(cwd, hashes, raw) {
  if (!hashes || hashes.length === 0) { error('At least one commit hash required'); }

  const valid = [];
  const invalid = [];
  for (const hash of hashes) {
    const result = execGit(cwd, ['cat-file', '-t', hash]);
    if (result.exitCode === 0 && result.stdout.trim() === 'commit') {
      valid.push(hash);
    } else {
      invalid.push(hash);
    }
  }

  output({
    all_valid: invalid.length === 0,
    valid,
    invalid,
    total: hashes.length,
  }, raw, invalid.length === 0 ? 'valid' : 'invalid');
}

function cmdVerifyArtifacts(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const artifacts = parseMustHavesBlock(content, 'artifacts');
  if (artifacts.length === 0) {
    output({ error: 'No must_haves.artifacts found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const artifact of artifacts) {
    if (typeof artifact === 'string') continue; // skip simple string items
    const artPath = artifact.path;
    if (!artPath) continue;

    const artFullPath = path.join(cwd, artPath);
    const exists = fs.existsSync(artFullPath);
    const check = { path: artPath, exists, issues: [], passed: false };

    if (exists) {
      const fileContent = safeReadFile(artFullPath) || '';
      const lineCount = fileContent.split('\n').length;

      if (artifact.min_lines && lineCount < artifact.min_lines) {
        check.issues.push(`Only ${lineCount} lines, need ${artifact.min_lines}`);
      }
      if (artifact.contains && !fileContent.includes(artifact.contains)) {
        check.issues.push(`Missing pattern: ${artifact.contains}`);
      }
      if (artifact.exports) {
        const exports = Array.isArray(artifact.exports) ? artifact.exports : [artifact.exports];
        for (const exp of exports) {
          if (!fileContent.includes(exp)) check.issues.push(`Missing export: ${exp}`);
        }
      }
      check.passed = check.issues.length === 0;
    } else {
      check.issues.push('File not found');
    }

    results.push(check);
  }

  const passed = results.filter(r => r.passed).length;
  output({
    all_passed: passed === results.length,
    passed,
    total: results.length,
    artifacts: results,
  }, raw, passed === results.length ? 'valid' : 'invalid');
}

function cmdVerifyKeyLinks(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const keyLinks = parseMustHavesBlock(content, 'key_links');
  if (keyLinks.length === 0) {
    output({ error: 'No must_haves.key_links found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const link of keyLinks) {
    if (typeof link === 'string') continue;
    const check = { from: link.from, to: link.to, via: link.via || '', verified: false, detail: '' };

    const sourceContent = safeReadFile(path.join(cwd, link.from || ''));
    if (!sourceContent) {
      check.detail = 'Source file not found';
    } else if (link.pattern) {
      try {
        const regex = new RegExp(link.pattern);
        if (regex.test(sourceContent)) {
          check.verified = true;
          check.detail = 'Pattern found in source';
        } else {
          const targetContent = safeReadFile(path.join(cwd, link.to || ''));
          if (targetContent && regex.test(targetContent)) {
            check.verified = true;
            check.detail = 'Pattern found in target';
          } else {
            check.detail = `Pattern "${link.pattern}" not found in source or target`;
          }
        }
      } catch {
        check.detail = `Invalid regex pattern: ${link.pattern}`;
      }
    } else {
      // No pattern: just check source references target
      if (sourceContent.includes(link.to || '')) {
        check.verified = true;
        check.detail = 'Target referenced in source';
      } else {
        check.detail = 'Target not referenced in source';
      }
    }

    results.push(check);
  }

  const verified = results.filter(r => r.verified).length;
  output({
    all_verified: verified === results.length,
    verified,
    total: results.length,
    links: results,
  }, raw, verified === results.length ? 'valid' : 'invalid');
}

function cmdVerifyMigrationTimestamps(cwd, raw) {
  const migrationsDir = path.join(cwd, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    output({ migrations_dir: null, skipped: true, reason: 'No migrations directory found' }, raw);
    return;
  }

  // Read flat file list from migrations/
  let allFiles;
  try {
    allFiles = fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter(d => d.isFile())
      .map(d => d.name);
  } catch (e) {
    output({ error: 'Could not read migrations directory: ' + e.message }, raw);
    return;
  }

  // Filter to files with a leading numeric timestamp prefix
  const TIMESTAMP_RE = /^(\d+)([_\-].*)?$/;
  const migrationFiles = allFiles.filter(f => TIMESTAMP_RE.test(f));

  // Group by timestamp prefix
  const groups = {};
  for (const file of migrationFiles) {
    const match = TIMESTAMP_RE.exec(file);
    const ts = match[1];
    if (!groups[ts]) groups[ts] = [];
    groups[ts].push(file);
  }

  const migrations = [];
  const existingTimestamps = new Set(migrationFiles.map(f => TIMESTAMP_RE.exec(f)[1]));

  let conflictsFound = 0;
  let resolved = 0;

  for (const [ts, files] of Object.entries(groups)) {
    if (files.length === 1) {
      migrations.push({ file: files[0], timestamp: ts, status: 'ok' });
      continue;
    }

    // First file is canonical, rest are conflicts
    migrations.push({ file: files[0], timestamp: ts, status: 'ok' });

    for (let i = 1; i < files.length; i++) {
      const originalFile = files[i];
      const tsMatch = TIMESTAMP_RE.exec(originalFile);
      const suffix = tsMatch[2] || '';
      conflictsFound++;

      // Find a unique timestamp by incrementing
      let newTs = BigInt(ts) + BigInt(1);
      while (existingTimestamps.has(String(newTs))) {
        newTs += BigInt(1);
      }
      const newTsStr = String(newTs);
      const newFile = newTsStr + suffix;

      try {
        fs.renameSync(
          path.join(migrationsDir, originalFile),
          path.join(migrationsDir, newFile)
        );
        existingTimestamps.add(newTsStr);
        resolved++;
        migrations.push({
          file: newFile,
          timestamp: newTsStr,
          original_file: originalFile,
          new_file: newFile,
          status: 'resolved',
          action: 'renamed',
        });
      } catch (e) {
        migrations.push({
          file: originalFile,
          timestamp: ts,
          status: 'error',
          error: 'Rename failed: ' + e.message,
        });
      }
    }
  }

  output({
    migrations_dir: 'migrations',
    files_scanned: migrationFiles.length,
    conflicts_found: conflictsFound,
    resolved,
    migrations,
  }, raw, conflictsFound === 0 || resolved === conflictsFound ? 'valid' : 'invalid');
}

// ─── Verify Dependency Stability ──────────────────────────────────────────────

function cmdVerifyDependencyStability(cwd, phaseArg, raw) {
  if (!phaseArg) {
    error('phase number required: verify dependency-stability <phase>');
    return;
  }

  const phaseNum = parseInt(phaseArg, 10);
  if (isNaN(phaseNum)) {
    error('phase must be a number');
    return;
  }

  const phasesDir = path.join(cwd, '.planning', 'phases');
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  // 1. Find the target phase directory
  const normalized = normalizePhaseName(phaseNum.toString());
  const allDirs = fs.existsSync(phasesDir) ? fs.readdirSync(phasesDir) : [];
  const phaseDir = allDirs.find(function(d) { return d.startsWith(normalized + '-') || d === normalized; });

  if (!phaseDir) {
    output({ error: 'Phase ' + phaseNum + ' directory not found', drift_detected: false }, raw);
    return;
  }

  // 2. Read ROADMAP.md to find what phases this phase depends on
  let dependsOn = [];
  if (fs.existsSync(roadmapPath)) {
    const roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
    // Find the phase section header
    const phaseHeaderRe = new RegExp('###\\s+Phase\\s+' + phaseNum + '[^\\d]', 'i');
    const phaseStart = roadmapContent.search(phaseHeaderRe);
    if (phaseStart !== -1) {
      const sectionRest = roadmapContent.slice(phaseStart, phaseStart + 2000);
      const depsMatch = sectionRest.match(/\*\*Depends on:\*\*\s*([^\n]+)/i);
      if (depsMatch) {
        const depsText = depsMatch[1].trim();
        if (!depsText.toLowerCase().includes('nothing')) {
          dependsOn = depsText
            .split(',')
            .map(function(dep) {
              const m = dep.match(/Phase\s+(\d+)/);
              return m ? parseInt(m[1]) : null;
            })
            .filter(function(n) { return n !== null; });
        }
      }
    }
  }

  if (dependsOn.length === 0) {
    output({
      phase: phaseNum,
      depends_on_phases: [],
      files_checked: [],
      drifted_files: [],
      drift_detected: false,
      message: 'No dependencies to check'
    }, raw, 'stable');
    return;
  }

  // 3. For each depended-on phase, collect files_modified from their PLAN.md frontmatters
  const allTrackedFiles = new Map(); // file -> depPhaseNum
  const depsWithNoFiles = [];

  for (const depPhaseNum of dependsOn) {
    const depNorm = normalizePhaseName(depPhaseNum.toString());
    const depDir = allDirs.find(function(d) { return d.startsWith(depNorm + '-') || d === depNorm; });
    if (!depDir) continue;

    const depDirPath = path.join(phasesDir, depDir);
    let planFiles = [];
    try { planFiles = fs.readdirSync(depDirPath).filter(function(f) { return f.endsWith('-PLAN.md'); }); } catch (e) {}
    let foundFiles = false;

    for (const planFile of planFiles) {
      const planContent = safeReadFile(path.join(depDirPath, planFile));
      if (!planContent) continue;
      // Parse YAML frontmatter
      const fmMatch = planContent.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      // Extract files_modified list
      const filesModifiedMatch = fm.match(/files_modified:\s*\n((?:\s+-\s+[^\n]+\n?)*)/);
      if (filesModifiedMatch) {
        const lines = filesModifiedMatch[1].split('\n');
        for (const line of lines) {
          const fileMatch = line.match(/^\s+-\s+(.+)/);
          if (fileMatch) {
            const trackedFile = fileMatch[1].trim().replace(/^["']|["']$/g, '');
            if (trackedFile) {
              allTrackedFiles.set(trackedFile, depPhaseNum);
              foundFiles = true;
            }
          }
        }
      }
    }

    if (!foundFiles) depsWithNoFiles.push(depPhaseNum);
  }

  if (allTrackedFiles.size === 0) {
    output({
      phase: phaseNum,
      depends_on_phases: dependsOn,
      files_checked: [],
      drifted_files: [],
      drift_detected: false,
      message: 'No tracked files found in depended-on phases (files_modified frontmatter may be absent)',
      deps_with_no_files: depsWithNoFiles
    }, raw, 'stable');
    return;
  }

  // 4. For each tracked file, check git log for commits not from the origin phase
  const driftedFiles = [];
  const filesChecked = Array.from(allTrackedFiles.keys());

  for (const [trackedFile, originPhase] of allTrackedFiles) {
    const fullFilePath = path.join(cwd, trackedFile);
    if (!fs.existsSync(fullFilePath)) continue;

    try {
      const { execFileSync } = require('child_process');
      const logOutput = execFileSync(
        'git', ['log', '--oneline', '--follow', '--', trackedFile],
        { cwd: cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
      ).trim();

      if (!logOutput) continue;

      const originNormStr = normalizePhaseName(originPhase.toString());
      const targetNormStr = normalizePhaseName(phaseNum.toString());

      const commits = logOutput.split('\n').map(function(line) {
        const spaceIdx = line.indexOf(' ');
        return {
          hash: line.slice(0, spaceIdx).trim(),
          message: line.slice(spaceIdx + 1).trim()
        };
      });

      for (const commit of commits) {
        const msg = commit.message;
        const isFromOriginPhase = msg.includes(originNormStr) ||
          msg.toLowerCase().includes('phase ' + originPhase);
        const isFromTargetPhase = msg.includes(targetNormStr) ||
          msg.toLowerCase().includes('phase ' + phaseNum);

        if (!isFromOriginPhase && !isFromTargetPhase) {
          // Extract phase number from conventional commit message if possible
          const phaseInMsg = msg.match(/(?:feat|fix|refactor|docs|chore|test)[^(]*\((\d+)/);
          const modifiedByPhase = phaseInMsg ? phaseInMsg[1] : 'unknown';
          driftedFiles.push({
            file: trackedFile,
            origin_phase: originPhase,
            modified_by_phase: modifiedByPhase,
            commit_hash: commit.hash,
            commit_msg: commit.message
          });
          break; // Only report first drift per file
        }
      }
    } catch (gitErr) {
      // git unavailable or file not tracked — skip silently
    }
  }

  const result = {
    phase: phaseNum,
    depends_on_phases: dependsOn,
    files_checked: filesChecked,
    drifted_files: driftedFiles,
    drift_detected: driftedFiles.length > 0
  };

  if (depsWithNoFiles.length > 0) result.deps_with_no_files = depsWithNoFiles;

  output(result, raw, driftedFiles.length > 0 ? 'drift_detected' : 'stable');
}


// ─── Shared Phase Parsing Helper ──────────────────────────────────────────────

/**
 * Parse phases from ROADMAP.md content + disk state.
 * Shared between cmdRoadmapAnalyze and cmdInitExecuteRoadmap to avoid duplication.
 * @param {string} content - ROADMAP.md content
 * @param {string} phasesDir - path to .planning/phases
 * @param {object} [options] - { includeExtendedDiskInfo: true } to include has_context/has_research/roadmap_complete
 * @returns {Array} phases
 */
function parseRoadmapPhases(content, phasesDir, options) {
  const extended = options && options.includeExtendedDiskInfo;
  const phasePattern = /###\s*Phase\s+(\d+(?:\.\d+)?)\s*:\s*([^\n]+)/gi;
  const phases = [];
  let match;

  while ((match = phasePattern.exec(content)) !== null) {
    const phaseNum = match[1];
    const phaseName = match[2].replace(/\(INSERTED\)/i, '').trim();

    const sectionStart = match.index;
    const restOfContent = content.slice(sectionStart);
    const nextHeader = restOfContent.match(/\n###\s+Phase\s+\d/i);
    const sectionEnd = nextHeader ? sectionStart + nextHeader.index : content.length;
    const section = content.slice(sectionStart, sectionEnd);

    const goalMatch = section.match(ROADMAP_GOAL_RE);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    const dependsMatch = section.match(/\*\*Depends on:\*\*\s*([^\n]+)/i);
    const depends_on = dependsMatch ? dependsMatch[1].trim() : null;

    const normalized = normalizePhaseName(phaseNum);
    let diskStatus = 'no_directory';
    let planCount = 0;
    let summaryCount = 0;
    let hasContext = false;
    let hasResearch = false;

    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      const dirMatch = dirs.find(d => d.startsWith(normalized + '-') || d === normalized);

      if (dirMatch) {
        const phaseFiles = fs.readdirSync(path.join(phasesDir, dirMatch));
        planCount = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').length;
        summaryCount = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').length;
        if (extended) {
          hasContext = phaseFiles.some(f => f.endsWith('-CONTEXT.md') || f === 'CONTEXT.md');
          hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');
        }

        if (summaryCount >= planCount && planCount > 0) diskStatus = 'complete';
        else if (summaryCount > 0) diskStatus = 'partial';
        else if (planCount > 0) diskStatus = 'planned';
        else if (extended && hasResearch) diskStatus = 'researched';
        else if (extended && hasContext) diskStatus = 'discussed';
        else diskStatus = 'empty';
      }
    } catch {}

    const phaseObj = { number: phaseNum, name: phaseName, goal, depends_on, disk_status: diskStatus };
    if (options && options.truthCwd) {
      // Only a phase whose disk evidence is complete can be proven complete; skip the git-backed check otherwise.
      phaseObj.phase_complete = diskStatus === 'complete' ? phaseTruth(options.truthCwd, phaseNum).complete : false;
    }
    if (extended) {
      phaseObj.plan_count = planCount;
      phaseObj.summary_count = summaryCount;
      phaseObj.has_context = hasContext;
      phaseObj.has_research = hasResearch;
      phaseObj.roadmap_complete = roadmapBox.checkboxState(content, phaseNum) === true;
    }
    phases.push(phaseObj);
  }

  return phases;
}

// ─── Roadmap Analysis ─────────────────────────────────────────────────────────

// Accepts both `**Goal:** x` (canonical) and `**Goal**: x`.
const ROADMAP_GOAL_RE = /\*\*Goal(?::\*\*|\*\*:)\s*([^\n]+)/i;
// `**vX.Y.Z Name**` milestone entries (the ## Milestones bullet list).
const MILESTONE_ENTRY_RE = /\*\*v([\d.]+)\s+([^*()\n]+?)\s*\*\*/g;

function cmdRoadmapAnalyze(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  if (!fs.existsSync(roadmapPath)) {
    output({ error: 'ROADMAP.md not found', milestones: [], phases: [], current_phase: null }, raw);
    return;
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const phasesDir = path.join(cwd, '.planning', 'phases');

  const phases = parseRoadmapPhases(content, phasesDir, { includeExtendedDiskInfo: true });

  // Extract milestone info
  const milestones = [];
  const milestonePattern = /##\s*(.*v(\d+\.\d+)[^(\n]*)/gi;
  let mMatch;
  while ((mMatch = milestonePattern.exec(content)) !== null) {
    milestones.push({
      heading: mMatch[1].trim(),
      version: 'v' + mMatch[2],
    });
  }

  for (const m of content.matchAll(MILESTONE_ENTRY_RE)) {
    const version = 'v' + m[1];
    if (milestones.some(x => x.heading.includes(version))) continue;
    milestones.push({ heading: `${version} ${m[2].trim()}`, version });
  }

  // Find current and next phase
  const currentPhase = phases.find(p => p.disk_status === 'planned' || p.disk_status === 'partial') || null;
  const nextPhase = phases.find(p => p.disk_status === 'empty' || p.disk_status === 'no_directory' || p.disk_status === 'discussed' || p.disk_status === 'researched') || null;

  // Aggregated stats
  const totalPlans = phases.reduce((sum, p) => sum + p.plan_count, 0);
  const totalSummaries = phases.reduce((sum, p) => sum + p.summary_count, 0);
  const completedPhases = phases.filter(p => p.disk_status === 'complete').length;


  // ─── File conflict detection for parallel-eligible phases ────────────────────
  const fileConflicts = [];

  try {
    // Only check not-yet-complete phases that have directories
    const incompletePhases = phases.filter(function(p) {
      return p.disk_status !== 'complete';
    });

    // Build phaseNum -> Set<string> map from PLAN.md files_modified frontmatter
    const phaseFilesMap = {};

    // Re-read entries from phasesDir for this pass
    let dirEntries = [];
    try { dirEntries = fs.readdirSync(phasesDir, { withFileTypes: true }); } catch (e) {}
    const allPhaseDirs = dirEntries.filter(function(e) { return e.isDirectory(); }).map(function(e) { return e.name; });

    for (const phase of incompletePhases) {
      const normPhase = normalizePhaseName(phase.number);
      const phDir = allPhaseDirs.find(function(d) { return d.startsWith(normPhase + '-') || d === normPhase; });
      if (!phDir) continue;

      const planFiles = fs.readdirSync(path.join(phasesDir, phDir))
        .filter(function(f) { return f.endsWith('-PLAN.md'); });
      const claimedFiles = {};

      for (const planFile of planFiles) {
        const planContent = safeReadFile(path.join(phasesDir, phDir, planFile));
        if (!planContent) continue;
        const fmMatch = planContent.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;
        const fm = fmMatch[1];
        const filesModMatch = fm.match(/files_modified:\s*\n((?:\s+-\s+[^\n]+\n?)*)/);
        if (filesModMatch) {
          const lines = filesModMatch[1].split('\n');
          for (const line of lines) {
            const fm2 = line.match(/^\s+-\s+(.+)/);
            if (fm2) {
              const f = fm2[1].trim().replace(/^["']|["']$/g, '');
              if (f) claimedFiles[f] = true;
            }
          }
        }
      }

      const keys = Object.keys(claimedFiles);
      if (keys.length > 0) {
        phaseFilesMap[phase.number] = keys;
      }
    }

    // Find parallel-eligible pairs: phases with no mutual dependency
    const conflictMap = {}; // file -> Set of phase numbers

    for (let i = 0; i < incompletePhases.length; i++) {
      for (let j = i + 1; j < incompletePhases.length; j++) {
        const phA = incompletePhases[i];
        const phB = incompletePhases[j];

        // Parse depends_on strings (may be "Phase 35" style)
        function parseDeps(depsStr) {
          if (!depsStr) return [];
          const matches = [];
          const re = /Phase\s+(\d+)/gi;
          let m;
          while ((m = re.exec(depsStr)) !== null) matches.push(parseInt(m[1]));
          return matches;
        }

        const depsA = parseDeps(phA.depends_on);
        const depsB = parseDeps(phB.depends_on);
        const numA = parseInt(phA.number) || 0;
        const numB = parseInt(phB.number) || 0;

        // Parallel-eligible if neither depends on the other
        if (depsA.indexOf(numB) !== -1 || depsB.indexOf(numA) !== -1) continue;

        const filesA = phaseFilesMap[phA.number] || [];
        const filesB = phaseFilesMap[phB.number] || [];

        for (const file of filesA) {
          if (filesB.indexOf(file) !== -1) {
            if (!conflictMap[file]) conflictMap[file] = {};
            conflictMap[file][phA.number] = true;
            conflictMap[file][phB.number] = true;
          }
        }
      }
    }

    for (const file of Object.keys(conflictMap)) {
      const claimedBy = Object.keys(conflictMap[file])
        .map(function(p) { return parseInt(p) || p; })
        .sort(function(a, b) { return a - b; });
      fileConflicts.push({
        file: file,
        claimed_by: claimedBy,
        conflict_type: 'write-write'
      });
    }
  } catch (conflictErr) {
    // Non-fatal: file conflict detection is best-effort
  }

  const result = {
    milestones,
    phases,
    phase_count: phases.length,
    completed_phases: completedPhases,
    total_plans: totalPlans,
    total_summaries: totalSummaries,
    progress_percent: totalPlans > 0 ? Math.round((totalSummaries / totalPlans) * 100) : 0,
    current_phase: currentPhase ? currentPhase.number : null,
    next_phase: nextPhase ? nextPhase.number : null,
    file_conflicts: fileConflicts,
  };

  output(result, raw);
}

// ─── Roadmap Parse ────────────────────────────────────────────────────────────

async function cmdRoadmapParse(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const result = await parseRoadmap(roadmapPath);
  output(result, raw);
}

// ─── Roadmap DAG ──────────────────────────────────────────────────────────────

async function cmdRoadmapDAG(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const parsed = await parseRoadmap(roadmapPath);

  if (parsed.error) {
    output({ error: parsed.error }, raw);
    return;
  }

  const { graph } = buildDAG(parsed.phases);
  const executionResult = getExecutionOrder(parsed.phases);
  const parallelOpportunities = detectParallelOpportunities(graph, executionResult.execution_order);

  const result = {
    execution_order: executionResult.execution_order,
    has_cycle: executionResult.has_cycle,
    cycle_phases: executionResult.cycle_phases,
    parallel_opportunities: parallelOpportunities
  };

  output(result, raw);
}

// ─── Roadmap Status ───────────────────────────────────────────────────────────

async function cmdRoadmapStatus(cwd, phaseArg, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const parsed = await parseRoadmap(roadmapPath);

  if (parsed.error) {
    output({ error: parsed.error }, raw);
    return;
  }

  // Update phase statuses based on disk
  const phasesDir = path.join(cwd, '.planning', 'phases');

  for (const phase of parsed.phases) {
    if (!fs.existsSync(phasesDir)) {
      phase.status = 'pending';
      continue;
    }

    // Check for phase directory
    const phasePattern = new RegExp(`^${phase.number.toString().padStart(2, '0')}-`);
    const dirs = fs.readdirSync(phasesDir).filter(d => phasePattern.test(d));

    if (dirs.length === 0) {
      phase.status = 'pending';
      continue;
    }

    const phaseDir = path.join(phasesDir, dirs[0]);
    const files = fs.readdirSync(phaseDir);

    // Check VERIFICATION.md
    const verificationFile = `${phase.number.toString().padStart(2, '0')}-VERIFICATION.md`;
    if (files.includes(verificationFile)) {
      const verificationPath = path.join(phaseDir, verificationFile);
      const content = fs.readFileSync(verificationPath, 'utf-8');
      if (content.match(/status:\s*passed/i)) {
        phase.status = 'complete';
        continue;
      }
    }

    // Check for SUMMARYs
    const summaries = files.filter(f => f.endsWith('-SUMMARY.md'));
    const plans = files.filter(f => f.endsWith('-PLAN.md'));

    if (summaries.length > 0) {
      phase.status = 'in_progress';
    } else if (plans.length > 0) {
      phase.status = 'in_progress';
    } else {
      phase.status = 'pending';
    }
  }

  // If phase arg provided, return single phase status
  if (phaseArg) {
    const targetPhase = parsed.phases.find(p => p.number === parseInt(phaseArg));
    if (targetPhase) {
      output({ phase: targetPhase.number, status: targetPhase.status }, raw, targetPhase.status);
    } else {
      output({ error: `Phase ${phaseArg} not found` }, raw);
    }
    return;
  }

  // Return all phases with statuses
  const result = {
    phases: parsed.phases.map(p => ({
      number: p.number,
      name: p.name,
      status: p.status
    }))
  };

  output(result, raw);
}

// ─── Roadmap Validate ─────────────────────────────────────────────────────────

async function cmdRoadmapValidate(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const parsed = await parseRoadmap(roadmapPath);

  if (parsed.error) {
    output({ valid: false, errors: [parsed.error], warnings: [] }, raw);
    return;
  }

  const errors = [];
  const warnings = [];

  // Validate all phases have Goal
  for (const phase of parsed.phases) {
    if (!phase.goal || phase.goal.length === 0) {
      errors.push(`Phase ${phase.number}: Missing Goal`);
    }

    // Validate dependencies reference valid phases
    for (const depNum of phase.depends_on) {
      const dep = parsed.phases.find(p => p.number === depNum);
      if (!dep) {
        errors.push(`Phase ${phase.number}: Dependency Phase ${depNum} not found`);
      }
    }

    // Validate requirements IDs format (e.g., REQ-01, AUTO-01)
    for (const req of phase.requirements) {
      if (!req.match(/^[A-Z]+-\d+$/)) {
        warnings.push(`Phase ${phase.number}: Requirement "${req}" doesn't match standard format (XXX-NN)`);
      }
    }
  }

  // Check for circular dependencies
  const executionResult = getExecutionOrder(parsed.phases);
  if (executionResult.has_cycle) {
    errors.push(`Circular dependency detected in phases: ${executionResult.cycle_phases.join(', ')}`);
  }

  const result = {
    valid: errors.length === 0,
    errors,
    warnings
  };

  output(result, raw);
}

// ─── Phase Add ────────────────────────────────────────────────────────────────

function cmdPhaseAdd(cwd, description, raw) {
  if (!description) {
    error('description required for phase add');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  if (!fs.existsSync(roadmapPath)) {
    error('ROADMAP.md not found');
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const slug = generateSlugInternal(description);

  // Find highest integer phase number
  const phasePattern = /###\s*Phase\s+(\d+)(?:\.\d+)?:/gi;
  let maxPhase = 0;
  let m;
  while ((m = phasePattern.exec(content)) !== null) {
    const num = parseInt(m[1], 10);
    if (num > maxPhase) maxPhase = num;
  }

  const newPhaseNum = maxPhase + 1;
  const paddedNum = String(newPhaseNum).padStart(2, '0');
  const truncatedSlug = slug.slice(0, 60).replace(/-+$/, '');
  const dirName = `${paddedNum}-${truncatedSlug}`;
  const dirPath = path.join(cwd, '.planning', 'phases', dirName);

  // Create directory
  fs.mkdirSync(dirPath, { recursive: true });

  // Build phase entry
  const phaseEntry = `\n### Phase ${newPhaseNum}: ${description}\n\n**Goal:** [To be planned]\n**Depends on:** Phase ${maxPhase}\n**Risk domains:** none\n**Plans:** 0 plans\n\nPlans:\n- [ ] TBD (run /gsd:plan-phase ${newPhaseNum} to break down)\n`;

  const updatedContent = roadmapBox.addPhase(content, { num: newPhaseNum, name: description, entry: phaseEntry, prev: maxPhase || null });

  atomicWriteFileSync(roadmapPath, updatedContent);

  const result = {
    phase_number: newPhaseNum,
    padded: paddedNum,
    name: description,
    slug,
    directory: `.planning/phases/${dirName}`,
  };

  output(result, raw, paddedNum);
}

// ─── Phase Insert (Decimal) ──────────────────────────────────────────────────

function cmdPhaseInsert(cwd, afterPhase, description, raw) {
  if (!afterPhase || !description) {
    error('after-phase and description required for phase insert');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  if (!fs.existsSync(roadmapPath)) {
    error('ROADMAP.md not found');
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const slug = generateSlugInternal(description);

  // Verify target phase exists
  const afterPhaseEscaped = afterPhase.replace(/\./g, '\\.');
  const targetPattern = new RegExp(`###\\s*Phase\\s+${afterPhaseEscaped}:`, 'i');
  if (!targetPattern.test(content)) {
    error(`Phase ${afterPhase} not found in ROADMAP.md`);
  }

  // Calculate next decimal using existing logic
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalizedBase = normalizePhaseName(afterPhase);
  let existingDecimals = [];

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const decimalPattern = new RegExp(`^${normalizedBase}\\.(\\d+)`);
    for (const dir of dirs) {
      const dm = dir.match(decimalPattern);
      if (dm) existingDecimals.push(parseInt(dm[1], 10));
    }
  } catch {}

  const nextDecimal = existingDecimals.length === 0 ? 1 : Math.max(...existingDecimals) + 1;
  const decimalPhase = `${normalizedBase}.${nextDecimal}`;
  const truncatedSlug = slug.slice(0, 60).replace(/-+$/, '');
  const dirName = `${decimalPhase}-${truncatedSlug}`;
  const dirPath = path.join(cwd, '.planning', 'phases', dirName);

  // Create directory
  fs.mkdirSync(dirPath, { recursive: true });

  // Build phase entry
  const phaseEntry = `\n### Phase ${decimalPhase}: ${description} (INSERTED)\n\n**Goal:** [Urgent work - to be planned]\n**Depends on:** Phase ${afterPhase}\n**Risk domains:** none\n**Plans:** 0 plans\n\nPlans:\n- [ ] TBD (run /gsd:plan-phase ${decimalPhase} to break down)\n`;

  const updatedContent = roadmapBox.addPhase(content, { num: decimalPhase, name: `${description} (INSERTED)`, entry: phaseEntry, prev: afterPhase, inline: true });
  atomicWriteFileSync(roadmapPath, updatedContent);

  const result = {
    phase_number: decimalPhase,
    after_phase: afterPhase,
    name: description,
    slug,
    directory: `.planning/phases/${dirName}`,
  };

  output(result, raw, decimalPhase);
}

// ─── Phase Remove ─────────────────────────────────────────────────────────────

function cmdPhaseRemove(cwd, targetPhase, options, raw) {
  if (!targetPhase) {
    error('phase number required for phase remove');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const force = options.force || false;

  if (!fs.existsSync(roadmapPath)) {
    error('ROADMAP.md not found');
  }

  // Normalize the target
  const normalized = normalizePhaseName(targetPhase);
  const isDecimal = targetPhase.includes('.');

  // Find and validate target directory
  let targetDir = null;
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    targetDir = dirs.find(d => d.startsWith(normalized + '-') || d === normalized);
  } catch {}

  // Check for executed work (SUMMARY.md files)
  if (targetDir && !force) {
    const targetPath = path.join(phasesDir, targetDir);
    const files = fs.readdirSync(targetPath);
    const summaries = files.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
    if (summaries.length > 0) {
      error(`Phase ${targetPhase} has ${summaries.length} executed plan(s). Use --force to remove anyway.`);
    }
  }

  // Delete target directory
  if (targetDir) {
    fs.rmSync(path.join(phasesDir, targetDir), { recursive: true, force: true });
  }

  // Renumber subsequent phases
  const renamedDirs = [];
  const renamedFiles = [];

  if (isDecimal) {
    // Decimal removal: renumber sibling decimals (e.g., removing 06.2 → 06.3 becomes 06.2)
    const baseParts = normalized.split('.');
    const baseInt = baseParts[0];
    const removedDecimal = parseInt(baseParts[1], 10);

    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

      // Find sibling decimals with higher numbers
      const decPattern = new RegExp(`^${baseInt}\\.(\\d+)-(.+)$`);
      const toRename = [];
      for (const dir of dirs) {
        const dm = dir.match(decPattern);
        if (dm && parseInt(dm[1], 10) > removedDecimal) {
          toRename.push({ dir, oldDecimal: parseInt(dm[1], 10), slug: dm[2] });
        }
      }

      // Sort descending to avoid conflicts
      toRename.sort((a, b) => b.oldDecimal - a.oldDecimal);

      for (const item of toRename) {
        const newDecimal = item.oldDecimal - 1;
        const oldPhaseId = `${baseInt}.${item.oldDecimal}`;
        const newPhaseId = `${baseInt}.${newDecimal}`;
        const newDirName = `${baseInt}.${newDecimal}-${item.slug}`;

        // Rename directory
        fs.renameSync(path.join(phasesDir, item.dir), path.join(phasesDir, newDirName));
        renamedDirs.push({ from: item.dir, to: newDirName });

        // Rename files inside
        const dirFiles = fs.readdirSync(path.join(phasesDir, newDirName));
        for (const f of dirFiles) {
          // Files may have phase prefix like "06.2-01-PLAN.md"
          if (f.includes(oldPhaseId)) {
            const newFileName = f.replace(oldPhaseId, newPhaseId);
            fs.renameSync(
              path.join(phasesDir, newDirName, f),
              path.join(phasesDir, newDirName, newFileName)
            );
            renamedFiles.push({ from: f, to: newFileName });
          }
        }
      }
    } catch {}

  } else {
    // Integer removal: renumber all subsequent integer phases
    const removedInt = parseInt(normalized, 10);

    try {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

      // Collect directories that need renumbering (integer phases > removed, and their decimals)
      const toRename = [];
      for (const dir of dirs) {
        const dm = dir.match(/^(\d+)(?:\.(\d+))?-(.+)$/);
        if (!dm) continue;
        const dirInt = parseInt(dm[1], 10);
        if (dirInt > removedInt) {
          toRename.push({
            dir,
            oldInt: dirInt,
            decimal: dm[2] ? parseInt(dm[2], 10) : null,
            slug: dm[3],
          });
        }
      }

      // Sort descending to avoid conflicts
      toRename.sort((a, b) => {
        if (a.oldInt !== b.oldInt) return b.oldInt - a.oldInt;
        return (b.decimal || 0) - (a.decimal || 0);
      });

      for (const item of toRename) {
        const newInt = item.oldInt - 1;
        const newPadded = String(newInt).padStart(2, '0');
        const oldPadded = String(item.oldInt).padStart(2, '0');
        const decimalSuffix = item.decimal !== null ? `.${item.decimal}` : '';
        const oldPrefix = `${oldPadded}${decimalSuffix}`;
        const newPrefix = `${newPadded}${decimalSuffix}`;
        const newDirName = `${newPrefix}-${item.slug}`;

        // Rename directory
        fs.renameSync(path.join(phasesDir, item.dir), path.join(phasesDir, newDirName));
        renamedDirs.push({ from: item.dir, to: newDirName });

        // Rename files inside
        const dirFiles = fs.readdirSync(path.join(phasesDir, newDirName));
        for (const f of dirFiles) {
          if (f.startsWith(oldPrefix)) {
            const newFileName = newPrefix + f.slice(oldPrefix.length);
            fs.renameSync(
              path.join(phasesDir, newDirName, f),
              path.join(phasesDir, newDirName, newFileName)
            );
            renamedFiles.push({ from: f, to: newFileName });
          }
        }
      }
    } catch {}
  }

  // Update ROADMAP.md
  let roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');

  // Remove the target phase section
  const targetEscaped = targetPhase.replace(/\./g, '\\.');
  const sectionPattern = new RegExp(
    `\\n?###\\s*Phase\\s+${targetEscaped}\\s*:[\\s\\S]*?(?=\\n###\\s+Phase\\s+\\d|$)`,
    'i'
  );
  roadmapContent = roadmapContent.replace(sectionPattern, '');

  // Remove from phase list (checkbox)
  const checkboxPattern = new RegExp(`\\n?-\\s*\\[[ x]\\]\\s*.*Phase\\s+${targetEscaped}[:\\s][^\\n]*`, 'gi');
  roadmapContent = roadmapContent.replace(checkboxPattern, '');

  // Remove from progress table
  const tableRowPattern = new RegExp(`\\n?\\|\\s*${targetEscaped}\\.?\\s[^|]*\\|[^\\n]*`, 'gi');
  roadmapContent = roadmapContent.replace(tableRowPattern, '');

  // Renumber references in ROADMAP for subsequent phases
  if (!isDecimal) {
    const removedInt = parseInt(normalized, 10);

    // Collect all integer phases > removedInt
    const maxPhase = 99; // reasonable upper bound
    for (let oldNum = maxPhase; oldNum > removedInt; oldNum--) {
      const newNum = oldNum - 1;
      const oldStr = String(oldNum);
      const newStr = String(newNum);
      const oldPad = oldStr.padStart(2, '0');
      const newPad = newStr.padStart(2, '0');

      // Phase headings: ### Phase 18: → ### Phase 17:
      roadmapContent = roadmapContent.replace(
        new RegExp(`(###\\s*Phase\\s+)${oldStr}(\\s*:)`, 'gi'),
        `$1${newStr}$2`
      );

      // Checkbox items: - [ ] **Phase 18:** → - [ ] **Phase 17:**
      roadmapContent = roadmapContent.replace(
        new RegExp(`(Phase\\s+)${oldStr}([:\\s])`, 'g'),
        `$1${newStr}$2`
      );

      // Plan references: 18-01 → 17-01
      roadmapContent = roadmapContent.replace(
        new RegExp(`${oldPad}-(\\d{2})`, 'g'),
        `${newPad}-$1`
      );

      // Table rows: | 18. → | 17.
      roadmapContent = roadmapContent.replace(
        new RegExp(`(\\|\\s*)${oldStr}\\.\\s`, 'g'),
        `$1${newStr}. `
      );

      // Depends on references
      roadmapContent = roadmapContent.replace(
        new RegExp(`(Depends on:\\*\\*\\s*Phase\\s+)${oldStr}\\b`, 'gi'),
        `$1${newStr}`
      );
    }
  }

  atomicWriteFileSync(roadmapPath, roadmapContent);

  // Update STATE.md phase count
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  if (fs.existsSync(statePath)) {
    let stateContent = fs.readFileSync(statePath, 'utf-8');
    // Update "Total Phases" field
    const totalPattern = /(\*\*Total Phases:\*\*\s*)(\d+)/;
    const totalMatch = stateContent.match(totalPattern);
    if (totalMatch) {
      const oldTotal = parseInt(totalMatch[2], 10);
      stateContent = stateContent.replace(totalPattern, `$1${oldTotal - 1}`);
    }
    // Update "Phase: X of Y" pattern
    const ofPattern = /(\bof\s+)(\d+)(\s*(?:\(|phases?))/i;
    const ofMatch = stateContent.match(ofPattern);
    if (ofMatch) {
      const oldTotal = parseInt(ofMatch[2], 10);
      stateContent = stateContent.replace(ofPattern, `$1${oldTotal - 1}$3`);
    }
    atomicWriteFileSync(statePath, stateContent);
  }

  const result = {
    removed: targetPhase,
    directory_deleted: targetDir || null,
    renamed_directories: renamedDirs,
    renamed_files: renamedFiles,
    roadmap_updated: true,
    state_updated: fs.existsSync(statePath),
  };

  output(result, raw);
}

// ─── Roadmap Progress-Table Row Rewriter ────────────────────────────────────
//
// Every ROADMAP phase summary table this framework's consuming projects use
// has a DIFFERENT column layout: 3-column (`| Phase | Requirements | Status |`),
// 4-column (`| Phase | Name | Plans | Status |`), 5-column
// (`| Phase | Name | Requirements | Flag | Status |`), and so on. Two previous
// implementations rewrote these rows with hardcoded column positions:
// `phase complete` assumed Status=column 3 / date=column 4, and
// `roadmap update-plan-progress` assumed a 5-column shape. Both are silent
// corrupters: applied to a row with a different layout they write the progress
// cell into whatever column happened to sit at that index (a Requirements or
// Flag cell, or a neighbouring row's name) and drop the row's real status text.
//
// The helpers below resolve the row's governing header FIRST, locate the
// progress/status column BY HEADER NAME, and rewrite only that cell — every
// other cell is spliced back byte-for-byte. A row whose cell count disagrees
// with its header is a pre-existing malformed row (already corrupted by an
// older version); positionally rewriting it cannot be made safe, so it is left
// untouched and reported instead.

const { splitTableCells, splitRowCells } = require('./md-table.js');

function headerColumnIndex(headerCells, re) {
  for (let i = 0; i < headerCells.length; i++) {
    const label = headerCells[i].replace(/[*_`]/g, '').trim();
    if (re.test(label)) return i;
  }
  return -1;
}

// Locates the phase row and the header row governing it. Returns null when
// either is absent or malformed.
function findProgressTableRow(content, phaseEscaped) {
  const lines = content.split('\n');
  // `0*` so a zero-padded row label ("| 01 Foundation |") matches phase 1.
  const rowRe = new RegExp(`^\\|\\s*0*${phaseEscaped}\\.?(\\s|\\|)`);
  let rowIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (rowRe.test(lines[i])) { rowIdx = i; break; }
  }
  if (rowIdx === -1) return null;
  const rowCells = splitTableCells(lines[rowIdx]);
  if (!rowCells) return null;

  let headerCells = null;
  // The governing header is the row directly above the nearest separator row.
  for (let i = rowIdx - 1; i >= 0 && i > rowIdx - 500 && !headerCells; i--) {
    const t = lines[i].trim();
    if (t.startsWith('#')) break;
    if (!/^\|[\s:|-]+\|$/.test(t)) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].trim() === '') continue;
      headerCells = splitTableCells(lines[j]);
      break;
    }
  }
  for (let i = rowIdx - 1; !headerCells && i >= 0 && i > rowIdx - 500; i--) {
    const t = lines[i].trim();
    if (t === '') continue;
    if (t.startsWith('#')) break; // reached the section heading — header is above it, not below
    if (/^\|[\s:|-]+\|$/.test(t)) continue; // separator row
    const cells = splitTableCells(t);
    // Real ROADMAP tables in the wild contain rows missing their trailing pipe
    // (hand-edited), so an unparseable line is skipped rather than treated as
    // the end of the table.
    if (!cells) continue;
    if (/^\d+(\.\d+)?\.?(\s|$)/.test(cells[0].trim())) continue; // a neighbouring DATA row, keep walking up
    headerCells = cells;
    break;
  }
  if (!headerCells) return null;
  return { lines, rowIdx, rowCells, headerCells };
}

function replaceTableRowCells(found, edits) {
  const cells = found.rowCells.slice();
  for (const [idx, text] of edits) cells[idx] = ` ${text} `;
  found.lines[found.rowIdx] = '|' + cells.join('|') + '|';
  return found.lines.join('\n');
}

const STATUS_HEADER_RE = /^(status|progress|state)\b/i;
const PLANS_HEADER_RE = /^(plans?|progress)\b/i;

/**
 * Rewrites only the progress/status cell of a phase row, located by header
 * name. `renderStatus(existingText)` returns the new status cell text, or null
 * to leave that column alone. `renderPlans(existingText)` does the same for a
 * separate Plans column when the table has one.
 *
 * Returns { content, updated, reason?, column?, header_columns?, row_cells? }.
 */
function updateProgressTableRow(content, phaseEscaped, renderStatus, renderPlans) {
  const found = findProgressTableRow(content, phaseEscaped);
  if (!found) return { content, updated: false, reason: 'phase row or its header not found in a progress table' };

  const { headerCells, rowCells } = found;
  const statusIdx = headerColumnIndex(headerCells, STATUS_HEADER_RE);
  const plansIdx = renderPlans && headerColumnIndex(headerCells, PLANS_HEADER_RE) !== statusIdx
    ? headerColumnIndex(headerCells, PLANS_HEADER_RE)
    : -1;

  if (statusIdx === -1 && plansIdx === -1) {
    return {
      content, updated: false, reason: 'header has no Status/Progress/Plans column',
      header_columns: headerCells.length,
    };
  }
  if (headerCells.length !== rowCells.length) {
    // Row was already corrupted by an older positional writer — it has a
    // different number of cells than its header. Any positional write would
    // compound the damage, so leave the row alone and report it.
    return {
      content,
      updated: false,
      reason: `row has ${rowCells.length} cells but its header declares ${headerCells.length} — malformed row left untouched (needs manual repair)`,
      header_columns: headerCells.length,
      row_cells: rowCells.length,
    };
  }

  const edits = [];
  if (plansIdx !== -1) {
    const plansText = renderPlans(rowCells[plansIdx]);
    if (plansText !== null && plansText !== undefined) edits.push([plansIdx, plansText]);
  }
  if (statusIdx !== -1) {
    const statusText = renderStatus(rowCells[statusIdx]);
    if (statusText !== null && statusText !== undefined) edits.push([statusIdx, statusText]);
  }
  if (edits.length === 0) return { content, updated: false, reason: 'no cell change requested', header_columns: headerCells.length };

  const next = replaceTableRowCells(found, edits);
  return {
    content: next,
    updated: next !== content,
    column: statusIdx !== -1 ? statusIdx : plansIdx,
    header_columns: headerCells.length,
  };
}

// Rewrites the `**Plans:**` line of one phase section. The line may carry roadmap-author prose:
// only a count this command owns (TBD, "N plans", "N/M plans executed|complete") is replaced; prose
// keeps its text and gets the tally appended once, retargeted on later runs. Never crosses into
// another phase's section and never matches a longer phase number (phase 2 vs 20).
function retargetPhasePlansLine(roadmapContent, phaseEscaped, planCountText) {
  const planCountPattern = new RegExp(
    `(#{2,4}\\s*Phase\\s+${phaseEscaped}(?![\\d.])(?:(?!\\n#{2,4}\\s*Phase\\s)[\\s\\S])*?\\*\\*Plans:\\*\\*[ \\t]*)([^\\n]*)`,
    'i'
  );
  return roadmapContent.replace(planCountPattern, (_m, head, existing) => {
    const text = existing.trim();
    const owned = /^(?:\[?TBD\]?|\d+(?:\/(?:\d+|TBD))?\s+plans?(?:\s+(?:executed|complete|completed))?)$/i;
    const tally = /\b\d+\/(?:\d+|TBD)\s+plans?\s+(?:executed|complete|completed)\b/i;
    if (text === '' || owned.test(text)) return `${head}${planCountText}`;
    if (tally.test(text)) return `${head}${text.replace(tally, planCountText)}`;
    return `${head}${text} (${planCountText})`;
  });
}

function cmdRoadmapUpdatePlanProgress(cwd, phaseNum, raw) {
  if (!phaseNum) {
    error('phase number required for roadmap update-plan-progress');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo) {
    error(`Phase ${phaseNum} not found`);
  }

  const planCount = phaseInfo.plans.length;
  const summaryCount = phaseInfo.summaries.length;

  if (planCount === 0) {
    output({ updated: false, reason: 'No plans found', plan_count: 0, summary_count: 0 }, raw, 'no plans');
    return;
  }

  const isComplete = summaryCount >= planCount;
  // Executed is not verified: "Complete" and the checkbox wait for a passed {N}-VERIFICATION.md (written by the verifier).
  const verified = isComplete && phaseInfo.directory
    && readPhaseVerification(path.join(cwd, phaseInfo.directory), phaseInfo.phase_number).status === 'passed';
  const status = verified ? 'Complete' : isComplete ? 'Executed' : summaryCount > 0 ? 'In Progress' : 'Planned';
  const today = new Date().toISOString().split('T')[0];

  if (!fs.existsSync(roadmapPath)) {
    output({ updated: false, reason: 'ROADMAP.md not found', plan_count: planCount, summary_count: summaryCount }, raw, 'no roadmap');
    return;
  }

  let roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
  const phaseEscaped = phaseNum.replace('.', '\\.');

  // Progress table row: rewrite ONLY the progress/status cell, located by the
  // header row that governs it. Positional/fixed-column assumptions corrupted
  // rows in 3-, 4-, and 5-column layouts (wrote the count into the
  // Requirements or Flag cell and dropped the row's real status text); see the
  // Roadmap Progress-Table Row Rewriter block above.
  const progressToken = `${summaryCount}/${planCount}`;
  const tableResult = updateProgressTableRow(
    roadmapContent,
    phaseEscaped,
    (existing) => {
      const text = existing.trim();
      if (text === '') return `${status} (${progressToken} plans)`;
      // Retarget an existing tally in place; otherwise append one. The
      // lifecycle word is re-stated from disk (plans vs summaries), the prose
      // after it is the roadmap author's and is preserved verbatim.
      const lifecycle = text.match(/^(\W*)(not started|in progress|complete|completed|executed|planned|blocked)\b/i);
      const rest = (lifecycle ? text.slice(lifecycle[0].length) : text).trim();
      // Keep any markdown emphasis wrapping the lifecycle word, drop the word.
      const leadWithWord = lifecycle
        ? text.slice(0, lifecycle[0].length) + (text[lifecycle[0].length] === ' ' ? ' ' : '')
        : '';
      const leadPrefix = lifecycle ? lifecycle[1] : '';
      const sameWord = lifecycle && lifecycle[2].toLowerCase() === status.toLowerCase();
      const head = sameWord ? leadWithWord : `${leadPrefix}${status} `;
      if (rest === '') return `${head}(${progressToken} plans)`.trim();
      // Only a plan tally is this command's to retarget; any other N/M (a verification score "22/24") is the author's.
      const planTally = /\b\d+\s*\/\s*\d+\s+plans?\b/i;
      const retargeted = planTally.test(rest)
        ? rest.replace(planTally, `${progressToken} plans`)
        : `${rest} (${progressToken} plans)`;
      return `${head}${retargeted}`.trim();
    },
    (existing) => {
      const text = existing.trim();
      const tally = /\b\d+\s*(?:\/|of\s+)\s*(?:\d+|TBD)\b/i;
      if (tally.test(text)) return text.replace(tally, progressToken);
      return text === '' ? progressToken : `${progressToken} — ${text}`;
    },
  );
  roadmapContent = tableResult.content;
  const tableUpdated = tableResult.updated;
  const headerColumnCount = tableResult.header_columns ?? null;

  const planCountText = verified
    ? `${summaryCount}/${planCount} plans complete`
    : `${summaryCount}/${planCount} plans executed`;
  roadmapContent = retargetPhasePlansLine(roadmapContent, phaseEscaped, planCountText);

  // Only a verified phase gets its checkbox
  if (verified) {
    roadmapContent = roadmapBox.tickCheckbox(roadmapContent, phaseNum, ` (completed ${today})`);
  }

  atomicWriteFileSync(roadmapPath, roadmapContent);

  const tableFailed = !tableResult.updated && Boolean(tableResult.reason) && tableResult.reason !== 'no cell change requested';
  if (tableFailed) process.stderr.write(`Error: progress table row for phase ${phaseNum} not updated: ${tableResult.reason}\n`);
  output({
    updated: true,
    phase: phaseNum,
    plan_count: planCount,
    summary_count: summaryCount,
    table_update_skipped: tableResult.updated ? null : (tableResult.reason || null),
    status,
    complete: verified,
    executed: isComplete,
    pending_verification: isComplete && !verified,
    table_updated: tableUpdated,
    table_header_columns: headerColumnCount,
    ...(tableFailed ? { error: `progress table row for phase ${phaseNum} not updated: ${tableResult.reason}` } : {}),
  }, raw, `${summaryCount}/${planCount} ${status}`, tableFailed ? 1 : 0);
}

// ─── Requirements Mark Complete ───────────────────────────────────────────────

// Ticks the checkbox and the traceability row of each id in REQUIREMENTS.md; null when the file is absent.
function markRequirementsComplete(cwd, reqIds) {
  const reqPath = path.join(cwd, '.planning', 'REQUIREMENTS.md');
  if (!fs.existsSync(reqPath)) return null;

  let reqContent = fs.readFileSync(reqPath, 'utf-8');
  const updated = [];
  const notFound = [];

  for (const reqId of reqIds) {
    let found = false;

    // Update checkbox: - [ ] **REQ-ID** -> - [x] **REQ-ID**
    // Note: use separate regex instances for test vs replace to avoid g-flag lastIndex bug
    const checkboxRegex = `(-\\s*\\[)[ ](\\]\\s*\\*\\*${reqId}\\*\\*)`;
    if (new RegExp(checkboxRegex, 'gi').test(reqContent)) {
      reqContent = reqContent.replace(new RegExp(checkboxRegex, 'gi'), '$1x$2');
      found = true;
    }

    // Update traceability table: | REQ-ID | Phase N | Pending | -> | REQ-ID | Phase N | Complete |
    const tableRegex = `(\\|\\s*${reqId}\\s*\\|[^|]+\\|)\\s*Pending\\s*(\\|)`;
    if (new RegExp(tableRegex, 'gi').test(reqContent)) {
      reqContent = reqContent.replace(new RegExp(tableRegex, 'gi'), '$1 Complete $2');
      found = true;
    }

    if (found) {
      updated.push(reqId);
    } else {
      notFound.push(reqId);
    }
  }

  if (updated.length > 0) {
    fs.writeFileSync(reqPath, reqContent, 'utf-8');
  }
  return { updated, notFound };
}

function cmdRequirementsMarkComplete(cwd, reqIdsRaw, raw) {
  if (!reqIdsRaw || reqIdsRaw.length === 0) {
    error('requirement IDs required. Usage: requirements mark-complete REQ-01,REQ-02 or REQ-01 REQ-02');
  }

  // Accept comma-separated, space-separated, or bracket-wrapped: [REQ-01, REQ-02]
  const reqIds = reqIdsRaw
    .join(' ')
    .replace(/[\[\]]/g, '')
    .split(/[,\s]+/)
    .map(r => r.trim())
    .filter(Boolean);

  if (reqIds.length === 0) {
    error('no valid requirement IDs found');
  }

  const marked = markRequirementsComplete(cwd, reqIds);
  if (!marked) {
    output({ updated: false, reason: 'REQUIREMENTS.md not found', ids: reqIds }, raw, 'no requirements file');
    return;
  }
  const { updated, notFound } = marked;

  output({
    updated: updated.length > 0,
    marked_complete: updated,
    not_found: notFound,
    total: reqIds.length,
  }, raw, `${updated.length}/${reqIds.length} requirements marked complete`);
}

// ─── Phase truth + lifecycle checkpoint ───────────────────────────────────────

function roadmapCheckboxState(cwd, phaseNum) {
  const content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  if (content === null) return null;
  return roadmapBox.checkboxState(content, phaseNum);
}

// One definition of "this phase is complete": the shared on-disk evidence
// (SUMMARY + Self-Check, tagged commits, VERIFICATION passed) plus the ROADMAP
// checkbox that `phase complete` sets. A roadmap with no checkbox line cannot
// be checked and does not fail the phase.
function phaseTruth(cwd, phaseNum) {
  const phaseInfo = findPhaseInternal(cwd, String(phaseNum));
  if (!phaseInfo) return { phase: String(phaseNum), complete: false, errors: ['phase directory not found'] };
  if (normalizePhaseName(String(phaseInfo.phase_number)) !== normalizePhaseName(String(phaseNum))) {
    return { phase: String(phaseNum), complete: false, errors: [`phase directory not found (nearest match: ${phaseInfo.directory})`] };
  }
  const phaseDir = path.join(cwd, phaseInfo.directory);
  let dirFiles;
  try { dirFiles = fs.readdirSync(phaseDir); } catch (e) {
    return { phase: String(phaseNum), complete: false, errors: [`phase directory unreadable: ${e.message}`] };
  }
  const split = collectPhaseFormErrors(cwd, phaseInfo, phaseDir, dirFiles);
  const recordedDebt = Array.isArray(split.evidence.verification.data.form_debt) ? split.evidence.verification.data.form_debt : [];
  const workErrors = [...split.workErrors];
  // The unset checkbox only says `phase complete` has not run: it blocks completion but is not missing work, so a
  // form-only phase can be closed with `phase complete --form-debt` (roadmap record: complete_form_debt).
  const unchecked = roadmapCheckboxState(cwd, phaseNum) === false ? ['ROADMAP.md checkbox is not set (run `gsd-tools phase complete`)'] : [];
  // Form errors accepted by `phase complete --form-debt` are recorded debt, not missing work.
  const formErrors = recordedDebt.length > 0 ? [] : split.errors.map((f) => `${f.file}: ${f.check}: ${f.message}`);
  const errors = [...workErrors, ...unchecked, ...formErrors];
  return { phase: String(phaseNum), complete: errors.length === 0, errors, work_errors: workErrors, form_errors: formErrors, form_debt: recordedDebt };
}

// Form debt of every ROADMAP phase, read from VERIFICATION frontmatter (written by `phase complete --form-debt`).
function milestoneFormDebt(cwd) {
  const content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  if (content === null) return [];
  return parseRoadmapPhases(content, path.join(cwd, '.planning', 'phases'))
    .map((p) => ({ phase: dispatch.phaseKey(p.number), items: phaseTruth(cwd, dispatch.phaseKey(p.number)).form_debt || [] }))
    .filter((d) => d.items.length > 0);
}

const CHECKPOINT_STEPS = ['discuss', 'research', 'plan', 'execute', 'verify'];
const CHECKPOINT_STATUSES = ['complete', 'skipped', 'gray_areas_identified', 'failed', 'passed', 'gaps_found', 'human_needed'];

// The single writer of the phase CHECKPOINT.json (shape: agents/gsd-phase-coordinator.md
// checkpoint_protocol). `phase complete` reads it; execute-phase and the coordinator write it here.
function cmdPhaseCheckpoint(cwd, args, raw) {
  const phaseNum = args[0];
  if (!phaseNum || phaseNum.startsWith('--')) error('phase checkpoint: phase number required');
  const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
  const step = flag('--step');
  const status = flag('--status');
  if (!CHECKPOINT_STEPS.includes(step)) error(`phase checkpoint: --step must be one of ${CHECKPOINT_STEPS.join(', ')}`);
  if (!CHECKPOINT_STATUSES.includes(status)) error(`phase checkpoint: --status must be one of ${CHECKPOINT_STATUSES.join(', ')}`);
  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo || normalizePhaseName(String(phaseInfo.phase_number)) !== normalizePhaseName(String(phaseNum))) {
    error(`phase checkpoint: phase ${phaseNum} directory not found`);
  }
  const successful = ['complete', 'skipped', 'passed', 'gray_areas_identified'].includes(status);
  const resumeFrom = flag('--resume-from')
    || (step === 'verify' ? (status === 'passed' ? 'done' : 'verify')
      : (successful ? CHECKPOINT_STEPS[CHECKPOINT_STEPS.indexOf(step) + 1] : step));
  const files = flag('--files');
  const checkpoint = {
    phase: Number.isNaN(Number(phaseInfo.phase_number)) ? phaseInfo.phase_number : Number(phaseInfo.phase_number),
    phase_name: phaseInfo.phase_name || null,
    last_step: step,
    step_status: status,
    timestamp: new Date().toISOString(),
    files_touched: files ? files.split(',').map(f => f.trim()).filter(Boolean) : [],
    key_context: flag('--key-context') || '',
    resume_from: resumeFrom,
  };
  const target = path.join(cwd, phaseInfo.directory, 'CHECKPOINT.json');
  atomicWriteFileSync(target, JSON.stringify(checkpoint, null, 2) + '\n');
  output({ written: true, path: path.relative(cwd, target), ...checkpoint }, raw);
}

// ─── Phase Complete (Transition) ──────────────────────────────────────────────

function cmdPhaseComplete(cwd, phaseNum, raw, opts = {}) {
  if (!phaseNum) {
    error('phase number required for phase complete');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const today = new Date().toISOString().split('T')[0];

  // Verify phase info
  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo) {
    error(`Phase ${phaseNum} not found`);
  }

  const planCount = phaseInfo.plans.length;
  const summaryCount = phaseInfo.summaries.length;

  let formDebtItems = [];
  // ── Phase completeness pre-conditions ──────────────────────────────────────────
  // Refuse to mark phase complete unless all required artifacts are present and valid.
  // This prevents phases being marked done without a passing VERIFICATION.md.
  {
    // Resolve the phase dir from findPhaseInternal and refuse to proceed when it
    // is missing or resolves to a different phase (its prefix match maps "38"
    // onto "384-..."): a missing dir used to skip every check below.
    const phaseDirPath = path.join(cwd, phaseInfo.directory);
    if (normalizePhaseName(String(phaseInfo.phase_number)) !== normalizePhaseName(String(phaseNum))) {
      error(`Phase ${phaseNum} directory not found (nearest match: ${phaseInfo.directory}) — refusing to mark complete without on-disk evidence`);
    }
    let dirFiles;
    try { dirFiles = fs.readdirSync(phaseDirPath); } catch (e) {
      error(`Phase ${phaseNum} directory unreadable (${phaseInfo.directory}): ${e.message} — refusing to mark complete`);
    }
    {
      const completenessErrors = [];

      // 1-2. Shared on-disk evidence: SUMMARY + Self-Check PASSED per plan,
      // tagged commits per plan, {N}-VERIFICATION.md status passed.
      const open = collectPhaseFormErrors(cwd, phaseInfo, phaseDirPath, dirFiles);
      const formItems = open.errors.map((f) => `${f.file}: ${f.check}: ${f.message}`);
      // --form-debt accepts open form errors (never missing work) and records them in {N}-VERIFICATION.md.
      completenessErrors.push(...open.workErrors, ...(opts.formDebt ? [] : formItems));
      if (opts.formDebt && open.workErrors.length === 0) formDebtItems = formItems;

      // 3. CHECKPOINT.json must exist with last_step: verify
      const checkpointPath = path.join(phaseDirPath, 'CHECKPOINT.json');
      if (!fs.existsSync(checkpointPath)) {
        completenessErrors.push('CHECKPOINT.json not found — phase lifecycle must complete before marking done');
      } else {
        try {
          const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
          if (checkpoint.last_step !== 'verify') {
            completenessErrors.push(`CHECKPOINT.json last_step is ${checkpoint.last_step} — must be verify before phase complete`);
          }
        } catch { completenessErrors.push('CHECKPOINT.json is malformed — cannot verify phase lifecycle completion'); }
      }

      if (completenessErrors.length > 0) {
        const result = {
          error: 'Phase completeness validation failed',
          phase: phaseNum,
          validation_errors: completenessErrors,
          hint: 'Run the verifier first to create VERIFICATION.md with status: passed',
        };
        process.stdout.write(JSON.stringify(result, null, 2));
        process.exit(1);
      }
    }
  }

  // This phase's requirement ids: its ROADMAP section's `**Requirements:**` ids whose REQUIREMENTS traceability row names this phase (or has no row).
  let phaseReqIds = [];
  let requirementsMarked = [];
  if (fs.existsSync(roadmapPath) && fs.existsSync(path.join(cwd, '.planning', 'REQUIREMENTS.md'))) {
    const roadmapText = fs.readFileSync(roadmapPath, 'utf-8');
    const section = roadmapBox.phaseSection(roadmapText, phaseNum);
    if (section === null && roadmapBox.checkboxState(roadmapText, phaseNum) === null) error(`ROADMAP.md has no "### Phase ${phaseNum}" heading (plain or bold) and no checklist line: refusing to complete a phase whose requirements cannot be read`);
    if (section === null) process.stderr.write(`Notice: ROADMAP.md has no "### Phase ${phaseNum}" heading; no requirement was marked complete (the checklist line is ticked)\n`);
    const ids = section === null ? [] : [...new Set(((section.match(/\*\*Requirements:?\*\*:?\s*([^\n]*)/i) || [])[1] || '').match(/[A-Z][A-Z0-9]*-\d+/g) || [])];
    const reqPath = path.join(cwd, '.planning', 'REQUIREMENTS.md');
    const reqText = fs.readFileSync(reqPath, 'utf-8');
    const key = String(phaseNum).replace(/^0+(?=\d)/, '').replace(/\./g, '\\.');
    const ownsPhase = new RegExp(`(?<![\\d.])0*${key}(?!\\d|\\.\\d)`);
    phaseReqIds = ids.filter((id) => {
      const row = reqText.match(new RegExp(`^\\|\\s*${id}\\s*\\|([^|]*)\\|`, 'im'));
      return !row || ownsPhase.test(row[1]);
    });
  }

  if (formDebtItems.length > 0) {
    const vFile = path.join(cwd, phaseInfo.directory, `${phaseInfo.phase_number}-VERIFICATION.md`);
    const vText = fs.readFileSync(vFile, 'utf-8');
    const block = `form_debt:\n${formDebtItems.map((i) => `  - ${JSON.stringify(i)}`).join('\n')}\n`;
    const m = vText.match(/^---\n([\s\S]*?)\n---/);
    atomicWriteFileSync(vFile, m
      ? `---\n${m[1].replace(/^form_debt:\n(?:[ \t]+-.*\n?)*/m, '').replace(/\n*$/, '\n')}${block}---${vText.slice(m[0].length)}`
      : `---\n${block}---\n${vText}`);
  }

  // Update ROADMAP.md: mark phase complete
  if (fs.existsSync(roadmapPath)) {
    let roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');

    // The gates above passed: the requirement ids this phase owns are done.
    requirementsMarked = phaseReqIds.length > 0 ? ((markRequirementsComplete(cwd, phaseReqIds) || {}).updated || []) : [];

    // Checkbox: - [ ] Phase N: → - [x] Phase N: (...completed DATE), on the phase's own line only
    roadmapContent = roadmapBox.tickCheckbox(roadmapContent, phaseNum, ` (completed ${today})`);

    // Progress table: update ONLY the status cell, located by header name.
    // The previous regex hardcoded Status=column 3 / date=column 4, so on any
    // other layout it overwrote a Requirements or Flag cell and deleted the
    // row's real status text.
    const phaseEscaped = phaseNum.replace('.', '\\.');
    const tableResult = updateProgressTableRow(
      roadmapContent,
      phaseEscaped,
      (existing) => {
        const text = existing.trim();
        if (text === '') return `Complete (${today})`;
        const lifecycle = text.match(/^(\W*)(not started|in progress|complete|completed|executed|planned|blocked)\b/i);
        const rest = (lifecycle ? text.slice(lifecycle[0].length) : text).trim();
        const leadWithWord = lifecycle
          ? text.slice(0, lifecycle[0].length) + (text[lifecycle[0].length] === ' ' ? ' ' : '')
          : '';
        const leadPrefix = lifecycle ? lifecycle[1] : '';
        const sameWord = lifecycle && lifecycle[2].toLowerCase() === 'complete';
        const dated = /\d{4}-\d{2}-\d{2}/.test(text);
        return `${leadPrefix}${sameWord ? '' : 'Complete '}${rest}${dated ? '' : ` (completed ${today})`}`.trim();
      },
      null,
    );
    roadmapContent = tableResult.content;
    if (!tableResult.updated && tableResult.reason) {
      process.stderr.write(`[gsd] ROADMAP progress row for phase ${phaseNum} left untouched: ${tableResult.reason}\n`);
    }

    // Update plan count in phase section
    roadmapContent = retargetPhasePlansLine(roadmapContent, phaseEscaped, `${summaryCount}/${planCount} plans complete`);

    atomicWriteFileSync(roadmapPath, roadmapContent);
  }

  // Find next phase: the smallest phase number above the current one, from ROADMAP.md headings
  // (the authority) merged with phase directories (the directory spelling wins when both exist).
  let nextPhaseNum = null;
  let nextPhaseName = null;
  let isLastPhase = true;
  let totalPhases = null;

  {
    const candidates = new Map();
    const currentFloat = parseFloat(phaseNum);
    if (fs.existsSync(roadmapPath)) {
      const rm = fs.readFileSync(roadmapPath, 'utf-8');
      for (const m of rm.matchAll(/^#{2,4}\s*Phase\s+(\d+(?:\.\d+)?)\s*:\s*(.+?)\s*$/gim)) {
        candidates.set(parseFloat(m[1]), { num: m[1], name: m[2] });
      }
      totalPhases = candidates.size;
    }
    try {
      const dirs = fs.readdirSync(phasesDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
      for (const dir of dirs) {
        const dm = dir.match(/^(\d+(?:\.\d+)?)-?(.*)/);
        if (!dm) continue;
        const key = parseFloat(dm[1]);
        const prior = candidates.get(key);
        candidates.set(key, { num: dm[1], name: dm[2] || (prior && prior.name) || null });
      }
    } catch {}
    const next = [...candidates.keys()].filter(k => k > currentFloat).sort((x, y) => x - y)[0];
    if (next !== undefined) {
      nextPhaseNum = candidates.get(next).num;
      nextPhaseName = candidates.get(next).name;
      isLastPhase = false;
    }
  }

  // Update STATE.md
  if (fs.existsSync(statePath)) {
    let stateContent = fs.readFileSync(statePath, 'utf-8');
    const set = (field, value) => { stateContent = stateReplaceFieldTolerant(stateContent, field, value) || stateContent; };
    const phaseTotal = (stateContent.match(/^\s*Phase:\s*\d+(?:\.\d+)?\s+of\s+(\d+)/im) || [])[1] || totalPhases;

    // Bold-field STATE.md (unchanged behaviour)
    stateContent = stateContent.replace(
      /(\*\*Current Phase:\*\*\s*).*/,
      `$1${nextPhaseNum || phaseNum}`
    );
    if (nextPhaseName) {
      stateContent = stateContent.replace(
        /(\*\*Current Phase Name:\*\*\s*).*/,
        `$1${nextPhaseName.replace(/-/g, ' ')}`
      );
    }
    // Plain-prose STATE.md ("Phase: 2 of 4 (Name)")
    if (/^\s*Phase:\s*\d/im.test(stateContent)) {
      const label = nextPhaseName ? ` (${nextPhaseName.replace(/-/g, ' ')})` : '';
      set('Phase', `${nextPhaseNum || phaseNum}${phaseTotal ? ` of ${phaseTotal}` : ''}${label}`);
    }
    set('Status', isLastPhase ? 'Milestone complete' : 'Ready to plan');
    set('Current Plan', 'Not started');
    if (/^\s*Plan:/im.test(stateContent)) set('Plan', 'Not started');
    set('Last Activity', today);
    set('Last activity', today);
    set('Last Activity Description', `Phase ${phaseNum} complete${nextPhaseNum ? `, transitioned to Phase ${nextPhaseNum}` : ''}`);

    atomicWriteFileSync(statePath, stateContent);
  }

  {
    const key = dispatch.phaseKey(phaseNum);
    const b = phaseBudgetStatus(cwd, key, readExecutionEvents(cwd));
    appendEvent(cwd, { type: 'phase_complete', phase: key, budget_class: b.budget_class, wall_minutes_spent: b.wall_minutes_spent, dispatches_spent: b.dispatches_spent, total_wall_minutes: b.total_wall_minutes, total_dispatches: b.total_dispatches, budget_wall_minutes: b.budget_wall_minutes, pct: b.pct, warn: b.warn, breach: b.breach });
  }

  const result = {
    completed_phase: phaseNum,
    phase_name: phaseInfo.phase_name,
    plans_executed: `${summaryCount}/${planCount}`,
    next_phase: nextPhaseNum,
    next_phase_name: nextPhaseName,
    is_last_phase: isLastPhase,
    date: today,
    roadmap_updated: fs.existsSync(roadmapPath),
    ...(fs.existsSync(roadmapPath) && roadmapBox.checkboxState(fs.readFileSync(roadmapPath, 'utf-8'), phaseNum) === null ? { roadmap_checkbox_missing: `no checkbox line for phase ${phaseNum} in ROADMAP.md (expected "- [ ] Phase ${phaseNum}"): tick it by hand` } : {}),
    requirements_marked: requirementsMarked,
    state_updated: fs.existsSync(statePath),
    ...(formDebtItems.length > 0 ? { form_debt: formDebtItems } : {}),
  };

  output(result, raw);
}

// ─── Phase Size ───────────────────────────────────────────────────────────────

async function cmdPhaseSize(cwd, args, raw) {
  const subcommand = args[0];
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  // Helper to get phases from roadmap
  const getPhases = async () => {
    if (!fs.existsSync(roadmapPath)) {
      error('ROADMAP.md not found');
    }
    const { phases } = await parseRoadmap(roadmapPath);
    return phases;
  };

  switch (subcommand) {
    case 'limits': {
      // Display current limits
      output(PHASE_LIMITS, raw, Object.entries(PHASE_LIMITS)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'));
      break;
    }

    case 'estimate': {
      // Estimate size for a specific phase
      const phaseNum = parseInt(args[1]);
      if (!phaseNum) {
        error('phase size estimate: phase number required');
      }

      const phases = await getPhases();
      const phase = phases.find(p => p.number === phaseNum);
      if (!phase) {
        error(`Phase ${phaseNum} not found`);
      }

      const estimate = estimatePhaseSize(phase);
      output({
        phase: phaseNum,
        name: phase.name,
        ...estimate
      }, raw);
      break;
    }

    case 'check': {
      // Check all phases for size issues
      const phases = await getPhases();
      const oversized = detectOversizedPhases(phases);

      const result = {
        total_phases: phases.length,
        oversized_count: oversized.length,
        oversized: oversized.map(o => ({
          phase: o.phase,
          name: o.name,
          reasons: o.reasons
        }))
      };

      if (raw) {
        output(result, raw);
      } else {
        if (oversized.length === 0) {
          console.log('All phases within size limits');
        } else {
          console.log(`Found ${oversized.length} oversized phase(s):`);
          for (const o of oversized) {
            console.log(`\n  Phase ${o.phase}: ${o.name}`);
            for (const reason of o.reasons) {
              console.log(`    - ${reason}`);
            }
          }
        }
      }

      // Exit code: 0 if none oversized, 1 if any oversized
      process.exit(oversized.length > 0 ? 1 : 0);
    }

    case 'split-recommend': {
      // Get split recommendations for a phase
      const phaseNum = parseInt(args[1]);
      if (!phaseNum) {
        error('phase size split-recommend: phase number required');
      }

      const phases = await getPhases();
      const phase = phases.find(p => p.number === phaseNum);
      if (!phase) {
        error(`Phase ${phaseNum} not found`);
      }

      const recommendation = recommendSplit(phase);
      const validation = validateSplitPreservesDependencies(phase, recommendation.recommendations, phases);

      output({
        phase: phaseNum,
        name: phase.name,
        ...recommendation,
        dependency_validation: validation
      }, raw);
      break;
    }

    default: {
      // Show size estimates for all phases (table format)
      const phases = await getPhases();
      const phaseNum = subcommand ? parseInt(subcommand) : null;

      if (phaseNum) {
        // Single phase
        const phase = phases.find(p => p.number === phaseNum);
        if (!phase) {
          error(`Phase ${phaseNum} not found`);
        }
        const estimate = estimatePhaseSize(phase);
        output({
          phase: phaseNum,
          name: phase.name,
          ...estimate
        }, raw);
      } else {
        // All phases table
        const results = phases.map(p => {
          const est = estimatePhaseSize(p);
          return {
            phase: p.number,
            name: p.name.substring(0, 30),
            requirements: est.requirements,
            criteria: est.successCriteria,
            plans: est.estimatedPlans,
            tokens: est.estimatedTokens,
            risk: est.riskLevel
          };
        });

        if (raw) {
          output({ phases: results }, raw);
        } else {
          console.log('Phase | Name                           | Reqs | Criteria | Plans | Tokens  | Risk');
          console.log('------|--------------------------------|------|----------|-------|---------|------');
          for (const r of results) {
            console.log(`${String(r.phase).padEnd(5)} | ${r.name.padEnd(30)} | ${String(r.requirements).padStart(4)} | ${String(r.criteria).padStart(8)} | ${String(r.plans).padStart(5)} | ${String(r.tokens).padStart(7)} | ${r.risk}`);
          }
        }
      }
      break;
    }
  }
}

// ─── Phase Archive ────────────────────────────────────────────────────────────

async function cmdPhaseArchive(phaseNum, raw) {
  if (!phaseNum) {
    error('phase number required for phase archive');
  }

  const phaseNumber = parseInt(phaseNum);
  const archive = require('./phase-archive.js');

  try {
    const result = await archive.archivePhase(phaseNumber);
    output(result, raw);
  } catch (err) {
    error(`Failed to archive phase ${phaseNumber}: ${err.message}`);
  }
}

async function cmdPhaseInjectContext(_cwd, targetPhaseNum, raw) {
  if (!targetPhaseNum) {
    error('target phase number required for inject-context');
  }

  const targetPhase = parseInt(targetPhaseNum);
  const archive = require('./phase-archive.js');

  try {
    const context = await archive.injectRelevantContext(targetPhase);
    output(context, raw);
  } catch (err) {
    error(`Failed to inject context for phase ${targetPhase}: ${err.message}`);
  }
}

async function cmdPhaseCleanupCheckpoints(_cwd, phaseNum, raw) {
  if (!phaseNum) {
    error('phase number required for cleanup-checkpoints');
  }

  const phaseNumber = parseInt(phaseNum);
  const archive = require('./phase-archive.js');

  try {
    const result = await archive.cleanupEphemeralCheckpoints(phaseNumber);
    output(result, raw);
  } catch (err) {
    error(`Failed to cleanup checkpoints for phase ${phaseNumber}: ${err.message}`);
  }
}

// ─── Milestone Complete ───────────────────────────────────────────────────────

// Pure function -- no I/O. Does MILESTONES.md already contain an entry for
// this exact version? Prevents cmdMilestoneComplete's append from
// duplicating the milestone entry if the command is re-run after a crash
// between this write and a later step (MILE-28 crash-point audit finding).
function milestoneAlreadyRecorded(milestonesContent, version) {
  if (!milestonesContent || !version) return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Negative lookahead (not a plain \b) -- a plain word-boundary assertion
  // treats "." as a non-word char, so "v1.0" would falsely match a "v1.0.1"
  // heading (boundary fires right after the shared "v1.0" prefix). Requiring
  // the next character to be neither a word char NOR "." prevents a shorter
  // version from false-positive-matching a longer dotted version that
  // extends it, in either direction.
  const heading = new RegExp('^##\\s+' + escaped + '(?![\\w.])', 'm');
  return heading.test(milestonesContent);
}

// ─── Milestone Phase Scoping ────────────────────────────────────────────────
//
// Recurring bug (a consuming project's RETROSPECTIVE.md: v0.1.8, v0.1.20, v0.1.28,
// v0.1.29): cmdMilestoneComplete counted EVERY directory under
// .planning/phases/, including phase directories left over from prior
// milestones that were never archived away. This silently produced wildly
// inflated phase/plan/task counts in the auto-generated MILESTONES.md entry
// every single time it recurred (e.g. v0.1.29: 73 phases / 389 plans / 154
// tasks reported instead of the milestone's actual 10 phases / 46 plans),
// and had to be hand-corrected after the fact each time. v0.1.20's
// retrospective additionally found that the CLI dispatcher accepted a
// `--phases N-M` flag on `milestone complete` but silently dropped it before
// ever reaching this function.
//
// The fix scopes phase counting two ways, in priority order:
//   1. An explicit `--phases N-M` flag (now actually wired through by the
//      CLI dispatcher -- see the `case 'milestone':` branch below).
//   2. When no explicit range is given, phase numbers parsed directly out of
//      ROADMAP.md's own "### Phase N: ..." headings -- the current
//      milestone's own roadmap section, per this repo's own
//      templates/roadmap.md convention (confirmed against every real
//      ROADMAP.md this fork ships against: a completed milestone's
//      ROADMAP.md only ever lists that milestone's own phases before it is
//      reorganized/archived).
//
// It deliberately does NOT fall back to scanning every directory in
// .planning/phases/ when neither source is available -- that silent
// fallback is the exact defect being fixed, so resolveMilestonePhaseScope
// errors out (exit 1) instead, asking the operator to pass --phases
// explicitly rather than risk another silently-wrong MILESTONES.md entry.

// Pure function -- no I/O. Extracts phase-number strings (e.g. "338",
// "2.1", "3A") from ROADMAP.md "### Phase N: ..." headings.
function parseRoadmapPhaseNumbers(roadmapContent) {
  const nums = [];
  if (!roadmapContent) return nums;
  const phasePattern = /^#{2,4}\s*Phase\s+(\d+[A-Za-z]?(?:\.\d+)*)\s*:/gm;
  let m;
  while ((m = phasePattern.exec(roadmapContent)) !== null) {
    nums.push(m[1]);
  }
  return nums;
}

// Pure function -- no I/O. Builds a directory-name matcher for a set of
// phase-number strings. Handles leading zeros ("01" -> "1"), letter
// suffixes ("3A"/"3a"), decimal phases ("3.1"), and guards against prefix
// collisions ("1" must not match directory "10-scaling").
function buildMilestonePhaseMatcher(phaseNumbers) {
  const normalized = new Set(
    phaseNumbers.map(n => String(n).replace(/^0+(?=\d)/, '').toLowerCase())
  );
  return function isDirInMilestone(dirName) {
    const m = dirName.match(/^0*(\d+[A-Za-z]?(?:\.\d+)*)/);
    if (!m) return false; // not a phase directory (e.g. "notes/", "misc/")
    return normalized.has(m[1].toLowerCase());
  };
}

// Determines which .planning/phases/ directories belong to the milestone
// being completed. Returns { matcher, source, range } where matcher(dirName)
// is a predicate. Exits 1 (via error()) if scoping cannot be determined --
// see the block comment above for why this never falls back to "scan
// everything".
function resolveMilestonePhaseScope(cwd, options) {
  if (options.phases) {
    const pm = String(options.phases).match(/^(\d+)(?:-(\d+))?$/);
    if (!pm) {
      error(`--phases value "${options.phases}" is not a valid range (expected N or N-M, e.g. --phases 338-347)`);
    }
    const min = parseInt(pm[1], 10);
    const max = pm[2] ? parseInt(pm[2], 10) : min;
    return {
      source: 'explicit --phases flag',
      range: pm[2] ? `${min}-${max}` : String(min),
      matcher: function isDirInMilestone(dirName) {
        const dm = dirName.match(/^0*(\d+)/);
        if (!dm) return false;
        const n = parseInt(dm[1], 10);
        return n >= min && n <= max;
      },
    };
  }

  const roadmapPathForScope = path.join(cwd, '.planning', 'ROADMAP.md');
  let roadmapContentForScope = '';
  if (fs.existsSync(roadmapPathForScope)) {
    try { roadmapContentForScope = fs.readFileSync(roadmapPathForScope, 'utf-8'); } catch {}
  }
  const phaseNumbers = parseRoadmapPhaseNumbers(roadmapContentForScope);
  if (phaseNumbers.length === 0) {
    error(
      'milestone complete cannot determine which phases belong to this milestone: ' +
      'no --phases N-M flag was given and ROADMAP.md has no "### Phase N: ..." headings to derive it from. ' +
      'Re-run with an explicit --phases N-M (e.g. --phases 338-347) rather than risk counting every ' +
      'directory in .planning/phases/, including phases from prior milestones ' +
      '(see RETROSPECTIVE.md v0.1.8/v0.1.20/v0.1.28/v0.1.29).'
    );
  }
  return {
    source: 'ROADMAP.md "### Phase N:" headings',
    range: phaseNumbers.join(','),
    matcher: buildMilestonePhaseMatcher(phaseNumbers),
  };
}

function cmdMilestoneComplete(cwd, version, options, raw) {
  if (!version) {
    error('version required for milestone complete (e.g., v1.0)');
  }

  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const reqPath = path.join(cwd, '.planning', 'REQUIREMENTS.md');
  const statePath = path.join(cwd, '.planning', 'STATE.md');
  const milestonesPath = path.join(cwd, '.planning', 'MILESTONES.md');
  const archiveDir = path.join(cwd, '.planning', 'milestones');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const today = new Date().toISOString().split('T')[0];
  const milestoneName = options.name || version;

  // Ensure archive directory exists
  fs.mkdirSync(archiveDir, { recursive: true });

  // Gather stats from phases (scoped to this milestone only -- see the
  // "Milestone Phase Scoping" block comment above). Scoping is only
  // resolved (and only errors out on ambiguity) when there is actually at
  // least one phase directory on disk to scope -- an empty/absent
  // .planning/phases/ has nothing to over-count, so there is no ambiguity
  // to reject.
  let phaseScope = null;
  let phaseCount = 0;
  let totalPlans = 0;
  let totalTasks = 0;
  const accomplishments = [];

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    if (dirs.length > 0) {
      phaseScope = resolveMilestonePhaseScope(cwd, options);
    }

    for (const dir of dirs) {
      if (phaseScope && !phaseScope.matcher(dir)) continue;
      phaseCount++;
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
      totalPlans += plans.length;

      // Extract one-liners from summaries
      for (const s of summaries) {
        try {
          const content = fs.readFileSync(path.join(phasesDir, dir, s), 'utf-8');
          const fm = extractFrontmatter(content);
          if (fm['one-liner']) {
            accomplishments.push(fm['one-liner']);
          }
          // Count tasks
          const taskMatches = content.match(/##\s*Task\s*\d+/gi) || [];
          totalTasks += taskMatches.length;
        } catch {}
      }
    }
  } catch {}

  if (!phaseScope) {
    phaseScope = { source: 'no phase directories present', range: '' };
  }

  // Archive ROADMAP.md
  if (fs.existsSync(roadmapPath)) {
    const roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
    fs.writeFileSync(path.join(archiveDir, `${version}-ROADMAP.md`), roadmapContent, 'utf-8');
  }

  // Archive REQUIREMENTS.md
  if (fs.existsSync(reqPath)) {
    const reqContent = fs.readFileSync(reqPath, 'utf-8');
    const archiveHeader = `# Requirements Archive: ${version} ${milestoneName}\n\n**Archived:** ${today}\n**Status:** SHIPPED\n\nFor current requirements, see \`.planning/REQUIREMENTS.md\`.\n\n---\n\n`;
    fs.writeFileSync(path.join(archiveDir, `${version}-REQUIREMENTS.md`), archiveHeader + reqContent, 'utf-8');
  }

  // Archive audit file if exists
  const auditFile = path.join(cwd, '.planning', `${version}-MILESTONE-AUDIT.md`);
  if (fs.existsSync(auditFile)) {
    fs.renameSync(auditFile, path.join(archiveDir, `${version}-MILESTONE-AUDIT.md`));
  }

  // Create/append MILESTONES.md entry
  const accomplishmentsList = accomplishments.map(a => `- ${a}`).join('\n');
  const milestoneEntry = `## ${version} ${milestoneName} (Shipped: ${today})\n\n**Phases completed:** ${phaseCount} phases, ${totalPlans} plans, ${totalTasks} tasks\n\n**Key accomplishments:**\n${accomplishmentsList || '- (none recorded)'}\n\n---\n\n`;

  let milestonesAppended = true;
  if (fs.existsSync(milestonesPath)) {
    const existing = fs.readFileSync(milestonesPath, 'utf-8');
    if (milestoneAlreadyRecorded(existing, version)) {
      console.warn(`  Note: MILESTONES.md already has an entry for ${version} — skipping duplicate append (re-run detected).`);
      milestonesAppended = false;
    } else {
      fs.writeFileSync(milestonesPath, existing + '\n' + milestoneEntry, 'utf-8');
    }
  } else {
    fs.writeFileSync(milestonesPath, `# Milestones\n\n${milestoneEntry}`, 'utf-8');
  }

  // Update STATE.md
  if (fs.existsSync(statePath)) {
    let stateContent = fs.readFileSync(statePath, 'utf-8');
    stateContent = stateContent.replace(
      /(\*\*Status:\*\*\s*).*/,
      `$1${version} milestone complete`
    );
    stateContent = stateContent.replace(
      /(\*\*Last Activity:\*\*\s*).*/,
      `$1${today}`
    );
    stateContent = stateContent.replace(
      /(\*\*Last Activity Description:\*\*\s*).*/,
      `$1${version} milestone completed and archived`
    );
    atomicWriteFileSync(statePath, stateContent);
  }

  const result = {
    version,
    name: milestoneName,
    date: today,
    phases: phaseCount,
    plans: totalPlans,
    tasks: totalTasks,
    accomplishments,
    phase_scope: { source: phaseScope.source, range: phaseScope.range },
    archived: {
      roadmap: fs.existsSync(path.join(archiveDir, `${version}-ROADMAP.md`)),
      requirements: fs.existsSync(path.join(archiveDir, `${version}-REQUIREMENTS.md`)),
      audit: fs.existsSync(path.join(archiveDir, `${version}-MILESTONE-AUDIT.md`)),
    },
    milestones_updated: true,
    milestones_appended: milestonesAppended,
    state_updated: fs.existsSync(statePath),
  };

  output(result, raw);
}


// ─── Milestone Summarize ──────────────────────────────────────────────

/**
 * Generate a structured milestone summary document.
 *
 * Reads all phase directories (optionally filtered by phase range) and produces
 * {version}-SUMMARY.md in .planning/milestones/ containing:
 *   - one-liner per phase (from SUMMARY.md title/frontmatter)
 *   - total plan count and total duration
 *   - key decisions from STATE.md
 *
 * Idempotent: always overwrites the summary file if it already exists.
 *
 * CLI: gsd-tools milestone summarize <version> [--phases N-M]
 */
function cmdMilestoneSummarize(cwd, version, options, raw) {
  if (!version) {
    error('version required for milestone summarize (e.g., v1.11.0)');
  }

  var phasesDir = path.join(cwd, '.planning', 'phases');
  var archiveDir = path.join(cwd, '.planning', 'milestones');
  var statePath = path.join(cwd, '.planning', 'STATE.md');
  var today = new Date().toISOString().split('T')[0];

  fs.mkdirSync(archiveDir, { recursive: true });

  var phaseMin = null;
  var phaseMax = null;
  if (options.phases) {
    var pm = String(options.phases).match(/^(\d+)(?:-(\d+))?$/);
    if (pm) {
      phaseMin = parseInt(pm[1], 10);
      phaseMax = pm[2] ? parseInt(pm[2], 10) : phaseMin;
    }
  }

  var phaseRows = [];
  var totalPlans = 0;
  var totalDurationMin = 0;

  var phaseDirList = [];
  try {
    var phaseEntries = fs.readdirSync(phasesDir, { withFileTypes: true });
    phaseDirList = phaseEntries
      .filter(function(e) { return e.isDirectory(); })
      .map(function(e) { return e.name; })
      .filter(function(name) { return /^\d/.test(name); })
      .sort(function(a, b) {
        var na = parseInt(a.match(/^(\d+)/)[1], 10);
        var nb = parseInt(b.match(/^(\d+)/)[1], 10);
        return na - nb;
      });
  } catch (err) { /* no phases dir */ }

  for (var i = 0; i < phaseDirList.length; i++) {
    var dirName = phaseDirList[i];
    var phaseMatch = dirName.match(/^(\d+)/);
    if (!phaseMatch) continue;
    var phaseNum = parseInt(phaseMatch[1], 10);
    if (phaseMin !== null && phaseNum < phaseMin) continue;
    if (phaseMax !== null && phaseNum > phaseMax) continue;

    var phaseDir = path.join(phasesDir, dirName);
    var phaseFiles;
    try { phaseFiles = fs.readdirSync(phaseDir); } catch (e) { continue; }

    var summaryFiles = phaseFiles
      .filter(function(f) { return f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md'; })
      .sort();

    var phaseName = dirName.replace(/^\d+[-_.\s]*/, '').replace(/-/g, ' ') || dirName;
    var planCount = phaseFiles.filter(function(f) { return f.endsWith('-PLAN.md') || f === 'PLAN.md'; }).length;
    var phaseDurationMin = 0;
    var planOneLinerParts = [];

    for (var j = 0; j < summaryFiles.length; j++) {
      try {
        var sc = fs.readFileSync(path.join(phaseDir, summaryFiles[j]), 'utf-8');
        var sfm = extractFrontmatter(sc);
        var stitle = sfm['title'] || sfm['one-liner'] || sfm['name'] || '';
        if (stitle) planOneLinerParts.push(stitle);
        var durRaw = String(sfm['duration'] || '0');
        var durMatch = durRaw.match(/(\d+)/);
        if (durMatch) phaseDurationMin += parseInt(durMatch[1], 10);
      } catch (e) {}
    }

    if (planOneLinerParts.length === 0 && summaryFiles.length > 0) {
      try {
        var fc = fs.readFileSync(path.join(phaseDir, summaryFiles[0]), 'utf-8');
        var body = fc.replace(/^---[\s\S]+?---\n/, '');
        var h2m = body.match(/^##\s+(.+)$/m);
        if (h2m) planOneLinerParts.push(h2m[1].trim());
      } catch (e) {}
    }

    var oneLiner = planOneLinerParts.join('; ') || '(no summary)';
    totalPlans += planCount;
    totalDurationMin += phaseDurationMin;
    phaseRows.push({ phase: phaseNum, name: phaseName, plans: planCount, duration: phaseDurationMin, oneLiner: oneLiner });
  }

  var keyDecisions = '';
  if (fs.existsSync(statePath)) {
    try {
      var stateContent = fs.readFileSync(statePath, 'utf-8');
      var dm = stateContent.match(/###\s*Decisions\n([\s\S]*?)(?=\n###|\n##|$)/);
      if (dm) {
        var dBullets = dm[1].split('\n').filter(function(l) { return l.trim().startsWith('- ['); }).map(function(l) { return l.trim(); });
        if (dBullets.length > 0) keyDecisions = dBullets.join('\n');
      }
    } catch (e) {}
  }

  var tableRows = ['| Phase | Name | Plans | Duration | What was built |', '|-------|------|-------|----------|----------------|']
  for (var k = 0; k < phaseRows.length; k++) {
    var r = phaseRows[k];
    tableRows.push('| ' + r.phase + ' | ' + r.name + ' | ' + r.plans + ' | ' + r.duration + ' min | ' + r.oneLiner + ' |');
  }

  var docLines = [
    '# Milestone Summary: ' + version, '',
    '**Generated:** ' + today,
    '**Phases:** ' + phaseRows.length,
    '**Total plans:** ' + totalPlans,
    '**Total duration:** ' + totalDurationMin + ' min',
    '', '## Phases', '', tableRows.join('\n'),
    '', '## Stats', '',
    '- **Phases completed:** ' + phaseRows.length,
    '- **Total plans:** ' + totalPlans,
    '- **Total execution time:** ~' + totalDurationMin + ' min',
    '', '## Key Decisions', '',
    keyDecisions || '*(See STATE.md Decisions section for full list)*',
    '', '---',
    '*Generated by gsd-tools milestone summarize ' + version + ' on ' + today + '*',
    '',
  ];
  var summaryContent = docLines.join('\n');

  var summaryPath = path.join(archiveDir, version + '-SUMMARY.md');
  fs.writeFileSync(summaryPath, summaryContent, 'utf-8');

  output({ version: version, summary_path: summaryPath, phases: phaseRows.length, total_plans: totalPlans, total_duration_min: totalDurationMin, phase_range: phaseMin !== null ? (phaseMin + '-' + phaseMax) : 'all', written: true }, raw);
}

// ─── Milestone Archive Phases ────────────────────────────────────────

/**
 * Move completed phase directories to a milestone archive subfolder.
 *
 * A phase is considered complete when its directory contains a VERIFICATION.md.
 * Idempotent: phases already at the archive path are skipped.
 *
 * CLI: gsd-tools milestone archive-phases <version> [--phases N-M] [--dry-run]
 */
function cmdMilestoneArchivePhases(cwd, version, options, raw) {
  if (!version) {
    error('version required for milestone archive-phases (e.g., v1.11.0)');
  }

  var phasesDir = path.join(cwd, '.planning', 'phases');
  var archiveDir = path.join(cwd, '.planning', 'milestones', version, 'phases');
  var dryRun = options.dryRun || options['dry-run'] || false;

  var phaseMin = null;
  var phaseMax = null;
  if (options.phases) {
    var pm = String(options.phases).match(/^(\d+)(?:-(\d+))?$/);
    if (pm) {
      phaseMin = parseInt(pm[1], 10);
      phaseMax = pm[2] ? parseInt(pm[2], 10) : phaseMin;
    }
  }

  if (!dryRun) fs.mkdirSync(archiveDir, { recursive: true });

  var archived = [], skipped = [], errors = [];
  var phaseDirList = [];
  try {
    var phaseEntries = fs.readdirSync(phasesDir, { withFileTypes: true });
    phaseDirList = phaseEntries
      .filter(function(e) { return e.isDirectory(); })
      .map(function(e) { return e.name; })
      .filter(function(name) { return /^\d/.test(name); })
      .sort(function(a, b) {
        var na = parseInt(a.match(/^(\d+)/)[1], 10);
        var nb = parseInt(b.match(/^(\d+)/)[1], 10);
        return na - nb;
      });
  } catch (err) {
    error('Cannot read phases directory: ' + err.message);
  }

  for (var i = 0; i < phaseDirList.length; i++) {
    var dirName = phaseDirList[i];
    var phaseMatch = dirName.match(/^(\d+)/);
    if (!phaseMatch) continue;
    var phaseNum = parseInt(phaseMatch[1], 10);
    if (phaseMin !== null && phaseNum < phaseMin) continue;
    if (phaseMax !== null && phaseNum > phaseMax) continue;

    var sourcePath = path.join(phasesDir, dirName);
    var targetPath = path.join(archiveDir, dirName);

    var hasVerification =
      fs.existsSync(path.join(sourcePath, phaseNum + '-VERIFICATION.md')) ||
      fs.existsSync(path.join(sourcePath, 'VERIFICATION.md'));

    if (!hasVerification) {
      skipped.push({ dir: dirName, reason: 'no VERIFICATION.md (incomplete phase)' });
      continue;
    }
    if (fs.existsSync(targetPath)) {
      skipped.push({ dir: dirName, reason: 'already archived' });
      continue;
    }

    if (dryRun) {
      archived.push({ dir: dirName, from: sourcePath, to: targetPath, dry_run: true });
    } else {
      try {
        fs.renameSync(sourcePath, targetPath);
        archived.push({ dir: dirName, from: sourcePath, to: targetPath });
      } catch (err) {
        errors.push({ dir: dirName, error: err.message });
      }
    }
  }

  output({ version: version, archive_path: archiveDir, dry_run: dryRun, archived: archived, skipped: skipped, errors: errors, counts: { archived: archived.length, skipped: skipped.length, errors: errors.length } }, raw);
}

// ─── Validate Consistency ─────────────────────────────────────────────────────

function cmdValidateConsistency(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const errors = [];
  const warnings = [];

  // Check for ROADMAP
  if (!fs.existsSync(roadmapPath)) {
    errors.push('ROADMAP.md not found');
    output({ passed: false, errors, warnings }, raw, 'failed');
    return;
  }

  const roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');

  // Extract phases from ROADMAP
  const roadmapPhases = new Set();
  const phasePattern = /###\s*Phase\s+(\d+(?:\.\d+)?)\s*:/gi;
  let m;
  while ((m = phasePattern.exec(roadmapContent)) !== null) {
    roadmapPhases.add(m[1]);
  }

  // Get phases on disk
  const diskPhases = new Set();
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    for (const dir of dirs) {
      const dm = dir.match(/^(\d+(?:\.\d+)?)/);
      if (dm) diskPhases.add(dm[1]);
    }
  } catch {}

  // Check: phases in ROADMAP but not on disk
  for (const p of roadmapPhases) {
    if (!diskPhases.has(p) && !diskPhases.has(normalizePhaseName(p))) {
      warnings.push(`Phase ${p} in ROADMAP.md but no directory on disk`);
    }
  }

  // Check: phases on disk but not in ROADMAP
  for (const p of diskPhases) {
    const unpadded = String(parseInt(p, 10));
    if (!roadmapPhases.has(p) && !roadmapPhases.has(unpadded)) {
      warnings.push(`Phase ${p} exists on disk but not in ROADMAP.md`);
    }
  }

  // Check: sequential phase numbers (integers only)
  const integerPhases = [...diskPhases]
    .filter(p => !p.includes('.'))
    .map(p => parseInt(p, 10))
    .sort((a, b) => a - b);

  for (let i = 1; i < integerPhases.length; i++) {
    if (integerPhases[i] !== integerPhases[i - 1] + 1) {
      warnings.push(`Gap in phase numbering: ${integerPhases[i - 1]} → ${integerPhases[i]}`);
    }
  }

  // Check: plan numbering within phases
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dir of dirs) {
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md')).sort();

      // Extract plan numbers
      const planNums = plans.map(p => {
        const pm = p.match(/-(\d{2})-PLAN\.md$/);
        return pm ? parseInt(pm[1], 10) : null;
      }).filter(n => n !== null);

      for (let i = 1; i < planNums.length; i++) {
        if (planNums[i] !== planNums[i - 1] + 1) {
          warnings.push(`Gap in plan numbering in ${dir}: plan ${planNums[i - 1]} → ${planNums[i]}`);
        }
      }

      // Check: plans without summaries (completed plans)
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md'));
      const planIds = new Set(plans.map(p => p.replace('-PLAN.md', '')));
      const summaryIds = new Set(summaries.map(s => s.replace('-SUMMARY.md', '')));

      // Summary without matching plan is suspicious
      for (const sid of summaryIds) {
        if (!planIds.has(sid)) {
          warnings.push(`Summary ${sid}-SUMMARY.md in ${dir} has no matching PLAN.md`);
        }
      }
    }
  } catch {}

  // Check: frontmatter in plans has required fields
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    for (const dir of dirs) {
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md'));

      for (const plan of plans) {
        const content = fs.readFileSync(path.join(phasesDir, dir, plan), 'utf-8');
        const fm = extractFrontmatter(content);

        if (!fm.wave) {
          warnings.push(`${dir}/${plan}: missing 'wave' in frontmatter`);
        }
      }
    }
  } catch {}

  const passed = errors.length === 0;
  output({ passed, errors, warnings, warning_count: warnings.length }, raw, passed ? 'passed' : 'failed');
}

// ─── Progress Render ──────────────────────────────────────────────────────────

function cmdProgressRender(cwd, format, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const milestone = getMilestoneInfo(cwd);

  const phases = [];
  let totalPlans = 0;
  let totalSummaries = 0;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => {
      const aNum = parseFloat(a.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      const bNum = parseFloat(b.match(/^(\d+(?:\.\d+)?)/)?.[1] || '0');
      return aNum - bNum;
    });

    for (const dir of dirs) {
      const dm = dir.match(/^(\d+(?:\.\d+)?)-?(.*)/);
      const phaseNum = dm ? dm[1] : dir;
      const phaseName = dm && dm[2] ? dm[2].replace(/-/g, ' ') : '';
      const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md').length;
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').length;

      totalPlans += plans;
      totalSummaries += summaries;

      let status;
      if (plans === 0) status = 'Pending';
      else if (summaries >= plans) status = 'Complete';
      else if (summaries > 0) status = 'In Progress';
      else status = 'Planned';

      phases.push({ number: phaseNum, name: phaseName, plans, summaries, status });
    }
  } catch {}

  const percent = totalPlans > 0 ? Math.round((totalSummaries / totalPlans) * 100) : 0;

  if (format === 'table') {
    // Render markdown table
    const barWidth = 10;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    let out = `# ${milestone.version} ${milestone.name}\n\n`;
    out += `**Progress:** [${bar}] ${totalSummaries}/${totalPlans} plans (${percent}%)\n\n`;
    out += `| Phase | Name | Plans | Status |\n`;
    out += `|-------|------|-------|--------|\n`;
    for (const p of phases) {
      out += `| ${p.number} | ${p.name} | ${p.summaries}/${p.plans} | ${p.status} |\n`;
    }
    output({ rendered: out }, raw, out);
  } else if (format === 'bar') {
    const barWidth = 20;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    const text = `[${bar}] ${totalSummaries}/${totalPlans} plans (${percent}%)`;
    output({ bar: text, percent, completed: totalSummaries, total: totalPlans }, raw, text);
  } else {
    // JSON format
    output({
      milestone_version: milestone.version,
      milestone_name: milestone.name,
      phases,
      total_plans: totalPlans,
      total_summaries: totalSummaries,
      percent,
    }, raw);
  }
}

// ─── Todo Complete ────────────────────────────────────────────────────────────

function cmdTodoComplete(cwd, filename, raw) {
  if (!filename) {
    error('filename required for todo complete');
  }

  const pendingDir = path.join(cwd, '.planning', 'todos', 'pending');
  const completedDir = path.join(cwd, '.planning', 'todos', 'completed');
  const sourcePath = path.join(pendingDir, filename);

  if (!fs.existsSync(sourcePath)) {
    error(`Todo not found: ${filename}`);
  }

  // Ensure completed directory exists
  fs.mkdirSync(completedDir, { recursive: true });

  // Read, add completion timestamp, move
  let content = fs.readFileSync(sourcePath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];
  content = `completed: ${today}\n` + content;

  fs.writeFileSync(path.join(completedDir, filename), content, 'utf-8');
  fs.unlinkSync(sourcePath);

  output({ completed: true, file: filename, date: today }, raw, 'completed');
}

// ─── Scaffold ─────────────────────────────────────────────────────────────────

function cmdScaffold(cwd, type, options, raw) {
  const { phase, name } = options;
  const padded = phase ? normalizePhaseName(phase) : '00';
  const today = new Date().toISOString().split('T')[0];

  // Find phase directory
  const phaseInfo = phase ? findPhaseInternal(cwd, phase) : null;
  const phaseDir = phaseInfo ? path.join(cwd, phaseInfo.directory) : null;

  if (phase && !phaseDir && type !== 'phase-dir') {
    error(`Phase ${phase} directory not found`);
  }

  let filePath, content;

  switch (type) {
    case 'context': {
      filePath = path.join(phaseDir, `${padded}-CONTEXT.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — Context\n\n## Decisions\n\n_Decisions will be captured during /gsd:discuss-phase ${phase}_\n\n## Discretion Areas\n\n_Areas where the executor can use judgment_\n\n## Deferred Ideas\n\n_Ideas to consider later_\n`;
      break;
    }
    case 'uat': {
      filePath = path.join(phaseDir, `${padded}-UAT.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — User Acceptance Testing\n\n## Test Results\n\n| # | Test | Status | Notes |\n|---|------|--------|-------|\n\n## Summary\n\n_Pending UAT_\n`;
      break;
    }
    case 'verification': {
      filePath = path.join(phaseDir, `${padded}-VERIFICATION.md`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} — Verification\n\n## Goal-Backward Verification\n\n**Phase Goal:** [From ROADMAP.md]\n\n## Checks\n\n| # | Requirement | Status | Evidence |\n|---|------------|--------|----------|\n\n## Result\n\n_Pending verification_\n`;
      break;
    }
    case 'phase-dir': {
      if (!phase || !name) {
        error('phase and name required for phase-dir scaffold');
      }
      const slug = generateSlugInternal(name);
      const truncatedSlug = slug.slice(0, 60).replace(/-+$/, '');
      const dirName = `${padded}-${truncatedSlug}`;
      const phasesParent = path.join(cwd, '.planning', 'phases');
      fs.mkdirSync(phasesParent, { recursive: true });
      const dirPath = path.join(phasesParent, dirName);
      fs.mkdirSync(dirPath, { recursive: true });
      output({ created: true, directory: `.planning/phases/${dirName}`, path: dirPath }, raw, dirPath);
      return;
    }
    default:
      error(`Unknown scaffold type: ${type}. Available: context, uat, verification, phase-dir`);
  }

  if (fs.existsSync(filePath)) {
    output({ created: false, reason: 'already_exists', path: filePath }, raw, 'exists');
    return;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  const relPath = path.relative(cwd, filePath);
  output({ created: true, path: relPath }, raw, relPath);
}

// ─── Compound Commands ────────────────────────────────────────────────────────

// ruling_model / ruling_model_fallback for every init output; an invalid models.top exits 1.
function topModelFields(cwd) {
  const t = topModel.resolveTop(cwd);
  if (!t.ok) error(t.error);
  if (t.legacy && !topModelFields.noticed) { topModelFields.noticed = true; process.stderr.write('Notice: config ruling_model is legacy; set models.top\n'); }
  return { ruling_model: t.top, ruling_model_fallback: t.fallback };
}

// plan_stamp / plans_stale for init plan-phase. Unexecuted plans without a stamp are never stale (one notice).
function planStampFields(cwd, phase) {
  const info = findPhaseInternal(cwd, phase);
  const dir = info ? path.join(cwd, info.directory) : null;
  const current = planStamp.compute(cwd, phase, dir);
  const st = dir ? planStamp.staleness(dir, info.incomplete_plans, current) : { plans_stale: false, unstamped: [] };
  if (st.unstamped.length > 0) process.stderr.write(`Notice: ${st.unstamped.join(', ')} carry no plan_stamp; staleness cannot be checked for them\n`);
  return { plan_stamp: current.stamp, plans_stale: st.plans_stale };
}

// phase_risk_domains from the ROADMAP **Risk domains** line (comma list of configured names, or none); a missing line
// falls back to configured names found in the phase goal/requirements; both cases print one notice.
const riskNoticed = new Set();
function phaseRiskFields(cwd, phase) {
  const r = rigour.phaseRiskDomains(cwd, phase, projectContext.riskDomainsFor(cwd));
  const note = (msg) => { const k = `${cwd}:${phase}:${msg}`; if (!riskNoticed.has(k)) { riskNoticed.add(k); process.stderr.write(`Notice: phase ${phase} ${msg}\n`); } };
  if (r.derived) note(`has no **Risk domains:** line; matched from goal/requirements: ${r.domains.join(', ') || 'none'}`);
  if (r.unknown.length > 0) note(`**Risk domains:** names not in the project's risk_domains are ignored: ${r.unknown.join(', ')}`);
  return { phase_risk_domains: r.domains };
}

// The one rule for the risk-domain add-ons (references/rigour.md): a standard phase that declares risk domains.
// Prose and the budget class key on this value only.
function riskAddons(cwd, phase, level) {
  return level !== 'spike' && (phaseRiskFields(cwd, phase).phase_risk_domains.length > 0);
}

function initRiskFields(cwd, phase) {
  const level = rigour.resolveRigour(cwd, phase, getMilestoneInfo(cwd).version).rigour;
  const addons = riskAddons(cwd, phase, level);
  return { risk_addons: addons, ...phaseBudget.budgetFields(cwd, phaseBudget.budgetClass({ rigour: level, riskAddons: addons })) };
}

const TOP_ROLES = new Set(['gsd-planner', 'gsd-verifier']);
function resolveModelInternal(cwd, agentType) {
  if (TOP_ROLES.has(agentType)) return topModelFields(cwd).ruling_model;
  return ROLE_MODELS[agentType] || 'sonnet';
}

// At spike the executor is the investigator: executor_model (haiku) is raised to sonnet.
function executorModelFor(cwd, phase) {
  const model = resolveModelInternal(cwd, 'gsd-executor');
  const spike = rigour.resolveRigour(cwd, phase, getMilestoneInfo(cwd).version).rigour === 'spike';
  return spike && model === 'haiku' ? 'sonnet' : model;
}

function findPhaseInternal(cwd, phase) {
  if (!phase) return null;

  const phasesDir = path.join(cwd, '.planning', 'phases');
  const normalized = normalizePhaseName(phase);

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    // Match both 'NN-name' and 'phase-NN-name' directory conventions
    // Exact phase number: "2" never resolves 02.1-x or 20-x. A non-numeric argument keeps the prefix match.
    const numeric = /^\d/.test(String(phase));
    const numberOf = d => { const m = d.match(/^(?:phase-)?(\d+(?:\.\d+)?)(?:-|$)/); return m ? normalizePhaseName(m[1]) : null; };
    const match = numeric
      ? dirs.find(d => numberOf(d) === normalized)
      : dirs.find(d => d.startsWith(normalized) || d.startsWith('phase-' + normalized + '-') || d === 'phase-' + normalized);
    if (!match) return null;

    const dirMatch = match.match(/^(?:phase-)?(\d+(?:\.\d+)?)-?(.*)/);
    const phaseNumber = dirMatch ? dirMatch[1] : normalized;
    const rawName = dirMatch && dirMatch[2] ? dirMatch[2] : null;
    // Strip leading 'phase-' artifact if present (shouldn't be after regex fix, but safety net)
    const phaseName = rawName ? rawName.replace(/^phase-/, '') : null;
    const phaseDir = path.join(phasesDir, match);
    const phaseFiles = fs.readdirSync(phaseDir);

    // Require a 2-digit plan number before -PLAN.md (or the legacy bare
    // PLAN.md) so artifact files like E2E-TEST-PLAN.md are not miscounted as
    // task plans or flagged as incomplete. Mirrors the phase-gate pattern.
    const plans = phaseFiles.filter(f => f.match(/-\d{2}-PLAN\.md$/i) || f === 'PLAN.md').sort();
    const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md').sort();
    const hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');
    const hasContext = phaseFiles.some(f => f.endsWith('-CONTEXT.md') || f === 'CONTEXT.md');
    const hasVerification = phaseFiles.some(f => f.endsWith('-VERIFICATION.md') || f === 'VERIFICATION.md');

    // Determine incomplete plans (plans without matching summaries)
    const completedPlanIds = new Set(
      summaries.map(s => s.replace('-SUMMARY.md', '').replace('SUMMARY.md', ''))
    );
    const incompletePlans = plans.filter(p => {
      const planId = p.replace('-PLAN.md', '').replace('PLAN.md', '');
      return !completedPlanIds.has(planId);
    });

    return {
      found: true,
      directory: path.join('.planning', 'phases', match),
      phase_number: phaseNumber,
      phase_name: phaseName,
      phase_slug: phaseName ? phaseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : null,
      plans,
      summaries,
      incomplete_plans: incompletePlans,
      has_research: hasResearch,
      has_context: hasContext,
      has_verification: hasVerification,
    };
  } catch {
    return null;
  }
}

// Derives the set of files a phase actually touched, purely from git history
// (log --grep + diff-tree) -- never from PLAN.md `files_modified` or SUMMARY.md
// `key-files`, which are self-reported and exactly what MILE-06/phase-gate must
// be independent of. Shared by cmdVerifyPhaseGate (45-01) and HAS_UI detection
// (45-02).
//
// `plans` is an array of { file, fm, content, planNum } objects for the phase's
// *-PLAN.md files (planNum e.g. "01"). Returns { files: [...unique paths],
// warnings: [...] } where warnings flag plans with zero matching commits, plus
// optional cross-check warnings when a plan's self-reported files_modified
// disagrees with the real diff (informational only -- never affects `files`).
// ERE matching the {phase}-{plan} tag as a whole token: "83-01" must not match
// "383-01", "09-01" must not match a date like 2026-09-01, and a decimal
// phase's "." is literal.
function planTagGrepPattern(phaseNumber, planNum) {
  const esc = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `(^|[^0-9.-])${esc(phaseNumber)}-${esc(planNum)}([^0-9]|$)`;
}

function collectPhaseTouchedFiles(cwd, phaseNumber, plans) {
  const fileSet = new Set();
  const warnings = [];
  const filesByPlan = {};

  for (const plan of plans || []) {
    const planNum = plan.planNum || (plan.fm && plan.fm.plan);
    if (!planNum) continue;

    const logResult = execGit(cwd, ['log', '--oneline', '--all', '-E', '--grep', planTagGrepPattern(phaseNumber, planNum)]);
    const commitLines = (logResult.stdout || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (commitLines.length === 0) {
      warnings.push({ plan: planNum, warning: 'no_commits_found' });
      continue;
    }

    const planFiles = new Set();
    for (const line of commitLines) {
      const hash = line.split(/\s+/)[0];
      if (!hash) continue;
      // --root is required so root commits (no parent -- common in small test
      // fixtures and possible for a repo's very first tagged commit) are
      // diffed against the empty tree instead of silently producing zero
      // file paths (git diff-tree's default behavior for parentless commits).
      const diffResult = execGit(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', hash]);
      const filePaths = (diffResult.stdout || '')
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0);
      for (const f of filePaths) {
        fileSet.add(f);
        planFiles.add(f);
      }
    }

    // Optional cross-check (informational only -- never affects the returned
    // `files` array): flag when a plan's self-reported files_modified claims a
    // file that never showed up in the real diff for that plan's commits.
    const claimedFiles = plan.fm && Array.isArray(plan.fm.files_modified)
      ? plan.fm.files_modified
      : (plan.fm && plan.fm.files_modified ? [String(plan.fm.files_modified)] : []);
    // A claimed directory (trailing `/`, or a directory on disk) is satisfied by any diffed file under it.
    const isDirClaim = (c) => {
      if (/\/$/.test(c)) return true;
      try { return fs.statSync(path.join(cwd, c)).isDirectory(); } catch { return false; }
    };
    const underDir = (c) => { const d = c.replace(/\/+$/, '') + '/'; return [...planFiles].some((f) => f.startsWith(d)); };
    for (const claimed of claimedFiles) {
      if (!planFiles.has(claimed) && !(isDirClaim(claimed) && underDir(claimed))) {
        warnings.push({ plan: planNum, warning: 'claimed_file_not_in_diff', file: claimed });
      }
    }

    // Additive (Phase 46-03): per-plan file breakdown, used by
    // computeTestContentCoverage to scope test files to the plan(s) that
    // actually declare a given requirement -- existing callers destructure
    // only { files, warnings } and are unaffected by this new key.
    filesByPlan[planNum] = [...planFiles];
  }

  return { files: [...fileSet], warnings, filesByPlan };
}

function pathExistsInternal(cwd, targetPath) {
  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);
  try {
    fs.statSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

function generateSlugInternal(text) {
  if (!text) return null;
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getMilestoneInfo(cwd) {
  try {
    const roadmap = fs.readFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), 'utf-8');
    // Match all "**vX.Y.Z Name**" entries (from the ## Milestones bullet list)
    const entries = [...roadmap.matchAll(MILESTONE_ENTRY_RE)];
    if (entries.length > 0) {
      const last = entries[entries.length - 1];
      return { version: 'v' + last[1], name: last[2].trim() };
    }
    // Fallback: version only
    const versionMatch = roadmap.match(/v(\d+\.\d+[\d.]*)/);
    return { version: versionMatch ? versionMatch[0] : 'v1.0', name: 'milestone' };
  } catch {
    return { version: 'v1.0', name: 'milestone' };
  }
}

// Relative paths of the planning files an init caller hands to spawned agents; null when absent.
function initFilePaths(cwd, phaseInfo) {
  const ifExists = (rel) => (pathExistsInternal(cwd, rel) ? rel : null);
  const inPhase = (suffix) => {
    if (!phaseInfo?.directory) return null;
    try {
      const f = fs.readdirSync(path.join(cwd, phaseInfo.directory)).find(n => n.endsWith(`-${suffix}.md`) || n === `${suffix}.md`);
      return f ? path.join(phaseInfo.directory, f) : null;
    } catch { return null; }
  };
  return {
    state_path: ifExists('.planning/STATE.md'),
    roadmap_path: ifExists('.planning/ROADMAP.md'),
    requirements_path: ifExists('.planning/REQUIREMENTS.md'),
    config_path: ifExists('.planning/config.json'),
    context_path: inPhase('CONTEXT'),
    research_path: inPhase('RESEARCH'),
    verification_path: inPhase('VERIFICATION'),
    uat_path: inPhase('UAT'),
  };
}

function cmdInitExecutePhase(cwd, phase, includes, raw, gate) {
  if (!phase) {
    error('phase required for init execute-phase');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);
  const milestone = getMilestoneInfo(cwd);

  const result = {
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    project_context: { legacy: gate?.legacy === true },
    ...rigour.resolveRigour(cwd, phase, getMilestoneInfo(cwd).version),
    phase_req_ids: rigour.phaseReqIds(cwd, phase),
    ...phaseRiskFields(cwd, phase),
    ...initRiskFields(cwd, phase),

    // Models
    executor_model: executorModelFor(cwd, phase),
    verifier_model: resolveModelInternal(cwd, 'gsd-verifier'),
    // The final phase review and rulings run on the configured top model (models.top).
    ...topModelFields(cwd),
    utility_model: readRawConfig(cwd).utility_model || 'haiku',
    reviewer_model: readRawConfig(cwd).reviewer_model || 'sonnet',
    base_branch: resolveBaseBranch(cwd),
    ui_qa_mode: projectContext.uiQaMode(cwd),

    // Config flags
    commit_docs: config.commit_docs,
    parallelization: config.parallelization,
    branching_strategy: config.branching_strategy,
    phase_branch_template: config.phase_branch_template,
    milestone_branch_template: config.milestone_branch_template,
    verifier_enabled: config.verifier,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || null,

    // Plan inventory
    plans: phaseInfo?.plans || [],
    summaries: phaseInfo?.summaries || [],
    incomplete_plans: phaseInfo?.incomplete_plans || [],
    plan_count: phaseInfo?.plans?.length || 0,
    incomplete_count: phaseInfo?.incomplete_plans?.length || 0,

    // Branch name (pre-computed)
    branch_name: config.branching_strategy === 'phase' && phaseInfo
      ? config.phase_branch_template
          .replace('{phase}', phaseInfo.phase_number)
          .replace('{slug}', phaseInfo.phase_slug || 'phase')
      : config.branching_strategy === 'milestone'
        ? config.milestone_branch_template
            .replace('{milestone}', milestone.version)
            .replace('{slug}', generateSlugInternal(milestone.name) || 'milestone')
        : null,

    // Milestone info
    milestone_version: milestone.version,
    milestone_name: milestone.name,
    milestone_slug: generateSlugInternal(milestone.name),

    // File existence
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    config_exists: pathExistsInternal(cwd, '.planning/config.json'),
    ...initFilePaths(cwd, phaseInfo),
  };

  // Include file contents if requested via --include
  if (includes.has('state')) {
    result.state_content = safeReadFile(path.join(cwd, '.planning', 'STATE.md'));
  }
  if (includes.has('config')) {
    result.config_content = safeReadFile(path.join(cwd, '.planning', 'config.json'));
  }
  if (includes.has('roadmap')) {
    result.roadmap_content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  }

  // Circuit breaker execution gate (Gap 1: circuit breaker -> init execute-phase wiring)
  if (circuitBreaker && circuitBreaker.checkExecution) {
    try {
      result.circuit_breaker = circuitBreaker.checkExecution(
        phaseInfo?.phase_slug || phase,
        result.executor_model,
        0
      );
    } catch (e) {
      result.circuit_breaker = { proceed: true, reason: 'check_error' };
    }
  } else {
    result.circuit_breaker = null;
  }

  output(result, raw);
}

// Name/slug/number for a phase whose directory does not exist yet, taken from
// the ROADMAP "### Phase N: Name" header, so callers can mkdir the target dir.
function roadmapPhaseFallback(cwd, phase) {
  const normalized = normalizePhaseName(phase);
  const number = normalized.match(/^\d+(?:\.\d+)?/)?.[0];
  if (!number) return null;
  const content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  if (!content) return null;
  const escaped = number.replace(/^0+(?=\d)/, '').replace(/\./g, '\\.');
  const header = content.match(new RegExp(`###\\s*Phase\\s+0*${escaped}:\\s*([^\\n]+)`, 'i'));
  if (!header) return null;
  const name = header[1].trim();
  const slug = generateSlugInternal(name);
  return { phase_number: number, phase_name: name, phase_slug: slug, directory: path.join('.planning', 'phases', `${number.padStart(2, '0')}-${slug}`) };
}

function cmdInitPlanPhase(cwd, phase, includes, raw, gate) {
  if (!phase) {
    error('phase required for init plan-phase');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);
  const planned = phaseInfo ? null : roadmapPhaseFallback(cwd, phase);

  const result = {
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    project_context: { legacy: gate?.legacy === true },
    ...rigour.resolveRigour(cwd, phase, getMilestoneInfo(cwd).version),
    phase_req_ids: rigour.phaseReqIds(cwd, phase),
    ...phaseRiskFields(cwd, phase),
    ...initRiskFields(cwd, phase),
    ...planStampFields(cwd, phase),

    // Models
    researcher_model: resolveModelInternal(cwd, 'gsd-phase-researcher'),
    planner_model: resolveModelInternal(cwd, 'gsd-planner'),
    checker_model: resolveModelInternal(cwd, 'gsd-plan-checker'),
    executor_model: executorModelFor(cwd, phase),
    // Risk-domain plans, rulings and adversarial passes run on the configured top model (models.top).
    ...topModelFields(cwd),
    utility_model: readRawConfig(cwd).utility_model || 'haiku',

    // Workflow flags
    research_enabled: config.research,
    plan_checker_enabled: config.plan_checker,
    commit_docs: config.commit_docs,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || planned?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || planned?.phase_slug || null,
    padded_phase: (phaseInfo?.phase_number || planned?.phase_number)?.padStart(2, '0') || null,
    // Where the directory belongs; equals phase_dir once it exists
    phase_dir_target: phaseInfo?.directory || planned?.directory || null,

    // Existing artifacts
    has_research: phaseInfo?.has_research || false,
    has_context: phaseInfo?.has_context || false,
    has_plans: (phaseInfo?.plans?.length || 0) > 0,
    plan_count: phaseInfo?.plans?.length || 0,

    // Environment
    planning_exists: pathExistsInternal(cwd, '.planning'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    ...initFilePaths(cwd, phaseInfo),
  };

  // Include file contents if requested via --include
  if (includes.has('state')) {
    result.state_content = safeReadFile(path.join(cwd, '.planning', 'STATE.md'));
  }
  if (includes.has('roadmap')) {
    result.roadmap_content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  }
  if (includes.has('requirements')) {
    result.requirements_content = safeReadFile(path.join(cwd, '.planning', 'REQUIREMENTS.md'));
  }
  if (includes.has('context') && phaseInfo?.directory) {
    // Find *-CONTEXT.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const contextFile = files.find(f => f.endsWith('-CONTEXT.md') || f === 'CONTEXT.md');
      if (contextFile) {
        result.context_content = safeReadFile(path.join(phaseDirFull, contextFile));
      }
    } catch {}
  }
  if (includes.has('research') && phaseInfo?.directory) {
    // Find *-RESEARCH.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const researchFile = files.find(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');
      if (researchFile) {
        result.research_content = safeReadFile(path.join(phaseDirFull, researchFile));
      }
    } catch {}
  }
  if (includes.has('verification') && phaseInfo?.directory) {
    // Find *-VERIFICATION.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const verificationFile = files.find(f => f.endsWith('-VERIFICATION.md') || f === 'VERIFICATION.md');
      if (verificationFile) {
        result.verification_content = safeReadFile(path.join(phaseDirFull, verificationFile));
      }
    } catch {}
  }
  if (includes.has('uat') && phaseInfo?.directory) {
    // Find *-UAT.md in phase directory
    const phaseDirFull = path.join(cwd, phaseInfo.directory);
    try {
      const files = fs.readdirSync(phaseDirFull);
      const uatFile = files.find(f => f.endsWith('-UAT.md') || f === 'UAT.md');
      if (uatFile) {
        result.uat_content = safeReadFile(path.join(phaseDirFull, uatFile));
      }
    } catch {}
  }

  output(result, raw);
}

// Pure-Node recursive directory walk (depth-limited), replacing a prior
// `find ... | grep -v ... | head -N` shell pipeline. Skips node_modules/.git.
function findCodeFilesSync(cwd, extensions, maxDepth, limit) {
  const results = [];
  const skipDirs = new Set(['node_modules', '.git']);

  function walk(dir, depth) {
    if (results.length >= limit || depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        if (extensions.includes(path.extname(entry.name))) {
          results.push(path.join(dir, entry.name));
        }
      }
    }
  }

  walk(cwd, 0);
  return results;
}

function cmdInitNewProject(cwd, raw) {
  const config = loadConfig(cwd);

  // Detect Brave Search API key availability
  const homedir = require('os').homedir();
  const braveKeyFile = path.join(homedir, '.gsd', 'brave_api_key');
  const hasBraveSearch = !!(process.env.BRAVE_API_KEY || fs.existsSync(braveKeyFile));

  // Detect existing code
  let hasCode = false;
  let hasPackageFile = false;
  try {
    const files = findCodeFilesSync(cwd, ['.ts', '.js', '.py', '.go', '.rs', '.swift', '.java'], 3, 5);
    hasCode = files.length > 0;
  } catch {}

  hasPackageFile = pathExistsInternal(cwd, 'package.json') ||
                   pathExistsInternal(cwd, 'requirements.txt') ||
                   pathExistsInternal(cwd, 'Cargo.toml') ||
                   pathExistsInternal(cwd, 'go.mod') ||
                   pathExistsInternal(cwd, 'Package.swift');

  const result = {
    ...topModelFields(cwd),
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    available_presets: projectContext.availablePresets(path.join(__dirname, '..', 'presets')),
    context_gate: projectContext.contextGate(cwd, { legacy: false }),

    // Models
    researcher_model: resolveModelInternal(cwd, 'gsd-project-researcher'),
    synthesizer_model: resolveModelInternal(cwd, 'gsd-research-synthesizer'),
    roadmapper_model: resolveModelInternal(cwd, 'gsd-roadmapper'),

    // Config
    commit_docs: config.commit_docs,

    // Existing state
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    has_codebase_map: pathExistsInternal(cwd, '.planning/codebase'),
    planning_exists: pathExistsInternal(cwd, '.planning'),

    // Brownfield detection
    has_existing_code: hasCode,
    has_package_file: hasPackageFile,
    is_brownfield: hasCode || hasPackageFile,
    needs_codebase_map: (hasCode || hasPackageFile) && !pathExistsInternal(cwd, '.planning/codebase'),

    // Git state
    has_git: pathExistsInternal(cwd, '.git'),

    // Enhanced search
    brave_search_available: hasBraveSearch,
  };

  output(result, raw);
}

function cmdInitNewMilestone(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  const result = {
    ...topModelFields(cwd),
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Models
    researcher_model: resolveModelInternal(cwd, 'gsd-project-researcher'),
    synthesizer_model: resolveModelInternal(cwd, 'gsd-research-synthesizer'),
    roadmapper_model: resolveModelInternal(cwd, 'gsd-roadmapper'),

    // Config
    commit_docs: config.commit_docs,
    research_enabled: config.research,

    // Current milestone
    current_milestone: milestone.version,
    current_milestone_name: milestone.name,

    // File existence
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
  };

  output(result, raw);
}

function cmdInitMilestoneBranch(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  const result = {
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    branching_strategy: config.branching_strategy,
    branch_name: config.branching_strategy === 'milestone'
      ? config.milestone_branch_template
          .replace('{milestone}', milestone.version)
          .replace('{slug}', generateSlugInternal(milestone.name) || 'milestone')
      : null,
    milestone_version: milestone.version,
    milestone_slug: generateSlugInternal(milestone.name),
  };

  output(result, raw);
}

function cmdInitQuick(cwd, description, raw) {
  const config = loadConfig(cwd);
  const now = new Date();
  const slug = description ? generateSlugInternal(description)?.substring(0, 40) : null;

  // Find next quick task number
  const quickDir = path.join(cwd, '.planning', 'quick');
  let nextNum = 1;
  try {
    const existing = fs.readdirSync(quickDir)
      .filter(f => /^\d+-/.test(f))
      .map(f => parseInt(f.split('-')[0], 10))
      .filter(n => !isNaN(n));
    if (existing.length > 0) {
      nextNum = Math.max(...existing) + 1;
    }
  } catch {}

  const result = {
    ...topModelFields(cwd),
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Models
    planner_model: resolveModelInternal(cwd, 'gsd-planner'),
    executor_model: resolveModelInternal(cwd, 'gsd-executor'),

    // Config
    commit_docs: config.commit_docs,

    // Quick task info
    next_num: nextNum,
    slug: slug,
    description: description || null,

    // Timestamps
    date: now.toISOString().split('T')[0],
    timestamp: now.toISOString(),

    // Paths
    quick_dir: '.planning/quick',
    task_dir: slug ? `.planning/quick/${nextNum}-${slug}` : null,

    // File existence
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    planning_exists: pathExistsInternal(cwd, '.planning'),
  };

  output(result, raw);
}

function cmdInitResume(cwd, raw) {
  const config = loadConfig(cwd);

  // Check for interrupted agent
  let interruptedAgentId = null;
  try {
    interruptedAgentId = fs.readFileSync(path.join(cwd, '.planning', 'current-agent-id.txt'), 'utf-8').trim();
  } catch {}

  const result = {
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // File existence
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    planning_exists: pathExistsInternal(cwd, '.planning'),

    // Agent state
    has_interrupted_agent: !!interruptedAgentId,
    interrupted_agent_id: interruptedAgentId,

    // Config
    commit_docs: config.commit_docs,
  };

  output(result, raw);
}

function cmdInitVerifyWork(cwd, phase, raw) {
  if (!phase) {
    error('phase required for init verify-work');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);

  const result = {
    ...topModelFields(cwd),
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Models
    planner_model: resolveModelInternal(cwd, 'gsd-planner'),
    checker_model: resolveModelInternal(cwd, 'gsd-plan-checker'),

    // Config
    commit_docs: config.commit_docs,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,

    // Existing artifacts
    has_verification: phaseInfo?.has_verification || false,
  };

  output(result, raw);
}

function cmdInitPhaseOp(cwd, phase, raw) {
  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);

  const result = {
    ...topModelFields(cwd),
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Config
    commit_docs: config.commit_docs,
    brave_search: config.brave_search,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || null,
    padded_phase: phaseInfo?.phase_number?.padStart(2, '0') || null,

    // Existing artifacts
    has_research: phaseInfo?.has_research || false,
    has_context: phaseInfo?.has_context || false,
    has_plans: (phaseInfo?.plans?.length || 0) > 0,
    has_verification: phaseInfo?.has_verification || false,
    plan_count: phaseInfo?.plans?.length || 0,

    // File existence
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    planning_exists: pathExistsInternal(cwd, '.planning'),
  };

  output(result, raw);
}

function cmdInitTodos(cwd, area, raw) {
  const config = loadConfig(cwd);
  const now = new Date();

  // List todos (reuse existing logic)
  const pendingDir = path.join(cwd, '.planning', 'todos', 'pending');
  let count = 0;
  const todos = [];

  try {
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
        const createdMatch = content.match(/^created:\s*(.+)$/m);
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        const areaMatch = content.match(/^area:\s*(.+)$/m);
        const todoArea = areaMatch ? areaMatch[1].trim() : 'general';

        if (area && todoArea !== area) continue;

        count++;
        todos.push({
          file,
          created: createdMatch ? createdMatch[1].trim() : 'unknown',
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          area: todoArea,
          path: path.join('.planning', 'todos', 'pending', file),
        });
      } catch {}
    }
  } catch {}

  const result = {
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Config
    commit_docs: config.commit_docs,

    // Timestamps
    date: now.toISOString().split('T')[0],
    timestamp: now.toISOString(),

    // Todo inventory
    todo_count: count,
    todos,
    area_filter: area || null,

    // Paths
    pending_dir: '.planning/todos/pending',
    completed_dir: '.planning/todos/completed',

    // File existence
    planning_exists: pathExistsInternal(cwd, '.planning'),
    todos_dir_exists: pathExistsInternal(cwd, '.planning/todos'),
    pending_dir_exists: pathExistsInternal(cwd, '.planning/todos/pending'),
  };

  output(result, raw);
}

function cmdInitMilestoneOp(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  // Count phases
  let phaseCount = 0;
  let completedPhases = 0;
  const phasesDir = path.join(cwd, '.planning', 'phases');
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    phaseCount = dirs.length;

    // Count phases with summaries (completed)
    for (const dir of dirs) {
      try {
        const phaseFiles = fs.readdirSync(path.join(phasesDir, dir));
        const hasSummary = phaseFiles.some(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
        if (hasSummary) completedPhases++;
      } catch {}
    }
  } catch {}

  // Check archive
  const archiveDir = path.join(cwd, '.planning', 'archive');
  let archivedMilestones = [];
  try {
    archivedMilestones = fs.readdirSync(archiveDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {}

  const result = {
    ...topModelFields(cwd),
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Config
    commit_docs: config.commit_docs,

    // Current milestone
    milestone_version: milestone.version,
    milestone_name: milestone.name,
    milestone_slug: generateSlugInternal(milestone.name),

    // Phase counts
    phase_count: phaseCount,
    completed_phases: completedPhases,
    all_phases_complete: phaseCount > 0 && phaseCount === completedPhases,

    // Archive
    archived_milestones: archivedMilestones,
    archive_count: archivedMilestones.length,

    // File existence
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
    archive_exists: pathExistsInternal(cwd, '.planning/archive'),
    phases_dir_exists: pathExistsInternal(cwd, '.planning/phases'),
  };

  output(result, raw);
}

function cmdInitMapCodebase(cwd, raw) {
  const config = loadConfig(cwd);

  // Check for existing codebase maps
  const codebaseDir = path.join(cwd, '.planning', 'codebase');
  let existingMaps = [];
  try {
    existingMaps = fs.readdirSync(codebaseDir).filter(f => f.endsWith('.md'));
  } catch {}

  const result = {
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Models
    mapper_model: resolveModelInternal(cwd, 'gsd-codebase-mapper'),

    // Config
    commit_docs: config.commit_docs,
    search_gitignored: config.search_gitignored,
    parallelization: config.parallelization,

    // Paths
    codebase_dir: '.planning/codebase',

    // Existing maps
    existing_maps: existingMaps,
    has_maps: existingMaps.length > 0,

    // File existence
    planning_exists: pathExistsInternal(cwd, '.planning'),
    codebase_dir_exists: pathExistsInternal(cwd, '.planning/codebase'),
  };

  output(result, raw);
}

function cmdInitProgress(cwd, includes, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  // Analyze phases
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const phases = [];
  let currentPhase = null;
  let nextPhase = null;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dir of dirs) {
      const match = dir.match(/^(\d+(?:\.\d+)?)-?(.*)/);
      const phaseNumber = match ? match[1] : dir;
      const phaseName = match && match[2] ? match[2] : null;

      const phasePath = path.join(phasesDir, dir);
      const phaseFiles = fs.readdirSync(phasePath);

      const plans = phaseFiles.filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');
      const summaries = phaseFiles.filter(f => f.endsWith('-SUMMARY.md') || f === 'SUMMARY.md');
      const hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md') || f === 'RESEARCH.md');

      const status = summaries.length >= plans.length && plans.length > 0 ? 'complete' :
                     plans.length > 0 ? 'in_progress' :
                     hasResearch ? 'researched' : 'pending';

      const phaseInfo = {
        number: phaseNumber,
        name: phaseName,
        directory: path.join('.planning', 'phases', dir),
        status,
        plan_count: plans.length,
        summary_count: summaries.length,
        has_research: hasResearch,
      };

      phases.push(phaseInfo);

      // Find current (first incomplete with plans) and next (first pending)
      if (!currentPhase && (status === 'in_progress' || status === 'researched')) {
        currentPhase = phaseInfo;
      }
      if (!nextPhase && status === 'pending') {
        nextPhase = phaseInfo;
      }
    }
  } catch {}

  // Check for paused work
  let pausedAt = null;
  try {
    const state = fs.readFileSync(path.join(cwd, '.planning', 'STATE.md'), 'utf-8');
    const pauseMatch = state.match(/\*\*Paused At:\*\*\s*(.+)/);
    if (pauseMatch) pausedAt = pauseMatch[1].trim();
  } catch {}

  const result = {
    ...projectContext.contextFields(cwd),
    ...autoModeFields(cwd),
    // Models
    executor_model: resolveModelInternal(cwd, 'gsd-executor'),
    planner_model: resolveModelInternal(cwd, 'gsd-planner'),

    // Config
    commit_docs: config.commit_docs,

    // Milestone
    milestone_version: milestone.version,
    milestone_name: milestone.name,

    // Phase overview
    phases,
    phase_count: phases.length,
    completed_count: phases.filter(p => p.status === 'complete').length,
    in_progress_count: phases.filter(p => p.status === 'in_progress').length,

    // Current state
    current_phase: currentPhase,
    next_phase: nextPhase,
    paused_at: pausedAt,
    has_work_in_progress: !!currentPhase,

    // File existence
    project_exists: pathExistsInternal(cwd, '.planning/PROJECT.md'),
    roadmap_exists: pathExistsInternal(cwd, '.planning/ROADMAP.md'),
    state_exists: pathExistsInternal(cwd, '.planning/STATE.md'),
  };

  // Include file contents if requested via --include
  if (includes.has('state')) {
    result.state_content = safeReadFile(path.join(cwd, '.planning', 'STATE.md'));
  }
  if (includes.has('roadmap')) {
    result.roadmap_content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  }
  if (includes.has('project')) {
    result.project_content = safeReadFile(path.join(cwd, '.planning', 'PROJECT.md'));
  }
  if (includes.has('config')) {
    result.config_content = safeReadFile(path.join(cwd, '.planning', 'config.json'));
  }

  output(result, raw);
}

function readRawConfig(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

// Base branch for the roadmap PR: config git.base_branch, else origin/HEAD, else null (PR is then skipped, not failed).
function resolveBaseBranch(cwd) {
  const cfg = readRawConfig(cwd);
  const configured = (cfg.git && cfg.git.base_branch) || cfg.base_branch;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const head = execGit(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (head.exitCode === 0 && head.stdout) return head.stdout.replace(/^origin\//, '');
  return null;
}

function hasGitRemote(cwd) {
  const r = execGit(cwd, ['remote']);
  return r.exitCode === 0 && r.stdout.length > 0;
}

const slugifyMilestone = (name) => String(name || 'milestone').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'milestone';

// Phases whose gates are not re-judged: a `phase_complete` event, or a ROADMAP box checked when the one-time `gate_baseline`
// event was taken (phases finished by older builds). The baseline is never rewritten, so a box ticked by hand later proves nothing.
// `write` appends the baseline when none exists: only `roadmap next` and `roadmap record` pass it; every other reader computes
// the same set in memory (a log created by a read would change `init progress` resume state).
function closedPhaseKeys(cwd, write = false) {
  const events = readExecutionEvents(cwd);
  const base = events.find((e) => e.type === 'gate_baseline');
  let keys;
  if (base) keys = (base.phases || []).map(dispatch.phaseKey);
  else {
    const content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
    keys = content === null ? [] : parseRoadmapPhases(content, path.join(cwd, '.planning', 'phases'))
      .map((p) => dispatch.phaseKey(p.number)).filter((k) => roadmapBox.checkboxState(content, k) === true);
    if (write && content !== null) appendEvent(cwd, { type: 'gate_baseline', phases: keys });
  }
  return new Set([...keys, ...events.filter((e) => e.type === 'phase_complete').map((e) => dispatch.phaseKey(e.phase))]);
}

function readExecutionEvents(cwd) {
  try {
    return fs.readFileSync(path.join(cwd, '.planning', 'EXECUTION_LOG.md'), 'utf-8')
      .split('\n').filter(l => l.trim().startsWith('{'))
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// Cache per-process: phaseTruth shells out to git, and one command asks the same question repeatedly.
function makeTruthFn(cwd) {
  const cache = new Map();
  return (k) => {
    if (!cache.has(k)) cache.set(k, phaseTruth(cwd, k).complete);
    return cache.get(k);
  };
}

// Owner-gate view for the roadmap loop: which gate stops it right now (start gates, then the PR gate).
function ownerGateView(cwd, events) {
  const autoMode = autoModeFields(cwd).auto_mode;
  const milestone = getMilestoneInfo(cwd).version;
  const summary = ownerGates.summarise(cwd, { autoMode, milestone });
  const prExists = events.some(e => e.type === 'pr_requested' || e.type === 'pr_created');
  const done = events.some(e => e.type === 'roadmap_complete');
  const prGate = ownerGates.find(ownerGates.readAll(cwd), 'pr', milestone);
  const prWaiting = prExists && !done && (autoMode || !!prGate) && !(prGate && prGate.status === 'approved');
  const blocked = summary.blocked_by_owner_gate || (prWaiting ? 'pr' : null);
  return { summary, blocked_by_owner_gate: blocked, pr_waiting: prWaiting, auto_mode: autoMode };
}

function cmdInitExecuteRoadmap(cwd, raw) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');

  if (!fs.existsSync(roadmapPath)) {
    output({
      ...projectContext.contextFields(cwd),
      ...autoModeFields(cwd),
      error: 'ROADMAP.md not found',
      roadmap_exists: false
    }, raw);
    return;
  }

  const config = loadConfig(cwd);
  const rawConfig = readRawConfig(cwd);
  const coordinatorModel = config.coordinator_model ?? 'sonnet';

  // Reuse shared phase parsing (avoids duplicating 60+ lines from cmdRoadmapAnalyze)
  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const phases = parseRoadmapPhases(content, phasesDir, { truthCwd: cwd });

  // Build execution order (simple sequential for now - no DAG parallel support yet)
  const executionOrder = phases.map(p => p.number);

  // Completion is on-disk truth (phaseTruth), never the bare summary count.
  const completePhases = new Set(phases.filter(p => p.phase_complete).map(p => dispatch.phaseKey(p.number)));
  const executable = [];
  const blocked = [];

  for (const phase of phases) {
    if (phase.phase_complete) continue;
    const deps = dispatch.parseDeps(phase.depends_on);
    const missing = deps.filter(dep => !completePhases.has(dep));
    if (missing.length === 0) executable.push(phase.number);
    else blocked.push({ phase: phase.number, missing_deps: missing });
  }

  const hasExecutionLog = fs.existsSync(path.join(cwd, '.planning', 'EXECUTION_LOG.md'));

  // Resume: events intersected with disk truth.
  let resumeState = null;
  if (hasExecutionLog) {
    const events = readExecutionEvents(cwd);
    const roadmapComplete = events.some(e => e.type === 'roadmap_complete');
    if (!roadmapComplete && events.length > 0) {
      const truth = (k) => completePhases.has(k);
      const rs = dispatch.resumeState(events, phases, truth);
      if (rs.completed_phases.length > 0 || rs.started_incomplete.length > 0 || rs.parked.length > 0) {
        const lead = rs.started_incomplete[0] || rs.parked[0] || null;
        const leadPhase = lead ? phases.find(p => dispatch.phaseKey(p.number) === lead) : null;
        resumeState = {
          ...rs,
          status: rs.started_incomplete.length > 0 ? 'in_progress' : 'can_resume',
          phase: lead,
          phase_name: leadPhase ? leadPhase.name : null,
        };
      }
    }
  }

  const milestone = getMilestoneInfo(cwd);
  const gateView = ownerGateView(cwd, hasExecutionLog ? readExecutionEvents(cwd) : []);
  if (gateView.blocked_by_owner_gate && !(resumeState && resumeState.status === 'in_progress')) {
    resumeState = {
      completed_phases: [], started_incomplete: [], parked: [], ...(resumeState || {}),
      status: ownerGates.STATUS_WAITING,
      blocked_by_owner_gate: gateView.blocked_by_owner_gate,
    };
  }
  const autoFields = autoModeFields(cwd);
  output({
    ...projectContext.contextFields(cwd),
    ...autoFields,
    owner_gates: { ...autoFields.owner_gates, status: gateView.summary },
    blocked_by_owner_gate: gateView.blocked_by_owner_gate,
    roadmap_exists: true,
    total_phases: phases.length,
    execution_order: executionOrder,
    parallel_opportunities: [], // Future enhancement
    next_executable: executable,
    blocked_phases: blocked,
    has_execution_log: hasExecutionLog,
    resume_state: resumeState,
    coordinator_model: coordinatorModel,
    ...topModelFields(cwd),
    utility_model: rawConfig.utility_model || 'haiku',
    reviewer_model: rawConfig.reviewer_model || 'sonnet',
    legacy: process.argv.includes('--legacy') || process.env.GSD_LEGACY === '1',
    milestone_version: milestone.version,
    milestone_slug: slugifyMilestone(milestone.name),
    base_branch: resolveBaseBranch(cwd),
  }, raw);
}

// owner-gate request|status|approve|reject --kind composition|roadmap|pr [--milestone V] [--summary S] [--revise] [--spike-phases N,M --spike-roots p,q] [--by W] [--note N] [--owner-confirmed]
// approve/reject: refused while auto_mode is active unless --owner-confirmed with a --note. The flag is a recorded
// attestation, not authentication: an unattended agent that passes it has lied in the audit trail, visibly.
// budget spend --phase N [--step S] [--model M]: logs ONE dispatch (at spawn). budget status --phase N: the coordinator reads it before each new cycle.
function cmdPhaseBudget(cwd, args, raw) {
  const sub = args[0];
  if (sub !== 'status' && sub !== 'spend') error('Unknown budget subcommand. Available: status, spend');
  const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
  const phase = flag('--phase');
  if (!phase) error(`budget ${sub}: --phase required`);
  if (sub === 'spend') {
    appendEvent(cwd, { type: 'phase_spend', phase: dispatch.phaseKey(phase), step: flag('--step') || null, model: flag('--model') || null });
    output({ logged: true, phase: dispatch.phaseKey(phase) }, raw);
    return;
  }
  output(phaseBudgetStatus(cwd, phase, readExecutionEvents(cwd)), raw);
}

function phaseBudgetStatus(cwd, phase, events) {
  const level = rigour.resolveRigour(cwd, phase, getMilestoneInfo(cwd).version).rigour;
  const cls = phaseBudget.budgetClass({ rigour: level, riskAddons: riskAddons(cwd, phase, level) });
  return phaseBudget.status({ cwd, phase, cls, events });
}

function cmdOwnerGate(cwd, args, raw) {
  const sub = args[0];
  const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
  const kind = flag('--kind') || (sub !== 'status' ? args[1] : undefined);
  const milestone = flag('--milestone') || getMilestoneInfo(cwd).version;
  if (sub === 'request') {
    const csv = (v) => (v == null ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean));
    const checked = rigour.gateRequestErrors(cwd, { kind, milestone, spikePhases: csv(flag('--spike-phases')), spikeRoots: csv(flag('--spike-roots')), isComplete: (n) => roadmapCheckboxState(cwd, n) === true || phaseTruth(cwd, n).complete });
    for (const n of checked.notices) process.stderr.write(`Notice: ${n}\n`);
    if (checked.errors.length > 0) error(`owner-gate request refused: ${checked.errors.join('; ')}`);
    const r = ownerGates.request(cwd, { kind, milestone, summary: flag('--summary'), spikePhases: flag('--spike-phases'), spikeRoots: flag('--spike-roots'), revise: args.includes('--revise') });
    if (!r.ok) error(`owner-gate: ${r.error}`);
    output({ action: 'owner_gate_requested', created: r.created, status: r.gate.status === 'pending' ? ownerGates.STATUS_WAITING : r.gate.status, gate: r.gate }, raw);
  } else if (sub === 'status') {
    const view = ownerGates.summarise(cwd, { autoMode: autoModeFields(cwd).auto_mode, milestone });
    output({ ...view, gates: ownerGates.readAll(cwd) }, raw);
  } else if (sub === 'approve' || sub === 'reject') {
    const auto = autoModeFields(cwd);
    const confirmed = args.includes('--owner-confirmed');
    const note = flag('--note');
    if (auto.auto_mode && !confirmed) error(`owner-gate ${sub}: auto mode is active (${auto.auto_mode_source}); an owner gate is decided by the owner from an interactive session, or with --owner-confirmed --note "<how the owner decided>"`);
    if ((confirmed || auto.owner_gates.require_note) && !note) error(`owner-gate ${sub}: --note is required`);
    const r = ownerGates.decide(cwd, { kind, milestone, status: sub === 'approve' ? 'approved' : 'rejected', by: flag('--by'), note, via: confirmed ? 'owner_confirmed_flag' : 'interactive' });
    if (!r.ok) error(`owner-gate: ${r.error}`);
    output({ action: `owner_gate_${r.gate.status}`, changed: r.changed, gate: r.gate }, raw);
  } else {
    error('Unknown owner-gate subcommand. Available: request, status, approve, reject');
  }
}

// roadmap next: pure state machine over events + disk truth; appends the events it returns.
function roadmapInputs(cwd) {
  const content = safeReadFile(path.join(cwd, '.planning', 'ROADMAP.md'));
  if (content === null) error('ROADMAP.md not found');
  const phases = parseRoadmapPhases(content, path.join(cwd, '.planning', 'phases'));
  return { phases, events: readExecutionEvents(cwd), truth: makeTruthFn(cwd) };
}

function cmdRoadmapNext(cwd, args, raw) {
  closedPhaseKeys(cwd, true);
  const { phases, events, truth } = roadmapInputs(cwd);
  const config = loadConfig(cwd);
  const gateView = ownerGateView(cwd, events);
  const result = dispatch.next({
    phases,
    events,
    truth,
    ownerGate: { blocked_by: gateView.blocked_by_owner_gate, status: gateView.blocked_by_owner_gate ? ((ownerGates.find(ownerGates.readAll(cwd), gateView.blocked_by_owner_gate, getMilestoneInfo(cwd).version) || {}).status || 'not_requested') : null, pr_waiting: gateView.pr_waiting },
    retryParked: args.includes('--retry-parked'),
    hasCheckpoint: (k) => { const info = findPhaseInternal(cwd, k); return !!info && fs.existsSync(path.join(cwd, info.directory, 'CHECKPOINT.json')); },
    gateMarked: dispatch.hasEvent(events, 'gate_pre_pr_passed'),
    riskDomains: (k) => phaseRiskFields(cwd, k).phase_risk_domains,
    prRecorded: dispatch.hasEvent(events, 'pr_created') || dispatch.hasEvent(events, 'pr_requested') || dispatch.hasEvent(events, 'pr_skipped'),
    hasRemote: hasGitRemote(cwd),
    config: {
      coordinator_model: config.coordinator_model ?? 'sonnet',
      base_branch: resolveBaseBranch(cwd),
      legacy: args.includes('--legacy') || process.env.GSD_LEGACY === '1',
    },
  });
  for (const e of result.log) appendEvent(cwd, e);
  output(result.action === 'done' ? { ...result, form_debt: milestoneFormDebt(cwd) } : result, raw);
}

// roadmap record --phase N --result '<coordinator JSON or text>' | --kind pr --result '{"status":"created|skipped"}'
function cmdRoadmapRecord(cwd, args, raw) {
  const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
  const resultArg = flag('--result');
  const kind = flag('--kind');
  if (kind === 'pr' || kind === 'pr_requested') {
    let status = 'skipped';
    let reason = null;
    let url = null;
    try { const r = JSON.parse(resultArg); status = r.status === 'created' ? 'created' : 'skipped'; reason = r.reason || null; url = r.url || null; } catch { /* default skipped */ }
    // A PR in an unattended run is only ever requested for the owner, never completed by the run.
    const requested = status === 'created' && (kind === 'pr_requested' || autoModeFields(cwd).auto_mode);
    if (requested) {
      const gate = ownerGates.request(cwd, { kind: 'pr', milestone: getMilestoneInfo(cwd).version, summary: `PR for owner review${url ? `: ${url}` : ''}` });
      appendEvent(cwd, { type: 'pr_requested', url });
      output({ action: 'pr_recorded', status: 'requested', gate: gate.gate, next_status: ownerGates.STATUS_WAITING }, raw);
      return;
    }
    appendEvent(cwd, { type: status === 'created' ? 'pr_created' : 'pr_skipped', reason });
    output({ action: 'pr_recorded', status }, raw);
    return;
  }
  const phase = flag('--phase');
  if (!phase) error('roadmap record: --phase required (or --kind pr)');
  if (resultArg === undefined) error('roadmap record: --result required');
  closedPhaseKeys(cwd, true);
  const events = readExecutionEvents(cwd);
  const k = dispatch.phaseKey(phase);
  const truth = phaseTruth(cwd, k);
  const out = dispatch.record({
    phase: k,
    result: resultArg,
    truth,
    events,
    spike: rigour.resolveRigour(cwd, k, getMilestoneInfo(cwd).version).rigour === 'spike',
    ladder: (ph, errorMsg, step) => {
      const applied = applyExecutionStateFailure(cwd, { phase: ph, errorMsg, step });
      return applied.ok ? { action: applied.result.action, attempts: applied.result.attempts } : { action: 'escalate' };
    },
  });
  if (out.action === 'complete') {
    applyExecutionStateSuccess(cwd, { phase: k });
  }
  for (const e of out.events) {
    if (e.type !== 'phase_complete') { appendEvent(cwd, e); continue; }
    // `phase complete` already wrote this completion (with its final spend) and nothing has reopened the phase since.
    const mine = events.filter((x) => dispatch.phaseKey(x.phase) === k);
    if (mine.length > 0 && mine[mine.length - 1].type === 'phase_complete') continue;
    // The completion resets the budget window: record the final spend in the event so `budget status` can still show it.
    const b = phaseBudgetStatus(cwd, k, events);
    appendEvent(cwd, { ...e, budget_class: b.budget_class, wall_minutes_spent: b.wall_minutes_spent, dispatches_spent: b.dispatches_spent, total_wall_minutes: b.total_wall_minutes, total_dispatches: b.total_dispatches, budget_wall_minutes: b.budget_wall_minutes, pct: b.pct, warn: b.warn, breach: b.breach });
  }
  output({ ...out, truth: { complete: truth.complete, errors: truth.errors, work_errors: truth.work_errors, form_errors: truth.form_errors } }, raw);
}

// ─── Session Analysis Commands ────────────────────────────────────────────────

/**
 * analyze-session <session-file-path>
 *
 * Prepares a session JSONL file for Haiku analysis.
 * Returns extraction requests for the calling GSD workflow to pass to Task().
 */
async function cmdAnalyzeSession(cwd, args, raw) {
  const sessionFilePath = args[0];

  if (!sessionFilePath) {
    output({ status: 'error', reason: 'Usage: analyze-session <session-file-path>' }, raw);
    return;
  }

  // Resolve the path (absolute or relative to cwd)
  const resolvedPath = path.isAbsolute(sessionFilePath)
    ? sessionFilePath
    : path.join(cwd, sessionFilePath);

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    output({ status: 'error', reason: `Session file not found: ${resolvedPath}` }, raw);
    return;
  }

  // Lazy-require modules
  let shouldAnalyzeSession, isAlreadyAnalyzed, getSessionContentHash;
  try {
    const gates = require(path.join(__dirname, 'session-quality-gates.js'));
    shouldAnalyzeSession = gates.shouldAnalyzeSession;
    isAlreadyAnalyzed = gates.isAlreadyAnalyzed;
    getSessionContentHash = gates.getSessionContentHash;
  } catch (err) {
    output({ status: 'error', reason: 'Failed to load session-quality-gates.js: ' + err.message }, raw);
    return;
  }

  let prepareSessionForAnalysis;
  try {
    const chunker = require(path.join(__dirname, 'session-chunker.js'));
    prepareSessionForAnalysis = chunker.prepareSessionForAnalysis;
  } catch (err) {
    output({ status: 'error', reason: 'Failed to load session-chunker.js: ' + err.message }, raw);
    return;
  }

  let analyzeSession;
  try {
    const analyzer = require(path.join(__dirname, 'session-analyzer.js'));
    analyzeSession = analyzer.analyzeSession;
  } catch (err) {
    output({ status: 'error', reason: 'Failed to load session-analyzer.js: ' + err.message }, raw);
    return;
  }

  // Load session JSONL entries
  let entries = [];
  try {
    const rawContent = fs.readFileSync(resolvedPath, 'utf8');
    const lines = rawContent.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    output({ status: 'error', reason: 'Failed to read session file: ' + err.message }, raw);
    return;
  }

  // Run quality gates
  const qualityCheck = shouldAnalyzeSession(entries);
  if (!qualityCheck.analyze) {
    output({ status: 'skipped', reason: qualityCheck.reason }, raw);
    return;
  }

  // Check re-analysis prevention
  const contentHash = getSessionContentHash(entries);
  const sessionId = path.basename(resolvedPath, '.jsonl');

  if (isAlreadyAnalyzed(sessionId, contentHash)) {
    output({ status: 'already_analyzed', sessionId, contentHash }, raw);
    return;
  }

  // Prepare session (voice resolution + chunking)
  const prepared = prepareSessionForAnalysis(entries);

  // For each chunk, get extraction requests
  const allExtractionRequests = [];
  for (const chunk of prepared.chunks) {
    const requests = analyzeSession(chunk);
    allExtractionRequests.push(...requests);
  }

  output({
    status: 'ready',
    sessionId,
    sessionPath: resolvedPath,
    chunkCount: prepared.chunkCount,
    totalChars: prepared.totalChars,
    contentHash,
    extractionRequests: allExtractionRequests
  }, raw);
}

/**
 * historical-extract <planning-path>
 *
 * Extracts knowledge from an existing GSD project's completed phases.
 * Returns extraction requests for the calling GSD workflow to pass to Task().
 */
async function cmdHistoricalExtract(cwd, args, raw) {
  const planningPath = args[0];

  if (!planningPath) {
    output({ status: 'error', reason: 'Usage: historical-extract <planning-path>' }, raw);
    return;
  }

  const resolvedPath = path.isAbsolute(planningPath)
    ? planningPath
    : path.join(cwd, planningPath);

  if (!fs.existsSync(resolvedPath)) {
    output({ status: 'error', reason: `Planning path does not exist: ${resolvedPath}`, phasesFound: 0 }, raw);
    return;
  }

  const roadmapPath = path.join(resolvedPath, 'ROADMAP.md');
  if (!fs.existsSync(roadmapPath)) {
    output({ status: 'error', reason: `ROADMAP.md not found in: ${resolvedPath}`, phasesFound: 0 }, raw);
    return;
  }

  let extractFromProject;
  try {
    const extractor = require(path.join(__dirname, 'historical-extract.js'));
    extractFromProject = extractor.extractFromProject;
  } catch (err) {
    output({ status: 'error', reason: 'Failed to load historical-extract.js: ' + err.message }, raw);
    return;
  }

  const result = extractFromProject(resolvedPath);
  output(result, raw);
}

/**
 * analysis-status
 *
 * Reports statistics on analyzed sessions.
 */
function cmdAnalysisStatus(cwd, _args, raw) {
  let getAnalysisStats;
  try {
    const gates = require(path.join(__dirname, 'session-quality-gates.js'));
    getAnalysisStats = gates.getAnalysisStats;
  } catch (err) {
    output({
      totalAnalyzed: 0,
      totalInsights: 0,
      lastAnalysis: null,
      error: 'Failed to load session-quality-gates.js: ' + err.message
    }, raw);
    return;
  }

  const stats = getAnalysisStats();
  const analysisLogPath = path.join(cwd, '.planning', 'telegram-sessions', '.analysis-log.jsonl');

  output({
    totalAnalyzed: stats.totalSessions || 0,
    totalInsights: stats.totalInsights || 0,
    lastAnalysis: stats.lastAnalyzedAt || null,
    analysisLogPath
  }, raw);
}

/**
 * list-pending-sessions
 *
 * Scans .planning/telegram-sessions/ for session JSONL files with
 * session_analysis_pending entries that have not yet been processed.
 */
async function cmdListPendingSessions(cwd, _args, raw) {
  const sessionsDir = path.join(cwd, '.planning', 'telegram-sessions');

  if (!fs.existsSync(sessionsDir)) {
    output({ pending: [], count: 0 }, raw);
    return;
  }

  let isAlreadyAnalyzed;
  try {
    const gates = require(path.join(__dirname, 'session-quality-gates.js'));
    isAlreadyAnalyzed = gates.isAlreadyAnalyzed;
  } catch (err) {
    output({ pending: [], count: 0, error: 'Failed to load session-quality-gates.js: ' + err.message }, raw);
    return;
  }

  // Read all JSONL files in the sessions directory
  let sessionFiles = [];
  try {
    sessionFiles = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('.'))
      .map(f => path.join(sessionsDir, f));
  } catch (err) {
    output({ pending: [], count: 0, error: 'Failed to read sessions directory: ' + err.message }, raw);
    return;
  }

  const pending = [];

  for (const sessionPath of sessionFiles) {
    let entries = [];
    try {
      const rawContent = fs.readFileSync(sessionPath, 'utf8');
      const lines = rawContent.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      continue;
    }

    // Check if there's a session_analysis_pending entry
    const pendingEntryIdx = entries.findIndex(e => e && e.type === 'session_analysis_pending');
    if (pendingEntryIdx === -1) continue;

    // Check if a session_analysis_complete entry exists AFTER the pending entry
    const hasComplete = entries
      .slice(pendingEntryIdx + 1)
      .some(e => e && e.type === 'session_analysis_complete');

    if (hasComplete) continue;

    // Get the pending entry to retrieve extraction requests
    const pendingEntry = entries[pendingEntryIdx];
    const sessionId = pendingEntry.session_id || path.basename(sessionPath, '.jsonl');

    // Secondary guard: check analysis log
    if (pendingEntry.content_hash && isAlreadyAnalyzed(sessionId, pendingEntry.content_hash)) {
      continue;
    }

    pending.push({
      sessionId,
      sessionPath,
      extractionRequests: pendingEntry.extraction_requests || [],
      timestamp: pendingEntry.timestamp || null
    });
  }

  output({ pending, count: pending.length }, raw);
}

/**
 * store-analysis-result <session-id> <results-json>
 *
 * Accepts Haiku extraction results and persists them to the knowledge DB.
 * Marks the session as analyzed to prevent re-analysis.
 */
async function cmdStoreAnalysisResult(cwd, args, raw) {
  const sessionId = args[0];
  const resultsArg = args.slice(1).join(' ');

  if (!sessionId) {
    output({ status: 'error', reason: 'Usage: store-analysis-result <session-id> <results-json>' }, raw);
    return;
  }

  if (!resultsArg) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: ['No results JSON provided'] }, raw);
    return;
  }

  // Parse the results JSON (may be a JSON string or path to JSON file)
  let results = [];
  try {
    // First try as a JSON string
    results = JSON.parse(resultsArg);
  } catch {
    // Try as a file path
    const resolvedPath = path.isAbsolute(resultsArg)
      ? resultsArg
      : path.join(cwd, resultsArg);
    try {
      const fileContent = fs.readFileSync(resolvedPath, 'utf8');
      results = JSON.parse(fileContent);
    } catch (err) {
      output({ stored: 0, skipped: 0, evolved: 0, errors: ['Failed to parse results JSON: ' + err.message] }, raw);
      return;
    }
  }

  // Handle empty results
  if (!Array.isArray(results) || results.length === 0) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: [] }, raw);
    return;
  }

  // Lazy-require modules
  let parseExtractionResult;
  try {
    const analyzer = require(path.join(__dirname, 'session-analyzer.js'));
    parseExtractionResult = analyzer.parseExtractionResult;
  } catch (err) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: ['Failed to load session-analyzer.js: ' + err.message] }, raw);
    return;
  }

  let storeInsights;
  try {
    const writer = require(path.join(__dirname, 'knowledge-writer.js'));
    storeInsights = writer.storeInsights;
  } catch (err) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: ['Failed to load knowledge-writer.js: ' + err.message] }, raw);
    return;
  }

  let markSessionAnalyzed, getSessionContentHash;
  try {
    const gates = require(path.join(__dirname, 'session-quality-gates.js'));
    markSessionAnalyzed = gates.markSessionAnalyzed;
    getSessionContentHash = gates.getSessionContentHash;
  } catch (err) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: ['Failed to load session-quality-gates.js: ' + err.message] }, raw);
    return;
  }

  // Collect all insights from all result objects
  const allInsights = [];
  const parseErrors = [];

  for (const resultObj of results) {
    if (!resultObj || typeof resultObj.type !== 'string' || typeof resultObj.result !== 'string') {
      parseErrors.push('Invalid result object (missing type or result field)');
      continue;
    }

    const { insights, errors } = parseExtractionResult(resultObj.type, resultObj.result);
    allInsights.push(...insights);
    parseErrors.push(...errors);
  }

  // Store all insights in knowledge DB
  const { resolveProjectSlug } = require(path.join(__dirname, 'knowledge-writer.js'));
  let storeResult = { stored: 0, skipped: 0, evolved: 0, errors: [] };
  if (allInsights.length > 0) {
    try {
      storeResult = await storeInsights(allInsights, { sessionId, scope: 'global', projectSlug: resolveProjectSlug(cwd) });
    } catch (err) {
      storeResult.errors.push('storeInsights failed: ' + err.message);
    }
  }

  // Mark session as analyzed
  const totalInsights = storeResult.stored + storeResult.evolved;
  const contentHash = getSessionContentHash([]); // We use a placeholder hash here since entries may not be available
  try {
    markSessionAnalyzed(sessionId, contentHash, totalInsights);
  } catch (err) {
    storeResult.errors.push('markSessionAnalyzed failed: ' + err.message);
  }

  // Append session_analysis_complete entry to the session JSONL file
  const sessionsDir = path.join(cwd, '.planning', 'telegram-sessions');
  const sessionFilePath = path.join(sessionsDir, sessionId + '.jsonl');
  if (fs.existsSync(sessionFilePath)) {
    try {
      const completeEntry = JSON.stringify({
        type: 'session_analysis_complete',
        session_id: sessionId,
        insight_count: totalInsights,
        timestamp: new Date().toISOString()
      }) + '\n';
      fs.appendFileSync(sessionFilePath, completeEntry, 'utf8');
    } catch (err) {
      storeResult.errors.push('Failed to append session_analysis_complete: ' + err.message);
    }
  }

  output({
    stored: storeResult.stored,
    skipped: storeResult.skipped,
    evolved: storeResult.evolved,
    errors: [...parseErrors, ...storeResult.errors]
  }, raw);
}

// ============================================================
// Compression: doc header extraction (Phase 09)
// ============================================================

function cmdCompressSummary(filePath, raw) {
  if (!filePath) { error('file path required'); return; }
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) { error('file not found: ' + absolutePath); return; }

  const { HeaderExtractor } = require('./compression/header-extractor');
  const extractor = new HeaderExtractor();
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const result = extractor.extractSummary(content, absolutePath);

  if (raw) {
    console.log(result.summary);
  } else {
    const reductionPercent = ((1 - result.summary.length / content.length) * 100).toFixed(1);
    output({ ...result, originalLength: content.length, reductionPercent }, false);
  }
}

function cmdCompressStats(raw) {
  output({
    message: 'Compression stats tracking not yet implemented',
    suggestion: 'Use "compress summary" command to compress individual files'
  }, raw);
}

// ============================================================
// Routing: failure classification, escalation
// ============================================================

function cmdRoutingClassifyFailure(cwd, errorText, raw) {
  const result = classifyFailure(errorText || '');
  output(result, raw);
}

// Composes classifyFailure + decideEscalation into one call the coordinator
// can use to decide whether to re-spawn a failed task at a higher tier.
function cmdRoutingEscalationDecision(cwd, options, raw) {
  const { currentTier, errorSummary, escalationsUsed, failsAtTier, rescuesUsed } = options || {};
  if (!currentTier) { error('routing escalation-decision: --current-tier is required'); return; }
  const classification = classifyFailure(errorSummary || '');
  const escalationsUsedNum = parseInt(escalationsUsed, 10) || 0;
  const failsNum = parseInt(failsAtTier, 10) || 1;
  const rescuesNum = parseInt(rescuesUsed, 10) || 0;
  const topAlias = currentTier === 'sonnet' ? topModelFields(cwd).ruling_model : null;
  const decision = decideEscalation(currentTier, classification, escalationsUsedNum, topAlias, failsNum, rescuesNum);
  output({ ...classification, ...decision, current_tier: currentTier, escalations_used: escalationsUsedNum, fails_at_tier: failsNum }, raw);
}

/**
 * mine-conversations [--max-age-days N] [--include-subagents] [--limit N] [--all-projects]
 *
 * Discovers Claude Code project JSONL conversation files, converts entries to
 * session-like format, applies quality gates, checks re-analysis prevention
 * via conversation-specific analysis log, and returns extraction requests
 * ready for the calling GSD workflow to pass to Task().
 *
 * --all-projects: scan all ~/.claude/projects/ slug directories instead of current CWD only.
 */
async function cmdMineConversations(cwd, args, raw) {
  const maxAgeDays = args.includes('--max-age-days')
    ? parseInt(args[args.indexOf('--max-age-days') + 1])
    : 30;
  const includeSubagents = args.includes('--include-subagents');
  const limit = args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1])
    : 0;
  const allProjects = args.includes('--all-projects');

  // Lazy-require conversation-miner.js
  let conversationMiner;
  try {
    conversationMiner = require(path.join(__dirname, 'conversation-miner.js'));
  } catch (err) {
    output({ status: 'error', reason: 'Failed to load conversation-miner.js: ' + err.message }, raw);
    return;
  }

  // Auto-checkpoint before this bulk operation, best-effort. Checkpoint
  // failure must never block mining — swallow any error and continue.
  try {
    const { createCheckpoint } = require(path.join(__dirname, 'knowledge-checkpoint.js'));
    await createCheckpoint({
      task_title: 'Conversation mining (bulk operation)',
      plan: ['discover conversations', 'extract insights', 'store results'],
      progress: { completed: [], current: 'discover conversations', remaining: ['extract insights', 'store results'] },
      phase: 0,
      plan_id: 'bulk-mine-conversations',
      key_context: `Bulk conversation mining started at ${new Date().toISOString()}, allProjects=${allProjects}, maxAgeDays=${maxAgeDays}`,
      files_touched: [],
      decisions: [],
      next_steps: []
    });
  } catch (_) { /* checkpoint failure must never block mining */ }

  if (allProjects) {
    // --all-projects: scan all project slug dirs under ~/.claude/projects/
    const { projects, totalFiles, skippedNonGSD } = conversationMiner.discoverAllProjectConversations(
      { maxAgeDays, includeSubagents }
    );

    const extractionSessions = [];
    const skipped = [];

    for (const project of projects) {
      const projectFiles = limit > 0 ? project.files.slice(0, limit) : project.files;

      for (const fileInfo of projectFiles) {
        const prepared = conversationMiner.prepareConversationForMining(fileInfo.path, fileInfo.sessionId);

        if (!prepared.shouldMine) {
          skipped.push({ sessionId: fileInfo.sessionId, projectSlug: project.projectSlug, reason: prepared.reason });
        } else {
          extractionSessions.push({
            sessionId: fileInfo.sessionId,
            sessionPath: fileInfo.path,
            projectSlug: project.projectSlug,
            mtime: fileInfo.mtime,
            chunkCount: prepared.chunkCount,
            contentHash: prepared.contentHash,
            extractionRequests: prepared.extractionRequests
          });
        }
      }
    }

    output({
      status: 'ready',
      allProjects: true,
      projectsScanned: projects.length,
      skippedNonGSD,
      filesFound: totalFiles,
      sessionsReady: extractionSessions.length,
      sessionsSkipped: skipped.length,
      sessions: extractionSessions,
      skipped
    }, raw);
    return;
  }

  // Single project mode (current CWD)
  const { files, projectSlugDir, error: discoverError } = conversationMiner.discoverProjectConversations(
    cwd,
    { maxAgeDays, includeSubagents }
  );

  if (discoverError) {
    output({ status: 'error', reason: discoverError, projectSlugDir }, raw);
    return;
  }

  // Apply limit
  const targetFiles = limit > 0 ? files.slice(0, limit) : files;

  const extractionSessions = [];
  const skipped = [];

  for (const fileInfo of targetFiles) {
    const prepared = conversationMiner.prepareConversationForMining(fileInfo.path, fileInfo.sessionId);

    if (!prepared.shouldMine) {
      skipped.push({ sessionId: fileInfo.sessionId, reason: prepared.reason });
    } else {
      extractionSessions.push({
        sessionId: fileInfo.sessionId,
        sessionPath: fileInfo.path,
        mtime: fileInfo.mtime,
        chunkCount: prepared.chunkCount,
        contentHash: prepared.contentHash,
        extractionRequests: prepared.extractionRequests
      });
    }
  }

  output({
    status: 'ready',
    filesFound: files.length,
    filesTargeted: targetFiles.length,
    sessionsReady: extractionSessions.length,
    sessionsSkipped: skipped.length,
    sessions: extractionSessions,
    skipped
  }, raw);
}

/**
 * store-conversation-result <session-id> <results-json> [--content-hash <hash>]
 *
 * Accepts Haiku extraction results from conversation mining and persists them
 * to the knowledge DB. Marks the conversation as analyzed in the
 * conversation-specific analysis log (.planning/knowledge/.conversation-analysis-log.jsonl)
 * — completely separate from the Telegram session analysis log.
 */
async function cmdStoreConversationResult(cwd, args, raw) {
  // Strip --content-hash flag before extracting sessionId and resultsArg
  const contentHashIdx = args.indexOf('--content-hash');
  const contentHash = contentHashIdx !== -1 ? args[contentHashIdx + 1] : 'unknown';
  // Build filtered args without --content-hash and its value (only filter when flag present)
  const filteredArgs = contentHashIdx !== -1
    ? args.filter((_, i) => i !== contentHashIdx && i !== contentHashIdx + 1)
    : args;

  const sessionId = filteredArgs[0];
  const resultsArg = filteredArgs.slice(1).join(' ');

  if (!sessionId) {
    output({ status: 'error', reason: 'Usage: store-conversation-result <session-id> <results-json> [--content-hash <hash>]' }, raw);
    return;
  }

  if (!resultsArg) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: ['No results JSON provided'] }, raw);
    return;
  }

  // Parse the results JSON (may be a JSON string or path to JSON file)
  let results = [];
  try {
    results = JSON.parse(resultsArg);
  } catch {
    const resolvedPath = path.isAbsolute(resultsArg)
      ? resultsArg
      : path.join(cwd, resultsArg);
    try {
      const fileContent = fs.readFileSync(resolvedPath, 'utf8');
      results = JSON.parse(fileContent);
    } catch (err) {
      output({ stored: 0, skipped: 0, evolved: 0, errors: ['Failed to parse results JSON: ' + err.message] }, raw);
      return;
    }
  }

  // Handle empty results
  if (!Array.isArray(results) || results.length === 0) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: [] }, raw);
    return;
  }

  // Lazy-require session-analyzer.js
  let parseExtractionResult;
  try {
    const analyzer = require(path.join(__dirname, 'session-analyzer.js'));
    parseExtractionResult = analyzer.parseExtractionResult;
  } catch (err) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: ['Failed to load session-analyzer.js: ' + err.message] }, raw);
    return;
  }

  // Lazy-require knowledge-writer.js
  let storeInsights;
  try {
    const writer = require(path.join(__dirname, 'knowledge-writer.js'));
    storeInsights = writer.storeInsights;
  } catch (err) {
    output({ stored: 0, skipped: 0, evolved: 0, errors: ['Failed to load knowledge-writer.js: ' + err.message] }, raw);
    return;
  }

  // Collect all insights from all result objects
  const allInsights = [];
  const parseErrors = [];

  for (const resultObj of results) {
    if (!resultObj || typeof resultObj.type !== 'string' || typeof resultObj.result !== 'string') {
      parseErrors.push('Invalid result object (missing type or result field)');
      continue;
    }

    const { insights, errors } = parseExtractionResult(resultObj.type, resultObj.result);
    allInsights.push(...insights);
    parseErrors.push(...errors);
  }

  // Store all insights in knowledge DB (pass conversationId for context tracking)
  const { resolveProjectSlug: resolveProjectSlugConv } = require(path.join(__dirname, 'knowledge-writer.js'));
  let storeResult = { stored: 0, skipped: 0, evolved: 0, errors: [] };
  if (allInsights.length > 0) {
    try {
      storeResult = await storeInsights(allInsights, {
        sessionId,
        conversationId: sessionId,
        scope: 'global',
        projectSlug: resolveProjectSlugConv(cwd)
      });
    } catch (err) {
      storeResult.errors.push('storeInsights failed: ' + err.message);
    }
  }

  // Mark conversation as analyzed in the conversation-specific analysis log
  const totalInsights = storeResult.stored + storeResult.evolved;
  const conversationLogPath = path.join(require('os').homedir(), '.claude', 'knowledge', '.conversation-analysis-log.jsonl');
  try {
    // Ensure parent directory exists
    const logDir = path.dirname(conversationLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logEntry = JSON.stringify({
      session_id: sessionId,
      content_hash: contentHash,
      analyzed_at: new Date().toISOString(),
      insight_count: totalInsights,
      version: 1
    }) + '\n';
    fs.appendFileSync(conversationLogPath, logEntry, 'utf8');
  } catch (err) {
    storeResult.errors.push('Failed to write conversation analysis log: ' + err.message);
  }

  output({
    stored: storeResult.stored,
    skipped: storeResult.skipped,
    evolved: storeResult.evolved,
    errors: [...parseErrors, ...storeResult.errors]
  }, raw);
}

// ─── Knowledge Migration ──────────────────────────────────────────────────────

/**
 * migrate-knowledge
 *
 * Scans ~/.claude/projects/ for all project directories, finds any per-project
 * .planning/knowledge/<user>.db files, copies all entries to the global DB,
 * and reports results. Does NOT delete old DBs.
 */
async function cmdMigrateKnowledge(_cwd, _args, raw) {
  const os = require('os');
  const homedir = os.homedir();
  const username = os.userInfo().username;

  // Load better-sqlite3 directly (knowledge-db.js is not used for legacy path)
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    output({ status: 'error', reason: 'better-sqlite3 not installed: ' + err.message }, raw);
    return;
  }

  // Open the global DB via knowledge-db.js
  let knowledgeDb;
  try {
    knowledgeDb = require(path.join(__dirname, 'knowledge-db.js'));
  } catch (err) {
    output({ status: 'error', reason: 'Failed to load knowledge-db.js: ' + err.message }, raw);
    return;
  }

  let globalConn;
  try {
    globalConn = knowledgeDb.openKnowledgeDB('global');
  } catch (err) {
    output({ status: 'error', reason: 'Failed to open global knowledge DB: ' + err.message }, raw);
    return;
  }

  const globalDB = globalConn.db;

  // Scan ~/.claude/projects/ for slug directories
  const projectsDir = path.join(homedir, '.claude', 'projects');
  let slugDirs = [];
  try {
    slugDirs = fs.readdirSync(projectsDir).filter(entry => {
      return fs.statSync(path.join(projectsDir, entry)).isDirectory();
    });
  } catch (err) {
    // ~/.claude/projects/ may not exist — that's fine
    output({
      status: 'ok',
      migrated: 0,
      projects: [],
      total_entries: 0,
      message: 'No projects directory found at ' + projectsDir
    }, raw);
    return;
  }

  const results = [];
  let totalMigrated = 0;

  for (const slug of slugDirs) {
    // Reverse slug to filesystem path: leading - means leading /, all - are /
    const reversed = slug.replace(/-/g, '/');
    const projectPath = reversed; // Already starts with /

    const legacyDbPath = path.join(projectPath, '.planning', 'knowledge', `${username}.db`);

    // Check if legacy DB exists
    if (!fs.existsSync(legacyDbPath)) {
      continue;
    }

    // Open the legacy DB directly
    let legacyDB;
    try {
      legacyDB = new Database(legacyDbPath, { readonly: true });
    } catch (err) {
      results.push({ project: projectPath, status: 'error', reason: 'Failed to open legacy DB: ' + err.message });
      continue;
    }

    let rows = [];
    try {
      // Check if knowledge table exists in legacy DB
      const tableExists = legacyDB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge'"
      ).get();

      if (!tableExists) {
        legacyDB.close();
        results.push({ project: projectPath, status: 'skipped', reason: 'No knowledge table in legacy DB' });
        continue;
      }

      rows = legacyDB.prepare('SELECT * FROM knowledge').all();
    } catch (err) {
      legacyDB.close();
      results.push({ project: projectPath, status: 'error', reason: 'Failed to read legacy DB: ' + err.message });
      continue;
    }

    legacyDB.close();

    if (rows.length === 0) {
      results.push({ project: projectPath, status: 'ok', migrated: 0 });
      continue;
    }

    // Get the column list from the global DB (may have project_slug, legacy won't)
    const globalColumns = globalDB.prepare("PRAGMA table_info(knowledge)").all().map(c => c.name);
    // Determine which columns exist in the legacy rows
    const legacyColumns = Object.keys(rows[0]);
    // Only copy columns that exist in both
    const sharedColumns = legacyColumns.filter(c => globalColumns.includes(c));

    // Prepare the insert statement
    const placeholders = sharedColumns.map(() => '?').join(', ');
    const columnList = sharedColumns.join(', ');
    const insertStmt = globalDB.prepare(
      `INSERT OR IGNORE INTO knowledge (${columnList}) VALUES (${placeholders})`
    );

    // Use transaction for bulk insert
    let copiedCount = 0;
    try {
      const insertMany = globalDB.transaction((rows) => {
        for (const row of rows) {
          const values = sharedColumns.map(c => row[c]);
          insertStmt.run(values);
          copiedCount++;
        }
      });
      insertMany(rows);
    } catch (err) {
      results.push({ project: projectPath, status: 'error', reason: 'Transaction failed: ' + err.message, migrated: copiedCount });
      continue;
    }

    // Verify: global DB count >= rows copied from this source
    const globalCount = globalDB.prepare('SELECT COUNT(*) as cnt FROM knowledge').get().cnt;
    if (globalCount < copiedCount) {
      results.push({
        project: projectPath,
        status: 'warning',
        reason: `Global count (${globalCount}) less than copied (${copiedCount}) — possible duplicates filtered`,
        migrated: copiedCount
      });
    } else {
      results.push({ project: projectPath, status: 'ok', migrated: copiedCount });
    }

    totalMigrated += copiedCount;
  }

  output({
    status: 'ok',
    migrated: totalMigrated,
    projects: results,
    total_entries: totalMigrated,
    note: 'Old per-project DBs were NOT deleted. Remove .planning/knowledge/ manually when satisfied.'
  }, raw);
}

// ─── Knowledge Query ─────────────────────────────────────────────────────────

/**
 * query-knowledge <question> [--project <slug>]
 *
 * Search the global knowledge DB for relevant past decisions, lessons, and summaries.
 * Returns top 5 results in the locked output schema for agent-readable consumption.
 *
 * Output schema per result:
 *   { question, answer, confidence, project_slug, source_type, created_at }
 *
 * Zero results: { results: [], no_results: true, query: "..." }
 */
async function cmdQueryKnowledge(cwd, args, raw) {
  // Parse --project flag
  const projectFlagIdx = args.indexOf('--project');
  const projectSlug = projectFlagIdx !== -1 ? args[projectFlagIdx + 1] : null;

  // Build the question string from remaining args (excluding --project and its value)
  const filteredArgs = args.filter((_, i) => {
    if (projectFlagIdx === -1) return true;
    return i !== projectFlagIdx && i !== projectFlagIdx + 1;
  });

  const questionString = filteredArgs.join(' ').trim();

  if (!questionString) {
    output({ status: 'error', reason: 'Usage: query-knowledge <question> [--project <slug>]' }, raw);
    return;
  }

  // Lazy-require knowledge-db.js
  let knowledgeDb;
  try {
    knowledgeDb = require(path.join(__dirname, 'knowledge-db.js'));
  } catch (err) {
    output({ results: [], no_results: true, query: questionString, error: 'Failed to load knowledge-db.js: ' + err.message }, raw);
    return;
  }

  // Open the global knowledge DB
  let conn;
  try {
    conn = knowledgeDb.openKnowledgeDB('global');
  } catch (err) {
    // DB may not exist yet (no knowledge stored)
    output({ results: [], no_results: true, query: questionString, note: 'Global knowledge DB not found or could not be opened: ' + err.message }, raw);
    return;
  }

  // Lazy-require knowledge-search.js
  let searchKnowledge;
  try {
    searchKnowledge = require(path.join(__dirname, 'knowledge-search.js')).searchKnowledgeAsync;
  } catch (err) {
    output({ results: [], no_results: true, query: questionString, error: 'Failed to load knowledge-search.js: ' + err.message }, raw);
    return;
  }

  // Execute search — top 5 results, no confidence threshold filtering
  let rawResults = [];
  try {
    rawResults = await searchKnowledge(conn, questionString, {
      limit: 5,
      project_slug: projectSlug || null
    });
  } catch (err) {
    output({ results: [], no_results: true, query: questionString, error: 'Search failed: ' + err.message }, raw);
    return;
  }

  if (!rawResults || rawResults.length === 0) {
    output({ results: [], no_results: true, query: questionString }, raw);
    return;
  }

  // Map to locked output schema. `id` is additive (Phase 49-02) — every
  // other field is unchanged so an agent can call `knowledge mark-wrong <id>`
  // later if this specific answer proves wrong, without breaking existing callers.
  const results = rawResults.map(r => ({
    id: r.id,
    question: questionString,
    answer: r.content,
    confidence: (r.metadata && r.metadata.confidence) ? r.metadata.confidence : 0.7,
    project_slug: r.project_slug || null,
    source_type: r.type,
    created_at: r.created_at
  }));

  // Track access for returned results so stats reflect actual usage
  try {
    const knowledgeLifecycle = require(path.join(__dirname, 'knowledge-lifecycle.js'));
    const ids = rawResults.map(r => r.id).filter(Boolean);
    if (ids.length > 0) knowledgeLifecycle.trackAccessBatch(conn.db, ids);
  } catch (_) {
    // Non-fatal — tracking failure must not break query results
  }

  // Emit feature-level telemetry for successful knowledge queries
  try {
    if (cwd && typeof cwd === 'string') {
      appendEvent(findProjectRoot(cwd), {
        type: EVENT_TYPES.KNOWLEDGE_QUERY,
        query: questionString,
        result_count: results.length,
        project_slug: projectSlug || null
      });
    }
  } catch (_) {
    // Telemetry must never break the feature
  }

  output({ results, query: questionString }, raw);
}


// ─── Service Health Helpers ───────────────────────────────────────────────────

function getServicePidsDir(cwd) {
  return path.join(cwd, '.planning', 'service-pids');
}

function getPidFilePath(cwd, name) {
  return path.join(getServicePidsDir(cwd), name + '.pid');
}

function readServicePid(cwd, name) {
  const pidFile = getPidFilePath(cwd, name);
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writeServicePid(cwd, name, pid) {
  const dir = getServicePidsDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getPidFilePath(cwd, name), String(pid), 'utf8');
}

function removeServicePid(cwd, name) {
  const pidFile = getPidFilePath(cwd, name);
  try { fs.unlinkSync(pidFile); } catch (e) { /* already gone */ }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

async function pollHealthEndpoint(url, intervalMs, timeoutMs) {
  const mod = await import(url.startsWith('https') ? 'https' : 'http');
  const http = mod.default || mod;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise(function(resolve, reject) {
        const req = http.get(url, function(res) {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 400) resolve(true);
          else reject(new Error('HTTP ' + res.statusCode));
        });
        req.on('error', reject);
        req.setTimeout(2000, function() { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch (e) {
      await new Promise(function(r) { setTimeout(r, intervalMs); });
    }
  }
  return false;
}

// Pick the entry for `name` from a list of {name} objects. 'default' is the only entry, or an entry named default.
function pickNamed(list, name) {
  if (name === 'default') {
    if (list.length === 1) return list[0];
    return list.find((s) => s.name === 'default') || null;
  }
  return list.find((s) => s.name === name) || null;
}

// stack.services[] from the profile, as the service-health shape. The health path is appended to the url.
function serviceFromProfile(cwd, name) {
  const loaded = projectProfile.loadProfile(cwd);
  const services = loaded.error ? undefined : projectProfile.getProfileValue(loaded, 'stack.services');
  if (!Array.isArray(services) || services.length === 0) return null;
  const svc = pickNamed(services, name);
  if (!svc) return null;
  const health = svc.health;
  const healthUrl = !health ? svc.url : /^https?:\/\//.test(health) ? health : svc.url.replace(/\/+$/, '') + (health.startsWith('/') ? '' : '/') + health;
  return { name: svc.name, health_url: healthUrl, health_cmd: svc.health_cmd || null, start: svc.launch, source: 'stack.services' };
}

// Profile first (stack.services), then dev_servers in config.json. No default URL: a server with neither a
// health_url nor a port has no health URL.
function getDevServerConfig(cwd, name) {
  const fromProfile = serviceFromProfile(cwd, name);
  if (fromProfile) return fromProfile;
  const config = loadConfig(cwd);
  const devServers = config.dev_servers || {};
  const entry = pickNamed(Object.entries(devServers).map(([key, cfg]) => Object.assign({ name: key }, cfg)), name);
  return entry ? Object.assign({ source: 'dev_servers' }, entry) : null;
}

function healthUrlOf(serverCfg) {
  if (serverCfg.health_url) return serverCfg.health_url;
  return serverCfg.port ? 'http://localhost:' + serverCfg.port : null;
}

function serviceNames(cwd) {
  const loaded = projectProfile.loadProfile(cwd);
  const services = loaded.error ? [] : projectProfile.getProfileValue(loaded, 'stack.services');
  const profileNames = Array.isArray(services) ? services.map((s) => s.name) : [];
  const devNames = Object.keys(loadConfig(cwd).dev_servers || {});
  return [...new Set([...profileNames, ...devNames])];
}

async function cmdServiceHealth(cwd, args, raw) {
  const subCmd = args[0];
  const serverName = args[1] || 'default';

  if (subCmd === 'start') {
    const serverCfg = getDevServerConfig(cwd, serverName);
    if (!serverCfg) {
      output({ status: 'no_config', name: serverName, message: 'No stack.services entry or dev_servers.' + serverName + ' in config.json' }, raw);
      return;
    }

    const healthUrl = healthUrlOf(serverCfg);
    if (!healthUrl) {
      output({ status: 'no_health_url', name: serverName, message: 'Set stack.services[].url or dev_servers.' + serverName + '.health_url' }, raw);
      return;
    }

    const existingPid = readServicePid(cwd, serverName);
    if (existingPid && isProcessRunning(existingPid)) {
      const alreadyUp = await pollHealthEndpoint(healthUrl, 500, 3000);
      if (alreadyUp) {
        output({ status: 'already_running', name: serverName, pid: existingPid, health_url: healthUrl }, raw);
        return;
      }
    }

    const preCheck = await pollHealthEndpoint(healthUrl, 500, 3000);
    if (preCheck) {
      output({ status: 'already_running', name: serverName, health_url: healthUrl, pid: null }, raw);
      return;
    }

    const startCmd = serverCfg.start;
    if (!startCmd) {
      error('service-health start: no launch command for ' + serverName + ' (stack.services[].launch or dev_servers.' + serverName + '.start)');
      return;
    }

    const { spawn } = require('child_process');
    const child = spawn('sh', ['-c', startCmd], {
      cwd: cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    writeServicePid(cwd, serverName, child.pid);

    const ready = await pollHealthEndpoint(healthUrl, 2000, 60000);
    if (ready) {
      output({ status: 'started', name: serverName, pid: child.pid, health_url: healthUrl }, raw);
    } else {
      output({ status: 'start_timeout', name: serverName, pid: child.pid, health_url: healthUrl, message: 'Server did not respond within 60s' }, raw);
    }

  } else if (subCmd === 'stop') {
    const pid = readServicePid(cwd, serverName);
    if (!pid) {
      output({ status: 'not_running', name: serverName, message: 'No PID file found' }, raw);
      return;
    }
    if (!isProcessRunning(pid)) {
      removeServicePid(cwd, serverName);
      output({ status: 'already_stopped', name: serverName, pid: pid }, raw);
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
      let stopped = false;
      for (let i = 0; i < 25; i++) {
        await new Promise(function(r) { setTimeout(r, 200); });
        if (!isProcessRunning(pid)) { stopped = true; break; }
      }
      if (!stopped) {
        try { process.kill(pid, 'SIGKILL'); } catch (e) { /* already gone */ }
      }
      removeServicePid(cwd, serverName);
      output({ status: 'stopped', name: serverName, pid: pid, graceful: stopped }, raw);
    } catch (e) {
      removeServicePid(cwd, serverName);
      output({ status: 'stop_error', name: serverName, pid: pid, error: e.message }, raw);
    }

  } else if (subCmd === 'status') {
    const serverCfg = getDevServerConfig(cwd, serverName);
    const healthUrl = serverCfg ? healthUrlOf(serverCfg) : null;
    const pid = readServicePid(cwd, serverName);
    const pidRunning = pid ? isProcessRunning(pid) : false;
    const healthOk = healthUrl ? await pollHealthEndpoint(healthUrl, 500, 3000) : null;

    output({
      name: serverName,
      pid: pid || null,
      pid_running: pidRunning,
      health_url: healthUrl,
      health_cmd: serverCfg ? serverCfg.health_cmd || null : null,
      health_ok: healthOk,
      status: (pidRunning || healthOk) ? 'running' : 'stopped',
    }, raw);

  } else if (subCmd === 'start-all') {
    const names = serviceNames(cwd);
    if (names.length === 0) {
      output({ status: 'no_servers', message: 'No stack.services or dev_servers in config' }, raw);
      return;
    }
    const results = [];
    for (const name of names) {
      await cmdServiceHealth(cwd, ['start', name], true);
      results.push(name);
    }
    output({ status: 'done', started: results }, raw);

  } else if (subCmd === 'stop-all') {
    const dir = getServicePidsDir(cwd);
    if (!fs.existsSync(dir)) {
      output({ status: 'no_pid_files', message: 'No service PID files found' }, raw);
      return;
    }
    const pidFiles = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.pid'); });
    const results = [];
    for (const pf of pidFiles) {
      const name = pf.replace(/\.pid$/, '');
      await cmdServiceHealth(cwd, ['stop', name], true);
      results.push(name);
    }
    output({ status: 'done', stopped: results }, raw);

  } else {
    error('service-health: unknown subcommand ' + JSON.stringify(subCmd) + '. Available: start, stop, status, start-all, stop-all');
  }
}

// ─── Skew Detection (MILE-25) ──────────────────────────────────────────
// Pure function -- no I/O. Compares an installed manifest's file->hash map
// against a freshly-computed current-tree map. Files present in installed
// but absent from current are flagged 'missing_in_source'; files with a
// different hash are flagged 'hash_mismatch'. Files present ONLY in
// current (new files added since the manifest was written) are NOT drift.
function computeManifestDrift(installedFiles, currentFiles) {
  const drifted = [];
  for (const [relPath, installedHash] of Object.entries(installedFiles || {})) {
    const currentHash = (currentFiles || {})[relPath];
    if (currentHash === undefined) {
      drifted.push({ path: relPath, reason: 'missing_in_source' });
    } else if (currentHash !== installedHash) {
      drifted.push({ path: relPath, reason: 'hash_mismatch' });
    }
  }
  return { clean: drifted.length === 0, drifted };
}

// Deliberately NOT cross-requiring bin/install.js's fileHash/generateManifest:
// that file only exists in dev checkouts, not installed deployments, and a
// hard require would need brittle existence-guarding for zero benefit over
// duplicating this 3-line SHA256-over-file-bytes primitive verbatim.
function hashFileSync(filePath) {
  const content = fs.readFileSync(filePath);
  return require('crypto').createHash('sha256').update(content).digest('hex');
}

// I/O: walks the same three subtrees writeManifest() hashes (get-shit-done/,
// commands/gsd/, agents/gsd-*.md) under repoRoot, using the EXACT SAME key
// prefixes so the result lines up 1:1 against an installed manifest's `files`.
function buildCurrentSourceManifest(repoRoot) {
  const result = {};
  function walk(dir, baseDir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, baseDir, prefix);
      } else {
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        result[prefix + relPath] = hashFileSync(fullPath);
      }
    }
  }
  walk(path.join(repoRoot, 'get-shit-done'), path.join(repoRoot, 'get-shit-done'), 'get-shit-done/');
  walk(path.join(repoRoot, 'commands', 'gsd'), path.join(repoRoot, 'commands', 'gsd'), 'commands/gsd/');
  const agentsDir = path.join(repoRoot, 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (file.startsWith('gsd-') && file.endsWith('.md')) {
        result['agents/' + file] = hashFileSync(path.join(agentsDir, file));
      }
    }
  }
  return result;
}

const MANIFEST_NAME_FOR_DOCTOR = 'gsd-file-manifest.json';

function cmdDoctor(cwd, options, raw) {
  const homeDir = require('os').homedir();
  const configDir = options.configDir || path.join(homeDir, '.claude');
  const manifestPath = path.join(configDir, 'gsd-file-manifest.json');

  if (!fs.existsSync(manifestPath)) {
    output({ ok: false, skipped: true, reason: 'no_manifest', message: 'No installed manifest found — not installed, skew check skipped' }, raw);
    return;
  }
  const parseResult = safeJsonParse(fs.readFileSync(manifestPath, 'utf-8'), MANIFEST_NAME_FOR_DOCTOR);
  if (!parseResult.ok) {
    output({ ok: false, reason: 'corrupted_manifest', error: parseResult.error }, raw);
    return;
  }
  const manifest = parseResult.value;

  const isSourceCheckout = fs.existsSync(path.join(cwd, 'get-shit-done', 'bin', 'gsd-tools.js'));
  if (!isSourceCheckout) {
    output({ ok: true, reason: 'not_a_source_checkout', message: 'Not running from a GSD source checkout — skipping skew check' }, raw);
    return;
  }

  // Fast path: compare git SHAs directly if both are available.
  if (manifest.source_git_sha) {
    try {
      const currentSha = require('child_process').execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
      if (currentSha === manifest.source_git_sha) {
        output({ ok: true, clean: true, drifted: [], method: 'git_sha', current_sha: currentSha }, raw);
        return;
      }
    } catch (_) { /* git unavailable — fall through to full hash diff */ }
  }

  // Full path: re-hash the current tree and diff against the installed manifest.
  const currentManifest = buildCurrentSourceManifest(cwd);
  const diff = computeManifestDrift(manifest.files || {}, currentManifest);
  if (!diff.clean) {
    console.warn(`WARNING: ${diff.drifted.length} file(s) drifted between installed copy and source checkout:`);
    for (const d of diff.drifted) console.warn(`  - ${d.path} (${d.reason})`);
  }
  output({ ok: true, clean: diff.clean, drifted: diff.drifted, method: 'file_hash' }, raw);
}

// ─── Self-Report Telemetry (MILE-26) ───────────────────────────────────
const TELEMETRY_DIR = 'telemetry';
const TELEMETRY_FILE = 'agent-reports.jsonl';
const TELEMETRY_FIELDS_DEFAULTS = {
  context_pressure: null,
  instructions_not_followed: [],
  ambiguities: [],
  tool_errors_swallowed: 0
};

function getTelemetryPath(cwd) {
  return path.join(cwd, '.planning', TELEMETRY_DIR, TELEMETRY_FILE);
}

// I/O: appends one JSONL line. Missing optional fields fall back to safe
// defaults (never throws on a caller omitting one of the 4 fields) --
// agent/phase/timestamp are always attached fresh, never trusted from input.
function appendTelemetryReport(cwd, agent, phase, fields) {
  const telemetryPath = getTelemetryPath(cwd);
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  const entry = {
    agent,
    phase,
    timestamp: new Date().toISOString(),
    context_pressure: (fields && fields.context_pressure !== undefined) ? fields.context_pressure : TELEMETRY_FIELDS_DEFAULTS.context_pressure,
    instructions_not_followed: (fields && Array.isArray(fields.instructions_not_followed)) ? fields.instructions_not_followed : TELEMETRY_FIELDS_DEFAULTS.instructions_not_followed,
    ambiguities: (fields && Array.isArray(fields.ambiguities)) ? fields.ambiguities : TELEMETRY_FIELDS_DEFAULTS.ambiguities,
    tool_errors_swallowed: (fields && typeof fields.tool_errors_swallowed === 'number') ? fields.tool_errors_swallowed : TELEMETRY_FIELDS_DEFAULTS.tool_errors_swallowed
  };
  fs.appendFileSync(telemetryPath, JSON.stringify(entry) + '\n');
  return entry;
}

// I/O: reads all reports, skip-and-warn per malformed line (matches the
// established local convention for JSONL log reads, e.g. validation-log.jsonl).
function readTelemetryReports(cwd) {
  const telemetryPath = getTelemetryPath(cwd);
  if (!fs.existsSync(telemetryPath)) return [];
  const lines = fs.readFileSync(telemetryPath, 'utf-8').split('\n');
  const reports = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(line, TELEMETRY_FILE);
    if (parsed.ok) reports.push(parsed.value);
    else console.warn(`Warning: skipping malformed telemetry line: ${parsed.error.message}`);
  }
  return reports;
}

// Pure function -- no I/O. Aggregates an array of report objects (shape
// matches appendTelemetryReport's entry) into summary stats.
function summarizeTelemetryReports(reports) {
  if (!reports || reports.length === 0) {
    return { count: 0, avg_context_pressure: null, total_tool_errors_swallowed: 0, instructions_not_followed_by_rule: {}, top_ambiguities: [] };
  }
  let pressureSum = 0, pressureCount = 0, toolErrorsTotal = 0;
  const byRule = {};
  const ambiguityCounts = {};
  for (const r of reports) {
    if (typeof r.context_pressure === 'number') { pressureSum += r.context_pressure; pressureCount++; }
    toolErrorsTotal += (typeof r.tool_errors_swallowed === 'number') ? r.tool_errors_swallowed : 0;
    for (const item of (r.instructions_not_followed || [])) {
      const rule = (item && item.rule) ? item.rule : String(item);
      byRule[rule] = (byRule[rule] || 0) + 1;
    }
    for (const amb of (r.ambiguities || [])) {
      const key = typeof amb === 'string' ? amb : JSON.stringify(amb);
      ambiguityCounts[key] = (ambiguityCounts[key] || 0) + 1;
    }
  }
  const topAmbiguities = Object.entries(ambiguityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));
  return {
    count: reports.length,
    avg_context_pressure: pressureCount > 0 ? pressureSum / pressureCount : null,
    total_tool_errors_swallowed: toolErrorsTotal,
    instructions_not_followed_by_rule: byRule,
    top_ambiguities: topAmbiguities
  };
}

// Fixed, case-insensitive substring deny-list: matching ANY of these means
// the failure is environment/infra-shaped (missing file, network, auth, disk,
// git conflict), not a capability gap -- escalating to a higher model tier
// cannot fix these, so classifyFailure/decideEscalation must never escalate
// on them. Unmatched text defaults to capability_related:true (the safer
// default for a self-healing system -- an unclassified failure is assumed to
// be a capability gap the next tier up might solve).
const NON_CAPABILITY_PATTERNS = [
  'ENOENT', 'no such file', 'command not found', 'permission denied', 'EACCES',
  'ECONNREFUSED', 'getaddrinfo', 'network error', 'env var', 'environment variable',
  '.env', 'ENOSPC', 'disk full', 'git conflict', 'merge conflict'
];

// Pure. Never throws -- empty/undefined input defaults to capability_related:true.
function classifyFailure(errorSummary) {
  const text = (errorSummary || '').toLowerCase();
  for (const pattern of NON_CAPABILITY_PATTERNS) {
    if (text.includes(pattern.toLowerCase())) {
      return { capability_related: false, matched_pattern: pattern };
    }
  }
  return { capability_related: true, matched_pattern: null };
}

// Pure, ladder-bounded escalation decision. `failsAtTier` counts the task's failures at currentTier (1 = the first):
// a task is retried once on the same tier and escalates, or is rescued, only on its second failure there. Uses getNextTier/getTiers from
// model-registry.js -- the SINGLE source of truth for the escalation ladder;
// never re-declares a second hardcoded ladder here. Bound: one retry per
// tier (escalationsUsed caps at getTiers().length - 1), non-capability
// failures never escalate, and the ladder ends at sonnet. The one rung past
// it is the rescue: the second capability failure at sonnet returns rescue:true with
// `to` = topAlias (the caller's resolved ruling_model), a single top-model
// debugger dispatch, never an executor retry; `rescuesUsed` >= 1 withholds it (once per task).
function decideEscalation(currentTier, classification, escalationsUsed, topAlias, failsAtTier = 1, rescuesUsed = 0) {
  if (!classification || classification.capability_related === false) {
    return { escalate: false, next_tier: null, reason: 'non_capability_failure' };
  }
  if ((failsAtTier || 1) < 2) return { escalate: false, next_tier: null, retry: true, reason: 'retry_same_tier' };
  const stop = (reason) => ({
    escalate: false, next_tier: null, reason,
    ...(currentTier === 'sonnet' && topAlias && !(rescuesUsed >= 1) ? { rescue: true, to: topAlias } : {})
  });
  const maxEscalations = getTiers().length - 1;
  if ((escalationsUsed || 0) >= maxEscalations) return stop('escalation_bound_reached');
  const nextTier = getNextTier(currentTier);
  if (!nextTier) return stop('ladder_exhausted');
  return { escalate: true, next_tier: nextTier, reason: 'capability_failure' };
}

// ─── CLI Router ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const rawIndex = args.indexOf('--raw');
  const raw = rawIndex !== -1;
  if (rawIndex !== -1) args.splice(rawIndex, 1);

  // A flag token is a flag only outside value position: not directly after another `--flag`, and (for -h) not the
  // positional commit message.
  const asValue = (i) => i > 0 && /^--[\w-]+$/.test(args[i - 1]);

  // Global --cwd <dir>: run every command against that project (process.cwd() everywhere follows).
  const cwdIndex = args.findIndex((a, i) => a === '--cwd' && !asValue(i));
  if (cwdIndex !== -1) {
    const target = args[cwdIndex + 1];
    if (!target || target.startsWith('--')) error('--cwd requires a directory');
    args.splice(cwdIndex, 2);
    try { process.chdir(path.resolve(target)); } catch (e) { error(`--cwd ${target}: ${e.message}`); }
  }

  const command = args[0];
  const cwd = process.cwd();

  // --help / -h after the command prints usage and does nothing else (`commit --help` once became a commit message).
  const helpAt = (i) => (args[i] === '--help' || args[i] === '-h') && !asValue(i) && !(command === 'commit' && i === 1 && args[i] === '-h');
  if (command && command !== 'help' && args.some((_, i) => i >= 1 && helpAt(i))) {
    console.log(command === 'commit'
      ? COMMIT_USAGE
      : `Usage: gsd-tools ${command} <subcommand> [args] [--raw] [--cwd <dir>]\nRun gsd-tools ${command} without args for subcommand help. --help performs no action.`);
    process.exit(0);
  }

  if (!command || command === '--help' || command === 'help') {
    console.log('Usage: gsd-tools <command> [args] [--raw] [--cwd <dir>]');
    console.log('Commands: state, roadmap, execution-log, quota, config, phases, frontmatter, template, commit, verify, health, init, and more.');
    console.log('Run gsd-tools <command> without args for subcommand help.');
    process.exit(0);
  }

  switch (command) {
    case 'state': {
      const subcommand = args[1];
      if (subcommand === 'update') {
        cmdStateUpdate(cwd, args[2], args[3]);
      } else if (subcommand === 'get') {
        cmdStateGet(cwd, args[2], raw);
      } else if (subcommand === 'patch') {
        const patches = {};
        for (let i = 2; i < args.length; i += 2) {
          const key = args[i].replace(/^--/, '');
          const value = args[i + 1];
          if (key && value !== undefined) {
            patches[key] = value;
          }
        }
        cmdStatePatch(cwd, patches, raw);
      } else if (subcommand === 'advance-plan') {
        const phIdx = args.indexOf('--phase');
        cmdStateAdvancePlan(cwd, raw, { phase: phIdx !== -1 ? args[phIdx + 1] : null });
      } else if (subcommand === 'record-metric') {
        const phaseIdx = args.indexOf('--phase');
        const planIdx = args.indexOf('--plan');
        const durationIdx = args.indexOf('--duration');
        const tasksIdx = args.indexOf('--tasks');
        const filesIdx = args.indexOf('--files');
        cmdStateRecordMetric(cwd, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          plan: planIdx !== -1 ? args[planIdx + 1] : null,
          duration: durationIdx !== -1 ? args[durationIdx + 1] : null,
          tasks: tasksIdx !== -1 ? args[tasksIdx + 1] : null,
          files: filesIdx !== -1 ? args[filesIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'update-progress') {
        cmdStateUpdateProgress(cwd, raw);
      } else if (subcommand === 'add-decision') {
        const phaseIdx = args.indexOf('--phase');
        const summaryIdx = args.indexOf('--summary');
        const rationaleIdx = args.indexOf('--rationale');
        cmdStateAddDecision(cwd, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          summary: summaryIdx !== -1 ? args[summaryIdx + 1] : null,
          rationale: rationaleIdx !== -1 ? args[rationaleIdx + 1] : '',
        }, raw);
      } else if (subcommand === 'add-blocker') {
        const textIdx = args.indexOf('--text');
        cmdStateAddBlocker(cwd, textIdx !== -1 ? args[textIdx + 1] : null, raw);
      } else if (subcommand === 'resolve-blocker') {
        const textIdx = args.indexOf('--text');
        cmdStateResolveBlocker(cwd, textIdx !== -1 ? args[textIdx + 1] : null, raw);
      } else if (subcommand === 'record-session') {
        const stoppedIdx = args.indexOf('--stopped-at');
        const resumeIdx = args.indexOf('--resume-file');
        cmdStateRecordSession(cwd, {
          stopped_at: stoppedIdx !== -1 ? args[stoppedIdx + 1] : null,
          resume_file: resumeIdx !== -1 ? args[resumeIdx + 1] : 'None',
        }, raw);
      } else {
        cmdStateLoad(cwd, raw);
      }
      break;
    }

    case 'resolve-model': {
      cmdResolveModel(cwd, args[1], raw);
      break;
    }

    case 'find-phase': {
      cmdFindPhase(cwd, args[1], raw);
      break;
    }

    case 'commit': {
      const amend = args.includes('--amend');
      const message = args[1];
      // Anything that looks like a flag where the message belongs, or a flag commit does not know, is refused before any git call.
      const known = new Set(['--amend', '--files', '--trailer']);
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--trailer') { i++; continue; }
        if (args[i] === '--files') { while (i + 1 < args.length && !args[i + 1].startsWith('--')) i++; continue; }
        if (args[i].startsWith('--') && !known.has(args[i])) { process.stderr.write(`Error: commit: unknown flag ${args[i]}\n${COMMIT_USAGE}\n`); process.exit(1); }
      }
      if (typeof message === 'string' && message.startsWith('--') && !(amend && message === '--amend')) {
        process.stderr.write(`Error: commit: message expected, got flag ${message}\n${COMMIT_USAGE}\n`); process.exit(1);
      }
      // Parse --files flag (collect args after --files, stopping at other flags)
      // --trailer <line> is repeatable and appends a trailer paragraph to the message.
      const files = [];
      const trailers = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--trailer') { if (i + 1 < args.length) trailers.push(args[++i]); continue; }
        if (args[i] !== '--files') continue;
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) files.push(args[++i]);
      }
      cmdCommit(cwd, amend && message === '--amend' ? undefined : message, files, raw, amend, trailers);
      break;
    }

    case 'verify-summary': {
      const summaryPath = args[1];
      const countIndex = args.indexOf('--check-count');
      const checkCount = countIndex !== -1 ? parseInt(args[countIndex + 1], 10) : 2;
      cmdVerifySummary(cwd, summaryPath, checkCount, raw);
      break;
    }

    case 'template': {
      const subcommand = args[1];
      if (subcommand === 'select') {
        cmdTemplateSelect(cwd, args[2], raw);
      } else if (subcommand === 'fill') {
        const templateType = args[2];
        const phaseIdx = args.indexOf('--phase');
        const planIdx = args.indexOf('--plan');
        const nameIdx = args.indexOf('--name');
        const typeIdx = args.indexOf('--type');
        const waveIdx = args.indexOf('--wave');
        const fieldsIdx = args.indexOf('--fields');
        let templateFields = {};
        if (fieldsIdx !== -1) {
          const fieldsParseResult = safeJsonParse(args[fieldsIdx + 1], '--fields argument');
          if (!fieldsParseResult.ok) {
            error(`template fill: --fields ${fieldsParseResult.error.message}`);
          }
          templateFields = fieldsParseResult.value;
        }
        cmdTemplateFill(cwd, templateType, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          plan: planIdx !== -1 ? args[planIdx + 1] : null,
          name: nameIdx !== -1 ? args[nameIdx + 1] : null,
          type: typeIdx !== -1 ? args[typeIdx + 1] : 'execute',
          wave: waveIdx !== -1 ? args[waveIdx + 1] : '1',
          fields: templateFields,
        }, raw);
      } else {
        error('Unknown template subcommand. Available: select, fill');
      }
      break;
    }

    case 'frontmatter': {
      const subcommand = args[1];
      const file = args[2];
      if (subcommand === 'get') {
        const fieldIdx = args.indexOf('--field');
        cmdFrontmatterGet(cwd, file, fieldIdx !== -1 ? args[fieldIdx + 1] : null, raw);
      } else if (subcommand === 'set') {
        const fieldIdx = args.indexOf('--field');
        const valueIdx = args.indexOf('--value');
        cmdFrontmatterSet(cwd, file, fieldIdx !== -1 ? args[fieldIdx + 1] : null, valueIdx !== -1 ? args[valueIdx + 1] : undefined, raw);
      } else if (subcommand === 'merge') {
        const dataIdx = args.indexOf('--data');
        cmdFrontmatterMerge(cwd, file, dataIdx !== -1 ? args[dataIdx + 1] : null, raw);
      } else if (subcommand === 'validate') {
        const schemaIdx = args.indexOf('--schema');
        cmdFrontmatterValidate(cwd, file, schemaIdx !== -1 ? args[schemaIdx + 1] : null, raw);
      } else {
        error('Unknown frontmatter subcommand. Available: get, set, merge, validate');
      }
      break;
    }

    case 'verify': {
      const subcommand = args[1];
      if (subcommand === 'plan-structure') {
        cmdVerifyPlanStructure(cwd, args[2], raw);
      } else if (subcommand === 'phase-completeness') {
        cmdVerifyPhaseCompleteness(cwd, args[2], raw);
      } else if (subcommand === 'references') {
        cmdVerifyReferences(cwd, args[2], raw);
      } else if (subcommand === 'commits') {
        cmdVerifyCommits(cwd, args.slice(2), raw);
      } else if (subcommand === 'artifacts') {
        cmdVerifyArtifacts(cwd, args[2], raw);
      } else if (subcommand === 'key-links') {
        cmdVerifyKeyLinks(cwd, args[2], raw);
      } else if (subcommand === 'migration-timestamps') {
        cmdVerifyMigrationTimestamps(cwd, raw);
      } else if (subcommand === 'dependency-stability') {
        cmdVerifyDependencyStability(cwd, args[2], raw);
      } else if (subcommand === 'form') {
        cmdVerifyForm(cwd, args.slice(2), raw);
      } else if (subcommand === 'phase-gate') {
        cmdVerifyPhaseGate(cwd, args[2], raw, { preVerifier: args.includes('--pre-verifier') });
      } else if (subcommand === 'e2e-gaps') {
        cmdVerifyE2EGaps(cwd, args[2], raw);
      } else if (subcommand === 'test-content') {
        cmdVerifyTestContent(cwd, args[2], raw);
      } else if (subcommand === 'append-gap') {
        const truthIdx = args.indexOf('--truth');
        const reasonIdx = args.indexOf('--reason');
        const failureTypeIdx = args.indexOf('--failure-type');
        const artifactsIdx = args.indexOf('--artifacts');
        cmdVerifyAppendGap(cwd, args[2], {
          truth: truthIdx !== -1 ? args[truthIdx + 1] : null,
          reason: reasonIdx !== -1 ? args[reasonIdx + 1] : null,
          failureType: failureTypeIdx !== -1 ? args[failureTypeIdx + 1] : null,
          artifactsJson: artifactsIdx !== -1 ? args[artifactsIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'gate-handshake') {
        cmdVerifyGateHandshake(cwd, raw);
      } else {
        error('Unknown verify subcommand. Available: form, plan-structure, phase-completeness, references, commits, artifacts, key-links, migration-timestamps, dependency-stability, phase-gate, e2e-gaps, test-content, append-gap, gate-handshake');
      }
      break;
    }

    case 'deferred': {
      const subcommand = args[1];
      if (subcommand === 'add') {
        const stepIdx = args.indexOf('--step');
        const reasonIdx = args.indexOf('--reason');
        const approverIdx = args.indexOf('--approver');
        const planIdx = args.indexOf('--plan');
        cmdDeferredAdd(cwd, args[2], {
          step: stepIdx !== -1 ? args[stepIdx + 1] : null,
          reason: reasonIdx !== -1 ? args[reasonIdx + 1] : null,
          approver: approverIdx !== -1 ? args[approverIdx + 1] : null,
          plan: planIdx !== -1 ? args[planIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'list') {
        const phaseFlagIdx = args.indexOf('--phase');
        const listPhase = phaseFlagIdx !== -1 ? args[phaseFlagIdx + 1] : args[2];
        if (!listPhase || listPhase.startsWith('--')) error('usage: deferred list <phase>  (or --phase <phase>)');
        cmdDeferredList(cwd, listPhase, raw);
      } else {
        error('Unknown deferred subcommand. Available: add, list');
      }
      break;
    }

    case 'execution-state': {
      const subcommand = args[1];
      const phaseIdx = args.indexOf('--phase');
      const planIdx = args.indexOf('--plan');
      const errorIdx = args.indexOf('--error');
      const stepIdx = args.indexOf('--step');
      const filesIdx = args.indexOf('--files');
      const options = {
        phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
        plan: planIdx !== -1 ? args[planIdx + 1] : null,
      };
      if (subcommand === 'record-failure') {
        cmdExecutionStateRecordFailure(cwd, {
          ...options,
          errorMsg: errorIdx !== -1 ? args[errorIdx + 1] : null,
          step: stepIdx !== -1 ? args[stepIdx + 1] : null,
          files: filesIdx !== -1 ? args[filesIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'record-success') {
        cmdExecutionStateRecordSuccess(cwd, options, raw);
      } else if (subcommand === 'get') {
        cmdExecutionStateGet(cwd, options, raw);
      } else {
        error('Unknown execution-state subcommand. Available: record-failure, record-success, get');
      }
      break;
    }

    case 'generate-slug': {
      cmdGenerateSlug(args[1], raw);
      break;
    }

    case 'current-timestamp': {
      cmdCurrentTimestamp(args[1] || 'full', raw);
      break;
    }

    case 'list-todos': {
      cmdListTodos(cwd, args[1], raw);
      break;
    }

    case 'verify-path-exists': {
      cmdVerifyPathExists(cwd, args[1], raw);
      break;
    }

    case 'config-ensure-section': {
      cmdConfigEnsureSection(cwd, raw);
      break;
    }

    case 'config-set': {
      cmdConfigSet(cwd, args[1], args[2], raw);
      break;
    }

    case 'config': {
      const subcommand = args[1];
      if (subcommand === 'get') {
        const defaultIdx = args.indexOf('--default');
        const defaultValue = defaultIdx !== -1 ? args[defaultIdx + 1] : undefined;
        cmdConfigGet(cwd, args[2], raw, defaultValue);
      } else {
        error('Unknown config subcommand. Available: get');
      }
      break;
    }

    case 'history-digest': {
      cmdHistoryDigest(cwd, raw);
      break;
    }

    case 'phases': {
      const subcommand = args[1];
      if (subcommand === 'list') {
        const typeIndex = args.indexOf('--type');
        const phaseIndex = args.indexOf('--phase');
        const options = {
          type: typeIndex !== -1 ? args[typeIndex + 1] : null,
          phase: phaseIndex !== -1 ? args[phaseIndex + 1] : null,
        };
        cmdPhasesList(cwd, options, raw);
      } else {
        error('Unknown phases subcommand. Available: list');
      }
      break;
    }

    case 'owner-gate': {
      cmdOwnerGate(cwd, args.slice(1), raw);
      break;
    }

    case 'roadmap': {
      const subcommand = args[1];
      if (subcommand === 'get-phase') {
        cmdRoadmapGetPhase(cwd, args[2], raw);
      } else if (subcommand === 'analyze' || subcommand === 'list') {
        cmdRoadmapAnalyze(cwd, raw);
      } else if (subcommand === 'parse') {
        cmdRoadmapParse(cwd, raw);
      } else if (subcommand === 'dag') {
        cmdRoadmapDAG(cwd, raw);
      } else if (subcommand === 'status') {
        cmdRoadmapStatus(cwd, args[2], raw);
      } else if (subcommand === 'validate') {
        cmdRoadmapValidate(cwd, raw);
      } else if (subcommand === 'update-plan-progress') {
        cmdRoadmapUpdatePlanProgress(cwd, args[2], raw);
      } else if (subcommand === 'next') {
        cmdRoadmapNext(cwd, args.slice(2), raw);
      } else if (subcommand === 'record') {
        cmdRoadmapRecord(cwd, args.slice(2), raw);
      } else {
        error('Unknown roadmap subcommand. Available: get-phase, analyze, list, parse, dag, status, validate, update-plan-progress, next, record');
      }
      break;
    }

    case 'phase': {
      const subcommand = args[1];
      if (subcommand === 'next-decimal') {
        cmdPhaseNextDecimal(cwd, args[2], raw);
      } else if (subcommand === 'add') {
        cmdPhaseAdd(cwd, args.slice(2).join(' '), raw);
      } else if (subcommand === 'insert') {
        cmdPhaseInsert(cwd, args[2], args.slice(3).join(' '), raw);
      } else if (subcommand === 'remove') {
        const forceFlag = args.includes('--force');
        cmdPhaseRemove(cwd, args[2], { force: forceFlag }, raw);
      } else if (subcommand === 'complete') {
        cmdPhaseComplete(cwd, args[2], raw, { formDebt: args.includes('--form-debt') });
      } else if (subcommand === 'checkpoint') {
        cmdPhaseCheckpoint(cwd, args.slice(2), raw);
      } else if (subcommand === 'archive') {
        await cmdPhaseArchive(cwd, args[2], raw);
      } else if (subcommand === 'inject-context') {
        await cmdPhaseInjectContext(cwd, args[2], raw);
      } else if (subcommand === 'cleanup-checkpoints') {
        await cmdPhaseCleanupCheckpoints(cwd, args[2], raw);
      } else if (subcommand === 'size' || subcommand === 'limits' || subcommand === 'check' || subcommand === 'split-recommend') {
        await cmdPhaseSize(cwd, args.slice(1), raw);
      } else {
        error('Unknown phase subcommand. Available: next-decimal, add, insert, remove, complete, checkpoint, archive, inject-context, cleanup-checkpoints, size, limits, check, split-recommend');
      }
      break;
    }

    case 'milestone': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        const nameIndex = args.indexOf('--name');
        const milestoneName = nameIndex !== -1 ? args.slice(nameIndex + 1).join(' ') : null;
        const msPhasesIndex = args.indexOf('--phases');
        const msPhasesRange = msPhasesIndex !== -1 ? args[msPhasesIndex + 1] : null;
        // --phases must be threaded through to cmdMilestoneComplete itself,
        // not just to the summarize/archive-phases calls below -- this was
        // exactly the v0.1.20 regression (silently dropped before reaching
        // cmdMilestoneComplete's own phase/plan/task counting).
        cmdMilestoneComplete(cwd, args[2], { name: milestoneName, phases: msPhasesRange }, raw);
        const msVersion = args[2];
        if (msVersion) {
          cmdMilestoneSummarize(cwd, msVersion, { name: milestoneName, phases: msPhasesRange }, raw);
          cmdMilestoneArchivePhases(cwd, msVersion, { phases: msPhasesRange }, raw);
        }
      } else if (subcommand === 'summarize') {
        const msPhasesIndex = args.indexOf('--phases');
        const msPhasesRange = msPhasesIndex !== -1 ? args[msPhasesIndex + 1] : null;
        cmdMilestoneSummarize(cwd, args[2], { phases: msPhasesRange }, raw);
      } else if (subcommand === 'archive-phases') {
        const msPhasesIndex = args.indexOf('--phases');
        const msPhasesRange = msPhasesIndex !== -1 ? args[msPhasesIndex + 1] : null;
        const msDryRun = args.includes('--dry-run');
        cmdMilestoneArchivePhases(cwd, args[2], { phases: msPhasesRange, 'dry-run': msDryRun }, raw);
      } else {
        error('Unknown milestone subcommand. Available: complete, summarize, archive-phases');
      }
      break;
    }

    case 'validate': {
      const subcommand = args[1];
      if (subcommand === 'consistency') {
        cmdValidateConsistency(cwd, raw);
      } else {
        error('Unknown validate subcommand. Available: consistency');
      }
      break;
    }

    case 'progress': {
      const subcommand = args[1] || 'json';
      cmdProgressRender(cwd, subcommand, raw);
      break;
    }

    case 'todo': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        cmdTodoComplete(cwd, args[2], raw);
      } else {
        error('Unknown todo subcommand. Available: complete');
      }
      break;
    }

    case 'scaffold': {
      const scaffoldType = args[1];
      const phaseIndex = args.indexOf('--phase');
      const nameIndex = args.indexOf('--name');
      const scaffoldOptions = {
        phase: phaseIndex !== -1 ? args[phaseIndex + 1] : null,
        name: nameIndex !== -1 ? args.slice(nameIndex + 1).join(' ') : null,
      };
      cmdScaffold(cwd, scaffoldType, scaffoldOptions, raw);
      break;
    }

    case 'init': {
      const legacyFlag = args.includes('--legacy');
      const initArgs = args.filter((a) => a !== '--legacy' && a !== '--auto');
      const workflow = initArgs[1];
      const includes = parseIncludeFlag(initArgs);
      const gate = projectContext.contextGate(cwd, {
        legacy: legacyFlag || process.env.GSD_LEGACY === '1',
      });
      if ((workflow === 'plan-phase' || workflow === 'execute-phase') && !gate.ok) {
        fs.writeSync(2, projectContext.gateStderr(gate) + '\n');
        writeStdoutSync(JSON.stringify(projectContext.gateFailure(gate), null, 2) + '\n');
        process.exit(1);
      }
      switch (workflow) {
        case 'execute-phase':
          cmdInitExecutePhase(cwd, initArgs[2], includes, raw, gate);
          break;
        case 'plan-phase':
          cmdInitPlanPhase(cwd, initArgs[2], includes, raw, gate);
          break;
        case 'new-project':
          cmdInitNewProject(cwd, raw);
          break;
        case 'new-milestone':
          cmdInitNewMilestone(cwd, raw);
          break;
        case 'milestone-branch':
          cmdInitMilestoneBranch(cwd, raw);
          break;
        case 'quick':
          cmdInitQuick(cwd, initArgs.slice(2).join(' '), raw);
          break;
        case 'resume':
          cmdInitResume(cwd, raw);
          break;
        case 'verify-work':
          cmdInitVerifyWork(cwd, initArgs[2], raw);
          break;
        case 'phase-op':
          cmdInitPhaseOp(cwd, initArgs[2], raw);
          break;
        case 'todos':
          cmdInitTodos(cwd, initArgs[2], raw);
          break;
        case 'milestone-op':
          cmdInitMilestoneOp(cwd, raw);
          break;
        case 'map-codebase':
          cmdInitMapCodebase(cwd, raw);
          break;
        case 'progress':
          cmdInitProgress(cwd, includes, raw);
          break;
        case 'execute-roadmap':
          cmdInitExecuteRoadmap(cwd, raw);
          break;
        default:
          error(`Unknown init workflow: ${workflow}\nAvailable: execute-phase, plan-phase, new-project, new-milestone, milestone-branch, quick, resume, verify-work, phase-op, todos, milestone-op, map-codebase, progress, execute-roadmap`);
      }
      break;
    }

    case 'phase-plan-index': {
      cmdPhasePlanIndex(cwd, args[1], raw);
      break;
    }

    case 'state-snapshot': {
      cmdStateSnapshot(cwd, raw);
      break;
    }

    case 'summary-extract': {
      const summaryPath = args[1];
      const fieldsIndex = args.indexOf('--fields');
      const fields = fieldsIndex !== -1 ? args[fieldsIndex + 1].split(',') : null;
      cmdSummaryExtract(cwd, summaryPath, fields, raw);
      break;
    }

    case 'websearch': {
      const query = args[1];
      const limitIdx = args.indexOf('--limit');
      const freshnessIdx = args.indexOf('--freshness');
      await cmdWebsearch(query, {
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10,
        freshness: freshnessIdx !== -1 ? args[freshnessIdx + 1] : null,
      }, raw);
      break;
    }

    case 'quota': {
      const subCommand = args[1];

      if (subCommand === 'status') {
        const state = loadQuotaState(cwd);
        const sessionPercent = state.session.tokens_limit > 0
          ? ((state.session.tokens_used / state.session.tokens_limit) * 100).toFixed(1)
          : 0;
        const weeklyPercent = state.weekly.tokens_limit > 0
          ? ((state.weekly.tokens_used / state.weekly.tokens_limit) * 100).toFixed(1)
          : 0;

        const result = {
          session: {
            used: state.session.tokens_used,
            limit: state.session.tokens_limit,
            percent: parseFloat(sessionPercent),
            reset_time: state.session.reset_time
          },
          weekly: {
            used: state.weekly.tokens_used,
            limit: state.weekly.tokens_limit,
            percent: parseFloat(weeklyPercent),
            reset_time: state.weekly.reset_time
          },
          task_count: state.tasks.length
        };
        output(result, raw);
      } else if (subCommand === 'status-bar') {
        const state = loadQuotaState(cwd);

        if (args.includes('--json')) {
          const tasks = state.tasks || [];
          const modelCounts = { haiku: 0, sonnet: 0, opus: 0 };
          for (const task of tasks) {
            const model = task.model.toLowerCase();
            if (modelCounts[model] !== undefined) {
              modelCounts[model] += task.tokens_in + task.tokens_out;
            }
          }
          output({
            total_tokens: tasks.reduce((sum, t) => sum + t.tokens_in + t.tokens_out, 0),
            model_distribution: modelCounts,
            task_count: tasks.length,
            last_model: tasks[tasks.length - 1]?.model || null
          }, raw);
        } else {
          const statusBar = formatStatusBar(state);
          output({ status_bar: statusBar }, raw, statusBar);
        }
      } else if (subCommand === 'stats') {
        const state = loadQuotaState(cwd);
        const stats = getUsageStats(state);

        if (args.includes('--table')) {
          // Print as formatted table
          const totalTokens = stats.session_total.tokens;
          const models = stats.per_model;

          console.log('\n=== GSD Auto Mode Session Stats ===\n');
          console.log(`Total: ${totalTokens.toLocaleString()} tokens across ${stats.session_total.tasks} tasks\n`);
          console.log('Model Distribution:');
          console.log(`  Haiku:  ${models.haiku.tokens.toLocaleString()} tokens (${models.haiku.tasks} tasks)`);
          console.log(`  Sonnet: ${models.sonnet.tokens.toLocaleString()} tokens (${models.sonnet.tasks} tasks)`);
          console.log(`  Opus:   ${models.opus.tokens.toLocaleString()} tokens (${models.opus.tasks} tasks)`);
          console.log('\nCost Savings:');
          console.log(`  Actual:    ${stats.cost_estimate.actual_cost}`);
          console.log(`  If Opus:   ${stats.cost_estimate.if_all_opus}`);
          console.log(`  Saved:     ${stats.cost_estimate.savings} (${stats.cost_estimate.savings_percent})`);
          console.log('\nQuota:');
          console.log(`  Session:   ${stats.quota.session_percent} used`);
          console.log(`  Weekly:    ${stats.quota.weekly_percent} used`);
          process.exit(0);
        } else {
          output(stats, raw);
        }
      } else if (subCommand === 'reset') {
        saveQuotaState(cwd, { ...DEFAULT_QUOTA_STATE });
        output({ reset: true }, raw);
      } else if (subCommand === 'record') {
        const [taskId, model, tokensIn, tokensOut] = args.slice(2);
        const state = recordTaskUsage(cwd, taskId, model, parseInt(tokensIn), parseInt(tokensOut));
        output({
          recorded: true,
          session_total: state.session.tokens_used,
          task_count: state.tasks.length
        }, raw);
      } else if (subCommand === 'update-from-headers') {
        const headersJson = args.slice(2).join(' ');
        const headersParseResult = safeJsonParse(headersJson, 'update-from-headers argument');
        if (!headersParseResult.ok) {
          error(`quota update-from-headers: ${headersParseResult.error.message}`);
        }
        const headers = headersParseResult.value;
        const parsed = parseQuotaHeaders(headers);

        const state = loadQuotaState(cwd);

        // Update limits and reset times from actual API headers
        state.session.tokens_limit = parsed.input.limit;
        state.session.reset_time = parsed.input.reset;
        state.session.tokens_used = parsed.input.limit - parsed.input.remaining;

        saveQuotaState(cwd, state);
        output({
          updated: true,
          session_percent: ((state.session.tokens_used / state.session.tokens_limit) * 100).toFixed(1)
        }, raw);
      } else if (subCommand === 'check') {
        const warnings = checkQuotaWarning(cwd);
        const waitCheck = checkQuotaAndWait(cwd);
        output({
          warnings,
          wait: waitCheck
        }, raw);
      } else if (subCommand === 'wait') {
        const waitCheck = checkQuotaAndWait(cwd);

        if (!waitCheck.should_wait) {
          output({ waited: false, reason: 'quota_ok' }, raw);
        } else {
          output({
            waiting: true,
            type: waitCheck.wait_type,
            seconds: waitCheck.wait_seconds,
            until: waitCheck.wait_until
          }, raw);
        }
      } else {
        error('Unknown quota subcommand. Available: status, reset, record, update-from-headers, check, wait, status-bar, stats');
      }
      break;
    }

    case 'resilience': {
      const subCommand = args[1];

      if (subCommand === 'check-staleness') {
        const filePath = args[2];
        const thresholdIdx = args.indexOf('--threshold-minutes');
        const thresholdMinutes = thresholdIdx !== -1 ? parseFloat(args[thresholdIdx + 1]) : null;
        if (!filePath) {
          error('resilience check-staleness: <file> required');
        }
        cmdResilienceCheckStaleness(cwd, filePath, thresholdMinutes, raw);
      } else if (subCommand === 'parse-death') {
        const textIdx = args.indexOf('--text');
        const text = textIdx !== -1 ? args[textIdx + 1] : null;
        if (!text) {
          error('resilience parse-death: --text required');
        }
        cmdResilienceParseDeath(text, raw);
      } else if (subCommand === 'resume-brief') {
        const phase = args[2];
        cmdResilienceResumeBrief(cwd, phase, raw);
      } else if (subCommand === 'estimate-quota') {
        const phasesIdx = args.indexOf('--phases');
        const phaseCount = phasesIdx !== -1 ? parseInt(args[phasesIdx + 1], 10) : 1;
        cmdResilienceEstimateQuota(cwd, phaseCount, raw);
      } else if (subCommand === 'usage-window') {
        const hoursIdx = args.indexOf('--hours');
        const hours = hoursIdx !== -1 ? parseFloat(args[hoursIdx + 1]) : 5;
        cmdResilienceUsageWindow(hours, raw);
      } else {
        error('Unknown resilience subcommand. Available: check-staleness, parse-death, resume-brief, estimate-quota, usage-window');
      }
      break;
    }

    case 'handoff': {
      const subCommand = args[1];

      if (subCommand === 'brief') {
        const jsonIdx = args.indexOf('--json');
        const jsonArg = jsonIdx !== -1 ? args[jsonIdx + 1] : null;
        cmdHandoffBrief(jsonArg, raw);
      } else {
        error('Unknown handoff subcommand. Available: brief');
      }
      break;
    }

    case 'doctor': {
      const configDirIdx = args.indexOf('--config-dir');
      const options = { configDir: configDirIdx !== -1 ? args[configDirIdx + 1] : null };
      cmdDoctor(cwd, options, raw);
      break;
    }

    case 'telemetry': {
      const telemetrySubcmd = args[1];
      if (telemetrySubcmd === 'append') {
        const agentIdx = args.indexOf('--agent');
        const phaseIdx = args.indexOf('--phase');
        const pressureIdx = args.indexOf('--context-pressure');
        const instrIdx = args.indexOf('--instructions-not-followed');
        const ambIdx = args.indexOf('--ambiguities');
        const toolErrIdx = args.indexOf('--tool-errors-swallowed');
        const agent = agentIdx !== -1 ? args[agentIdx + 1] : null;
        const phase = phaseIdx !== -1 ? args[phaseIdx + 1] : null;
        if (!agent) error('telemetry append: --agent required');
        const fields = {
          context_pressure: pressureIdx !== -1 ? parseFloat(args[pressureIdx + 1]) : null,
          instructions_not_followed: instrIdx !== -1 ? safeJsonParse(args[instrIdx + 1], '--instructions-not-followed').value || [] : [],
          ambiguities: ambIdx !== -1 ? safeJsonParse(args[ambIdx + 1], '--ambiguities').value || [] : [],
          tool_errors_swallowed: toolErrIdx !== -1 ? parseInt(args[toolErrIdx + 1], 10) : 0
        };
        const entry = appendTelemetryReport(cwd, agent, phase, fields);
        output(entry, raw);
      } else if (telemetrySubcmd === 'summarize') {
        const reports = readTelemetryReports(cwd);
        output(summarizeTelemetryReports(reports), raw);
      } else {
        error('Unknown telemetry subcommand. Available: append, summarize');
      }
      break;
    }

    case 'knowledge': {
      const knowledgeSubcmd = args[1];
      const knowledgeArgs = args.slice(2);
      switch (knowledgeSubcmd) {
        case 'status':
          cmdKnowledgeStatus(knowledgeArgs, raw);
          break;
        case 'add':
          await cmdKnowledgeAdd(cwd, knowledgeArgs, raw);
          break;
        case 'search':
          cmdKnowledgeSearch(knowledgeArgs, raw);
          break;
        case 'get':
          cmdKnowledgeGet(knowledgeArgs, raw);
          break;
        case 'delete':
          cmdKnowledgeDelete(knowledgeArgs, raw);
          break;
        case 'cleanup':
          cmdKnowledgeCleanup(knowledgeArgs, raw);
          break;
        case 'prune':
          cmdKnowledgePrune(knowledgeArgs, raw);
          break;
        case 'stats':
          cmdKnowledgeStats(cwd, knowledgeArgs, raw);
          break;
        case 'consolidate':
          await cmdKnowledgeConsolidate(cwd, knowledgeArgs, raw);
          break;
        default:
          error(`knowledge: unknown subcommand '${knowledgeSubcmd}'`);
      }
      break;
    }

    case 'pause': {
      cmdPause(args.slice(1), raw);
      break;
    }

    case 'resume': {
      cmdResume(args.slice(1), raw);
      break;
    }

    case 'budget': {
      // Sub-dispatch: `budget check` (MILE-30 prompt-token budget, Phase
      // 53-02) vs the pre-existing cost/spend budget command (`budget
      // --period daily --scope project`). Only a bare `check` positional as
      // the very first sub-argument routes to the prompt-budget path; every
      // other invocation (including bare `budget` with no args) preserves
      // the original cost-budget behavior unchanged.
      if (args[1] === 'check') {
        cmdPromptBudget(cwd, raw);
      } else if (args[1] === 'status' || args[1] === 'spend') {
        cmdPhaseBudget(cwd, args.slice(1), raw);
      } else {
        cmdBudget(args.slice(1), raw);
      }
      break;
    }

    case 'mark-wrong': {
      cmdMarkWrong(args.slice(1), raw);
      break;
    }

    case 'mark-outdated': {
      await cmdMarkOutdated(args.slice(1), raw);
      break;
    }

    case 'principle-history': {
      cmdPrincipleHistory(args.slice(1), raw);
      break;
    }

    case 'pending-replacements': {
      cmdPendingReplacements(cwd, args.slice(1), raw);
      break;
    }

    case 'checkpoint': {
      cmdCheckpoint(cwd, args.slice(1), raw);
      break;
    }

    case 'execution-log': {
      cmdExecutionLog(cwd, args.slice(1), raw);
      break;
    }

    case 'analytics': {
      const analyticsSubcmd = args[1];
      if (!analyticsSubcmd) {
        error('analytics: subcommand required (report)');
      }
      if (analyticsSubcmd === 'report') {
        const { generateReport } = require('./analytics.js');
        const report = generateReport(cwd);
        process.stdout.write(report + '\n');
      } else {
        error(`analytics: unknown subcommand "${analyticsSubcmd}"`);
      }
      break;
    }

    case 'failure': {
      cmdFailure(cwd, args.slice(1), raw);
      break;
    }

    case 'completion': {
      cmdCompletion(cwd, args.slice(1), raw);
      break;
    }

    case 'token': {
      cmdToken(cwd, args.slice(1), raw);
      break;
    }

    case 'token-usage': {
      cmdTokenUsage(cwd, args.slice(1), raw);
      break;
    }

    case 'alerts': {
      cmdAlerts(cwd, args.slice(1), raw);
      break;
    }

    case 'task': {
      cmdTask(cwd, args.slice(1), raw);
      break;
    }

    case 'eval': {
      cmdEval(cwd, args.slice(1), raw);
      break;
    }

    case 'pack': {
      const r = projectPack.runCli(args.slice(1), cwd);
      writeStdoutSync(JSON.stringify(r.result, null, 2) + '\n');
      process.exit(r.exitCode);
      break;
    }

    case 'eval-candidate': {
      const subcommand = args[1];
      if (subcommand === 'from-debug') {
        cmdEvalCandidateFromDebug(cwd, args[2], raw);
      } else if (subcommand === 'from-verification') {
        cmdEvalCandidateFromVerification(cwd, args[2], raw);
      } else if (subcommand === 'list') {
        cmdEvalCandidateList(cwd, args[2], raw);
      } else if (subcommand === 'accept') {
        cmdEvalCandidateAccept(cwd, args[2], raw);
      } else if (subcommand === 'reject') {
        const reasonIndex = args.indexOf('--reason');
        const reason = reasonIndex !== -1 ? args[reasonIndex + 1] : undefined;
        cmdEvalCandidateReject(cwd, args[2], reason, raw);
      } else {
        error('Unknown eval-candidate subcommand. Available: from-debug, from-verification, list, accept, reject');
      }
      break;
    }

    case 'profile': {
      const r = projectProfile.runCli(cwd, args.slice(1));
      if (r.error) error(r.error);
      if (r.exitCode !== 0) {
        writeStdoutSync(JSON.stringify(r.result, null, 2));
        process.exit(r.exitCode);
      }
      output(r.result, raw, r.rawValue);
      break;
    }

    case 'project': {
      if (args[1] === 'adopt-brief') {
        const rootIdx = args.indexOf('--root');
        const adopted = projectContext.adoptBrief(rootIdx === -1 ? cwd : path.resolve(cwd, args[rootIdx + 1] ?? '.'));
        writeStdoutSync(JSON.stringify(adopted, null, 2) + '\n');
        process.exit(adopted.ok ? 0 : 1);
      }
      const r = projectRegistry.initWithRegistration(cwd, args.slice(1), process.env,
        () => projectDeploy.runCli(cwd, args.slice(1), process.env));
      writeStdoutSync(JSON.stringify(r.result, null, 2) + '\n');
      process.exit(r.exitCode);
      break;
    }

    case 'prompt-optimize': {
      cmdPromptOptimize(cwd, args.slice(1), raw);
      break;
    }

    case 'observability': {
      await cmdObservability(args.slice(1), raw);
      break;
    }

    case 'dashboard': {
      await cmdDashboard(args.slice(1));
      break;
    }

    case 'health': {
      await cmdHealth(args.slice(1));
      break;
    }

    case 'savings': {
      cmdSavings(cwd, args.slice(1), raw);
      break;
    }

    case 'analyze-session': {
      await cmdAnalyzeSession(cwd, args.slice(1), raw);
      break;
    }

    case 'historical-extract': {
      await cmdHistoricalExtract(cwd, args.slice(1), raw);
      break;
    }

    case 'analysis-status': {
      cmdAnalysisStatus(cwd, args.slice(1), raw);
      break;
    }

    case 'list-pending-sessions': {
      await cmdListPendingSessions(cwd, args.slice(1), raw);
      break;
    }

    case 'store-analysis-result': {
      await cmdStoreAnalysisResult(cwd, args.slice(1), raw);
      break;
    }

    case 'mine-conversations': {
      await cmdMineConversations(cwd, args.slice(1), raw);
      break;
    }

    case 'store-conversation-result': {
      await cmdStoreConversationResult(cwd, args.slice(1), raw);
      break;
    }

    case 'migrate-knowledge': {
      await cmdMigrateKnowledge(cwd, args.slice(1), raw);
      break;
    }

    case 'query-knowledge': {
      await cmdQueryKnowledge(cwd, args.slice(1), raw);
      break;
    }

    case 'compress': {
      const subcommand = args[1];
      if (subcommand === 'summary') {
        const filePath = args[2];
        const rawFlag = args.includes('--raw');
        cmdCompressSummary(filePath, rawFlag);
      } else if (subcommand === 'stats') {
        cmdCompressStats(raw);
      } else if (subcommand === 'status') {
        // Show compression configuration and circuit breaker state
        const { loadHookConfig, getCircuitBreakerStatus } = require(path.join(process.env.HOME, '.claude/get-shit-done/bin/hooks/config'));
        const config = loadHookConfig();
        const cbStatus = getCircuitBreakerStatus();

        output({
          enabled: config.compression.enabled,
          strategy: config.compression.strategy,
          min_file_lines: config.compression.min_file_lines,
          cache_ttl: config.compression.cache_ttl,
          circuit_breaker: cbStatus
        }, raw);

      } else if (subcommand === 'enable') {
        // Enable compression
        const { loadHookConfig, saveHookConfig } = require(path.join(process.env.HOME, '.claude/get-shit-done/bin/hooks/config'));
        const config = loadHookConfig();
        config.compression.enabled = true;
        saveHookConfig(config);
        output({ enabled: true, message: 'Compression enabled' }, raw);

      } else if (subcommand === 'disable') {
        // Disable compression
        const { loadHookConfig, saveHookConfig } = require(path.join(process.env.HOME, '.claude/get-shit-done/bin/hooks/config'));
        const config = loadHookConfig();
        config.compression.enabled = false;
        saveHookConfig(config);
        output({ enabled: false, message: 'Compression disabled' }, raw);

      } else if (subcommand === 'reset') {
        // Reset circuit breaker
        const { resetCircuitBreaker } = require(path.join(process.env.HOME, '.claude/get-shit-done/bin/hooks/config'));
        resetCircuitBreaker();
        output({ message: 'Circuit breaker reset to closed state' }, raw);

      } else if (subcommand === 'metrics') {
        // Show compression statistics
        const metricsPath = path.join(process.env.HOME, '.claude', 'get-shit-done', 'compression-metrics.jsonl');
        if (!fs.existsSync(metricsPath)) {
          output({ count: 0, message: 'No compression metrics yet' }, raw);
        } else {
          const lines = fs.readFileSync(metricsPath, 'utf-8').trim().split('\n').filter(l => l.trim());
          if (lines.length === 0) {
            output({ count: 0, message: 'No compression metrics yet' }, raw);
          } else {
            const records = lines.map(l => {
              try {
                return JSON.parse(l);
              } catch (e) {
                return null;
              }
            }).filter(r => r !== null);

            const avgReduction = records.length > 0
              ? records.reduce((sum, r) => sum + parseFloat(r.reductionPercent || 0), 0) / records.length
              : 0;

            const totalTokensSaved = records.reduce((sum, r) =>
              sum + ((r.originalTokensEst || 0) - (r.compressedTokensEst || 0)), 0);

            output({
              count: records.length,
              avgReduction: avgReduction.toFixed(1) + '%',
              totalTokensSaved,
              recentFiles: records.slice(-5).map(r => ({
                file: r.file ? require('path').basename(r.file) : 'unknown',
                timestamp: r.timestamp,
                reductionPercent: r.reductionPercent,
                originalTokensEst: r.originalTokensEst,
                compressedTokensEst: r.compressedTokensEst
              }))
            }, raw);
          }
        }

      } else if (subcommand === 'clear-cache') {
        // Clear compression cache
        const { CompressionCache } = require(path.join(process.env.HOME, '.claude/get-shit-done/bin/hooks/compression-cache'));
        const cache = new CompressionCache();
        const statsBefore = cache.stats();
        cache.clear();
        output({
          message: 'Compression cache cleared',
          entriesCleared: statsBefore.entries,
          bytesFreed: statsBefore.totalSize
        }, raw);

      } else {
        error('Unknown compress subcommand. Available: summary, stats, status, enable, disable, reset, metrics, clear-cache');
      }
      break;
    }

    case 'circuit-breaker': {
      const subCommand = args[1];

      if (!circuitBreaker) {
        error('circuit-breaker module not available — run npm install in get-shit-done/');
        break;
      }

      if (subCommand === 'thresholds') {
        const modelIdx = args.indexOf('--model');
        const taskIdx = args.indexOf('--task');

        const model = modelIdx !== -1 ? args[modelIdx + 1] : 'sonnet';
        const task = taskIdx !== -1 ? args.slice(taskIdx + 1).join(' ') : '';

        const thresholds = circuitBreaker.getAdaptiveThresholds(task, model);
        output(thresholds, raw);

      } else if (subCommand === 'update-threshold') {
        const patternIdx = args.indexOf('--pattern');
        const multiplierIdx = args.indexOf('--multiplier');

        if (patternIdx === -1 || multiplierIdx === -1) {
          error('update-threshold requires --pattern and --multiplier');
          break;
        }

        const pattern = args[patternIdx + 1];
        const multiplier = parseFloat(args[multiplierIdx + 1]);

        const thresholds = circuitBreaker.loadThresholds();
        if (!thresholds.learned) {
          thresholds.learned = {};
        }
        thresholds.learned[pattern] = multiplier;
        circuitBreaker.saveThresholds(thresholds);

        output({ updated: true, pattern, multiplier }, raw);

      } else if (subCommand === 'log') {
        const modelIdx = args.indexOf('--model');
        const limitIdx = args.indexOf('--limit');

        const modelFilter = modelIdx !== -1 ? args[modelIdx + 1] : null;
        const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 20;

        const logPath = path.join(cwd, '.planning', 'circuit-breaker', 'timeout-log.jsonl');

        if (!fs.existsSync(logPath)) {
          output({ entries: [] }, raw);
          break;
        }

        const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
        const entries = [];

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry._comment) continue; // Skip header
            if (modelFilter && entry.model !== modelFilter) continue;
            entries.push(entry);
          } catch (e) {
            // Skip invalid lines
          }
        }

        const result = entries.slice(-limit);
        output({ entries: result, total: entries.length }, raw);

      } else if (subCommand === 'stats') {
        const logPath = path.join(cwd, '.planning', 'circuit-breaker', 'timeout-log.jsonl');

        if (!fs.existsSync(logPath)) {
          output({
            total_timeouts: 0,
            by_model: {},
            average_time_to_timeout: null
          }, raw);
          break;
        }

        const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
        const entries = [];

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry._comment) continue;
            entries.push(entry);
          } catch (e) {
            // Skip invalid lines
          }
        }

        const byModel = {};
        let totalTimeoutMs = 0;

        for (const entry of entries) {
          const model = entry.model || 'unknown';
          if (!byModel[model]) {
            byModel[model] = { count: 0, total_timeout_ms: 0 };
          }
          byModel[model].count++;

          if (entry.timeout_ms) {
            byModel[model].total_timeout_ms += entry.timeout_ms;
            totalTimeoutMs += entry.timeout_ms;
          }
        }

        const avgTimeToTimeout = entries.length > 0
          ? Math.floor(totalTimeoutMs / entries.length)
          : null;

        output({
          total_timeouts: entries.length,
          by_model: byModel,
          average_time_to_timeout: avgTimeToTimeout
        }, raw);

      } else {
        error('Unknown circuit-breaker subcommand. Available: thresholds, update-threshold, log, stats');
      }
      break;
    }

    case 'validation': {
      const subCommand = args[1];

      if (subCommand === 'validate') {
        const taskIdIdx = args.indexOf('--task-id');
        const outputIdx = args.indexOf('--output');
        const reasoningIdx = args.indexOf('--reasoning');

        const taskId = taskIdIdx !== -1 ? args[taskIdIdx + 1] : 'unknown';
        let taskOutput = outputIdx !== -1 ? args[outputIdx + 1] : '';
        let taskReasoning = reasoningIdx !== -1 ? args[reasoningIdx + 1] : '';

        // Check if output/reasoning are file paths
        if (taskOutput.startsWith('/') || taskOutput.startsWith('./')) {
          try {
            taskOutput = fs.readFileSync(taskOutput, 'utf-8');
          } catch (e) {
            // If not a file, treat as literal string
          }
        }
        if (taskReasoning.startsWith('/') || taskReasoning.startsWith('./')) {
          try {
            taskReasoning = fs.readFileSync(taskReasoning, 'utf-8');
          } catch (e) {
            // If not a file, treat as literal string
          }
        }

        // Run validation
        const task = args.slice(2).filter(a => !a.startsWith('--') && a !== taskId && a !== taskOutput && a !== taskReasoning).join(' ');
        const result = await validator.validateTask(task, taskOutput, taskReasoning, { task_id: taskId });

        output(result, raw);

      } else if (subCommand === 'depth') {
        const task = args.slice(2).join(' ');
        const result = validator.selectValidationDepth(task);
        output(result, raw);

      } else if (subCommand === 'log') {
        const taskIdIdx = args.indexOf('--task-id');
        const limitIdx = args.indexOf('--limit');

        const taskIdFilter = taskIdIdx !== -1 ? args[taskIdIdx + 1] : null;
        const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 20;

        const logFile = path.join(cwd, '.planning', 'validation', 'validation-log.jsonl');
        let entries = [];

        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8');
          entries = content
            .trim()
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              const parseResult = safeJsonParse(line, 'validation-log.jsonl');
              if (!parseResult.ok) {
                process.stderr.write('Warning: skipping malformed validation-log.jsonl line: ' + parseResult.error.message + '\n');
                return null;
              }
              return parseResult.value;
            })
            .filter(entry => entry !== null && !entry._comment); // Skip malformed lines and header comments

          if (taskIdFilter) {
            entries = entries.filter(e => e.task_id === taskIdFilter);
          }

          entries = entries.slice(-limit); // Get last N entries
        }

        output({ entries, count: entries.length }, raw);

      } else if (subCommand === 'stats') {
        const logFile = path.join(cwd, '.planning', 'validation', 'validation-log.jsonl');
        let entries = [];

        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8');
          entries = content
            .trim()
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              const parseResult = safeJsonParse(line, 'validation-log.jsonl');
              if (!parseResult.ok) {
                process.stderr.write('Warning: skipping malformed validation-log.jsonl line: ' + parseResult.error.message + '\n');
                return null;
              }
              return parseResult.value;
            })
            .filter(entry => entry !== null && !entry._comment && entry.result);
        }

        const total = entries.length;
        const passed = entries.filter(e => e.result && e.result.valid).length;
        const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

        const avgCorrectness = total > 0
          ? (entries.reduce((sum, e) => sum + (e.result.correctness_score || 0), 0) / total).toFixed(1)
          : 0;
        const avgReasoning = total > 0
          ? (entries.reduce((sum, e) => sum + (e.result.reasoning_score || 0), 0) / total).toFixed(1)
          : 0;

        const byDepth = {
          light: entries.filter(e => e.depth === 'light').length,
          standard: entries.filter(e => e.depth === 'standard').length,
          thorough: entries.filter(e => e.depth === 'thorough').length
        };

        const stats = {
          total_validations: total,
          passed: passed,
          failed: total - passed,
          pass_rate: parseFloat(passRate),
          average_correctness: parseFloat(avgCorrectness),
          average_reasoning: parseFloat(avgReasoning),
          by_depth: byDepth
        };

        output(stats, raw);

      } else {
        error('Unknown validation subcommand. Available: validate, depth, log, stats');
      }
      break;
    }

    case 'escalation': {
      const subCommand = args[1];

      if (subCommand === 'weights') {
        // Show error weight configuration
        output(escalation.ERROR_WEIGHTS, raw);

      } else if (subCommand === 'threshold') {
        // Show escalation threshold
        output({
          threshold: escalation.ESCALATION_THRESHOLD,
          description: '1-2 errors trigger escalation'
        }, raw);

      } else if (subCommand === 'log') {
        // Read escalation log
        const taskIdIdx = args.indexOf('--task-id');
        const limitIdx = args.indexOf('--limit');

        const taskIdFilter = taskIdIdx !== -1 ? args[taskIdIdx + 1] : null;
        const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 20;

        const logFile = path.join(cwd, '.planning', 'validation', 'escalation-log.jsonl');
        let entries = [];

        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8');
          entries = content
            .trim()
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(entry => entry && !entry._comment); // Skip header comments and parse errors

          if (taskIdFilter) {
            entries = entries.filter(e => e.task_id === taskIdFilter);
          }

          entries = entries.slice(-limit); // Get last N entries
        }

        output({ entries, count: entries.length }, raw);

      } else if (subCommand === 'stats') {
        // Escalation statistics
        const logFile = path.join(cwd, '.planning', 'validation', 'escalation-log.jsonl');
        let entries = [];

        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8');
          entries = content
            .trim()
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(entry => entry && !entry._comment);
        }

        const total = entries.length;
        const byModel = {};
        let totalErrors = 0;

        entries.forEach(entry => {
          const from = entry.from_model || 'unknown';
          const to = entry.to_model || 'unknown';
          const key = `${from} → ${to}`;

          if (!byModel[key]) {
            byModel[key] = { count: 0, total_score: 0 };
          }

          byModel[key].count++;
          byModel[key].total_score += entry.cumulative_score || 0;
          totalErrors++;
        });

        const avgErrorsBeforeEscalation = total > 0
          ? (totalErrors / total).toFixed(2)
          : 0;

        const stats = {
          total_escalations: total,
          by_model: byModel,
          avg_errors_before_escalation: avgErrorsBeforeEscalation
        };

        output(stats, raw);

      } else if (subCommand === 'simulate') {
        // Simulate error scoring
        const errorsIdx = args.indexOf('--errors');
        if (errorsIdx === -1) {
          error('Missing --errors argument. Usage: escalation simulate --errors "RETRY,VALIDATION_FIX,COMPLETE_REJECTION"');
        }

        const errorsStr = args[errorsIdx + 1];
        const errorTypes = errorsStr.split(',').map(s => s.trim());

        const tracker = new escalation.ErrorTracker({ id: 'simulation' });

        errorTypes.forEach(errorType => {
          if (escalation.ERROR_WEIGHTS[errorType] !== undefined) {
            tracker.recordError(errorType, `Simulated ${errorType} error`);
          } else {
            error(`Unknown error type: ${errorType}. Valid types: ${Object.keys(escalation.ERROR_WEIGHTS).join(', ')}`);
          }
        });

        output({
          cumulative_score: tracker.cumulativeScore,
          should_escalate: tracker.shouldEscalate(),
          errors: tracker.errors.length
        }, raw);

      } else {
        error('Unknown escalation subcommand. Available: weights, threshold, log, stats, simulate');
      }
      break;
    }

    case 'feedback': {
      const subCommand = args[1];

      if (subCommand === 'config') {
        // Show current feedback configuration
        const config = feedback.loadConfig();
        const feedbackConfig = {
          feedback_enabled: config.feedback_enabled,
          feedback_mode: config.feedback_mode,
          feedback_frequency: config.feedback_frequency,
          sample_rate: config.sample_rate
        };
        output(feedbackConfig, raw);

      } else if (subCommand === 'enable') {
        // Enable feedback collection
        const modeIdx = args.indexOf('--mode');
        const frequencyIdx = args.indexOf('--frequency');

        const mode = modeIdx !== -1 ? args[modeIdx + 1] : 'human';
        const frequency = frequencyIdx !== -1 ? args[frequencyIdx + 1] : 'escalations';

        // Validate mode
        if (!['human', 'opus'].includes(mode)) {
          error('Invalid mode. Must be: human or opus');
        }

        // Validate frequency
        if (!['all', 'escalations', 'sample'].includes(frequency)) {
          error('Invalid frequency. Must be: all, escalations, or sample');
        }

        const config = feedback.loadConfig();
        config.feedback_enabled = true;
        config.feedback_mode = mode;
        config.feedback_frequency = frequency;
        feedback.saveConfig(config);

        output({
          message: 'Feedback collection enabled',
          feedback_enabled: true,
          feedback_mode: mode,
          feedback_frequency: frequency
        }, raw);

      } else if (subCommand === 'disable') {
        // Disable feedback collection
        const config = feedback.loadConfig();
        config.feedback_enabled = false;
        feedback.saveConfig(config);

        output({
          message: 'Feedback collection disabled',
          feedback_enabled: false
        }, raw);

      } else if (subCommand === 'log') {
        // Read feedback log
        const correctIdx = args.indexOf('--correct');
        const modelIdx = args.indexOf('--model');
        const limitIdx = args.indexOf('--limit');

        const options = {};

        if (correctIdx !== -1) {
          const correctVal = args[correctIdx + 1];
          options.correct = correctVal === 'true';
        }

        if (modelIdx !== -1) {
          options.model = args[modelIdx + 1];
        }

        if (limitIdx !== -1) {
          options.limit = parseInt(args[limitIdx + 1], 10);
        } else {
          options.limit = 20;
        }

        const entries = feedback.readFeedbackLog(options);
        output({ entries, count: entries.length }, raw);

      } else if (subCommand === 'stats') {
        // Feedback statistics
        const stats = feedback.calculateFeedbackStats();
        output(stats, raw);

      } else if (subCommand === 'prompt') {
        // Generate feedback prompt (for testing)
        const taskIdx = args.indexOf('--task');
        const modelIdx = args.indexOf('--model');

        if (taskIdx === -1 || modelIdx === -1) {
          error('Missing required arguments. Usage: feedback prompt --task "description" --model MODEL');
        }

        const taskDescription = args[taskIdx + 1];
        const model = args[modelIdx + 1];

        const prompt = `
Task: ${taskDescription}
Model used: ${model}

Was ${model} the right choice for this task? (y/n): `;

        if (raw) {
          output({ prompt, task: taskDescription, model }, raw);
        } else {
          console.log(prompt);
        }

      } else {
        error('Unknown feedback subcommand. Available: config, enable, disable, log, stats, prompt');
      }
      break;
    }

    case 'learning': {
      const subCommand = args[1];

      if (subCommand === 'extract') {
        // Extract patterns from feedback
        const feedbackLog = learning.readFeedbackLog();
        const patterns = learning.extractPatterns(feedbackLog);
        output({ patterns, count: patterns.length }, raw);

      } else if (subCommand === 'merge') {
        // Merge learned rules with built-in
        const builtInRules = learning.loadBuiltInRules();
        const feedbackLog = learning.readFeedbackLog();
        const learnedPatterns = learning.extractPatterns(feedbackLog);
        const result = learning.mergeRules(builtInRules, learnedPatterns);

        // Write learned rules to markdown
        learning.writeLearnedRules(learnedPatterns);

        output({
          total_rules: result.rules.length,
          learned_count: learnedPatterns.length,
          overrides: result.stats.overrides,
          conflicts_insufficient: result.stats.insufficient,
          new_rules: result.stats.new
        }, raw);

      } else if (subCommand === 'rules') {
        // Show current learned rules
        const rulesPath = path.join(process.env.HOME, '.claude/gsd-learned-rules/learned-rules.md');

        if (!fs.existsSync(rulesPath)) {
          output({ rules: [], message: 'No learned rules file found' }, raw);
        } else {
          const content = fs.readFileSync(rulesPath, 'utf8');

          // Parse markdown table
          const lines = content.split('\n');
          const rules = [];
          let inTable = false;

          for (const line of lines) {
            if (line.startsWith('| Pattern |')) {
              inTable = true;
              continue;
            }
            if (line.startsWith('|---')) {
              continue;
            }
            if (inTable && line.startsWith('|')) {
              const parts = splitRowCells(line).filter(s => s);
              if (parts.length >= 3 && parts[0] !== '(no learned rules yet)') {
                rules.push({
                  pattern: parts[0],
                  model: parts[1],
                  evidence_count: parseInt(parts[2], 10)
                });
              }
            }
            if (inTable && !line.startsWith('|')) {
              break;
            }
          }

          output({ rules, count: rules.length }, raw);
        }

      } else if (subCommand === 'clear') {
        // Clear learned rules
        learning.writeLearnedRules([]);
        output({ message: 'Learned rules cleared' }, raw);

      } else if (subCommand === 'status') {
        // Learning system status
        const feedbackLog = learning.readFeedbackLog();
        const patterns = learning.extractPatterns(feedbackLog);

        // Get merge log stats
        const mergeLogPath = path.join(process.cwd(), '.planning/feedback/rule-merge-log.jsonl');
        let lastMerge = null;
        let mergeCount = 0;

        if (fs.existsSync(mergeLogPath)) {
          const lines = fs.readFileSync(mergeLogPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"'));

          mergeCount = lines.length;

          if (lines.length > 0) {
            try {
              const lastEntry = JSON.parse(lines[lines.length - 1]);
              lastMerge = lastEntry.timestamp;
            } catch (e) {
              // Ignore parse errors
            }
          }
        }

        // Get all feedback count
        const allFeedbackPath = path.join(process.cwd(), '.planning/feedback/human-feedback.jsonl');
        let totalFeedback = 0;

        if (fs.existsSync(allFeedbackPath)) {
          const lines = fs.readFileSync(allFeedbackPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"'));
          totalFeedback = lines.length;
        }

        output({
          feedback_count: totalFeedback,
          incorrect_count: feedbackLog.length,
          learned_rules_count: patterns.length,
          last_merge: lastMerge,
          merge_count: mergeCount
        }, raw);

      } else {
        error('Unknown learning subcommand. Available: extract, merge, rules, clear, status');
      }
      break;
    }

    case 'auto-task': {
      const subCommand = args[1];

      if (subCommand === 'status') {
        // Show Phase 2 system status
        const cwd = process.cwd();

        // Validation status
        const validationLogPath = path.join(cwd, '.planning/validation/validation-log.jsonl');
        let validationEntries = 0;
        if (fs.existsSync(validationLogPath)) {
          validationEntries = fs.readFileSync(validationLogPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"')).length;
        }

        // Circuit breaker status
        const thresholdsPath = path.join(cwd, '.planning/circuit-breaker/thresholds.json');
        let thresholds = { haiku: {}, sonnet: {}, opus: {} };
        if (fs.existsSync(thresholdsPath)) {
          try {
            thresholds = JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'));
          } catch (e) {
            // Use defaults
          }
        }

        // Escalation status
        const escalationLogPath = path.join(cwd, '.planning/escalation/escalation-log.jsonl');
        let totalEscalations = 0;
        const byModel = { haiku_to_sonnet: 0, sonnet_to_opus: 0, opus_to_fail: 0 };
        if (fs.existsSync(escalationLogPath)) {
          const lines = fs.readFileSync(escalationLogPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"'));

          totalEscalations = lines.length;

          lines.forEach(line => {
            try {
              const entry = JSON.parse(line);
              const from = entry.from_model || 'unknown';
              const to = entry.to_model || 'unknown';
              const key = `${from}_to_${to}`;
              if (byModel[key] !== undefined) byModel[key]++;
            } catch (e) {
              // Ignore parse errors
            }
          });
        }

        // Feedback status
        const feedbackConfig = feedback.loadConfig();
        const feedbackLogPath = path.join(cwd, '.planning/feedback/human-feedback.jsonl');
        let feedbackEntries = 0;
        if (fs.existsSync(feedbackLogPath)) {
          feedbackEntries = fs.readFileSync(feedbackLogPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"')).length;
        }

        // Learning status
        const learnedRulesPath = path.join(process.env.HOME, '.claude/gsd-learned-rules/learned-rules.md');
        let rulesCount = 0;
        if (fs.existsSync(learnedRulesPath)) {
          const content = fs.readFileSync(learnedRulesPath, 'utf8');
          const lines = content.split('\n');
          rulesCount = lines.filter(line =>
            line.startsWith('|') &&
            !line.includes('Pattern |') &&
            !line.includes('---') &&
            !line.includes('(no learned rules yet)')
          ).length;
        }

        const mergeLogPath = path.join(cwd, '.planning/feedback/rule-merge-log.jsonl');
        let lastMerge = null;
        if (fs.existsSync(mergeLogPath)) {
          const lines = fs.readFileSync(mergeLogPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"'));

          if (lines.length > 0) {
            try {
              const lastEntry = JSON.parse(lines[lines.length - 1]);
              lastMerge = lastEntry.timestamp;
            } catch (e) {
              // Ignore parse errors
            }
          }
        }

        output({
          validation: {
            enabled: true,
            log_entries: validationEntries
          },
          circuit_breaker: {
            thresholds: thresholds,
            configured: Object.keys(thresholds).length > 0
          },
          escalation: {
            total: totalEscalations,
            by_model: byModel
          },
          feedback: {
            enabled: feedbackConfig.enabled,
            entries: feedbackEntries
          },
          learning: {
            rules_count: rulesCount,
            last_merge: lastMerge
          }
        }, raw);

      } else if (subCommand === 'report') {
        // Generate end-of-execution report
        const cwd = process.cwd();
        const jsonFlag = args.includes('--json');

        // Aggregate validation stats (inline implementation)
        const validationLogPath = path.join(cwd, '.planning/validation/validation-log.jsonl');
        let validationStats = { total: 0, passed: 0, pass_rate: 0, by_depth: {} };

        if (fs.existsSync(validationLogPath)) {
          const lines = fs.readFileSync(validationLogPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"'));

          const entries = lines.map(line => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          }).filter(e => e !== null);

          const total = entries.length;
          const passed = entries.filter(e => e.recommendation === 'PASS').length;
          const passRate = total > 0 ? (passed / total) : 0;

          const byDepth = {};
          ['light', 'standard', 'thorough'].forEach(depth => {
            const depthEntries = entries.filter(e => e.depth === depth);
            const depthPassed = depthEntries.filter(e => e.recommendation === 'PASS').length;
            if (depthEntries.length > 0) {
              byDepth[depth] = {
                total: depthEntries.length,
                passed: depthPassed,
                pass_rate: depthPassed / depthEntries.length
              };
            }
          });

          validationStats = { total, passed, pass_rate: passRate, by_depth: byDepth };
        }

        // Aggregate escalation history (inline implementation)
        const escalationLogPath = path.join(cwd, '.planning/escalation/escalation-log.jsonl');
        let escalationLog = [];

        if (fs.existsSync(escalationLogPath)) {
          const lines = fs.readFileSync(escalationLogPath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('{"_comment"'));

          escalationLog = lines.map(line => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          }).filter(e => e !== null);
        }

        // Aggregate feedback summary
        const feedbackStats = feedback.calculateFeedbackStats();

        const report = {
          validation: validationStats,
          escalation: {
            total: escalationLog.length,
            history: escalationLog.map(e => ({
              task_id: e.task_id,
              from_model: e.from_model,
              to_model: e.to_model,
              reason: e.reason,
              timestamp: e.timestamp
            }))
          },
          feedback: feedbackStats
        };

        if (jsonFlag || raw) {
          output(report, true);
        } else {
          // Format as readable text
          console.log('=== Phase 2 Execution Report ===\n');

          console.log('VALIDATION SUMMARY:');
          console.log(`  Total: ${report.validation.total}`);
          console.log(`  Passed: ${report.validation.passed}`);
          console.log(`  Pass Rate: ${(report.validation.pass_rate * 100).toFixed(1)}%`);
          if (Object.keys(report.validation.by_depth).length > 0) {
            console.log('  By Depth:');
            Object.entries(report.validation.by_depth).forEach(([depth, stats]) => {
              console.log(`    ${depth}: ${stats.passed}/${stats.total} (${(stats.pass_rate * 100).toFixed(1)}%)`);
            });
          }
          console.log('');

          console.log('ESCALATION HISTORY:');
          console.log(`  Total: ${report.escalation.total}`);
          if (report.escalation.history.length > 0) {
            report.escalation.history.forEach(e => {
              console.log(`  - ${e.task_id}: ${e.from_model} → ${e.to_model} (${e.reason})`);
            });
          } else {
            console.log('  (none)');
          }
          console.log('');

          console.log('FEEDBACK SUMMARY:');
          console.log(`  Total: ${report.feedback.total_feedback}`);
          console.log(`  Correct: ${report.feedback.correct_selections || 0}`);
          console.log(`  Incorrect: ${report.feedback.incorrect_selections || 0}`);
          console.log(`  Correct Rate: ${report.feedback.correct_rate}%`);
          if (Object.keys(report.feedback.incorrect_by_model).length > 0) {
            console.log('  Incorrect by Model:');
            Object.entries(report.feedback.incorrect_by_model).forEach(([model, count]) => {
              console.log(`    ${model}: ${count}`);
            });
          }
        }

      } else {
        error('Unknown auto-task subcommand. Available: status, report');
      }
      break;
    }

    case 'requirements': {
      const subcommand = args[1];
      if (subcommand === 'mark-complete') {
        cmdRequirementsMarkComplete(cwd, args.slice(2), raw);
      } else {
        error('Unknown requirements subcommand. Available: mark-complete');
      }
      break;
    }

    case 'routing': {
      const subcommand = args[1];
      if (subcommand === 'classify-failure') {
        cmdRoutingClassifyFailure(cwd, args.slice(2).join(' '), raw);
      } else if (subcommand === 'escalation-decision') {
        const currentTierIdx = args.indexOf('--current-tier');
        const errorSummaryIdx = args.indexOf('--error-summary');
        const escalationsUsedIdx = args.indexOf('--escalations-used');
        const failsIdx = args.indexOf('--fails-at-tier');
        const rescuesIdx = args.indexOf('--rescues-used');
        cmdRoutingEscalationDecision(cwd, {
          failsAtTier: failsIdx !== -1 ? args[failsIdx + 1] : null,
          rescuesUsed: rescuesIdx !== -1 ? args[rescuesIdx + 1] : null,
          currentTier: currentTierIdx !== -1 ? args[currentTierIdx + 1] : null,
          errorSummary: errorSummaryIdx !== -1 ? args[errorSummaryIdx + 1] : null,
          escalationsUsed: escalationsUsedIdx !== -1 ? args[escalationsUsedIdx + 1] : null,
        }, raw);
      } else {
        error('Unknown routing subcommand. Available: classify-failure, escalation-decision');
      }
      break;
    }

    case 'quality': {
      const subcommand = args[1];
      if (subcommand === 'touches-source') {
        const filesIdx = args.indexOf('--files');
        const filesArg = filesIdx !== -1 ? (args[filesIdx + 1] || '') : '';
        const fileList = filesArg.split(',').map(s => s.trim()).filter(Boolean);
        output({ touches_source_code: computeTouchesSourceCode(fileList), file_count: fileList.length }, raw);
      } else if (subcommand === 'assess-risk') {
        cmdQualityAssessRisk(cwd, args[2], raw);
      } else if (subcommand === 'verdict-to-issues') {
        cmdQualityVerdictToIssues(cwd, args[2], raw, args.includes('--require'));
      } else {
        error('Unknown quality subcommand. Available: touches-source, assess-risk, verdict-to-issues');
      }
      break;
    }

    case 'log-feature-event': {
      // CLI bridge for subagents that cannot call appendEvent directly.
      // Usage: node gsd-tools.js log-feature-event --project-path <path> --type <EVENT_TYPE> --data <json>
      const projectPathIdx = args.indexOf('--project-path');
      const typeIdx = args.indexOf('--type');
      const dataIdx = args.indexOf('--data');

      if (projectPathIdx === -1 || typeIdx === -1) {
        error('log-feature-event: --project-path and --type are required');
        break;
      }

      const featureEventProjectPath = args[projectPathIdx + 1];
      const featureEventType = args[typeIdx + 1];
      let featureEventData = {};
      if (dataIdx !== -1) {
        try { featureEventData = JSON.parse(args[dataIdx + 1]); } catch (_) { /* ignore malformed JSON */ }
      }

      try {
        if (!featureEventProjectPath || typeof featureEventProjectPath !== 'string') {
          error('log-feature-event: --project-path must be a non-empty string');
          break;
        }
        const resolvedFeaturePath = findProjectRoot(featureEventProjectPath);
        const result = appendEvent(resolvedFeaturePath, { type: featureEventType, ...featureEventData });
        output(result, raw, 'Feature event appended to EXECUTION_LOG.md');
      } catch (err) {
        error(`log-feature-event: failed to append event: ${err.message}`);
      }
      break;
    }

    case 'service-health': {
      await cmdServiceHealth(cwd, args.slice(1), raw);
      break;
    }

    case 'gate': {
      const subCmd = args[1];
      if (subCmd === 'pre-pr') {
        cmdGatePrePr(cwd, args.slice(2), raw);
      } else {
        console.error(`Unknown gate subcommand: ${subCmd}`);
        process.exit(1);
      }
      break;
    }

    default:
      error(`Unknown command: ${command}`);
  }
}

// module.exports is assigned BEFORE the require.main guard below (not after)
// so that a circular require('./gsd-tools.js') from another same-directory
// module (e.g. analytics.js's lazy telemetry-helpers require, MILE-26) sees
// the fully-populated exports object even when gsd-tools.js is the CLI entry
// point currently executing main() -- otherwise Node's circular-dependency
// resolution would hand back an empty/partial exports object mid-main().
module.exports = {
  parseDeathSignature,
  parseResetTime,
  checkStaleness,
  parseCheckpointForResume,
  buildResumeBrief,
  estimateQuotaForRemainingPhases,
  scanUsageWindow,
  computeManifestDrift,
  summarizeTelemetryReports,
  appendTelemetryReport,
  readTelemetryReports,
  countTestCalls,
  countAssertions,
  milestoneAlreadyRecorded,
  buildHandoffBrief,
  cmdHandoffBrief,
  getPhaseInvariantsText,
  buildEvalCandidateFromDebugFile,
  buildEvalCandidatesFromVerificationFile,
  appendVerificationGap,
  writeEvalCandidates,
  validateEvalCandidateSchema,
  classifyFailure,
  decideEscalation,
  NON_CAPABILITY_PATTERNS,
  loadConfig,
  isSourceFile,
  isTestOrSpecFile,
  evaluateSummarySelfCheck,
  collectPhaseEvidenceErrors,
  collectPhaseTouchedFiles,
  planTagGrepPattern,
  hasVerifiedMutantCite,
  parseTestDelta,
  splitTestCases,
  scanHollowReasons,
  scanNewHollowCases,
  SENSITIVE_PATH_RE,
  isApiFile,
  computeHasApi,
  computeTouchesSourceCode,
  verdictToIssues,
  runP0TierAssignmentGate,
  compareGateCapabilities,
};

// Only auto-run when invoked directly as a CLI (`node gsd-tools.js ...`), not
// when required as a module -- lets tests `require()` the pure resilience
// helpers below (which take a controllable `referenceDate`/path argument,
// e.g. parseResetTime) without triggering main()'s process.argv-driven
// side effects (which would call process.exit() inside the test process).
// The CLI's own behavior is completely unaffected by this guard.
if (require.main === module) {
  main();
}
