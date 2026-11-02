#!/usr/bin/env python3
"""Known-defect recall for review, plan-check and verify runs (DESIGN §5.1 known_recall, §7.6).

  run --run RUN_ID [--model sonnet]   match the run's report.md against tasks/<ID>/oracle/known.json
                                      and append one row to results/matches.jsonl (skipped if no known items)
  selftest [--model sonnet]           one fake known list and report through the same call path; writes nothing

known.json is a list of {"id", "required", "where", "mechanism"}; a run counts an item as found only when the
matcher says the report names its location and mechanism.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402
import ab_judge as J  # noqa: E402

SANDBOX = C.AB_HOME / "match-sandbox"


def load_known(task_id: str) -> List[Dict[str, Any]]:
    return C.read_json(C.task_dir(task_id) / "oracle" / "known.json", []) or []


def build_prompt(known: List[Dict[str, Any]], report: str) -> str:
    lines = [f"- {k['id']} (required: {str(bool(k.get('required'))).lower()}): location {k['where']}; "
             f"mechanism: {k['mechanism']}" for k in known]
    template = (C.PROMPTS / "matcher.md").read_text()
    return template.replace("{{KNOWN}}", "\n".join(lines)).replace("{{REPORT}}", report)


def parse_match(text: str, ids: List[str]) -> Dict[str, bool]:
    """Last fenced JSON block; every known id must carry a boolean `found` (DESIGN §7.6)."""
    blocks = J.FENCE_RE.findall(text)
    if not blocks:
        raise ValueError("no fenced JSON block")
    known = json.loads(blocks[-1]).get("known")
    if not isinstance(known, dict):
        raise ValueError("no known object")
    out = {}
    for i in ids:
        entry = known.get(i)
        if not isinstance(entry, dict) or not isinstance(entry.get("found"), bool):
            raise ValueError(f"{i}: missing boolean found")
        out[i] = entry["found"]
    return out


def _call(prompt: str, model: str) -> Tuple[Optional[str], Optional[str]]:
    """No tools, empty working directory: the matcher sees only the prompt (DESIGN §7.3)."""
    SANDBOX.mkdir(parents=True, exist_ok=True)
    settings = J.ensure_judge_settings()
    argv = ["claude", "-p", prompt, "--model", model, "--setting-sources", "local",
            "--settings", str(settings), "--strict-mcp-config",
            "--mcp-config", str(C.AB_HOME / "harness" / "empty-mcp.json"),
            "--disallowedTools", "Bash", "Edit", "Write", "Agent", "Read", "Glob", "Grep",
            "--output-format", "json"]
    proc = subprocess.run(argv, cwd=str(SANDBOX), capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        return None, f"claude rc={proc.returncode}: {proc.stderr.strip()[-200:]}"
    try:
        return json.loads(proc.stdout).get("result", ""), None
    except ValueError:
        return None, "non-JSON claude output"


def match_text(known: List[Dict[str, Any]], report: str, model: str) -> Tuple[Optional[Dict[str, bool]], Optional[str]]:
    """Two attempts, as in the judge: an invalid or failed call is retried once, then reported as an error."""
    ids = [k["id"] for k in known]
    prompt = build_prompt(known, report)
    last = None
    for _attempt in (1, 2):
        text, err = _call(prompt, model)
        if err is None:
            try:
                return parse_match(text or "", ids), None
            except (ValueError, KeyError, json.JSONDecodeError) as exc:
                last = f"invalid match: {exc}"
        else:
            last = err
    return None, last


def recall(found: Dict[str, bool]) -> float:
    return sum(1 for v in found.values() if v) / len(found) if found else 0.0


def cmd_run(args: argparse.Namespace) -> int:
    runs = {r["run_id"]: r for r in C.read_jsonl(C.AB_HOME / "results" / args.runs_log)}
    row = runs.get(args.run)
    if row is None:
        raise C.Refused(f"{args.run} is not in results/runs.jsonl")
    known = load_known(row["task_id"])
    if not known:
        print(f"{args.run}: no known items for {row['task_id']}; nothing to match")
        return 0
    report_path = C.AB_HOME / "runs" / args.run / "report.md"
    report = report_path.read_text(errors="replace") if report_path.exists() else ""
    found, err = match_text(known, report, args.model) if report else (None, "no report.md")
    out = {"run_id": args.run, "task_id": row["task_id"], "variant": row["variant"], "rep": row["rep"],
           "model": args.model, "ts": C.utc_now(), "error": err,
           "found": found, "known_recall": None if found is None else recall(found),
           "required_found": None if found is None else {k["id"]: found[k["id"]] for k in known
                                                         if k.get("required")}}
    C.append_jsonl(C.AB_HOME / "results" / "matches.jsonl", out)
    print(f"{args.run}: known_recall={out['known_recall']} error={err}")
    return 0


def cmd_selftest(args: argparse.Namespace) -> int:
    known = [{"id": "K1", "required": True, "where": "src/projection.ts projectFields",
              "mechanism": "reads inherited properties through `k in source`"},
             {"id": "K2", "required": False, "where": "src/amount.ts parseAmount",
              "mechanism": "unbounded digit run before BigInt scaling"}]
    report = "Finding: src/projection.ts projectFields reads inherited properties through `k in source`.\n"
    found, err = match_text(known, report, args.model)
    if found is None:
        print(f"selftest FAIL: {err}")
        return 1
    expect = {"K1": True, "K2": False}
    ok = found == expect
    print(f"selftest {'OK' if ok else 'MISMATCH'}: model={args.model} found={found} expected={expect} "
          "(nothing written to results/)")
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--run", required=True)
    r.add_argument("--runs-log", default="runs.jsonl")
    r.add_argument("--model", default="sonnet")
    st = sub.add_parser("selftest")
    st.add_argument("--model", default="sonnet")
    return p


def main(argv: List[str]) -> int:
    args = build_parser().parse_args(argv)
    return {"run": cmd_run, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except C.Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(2)
