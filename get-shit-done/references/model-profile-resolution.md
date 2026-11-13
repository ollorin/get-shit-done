# Model resolution

Workflows never look a model up. `gsd-tools init <workflow>` returns one field per role (`planner_model`, `checker_model`, `executor_model`, `reviewer_model`, `coordinator_model`, `utility_model`, `ruling_model`, `ruling_model_fallback`); every spawn passes the field as `model`. What each field means: `references/model-profiles.md`.
