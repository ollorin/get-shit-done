#!/usr/bin/env python3
"""Q3 runner: probes, randomised arm runs, aggregation. Own state in ~/ab-eval-q3 only; reads ~/ab-eval/results/quota.json read-only.
Spawn shape mirrors apps/e2e-charlotte/runner/run.ts (cwd, env scrubbing, --allowedTools, --print) plus
--output-format stream-json --verbose --no-session-persistence in every arm."""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import signal
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import q3_grade as G
import q3_spec as S

HOME = S.Q3_HOME
RUNS = HOME / "runs"
PROBES = HOME / "probes"
OTHER_QUOTA = Path.home() / "ab-eval" / "results" / "quota.json"
MY_QUOTA = HOME / "quota.json"
QUOTA_STOP = 0.82
DISK_STOP_GIB = 7.0
SESSION_TIMEOUT_S = 900
CHARLOTTE_TOOLS_TS = S.RUNNER_SRC["tool-policy.ts"]


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def charlotte_tools() -> List[str]:
    """The exact CHARLOTTE_TOOLS list from tool-policy.ts, parsed at run time so it cannot drift."""
    import re
    src = CHARLOTTE_TOOLS_TS.read_text()
    block = src[src.index("export const CHARLOTTE_TOOLS"):]
    block = block[:block.index("] as const")]
    return re.findall(r'"(mcp__charlotte__charlotte_[a-z_]+)"', block)


def free_gib() -> float:
    return shutil.disk_usage("/System/Volumes/Data").free / 1024 ** 3


def quota_util() -> float:
    vals = []
    for p in (OTHER_QUOTA, MY_QUOTA):
        try:
            v = json.loads(p.read_text()).get("seven_day_utilization")
            if v is not None:
                vals.append(float(v))
        except (OSError, ValueError):
            pass
    return max(vals) if vals else 0.0


class Stop(RuntimeError):
    pass


def guard() -> None:
    q, d = quota_util(), free_gib()
    if q >= QUOTA_STOP:
        raise Stop(f"quota {q:.2f} >= {QUOTA_STOP}")
    if d < DISK_STOP_GIB:
        raise Stop(f"free disk {d:.1f} GiB < {DISK_STOP_GIB}")


# ---------------------------------------------------------------- servers
def start_servers() -> List[subprocess.Popen]:
    clean = HOME / "fixtures" / "qa-app-clean"
    S.build_clean(clean)
    procs = []
    for port, d in ((S.SEEDED_PORT, S.SEEDED_SRC), (S.CLEAN_PORT, clean)):
        p = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(d)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        procs.append(p)
    time.sleep(1.0)
    return procs


def stop_servers(procs: List[subprocess.Popen]) -> None:
    for p in procs:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)


# ---------------------------------------------------------------- prompts
def gen_prompts() -> Dict[str, Dict[str, str]]:
    """Prompts from the production buildPrompt, generated now; control text, and C text with the STEP 2 patch."""
    HOME.mkdir(parents=True, exist_ok=True)
    scj, out = HOME / "scenarios.json", HOME / "prompts.json"
    scj.write_text(json.dumps({k: S.scenario_data(k) for k in ("seeded", "clean")}))
    shot = str(HOME / "shots")
    subprocess.run(["deno", "run", "--no-lock", f"--allow-read={S.RUNNER_DIR},{scj}", f"--allow-write={out}",
                    str(Path(__file__).with_name("gen_prompt.ts")), str(scj), str(out), shot], check=True, cwd=str(HOME))
    base = json.loads(out.read_text())
    res: Dict[str, Dict[str, str]] = {"control": {}, "C": {}}
    for k, p in base.items():
        res["control"][k] = p
        old = S.STEP2_OLD.format(shot=f"{shot}/{k}/screenshots")
        new = S.STEP2_NEW.format(shot=f"{shot}/{k}/screenshots")
        if p.count(old) != 1:
            raise RuntimeError("STEP 2 anchor not found exactly once in generated prompt")
        res["C"][k] = p.replace(old, new)
    return res


def provenance() -> Dict[str, Any]:
    d = {f: S.sha256(p) for f, p in S.RUNNER_SRC.items()}
    d["defects.json"] = S.sha256(S.DEFECTS)
    return d


# ---------------------------------------------------------------- spawn
def build_cmd(arm: str, prompt: str, extra_flags: Optional[List[str]] = None, arm_spec: Optional[dict] = None, tools: Optional[List[str]] = None):
    spec = arm_spec or S.ARMS[arm]
    tools = tools or charlotte_tools()
    args = ["claude", "--model", spec["model"], "--allowedTools", ",".join(tools)]
    if spec["denied"]:
        args += ["--disallowedTools", ",".join(spec["denied"])]
    args += list(spec["flags"]) + list(extra_flags or [])
    args += ["--output-format", "stream-json", "--verbose", "--no-session-persistence", "--print", prompt]
    return args


