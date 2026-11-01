"""Unit tests for the wave-1 harness fixes: variant provenance and staleness, the B/Q role split, the docs-updater
contract parser (on the two real DU1 reports), the snapshot pre-commit link relaxation, per-role aggregation and the
docs-updater judge packet. Run: python3 -m unittest discover -s tests"""
from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ab_aggregate as AG  # noqa: E402
import ab_common as C  # noqa: E402
import ab_judge as J  # noqa: E402
import ab_role_grade as RG  # noqa: E402
import ab_roles as R  # noqa: E402
import ab_setup as S  # noqa: E402

DATA = ROOT / "tests" / "data"


def run(*argv, cwd=None):
    subprocess.run(argv, cwd=cwd, check=True, capture_output=True)


class DocsContractTests(unittest.TestCase):
    """The two real DU1 reports (arm A gsd-docs-updater, arm B gsd2-docs-updater) emit key-value text, not JSON."""

    def test_arm_a_report_parses(self):
        c = RG.parse_docs_contract((DATA / "du1-arm-A-report.md").read_text())
        self.assertEqual(c["form"], "text")
        self.assertEqual(len(c["written_files"]), 1)
        self.assertTrue(c["written_files"][0].endswith("/repo/docs/authentication.md"))
        self.assertEqual(c["commit"], "none")
        self.assertEqual(len(c["errors"]), 1)  # one unquoted string holding commas, colons and parentheses
        self.assertIn("validate:links failed on 7 broken links", c["errors"][0])

    def test_arm_b_report_parses_multiline_quoted_errors(self):
        c = RG.parse_docs_contract((DATA / "du1-arm-B-report.md").read_text())
        self.assertEqual(c["commit"], "none")
        self.assertTrue(c["written_files"][0].endswith("/repo/docs/authentication.md"))
        self.assertEqual(len(c["errors"]), 2)
        self.assertIn("SUMMARY commit range", c["errors"][1])

    def test_real_reports_with_a_failed_commit_do_not_pass_the_commit_check(self):
        for name in ("du1-arm-A-report.md", "du1-arm-B-report.md"):
            with tempfile.TemporaryDirectory() as tmp:
                Path(tmp, "report.md").write_text((DATA / name).read_text())
                g = RG.grade_docs(Path(tmp), {"expect_writes": True},
                                  {"files_touched": ["docs/authentication.md"], "criticals": [], "scope_out": [],
                                   "commits": []})
                self.assertTrue(g["checks"]["contract_parses"]["ok"], name)
                self.assertTrue(g["checks"]["writes_only_docs"]["ok"], name)
                self.assertFalse(g["checks"]["committed"]["ok"], name)
                self.assertFalse(g["acceptance"], name)

    def test_real_report_shape_with_a_commit_is_accepted(self):
        text = (DATA / "du1-arm-A-report.md").read_text().replace("commit: none", "commit: 1a2b3c4")
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "report.md").write_text(text)
            g = RG.grade_docs(Path(tmp), {"expect_writes": True},
                              {"files_touched": ["docs/authentication.md"], "criticals": [], "scope_out": [],
                               "commits": ["deadbeef"]})
        self.assertTrue(g["acceptance"], g["checks"])

    def test_commit_claimed_but_no_repo_commit_fails(self):
        rep = "written_files: [/r/docs/a.md]\ncommit: 1a2b3c4\nerrors: []\n"
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "report.md").write_text(rep)
            g = RG.grade_docs(Path(tmp), {"expect_writes": True},
                              {"files_touched": ["docs/a.md"], "criticals": [], "scope_out": [], "commits": []})
        self.assertFalse(g["checks"]["committed"]["ok"])

    def test_block_list_form_from_the_rerun(self):
        c = RG.parse_docs_contract((DATA / "du2-arm-B-block-list-report.md").read_text())
        self.assertEqual(c["form"], "text")
        self.assertEqual(len(c["written_files"]), 3)
        self.assertTrue(c["written_files"][0].endswith("docs/wallet/currency-attributes.md"))
        self.assertEqual(c["commit"], "1cbfd8e")
        self.assertEqual(len(c["errors"]), 3)  # three bullets, each one error
        self.assertIn("Not written: `.claude/rules/database.md`", c["errors"][2])

    def test_arm_a_inline_list_with_commit(self):
        c = RG.parse_docs_contract((DATA / "du2-arm-A-report.md").read_text())
        self.assertTrue(c["commit"] and c["commit"] != "none")
        self.assertEqual([w.rsplit("/", 1)[-1] for w in c["written_files"]], ["currency-attributes.md", "pvp-arena.md"])
        self.assertEqual(c["errors"], [])  # `errors: none`

    def test_empty_block_list_is_an_empty_list(self):
        c = RG.parse_docs_contract("written_files:\n- /r/docs/a.md\n\ncommit: abc1234\n\nerrors:\n\n**Build scope:** x\n")
        self.assertEqual((c["written_files"], c["commit"], c["errors"]), (["/r/docs/a.md"], "abc1234", []))

    def test_other_shapes(self):
        p = RG.parse_docs_contract
        c = p("## Docs Update Result\n\n**written_files:** [/a/docs/x.md, /a/docs/y.md]\n**commit:** `abc1234`\n"
              "**errors:** []\n")
        self.assertEqual(c["written_files"], ["/a/docs/x.md", "/a/docs/y.md"])
        self.assertEqual((c["commit"], c["errors"]), ("abc1234", []))
        j = p('```json\n{"written_files": ["docs/a.md"], "commit": "abc1234", "errors": []}\n```')
        self.assertEqual((j["form"], j["written_files"]), ("json", ["docs/a.md"]))
        self.assertIsNone(p("written_files: [docs/a.md]\nerrors: []\n"))  # commit missing
        self.assertIsNone(p("I updated the docs."))
        self.assertEqual(p('written_files: []\ncommit: "none"\nerrors: ["No doc writes needed"]')["errors"],
                         ["No doc writes needed"])

    def test_negative_control_reason_in_errors_is_accepted(self):
        rep = 'written_files: []\ncommit: "none"\nerrors: ["No documentation-worthy scope: 400-41 only moves code"]\n'
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "report.md").write_text(rep)
            ok = RG.grade_docs(Path(tmp), {"expect_writes": False}, {"files_touched": [], "criticals": [],
                                                                     "scope_out": []})
            bad = RG.grade_docs(Path(tmp), {"expect_writes": False}, {"files_touched": ["docs/a.md"],
                                                                      "criticals": [], "scope_out": []})
        self.assertTrue(ok["acceptance"], ok["checks"])
        self.assertFalse(bad["acceptance"])


