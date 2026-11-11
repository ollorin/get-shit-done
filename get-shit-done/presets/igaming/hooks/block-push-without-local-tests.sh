#!/bin/bash
# Block git push unless local CI preflight has passed (marker < 30 min old) and keep the marker
# unforgeable by agents. Logic: lib/block-push-without-local-tests.pl. Fails closed on bad input.
PATH="$PATH:/usr/bin:/bin"
. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" block-push-without-local-tests