def child_env(spec: dict, shot_dir: str) -> Dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_SSE_PORT", "ANTHROPIC_API_KEY")}
    env["CHARLOTTE_SCREENSHOT_DIR"] = shot_dir
    env["FORCE_PROMPT_CACHING_5M"] = "1"
    env.update(spec["env"])
    return env


def spawn(args: List[str], env: Dict[str, str], out_dir: Path, timeout: int = SESSION_TIMEOUT_S) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    p = subprocess.Popen(args, cwd=str(S.RUNNER_DIR), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         stdin=subprocess.DEVNULL, start_new_session=True, text=True)
    timed_out = False
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(p.pid, signal.SIGKILL)
        out, err = p.communicate()
    finally:
        try:
            os.killpg(p.pid, signal.SIGTERM)  # reap MCP child + its browser; our own process group only
        except ProcessLookupError:
            pass
    wall = time.time() - t0
    (out_dir / "stream.jsonl").write_text(out)
    (out_dir / "stderr.txt").write_text(err)
    return {"exit": p.returncode, "timed_out": timed_out, "wall_s": round(wall, 1), "stdout": out}


# ---------------------------------------------------------------- stream parsing
def events(stdout: str) -> List[dict]:
    res = []
    for line in stdout.splitlines():
        try:
            res.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return res


def calls_from(evs: List[dict]) -> List[dict]:
    by_id: Dict[str, dict] = {}
    order: List[str] = []
    for e in evs:
        if e.get("type") != "assistant":
            continue
        m = e.get("message", {})
        mid, u = m.get("id"), m.get("usage") or {}
        if not mid:
            continue
        if mid not in by_id:
            order.append(mid)
            by_id[mid] = {"id": mid, "model": m.get("model"), "usage": u}
        elif (u.get("output_tokens") or 0) >= (by_id[mid]["usage"].get("output_tokens") or 0):
            by_id[mid]["usage"] = u
    return [by_id[i] for i in order]


