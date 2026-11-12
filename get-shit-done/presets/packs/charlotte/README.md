# charlotte pack

UI QA driver pack. It holds the `gsd-charlotte-qa` agent (`agents/`) and the seven
`mcp__charlotte__*` allow rules (`settings.fragment.json`).

Install into a project with `gsd-tools pack install charlotte [--root <dir>]`. The command
copies the agent only where the file is absent and prints the settings fragment for the
owner to add to `.claude/settings.json` by hand.

Layering this pack onto an existing base project is cutover work and is not automated here.
The base preset never names the driver.
