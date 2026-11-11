#!/bin/bash
# Hook: redirect-recursive-search.sh  (logic: lib/redirect-recursive-search.pl, tokeniser: lib/ShellParse.pm)
#
# Denies recursive grep/rg, rg without a file target, find -exec without -maxdepth, and `rtk grep`.
# Allows grep on named files/globs, wait loops, git grep, pipe-fed grep, zg. Rationale: the Bash
# classifier does NOT prompt on a plain `grep -n x file` (experiments/09-hooks-audit RULING R1); what
# these shapes cost is unbounded reads and lossy output, and zg/git grep give exact, bounded results.
# Exit codes: 0 allow, 2 block (reason on stderr). Unreadable input or a crash fails closed (exit 2).
PATH="$PATH:/usr/bin:/bin"
. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" redirect-recursive-search
