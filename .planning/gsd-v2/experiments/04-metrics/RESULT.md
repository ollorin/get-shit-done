# Experiment 04 - KPI metrics tool (result)

Tool: `~/get-shit-done/scripts/gsd-metrics/` (`lib.py`, `extract.py`, `metrics_v2.py`, `README.md`). Outputs stay in `<repo>/.tmp/gsd-v2/out/` (`GSD_OUT` overrides).

## Use
```
cd ~/get-shit-done/scripts/gsd-metrics
GSD_REPO=/Users/ollorin/igaming-platform python3 metrics_v2.py                       # refresh (incremental) + one KPI table
GSD_SINCE=2026-10-29 GSD_UNTIL=2026-10-31 python3 metrics_v2.py                      # window by spawn t0 (UTC)
python3 metrics_v2.py --row | --json | --no-refresh | --no-git | --selftest
```
`GSD_SINCE`/`GSD_UNTIL` filter in `lib.load()` by spawn start time. Extraction is incremental (keyed on transcript path + size, reprocessed when new, grown, or its `.meta.json` appeared): no-op refresh ~2 s, 48 changed files ~3 s, full run with git ~5 s. Re-extracting 40 random unchanged files gave byte-identical records.

Table covers: role x model (spawns, active h, est $, $/spawn, first-turn tokens); coordinator cache-write/read ratio, poll calls/h/share, cache-miss turns and premium; executor wait/poll share and test h; review rounds, rulings, fix agents per plan; mutation-command h; git commits, `.planning` share, planning-only commit share; API-error deaths, resume spawns, coordinator resume share, compaction rate; Charlotte screenshot p50/p90/timeouts/share of runner wall lost.

## Self-test (01 window, frozen 01-time index `out/files.01-snapshot.jsonl`)
Window `2026-09-27T15:58Z .. 2026-10-31T15:58:17Z`. Full table: `selftest_snapshot.md` (this dir). **44 of 45 metrics within 1%**, e.g. cache-read 22,042M vs 22,015M (+0.12%), est $ 6,794 vs 6,789, coordinator poll calls 3,885 vs 3,883, executor wait share 27.0% vs 27.0%, Sonnet reviews/plan 2.318 vs 2.31, rulings/plan 1.255 vs 1.25, commits 4,451 vs 4,452, `.planning` share 51.2% vs 51.2%, Charlotte 522 shots / 498 timeouts / mean 173.3 s, cache-miss premium $767.0 vs $767.

The one miss: "transcripts ended on API error", 01 headline 128 vs 113. 01's own per-role breakdown (41/35/15/8/4/4/2 + planner 2 + verifier 2) sums to 113; 128 = 113 + 15 is unexplained, so this is a 01 internal inconsistency, not a tool bug (unverified: 01's extraction script was not re-run).

## Limitations (traced during self-test)
- Live index vs the 01 window: running the self-test on the current index gives 33/45 within 1%. A spawn belongs wholly to the window its t0 falls in, and long live coordinators have grown since the snapshot (boundary attribution). Use `--selftest` (snapshot) for regression of the tool, and treat narrow-window rows as informational.
- git: `--since=<date>` means that date at the current clock time; the tool passes epoch seconds.
- Poll share can exceed 100% in small windows (poll time summed per call, active time with idle gaps removed).
- 01's "Opus reviews/plan 0.86" counts every non-Sonnet reviewer (Haiku included); the tool prints true Opus (0.20) and non-Sonnet (0.87).
- Est $ is an index (fresh 1 : cache-write 1.25 : cache-read 0.1 : output 5, per-tier $/Mtok), roughly +/-30% of billing.
- 01's mutation row (131 spawns / 23 h / $78) is keyword-only and undercounts mutation work by ~6x; see experiment 05.
- Sample new-data row (since Oct 29): coordinator cw/cr 1.05; executor wait share 27%; Charlotte screenshot p50 still 180 s with 112/113 timeouts, so the Charlotte fix is not visible in those transcripts yet.
