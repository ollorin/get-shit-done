#!/usr/bin/env python3
"""Blinded pairwise judging of two runs (DESIGN §5.2, §7.3, §7.5).

  pack --a RUN_A --b RUN_B --rep N [--second-judge fable|sonnet --sample 0.25]
                                 blinded packets for both orders; key.json stays outside the sandbox
  judge --pair PAIR_ID [--model opus] [--second]
                                 one Claude call per order; verdict JSON stored per packet
  collapse [--judge-model opus]  pair verdicts -> results/pairs.jsonl (B-win / A-win / tie)
  selftest [--model haiku]       fake packet through the same judge path; writes nothing to results/
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402
from ab_roles import task_brief_text  # noqa: E402

PREFS = ("X", "Y", "tie")
FENCE_RE = re.compile(r"```(?:json)?[ \t]*\n(.*?)\n```", re.S)
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
FINGERPRINTS = (  # instruction-file names that would reveal the arm (DESIGN §5.2 blinding)
    r"CLAUDE\.md", r"\.claude/rules/[\w.\-]+\.md", r"docs/rules/[\w.\-]+-reference\.md",
    r"MEMORY\.md", r"orchestration\.md",
)
DIMS: Dict[str, List[Tuple[str, str]]] = {
    "executor": [
        ("correctness", "correctness"),
        ("completeness", "completeness vs the scoped tasks"),
        ("conventions", "project conventions (Result types not throw, immutability, pure domain, 500-line files, "
                        "move-only splits, test rules)"),
        ("test_quality", "test quality (can fail, lowest layer, RED before GREEN, no hollow assertions)"),
        ("honesty", "report honesty (every claim in report.md matches gates.md and the diffs; unrun steps declared)"),
        ("scope", "scope discipline (no unrelated edits; deviations declared)"),
    ],
    "review": [
        ("real_defects", "real defects found (reference list supplied)"),
        ("false_positives", "false positives"),
        ("severity", "severity calibration"),
        ("actionability", "actionability (file:line + fix)"),
        ("claims_traced", "claims traced to code"),
        ("honesty", "report honesty (claims match the code and the gates)"),
    ],
    "plancheck": [
        ("real_defects", "real plan defects found (reference list supplied)"),
        ("false_positives", "false positives"),
        ("severity", "severity calibration"),
        ("actionability", "actionability (file:line + fix)"),
        ("claims_traced", "claims traced to code"),
        ("honesty", "report honesty"),
    ],
    "planner": [
        ("coverage", "coverage of the finding and requirements"),
        ("executability", "executability (files, verify, tasks sized, tier tags)"),
        ("test_plan", "test plan (fail-first, lowest layer, mutation where T0)"),
        ("conventions", "conventions (500 LOC, migration + ROLLBACK, grants, allowlisted commands, zg)"),
        ("risk_handling", "risk handling (threat model, stack lock); no gold-plating"),
        ("honesty", "report honesty"),
    ],
    "verifier": [
        ("real_gaps", "real gaps found (reference list supplied)"),
        ("false_positives", "false positives"),
        ("status_calibration", "status calibration (gaps_found vs passed)"),
        ("actionability", "actionability (file:line + fix)"),
        ("claims_traced", "claims traced to code"),
        ("honesty", "report honesty"),
    ],
    "docs-updater": [
        ("accuracy", "accuracy and grounding (each statement matches the source and SUMMARY in inputs/ and the "
                     "reference; nothing invented)"),
        ("coverage", "coverage of what the SUMMARY says was built, within the requested scope"),
        ("conventions", "docs conventions (frontmatter, tables for reference, no filler or padding, DRY links, "
                        "thin and focused)"),
        ("scope", "scope discipline (only the requested section and paths; surgical; no unrelated edits)"),
        ("honesty", "contract and report honesty (written_files, commit and errors match the diff and gates.md; "
                    "failed or unrun steps declared; an empty write justified when nothing was needed)"),
    ],
}


def dims_for(role: str) -> List[Tuple[str, str]]:
    return DIMS.get(role, DIMS["executor"])


def redact(text: str, run_id: str, repo_path: str, extra: List[str]) -> str:
    text = text.replace(repo_path, "<repo>")
    text = text.replace(run_id, "<run>")
    text = UUID_RE.sub("<id>", text)
    text = re.sub(r"(?m)^.*(Co-Authored-By|Claude-Session).*$", "<redacted>", text)
    for pat in FINGERPRINTS + tuple(extra):
        text = re.sub(pat, "<instructions>", text)
    return text


def _slug(model: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", model).strip("-")


def ensure_judge_settings() -> Path:
    path = C.AB_HOME / "harness" / "judge-settings.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "autoMemoryEnabled": False,
        "hooks": {"PreToolUse": [{"matcher": "Read|Glob|Grep|Bash", "hooks": [
            {"type": "command", "command": str(C.HOOKS / "judge-deny.py")}]}]},
    }, indent=2))
    empty = C.AB_HOME / "harness" / "empty-mcp.json"
    if not empty.exists():
        empty.write_text('{"mcpServers":{}}')
    return path


def regraded_summary(summary: Dict[str, Any], run_id: str) -> Dict[str, Any]:
    """The packet shows the run's criticals after the regrade overlay (results/regraded.jsonl): a critical that a
    later harness fix showed to be a false positive must not be argued by the judge."""
    out = dict(summary)
    for row in C.read_jsonl(C.AB_HOME / "results" / "regraded.jsonl"):
        if row.get("run_id") == run_id and "criticals" in row.get("set", {}):
            out["criticals"] = row["set"]["criticals"]
    return out


def _side_files(run_dir: Path, run_id: str, repo_path: str, extra: List[str],
                role_checks: bool = False) -> Dict[str, str]:
    grade = run_dir / "grade"
    summary = regraded_summary(C.read_json(grade / "summary.json", {}), run_id)
    diff = (grade / "diff.patch").read_text() if (grade / "diff.patch").exists() else "(no diff)"
    report = (run_dir / "report.md").read_text() if (run_dir / "report.md").exists() else "(no final report)"
    gates_lines = [
        f"visible tests pass: {summary.get('visible', {}).get('pass')}",
        *[f"  {v['cmd']} -> rc={v['rc']}" for v in summary.get("visible", {}).get("results", [])],
        f"deno check ok: {summary.get('check_ok')}",
        f"deno lint ok: {summary.get('lint_ok')}",
        f"deno fmt ok (reported only): {summary.get('fmt_ok')}",
        f"files touched: {', '.join(summary.get('files_touched', [])) or '(none)'}",
        f"out-of-scope files: {', '.join(summary.get('scope_out', [])) or '(none)'}",
        f"criticals: {', '.join(summary.get('criticals', [])) or '(none)'}",
    ]
    role_lines = [f"{name}: {'ok' if c.get('ok') else 'FAILED'} ({c.get('detail', '')})"
                  for name, c in (summary.get("role_checks", {}) or {}).get("checks", {}).items()
                  if name not in ("contract_parses",)] if role_checks else []
    if role_lines:
        gates_lines += ["role checks:"] + [f"  {ln}" for ln in role_lines]
    return {
        "diff.patch": redact(diff, run_id, repo_path, extra),
        "report.md": redact(report, run_id, repo_path, extra),
        "gates.md": redact("\n".join(gates_lines) + "\n", run_id, repo_path, extra),
        "planning.patch": "(not applicable: executor packet has no planning changes)\n",
    }


def build_packet(pdir: Path, a_run: str, b_run: str, x_run: str, y_run: str, task: Dict[str, Any],
                 extra: List[str]) -> None:
    sb = pdir / "sandbox"
    if sb.exists():
        shutil.rmtree(sb)
    for side, run_id in (("X", x_run), ("Y", y_run)):
        run_dir = C.AB_HOME / "runs" / run_id
        repo_path = str(run_dir / "repo")
        (sb / side).mkdir(parents=True)
        for name, text in _side_files(run_dir, run_id, repo_path, extra, task["role"] == "docs-updater").items():
            (sb / side / name).write_text(text)
    (sb / "reference").mkdir(parents=True)
    ref = (C.task_dir(task["id"]) / "oracle" / "ref.diff")
    (sb / "reference" / "ref.diff").write_text(ref.read_text() if ref.exists() else "(no reference)\n")
    scope = "\n".join(f"- {p}" for p in task.get("scope_files", [])) or "(none: a negative control)"
    tasks = "\n".join(f"- {t}" for t in task.get("task_names", [])) or "(see the brief)"
    brief = task_brief_text(task)
    (sb / "task.md").write_text(
        f"# Task {task['id']} ({task['role']})\n\n"
        f"Plan: {task.get('plan') or '(none)'}\n\nTasks in scope:\n{tasks}\n\nScope files:\n{scope}\n\n"
        f"Visible verify: {'; '.join(' '.join(v) for v in task.get('verify', [])) or '(none)'}\n\n"
        f"Brief given to the agent:\n\n{brief}\n\n"
        "Constraints: the shared stack (Supabase, Docker, integration, Charlotte) was unavailable; steps that "
        "need it must be reported as not run. The repository was a one-commit snapshot, so shas and commit ranges "
        "named in the brief do not resolve there.\n")
    if task["role"] == "docs-updater":
        for rel in (task.get("calibration") or {}).get("inputs", []):
            src = C.task_dir(task["id"]) / "pristine-A" / rel
            if src.is_file() and src.suffix == ".md":
                (sb / "inputs").mkdir(exist_ok=True)
                (sb / "inputs" / src.name).write_text(src.read_text(errors="replace"))
    role_dims = dims_for(task["role"])
    prompt = (C.PROMPTS / "judge.md").read_text()
    prompt = prompt.replace("{{ROLE}}", task["role"]).replace(
        "{{DIMENSIONS}}", "\n".join(f"- {key}: {text}" for key, text in role_dims))
    (sb / "prompt.md").write_text(prompt)


def pair_id(task_id: str, rep: int, a: str, b: str) -> str:
    return f"{task_id}-r{rep}-" + hashlib.sha256((a + "|" + b).encode()).hexdigest()[:8]


def _run_rows() -> Dict[str, Dict[str, Any]]:
    path = C.AB_HOME / "results" / "runs.jsonl"
    rows = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                rows[r["run_id"]] = r
    return rows


def cmd_pack(args: argparse.Namespace) -> int:
    rows = _run_rows()
    a, b = rows.get(args.a), rows.get(args.b)
    if not a or not b:
        raise C.Refused("both runs must be in results/runs.jsonl")
    if a["task_id"] != b["task_id"] or a["variant"] == b["variant"]:
        raise C.Refused("pairs need the same task and two different arms")
    if a["status"] != "done" or b["status"] != "done":
        raise C.Refused("only done runs are judged (void/failed runs are re-run or reported)")
    cfg = C.load_tasks()
    task = C.find_task(cfg, a["task_id"])
    extra = _extra_redactions(a["variant"]) + _extra_redactions(b["variant"])
    pid = pair_id(task["id"], args.rep, args.a, args.b)
    jdir = C.AB_HOME / "judge" / pid
    if jdir.exists():
        shutil.rmtree(jdir)
    orders = {}
    for order, (x, y) in (("o1", (a, b)), ("o2", (b, a))):
        pdir = jdir / order
        pdir.mkdir(parents=True)
        build_packet(pdir, args.a, args.b, x["run_id"], y["run_id"], task, extra)
        C.write_json(pdir / "key.json", {"X": x["variant"], "Y": y["variant"], "X_run": x["run_id"],
                                         "Y_run": y["run_id"]})
        orders[order] = {"X": x["variant"], "Y": y["variant"]}
    sampled = bool(args.second_judge) and (int(hashlib.sha256(pid.encode()).hexdigest()[:8], 16) / 2 ** 32
                                           < args.sample)
    C.write_json(jdir / "index.json", {"pair_id": pid, "task": task["id"], "rep": args.rep, "a": args.a,
                                       "b": args.b, "a_arm": a["variant"], "b_arm": b["variant"], "orders": orders,
                                       "second_judge_sampled": sampled})
    print(f"packed {pid}: both orders under {jdir} (second judge sampled: {sampled})")
    return 0


def _extra_redactions(variant: str) -> List[str]:
    path = C.variant_dir(variant) / "redact.txt"
    if not path.exists():
        return []
    return [ln.strip() for ln in path.read_text().splitlines() if ln.strip() and not ln.startswith("#")]


def _call_judge(sandbox: Path, prompt: str, model: str) -> Tuple[Optional[str], Optional[str]]:
    settings = ensure_judge_settings()
    argv = ["claude", "-p", prompt, "--model", model, "--setting-sources", "local",
            "--settings", str(settings), "--strict-mcp-config",
            "--mcp-config", str(C.AB_HOME / "harness" / "empty-mcp.json"),
            "--allowedTools", "Read",
            "--disallowedTools", "Bash", "Edit", "Write", "Agent",
            "--output-format", "json"]
    proc = subprocess.run(argv, cwd=str(sandbox), capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        return None, f"claude rc={proc.returncode}: {proc.stderr.strip()[-200:]}"
    try:
        return json.loads(proc.stdout).get("result", ""), None
    except ValueError:
        return None, "non-JSON claude output"


def parse_verdict(text: str, role: str) -> Dict[str, Any]:
    """Last fenced JSON block; every dimension must be present with a valid pref (DESIGN §7.5)."""
    blocks = FENCE_RE.findall(text)
    if not blocks:
        raise ValueError("no fenced JSON block")
    verdict = json.loads(blocks[-1])
    dims = verdict.get("dims", {})
    expected = [k for k, _ in dims_for(role)]
    missing = [k for k in expected if k not in dims]
    if missing:
        raise ValueError(f"missing dimensions {missing}")
    for k in expected:
        if dims[k].get("pref") not in PREFS:
            raise ValueError(f"bad pref for {k}")
    if verdict.get("overall", {}).get("pref") not in PREFS:
        raise ValueError("bad overall pref")
    return verdict


def judge_packet(pdir: Path, role: str, model: str) -> Dict[str, Any]:
    sandbox = pdir / "sandbox"
    prompt = (sandbox / "prompt.md").read_text()
    out_path = pdir / f"out-{_slug(model)}.json"
    last_err = None
    for attempt in (1, 2):
        text, err = _call_judge(sandbox, prompt, model)
        if err is None:
            try:
                verdict = parse_verdict(text or "", role)
                result = {"verdict": verdict, "error": None, "attempt": attempt, "model": model}
                C.write_json(out_path, result)
                return result
            except (ValueError, KeyError) as exc:
                last_err = f"invalid verdict: {exc}"
        else:
            last_err = err
    result = {"verdict": None, "error": last_err, "attempt": 2, "model": model}
    C.write_json(out_path, result)
    return result


def _arm_of(pref: str, x_arm: str, y_arm: str) -> str:
    return {"X": x_arm, "Y": y_arm}.get(pref, "tie")


def cmd_judge(args: argparse.Namespace) -> int:
    cfg = C.load_tasks()
    idx = C.read_json(C.AB_HOME / "judge" / args.pair / "index.json")
    if not idx:
        raise C.Refused(f"no packets for {args.pair}")
    if args.second and not idx["second_judge_sampled"]:
        print("pair not in the second-judge sample; nothing to do")
        return 0
    task = C.find_task(cfg, idx["task"])
    role = task["role"]
    for order in ("o1", "o2"):
        pdir = C.AB_HOME / "judge" / args.pair / order
        result = judge_packet(pdir, role, args.model)
        key = C.read_json(pdir / "key.json")
        rows = []
        v = result["verdict"]
        for row in _judgment_rows(args.pair, order, idx, key, v, role, args.model, result["error"]):
            rows.append(row)
        for row in rows:
            C.append_jsonl(C.AB_HOME / "results" / "judgments.jsonl", row)
        status = v["overall"]["pref"] if v else f"ERROR {result['error']}"
        print(f"{args.pair} {order} {args.model}: {status}")
    return 0


def _judgment_rows(pair: str, order: str, idx: Dict[str, Any], key: Dict[str, Any], verdict: Optional[Dict[str, Any]],
                   role: str, model: str, error: Optional[str]) -> List[Dict[str, Any]]:
    base = {"pair_id": pair, "task": idx["task"], "rep": idx["rep"], "order": order, "role": role,
            "judge_model": model, "x_arm": key["X"], "y_arm": key["Y"], "error": error}
    if idx.get("a_arm") and idx.get("b_arm"):  # control = the pack's --a arm, candidate = its --b arm
        base.update(ctl_arm=idx["a_arm"], cand_arm=idx["b_arm"])
    if verdict is None:
        return [dict(base, overall_pref=None, winner=None, dims={})]
    dims = {k: {"pref": d["pref"], "winner": _arm_of(d["pref"], key["X"], key["Y"]),
                "weight": d.get("weight")} for k, d in verdict["dims"].items()}
    return [dict(base, overall_pref=verdict["overall"]["pref"],
                 winner=_arm_of(verdict["overall"]["pref"], key["X"], key["Y"]), dims=dims)]


def collapse_pair(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Both orders prefer B -> B-win; both prefer A -> A-win; otherwise tie (DESIGN §5.2)."""
    by_order = {r["order"]: r for r in rows}
    o1, o2 = by_order.get("o1"), by_order.get("o2")
    if not o1 or not o2 or o1["error"] or o2["error"] or o1["winner"] is None or o2["winner"] is None:
        return {"verdict": "error", "winners": None, "position_inconsistent": False}
    w1, w2 = _relative_winner(o1), _relative_winner(o2)
    if w1 == w2 and w1 in ("A", "B"):
        verdict = f"{w1}-win"
    else:
        verdict = "tie"
    same_position = o1["overall_pref"] in ("X", "Y") and o1["overall_pref"] == o2["overall_pref"]
    out = {"verdict": verdict, "winners": [w1, w2], "position_inconsistent": same_position}
    if o1.get("cand_arm"):
        out["cand_arm"] = o1["cand_arm"]
    return out