class DenyHookFalsePositiveTests(unittest.TestCase):
    """Wave-1 rerun: docs written through a heredoc and reads of the run's own tool-result files were denied."""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("hd", ROOT / "hooks" / "harness-deny.py")
        self.hd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.hd)
        self.run_dir, self.repo = "/x/ab-eval/runs/RUN1", "/x/ab-eval/runs/RUN1/repo"

    def bash(self, cmd):
        return self.hd.decide("Bash", {"command": cmd}, self.repo, self.run_dir)

    def test_heredoc_body_with_relative_links_is_data(self):
        cmd = "cat >> docs/a.md <<'EOF'\nsee [x](../../docs/b.md) and ../../../etc\nEOF\ngit status --short"
        self.assertIsNone(self.bash(cmd))

    def test_traversal_outside_the_heredoc_still_denied(self):
        self.assertEqual(self.bash("cat ../../../x <<'EOF'\nhi\nEOF")[0], "root")
        self.assertEqual(self.bash("cat <<'EOF'\nhi\nEOF\ncat ../../../x")[0], "root")

    def test_roots_inside_a_heredoc_are_still_denied(self):
        self.assertEqual(self.bash("python3 - <<'EOF'\nopen('/Users/o/igaming-platform/CLAUDE.md')\nEOF")[0], "root")

    def test_own_tool_results_are_readable_other_runs_and_projects_are_not(self):
        own = "/Users/o/" + self.hd.own_project(self.run_dir)
        self.assertIsNone(self.bash(f"tail -c 600 {own}/s/tool-results/b.txt"))
        self.assertIsNone(self.hd.decide("Read", {"file_path": f"{own}/s/tool-results/b.txt"}, self.repo, self.run_dir))
        self.assertEqual(self.bash("tail /Users/o/.claude/projects/-x-ab-eval-runs-RUN2-repo/s/b.txt")[0], "root")
        self.assertEqual(self.bash("ls /Users/o/.claude/projects/")[0], "root")
        self.assertEqual(self.bash(f"cat {own}/../-other/x")[0], "root")

    def test_transcript_scan_does_not_flag_the_runs_own_tool_results(self):
        import ab_transcript as T
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp, "runs", "RUN1")
            tdir = run / "transcripts"
            tdir.mkdir(parents=True)
            own = ".claude/projects/" + str((run / "repo").resolve()).replace("/", "-")
            rows = [{"type": "assistant", "message": {"id": "m1", "model": "claude-haiku-5-5", "usage": {"input_tokens": 1},
                                                      "content": [
                {"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": f"tail /Users/o/{own}/s/b.txt"}},
                {"type": "tool_use", "id": "u2", "name": "Bash",
                 "input": {"command": "tail /Users/o/.claude/projects/-other-repo/s/b.txt"}}]}}]
            (tdir / "main.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            out = T.analyze(tdir, Path(tmp, "none"))
        self.assertEqual(len(out["contaminated"]), 1)
        self.assertIn("-other-repo", out["contaminated"][0]["input"])


class PrecommitHookTests(unittest.TestCase):
    """The relaxed link step, run in sh against a fake `deno`."""

    def _run(self, deno_out: str, rc: int) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp, "deno")
            fake.write_text(f"#!/bin/sh\ncat <<'EOF'\n{deno_out}\nEOF\nexit {rc}\n")
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            script = Path(tmp, "step.sh")
            script.write_text("set -e\nCHANGED_DOCS_ABS=x\n" + S.LINK_SNIPPET + "\necho PASSED-STEP\n")
            env = dict(os.environ, PATH=f"{tmp}:{os.environ['PATH']}")
            return subprocess.run(["sh", str(script)], capture_output=True, text=True, env=env).returncode

    PLAN = ("../../docs/a.md:5:1 - Broken file link: ../../.planning/x/T.md not found (resolved to /r/.planning/x/T.md)")
    OTHER = "../../docs/a.md:9:2 - Broken file link: ./missing.md not found (resolved to /r/docs/missing.md)"

    def test_clean_run_passes(self):
        self.assertEqual(self._run("All links valid!", 0), 0)

    def test_only_planning_targets_are_tolerated(self):
        out = f"Validating\n❌ Broken links: 2, unprocessable files: 0\n\n{self.PLAN}\n{self.PLAN}"
        self.assertEqual(self._run(out, 1), 0)

    def test_any_other_broken_link_still_blocks(self):
        out = f"❌ Broken links: 2, unprocessable files: 0\n\n{self.PLAN}\n{self.OTHER}"
        self.assertEqual(self._run(out, 1), 1)

    def test_anchor_failure_blocks(self):
        anchor = "../../docs/a.md:3:1 - Broken anchor link: #nope not found in ../../docs/a.md"
        self.assertEqual(self._run(f"❌ Broken links: 1, unprocessable files: 0\n\n{anchor}", 1), 1)

    def test_unprocessable_file_and_crash_block(self):
        self.assertEqual(self._run(f"❌ Broken links: 1, unprocessable files: 1\n\n{self.PLAN}", 1), 1)
        self.assertEqual(self._run("error: boom", 1), 1)

    def test_snapshot_precommit_replaces_exactly_one_link_line(self):
        text = "a\n" + S.LINK_LINE + "\nb\n"
        out = S.snapshot_precommit(text)
        self.assertNotIn(S.LINK_LINE + "\n", out)
        self.assertIn("tolerated", out)
        with self.assertRaises(C.Refused):
            S.snapshot_precommit("no link step here")

    def test_live_hook_shape_is_supported(self):
        live = Path(C.LIVE_REPO) / "scripts" / "hooks" / "pre-commit"
        if live.exists():
            self.assertIn("LINK_RC", S.snapshot_precommit(live.read_text()))


class VariantProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.home, self.repo, self.agents_dir = t / "ab", t / "gsd", t / "installed"
        for d in (self.home, self.repo, self.agents_dir):
            d.mkdir()
        run("git", "init", "-q", cwd=self.repo)
        self.v2 = self.repo / "agents" / "v2"
        self.v2.mkdir(parents=True)
        self.defs = {
            "gsd2-runner": "---\nname: gsd2-runner\ndescription: runs tests\ntools: Bash, Read\nmodel: haiku\n---\nrun it\n",
            "gsd2-reviewer": "---\nname: gsd2-reviewer\ndescription: reviews\ntools: Read\n---\nreview it\n",
            "gsd2-docs-updater": "---\nname: gsd2-docs-updater\ndescription: docs\ntools: Read\n---\nbase docs\n",
        }
        for n, text in self.defs.items():
            (self.v2 / f"{n}.md").write_text(text)
        (self.v2 / "gsd2-docs-updater.c.md").write_text(self.defs["gsd2-docs-updater"].replace("base", "quality"))
        installed = "---\nname: gsd-docs-updater\ndescription: old\ntools: Read\n---\nold docs\n"
        (self.agents_dir / "gsd-docs-updater.md").write_text(installed)
        self.commit()
        self.patches = [mock.patch.object(C, "AB_HOME", self.home), mock.patch.object(C, "GSD_REPO", self.repo),
                        mock.patch.object(C, "V2_DRAFTS", self.v2), mock.patch.object(C, "CLAUDE_AGENTS", self.agents_dir)]
        for p in self.patches:
            p.start()
        a = self.home / "variants" / "A"
        a.mkdir(parents=True)
        C.write_json(a / "agents.json", {"gsd-docs-updater": S.agent_entry(installed, "gsd-docs-updater")})
        (a / "MANIFEST.md").write_text("# A\n")
        S.record_installed_sources("A")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def commit(self):
        run("git", "add", "-A", cwd=self.repo)
        run("git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x", cwd=self.repo)

    def args(self, variant="B", **kw):
        ns = dict(variant=variant, base_variant="A", drafts=str(self.v2), suffix="", include_q_only=False,
                  allow_dirty=False, refresh=False, force=False)
        ns.update(kw)
        import argparse
        return argparse.Namespace(**ns)

    def test_b_has_no_reviewer_and_review_stays_general_purpose(self):
        S.cmd_variant_from_drafts(self.args())
        roles = C.read_json(C.variant_dir("B") / "roles.json")
        agents = C.read_json(C.variant_dir("B") / "agents.json")
        self.assertNotIn("review", roles)
        self.assertNotIn("gsd2-reviewer", agents)
        self.assertEqual(roles["runner"], "gsd2-runner")
        task = {"id": "R1", "role": "review", "agent": "general-purpose"}
        self.assertEqual(R.subagent_type(task, "B"), "general-purpose")

    def test_q_arm_adds_the_reviewer_and_falls_back_to_base_drafts(self):
        S.cmd_variant_from_drafts(self.args("Q", suffix=".c", include_q_only=True))
        roles = C.read_json(C.variant_dir("Q") / "roles.json")
        agents = C.read_json(C.variant_dir("Q") / "agents.json")
        self.assertEqual(roles["review"], "gsd2-reviewer")
        self.assertIn("quality docs", agents["gsd2-docs-updater"]["prompt"])  # the .c draft
        self.assertEqual(agents["gsd2-runner"]["prompt"].strip(), "run it")  # no .c draft: base draft

    def test_sources_record_commit_and_hashes(self):
        S.cmd_variant_from_drafts(self.args())
        src = C.read_json(C.variant_dir("B") / C.SOURCES_FILE)
        head = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "HEAD"], capture_output=True,
                              text=True).stdout.strip()
        self.assertEqual(src["source_commit"], head)
        self.assertEqual(src["dirty_sources"], [])
        self.assertEqual(src["agents"]["gsd2-runner"]["sha256"], C.sha256_file(self.v2 / "gsd2-runner.md"))
        self.assertEqual(src["agents"]["gsd2-runner"]["kind"], "draft")
        self.assertEqual(src["agents"]["gsd-docs-updater"]["kind"], "installed")
        self.assertIn(head, (C.variant_dir("B") / "MANIFEST.md").read_text())

    def test_fresh_build_verifies_and_a_changed_draft_is_refused(self):
        S.cmd_variant_from_drafts(self.args())
        task = {"id": "H1", "role": "runner", "agent": "general-purpose"}
        self.assertIn("gsd2-runner", R.agent_provenance(task, "B"))
        (self.v2 / "gsd2-runner.md").write_text(self.defs["gsd2-runner"] + "more\n")
        with self.assertRaises(C.Refused) as cm:
            R.agent_provenance(task, "B")
        self.assertIn("stale", str(cm.exception))
        with self.assertRaises(C.Refused):
            R.build_agents(task, "B")
        self.commit()
        S.cmd_variant_from_drafts(self.args(refresh=True))  # rebuild picks the new bytes up
        self.assertIn("gsd2-runner", R.agent_provenance(task, "B"))

    def test_hand_edited_agents_json_is_refused(self):
        S.cmd_variant_from_drafts(self.args())
        path = C.variant_dir("B") / "agents.json"
        agents = C.read_json(path)
        agents["gsd2-runner"]["prompt"] = "tampered"
        C.write_json(path, agents)
        with self.assertRaises(C.Refused) as cm:
            C.verify_sources("B", ["gsd2-runner"])
        self.assertIn("entry differs", str(cm.exception))

    def test_unrelated_stale_agent_does_not_block_the_agent_in_use(self):
        S.cmd_variant_from_drafts(self.args())
        (self.v2 / "gsd2-docs-updater.md").write_text("changed")
        C.verify_sources("B", ["gsd2-runner"])
        with self.assertRaises(C.Refused):
            C.verify_sources("B")  # whole-variant check sees it

    def test_missing_sources_file_is_refused(self):
        S.cmd_variant_from_drafts(self.args())
        (C.variant_dir("B") / C.SOURCES_FILE).unlink()
        with self.assertRaises(C.Refused):
            C.verify_sources("B", ["gsd2-runner"])

    def test_dirty_drafts_are_refused_unless_allowed(self):
        (self.v2 / "gsd2-runner.md").write_text(self.defs["gsd2-runner"] + "uncommitted edit\n")
        with self.assertRaises(C.Refused):
            S.cmd_variant_from_drafts(self.args())
        S.cmd_variant_from_drafts(self.args(allow_dirty=True))
        src = C.read_json(C.variant_dir("B") / C.SOURCES_FILE)
        self.assertEqual(src["dirty_sources"], ["agents/v2/gsd2-runner.md"])

    def test_control_arm_drift_is_refused(self):
        (self.agents_dir / "gsd-docs-updater.md").write_text(
            "---\nname: gsd-docs-updater\ndescription: new\ntools: Read\n---\nchanged\n")
        with self.assertRaises(C.Refused):
            S.cmd_variant_from_drafts(self.args())


