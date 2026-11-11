#!/bin/bash
# Hook: check-api-contract-drift.sh (Phase 269, Plan 03). Logic: lib/check-api-contract-drift.pl.
# Blocks an agent `git commit` while frontend calls lack a backend route in the repo being committed to
# (cd / -C aware; repos without scripts/api-contract/diff-registries.ts are skipped). Only fires for a
# Claude Code agent's own commit; the CI job api-contract-check is the universally-enforced gate.
# Blocking since 2026-07-09 (Phase 269-04). Fails closed on unreadable input.
PATH="$PATH:/usr/bin:/bin"
. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" check-api-contract-drift
