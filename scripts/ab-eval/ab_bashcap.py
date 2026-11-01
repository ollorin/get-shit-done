#!/usr/bin/env python3
"""Exp 11 X2 metrics and gates: arm A (control) against arm BC (A + bashOutputMaxChars), from run rows and transcripts.

  gates --cap 8000 [--tasks E3,E4,E6,E7] [--a-runs RUN ...] [--judge opus]   print the gate table as JSON
  cf --cap 8000 [--tasks ...]     no-LLM counterfactual on the existing A rows (upper bound, no read-back)
  selftest

Cost is priced as exp 10 (Haiku list prices, x5 on every class for a call whose prompt exceeds 100k). Read-back counts
tool results saved to a file (`<persisted-output>`) and later Read or Bash calls that name the saved file.
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import statistics as st
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402

PRICE = dict(i=0.10, cw=0.125, cr=0.01, o=0.50)  # $/MTok, Haiku list
TIER = 100_000
SAVED_RE = re.compile(r"Full output saved to:\s*(\S+)")
OVERSIZE = 8000
BC_LOG = C.AB_HOME / "results" / "runs-bashcap.jsonl"


def price(u: Dict[str, int], mult: int) -> float:
    return mult * sum(u[k] * PRICE[k] for k in PRICE) / 1e6


def _text(content: Any) -> str:
    return content if isinstance(content, str) else "".join(i.get("text", "") for i in content or [])


def transcript_files(run_dir: Path) -> List[Path]:
    return sorted(Path(p) for p in glob.glob(str(run_dir / "transcripts" / "**" / "*.jsonl"), recursive=True))


def analyse_files(files: List[Path]) -> Dict[str, Any]:
    """Calls, tier cost and tool-output facts. Executor = subagent transcripts (path contains /subagents/)."""
    seen: set = set()
    calls: List[Any] = []
    saved: Dict[str, int] = {}          # saved path -> chars of the inline preview
    bash_ids: set = set()
    out = dict(bash_results=0, bash_over_8k=0, bash_chars=0, bash_chars_over_8k=0, persisted=0, readbacks=0,
               readback_chars=0, readback_ids={})
    for f in files:
        sub = "/subagents/" in str(f)
        pending: Dict[str, str] = {}    # tool_use id -> saved path it reads back
        for line in f.read_text().splitlines():
            try:
                x = json.loads(line)
            except ValueError:
                continue
            msg = x.get("message") or {}
            if x.get("type") == "assistant":
                for b in msg.get("content") or []:
                    if b.get("type") != "tool_use":
                        continue
                    if b["name"] == "Bash":
                        bash_ids.add(b["id"])
                    blob = json.dumps(b.get("input") or {})
                    for p in saved:
                        if p in blob:
                            pending[b["id"]] = p
                            out["readbacks"] += 1
                if msg.get("id") in seen or not msg.get("usage"):
                    continue
                seen.add(msg["id"])
                u = msg["usage"]
                c = dict(i=u.get("input_tokens") or 0, cw=u.get("cache_creation_input_tokens") or 0,
                         cr=u.get("cache_read_input_tokens") or 0, o=u.get("output_tokens") or 0)
                calls.append((sub, c["i"] + c["cw"] + c["cr"], c))
            elif x.get("type") == "user" and isinstance(msg.get("content"), list):
                for b in msg["content"]:
                    if b.get("type") != "tool_result":
                        continue
                    t = _text(b.get("content"))
                    if b.get("tool_use_id") in bash_ids:
                        n = len(t)
                        out["bash_results"] += 1
                        out["bash_chars"] += n
                        out["bash_over_8k"] += n > OVERSIZE
                        out["bash_chars_over_8k"] += n if n > OVERSIZE else 0
                    m = SAVED_RE.search(t) if t.lstrip().startswith("<persisted-output>") else None
                    if m:
                        out["persisted"] += 1
                        saved[m.group(1)] = len(t)
                    if b.get("tool_use_id") in pending:
                        out["readback_chars"] += len(t)
    flat = sum(price(c, 1) for _, _, c in calls)
    tier = sum(price(c, 5 if ctx > TIER else 1) for _, ctx, c in calls)
    sub_calls = [(ctx, c) for s, ctx, c in calls if s]
    out.update(calls=len(calls), flat=flat, tier=tier, sub_calls=len(sub_calls),
               sub_above=sum(ctx > TIER for ctx, _ in sub_calls),
               peak=max([ctx for ctx, _ in sub_calls], default=0))
    out.pop("readback_ids")
    return out


def counterfactual(files: List[Path], cap: int, cpt: float = 3.5, preview: int = 2000) -> Dict[str, float]:
    """No-LLM upper bound for a cap: remove (chars - preview)/cpt tokens of every Bash result over `cap` from every later
    call of the same transcript (cache-write once, cache-read after), re-price with the 5x line, assume no read-back and
    no behaviour change. Bash only; Read results are untouched."""
    base = new = above0 = above1 = n = 0
    for f in files:
        bash_ids: set = set()
        seen: set = set()
        removed = 0.0
        fresh = 0.0
        for line in f.read_text().splitlines():
            try:
                x = json.loads(line)
            except ValueError:
                continue
            msg = x.get("message") or {}
            if x.get("type") == "assistant":
                for b in msg.get("content") or []:
                    if b.get("type") == "tool_use" and b["name"] == "Bash":
                        bash_ids.add(b["id"])
                if msg.get("id") in seen or not msg.get("usage"):
                    continue
                seen.add(msg["id"])
                u = msg["usage"]
                c = dict(i=u.get("input_tokens") or 0, cw=u.get("cache_creation_input_tokens") or 0,
                         cr=u.get("cache_read_input_tokens") or 0, o=u.get("output_tokens") or 0)
                ctx = c["i"] + c["cw"] + c["cr"]
                # tokens removed since the previous call: first priced as cache write, later as cache read
                cut_w = min(fresh, c["cw"])
                cut_r = min(max(removed - cut_w, 0.0), c["cr"])
                adj = dict(c, cw=c["cw"] - cut_w, cr=c["cr"] - cut_r)
                nctx = ctx - cut_w - cut_r
                fresh = 0.0
                base += price(c, 5 if ctx > TIER else 1)
                new += price(adj, 5 if nctx > TIER else 1)
                above0 += ctx > TIER
                above1 += nctx > TIER
                n += 1
            elif x.get("type") == "user" and isinstance(msg.get("content"), list):
                for b in msg["content"]:
                    if b.get("type") == "tool_result" and b.get("tool_use_id") in bash_ids:
                        t = _text(b.get("content"))
                        if len(t) > cap:
                            cut = (len(t) - preview) / cpt
                            removed += cut
                            fresh += cut
    return dict(tier_before=base, tier_after=new, calls=n, above_before=above0, above_after=above1)


def analyse_run(row: Dict[str, Any]) -> Dict[str, Any]:
    d = analyse_files(transcript_files(C.AB_HOME / "runs" / row["run_id"]))
    d.update(run=row["run_id"], task=row["task_id"], acc=bool(row.get("acceptance_pass")), wall=row.get("wall_s"),
             commits=len(row.get("commits") or []))
    return d


def _med(rows: List[Dict[str, Any]], key: str, task: str) -> float:
    return st.median([r[key] for r in rows if r["task"] == task])


def evaluate(a: List[Dict[str, Any]], bc: List[Dict[str, Any]], tasks: List[str], judge: Optional[Dict[str, Any]] = None,
             margin: float = 0.35) -> Dict[str, Any]:
    """a, bc: analyse_run dicts. judge: {'pairs','bc','a','tie','honesty_bc_loses','honesty_a_loses'} or None (gate then unmeasured)."""
    acc = {t: (sum(r["acc"] for r in a if r["task"] == t), sum(r["acc"] for r in bc if r["task"] == t),
               sum(1 for r in a if r["task"] == t), sum(1 for r in bc if r["task"] == t)) for t in tasks}
    flips = [t for t, (ka, kb, na, nb) in acc.items() if nb == 0 or na == 0 or kb / nb < ka / na]
    cost_a = sum(_med(a, "tier", t) for t in tasks)
    cost_b = sum(_med(bc, "tier", t) for t in tasks)
    share = lambda rs: sum(r["sub_above"] for r in rs) / max(sum(r["sub_calls"] for r in rs), 1)  # noqa: E731
    rb = dict(persisted_a=sum(r["persisted"] for r in a), persisted_bc=sum(r["persisted"] for r in bc),
              readbacks_a=sum(r["readbacks"] for r in a), readbacks_bc=sum(r["readbacks"] for r in bc),
              readback_chars_a=sum(r["readback_chars"] for r in a), readback_chars_bc=sum(r["readback_chars"] for r in bc))
    g: Dict[str, Any] = {
        "acceptance": {"pass": not flips, "flips": flips, "per_task": acc},
        "cost": {"pass": cost_b <= 0.95 * cost_a, "a": cost_a, "bc": cost_b, "ratio": cost_b / cost_a if cost_a else None},
        "above_100k": {"pass": share(bc) < share(a), "a": share(a), "bc": share(bc)},
        "read_back": {"pass": None, "reported": rb},
    }
    if judge is None:
        g["judge"] = {"pass": None, "note": "not measured"}
    else:
        n = max(judge["pairs"], 1)
        delta = (judge["bc"] - judge["a"]) / n
        g["judge"] = {"pass": delta >= -margin and judge["honesty_bc_loses"] <= judge["honesty_a_loses"] + 1,
                      "delta": delta, "margin": margin, **judge}
    gated = [v["pass"] for k, v in g.items() if k != "read_back"]
    g["verdict"] = "UNDETERMINED" if None in gated else "PASS" if all(gated) else "FAIL"
    return g


def _row_ok(r: Dict[str, Any]) -> bool:
    return r.get("status") == "done"


def cmd_gates(args: argparse.Namespace) -> int:
    tasks = args.tasks.split(",")
    sup = {r.get("run_id") for r in C.read_jsonl(C.AB_HOME / "results" / "superseded.jsonl")}
    ctl = [r for r in C.read_jsonl(C.AB_HOME / "results" / "runs.jsonl")
           if r["variant"] == "A" and r["task_id"] in tasks and _row_ok(r) and r["run_id"] not in sup]
    if args.a_runs:
        ctl = [r for r in ctl if r["run_id"] in set(args.a_runs)]
    bc = [r for r in C.read_jsonl(BC_LOG) if r.get("bash_cap") == args.cap and r["task_id"] in tasks and _row_ok(r)]
    print(json.dumps(evaluate([analyse_run(r) for r in ctl], [analyse_run(r) for r in bc], tasks), indent=1))
    return 0


def cmd_cf(args: argparse.Namespace) -> int:
    tasks = args.tasks.split(",")
    sup = {r.get("run_id") for r in C.read_jsonl(C.AB_HOME / "results" / "superseded.jsonl")}
    ctl = [r for r in C.read_jsonl(C.AB_HOME / "results" / "runs.jsonl")
           if r["variant"] == "A" and r["task_id"] in tasks and _row_ok(r) and r["run_id"] not in sup]
    out: Dict[str, Any] = {}
    for cpt in (3.0, 3.5, 4.0):
        per = {t: [counterfactual(transcript_files(C.AB_HOME / "runs" / r["run_id"]), args.cap, cpt)
                   for r in ctl if r["task_id"] == t] for t in tasks}
        before = sum(st.median(x["tier_before"] for x in v) for v in per.values())
        after = sum(st.median(x["tier_after"] for x in v) for v in per.values())
        a0 = sum(x["above_before"] for v in per.values() for x in v)
        a1 = sum(x["above_after"] for v in per.values() for x in v)
        n = sum(x["calls"] for v in per.values() for x in v)
        out[f"chars_per_token={cpt}"] = dict(sum_median_tier_before=before, sum_median_tier_after=after,
                                              ratio=after / before, all_calls_above_100k_before=a0 / n,
                                              all_calls_above_100k_after=a1 / n)
    print(json.dumps(out, indent=1))
    return 0


def selftest() -> int:
    def line(kind: str, **kw: Any) -> str:
        return json.dumps(dict(kw, type=kind))

    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp, "x", "subagents", "a.jsonl")
        f.parent.mkdir(parents=True)
        usage = dict(input_tokens=10, cache_creation_input_tokens=0, cache_read_input_tokens=150_000, output_tokens=5)
        lines = [
            line("assistant", message=dict(id="m1", usage=usage, content=[dict(type="tool_use", id="t1", name="Bash", input={})])),
            line("user", message=dict(content=[dict(type="tool_result", tool_use_id="t1", content=[dict(
                type="text", text="<persisted-output>\nOutput too large (9KB). Full output saved to: /tmp/o/b1.txt\n")])])),
            line("assistant", message=dict(id="m2", usage=usage, content=[dict(type="tool_use", id="t2", name="Read",
                                                                               input={"file_path": "/tmp/o/b1.txt"})])),
            line("user", message=dict(content=[dict(type="tool_result", tool_use_id="t2", content="y" * 9000)])),
        ]
        f.write_text("\n".join(lines))
        d = analyse_files([f])
    assert (d["persisted"], d["readbacks"], d["readback_chars"], d["calls"], d["sub_above"]) == (1, 1, 9000, 2, 2), d
    assert abs(d["tier"] - 2 * price(dict(i=10, cw=0, cr=150_000, o=5), 5)) < 1e-12
    rows = lambda cost, acc, above: [dict(task="E1", tier=cost, acc=acc, sub_above=above, sub_calls=10, persisted=0,  # noqa: E731
                                          readbacks=0, readback_chars=0)]
    ok = evaluate(rows(1.0, True, 8), rows(0.9, True, 5), ["E1"], dict(pairs=4, bc=1, a=1, tie=2, honesty_bc_loses=0, honesty_a_loses=0))
    assert ok["verdict"] == "PASS", ok
    assert evaluate(rows(1.0, True, 8), rows(0.96, True, 5), ["E1"])["cost"]["pass"] is False
    assert evaluate(rows(1.0, True, 8), rows(0.5, False, 5), ["E1"])["acceptance"]["flips"] == ["E1"]
    assert evaluate(rows(1.0, True, 8), rows(0.5, True, 9), ["E1"])["above_100k"]["pass"] is False
    assert evaluate(rows(1.0, True, 8), rows(0.5, True, 5), ["E1"])["verdict"] == "UNDETERMINED"
    with tempfile.TemporaryDirectory() as tmp:  # one 150k call, a 12k-char Bash result, then a call at 102k that falls to ~98.6k
        f = Path(tmp, "subagents", "b.jsonl")
        f.parent.mkdir()
        u = lambda ctx: dict(input_tokens=0, cache_creation_input_tokens=0, cache_read_input_tokens=ctx, output_tokens=0)  # noqa: E731
        f.write_text("\n".join([
            line("assistant", message=dict(id="a", usage=u(90_000), content=[dict(type="tool_use", id="t", name="Bash", input={})])),
            line("user", message=dict(content=[dict(type="tool_result", tool_use_id="t", content="z" * 12_000)])),
            line("assistant", message=dict(id="b", usage=u(102_000), content=[])),
        ]))
        cf = counterfactual([f], 8000, cpt=3.0, preview=2000)
    assert (cf["above_before"], cf["above_after"], cf["calls"]) == (1, 0, 2), cf
    assert cf["tier_after"] < cf["tier_before"] / 3, cf
    print("selftest ok")
    return 0


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gates")
    g.add_argument("--cap", type=int, required=True)
    g.add_argument("--tasks", default="E3,E4,E6,E7")
    g.add_argument("--a-runs", nargs="*")
    c = sub.add_parser("cf")
    c.add_argument("--cap", type=int, required=True)
    c.add_argument("--tasks", default="E3,E4,E6,E7")
    sub.add_parser("selftest")
    args = p.parse_args(argv)
    return cmd_gates(args) if args.cmd == "gates" else cmd_cf(args) if args.cmd == "cf" else selftest()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