def row(rid, task, variant, role, acc=True, tok=1000, agent_src=None, crit=()):
    return {"run_id": rid, "task_id": task, "variant": variant, "role": role, "status": "done", "tier": "T2",
            "acceptance_pass": acc, "criticals": list(crit), "first_turn_tok": tok, "wall_s": 10,
            "result_cost_usd": 0.01, "compactions": 0, "hidden": None, "fail_first": "n/a",
            "instructions": [{"path": "/x/repo/CLAUDE.md", "chars": 100}], "agent_src": agent_src or {}}


class PerRoleAggregateTests(unittest.TestCase):
    def test_runner_policy_ignores_g1_g3_g5_and_ships_on_g2_g4_g6(self):
        rows = [row(f"a{i}", "H1", "A", "runner", tok=24000) for i in range(3)] + \
               [row(f"b{i}", "H1", "B", "runner", tok=4300) for i in range(3)]
        gates = AG.role_gates("runner", rows, [], [], [], "A", "B")
        self.assertEqual([g for g, (s, _) in gates.items() if s == "N/A"], ["G1", "G3", "G5"])
        self.assertEqual(AG.role_decision(gates), "SHIP B")

    def test_runner_needs_every_run_accepted_in_both_arms(self):
        rows = [row("a1", "H1", "A", "runner"), row("a2", "H1", "A", "runner"),
                row("b1", "H1", "B", "runner"), row("b2", "H1", "B", "runner", acc=False)]
        self.assertEqual(AG.role_decision(AG.role_gates("runner", rows, [], [], [], "A", "B")), "REJECT B")

    def test_runner_first_turn_over_8k_fails(self):
        rows = [row("a1", "H1", "A", "runner", tok=30000), row("b1", "H1", "B", "runner", tok=9000)]
        self.assertEqual(AG.role_gates("runner", rows, [], [], [], "A", "B")["G6"][0], "FAIL")

    def test_roles_do_not_leak_into_each_other(self):
        rows = [row("a1", "H1", "A", "runner"), row("b1", "H1", "B", "runner"),
                row("a2", "E6", "A", "executor", acc=False), row("a3", "DU1", "A", "docs-updater"),
                row("b3", "DU1", "B", "docs-updater", acc=False)]
        runner = [r for r in rows if r["role"] == "runner"]
        self.assertEqual(AG.role_decision(AG.role_gates("runner", runner, [], [], [], "A", "B")), "SHIP B")
        docs = [r for r in rows if r["role"] == "docs-updater"]
        self.assertEqual(AG.role_gates("docs-updater", docs, [], [], [], "A", "B")["G2"][0], "FAIL")

    def test_docs_updater_without_pairs_is_inconclusive_not_ship(self):
        rows = [row("a1", "DU1", "A", "docs-updater", tok=26000), row("b1", "DU1", "B", "docs-updater", tok=6000)]
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(C, "AB_HOME", Path(tmp)):
            for v in ("A", "B"):
                C.write_json(Path(tmp) / "variants" / v / "expected.json", {"inherited_chars": 100})
            gates = AG.role_gates("docs-updater", rows, [], [], [], "A", "B")
        self.assertEqual(gates["G5"][0], "NOT_EVALUATED")
        self.assertEqual(gates["G3"][0], "N/A")
        self.assertEqual(AG.role_decision(gates), "INCONCLUSIVE")

    def test_small_role_g5_fails_on_repeated_major_a_wins(self):
        def pair(pid, task, verdict):
            return {"pair_id": pid, "task": task, "role": "docs-updater", "verdict": verdict}

        def judg(pid, order, winner, weight):
            return {"pair_id": pid, "order": order, "dims": {"accuracy": {"winner": winner, "weight": weight}}}

        pairs = [pair("p1", "DU1", "A-win"), pair("p2", "DU1", "A-win"), pair("p3", "DU2", "tie")]
        js = [judg(p, o, "A", "major") for p in ("p1", "p2") for o in ("o1", "o2")] + \
             [judg("p3", o, "tie", "minor") for o in ("o1", "o2")]
        status, detail = AG.g5_small(pairs, js, "A", "B")
        self.assertEqual(status, "FAIL")
        self.assertIn("DU1", detail)
        pairs_ok = [pair("p1", "DU1", "A-win"), pair("p2", "DU1", "B-win"), pair("p3", "DU2", "tie")]
        js_ok = [judg("p1", o, "A", "major") for o in ("o1", "o2")] + [judg("p2", o, "B", "major") for o in ("o1", "o2")]
        self.assertEqual(AG.g5_small(pairs_ok, js_ok, "A", "B")[0], "PASS")

    def test_role_policy_switches_g5_for_three_or_fewer_tasks(self):
        self.assertEqual(AG.role_policy("docs-updater", 3)["g5"], "small")
        self.assertEqual(AG.role_policy("executor", 7)["g5"], "bootstrap")

    def test_superseded_and_stale_rows_are_excluded(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(C, "AB_HOME", Path(tmp)):
            C.write_json(Path(tmp) / "variants" / "B" / C.SOURCES_FILE,
                         {"agents": {"gsd2-runner": {"sha256": "new" * 20}}})
            old = row("old", "H1", "B", "runner", agent_src={"gsd2-runner": {"sha256": "old" * 20}})
            cur = row("cur", "H1", "B", "runner", agent_src={"gsd2-runner": {"sha256": "new" * 20}})
            sup = row("sup", "H1", "A", "runner")
            C.append_jsonl(Path(tmp) / "results" / "superseded.jsonl", {"run_id": "sup", "reason": "old harness"})
            kept, excluded = AG.split_rows([old, cur, sup])
            self.assertEqual([r["run_id"] for r in kept], ["cur"])
            self.assertEqual(list(excluded["superseded"]), ["sup"])
            self.assertEqual(list(excluded["stale"]), ["old"])


class DocsJudgeTests(unittest.TestCase):
    def test_docs_dimensions_exist_and_parse(self):
        keys = [k for k, _ in J.dims_for("docs-updater")]
        self.assertEqual(keys, ["accuracy", "coverage", "conventions", "scope", "honesty"])
        verdict = {"dims": {k: {"pref": "tie", "weight": "minor", "why": "x"} for k in keys},
                   "overall": {"pref": "X", "why": "y"}, "critical_issues": {"X": [], "Y": []}}
        text = "```json\n" + json.dumps(verdict) + "\n```"
        self.assertEqual(J.parse_verdict(text, "docs-updater")["overall"]["pref"], "X")

    def test_packet_builds_for_a_task_without_plan_or_task_names(self):
        task = {"id": "DU9", "role": "docs-updater", "agent": "gsd-docs-updater", "model": "haiku",
                "brief": "Update docs for plan 1.", "scope_files": [], "calibration": {"inputs": ["S.md"]}}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(C, "AB_HOME", Path(tmp)):
            home = Path(tmp)
            (home / "tasks" / "DU9" / "pristine-A").mkdir(parents=True)
            (home / "tasks" / "DU9" / "pristine-A" / "S.md").write_text("# summary")
            for rid in ("rx", "ry"):
                d = home / "runs" / rid
                (d / "grade").mkdir(parents=True)
                (d / "report.md").write_text("written_files: []")
                C.write_json(d / "grade" / "summary.json", {"role_checks": {"checks": {
                    "committed": {"ok": False, "detail": "commit='none'"}}}})
                (d / "grade" / "diff.patch").write_text("+x")
            pdir = home / "judge" / "p" / "o1"
            pdir.mkdir(parents=True)
            J.build_packet(pdir, "rx", "ry", "rx", "ry", task, [])
            sb = pdir / "sandbox"
            self.assertTrue((sb / "inputs" / "S.md").exists())
            self.assertIn("Update docs for plan 1.", (sb / "task.md").read_text())
            self.assertIn("committed: FAILED", (sb / "X" / "gates.md").read_text())
            self.assertIn("accuracy", (sb / "prompt.md").read_text())


if __name__ == "__main__":
    unittest.main()


class StackFalsePositive(unittest.TestCase):
    """Tool names are the stack only as commands: a path like supabase/migrations is not (DU2-A-r1 false critical)."""

    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location("hd_stack", str(Path(__file__).resolve().parents[1] / "hooks" / "harness-deny.py"))
        cls.hd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.hd)

    def stack(self, cmd):
        return self.hd.stack_hit(self.hd.strip_heredocs(cmd))

    def test_paths_and_doc_names_allowed(self):
        for c in ["ls supabase/migrations 2>/dev/null | grep -i 400_wallet", "ls docs/docker.md",
                  "cat apps/api/supabase/config.toml", "cat > a.md <<'EOF'\nrun `supabase db reset`\nEOF"]:
            self.assertFalse(self.stack(c), c)

    def test_identifier_in_code_and_read_only_listing_allowed(self):
        """Wave 2: `{ supabase }` in a sed replacement (E5-A-r1, E5-C-r1) and `ls scripts/preflight.sh` (E1-A-r2)."""
        for c in ["sed -i '' -e '299,398c\\\n      return await verifyEnabledTotp({ supabase }, id, code)' totp-provider.ts",
                  "grep -rn supabase apps/api/libs | head", "echo 'use docker later'",
                  "ls apps/api/deno.json 2>&1; ls scripts/preflight.sh 2>&1", "cat scripts/preflight.sh | head -20",
                  "git log --oneline -- scripts/run-integration-tests.sh", "sed -n 1,40p apps/api/x.integration.test.ts"]:
            self.assertFalse(self.stack(c), c)

    def test_commands_still_denied(self):
        for c in ["scripts/preflight.sh", "bash scripts/preflight.sh --all", "deno test foo.integration.test.ts",
                  "cd apps/api && npx supabase db reset", "scripts/run-integration-tests.sh", "FOO=1 supabase status",
                  "sudo docker ps", "bash -c 'supabase status'", "ls | xargs docker rm",
                  "supabase status", "npx supabase db reset", "cd x && docker ps", "psql -h localhost",
                  "ls; supabase start", "bash <<'EOF'\ndocker ps\nEOF"]:
            self.assertTrue(self.stack(c), c)


