# Results: Charlotte scenario-session candidates (Q3)

Status: COMPLETE (2026-11-01, 18 scored sessions + 9 probe sessions, about $2.0 total at Haiku 4.5 list price). Gates were written at 2026-11-01T17:42Z, before any probe or scored run. Method: `scripts/ab-eval/q3/` (code), data `~/ab-eval-q3/`. Time box 75 min from 17:16Z.

## Gates (declared before the first run, not changed afterwards)

Task Q3: 2 scenarios (S-seeded on `fixtures/qa-app-seeded`, S-clean = defect-fixed copy), 9 assertions each (S1..S9), 3 reps per scenario per arm = 6 sessions per arm, order randomised (seed recorded). Truth: `examples/artifacts/Q/defects.json` (F1 S2, F2 S3, F4 S8, F3 S9, F5 S5, F6 S6; S1, S4, S7 are controls expected PASS). Grading is deterministic from the `---RESULT---` JSON: step `status` of steps tagged `S<n>` (any FAIL wins).

For a candidate X against the control, X passes only if ALL hold:

| Gate | Rule |
|---|---|
| G-recall | seeded defects detected (of 18 = 6 defects x 3 reps) >= control's |
| G-falsefail | assertion-level FAILs on the clean fixture (tagged S1..S9 reported FAIL, of 27) <= control's, and sessions with overall status FAIL on clean <= control's |
| G-parse | verdict contract parse rate 100% (block present, valid JSON, status allowed, non-empty steps) over all 6 sessions of X |
| G-first-turn | (C and C+M1) median first-turn tokens <= 0.75 x control median (DESIGN.md S6 G6 bar) |
| G-cost | median session cost at the arm's own list price <= control median at Haiku 4.5 list price (Haiku 4.5 $1/$5 per Mtok; Haiku 5.5 $0.10/$0.50 up to 100k prompt, $0.50/$2.50 above; cache read 0.1x, 5m write 1.25x, 1h write 2x) |
| G-complete | every session exits 0 and finishes (no timeout/ERROR-class output) |

Arms: control (run.ts argv: `--model claude-haiku-4-5-20251001`, 45 `--allowedTools` parsed from `tool-policy.ts`), C (C1+C2+C3 from the diagnosis, model unchanged), M1 (control text, `--model haiku`), C+M1 only if C and M1 each pass. All arms add `--output-format stream-json --verbose --no-session-persistence` (the last so test sessions leave no transcripts in `~/.claude/projects`). Tie-break rule: literal comparisons as written; with n=6 per arm a tie passes, a one-defect shortfall fails. No retune after the first scored run; at most one replacement if a probe shows a flag has no effect. Quota stop 0.82 (max of `~/ab-eval/results/quota.json` and own tracking), disk stop 7 GiB free.

## Probes (run 17:20-17:24Z, before any scored run; ~$0.5 total)

Probe sessions: `claude --print` with a 3-question prompt from `apps/e2e-charlotte`, run.ts argv, stream-json; first-turn tokens are deterministic (identical on a repeat of P0, P3, P5). Data: `~/ab-eval-q3/probes/`.

| Probe | First-turn tokens | init tools | init slash/skills | Model answer (Q1 CLAUDE.md / Q2 MEMORY.md / Q3 Agent+Skill tools) | Verdict |
|---|---|---|---|---|---|
| P0 base | 37,510 | 90 | 110 / 42 | yes / yes / yes | reference |
| P1 `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` | 27,963 (-9,547) | 90 | 110 / 42 | no / yes / yes | works (CLAUDE.md + rules gone) |
| P2 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | 30,454 (-7,056) | 90 | 110 / 42 | yes / no / yes; `memory_paths` absent in init | works (MEMORY.md + section gone) |
| P3 `--disable-slash-commands` | 39,633 (+2,123) | 89 | 0 / 0 | yes / yes / Skill gone | listings gone but prompt GROWS: counter-productive, dropped |
| P4 deny `Agent,Skill,Edit,Write,NotebookEdit,WebFetch,WebSearch` | 32,950 (-4,560) | 84 | 110 / 42 | yes / yes / no / no | works (Agent and Skill tools removed) |
| P5 = P1+P2+P3+P4 | 20,457 (-17,053) | 84 | 0 / 0 | no / no / no | P3's +2.1k is additive: without it ~18.3k expected |

