#!/bin/bash
# Hook: check-test-command.sh  (logic: lib/check-test-command.pl, tokeniser: lib/ShellParse.pm)
#
# BLOCKS only what is unsafe to run unsupervised:
#   1. Charlotte E2E suite tasks and apps/e2e-charlotte runner/run.ts (budget burn, fake red results);
#      exception: ONE scenario (`test:scenario <one>` / `run.ts --scenario=<one>`) wrapped in
#      scripts/stack-lock.(sh|ts) ... --, or anything run through scripts/session-supervisor.sh.
#   2. `deno task test:integration[:*]` (live stack without the lock; use scripts/run-integration-tests.sh).
# CLAUDE.md shapes stay allowed: `cd apps/api && deno task test <file>`, `deno test <file>`, `npx nx test <p>`.
# A direct `deno test x.integration.test.ts` without stack-lock only gets an additionalContext reminder.
# Exit codes: 0 allow, 2 block (reason on stderr). Unreadable input or a crash fails closed (exit 2).
PATH="$PATH:/usr/bin:/bin"
. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" check-test-command
