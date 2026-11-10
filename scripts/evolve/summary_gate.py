#!/usr/bin/env python3
"""summary gate: deterministic pre-review check of a plan SUMMARY against a tree. No LLM.

  check --rev SHA --summary PATH      broken `path:line` cites (file missing or line past EOF) and unknown / non-ancestor SHAs
  replay                              run the check on every registry entry at its first-attempt SHA and at its fix head:
                                      how many plans would have been stopped before review, and the false-positive floor
"""
import argparse, json, os, re, subprocess, sys
from pathlib import Path

HOME = Path(os.environ.get("EVOLVE_HOME", str(Path.home() / "gsd-evolve")))
REPO = Path(os.environ.get("EVOLVE_REPO", os.environ.get("AB_LIVE_REPO", "/Users/ollorin/igaming-platform")))
CITE = re.compile(r"`?((?:apps|scripts|docs|supabase|libs|packages|\.planning|\.claude|\.github)/[\w./@\[\]\-]+\.\w+):(\d+)(?:-(\d+))?")
SHA = re.compile(r"`([0-9a-f]{7,12})`")
_len = {}

def git(*a):
    return subprocess.run(["git", *a], cwd=str(REPO), capture_output=True, text=True)

def nlines(rev, path):
    k = (rev, path)
    if k not in _len:
        p = git("show", f"{rev}:{path}")
        _len[k] = p.stdout.count("\n") + 1 if p.returncode == 0 else -1
    return _len[k]

def check(rev, summary, strict_sha=False):
    p = git("show", f"{rev}:{summary}")
    if p.returncode: return None
    text, bad = p.stdout, []
    for m in CITE.finditer(text):
        path, hi = m.group(1), int(m.group(3) or m.group(2))
        if path.startswith((".planning/test-runs/", ".tmp/")): continue  # gitignored evidence logs
        n = nlines(rev, path)
        if n < 0 and nlines(rev, "apps/api/" + path) >= 0: n = nlines(rev, "apps/api/" + path)  # apps/api-relative cite
        if n < 0: bad.append(("missing-file", m.group(0)))
        elif hi > n: bad.append(("line-past-eof", f"{m.group(0)} (file has {n})"))
    for s in sorted(set(SHA.findall(text))):
        if git("cat-file", "-e", s + "^{commit}").returncode: bad.append(("unknown-sha", s))
        elif strict_sha and git("merge-base", "--is-ancestor", s, rev).returncode: bad.append(("sha-not-ancestor", s))
    return {"cites": len(CITE.findall(text)), "shas": len(set(SHA.findall(text))), "bad": bad}

def replay(args):
    reg = json.loads((HOME / "registry.json").read_text())["entries"]
    rows = []
    for e in reg:
        pre = e["plan"].rsplit("-", 1)[0] + "-"
        pd = e["phase_dir"] or next((d for d in git("ls-tree", "-d", "--name-only", e["first_attempt"], ".planning/phases/").stdout.split() if Path(d).name.startswith(pre)), None)
        if not pd: continue
        s = f"{pd}/{e['plan']}-SUMMARY.md"
        a, b = check(e["first_attempt"], s), check(e["fix_head"], s)
        if a is None or b is None: continue
        doc_rework = e["classes"].get("D", 0) + e["classes"].get("E", 0)
        rows.append({"plan": e["plan"], "first_bad": len(a["bad"]), "fix_bad": len(b["bad"]), "cites": a["cites"], "doc_rework": doc_rework,
                     "kinds": sorted({k for k, _ in a["bad"]})})
    (HOME / "summary-gate-replay.json").write_text(json.dumps(rows, indent=1))
    n = len(rows); f = [r for r in rows if r["first_bad"]]; g = [r for r in rows if r["fix_bad"]]
    hit = [r for r in f if r["doc_rework"]]; miss = [r for r in rows if not r["first_bad"] and r["doc_rework"]]
    print(f"plans with a SUMMARY at both revs: {n}")
    print(f"flagged at first attempt: {len(f)} ({sum(r['first_bad'] for r in f)} broken cites/SHAs); of those, later had E/D rework: {len(hit)}")
    print(f"not flagged but later had E/D rework: {len(miss)}")
    print(f"still flagged at the fix head (reviewed tree, false-positive ceiling): {len(g)} ({sum(r['fix_bad'] for r in g)} items)")
    kinds = {}
    for r in f:
        for k in r["kinds"]: kinds[k] = kinds.get(k, 0) + 1
    print("kinds at first attempt (plans):", kinds)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check"); c.add_argument("--rev", default="HEAD"); c.add_argument("--summary", required=True)
    sub.add_parser("replay")
    a = ap.parse_args()
    if a.cmd == "replay": replay(a)
    else:
        r = check(a.rev, a.summary)
        if r is None: sys.exit("summary not found at " + a.rev)
        for k, v in r["bad"]: print(k, v)
        print(f"{len(r['bad'])} broken of {r['cites']} cites, {r['shas']} SHAs"); sys.exit(1 if r["bad"] else 0)
