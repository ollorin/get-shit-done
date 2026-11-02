#!/bin/bash
# Exp 14 pilot queue: skips completed runs, stops at the weekly ceiling.
CEILING=0.985
cd "$(dirname "$0")" || exit 2
LOG="$HOME/ab-eval/results/runs-ponytail.jsonl"
done_count() { [ -f "$LOG" ] && python3 -c "
import json,sys
print(sum(1 for l in open('$LOG') if (r:=json.loads(l))['task_id']=='$1' and r['variant']=='$2' and r['status']=='done'))" || echo 0; }
run() { # task variant reps
  local have rep
  have=$(done_count "$1" "$2")
  for ((rep = have + 1; rep <= $3; rep++)); do
    python3 ab_run.py run --task "$1" --variant "$2" --rep-start "$rep" --reps 1 --model haiku \
      --log runs-ponytail.jsonl --quota-ceiling "$CEILING" || { echo "STOP at $1 $2 r$rep"; exit 3; }
  done
}
for t in R1 R2; do run "$t" Q2 3; run "$t" P 3; done
for t in TW4 TW3 TW1; do run "$t" P 3; done
run TW2 P 2
run E1 P 3
echo PILOT-QUEUE-DONE