Delta probe (`probe-delta.json`, clean fixture, same 6-call script, only `auto_snapshot` differs): default config `every_action`: 2 of 2 `click`/`wait_for` results carry `delta`; `auto_snapshot: "manual"` (configure result confirms `"auto_snapshot":"manual"`): still 2 of 2 carry `delta`, and the click delta is larger (1,844 vs 1,256 chars; it diffs against an older snapshot, `from_snapshot:1,to_snapshot:0`). Source: `~/charlotte/src/tools/tool-helpers.ts:208-224` attaches `delta` whenever the store holds any earlier snapshot, and in run.ts's flow STEP 1 `tab_open` runs before STEP 2 `configure` (stale-snapshot cause: unverified, the 1,844-char diff is the measured fact). C3 as written in the diagnosis does not work: dropped, no replacement (no other delta switch exists in that file).

Decision before the first scored run: **C = C1 env vars (2) + C2 deny list; prompt text unchanged (C3 dropped); `--disable-slash-commands` dropped** (the Skill tool and its listing are removed by C2). No replacement was added (the one allowed replacement was not used). The control and C prompts are therefore byte-identical; C differs only in env and `--disallowedTools`.

## Scored run (18 sessions, 2 in parallel, order shuffled with seed 20261101)

Order file `~/ab-eval-q3/order-main.json`; raw streams and `record.json` per session under `~/ab-eval-q3/runs/`; rows `~/ab-eval-q3/runs.jsonl`; aggregate `~/ab-eval-q3/report.json`. Prompt: generated at run time by `q3/gen_prompt.ts` importing `buildPrompt` from `runner/prompt.ts` (read-only). Source sha256 (first 12): run.ts `4950b032f308`, prompt.ts `e781efb9ff97`, tool-policy.ts `f94849034f2c`, defects.json `379b457c20d0`. Clean fixture = seeded app with F1-F6 patched at run time (`q3_spec.build_clean`); the repo's `fixtures/qa-app/` is a one-button stub with none of the pages S1..S9 need, so it was not served. Control and C prompts are byte-identical (C3 dropped). Operator TOTP flow not exercised (no `auth`). `causal-language` violations not measured.

| Arm | Recall (seeded, of 18) | Clean false FAILs (of 27 / sessions FAIL of 3) | Parse rate | First-turn tokens (median) | Total tokens/session (mean) | API calls/session | Cost/session median, Haiku 4.5 list | Cost/session median, Haiku 5.5 list | Total cost 6 sessions, 4.5 / 5.5 list | Wall/session (mean) |
|---|---|---|---|---|---|---|---|---|---|---|
| control (pinned 4.5) | 18 | 0 / 0 | 6/6 | 39,352 | 1,487,880 | 29.8 | $0.217 | $0.022 | $1.259 / $0.126 | 80.8 s |
| C (C1 env + C2 deny list) | 18 | 0 / 0 | 6/6 | 22,240 (0.565x) | 947,598 (-36%) | 29.2 | $0.142 (-34%) | $0.014 | $0.912 / $0.091 | 78.8 s |
| M1 (`--model haiku`, resolved to `claude-haiku-5-5`) | 18 | 2 / 2 | 6/6 | 47,610 (+21%, tokenizer) | 1,127,088 | 19.3 | $0.190 (as if 4.5; not its price) | $0.019 | $1.139 (n/a) / $0.114 | 57.3 s |

"4.5 list" = Haiku 4.5 prices applied to the arm's tokens; the control and C totals equal the CLI's own `total_cost_usd` (1.259, 0.912). M1's real cost is the 5.5 column (the CLI reports 0.114). Wall times are with 2 sessions in parallel on a loaded host: indicative only.

Gate outcomes (declared above; `q3_report.py`):

