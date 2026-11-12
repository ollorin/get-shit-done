# Project Memory - iGaming Platform

## User
- [the owner managing AI-only development](user_role_ceo_cpo.md) — All dev done by Claude agents via GSD workflows; user sets vision/requirements, never writes code

## Reference
- [Session-limit supervisor + GSD_AUTONOMOUS](reference_session_limit_supervisor.md) — GSD's documented wait-until-reset loop is PROSE not code; only `scripts/session-supervisor.sh` (an OS process) survives a session limit; unattended launch incantation
- [GSD fork rollout mechanism](reference_gsd_fork_rollout.md) — author in `~/get-shit-done`, roll out via `npm run install:gsd` (local installer), NOT `/gsd:update` (may pull upstream, clobbers fork)
- [Charlotte is a user-owned fork](reference_charlotte_fork.md) — source at `~/charlotte` (<private-repo>), home folder beside GSD; same fork discipline (never clobber/pull upstream); fixes go in the fork, not the consuming repo — relevant to Phase 290
- [CI integration-test setup](reference_ci_integration_setup.md) — Edge Functions in CI need every secret passed explicitly (AUTH_HMAC_SECRET, UPSTASH_REDIS_*, ENCRYPTION_KEY, NODE_ENV/DENO_ENV/ALLOWED_ORIGINS); workspace imports need import_map.json; use `supabase start`, not `functions serve`
- [MSW mock handler contract — custom auth API](reference_msw_custom_auth_contract.md) — Custom auth Edge Functions return a FLAT response shape, never Supabase's native `{session:{access_token}}` nesting
- [Common backend pitfalls](reference_common_pitfalls.md) — RPC keyword args must match DB function signature exactly; use public views (INSTEAD OF triggers), never `.schema()`, for non-public schemas
- [Testing strategy](reference_testing_strategy.md) — unit + API integration tests run in CI; UI E2E is local-only (flaky/slow); `scripts/preflight.sh` is now the canonical pre-PR gate
- [New PostgreSQL schema 3-step checklist](reference_new_schema_checklist.md) — config.toml + grants migration + `.schema()`-qualified RPC calls, or 42501/42883 errors
- [Email provider: AWS SES, not Resend/Postmark](reference_email_provider_ses_aup.md) — Resend AND Postmark ban gambling in their AUPs; production email is AWS SES behind a swappable EmailPort (Resend kept as secondary); market-generic region config
- [Docker runtime: OrbStack default, colima degraded fallback](reference_docker_runtime_orbstack_vs_colima.md) — colima structurally can't run vector/logflare (virtiofs socket limitation); always verify `docker context ls` shows orbstack active before trusting local E2E results
- [gsd-tools.js known bugs](reference_gsd_tools_known_bugs.md) — ROADMAP summary-row corruption FIXED 2026-10-02; `verify test-content` false-flags Deno's assertEquals as hollow; VERIFICATION.md must be `{N}-VERIFICATION.md`; `verify phase-gate`'s testRequired regex false-positives on tdd-absence prose; decimal/inserted phases (e.g. 368.1) get mass false `claimed_file_not_in_diff` warnings — spot-check git log/show directly
- [Full-bucket test-run instability: 4 root causes](reference_host_memory_pressure_test_concurrency.md) — memory pressure (hang, fix `MAX_CONCURRENT_BUCKETS=2`), colima/docker context (hang, check `lsof` for stuck `SYN_SENT`), pg_cron job races (scattered failures across unrelated files, not a hang — re-run failing files in isolation before assuming regression)
- [GSD false gate-pass, same-phase parallelism corruption, rate-limit death](bug_gsd_false_gate_pass_under_resume.md) — trust only on-disk artifacts, never an agent's self-report; resume/instruct the agent, don't run/poll it yourself; NEVER run 2 executors in parallel within one phase (TASK-CHECKPOINT.json collision, now a CLAUDE.md rule); a session-rate-limit death leaves agents unresumable — dispatch a fresh coordinator scoped as death-resume

