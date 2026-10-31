#!/usr/bin/env python3
"""PreToolUse deny hook for judge runs: the judge may read only its sandbox (key.json must stay hidden)."""
import json
import sys

DENY = ("key.json", "/ab-eval/runs", "/ab-eval/tasks", "/ab-eval/results", "/ab-eval/variants",
        "igaming-platform", "get-shit-done", ".claude/projects")
d = json.load(sys.stdin)
ti = d.get("tool_input", {}) or {}
blob = json.dumps(ti)
hit = [p for p in DENY if p in blob]
if d.get("tool_name") in ("Read", "Glob", "Grep", "Bash") and hit:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": "JUDGE-DENY: only the packet in the working directory is available"}}))
sys.exit(0)
