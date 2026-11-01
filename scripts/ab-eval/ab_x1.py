#!/usr/bin/env python3
"""Experiment 11 X1 aggregator: test-writer E against A on TW1-TW4, plus X0 A-vs-A noise (DESIGN 11, "Order and gates").

Gates are fixed in `.planning/gsd-v2/experiments/11-test-writer-executor-e/PREREG-X0-X1.md`, committed before the first
scored E run. Nothing here reads a result to choose a threshold.

  python3 ab_x1.py gates [--cand E] [--judges opus,claude-fable-5-1] [--out PATH.json]
  python3 ab_x1.py noise [--judges opus,claude-fable-5-1]
  python3 ab_x1.py table                      per-run volume table (markdown)
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402
import ab_volume as V  # noqa: E402

X0_START = "2026-11-01T19:10:00Z"  # runs before this are the wave-2 rows (older build of the snapshots), not used here
TASKS = ("TW1", "TW2", "TW3", "TW4")
BLOATED = ("TW3", "TW4")
CTX_LIMIT = 100_000
LOC_RATIO = 0.8          # DESIGN gate "Volume": LOC at most 0.8 x A
NOISE_FRACTION = 0.5     # PREREG: test_quality non-inferior when delta >= -0.5 x A-vs-A decisive rate
HONESTY_SLACK = 1        # DESIGN: honesty losses at most A + 1


def med(xs: List[float]) -> float:
    return float(statistics.median(xs)) if xs else 0.0


def rows_for(variant: str) -> Dict[str, List[Dict[str, Any]]]:
    sup = {json.loads(l)["run_id"] for l in (C.AB_HOME / "results" / "superseded.jsonl").read_text().splitlines()
           if l.strip()} if (C.AB_HOME / "results" / "superseded.jsonl").exists() else set()
    out: Dict[str, List[Dict[str, Any]]] = {t: [] for t in TASKS}
    for r in C.read_jsonl(C.AB_HOME / "results" / "runs.jsonl"):
        if r.get("variant") == variant and r.get("task_id") in out and r["run_id"] not in sup \
                and r.get("status") == "done" and str(r.get("start_ts", "")) >= X0_START:
            out[r["task_id"]].append(r)
    for t in out:
        out[t].sort(key=lambda r: r.get("rep", 0))
    return out


def share_above(run_id: str) -> Tuple[int, int]:
    """(calls above 100k context, calls) over the subagent transcript of a run."""
    n = hi = 0
    for f in (C.AB_HOME / "runs" / run_id / "transcripts").rglob("agent-*.jsonl"):
        for line in f.read_text(errors="replace").splitlines():
            try:
                o = json.loads(line)
            except ValueError:
                continue
            u = (o.get("message") or {}).get("usage") if o.get("type") == "assistant" else None
            if not u:
                continue
            ctx = sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
            n += 1
            hi += ctx > CTX_LIMIT
    return hi, n


def enrich(r: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, Any]:
    task = C.find_task(cfg, r["task_id"])
    m = V.run_metrics(r["run_id"], task.get("behaviours"))
    hi, n = share_above(r["run_id"])
    cost = r.get("result_cost_usd") or 0.0
    checks = ((C.read_json(C.AB_HOME / "runs" / r["run_id"] / "grade" / "summary.json", {}) or {})
              .get("role_checks") or {}).get("checks") or {}
    return dict(m, task=r["task_id"], rep=r.get("rep"), accepted=bool(r.get("acceptance_pass")), cost=cost,
                first_turn_tok=r.get("first_turn_tok"), calls_hi=hi, calls=n, covered=bool((checks.get("kill_count") or {}).get("ok")),
                honest_claims=None)


def arm_data(variant: str, cfg: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    return {t: [enrich(r, cfg) for r in rs] for t, rs in rows_for(variant).items()}


def per_task_median(data: Dict[str, List[Dict[str, Any]]], key: str) -> Dict[str, float]:
    return {t: med([x[key] for x in rs]) for t, rs in data.items() if rs}


def pair_dim_winner(rows: List[Dict[str, Any]], dim: str) -> Optional[str]:
    """Both orders agree on one arm -> that arm; otherwise 'tie'. None when an order is missing or errored."""
    by = {r["order"]: r for r in rows}
    if set(by) != {"o1", "o2"} or any(r.get("error") for r in by.values()):
        return None
    w = [((r.get("dims") or {}).get(dim) or {}).get("winner") for r in by.values()]
    return w[0] if w[0] == w[1] and w[0] not in (None, "tie") else "tie"


def judgments(judge: str) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in C.read_jsonl(C.AB_HOME / "results" / "judgments.jsonl"):
        if r.get("judge_model") == judge:
            out.setdefault(r["pair_id"], []).append(r)
    return out


def judge_summary(judge: str, kind: str, cand: str, ctl: str) -> Dict[str, Any]:
    """kind: 'x1' (pairs of arms ctl vs cand) or 'x0' (same-arm pairs, A1 vs A2)."""
    res = {"pairs": 0, "tq": {"cand": 0, "ctl": 0, "tie": 0}, "overall": {"cand": 0, "ctl": 0, "tie": 0},
           "honesty_rows_cand_loses": 0, "honesty_rows_ctl_loses": 0, "errors": 0, "per_pair": {}}
    for pid, rows in sorted(judgments(judge).items()):
        first = rows[0]
        if (first.get("cand_arm"), first.get("ctl_arm")) != (cand, ctl):
            continue
        res["pairs"] += 1
        tq = pair_dim_winner(rows, "test_quality")
        ov = None
        by = {r["order"]: r for r in rows}
        if set(by) == {"o1", "o2"} and not any(r.get("error") for r in by.values()):
            w = [r.get("winner") for r in by.values()]
            ov = w[0] if w[0] == w[1] and w[0] not in (None, "tie") else "tie"
        if tq is None or ov is None:
            res["errors"] += 1
            continue
        for key, val in (("tq", tq), ("overall", ov)):
            res[key]["cand" if val == cand else "ctl" if val == ctl else "tie"] += 1
        for r in rows:
            hw = ((r.get("dims") or {}).get("honesty") or {}).get("winner")
            res["honesty_rows_cand_loses"] += hw == ctl
            res["honesty_rows_ctl_loses"] += hw == cand
        res["per_pair"][pid] = {"task": first["task"], "rep": first["rep"], "tq": tq, "overall": ov,
                                "tq_dims": {o: ((r.get("dims") or {}).get("test_quality") or {}).get("winner") for o, r in sorted(by.items())}}
    return res


def noise(judges: List[str]) -> Dict[str, Any]:
    out = {}
    for j in judges:
        s = judge_summary(j, "x0", "A2", "A1")
        n = s["pairs"] - s["errors"]
        decisive = s["tq"]["cand"] + s["tq"]["ctl"]
        o_dec = s["overall"]["cand"] + s["overall"]["ctl"]
        out[j] = {"pairs": n, "tq_decisive": decisive, "tq_decisive_rate": round(decisive / n, 3) if n else None,
                  "overall_decisive": o_dec, "overall_decisive_rate": round(o_dec / n, 3) if n else None,
                  "tq_counts": s["tq"], "overall_counts": s["overall"], "errors": s["errors"],
                  "margin": round(NOISE_FRACTION * decisive / n, 3) if n else None}
    return out


def gates(cand: str, judges: List[str]) -> Dict[str, Any]:
    cfg = C.load_tasks()
    A, E = arm_data("A", cfg), arm_data(cand, cfg)
    g: Dict[str, Any] = {}
    # Acceptance: accepted rate per task at least A, no flip
    acc = {t: (sum(x["accepted"] for x in E[t]) / len(E[t]) if E[t] else None,
               sum(x["accepted"] for x in A[t]) / len(A[t]) if A[t] else None) for t in TASKS}
    bad = [t for t, (e, a) in acc.items() if e is None or a is None or e < a - 1e-9]
    g["acceptance"] = {"pass": not bad, "detail": {t: {"E": e, "A": a, "n_E": len(E[t]), "n_A": len(A[t])} for t, (e, a) in acc.items()}, "flips": bad}
    # Mutants survived
    sa, se = per_task_median(A, "mutants_survived"), per_task_median(E, "mutants_survived")
    g["mutants_survived"] = {"pass": sum(se.values()) <= sum(sa.values()), "E": se, "A": sa, "sumE": sum(se.values()), "sumA": sum(sa.values())}
    # Volume
    la, le = per_task_median(A, "net_loc"), per_task_median(E, "net_loc")
    ca, ce = per_task_median(A, "net_cases"), per_task_median(E, "net_cases")
    sumA, sumE = sum(la.values()), sum(le.values())
    loc_ok = sumE <= LOC_RATIO * sumA if sumA > 0 else sumE <= sumA
    g["volume"] = {"pass": loc_ok and sum(ce.values()) <= sum(ca.values()), "loc_E": le, "loc_A": la, "sum_loc_E": sumE,
                   "sum_loc_A": sumA, "ratio": round(sumE / sumA, 3) if sumA else None,
                   "cases_E": ce, "cases_A": ca, "sum_cases_E": sum(ce.values()), "sum_cases_A": sum(ca.values())}
    # Bloated start
    bl = {}
    for t in BLOATED:
        n = len(E[t])
        cov = sum(x["covered"] for x in E[t])
        bl[t] = {"median_net_loc_E": med([x["net_loc"] for x in E[t]]), "covered_reps": f"{cov}/{n}",
                 "ok": bool(n) and med([x["net_loc"] for x in E[t]]) <= 0 and cov * 2 > n}
    g["bloated_start"] = {"pass": all(v["ok"] for v in bl.values()), "detail": bl,
                          "A_median_net_loc": {t: med([x["net_loc"] for x in A[t]]) for t in BLOATED}}
    # Kills per added case
    ka, ke = per_task_median(A, "kills_per_added_case"), per_task_median(E, "kills_per_added_case")
    g["kills_per_added_case"] = {"pass": sum(ke.values()) >= sum(ka.values()), "E": ke, "A": ka, "sumE": round(sum(ke.values()), 3), "sumA": round(sum(ka.values()), 3)}
    # Judges
    g["judges"] = {}
    nz = noise(judges)
    for j in judges:
        s = judge_summary(j, "x1", cand, "A")
        n = s["pairs"] - s["errors"]
        delta = (s["tq"]["cand"] - s["tq"]["ctl"]) / n if n else None
        margin = (nz.get(j) or {}).get("margin")
        tq_pass = None if (delta is None or margin is None) else delta >= -margin
        hon = {"E_loses": s["honesty_rows_cand_loses"], "A_loses": s["honesty_rows_ctl_loses"]}
        g["judges"][j] = {"pairs": n, "errors": s["errors"], "test_quality": s["tq"], "delta": None if delta is None else round(delta, 3),
                          "noise_margin": margin, "test_quality_pass": tq_pass, "overall": s["overall"], "honesty_rows": hon,
                          "honesty_pass": hon["E_loses"] <= hon["A_loses"] + HONESTY_SLACK, "per_pair": s["per_pair"]}
    # Cost, share above 100k, first-turn tokens
    cA, cE = per_task_median(A, "cost"), per_task_median(E, "cost")
    g["cost"] = {"pass": sum(cE.values()) <= sum(cA.values()), "E": cE, "A": cA, "sumE": round(sum(cE.values()), 3), "sumA": round(sum(cA.values()), 3)}

    def share(d):
        hi = sum(x["calls_hi"] for rs in d.values() for x in rs)
        n = sum(x["calls"] for rs in d.values() for x in rs)
        return {"calls_hi": hi, "calls": n, "share": round(hi / n, 4) if n else None}
    sA, sE = share(A), share(E)
    g["share_above_100k"] = {"pass": (sE["share"] or 0) <= (sA["share"] or 0), "E": sE, "A": sA}
    g["first_turn_tokens"] = {"E": per_task_median(E, "first_turn_tok"), "A": per_task_median(A, "first_turn_tok")}
    g["n_runs"] = {"A": {t: len(A[t]) for t in TASKS}, cand: {t: len(E[t]) for t in TASKS}}
    g["per_run"] = {"A": A, cand: E}
    g["noise"] = nz
    return g


def table(cand: str = "E") -> str:
    cfg = C.load_tasks()
    lines = ["| run | arm | acc | cases+ | cases- | loc+ | loc- | net loc | killed/total | kills/case | cost $ | 1st-turn tok | calls>100k |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for arm in ("A", cand):
        for t, rs in arm_data(arm, cfg).items():
            for x in rs:
                lines.append(f"| {x['run_id'].split('-2026')[0]} | {arm} | {'Y' if x['accepted'] else 'N'} | {x['cases_added']} | {x['cases_removed']} | "
                             f"{x['loc_added']} | {x['loc_removed']} | {x['net_loc']} | {x['mutants_killed']}/{x['mutants_total']} | {x['kills_per_added_case']} | "
                             f"{x['cost']:.2f} | {x['first_turn_tok']} | {x['calls_hi']}/{x['calls']} |")
    return "\n".join(lines)


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("gates", "noise", "table"):
        s = sub.add_parser(name)
        s.add_argument("--cand", default="E")
        s.add_argument("--judges", default="opus,claude-fable-5-1")
        s.add_argument("--out", default=None)
    a = p.parse_args(argv)
    judges = a.judges.split(",")
    if a.cmd == "table":
        print(table(a.cand))
        return 0
    res = noise(judges) if a.cmd == "noise" else gates(a.cand, judges)
    txt = json.dumps(res, indent=1, default=str)
    if a.out:
        Path(a.out).write_text(txt)
    print(txt if a.cmd == "noise" else json.dumps({k: (v.get("pass") if isinstance(v, dict) and "pass" in v else v) for k, v in res.items() if k not in ("per_run",)}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
