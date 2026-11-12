#!/bin/bash
# Hook: check-test-command.sh. Logic: lib/check-test-command.pl, tokeniser: lib/ShellParse.pm.
# Blocks a command listed in `stack.locked_commands` (.planning/config.json) unless it runs under
# scripts/stack-lock.sh or scripts/session-supervisor.sh, and any command listed in `stack.deploy.never_touch`
# (lock or no lock). No list: inert. Unreadable config or input: exit 2.
PATH="$PATH:/usr/bin:/bin"
D="${BASH_SOURCE[0]%/*}"; [ "$D" = "${BASH_SOURCE[0]}" ] && D=.
. "$D/lib/run-perl.sh" check-test-command || exit 2
