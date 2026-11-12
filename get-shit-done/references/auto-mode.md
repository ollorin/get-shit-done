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

When `auto_mode` is true, AskUserQuestion is never called and nothing waits for a reply, with exactly three named exceptions, the owner gates below (OG1-OG3). Every other prompt takes the action of its class and logs it:

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

## Owner gates: the named exceptions

Full auto mode keeps three stops that only the owner passes. They are the only places an unattended run ends waiting for a person; everything between them runs unattended. The decisions gate (an unanswered irreversible assumption parks the work, K4) is a fourth stop that already exists and is unchanged.

| Gate | Kind | Where | Stops until |
|---|---|---|---|
| OG1 | `composition` | new-milestone, after the milestone's composition (which PRDs and requirements) is drafted, before the roadmap is drafted | the owner approves the composition |
| OG2 | `roadmap` | new-milestone, after the roadmap is drafted | the owner approves the roadmap; no phase starts before |
| OG3 | `pr` | execute-roadmap, after the pull request is opened (draft allowed) | the owner approves; the run never merges and never enables auto-merge |

`resolveAutoMode` emits `owner_gates.gates.{composition,roadmap,pr}.required`, always true. `workflow.owner_gates.<kind>: false` in config is ignored and listed in `ignored_overrides`; the only knob is stricter: `workflow.owner_gates.require_note: true` makes every approval carry a note.

An unattended run does not prompt at a gate and does not loop. It requests the gate, prints a compact owner summary and ends in the durable state `waiting_owner_approval`:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" owner-gate request --kind composition --milestone v1.1 --summary "<what is awaited>"
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" owner-gate status
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" owner-gate approve --kind composition
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" owner-gate reject --kind composition --note "<why>"
```

State is `.planning/OWNER-GATES.json` (`gates[]`: `id`, `kind`, `milestone`, `requested_at`, `summary`, `status` `pending|approved|rejected`, `approved_by`, `approved_at`, `note`, `via`). A repeated request keeps the first `requested_at`; a rejected gate is re-requested after a redraft. `approve` and `reject` are refused while `auto_mode` is active unless the call carries `--owner-confirmed --note "<how the owner decided>"`: the flag is a recorded attestation, not authentication, and an agent that passes it on its own has written a false line in the audit trail. The owner normally runs them from an interactive session without the flag.

A resume reads the file. `init execute-roadmap` emits `owner_gates.status` and `blocked_by_owner_gate`; `roadmap next` returns `action: waiting_owner_approval` (with `blocked_by_owner_gate` and `gate_status`) while an auto run has no approved composition and roadmap gate, and again after `roadmap record --kind pr_requested` until the `pr` gate is approved; `resume_state.status` is `waiting_owner_approval`. That status is neither `blocked` (a parked phase) nor `done`. An interactive run is stopped only by a gate that was requested and is unapproved.

## Marking a prompt site

Every prompt site in an unattended path carries the literal line

`Auto (auto_mode, references/auto-mode.md K<n>): <action>.`

within 12 lines of the prompt. A gate site carries `Auto (auto_mode, references/auto-mode.md OG<n>): <action>.` instead, and the lint accepts OG1/OG2 only in new-milestone and OG3 only in execute-roadmap. `scripts/auto-mode-lint.test.js` fails on a site (`AskUserQuestion`, `wait for the user`, `Type "`, `present ... and wait`, `offer`) in the scanned workflows without that line, unless the site is in the lint's allowlist with a reason. It also fails on a model literal (`model="haiku"` and the like) in those files: models come from init (`executor_model`, `reviewer_model`, `utility_model`, `ruling_model`, `ruling_model_fallback`) and on a config-dir path written without the trailing slash the installer rewrites.
