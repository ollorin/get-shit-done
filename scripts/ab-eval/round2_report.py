#!/usr/bin/env python3
"""Exp 15 report: per task and arm, then arm vs control with a task-clustered bootstrap (95%)."""
import argparse
import json
import random
import re
from collections import defaultdict

import ab_calib as K
import ab_common as C

TASKS = {t["id"]: t for t in C.load_tasks()["tasks"]}
SEV = re.compile(r'"severity"\s*:\s*"(CRIT|HIGH|MED|LOW)"')


def kills(run_id, task_id):
    """Kills from the grader. A run whose tests never went green is graded with no kills: all mutants survive it."""
    s = C.read_json(C.AB_HOME / "runs" / run_id / "grade" / "summary.json", {}) or {}
    k = (s.get("role_checks") or {}).get("kills") or []
    return sum(1 for x in k if x.get("killed")), len(K.mutant_paths(TASKS[task_id])) or len(k)


def metrics(row, matches):
    """One number per metric for one run; None when the run cannot say."""
    run = row["run_id"]
    out = {"cost": row.get("result_cost_usd") or 0, "added": row.get("diff_added_lines") or 0,
           "accept": 1.0 if row.get("acceptance_pass") else 0.0, "crit": len(row.get("criticals") or []),
           "passed": 1.0 if (row.get("role_checks") or {}).get("pass_on_green") else 0.0}
    if row["role"] == "review":
        report = C.AB_HOME / "runs" / run / "report.md"
        text = report.read_text(errors="replace") if report.exists() else ""
        m = matches.get(run) or {}
        out.update(recall=m.get("known_recall"), findings=len(SEV.findall(text)),
                   required=None if not m.get("required_found") else
                   sum(m["required_found"].values()) / len(m["required_found"]))
    else:
        killed, total = kills(run, row["task_id"])
        out.update(killed=killed if total else None, survived=total - killed if total else None,
                   kills_per_100=(100 * killed / out["added"] if out["added"] else 0.0) if total else None,
                   hidden=None if not row.get("hidden") else (1.0 if row["hidden"].get("pass") else 0.0))
    return out


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def table(rows, matches):
    cells = defaultdict(list)
    for r in rows:
        if r.get("status") == "done":
            cells[(r["task_id"], r["variant"])].append(metrics(r, matches))
    return cells


def task_means(cells, arm, metric):
    return {t: mean([m.get(metric) for m in ms]) for (t, a), ms in cells.items() if a == arm}


def bootstrap(a, b, n=4000, seed=15):
    """b minus a over tasks both arms have. Tasks are resampled, never single runs: runs of one task are not independent."""
    tasks = sorted(t for t in a if t in b and a[t] is not None and b[t] is not None)
    if not tasks:
        return None
    diff = {t: b[t] - a[t] for t in tasks}
    rng, stats = random.Random(seed), []
    for _ in range(n):
        pick = [rng.choice(tasks) for _ in tasks]
        stats.append(sum(diff[t] for t in pick) / len(pick))
    stats.sort()
    return sum(diff.values()) / len(tasks), stats[int(.025 * n)], stats[int(.975 * n)], len(tasks)


def fmt(x):
    return "-" if x is None else f"{x:.2f}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--log", default="runs-round2.jsonl")
    p.add_argument("--role", required=True, choices=["test-writer", "review"])
    p.add_argument("--control", default="A")
    p.add_argument("--tasks", nargs="*")
    o = p.parse_args()
    rows = [r for r in C.read_jsonl(C.AB_HOME / "results" / o.log) if r["role"] == o.role
            and (not o.tasks or r["task_id"] in o.tasks)]
    matches = {m["run_id"]: m for m in C.read_jsonl(C.AB_HOME / "results" / "matches.jsonl")}
    cells = table(rows, matches)
    names = (("recall", "required", "findings", "cost") if o.role == "review"
             else ("killed", "survived", "kills_per_100", "added", "accept", "passed", "hidden", "crit", "cost"))
    print("task arm n " + " ".join(names))
    for (t, a), ms in sorted(cells.items()):
        print(t, a, len(ms), " ".join(fmt(mean([m.get(k) for m in ms])) for k in names))
    arms = sorted({a for _t, a in cells} - {o.control})
    for arm in arms:
        for k in names:
            res = bootstrap(task_means(cells, o.control, k), task_means(cells, arm, k))
            if res:
                print(f"{arm}-{o.control} {k}: {res[0]:+.2f} [{res[1]:+.2f}, {res[2]:+.2f}] tasks={res[3]}")
    print("spent $%.2f; last util %s" % (sum(r.get("result_cost_usd") or 0 for r in rows),
                                         rows[-1].get("rate_limit_util_end") if rows else None))


if __name__ == "__main__":
    main()
