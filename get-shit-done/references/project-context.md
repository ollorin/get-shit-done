# Project Context

Shared reference for agents that read the project profile. Agents include the pointer block below and read every value through the profile reader, never from a default.

## Pointer block

Include this block verbatim in the agent prompt:

```
<project_context>
Domain facts and risk domains: `.planning/PRODUCT-BRIEF.md`. Commands, paths, services and tools: `.planning/STACK-PROFILE.md`.
Read the sections your role needs before acting. Every command, path and tool name comes from the profile.
If a key you need is missing, stop and report the key. Never substitute a default stack.
</project_context>
```

## Reading values

- `node get-shit-done/bin/gsd-tools.js profile get <key> --raw` prints one value. An absent key exits 1 with `profile key not set: <key>`.
- `node get-shit-done/bin/gsd-tools.js profile check` validates the whole profile and exits 1 on any missing or invalid key.
- Placeholders `{root}`, `{file}`, `{paths}` and `{project}` in command values are filled by the caller.

## Keys

| Key | Required | Meaning |
|-----|----------|---------|
| `project.slug` | yes | lowercase slug matching `^[a-z0-9][a-z0-9-]*$` |
| `project.owner_title` | yes | how rulings address the owner |
| `project.risk_domains` | yes | unique risk domain ids |
| `project.ruling_topics` | yes | unique ruling topic ids |
| `stack.commands.test_file` | yes | command for one test file; takes `{file}` |
| `stack.commands.<name>` | no | `test_all`, `typecheck`, `lint`, `format`, `frontend_test`, `pre_pr_gate`, `search` |
| `stack.preset`, `stack.preset_version` | no | preset name and version, non-empty strings |
| `stack.paths` | no | `backend`, `migrations`, `api_globs`, `e2e_scenarios`, `frontends` |
| `stack.test_command_shapes` | no | array of allowed test command shapes |
| `stack.gates` | no | array of `{id, run}`; ids unique |
| `stack.services` | no | array of `{name, url, health?, launch?, ready?}`; names unique |
| `stack.capabilities` | no | `ui_qa: {driver, agent, tool_prefix?, reset_patterns?}` |
| `stack.isolation` | no | `port_base` (1024-65535), `container_suffix`, `lock_dir`, `machine_locks` |

An unknown key under these scopes is a warning, not an error.

## Example

<!-- profile-example -->
```json
{
  "project": {
    "slug": "demo-app",
    "owner_title": "owner",
    "risk_domains": ["auth", "billing"],
    "ruling_topics": ["auth", "security"]
  },
  "stack": {
    "paths": { "backend": "src", "api_globs": ["src/api/**"] },
    "commands": {
      "test_file": "npm test -- {file}",
      "test_all": "npm test",
      "typecheck": "npx tsc --noEmit",
      "lint": "npx eslint {paths}"
    },
    "gates": [{ "id": "unit", "run": "npm test" }],
    "services": [{ "name": "web", "url": "http://127.0.0.1:4100", "health": "http://127.0.0.1:4100/health" }],
    "capabilities": {},
    "isolation": { "port_base": 4100, "lock_dir": ".tmp", "machine_locks": [] }
  }
}
```
