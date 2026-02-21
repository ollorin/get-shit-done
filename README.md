<div align="center">

# GET SHIT DONE

**Spec-driven development system for Claude Code. Solves context rot.**

[![npm version](https://img.shields.io/npm/v/get-shit-done-cc?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/get-shit-done-cc)
[![npm downloads](https://img.shields.io/npm/dm/get-shit-done-cc?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/get-shit-done-cc)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/5JJgD5svVS)
[![GitHub stars](https://img.shields.io/github/stars/glittercowboy/get-shit-done?style=for-the-badge&logo=github&color=181717)](https://github.com/glittercowboy/get-shit-done)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

```bash
npx get-shit-done-cc@latest
```

</div>

---

## How It Works

Four commands, one loop:

```
/gsd:discuss-phase N   → capture your decisions before planning
/gsd:plan-phase N      → research → create atomic plans → verify
/gsd:execute-phase N   → run plans in parallel waves, commit per task
/gsd:verify-work N     → UAT walk-through, auto-fix plans for failures
```

Each plan executes in a fresh 200k context window. No degradation. Git history is clean — one commit per task, automatically.

Start a project: `/gsd:new-project` — questions → research → requirements → roadmap.

Full cycle when all phases done: `/gsd:complete-milestone` → `/gsd:new-milestone`.

---

## Commands

### Core Workflow

| Command | What it does |
|---------|--------------|
| `/gsd:new-project` | Initialize: questions → research → requirements → roadmap |
| `/gsd:discuss-phase [N]` | Lock implementation decisions before planning |
| `/gsd:plan-phase [N]` | Research + create plans + verify against requirements |
| `/gsd:execute-phase <N>` | Execute all plans in parallel waves |
| `/gsd:verify-work [N]` | Manual UAT, auto-generates fix plans |
| `/gsd:complete-milestone` | Archive milestone, tag release |
| `/gsd:new-milestone [name]` | Start next version |

### Quick Mode

```
/gsd:quick
```

GSD guarantees (atomic commits, state tracking) without full planning. Use for bug fixes and one-off tasks.

### Utilities

| Command | What it does |
|---------|--------------|
| `/gsd:progress` | Where am I, what's next |
| `/gsd:map-codebase` | Analyze existing codebase before new-project |
| `/gsd:pause-work` / `/gsd:resume-work` | Session handoff |
| `/gsd:set-profile <auto\|quality\|balanced\|budget>` | Switch model profile |
| `/gsd:settings` | Configure workflow agents and execution |
| `/gsd:add-phase` / `/gsd:insert-phase` / `/gsd:remove-phase` | Roadmap management |
| `/gsd:add-todo` / `/gsd:check-todos` | Capture ideas |
| `/gsd:debug` | Systematic debugging with persistent state |
| `/gsd:update` | Update GSD |

---

## Install & Uninstall

```bash
# Standard install (Claude Code)
npx get-shit-done-cc@latest

# Non-interactive
npx get-shit-done-cc --claude --global
npx get-shit-done-cc --claude --local
npx get-shit-done-cc --opencode --global
npx get-shit-done-cc --gemini --global
```

```bash
# Uninstall
npx get-shit-done-cc --claude --global --uninstall
npx get-shit-done-cc --claude --local --uninstall
```

Verify: `/gsd:help` inside Claude Code.

> **Security note:** `--dangerously-skip-permissions` disables Claude Code's interactive permission prompts (file writes, shell commands, etc.). Only use this flag in isolated, automated environments (e.g., CI pipelines, sandboxed VMs) where you fully control and trust all executed code. Do not use it in production environments or when running untrusted workflows.

> Run Claude Code with `claude --dangerously-skip-permissions` — GSD is designed for frictionless automation.

---

## Enhancements (This Fork)

This fork extends the base GSD system with autonomous execution, a persistent knowledge database, Telegram integration, and conversation mining.

### What Was Built

**Auto Mode**
A Haiku subagent (`gsd-task-router`) reads each task description and uses LLM reasoning — not keyword matching — to pick the right tier. Haiku for mechanical one-step tasks, Sonnet for multi-step implementation, Opus for architecture and high-stakes decisions. Quota pressure adjusts selection downward at >80% and >95% usage. Top 3 relevant docs are injected into the executor prompt alongside the routing decision. ~40–60% token savings vs all-Opus.

Routing rules editable at `~/.claude/routing-rules.md`. Project overrides at `.planning/routing/project-rules.md`.

**Knowledge System**
Local SQLite + sqlite-vec knowledge database at `.planning/knowledge/{user}.db`. Stores decisions, lessons, summaries with TTL lifecycle, vector + FTS5 search, and type-weighted ranking. Passive extraction via Claude Code hooks captures knowledge during normal work. Three-stage deduplication: content hash → canonical hash → embedding similarity. Memory evolves — similar new knowledge updates existing entries rather than creating duplicates.

**Autonomous Execution**
`/gsd:execute-roadmap` — runs an entire project roadmap unattended. Opus coordinator spawns per-phase sub-coordinators, each with fresh context. Before pushing, runs pre-PR quality gates (lint, type checks, unit tests, docs validation), then automatically pushes the branch and opens a PR. Failure handling with retry/skip/escalate and parallel execution for independent phases.

**Telegram Integration**
MCP server (`mcp-servers/telegram-mcp/`) that auto-loads with Claude Code. Sends blocking questions to your phone when human input is needed, resumes automatically on reply. Voice message support via local Whisper (no API cost). Multi-instance safe with isolated question queues and file locking.

**Doc Compression**
PreToolUse hook intercepts reads of GSD planning documents and injects compressed summaries (60–70% token reduction). Disabled by default. Enable in `hook-config.json`:
```json
{ "enabled": true, "compression": { "enabled": true } }
```

**Conversation Mining**
`/gsd:mine-conversations` — mines `~/.claude/projects/{slug}/*.jsonl` for decisions and reasoning patterns. Haiku subagents extract insights from Claude Code conversation history. Idempotent — already-analyzed sessions are skipped via content hash.

---

## Setup

```bash
git clone https://github.com/ollorin/get-shit-done.git
cd get-shit-done
cp .env.template .env
# Fill in TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID in .env
npm run install:gsd
```

Installs npm dependencies, Whisper models, Claude Code hooks, and MCP server config. The knowledge DB creates itself on first use.

After updating from git: run `/gsd:reapply-patches` if you have local modifications to GSD files.

---

## Recent Changes

### v1.18.0
- `--auto` flag for `/gsd:new-project` — runs research → requirements → roadmap automatically after config questions. Pass idea document via `@` reference: `/gsd:new-project --auto @prd.md`
- Windows: SessionStart hook spawns detached process correctly; HEREDOC replaced with literal newlines for git commit compatibility
- Research decision from `/gsd:new-milestone` now persists to config.json

### v1.17.0
- **gsd-tools verification suite**: `verify plan-structure`, `verify phase-completeness`, `verify references`, `verify commits`, `verify artifacts` — deterministic structural checks that replace manual AI-driven inspection
- **gsd-tools frontmatter CRUD**: `frontmatter get/set/merge/validate` — safe YAML frontmatter operations with schema validation
- **Local patch preservation**: installer detects locally modified GSD files, backs them up to `gsd-local-patches/`
- `/gsd:reapply-patches` command to merge local modifications back after GSD updates
- Agents (executor, planner, plan-checker, verifier) now use gsd-tools for state updates instead of manual markdown parsing

### Post-release fixes

**Routing accuracy** — auto-mode tier assignment calibrated from empirical analysis of real task history. Haiku rubric expanded with patterns that were consistently over-assigned to Sonnet: mechanical search-replace, dead code removal, lint fixes, single-element additions, run-and-report tasks. Sonnet rubric extended with targeted debugging and documentation tasks that were incorrectly reaching Opus. Fallback defaults changed from sonnet → haiku throughout. Planner routing pass now runs a consistency check: structurally similar tasks in the same plan get the same tier.

**execute-roadmap: pre-PR quality gates** — before pushing and opening a PR, runs: frontend lint (`npm run lint`), backend lint (`deno lint`), type checks, unit tests (both npm and deno), and docs validation (`markdownlint`, `deno task validate:frontmatter`, `deno task validate:links`) when `docs/` files changed. Pre-commit hooks also run explicitly to catch anything agents may have bypassed. Collects all failures before reporting — asks fix/proceed/stop. On "proceed anyway", failures are noted in the PR body.

**execute-roadmap: auto push + PR** — after all phases complete and quality gates pass, branch is pushed to remote and PR opened automatically via `gh pr create`. PR body includes phase summary from SUMMARY.md files. Skipped on `main`/`master`.

**gsd-tools CLI** — added `--help` command (prints usage, exits cleanly); `execution-log event` alias (workflows use `event` but tool only had `append` with individual flags — now accepts `--data '<json>'` blob); `roadmap list` alias for `roadmap analyze`.

---

## Telegram Setup

1. Message `@BotFather` → `/newbot` → copy token
2. Add to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_OWNER_ID=your_telegram_user_id
   ```
3. The MCP server starts automatically with Claude Code (configured by `npm run install:gsd`)
4. Send `/start` to your bot in Telegram

Voice messages: install `ffmpeg` (`brew install ffmpeg`) — Whisper model is downloaded by the installer.

---

## Configuration

Settings in `.planning/config.json`. Change via `/gsd:settings`.

| Setting | Default | What it does |
|---------|---------|--------------|
| `mode` | `interactive` | `yolo` = auto-approve all steps |
| `depth` | `standard` | Planning thoroughness |
| `parallelization.enabled` | `true` | Run independent plans in parallel |
| `git.branching_strategy` | `none` | `phase` or `milestone` to create branches |

**Model profiles** (`/gsd:set-profile`):

| Profile | Planning | Execution | Verification |
|---------|----------|-----------|--------------|
| `auto` | adaptive | adaptive | adaptive |
| `quality` | Opus | Opus | Sonnet |
| `balanced` | Opus | Sonnet | Sonnet |
| `budget` | Sonnet | Sonnet | Haiku |

`auto` spawns a Haiku subagent (`gsd-task-router`) that reads each task description and reasons about which model tier to use — Haiku for mechanical single-step tasks, Sonnet for standard multi-step implementation, Opus for architecture and high-stakes decisions. Quota pressure downgrade: >80% usage drops Opus→Sonnet, >95% drops all to Haiku. Circuit breakers and error escalation ensure quality.

---

## Troubleshooting

**Commands not found after install** — restart Claude Code, verify `~/.claude/commands/gsd/` exists.

**`PreToolUse:Read hook error` on every file read** — the doc-compression hook can't find its dependencies. Run `npm install --prefix ~/.claude/get-shit-done/ markdown-it gray-matter minimatch`. This is handled automatically by `npm run install:gsd` from v1.18+.

**Docker / CI** — set `CLAUDE_CONFIG_DIR=/home/user/.claude` before installing.

**Telegram bot not responding** — check `.env` has correct token, send `/start` to bot first.

**Voice messages not working** — `brew install ffmpeg`, check Whisper model downloaded.

---

## License

MIT. See [LICENSE](LICENSE).

---

<div align="center">

**Claude Code is powerful. GSD makes it reliable.**

</div>
