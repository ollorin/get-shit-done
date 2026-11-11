#!/usr/bin/env python3
"""evolve replay: turn calibrated registry entries into ab-eval executor tasks (id RP-<plan>) in $AB_HOME/tasks.json.

  make [--plan P] [--max-tasks N]   base = tree before the first attempt, brief = the plan as committed at base,
                                    hidden = rework unit tests at the fix head that are green there and red (by
                                    assertion) on the first-attempt tree. Score = hidden cases a replay passes,
                                    i.e. real review findings avoided on the first attempt.
"""
import argparse, json, os, re, subprocess, sys
from pathlib import Path

HOME = Path(os.environ.get("EVOLVE_HOME", str(Path.home() / "gsd-evolve")))
AB = Path(os.environ.get("AB_HOME", str(Path.home() / "ab-eval")))
REPO = Path(os.environ.get("EVOLVE_REPO", os.environ.get("AB_LIVE_REPO", "/Users/ollorin/igaming-platform")))

def git(*a, check=True):
    p = subprocess.run(["git", *a], cwd=str(REPO), capture_output=True, text=True)
    if check and p.returncode: raise RuntimeError(p.stderr.strip()[-200:])
    return p.stdout

def make(args):
    reg = json.loads((HOME / "registry.json").read_text())
    cfg = json.loads((AB / "tasks.json").read_text()); have = {t["id"] for t in cfg["tasks"]}
    made = 0
    for e in reg["entries"]:
        rep = (e.get("calibration") or {}).get("replayable") or []
        if not rep or args.plan not in (None, e["plan"]): continue
        if not e["phase_dir"]:
            pre = e["plan"].rsplit("-", 1)[0] + "-"
            e["phase_dir"] = next((d for d in git("ls-tree", "-d", "--name-only", e["base"], ".planning/phases/").split() if Path(d).name.startswith(pre)), None)
            if not e["phase_dir"]: continue
        tid = "RP-" + e["plan"]
        subj = [l.split("\t") for l in git("log", "--reverse", "--format=%H\t%s", "-F", f"--grep=({e['plan']}):", f"{e['first_attempt']}").splitlines()]
        ex = next((h for h, s_ in subj if not s_.startswith("docs(")), None)
        if ex: e["base"] = git("rev-parse", ex + "^").strip()[:12]
        if tid in have: continue
        phase, num = e["plan"].rsplit("-", 1)
        plan = f"{e['phase_dir']}/{e['plan']}-PLAN.md"
        if subprocess.run(["git", "cat-file", "-e", f"{e['base']}:{plan}"], cwd=str(REPO), capture_output=True).returncode:
            print(tid, "skip: plan not committed at base"); continue
        text = git("show", f"{e['base']}:{plan}")
        blocks = re.findall(r"<task\b.*?</task>", text, re.S)
        keys = {Path(f).name for f in rep} | {Path(f).name.replace(".test.ts", ".ts") for f in rep}
        sel = [(i + 1, re.search(r"<name>(.*?)</name>", b, re.S).group(1).strip()) for i, b in enumerate(blocks)
               if re.search(r"<name>", b) and any(k in b for k in keys)
               and not re.search(r"review|mutation|mutant|precondition|threat-model|ready for train", re.search(r"<name>(.*?)</name>", b, re.S).group(1), re.I)]
        if not sel or len(sel) > args.max_plan_tasks: print(tid, f"skip: {len(sel)} of {len(blocks)} plan tasks name the tested files"); continue
        names = [n for _, n in sel]
        files = sorted({m for b in (blocks[i - 1] for i, _ in sel) for m in re.findall(r"(?:apps|supabase|docs|scripts)/[\w./@\-\[\]]+\.\w+", (re.search(r"<files>(.*?)</files>", b, re.S) or [None, ""])[1])})
        cfg["tasks"].append({
            "id": tid, "role": "executor", "agent": "gsd-executor", "model": "haiku", "tier": "replay", "plan": plan,
            "phase_dir": e["phase_dir"], "phase_number": phase, "phase_name": Path(e["phase_dir"]).name.split("-", 1)[1],
            "plan_number": num, "task_range": ",".join(str(i) for i, _ in sel), "task_names": names, "tasks": [i for i, _ in sel],
            "base": e["base"], "ref": [e["fix_head"]], "scope_files": sorted(set(files) | set(rep)), "verify": [],
            "hidden": [f"{f}@{e['fix_head']}" for f in rep], "tdd": False, "budget_usd": 8, "timeout_min": 60,
            "scrub_terms": [e["plan"]], "enabled": True, "scope_note": "Predecessor plans are complete and merged in this tree; their planning artifacts and commits are not visible here. Do not stop on a precondition that looks for them.", "calibration": {"mode": "tests", "base_red": "hidden"},
            "evolve": {"first_attempt": e["first_attempt"], "classes": e["classes"], "rework_commits": e["rework_commits"]}})
        made += 1; print(tid, f"tasks={len(names)} hidden={len(rep)} scope={len(set(files) | set(rep))}")
        if made >= args.max_tasks: break
    (AB / "tasks.json").write_text(json.dumps(cfg, indent=1))

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make"); m.add_argument("--plan"); m.add_argument("--max-tasks", type=int, default=20); m.add_argument("--max-plan-tasks", type=int, default=4)
    a = ap.parse_args(); make(a)
