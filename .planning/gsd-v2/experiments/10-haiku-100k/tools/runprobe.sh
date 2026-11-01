#!/bin/zsh
# usage: runprobe.sh NAME SETTINGS_FILE [extra args...]
n=$1; s=$2; shift 2
cd ~/ab-eval/scratch/h100k/p
claude -p "$(cat ${PROMPT:-prompt.md})" --model haiku --setting-sources project,local --settings $s --permission-mode bypassPermissions --output-format stream-json --verbose --max-budget-usd 1.5 --session-id $(uuidgen | tr A-Z a-z) "$@" > ../$n.stream.jsonl 2> ../$n.err
