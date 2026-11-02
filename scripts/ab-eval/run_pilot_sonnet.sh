#!/bin/bash
# Exp 14: reviewer on its production tier, both arms in the same period, arms alternating.
cd "$(dirname "$0")" || exit 2
go() { python3 ab_run.py run --task "$1" --variant "$2" --rep-start "$3" --reps 1 --log runs-ponytail-sonnet.jsonl --quota-ceiling 0.985 || { echo "STOP at $1 $2 r$3"; exit 3; }; }
for rep in 1 2 3; do for t in R1 R2; do go "$t" Q2 "$rep"; go "$t" P "$rep"; done; done
python3 - <<'P'
import json, os, subprocess
log = "runs-ponytail-sonnet.jsonl"
for line in open(os.path.expanduser(f"~/ab-eval/results/{log}")):
    r = json.loads(line)
    if r["status"] == "done":
        subprocess.run(["python3", "ab_match.py", "run", "--run", r["run_id"], "--runs-log", log], check=False)
P
echo SONNET-DONE
