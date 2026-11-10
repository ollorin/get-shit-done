#!/usr/bin/env python3
"""evolve gate: decide adopt / reject / more-reps for a candidate arm against the control arm from ab-eval results.

  decide --control A --arm F [--corpus T1,T2] [--canary E6,E7] [--max-usd 10]
  adopt  --id <candidate> --arm F     record adoption (adopted.json, agents/VERSIONS.json, CHANGELOG line); no install
  rollback --id <candidate>           mark rolled back; the adoption commit is reverted with `git revert`

Rules (all counts are runs, never rates alone):
  n < 5 in either arm on any task                      -> MORE-REPS (to 5)
  canary: arm acceptance < control acceptance - 1      -> REJECT (regression)
  corpus score = sum of hidden test cases passed / total, per arm
  Fisher exact one-sided p <= 0.10 for arm > control   -> ADOPT (quality gain)
  p > 0.10 and n < 10                                  -> MORE-REPS (to 10)
  no quality difference at n >= 10 and arm is smaller  -> ADOPT (token saving)   else REJECT
  spend so far > --max-usd                             -> STOP (reported, no decision)
"""
import argparse, json, os, sys, time
from math import comb
from pathlib import Path

HOME = Path(os.environ.get("EVOLVE_HOME", str(Path.home() / "gsd-evolve")))
AB = Path(os.environ.get("AB_HOME", str(Path.home() / "ab-eval")))
FORK = Path(__file__).resolve().parents[2]

def rows():
    p = AB / "results" / "runs.jsonl"
    return [r for r in map(json.loads, p.read_text().splitlines()) if r.get("status") == "done" and not r.get("void_reason")]

def hidden(r):
    fs = (r.get("hidden") or {}).get("files", [])
    return sum((f.get("counts") or {}).get("passed", 0) for f in fs), sum(sum((f.get("counts") or {}).values()) for f in fs)

def fisher(a, b, c, d):  # P(X >= a) for table [[a, b], [c, d]], arm row first
    n, k, m = a + b + c + d, a + c, a + b
    return sum(comb(k, x) * comb(n - k, m - x) for x in range(a, min(k, m) + 1)) / comb(n, m) if n else 1.0

def stats(rs, tasks, variant):
    out = {}
    for t in tasks:
        v = [r for r in rs if r["task_id"] == t and r["variant"] == variant]
        hp = [hidden(r) for r in v]
        out[t] = {"n": len(v), "acc": sum(1 for r in v if r["acceptance_pass"]), "hid_pass": sum(p for p, _ in hp), "hid_total": sum(t_ for _, t_ in hp),
                  "all_hidden_green": sum(1 for p, t_ in hp if t_ and p == t_), "usd": round(sum(r.get("result_cost_usd") or 0 for r in v), 2),
                  "first_turn_tok": round(sum(r.get("first_turn_tok") or 0 for r in v) / len(v)) if v else None}
    return out

