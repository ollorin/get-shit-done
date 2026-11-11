# igaming preset (snapshot)

- Source repo: igaming-platform
- Pinned SHA: 95a02959e5fa464f3bcce11378c803f7b86ec76d
- Branch at pin: feature/codebase-review-hardening
- Snapshot date: 2026-11-11
- Tracked files only, taken with `git archive` (never the working tree).

## Layout

| src (preset) | dest (project) | files |
|---|---|---|
| `CLAUDE.md` | `CLAUDE.md` | 1 |
| `rules/` | `.claude/rules/` | 12 |
| `hooks/` | `.claude/hooks/` | 19 |
| `skills/` | `.claude/skills/` | 15 |
| `canaries/` | `scripts/validation/hook-canaries/` | 2 |

All 49 entries are `kind: whole`, `render: false`. `settings.snapshot.json` is the verbatim settings file and is not in `files`.

## Settings

`settings.snapshot.json` is the verbatim file and is never deployed. `settings.fragment.json` is its `permissions` (allow/deny/ask) and `hooks`. The keys `env`, `enableAllProjectMcpServers`, `enabledPlugins`, `sandbox` are not deployed by the current engine. Deployed settings are set-equal to the snapshot, not byte-equal.
Phase H must carry these four keys (env, enableAllProjectMcpServers, enabledPlugins, sandbox): the engine does not deploy them.

## Redactions

- `rules/edge-functions.md` line 126 (dest `.claude/rules/edge-functions.md`), pattern `assigned_secret`: the matched value is replaced by `<redacted:assigned_secret>`. The golden compares against the redacted form for this file.
- Scan after redaction: `scanDir` 0 hits over 53 files.

## Not changed in this snapshot

- Absolute user paths are kept verbatim (10 in the settings file, 1 in `CLAUDE.md`, 122 in `canaries/canaries.jsonl`) until Phase F turns them into `{{project.root}}`.
- The Charlotte MCP allow rules stay in the fragment until the pack exists (Phase F).
- Canaries are data until Phase F1: the runner needs `jq`, `perl`, macOS `date -v` and hooks under `~/.claude`.

## Do not use for a new project

The fragment contains mutating allow rules scoped to the igaming checkout (for example `rm -rf` under its `.tmp/`). Do not run `project init --preset igaming` in another repo. The reviewed base subset is Phase F4.

## Re-verify against the source

```
git -C /Users/ollorin/igaming-platform archive 95a02959e5fa464f3bcce11378c803f7b86ec76d CLAUDE.md .claude scripts/validation/hook-canaries | tar -x -C <empty-dir>
shasum -a 256 -c golden.sha256   (run inside <empty-dir>; expect one FAILED: .claude/rules/edge-functions.md, the redaction above)
```
