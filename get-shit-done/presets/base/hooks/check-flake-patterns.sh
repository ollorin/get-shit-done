#!/bin/bash
# Hook: check-flake-patterns.sh. Logic: lib/flake-gate.mjs --hook (the same scanner the --all gate runs).
# Blocks a Write, Edit or MultiEdit of a test file (stack.flake_patterns.test_globs) whose content matches a
# `stack.flake_patterns` entry, unless a `flake-ignore: <reason>` comment covers the line.
# No config, no patterns: allow. Unreadable config, invalid regex, unparseable stdin, no node or a scan past 10 s: exit 2.
NODE="$(command -v node 2>/dev/null)"
[ -x "$NODE" ] || { echo "BLOCKED: node not found, check-flake-patterns cannot scan the edit (fail closed)" >&2; exit 2; }
PERL=/usr/bin/perl; [ -x "$PERL" ] || PERL="$(command -v perl 2>/dev/null)"
[ -x "$PERL" ] || { echo "BLOCKED: perl not found, check-flake-patterns cannot bound its run time (fail closed)" >&2; exit 2; }
D="${BASH_SOURCE[0]%/*}"; [ "$D" = "${BASH_SOURCE[0]}" ] && D=.
"$PERL" -e 'alarm shift; exec @ARGV or exit 127' 10 "$NODE" "$D/lib/flake-gate.mjs" --hook
rc=$?
case "$rc" in
  0|2) exit "$rc";;
  142) echo "BLOCKED: check-flake-patterns ran past 10 s (a stack.flake_patterns regex that backtracks?), failing closed" >&2; exit 2;;
  *) echo "BLOCKED: hook check-flake-patterns crashed (rc=$rc), failing closed" >&2; exit 2;;
esac
