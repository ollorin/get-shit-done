# gsd-metrics

KPI table for GSD v2 experiments (design decision D0). Reads Claude Code transcripts, read-only; writes only to `GSD_OUT`.

```
python3 scripts/gsd-metrics/metrics_v2.py                       # refresh index incrementally, print KPI table (whole history)
GSD_SINCE=2026-11-07T00:00:00Z GSD_UNTIL=2026-11-14T00:00:00Z python3 scripts/gsd-metrics/metrics_v2.py   # one week
python3 scripts/gsd-metrics/metrics_v2.py --row                 # one markdown row for research/KPI.md
python3 scripts/gsd-metrics/metrics_v2.py --json | --no-refresh | --no-git | --workers N
GSD_FILES=<snapshot files.jsonl> GSD_SINCE=2026-09-27T15:58:00Z GSD_UNTIL=2026-10-31T15:58:17Z python3 scripts/gsd-metrics/metrics_v2.py --no-refresh --selftest
python3 scripts/gsd-metrics/extract.py [workers] [--full]        # refresh only
```

Env: `GSD_SINCE`, `GSD_UNTIL` (ISO, `Z` or date only = UTC midnight), `GSD_OUT` (default `$GSD_REPO/.tmp/gsd-v2/out`), `GSD_REPO` (default `/Users/ollorin/igaming-platform`), `GSD_FILES` (alternate index).

Files: `lib.py` loaders, role/tier/activity classifiers, price index (01 conventions). `extract.py` incremental extractor: `process()` is the 02_extract.py parser unchanged; a transcript is re-read only if new, grown, or its `meta.json` appeared (no-op refresh ~2 s, 48 changed files ~3 s). It also writes `extras.jsonl` (Charlotte screenshot timings, coordinator cache-miss turns) for the two roles that need a second pass. `metrics_v2.py` KPI table.

Semantics and limits:
- Window = spawns whose first timestamp is in `[SINCE, UNTIL)`. A spawn that runs across a boundary is attributed whole to the window it started in (a live 90 h coordinator inflates the week it began). Compare windows of at least a few days.
- git window uses epoch seconds. Date-only `--since=2026-09-27` in git means that date at the current clock time, which silently shifted 01's git counts; the tool never passes date-only values.
- "Poll share" can exceed 100% in small windows: tool-wait counts time that active-time (gaps over 30 min removed) excludes.
- Est $ is the 01 index (fresh 1 : cache-write 1.25 : cache-read 0.1 : output 5, tier $/Mtok 2.8/2.05/0.43), within about 30% of billing. Use it for ratios and trends only.
- Review "Opus reviews/plan" in 01 counts every non-Sonnet reviewer including Haiku. The table prints true Opus with the non-Sonnet figure in parentheses.
- Scripts classify activity by description regex (lib.py `activity`); 6% land in other-gp.
