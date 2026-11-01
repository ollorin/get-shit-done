#!/usr/bin/env python3
"""Aggregate ~/ab-eval-q3/runs.jsonl per arm, apply the declared gates, print a markdown table + JSON."""
from __future__ import annotations

import json
import statistics as st
import sys
from typing import Any, Dict, List

import q3_spec as S

ROWS = S.Q3_HOME / "runs.jsonl"


def load() -> List[dict]:
    return [json.loads(l) for l in ROWS.read_text().splitlines() if l.strip()]


def arm_stats(rows: List[dict]) -> Dict[str, Any]:
    seeded = [r for r in rows if r["kind"] == "seeded"]
    clean = [r for r in rows if r["kind"] == "clean"]
    det = sum(len(r["grade"]["defects_detected"]) for r in seeded)
    tot = sum(r["grade"]["defects_total"] for r in seeded)
    ff = sum(len(r["grade"]["false_fail_tags"]) for r in clean)
    ctrl_ff_seeded = sum(len(r["grade"]["false_fail_tags"]) for r in seeded)
    ff_sessions = sum(1 for r in clean if r["grade"]["overall_false_fail"])
    parse = sum(1 for r in rows if r["grade"]["parse_ok"])
    ok = all(r["exit"] == 0 and not r["timed_out"] and not r.get("is_error") for r in rows)
    ft = [r["first_turn_tokens"] for r in rows if r["first_turn_tokens"]]
    return {
        "n": len(rows), "recall": det, "recall_of": tot, "clean_false_fail": ff, "clean_false_fail_of": 9 * len(clean),
        "clean_overall_fail_sessions": ff_sessions, "seeded_control_false_fail": ctrl_ff_seeded,
        "parse": parse, "complete": ok,
        "tags_missing": sum(len(r["grade"]["tags_missing"]) for r in rows),
        "first_turn_median": st.median(ft) if ft else None,
        "total_tokens_mean": round(st.mean(r["total_tokens"] for r in rows)),
        "calls_mean": round(st.mean(r["n_calls"] for r in rows), 1),
        "tool_calls_mean": round(st.mean(r["n_tool_calls"] for r in rows), 1),
        "cost45_median": round(st.median(r["cost_haiku45"] for r in rows), 4), "cost45_total": round(sum(r["cost_haiku45"] for r in rows), 3),
        "cost55_median": round(st.median(r["cost_haiku55"] for r in rows), 4), "cost55_total": round(sum(r["cost_haiku55"] for r in rows), 3),
        "cli_cost_total": round(sum((r.get("cli_cost_usd") or 0) for r in rows), 3),
        "wall_mean_s": round(st.mean(r["wall_s"] for r in rows), 1), "wall_total_s": round(sum(r["wall_s"] for r in rows), 1),
        "models": sorted({m for r in rows for m in r.get("models_used", [])}),
    }


def gates(arm: str, a: Dict[str, Any], c: Dict[str, Any]) -> Dict[str, Any]:
    g = {
        "G-recall": a["recall"] >= c["recall"],
        "G-falsefail": a["clean_false_fail"] <= c["clean_false_fail"] and a["clean_overall_fail_sessions"] <= c["clean_overall_fail_sessions"],
        "G-parse": a["parse"] == a["n"],
        "G-complete": a["complete"],
    }
    own_cost = a["cost55_median"] if arm in ("M1", "C+M1") else a["cost45_median"]
    g["G-cost"] = own_cost <= c["cost45_median"]
    if arm in ("C", "C+M1"):
        g["G-first-turn"] = a["first_turn_median"] <= 0.75 * c["first_turn_median"]
    return g


def main() -> int:
    rows = load()
    by: Dict[str, List[dict]] = {}
    for r in rows:
        by.setdefault(r["arm"], []).append(r)
    stats = {k: arm_stats(v) for k, v in by.items()}
    out = {"stats": stats, "gates": {k: gates(k, stats[k], stats["control"]) for k in stats if k != "control"}}
    (S.Q3_HOME / "report.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
