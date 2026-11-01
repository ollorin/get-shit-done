# Prompt-cache TTL break-even per role (5 min vs 1 h)

Generated 2026-11-01 17:22 local by `scripts/gsd-metrics/cache_ttl.py`. Window: 2026-10-11 16:22 .. now UTC (spawns whose first timestamp falls inside). Transcripts in scope: 2802 (326 re-parsed because stale in index).

Flags: multipliers base 1.00 read 0.10 write-5m 1.25 write-1h 2.00; base input $/MTok opus 5.00 sonnet 3.00 haiku 1.00 fable 5.00. Costs are input-side only (output identical in both cases), in $ at those prices.

## Per role and model

| role | model | spawns | turns | med/p90 turns | gaps | >5m % | >1h % | obs read M | obs w5m M | obs w1h M | sim 5m $ | sim 1h $ | delta $ | delta % | verdict | spawns 1h wins % | rescued gaps/spawn vs break-even |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| gsd-executor | sonnet | 187 | 15875 | 72/159 | 15688 | 3.8 | 0.1 | 2418.8 | 128.9 | 0.0 | 1239 | 996 | 243 | 19.6 | 1h pays | 51 | 3.1 vs 0.9 |
| gsd-phase-coordinator | sonnet | 46 | 4249 | 73/222 | 4203 | 43.6 | 0.5 | 352.6 | 266.4 | 1.1 | 1233 | 250 | 983 | 79.8 | 1h pays | 93 | 39.5 vs 1.0 |
| general-purpose | sonnet | 525 | 12567 | 16/48 | 12042 | 1.7 | 0.0 | 1309.3 | 89.8 | 0.0 | 733 | 757 | -24 | -3.2 | 5m pays | 3 | 0.4 vs 0.5 |
| general-purpose | opus | 221 | 7086 | 29/57 | 6865 | 0.0 | 0.0 | 790.7 | 30.7 | 0.0 | 589 | 701 | -112 | -19.0 | 5m pays | 1 | 0.0 vs 0.6 |
| MAIN-session | sonnet | 3 | 1836 | 246/1586 | 1833 | 30.8 | 1.5 | 355.8 | 0.0 | 8.1 | 502 | 152 | 351 | 69.8 | 1h pays | 67 | 179.3 vs 8.2 |
| gsd-executor | haiku | 348 | 21563 | 48/130 | 21215 | 1.2 | 0.0 | 3501.1 | 109.1 | 0.0 | 498 | 501 | -4 | -0.7 | neutral (<2%) | 22 | 0.7 vs 0.8 |
| general-purpose | haiku | 814 | 19731 | 18/50 | 18917 | 1.2 | 0.1 | 1936.8 | 97.8 | 0.0 | 321 | 368 | -47 | -14.6 | 5m pays | 12 | 0.3 vs 0.9 |
| gsd-planner | opus | 44 | 2330 | 38/124 | 2286 | 0.0 | 0.0 | 366.2 | 10.9 | 0.0 | 248 | 288 | -39 | -15.7 | 5m pays | 0 | 0.0 vs inf |
| charlotte-runner-session | haiku | 348 | 12021 | 33/50 | 11673 | 0.0 | 0.0 | 812.4 | 0.0 | 25.0 | 120 | 143 | -23 | -19.4 | 5m pays | 0 | 0.0 vs 1.0 |
| gsd-debugger | sonnet | 23 | 942 | 28/91 | 919 | 2.1 | 0.0 | 103.4 | 6.1 | 0.0 | 55 | 49 | 5 | 9.8 | 1h pays | 22 | 0.8 vs 0.5 |
| gsd-plan-checker | opus | 15 | 519 | 33/45 | 504 | 0.0 | 0.0 | 72.3 | 2.9 | 0.0 | 54 | 64 | -11 | -19.7 | 5m pays | 0 | 0.0 vs inf |
| MAIN-session | opus | 1 | 128 | 128/128 | 127 | 20.5 | 3.9 | 25.8 | 0.0 | 1.6 | 51 | 30 | 21 | 41.9 | 1h pays | 100 | 21.0 vs 4.8 |
| gsd-verifier | opus | 8 | 435 | 49/95 | 427 | 0.0 | 0.0 | 53.7 | 1.2 | 0.0 | 35 | 39 | -5 | -13.5 | 5m pays | 0 | 0.0 vs inf |
| gsd-phase-researcher | sonnet | 6 | 393 | 65/70 | 387 | 0.5 | 0.0 | 65.8 | 1.9 | 0.0 | 27 | 30 | -2 | -9.1 | 5m pays | 17 | 0.3 vs 1.0 |
| gsd-plan-attacker | opus | 18 | 373 | 20.5/30 | 355 | 0.0 | 0.0 | 24.0 | 1.6 | 0.0 | 22 | 28 | -6 | -27.7 | 5m pays | 0 | 0.0 vs inf |
| gsd-charlotte-qa | sonnet | 21 | 403 | 12/39 | 382 | 11.3 | 0.0 | 20.9 | 3.7 | 0.0 | 21 | 15 | 6 | 29.3 | 1h pays | 48 | 2.0 vs 0.7 |
| gsd-plan-checker | sonnet | 17 | 253 | 9/19 | 236 | 0.0 | 0.0 | 31.6 | 1.8 | 0.0 | 17 | 21 | -4 | -25.7 | 5m pays | 0 | 0.0 vs inf |
| gsd-docs-updater | haiku | 66 | 991 | 11.5/22 | 925 | 0.0 | 0.0 | 64.2 | 5.6 | 0.0 | 13 | 18 | -4 | -31.2 | 5m pays | 0 | 0.0 vs inf |
| gsd-debugger | opus | 1 | 100 | 100/100 | 99 | 2.0 | 0.0 | 12.2 | 0.3 | 0.0 | 9 | 8 | 1 | 7.6 | 1h pays | 100 | 2.0 vs 1.0 |
| gsd-test-writer | sonnet | 2 | 121 | 60.5/65 | 119 | 0.0 | 0.0 | 20.9 | 0.5 | 0.0 | 8 | 10 | -1 | -14.8 | 5m pays | 0 | 0.0 vs inf |
| gsd-test-writer | haiku | 13 | 488 | 40/63 | 475 | 0.0 | 0.0 | 57.1 | 1.9 | 0.0 | 8 | 10 | -1 | -18.0 | 5m pays | 0 | 0.0 vs inf |
| gsd-docs-updater | sonnet | 4 | 117 | 9/92 | 113 | 0.0 | 0.0 | 17.7 | 0.6 | 0.0 | 7 | 9 | -1 | -16.7 | 5m pays | 0 | 0.0 vs inf |
| gsd-plan-judge | opus | 17 | 113 | 7/8 | 96 | 0.0 | 0.0 | 3.6 | 0.7 | 0.0 | 7 | 9 | -3 | -43.7 | 5m pays | 0 | 0.0 vs inf |
| Plan | opus | 1 | 53 | 53/53 | 52 | 0.0 | 0.0 | 7.1 | 0.2 | 0.0 | 5 | 6 | -1 | -15.7 | 5m pays | 0 | 0.0 vs inf |
| gsd-plan-defender | sonnet | 17 | 61 | 4/4 | 44 | 0.0 | 0.0 | 1.4 | 0.6 | 0.0 | 3 | 4 | -1 | -51.6 | 5m pays | 0 | 0.0 vs inf |
| gsd-planner | sonnet | 6 | 48 | 7.5/9 | 42 | 0.0 | 0.0 | 2.7 | 0.5 | 0.0 | 3 | 4 | -1 | -41.5 | 5m pays | 0 | 0.0 vs inf |
| Explore | sonnet | 2 | 51 | 25.5/41 | 49 | 0.0 | 0.0 | 3.0 | 0.2 | 0.0 | 2 | 2 | -0 | -24.6 | 5m pays | 0 | 0.0 vs inf |
| gsd-charlotte-qa | haiku | 5 | 97 | 18/43 | 92 | 8.7 | 0.0 | 5.0 | 0.7 | 0.0 | 2 | 1 | 0 | 23.3 | 1h pays | 40 | 1.6 vs 0.6 |
| gsd2-runner | haiku | 18 | 133 | 5/11 | 115 | 0.9 | 0.0 | 2.9 | 0.9 | 0.0 | 1 | 2 | -1 | -37.5 | 5m pays | 6 | 0.1 vs 0.4 |
| gsd-roadmapper | sonnet | 2 | 10 | 5/7 | 8 | 0.0 | 0.0 | 0.5 | 0.1 | 0.0 | 1 | 1 | -0 | -47.6 | 5m pays | 0 | 0.0 vs inf |
| gsd-e2e-test-generator | sonnet | 1 | 10 | 10/10 | 9 | 0.0 | 0.0 | 0.3 | 0.1 | 0.0 | 0 | 0 | -0 | -39.3 | 5m pays | 0 | 0.0 vs inf |
| web-fetch | haiku | 1 | 2 | 2/2 | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0 | 0 | -0 | -59.4 | 5m pays | 0 | 0.0 vs inf |
| Explore | haiku | 1 | 1 | 1/1 | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0 | 0 | -0 | -60.0 | 5m pays | 0 | 0.0 vs inf |
| **TOTAL** | | 2802 | 103100 | | 100298 | 3.8 | 0.1 | | | | 5833 | 4515 | 1318 | 22.6 | 1h pays | | |

