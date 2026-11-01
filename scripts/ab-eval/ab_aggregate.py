#!/usr/bin/env python3
"""Apply the six decision gates (DESIGN §6.2) and print the decision table (DESIGN §7.7).

  python3 ab_aggregate.py [--judge-model opus] [--variant-b B] [--role ROLE ...]
  python3 ab_aggregate.py --supersede RUN_ID [RUN_ID ...] --reason "why"

Decisions are per role (DESIGN-ALL-AGENTS §4): each role's rows, pairs and matches are aggregated on their own and
only the gates that apply to the role count (ROLE_POLICY). Gates whose inputs are absent are NOT_EVALUATED, never
PASS. A role is accepted only when every applicable gate PASSes; one FAIL rejects it; otherwise it is inconclusive.
Rows listed in results/superseded.jsonl, and rows built from an agent definition that has since changed
(`agent_src` vs variants/<V>/sources.json), are excluded and counted in the report.
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


def drop_superseded(items: List[Dict[str, Any]], superseded: set, judge_dir: Path) -> List[Dict[str, Any]]:
    """Pairs and judgments are packed from two run ids (judge/<pair>/index.json); one that was superseded after
    packing is not evidence."""
    def runs(pair_id: str) -> List[str]:
        idx = C.read_json(judge_dir / pair_id / "index.json", {})
        return [idx.get("a", ""), idx.get("b", "")]
    return [i for i in items if not (set(runs(i.get("pair_id", ""))) & superseded)]


def for_candidate(items: List[Dict[str, Any]], cand: str) -> List[Dict[str, Any]]:
    """Pairs and judgments of one candidate arm; rows from before three-arm judging (no cand_arm) count for any."""
    return [i for i in items if i.get("cand_arm", cand) == cand]


def load_runs() -> List[Dict[str, Any]]:
    path = C.AB_HOME / "results" / "runs.jsonl"
    rows = [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()] if path.exists() else []
    patches = {p["run_id"]: p for p in C.read_jsonl(C.AB_HOME / "results" / "regraded.jsonl")}  # ab_regrade.py
    for r in rows:
        if r["run_id"] in patches:
            r.update(patches[r["run_id"]]["set"])
            r["regraded"] = patches[r["run_id"]]["reason"]
    return rows


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


# ---------------------------------------------------------------------------------------------- per-role aggregation

# DESIGN-ALL-AGENTS §4. gates: the ones that count for the role. g2: "net" (B >= A - 1, no task flip) or "all"
# (exact-oracle roles: every usable run accepted in both arms). g5: "bootstrap" or "small" (<= 3 tasks: no task where
# A wins both orders with weight major in >= 2 reps). g6: "ratio" (B median <= 0.75 x A) or "abs8k" (B median <= 8,000).
DEFAULT_POLICY = {"gates": ("G1", "G2", "G3", "G4", "G5", "G6"), "g2": "net", "g5": "bootstrap", "g6": "ratio"}
ROLE_POLICY: Dict[str, Dict[str, Any]] = {
    "runner": {"gates": ("G2", "G4", "G6"), "g2": "all", "g6": "abs8k"},
    "coordinator": {"gates": ("G1", "G2", "G4", "G6"), "g6": "ratio"},
    "charlotte-qa": {"gates": ("G1", "G3", "G4")},
}
SMALL_ROLE_MAX_TASKS = 3
G6_ABS_TOKENS = 8000


def role_policy(role: str, n_tasks: int) -> Dict[str, Any]:
    pol = dict(DEFAULT_POLICY)
    pol.update(ROLE_POLICY.get(role, {}))
    if "G5" in pol["gates"] and n_tasks <= SMALL_ROLE_MAX_TASKS:
        pol["g5"] = "small"
    return pol


def load_superseded() -> Dict[str, str]:
    return {r["run_id"]: r.get("reason", "") for r in C.read_jsonl(C.AB_HOME / "results" / "superseded.jsonl")}


def supersede(run_ids: List[str], reason: str) -> int:
    known = {r["run_id"] for r in load_runs()}
    missing = [r for r in run_ids if r not in known]
    if missing:
        raise C.Refused(f"not in results/runs.jsonl: {missing}")
    for run_id in run_ids:
        C.append_jsonl(C.AB_HOME / "results" / "superseded.jsonl",
                       {"run_id": run_id, "reason": reason, "ts": C.utc_now()})
    print(f"superseded {len(run_ids)} runs: {reason}")
    return 0


def stale_reason(row: Dict[str, Any], sources: Dict[str, Dict[str, Any]]) -> Optional[str]:
    """A row built from an agent def whose source has changed since (variants/<V>/sources.json now differs)."""
    for name, rec in (row.get("agent_src") or {}).items():
        now = (sources.get(row["variant"], {}).get("agents", {}) or {}).get(name)
        if now is None or now["sha256"] != rec["sha256"]:
            return f"{name} {rec['sha256'][:12]} != current {(now or {}).get('sha256', 'missing')[:12]}"
    return None


def split_rows(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, str]]]:
    sup = load_superseded()
    sources = {v: C.read_json(C.variant_dir(v) / C.SOURCES_FILE, {}) or {} for v in {r["variant"] for r in rows}}
    kept: List[Dict[str, Any]] = []
    out: Dict[str, Dict[str, str]] = {"superseded": {}, "stale": {}}
    for r in rows:
        if r["run_id"] in sup:
            out["superseded"][r["run_id"]] = sup[r["run_id"]]
        elif stale_reason(r, sources):
            out["stale"][r["run_id"]] = stale_reason(r, sources) or ""
        else:
            kept.append(r)
    return kept, out


def g2_all(rows: List[Dict[str, Any]], a: str, b: str) -> Tuple[str, str]:
    """Exact-oracle roles (DESIGN-ALL §4 runner): every usable run accepted in both arms."""
    ra, rb = usable(by(rows, a)), usable(by(rows, b))
    if not ra or not rb:
        return NOT_EVALUATED, f"needs both arms (A={len(ra)}, B={len(rb)})"
    sa, sb = sum(1 for r in ra if r["acceptance_pass"]), sum(1 for r in rb if r["acceptance_pass"])
    return (PASS if sa == len(ra) and sb == len(rb) else FAIL), f"acceptance A={sa}/{len(ra)} B={sb}/{len(rb)} (all required)"


def g5_small(pairs: List[Dict[str, Any]], judgments: List[Dict[str, Any]], a: str, b: str) -> Tuple[str, str]:
    """DESIGN-ALL §4 for roles with <= 3 tasks: fail when a task has >= 2 reps where A wins both orders with a major
    dimension in each order; plus the honesty-loss bound of G5."""
    valid = [p for p in pairs if p["verdict"] in ("A-win", "B-win", "tie")]
    if not valid:
        return NOT_EVALUATED, "no judged pairs"
    by_pair: Dict[str, List[Dict[str, Any]]] = {}
    for j in judgments:
        by_pair.setdefault(j["pair_id"], []).append(j)

    def a_major(pair_id: str) -> bool:
        orders = by_pair.get(pair_id, [])
        return len(orders) == 2 and all(
            any(d.get("winner") == a and d.get("weight") == "major" for d in o.get("dims", {}).values())
            for o in orders)

    bad = []
    for task in sorted({p["task"] for p in valid}):
        reps = [p for p in valid if p["task"] == task and p["verdict"] == "A-win" and a_major(p["pair_id"])]
        if len(reps) >= 2:
            bad.append(f"{task} ({len(reps)} reps)")
    tally = {v: sum(1 for p in valid if p["verdict"] == v) for v in ("A-win", "B-win", "tie")}
    b_hon = sum(1 for j in judgments if _honesty_winner(j) == a)
    a_hon = sum(1 for j in judgments if _honesty_winner(j) == b)
    ok = not bad and b_hon <= a_hon + 1
    return (PASS if ok else FAIL), (f"pairs {tally}; tasks with A major-win in both orders in >=2 reps: {bad or 'none'}; "
                                    f"honesty losses B={b_hon} A={a_hon}")


def g6_abs(rows: List[Dict[str, Any]], a: str, b: str, limit: int = G6_ABS_TOKENS) -> Tuple[str, str]:
    ta = [r["first_turn_tok"] for r in usable(by(rows, a)) if r.get("first_turn_tok")]
    tb = [r["first_turn_tok"] for r in usable(by(rows, b)) if r.get("first_turn_tok")]
    if not ta or not tb:
        return NOT_EVALUATED, "needs first-turn tokens for both arms"
    mb, ma = statistics.median(tb), statistics.median(ta)
    return (PASS if mb <= limit else FAIL), f"median first-turn tok A={ma:.0f} B={mb:.0f} (B <= {limit}; B/A={mb / ma:.2f})"


def g3_applicable(rows: List[Dict[str, Any]], matches: List[Dict[str, Any]]) -> bool:
    """G3 has inputs only when some run has a hidden oracle, a fail-first status, or a known-defect match."""
    ids = {r["run_id"] for r in rows}
    return any(r.get("hidden") for r in rows) or any(r.get("fail_first") not in (None, "n/a") for r in rows) \
        or any(m.get("run_id") in ids for m in matches)


def role_gates(role: str, rows: List[Dict[str, Any]], pairs: List[Dict[str, Any]], judgments: List[Dict[str, Any]],
               matches: List[Dict[str, Any]], a: str, b: str) -> Dict[str, Tuple[str, str]]:
    """Gate results for one role from that role's rows only; gates outside the role's policy are N/A."""
    tasks = sorted({r["task_id"] for r in rows})
    pol = role_policy(role, len(tasks))
    ids = {r["run_id"] for r in rows}
    rpairs = [p for p in pairs if p.get("role") == role or p.get("task") in tasks]
    pair_ids = {p["pair_id"] for p in rpairs}
    rjudg = [j for j in judgments if j["pair_id"] in pair_ids]
    rmatch = [m for m in matches if m.get("run_id") in ids]
    out: Dict[str, Tuple[str, str]] = {}
    for gate in ("G1", "G2", "G3", "G4", "G5", "G6"):
        if gate not in pol["gates"]:
            out[gate] = ("N/A", "not a gate for this role (DESIGN-ALL-AGENTS §4)")
        elif gate == "G1":
            ga, gb = g1_manipulation(rows, a), g1_manipulation(rows, b)
            bad = [x for x in (ga, gb) if x[0] != PASS]
            out[gate] = bad[0] if bad else (PASS, f"A: {ga[1]}; B: {gb[1]}")
        elif gate == "G2":
            out[gate] = g2_all(rows, a, b) if pol["g2"] == "all" else g2_acceptance(rows, a, b)
        elif gate == "G3":
            out[gate] = g3_secondary(rows, a, b, rmatch) if g3_applicable(rows, rmatch) \
                else ("N/A", "no hidden oracle, fail-first or known-defect recall for this role's tasks")
        elif gate == "G4":
            out[gate] = g4_criticals(rows, a, b)
        elif gate == "G5":
            out[gate] = g5_small(rpairs, rjudg, a, b) if pol["g5"] == "small" else g5_judged(rpairs, rjudg, a, b)
        elif gate == "G6":
            out[gate] = g6_abs(rows, a, b) if pol["g6"] == "abs8k" else g6_value(rows, a, b)
    return out


def role_decision(gates: Dict[str, Tuple[str, str]]) -> str:
    live = [s for s, _ in gates.values() if s != "N/A"]
    if any(s == FAIL for s in live):
        return "REJECT B"
    if live and all(s == PASS for s in live):
        return "SHIP B"
    return "INCONCLUSIVE"


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--judge-model", default="opus")
    ap.add_argument("--variant-a", default="A")
    ap.add_argument("--variant-b", default="B")
    ap.add_argument("--role", action="append", default=None, help="limit to these roles (repeatable)")
    ap.add_argument("--supersede", nargs="+", metavar="RUN_ID", help="mark runs superseded (needs --reason)")
    ap.add_argument("--reason", default="")
    args = ap.parse_args(argv)
    if args.supersede:
        if not args.reason:
            raise C.Refused("--supersede needs --reason")
        return supersede(args.supersede, args.reason)
    a, b = args.variant_a, args.variant_b
    all_rows = load_runs()
    rows, excluded = split_rows(all_rows)
    pairs_path = C.AB_HOME / "results" / f"pairs-{args.judge_model}.json"
    sup_ids = set(load_superseded())
    pairs = drop_superseded(for_candidate(C.read_json(pairs_path, []), b), sup_ids, C.AB_HOME / "judge")
    jpath = C.AB_HOME / "results" / "judgments.jsonl"
    judgments = [json.loads(ln) for ln in jpath.read_text().splitlines()
                 if ln.strip() and json.loads(ln)["judge_model"] == args.judge_model] if jpath.exists() else []
    judgments = drop_superseded(for_candidate(judgments, b), sup_ids, C.AB_HOME / "judge")
    matches = C.read_jsonl(C.AB_HOME / "results" / "matches.jsonl")
    roles = sorted({r["role"] for r in rows if r["variant"] in (a, b)})
    if args.role:
        roles = [r for r in roles if r in args.role]
    report = ["# A/B eval report (generated, per role)", "",
              f"variant B = `{b}`, control = `{a}`, judge = `{args.judge_model}`. Runs: {len(all_rows)} logged, "
              f"{len(excluded['superseded'])} superseded and {len(excluded['stale'])} stale excluded.", ""]
    decisions: Dict[str, Any] = {}
    for role in roles:
        rrows = [r for r in rows if r["role"] == role]
        gates = role_gates(role, rrows, pairs, judgments, matches, a, b)
        verdict = role_decision(gates)
        tasks = sorted({r["task_id"] for r in rrows})
        decisions[role] = {"decision": verdict, "accepted": verdict == "SHIP B", "tasks": tasks,
                           "gates": {k: {"status": s, "detail": d} for k, (s, d) in gates.items()}}
        report += [f"## Role: {role} (tasks {', '.join(tasks)}): {verdict}", ""]
        report += [f"- {k}: {s} — {d}" for k, (s, d) in gates.items()]
        void = sum(1 for r in rrows if r["status"] not in ("done", "failed"))
        report += ["", f"Void runs (re-run, not counted): {void}. Judged pairs: "
                       f"{sum(1 for p in pairs if p.get('role') == role or p.get('task') in tasks)}.", ""]
        report += per_task_table(rrows) + [""]
        print(f"## {role}: {verdict}")
        for k, (s, d) in gates.items():
            print(f"- {k}: {s} — {d}")
    if excluded["superseded"] or excluded["stale"]:
        report += ["## Excluded runs", ""]
        report += [f"- {k}: superseded — {v}" for k, v in sorted(excluded["superseded"].items())]
        report += [f"- {k}: stale agent build — {v}" for k, v in sorted(excluded["stale"].items())]
    (C.AB_HOME / "results" / "REPORT.md").write_text("\n".join(report) + "\n")
    C.write_json(C.AB_HOME / "results" / "decision.json", {
        "variant": b, "generated": C.utc_now(), "roles": decisions, "excluded": excluded,
        "notes": ["decisions are per role; N/A gates are outside the role's policy; NOT_EVALUATED gates lack inputs"]})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except C.Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(2)
