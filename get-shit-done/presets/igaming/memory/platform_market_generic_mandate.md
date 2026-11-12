---
name: platform-market-generic-mandate
description: "Owner mandate (2026-07-07) — platform is market-generic; jurisdictions are pluggable config packs, never hardcode a market"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c05eab6b-762a-49b7-9221-9d52e888e5a8
  modified: 2026-09-11T20:46:11.828Z
---

Owner decision (2026-07-07): the iGaming platform must be **market-generic**. Any regulated market must be addable as a configuration pack — jurisdiction descriptor binding geolocation rules, RTP floors, game availability, RG toolset, KYC/AML provider adapters, currencies, tax, and regulator export formats. Nigeria/Kenya (NGN/KES) are reference packs only, NOT the architecture.

**Why:** Earlier planning (audit 2026-07 wave) drifted into "Nigeria-first" hardcoding; the owner corrected it explicitly. Also: no legal entity exists yet, so real KYC/payment providers can't be contracted until incorporation. Updated owner decision (2026-07-07): build FULL internal payment/KYC/AML infrastructure end-to-end, integrated over the real wire with hosted test-provider SIMULATORS that genuinely process the platform's payloads (real HTTP/auth/HMAC webhooks/failure injection) but return mocked verdicts/settlements — go-live is an endpoint+credential swap. See `.planning/prds/pending/provider-simulation-environment.md`, `payment-rails-readiness.md`, `kyc-aml-infrastructure.md`.

**How to apply:** When writing/reviewing PRDs, plans, or code: reject market-specific hardcoding in core (currency literals, provider names, fixed AML thresholds, fixed RG limits). Everything compliance-related is per-jurisdiction configuration; providers are capability-based plug-in adapters. Acceptance test pattern: a fictional "Testland" pack must be addable with zero core code changes. See [[project-full-audit-2026-07]] and `.planning/prds/pending/jurisdiction-licensing-framework.md`.

**Reinforced 2026-07-22 (resolves the Phase-289 audit-scope tension):** the answer to "Africa-first vs US/EU" is **combination — the platform must be ready for ANY market with minimal per-market justification.** So Phase 289's T15 jurisdiction/compliance audit must audit against a COMBINED multi-market reference set (US + EU + Africa packs), proving genericity/config-pluggability, NOT pick one market. This is a settled owner directive — do not re-escalate it; drive 289 accordingly.

**Extended 2026-09-11 to wagering mode (sweeps vs. real-money):** when the owner proposed launching v1
as a US sweepstakes model (Gold Coins / Sweepstakes Coins dual-currency, to sidestep the missing
payment-processor contracts and App Store IAP real-money restrictions), he explicitly reapplied this
same mandate: **sweepstakes-vs-real-money must be a configuration dimension, not an architectural
fork.** Both modes reuse the existing settlement/wallet/ticket machinery; a market's config picks the
mode (e.g. `wagering_mode: 'real_money' | 'sweepstakes'`), same pattern as jurisdiction/currency/
provider config packs. Do not let any future PRD (e.g. a sweepstakes-currency PRD) design sweeps as a
parallel/replacement system for the shipped real-money ticket design — it must compose with it.
**General rule this confirms: whenever a new business-model or monetization axis is introduced on
this platform, ask whether it's actually a new config dimension on the existing architecture before
treating it as new architecture.**

**Game-generic too (owner 2026-09-25):** PVP Arena is the first consumer of shared infrastructure (tournaments, rewards, social, referral, RG), never the only one — game-specific logic behind a named adapter the arena implements first, so the next game plugs in without a rewrite.
