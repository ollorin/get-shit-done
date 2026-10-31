#!/usr/bin/env python3
"""Deterministic stand-in for a coordinator's child agent (DESIGN-ALL-AGENTS §2.3, C1-C3).

  stub_child.py --role executor|verifier|plan-checker|docs-updater|test-writer|review [--plan 398-02] [--phase 398]

Runs inside the run snapshot (cwd = repo). $AB_RUN_DIR/stub/scenario.json decides what each attempt does:
  {"plans": {"398-02": ["lie", "ok"], "398-03": ["ok"]}, "duration_s": {"398-03": 420}, "default_duration_s": 2}
Attempts beyond the list are "ok". Every call appends one row to $AB_RUN_DIR/stub/events.jsonl; the decision
oracle (ab_coord.py) reads those rows plus the final tree. Standard library only.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

RUN_DIR = Path(os.environ.get("AB_RUN_DIR", "")) if os.environ.get("AB_RUN_DIR") else None
STUB = (RUN_DIR / "stub") if RUN_DIR else None


def read_json(path: Path, default):
    return json.loads(path.read_text()) if path and path.exists() else default


def phase_dir(phase: str) -> Path:
    hits = sorted(glob.glob(f".planning/phases/{phase}-*"))
    return Path(hits[0]) if hits else Path(f".planning/phases/{phase}")


def summary_ok(plan: str) -> bool:
    d = phase_dir(plan.split("-")[0])
    s = d / f"{plan}-SUMMARY.md"
    return s.exists() and "Self-Check: PASSED" in s.read_text(errors="replace")


def deps_of(plan: str) -> list:
    d = phase_dir(plan.split("-")[0])
    f = d / f"{plan}-PLAN.md"
    if not f.exists():
        return []
    m = re.search(r"^depends_on:\s*\[(.*?)\]", f.read_text(errors="replace"), re.M)
    if not m:
        return []
    out = []
    for tok in m.group(1).split(","):
        tok = tok.strip().strip("'\"")
        if re.fullmatch(r"\d+-\d+", tok):
            out.append(tok)
        elif re.fullmatch(r"\d+", tok):
            out.append(f"{plan.split('-')[0]}-{int(tok):02d}")
    return out


def next_attempt(key: str) -> int:
    state_path = STUB / "state.json"
    state = read_json(state_path, {})
    state[key] = state.get(key, 0) + 1
    state_path.write_text(json.dumps(state))
    return state[key]


def event(row: dict) -> None:
    row = {"ts": time.time(), **row}
    with open(STUB / "events.jsonl", "a") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")


def commit(message: str) -> str:
    subprocess.run(["git", "add", "-A"], check=False)
    subprocess.run(["git", "-c", "user.name=stub", "-c", "user.email=stub@localhost", "commit", "-q",
                    "--no-verify", "-m", message], check=False, capture_output=True)
    return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()


def executor(plan: str, scenario: dict) -> str:
    phase = plan.split("-")[0]
    attempt = next_attempt(f"executor:{plan}")
    actions = scenario.get("plans", {}).get(plan, [])
    action = actions[attempt - 1] if attempt <= len(actions) else "ok"
    duration = float(scenario.get("duration_s", {}).get(plan, scenario.get("default_duration_s", 2)))
    deps_ok = all(summary_ok(d) for d in deps_of(plan))
    event({"role": "executor", "plan": plan, "attempt": attempt, "action": action, "phase": "start",
           "deps_ok": deps_ok})
    if action == "die":
        event({"role": "executor", "plan": plan, "attempt": attempt, "action": action, "phase": "end"})
        return ("API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\","
                "\"message\":\"Overloaded\"}}")
    time.sleep(duration if action == "ok" else min(duration, 2))
    d = phase_dir(phase)
    d.mkdir(parents=True, exist_ok=True)
    check = "PASSED" if action == "ok" else "FAILED"
    (d / f"{plan}-SUMMARY.md").write_text(
        f"# Plan {plan} summary\n\nStub executor run (attempt {attempt}).\n\n## Self-Check: {check}\n\n"
        "## Defect Classes\n\n| class | instance | caught_by | severity | rule_gap |\n|---|---|---|---|---|\n"
        "| stub class | stub.ts:1 | other | minor | none |\n")
    sha = commit(f"feat({plan}): stub") if action == "ok" else ""
    event({"role": "executor", "plan": plan, "attempt": attempt, "action": action, "phase": "end", "commit": sha})
    return (f"## PLAN COMPLETE\n\n**Plan:** {plan}\n**Tasks:** 1/1\n**SUMMARY:** {d}/{plan}-SUMMARY.md\n"
            f"**Commits:**\n- {sha or 'none'}: feat({plan}): stub\n\n```json\n"
            f"{json.dumps({'status': 'complete', 'phase': int(phase), 'plan': plan, 'completed_tasks': 1, 'total_tasks': 1})}"
            "\n```")


def verifier(phase: str, scenario: dict) -> str:
    attempt = next_attempt(f"verifier:{phase}")
    event({"role": "verifier", "phase": phase, "attempt": attempt, "action": "ok"})
    d = phase_dir(phase)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{phase}-VERIFICATION.md").write_text(
        f"---\nphase: {phase}\nstatus: passed\nverifier: stub\n---\n\n# Phase {phase} verification\n\nAll must-haves met (stub).\n")
    commit(f"docs({phase}): phase verification (stub)")
    return f"## Verification Passed\n\nstatus: passed\nVERIFICATION: {d}/{phase}-VERIFICATION.md"


def generic(role: str, args, scenario: dict) -> str:
    key = args.plan or args.phase or "-"
    attempt = next_attempt(f"{role}:{key}")
    event({"role": role, "plan": args.plan, "phase": args.phase, "attempt": attempt, "action": "ok"})
    if role == "review":
        return "```json\n{\"findings\": [], \"summary\": \"0 findings\"}\n```"
    if role == "plan-checker":
        return "## VERIFICATION PASSED\n\nNone found. (reviewed by: plan-check)"
    if role == "docs-updater":
        Path("docs").mkdir(exist_ok=True)
        f = Path("docs") / f"stub-{(args.plan or 'x')}.md"
        f.write_text("# Stub doc\n")
        sha = commit(f"docs({args.plan or 'x'}): stub")
        return json.dumps({"written_files": [str(f)], "commit": sha, "errors": []})
    if role == "test-writer":
        return "## TESTS WRITTEN\n\nNo new tests needed (stub)."
    return "OK (stub)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", required=True)
    ap.add_argument("--plan", default="")
    ap.add_argument("--phase", default="")
    args = ap.parse_args()
    if STUB is None:
        print("stub_child: AB_RUN_DIR is not set", file=sys.stderr)
        return 2
    STUB.mkdir(parents=True, exist_ok=True)
    scenario = read_json(STUB / "scenario.json", {})
    plan = args.plan.strip()
    phase = (args.phase or plan.split("-")[0]).strip()
    if args.role == "executor" and plan:
        print(executor(plan, scenario))
    elif args.role == "verifier" and phase:
        print(verifier(phase, scenario))
    else:
        print(generic(args.role, args, scenario))
    return 0


if __name__ == "__main__":
    sys.exit(main())
