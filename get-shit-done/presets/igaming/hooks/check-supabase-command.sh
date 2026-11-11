#!/bin/bash
# Hook: check-supabase-command.sh. Logic: lib/check-supabase-command.pl.
# Blocks bare `supabase start` (no --exclude / --project-id) and `supabase stop` (no --project-id),
# including path-prefixed and npx-prefixed binaries; the flags must be in the same command.
# ALLOWS nx lifecycle commands (npx nx start:dev|stop:dev|start:minimal api), supabase status/db/migration/gen/functions.
PATH="$PATH:/usr/bin:/bin"
. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" check-supabase-command
