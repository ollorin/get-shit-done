"""Role-appropriate calibration, no LLM (DESIGN §4.6, DESIGN-ALL-AGENTS §4).

A task is valid only if its oracle can tell a good outcome from a bad one before any agent runs. The mode is
`task["calibration"]["mode"]`, defaulting to the role's mode (ab_roles.ROLES):

  tests      base is red (visible and/or hidden, `base_red`), ref is green x3            executor, debugger
  leak       the test leaves orphan processes at base, none at ref                        debugger D2
  evidence   the known defect / doc gap is present at base and absent or fixed at ref     review, plancheck,
             (regex checks on `git show`/`git grep` of the live repo, read-only)           planner, verifier, docs
  planted    a planted failure gives the exact expected counts and names; the clean tree  runner
             passes
  mutants    tests fail at base, pass on GREEN, and kill every seeded mutant of GREEN      test-writer
  coord      the stub child follows the scenario (ok / lie / die) in the snapshot         coordinator
  fixture    every seeded defect is present in the fixture app and absent from the clean   charlotte-qa
             control app
  setup      the snapshot has the inputs, lacks the outputs, the brief renders, the agent  smoke roles
             def exists

calib.json records `mode`, `checks` and `ok`; runs refuse a task without `ok: true`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import ab_common as C
import ab_grade as G
import ab_roles as R


def check(name: str, ok: bool, detail: str = "", **extra: Any) -> Dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail, **extra}


def rev_of(t: Dict[str, Any], which: str) -> str:
    if which == "base":
        return t["base"]
    if which == "ref":
        return t["ref"][-1]
    return which


def file_at(rev: str, path: str) -> Optional[str]:
    proc = subprocess.run(["git", "-C", str(C.LIVE_REPO), "show", f"{rev}:{path}"], capture_output=True)
    return proc.stdout.decode(errors="replace") if proc.returncode == 0 else None


def grep_at(rev: str, pathspec: str, regex: str) -> List[str]:
    proc = subprocess.run(["git", "-C", str(C.LIVE_REPO), "grep", "-l", "-E", regex, rev, "--", pathspec],
                          capture_output=True, text=True)
    return [ln for ln in proc.stdout.splitlines() if ln.strip()]


def eval_evidence(t: Dict[str, Any], ev: Dict[str, Any]) -> Dict[str, Any]:
    """One regex check at a rev: `file` is a path (git show) or, with `search: true`, a pathspec (git grep)."""
    rev = rev_of(t, ev["at"])
    expect = ev.get("expect", True)
    if ev.get("search"):
        hits = grep_at(rev, ev["file"], ev["regex"])
        found, where = bool(hits), (hits[0] if hits else "no match")
    else:
        text = file_at(rev, ev["file"])
        if text is None:
            found, where = False, "file missing"
        else:
            m = re.search(ev["regex"], text, re.M)
            found = bool(m)
            where = f"line {text[:m.start()].count(chr(10)) + 1}" if m else "no match"
    ok = found == expect
    return check(f"{ev['at']}:{ev['file']}~{ev['regex'][:40]}", ok,
                 f"expect {'present' if expect else 'absent'} at {ev['at']} ({rev[:9]}): {where}")


def mode_evidence(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    checks: List[Dict[str, Any]] = []
    verified = 0
    for it in t.get("known", []):
        evs = it.get("evidence")
        if not evs:
            if it.get("required"):
                checks.append(check(f"known:{it['id']}", False, "required item has no evidence entry"))
            else:
                checks.append(check(f"known:{it['id']}", True, "unchecked (no evidence entry)", unchecked=True))
            continue
        results = [eval_evidence(t, e) for e in evs]
        ok = all(r["ok"] for r in results)
        verified += 1 if ok else 0
        checks.append(check(f"known:{it['id']}", ok, "; ".join(r["detail"] for r in results if not r["ok"])
                            or f"{len(results)} evidence checks hold", mode_detail=results))
    for i, ev in enumerate(t.get("evidence", [])):
        r = eval_evidence(t, ev)
        verified += 1 if r["ok"] else 0
        checks.append({**r, "name": f"evidence[{i}]:{r['name']}"})
    checks.append(check("at_least_one_verified", verified > 0, f"{verified} verified evidence groups"))
    return checks


# ------------------------------------------------------------------ tests / leak / planted


def prepare_copies(t: Dict[str, Any], tdir: Path) -> Tuple[Path, Path, Path]:
    pristine = tdir / "pristine-A"
    if not pristine.exists():
        raise C.Refused("build pristine-A first (variant --variant A)")
    calib = tdir / "calib"
    if calib.exists():
        shutil.rmtree(calib)
    calib.mkdir(parents=True)
    return pristine, calib, calib / "base"


def extract_ref(t: Dict[str, Any], pristine: Path, calib: Path, rev: Optional[str] = None) -> Path:
    import ab_setup as S
    ref_copy = calib / "ref"
    S.extract_rev_paths(C.LIVE_REPO, rev or t["ref"][-1], ["."], ref_copy)
    env_src = pristine / "apps" / "api" / ".env.test"
    if env_src.exists():
        shutil.copy2(env_src, ref_copy / "apps" / "api" / ".env.test")
    return ref_copy


def mode_tests(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    pristine, calib, base_copy = prepare_copies(t, tdir)
    C.clone_tree(pristine, base_copy)
    base_vis = G.run_visible(base_copy, t["verify"], retries=0)
    base_hid = G.run_hidden(base_copy, tdir / "oracle", t)
    ref_copy = extract_ref(t, pristine, calib)
    ref_vis, ref_hid = [], []
    for _ in range(repeat):
        ref_vis.append(G.run_visible(ref_copy, t["verify"], retries=0))
        ref_hid.append(G.run_hidden(ref_copy, tdir / "oracle", t))
    shutil.rmtree(calib)
    policy = cfg.get("base_red", "both")
    vis_red = None if not base_vis else all(not v["pass"] for v in base_vis)
    hid_red = None if base_hid.get("none") else (not base_hid["pass"])
    if policy == "visible":
        red = bool(vis_red)
    elif policy == "hidden":
        red = bool(hid_red)
    else:
        red = all(x for x in (vis_red, hid_red) if x is not None) and (vis_red is not None or hid_red is not None)
    ref_green = all(all(v["pass"] for v in batch) for batch in ref_vis) and all(h["pass"] for h in ref_hid)
    return [
        check("base_red", red, f"policy={policy} visible_red={vis_red} hidden_red={hid_red}",
              base_visible=[(v["cmd"], v["rc"]) for v in base_vis],
              base_hidden=[(f["dest"], f["rc"], f["counts"]) for f in base_hid.get("files", [])]),
        check("ref_green_x%d" % repeat, ref_green, "visible and hidden pass at the ref tree",
              ref_hidden=[[(f["dest"], f["rc"], f["counts"]) for f in h.get("files", [])] for h in ref_hid]),
    ]


def mode_leak(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    """The test run leaves orphan processes at base and none at ref (cfg: command, pattern)."""
    pristine, calib, base_copy = prepare_copies(t, tdir)
    C.clone_tree(pristine, base_copy)
    spec = {"cmd": cfg["cmd"], "pattern": cfg["pattern"]}
    base_run = G.leak_check(base_copy, spec)
    ref_copy = extract_ref(t, pristine, calib)
    ref_runs = [G.leak_check(ref_copy, spec) for _ in range(repeat)]
    shutil.rmtree(calib)
    return [
        check("base_leaks", base_run["rc"] == 0 and base_run["leaked"] > 0,
              f"rc={base_run['rc']} leaked={base_run['leaked']} orphans of '{cfg['pattern']}'"),
        check("ref_clean_x%d" % repeat, all(r["rc"] == 0 and r["leaked"] == 0 for r in ref_runs),
              f"rc/leaked per run: {[(r['rc'], r['leaked']) for r in ref_runs]}"),
    ]


def mode_planted(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    """Runner oracle: the planted tree fails with exactly t['expect']; the unplanted base tree passes."""
    pristine, calib, base_copy = prepare_copies(t, tdir)
    C.clone_tree(pristine, base_copy)
    expect = t.get("expect") or {}
    planted = []
    for _ in range(repeat):
        rc, out, _secs = C.run_cmd(t["run_cmd"], base_copy / "apps" / "api", timeout=900)
        planted.append({"rc": rc, "counts": G.parse_counts(out), "names": G.failed_names(out)})
    clean = extract_ref(t, pristine, calib, rev=t["base"])
    rc_c, out_c, _ = C.run_cmd(t["run_cmd"], clean / "apps" / "api", timeout=900)
    shutil.rmtree(calib)
    stable = all(p == planted[0] for p in planted)
    exact = bool(expect) and all(p["rc"] != 0 and p["counts"]["passed"] == expect["passed"]
                                 and p["counts"]["failed"] == expect["failed"]
                                 and p["names"] == expect["failed_names"] for p in planted)
    return [
        check("planted_stable", stable, f"{repeat} runs: {planted[0]}"),
        check("planted_matches_expect", exact, f"expect={expect} got={planted[0]}"),
        check("unplanted_passes", rc_c == 0, f"rc={rc_c} counts={G.parse_counts(out_c)}"),
    ]


# ------------------------------------------------------------------ mutants (test-writer)


def apply_mutant(tree: Path, patch: Path) -> Tuple[bool, str]:
    proc = subprocess.run(["git", "apply", "--whitespace=nowarn", str(patch)], cwd=str(tree), capture_output=True,
                          text=True)
    return proc.returncode == 0, proc.stderr.strip()[:200]


def revert_mutant(tree: Path, patch: Path) -> None:
    subprocess.run(["git", "apply", "-R", "--whitespace=nowarn", str(patch)], cwd=str(tree), capture_output=True)


def run_mutants(tree: Path, tests: List[str], mutants: List[Path]) -> List[Dict[str, Any]]:
    """Per mutant: apply, run each test file from apps/api, revert. killed = any test file fails."""
    cwd = tree / "apps" / "api"
    out = []
    for m in mutants:
        ok, err = apply_mutant(tree, m)
        if not ok:
            out.append({"mutant": m.name, "applied": False, "killed": False, "error": err})
            continue
        try:
            rcs = []
            for test in tests:
                rc, _o, _s = C.run_cmd(["deno", "task", "test", os.path.relpath(tree / test, cwd)], cwd, timeout=900)
                rcs.append(rc)
        finally:
            revert_mutant(tree, m)
        out.append({"mutant": m.name, "applied": True, "killed": any(rc != 0 for rc in rcs), "rcs": rcs})
    return out


def mutant_paths(t: Dict[str, Any]) -> List[Path]:
    return [C.ARTIFACTS / name for name in t.get("mutants", [])]


def mode_mutants(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    import ab_setup as S
    pristine, calib, base_copy = prepare_copies(t, tdir)
    tests = t["test_files"]
    # (a) the reference tests fail at base (module/behaviour missing) ...
    C.clone_tree(pristine, base_copy)
    ref_tree = extract_ref(t, pristine, calib)
    for test in tests:
        dest = base_copy / test
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ref_tree / test, dest)
    cwd = base_copy / "apps" / "api"
    base_rcs = [C.run_cmd(["deno", "task", "test", os.path.relpath(base_copy / x, cwd)], cwd, timeout=900)[0]
                for x in tests]
    # (b) ... and pass on the GREEN tree, 3 times
    green = [[C.run_cmd(["deno", "task", "test", os.path.relpath(ref_tree / x, ref_tree / "apps" / "api")],
                        ref_tree / "apps" / "api", timeout=900)[0] for x in tests] for _ in range(repeat)]
    # (c) the reference tests kill every seeded mutant of GREEN
    muts = run_mutants(ref_tree, tests, mutant_paths(t))
    shutil.rmtree(calib)
    return [
        check("ref_tests_fail_at_base", all(rc != 0 for rc in base_rcs), f"base rcs={base_rcs}"),
        check("ref_tests_pass_on_green_x%d" % repeat, all(rc == 0 for batch in green for rc in batch),
              f"green rcs={green}"),
        check("mutants_apply", bool(muts) and all(m["applied"] for m in muts),
              f"{sum(m['applied'] for m in muts)}/{len(muts)} apply"),
        check("ref_kills_all_mutants", bool(muts) and all(m["killed"] for m in muts),
              f"killed {sum(m['killed'] for m in muts)}/{len(muts)}", mutants=muts),
    ]


# ------------------------------------------------------------------ coordinator, fixture, setup


def mode_coord(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    """Run the real stub_child.py against a clone of the snapshot with the task's scenario."""
    pristine, calib, work = prepare_copies(t, tdir)
    C.clone_tree(pristine, work)
    scenario = t["scenario"]
    run_dir = calib / "run"
    (run_dir / "stub").mkdir(parents=True)
    C.write_json(run_dir / "stub" / "scenario.json", {**scenario, "default_duration_s": 0,
                                                     "duration_s": {k: 0 for k in scenario.get("plans", {})}})
    env = dict(os.environ, AB_RUN_DIR=str(run_dir))
    stub = C.HARNESS_SRC / "stub_child.py"

    def call(*args: str) -> str:
        return subprocess.run(["python3", str(stub), *args], cwd=str(work), env=env, capture_output=True,
                              text=True).stdout

    checks: List[Dict[str, Any]] = []
    phase = t["phase_number"]
    pdir = next(iter((work / ".planning" / "phases").glob(f"{phase}-*")), None)
    checks.append(check("phase_dir_present", pdir is not None, f"{phase}-* under .planning/phases"))
    plans = sorted(scenario.get("plans", {}))
    checks.append(check("plans_present", bool(pdir) and all((pdir / f"{p}-PLAN.md").exists() for p in plans),
                        f"plans {plans}"))
    checks.append(check("prior_summary_present", bool(pdir) and (pdir / f"{phase}-01-SUMMARY.md").exists(),
                        f"{phase}-01-SUMMARY.md"))
    checks.append(check("checkpoint_present", bool(pdir) and (pdir / "CHECKPOINT.json").exists(), "CHECKPOINT.json"))
    outputs = {}
    for plan in plans:
        for _attempt in range(len(scenario["plans"][plan]) + 1):
            outputs.setdefault(plan, []).append(call("--role", "executor", "--plan", plan))
    events = [json.loads(ln) for ln in (run_dir / "stub" / "events.jsonl").read_text().splitlines()
              if ln.strip()] if (run_dir / "stub" / "events.jsonl").exists() else []
    for plan in plans:
        expected = scenario["plans"][plan] + ["ok"]
        got = [e["action"] for e in events if e.get("plan") == plan and e.get("phase") == "start"]
        checks.append(check(f"scenario_followed:{plan}", got == expected, f"expected {expected} got {got}"))
    first_plan = plans[0]
    summ = (pdir / f"{first_plan}-SUMMARY.md") if pdir else None
    checks.append(check("final_summary_passed", bool(summ) and summ.exists()
                        and "Self-Check: PASSED" in summ.read_text(), f"{first_plan}-SUMMARY.md after last attempt"))
    first_actions = scenario["plans"][first_plan]
    if first_actions and first_actions[0] == "die":
        checks.append(check("die_prints_api_error", "API Error" in outputs[first_plan][0], outputs[first_plan][0][:80]))
    if first_actions and first_actions[0] == "lie":
        checks.append(check("lie_claims_complete", "## PLAN COMPLETE" in outputs[first_plan][0],
                            outputs[first_plan][0][:60]))
    if len(plans) > 1:
        later = [e for e in events if e.get("plan") == plans[1] and e.get("phase") == "start"]
        checks.append(check("later_plan_deps_ok", bool(later) and later[0]["deps_ok"],
                            f"{plans[1]} start deps_ok={later[0]['deps_ok'] if later else None}"))
    ver = call("--role", "verifier", "--phase", phase)
    checks.append(check("verifier_stub_writes_passed", "Verification Passed" in ver and bool(pdir)
                        and "status: passed" in (pdir / f"{phase}-VERIFICATION.md").read_text(), ver[:60]))
    shutil.rmtree(calib)
    return checks


