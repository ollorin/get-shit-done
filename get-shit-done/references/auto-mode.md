# Auto mode: one rule for "no human is answering"

`auto_mode` is emitted by every `gsd-tools init <workflow>` call (`bin/auto-mode.js`). It is true when any of these holds, and `auto_mode_source` names the first match:

| Source | `auto_mode_source` |
|---|---|
| `--auto` in the init call's arguments | `flag` |
| `GSD_AUTONOMOUS=1` in the environment | `env` |
| `mode` is `yolo` in `.planning/config.json` | `config_mode` |
| `workflow.auto_advance` is true | `config_auto_advance` |
| `workflow._auto_chain_active` is true | `config_auto_chain` |

An exported variable may not reach a spawned agent's shell, so a spawner that is in auto mode also writes `auto: true` in every spawn prompt, and the child passes `--auto` to its own init call (the same way `legacy: true` travels).

**Chain-advance is not part of this rule.** plan-phase step 14 and execute-phase `offer_next` keep their own trigger (`--auto`, `workflow.auto_advance`, `workflow._auto_chain_active`); `mode: yolo` alone never starts chaining.

## Behaviour

When `auto_mode` is true, AskUserQuestion is never called and nothing waits for a reply. Each prompt takes the action of its class and logs it:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" execution-log event --type auto_decision --data '{"prompt":"<id>","class":"K2","chosen":"<what was done>"}'
```

| Class | Meaning | Auto action |
|---|---|---|
| K1 confirm | yes/continue prompt | proceed |
| K2 safe default | choice with a non-destructive default | take the named default; never `override`, never `restart`, never a deletion |
| K3 owner content | needs words only the owner has | take them from the input document or the decisions ledger; if absent, stop before any write and name the missing input |
| K4 human only | human-action, `human_needed`, unresolved blocker | park the phase and its dependents (`phase_parked`), continue independent phases, report it in the completion summary |
| K5 failure choice | retry/skip/stop, gaps | the deterministic ladder (`execution-state record-failure`); gaps: one closure cycle, then K4 |
| K6 artifact approval | approve a generated roadmap or plan | approve; open questions become `A-` rows through the decisions CLI; a force-proceed writes the `OVERRIDE:` line |

## Marking a prompt site

Every prompt site in an unattended path carries the literal line

`Auto (auto_mode, references/auto-mode.md K<n>): <action>.`

within 12 lines of the prompt. `scripts/auto-mode-lint.test.js` fails on a site (`AskUserQuestion`, `wait for the user`, `Type "`, `present ... and wait`, `offer`) in the scanned workflows without that line, unless the site is in the lint's allowlist with a reason. It also fails on a model literal (`model="haiku"` and the like) in those files: models come from init (`executor_model`, `reviewer_model`, `utility_model`, `ruling_model`, `ruling_model_fallback`) and on a config-dir path written without the trailing slash the installer rewrites.
