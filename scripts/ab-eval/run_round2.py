#!/usr/bin/env python3
"""Exp 15 driver: arms in random order inside each block, at most 2 runs at once, stops at the quota ceiling,
stops starting runs near the batch time limit. Skips completed runs, so re-running it resumes.
Spec: JSON list of {"tasks": [...], "arms": [...], "reps": N, "rep_start": N, "model": optional}."""
import argparse
import json
import random
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import ab_common as C

CEILING = "0.045"  # refused from a reading of 0.05: the CEO's 5% budget
LIMIT_S = 105 * 60  # under the 2 h limit of a background command


def plan(spec, seed):
    """Per task the arm order is random once, then rotates each rep, so every arm leads equally often (PLAN 0.5)."""
    rng, jobs = random.Random(seed), []
    for si, s in enumerate(spec):
        start = s.get("rep_start", 1)
        orders = {t: rng.sample(list(s["arms"]), len(s["arms"])) for t in s["tasks"]}
        for i, rep in enumerate(range(start, start + s["reps"])):
            tasks = rng.sample(list(s["tasks"]), len(s["tasks"]))
            for t in tasks:
                k = (i + start) % len(s["arms"])
                jobs += [(t, a, rep, s.get("model")) for a in orders[t][k:] + orders[t][:k]]
    return jobs


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--spec", required=True)
    a.add_argument("--log", default="runs-round2.jsonl")
    a.add_argument("--parallel", type=int, default=2)
    a.add_argument("--dry-run", action="store_true")
    o = a.parse_args()
    if o.parallel > C.MAX_CONCURRENT:
        raise C.Refused("parallel over the ceiling")
    log = C.AB_HOME / "results" / o.log
    done = {(r["task_id"], r["variant"], r["rep"]) for r in C.read_jsonl(log) if r["status"] == "done"} if log.exists() else set()
    jobs = [j for j in plan(json.loads(open(o.spec).read()), 15) if j[:3] not in done]
    print(f"{len(jobs)} runs to do, {len(done)} done", flush=True)
    if o.dry_run:
        for j in jobs[:12]:
            print(j)
        return 0
    t0, stop = time.time(), {"why": None}

    def one(job):
        task, arm, rep, model = job
        if stop["why"]:
            return
        if time.time() - t0 > LIMIT_S:
            stop["why"] = "batch-time"
            return
        cmd = ["python3", "ab_run.py", "run", "--task", task, "--variant", arm, "--rep-start", str(rep), "--reps", "1",
               "--log", o.log, "--quota-ceiling", CEILING]
        if model:
            cmd += ["--model", model]
        p = subprocess.run(cmd, capture_output=True, text=True)
        print((p.stdout.strip().splitlines() or [""])[-1][:120] or p.stderr.strip()[-200:], flush=True)
        if p.returncode != 0:
            stop["why"] = "refused: " + p.stderr.strip()[-200:]

    with ThreadPoolExecutor(max_workers=o.parallel) as pool:
        list(pool.map(one, jobs))
    print("STOP " + stop["why"] if stop["why"] else "SPEC-DONE", flush=True)
    return 3 if stop["why"] and stop["why"] != "batch-time" else 0


if __name__ == "__main__":
    sys.exit(main())
