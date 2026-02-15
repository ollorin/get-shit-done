# Codebase Concerns

**Analysis Date:** 2026-02-15

## Tech Debt

**Overengineered Codebase Intelligence System (Removed):**
- Issue: SQLite graph database and entity relationship tracking was removed in v1.9.2 due to overengineering
- Why: Initial implementation added 21MB of dependencies (sql.js) for a feature that didn't justify the complexity
- Impact: Removed feature set but clean removal means no residual code
- Fix approach: Solved — system removed cleanly

**Path Normalization Across Platforms:**
- Issue: File path handling requires Windows backslash normalization in multiple places (`install.js`, `gsd-tools.js`, workflows)
- Files: `bin/install.js`, `get-shit-done/bin/gsd-tools.js`, `get-shit-done/workflows/` (execute-phase, etc.)
- Impact: Cross-platform bugs can silently occur — paths fail on Windows without explicit normalization
- Fix approach: Centralize path normalization in gsd-tools.js as a utility function, use consistently across all commands and workflows. Already partially addressed (v1.17.0 normalized backslash paths) but could be more systematic.

**Tilde Path Expansion Inconsistency:**
- Issue: Multiple runtime config paths require tilde expansion logic repeated across install.js (~150 lines of path resolution code)
- Files: `bin/install.js` (expandTilde function and getGlobalDir/getOpencodeGlobalDir functions)
- Impact: Container/Docker deployments may fail if tilde doesn't expand correctly; README documents workaround (`CLAUDE_CONFIG_DIR` env var)
- Fix approach: Extract tilde expansion and path resolution into a single utility module in gsd-tools.js, import into install.js

**Session Hook Architecture Complexity:**
- Issue: Hooks run shell scripts (bash/sh) that detect non-TTY environments and fallback gracefully, but logic is duplicated across platforms
- Files: `hooks/` directory (SessionStart hook, statusline hooks for Mac/Linux/Windows)
- Impact: Maintenance burden when adding new hook types; bugs in one platform not caught until testing that specific OS
- Fix approach: Consolidate hook registration and TTY detection into centralized hook manager

## Known Bugs

**Claude Code `classifyHandoffIfNeeded` False Failures:**
- Symptoms: Agent reports "failed" with error `classifyHandoffIfNeeded is not defined` during execute-phase orchestration
- Trigger: Occurs unpredictably during parallel agent execution, appears to be a Claude Code runtime bug
- Workaround: Execute-phase and quick workflows now spot-check actual output (SUMMARY.md exists, git commits present, `## Self-Check: FAILED` marker absent) before treating as real failure
- Root cause: Claude Code bug (not GSD) — error fires in completion handler AFTER all tool calls finish
- Status: **Mitigated** — Added detection and recovery in v1.17.0 (`get-shit-done/workflows/execute-phase.md` lines 165, 327)

**OpenCode Config Parser Fragility:**
- Symptoms: Installer crashes when encountering JSON with comments, trailing commas, or BOM
- Trigger: Reading ~/.config/opencode/opencode.json with JSONC format
- Workaround: Fixed in v1.14.0 — now handles comments, trailing commas, BOM correctly
- Root cause: Using strict JSON.parse instead of JSONC parser
- Status: **Fixed**

**WSL2 / Non-TTY Terminal Detection:**
- Symptoms: Installation fails silently on non-interactive stdin (Docker, CI, WSL without TTY)
- Trigger: Running installer in container or headless environment without `-g`/`-l` flags
- Workaround: Detects non-interactive stdin and falls back to global install automatically (v1.6.4+)
- Root cause: readline.createInterface behaves differently on non-TTY environments
- Status: **Fixed** with fallback behavior

**Subagent MCP Tool Access (Claude Code Limitation):**
- Symptoms: Subagents (spawned via gsd-executor, gsd-debugger, etc.) cannot access MCP tools in some Claude Code versions
- Trigger: Using Context7 or other MCP tools when spawning subagents
- Workaround: Added workaround in v1.9.5 — agents now attempt tool access but continue if unavailable
- Root cause: Claude Code bug #13898 — MCP context not inherited by spawned agents in some versions
- Status: **Mitigated**

**Executor Hallucinated Success:**
- Symptoms: SUMMARY.md claims tasks completed when they were actually stubs or incomplete
- Trigger: Executor doesn't verify task completion programmatically before marking done
- Workaround: Verifier now checks artifacts substantively (3-level verification: exists, substantive, wired) in v1.11.2+
- Root cause: Executor relied on Claude's self-report rather than checking actual artifacts
- Status: **Mitigated** — executor now verifies task completion, verifier performs deep checks

