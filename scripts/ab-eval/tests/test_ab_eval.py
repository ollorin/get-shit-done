"""Unit tests for the pure logic of the A/B eval runner. Run: python3 tests/test_ab_eval.py"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ab_aggregate as AG  # noqa: E402
import ab_common as C  # noqa: E402
import ab_grade as G  # noqa: E402
import ab_judge as J  # noqa: E402
import ab_match as M  # noqa: E402
import ab_roles as RO  # noqa: E402
import ab_run as R  # noqa: E402
import ab_setup as S  # noqa: E402
import ab_transcript as T  # noqa: E402


class RedactTests(unittest.TestCase):
    def test_redacts_paths_ids_trailers_and_instruction_names(self):
        text = ("cwd /Users/x/ab-eval/runs/RUN1/repo sess 1b2c3d4e-0000-4000-8000-aaaaaaaaaaaa\n"
                "Co-Authored-By: Claude <x>\nsee CLAUDE.md and .claude/rules/fp.md\n")
        out = J.redact(text, "RUN1", "/Users/x/ab-eval/runs/RUN1/repo", [])
        self.assertIn("<repo>", out)
        self.assertIn("<id>", out)
        self.assertIn("<redacted>", out)
        self.assertNotIn("CLAUDE.md", out)
        self.assertNotIn("RUN1", out)


class VerdictTests(unittest.TestCase):
    def _block(self, dims):
        verdict = {"dims": {k: {"pref": p, "weight": "minor", "why": "x"} for k, p in dims.items()},
                   "overall": {"pref": "X", "why": "y"}, "critical_issues": {"X": [], "Y": []}}
        return "prose\n```json\n" + json.dumps(verdict) + "\n```\n"

    def test_parses_last_fenced_block(self):
        keys = [k for k, _ in J.dims_for("executor")]
        text = self._block({k: "X" for k in keys})
        self.assertEqual(J.parse_verdict(text, "executor")["overall"]["pref"], "X")

    def test_rejects_missing_dimension(self):
        keys = [k for k, _ in J.dims_for("executor")][:-1]
        with self.assertRaises(ValueError):
            J.parse_verdict(self._block({k: "tie" for k in keys}), "executor")

    def test_rejects_bad_pref(self):
        keys = [k for k, _ in J.dims_for("executor")]
        dims = {k: "tie" for k in keys}
        dims[keys[0]] = "B"
        with self.assertRaises(ValueError):
            J.parse_verdict(self._block(dims), "executor")


class CollapseTests(unittest.TestCase):
    def _row(self, order, pref, winner):
        return {"order": order, "overall_pref": pref, "winner": winner, "error": None}

    def test_both_orders_prefer_b(self):
        res = J.collapse_pair([self._row("o1", "Y", "B"), self._row("o2", "X", "B")])
        self.assertEqual(res["verdict"], "B-win")
        self.assertFalse(res["position_inconsistent"])

    def test_disagreeing_orders_are_a_tie(self):
        res = J.collapse_pair([self._row("o1", "X", "A"), self._row("o2", "X", "B")])
        self.assertEqual(res["verdict"], "tie")
        self.assertTrue(res["position_inconsistent"])

    def test_error_order_is_not_scored(self):
        bad = dict(self._row("o2", None, None), error="claude rc=1")
        self.assertEqual(J.collapse_pair([self._row("o1", "X", "A"), bad])["verdict"], "error")


class BootstrapTests(unittest.TestCase):
    def test_all_a_wins_bound_is_one(self):
        per_task = {f"T{i}": [1, 1, 1] for i in range(4)}
        self.assertEqual(AG.bootstrap_upper90(per_task, resamples=500), 1.0)

    def test_ties_bound_is_zero(self):
        per_task = {f"T{i}": [0, 0] for i in range(3)}
        self.assertEqual(AG.bootstrap_upper90(per_task, resamples=500), 0.0)

    def test_deterministic_with_seed(self):
        per_task = {"A": [1, -1, 0], "B": [0, 0, 1], "C": [-1, -1, 0]}
        self.assertEqual(AG.bootstrap_upper90(per_task, 300, 3), AG.bootstrap_upper90(per_task, 300, 3))


class FrontmatterTests(unittest.TestCase):
    def test_model_is_optional_and_tools_split(self):
        text = "---\nname: gsd-x\ndescription: Does things\ntools: Read, Bash , Glob\n---\n\n<role>body</role>\n"
        entry = S.agent_entry(text, "gsd-x")
        self.assertNotIn("model", entry)
        self.assertEqual(entry["tools"], ["Read", "Bash", "Glob"])
        self.assertEqual(entry["prompt"], "<role>body</role>\n")

    def test_model_kept_when_present(self):
        text = "---\nname: gsd-e\ndescription: d\nmodel: haiku\n---\nbody"
        self.assertEqual(S.agent_entry(text, "gsd-e")["model"], "haiku")

    def test_description_required(self):
        with self.assertRaises(C.Refused):
            S.agent_entry("---\nname: x\n---\nbody", "x")


class ScrubMemoryTests(unittest.TestCase):
    def test_topic_with_term_removed_and_index_lines_filtered(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp, "src"), Path(tmp, "dst")
            src.mkdir()
            (src / "topic_a.md").write_text("notes about LOCKOUT-POLICY here")
            (src / "topic_b.md").write_text("unrelated")
            (src / "MEMORY.md").write_text("- [A](topic_a.md) lockout-policy\n- [B](topic_b.md) other\n")
            res = S.scrub_memory(src, dst, ["lockout-policy"])
            self.assertEqual(res["removed_files"], ["topic_a.md"])
            self.assertEqual(res["memory_md_lines_removed"], 1)
            self.assertFalse((dst / "topic_a.md").exists())
            self.assertTrue((dst / "topic_b.md").exists())
            self.assertEqual((dst / "MEMORY.md").read_text(), "- [B](topic_b.md) other\n")


class QuotaTests(unittest.TestCase):
    def test_seven_day_path(self):
        rate = {"rate_limit_info": {"unifiedWindows": {"seven_day": {"utilization": 0.33}}}}
        self.assertEqual(R.seven_day_util(rate), 0.33)
        self.assertIsNone(R.seven_day_util(None))

    def test_refuses_above_ceiling(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = R.QUOTA_FILE
            R.QUOTA_FILE = Path(tmp, "quota.json")
            try:
                C.write_json(R.QUOTA_FILE, {"seven_day_utilization": 0.9})
                with self.assertRaises(C.Refused):
                    R.check_quota()
                C.write_json(R.QUOTA_FILE, {"seven_day_utilization": 0.5})
                self.assertEqual(R.check_quota(), 0.5)
            finally:
                R.QUOTA_FILE = old


class BashCapArmTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = C.AB_HOME
        C.AB_HOME = Path(self.tmp.name)
        (C.AB_HOME / "harness").mkdir()
        C.write_json(C.AB_HOME / "harness" / "settings.json", {"hooks": {"PreToolUse": []}})

    def tearDown(self):
        C.AB_HOME = self.old
        self.tmp.cleanup()

    def test_settings_carry_cap_and_hook_but_not_compaction(self):
        cfg = C.read_json(R.settings_path(None, 8000), {})
        self.assertEqual(cfg["bashOutputMaxChars"], 8000)
        self.assertIn("hooks", cfg)
        self.assertNotIn("autoCompactEnabled", cfg)
        self.assertEqual(R.settings_path(None, 8000).name, "settings-bc8000.json")

    def test_no_arm_uses_plain_harness_settings(self):
        self.assertEqual(R.settings_path(None, None), C.AB_HOME / "harness" / "settings.json")

    def test_cap_outside_clamp_range_refused(self):
        for bad in (100, 3999, 128001):
            with self.assertRaises(C.Refused):
                R.settings_path(None, bad)

    def test_window_and_cap_are_separate_arms(self):
        with self.assertRaises(C.Refused):
            R.settings_path(130000, 8000)

    def test_cli_flag_parses_and_batch_ceilings(self):
        args = R.build_parser().parse_args(["run", "--task", "E4", "--variant", "A", "--bash-cap", "8000"])
        self.assertEqual(args.bash_cap, 8000)
        self.assertLess(R.BASHCAP_START_CEILING, 0.81)
        self.assertLess(R.BASHCAP_STOP_CEILING, 0.82)
        old = R.QUOTA_FILE
        R.QUOTA_FILE = Path(self.tmp.name, "quota.json")
        try:
            C.write_json(R.QUOTA_FILE, {"seven_day_utilization": 0.81})
            with self.assertRaises(C.Refused):
                R.check_quota(R.BASHCAP_START_CEILING)
            C.write_json(R.QUOTA_FILE, {"seven_day_utilization": 0.80})
            self.assertEqual(R.check_quota(R.BASHCAP_START_CEILING), 0.80)
        finally:
            R.QUOTA_FILE = old

    def test_metrics_selftest(self):
        import ab_bashcap
        self.assertEqual(ab_bashcap.selftest(), 0)


class TranscriptTests(unittest.TestCase):
    def _write(self, path: Path, lines):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(x) for x in lines) + "\n")

    def test_contamination_tier_and_first_turn(self):
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp, "t")
            main = [
                {"type": "assistant", "message": {"id": "m1", "model": "claude-haiku-5-5",
                                                  "usage": {"input_tokens": 5, "cache_read_input_tokens": 10},
                                                  "content": [
                                                      {"type": "tool_use", "id": "u1", "name": "Bash",
                                                       "input": {"command": "cat /Users/o/igaming-platform/x"}},
                                                      {"type": "tool_use", "id": "a1", "name": "Agent",
                                                       "input": {"subagent_type": "gsd-executor",
                                                                 "model": "haiku",
                                                                 "description": "Execute plan 20",
                                                                 "prompt": "p"}}]}},
                {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "u1",
                                                          "content": "ok"}]}},
            ]
            sub = [
                {"type": "assistant", "message": {"id": "s1", "model": "claude-haiku-5-5",
                                                  "usage": {"input_tokens": 100, "cache_creation_input_tokens": 50},
                                                  "content": [{"type": "tool_use", "id": "u2", "name": "Read",
                                                               "input": {"file_path": "/x/ab-eval/tasks/E6/y"}}]}},
                {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "u2",
                                                          "content": "HARNESS-DENY: no"}]}},
            ]
            self._write(tdir / "main.jsonl", main)
            self._write(tdir / "session" / "subagents" / "agent-1.jsonl", sub)
            (tdir / "session" / "subagents" / "agent-1.meta.json").write_text(
                json.dumps({"agentType": "gsd-executor"}))
            out = T.analyze(tdir, Path(tmp, "none.jsonl"))
            self.assertEqual(len(out["contaminated"]), 1)
            self.assertEqual(out["contaminated"][0]["tool"], "Bash")
            self.assertEqual(out["tier_violations"], [])
            self.assertEqual(out["first_turn_tok"], 150)
            self.assertTrue(out["first_turn_source"].startswith("subagent"))

    def test_executor_child_on_opus_is_a_violation(self):
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp, "t")
            self._write(tdir / "main.jsonl", [
                {"type": "assistant", "message": {"id": "m", "model": "claude-haiku-5-5", "usage": {"input_tokens": 1},
                                                  "content": [{"type": "tool_use", "id": "a", "name": "Agent",
                                                               "input": {"subagent_type": "gsd-executor",
                                                                         "model": "opus",
                                                                         "description": "x"}}]}}])
            out = T.analyze(tdir, Path(tmp, "none"))
            self.assertEqual(len(out["tier_violations"]), 1)


class StatusTests(unittest.TestCase):
    def test_void_on_fallback_model_but_not_on_synthetic(self):
        res = {"subtype": "success", "is_error": False}
        run = {"timed_out": False}
        self.assertEqual(R.status_of(res, run, False, ["claude-haiku-5-5", "<synthetic>"])[0], "done")
        self.assertEqual(R.status_of(res, run, False, ["claude-opus-5"])[0], "void")
        self.assertEqual(R.status_of(res, run, True, ["claude-haiku-5-5"])[0], "void")
        self.assertEqual(R.status_of(None, run, False, [])[0], "void")
        self.assertEqual(R.status_of(None, {"timed_out": True}, False, [])[0], "failed")


class GateTests(unittest.TestCase):
    def _row(self, task, variant, acc, crit=(), tier="T0", hidden=None):
        return {"run_id": f"{task}-{variant}-{acc}", "task_id": task, "variant": variant, "status": "done",
                "acceptance_pass": acc, "criticals": list(crit), "tier": tier, "hidden": hidden,
                "first_turn_tok": 1000, "instructions": []}

    def test_g2_flags_task_flip_and_needs_both_arms(self):
        rows = [self._row("E1", "A", True), self._row("E1", "A", True), self._row("E1", "A", True),
                self._row("E1", "B", False), self._row("E1", "B", False), self._row("E1", "B", False)]
        status, detail = AG.g2_acceptance(rows, "A", "B")
        self.assertEqual(status, AG.FAIL)
        self.assertIn("E1", detail)
        self.assertEqual(AG.g2_acceptance(rows[:3], "A", "B")[0], AG.NOT_EVALUATED)

    def test_g4_rejects_b_only_t0_critical(self):
        rows = [self._row("E6", "A", True), self._row("E6", "B", True, crit=["shared-stack-attempted"])]
        self.assertEqual(AG.g4_criticals(rows, "A", "B")[0], AG.FAIL)

    def test_g5_passes_on_clear_b_non_inferiority(self):
        pairs = [{"pair_id": f"p{i}", "task": f"T{i % 3}", "verdict": "tie"} for i in range(9)]
        status, _ = AG.g5_judged(pairs, [], "A", "B")
        self.assertEqual(status, AG.PASS)

    def test_g6_ratio(self):
        rows = [dict(self._row("E6", "A", True), first_turn_tok=1000),
                dict(self._row("E6", "B", True), first_turn_tok=700)]
        self.assertEqual(AG.g6_value(rows, "A", "B")[0], AG.PASS)


HOOK_SPEC = importlib.util.spec_from_file_location("harness_deny", ROOT / "hooks" / "harness-deny.py")
HD = importlib.util.module_from_spec(HOOK_SPEC)
HOOK_SPEC.loader.exec_module(HD)
RUN_DIR = "/x/ab-eval/runs/RUN1"
REPO = RUN_DIR + "/repo"


class HarnessDenyTests(unittest.TestCase):
    def _bash(self, command, cwd=REPO):
        return HD.decide("Bash", {"command": command}, cwd, RUN_DIR)

    def test_snapshot_relative_redirect_after_cd_is_allowed(self):
        cmd = "cd apps/api && deno test libs/domain/x.test.ts 2>&1 | tail -n 6 > ../../.tmp/399-20-green.log"
        self.assertIsNone(self._bash(cmd))

    def test_redirect_from_persisted_subdirectory_is_allowed(self):
        self.assertIsNone(self._bash("cat ../../.tmp/x.log", cwd=REPO + "/apps/api"))

    def test_traversal_that_leaves_snapshot_is_denied(self):
        self.assertEqual(self._bash("cd apps/api && cat ../../../other")[0], "root")
        self.assertEqual(self._bash("ls ../..")[0], "root")
        self.assertEqual(self._bash("cd ..")[0], "root")
        self.assertEqual(self._bash("cd apps/api; cat ../../../../x")[0], "root")
        self.assertEqual(self._bash("cd /tmp && ls")[0], "root")

    def test_cd_chain_resolves_each_step(self):
        self.assertIsNone(self._bash("cd apps && cd api && cat ../../.tmp/x"))
        self.assertEqual(self._bash("cd apps && cd api && cat ../../../x")[0], "root")

    def test_dotdot_inside_a_word_is_not_traversal(self):
        self.assertIsNone(self._bash("echo file..txt > out..log"))

    def test_roots_and_stack_still_denied(self):
        self.assertEqual(self._bash("cat /Users/o/igaming-platform/CLAUDE.md")[0], "root")
        self.assertEqual(self._bash("supabase status")[0], "stack")
        self.assertEqual(self._bash("git push origin x")[0], "net")

    def test_other_run_id_denied(self):
        self.assertEqual(self._bash("cat /x/ab-eval/runs/RUN2/repo/a")[0], "root")

    def test_read_traversal_resolves_against_cwd(self):
        self.assertIsNone(HD.decide("Read", {"file_path": "../../.tmp/x.log"}, REPO + "/apps/api", RUN_DIR))
        self.assertEqual(HD.decide("Read", {"file_path": "../../../x"}, REPO + "/apps/api", RUN_DIR)[0], "root")

    def test_writes_limited_to_run_directory(self):
        self.assertIsNone(HD.decide("Write", {"file_path": REPO + "/a.ts"}, REPO, RUN_DIR))
        self.assertEqual(HD.decide("Write", {"file_path": "/x/elsewhere.ts"}, REPO, RUN_DIR)[0], "write")


class BriefTests(unittest.TestCase):
    def test_placeholders_filled(self):
        task = {"id": "T", "role": "executor", "agent": "gsd-executor", "model": "haiku", "plan_number": "20",
                "task_range": "1", "phase_number": "399", "phase_name": "p", "plan": "a/b.md",
                "task_names": ["Task 1: x"], "scope_files": ["f.ts"]}
        text = RO.render_brief(task)
        self.assertIn("Execute plan 20 tasks 1", text)
        self.assertNotIn("{{", text)


class RedClassificationTests(unittest.TestCase):
    def test_assertion_failure_is_proven(self):
        out = "x_test ... FAILED (2ms)\n\nFAILURES\nAssertionError: expected 5\n\n0 passed | 1 failed"
        self.assertEqual(G.classify_red(1, out), "proven")

    def test_missing_module_is_module_missing_even_with_type_check_text(self):
        out = "TS2307 [ERROR]: Cannot find module 'file:///x/lockout-policy.ts'.\nerror: Type checking failed."
        self.assertEqual(G.classify_red(1, out), "module-missing")

    def test_other_compile_error_is_unknown_not_proven(self):
        out = "TS2322 [ERROR]: Type 'string' is not assignable.\nerror: Type checking failed."
        self.assertEqual(G.classify_red(1, out), "unknown")

    def test_green_at_red_is_recorded(self):
        self.assertEqual(G.classify_red(0, "1 passed"), "green-at-red")

    def test_combined_prefers_proven_then_module_missing(self):
        self.assertEqual(G._combine_red(["module-missing", "proven"]), "proven")
        self.assertEqual(G._combine_red(["green-at-red", "module-missing"]), "module-missing")
        self.assertEqual(G._combine_red(["green-at-red"]), "green-at-red")


class FpGateTests(unittest.TestCase):
    def test_missing_gate_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = G.fp_delta(Path(tmp), "HEAD", [("M", "apps/api/x.ts")], Path(tmp))
            self.assertEqual(res["increase"], 1)
            self.assertIn("missing", res["error"])

    def test_no_typescript_change_is_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(G.fp_delta(Path(tmp), "HEAD", [("M", "README.md")], Path(tmp))["increase"], 0)


class MatcherTests(unittest.TestCase):
    KNOWN = [{"id": "K1", "required": True, "where": "a.ts f", "mechanism": "m1"},
             {"id": "K2", "required": False, "where": "b.ts g", "mechanism": "m2"}]

    def _block(self, known):
        return "analysis\n```json\n" + json.dumps({"known": known}) + "\n```\n"

    def test_parses_found_flags(self):
        text = self._block({"K1": {"found": True, "quote": "q"}, "K2": {"found": False, "quote": ""}})
        self.assertEqual(M.parse_match(text, ["K1", "K2"]), {"K1": True, "K2": False})

    def test_rejects_missing_item_and_non_boolean(self):
        with self.assertRaises(ValueError):
            M.parse_match(self._block({"K1": {"found": True}}), ["K1", "K2"])
        with self.assertRaises(ValueError):
            M.parse_match(self._block({"K1": {"found": "yes"}, "K2": {"found": False}}), ["K1", "K2"])

    def test_recall_and_prompt_substitution(self):
        self.assertEqual(M.recall({"K1": True, "K2": False}), 0.5)
        self.assertEqual(M.recall({}), 0.0)
        prompt = M.build_prompt(self.KNOWN, "report with {{KNOWN}} inside")
        self.assertIn("- K1 (required: true): location a.ts f; mechanism: m1", prompt)
        self.assertIn("report with {{KNOWN}} inside", prompt)
        self.assertNotIn("{{REPORT}}", prompt)


class G3Tests(unittest.TestCase):
    def _row(self, run_id, variant, task="R1", fail_first="absent", hidden=None):
        return {"run_id": run_id, "task_id": task, "variant": variant, "status": "done", "acceptance_pass": True,
                "criticals": [], "tier": "T0", "hidden": hidden, "fail_first": fail_first, "first_turn_tok": 1,
                "instructions": []}

    def _match(self, run_id, variant, found, task="R1"):
        return {"run_id": run_id, "task_id": task, "variant": variant, "error": None, "found": found,
                "known_recall": sum(found.values()) / len(found), "required_found": {"K1": found["K1"]}}

    def test_fail_first_drop_fails_g3(self):
        rows = [self._row("a1", "A", fail_first="proven"), self._row("a2", "A", fail_first="proven"),
                self._row("a3", "A", fail_first="proven"), self._row("b1", "B"), self._row("b2", "B"),
                self._row("b3", "B")]
        status, detail = AG.g3_secondary(rows, "A", "B")
        self.assertEqual(status, AG.FAIL)
        self.assertIn("fail_first proven A=3 B=0", detail)

    def test_passes_with_matching_fail_first_and_no_known_items(self):
        rows = [self._row("a1", "A", fail_first="proven"), self._row("b1", "B", fail_first="proven")]
        status, detail = AG.g3_secondary(rows, "A", "B", [])
        self.assertEqual(status, AG.PASS)
        self.assertIn("known_recall: n/a", detail)

    def test_required_item_short_on_b_fails(self):
        rows = [self._row("a1", "A"), self._row("a2", "A"), self._row("a3", "A"),
                self._row("b1", "B"), self._row("b2", "B"), self._row("b3", "B")]
        matches = [self._match("a1", "A", {"K1": True}), self._match("a2", "A", {"K1": True}),
                   self._match("a3", "A", {"K1": True}), self._match("b1", "B", {"K1": False}),
                   self._match("b2", "B", {"K1": False}), self._match("b3", "B", {"K1": True})]
        status, detail = AG.g3_secondary(rows, "A", "B", matches)
        self.assertEqual(status, AG.FAIL)
        self.assertIn("R1/K1 A=3 B=1", detail)

    def test_latest_match_wins_and_errors_are_dropped(self):
        matches = [{"run_id": "a1", "error": None, "found": {"K1": False}, "known_recall": 0.0},
                   {"run_id": "a1", "error": None, "found": {"K1": True}, "known_recall": 1.0},
                   {"run_id": "a2", "error": "claude rc=1", "found": None, "known_recall": None}]
        self.assertEqual(AG.latest_matches(matches), {"a1": matches[1]})


class HiddenArgTests(unittest.TestCase):
    def test_apps_api_tests_keep_the_short_form(self):
        repo = Path("/r")
        self.assertEqual(G.hidden_arg(repo / "apps/api/libs/x.test.ts", repo / "apps/api"), "libs/x.test.ts")

    def test_scripts_tests_resolve_from_apps_api(self):
        repo = Path("/r")
        self.assertEqual(G.hidden_arg(repo / "scripts/validation/g.test.ts", repo / "apps/api"),
                         "../../scripts/validation/g.test.ts")


SYNTHETIC_ROLES = {"coordinator", "charlotte-qa", "runner"}  # no reference commit: the oracle is built, not inherited
SYNTHETIC_IDS = {"S-PJ", "S-PI", "S-CM"}  # frozen-HEAD smoke tasks, setup calibration only


class RegistryTests(unittest.TestCase):
    def test_registry_entries_are_well_formed(self):
        tasks = json.loads((ROOT / "examples" / "tasks.json").read_text())["tasks"]
        ids = [t["id"] for t in tasks]
        self.assertEqual(len(ids), len(set(ids)))
        for t in tasks:
            self.assertIsInstance(t.get("enabled"), bool, t["id"])
            if not t["enabled"]:
                self.assertTrue(t.get("reason") or t.get("blocked"), f"{t['id']} disabled without a reason")
            if t["enabled"]:
                self.assertIsInstance(t.get("base"), str, t["id"])
                if t["role"] not in SYNTHETIC_ROLES and t["id"] not in SYNTHETIC_IDS:
                    self.assertTrue(t.get("ref"), t["id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
