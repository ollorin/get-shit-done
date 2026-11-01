# Charlotte regression scenario sessions: diagnosis and candidate

Status: candidate only. Nothing installed, no A/B run, no browser, `~/igaming-platform` untouched.
Scope: the nested `claude --print` sessions spawned per scenario by `apps/e2e-charlotte/runner/run.ts:291` (spawn), `:294` (model). Role `charlotte-runner-session` (`gsd-metrics/lib.py:29`, any project dir ending `charlotte`).
Data: 348 transcripts in `~/.claude/projects/-Users-ollorin-igaming-platform-apps-e2e-charlotte/` (2026-10-16 17:31Z to 2026-11-01 11:58Z), 12,021 API calls, 12,360 tool calls; 374 scenario results in `apps/e2e-charlotte/results/2026-10-1*..2026-11-01*/results.json` (213 runs). Analysis scripts were throwaway (`/tmp/cr/`), numbers below are reproducible from those two sources.

## Answer

1. **53% of the 43k-token first turn is context the runner never uses**: the parent project's CLAUDE.md, rules, the auto-memory index and its system-prompt section, the skill listing and the agent listing (about 23k of 43k tokens). The scenario prompt body is 11% (4.7k). Charlotte's own tool schemas are deferred and cost 3.7k only on turn 2.
2. **Three action tools carry 71% of tool-result tokens** (`wait_for` 36%, `click` 24%, `type` 12%) because every action returns the full interactive list plus a diff `delta`. `evaluate`, the tool the verdicts actually rest on, is 34% of calls and 1.5% of result tokens. `screenshot` and `console` are negligible.
3. **Failures are mostly not the agent.** Of 110 non-PASS results (264 PASS): 56 harness setup ERRORs (45 on one day, 2026-10-28), 18 harness-class FAILs, 18 product/spec, 10 real-time race on crash scenarios, 4 agent mistakes, 3 agent-output ERRORs, 1 unclassified; 0 TIMEOUT, 0 LIMIT_ABORTED. Last three days: 27 PASS, 1 FAIL.
4. **Model**: all 12,021 calls logged `claude-haiku-4-5-20251001`. Estimated spend $148.77 (1h-cache writes, as logged) or $129.99 (if writes were 5m, as of today's commit `76c774137`). On Haiku 5.5 prices: $22.56 / $19.96, i.e. -85%. No quality evidence on Charlotte exists: unverified.
5. **Candidate C** (3 changes, one diff below): lean inherited context, trim unused built-in tools, suppress per-action delta. Estimated first turn 43k to about 21-25k, spend -$40 to -$47 (about -30%) on Haiku 4.5. **Candidate M1** (model) is separate. Q1/Q2 cannot test either; a purpose-built Q3 on the same seeded fixture can, for about $5-6.

## 1. First-turn composition

First assistant message of each session: input + cache_creation + cache_read. n=348, median 43,176 tokens (min 39,666, max 51,295). The session in the sample wrote 26,906 and read 18,501; so about 27k tokens are written at the 1h price per session (why the split falls there is unverified; `session_context` carries a per-session `gitStatus`) (all 25.04M cache-creation tokens in the data are `ephemeral_1h`; `cc5m` = 0).

Measured chars are medians of de-duplicated attachments (`prompt_snapshot`, `instructions`, listings) per session. Token figures: prompt body from a regression over 348 sessions (first-turn tokens = 38,565 + 0.306 x prompt chars, so 3.26 chars/token); all other text at an assumed 3.5 chars/token.

| Part | Chars | Tokens (est.) | Used by the runner? |
|---|---|---|---|
| run.ts prompt body (`prompt.ts:107`, median) | 15,217 (6,456 to 27,129) | 4.7k, measured | yes |
| Default system prompt, excl. auto-memory section | 16.0k | 4.6k | partly |
| Auto-memory section of the system prompt (`# auto memory`) | 12.8k | 3.7k | no |
| `igaming-platform/CLAUDE.md` | 17.5k | 5.0k | no |
| `.claude/rules/pre-pr-quality-gates.md` | 8.6k | 2.4k | no |
| `MEMORY.md` index (type AutoMem) | 13.2k | 3.8k | no |
| `RTK.md` + global CLAUDE.md | 1.0k | 0.3k | no |
| Agent-type listing (`agent_listing_delta`) | 12.2k | 3.5k | no (0 Agent calls) |
| Skill listing | 11.2k | 3.2k | no (0 Skill calls) |
| Deferred tool names (79, three MCP servers plus built-ins) | 5.6k | 1.6k | 46 of the names are Charlotte's |
| MCP instructions (`claude.ai Claude Docs`) | 2.2k | 0.6k | no |
| `session_context` (email, gitStatus) | 2.7k | 0.8k | no |
| Output style + env/date/model attachments | 2.5k | 0.7k | n/a |
| Residual: built-in tool definitions, wrapper | not logged | about 8k | unverified split |

The inherited block removable by flags is CLAUDE.md + rules + MEMORY + RTK (11.5k) + auto-memory section (3.7k) + skill listing (3.2k) = **about 18.4k tokens (43%)**; plus the agent listing (3.5k) = 21.9k (51%).

Charlotte tool schemas: all 46 tools are in `--allowedTools` (`tool-policy.ts` `CHARLOTTE_TOOLS`) but deferred. Every session starts with a `ToolSearch` call (372 calls, 348 sessions) that loads the schemas it asks for (13 in the sample session, `deferred_tools_record`, 13.6k chars); the second API call is +3.7k tokens (median 46,927 vs 43,177). Only 25 distinct Charlotte tools are ever called.

`--allowedTools` is a pre-approval list, not a restriction (`claude --help`: "tool names to allow"). The sessions show it: 11 `Bash` and 1 `Read` calls happened with neither in the list (`Read` returned 59.6k chars from a persisted tool-result file in session `9ffea8ec`; `Bash` ran `mkdir` that the runner already does, and `sleep 12` in `481f6007`). `tool-policy.ts:1-12` describes the allow list as a gate that removes tools; for built-ins it is not.

Fixed-prefix share of spend: the first-turn tokens are re-read on every call (median 33 turns). Prefix reads are 61% of all per-call input tokens; priced at observed rates the prefix is about $70 of $148.77 (reads about $51, first-turn writes about $19).

## 2. Tool calls and bulky outputs

Median 33 tool calls per scenario (mean 35.5, p90 55). Result tokens use 0.375 tokens/char, calibrated on 11,180 single-result turns (usage delta between consecutive calls). "Weighted $" = tokens x ($2 write + $0.1 x turns remaining) per M at Haiku 4.5 rates; it covers only tool results ($42.05 of $148.77).

| Tool | Calls | Median/scn | Result tokens | Share | Weighted $ | Tokens/call |
|---|---|---|---|---|---|---|
| wait_for | 1,550 | 4 | 3.98M | 35.9% | 15.98 | 2,567 |
| click | 1,001 | 2 | 2.62M | 23.7% | 9.30 | 2,618 |
| observe | 703 | 2 | 1.41M | 12.7% | 5.25 | 2,005 |
| type | 614 | 0 | 1.31M | 11.9% | 4.89 | 2,137 |
| navigate | 788 | 2 | 0.35M | 3.1% | 1.59 | 441 |
| viewport | 205 | 0 | 0.36M | 3.3% | 1.18 | 1,769 |
| reload | 374 | 1 | 0.17M | 1.5% | 0.78 | 458 |
| requests | 125 | 0 | 0.21M | 1.9% | 0.66 | 1,709 (max 37k chars) |
| evaluate | 4,190 | 10 | 0.16M | 1.5% | 0.63 | 39 |
| scroll | 49 | 0 | 0.12M | 1.1% | 0.41 | 2,414 (max 39.7k chars) |
| screenshot | 567 | 1 | 0.05M | 0.4% | 0.16 | 85 (path text) |
| console | 63 | 0 | 0.02M | 0.2% | n/a | about 385 |

Why the action tools are bulky (sampled every 4th session, 265 clicks, 345 wait_for, 146 type): the tool description says "Returns full page representation after the click". The JSON has `interactive` (median 30 elements, about 4.0-4.4k chars, 50-65% of each response), `delta` (click 2.5k chars, 31%; wait_for 1.7k, 21%; type 0.6k, 9%) and `structure` (1.0-1.2k). Charlotte source: `renderActivePage` defaults `detail = "summary"` (`~/charlotte/src/tools/tool-helpers.ts:96`), `renderAfterAction` attaches `delta` only when `snapshotStore.getLatest()` is non-null (`:208-224`), and snapshots are pushed only when `autoSnapshot` is `every_action`, or `observe_only` on observe (`:141-146`). The default is `every_action` (`~/charlotte/src/types/config.ts:17`), and run.ts's STEP 2 only passes `screenshot_dir` (`prompt.ts:245`). `charlotte_diff`, the only reader of the snapshot buffer besides `delta`, is called 0 times.

`observe`: the prompt says "Use charlotte_observe or charlotte_find after each step" (`prompt.ts:247`). 448 of 703 calls use `detail: "full"` (median 5.4k chars), 193 `summary` (4.9k), 30 `minimal` (1.2k). Lowering the detail would save little for `summary` and risks losing the page text the agent quotes; not proposed.

What the verdict rests on: after `wait_for` the next call is `evaluate` 27.5% of the time, `observe` 7.8%. Agents read `[data-testid]` values with single-line `evaluate` probes, as `PROBE_RULES` instructs (`prompt.ts:13-31`). The action responses are mostly unread context that is re-read about 33 times.

## 3. Failure modes (2026-10-16 to 2026-11-01)

374 results: PASS 264, FAIL 51, ERROR 59. Contract violations: 18, all `causal-language`. FAIL class is hand-labelled from the first failing step's observations (`/tmp/cr/fails.txt`, 51 entries), not traced to product code: treat as sampled labels, unverified against code.

| Class | Count | Evidence (run dir / scenario) |
|---|---|---|
| Harness setup ERROR, no session spawned | 56 | `Setup failed: loginAsOperator(...) pending/verify -> 401 PENDING_2FA_INVALID` x45, all on 2026-10-28; `no email OTP appeared` x9 (7+2, mostly 2026-10-16); 429 on `pending/email/enroll` x1; `detectGap` x1 |
| Harness-class FAIL (agent session spawned) | 18 | operator `AUTH_FAIL:NO_SESSION` / `PENDING_2FA_INVALID` (`2026-10-28T07-16-11` Campaign lifecycle, Operations Command Center, RG enforcement; `2026-10-28T12-06-33` x3); player `SESSION_MISSING` / 401 after `AUTH_OK` (`2026-10-16T18-43-41`, `2026-10-17T04-34-03`, `2026-10-17T08-43-11`); `REFRESH_FAIL:503 name resolution failed` (`2026-10-17T14-41-30`); crash round never opens, button stays "Betting closed" x4 (`2026-10-27T18-34-53`, `2026-10-27T18-37-53`, `2026-10-28T23-06-02` x2); TOTP/credential state x2 |
| Product or spec defect | 18 | `POST /auth/2fa/verify 400 Unrecognized key 'useBackupCode'` (`2026-10-16T17-38-43`); `bonuses-page` testid absent (`2026-10-28T07-16-11`, `10-47-38`); `wagering-calculator-no-req` shown (x2); deposit amount=0 message "Amount must be positive" vs spec "Enter a valid amount" (x2, spec drift); `float-sparkline` svg absent (`2026-10-22T09-40-22`); "No RTP data available" (`2026-10-28T14-06-47`); others |
| Real-time race, crash game vs agent turn latency | 10 | multiplier read "1.00x" (`2026-10-24T03-30-27`, `2026-10-28T07-16-11`); betting window closed during resize (x3); `crash-cancel-bet-btn` 5s wait timeout (x3); request-rate window miscounted (x2) |
| Agent mistake | 4 | `.value` write on a React input despite the rule at `prompt.ts:25-27` (`2026-10-28T23-06-02` RG deposit limit); DOM `id` used as `element_id` (`2026-10-28T23-06-02` auto-cashout); `button.click()` via `evaluate` (`2026-10-29T04-52-52`); Promise-sleep in `wait_for` returned after 4.3s of 10s |
| Agent-output ERROR | 3 | no `---RESULT---` block x2 (stdout "E2E test execution complete" and "Select didn't change. Let me reset..."), status `PARTIAL` x1 |
| Unclassified | 1 | "Withdrawal form: boundary value analysis" FAIL with no failing step recorded (`2026-10-28T07-16-11`) |
| TIMEOUT / LIMIT_ABORTED | 0 | none in this window |

Reading: 74 of 110 non-PASS (67%) are harness. They are concentrated: 2026-10-28 has 195 of the 374 results and 74 of the 110 non-PASS (45 setup 401, 27 FAIL, 2 ERROR). The spawn flags cannot fix this class; it is the largest quality lever and sits in `runner/auth.ts` / `operator-email-otp.ts` (pending-token expiry under parallel buckets is the pattern in the error text; cause unverified, probe: replay one 10-28 run with `--buckets 1`). Agent mistakes are 4 of 51 FAILs (8%), so a prompt-text quality change has a small ceiling. The 10 race failures are a scenario-design issue (5-second windows against 5-10 second agent turns); `Bash sleep` is the agent's own workaround for timers (`481f6007`), which is why C2 keeps `Bash`.

## 4. Model and cost

`run.ts:294` hard-codes `claude-haiku-4-5-20251001`; project CLAUDE.md says aliases only. Logged model on all 12,021 calls: `claude-haiku-4-5-20251001`. The alias `haiku` resolves to `claude-haiku-5-5` on the installed CLI 2.1.304: 144 of 193 rows in `~/ab-eval/results/runs.jsonl` have `result_model_keys = ['claude-haiku-5-5']` for `--model haiku` (`ab_run.py:87`). So the pin is both a rule violation and a stale model.

Tokens in the window: fresh input 97.6k, cache read 812.4M, cache creation 25.04M (all 1h), output 3.47M. Per-call prompt: median 64.9k, p90 97.2k, max 166.9k; 8.75% of calls exceed 100k; per-session max-context median 85.8k, p90 130.3k. Median spend per session $0.39.

Cache multipliers assumed (not on the pricing page you quoted): read 0.1x, 5m write 1.25x, 1h write 2x of input price, both models (`research/01-SESSION-ANALYSIS.md:7` uses 1 : 1.25 : 0.1 : 5).

| | Fresh in | Cache read | Cache write | Output | Total |
|---|---|---|---|---|---|
| Haiku 4.5 ($1 / $5), 1h writes as logged | 0.10 | 81.24 | 50.09 | 17.35 | **$148.77** |
| Haiku 4.5, writes as 5m | | | | | $129.99 |
| Haiku 5.5 ($0.10 / $0.50 up to 100k prompt, $0.50 / $2.50 above), 1h writes | | | | | **$22.56** |
| Haiku 5.5, writes as 5m | | | | | $19.96 |

Difference: -$126.21 (-85%) on the logged basis; -$110.03 (-85%) on the 5m basis. Savings from C stack on top (they act on token counts, not price).

Quality evidence for Charlotte on Haiku 5.5: **none; unverified.** Weak adjacent evidence: PROBES S9 had a Haiku 5.5 subagent drive `charlotte_dev_serve`/navigate under the harness ("PASS after fallback"); `research/04-BEST-PRACTICES.md:56` lists Haiku 5.5 early-stop and "claims done without running a check" failure modes, which are exactly the 3 agent-output ERRORs seen on 4.5. Settling probe: M1 A/B below.

## 5. Candidate C (at most 3 changes, each tied to a finding)

| # | Change | Finding | Est. effect |
|---|---|---|---|
| C1 | env `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; flag `--disable-slash-commands` | 18.4k of 43k first-turn tokens are CLAUDE.md, rules, MEMORY, auto-memory section, skill listing; nothing in `prompt.ts` references them | first turn -18.4k (-43%); about $0.098/session (tokens x ($2 + 33 x $0.1)/M) = **about -$34** per 348 sessions |
| C2 | extend the denied set (via the existing `buildToolArgs`) with `Agent,Skill,Edit,Write,NotebookEdit,WebFetch,WebSearch`; keep `Bash` and `Read` | 0 calls to any of them in 12,360; `Bash` kept because `sleep` is a real timer workaround (`481f6007`) and the one `Read` was a persisted-output read | agent listing -3.5k tokens if dropped with the Agent tool, plus those tools' definitions (unmeasured): **at least -$6**; probe-gated |
| C3 | STEP 2 prompt text: `charlotte_configure` with `auto_snapshot: "manual"` | `delta` is 21-31% of `click`/`wait_for` responses; 0 `charlotte_diff` calls; snapshots, hence `delta`, exist only under `every_action` (`tool-helpers.ts:141-146,208-224`) | -1.76M of 11.07M result tokens (-16%), weighted **about -$6.7** |

Expected: first turn about 43.2k to 21-25k (ratio 0.49-0.57 against the 0.75 G6 bar, `DESIGN.md` §6); spend -$40 to -$47 (-27% to -32%) on Haiku 4.5 (about 14% less after today's 5m-cache commit lowers the per-token write price). Unchanged by C: the `---RESULT---` JSON schema, the OBSERVATION CONTRACT, STEP A-E, `operatorAuthInjectScript` and the D2 TOTP form step (`totp.ts:58`). Output stays on Haiku 4.5 so the A/B isolates C from the model.

Not verified, each named with its probe:
- C1 env vars: the names exist in the CLI binary (`strings` on `claude.exe` 2.1.304); behaviour not run. Probe: one `claude --print "ok"` per arm from `apps/e2e-charlotte`, compare `instructions` attachments in the transcript (precedent: `omitClaudeMd` took H1 first turn 24.8k to 4.3k, `RUNNER.md:109`, PROBES S13). Fallback if the env is ignored: `--agents` JSON runner agent with `"omitClaudeMd": true` and `--agent`.
- C2: that `--disallowedTools` removes built-in tool definitions and the agent listing from the request. Probe: compare `first_turn_tok` and the `agent_listing_delta` attachment. If it does not shrink the prefix, drop C2.
- C3: that no step needs `delta`. Probe: Q3 verdict agreement.

```diff
--- a/apps/e2e-charlotte/runner/run.ts
+++ b/apps/e2e-charlotte/runner/run.ts
@@ const cmd = new Deno.Command("claude", {
   args: [
     "--model",
     "claude-haiku-4-5-20251001",
-    ...buildToolArgs(policy),
+    ...buildToolArgs({
+      allowed: policy.allowed,
+      denied: [...policy.denied, ...LEAN_DENIED_BUILTINS],
+    }),
+    "--disable-slash-commands",
     "--print",
     prompt,
   ],
@@
     ...rest,
     CHARLOTTE_SCREENSHOT_DIR: screenshotDir,
     FORCE_PROMPT_CACHING_5M: "1",
+    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
+    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
   }))(
@@ (module scope, with the other consts)
+// Built-ins no scenario session has ever called (0 of 12,360, 2026-10-16..11-01); Bash/Read stay.
+const LEAN_DENIED_BUILTINS = [
+  "Agent", "Skill", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch",
+] as const;

--- a/apps/e2e-charlotte/runner/prompt.ts
+++ b/apps/e2e-charlotte/runner/prompt.ts
@@ buildPrompt, RULES block (line 245)
-- STEP 2: call charlotte_configure with screenshot_dir: "${screenshotDir}"${...}
+- STEP 2: call charlotte_configure with screenshot_dir: "${screenshotDir}", auto_snapshot: "manual"${...}
```

Test impact: `grep "STEP 2" prompt.test.ts` finds no pin (run `deno test runner/prompt.test.ts` to confirm); `tool-policy.test.ts` is unaffected because `buildToolArgs` and `resolveToolPolicy` are not changed. `LEAN_DENIED_BUILTINS` must not intersect `AUTH_SETUP_REQUIRED_TOOLS` (it does not; those are Charlotte tools).

### Candidate M1 (model, separate, not part of C)

```diff
-      "claude-haiku-4-5-20251001",
+      "haiku",
```
Alias per CLAUDE.md; resolves to `claude-haiku-5-5` on CLI 2.1.304. Cost -85% (section 4). Ship only after the M1 A/B passes; run it on arm A flags (current spawn) so it is independent of C. Risk named in `research/04-BEST-PRACTICES.md:56`: early stop and unverified "done". Watch the agent-output ERROR rate (3 of 374 now) and the `---RESULT---` presence.

## 6. How to A/B it cheaply

**Q1/Q2 cannot test C or M1.** (a) They run `gsd-charlotte-qa` as a subagent of a dispatcher (`ab_roles.py:28`, `ab_run.py:87-91`: `--agents`, `--setting-sources project,local`, `--strict-mcp-config`), so the prefix is the harness's and the run.ts spawn flags, env and prompt never reach the session. (b) They grade recall of seeded defects F1-F6 / U1-U3 from a free-text report (`ab_match`), not per-assertion PASS/FAIL in the `---RESULT---` contract. (c) The agent's tool list is fixed by its definition, not by `--disallowedTools`. (d) `DESIGN-ALL-AGENTS.md:126` gates them on the exp-02 screenshot fix, and `~/ab-eval/results/runs.jsonl` has no Q rows yet. What Q1/Q2 would tell you: whether a Haiku 5.5 charlotte-qa subagent finds the same seeded defects as on 4.5, a weak proxy for M1 only.

**What tests it: Q3, a runner-contract task on the same seeded fixture** (new task entry, no edits to `~/igaming-platform`; all files under `~/ab-eval/` or `/tmp`):

1. Serve fixtures: `python3 -m http.server 8765 --directory ~/get-shit-done/scripts/ab-eval/fixtures/qa-app-seeded` and the clean control `~/ab-eval/harness/fixtures/qa-app` on 8766.
2. Two `ScenarioData` objects (no `auth`, so STEP A-E is absent; auth/TOTP is covered by the unchanged `prompt.test.ts` and by a separate one-scenario operator smoke when the stack is up):
   - S-seeded (port 8765): 9 assertions worded as correct behaviour. Ground truth from `examples/artifacts/Q/defects.json`: F1 wishlist feedback, F2 no console error on catalog, F3 contact submit succeeds, F4 email field has a label, F5 empty-state message on no match, F6 no horizontal overflow at 375px, expected FAIL x6; plus 3 controls expected PASS (page title non-empty, catalog lists items, contact form has a submit button).
   - S-clean (port 8766): same wording, expected PASS x9. Guards false FAILs.
3. A 10-line Deno script imports `buildPrompt` from `runner/prompt.ts` (read-only import) and writes the two prompts to `.tmp`.
4. Arms run with exactly run.ts's argv from `cwd = apps/e2e-charlotte` (CLAUDE.md discovery must match production): arm A = current args/env; arm B = A plus the C diff (`--output-format stream-json --verbose` added to both for usage logging). Charlotte from the user-level MCP config in both arms. 3 reps x 2 scenarios x 2 arms = 12 sessions.
5. Metrics per run: per-assertion verdict vs truth parsed from `---RESULT---`; JSON valid; `causal-language` violations (`runner/causal-language.ts`); `first_turn_tok` (`ab_transcript.py`); total usage priced as in section 4; API turns; wall.
6. Gates, adapted from `DESIGN-ALL-AGENTS.md:126` (G3') and `DESIGN.md` §6 (G6): B correct assertions >= A - 2 summed over 54 per arm; B false FAIL on S-clean <= A + 1; JSON valid 6/6; B median first turn <= 0.75 x A (expected about 0.5); report cost ratio. Per-change attribution if B fails: rerun with C1 only, then C1+C2.
7. Cost: fixture sessions are short (about 15 calls), so under the $0.39 production median: about $4-5 for the 12 sessions, plus about $0.4 per 6 extra for M1.
8. M1: arm A (current spawn) vs arm M (A with `--model haiku`), same 12-session design, reusing arm A rows; gate: correct >= A - 2, JSON valid 6/6, no new ERROR class; cost ratio expected about 0.15.

Order: probe C1/C2 with the two one-shot `claude --print "ok"` calls first (about $0.05), then Q3 for C, then Q3 for M1. Q3 only covers 9 assertions on static pages: it cannot see real-time crash scenarios or operator TOTP; those need one production run per arm on a small bucket after Q3 passes, using the 28 results of the last three days (27 PASS, 1 FAIL) as the comparison set.
