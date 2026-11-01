"""Unit tests for the gates pre-registered in RULING-executor-d.md: per-file informational hidden tests (R2, both arms)
and G6-Q (R1). Run: python3 -m unittest discover -s tests"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ab_aggregate as AG  # noqa: E402

GRID = "scripts/validation/grid-check.test.ts"
GATING = "apps/api/libs/infrastructure/src/lib/cache/redis-client-upstash.test.ts"
INFO = "apps/api/libs/infrastructure/src/lib/cache/cache-generation.test.ts"


def hid(*rcs_by_dest):
    files = [{"dest": d, "rc": rc, "counts": {"passed": 0 if rc else 1, "failed": 0}, "api_mismatch": bool(rc)}
             for d, rc in rcs_by_dest]
    return {"pass": all(f["rc"] == 0 for f in files), "files": files}


def row(rid, task, variant, acc=False, hidden=None, cost=0.5, status="done", ff="n/a", scope=(), crit=(), **kw):
    r = {"run_id": rid, "task_id": task, "variant": variant, "role": "executor", "status": status, "tier": "T2",
         "acceptance_pass": acc, "criticals": list(crit), "first_turn_tok": 1000, "result_cost_usd": cost,
         "hidden": hidden, "fail_first": ff, "scope_out": list(scope), "visible": {"pass": True}, "check_ok": True,
         "lint_ok": True, "fp": {"increase": 0}, "leak": None, "instructions": []}
    r.update(kw)
    return r


class InformationalHiddenTests(unittest.TestCase):
    def test_informational_file_failure_is_excused_for_both_arms(self):
        for variant in ("A", "D"):
            r = row("r", "E2", variant, hidden=hid((INFO, 1), (GATING, 0)))
            self.assertTrue(AG.treated_acceptance(r), variant)
            self.assertTrue(AG.hidden_gating_pass(r))

    def test_gating_file_failure_still_fails(self):
        r = row("r", "E2", "D", hidden=hid((INFO, 0), (GATING, 1)))
        self.assertFalse(AG.treated_acceptance(r))
        self.assertFalse(AG.hidden_gating_pass(r))

    def test_other_blockers_are_not_excused(self):
        hidden = hid((INFO, 1), (GATING, 0))
        for kw in ({"scope": ["docs/x.md"]}, {"crit": ["fp-increase=1"]}, {"status": "failed"},
                   {"visible": {"pass": False}}, {"check_ok": False}, {"lint_ok": False}, {"fp": {"increase": 1}}):
            self.assertFalse(AG.treated_acceptance(row("r", "E2", "A", hidden=hidden, **kw)), kw)

    def test_task_without_informational_files_is_untouched(self):
        r = row("r", "E4", "A", acc=False, hidden=hid(("apps/api/x.test.ts", 1)))
        self.assertFalse(AG.treated_acceptance(r))
        self.assertFalse(AG.hidden_gating_pass(r))
        self.assertTrue(AG.treated_acceptance(row("r", "E4", "A", acc=True)))

    def test_only_listed_file_of_a_listed_task_is_informational(self):
        r = row("r", "E1", "A", hidden=hid((GRID, 1)))
        self.assertTrue(AG.hidden_gating_pass(r))
        self.assertFalse(AG.hidden_gating_pass(row("r", "E1", "A", hidden=hid(("scripts/other.test.ts", 1)))))

    def test_g2_treated_figure_gates_and_strict_is_printed(self):
        ra = [row(f"a{i}", "E2", "A", hidden=hid((INFO, 1), (GATING, 0))) for i in range(3)]
        rb = [row(f"d{i}", "E2", "D", hidden=hid((INFO, 1), (GATING, 1))) for i in range(3)]
        status, detail = AG.g2_acceptance(ra + rb, "A", "D")
        self.assertEqual(status, AG.FAIL)
        self.assertIn("A=3/3 B=0/3", detail)
        self.assertIn("strict A=0/3 B=0/3", detail)
        status, detail = AG.g2_acceptance(ra + [dict(x, variant="D") for x in ra], "A", "D")
        self.assertEqual(status, AG.PASS)

    def test_g3_hidden_mean_uses_gating_files_and_reports_informational_rates(self):
        ra = [row(f"a{i}", "E2", "A", hidden=hid((INFO, 1), (GATING, 0))) for i in range(3)]
        rb = [row(f"d{i}", "E2", "D", hidden=hid((INFO, 0), (GATING, 0))) for i in range(3)]
        status, detail = AG.g3_secondary(ra + rb, "A", "D", [])
        self.assertEqual(status, AG.PASS)
        self.assertIn("hidden mean A=1.00 B=1.00", detail)
        self.assertIn("E2/cache-generation.test.ts 0/3", detail)
        self.assertIn("E2/cache-generation.test.ts 3/3", detail)


class G6QualityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.draft = Path(self.tmp.name) / "d.md"
        self.draft.write_bytes(b"x" * AG.G6Q_MAX_BYTES)

    def rows(self, d_cost=0.5, d_ff="proven", d_status="done", d_cost_none=False):
        tasks = ("E2", "E3", "E4", "E5")
        ra = [row(f"a{t}{i}", t, "A", cost=0.5) for t in tasks for i in range(3)]
        rd = [row(f"d{t}{i}", t, "D", cost=None if d_cost_none else d_cost, status=d_status, ff=d_ff)
              for t in tasks for i in range(3)]
        return ra + rd

    def judgments(self, d_wins=6, a_wins=0):
        out = []
        for i in range(d_wins + a_wins):
            winner = "D" if i < d_wins else "A"
            out.append({"pair_id": f"p{i}", "task": ("E2", "E3", "E4", "E5")[i % 4],
                        "dims": {"test_quality": {"winner": winner}}, "error": None})
        return out

    def pairs(self, d_wins=2, a_wins=1):
        return [{"pair_id": f"q{i}", "task": "E2", "verdict": "B-win" if i < d_wins else "A-win"}
                for i in range(d_wins + a_wins)]

    def gate(self, rows=None, judg=None, pairs=None, draft=None):
        return AG.g6_quality(rows or self.rows(), pairs or self.pairs(), judg or self.judgments(20), "A", "D",
                             draft or self.draft)

    def test_all_clauses_pass(self):
        status, detail = self.gate()
        self.assertEqual(status, AG.PASS, detail)

    def test_cost_over_ten_percent_fails(self):
        self.assertEqual(self.gate(rows=self.rows(d_cost=0.56))[0], AG.FAIL)
        self.assertEqual(self.gate(rows=self.rows(d_cost=0.55))[0], AG.PASS)

    def test_failed_run_without_cost_line_fails_cost_clause(self):
        rows = self.rows()
        rows.append(row("dE4x", "E4", "D", cost=None, status="failed", ff="proven"))
        status, detail = self.gate(rows=rows)
        self.assertEqual(status, AG.FAIL)
        self.assertIn("dE4x", detail)

    def test_size_over_bar_fails(self):
        self.draft.write_bytes(b"x" * (AG.G6Q_MAX_BYTES + 1))
        self.assertEqual(self.gate()[0], AG.FAIL)

    def test_tie_cannot_pass_better_clause(self):
        status, detail = self.gate(judg=self.judgments(d_wins=10, a_wins=10), pairs=self.pairs(1, 1))
        self.assertEqual(status, AG.FAIL)
        self.assertIn("test_quality net=+0", detail)

    def test_net_threshold_and_bootstrap_p10(self):
        self.assertEqual(self.gate(judg=self.judgments(d_wins=9, a_wins=0))[0], AG.FAIL)
        self.assertEqual(self.gate(judg=self.judgments(d_wins=10, a_wins=0))[0], AG.PASS)
        ties = [{"pair_id": f"t{i}", "task": "E2", "dims": {"test_quality": {"winner": "tie"}}, "error": None}
                for i in range(30)]
        self.assertEqual(self.gate(judg=self.judgments(d_wins=10, a_wins=0) + ties)[0], AG.PASS)
        one_task = [dict(j, task="E2") for j in self.judgments(d_wins=8, a_wins=4)]
        self.assertEqual(self.gate(judg=one_task)[0], AG.FAIL)

    def test_fail_first_proven_needs_three(self):
        self.assertEqual(self.gate(rows=self.rows(d_ff="absent"))[0], AG.FAIL)

    def test_pairs_c_clause_a_wins_more_fails(self):
        self.assertEqual(self.gate(pairs=self.pairs(d_wins=1, a_wins=2))[0], AG.FAIL)
        self.assertEqual(self.gate(pairs=self.pairs(d_wins=2, a_wins=2))[0], AG.PASS)

    def test_bootstrap_lower10_is_deterministic_and_clustered(self):
        per = {"E1": [1, 1], "E2": [1, 1], "E3": [-1, -1]}
        self.assertEqual(AG.bootstrap_lower10(per, 6), AG.bootstrap_lower10(per, 6))
        self.assertLess(AG.bootstrap_lower10(per, 6), 0)
        self.assertGreater(AG.bootstrap_lower10({"E1": [1, 1], "E2": [1, 1]}, 6), 0)

    def test_role_gates_swaps_g6_only_when_asked_for_executor(self):
        rows = self.rows()
        gates = AG.role_gates("executor", rows, self.pairs(), self.judgments(20), [], "A", "D", self.draft)
        self.assertIn("G6-Q", gates["G6"][1])
        plain = AG.role_gates("executor", rows, self.pairs(), self.judgments(20), [], "A", "D")
        self.assertNotIn("G6-Q", plain["G6"][1])


if __name__ == "__main__":
    unittest.main()
