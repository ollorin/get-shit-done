# Prompt: RG Test Coverage Gap Analysis + Phase Creation

> **Usage:** Paste this prompt into Claude Code in the `/Users/ollorin/igaming-platform/` project directory.

---

You are a QA architect. Your job is to analyze the Responsible Gaming milestone (phases 74-83) and identify every place where API-level, UI/UX, and E2E tests are missing, then create new phases to achieve 100% coverage.

## Step 1: Read all context

Read these files in parallel:

**PRD (requirements source of truth):**
- `.planning/prds/done/responsible-gaming.md` — all user stories and acceptance criteria

**What was built (phase summaries):**
- `.planning/phases/74-rg-infrastructure/74-01-SUMMARY.md`
- `.planning/phases/74-rg-infrastructure/74-02-SUMMARY.md`
- `.planning/phases/74-rg-infrastructure/74-03-SUMMARY.md`
- `.planning/phases/74-rg-infrastructure/74-04-SUMMARY.md`
- `.planning/phases/75-limits-engine-rpcs/75-01-SUMMARY.md`
- `.planning/phases/75-limits-engine-rpcs/75-02-SUMMARY.md`
- `.planning/phases/75-limits-engine-rpcs/75-03-SUMMARY.md`
- `.planning/phases/75-limits-engine-rpcs/75-04-SUMMARY.md`
- `.planning/phases/76-exclusion-state-machine/76-01-SUMMARY.md`
- `.planning/phases/76-exclusion-state-machine/76-02-SUMMARY.md`
- `.planning/phases/76-exclusion-state-machine/76-03-SUMMARY.md`
- `.planning/phases/76-exclusion-state-machine/76-04-SUMMARY.md`
- `.planning/phases/77-payments-auth-gate-integration/77-01-SUMMARY.md`
- `.planning/phases/77-payments-auth-gate-integration/77-02-SUMMARY.md`
- `.planning/phases/77-payments-auth-gate-integration/77-03-SUMMARY.md`
- `.planning/phases/77-payments-auth-gate-integration/77-04-SUMMARY.md`
- `.planning/phases/78-behavioral-harm-detection/78-01-SUMMARY.md`
- `.planning/phases/78-behavioral-harm-detection/78-02-SUMMARY.md`
- `.planning/phases/78-behavioral-harm-detection/78-03-SUMMARY.md`
- `.planning/phases/78-behavioral-harm-detection/78-04-SUMMARY.md`
- `.planning/phases/79-operator-rg-edge-function/79-01-SUMMARY.md`
- `.planning/phases/79-operator-rg-edge-function/79-02-SUMMARY.md`
- `.planning/phases/79-operator-rg-edge-function/79-03-SUMMARY.md`
- `.planning/phases/79-operator-rg-edge-function/79-04-SUMMARY.md`
- `.planning/phases/80-player-web-rg-ui/80-01-SUMMARY.md`
- `.planning/phases/80-player-web-rg-ui/80-02-SUMMARY.md`
- `.planning/phases/81-player-web-session-activity-ui/81-01-SUMMARY.md`
- `.planning/phases/81-player-web-session-activity-ui/81-02-SUMMARY.md`
- `.planning/phases/82-operator-web-rg-ui/82-01-SUMMARY.md`
- `.planning/phases/82-operator-web-rg-ui/82-02-SUMMARY.md`
- `.planning/phases/82-operator-web-rg-ui/82-03-SUMMARY.md`
- `.planning/phases/83-rg-integration-tests-gli19-verification/83-01-SUMMARY.md`
- `.planning/phases/83-rg-integration-tests-gli19-verification/83-02-SUMMARY.md`
- `.planning/phases/83-rg-integration-tests-gli19-verification/83-03-SUMMARY.md`

**Current roadmap:**
- `.planning/ROADMAP.md` — to see what phases already exist and the last phase number

## Step 2: Build the gap inventory

For everything that was implemented in phases 74-83, determine what testing exists vs. what is missing.

**Testing types:**

| Type | What it means | Coverage requirement |
|------|--------------|----------------------|
| **API (HTTP-level)** | HTTP requests hitting actual edge function routes — not RPC calls directly | Every HTTP route must be called via HTTP: auth failures (401/403), validation errors (422), success paths, error paths |
| **Player UI** | Charlotte browser QA on `player-web` pages | Every page/form/modal the player interacts with: renders, key flows, error states, blocked states |
| **Operator UI** | Charlotte browser QA on `operator-web` pages | Every page/form/modal the operator uses: renders, RBAC-gated controls, data display |
| **E2E flow** | Cross-system user journeys hitting multiple components in sequence | Full user journeys: player sets limit → tries to exceed → gets blocked; player self-excludes → session terminated → login blocked; operator flags → player receives reality check |

**Known gaps from prior analysis:**
- Phase 83 "integration tests" call RPCs directly — they do NOT exercise HTTP routes
- Player UI was unit-tested with mocks — no real browser Charlotte QA was run
- Operator UI was unit-tested with mocks — no real browser Charlotte QA was run
- No E2E flows were ever tested end-to-end across API + UI + state machine

## Step 3: Produce the gap analysis report

Before creating phases, output a structured gap inventory grouped by area:

