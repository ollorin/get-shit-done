---
name: reference_email_provider_ses_aup
description: Transactional email must use a provider whose AUP permits gambling — Resend AND Postmark both BAN it; production adapter is AWS SES behind a swappable EmailPort
metadata: 
  node_type: memory
  type: reference
  originSessionId: 57b0729a-6d9b-434e-9d90-dbd122a25489
---

**Vendor-compliance constraint (owner-decided 2026-07-23, Phase 288 / Wave E):** the platform is a
real-money gambling operation, so its transactional-email provider must not prohibit gambling. **Both
Resend and Postmark ban gambling in their Acceptable Use Policies** — using them live risks abrupt
account termination and an email outage (verification / password-reset / receipts) at the worst
possible time. Fable flagged this; the owner chose to build the AUP-compatible provider now.

**Decision:** production transactional-email adapter is **AWS SES** (SESv2 SDK), built behind a
swappable `EmailPort`/`EmailEventPort` in Phase 288. The already-built-and-integration-tested
**Resend** adapter (from Phases 250/251) is RETAINED as a swappable secondary, not ripped out — the
port makes provider choice a single-adapter change. SES delivery/bounce/complaint events arrive via
**SNS** (different shape from Resend's webhook), wired through the EmailEventPort. Region/config is
market-generic (no hardcoded region — per [[platform_market_generic_mandate]]). Built + integration-
tested against a SES simulator/sandbox so go-live is a credential swap, not a code change (consistent
with the platform's simulator doctrine).

**How to apply:** Do NOT set Resend (or Postmark, or any gambling-banning provider) as the production
email default — it's an AUP violation on a gambling platform. SES is the production default; keep the
port abstraction so any future provider swap is one adapter. SMS is deferred (dependent UI feature-
flagged off); 2FA stays TOTP (Phase 288 Q3, owner-decided). Relevant to Phase 288, launch readiness,
and any future notification/provider work.