">5m %" counts every gap above 5 min (so it includes the >1h gaps). "inf" break-even = the role has no gaps in (5m, 1h] to rescue, so 1h can only add premium. "obs w5m" includes cache writes from logs without the ephemeral split (older transcripts; assumed 5m). "rescued gaps" = gaps in (5m, 1h]: a 5m TTL rewrites the prefix, a 1h TTL reads it. Break-even = 1h write premium per spawn divided by the mean saving per rescued gap; 1h pays when rescued > break-even. delta = sim 5m - sim 1h (positive = 1h cheaper).

## Sanity check: simulated 5m vs logged cost

- 5m-only logged (split present), sim 5m, spec method (first call = full write): 2444 transcripts, simulated $5055 vs logged $4957, error +2.0% (median abs per-transcript error 0.0%).
- 5m-only logged, diagnostic: first call keeps its observed cache read: 2444 transcripts, simulated $5029 vs logged $4957, error +1.5% (median abs per-transcript error 0.0%).
- 5m-only incl. unsplit older logs, sim 5m, spec method: 2444 transcripts, simulated $5055 vs logged $4957, error +2.0% (median abs per-transcript error 0.0%).
- 5m-only logged, only transcripts with at least one gap > 5 min (where the TTL logic actually bites), spec method: 382 transcripts, simulated $2559 vs logged $2467, error +3.7% (median abs per-transcript error 1.5%).
- 5m-only logged, gsd-phase-coordinator only, spec method: 40 transcripts, simulated $1129 vs logged $1083, error +4.2% (median abs per-transcript error 5.9%).
- 1h-only logged, sim 1h (checks the 1h branch): 358 transcripts, simulated $354 vs logged $344, error +2.7% (median abs per-transcript error 9.9%).

