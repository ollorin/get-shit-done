---
name: bug-view-recreation-drops-grants
description: Recurring bug class — CREATE OR REPLACE VIEW silently drops Postgres grants; migrations must re-GRANT to service_role
metadata: 
  node_type: memory
  type: project
  originSessionId: c05eab6b-762a-49b7-9221-9d52e888e5a8
---

Real production bug found 2026-07-08 by running the full preflight gate during the v0.1.21 release (clean `supabase db reset` exposed it; long-lived envs had grants applied historically so it was masked). Committed migrations were MISSING `service_role` GRANTs on public financial/games views — a fresh prod/CI deploy would fail integration tests with permission-denied (Postgres 42501) on core wallet/games/rules access.

**Root cause / bug class:** `CREATE OR REPLACE VIEW` (and DROP+recreate) SILENTLY DROPS all grants on that view in Postgres. Migration `20260207093605` recreated `public.games` without re-granting; views `wallet_transactions`, `player_balances`, `rules`, `game_assets`, `collections` never had grants committed at all. Fix: migration `20260707000100_fix_missing_public_view_grants.sql` with targeted re-GRANTs (NOT a blanket `GRANT ALL ON ALL TABLES` — that's a hack).

**How to apply / prevent recurrence:** Any migration that does `CREATE OR REPLACE VIEW` or DROP+recreate a public view MUST re-issue the view's GRANTs to `service_role` in the same migration. When reviewing DB migrations, grep the diff for view recreation and confirm a following GRANT. The platform accesses these public views via `service_role` (see [[project-full-audit-2026-07]] and `.claude/rules/database.md` schema-access pattern). This bug is invisible in long-lived local/staging DBs and only surfaces on a clean replay — so the preflight `db reset` gate is what catches it; do not bypass it.