def _relative_winner(row: Dict[str, Any]) -> Optional[str]:
    """Winner as 'A' (control) / 'B' (candidate, whatever its arm name) / 'tie'; rows without arm fields already
    carry 'A' and 'B'."""
    w = row["winner"]
    if row.get("cand_arm") and w == row["cand_arm"]:
        return "B"
    if row.get("ctl_arm") and w == row["ctl_arm"]:
        return "A"
    return w


def cmd_collapse(args: argparse.Namespace) -> int:
    path = C.AB_HOME / "results" / "judgments.jsonl"
    rows = [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()] if path.exists() else []
    grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for r in rows:
        if r["judge_model"] != args.judge_model:
            continue
        grouped.setdefault((r["pair_id"], r["judge_model"]), []).append(r)
    out = []
    for (pid, model), grp in sorted(grouped.items()):
        first = grp[0]
        res = collapse_pair(grp)
        out.append({"pair_id": pid, "task": first["task"], "rep": first["rep"], "role": first["role"],
                    "judge_model": model, **res})
    C.write_json(C.AB_HOME / "results" / f"pairs-{args.judge_model}.json", out)
    tally: Dict[str, int] = {}
    for p in out:
        tally[p["verdict"]] = tally.get(p["verdict"], 0) + 1
    print(f"pairs collapsed: {len(out)} {tally}")
    return 0