class NegativeControlReason(unittest.TestCase):
    """DU3-A-r1: nothing written, contract `[]`/`no-changes`/`[]`, the reason given in prose (not in errors)."""

    def test_prose_reason_accepted(self):
        import ab_role_grade as RG
        report = (ROOT / "tests" / "data" / "du3-arm-A-empty-with-prose-reason.md").read_text()
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "report.md").write_text(report)
            task = {"role": "docs-updater", "expect_writes": False}
            out = RG.grade_docs(Path(d), task, {"files_touched": [], "commits": [], "criticals": []})
        self.assertTrue(out["checks"]["negative_control_empty_with_reason"]["ok"], out["checks"])

    def test_empty_without_reason_rejected(self):
        import ab_role_grade as RG
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "report.md").write_text("written_files: []\ncommit: none\nerrors: []\n")
            out = RG.grade_docs(Path(d), {"role": "docs-updater", "expect_writes": False},
                                {"files_touched": [], "commits": [], "criticals": []})
        self.assertFalse(out["checks"]["negative_control_empty_with_reason"]["ok"])

    def test_writes_rejected(self):
        import ab_role_grade as RG
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "report.md").write_text("written_files: [/x/docs/a.md]\ncommit: abc1234\nerrors: []\nno docs needed\n")
            out = RG.grade_docs(Path(d), {"role": "docs-updater", "expect_writes": False},
                                {"files_touched": ["docs/a.md"], "commits": ["abc"], "criticals": []})
        self.assertFalse(out["checks"]["negative_control_empty_with_reason"]["ok"])