```
## RG TEST COVERAGE GAP ANALYSIS

### API Gaps (HTTP-level — edge function routes not covered)

**Player API:**
- [ ] POST /player/rg/limits — set limit (auth, validation, success, cooling-off)
- [ ] GET /player/rg/limits — get all limits
- [ ] POST /player/rg/exclusions/cool-off — activate cool-off
- [ ] POST /player/rg/exclusions/self-exclude — self-exclude (irrevocable)
- [ ] GET /player/rg/status — session status
- [ ] GET /player/rg/suggestions — personalized limit suggestions
- [ ] POST /deposits (RG gate) — deposit blocked when limit exceeded
- [ ] POST /auth/login (RG gate) — restricted session on exclusion
- [list all others found in summaries]

**Operator API:**
- [ ] GET /operator/rg/review-queue — RBAC, sorting, tier filter
- [ ] GET /operator/players/:id/rg — full RG profile
- [ ] POST /operator/players/:id/rg/limits — operator-set limit (reason required, bypass cooling-off)
- [ ] POST /operator/players/:id/rg/exclusions — forced exclusion (2FA, reason)
- [ ] GET /operator/rg/audit-export — GLI-19 export (CSV/JSON, date range)
- [ ] POST /operator/players/:id/rg/interventions — log intervention outcome
- [list all others found in summaries]

### Player UI Gaps (Charlotte QA not run)

- [ ] /account/limits — limit widget for each type, edit flow, cooling-off pending state, operator-imposed read-only
- [ ] /account/exclusions — take-a-break flow, self-exclusion 3-step, confirmation text, current status display
- [ ] /account/statements — date range filter, gambling activity table, CSV export
- [ ] Session countdown banner — soft warning at 80%, hard stop with 60s countdown
- [ ] Reality check modal — interval trigger, net result display, dismiss, pause 10 min
- [ ] Block banner — shown on exclusion/hard stop, gambling nav disabled
- [ ] Deposit limit widget — on deposit page, remaining allowance, period reset date
- [ ] First-deposit prompt — blocks deposit until dismissed
- [list all others found in summaries]

### Operator UI Gaps (Charlotte QA not run)

- [ ] /operators/rg/review-queue — tier badge, signal summary, time flagged, intervention modal
- [ ] /players/:id?tab=rg — limits table, source badges, set-limit form, exclusion card
- [ ] Bulk review panel — checkbox select, reason input, submit
- [ ] Notification bell — badge count, popover panel, per-item dismiss
- [ ] Review queue intervention modal — outcome select required, history timeline
- [list all others found in summaries]

### E2E Flow Gaps (no cross-system flows tested)

- [ ] Player sets deposit limit → makes deposit that exceeds it → blocked with correct error
- [ ] Player self-excludes → active session terminated → next login returns restricted token → gambling endpoints return 403
- [ ] Operator excludes player → player immediately blocked → player UI shows exclusion status
- [ ] Player hits session time limit → soft warning shown → hard stop terminates session
- [ ] Reality check fires at configured interval → player dismisses → interval resets
- [ ] Operator reviews tier-3 player → records intervention → escalation badge clears
- [ ] Player at deposit limit → operator raises limit → player can now deposit more
- [list all others found in summaries]
```

## Step 4: Group gaps into logical phases

Group the gaps into 5-7 phases that can be planned and executed independently. Each phase should have a single clear concern.

Suggested grouping (adjust based on actual gaps found):

| # | Phase concern | Coverage |
|---|--------------|---------|
| A | Player-facing HTTP API tests | All player edge function routes via HTTP |
| B | Operator-facing HTTP API tests | All operator edge function routes via HTTP |
| C | Player-web Charlotte QA | All player-web RG pages and components in browser |
| D | Operator-web Charlotte QA | All operator-web RG pages and components in browser |
| E | RG E2E flow tests | Cross-system flows: limits enforcement, exclusion blocking, session management, operator intervention |

If any group is too large (more than ~15 test cases), split it.

## Step 5: Create the phases

For each group, call `/gsd:add-phase` with a description that clearly states:
1. What is being tested
2. What type of test (API / Charlotte QA / E2E)
3. The scope

Run each `/gsd:add-phase` call sequentially (not in parallel — each one updates ROADMAP.md and the next needs the updated phase number).

Example calls:
```
/gsd:add-phase RG player API HTTP-level tests — deposit gate, limits, exclusions, session, suggestions endpoints
/gsd:add-phase RG operator API HTTP-level tests — review queue, player profile, audit export, interventions, RBAC enforcement
/gsd:add-phase RG player-web Charlotte QA — limits page, exclusion page, session countdown, reality check, block banner, statements, deposit widget
/gsd:add-phase RG operator-web Charlotte QA — review queue, player profile RG tab, bulk review, notification bell, intervention modal
/gsd:add-phase RG E2E enforcement flows — deposit limit, self-exclusion blocking, session termination, operator exclusion, reality check, operator intervention
```

Adjust the descriptions based on the actual gaps found in Step 3. If gaps are larger or smaller than expected, adjust the number of phases and their scopes accordingly.

## Step 6: Report what was created

After all `/gsd:add-phase` calls complete, output:

```
## RG TEST PHASES CREATED

Phases added to ROADMAP.md:

| Phase | Description | Gap count |
|-------|-------------|-----------|
| NN | [description] | N gaps |
| NN+1 | [description] | N gaps |
...

Total new test coverage phases: N
Total gaps to be closed: N

Next: /gsd:plan-phase NN to start with the first new phase.
```
