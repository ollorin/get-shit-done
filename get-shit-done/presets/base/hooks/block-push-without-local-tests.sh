#!/bin/bash
# Block git push unless the local pre-PR gate has passed (marker < 30 min old) and block the plain ways of writing
# the marker (a steer for honest agents, not a boundary: see lib/block-push-without-local-tests.pl). Fails closed on bad input.
PATH="$PATH:/usr/bin:/bin"
D="${BASH_SOURCE[0]%/*}"; [ "$D" = "${BASH_SOURCE[0]}" ] && D=.
. "$D/lib/run-perl.sh" block-push-without-local-tests || exit 2