## Security Considerations

**Secrets Exposure in Codebase Mapping:**
- Risk: `/gsd:map-codebase` reads files to analyze codebase; API keys, credentials could be committed to planning docs
- Files: `agents/gsd-codebase-mapper.md`
- Current mitigation:
  - Built-in protections: codebase mapper has forbidden file list (`.env*`, `*.key`, `*.pem`, credentials files)
  - Defense in depth: README documents Claude Code deny rules for sensitive files (`.claude/settings.json` permissions)
  - Agent prompt explicitly documents secret files to skip
- Recommendations:
  - Add pre-execution check that reads `.gitignore` and skips those patterns
  - Warn users if secret file patterns are detected before mapping
  - Log which files were skipped for transparency

**Environment Variable Leakage:**
- Risk: Planning docs tracked in git may accidentally contain values like `API_KEY=sk-...`
- Files: All `.planning/` directories that get committed (configurable via `planning.commit_docs`)
- Current mitigation:
  - `planning.commit_docs: false` option lets users opt out of tracking planning docs
  - README security section documents deny rules
  - Installer asks about git tracking during `/gsd:new-project`
- Recommendations:
  - Pre-commit hook to scan `.planning/` for obvious secret patterns (sk-, pk-, Bearer, API_KEY=)
  - Document best practices in SECURITY.md for sensitive projects

**JSON Config File Permissions:**
- Risk: `config.json` and local `.claude/settings.json` stored with default permissions; could be world-readable
- Files: `bin/install.js` (file creation), gsd-tools.js (config file operations)
- Current mitigation: Uses system defaults (usually restricted to user)
- Recommendations:
  - Explicitly chmod config files to 0600 after creation
  - Document permission requirements in README

**OpenCode XDG Base Directory Handling:**
- Risk: Multiple env var paths checked for OpenCode config location; incorrect order could read wrong config
- Files: `bin/install.js` (lines 54-72, getOpencodeGlobalDir function)
- Current mitigation: Correct XDG precedence implemented (OPENCODE_CONFIG_DIR > OPENCODE_CONFIG > XDG_CONFIG_HOME > ~/.config/opencode)
- Recommendations: Document this precedence clearly in code comments

## Performance Bottlenecks

**Context Window Management in Orchestrators:**
- Problem: Orchestrators (execute-phase, plan-phase) load full file contents in memory for analysis
- Measurement: Large ROADMAP.md + all SUMMARY.md files can reach 50-100KB; many concurrent reads
- Cause: Inefficient file I/O patterns in bash workflows — reads same files multiple times
- Files: `get-shit-done/workflows/execute-phase.md`, `get-shit-done/workflows/plan-phase.md`
- Improvement path:
  - Use gsd-tools.js memoization (already partially implemented via `history-digest`)
  - Cache phase/plan metadata in single JSON file rather than parsing multiple SUMMARY.md files
  - Pass paths to subagents rather than embedding full content

**Parallel Execution Wave Dependencies:**
- Problem: Wave execution waits for all agents to complete before proceeding; if one agent is slow, entire wave blocks
- Measurement: N/A (depends on Claude API latency)
- Cause: Orchestrator design requires all agents in wave to complete before next wave starts
- Files: `get-shit-done/workflows/execute-phase.md` (step: execute_waves)
- Improvement path:
  - Implement streaming results — process completed plans immediately instead of waiting for wave
  - Add timeout mechanism for hung agents
  - Implement priority queue for dependent plans

**Git Operations Overhead:**
- Problem: Each task commit requires separate `git add` + `git commit` call; N tasks = N git operations
- Measurement: ~500ms per commit on typical systems
- Cause: Atomic commit design requires per-task commits for bisect-ability
- Files: gsd-tools.js (commit function), all executor workflows
- Improvement path:
  - Batch stage changes but still commit separately (reduce git overhead by staging once)
  - Pre-compute commit hashes to verify success without reading logs

## Fragile Areas

**Plan Execution State Management (Checkpoints & Continuations):**
- Files: `agents/gsd-executor.md`, `get-shit-done/references/checkpoints.md`, `get-shit-done/references/continuation-format.md`
- Why fragile:
  - Checkpoint system relies on fresh agent spawning with explicit state passed in prompt
  - Continuation agents reconstruct execution context from tables embedded in markdown
  - No type checking or schema validation on checkpoint payloads
