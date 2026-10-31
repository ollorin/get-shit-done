#!/bin/bash
D=$(dirname "$0"); cd $D
until [ "$($D/display-state.sh)" = on ]; do sleep 5; done
sleep 20
echo "on-window start $($D/display-state.sh) $(date -u +%FT%TZ)" > logs/on-after.meta
PUPPETEER_CACHE_DIR=$D/cache node bench.mjs /Users/ollorin/charlotte/dist/index.js fixed-on-seq 20 > logs/fixed-on-seq.json 2> logs/fixed-on-seq.err
echo "bench done $($D/display-state.sh) $(date -u +%FT%TZ)" >> logs/on-after.meta
(cd ~/charlotte && npx vitest run 2>&1 | grep -E "Test Files|Tests |×" > $D/logs/suite-fallback-display-on.txt)
echo "suite done $($D/display-state.sh) $(date -u +%FT%TZ)" >> logs/on-after.meta
