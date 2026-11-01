Docs-updater did not commit. The edit to `docs/authentication.md` is written and staged, but the pre-commit `validate:links` hook failed on 7 broken links in files outside this change.

```
written_files: [/Users/ollorin/ab-eval/runs/DU1-A-r1-20261101-021647-1eaee8/repo/docs/authentication.md]
commit: none
errors: [pre-commit validate:links failed on 7 broken links in files outside this change: docs/api/endpoints/games.md:459, docs/api/endpoints/games.md:537, docs/development/ci-drift-proofing.md:127, docs/game-engine/games/pvp-arena.md:1757, docs/game-engine/games/pvp-arena.md:1759, docs/migrations/kyc-aml-schema.md:324, docs/migrations/kyc-aml-schema.md:340 (all point at .planning/ THREAT-MODEL/SUMMARY files that do not exist); docs/authentication.md has no broken links; --no-verify not used]
```

**Edit (docs/authentication.md, `POST /auth/2fa/verify` section only):**
- Request `method` enum corrected to `"totp" | "sms" | "email"`. `backup_code` is not a `TwoFactorMethodType` (`apps/api/libs/infrastructure/src/lib/services/two-factor-service.interface.ts:13`). Backup codes are only tried when `method` is omitted.
- New "Method gating" paragraph and a 3-row result table:
  - Method not enabled, including a disabled TOTP row: `AUTH_007` (400). Refused by `two-factor-login-rule.ts:29` (`selectLoginVerification`), reached from `login-verify.ts:127` and `two-factor-service-impl.ts:167`.
  - Wrong or expired code: `AUTH_007`.
  - Status read, provider or backup-code fault: `AUTH_900` (500), at `login-verify.ts:43`.
- Enrolment paragraph: providers run with `mode: 'login'` (`login-verify.ts:34`), and their setup branches are gated at `totp-provider.ts:205`, `email-provider.ts:372` and `sms-provider.ts:357`. Enrolment completes only via `facade.verify(..., {mode:'enrol'})` (`facade.ts:197`). No route completes email/SMS enrolment (`apps/api/functions/auth/index.ts:696-735`, cited from the SUMMARY, not re-read).
- Backup codes only when TOTP is enabled: `two-factor-login-rule.ts:38`.

**Not verified or left alone:**
- The step-up requirement on enrolment is not in the source the subagent read, so it is not documented.
- The existing `400 Invalid code, too many attempts` and `401 Invalid pending session token` bullets are unchanged and unverified. The 400 bullet conflicts with the "Guess caps" text in the 2FA Login Flow section, which says a refused guess returns `AUTH_001`.

**To finish:** fix or exclude the 7 broken links in the other files, then run `git commit -- docs/authentication.md` with the `Co-Authored-By: Claude Haiku 5.5` trailer. The subagent reports the index holds only this file.