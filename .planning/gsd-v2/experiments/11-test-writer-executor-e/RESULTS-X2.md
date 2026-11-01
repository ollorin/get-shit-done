# 11 results, X2: Bash output cap (`bashOutputMaxChars: 8000`)

**Verdict: NOT RUN. No gate was evaluated and nothing was spent on arm runs.** The setting is real and reaches subagents (probe below), but two independent stops apply: (1) the fresh quota is 0.86, above the 0.81 start line, the 0.82 stop line and the harness 0.85 ceiling; (2) a no-LLM bound on the existing A rows says the cost gate cannot be met by this cap (best case 0.98 x A against the required 0.95). Per the brief, partial results are reported instead of pushing on. The harness arm, metrics and pre-registration are built and committed, so a run is one command after the quota resets (2026-11-03 17:00 UTC).

## 1. Does the setting exist, and does it reach subagents? Yes.

- Name and range: `bashOutputMaxChars` is in the settings schema of the installed `claude` 2.1.304 (binary string search; description: "How many characters of a successful Bash or PowerShell command's output Claude receives inline (default 30000; values clamp to 4000-128000). Output past this is saved to a file and Claude receives a short preview plus the path. When set, this also replaces BASH_MAX_OUTPUT_LENGTH"). The changelog (`~/.claude/cache/changelog.md:2924`) lists it.
- How it is passed: a `--settings <file>` JSON `{"bashOutputMaxChars": N}`, the same route as the window arm. The harness drops user settings (`--setting-sources project,local`), so the key must be in that file.
- Probe (2 runs, cheapest tier, about $0.008 total, scratch `~/ab-eval/scratch/bc-probe/`): a Bash command printing 9,009 characters, run by the main thread and by a subagent defined through `--agents`.

| arm | main thread tool result | subagent tool result (transcript `subagents/agent-*.jsonl`) |
|---|---|---|
| cap 4000 | 2,249 chars, `<persisted-output> Output too large (8.8KB). Full output saved to: .../tool-results/<id>.txt` plus a preview | same form, 2,249 chars |
| no setting | 9,008 chars inline | 9,008 chars inline |

So the cap applies inside the subagent. Not probed: the failure-output path (design: about 10k head-tail, no file), a cap of 8000 specifically (the preview stayed about 2,000 chars at 4000; the same at 8000 is unverified), and the coordinator/verifier effect (the setting is session-wide, so it applies to them by construction; no run measures it).

## 2. Quota (fresh value)

`quota.json` held 0.79 (stale). The probe's `rate_limit_event` reported `unifiedWindows.seven_day.utilization` 0.86 (resets 2026-11-03 17:00 UTC), so production took about 7pp since the X1 batch. `quota.json` now holds 0.86 (run id `X2-probe-cap4000`). `ab_run.py quota` refuses batches (0.86 > 0.85). Disk was fine (18 GiB free, `~/ab-eval` 1.6 GiB), no background processes left.

## 3. Reused A rows

12 rows, none superseded, all `done`: E3 r1-r3 `...062550-466b86`, `...064725-e70838`, `...071400-a49ef0` (accepted 0/3); E4 r1-r3 (3/3); E6 r1-r3 `...111257-eb3371`, `...111835-7cfcc8`, `...112314-76a8e5` (3/3); E7 r1-r3 (3/3). Frozen entry sha `e2b2ec1a...` ran; the installed `gsd-executor` is now `20f84401...`, so the BC arm sets `SOURCE_DRIFT_OK` like the window arm (the agents.json entry hash stays enforced) and `variants/A` is untouched. Snapshots are pruned and would be rebuilt; the equality check against the A rows is in `PREREG-X2.md`. Two earlier E6 A rows and three tiny E3 A rows are superseded and excluded.

## 4. Baseline and bound from the existing A rows (no LLM calls)

