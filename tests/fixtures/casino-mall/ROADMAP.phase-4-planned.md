# Roadmap: Casino Mall

## Milestones

- 🚧 **v0.0.1 Stack spike** - Phases 1-4 (in progress)

## Overview

Milestone 0.0.1 is a one-day throwaway spike in `spike/` that decides the admin and auth shape before any product code: build the local base (own Supabase, Astro on Workers), prove or disprove Supabase Auth on it, prove or disprove EmDash beside own admin screens with a prefixed default locale, then write the decision record. Product scope (35 PRDs) is not part of this milestone.

## Phases

**Phase Numbering:** integer phases are planned milestone work; decimals are urgent insertions.

- [x] **Phase 1: Local base** - Own Supabase instance plus an Astro SSR skeleton running on the Workers runtime locally (executed 2026-11-12; verification gaps_found 22/24 after gap closure 01-04 (earlier passes 9/11 and 16/17); gap closure 01-05 executed, awaiting re-verification) (completed 2026-11-12)
- [x] **Phase 2: Supabase Auth on Workers** - Sign-up, sign-in, session cookie, sign-out, protected page, staff-only page (completed 2026-11-13)
- [x] **Phase 3: EmDash admin and coexistence** - EmDash admin under a `/en/` default locale, roles, database, own admin screen in the same project (completed 2026-11-13)
- [ ] **Phase 4: Decision record** - Recommendation for admin and auth shape, unverified list, stack commands

## Phase Details

### Phase 1: Local base
**Goal:** A separate local Supabase instance and an Astro SSR project on the Cloudflare adapter both run locally without touching the `api` project's stack.
**Depends on:** Nothing (first phase)
**Risk domains:** none
**Requirements:** STACK-01, STACK-02
**Decision records:** none consumed (A-17 is exercised in phase 3)
**Success Criteria** (what must be TRUE):
  1. `docker ps` for the `api` project's containers is identical before and after; the new stack uses its own `project_id` and ports in the 55000 range, with only Postgres, Auth and the mail catcher running.
  2. A page served by `astro dev` and by `astro preview` is confirmed to run on `workerd` (runtime evidence captured, not assumed).
  3. `spike/.env` holds the secrets, is ignored by git and no secret value appears in any committed file or command output.
  4. No unexpected image pull occurred (`docker images` checked before the stack started).
**Plans:** 5/5 plans complete

Plans:
- [x] 01-01: Supabase config, ports, start/stop notes, image check
- [x] 01-02: Astro + Cloudflare adapter skeleton with versions and secrets handling
- [x] 01-03: Gap closure (CVE baseline, bind and ledger rulings, secret-scan evidence, bookkeeping)
- [ ] 01-04: Gap closure (container proofs D1-D4, D-29 observation, scan script cleanup)
- [ ] 01-05: Gap closure (start logs deleted and scan exclusion removed under D-30, stale result line, docs waiver ruling D-31, ledger annotations)

### Phase 2: Supabase Auth on Workers
**Goal:** Supabase Auth works in Astro SSR on `workerd`, with a staff check read from Postgres.
**Depends on:** Phase 1
**Requirements:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Decision records:** A-25, A-26 (compared only; not built)
**Risk domains:** auth, security. Plans here follow the owner-ruling route of `decisions-protocol.md` before execution.
**Success Criteria** (what must be TRUE):
  1. A visitor signs up by email, the confirmation mail appears in the local mail catcher, and the user can then sign in.
  2. The session survives a reload; signing out ends it and the protected page then refuses access.
  3. The staff-only page admits a user whose staff row exists in Postgres and refuses a plain user and an anonymous visitor.
  4. Responses that set cookies are `private, no-store`, and authorization uses `getClaims`/`getUser`.
**Plans:** 3/3 plans complete