Verdict on the simulation: within the 15% bar (+2.0%).

## Production check: gsd-phase-coordinator since 2026-10-31 16:00 local

Spawns: 6. 1h-only writes: 6. Mixed 5m+1h: 0. 5m-only (no 1h): 0.

| start (local) | model | turns | gaps >5m | gaps >1h | write 5m M | write 1h M | read M | class |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 11-01 04:10 | sonnet | 148 | 40 | 0 | 0.0 | 0.3 | 24.5 | 1h-only |
| 11-01 04:51 | sonnet | 69 | 18 | 0 | 0.0 | 0.1 | 6.4 | 1h-only |
| 11-01 07:57 | sonnet | 112 | 45 | 0 | 0.0 | 0.2 | 15.8 | 1h-only |
| 11-01 10:44 | sonnet | 107 | 34 | 0 | 0.0 | 0.2 | 13.6 | 1h-only |
| 11-01 15:02 | sonnet | 79 | 12 | 0 | 0.0 | 0.2 | 10.8 | 1h-only |
| 11-01 16:34 | sonnet | 31 | 4 | 0 | 0.0 | 0.1 | 2.1 | 1h-only |

Frontmatter change per HYPOTHESIS.md applies to coordinators spawned after ~2026-10-31 19:40 local; earlier rows are expected to be 5m.

