#!/bin/bash
# GSD Uninstall Script
# Removes GSD files while preserving user data

set -e

echo ""
echo "  GSD Uninstall"
echo ""

HOOKS_DIR="$HOME/.claude/hooks"
CLAUDE_DIR=".claude"
PRESERVED=()

# Remove hooks
if [ -d "$HOOKS_DIR" ]; then
  for hook in gsd-statusline.js gsd-check-update.js; do
    if [ -f "$HOOKS_DIR/$hook" ]; then
      rm -f "$HOOKS_DIR/$hook"
      echo "  - Removed $HOOKS_DIR/$hook"
    fi
  done
fi

# Clean MCP config
MCP_CONFIG="$CLAUDE_DIR/.mcp.json"
if [ -f "$MCP_CONFIG" ]; then
  # Backup first
  cp "$MCP_CONFIG" "$MCP_CONFIG.backup"

  # Remove telegram server (using Node for JSON manipulation)
  node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf8'));
    if (config.mcpServers && config.mcpServers.telegram) {
      delete config.mcpServers.telegram;
      fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2));
      console.log('  - Removed telegram MCP server from config');
    }
  " 2>/dev/null || echo "  - Warning: Could not update MCP config"
fi

# Clean settings.json
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  node -e "
    const fs = require('fs');
    let settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));
    let modified = false;

    // Remove GSD statusline
    if (settings.statusLine && settings.statusLine.command &&
        settings.statusLine.command.includes('gsd-statusline')) {
      delete settings.statusLine;
      modified = true;
      console.log('  - Removed GSD statusline from settings');
    }

    // Remove GSD hooks
    if (settings.hooks && settings.hooks.SessionStart) {
      const before = settings.hooks.SessionStart.length;
      settings.hooks.SessionStart = settings.hooks.SessionStart.filter(entry => {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          return !entry.hooks.some(h =>
            h.command && h.command.includes('gsd-check-update')
          );
        }
        return true;
      });
      if (settings.hooks.SessionStart.length < before) {
        modified = true;
        console.log('  - Removed GSD hooks from settings');
      }
    }

    if (modified) {
      fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2) + '\\n');
    }
  " 2>/dev/null || echo "  - Warning: Could not update settings.json"
fi

echo ""
echo "  Preserved (your data):"
echo "    - .planning/ (project state)"
echo "    - .env (your secrets)"
echo "    - ~/.cache/whisper/ (reusable models)"
echo ""
echo "  Done! GSD has been uninstalled."
echo ""
