# Technology Stack

**Analysis Date:** 2026-02-15

## Languages

**Primary:**
- JavaScript (ES6+) - Core CLI tool, agents, commands, and automation
- Markdown - Documentation, templates, and configuration files

**Secondary:**
- YAML - Frontmatter in markdown files for structured metadata

## Runtime

**Environment:**
- Node.js 16.7.0+ (specified in `package.json` engines field)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present (v3)

## Frameworks

**Core:**
- No external framework dependencies - pure Node.js standard library (fs, path, child_process, readline, crypto, os)

**CLI/Command:**
- Native Node.js CLI approach using execSync and process management

**Build/Dev:**
- esbuild ^0.24.0 - Bundler for compiling hooks

## Key Dependencies

**Production:**
- None - Zero production dependencies

**Development:**
- esbuild ^0.24.0 - Builds and bundles hook scripts for installation

## Configuration

**Environment:**
- Multiple AI runtime support via environment variables:
  - `CLAUDE_CONFIG_DIR` - Claude Code configuration directory
  - `OPENCODE_CONFIG_DIR` / `OPENCODE_CONFIG` - OpenCode configuration
  - `GEMINI_CONFIG_DIR` - Gemini CLI configuration
  - `XDG_CONFIG_HOME` - XDG Base Directory spec support
  - `BRAVE_API_KEY` - Optional Brave Search integration

**Project Configuration:**
- `.planning/config.json` - GSD workflow configuration
  - `model_profile` - 'quality', 'balanced', or 'budget'
  - `commit_docs` - Whether to auto-commit planning documents
  - `branching_strategy` - Git branching approach
  - `research` / `plan_checker` / `verifier` - Workflow toggles
  - `parallelization` - Enable parallel agent execution
  - `brave_search` - Brave Search API availability

**Build:**
- `scripts/build-hooks.js` - Simple Node.js build script that copies hook files to `hooks/dist/`
- No webpack/esbuild config files needed for main distribution

## Platform Requirements

**Development:**
- Node.js 16.7.0 or higher
- Standard Unix tools for git integration
- npm for dependency management

**Installation Targets:**
- Claude Code (`.claude` config directory)
- OpenCode (`.config/opencode` or `OPENCODE_CONFIG_DIR`)
- Gemini CLI (`.gemini` config directory)

**Production/Distribution:**
- Published as npm package: `get-shit-done-cc` on npmjs.org
- Installed globally or locally via npm
- Cross-platform support: Mac, Windows, Linux

## Entry Points

**CLI Binary:**
- `bin/install.js` - Installation and setup script (designated in `package.json` bin field)
- `get-shit-done/bin/gsd-tools.js` - Main tools utility (4,597 lines)

**Hook Scripts:**
- `hooks/dist/gsd-check-update.js` - Background version checking (detached process)
- `hooks/dist/gsd-statusline.js` - Status line integration

## Version Management

**Current Version:** 1.18.0 (from `package.json`)

**Distribution:**
- npm package name: `get-shit-done-cc`
- Repository: https://github.com/glittercowboy/get-shit-done
- License: MIT

---

*Stack analysis: 2026-02-15*
