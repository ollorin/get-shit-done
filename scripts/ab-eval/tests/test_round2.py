import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import round2_report as R  # noqa: E402
import run_round2 as D  # noqa: E402


class Bootstrap(unittest.TestCase):
    def test_known_gap_lies_inside_interval_and_excludes_zero(self):
        a = {f"t{i}": 0.5 + i * .01 for i in range(10)}
        b = {t: v + .2 for t, v in a.items()}
        d, lo, hi, n = R.bootstrap(a, b)
        self.assertAlmostEqual(d, .2)
        self.assertTrue(lo <= .2 <= hi and n == 10)

    def test_no_gap_interval_covers_zero(self):
        rng = random.Random(1)
        a = {f"t{i}": rng.random() for i in range(10)}
        b = {t: v + rng.choice((-.1, .1)) for t, v in a.items()}
        _d, lo, hi, _n = R.bootstrap(a, b)
        self.assertTrue(lo <= 0 <= hi)

    def test_one_task_dominating_widens_interval(self):
        a = {f"t{i}": 0.0 for i in range(10)}
        b = dict(a, t0=5.0)
        _d, lo, hi, _n = R.bootstrap(a, b)
        self.assertEqual(lo, 0.0)
        self.assertGreater(hi, 1.0)

    def test_tasks_without_both_arms_are_ignored(self):
        self.assertIsNone(R.bootstrap({"a": 1.0}, {"b": 1.0}))
        self.assertIsNone(R.bootstrap({"a": None}, {"a": 1.0}))


class Driver(unittest.TestCase):
    SPEC = [{"tasks": ["T1", "T2"], "arms": ["A", "A2"], "reps": 4}]

    def test_every_cell_runs_exactly_once(self):
        jobs = D.plan(self.SPEC, 15)
        self.assertEqual(len(jobs), 16)
        self.assertEqual(len(set(jobs)), 16)

    def test_order_is_seeded_and_both_arms_lead_sometimes(self):
        jobs = D.plan(self.SPEC, 15)
        self.assertEqual(jobs, D.plan(self.SPEC, 15))
        for task in ("T1", "T2"):
            mine = [j[1] for j in jobs if j[0] == task]
            firsts = [mine[i] for i in range(0, 8, 2)]
            self.assertEqual(firsts.count("A"), 2, firsts)

    def test_rep_start_is_honoured(self):
        spec = [dict(self.SPEC[0], rep_start=7, reps=1)]
        self.assertEqual({j[2] for j in D.plan(spec, 15)}, {7})


if __name__ == "__main__":
    unittest.main()
