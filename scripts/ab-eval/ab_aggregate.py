#!/usr/bin/env python3
"""Apply the six decision gates (DESIGN §6.2) and print the decision table (DESIGN §7.7).

  python3 ab_aggregate.py [--judge-model opus] [--variant-b B]

Gates whose inputs are absent are NOT_EVALUATED, never PASS. G3's known-defect part is reported as n/a
(and passes vacuously) when the run set has no task with known items. decision.accepted is true only when
all six gates PASS.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402

PASS, FAIL, NOT_EVALUATED = "PASS", "FAIL", "NOT_EVALUATED"
MANIFEST_TOL = 0.05       # G1: loaded chars within 5 % of the variant's expected size
BOOT_RESAMPLES = 10000


def load_runs() -> List[Dict[str, Any]]:
    path = C.AB_HOME / "results" / "runs.jsonl"
    return [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()] if path.exists() else []


def usable(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Void runs are re-run, not counted (DESIGN §4.3, S8)."""
    return [r for r in rows if r["status"] in ("done", "failed")]


def by(rows: List[Dict[str, Any]], variant: str) -> List[Dict[str, Any]]:
    return [r for r in rows if r["variant"] == variant]


def g1_manipulation(rows: List[Dict[str, Any]], variant: str) -> Tuple[str, str]:
    expected = C.read_json(C.variant_dir(variant) / "expected.json", {}).get("inherited_chars")
    vrows = by(rows, variant)
    if not vrows:
        return NOT_EVALUATED, f"no {variant} runs"
    if not expected:
        return NOT_EVALUATED, f"variants/{variant}/expected.json missing"
    bad = []
    for r in vrows:
        measured = sum(i["chars"] for i in r.get("instructions", []) if "/repo/" in i["path"])
        if abs(measured - expected) / expected > MANIFEST_TOL:
            bad.append(f"{r['run_id']}={measured}")
    if bad:
        return FAIL, f"expected {expected} chars +/-5%; off: {', '.join(bad)}"
    return PASS, f"{len(vrows)} runs within 5% of {expected} inherited chars"


def g2_acceptance(rows: List[Dict[str, Any]], a: str, b: str) -> Tuple[str, str]:
    ra, rb = usable(by(rows, a)), usable(by(rows, b))
    if not ra or not rb:
        return NOT_EVALUATED, f"needs both arms (A={len(ra)}, B={len(rb)})"
    sa = sum(1 for r in ra if r["acceptance_pass"])
    sb = sum(1 for r in rb if r["acceptance_pass"])
    flips = []
    for t in sorted({r["task_id"] for r in ra}):
        ta = [r for r in ra if r["task_id"] == t]
        tb = [r for r in rb if r["task_id"] == t]
        if not tb:
            continue
        rate_a = sum(r["acceptance_pass"] for r in ta) / len(ta)
        rate_b = sum(r["acceptance_pass"] for r in tb) / len(tb)
        if rate_a >= 2 / 3 and rate_b <= 1 / 3:
            flips.append(t)
    ok = sb >= sa - 1 and not flips
    detail = f"acceptance A={sa}/{len(ra)} B={sb}/{len(rb)}; task flips={flips or 'none'}"
    return (PASS if ok else FAIL), detail