| Gate | C | M1 |
|---|---|---|
| G-recall (18 >= 18) | pass | pass |
| G-falsefail (clean FAILs <= control's 0) | pass (0) | **fail (2: S9 in two clean sessions)** |
| G-parse 100% | pass | pass |
| G-first-turn <= 0.75 x control (29,514) | pass (22,240) | n/a |
| G-cost | pass | pass |
| G-complete | pass | pass |

## Decisions

- **C (C1 env vars + C2 deny list, C3 and the slash flag dropped at probe stage): PASS all declared gates.** Same recall (18/18), 0 false FAILs, 6/6 parse, first turn 39.4k to 22.2k, -36% tokens, -27.5% total session cost at Haiku 4.5 list ($1.259 to $0.912). The diagnosis estimate (first turn 21-25k, -30%) held without C3. Not shown: behaviour on real-time crash scenarios, operator TOTP/auth steps, long sessions, and whether denied built-ins matter for any of the 374 production scenarios (0 calls in 12,360 historically, so unlikely).
- **M1 (alias `haiku` = Haiku 5.5): REJECTED on the declared gate.** Recall equal (18/18), parse 6/6, cost -91% at 5.5 list ($0.114 vs $1.259), 19.3 vs 29.8 API calls, but 2 false FAILs on the clean fixture. Both are step S9: the agent read `#result` = "Message sent. Thank you!" and still marked FAIL because the element keeps `class="err"` and renders in red (rgb(176,0,32)) (`09-M1-clean-r2`, `11-M1-clean-r1` final_text). That is a real defect in my defect-fixed clean copy (the success text inherits the error style; U1-U3 were left unfixed on purpose and this one slipped in), so 5.5 may be reporting a genuine observation that 4.5 never looked at (the 6 control and C clean S9 reads all PASS and none recorded the colour; the third M1 clean session also recorded the colour but passed). It is still a verdict that disagrees with the assertion as worded ("shows a success message and no error text"), and the gate was fixed before the run: no retune, rejected stays rejected. A re-test with that fixture flaw removed is a new experiment, not a rescue of this one. Also noted: 5.5 first turn is +21% tokens for identical text (tokenizer), so first-turn-token comparisons across models are not like for like.
- **C+M1: not run** (precondition: both pass individually).

## Caveats

n=6 sessions per arm, 3 per scenario cell, one static 3-page app, 9 assertions. Recall 18/18 in every arm gives a ceiling effect: this test cannot see a recall loss smaller than the whole defect set. Zero-vs-two false FAILs is 2/27 vs 0/27 and sits on one fixture flaw; neither is statistically separable. Tokens are deterministic (first-turn counts repeat to within 3 tokens), so the C token and cost reductions are solid for this prompt shape; the quality gates are weak evidence. The cost numbers use 5m cache writes as in run.ts (`FORCE_PROMPT_CACHING_5M=1` set in every arm). Sessions ran with `--no-session-persistence`, so they left no transcripts for gsd-metrics. The `delta` field stayed on in all 104 click/wait_for/type results across arms (35/35 control, 35/35 C, 34/34 M1).

Probe failures (recorded, not worked around): `--disable-slash-commands` removes the Skill tool and listings but adds 2.1k tokens; `auto_snapshot: "manual"` does not remove `delta`. Measurement fix made after the run (not an arm change): streamed assistant events carry partial `output_tokens`, so output cost was re-priced from the result event's total (`q3_recompute.py`); control and C totals now equal the CLI's `total_cost_usd`.

## Spawn changes `run.ts` would need (NOT applied)

C only, in `apps/e2e-charlotte/runner/run.ts` around the `new Deno.Command("claude", ...)` call (lines ~291-320):

1. Deny the unused built-ins through the existing `buildToolArgs`: replace `...buildToolArgs(policy)` with `...buildToolArgs({ allowed: policy.allowed, denied: [...policy.denied, ...LEAN_DENIED_BUILTINS] })`, with module-level `const LEAN_DENIED_BUILTINS = ["Agent", "Skill", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"] as const;` (keep `Bash` and `Read`). Probe P4: Agent and Skill tools absent, -4.6k tokens.
2. Add to the child env object (next to `FORCE_PROMPT_CACHING_5M`): `CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1"`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1"`. Probes P1/P2: -9.5k and -7.1k tokens.
3. Do NOT add `--disable-slash-commands` and do NOT change the STEP 2 prompt text. No change to `prompt.ts`, the result schema, or model (`claude-haiku-4-5-20251001` stays).

`--output-format stream-json --verbose --no-session-persistence` were test-harness additions only.
M1 (`"haiku"`): not recommended on this evidence; revisit after fixing the clean fixture's S9 styling and rerunning the 12-session comparison.
