# Models: the top model and the fixed roles

## The top model (one config key)

The owner names the best available model once, in `.planning/config.json`, as an alias (never a model id), with an optional fallback:

```json
{ "models": { "top": "<alias>", "top_fallback": "<alias>" } }
```

Every `gsd-tools init <workflow>` call emits it as `ruling_model` and `ruling_model_fallback` (`resolve-model top` and `top-fallback` print them; the legacy `ruling_model` keys are read only while `models.top` is absent). The default is `opus`. A spawn rejected for availability retries once on the fallback and says so.

These roles always run on `ruling_model`. This table is the only place that says so; every other file writes `{ruling_model}`:

| Role | Where |
|---|---|
| Final phase review: the phase-end `gsd-verifier` (two parallel passes at risk add-ons), at every rigour | execute-phase `verify_phase_goal` |
| Final milestone review: the milestone audit, its rules distillation and the separate review of that diff | execute-roadmap `completion`, audit-milestone |
| Rulings | wherever the trigger row of `references/rigour.md` allows one |
| The planner, at every rigour (init `planner_model` is the same value) | plan-phase |
| Round-1 plan-check of a risk-domain phase or plan; PRD synthesis | plan-phase, prd |

A ledger `source` or `caught_by` value such as `opus-ruling` or `opus-diff-review` is a stored identifier the CLI validates ("done on the top model"), not a model choice.

## Every other role (fixed, no profile)

`ROLE_MODELS` in `bin/gsd-tools.js` holds one model per role; init returns the result as `checker_model` (`sonnet` at every rigour), `researcher_model`, `executor_model` (`haiku`); `coordinator_model` and `reviewer_model` come from their own config keys (default `sonnet`) and `utility_model` from its own (default `haiku`). A `model_profile` key left in an old config is ignored. Task tags are `haiku` or `sonnet` only (`verify form` rejects anything else; a task that needs the top model is split by the planner). Executors do not take `executor_model` as is: a task's own tier tag (`<model>` in a PLAN, mandatory) is its executor model (`references/task-routing.md`); at spike one executor runs a plan on its highest tag, never below `executor_model`, which is raised from `haiku` to `sonnet` (`references/rigour.md`, Spike executor). `executor_model` is the model of fix dispatches; the test steward (`gsd-test-writer`) and the fix re-check run on `reviewer_model` (`sonnet`). Workflows pass the init field in every spawn and never look a model up themselves.

An executor miss is caught by the final phase review; a haiku task escalates to sonnet after two failures, a sonnet task fails twice before it gets one rescue (`routing escalation-decision --fails-at-tier` returns it, `references/task-routing.md` step 4), and a spike plan executor gets one at its second failure (`execution-state record-failure` returns `debug` once, `workflows/debug.md` takes `model: {ruling_model}`): a single debugger dispatch on the top model, logged as `tier_escalation` with `rescue: true`, never an opus executor.