def mode_fixture(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    """Seeded defects (examples/artifacts/<ID>/defects.json) exist in the fixture app and not in the clean one."""
    defects = C.read_json(C.ARTIFACTS / t["defects_file"], [])
    wanted = set(t.get("defect_ids", [d["id"] for d in defects]))
    seeded = C.FIXTURES / t["fixture"]
    clean = C.FIXTURES / "qa-app"
    checks = [check("fixture_pages", len(list(seeded.glob("*.html"))) >= 3, f"{len(list(seeded.glob('*.html')))} pages")]
    for d in defects:
        if d["id"] not in wanted:
            continue
        f = seeded / d["file"]
        text = f.read_text() if f.exists() else ""
        in_seeded = bool(re.search(d["regex"], text, re.S))
        cf = clean / d["file"]
        in_clean = bool(cf.exists() and re.search(d["regex"], cf.read_text(), re.S))
        checks.append(check(f"defect:{d['id']}", in_seeded and not in_clean,
                            f"{d['kind']} {d['summary']} seeded={in_seeded} in_clean_control={in_clean}"))
    snap = tdir / "pristine-A" / "qa-fixture" / "qa-app"
    if snap.exists():
        same = all((snap / p.name).exists() and (snap / p.name).read_bytes() == p.read_bytes()
                   for p in seeded.glob("*.html"))
        checks.append(check("snapshot_has_seeded_fixture", same, "qa-fixture/qa-app equals the seeded fixture"))
    return checks


def mode_setup(t: Dict[str, Any], tdir: Path, cfg: Dict[str, Any], repeat: int) -> List[Dict[str, Any]]:
    snap = tdir / "pristine-A"
    if not snap.exists():
        raise C.Refused("build pristine-A first (variant --variant A)")
    checks = []
    for rel in cfg.get("inputs", []):
        checks.append(check(f"input:{rel}", (snap / rel).exists(), "present in snapshot"))
    for rel in cfg.get("absent", []):
        checks.append(check(f"absent:{rel}", not (snap / rel).exists(), "output absent from snapshot (agent must write it)"))
    for rel in cfg.get("ref_outputs", []):
        rev = rev_of(t, "ref")
        checks.append(check(f"ref_output:{rel}", file_at(rev, rel) is not None, f"exists at ref {rev[:9]}"))
    need = R.subagent_type(t, "A")
    agents = C.read_json(C.variant_dir("A") / "agents.json", {})
    checks.append(check("agent_def", need == "general-purpose" or need in agents, f"{need} in variants/A/agents.json"))
    try:
        R.render_brief(t, "A")
        checks.append(check("brief_renders", True, "no unfilled placeholders"))
    except C.Refused as exc:
        checks.append(check("brief_renders", False, str(exc)))
    return checks


MODES: Dict[str, Callable[..., List[Dict[str, Any]]]] = {
    "tests": mode_tests, "leak": mode_leak, "evidence": mode_evidence, "planted": mode_planted,
    "mutants": mode_mutants, "coord": mode_coord, "fixture": mode_fixture, "setup": mode_setup,
}


def calibrate(t: Dict[str, Any], tdir: Path, repeat: int = 3) -> Dict[str, Any]:
    cfg = R.calibration_cfg(t)
    mode = cfg["mode"]
    if mode not in MODES:
        raise C.Refused(f"{t['id']}: unknown calibration mode {mode!r}")
    # evidence/fixture-only modes need no snapshot, but the brief must render for every mode
    R.render_brief(t, "A")
    checks = MODES[mode](t, tdir, cfg, repeat)
    if mode in ("evidence", "tests") and cfg.get("also_setup") and (tdir / "pristine-A").exists():
        checks += mode_setup(t, tdir, cfg, repeat)
    return {"ts": C.utc_now(), "mode": mode, "repeat": repeat, "checks": checks,
            "ok": bool(checks) and all(c["ok"] for c in checks)}
