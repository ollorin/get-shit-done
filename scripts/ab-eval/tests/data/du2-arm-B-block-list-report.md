## Docs Update Result

written_files:
- /Users/ollorin/ab-eval/runs/DU2-B-r1-20261101-024159-4bcb3b/repo/docs/wallet/currency-attributes.md
- /Users/ollorin/ab-eval/runs/DU2-B-r1-20261101-024159-4bcb3b/repo/docs/game-engine/games/pvp-arena.md
- /Users/ollorin/ab-eval/runs/DU2-B-r1-20261101-024159-4bcb3b/repo/docs/architecture/decisions.md

commit: 1cbfd8e

errors:
- Commit was made with `git commit -m ... -- <paths>` on the three doc paths. The pre-commit hook ran and the commit succeeded, but the hook's output was too large to read in full, so I did not confirm its individual checks.
- The Bash hook denied several commands with "path outside the run snapshot". The cause was `../` in a doc link and a `cd` in one command. I retried with relative paths and a root-relative link (`/docs/wallet/currency-attributes.md`), and the appends then went through. The commit landed with a clean tree.
- Not written: `.claude/rules/database.md` (the proposed NaN rule line from SUMMARY deviation 6) is under `.claude/`, which is outside the allowed write scope. The NaN rule is documented in `currency-attributes.md` instead.

**Build scope:** architecture

The SUMMARY has no Files Modified section, so scope came from the text. The migration keyword matched and no api, component, or refactoring path matched. I used `architecture` and did not add a CHANGELOG line.

**Docs style:** match_existing

### What changed

- **`docs/wallet/currency-attributes.md`**: appended `### Phase 400-12 additions`.
  - A table of the input guards on `wallet_create_reversal` and `wallet_credit_settlement_pair`, with `file:line` cites from `20261018140000_400_wallet_ledger_input_guards.sql`.
  - A "NaN CHECK rule" subsection covering the nine constraints in migration 1 (`:26-50`) and the 43 more in `20261018140100`, 52 validated in total.
- **`docs/game-engine/games/pvp-arena.md`**: appended `### Phase 400-12 additions`. It states that the existing note saying `wallet_credit_settlement_pair` has no non-object metadata guard is superseded. It also covers `INVALID_SETTLEMENT_METADATA` (`:428`, `:434`, `:459`) and leg `funding_source` precedence (`:481-482`, `:505-506`).
- **`docs/architecture/decisions.md`**: added `## Phase 400-12: House-funded reversals write a row and move no cash`, dated 2026-11-01. This follows the architecture rule and the SUMMARY's R11 decision.

I did not change the existing content of any doc.