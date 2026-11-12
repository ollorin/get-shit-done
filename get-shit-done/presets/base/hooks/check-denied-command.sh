#!/bin/bash
# Hook: check-denied-command.sh. Logic: lib/check-denied-command.pl, tokeniser: lib/ShellParse.pm.
# The settings deny and ask rows stop one literal spelling; this stops the same commands behind `git -C`, a trailing
# or split flag, `env`, `bash -c` or a path prefix. A steer, not a boundary. Unreadable input or a crash: exit 2.
PATH="$PATH:/usr/bin:/bin"
D="${BASH_SOURCE[0]%/*}"; [ "$D" = "${BASH_SOURCE[0]}" ] && D=.
. "$D/lib/run-perl.sh" check-denied-command || exit 2
