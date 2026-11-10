#!/usr/bin/env python3
"""evolve corpus: grow a registry of real (first attempt -> review rework) pairs from git history.

  build      scan plan-tagged commits of a repo; one registry entry per plan that was reworked after its SUMMARY
  calibrate  for each entry, find rework unit tests that are RED on the first-attempt tree, GREEN on the fix tree
             and already runnable at base (so a replay from base can be scored by them). No LLM, no stack.
  show       print the registry as a table

Registry: $EVOLVE_HOME/registry.json (default ~/gsd-evolve). The source repo is only read (git log/show/archive).
"""
import argparse, json, os, re, subprocess, sys, tempfile, shutil, time
from pathlib import Path

HOME = Path(os.environ.get("EVOLVE_HOME", str(Path.home() / "gsd-evolve")))
REPO = Path(os.environ.get("EVOLVE_REPO", os.environ.get("AB_LIVE_REPO", "/Users/ollorin/igaming-platform")))
SUBJ = re.compile(r"^(\w+)\((\d+(?:\.\d+)?-\d+)\): (.*)$")
UNIT = re.compile(r"^apps/api/.*(?<!integration)\.test\.ts$")
CLASSES = [  # finding class -> subject regex (same letters as the review mining, .tmp/review-mining-B.md)
    ("E", r"SUMMARY|Self-Check|evidence|review round|rounds|register|count|record"),
    ("D", r"stale|cite|comment|wording|docs?\b"),
    ("G", r"\bfmt\b|lint|LOC|ceiling"),
    ("U", r"503|unknown|classif|unavailable|fail-closed|error arm|outage"),
    ("T", r"\bred\b|RED|mutant|assert|vacuous|hollow|pin"),
    ("S", r"valid|NUL|surrogate|cap\b|length|sanitiz|escape"),
    ("A", r"authz|grant|role|permission|deny|owner"),
    ("X", r"ROLLBACK|migration|search_path"),
]

def git(*a, cwd=REPO, check=True):
    p = subprocess.run(["git", *a], cwd=str(cwd), capture_output=True, text=True)
    if check and p.returncode: raise RuntimeError(p.stderr.strip()[-300:])
    return p.stdout

def classify(subject):
    return [c for c, rx in CLASSES if re.search(rx, subject, re.I if c not in ("T",) else 0)] or ["O"]

def build(args):
    log = git("log", "--reverse", "--format=%H\t%ct\t%s", f"--since={args.since}")
    plans = {}
    for line in log.splitlines():
        sha, ct, subj = line.split("\t", 2)
        m = SUBJ.match(subj)
        if m: plans.setdefault(m.group(2), []).append({"sha": sha[:12], "ct": int(ct), "type": m.group(1), "subject": m.group(3)})
    old = {e["plan"]: e for e in json.loads((HOME / "registry.json").read_text())["entries"]} if (HOME / "registry.json").exists() else {}
    entries = []
    for plan, cs in sorted(plans.items()):
        si = next((i for i, c in enumerate(cs) if c["type"] == "docs" and "SUMMARY" in c["subject"]), None)
        if si is None or si == len(cs) - 1: continue
        rework = cs[si + 1:]
        code = [c for c in rework if c["type"] in ("fix", "test", "refactor", "feat")]
        tests = {}
        for c in code:
            for f in git("show", "--name-only", "--format=", c["sha"]).split():
                if UNIT.match(f): tests[f] = c["sha"]  # last rework commit touching the file
        cls = {}
        for c in rework:
            for k in classify(c["subject"]): cls[k] = cls.get(k, 0) + 1
        phase_dirs = git("ls-tree", "-d", "--name-only", cs[0]["sha"], ".planning/phases/").split()  # at the attempt, phases get archived later
        pd = next((d for d in phase_dirs if Path(d).name.startswith(plan.rsplit("-", 1)[0] + "-")), None)
        e = {"plan": plan, "phase_dir": pd, "base": git("rev-parse", cs[0]["sha"] + "^").strip()[:12],
             "first_attempt": cs[si]["sha"], "fix_head": rework[-1]["sha"], "attempt_commits": si + 1,
             "rework_commits": len(rework), "rework_code_commits": len(code), "classes": cls,
             "rework_unit_tests": tests, "rework_subjects": [c["type"] + ": " + c["subject"][:110] for c in code][:25],
             "added": old.get(plan, {}).get("added", time.strftime("%Y-%m-%d"))}
        if plan in old and "calibration" in old[plan] and old[plan].get("fix_head") == e["fix_head"]:
            e["calibration"] = old[plan]["calibration"]
        entries.append(e)
    HOME.mkdir(parents=True, exist_ok=True)
    (HOME / "registry.json").write_text(json.dumps({"repo": str(REPO), "built": time.strftime("%Y-%m-%dT%H:%M:%S"), "entries": entries}, indent=1))
    print(f"registry: {len(entries)} reworked plans of {len(plans)} plan tags; {sum(1 for e in entries if e['rework_unit_tests'])} with rework unit tests; new {sum(1 for e in entries if e['plan'] not in old)}")

