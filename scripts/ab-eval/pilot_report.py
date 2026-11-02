#!/usr/bin/env python3
"""Exp 14: pilot rows beside their controls. Reviewer control = Q2 at Haiku; others = frozen A rows in runs.jsonl."""
import json
from collections import defaultdict
from pathlib import Path

RES = Path.home() / "ab-eval" / "results"


def rows(name):
    path = RES / name
    return [json.loads(line) for line in path.open()] if path.exists() else []


def summary(group):
    ok = [r for r in group if r.get("status") == "done"]
    if not ok:
        return f"n=0 (of {len(group)})"
    mean = lambda f: sum(f(r) or 0 for r in ok) / len(ok)
    hidden = [r["hidden"]["pass"] for r in ok if r.get("hidden")]
    checks = defaultdict(int)
    for r in ok:
        for key, val in (r.get("role_checks") or {}).items():
            checks[key] += 1 if val else 0
    fp = [sum(v for v in (r.get("fp") or {}).values() if isinstance(v, (int, float))) for r in ok]
    return (f"n={len(ok)}/{len(group)} accept={sum(1 for r in ok if r.get('acceptance_pass'))} "
            f"hidden={sum(hidden)}/{len(hidden)} crit={sum(len(r.get('criticals') or []) for r in ok)} "
            f"added={mean(lambda r: r.get('diff_added_lines')):.0f} fp={sum(fp)/len(fp):.0f} "
            f"${mean(lambda r: r.get('result_cost_usd')):.2f} wall={mean(lambda r: r.get('wall_s')):.0f}s "
            f"checks={dict(checks)}")


pilot, control = rows("runs-ponytail.jsonl"), rows("runs.jsonl")
for task in sorted({r["task_id"] for r in pilot}):
    if task.startswith("R"):
        print(task, "Q2-haiku", summary([r for r in pilot if r["task_id"] == task and r["variant"] == "Q2"]))
    else:
        print(task, "A", summary([r for r in control if r["task_id"] == task and r["variant"] == "A"]))
    print(task, "P", summary([r for r in pilot if r["task_id"] == task and r["variant"] == "P"]))
print("spent $%.2f; last util %s" % (sum(r.get("result_cost_usd") or 0 for r in pilot),
                                     pilot[-1].get("rate_limit_util_end") if pilot else None))
