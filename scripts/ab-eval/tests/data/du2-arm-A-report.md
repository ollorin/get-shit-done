## Docs Update Result

written_files: `docs/wallet/currency-attributes.md`, `docs/game-engine/games/pvp-arena.md`
commit: 9c1e1bd
errors: none

**Build scope:** architecture (signal: "migration" in SUMMARY text; no api/route/component/page paths matched)
**Docs style:** match_existing

Changes, all traced to the migration or to the SUMMARY:

- **`docs/wallet/currency-attributes.md`**: new section "Ledger Input Guards (Phase 400-12)" covering:
  - NaN CHECK rule and the nine constraints (table, from `20261018140000_...sql:42-50`, precheck `:26-37`), plus the 43-column sweep in `20261018140100`.
  - `wallet_create_reversal` input guards: `p_type` allow-list (`:88-91`), balance_type dispatch (`:140`, `:246`, `:320-323`), bonus currency lock (`:160-169`), house-funded carve-out (`:255-297`).
  - `wallet_credit_settlement_pair` metadata object checks (`:427-437`, `:458-461`) and the leg-over-outer `funding_source` precedence (`:480-484`, `:504-508`).
- **`docs/game-engine/games/pvp-arena.md`**: the settlement merge formula now includes the `funding_source` re-assert term it was missing. The paragraph calling the non-object metadata defect open now says it is refused with `INVALID_SETTLEMENT_METADATA`.

Not changed, by design:
- `docs/api/endpoints/wallet.md`: its Database Layer table lists only endpoint RPCs, not the reversal and settlement RPCs.
- `docs/game-engine/error-codes.md`: has no wallet or settlement error codes, so there is no existing section for the new ones.
- `docs/architecture/decisions.md`: skipped because scope was limited to wallet and game-engine docs.
- `.claude/rules/database.md`: the SUMMARY's proposed NaN rule line belongs here, but rule files are outside this run's scope. It needs a separate rules update.

The pre-commit hook ran and passed without `--no-verify`. The commit used `git commit -- <paths>`, so only the two doc files were included.