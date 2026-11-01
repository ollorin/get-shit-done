#!/bin/zsh
# usage: runsub.sh NAME SETTINGS
n=$1; s=$2; shift 2
cd ~/ab-eval/scratch/h100k/p
AG='{"reader":{"description":"reads files","prompt":"You are a file reader. Follow the task you are given exactly.","model":"haiku","tools":["Read"]}}'
claude -p "$(cat dispatch.md)" --model haiku --agents "$AG" --setting-sources project,local --settings $s --permission-mode bypassPermissions --output-format stream-json --verbose --max-budget-usd 1.5 --session-id $(uuidgen | tr A-Z a-z) "$@" > ../$n.stream.jsonl 2> ../$n.err
