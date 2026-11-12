#!/bin/sh
exec node "$(dirname "$0")/stack-lock.mjs" "$@"