def decide(args):
    rs = rows(); corpus = [x for x in args.corpus.split(",") if x]; canary = [x for x in args.canary.split(",") if x]
    C, A = stats(rs, corpus + canary, args.control), stats(rs, corpus + canary, args.arm)
    spend = sum(s["usd"] for s in list(C.values()) + list(A.values()))
    minn = min([s["n"] for s in list(C.values()) + list(A.values())] or [0])
    a, at = sum(A[t]["hid_pass"] for t in corpus), sum(A[t]["hid_total"] for t in corpus)
    c, ct = sum(C[t]["hid_pass"] for t in corpus), sum(C[t]["hid_total"] for t in corpus)
    ra, rc = sum(A[t]["all_hidden_green"] for t in corpus), sum(C[t]["all_hidden_green"] for t in corpus)
    na, nc = sum(A[t]["n"] for t in corpus), sum(C[t]["n"] for t in corpus)
    p = fisher(ra, na - ra, rc, nc - rc)  # run-level (runs are independent; test cases within a run are not)
    canary_reg = [t for t in canary if A[t]["acc"] < C[t]["acc"] - 1]
    tokA = [A[t]["first_turn_tok"] for t in corpus + canary if A[t]["first_turn_tok"]]; tokC = [C[t]["first_turn_tok"] for t in corpus + canary if C[t]["first_turn_tok"]]
    smaller = bool(tokA and tokC and sum(tokA) / len(tokA) < sum(tokC) / len(tokC))
    if spend > args.max_usd: verdict = "STOP (cost cap)"
    elif minn < 5: verdict = "MORE-REPS (to 5)"
    elif canary_reg: verdict = f"REJECT (canary regression {canary_reg})"
    elif p <= 0.10 and ra > rc: verdict = "ADOPT (quality gain)"
    elif minn < 10: verdict = "MORE-REPS (to 10)"
    elif ra >= rc and smaller: verdict = "ADOPT (token saving, no loss)"
    else: verdict = "REJECT (no gain)"
    d = {"when": time.strftime("%Y-%m-%dT%H:%M:%S"), "control": args.control, "arm": args.arm, "verdict": verdict, "p_run_level": round(p, 4),
         "runs_all_hidden_green": {"arm": [ra, na], "control": [rc, nc]}, "hidden_cases": {"arm": [a, at], "control": [c, ct]},
         "min_n": minn, "spend_usd": round(spend, 2), "per_task": {"control": C, "arm": A}}
    HOME.mkdir(parents=True, exist_ok=True)
    with (HOME / "decisions.jsonl").open("a") as f: f.write(json.dumps(d) + "\n")
    print(json.dumps({k: v for k, v in d.items() if k != "per_task"}, indent=1))
    for t in corpus + canary:
        print(f"{t}: control n={C[t]['n']} acc={C[t]['acc']} green={C[t]['all_hidden_green']} cases={C[t]['hid_pass']}/{C[t]['hid_total']} | arm n={A[t]['n']} acc={A[t]['acc']} green={A[t]['all_hidden_green']} cases={A[t]['hid_pass']}/{A[t]['hid_total']}")

def adopt(args):
    cand = json.loads((HOME / "drafts" / args.id / "candidate.json").read_text())
    last = [json.loads(l) for l in (HOME / "decisions.jsonl").read_text().splitlines() if json.loads(l)["arm"] == args.arm][-1]
    if not last["verdict"].startswith("ADOPT"): sys.exit(f"last decision for arm {args.arm} is {last['verdict']}; refusing")
    ad = json.loads((HOME / "adopted.json").read_text()) if (HOME / "adopted.json").exists() else []
    ad.append({**cand, "arm": args.arm, "adopted": time.strftime("%Y-%m-%d"), "decision": {k: last[k] for k in ("verdict", "p_run_level", "runs_all_hidden_green", "min_n")}})
    (HOME / "adopted.json").write_text(json.dumps(ad, indent=1))
    vf = FORK / "agents" / "VERSIONS.json"; v = json.loads(vf.read_text()) if vf.exists() else {}
    v[cand["target"]] = {"rev": v.get(cand["target"], {}).get("rev", 0) + 1, "candidate": cand["id"], "date": time.strftime("%Y-%m-%d")}
    vf.write_text(json.dumps(v, indent=1) + "\n")
    print(f"recorded. Now apply the draft to agents/{cand['target']}.md, add a CHANGELOG line citing decisions.jsonl, commit as one commit `evolve({cand['id']}): adopt`. Rollback = git revert of that commit + `gate.py rollback --id {cand['id']}`.")

def rollback(args):
    p = HOME / "adopted.json"; ad = json.loads(p.read_text())
    for x in ad:
        if x["id"] == args.id: x["rolled_back"] = time.strftime("%Y-%m-%d")
    p.write_text(json.dumps(ad, indent=1)); print("marked rolled back:", args.id)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("decide"); d.add_argument("--control", default="A"); d.add_argument("--arm", required=True); d.add_argument("--corpus", default=""); d.add_argument("--canary", default=""); d.add_argument("--max-usd", type=float, default=10)
    x = sub.add_parser("adopt"); x.add_argument("--id", required=True); x.add_argument("--arm", required=True)
    y = sub.add_parser("rollback"); y.add_argument("--id", required=True)
    a = ap.parse_args(); {"decide": decide, "adopt": adopt, "rollback": rollback}[a.cmd](a)
