# External Integrations

**Analysis Date:** 2026-02-15

## APIs & External Services

**Brave Search (Optional):**
- Service: Brave Search API
- What it's used for: Web search functionality in `gsd-tools.js` via `websearch` command
- SDK/Client: Direct HTTP calls via child_process or built-in modules
- Auth: `BRAVE_API_KEY` environment variable or `~/.gsd/brave_api_key` file
- Configuration: `brave_search` boolean in `.planning/config.json`
- Status: Optional - feature disabled by default, enabled only when API key detected

**NPM Registry:**
- Service: npmjs.org
- What it's used for: Version checking and package distribution
- SDK/Client: Direct `npm` CLI commands via execSync
- Used by: `gsd-check-update.js` hook for checking latest version availability
- Command: `npm view get-shit-done-cc version`

**GitHub API (Implicit):**
- Service: GitHub
- What it's used for: Repository information, issue templates, workflows
- Client: Git command-line tool
- Integration: Git operations for commits and branch management

## Data Storage

**File-Based Storage:**
- `.planning/config.json` - User configuration and settings
- `.planning/STATE.md` - Project state and progress tracking
- `.planning/ROADMAP.md` - Phase and milestone definitions
- `.planning/codebase/` - Analysis documents (STACK.md, ARCHITECTURE.md, etc.)
- `.planning/todos/` - Todo management (pending and completed)
- Local project files - No external database required

**No Remote Storage:**
- All data persists locally in project repository
- No cloud sync or remote backend

## Authentication & Identity

**Auth Provider:**
- Custom/None - No built-in authentication system
- Multi-runtime support: Claude Code, OpenCode, Gemini CLI handled via config directories
- Model resolution: Profile-based selection (quality/balanced/budget) → model assignment

**Model Profiles:**
Agent-to-model mapping defined in `get-shit-done/bin/gsd-tools.js` (lines 125-137):
```javascript
const MODEL_PROFILES = {
  'gsd-planner':              { quality: 'opus', balanced: 'opus',   budget: 'sonnet' },
  'gsd-roadmapper':           { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'gsd-executor':             { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'gsd-phase-researcher':     { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'gsd-project-researcher':   { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
  'gsd-research-synthesizer': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'gsd-debugger':             { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' },
  'gsd-codebase-mapper':      { quality: 'sonnet', balanced: 'haiku', budget: 'haiku' },
  'gsd-verifier':             { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'gsd-plan-checker':         { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
  'gsd-integration-checker':  { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
};
```

Models referenced: `opus`, `sonnet`, `haiku` (Anthropic Claude models)

## Monitoring & Observability

**Error Tracking:**
- None detected - Standard process error handling and exit codes

**Logs:**
- Console output via `process.stdout` and `process.stderr`
- Error messages written to stderr with format: `Error: [message]`
- Status information printed to stdout as JSON or plain text depending on `--raw` flag
- Background processes (update checks, statusline) run detached with `stdio: 'ignore'`

**Version Checking:**
- Background hook: `gsd-check-update.js`
- Cache location: `~/.claude/cache/gsd-update-check.json`
- Runs detached/non-blocking via spawned child process
- Caches version info to avoid repeated npm queries

## CI/CD & Deployment

**Hosting:**
- npm registry: https://www.npmjs.com/package/get-shit-done-cc

**Distribution Method:**
- npm package: `npx get-shit-done-cc@latest` or `npm install -g get-shit-done-cc`
- Installation script: `bin/install.js` handles setup for multiple runtimes

**CI/CD Pipeline:**
- GitHub Actions workflows present in `.github/workflows/`
- Auto-labeling workflow: `gsd-workflows-triage.yml` (applies needs-triage label to new issues)
- Issue templates and PR template configured in `.github/`

**Repository:**
- GitHub: https://github.com/glittercowboy/get-shit-done
- Default branch: `main`

## Environment Configuration

**Critical Environment Variables:**
- `CLAUDE_CONFIG_DIR` - Override Claude Code config location
- `OPENCODE_CONFIG_DIR` / `OPENCODE_CONFIG` - OpenCode configuration paths
- `GEMINI_CONFIG_DIR` - Gemini CLI config directory
- `XDG_CONFIG_HOME` - XDG Base Directory spec support
- `BRAVE_API_KEY` - Optional Brave Search API key

**Secrets Location:**
- `~/.gsd/brave_api_key` - File-based storage for Brave Search API key
- Environment variables - For all configuration
- No .env files detected or required in main distribution

**Configuration Files:**
- `.planning/config.json` - Main project configuration (created on first run)
- `.claude/get-shit-done/VERSION` - Project-level version tracking
- `~/.claude/get-shit-done/VERSION` - Global installation version

## Webhooks & Callbacks

**Incoming:**
- None detected - No webhook endpoints in this tool

**Outgoing:**
- None detected - Tool is request-only (queries npm, Brave Search if configured)

## Git Integration

**Operations:**
- `git check-ignore` - Check if files are gitignored (used in `isGitIgnored()` function)
- `git add`, `git commit` - Commit planning documents
- `git log`, `git diff` - Branch analysis and commit inspection
- Branch creation and management via template names

**Branching:**
- `phase_branch_template` - Template for phase branches: `gsd/phase-{phase}-{slug}`
- `milestone_branch_template` - Template for milestone branches: `gsd/{milestone}-{slug}`
- Strategy configurable: none, feature, trunk-based, etc.

## Command-Line Tool Integration

**Child Process Execution:**
- Uses `execSync()` and `spawn()` for running git, npm, and other CLI tools
- Timeout protection where applicable
- Error handling with exit codes and stderr capture

**Execution Examples:**
- Version checking: spawns background npm process
- Git operations: execSync for git commands
- YAML/frontmatter parsing: Pure JavaScript (no external parsers)

---

*Integration audit: 2026-02-15*
