#!/usr/bin/env python3
"""Regrade runs whose only stack denials were false positives of the old deny hook (wave 2).

  python3 ab_regrade.py [--apply]

For every non-superseded row with a `stack` harness denial, replay the run's Bash commands through the current
hook (`stack_hit`). When none is a stack command the denial was a false positive: append a patch to
results/regraded.jsonl (the aggregator applies it on load; runs.jsonl is never rewritten) that drops the
`shared-stack-attempted` critical and the stack denial count and recomputes `acceptance_pass` from the stored
components. Without --apply it only prints.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402

STACK_CRITICAL = "shared-stack-attempted"


def corrected(row: Dict[str, Any]) -> Dict[str, Any]:
    """The fields that change when the run's stack denials are not real."""
    crit = [c for c in row.get("criticals", []) if c != STACK_CRITICAL]
    by_cat = {k: v for k, v in (row.get("harness_denials") or {}).get("by_cat", {}).items() if k != "stack"}
    hidden = row.get("hidden")
    acceptance = bool(row["visible"]["pass"] and row["check_ok"] and row["lint_ok"]
                      and (row.get("fp") or {}).get("increase", 1) == 0 and not crit and not row.get("scope_out")
                      and (hidden is None or hidden["pass"])
                      and (row.get("leak") is None or row["leak"].get("leaked", 0) == 0))
    return {"criticals": crit, "acceptance_pass": acceptance,
            "harness_denials": {"by_cat": by_cat, "count": sum(by_cat.values())}}


def timeout_patch(row: Dict[str, Any]) -> Dict[str, Any]:
    """A run that hit the wall-clock limit without a result line was recorded void by the old classification; it is
    a failed run of its arm (acceptance False)."""
    return {"status": "failed", "void_reason": "timeout without a result line", "acceptance_pass": False}


def bash_commands(run_dir: Path) -> List[str]:
    out: List[str] = []
    for f in sorted((run_dir / "transcripts").rglob("*.jsonl")):
        for line in f.read_text(errors="replace").splitlines():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            for b in ((d.get("message") or {}).get("content") or []):
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Bash":
                    out.append((b.get("input") or {}).get("command", ""))
    return out


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)
    hook = C.deny_hook()
    sup = {r["run_id"] for r in C.read_jsonl(C.AB_HOME / "results" / "superseded.jsonl")}
    done = {r["run_id"] for r in C.read_jsonl(C.AB_HOME / "results" / "regraded.jsonl")}
    for row in C.read_jsonl(C.AB_HOME / "results" / "runs.jsonl"):
        if row["run_id"] not in sup and row["run_id"] not in done and row["status"] == "void" and row.get("timed_out") \
                and row.get("void_reason") == "no result line in stream":
            print(f"{row['run_id']}: timed out without a result line -> failed")
            if args.apply:
                C.append_jsonl(C.AB_HOME / "results" / "regraded.jsonl", {
                    "run_id": row["run_id"], "ts": C.utc_now(), "set": timeout_patch(row),
                    "reason": "timeout without a result line is a failed run, not a void (selection bias)"})
            continue
        if row["run_id"] in sup or row["run_id"] in done or STACK_CRITICAL not in row.get("criticals", []):
            continue
        run_dir = C.AB_HOME / "runs" / row["run_id"]
        real = [c for c in bash_commands(run_dir) if hook.stack_hit(hook.strip_heredocs(c))]
        if real:
            print(f"{row['run_id']}: real stack command remains, not regraded: {real[0][:100]}")
            continue
        patch = corrected(row)
        print(f"{row['run_id']}: false stack denial; acceptance {row['acceptance_pass']} -> {patch['acceptance_pass']}")
        if args.apply:
            C.append_jsonl(C.AB_HOME / "results" / "regraded.jsonl", {
                "run_id": row["run_id"], "ts": C.utc_now(), "set": patch,
                "reason": "stack denial was a false positive of the old deny hook (replayed with the current stack_hit)"})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
