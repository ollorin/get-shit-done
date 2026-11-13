# Models: the top model and the profiles

## The top model (one config key)

The owner names the best available model once, in `.planning/config.json`, as an alias (never a model id), with an optional fallback:

```json
{ "models": { "top": "<alias>", "top_fallback": "<alias>" } }
```

Every `gsd-tools init <workflow>` call emits it as `ruling_model` and `ruling_model_fallback` (`resolve-model top` and `top-fallback` print them; the legacy `ruling_model` keys are read only while `models.top` is absent). The default is `opus`. A spawn rejected for availability retries once on the fallback and says so.

These roles always run on `ruling_model`, whatever the profile. This table is the only place that says so; every other file writes `{ruling_model}`:

| Role | Where |
|---|---|
| Final phase review: the phase-end `gsd-verifier`, at every rigour | execute-phase `verify_phase_goal` |
| Final milestone review: the milestone audit, its rules distillation and the separate review of that diff | execute-roadmap `completion`, audit-milestone |
| Rulings | wherever the trigger row of `references/rigour.md` allows one |
| Planner and round-1 plan-check of a risk-domain phase or plan; the batched diff review; PRD synthesis | plan-phase, execute-phase, prd |

A ledger `source` or `caught_by` value such as `opus-ruling` or `opus-diff-review` is a stored identifier the CLI validates ("done on the top model"), not a model choice.

## Profiles (every other role)

`model_profile` in `.planning/config.json` (`quality` | `balanced` (default) | `budget`; `/gsd:set-profile <profile>`) picks the model of the remaining agents. `MODEL_PROFILES` in `bin/gsd-tools.js` holds the table; init returns the result as `planner_model`, `checker_model`, `researcher_model`, `executor_model`; `coordinator_model`, `reviewer_model` and `utility_model` come from their own config keys. Executors do not take `executor_model` as is: a task's own tier tag (`<model>` in a PLAN, mandatory) is its executor model (`references/task-routing.md`); at spike one executor runs a plan on its highest tag, never below `executor_model`, which is raised from `haiku` to `sonnet` (`references/rigour.md`, Spike executor). `executor_model` is the model of test-writers and fix dispatches. The legacy profile value `auto` only selects its own table column; routing no longer depends on it. Workflows pass the init field in every spawn and never look a model up themselves.

| Profile | Intent |
|---|---|
| `quality` | strongest model for every agent that decides something; highest cost |
| `balanced` | strong planning, cheap execution and test/doc writing (plans are already decomposed), mid tier for coordination, research and review rounds |
| `budget` | cheapest model for anything that writes; mid tier only for planning and coordination |

An executor miss is caught by the review rounds and the final phase review; a task escalates one tier after two failures.
