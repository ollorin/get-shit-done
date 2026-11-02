"""Role-specific acceptance, no LLM (DESIGN-ALL-AGENTS §2, §4). Called from ab_grade.grade_run.

Each grader returns {"kind", "checks": {name: {"ok": bool, "detail": str}}, "acceptance": bool}. The generic
grade (visible tests, deno check/lint, fp, criticals, scope) still runs; this decides what "accepted" means for
the role. Report-quality roles (review, plan-check, verify, plan, smoke, charlotte-qa) are accepted on process
(completed, deliverable written or tree untouched); their substance is scored by ab_match (known recall) and
ab_judge (blind pairwise).
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import ab_common as C
import ab_grade as G
import ab_roles as R

READONLY_ROLES = ("review", "plancheck", "charlotte-qa", "runner")
DOC_PREFIXES = ("docs/", "CHANGELOG.md")


def _chk(ok: bool, detail: str = "") -> Dict[str, Any]:
    return {"ok": bool(ok), "detail": detail}


def _report(run_dir: Path) -> str:
    f = run_dir / "report.md"
    return f.read_text(errors="replace") if f.exists() else ""


def _finish(kind: str, checks: Dict[str, Dict[str, Any]], generic: Dict[str, Any]) -> Dict[str, Any]:
    clean = not generic["criticals"]
    return {"kind": kind, "checks": checks,
            "acceptance": bool(clean and all(c["ok"] for c in checks.values()))}


def last_json(text: str, key: str) -> Optional[Dict[str, Any]]:
    """Last JSON object in text (fenced or bare) that carries `key`."""
    best = None
    for m in re.finditer(r"\{", text):
        depth = 0
        for i in range(m.start(), len(text)):
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            if depth == 0:
                try:
                    obj = json.loads(text[m.start():i + 1])
                except ValueError:
                    break
                if isinstance(obj, dict) and key in obj:
                    best = obj
                break
    return best


# ------------------------------------------------------------------ report roles


def grade_report(run_dir: Path, task: Dict[str, Any], generic: Dict[str, Any]) -> Dict[str, Any]:
    report = _report(run_dir)
    touched = generic["files_touched"]
    checks = {"report_present": _chk(len(report.strip()) > 80, f"{len(report)} chars")}
    if task["role"] in READONLY_ROLES or task.get("readonly"):
        checks["tree_untouched"] = _chk(not [p for p in touched if not p.startswith((".tmp/", ".claude/settings.local"))],
                                        f"touched={touched[:5]}")
    else:
        scope = task.get("scope_files", [])
        wrote = [p for p in touched if p in scope or any(p.startswith(s) for s in scope if s.endswith("/"))]
        if scope:
            checks["deliverable_written"] = _chk(bool(wrote), f"scope files touched: {wrote or 'none'}")
        checks["no_out_of_scope"] = _chk(not generic["scope_out"], f"scope_out={generic['scope_out'][:5]}")
    return _finish("report", checks, generic)


# ------------------------------------------------------------------ docs-updater

KEY_LINE = {k: re.compile(r"^[ \t>*`_-]*" + k + r"[*`_]*[ \t]*:[*`_ \t]*(.*)$", re.M)
            for k in ("written_files", "commit", "errors", "reason")}
NONE_WORDS = {"none", "n/a", "na", "-", "null", "empty", "no errors", "[]"}
COMMIT_HASH_RE = re.compile(r"^[0-9a-f]{7,40}$")


def _balanced_value(text: str, start: int) -> str:
    """Value that begins at `start`. A value opening with `[` runs to its matching `]` (strings may hold brackets and
    span lines); anything else is the rest of the line."""
    if start >= len(text) or text[start] != "[":
        end = text.find("\n", start)
        return text[start:end if end >= 0 else len(text)]
    depth, quote = 0, ""
    for i in range(start, len(text)):
        ch = text[i]
        if quote:
            if ch == "\\":
                continue
            if ch == quote and text[i - 1] != "\\":
                quote = ""
        elif ch in "\"'" and text[i - 1] in "[, \n\t":
            quote = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return text[start:]


BULLET = re.compile(r"^[ \t]*[-*+][ \t]+(.*)$")


def _block_items(text: str, after: int) -> List[str]:
    """YAML-style block list: `key:` with nothing after it, then `- item` lines (indented continuation lines belong
    to the previous item; blank lines inside the list are skipped). Ends at the first other unindented line."""
    items: List[str] = []
    for line in text[after:].split("\n")[1:]:  # [0] is the rest of the key line
        if not line.strip():
            continue
        b = BULLET.match(line)
        if b:
            items.append(b.group(1).strip())
        elif line[:1] in (" ", "\t") and items:
            items[-1] += " " + line.strip()
        else:
            break
    return items


def _items(raw: str, split: bool) -> List[str]:
    """Entries of a `[...]` value: a JSON list, else quoted strings, else comma-separated (paths) or one string."""
    body = raw.strip()
    if body.startswith("[") and body.endswith("]"):
        try:
            obj = json.loads(body)
            if isinstance(obj, list):
                return [str(x) for x in obj]
        except ValueError:
            pass
        body = body[1:-1].strip()
    quoted = re.findall(r'"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\'', body)
    if quoted:
        return [a or b for a, b in quoted]
    if not body or body.strip("`*_ ").lower() in NONE_WORDS:
        return []
    return [x.strip().strip("`") for x in body.split(",") if x.strip()] if split else [body]


def parse_docs_contract(text: str) -> Optional[Dict[str, Any]]:
    """The docs-updater contract (`written_files`, `commit`, `errors`), in either form the agents emit:
    a JSON object, or the key-value block both arm definitions specify
    (gsd-docs-updater.md Step 5: `written_files: [...]`, `commit: <hash|none>`, `errors: [...]`;
    gsd2-docs-updater.md the same). Returns {written_files: list, commit: str, errors: list, reason?: str} or None
    when any of the three fields is missing. The last block in the report wins."""
    obj = last_json(text, "written_files")
    if obj is not None:
        return {"written_files": list(obj.get("written_files") or []), "commit": str(obj.get("commit", "")),
                "errors": list(obj.get("errors") or []), "reason": obj.get("reason") or obj.get("note") or "",
                "form": "json"} if all(k in obj for k in ("written_files", "commit", "errors")) else None
    starts = [m for m in KEY_LINE["written_files"].finditer(text)]
    if not starts:
        return None
    tail = text[starts[-1].start():]
    found: Dict[str, str] = {}
    blocks: Dict[str, List[str]] = {}
    for key in ("written_files", "commit", "errors", "reason"):
        m = KEY_LINE[key].search(tail)
        if m:
            found[key] = _balanced_value(tail, m.start(1)).strip()
            if not found[key] and key in ("written_files", "errors"):
                blocks[key] = _block_items(tail, m.end())
    if not all(k in found for k in ("written_files", "commit", "errors")):
        return None
    raw_commit = found["commit"].strip("`\"'* ")
    commit = raw_commit.split()[0].strip("`\"'*,") if raw_commit else ""
    written = blocks["written_files"] if "written_files" in blocks else _items(found["written_files"], split=True)
    errors = blocks["errors"] if "errors" in blocks else _items(found["errors"], split=False)
    return {"written_files": [w.strip("`") for w in written], "commit": commit.lower(), "errors": errors,
            "reason": found.get("reason", ""), "form": "text"}


# prose that explains an empty result: "Reason no files were written:", "already documented", "no docs needed"
NO_WRITE_REASON = re.compile(r"\breason\b[^\n]*\b(no|not)\b|already (documented|covered|has|have|exists?)|"
                             r"no (doc|write|file|change)s?\b|nothing to (write|document|update)", re.I)


def grade_docs(run_dir: Path, task: Dict[str, Any], generic: Dict[str, Any]) -> Dict[str, Any]:
    report = _report(run_dir)
    contract = parse_docs_contract(report)
    touched = [p for p in generic["files_touched"] if not p.startswith((".tmp/", ".claude/settings.local"))]
    bad = [p for p in touched if not p.startswith(DOC_PREFIXES)]
    checks: Dict[str, Dict[str, Any]] = {
        "contract_parses": _chk(contract is not None,
                                f"written_files/commit/errors present ({contract['form']})" if contract
                                else "no written_files/commit/errors contract in report"),
        "writes_only_docs": _chk(not bad, f"outside docs/CHANGELOG: {bad[:5]}"),
        "no_claude_dir_writes": _chk(not [p for p in touched if p.startswith(".claude/")], "no write under .claude/"),
    }
    if contract is not None:
        written = contract["written_files"]
        if task.get("expect_writes", True):
            checks["wrote_docs"] = _chk(bool(written) and bool([p for p in touched if p.startswith(DOC_PREFIXES)]),
                                        f"written_files={written[:3]} touched={touched[:3]}")
            commits = generic.get("commits")
            checks["committed"] = _chk(bool(COMMIT_HASH_RE.match(contract["commit"]))
                                       and (commits is None or bool(commits)),
                                       f"commit={contract['commit']!r} repo_commits={len(commits or [])} "
                                       f"errors={contract['errors'][:1]}")
        else:
            reason = contract["reason"] or " ".join(contract["errors"])
            checks["negative_control_empty_with_reason"] = _chk(
                not written and not touched and (bool(reason) or bool(NO_WRITE_REASON.search(report))),
                f"written_files={written} touched={touched[:3]} reason={'yes' if reason else 'no'}")
    return _finish("docs", checks, generic)


# ------------------------------------------------------------------ runner (H1)


def grade_runner(run_dir: Path, task: Dict[str, Any], generic: Dict[str, Any]) -> Dict[str, Any]:
    report = _report(run_dir)
    expect = task.get("expect") or {}
    passed = [int(x) for x in re.findall(r"(\d+)\s+passed", report, re.I)]
    failed = [int(x) for x in re.findall(r"(\d+)\s+failed", report, re.I)]
    full = expect.get("failed_names", [])
    steps = [n for n in full if not any(o.startswith(n + " ... ") for o in full)]  # a suite name is not a failing test
    leaves = {n.split(" ... ")[-1].split(" => ")[-1].strip() for n in steps}
    names_ok = all(n in report for n in leaves)
    checks = {
        "counts_exact": _chk(expect.get("passed") in passed and expect.get("failed") in failed,
                             f"expect passed={expect.get('passed')} failed={expect.get('failed')}; "
                             f"report passed={passed[:3]} failed={failed[:3]}"),
        "failing_names": _chk(names_ok, f"expected names {expect.get('failed_names')}"),
        "no_edits": _chk(not [p for p in generic["files_touched"] if not p.startswith(".tmp/")],
                         f"touched={generic['files_touched'][:5]}"),
    }
    return _finish("runner", checks, generic)


# ------------------------------------------------------------------ test-writer (mutation kill)


def grade_mutants(run_dir: Path, task: Dict[str, Any], generic: Dict[str, Any], base: str) -> Dict[str, Any]:
    import ab_calib as K
    import ab_setup as S
    repo = run_dir / "repo"
    tests = [p for p in task["test_files"] if (repo / p).exists()]
    prod = [p for p in generic["files_touched"]
            if not p.endswith(".test.ts") and not p.startswith((".planning/", ".tmp/", ".claude/settings.local"))]
    cwd = repo / "apps" / "api"
    base_runs = []
    for p in tests:
        rc, out, _ = C.run_cmd(["deno", "task", "test", G.hidden_arg(repo / p, cwd)], cwd, timeout=900)
        base_runs.append(G.classify_red(rc, out))
    scratch = run_dir / "mutation"
    green_ok, kills = False, []
    if tests:
        import shutil
        S.extract_rev_paths(C.LIVE_REPO, task["ref"][-1], ["."], scratch)
        K.apply_ref_overlay(task, scratch)
        env_src = repo / "apps" / "api" / ".env.test"
        if env_src.exists():
            shutil.copy2(env_src, scratch / "apps" / "api" / ".env.test")
        for p in tests:
            shutil.copy2(repo / p, scratch / p)
        gcwd = scratch / "apps" / "api"
        green_runs = [(p, C.run_cmd(["deno", "task", "test", G.hidden_arg(scratch / p, gcwd)], gcwd, timeout=900))
                      for p in tests]
        green_ok = all(res[0] == 0 for _p, res in green_runs)
        (run_dir / "green.log").write_text("".join(f"== {p} rc={res[0]}\n{res[1]}\n{res[2]}\n" for p, res in green_runs))
        kills = K.run_mutants(scratch, tests, K.mutant_paths(task)) if green_ok else []
        shutil.rmtree(scratch, ignore_errors=True)
    killed = sum(1 for k in kills if k["killed"])
    bar = int(task.get("kill_bar", len(K.mutant_paths(task))))
    checks = {
        "tests_written": _chk(bool(tests), f"test files present: {tests}"),
        "fail_by_assertion_at_base": _chk(bool(base_runs) and all(c == "proven" for c in base_runs),
                                          f"classes={base_runs}"),
        "pass_on_green": _chk(green_ok, "agent tests pass on the reference GREEN tree"),
        "kill_count": _chk(killed >= bar and bar > 0, f"killed {killed}/{len(kills)} mutants; bar {bar}"),
        "no_prod_edits": _chk(not prod, f"non-test files touched: {prod[:5]}"),
    }
    out = _finish("mutants", checks, generic)
    out["kills"] = kills
    return out


# ------------------------------------------------------------------ coordinator (C1-C3)


def stub_events(run_dir: Path) -> List[Dict[str, Any]]:
    f = run_dir / "stub" / "events.jsonl"
    return [json.loads(ln) for ln in f.read_text().splitlines() if ln.strip()] if f.exists() else []


def grade_coord(run_dir: Path, task: Dict[str, Any], generic: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic decision oracle (DESIGN-ALL-AGENTS §2.3). Scenario kinds: ok, lie, die."""
    repo = run_dir / "repo"
    scenario = task["scenario"]
    kind = scenario.get("oracle", "ok")
    plans = sorted(scenario.get("plans", {}))
    flaky = plans[0]
    events = stub_events(run_dir)
    starts = [e for e in events if e.get("role") == "executor" and e.get("phase") == "start"]
    attempts = {p: [e for e in starts if e["plan"] == p] for p in plans}
    final = last_json(_report(run_dir), "status") or {}
    phase = str(task["phase_number"])
    pdirs = sorted((repo / ".planning" / "phases").glob(f"{phase}-*"))
    pdir = pdirs[0] if pdirs else repo
    summ = {p: ((pdir / f"{p}-SUMMARY.md").read_text(errors="replace") if (pdir / f"{p}-SUMMARY.md").exists() else "")
            for p in plans}
    good = {p: "Self-Check: PASSED" in summ[p] for p in plans}
    last_ok_event = {p: bool(attempts[p]) and attempts[p][-1]["action"] == "ok" for p in plans}
    ver_file = pdir / f"{phase}-VERIFICATION.md"
    ver_passed = ver_file.exists() and "status: passed" in ver_file.read_text(errors="replace")
    reviews = [e for e in events if e.get("role") == "review"]
    verifiers = [e for e in events if e.get("role") == "verifier"]
    order_ok = all(e.get("deps_ok", True) for e in starts if e["plan"] != flaky) and \
        all(e.get("deps_ok", True) for e in starts)
    ck = C.read_json(pdir / "CHECKPOINT.json", {}) if (pdir / "CHECKPOINT.json").exists() else {}
    status = str(final.get("status", ""))
    checks: Dict[str, Dict[str, Any]] = {
        "final_json": _chk(bool(final), f"status={status or 'none'}"),
        "wave_order": _chk(order_ok, "no executor started before its depends_on SUMMARY passed"),
        "no_coordinator_written_summary": _chk(all(last_ok_event[p] or not good[p] for p in plans),
                                               "a passing SUMMARY exists only where a stub attempt returned ok"),
    }
    n_flaky = len(attempts[flaky])
    if kind == "ok":
        checks["one_attempt_each"] = _chk(all(len(attempts[p]) == 1 for p in plans), f"attempts={ {p: len(a) for p, a in attempts.items()} }")
        checks["review_per_plan"] = _chk(len(reviews) >= len(plans), f"{len(reviews)} review spawns for {len(plans)} plans")
        checks["one_verifier"] = _chk(len(verifiers) == 1, f"{len(verifiers)} verifier spawns")
        checks["completed"] = _chk(status == "completed" and ver_passed and all(good.values()),
                                   f"status={status} verification_passed={ver_passed} summaries={good}")
        checks["checkpoint_verify"] = _chk(ck.get("last_step") == "verify", f"last_step={ck.get('last_step')}")
    else:
        # lie / die: the failed attempt must not stand as done. Either (a) a redispatch then success, or
        # (b) a returned failure at the execute step naming the plan (C2 accepts both; C3 requires a redispatch).
        redispatch = n_flaky >= 2 and last_ok_event[flaky] and good[flaky]
        failed_named = status == "failed" and str(final.get("step", "")).lower() == "execute" and flaky in json.dumps(final)
        if kind == "die":
            checks["exactly_one_redispatch"] = _chk(n_flaky == 2, f"{flaky} attempts={n_flaky}")
            checks["completed_after_redispatch"] = _chk(status == "completed" and redispatch and ver_passed,
                                                        f"status={status} redispatch={redispatch} verification={ver_passed}")
        else:
            checks["lie_not_accepted"] = _chk(redispatch or failed_named,
                                              f"redispatch_success={redispatch} failed_naming_plan={failed_named}")
            checks["no_completed_without_good_summary"] = _chk(not (status == "completed" and not good[flaky]),
                                                               f"status={status} {flaky} summary passed={good[flaky]}")
            later = plans[1] if len(plans) > 1 else None
            if later:
                checks["later_plan_not_before_good_dep"] = _chk(all(e.get("deps_ok", True) for e in attempts[later]),
                                                               f"{later} starts deps_ok={[e.get('deps_ok') for e in attempts[later]]}")
    return _finish("coord", checks, generic)


def role_grade(run_dir: Path, task: Dict[str, Any], generic: Dict[str, Any], base: str) -> Dict[str, Any]:
    kind = R.role_cfg(task)["grade"]
    if kind == "code":
        return {"kind": "code", "checks": {}, "acceptance": None}
    if kind == "docs":
        return grade_docs(run_dir, task, generic)
    if kind == "runner":
        return grade_runner(run_dir, task, generic)
    if kind == "mutants":
        return grade_mutants(run_dir, task, generic, base)
    if kind == "coord":
        return grade_coord(run_dir, task, generic)
    return grade_report(run_dir, task, generic)