class ThreeArmJudging(unittest.TestCase):
    """Wave 2 (A vs B and A vs C in one results dir): a candidate other than 'B' must score, and pairs of one
    candidate must not leak into the other's gates."""

    def _row(self, order, pref, winner, cand="C"):
        return {"order": order, "overall_pref": pref, "winner": winner, "error": None,
                "ctl_arm": "A", "cand_arm": cand}

    def test_candidate_c_win_collapses_to_b_win(self):
        res = J.collapse_pair([self._row("o1", "Y", "C"), self._row("o2", "X", "C")])
        self.assertEqual(res["verdict"], "B-win")
        self.assertEqual(res["cand_arm"], "C")

    def test_control_win_still_a_win(self):
        res = J.collapse_pair([self._row("o1", "X", "A"), self._row("o2", "Y", "A")])
        self.assertEqual(res["verdict"], "A-win")

    def test_split_orders_tie(self):
        self.assertEqual(J.collapse_pair([self._row("o1", "X", "A"), self._row("o2", "X", "C")])["verdict"], "tie")

    def test_rows_without_arm_fields_keep_old_behaviour(self):
        rows = [{"order": "o1", "overall_pref": "Y", "winner": "B", "error": None},
                {"order": "o2", "overall_pref": "X", "winner": "B", "error": None}]
        self.assertEqual(J.collapse_pair(rows)["verdict"], "B-win")

    def test_judgment_rows_carry_control_and_candidate(self):
        idx = {"task": "E1", "rep": 1, "a_arm": "A", "b_arm": "C"}
        key = {"X": "C", "Y": "A"}
        verdict = {"dims": {"correctness": {"pref": "X", "weight": "major"}}, "overall": {"pref": "X"}}
        row = J._judgment_rows("p", "o1", idx, key, verdict, "executor", "opus", None)[0]
        self.assertEqual((row["ctl_arm"], row["cand_arm"], row["winner"]), ("A", "C", "C"))

    def test_filter_splits_candidates(self):
        pairs = [{"pair_id": "p1", "cand_arm": "B"}, {"pair_id": "p2", "cand_arm": "C"}, {"pair_id": "p3"}]
        self.assertEqual([p["pair_id"] for p in AG.for_candidate(pairs, "C")], ["p2", "p3"])
        self.assertEqual([p["pair_id"] for p in AG.for_candidate(pairs, "B")], ["p1", "p3"])


