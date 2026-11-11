#!/bin/bash
# Hook: check-git-merge-target.sh. Logic: lib/check-git-merge-target.pl.
# Asks for `gh pr merge`, the merge API, pushes to main, and `git merge` on main. A lone `git merge`
# into a non-main branch is allowed without a prompt; compound commands get no decision.
PATH="$PATH:/usr/bin:/bin"
. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" check-git-merge-target