- Common failures:
  - Checkpoint table format changes break continuation parsing
  - Task numbers get renumbered manually, losing reference to checkpoint state
  - Parallel checkpoints in different waves can have ordering issues
- Safe modification:
  - Always validate continuation format against schema before spawning continuation agent
  - Use gsd-tools.js `verify-references` to check table integrity
  - Add YAML frontmatter validation for checkpoint payloads
- Test coverage: Tested implicitly via `/gsd:execute-phase` with checkpoint plans, but no isolated unit tests

**Wave Dependency Resolution:**
- Files: `get-shit-done/bin/gsd-tools.js` (phase-plan-index command), `get-shit-done/workflows/execute-phase.md`
- Why fragile:
  - Dependency graph computed from plan `depends_on` field; no cycle detection
  - Wave grouping algorithm assumes all dependencies are in earlier waves
  - Circular dependencies would cause infinite loops or deadlocks
- Common failures:
  - Plan marked with wrong wave number manually → breaks dependency chain
  - Circular dependency (Plan A depends_on B, B depends_on A) causes execution to halt
  - Missing wave number causes plan to execute with unmet dependencies
- Safe modification:
  - Always use `gsd-tools.js phase add` to add plans (auto-assigns waves)
  - Never manually edit wave numbers or depends_on fields
  - Run `gsd-tools.js validate consistency` before execution
- Test coverage: No automated tests for cycle detection; validated manually in test suite

**Path Resolution Logic:**
- Files: `bin/install.js` (tilde expansion, config dir resolution), `get-shit-done/bin/gsd-tools.js` (path operations)
- Why fragile:
  - Different runtimes (Claude Code, OpenCode, Gemini) use different config directory conventions
  - Tilde expansion fails in containers or when `$HOME` not set
  - Symlinks and relative paths not handled uniformly
  - Windows backslash vs forward slash normalization scattered across codebase
- Common failures:
  - Install to wrong config directory on OpenCode (if XDG_CONFIG_HOME set unexpectedly)
  - Paths fail in Docker without `CLAUDE_CONFIG_DIR` env var
  - Windows paths in agent prompts cause command failures
  - Symlinks in project structure break phase discovery
- Safe modification:
  - Always use `expandTilde` function from install.js before using paths
  - Use `path.resolve()` to canonicalize paths (handles symlinks and relative paths)
  - Test on Windows, Mac, Linux, and Docker before merging path changes
  - Use path.normalize() and path.join() consistently, never string concatenation
- Test coverage: Manual testing on multiple platforms; automated tests could be added

**Phase Discovery and Numbering:**
- Files: `get-shit-done/bin/gsd-tools.js` (find-phase, phase add, phase remove), `get-shit-done/workflows/` (all phase workflows)
- Why fragile:
  - Phase numbers use decimal notation (1, 1.1, 1.2, 2, etc.) — non-standard sorting
  - Renumbering after phase removal requires updating all references (ROADMAP, REQUIREMENTS, STATE, plan depends_on)
  - Directory names must match phase numbers for discovery to work
  - Phases can be removed out of order, creating gaps
- Common failures:
  - `ls` sorts phases alphabetically (1, 1.1, 1.10, 1.2...) instead of numerically
  - Removing middle phase leaves references in ROADMAP pointing to non-existent phase
  - Plans with `depends_on` pointing to removed phase cause orchestrator to skip them
  - Phase directories numbered incorrectly when manually created
- Safe modification:
  - ONLY use `gsd-tools.js phase add`, `phase insert`, `phase remove` commands — never manual directory creation
  - Always run `gsd-tools.js validate consistency` before and after phase modifications
  - Check REQUIREMENTS.md for phase references before removing a phase
  - Use `gsd-tools.js roadmap analyze` to see full dependency graph
- Test coverage: Tested in v1.16.0+ via gsd-tools commands; manual verification recommended

**Artifact Verification (Stubs vs Real Implementation):**
- Files: `agents/gsd-verifier.md` (verify artifacts function), `get-shit-done/references/verification-patterns.md`
- Why fragile:
  - Stub detection relies on heuristics (file line count, presence of patterns)
  - Components can pass artifact checks but still be non-functional (e.g., render without state wiring)
  - Import detection uses grep patterns that can have false positives (commented imports, string literals containing import statements)
  - "Wired" status determined by import + usage patterns; not type-safe
- Common failures:
  - Large stub files (50+ lines) pass line-count check but are just comments/types
  - Component imports exist but never actually used in execution
  - API endpoints respond but return hardcoded/stale data
  - Database queries execute but against wrong schema
