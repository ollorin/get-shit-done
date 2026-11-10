#!/usr/bin/env python3
"""evolve run: the phase-end trigger. One pass, no human in the loop, bounded by --max-usd.

  1 corpus build (new reworked plans since last run)      2 corpus calibrate --limit N (no LLM)
  3 replay make (new RP-* tasks)                           4 candidates rank
  5 if --arm is given: ab-eval runs for control and arm on the corpus tasks + canary until gate says
    ADOPT / REJECT / STOP, 5 reps first, then up to 10. Never installs: an ADOPT only writes decisions.jsonl.
Steps 1-4 cost nothing. Step 5 is skipped with --dry-run (default) so a phase end only grows the corpus.
"""
import argparse, json, os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ABEVAL = HERE.parent / "ab-eval"

def sh(*cmd, cwd=HERE):
    print("+", " ".join(cmd), flush=True)
    return subprocess.run([sys.executable, *cmd], cwd=str(cwd)).returncode

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-01"); ap.add_argument("--calibrate-limit", type=int, default=5)
    ap.add_argument("--arm"); ap.add_argument("--control", default="A"); ap.add_argument("--corpus", default=""); ap.add_argument("--canary", default="E6,E7")
    ap.add_argument("--max-usd", type=float, default=10); ap.add_argument("--dry-run", action="store_true", default=False)
    a = ap.parse_args()
    sh("corpus.py", "build", "--since", a.since); sh("corpus.py", "calibrate", "--limit", str(a.calibrate_limit))
    sh("replay.py", "make"); sh("candidates.py", "rank")
    if not a.arm or a.dry_run: return
    tasks = [t for t in (a.corpus + "," + a.canary).split(",") if t]
    for target in (5, 10):
        for t in tasks:
            rows = [json.loads(l) for l in (Path(os.environ.get("AB_HOME", str(Path.home() / "ab-eval"))) / "results" / "runs.jsonl").read_text().splitlines()]
            have = {v: sum(1 for r in rows if r["task_id"] == t and r["variant"] == v and r.get("status") == "done" and not r.get("void_reason")) for v in (a.control, a.arm)}
            procs = [subprocess.Popen([sys.executable, "ab_run.py", "run", "--task", t, "--variant", v, "--reps", str(target - have[v]), "--rep-start", str(have[v] + 1)], cwd=str(ABEVAL))
                     for v in (a.control, a.arm) if have[v] < target]
            for p in procs: p.wait()  # 2 Haiku runs in parallel, never more
        subprocess.run([sys.executable, "gate.py", "decide", "--control", a.control, "--arm", a.arm, "--corpus", a.corpus, "--canary", a.canary, "--max-usd", str(a.max_usd)], cwd=str(HERE))
        last = json.loads((Path(os.environ.get("EVOLVE_HOME", str(Path.home() / "gsd-evolve"))) / "decisions.jsonl").read_text().splitlines()[-1])
        if not last["verdict"].startswith("MORE-REPS"): break

if __name__ == "__main__":
    main()