- [Killing a wait shell revives its agent](bug_killing_wait_shell_revives_agent.md) — TaskStop the owning agent BEFORE killing its `until` wait shell, or it wakes and resumes stale stack mutations
- [nx functions-serve buffer crash](bug_nx_functions_serve_buffer_crash.md) — `nx start:functions` dies after ~21h (RangeError) → edge 503 voids live runs; run `supabase functions serve` directly
- [Supabase CLI: npx 2.118.0, not brew](reference_supabase_cli_npx_not_brew.md) — brew 2.78.1 rejects config.toml local_smtp so `functions serve` fails; crash-worker-cron-kills-serve theory did NOT reproduce
- [Redis mock divergence class](bug_redis_mock_divergence_class.md) — MockRedisClient ≠ real Upstash (RESP ints, raw strings, Lua ARGV); hid 3 prod login breaks; Lua/encoding changes need real-Redis integration tests

## Feedback
- [E2E: additive, never replace](feedback_e2e_additive_never_replace.md) — new test suites run alongside old LLM Charlotte tests; retire old ones only after proven equal-or-better coverage + measured speed, keep a few for UI checks
- [Always latest model, Haiku tasks under 100k](feedback_always_latest_model_100k.md) — aliases only, never pinned IDs; plans must keep Haiku tasks under the 100k price threshold, verify against measured peaks
- [Be concise, token-conscious](feedback_be_concise_token_budget.md) — short status updates, no padded prose; corrected twice in one session
- [Model tiering: Opus plans/verifies, Sonnet coordinates+reviews, Haiku implements](feedback_use_fable_for_game_ui.md) — Opus: decomposed plans, phase verifier, milestone audit, high-stakes; Sonnet: ALL coordinators + first reviewer; Haiku (alias, no hard-coded ID): test runner + default implementer, Sonnet only after 2 Haiku failures/ambiguity/unclear RCA/architecture; no Opus forks for lower-tier work; never an all-Opus batch; Fable not used
- [Never skip pre-PR quality gates](feedback_never_skip_quality_gates.md) — MUST run integration tests, Charlotte E2E, full check suite TWICE before any PR
- [v0.1.9 Post-Mortem](feedback_v019_postmortem.md) — Cross-phase checks unconditional, Charlotte QA non-negotiable for UI phases, cross-layer type validation mandatory, docs mandatory at milestone end
- [CI import map THREE places](feedback_ci_import_map_three_places.md) — New @igaming/* imports must be added to import_map.json AND both CI workflow files (pr-validation.yml + deploy-staging.yml) — CI overwrites the repo import map
- [Zero Tolerance for Test Failures](feedback_zero_tolerance_tests.md) — ALL tests/lint must be 100% green every run. No "pre-existing" exceptions.
- [Fix all findings, no blind defer](feedback_fix_all_findings_no_blind_defer.md) — every severity fixed in-phase (same-file batched, disjoint parallel); defer only Opus "no business value" rulings
- [Autonomous decisions: Haiku details → Opus direction](feedback_autonomous_haiku_details_fable_direction.md) — during autonomous roadmap runs, resolve questions via Haiku fact-gather + Opus recommendation; escalate only strategic/irreversible calls to the owner
- [Don't run/poll work yourself — delegate to agents](feedback_dont_overspawn_subagents.md) — one gsd-phase-coordinator per phase, don't reach into nested executors unless confirmed dead; TIGHTENED 2026-09-11: never run/poll shell commands or edit code directly, even as a "gap-fill" — resume/instruct the agent to do it and return a real result
- [Never SendMessage a handed-back coordinator](feedback_no_sendmessage_to_handed_back_coordinator.md) — it resumes and runs in parallel with its replacement (duplicate executors, Phase 384); TaskStop it, brief the new one
- [Decide fixes autonomously](feedback_decide_fixes_autonomously.md) — owner 2026-09-27: never ask whether to fix/fold/grant; decide (Opus for high-stakes) and report; ask only for harness-blocked, irreversible, or business/legal policy
- [No unapproved stack/history commands](feedback_no_unapproved_stack_or_history_commands.md) — docker stop/git rebase route via main for owner approval; db reset needs NO approval since 2026-10-01, only a peer check that no test is running
- [No OS-prompt-blocking commands unattended](feedback_no_os_prompt_blocking_commands.md) — keychain/docker-pull dialogs hang unattended runs; check `docker images` first, explain + ask before any command that can raise a prompt
- [Keep 2 phases in flight](feedback_keep_two_phases_in_flight.md) — owner: always run 2 independent phases in parallel (3 if allowed); file claims in .tmp/phase-file-claims.md + peer check-in before db reset/preflight
- [Worktree phases while stack locked](feedback_worktree_phases_while_stack_locked.md) — other phases code-only in `.tmp/wt-<phase>` worktrees, one joint train; fix loops run affected tests once
- [Planners write PLAN.md only, never scripts](feedback_planners_write_plans_not_scripts.md) — checks become executor tasks producing real tests/guards; phase-dir scripts are specs to delete
- [Check settings before asking for permissions](feedback_check_settings_before_asking_permissions.md) — classifier denials are command shape (inline RATE_LIMIT_BYPASS etc.), not missing rules; run tests via `deno task test` / run-integration-tests.sh
- [Restart only below ~3Gi free](feedback_disk_threshold_5gi.md) — owner 2026-10-31: restart OrbStack/serve only when free disk < ~3Gi or docker/a bucket stalls; swap is never a trigger; one restart owner, serve always with the project.json:33-44 --env-file recipe
- [Protect .tmp/gsd-v2 from cleanup](feedback_protect_tmp_gsd_v2.md) — owner 2026-10-31: whole dir is never deleted; keep it in the cleanup NEVER-delete list and in the GSD fork cleanup rule
- [Editor diagnostics unreliable for Deno](feedback_editor_diagnostics_unreliable_for_deno.md) — run `deno check` before relaying an IDE "type error" in apps/api; IDE can't resolve @std/* so assert-narrowing looks broken

## Bugs
- [View recreation drops grants](bug_view_recreation_drops_grants.md) — CREATE OR REPLACE VIEW silently drops Postgres grants; migrations recreating public views MUST re-GRANT to service_role (real prod bug caught by preflight 2026-07-08)
- [2FA TOTP replay vuln (cross-isolate)](bug_2fa_totp_replay_cross_isolate.md) — verify() trusted per-isolate Redis pending-key → unchecked setup branch replayable; DB is source of truth (fixed 2026-07-09)

## Project Context
- [No production users yet (2026-09-23)](project_no_production_users.md) — security holes need only the code fix, no incident response (key rotation/password resets); re-check near launch
- [PVP-first launch strategy](project_pvp_first_launch_strategy.md) — launch PVP Arena first (not all 99 PRDs), generate revenue, fund the rest of the backlog + slots/crash buildout; default scoping question for any future work
- [Full Charlotte deferred to milestone end (2026-10-30)](project_full_charlotte_deferred_to_milestone_end.md) — no phase-end full regression in v0.1.34; one run at milestone completion (needs `claude setup-token`); VERIFICATION records it as deferred, never passed
- [Next milestone: code review first](project_next_milestone_code_review_first.md) — after v0.1.33, codebase-review-hardening runs before any feature milestone (no pre-hardening pass; plan as written)

- [GSD v2 overhaul (2026-10-31)](project_gsd_v2_overhaul.md) — 4 streams (measure, machine, slim GSD, Bladebro); v0.1.34 runs in parallel; UI tests stay LLM-driven; document every change in the GSD fork

## Project Audits
- [Full project audit July 2026](project_full_audit_2026_07.md) — audit reports, 8 improvement plans, 7 PRD drafts in .planning/audit/; portfolio "AUTHORED" labels unreliable, payments/KYC mocked
- [Market-generic platform mandate](platform_market_generic_mandate.md) — jurisdictions = pluggable config packs; never hardcode market/currency/provider in core; EXTENDED 2026-09-11: sweeps-vs-real-money wagering mode is also a config dimension on the existing settlement/ticket machinery, not a parallel architecture — general rule for any new monetization axis
- [v0.1.22 Follow-ups](project_v0122_followups.md) — deferred tech-debt: one security follow-up (see the private repo's tracker), deploy-production phantom-fail trigger, dead RATE_LIMIT_BYPASS
- [Claude config overhaul pending actions](project_claude_config_overhaul_pending.md) — credential rotation done; review stale GSD local patches before reapplying
- [Disk pressure on frontend waves](project_disk_pressure_frontend_waves.md) — long autonomous Wave-D+ build/test runs filled the host disk to ENOSPC (0-byte deadlock); clear .nx/.next/deno caches + check df before build-heavy phases; never git reset/clean during recovery (uncommitted work)
- [PRD hardening = verify + elevate](feedback_prd_hardening_means_improve.md) — hardening a PRD means trace-verify against code AND add killer, competitor-beating features around the owner's core ideas
- [Check ROADMAP before reassigning work](feedback_check_roadmap_before_reassigning.md) — a hand-off to a deferred phase is a silent deferral (NB6→388.1); also Docker outage = void results
- [No provenance tags in rules](feedback_no_attribution_tags_in_rules.md) — no "(owner <date>)" stamps in CLAUDE.md/rules/GSD; git history records that
- [Host cleanup + OrbStack restart procedure](reference_host_cleanup_procedure.md) — 30min tick / 2h cleanup / 3h OrbStack crons run as Haiku; never restart while any executor runs (lock looks free between steps); NEVER `supabase stop --no-backup`; swap eats disk
- [Haiku implements, Sonnet reviews, Opus once](feedback_sonnet_until_zero_then_opus.md) — Haiku implements; fresh Sonnet rounds: high-stakes to zero, others max 3; Opus only at mandatory points (money/auth plans, one batched diff review, phase verifier, rulings)
- [Permitted test command shapes](feedback_permitted_test_command_shapes.md) — run tests only as `deno task test <file>` / `deno test <file>` / `npx nx test`; no inline env, pipes, chains, bash -c; else owner approval prompt
- [zg index refresh](reference_zg_index_refresh.md) — zg index is never auto-refreshed; incremental ~10s; run it in the 30-min tick and before dispatching a phase coordinator
- [OrbStack full restart (VERIFIED)](reference_orbstack_restart_docker_machine.md) — `nx stop:dev api` → `orbctl stop` → `orbctl start` → serve directly; frees swap (7.6→33 GiB disk); `restart docker` alone does not
- [Edge recycles on apps/api writes](bug_db_reset_drops_edge_serve.md) — any commit/cherry-pick touching apps/api/functions|libs recreates the edge container in ~8 s and voids other lanes' live runs; --reset-db does not; detached --workdir restart form inside
- [Clean + restart before long runs](feedback_clean_and_restart_before_long_run.md) — owner 2026-11-07: kill leaked procs, drop closed worktrees, restart OrbStack (swap) BEFORE a long exclusive run, never mid-run
- [Fable replaces Opus during allowance](feedback_fable_replaces_opus_during_allowance.md) — owner 2026-11-10: Opus-tier dispatches (plans, rulings, batched review, phase verifier, audit) use model fable; fall back to opus if rejected
- [Targeted tests, one full preflight per phase](feedback_targeted_tests_one_full_preflight_per_phase.md) — targeted tests per plan, one full preflight per phase, twice-green at milestone end
- [No Telegram, notify in chat](feedback_no_telegram_notify_in_chat.md) — owner 2026-11-11: Track 1 ledger and Track 2 demo notices go to chat, not Telegram