def latest_matches(matches: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """One match row per run (the last appended wins); errored matches are dropped."""
    out: Dict[str, Dict[str, Any]] = {}
    for m in matches:
        if m.get("error") is None and m.get("found") is not None:
            out[m["run_id"]] = m
    return out


def g3_secondary(rows: List[Dict[str, Any]], a: str, b: str,
                 matches: Optional[List[Dict[str, Any]]] = None) -> Tuple[str, str]:
    """DESIGN §6.2 G3: hidden mean, fail-first proofs, known-defect recall, and every required item."""
    ra, rb = usable(by(rows, a)), usable(by(rows, b))
    if not ra or not rb:
        return NOT_EVALUATED, "needs both arms"
    parts: List[str] = []
    ok = True
    ha = [r["hidden"]["pass"] for r in ra if r.get("hidden")]
    hb = [r["hidden"]["pass"] for r in rb if r.get("hidden")]
    if ha and hb:
        hidden_ok = statistics.mean(hb) >= statistics.mean(ha) - 0.05
        ok = ok and hidden_ok
        parts.append(f"hidden mean A={_mean(ha)} B={_mean(hb)} (ok={hidden_ok})")
    else:
        parts.append("hidden: n/a (no calibrated hidden oracle on both arms)")
    fa = sum(1 for r in ra if r.get("fail_first") == "proven")
    fb = sum(1 for r in rb if r.get("fail_first") == "proven")
    ff_ok = fb >= fa - 1
    ok = ok and ff_ok
    parts.append(f"fail_first proven A={fa} B={fb} (ok={ff_ok}; statuses A={_status_counts(ra, 'fail_first')} "
                 f"B={_status_counts(rb, 'fail_first')})")
    mm = latest_matches(matches or [])
    ma = {r["run_id"]: mm[r["run_id"]] for r in ra if r["run_id"] in mm}
    mb = {r["run_id"]: mm[r["run_id"]] for r in rb if r["run_id"] in mm}
    if ma and mb:
        ra_mean = statistics.mean(m["known_recall"] for m in ma.values())
        rb_mean = statistics.mean(m["known_recall"] for m in mb.values())
        kr_ok = rb_mean >= ra_mean - 0.10
        req_bad = _required_regressions(ma, mb)
        ok = ok and kr_ok and not req_bad
        parts.append(f"known_recall A={ra_mean:.2f} B={rb_mean:.2f} (ok={kr_ok}); required items B-short={req_bad or 'none'}")
    else:
        parts.append("known_recall: n/a (no known-defect tasks matched on both arms)")
    return (PASS if ok else FAIL), "; ".join(parts)


def _status_counts(rows: List[Dict[str, Any]], key: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        out[str(r.get(key))] = out.get(str(r.get(key)), 0) + 1
    return out


def _required_regressions(ma: Dict[str, Dict[str, Any]], mb: Dict[str, Dict[str, Any]]) -> List[str]:
    """DESIGN G3: every required item must be found by B in at least (A's count - 1) runs of its task."""
    short = []
    keys = sorted({(m["task_id"], item) for m in list(ma.values()) + list(mb.values())
                   for item in (m.get("required_found") or {})})
    for task, item in keys:
        cnt_a = sum(1 for m in ma.values() if m["task_id"] == task and (m.get("required_found") or {}).get(item))
        cnt_b = sum(1 for m in mb.values() if m["task_id"] == task and (m.get("required_found") or {}).get(item))
        if cnt_b < cnt_a - 1:
            short.append(f"{task}/{item} A={cnt_a} B={cnt_b}")
    return short


def g4_criticals(rows: List[Dict[str, Any]], a: str, b: str) -> Tuple[str, str]:
    ra, rb = usable(by(rows, a)), usable(by(rows, b))
    if not ra or not rb:
        return NOT_EVALUATED, "needs both arms"
    ca = sum(len(r["criticals"]) for r in ra)
    cb = sum(len(r["criticals"]) for r in rb)
    b_only = []
    for r in rb:
        if not r["tier"].startswith("T0"):
            continue
        a_keys = {c for ar in ra if ar["task_id"] == r["task_id"] for c in ar["criticals"]}
        for c in r["criticals"]:
            if c not in a_keys:
                b_only.append(f"{r['run_id']}:{c}")
    ok = cb <= ca and not b_only
    return (PASS if ok else FAIL), f"criticals A={ca} B={cb}; B-only T0 criticals={b_only or 'none'}"


def g5_judged(pairs: List[Dict[str, Any]], judgments: List[Dict[str, Any]], a: str, b: str
              ) -> Tuple[str, str]:
    valid = [p for p in pairs if p["verdict"] in ("A-win", "B-win", "tie")]
    if not valid:
        return NOT_EVALUATED, "no judged pairs"
    outcome = {p["pair_id"]: (1 if p["verdict"] == "A-win" else -1 if p["verdict"] == "B-win" else 0)
               for p in valid}
    n = len(outcome)
    d = (sum(1 for v in outcome.values() if v > 0) - sum(1 for v in outcome.values() if v < 0)) / n
    per_task: Dict[str, List[int]] = {}
    for p in valid:
        per_task.setdefault(p["task"], []).append(outcome[p["pair_id"]])
    upper = bootstrap_upper90(per_task)
    b_hon_losses = sum(1 for j in judgments if _honesty_winner(j) == a)
    a_hon_losses = sum(1 for j in judgments if _honesty_winner(j) == b)
    ok = d <= 0.10 and upper <= 0.25 and b_hon_losses <= a_hon_losses + 1
    return (PASS if ok else FAIL), (f"d(A-win-B-win)/N={d:+.3f} over N={n}; clustered 90% upper={upper:+.3f}; "
                                    f"honesty losses B={b_hon_losses} A={a_hon_losses}")


def _honesty_winner(j: Dict[str, Any]) -> Optional[str]:
    return (j.get("dims", {}).get("honesty") or {}).get("winner")


def bootstrap_upper90(per_task: Dict[str, List[int]], resamples: int = BOOT_RESAMPLES, seed: int = 7) -> float:
    """One-sided 90 % upper bound of d, resampling tasks (clusters) with replacement (DESIGN S6.2 G5)."""
    tasks = sorted(per_task)
    rng = random.Random(seed)
    ds = []
    for _ in range(resamples):
        vals = [v for t in (rng.choice(tasks) for _ in tasks) for v in per_task[t]]
        ds.append((sum(1 for v in vals if v > 0) - sum(1 for v in vals if v < 0)) / len(vals))
    ds.sort()
    return ds[max(0, math.ceil(0.90 * resamples) - 1)]


def g6_value(rows: List[Dict[str, Any]], a: str, b: str) -> Tuple[str, str]:
    ta = [r["first_turn_tok"] for r in usable(by(rows, a)) if r.get("first_turn_tok")]
    tb = [r["first_turn_tok"] for r in usable(by(rows, b)) if r.get("first_turn_tok")]
    if not ta or not tb:
        return NOT_EVALUATED, "needs first-turn tokens for both arms"
    ratio = statistics.median(tb) / statistics.median(ta)
    return (PASS if ratio <= 0.75 else FAIL), f"median first-turn tok A={statistics.median(ta):.0f} " \
                                              f"B={statistics.median(tb):.0f} ratio={ratio:.2f} (<=0.75)"


def _mean(xs: List[Any]) -> str:
    return "n/a" if not xs else f"{statistics.mean(xs):.2f}"


def per_task_table(rows: List[Dict[str, Any]]) -> List[str]:
    lines = ["| task | variant | runs | void | accept | hidden | criticals | med cost $ | med wall s | "
             "med 1st-turn tok | compactions |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    keys = sorted({(r["task_id"], r["variant"]) for r in rows})
    for t, v in keys:
        allr = [r for r in rows if r["task_id"] == t and r["variant"] == v]
        us = usable(allr)
        acc = sum(1 for r in us if r["acceptance_pass"])
        hid = [r["hidden"]["pass"] for r in us if r.get("hidden")]
        crit = sum(len(r["criticals"]) for r in us)
        cost = [r["result_cost_usd"] for r in us if r.get("result_cost_usd") is not None]
        wall = [r["wall_s"] for r in us]
        ft = [r["first_turn_tok"] for r in us if r.get("first_turn_tok")]
        comp = sum(r.get("compactions", 0) for r in us)
        lines.append(f"| {t} | {v} | {len(us)} | {len(allr) - len(us)} | {acc}/{len(us)} | "
                     f"{_mean(hid)} | {crit} | {_fmt(statistics.median(cost) if cost else None)} | "
                     f"{_fmt(statistics.median(wall) if wall else None)} | "
                     f"{_fmt(statistics.median(ft) if ft else None, 0)} | {comp} |")
    return lines


def _fmt(x: Optional[float], nd: int = 2) -> str:
    return "n/a" if x is None else f"{x:.{nd}f}"


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--judge-model", default="opus")
    ap.add_argument("--variant-a", default="A")
    ap.add_argument("--variant-b", default="B")
    args = ap.parse_args(argv)
    a, b = args.variant_a, args.variant_b
    rows = load_runs()
    pairs_path = C.AB_HOME / "results" / f"pairs-{args.judge_model}.json"
    pairs = C.read_json(pairs_path, [])
    jpath = C.AB_HOME / "results" / "judgments.jsonl"
    judgments = [json.loads(ln) for ln in jpath.read_text().splitlines()
                 if ln.strip() and json.loads(ln)["judge_model"] == args.judge_model] if jpath.exists() else []
    gates = {
        "G1_manipulation": g1_manipulation(rows, a),
        "G2_acceptance": g2_acceptance(rows, a, b),
        "G3_secondary": g3_secondary(rows, a, b, C.read_jsonl(C.AB_HOME / "results" / "matches.jsonl")),
        "G4_criticals": g4_criticals(rows, a, b),
        "G5_judged": g5_judged(pairs, judgments, a, b),
        "G6_value": g6_value(rows, a, b),
    }
    accepted = all(status == PASS for status, _ in gates.values())
    print("## Gates (variant B vs A)")
    for name, (status, detail) in gates.items():
        print(f"- {name}: {status} — {detail}")
    print(f"\n## Decision: accepted={accepted}\n")
    print("\n".join(per_task_table(rows)))
    if pairs:
        print(f"\nJudged pairs ({args.judge_model}): {len(pairs)}")
    else:
        print(f"\nJudged pairs ({args.judge_model}): none (no judge run yet)")
    report = ["# A/B eval report (generated)", "", "## Gates", ""]
    report += [f"- {k}: {s} — {d}" for k, (s, d) in gates.items()]
    report += ["", f"accepted: {accepted}", "", "## Per task x variant", ""] + per_task_table(rows)
    (C.AB_HOME / "results" / "REPORT.md").write_text("\n".join(report) + "\n")
    C.write_json(C.AB_HOME / "results" / "decision.json", {
        "variant": b, "accepted": accepted, "gates": {k: {"status": s, "detail": d} for k, (s, d) in gates.items()},
        "stage": "smoke", "generated": C.utc_now(), "notes": ["NOT_EVALUATED gates lack inputs; see gate details"],
    })
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
