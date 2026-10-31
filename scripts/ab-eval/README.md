# ab-eval: instruction A/B eval runner (exp 07)

Runs a task with two instruction sets (arm A = current, arm B = candidate), grades each run with objective checks,
judges matched pairs blind, and applies the six decision gates from
`.planning/gsd-v2/experiments/07-instruction-ab-eval/DESIGN.md` §6. Stdlib Python 3.9+ and Deno. Data lives in
`~/ab-eval/` (not committed). See `RUNNER.md` in the experiment folder for status and known gaps.

## Layout

| file | role |
|---|---|
| `ab_common.py` | paths, guards (disk, eval cap, quota, harness config), git and process helpers |
| `ab_setup.py` | `freeze-variant`, `base`, `index`, `variant`, `oracle`, `calibrate`, `all` |
| `ab_run.py` | per-run snapshot, headless `claude -p`, stream parsing, grading, one JSONL row |
| `ab_grade.py` | objective grade of a run: visible and hidden tests, deno check/lint/fmt, fp-gate counters, criticals, fail-first (RED re-run at the commit that lacks the implementation) |
| `ab_transcript.py` | facts from transcripts: instruction chars, first-turn tokens, tier and contamination checks |
| `ab_judge.py` | blinded packets (both orders), Opus judge call, verdict parse, pair collapse, selftest |
| `ab_match.py` | known-defect recall: Sonnet matcher of a review/plan/verify report against `oracle/known.json`, selftest |
| `ab_aggregate.py` | six gates G1-G6, decision table, `REPORT.md`, `decision.json` |
| `hooks/harness-deny.py` | PreToolUse deny hook for runs (DESIGN §4.4, tightened in probe S2). Traversal is judged by where a path resolves after the command's `cd` steps, so in-snapshot `../../.tmp/x` is allowed and anything outside `runs/<RUN>/repo` is denied |
| `hooks/judge-deny.py` | PreToolUse deny hook for judge calls (hides `key.json` and the live tree) |
| `prompts/brief-executor.md` | dispatcher brief plus the Wave-1 executor prompt (`execute-phase.md:206-240`) |
| `prompts/judge.md` | judge rubric template (DESIGN §7.5), dimensions filled per role |
| `fixtures/qa-app/` | clean static page copied into every snapshot (Charlotte probes) |
| `examples/tasks.json` | task registry used for the smoke run (E6 only) |
| `tests/test_ab_eval.py` | unit tests (45): redaction, verdicts, collapse, bootstrap, scrub, transcripts, gates, deny-hook traversal, RED classification, matcher parse, G3 |

## Data layout (`~/ab-eval/`)

```
tasks.json                       copy of examples/tasks.json (task registry)
harness/                         settings.json, empty-mcp.json, judge-settings.json (written by the tools)
variants/A/                      overlay/ (CLAUDE.md, .claude/rules), memory/, agents.json, expected.json, MANIFEST.md
tasks/<ID>/raw/                  base tree: git archive base + harness overlay + planning scrub + zg index
tasks/<ID>/pristine-<V>/         one-commit snapshot per arm (cloned per run with cp -cR)
tasks/<ID>/memory-<V>/           scrubbed memory per arm; scrub-<V>.json logs removals
tasks/<ID>/oracle/               hidden.json, hidden/, ref.diff, known.json (never shown to agents)
tasks/<ID>/calib.json            calibration result; runs refuse without ok=true
runs/<RUN>/                      brief.md, stream.jsonl, stderr.log, transcripts/, grade/, report.md, repo/ (deleted unless --keep)
judge/<PAIR>/                    o1/ and o2/ (sandbox/, key.json, out-<model>.json), index.json
results/                         runs.jsonl, judgments.jsonl, pairs-<model>.json, matches.jsonl, quota.json, REPORT.md, decision.json
```

## Commands

Run from `~/get-shit-done/scripts/ab-eval/`.

```bash
# 1. Variant A is frozen from the live repo HEAD (read-only; the sha is in variants/A/MANIFEST.md)
python3 ab_setup.py freeze-variant --variant A

# 2. Per task: base snapshot, index once, arm pristine, oracle, calibration (no LLM)
cp examples/tasks.json ~/ab-eval/tasks.json
python3 ab_setup.py all --task E6 --variant A

# 3. Runs (max 2 in parallel; refused above seven_day utilisation 0.85; refused without calibration)
python3 ab_run.py quota
python3 ab_run.py run --task E6 --variant A --reps 1 [--parallel 2] [--keep]
python3 ab_run.py run --task E6 --variant A --dry-run          # print the brief only

# 4. Judge matched pairs (both orders are judged; Fable is off unless --second-judge is set)
python3 ab_judge.py pack --a <RUN_A> --b <RUN_B> --rep 1
python3 ab_judge.py judge --pair <PAIR_ID> --model opus
python3 ab_judge.py collapse --judge-model opus
python3 ab_judge.py selftest --model haiku                     # fake packet, haiku, writes nothing to results/

# 5. Known-defect recall (review, plan-check and verify tasks only; needs oracle/known.json)
python3 ab_match.py run --run <RUN_ID> [--model sonnet]        # appends results/matches.jsonl
python3 ab_match.py selftest --model sonnet                    # fake report, writes nothing to results/

# 6. Gates and decision table
python3 ab_aggregate.py --judge-model opus --variant-b B

# Unit tests
python3 tests/test_ab_eval.py
```

Exit status 2 with `REFUSED:` means a guard stopped the command before any work was done.

## Guards

| guard | where | rule |
|---|---|---|
| quota | `ab_run.py check_quota` | refuse a batch when `results/quota.json` seven_day utilisation > 0.85; read from `rate_limit_event` |
| parallelism | `ab_run.py cmd_run` | `--parallel` above 2 is refused |
| disk | `ab_common.check_disk` | refuse below 10 GiB free for a run; setup aborts below 5 GiB |
| eval size | `ab_common.check_eval_cap` | refuse a run when `~/ab-eval` exceeds 3 GiB |
| calibration | `ab_run.build_snapshot` | refuse a task without `calib.json` `ok: true` |
| contamination | `ab_transcript.analyze` | a denied root reached by another path voids the run |
| model | `ab_run.status_of` | any model other than haiku (ignoring `<synthetic>`) voids the run |

## Notes on the design

- Snapshots never contain git history beyond one commit (`git archive` plus `git init`). The live repo is read with
  `git show`/`git archive` only; it is never checked out or modified.
- The project `hooks` key is stripped from the snapshot `settings.json` (probe S6); the harness hook comes in via
  `--settings`.
- Each run uses `--setting-sources project,local` and supplies every role through `--agents` (probe S3).
- Hidden oracles are copied in as `<name>.hidden.test.ts` when the run created the same path, then removed.
- Judge verdicts are parsed from the last fenced JSON block. Invalid output is retried once, then recorded as an error.