def cmd_selftest(args: argparse.Namespace) -> int:
    root = C.AB_HOME / "judge" / "_selftest"
    if root.exists():
        shutil.rmtree(root)
    sb = root / "sandbox"
    for side, body in (("X", "+export const v = 1;\n"), ("Y", "+export const v = 2;\n")):
        (sb / side).mkdir(parents=True)
        (sb / side / "diff.patch").write_text(body)
        (sb / side / "report.md").write_text("Added v. Gates not run.\n")
        (sb / side / "gates.md").write_text("visible tests pass: True\n")
        (sb / side / "planning.patch").write_text("(none)\n")
    (sb / "reference").mkdir(parents=True)
    (sb / "reference" / "ref.diff").write_text("+export const v = 1;\n")
    (sb / "task.md").write_text("# Selftest\nAdd `export const v`.\n")
    prompt = (C.PROMPTS / "judge.md").read_text().replace("{{ROLE}}", "executor").replace(
        "{{DIMENSIONS}}", "\n".join(f"- {k}: {t}" for k, t in dims_for("executor")))
    (sb / "prompt.md").write_text(prompt)
    result = judge_packet(root, "executor", args.model)
    if result["verdict"] is None:
        print(f"selftest FAIL: {result['error']}")
        return 1
    print(f"selftest OK: model={args.model} overall={result['verdict']['overall']['pref']} "
          f"dims={len(result['verdict']['dims'])} (no rows written to results/)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    pk = sub.add_parser("pack")
    pk.add_argument("--a", required=True)
    pk.add_argument("--b", required=True)
    pk.add_argument("--rep", type=int, required=True)
    pk.add_argument("--second-judge", choices=["fable", "sonnet"], default=None)
    pk.add_argument("--sample", type=float, default=0.25)
    jd = sub.add_parser("judge")
    jd.add_argument("--pair", required=True)
    jd.add_argument("--model", default="opus")
    jd.add_argument("--second", action="store_true")
    co = sub.add_parser("collapse")
    co.add_argument("--judge-model", default="opus")
    st = sub.add_parser("selftest")
    st.add_argument("--model", default="haiku")
    return p


def main(argv: List[str]) -> int:
    args = build_parser().parse_args(argv)
    return {"pack": cmd_pack, "judge": cmd_judge, "collapse": cmd_collapse, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except C.Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(2)
