---
name: project-gsd-v2-overhaul
description: "GSD v2 overhaul initiative (started 2026-10-31) — goals, owner decisions, hub location, what A/B proved"
metadata:
  node_type: memory
  type: project
  originSessionId: 23b0ea8e-ad82-5178-915e-2742fc366b39
  modified: 2026-11-01T23:12:51.242Z
---

Owner goal: GSD fork must replace a dev+QA team. Four streams: measurement, host stability (16 GiB RAM, OrbStack, disk), lean GSD, UI/UX QA speed (Charlotte fix, Bladebro pilot).

Hub: `~/get-shit-done/.planning/gsd-v2/` (README status, DECISIONS.md, research/, experiments/); shipped changes in `~/get-shit-done/docs/v2/CHANGES.md`; KPI tool `~/get-shit-done/scripts/gsd-metrics/`; A/B runner `~/get-shit-done/scripts/ab-eval/` with run data in `~/ab-eval/`.

Owner decisions (2026-10-31/11-01, full list in DECISIONS.md): v0.1.34 is not paused; UI/UX tests stay LLM-driven; LOW findings are not batched to phase end, cap review rounds on non-T0 work instead; plan-ahead coordinator removed; rules may change before the milestone boundary; instruction cuts only with blind A/B proof; gsd-dsh port fixed later from the fork docs. 2026-11-01: owner delegated autonomous implementation, merge to the fork's main and install.

Fable is not used, including as an A/B judge (owner 2026-11-02, replacing an earlier allowance); a second opinion means a fresh Opus.

**Why:** A/B showed intuition is unreliable: executor B (30.7→10.1 KB) dropped acceptance 12/21→2/21 and cost more; `gsd2-runner` passed (4.5k vs 24.8k first-turn tokens); mutation time was ~19%, not the 3% first estimated. Exp 14 (2026-11-02, Ponytail-informed drafts, 76 Haiku runs, plan and verdicts in `experiments/14-ponytail-ab/`): executor draft rejected, test-writer and reviewer are candidates; weekly 1% cost about $18 in harness runs; day-old controls produced a false regression on TW2, so controls must run in the same period as the arm. Test-writer E (2026-11-01) cut cost 0.45x and volume 0.66x but failed acceptance and honesty; the current agent already merged tests in the bloated TW3 task, so its text is not the proven cause of test growth.
**How to apply:** never ship an instruction cut without an A/B pass; prefer behaviour changes and scripts over text trimming; expect broad slimming to fail. Related: [[feedback-sonnet-until-zero-then-opus]], [[reference-charlotte-fork]].
