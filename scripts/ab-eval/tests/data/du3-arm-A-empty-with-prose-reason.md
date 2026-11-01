Result from gsd-docs-updater (verbatim):

## Docs Update Result

written_files: []
commit: no-changes
errors: []

**Build scope:** `api_change` (SUMMARY paths include `apps/api/functions/games/handlers/pvp/*` and `apps/api/migrations/20261023210000_*`). The `refactoring` fallback does not apply.
**Docs style:** match_existing
**Reason no files were written:** every candidate location either already has the entry or does not follow a per-plan convention.

- `docs/game-engine/games/pvp-arena.md:909-939` already has the 400-41 section. I checked it against the migration: the cron job name `orphan-pvp-join-sweep` and the `*/5 * * * *` schedule match `20261023210000_400_orphan_pvp_join_debit_sweep.sql:391-397`. The section is accurate, so I left it alone.
- No pg_cron job inventory page exists. `docs/` only lists cron jobs inside domain pages (KYC, events, auth, crash). The PvP join sweep belongs in the PvP page, which already covers it.
- `docs/game-engine/crash-multiplayer.md:924-947` documents only the crash sweep (`orphan-bet-debit-sweep`, 400-29). It does not list other jobs, so no cross-link is needed.
- `game.sweep_round_stuck` has no standalone values list in `docs/`. Its `orphan_pvp_join` marker is covered in the PvP section.
- `CHANGELOG.md` `## Unreleased` has per-plan bullets for phase 384, but a grep for `Phase 400|400-2x|400-3x` returned no matches. Phase 400 did not add per-plan lines (400-29 has none either), so I did not add one.
- `docs/deployment/rollback.md` has a rollback scenario only for 20261023190000. Since no per-migration rollback entry exists for 400-29 (20261023180000) either, I did not add one for 400-41.

**Unverified (not in my scope, not changed):** `pvp-arena.md:938-939` cites `pairing-recovery.ts:62-68` for the drop-reason mapping. The subagent did not trace that line. The probe is to read `pairing-recovery.ts` around lines 62-68 and confirm the `internal_error` mapping.