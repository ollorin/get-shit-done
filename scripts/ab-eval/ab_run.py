#!/usr/bin/env python3
"""Run headless agent evals in per-run snapshots and append one JSONL row per run (DESIGN §4.3, §4.5, §7.3).

  run --task ID --variant V [--reps N] [--rep-start K] [--parallel 1|2] [--keep] [--dry-run]
  quota                     show the last seven_day utilisation and whether a batch would start
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402
import ab_grade as G  # noqa: E402
import ab_roles as R  # noqa: E402
import ab_transcript as T  # noqa: E402

QUOTA_FILE = C.AB_HOME / "results" / "quota.json"
RUNS_LOG = C.AB_HOME / "results" / "runs.jsonl"


def seven_day_util(rate: Optional[Dict[str, Any]]) -> Optional[float]:
    """rate_limit_event.rate_limit_info.unifiedWindows.seven_day.utilization (probe S8)."""
    if not rate:
        return None
    info = rate.get("rate_limit_info", {}) or {}
    util = ((info.get("unifiedWindows") or {}).get("seven_day") or {}).get("utilization")
    return float(util) if util is not None else None


def check_quota(ceiling: float = C.QUOTA_CEILING) -> Optional[float]:
    state = C.read_json(QUOTA_FILE, None)
    if not state or state.get("seven_day_utilization") is None:
        print("quota: no rate_limit_event recorded yet; allowing the first batch", file=sys.stderr)
        return None
    util = float(state["seven_day_utilization"])
    if util > ceiling:
        raise C.Refused(f"seven_day utilisation {util:.2f} > {ceiling}; batch refused (DESIGN S4.5)")
    return util


def write_quota(util: Optional[float], run_id: str, resets_at: Any) -> None:
    if util is None:
        return
    C.write_json(QUOTA_FILE, {"seven_day_utilization": util, "resets_at": resets_at, "run_id": run_id,
                              "ts": C.utc_now()})


def build_snapshot(task: Dict[str, Any], variant: str, run_dir: Path) -> Dict[str, Any]:
    if task.get("enabled") is False:
        raise C.Refused(f"{task['id']} is registered enabled:false ({task.get('blocked') or task.get('reason')})")
    tdir = C.task_dir(task["id"])
    calib = C.read_json(tdir / "calib.json", {})
    if not calib.get("ok"):
        raise C.Refused(f"{task['id']} has no passing calibration (tasks/{task['id']}/calib.json)")
    pristine = tdir / f"pristine-{variant}"
    if not pristine.exists():
        raise C.Refused(f"missing {pristine}; run ab_setup.py variant first")
    repo = run_dir / "repo"
    C.clone_tree(pristine, repo)
    base_commit = C.git(repo, "rev-parse", "HEAD").strip()
    memory = run_dir / "memory"
    shutil.copytree(tdir / f"memory-{variant}", memory)
    (repo / ".claude" / "settings.local.json").write_text(
        json.dumps({"autoMemoryEnabled": True, "autoMemoryDirectory": str(memory)}))
    (run_dir / "brief.md").write_text(R.render_brief(task, variant))
    if task["role"] == "coordinator":
        (run_dir / "stub").mkdir(exist_ok=True)
        C.write_json(run_dir / "stub" / "scenario.json", task["scenario"])
    return {"base_commit": base_commit, "repo": repo}


def execute(run_dir: Path, task: Dict[str, Any], variant: str, session: str, budget: float) -> Dict[str, Any]:
    repo = run_dir / "repo"
    agents_text = json.dumps(R.build_agents(task, variant))
    harness = C.AB_HOME / "harness"
    argv = ["claude", "-p", (run_dir / "brief.md").read_text(), "--model", "haiku",
            "--agents", agents_text,
            "--setting-sources", "project,local",
            "--settings", str(harness / "settings.json"),
            "--strict-mcp-config", "--mcp-config", str(R.mcp_config(task)),
            "--permission-mode", "bypassPermissions",
            "--session-id", session,
            "--max-budget-usd", str(budget),
            "--output-format", "stream-json", "--verbose"]
    env = dict(os.environ, AB_RUN_DIR=str(run_dir.resolve()))
    t0 = time.time()
    timed_out = False
    with open(run_dir / "stream.jsonl", "w") as out, open(run_dir / "stderr.log", "w") as err:
        proc = subprocess.Popen(argv, cwd=str(repo), stdout=out, stderr=err, env=env, start_new_session=True)
        try:
            rc = proc.wait(timeout=int(task.get("timeout_min", 90)) * 60)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                rc = proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                rc = proc.wait()
    return {"exit_code": rc, "timed_out": timed_out, "wall_s": round(time.time() - t0, 1)}


def parse_stream(path: Path) -> Dict[str, Any]:
    result, rate, types = None, None, {}
    for line in path.read_text(errors="replace").splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = d.get("type")
        types[kind] = types.get(kind, 0) + 1
        if kind == "result":
            result = d
        elif kind == "rate_limit_event":
            rate = d
    return {"result": result, "rate": rate, "util": seven_day_util(rate), "types": types}


def mirror_transcripts(repo: Path, run_dir: Path) -> List[str]:
    src = C.encode_project_dir(repo)
    dst = run_dir / "transcripts"
    if not src.exists():
        return []
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return sorted(str(p.relative_to(run_dir)) for p in dst.rglob("*.jsonl"))


def status_of(res: Optional[Dict[str, Any]], run: Dict[str, Any], contaminated: bool, models: List[str],
              allowed: Sequence[str] = ("haiku",)) -> tuple:
    if res is None:
        return "void", "no result line in stream"
    if contaminated:
        return "void", "contaminated: denied root reached by another path"
    extra = [m for m in models if not any(a in m for a in allowed) and not m.startswith("<")]
    if extra:
        return "void", f"model fallback or extra model: {extra}"
    if run["timed_out"] or res.get("is_error") or str(res.get("subtype", "")).startswith("error"):
        return "failed", f"subtype={res.get('subtype')} timed_out={run['timed_out']}"
    return "done", None


def run_one(task: Dict[str, Any], variant: str, rep: int, keep: bool) -> Dict[str, Any]:
    run_id = f"{task['id']}-{variant}-r{rep}-{C.run_stamp()}-{uuid.uuid4().hex[:6]}"
    run_dir = C.AB_HOME / "runs" / run_id
    run_dir.mkdir(parents=True)
    C.check_disk(C.AB_HOME, C.MIN_FREE_GIB)
    session = str(uuid.uuid4())
    start = C.utc_now()
    provenance = R.agent_provenance(task, variant)
    snap = build_snapshot(task, variant, run_dir)
    quota_before = check_quota_value()
    budget = float(task.get("budget_usd", 8))
    run = execute(run_dir, task, variant, session, budget)
    parsed = parse_stream(run_dir / "stream.jsonl")
    res = parsed["result"]
    if res and res.get("result"):
        (run_dir / "report.md").write_text(str(res["result"]))
    transcripts = mirror_transcripts(snap["repo"], run_dir)
    graded = G.grade_run(run_dir, task, snap["base_commit"],
                         (R.subagent_type(task, variant), task["agent"]))
    tx = graded["transcript"]
    model_keys = sorted((res or {}).get("modelUsage", {}).keys())
    status, reason = status_of(res, run, bool(tx["contaminated"]), sorted(set(tx["models"]) | set(model_keys)),
                               R.allowed_models(task))
    row = {
        "run_id": run_id, "task_id": task["id"], "variant": variant, "rep": rep, "role": task["role"],
        "agent": R.subagent_type(task, variant), "agent_src": provenance, "model": task.get("model", "haiku"), "tier": task["tier"], "base": task["base"],
        "base_commit": snap["base_commit"], "status": status, "void_reason": reason,
        "start_ts": start, "end_ts": C.utc_now(), "wall_s": run["wall_s"], "exit_code": run["exit_code"],
        "timed_out": run["timed_out"], "session_id": session, "transcripts": transcripts,
        "result_subtype": (res or {}).get("subtype"), "is_error": (res or {}).get("is_error"),
        "result_cost_usd": (res or {}).get("total_cost_usd"), "result_num_turns": (res or {}).get("num_turns"),
        "result_usage": (res or {}).get("usage"), "result_model_keys": model_keys,
        "permission_denials_n": len((res or {}).get("permission_denials") or []),
        "rate_limit_util_before": quota_before, "rate_limit_util_end": parsed["util"],
        "tok": tx["usage"], "api_turns": tx["api_turns"], "max_ctx": tx["max_ctx"],
        "compactions": tx["compactions"], "first_turn_tok": tx["first_turn_tok"],
        "first_turn_source": tx["first_turn_source"], "instructions": tx["instructions"],
        "nested_memory": tx["nested_memory"], "nested_spawns": tx["agent_spawns"],
        "tier_violations": tx["tier_violations"], "contaminated": tx["contaminated"],
        "harness_denials": graded["harness_denials"],
        "visible": {"pass": graded["visible"]["pass"],
                    "flaky_retry": any(v["flaky_retry"] for v in graded["visible"]["results"])},
        "hidden": None if graded["hidden"] is None else {"pass": graded["hidden"]["pass"],
                                                         "files": [{k: f[k] for k in ("dest", "rc", "counts",
                                                                                     "api_mismatch")}
                                                                   for f in graded["hidden"]["files"]]},
        "check_ok": graded["check_ok"], "lint_ok": graded["lint_ok"], "fmt_ok": graded["fmt_ok"],
        "fp": graded["fp"], "fp_gate_rc": graded["fp_gate_rc"], "scope_out": graded["scope_out"],
        "fail_first": graded["fail_first"]["status"], "fail_first_detail": graded["fail_first"],
        "criticals": graded["criticals"], "acceptance_pass": graded["acceptance_pass"],
        "role_checks": {k: v["ok"] for k, v in graded["role_checks"]["checks"].items()},
        "leak": graded.get("leak"),
        "files_touched": graded["files_touched"], "commits": graded["commits"],
        "diff_added_lines": graded["diff_added_lines"],
    }
    C.append_jsonl(RUNS_LOG, row)
    write_quota(parsed["util"], run_id, ((parsed["rate"] or {}).get("rate_limit_info") or {}).get("resetsAt"))
    if not keep:
        shutil.rmtree(snap["repo"], ignore_errors=True)
    print(f"{run_id}: {status} acceptance={graded['acceptance_pass']} cost=${row['result_cost_usd']} "
          f"wall={run['wall_s']}s turns={row['result_num_turns']}")
    return row


def check_quota_value() -> Optional[float]:
    state = C.read_json(QUOTA_FILE, None)
    return None if not state else state.get("seven_day_utilization")


def cmd_run(args: argparse.Namespace) -> int:
    if args.parallel > C.MAX_CONCURRENT:
        raise C.Refused(f"--parallel capped at {C.MAX_CONCURRENT}")
    cfg = C.load_tasks()
    task = C.find_task(cfg, args.task)
    if args.dry_run:
        print(R.render_brief(task, args.variant))
        return 0
    C.check_eval_cap()
    C.ensure_harness()
    check_quota()
    R.agent_provenance(task, args.variant)  # refuses before any snapshot work when the variant build is stale
    jobs = [(task, args.variant, rep, args.keep) for rep in range(args.rep_start, args.rep_start + args.reps)]
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = [pool.submit(_guarded, *job) for job in jobs]
        for fut in futures:
            fut.result()
    return 0


def _guarded(task: Dict[str, Any], variant: str, rep: int, keep: bool) -> Dict[str, Any]:
    check_quota()
    return run_one(task, variant, rep, keep)


def cmd_quota(_args: argparse.Namespace) -> int:
    util = check_quota_value()
    print(f"last seven_day utilisation: {util}; ceiling {C.QUOTA_CEILING}")
    try:
        check_quota()
        print("batch would start")
    except C.Refused as exc:
        print(f"batch refused: {exc}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--task", required=True)
    r.add_argument("--variant", required=True)
    r.add_argument("--reps", type=int, default=1)
    r.add_argument("--rep-start", type=int, default=1)
    r.add_argument("--parallel", type=int, default=1)
    r.add_argument("--keep", action="store_true", help="keep runs/<RUN>/repo after grading")
    r.add_argument("--dry-run", action="store_true", help="print the rendered brief and exit")
    sub.add_parser("quota")
    return p


def main(argv: List[str]) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "run":
        return cmd_run(args)
    return cmd_quota(args)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except C.Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(2)
