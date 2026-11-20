# UI QA driver gaps: Charlotte ops with no Bladebro equivalent

Source of truth: `get-shit-done/presets/drivers/bladebro.json` (an op with `"tool": null` carries its `workaround`).
A test (`get-shit-done/bin/ui-qa-driver.test.js`) fails when this table and that file disagree. Op names are the
Charlotte tool names without the `charlotte_` prefix. Bladebro mapping verified against `src/mcp/tools.rs`,
`src/action.rs`, `docs/qa-usage.md` and `README.md` in the Bladebro checkout; items marked unverified were not
exercised against a running server.

Ops that map one to one (for example `navigate` to `act action=navigate`) are not listed; read the adapter file.

| Op | Equivalence | Workaround |
|---|---|---|
| `configure` | none | No per-call configuration. Set the server environment before the MCP server starts (see recording.env and the driver notes): BLADE_HEADLESS=1, BLADE_PACE=off, BLADE_NO_WARMING=1, BLADE_NO_ACTIVATE=1, BLADE_HOME=<scratch dir>. Screenshot directory: the path printed by the screenshot call is used as is. Video directory: BLADE_RECORD=<absolute dir>. |
| `diff` | partial | partial: model delta since the last capture, not a two-snapshot diff |
| `screenshot_get` | none | Not needed: the vision call returns the image in its own result. To re-read a saved shot, Read the PNG path it printed. |
| `screenshot_delete` | none | Delete the printed PNG path with the shell (rm). |
| `screenshots` | none | List the artifact directory with the shell (ls); the vision call prints each path. |
| `screencast_delete` | none | Delete the printed video path with the shell (rm). |
| `screencasts` | none | List the recording directory (BLADE_RECORD) with the shell (ls). |
| `set_headers` | none | No equivalent. Route the app through an HTTP proxy that adds the header and start the MCP server with BLADE_PROXY, or authenticate with set_cookies / a stored session (state save/load). |
| `drag` | none | No equivalent. Use evaluate to dispatch pointer events on the source and target, or test the same outcome through the keyboard or the app's own controls. |
| `dev_serve` | none | Start the project's dev server with its stack.services launch command (shell), not through the driver. |
| `dev_inject` | none | Use evaluate to run the injected script in the page. |
| `instance_launch` | none | One daemon per BLADE_HOME: start a separate MCP server with the env `ui-qa instance-env --instance <id>` prints (see Per-instance environment). |
| `instance_kill` | none | Stop the daemon with the shell (bladebro stop). |
| `instance_list` | none | No equivalent; the daemon is one per BLADE_HOME. |

## Behaviour differences on mapped ops

- `screenshot`: Bladebro's `vision` takes no filename, directory or selector. The image comes back in the call and the
  saved PNG path is printed. The demo flow registers that path with `demo-check.js register-shot` (adapter field
  `artifact_index: "register"`), because Bladebro writes no screenshot index of its own.
- `screencast_start` / `screencast_stop`: need `BLADE_RECORD` set in the MCP server environment and ffmpeg on `PATH`;
  `format` and `fps` are `BLADE_RECORD_FORMAT` and `BLADE_RECORD_FPS`, fixed when the server starts, not per call.
  Charlotte's 5 minute auto-stop is a Charlotte property; Bladebro's recording limit is unverified.
- `configure`: server environment only (`BLADE_HEADLESS`, `BLADE_PACE=off`, `BLADE_NO_ACTIVATE=1`, `BLADE_HOME`,
  `BLADE_RECORD=<dir>`). `BLADE_NO_ACTIVATE=1` stops the page being raised over the person's windows (bladebro 4.6.9+).
  The daemon reads its environment once, so a changed value needs `bladebro stop` and a new MCP server.
