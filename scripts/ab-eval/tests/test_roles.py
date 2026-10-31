"""Unit tests for role support: briefs, calibration modes, role graders, stub child. Run: python3 -m unittest discover -s tests"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ab_calib as K  # noqa: E402
import ab_common as C  # noqa: E402
import ab_grade as G  # noqa: E402
import ab_role_grade as RG  # noqa: E402
import ab_roles as R  # noqa: E402

REGISTRY = json.loads((ROOT / "examples" / "tasks.json").read_text())["tasks"]
ENABLED = [t for t in REGISTRY if t["enabled"]]
STUB = ROOT / "harness" / "stub_child.py"


def generic(touched=(), criticals=(), scope_out=()):
    return {"files_touched": list(touched), "criticals": list(criticals), "scope_out": list(scope_out)}


class RegistryRoleTests(unittest.TestCase):
    def test_every_task_role_is_in_the_role_table(self):
        for t in REGISTRY:
            self.assertIn(t["role"], R.ROLES, t["id"])

    def test_every_enabled_brief_renders_for_both_arms(self):
        for t in ENABLED:
            for variant in ("A", "B"):
                text = R.render_brief(t, variant)
                self.assertNotIn("{{", text, t["id"])
                self.assertIn("<<<PROMPT", text)

    def test_disabled_tasks_state_their_reason(self):
        for t in REGISTRY:
            if not t["enabled"]:
                self.assertTrue(t.get("reason"), t["id"])

    def test_calibration_mode_is_known(self):
        for t in ENABLED:
            self.assertIn(R.calibration_cfg(t)["mode"], K.MODES, t["id"])

    def test_artifacts_named_by_tasks_exist(self):
        for t in ENABLED:
            for name in t.get("patches", []) + t.get("mutants", []):
                self.assertTrue((C.ARTIFACTS / name).is_file(), f"{t['id']}: {name}")
            for name in t.get("overlay", []):
                self.assertTrue((C.ARTIFACTS / name).is_dir(), f"{t['id']}: {name}")
            if t.get("defects_file"):
                self.assertTrue((C.ARTIFACTS / t["defects_file"]).is_file(), t["id"])
            if t.get("fixture"):
                self.assertTrue((C.FIXTURES / t["fixture"]).is_dir(), t["id"])

    def test_mutant_patches_are_single_hunk_unified_diffs(self):
        for t in ENABLED:
            for name in t.get("mutants", []):
                text = (C.ARTIFACTS / name).read_text()
                self.assertTrue(text.startswith("--- a/"), name)
                self.assertEqual(text.count("\n@@ "), 1, name)

    def test_mutation_tasks_have_a_kill_bar_within_the_mutant_count(self):
        for t in ENABLED:
            if t["role"] == "test-writer":
                self.assertTrue(1 <= t["kill_bar"] <= len(t["mutants"]), t["id"])

    def test_seeded_fixture_defect_ids_resolve(self):
        for t in ENABLED:
            if t["role"] == "charlotte-qa":
                ids = {d["id"] for d in json.loads((C.ARTIFACTS / t["defects_file"]).read_text())}
                self.assertTrue(set(t["defect_ids"]) <= ids, t["id"])


class VariantMappingTests(unittest.TestCase):
    def test_variant_roles_json_renames_the_agent(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(C, "AB_HOME", Path(tmp)):
            (Path(tmp) / "variants" / "B").mkdir(parents=True)
            (Path(tmp) / "variants" / "B" / "roles.json").write_text(json.dumps({"runner": "gsd2-runner"}))
            task = {"id": "H", "role": "runner", "agent": "general-purpose"}
            self.assertEqual(R.subagent_type(task, "B"), "gsd2-runner")
            self.assertEqual(R.subagent_type(task, "A"), "general-purpose")

    def test_unfilled_placeholder_refuses(self):
        task = {"id": "X", "role": "smoke", "agent": "a", "model": "haiku", "brief": "hi {{NOPE}}"}
        with self.assertRaises(C.Refused):
            R.render_brief(task, "A")

    def test_coordinator_agents_include_stubs_by_child_name(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(C, "AB_HOME", Path(tmp)):
            (Path(tmp) / "variants" / "A").mkdir(parents=True)
            (Path(tmp) / "variants" / "A" / "agents.json").write_text(json.dumps({"gsd-phase-coordinator": {"prompt": "p"}}))
            task = {"id": "C", "role": "coordinator", "agent": "gsd-phase-coordinator"}
            agents = R.build_agents(task, "A")
            for child in ("gsd-executor", "gsd-verifier", "general-purpose"):
                self.assertIn("stub_child.py", agents[child]["prompt"])
            self.assertEqual(agents["gsd-phase-coordinator"]["prompt"], "p")


class FailedNamesTests(unittest.TestCase):
    def test_failed_lines_are_collected_without_ansi(self):
        out = ("handleDeleteConfig => soft-deletes ... \x1b[0m\x1b[31mFAILED\x1b[0m (3ms)\n"
               "other => fine ... ok (1ms)\n")
        self.assertEqual(G.failed_names(out), ["handleDeleteConfig => soft-deletes"])


class RunnerGradeTests(unittest.TestCase):
    def _run(self, report, touched=()):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "report.md").write_text(report)
            task = {"expect": {"passed": 11, "failed": 1, "failed_names": ["soft-deletes"]}}
            return RG.grade_runner(Path(tmp), task, generic(touched))

    def test_exact_counts_and_name_pass(self):
        self.assertTrue(self._run("11 passed | 1 failed. Failing: soft-deletes an active configuration")["acceptance"])

    def test_wrong_count_fails(self):
        out = self._run("12 passed | 0 failed")
        self.assertFalse(out["checks"]["counts_exact"]["ok"])

    def test_edits_fail(self):
        self.assertFalse(self._run("11 passed | 1 failed soft-deletes", touched=["apps/api/x.ts"])["acceptance"])


class DocsGradeTests(unittest.TestCase):
    def _grade(self, report, touched, expect_writes=True):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "report.md").write_text(report)
            return RG.grade_docs(Path(tmp), {"expect_writes": expect_writes}, generic(touched))

    def test_contract_and_docs_write_accepted(self):
        rep = '```json\n{"written_files": ["docs/a.md"], "commit": "abc", "errors": []}\n```'
        self.assertTrue(self._grade(rep, ["docs/a.md"])["acceptance"])

    def test_bare_prose_has_no_contract(self):
        self.assertFalse(self._grade("I updated the docs.", ["docs/a.md"])["acceptance"])

    def test_write_outside_docs_rejected(self):
        rep = '{"written_files": ["x.ts"], "commit": "abc", "errors": []}'
        self.assertFalse(self._grade(rep, ["x.ts"])["checks"]["writes_only_docs"]["ok"])

    def test_negative_control_needs_empty_contract_with_reason(self):
        rep = '{"written_files": [], "commit": "", "errors": [], "reason": "no docs needed"}'
        self.assertTrue(self._grade(rep, [], expect_writes=False)["acceptance"])
        self.assertFalse(self._grade(rep, ["docs/a.md"], expect_writes=False)["acceptance"])


class StubChildTests(unittest.TestCase):
    def _env(self, run, scenario):
        (run / "stub").mkdir(parents=True)
        (run / "stub" / "scenario.json").write_text(json.dumps(scenario))
        return dict(os.environ, AB_RUN_DIR=str(run))

    def _repo(self, tmp):
        repo = Path(tmp, "repo")
        pdir = repo / ".planning" / "phases" / "398-x"
        pdir.mkdir(parents=True)
        (pdir / "398-02-PLAN.md").write_text("---\ndepends_on: [\"398-01\"]\n---\n")
        (pdir / "398-01-SUMMARY.md").write_text("## Self-Check: PASSED\n")
        for cmd in (["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i"]):
            subprocess.run(["git", *cmd], cwd=repo, check=True, capture_output=True)
        return repo

    def _call(self, repo, env, *args):
        return subprocess.run([sys.executable, str(STUB), *args], cwd=repo, env=env, capture_output=True, text=True).stdout

    def test_lie_then_ok_and_die(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._repo(tmp)
            env = self._env(Path(tmp, "run"), {"plans": {"398-02": ["lie", "die"]}, "default_duration_s": 0})
            lie = self._call(repo, env, "--role", "executor", "--plan", "398-02")
            self.assertIn("## PLAN COMPLETE", lie)
            summary = (repo / ".planning/phases/398-x/398-02-SUMMARY.md").read_text()
            self.assertIn("Self-Check: FAILED", summary)
            self.assertIn("API Error", self._call(repo, env, "--role", "executor", "--plan", "398-02"))
            ok = self._call(repo, env, "--role", "executor", "--plan", "398-02")
            self.assertIn("Self-Check: PASSED", (repo / ".planning/phases/398-x/398-02-SUMMARY.md").read_text())
            self.assertIn("## PLAN COMPLETE", ok)
            events = [json.loads(ln) for ln in Path(tmp, "run/stub/events.jsonl").read_text().splitlines()]
            starts = [e["action"] for e in events if e["phase"] == "start"]
            self.assertEqual(starts, ["lie", "die", "ok"])
            self.assertTrue(all(e["deps_ok"] for e in events if e["phase"] == "start"))

    def test_verifier_writes_passed_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._repo(tmp)
            env = self._env(Path(tmp, "run"), {})
            self.assertIn("Verification Passed", self._call(repo, env, "--role", "verifier", "--phase", "398"))
            self.assertIn("status: passed", (repo / ".planning/phases/398-x/398-VERIFICATION.md").read_text())


class CoordGradeTests(unittest.TestCase):
    def _setup(self, tmp, events, summaries, verified, final, kind="ok"):
        run = Path(tmp)
        (run / "stub").mkdir()
        (run / "stub" / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events))
        pdir = run / "repo" / ".planning" / "phases" / "398-x"
        pdir.mkdir(parents=True)
        for plan, ok in summaries.items():
            (pdir / f"{plan}-SUMMARY.md").write_text("Self-Check: " + ("PASSED" if ok else "FAILED"))
        if verified:
            (pdir / "398-VERIFICATION.md").write_text("status: passed")
        (pdir / "CHECKPOINT.json").write_text(json.dumps({"last_step": "verify"}))
        (run / "report.md").write_text("```json\n" + json.dumps(final) + "\n```")
        task = {"phase_number": "398", "scenario": {"oracle": kind, "plans": {"398-02": [], "398-03": []}}}
        return run, task

    @staticmethod
    def _start(plan, action="ok", deps_ok=True):
        return {"role": "executor", "plan": plan, "phase": "start", "action": action, "deps_ok": deps_ok}

    def test_ok_path_accepted(self):
        events = [self._start("398-02"), self._start("398-03"), {"role": "review"}, {"role": "review"},
                  {"role": "verifier", "phase": "398"}]
        with tempfile.TemporaryDirectory() as tmp:
            run, task = self._setup(tmp, events, {"398-02": True, "398-03": True}, True, {"status": "completed"})
            self.assertTrue(RG.grade_coord(run, task, generic())["acceptance"])

    def test_lie_accepted_as_done_is_rejected(self):
        events = [self._start("398-02", "lie"), self._start("398-03")]
        with tempfile.TemporaryDirectory() as tmp:
            run, task = self._setup(tmp, events, {"398-02": False, "398-03": True}, True, {"status": "completed"}, "lie")
            out = RG.grade_coord(run, task, generic())
            self.assertFalse(out["acceptance"])
            self.assertFalse(out["checks"]["lie_not_accepted"]["ok"])

    def test_die_needs_exactly_one_redispatch(self):
        events = [self._start("398-02", "die"), self._start("398-02"), self._start("398-03"), {"role": "verifier"}]
        with tempfile.TemporaryDirectory() as tmp:
            run, task = self._setup(tmp, events, {"398-02": True, "398-03": True}, True, {"status": "completed"}, "die")
            self.assertTrue(RG.grade_coord(run, task, generic())["acceptance"])

    def test_dependency_order_violation_rejected(self):
        events = [self._start("398-02"), self._start("398-03", deps_ok=False), {"role": "review"}, {"role": "review"},
                  {"role": "verifier"}]
        with tempfile.TemporaryDirectory() as tmp:
            run, task = self._setup(tmp, events, {"398-02": True, "398-03": True}, True, {"status": "completed"})
            self.assertFalse(RG.grade_coord(run, task, generic())["checks"]["wave_order"]["ok"])


class EvidenceTests(unittest.TestCase):
    def test_base_present_ref_absent_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            def git(*a): subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=repo, check=True, capture_output=True)
            git("init", "-q")
            (repo / "f.ts").write_text("if (k in metadata) {}\n"); git("add", "-A"); git("commit", "-qm", "base")
            base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
            (repo / "f.ts").write_text("if (Object.hasOwn(metadata, k)) {}\n"); git("commit", "-qam", "fix")
            ref = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
            task = {"id": "T", "role": "review", "base": base, "ref": [ref], "known": [{
                "id": "K1", "required": True,
                "evidence": [{"at": "base", "file": "f.ts", "regex": r"k in metadata"},
                             {"at": "ref", "file": "f.ts", "regex": r"k in metadata", "expect": False}]}]}
            with mock.patch.object(C, "LIVE_REPO", repo):
                checks = K.mode_evidence(task, Path(tmp), {}, 1)
            self.assertTrue(all(c["ok"] for c in checks), checks)

    def test_required_item_without_evidence_fails(self):
        task = {"id": "T", "role": "review", "base": "x", "ref": ["y"], "known": [{"id": "K1", "required": True}]}
        checks = K.mode_evidence(task, Path("/nonexistent"), {}, 1)
        self.assertFalse(checks[0]["ok"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
