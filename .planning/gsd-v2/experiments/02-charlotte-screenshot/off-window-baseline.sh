#!/bin/bash
# Run once the display is off: config matrix, then main-build baseline (20 instances x 1 shot, parallel).
D=$(dirname "$0"); cd $D
$D/wait-display-off.sh
echo "display-off window started $(date -u +%FT%TZ)" > logs/off-baseline.meta
export SHELL_BIN=$(ls -d ~/.cache/puppeteer/chrome-headless-shell/mac_arm-154*/*/chrome-headless-shell)
node matrix.mjs "" 2 > logs/matrix-off.txt 2>&1
echo "matrix done display=$($D/display-state.sh) $(date -u +%FT%TZ)" >> logs/off-baseline.meta
for i in $(seq 1 20); do node bench.mjs /Users/ollorin/charlotte/dist/index.js main-off-$i 1 > logs/main-off-$i.json 2> logs/main-off-$i.err & done
wait
echo "baseline done display=$($D/display-state.sh) $(date -u +%FT%TZ)" >> logs/off-baseline.meta
