---
paths:
  - "apps/mobile/**"
---

# Flutter Mobile App Rules

**Note:** Expand as conventions solidify — this reflects the current tree, not a target design.

## Current Status

`apps/mobile/` is an initialized, in-progress Flutter app (`social_casino_app` per `pubspec.yaml`)
with real source under `lib/` (`lib/main.dart`, `lib/src/core/`, `lib/src/features/`,
`lib/games/game_registry.dart`, plus a `lib/templates/` set for mini-game/slot-machine templates),
platform folders for `android/`, `ios/`, `macos/`, and `web/`, and an `integration_test/` harness
with existing E2E specs (`demo_e2e_test.dart`, `email_login_e2e_test.dart`,
`email_registration_e2e_test.dart`, `simple_ui_demo.dart`). Unit/feature tests live under `test/`
(`unit/`, `features/`, `integration/`, `e2e/`, `edge_cases/`, `performance/`, `qa_automation/`,
etc.). `analysis_options.yaml` and `build.yaml` are present at the app root.

## Guidelines

Do not invent conventions this app doesn't already demonstrate. Before adding a new
platform-specific pattern, state-management approach, or testing convention here, verify it
against what `lib/src/`, `lib/games/`, and `test/` actually do — this file should describe the
real structure, not a proposed one.