`ab_bashcap.py`, from the 12 A transcripts. Cost at tier prices (executor-tier list, x5 above 100k), sum of per-task medians: **$2.169** (E3 1.164, E4 0.767, E6 0.109, E7 0.129; flat prices $0.525). Pooled share of executor calls above 100k: **0.862** (613 of 711).

Exposure of the cap: 21 of 515 Bash results exceed 8,000 chars (4.1%), carrying 245,683 of 826,436 Bash chars (29.7%), matching the design's 4.85% and 30.1%. By task: E3 13 results (164,850 chars), E7 4, E6 2, E4 2. Read-back already happens at the default cap: 20 results saved to files and 30 later Read/Bash calls naming them (E3 19/28, E7 1/2).

Upper bound of the saving (`ab_bashcap.py cf`): remove the over-cap part of every Bash result (keep a 2,000-char preview) from every later call, re-price with the 5x line, assume zero read-back and no change in behaviour. That is generous to the cap.

| cap | chars/token 3.0 | 3.5 | 4.0 | calls above 100k (A 0.834 of all calls) |
|---|---|---|---|---|
| 8000 | 0.980 x A | 0.982 | 0.984 | 0.830 |
| 4000 (floor of the range) | 0.955 | 0.962 | 0.965 | 0.819-0.822 |

Per task at 8000 (3.5 chars/token): E3 $1.164 to $1.142, E4 0.767 to 0.759, E6 0.109 to 0.101, E7 unchanged. The calls stay above the line because the A peaks (118k-345k) are dominated by Read results, tool calls and accumulated history, not by a few large Bash outputs.

## 5. Gate table

| Gate | Pass rule | Result |
|---|---|---|
| Acceptance, no flip | BC >= A per task | not run |
| Cost | BC <= 0.95 x A at tier prices | not run; bound says best case 0.98 x A (FAIL expected) |
| Calls above 100k | BC share below A | not run; bound 0.834 to 0.830 of all calls (a 0.4pp drop) |
| Read-back counted | report | A baseline 20 saved, 30 read-backs; BC not run |
| Judge non-inferior (Opus, both orders) | delta >= -0.35, honesty <= A + 1 | not run (no BC runs; no judge calls made) |

## 6. If it passed: the ship change and the follow-up

Not applicable now. If a future BC run passed: add `"bashOutputMaxChars": 8000` to the user settings (`~/.claude/settings.json`) and the project settings the executors read; this is session-wide, so it also caps coordinators, verifiers and the main thread. The design's follow-up is one verifier check and one coordinator check (a tail-truncated failure costs a read-back), since these tasks test only executors. Nothing was shipped.

## 7. Recommendation

Do not spend the $6 and 1.5pp on X2 as designed: the cap's mechanism is verified, but on these 12 executor transcripts it cannot buy a 5% tier-price cut at 8000 and only reaches about 4% at the 4000 floor, with all read-back costs and behaviour effects still against it. If the CEO wants the question closed with measurement rather than a bound, run `python3 ab_run.py run --task E3 --variant A --bash-cap 8000 --reps 3` (E3 carries 54% of the cost and 13 of the 21 oversize results), then E4/E6/E7, after 2026-11-03 17:00 UTC, gate with `python3 ab_bashcap.py gates --cap 8000`. Limits of the bound: it models Bash results only, takes chars per token from a 3.0-4.0 range, and ignores that a preview can change what the agent does next (it can only add read-back or retries, which push the cost up).

## Harness changes (committed, `scripts/ab-eval`)

`ab_run.py --bash-cap N` (clamp range checked, rows to `results/runs-bashcap.jsonl`, batch start ceiling 0.8099, between-run stop 0.8199), `ab_judge.py` reads those rows as arm `BC`, `ab_bashcap.py` (`gates`, `cf`, `selftest`), 6 new unit tests; 180 tests pass. One correction to `PREREG-X2.md` after its commit and before any BC run: the cost line said the exp 10 compaction add-on was included; the code omits it because no arm here compacts.