- `observe`: `detail: summary` has no counterpart; `see mode=model` lists interactive refs, `mode=content` is page text.
- `wait_for`: `act action=wait` needs `condition` plus the match value it names: `text` for element, title, url and text, `selector` for selector, `js` for js; only settle, network and network-idle take none. The adapter `args` carry `action`, `condition` and `timeout` only; the caller adds the one match key from the note.
- `read_state`: bladebro is `act action=read format=json` (by `ref` or `label`). Charlotte has no per-element state read; its adapter workaround is observe (detail summary).
- `toggle` and `submit` are both `act action=fill`; `submit` is the `submit` field of the same call.
- `clear_cookies`: one cookie per `state op=del-cookie`; no clear-all (unverified: call `state op=cookies` first and
  delete each).
- `network` is `see logs=network` (current navigation only). `requests` is `see logs=xhr`, the deduplicated API/fetch
  ring with method and status (bladebro 4.6.10+; older servers reject `logs=xhr`).

## Logical ops, per-instance env and wait_for match keys

- `gsd-tools ui-qa op-of --tool <name> --args '<json>' [--driver d | --root dir]` (export `opsOf` in `ui-qa-driver.js`) maps a call to
  its logical ops from the adapter ops map, the only source: `act {action: eval}` is `evaluate` for bladebro, `charlotte_evaluate` for
  charlotte. A runner or hook bans `evaluate` for either driver by comparing the result, not tool names. The CLI prints `{tool, ops, unknown}`
  (no singular `op`: a tool shared by several ops, `act action=fill` is `submit` and `toggle`, has no first op).
- `opsOf` never fails open. It returns the union over every nested step (adapter key `composite`: `container_tools`, `structural_actions`,
  `step_tools`, `state_actions`, `step_action_aliases`; children are `steps`, `then`, `else`, depth 32 as in bladebro), adds the
  adapter's `composite.js_op` (`evaluate`) to every JS-running form that is not the eval op (`composite.js_guards`), and returns the op
  `unknown` for any call it cannot place: an unmapped tool or action, a step with no string `action`, a batch/run/if/while without its
  step array, nesting past 32, or args that are not an object. `op-of` exits 3 with `unknown: true` for those, and for `--args` that
  is not JSON, so a runner that bans ops cannot be bypassed by an odd call shape. A real action with no logical op (`upload`, `pdf`,
  `download`, `collect`, `paginate`, `clear`, `save`/`load` through `act`) is `unknown` by the same rule.
- Bladebro actions that execute page JS (`src/mcp/server/act.rs`, `run.rs`, `validate.rs`, `src/mcp/tools.rs` on `main`), each resolved to `evaluate`:
  1. `act action=eval` (`act.rs:471-484`).
  2. `act action=wait condition=js` with `js=` or the legacy `text=`; a `wait` with a `js` field and no `condition` is the same call
     (`run.rs:147-200` `resolve_condition_fields`; `act.rs:634-636`). It is also `wait_for`.
  3. `act action=batch` whose `steps` hold any of 1, 2 or 4 (`act.rs:644`); batch steps are not run through a separate gate.
  4. A `run` step with `action=js` (alias of eval, `validate.rs:593`; `run.rs:422`) or `action=eval`.
  5. A `run` step `if` or `while` with `condition=js` (`run.rs:302` if, `run.rs:376` while, `condition_from_args` `run.rs:201`), and `wait` steps with `condition=js`
     including `wait` plus `else` (`tools.rs` run schema).
  6. Anything nested under `then`, `else` or `steps` of an `if`, `while` or `run`, to depth 32.
  `see extract=json template=...` runs bladebro's own extraction script, not caller JS (`see.rs`, `extract.rs`: no `js` argument), so it is not listed.
  Charlotte: `charlotte_evaluate` and `charlotte_wait_for` with a `js` argument (`composite.js_guards`).
