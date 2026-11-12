#!/bin/bash
# Hook: redirect-recursive-search.sh  (logic: lib/redirect-recursive-search.pl, tokeniser: lib/ShellParse.pm)
#
# Denies recursive grep/rg, rg without a file target, find -exec without -maxdepth, and `rtk grep`.
# Allows grep on named files/globs, wait loops, git grep, pipe-fed grep. Rationale: a plain
# `grep -n x file` is not the cost; these shapes cost unbounded reads and lossy output, and the
# search command of the stack profile and git grep give exact, bounded results.
# Exit codes: 0 allow, 2 block (reason on stderr). Unreadable input or a crash fails closed (exit 2).
PATH="$PATH:/usr/bin:/bin"
D="${BASH_SOURCE[0]%/*}"; [ "$D" = "${BASH_SOURCE[0]}" ] && D=.
. "$D/lib/run-perl.sh" redirect-recursive-search || exit 2