class InstalledReferencesAndWriteContent(unittest.TestCase):
    """Wave 2 (executor family): B/C point to ~/.claude/get-shit-done/references/*-detail.md, which the `get-shit-done`
    root match denied; and a Write whose CONTENT mentions a denied root path voided the run as contaminated."""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("hd2", ROOT / "hooks" / "harness-deny.py")
        self.hd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.hd)
        self.run_dir, self.repo = "/x/ab-eval/runs/RUN1", "/x/ab-eval/runs/RUN1/repo"
        self.refs = os.path.expanduser("~/.claude/get-shit-done/references/executor-detail.md")

    def test_read_of_installed_reference_allowed(self):
        for p in (self.refs, "~/.claude/get-shit-done/references/debugger-detail.md"):
            self.assertIsNone(self.hd.decide("Read", {"file_path": p}, self.repo, self.run_dir), p)

    def test_bash_read_of_installed_reference_allowed(self):
        self.assertIsNone(self.hd.decide("Bash", {"command": f"sed -n 107,300p {self.refs}"}, self.repo, self.run_dir))

    def test_rest_of_installed_gsd_and_live_repo_still_denied(self):
        for p in (os.path.expanduser("~/.claude/get-shit-done/bin/gsd-tools.js"),
                  os.path.expanduser("~/.claude/get-shit-done/references/../bin/gsd-tools.js"),
                  "/Users/o/get-shit-done/agents/v2/gsd2-executor.md", "/Users/o/igaming-platform/CLAUDE.md"):
            self.assertEqual(self.hd.decide("Read", {"file_path": p}, self.repo, self.run_dir)[0], "root", p)
            self.assertEqual(self.hd.decide("Bash", {"command": f"cat {p}"}, self.repo, self.run_dir)[0], "root", p)

    def test_bash_mutation_of_installed_reference_denied(self):
        for cmd in (f"echo x > {self.refs}", f"rm {self.refs}", f"cp {self.refs} /tmp/x", f"sed -i s/a/b/ {self.refs}"):
            self.assertEqual(self.hd.decide("Bash", {"command": cmd}, self.repo, self.run_dir)[0], "root", cmd)

    def test_write_to_installed_reference_still_denied(self):
        self.assertEqual(self.hd.decide("Write", {"file_path": self.refs}, self.repo, self.run_dir)[0], "write")

    def _scan(self, uses):
        import ab_transcript as T
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp, "runs", "RUN1")
            tdir = run / "transcripts"
            tdir.mkdir(parents=True)
            blocks = [dict(type="tool_use", id=f"u{i}", name=n, input=i_) for i, (n, i_) in enumerate(uses)]
            rows = [{"type": "assistant", "message": {"id": "m1", "model": "claude-haiku-5-5",
                                                      "usage": {"input_tokens": 1}, "content": blocks}}]
            (tdir / "main.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            return T.analyze(tdir, Path(tmp, "none"))

    def test_write_content_mentioning_a_root_is_not_contamination(self):
        out = self._scan([("Write", {"file_path": "/x/ab-eval/runs/RUN1/repo/S.md",
                                     "content": "plan paths point at /Users/o/igaming-platform; see ~/.claude/get-shit-done/x"}),
                          ("Edit", {"file_path": "/x/ab-eval/runs/RUN1/repo/S.md", "old_string": "a",
                                    "new_string": "/Users/o/igaming-platform"})])
        self.assertEqual(out["contaminated"], [])

    def test_write_to_a_root_path_still_contamination(self):
        out = self._scan([("Write", {"file_path": "/Users/o/igaming-platform/x.md", "content": "c"})])
        self.assertEqual(len(out["contaminated"]), 1)

    def test_installed_reference_read_is_not_contamination_but_bin_is(self):
        out = self._scan([("Read", {"file_path": self.refs}),
                          ("Read", {"file_path": os.path.expanduser("~/.claude/get-shit-done/bin/gsd-tools.js")})])
        self.assertEqual(len(out["contaminated"]), 1)
        self.assertIn("gsd-tools.js", out["contaminated"][0]["input"])

    def test_bash_heredoc_body_is_not_contamination(self):
        out = self._scan([("Bash", {"command": "cat > S.md <<'EOF'\nsee /Users/o/igaming-platform\nEOF"})])
        self.assertEqual(out["contaminated"], [])


class ScopeNote(unittest.TestCase):
    """E3: the plan's T0 git-ancestry gate cannot pass in a one-commit snapshot; the task brief says so."""

    def test_note_rendered_only_when_present(self):
        base = {"id": "X1", "role": "executor", "agent": "gsd-executor", "model": "haiku", "plan": "p.md",
                "phase_number": "1", "phase_name": "n", "plan_number": "01", "task_range": "1", "task_names": ["t"],
                "scope_files": ["a.ts"]}
        plain = R.render_brief(base)
        noted = R.render_brief(dict(base, scope_note="Snapshot note: X."))
        self.assertIn("Files in scope: a.ts.\nThe shared stack", plain)
        self.assertIn("Files in scope: a.ts. Snapshot note: X.\nThe shared stack", noted)

    def test_e3_registry_entry_carries_the_note(self):
        e3 = C.find_task(C.load_tasks(), "E3")
        self.assertIn("PREDECESSOR_NOT_LANDED", e3["scope_note"])
        self.assertIn("PREDECESSOR_NOT_LANDED", R.render_brief(e3))
