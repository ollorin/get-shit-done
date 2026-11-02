#!/bin/bash
# Exp 14 round 3: controls under the same load as P, more reps where the executor comparison is decisive.
cd "$(dirname "$0")" || exit 2
go() { python3 ab_run.py run --task "$1" --variant "$2" --rep-start "$3" --reps 1 --model haiku --log runs-ponytail.jsonl --quota-ceiling 0.985 || { echo "STOP at $1 $2 r$3"; exit 3; }; }
for rep in 21 22 23; do for t in E7 E6; do go "$t" A "$rep"; go "$t" P "$rep"; done; done
for rep in 24 25; do go E4 A "$rep"; go E4 P "$rep"; done
echo ROUND3-DONE
