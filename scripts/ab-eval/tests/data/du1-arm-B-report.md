## Docs Update Result

written_files: [/Users/ollorin/ab-eval/runs/DU1-B-r1-20261101-021819-85ffef/repo/docs/authentication.md]
commit: none
errors: [
"git commit blocked by .git/hooks/pre-commit step 5 (validate:links). The validator reports 7 broken links in other docs (docs/api/endpoints/games.md, docs/development/ci-drift-proofing.md, docs/game-engine/games/pvp-arena.md, docs/migrations/kyc-aml-schema.md). None are in docs/authentication.md. The change is left uncommitted in the working tree. I did not use --no-verify.",
"SUMMARY commit range 9359361d3..f107b6d43 does not resolve in this repo (HEAD is cff4c8d). The doc was written from the current source; the line numbers cited were checked by grep and read in the files."
]

**Build scope:** api_change (path classification: `apps/api/...`). The write was limited to the 2FA section of docs/authentication.md, as requested.
**Docs style:** match_existing

The change is one insertion (+23 lines) in the `### 2FA Login Flow` section, before the "Status disclosure" paragraph. It has a verify-behaviour table (AUTH_007 for refused methods, backup codes gated on TOTP, AUTH_900 for faults) and a paragraph on login mode. Every cited line was checked against the source: `login-verify.ts:34`/`:127`, `two-factor-service-impl.ts:167`/`:216`, `totp-provider.ts:205`, `email-provider.ts:372`, `sms-provider.ts:357`, `facade.ts:197`, and `two-factor-login-rule.ts:27-39`. The commit is pending: rerun `git commit -- docs/authentication.md` once the broken links in the other docs are fixed, or commit with the hook bypassed if that is acceptable to you.