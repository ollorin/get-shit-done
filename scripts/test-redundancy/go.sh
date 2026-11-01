#!/bin/sh
# usage: go.sh <label> <repo-rel source .ts> <repo-rel test .ts>   (worktree fixed below)
set -e
cd "$(dirname "$0")/../.."
deno run --allow-read --allow-write --allow-run scripts/test-redundancy/run.ts \
  --root /Users/ollorin/igaming-platform/.tmp/wt-redundancy --source "$2" --test "$3" \
  --out ".planning/gsd-v2/experiments/12-test-redundancy/$1" --cross "${4:-0}" > "/tmp/rr-$1.log" 2>&1 || { tail -30 "/tmp/rr-$1.log"; exit 1; }
python3 -I -c "
import json,sys
d=json.load(open('.planning/gsd-v2/experiments/12-test-redundancy/$1/summary.json'))['summary']
[d.pop(k) for k in ('zeroKillCases','zeroUniqueCases','runInfo')]
print(json.dumps(d))"
