#!/bin/bash
# Hook: check-git-merge-target.sh. Logic: lib/check-git-merge-target.pl.
# Asks for `gh pr merge`, the merge API, pushes to the default branch, and `git merge` into the default branch (or master). A lone `git merge`
# into a non-default branch is allowed without a prompt; compound commands get no decision.
PATH="$PATH:/usr/bin:/bin"
D="${BASH_SOURCE[0]%/*}"; [ "$D" = "${BASH_SOURCE[0]}" ] && D=.
. "$D/lib/run-perl.sh" check-git-merge-target || exit 2
