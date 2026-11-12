# Isolated install (test commands without touching the real ~/.claude)

Verified 2026-11-12 against `bin/install.js` (fork main + exp/init-fixes).

`npm run install:gsd` (`scripts/install-orchestrator.js`) also runs npm installs, Whisper, MCP and `.env` steps and shells out to the installer with no target argument. Do not use it for an isolated install. Call the installer directly; it supports `--config-dir` (and `CLAUDE_CONFIG_DIR`, `bin/install.js` getGlobalDir), and rewrites every `~/.claude/` in commands, workflows and agents to the absolute target path.

```bash
T=/tmp/gsd-pilot-home                      # any throwaway dir
mkdir -p "$T"
HOME="$T" node <fork checkout>/bin/install.js --claude --global --config-dir "$T/.claude"
```

`HOME="$T"` on the install keeps every `os.homedir()` write (npm cache, settings, statusline, hooks) inside `$T`; the hooks the installer writes into `$T/.claude/settings.json` point at `$T` paths.

Check: `node "$T/.claude/get-shit-done/bin/gsd-tools.js" init new-project` runs from any project dir; `@/tmp/.../get-shit-done/workflows/...` references in `$T/.claude/commands/gsd/*.md` are absolute.

## What a pilot session must set

The installer does NOT rewrite `$HOME/.claude/get-shit-done/bin/gsd-tools.js` calls inside workflow bodies (about 10 workflow and agent files use that form). Those resolve through the `HOME` of the Claude Code process, so launch the session with `HOME="$T"` (CLAUDE_CONFIG_DIR alone makes Claude Code load the commands from `$T/.claude` but leaves `$HOME/.claude/...` calls pointing at the real install). Subagents inherit the environment of the session, so they use the same copy.
Unverified: whether a session with a changed `HOME` keeps its login (credentials may live in `~/.claude.json` / keychain); if not, sign in once inside `$T`, or copy only the auth file.

Remove with `rm -rf "$T"`. Reinstall after every change to the fork: the install is a copy.