def prompt_tokens(u: dict) -> int:
    return int(u.get("input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0)


def price_call(u: dict, tiers: list) -> float:
    pt = prompt_tokens(u)
    for lim, pin, pout in tiers:
        if lim is None or pt <= lim:
            break
    cc = u.get("cache_creation") or {}
    w5 = int(cc.get("ephemeral_5m_input_tokens", u.get("cache_creation_input_tokens") or 0) or 0)
    w1 = int(cc.get("ephemeral_1h_input_tokens", 0) or 0)
    fresh = int(u.get("input_tokens") or 0)
    rd = int(u.get("cache_read_input_tokens") or 0)
    outt = int(u.get("output_tokens") or 0)
    return (fresh * pin + rd * pin * 0.1 + w5 * pin * 1.25 + w1 * pin * 2.0 + outt * pout) / 1e6


def extra_out(calls: List[dict], res: dict, tiers: list) -> float:
    """Streamed assistant events carry a partial output_tokens; the result event has the final total. Price the shortfall at the output rate of the last call's tier."""
    if not calls:
        return 0.0
    missing = int((res.get("usage") or {}).get("output_tokens") or 0) - sum(int(c["usage"].get("output_tokens") or 0) for c in calls)
    if missing <= 0:
        return 0.0
    pt = prompt_tokens(calls[-1]["usage"])
    pout = next(po for lim, _, po in tiers if lim is None or pt <= lim)
    return missing * pout / 1e6


def summarise_stream(stdout: str) -> Dict[str, Any]:
    evs = events(stdout)
    init = next((e for e in evs if e.get("type") == "system" and e.get("subtype") == "init"), {})
    res = next((e for e in reversed(evs) if e.get("type") == "result"), {})
    calls = calls_from(evs)
    first = prompt_tokens(calls[0]["usage"]) if calls else None
    tot = {k: sum(int(c["usage"].get(k) or 0) for c in calls) for k in
           ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")}
    # tool use / result accounting
    names: Dict[str, str] = {}
    n_tool = 0
    result_chars = 0
    delta_results = 0
    action_results = 0
    for e in evs:
        msg = e.get("message") or {}
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for b in content:
            if b.get("type") == "tool_use":
                names[b["id"]] = b["name"]
                n_tool += 1
            elif b.get("type") == "tool_result":
                txt = b.get("content")
                if isinstance(txt, list):
                    txt = "".join(x.get("text", "") for x in txt if isinstance(x, dict))
                txt = str(txt or "")
                result_chars += len(txt)
                nm = names.get(b.get("tool_use_id"), "")
                if nm.endswith(("charlotte_click", "charlotte_wait_for", "charlotte_type")):
                    action_results += 1
                    if '"delta"' in txt:
                        delta_results += 1
    rate = [e for e in evs if e.get("type") == "rate_limit_event"]
    util = None
    for e in rate:
        v = ((((e.get("rate_limit_info") or {}).get("unifiedWindows") or {}).get("seven_day")) or {}).get("utilization")
        if v is not None:
            util = float(v)
    models = sorted({c["model"] for c in calls if c.get("model")})
    return {
        "init_tools": len(init.get("tools") or []), "init_slash": init.get("slash_commands"), "init_skills": init.get("skills"),
        "init_agents": init.get("agents"), "init_model": init.get("model"), "init_tool_names": init.get("tools"),
        "mcp_servers": init.get("mcp_servers"), "memory_paths": init.get("memory_paths"),
        "n_calls": len(calls), "first_turn_tokens": first, "usage_total": tot,
        "total_tokens": sum(tot.values()), "models_used": models,
        "output_tokens_result": int((res.get("usage") or {}).get("output_tokens") or 0),
        "cost_haiku45": round(sum(price_call(c["usage"], S.PRICES["haiku-4.5"]["tiers"]) for c in calls) + extra_out(calls, res, S.PRICES["haiku-4.5"]["tiers"]), 4),
        "cost_haiku55": round(sum(price_call(c["usage"], S.PRICES["haiku-5.5"]["tiers"]) for c in calls) + extra_out(calls, res, S.PRICES["haiku-5.5"]["tiers"]), 4),
        "cli_cost_usd": res.get("total_cost_usd"), "is_error": res.get("is_error"), "subtype": res.get("subtype"),
        "num_turns": res.get("num_turns"), "duration_ms": res.get("duration_ms"),
        "n_tool_calls": n_tool, "tool_result_chars": result_chars,
        "action_results": action_results, "action_results_with_delta": delta_results,
        "final_text": res.get("result") or "", "seven_day_util": util,
    }


def record_quota(util: Optional[float], run_id: str) -> None:
    if util is not None:
        MY_QUOTA.write_text(json.dumps({"seven_day_utilization": util, "run_id": run_id, "ts": now()}))


# ---------------------------------------------------------------- scored session
def run_session(prompts: Dict[str, Dict[str, str]], arm: str, kind: str, rep: int, order_idx: int) -> Dict[str, Any]:
    guard()
    spec = S.ARMS[arm]
    run_id = f"{order_idx:02d}-{arm.replace('+', '_')}-{kind}-r{rep}"
    rdir = RUNS / run_id
    shot = HOME / "shots" / kind / "screenshots"
    prompt = prompts["C" if spec["manual"] else "control"][kind]
    args = build_cmd(arm, prompt)
    raw = spawn(args, child_env(spec, str(shot)), rdir)
    sm = summarise_stream(raw["stdout"])
    record_quota(sm.get("seven_day_util"), run_id)
    gr = G.grade(kind, sm["final_text"])
    rec = {"run_id": run_id, "arm": arm, "kind": kind, "rep": rep, "order": order_idx, "ts": now(),
           "exit": raw["exit"], "timed_out": raw["timed_out"], "wall_s": raw["wall_s"], "grade": gr,
           **{k: v for k, v in sm.items() if k not in ("final_text", "init_tool_names")}}
    (rdir / "record.json").write_text(json.dumps(rec, indent=1))
    (rdir / "final_text.txt").write_text(sm["final_text"])
    with (HOME / "runs.jsonl").open("a") as f:
        f.write(json.dumps(rec) + "\n")
    return rec


def cmd_run(a: argparse.Namespace) -> int:
    arms = a.arms.split(",")
    prompts = gen_prompts()
    jobs = [(arm, kind, rep) for arm in arms for kind in ("seeded", "clean") for rep in range(1, a.reps + 1)]
    rnd = random.Random(a.seed)
    rnd.shuffle(jobs)
    (HOME / f"order-{a.tag}.json").write_text(json.dumps({"seed": a.seed, "arms": arms, "order": jobs, "prov": provenance()}))
    servers = start_servers()
    try:
        done: List[dict] = []
        with ThreadPoolExecutor(max_workers=a.parallel) as pool:
            futs = [pool.submit(run_session, prompts, arm, kind, rep, i + a.order_base) for i, (arm, kind, rep) in enumerate(jobs)]
            for f in futs:
                try:
                    r = f.result()
                    done.append(r)
                    print(f"{r['run_id']}: exit={r['exit']} parse={r['grade']['parse_ok']} det={len(r['grade']['defects_detected'])} ff={len(r['grade']['false_fail_tags'])} "
                          f"first={r['first_turn_tokens']} cost45={r['cost_haiku45']} wall={r['wall_s']}", flush=True)
                except Stop as exc:
                    print(f"STOP: {exc}", flush=True)
    finally:
        stop_servers(servers)
    return 0


# ---------------------------------------------------------------- probes
PROBE_QUESTIONS = ("Answer in at most 3 short lines and call no tools. (1) Do you see project instructions that begin with 'Path-trace any claim made about code'? yes/no. "
                   "(2) Is there an auto memory section or MEMORY.md index in your system prompt? yes/no. (3) Are the Skill tool and the Agent tool available to you? yes/no.")


def probe_variants() -> List[tuple]:
    base = dict(model=S.MODEL_PIN, env={}, flags=[], denied=[], manual=False)
    v = [("P0-base", base)]
    v.append(("P1-claude-mds", {**base, "env": {"CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1"}}))
    v.append(("P2-auto-memory", {**base, "env": {"CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}}))
    v.append(("P3-slash", {**base, "flags": ["--disable-slash-commands"]}))
    v.append(("P4-denied", {**base, "denied": S.LEAN_DENIED}))
    v.append(("P5-all-C1C2", {**S.ARMS["C"], "manual": False}))
    return v


def cmd_probe(a: argparse.Namespace) -> int:
    PROBES.mkdir(parents=True, exist_ok=True)
    tools = charlotte_tools()
    results = {}
    only = set(a.only.split(",")) if a.only else None
    for name, spec in probe_variants():
        if only and name not in only:
            continue
        guard()
        args = build_cmd("probe", PROBE_QUESTIONS, arm_spec=spec, tools=tools)
        raw = spawn(args, child_env(spec, str(HOME / "shots" / "probe")), PROBES / name, timeout=240)
        sm = summarise_stream(raw["stdout"])
        record_quota(sm.get("seven_day_util"), name)
        results[name] = {k: sm[k] for k in ("first_turn_tokens", "init_tools", "init_slash", "init_skills", "init_agents", "init_model",
                                              "memory_paths", "cost_haiku45", "cli_cost_usd", "n_calls")}
        results[name]["answer"] = sm["final_text"]
        results[name]["has_Agent_Skill_tool"] = [t for t in (sm["init_tool_names"] or []) if t in ("Agent", "Skill", "Task")]
        results[name]["exit"] = raw["exit"]
        print(name, json.dumps(results[name])[:600], flush=True)
    (PROBES / "probe-env-flags.json").write_text(json.dumps(results, indent=1))
    return 0


def cmd_probe_delta(a: argparse.Namespace) -> int:
    servers = start_servers()
    tools = charlotte_tools()
    base = f"http://127.0.0.1:{S.CLEAN_PORT}"
    out = {}
    try:
        for name, extra in (("D-default", ""), ("D-manual", ', auto_snapshot: "manual"')):
            guard()
            prompt = (f"Do exactly these steps and nothing else. 1) charlotte_tab_open with no URL. 2) charlotte_configure with screenshot_dir: \"{HOME}/shots/probe\"{extra}. "
                      f"3) charlotte_navigate to {base}/index.html. 4) charlotte_click on the button 'Add to wishlist'. 5) charlotte_wait_for with js: \"true\" and timeout 1000. "
                      f"6) charlotte_tab_close. Reply with the single word done.")
            spec = {**S.ARMS["control"]}
            raw = spawn(build_cmd("probe", prompt, arm_spec=spec, tools=tools), child_env(spec, str(HOME / "shots" / "probe")), PROBES / name, timeout=300)
            sm = summarise_stream(raw["stdout"])
            record_quota(sm.get("seven_day_util"), name)
            out[name] = {k: sm[k] for k in ("n_tool_calls", "action_results", "action_results_with_delta", "tool_result_chars", "cost_haiku45", "n_calls")}
            out[name]["exit"] = raw["exit"]
            print(name, out[name], flush=True)
    finally:
        stop_servers(servers)
    (PROBES / "probe-delta.json").write_text(json.dumps(out, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("probe"); p.add_argument("--only", default=""); p.set_defaults(fn=cmd_probe)
    p = sub.add_parser("probe-delta"); p.set_defaults(fn=cmd_probe_delta)
    p = sub.add_parser("run"); p.add_argument("--arms", required=True); p.add_argument("--reps", type=int, default=3)
    p.add_argument("--seed", type=int, required=True); p.add_argument("--tag", required=True); p.add_argument("--parallel", type=int, default=2)
    p.add_argument("--order-base", type=int, default=0); p.set_defaults(fn=cmd_run)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
