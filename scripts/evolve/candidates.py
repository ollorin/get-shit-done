#!/usr/bin/env python3
"""evolve candidates: turn recurring rework classes in the corpus registry into small instruction or flow edits.

  rank                 classes by rework commits over the registry window, minus classes an adopted rule covers
  draft --class X      write a variant draft (agent file + one inserted rule) under $EVOLVE_HOME/drafts/<id>/

The rule library (RULES) is the reviewed source of candidate text; `rank` only decides which one is tried next.
A class with no library rule is printed as NEEDS-AUTHOR (a Haiku draft + human/Opus review step, not automated here).
"""
import argparse, json, os, sys, time
from pathlib import Path

HOME = Path(os.environ.get("EVOLVE_HOME", str(Path.home() / "gsd-evolve")))
FORK = Path(__file__).resolve().parents[2]
ANCHOR = "**Build rules (what reviews catch most):**"
RULES = {  # class -> (kind, target agent, text)
    "E": ("instruction", "gsd-executor", "- SUMMARY states only what a committed log or `git show` proves: paste the command and its count line; write NOT RUN for anything not run in this session."),
    "D": ("instruction", "gsd-executor", "- Before the SUMMARY commit run `git grep -n` for every renamed symbol, moved line range and changed status code; fix each stale comment, test title and cite it finds."),
    "G": ("flow", "execute-plan", "Run `deno fmt --check`, `deno lint` and the LOC ceiling on touched files as a scripted step before the reviewer is dispatched; a red gate returns to the executor, not to a review round."),
    "T": ("instruction", "gsd-test-writer", "- Each new test names the one-line change to the code under test that would make it fail; if you cannot name one, the test is hollow: delete it."),
    "U": ("instruction", "gsd-executor", "- For each new error arm write the test of the unknown/outage case first: it must return 503 (or Err unknown), never a refusal and never success."),
    "S": ("instruction", "gsd-executor", "- A validation added at one entry point is added at every entry point that writes the same column; list the entry points from `git grep` in SUMMARY."),
    "A": ("instruction", "gsd-executor", "- A new function, view, table or route states who may call it, and its test includes a caller who must be refused."),
    "X": ("instruction", "gsd-executor", "- Write ROLLBACK from the live `pg_get_functiondef`, then apply it once."),
}

def load(name, default):
    p = HOME / name
    return json.loads(p.read_text()) if p.exists() else default

def rank(args):
    reg = load("registry.json", {"entries": []})
    adopted = {d["class"] for d in load("adopted.json", [])}
    tot = {}
    for e in reg["entries"]:
        for k, v in e["classes"].items(): tot[k] = tot.get(k, 0) + v
    rows = sorted(((v, k) for k, v in tot.items() if k != "O"), reverse=True)
    out = [{"class": k, "rework_commits": v, "plans": sum(1 for e in reg["entries"] if k in e["classes"]),
            "status": "adopted" if k in adopted else ("candidate" if k in RULES else "NEEDS-AUTHOR"),
            "kind": RULES.get(k, ("", "", ""))[0], "target": RULES.get(k, ("", "", ""))[1]} for v, k in rows]
    (HOME / "candidates.json").write_text(json.dumps(out, indent=1))
    for r in out: print(f"{r['class']} | {r['rework_commits']} commits | {r['plans']} plans | {r['status']} | {r['kind']} {r['target']}")

def draft(args):
    kind, target, text = RULES[args.cls]
    if kind != "instruction": sys.exit(f"class {args.cls} is a {kind} edit ({target}); apply by hand: {text}")
    src = (FORK / "agents" / f"{target}.md").read_text()
    if text in src: sys.exit("rule already present in " + target)
    if ANCHOR in src: new = src.replace(ANCHOR, ANCHOR + "\n" + text, 1)
    else:
        i = src.rfind("</role>"); assert i > 0, "no insertion point"
        new = src[:i] + text.lstrip("- ") + "\n" + src[i:]
    cid = f"{args.cls}-{time.strftime('%Y%m%d')}"
    d = HOME / "drafts" / cid; d.mkdir(parents=True, exist_ok=True)
    (d / f"gsd2-{target.replace('gsd-', '')}.md").write_text(new.replace("~/.claude/", str(Path.home()) + "/.claude/"))
    (d / "candidate.json").write_text(json.dumps({"id": cid, "class": args.cls, "target": target, "text": text, "chars_delta": len(new) - len(src)}, indent=1))
    print(f"draft {cid}: {target} {len(src)} -> {len(new)} chars at {d}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("rank"); d = sub.add_parser("draft"); d.add_argument("--class", dest="cls", required=True)
    a = ap.parse_args(); {"rank": rank, "draft": draft}[a.cmd](a)
