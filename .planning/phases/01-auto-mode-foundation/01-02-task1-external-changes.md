# Task 1 External Changes

Modified: `~/.claude/get-shit-done/bin/gsd-tools.js`

Added functions:
- `extractKeywords(text)` - Keyword extraction with stop words
- `buildContextIndex(basePaths)` - Build searchable doc index
- `matchContextDocs(taskDescription, index, limit)` - Find top N matching docs
- `extractClaudeInstructions(claudeMdPath)` - Parse CLAUDE.md
- `loadContextIndex(cwd)` - Load or build cached index
- `cmdRoutingContext(cwd, taskDesc, raw)` - CLI command for context matching
- `cmdRoutingFull(cwd, taskDesc, raw)` - CLI command for full routing (model + context)
- `cmdRoutingIndexBuild(cwd, args, raw)` - CLI command to build index
- `cmdRoutingIndexRefresh(cwd, raw)` - CLI command to check index staleness

Updated routing case in main switch to handle: context, full, index-build, index-refresh subcommands.

Verification: Successfully tested `routing full "Add supabase authentication middleware"` - returns model recommendation + context matches.