- Safe modification:
  - Modify stub detection heuristics carefully — test against existing projects
  - Don't rely solely on artifact verification; always use `/gsd:verify-work` for human UX testing
  - Keep VERIFICATION.md checks automated but supplement with manual testing steps
  - Document custom patterns for domain-specific verification (e.g., API response schema checks)
- Test coverage: Tested via UAT flows; no isolated unit tests for verification heuristics

**CONTEXT.md Flow Through Planning Pipeline:**
- Files: `get-shit-done/workflows/discuss-phase.md`, `agents/gsd-phase-researcher.md`, `agents/gsd-planner.md`, `agents/gsd-plan-checker.md`
- Why fragile:
  - User decisions in CONTEXT.md must flow to all downstream agents
  - If any agent skips CONTEXT.md, decisions are ignored
  - CONTEXT.md format not standardized; researcher and planner parse it differently
  - No schema validation that CONTEXT.md answers required questions
- Common failures:
  - Researcher ignores CONTEXT.md decisions about tech stack, proposes alternatives instead
  - Plans created before CONTEXT.md steps (missing `/gsd:discuss-phase`) use defaults instead of user vision
  - Verifier can't check context compliance if CONTEXT.md wasn't created
  - Format changes break parsing (agent prompts hardcode section names)
- Safe modification:
  - ALWAYS run `/gsd:discuss-phase` before `/gsd:plan-phase`
  - Store CONTEXT.md path in STATE.md to ensure all agents load it
  - Add schema validation to check CONTEXT.md has required sections
  - Use gsd-tools.js to parse CONTEXT.md, not regex patterns
- Test coverage: Tested via workflow testing; no unit tests for CONTEXT.md parsing consistency

## Scaling Limits

**Phase Directory Structure Limits:**
- Current capacity: ~100 phases reasonable; ~1000 phases becomes unwieldy (discovery, sorting, validation slower)
- Limit: File system and bash glob expansion don't scale well beyond 1000 items
- Cause: Using `ls` + filtering in bash; decimal numbering requires custom sort
- Scaling path:
  - Use centralized phase registry in gsd-tools.js instead of directory listing
  - Cache phase metadata in JSON file to avoid repeated file system traversals
  - Implement lazy loading for large roadmaps (load only N phases at a time)

**ROADMAP.md File Size:**
- Current capacity: ~50-100 phases before file becomes unwieldy (>50KB)
- Limit: Parsing becomes slow, markdown viewers struggle, git diffs become noise
- Cause: Monolithic roadmap file accumulates all historical phases + current phases
- Scaling path:
  - Archive completed milestones to separate files (`MILESTONES.md`)
  - Split active phases into separate files by milestone
  - Move planning docs to sparse format (JSON instead of markdown) for large projects

**Parallel Agent Execution Limits:**
- Current capacity: 5-10 parallel subagents seem reasonable; Claude API has rate limits
- Limit: Too many parallel agents hit API rate limits, causing timeouts
- Cause: Each agent in wave spawns independently with fresh 200k context windows
- Scaling path:
  - Batch requests to Claude API (group small agents into single task)
  - Implement exponential backoff for rate-limited requests
  - Add configurable wave concurrency limit (currently all agents in wave run in parallel)

**Git Commit Frequency:**
- Current capacity: ~100 commits per phase seems reasonable
- Limit: Excessive commits create repo size issues, make git log hard to navigate, slow CI/CD
- Cause: Per-task atomic commits are intentional design but can accumulate quickly
- Scaling path:
  - Option: Squash commits at milestone completion (already supported)
  - Option: Batch related tasks into single commit (trade bisect-ability for fewer commits)
  - Option: Archive old milestones to separate git branches

## Dependencies at Risk

**Brave Search API Dependency (Optional):**
- Risk: Brave API used for web search in research phase; requires API key; subject to rate limits and API changes
- Impact: Breaks `/gsd:plan-phase` research step if API key not configured or API quota exceeded
- Files: `get-shit-done/bin/gsd-tools.js` (websearch command)
- Current mitigation: Optional — research can proceed without web search
- Migration plan: If Brave API sunsets, replace with alternative search API (DuckDuckGo, SerpAPI) or make research fully AI-based

**Node.js Runtime Version:**
- Risk: Requires Node.js >=16.7.0; older systems may not have compatible version
- Impact: Installer fails with cryptic error on older Node versions
- Files: `package.json` (engines field)
- Current mitigation: Error message could be more explicit
- Migration plan:
  - Add version check in install.js with helpful error message
  - Document Node.js install instructions for unsupported systems

