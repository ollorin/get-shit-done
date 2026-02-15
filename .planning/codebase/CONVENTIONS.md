# Coding Conventions

**Analysis Date:** 2026-02-15

## Naming Patterns

**Files:**
- Kebab-case: `gsd-tools.js`, `gsd-statusline.js`, `gsd-check-update.js`
- Test files: `gsd-tools.test.js` (co-located with implementation)
- Command files in `commands/` directory: `gsd-...` prefix pattern

**Functions:**
- camelCase for all function names: `parseIncludeFlag`, `safeReadFile`, `loadConfig`
- Command functions prefixed with `cmd`: `cmdGenerateSlug`, `cmdHistoryDigest`, `cmdPhasesList`
- Helper functions prefixed with verb: `execute`, `resolve`, `find`, `validate`
- Internal functions suffixed with `Internal`: `resolveModelInternal`, `pathExistsInternal`, `generateSlugInternal`

**Variables:**
- camelCase: `tmpDir`, `phaseDir`, `modelProfile`, `configPath`
- Constants in UPPER_SNAKE_CASE: `MODEL_PROFILES`, `TOOLS_PATH`, `FRONTMATTER_SCHEMAS`
- Boolean flags with `is`/`has` prefix: `isGitIgnored`, `hasCheckpoints`, `hasSummary`

**Types/Objects:**
- Object keys in snake_case: `model_profile`, `current_phase`, `phase_name`, `one_liner`
- Return objects with descriptive keys: `{ success: bool, output: string, error: string }`

## Code Style

**Formatting:**
- 2-space indentation throughout
- No semicolons at end of statements (Node.js convention)
- Line breaks between logical sections marked with `// ─── Section Name ─────`
- Comments use unicode box-drawing characters for visual hierarchy

**Linting:**
- Not detected - no eslint or prettier config files
- Consistent style maintained manually across 4000+ lines

## Import Organization

**Order:**
1. Built-in Node modules: `fs`, `path`, `os`, `child_process`, `crypto`, `readline`
2. Relative imports: Not used (monolithic files)
3. All imports at top of file before constants

**Path Aliases:**
- Not used - all paths are absolute or relative with `__dirname`

Example from `gsd-tools.test.js`:
```javascript
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
```

## Error Handling

**Patterns:**
- Use dedicated `error(message)` function at `src/get-shit-done/bin/gsd-tools.js:475` - exits process with code 1
- Safe reads with try-catch wrapped in `safeReadFile(filePath)` - returns null on failure instead of throwing
- Command functions validate required arguments at start: `if (!text) { error('text required...') }`
- Return objects include `{ error: string }` field for non-fatal errors
- Git operations wrapped in try-catch, fail gracefully: `try { execSync(...) } catch { return null }`

Example pattern:
```javascript
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
```

## Logging

**Framework:** `console.log`, `console.error` for user-facing messages

**Patterns:**
- Test output to stdout/stderr via `process.stdout.write()` and `process.stderr.write()`
- JSON results: `JSON.stringify(result, null, 2)` for formatted output
- Raw output with `--raw` flag: pass raw value directly to stdout
- Error messages prefixed with "Error: "
- Installation logs use color codes for status (green ✓, yellow ⚠, red ✗)

Example:
```javascript
function output(result, raw, rawValue) {
  if (raw && rawValue !== undefined) {
    process.stdout.write(String(rawValue));
  } else {
    process.stdout.write(JSON.stringify(result, null, 2));
  }
  process.exit(0);
}
```

## Comments

**When to Comment:**
- Section dividers with visual separation: `// ─── Model Profile Table ───────`
- JSDoc blocks for file-level documentation at top of monolithic files
- Inline comments for complex logic (YAML parsing, frontmatter extraction)
- No comments for obvious code

**JSDoc/TSDoc:**
- Full file-level JSDoc block at top of `gsd-tools.js` (lines 3-117) documenting all available commands
- Pattern: `/**\n * Description\n * [usage examples]\n */`
- No per-function JSDoc comments in test code

## Function Design

**Size:** Functions range from 10 lines (simple helpers) to 200+ lines (complex orchestration)

**Parameters:**
- Command functions accept: `(cwd, arg1, arg2, ..., options, raw)`
- Last parameter is `raw` boolean flag for output formatting
- Options parsed as object: `{ force: bool, include: Set, fields: [...] }`

**Return Values:**
- All functions return to caller or call `output()` (no return needed)
- `output()` stringifies result as JSON and exits process
- Helper functions return null for failures, truthy for success
- Command functions never throw; they call `error()` which exits

## Module Design

**Exports:**
- Single monolithic file: `gsd-tools.js` exports nothing directly
- CLI dispatch via switch statement on command name
- Compound commands build on atomic commands

**Barrel Files:**
- Not used - single file per functionality
- File organization: command functions clustered by domain (state, phase, roadmap, validation, progress, scaffolding)

## Frontmatter Parsing

**Pattern:** YAML frontmatter between `---` delimiters at top of .md files

**Extraction:** `extractFrontmatter(content)` function (line 252) handles:
- Nested objects (e.g., `dependency-graph: { provides: [...], affects: [...] }`)
- Arrays (both `-` list syntax and `[inline]` syntax)
- Flat fields merged with nested structures
- Malformed YAML handled gracefully (returns partial parse)

Example:
```javascript
function extractFrontmatter(content) {
  // Extracts YAML between --- markers
  // Handles nested objects, arrays, mixed formats
  // Returns parsed object or empty object on error
}
```

## State File Patterns

**Extraction:** Field values extracted via regex from markdown: `**Field Name:** value`
- Boolean fields: parsed as true/false
- Numeric fields: parsed to integers
- Date fields: kept as strings (ISO format)
- Lists: extracted from markdown list syntax

**Update:** `stateReplaceField(content, fieldName, newValue)` replaces inline values preserving structure

---

*Convention analysis: 2026-02-15*