def tree(sha, dest):
    dest.mkdir(parents=True)
    a = subprocess.Popen(["git", "archive", sha, "apps/api", "deno.lock", "supabase", "scripts"], cwd=str(REPO), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    subprocess.run(["tar", "-x", "-C", str(dest)], stdin=a.stdout, check=False); a.wait()
    env = REPO / "apps/api/.env.test"
    if env.exists() and (dest / "apps/api").exists(): shutil.copy2(env, dest / "apps/api/.env.test")

def run_test(root, rel, timeout=300):
    cwd = root / "apps/api"
    try:
        p = subprocess.run(["deno", "task", "test", os.path.relpath(root / rel, cwd)], cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "timeout", ""
    out = p.stdout + p.stderr
    if p.returncode == 0: return "green", out
    if re.search(r"Module not found|Cannot find module|TS2305|TS2307|TS2339|TS2554|TS2345|error: TS|does not provide an export|is not a function|TypeError", out): return "red-api", out
    if re.search(r"AssertionError|expect\(|Expected|FAILED", out): return "red-assert", out
    return "red-other", out

def calibrate(args):
    reg = json.loads((HOME / "registry.json").read_text())
    todo = [e for e in reg["entries"] if e["rework_unit_tests"] and (args.plan in (None, e["plan"])) and ("calibration" not in e or args.force)]
    todo = todo[: args.limit]
    for e in todo:
        tmp = Path(tempfile.mkdtemp(prefix="evolve-", dir=str(HOME)))
        try:
            tree(e["base"], tmp / "base"); tree(e["first_attempt"], tmp / "first"); tree(e["fix_head"], tmp / "fix")
            res = {}
            for f in sorted(e["rework_unit_tests"])[: args.max_tests]:
                if not (tmp / "fix" / f).exists(): res[f] = {"usable": False, "why": "deleted at fix head"}; continue
                fix, _ = run_test(tmp / "fix", f)
                (tmp / "first" / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy2(tmp / "fix" / f, tmp / "first" / f)
                first, _ = run_test(tmp / "first", f)
                (tmp / "base" / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy2(tmp / "fix" / f, tmp / "base" / f)
                base, _ = run_test(tmp / "base", f)
                res[f] = {"fix": fix, "first": first, "base": base,
                          "usable": fix == "green" and first == "red-assert" and base == "red-assert"}
            e["calibration"] = {"when": time.strftime("%Y-%m-%d"), "tests": res, "replayable": [f for f, r in res.items() if r.get("usable")]}
            print(e["plan"], {Path(f).name: (r.get("fix"), r.get("first"), r.get("base")) for f, r in res.items()})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        (HOME / "registry.json").write_text(json.dumps(reg, indent=1))

def show(args):
    reg = json.loads((HOME / "registry.json").read_text())
    print("plan | base | first | rework commits (code) | classes | rework unit tests | replayable")
    for e in reg["entries"]:
        c = e.get("calibration")
        print(f"{e['plan']} | {e['base'][:9]} | {e['first_attempt'][:9]} | {e['rework_commits']} ({e['rework_code_commits']}) | "
              f"{' '.join(f'{k}{v}' for k, v in sorted(e['classes'].items()))} | {len(e['rework_unit_tests'])} | {len(c['replayable']) if c else '-'}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--since", default="2026-10-01")
    c = sub.add_parser("calibrate"); c.add_argument("--plan"); c.add_argument("--limit", type=int, default=5); c.add_argument("--max-tests", type=int, default=6); c.add_argument("--force", action="store_true")
    sub.add_parser("show")
    a = ap.parse_args(); {"build": build, "calibrate": calibrate, "show": show}[a.cmd](a)