**esbuild Dependency (Build-Time Only):**
- Risk: esbuild used to compile hooks; breaking changes in esbuild API could break hook compilation
- Impact: Breaks installer if esbuild major version incompatibility occurs
- Files: `package.json` (devDependencies), `scripts/build-hooks.js`
- Current mitigation: Locked to ^0.24.0 (compatible with current API)
- Migration plan: Monitor esbuild releases; update build script if API changes

## Missing Critical Features

**Conflict Detection During Parallel Execution:**
- Problem: When multiple plans modify same file, conflicts not detected until manual merge
- Blocks: Clean concurrent development; forces sequential execution for safety
- Impact: Limits parallelization benefits; waves must be ordered to avoid file conflicts
- Current status: Documented in deviation rules but no automated detection
- Recommendation: Add pre-execution conflict analysis — scan plan artifacts for overlaps

**Automated Rollback on Phase Failure:**
- Problem: If phase verification fails, no automated way to revert commits
- Blocks: Users must manually `git revert` failed commits or fix issues
- Impact: Error recovery requires manual git operations; error-prone
- Current status: Checkpoint system allows pausing but not rolling back
- Recommendation: Add rollback option to `/gsd:execute-phase` failure handler

**Schema Validation for Planning Docs:**
- Problem: PLAN.md, ROADMAP.md, REQUIREMENTS.md have no schema; agents can create invalid documents
- Blocks: Reliable downstream processing; verification can't assume format consistency
- Impact: Parser errors cause workflow failures with unhelpful error messages
- Current status: Partial validation in gsd-tools.js; no comprehensive schema
- Recommendation: Define JSON schema for all planning documents; add validation step after generation

**API Endpoint Documentation Generation:**
- Problem: Phases that create APIs don't automatically document endpoints
- Blocks: Generated code lacks swagger/OpenAPI specs; integration is manual discovery
- Impact: Downstream integrations require reverse engineering API surface
- Current status: No automation for this; must be manual phase objective
- Recommendation: Add optional phase type for API generation that auto-produces OpenAPI spec

## Test Coverage Gaps

**Unit Tests for Phase/Dependency Logic:**
- What's not tested: `gsd-tools.js` phase operations (add, insert, remove, complete) lack isolated unit tests
- Files: `get-shit-done/bin/gsd-tools.js`, `get-shit-done/bin/gsd-tools.test.js`
- Risk: Renumbering logic has subtle off-by-one errors that only manifest with complex phase structures
- Priority: **High** — Phase management is critical path, affects all milestones
- Improvement: Add test cases for edge cases (decimal insertion, deletion gaps, circular dependency detection)

**Integration Tests for Multi-Wave Execution:**
- What's not tested: Parallel execution with dependencies, checkpoint resumption, failure recovery
- Files: `get-shit-done/workflows/execute-phase.md`, `agents/gsd-executor.md`
- Risk: Checkpoint logic only tested manually; edge cases (partial wave failure, hung agent) not covered
- Priority: **High** — Execute-phase is the main execution engine
- Improvement: Create test project with multi-wave plans and verify orchestration

**Cross-Platform Integration Tests:**
- What's not tested: Windows backslash paths, Docker container paths, WSL tilde expansion
- Files: `bin/install.js`, `get-shit-done/bin/gsd-tools.js`, hooks
- Risk: Platform-specific bugs only caught when users on that platform encounter them
- Priority: **Medium** — Affects install but not runtime for users on tested platforms
- Improvement: Add CI jobs for Windows and Docker environments; test install.js on all platforms

**Artifact Verification Heuristics:**
- What's not tested: Stub detection (line count, pattern matching), wiring verification (import patterns)
- Files: `agents/gsd-verifier.md`, verification verification commands in gsd-tools.js
- Risk: False positives (stubs marked as complete) only caught during UAT
- Priority: **Medium** — False positives delay detection until human testing
- Improvement: Create library of real stubs and real implementations; verify heuristics against all

**Security Testing:**
- What's not tested: Secret file protection during mapping, git pre-commit hook security checks
- Files: `agents/gsd-codebase-mapper.md`, install.js (pre-commit hook setup)
- Risk: Secrets accidentally committed despite mitigations
- Priority: **High** — Security breach risk
- Improvement: Add test cases that attempt to commit secrets and verify they're blocked

---

*Concerns analysis: 2026-02-15*