## Main-thread sessions: already 1h?

Main sessions in window: 4; 1h-only 4, mixed 0, 5m-only 0. 1h share of cache-write tokens: 100.0% (9.7 M of 9.7 M).

Per call-day, 1h share of split-logged cache writes (local date):

| day | main w5m M | main w1h M | main 1h % | coord w5m M | coord w1h M | coord 1h % |
|---|---:|---:|---:|---:|---:|---:|
| 2026-10-16 | 0.0 | 1.0 | 100 | 4.5 | 0.0 | 0 |
| 2026-10-17 | 0.0 | 0.7 | 100 | 10.5 | 0.0 | 0 |
| 2026-10-18 | 0.0 | 0.3 | 100 | 23.1 | 0.0 | 0 |
| 2026-10-20 | 0.0 | 0.1 | 100 | 0.8 | 0.0 | 0 |
| 2026-10-21 | 0.0 | 0.3 | 100 | 16.3 | 0.0 | 0 |
| 2026-10-22 | 0.0 | 0.3 | 100 | 22.1 | 0.0 | 0 |
| 2026-10-23 | 0.0 | 0.3 | 100 | 22.3 | 0.0 | 0 |
| 2026-10-24 | 0.0 | 0.1 | 100 | 4.0 | 0.0 | 0 |
| 2026-10-27 | 0.0 | 0.3 | 100 | 3.2 | 0.0 | 0 |
| 2026-10-28 | 0.0 | 0.3 | 100 | 31.3 | 0.0 | 0 |
| 2026-10-29 | 0.0 | 0.5 | 100 | 18.9 | 0.0 | 0 |
| 2026-10-30 | 0.0 | 0.5 | 100 | 37.6 | 0.0 | 0 |
| 2026-10-31 | 0.0 | 1.0 | 100 | 50.9 | 0.0 | 0 |
| 2026-11-01 | 0.0 | 1.5 | 100 | 9.6 | 1.1 | 10 |

## Method

- Roles and models come from lib.py (`role()`: agentType from meta.json, MAIN-session for top-level, charlotte-runner-session for the charlotte project; `model()`: dominant model by output tokens). Per-call usage is read from the raw transcripts (one call per assistant message id; `<synthetic>` and API-error messages dropped).
- Gap = timestamp of an assistant message to the timestamp of the next assistant message in the same transcript (first line of each message). Bucket decides expiry: gap <= TTL is a hit (TTL restarts on every call).
- Context per call = input + cache_read + cache_creation. Simulation per transcript and TTL: first call writes the whole context; later call within TTL reads min(prev context, context) and writes the remainder; beyond TTL rewrites the whole context, all at that TTL's write rate. Priced per call by its own model tier. Output tokens ignored.
- Identity used for break-even: sim5 - sim1 = saving on rescued gaps (read vs 5m rewrite) - 1h write premium on every token written under 1h.

## Caveats and unmeasured

- Prices and multipliers are the CLI defaults, not verified against current docs. Output tokens excluded.
- Subscription limits: how cache-write and cache-read tokens count against 5-hour/weekly usage limits is unmeasured; this is a token-priced cost model only.
- Polling changes unmeasured: if coordinators stop polling (long sleeps/waits), gap distributions change and so does the verdict; this uses the polling behaviour as logged.
- Cross-transcript cache sharing (identical system/tool prefixes between spawns) is not modelled; every spawn starts cold in the simulation. A 1h TTL would raise cross-spawn hit rates, which this undercounts.
- Gaps include model generation and tool time (start-to-start), and parallel background subagents do not refresh a parent's cache. Main-thread sessions include idle periods while the user is away (> 1 h), which no TTL fixes.
- The index (`files.jsonl`) can lag; stale or missing transcripts are re-parsed in memory with extract.process, nothing is written to the index.

