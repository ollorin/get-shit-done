# Stack lessons (17)

**reference_supabase_cli_npx_not_brew**
Run the repo-pinned `npx supabase` (2.118.0); the brew 2.78.1 binary rejects `local_smtp` in config.toml, so `functions serve` fails to start.
Pointer: reference_supabase_cli_npx_not_brew

**reference_new_schema_checklist**
A new non-public schema needs config.toml entries, a grants migration, and `.schema()`-qualified RPC calls; skipping any one gives 42501/42883.
Pointer: reference_new_schema_checklist

**reference_common_pitfalls**
RPC keyword args must match the DB function signature exactly, and non-public schemas are reached through public views because PostgREST blocks `.schema()`.
Pointer: reference_common_pitfalls

**bug_view_recreation_drops_grants**
`CREATE OR REPLACE VIEW` silently drops Postgres grants; any migration that recreates a public view must re-GRANT to service_role in the same file.
Pointer: bug_view_recreation_drops_grants

**bug_nx_functions_serve_buffer_crash**
`nx start:functions` buffers output and dies after ~21h (RangeError), leaving `/functions/v1` at 503; run `supabase functions serve` directly.
Pointer: bug_nx_functions_serve_buffer_crash

**feedback_editor_diagnostics_unreliable_for_deno**
IDE TypeScript diagnostics cannot resolve Deno imports, so run `deno check` before relaying any "type error" in apps/api.
Pointer: feedback_editor_diagnostics_unreliable_for_deno

**reference_docker_runtime_orbstack_vs_colima**
OrbStack is the Docker runtime; a silently flipped `docker context` made every DB call hang, so confirm `orbstack` is the active context before trusting a result.
Pointer: reference_docker_runtime_orbstack_vs_colima

**reference_orbstack_restart_docker_machine**
Only a full `orbctl stop` then `orbctl start` shrinks swap; `orbctl restart docker` alone does not.
Pointer: reference_orbstack_restart_docker_machine

**reference_zg_index_refresh**
`zg query` reads a snapshot that nothing refreshes; run `zg index` (incremental, ~10s) before relying on it in a long run.
Pointer: reference_zg_index_refresh

**reference_charlotte_fork**
Charlotte fixes belong in the home-folder fork, but the live MCP runs a separate consumed clone, so a rebuild alone does not reach it.
Pointer: reference_charlotte_fork

**project_full_charlotte_deferred_to_milestone_end**
The full Charlotte regression runs once at milestone end; VERIFICATION records it as deferred, never as passed.
Pointer: project_full_charlotte_deferred_to_milestone_end

**reference_gsd_tools_known_bugs**
gsd-tools checks misreport on decimal (inserted) phases and on Deno `assertEquals` tests; verify against `git log` and the real files.
Pointer: reference_gsd_tools_known_bugs

**reference_gsd_fork_rollout**
Author GSD changes in the fork and roll out with `npm run install:gsd`; never `/gsd:update`, which can pull upstream and overwrite the fork.
Pointer: reference_gsd_fork_rollout

**reference_session_limit_supervisor**
GSD's session-limit wait loop is prose; only `scripts/session-supervisor.sh`, an OS process outside the session, survives a limit.
Pointer: reference_session_limit_supervisor

**bug_db_reset_drops_edge_serve**
Commits touching apps/api/functions or libs recreate the edge container within ~8s and void other lanes' live runs.
Pointer: bug_db_reset_drops_edge_serve

**reference_ci_integration_setup**
CI edge functions need every secret, env var and the import map passed explicitly; `supabase start` serves functions, so no separate serve process is needed.
Pointer: reference_ci_integration_setup

**reference_host_memory_pressure_test_concurrency**
A deno test stuck at near-zero CPU is either memory starvation or a dead Docker context (check `lsof` for SYN_SENT); a scattered full-bucket failure is often pg_cron interference, so re-run the file in isolation first.
Pointer: reference_host_memory_pressure_test_concurrency