- Per-instance environment: adapter key `isolation`. Bladebro: `isolation.env` (`BLADE_HOME=.tmp/bladebro/{instance}`);
  `gsd-tools ui-qa instance-env --instance <id> [--driver d]` renders it, one daemon (and so one browser) per value. Charlotte:
  `isolation.launch_op: "instance_launch"`, rendered as `launch.tool` (`mcp__charlotte__charlotte_instance_launch`); its tools
  then take the returned `instance_id`.
- `wait_for.match` maps each condition to the one argument that carries its match value, so args are built mechanically. Bladebro
  (`src/cli/args/act.rs` wait, `src/mcp/tools.rs`): `element|title|url|text` -> `text`, `selector` -> `selector`, `js` -> `js`,
  `settle|network|network-idle` -> `null` (none). Charlotte (tool schema): no `condition` arg; `element` -> `element_id`,
  `selector`, `text`, `js` (optional `state` refines an element wait).
- `ui-qa drivers` prints `defaults` (adapter defaults: agent and aliases) and, inside a project with an MCP tier, `project`
  (that tier's resolved driver, agent and aliases); a project that sets its own agent resolves to no aliases.

## Role op allowlists and residual risk

Frontmatter can only name tools. Bladebro has five tools (`act`, `see`, `state`, `run`, `vision`) and bundles its
operations inside `act`, so an agent granted `act` can fill, eval and click however narrow its role is. The contract
therefore carries `roles` (role to logical ops) and `role_agents` (agent name to role) in `presets/drivers/index.json`;
a project's `ui_qa.roles` / `ui_qa.role_agents` win per key. `gsd-ui-qa-lock.js` denies (exit 2) every PreToolUse call to
the configured driver whose resolved ops (`opsOf`, so batch, run and wait-js are checked recursively) are not all in the calling agent's role; `unknown` is never in a role.
One exception stays: an op of a tool with no `action`/`op` discriminator (bladebro `see`) passes when the role holds any op of that tool.

Agent identity: the hook reads `agent_type` from the PreToolUse payload (`roleOf` in `ui-qa-driver.js`) and, when a
payload carries only `agent_id`, the role recorded for that `agent_id` at SubagentStart (`<lock_file>.roles/<sha256 of agent_id>.json`,
one file per agent, removed at SubagentStop; files older than the lock TTL are pruned at the next SubagentStart). The hook already reads `agent_id` on PreToolUse; `agent_type` on a PreToolUse payload inside
a subagent is not exercised here against a live Claude Code session (unverified; the SubagentStart record covers it).

Residual risk:
- A call from the main thread, or from an agent with no role, is not op-restricted (only the wrong-driver deny applies).
- `see` is one tool: the investigator role cannot be limited to `mode=model` versus `logs=console`; `see` stays open to it.
- A hook failure (unreadable contract) fails open on the role check; the wrong-driver deny needs only the adapter files.
- The role check keys on the calling agent's name; a project that renames an agent must add it to `ui_qa.role_agents`.

## Two tiers: scripted and MCP

Every adapter has `kind`: `mcp` (charlotte, bladebro: an agent drives a browser through MCP tools) or `command` (playwright: runs `ui_qa.command`, no tool_prefix, no ops, agent default `gsd2-runner`). `ui_qa.driver` names the tier a project already uses, so a scripted-only config (`driver: playwright, command: ...`) stays valid unedited.
The other tier is a nested object: `ui_qa.mcp = {driver: "charlotte"}` beside a command driver, `ui_qa.scripted = {driver: "playwright", command: ...}` beside an MCP driver. `gsd-tools ui-qa contract --tier mcp|scripted` returns one tier; the lock hook acts only on the MCP tier and is a no-op for a command-only project.

## Upgrade note

An MCP project that sets no `lock_file` now takes the adapter lock file (for charlotte `.tmp/charlotte.lock`) instead of `.tmp/ui-qa.lock`, because the lock hook reads the resolved contract. A session holding the old lock across the upgrade is not seen; finish live UI-QA runs before upgrading, or set `lock_file` explicitly.