Plans:
- [x] 02-01-PLAN.md — Config keys, confirmation template, staff table with RLS, secret key out of the Worker env, `@supabase/ssr` install, widened five-container start, probe harness and stack probe (R-01)
- [x] 02-02-PLAN.md — SSR client, middleware, sign-up, confirm, sign-in, sign-out, protected page, staff-only page; probes sc1..sc4 (one per success criterion) with mutants M-02..M-15
- [x] 02-03-PLAN.md — Discharge run of R-01..R-15 on the committed tree, evidence index, end-state and secret checks, stack stop, close-out

### Phase 3: EmDash admin and coexistence
**Goal:** Know whether EmDash works in this project and beside an own admin screen, with a prefixed default locale.
**Depends on:** Phase 2
**Risk domains:** auth
**Requirements:** ADM-01, ADM-02, ADM-03, ADM-04
**Decision records:** A-23, A-24, A-25 (consumed); A-17 (tested only: the spike produces evidence for it and builds nothing on it, so it is deliberately not mapped to a phase)
**Success Criteria** (what must be TRUE):
  1. The EmDash admin path is requested with default locale prefixed (`/en/...`) and unprefixed; status codes and configs are on disk, and the A-17 suspicion is confirmed or refuted.
  2. EmDash's roles and permissions are listed from the installed package and compared with A-24, naming the missing moderator capability.
  3. The database EmDash uses is recorded, with a result for connecting it to the Supabase Postgres (works, works with a named adapter, or does not).
  4. An own admin screen reading a Postgres table behind the staff check runs in the same project as the EmDash screens, and the identity relationship is described.
**Plans:** 2/2 plans complete

Plans:
- [ ] 03-01: Install EmDash, locale prefix experiment, roles and database findings
- [ ] 03-02: Own admin screen beside EmDash; identity relationship

### Phase 4: Decision record
**Goal:** A decision record the CEO can approve, plus honest stack commands.
**Depends on:** Phase 3
**Risk domains:** none
**Requirements:** DEC-01, DEC-02, DEC-03, DEC-04
**Success Criteria** (what must be TRUE):
  1. The record recommends EmDash plus own screens, or all own screens, with each claim cited to evidence files from phases 2 and 3.
  2. The record recommends Supabase Auth or Better Auth with the same citation standard.
  3. The unverified list names at least Hyperdrive on real Cloudflare, Google/Apple/Facebook sign-in and AWS SES delivery, plus any further gap found.
  4. `stack.commands` in `.planning/config.json` hold real commands or remain `none`, and the record says which and why.
**Plans:** 1 plan

Plans:
- [ ] 04-01: Write the decision record, set or confirm stack commands
  - Stack-command probe input (record only, not fixed in Phase 1): `spike/src/pages/probe.ts` line 1 imports `cloudflare:workers`, which has no type declarations, so `tsc --noEmit` is expected to report TypeScript error 2307 (unverified: `tsc` was never run, 01-03-SUMMARY.md:61; probe: run `tsc --noEmit` in `spike/` when DEC-04 is decided); typecheck is not configured (D-03). DEC-04 decides: add a `declare module 'cloudflare:workers'` d.ts or `@cloudflare/workers-types`, or leave typecheck `none`.
  - Expiry of the Phase 1 CVE baseline (ledger row D-05, ruling:phase-1-gap-1): empty `allowedFindings` in `.planning/cve-baseline.json` or delete the file, confirm `.planning/config.json` has no `stack.cve.lockfiles` key, rerun `node scripts/dependency-scan-gate.mjs` to rc 0. The gate does not enforce `expires` (`scripts/dependency-scan-gate.mjs:165-168` reads `allowedFindings` only).

## Progress

**Execution Order:** 1 → 2 → 3 → 4

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Local base | v0.0.1 | 3/5 | Complete Executed, gaps_found 22/24; gap closures 01-04 and 01-05 awaiting re-verification (completed 2026-11-12) | - |
| 2. Supabase Auth on Workers | v0.0.1 | 3/3 | Executed 02-03 (plans 3/3 executed), pending verification | - |
| 3. EmDash admin and coexistence | v0.0.1 | 0/2 | Complete  (completed 2026-11-13) | - |
| 4. Decision record | v0.0.1 | 0/2 | Not started | - |
