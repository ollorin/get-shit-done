#!/bin/sh
# Appends one KPI row for the last 7 days. Scheduling: docs/host-setup.md.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
OUT="$ROOT/.planning/gsd-v2/research/KPI.md"
SINCE=$(date -u -v-7d '+%Y-%m-%dT%H:%M:%SZ')
UNTIL=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
[ -f "$OUT" ] || printf '# Weekly KPI\n\n' > "$OUT"
GSD_SINCE="$SINCE" GSD_UNTIL="$UNTIL" python3 "$ROOT/scripts/gsd-metrics/metrics_v2.py" --row >> "$OUT"
