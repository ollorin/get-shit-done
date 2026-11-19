# bladebro pack

UI QA driver pack for projects whose `stack.capabilities.ui_qa.driver` is `bladebro`. It holds the five
`mcp__bladebro__*` allow rules (`settings.fragment.json`). It has no agent file: `gsd-ui-qa` ships globally.

Install into a project with `gsd-tools pack install bladebro [--root <dir>]`. The command prints the settings
fragment for the owner to add to `.claude/settings.json` by hand; it never writes a settings file.

The allow rules do nothing until the MCP server is registered. Registration is an owner step, once per machine:

```bash
claude mcp add --scope user bladebro -- <path>/bladebro mcp
```

`<path>` is the directory holding the built `bladebro` binary. Set the server environment (`BLADE_HEADLESS=1`,
`BLADE_PACE=off`, `BLADE_NO_WARMING=1`, `BLADE_HOME=<scratch dir>`; `BLADE_RECORD` for video) before the MCP server
starts: Bladebro has no per-call configuration (`docs/ui-qa-driver-gaps.md`).

Per-role limits inside `act` are enforced by the lock hook, not by these allow rules (`docs/ui-qa-driver-gaps.md`).
