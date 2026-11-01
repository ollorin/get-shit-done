import json
import unittest

import q3_grade as G
import q3_spec as S


def block(steps, status="FAIL"):
    return "noise\n---RESULT---\n" + json.dumps({"test": "t", "status": status, "steps": steps}) + "\n---RESULT---"


def step(tag, status):
    return {"step": f"{tag}: something", "status": status, "observations": []}


class GradeTests(unittest.TestCase):
    def test_extract_and_fence(self):
        self.assertEqual(G.extract_result("---RESULT---\n```json\n{\"a\":1}\n```\n---RESULT---"), '{"a":1}')
        self.assertIsNone(G.extract_result("no block"))
        self.assertIsNone(G.extract_result("---RESULT---\n  \n---RESULT---"))

    def test_parse_failures(self):
        self.assertEqual(G.parse_contract("x")["reason"], "no_result_block")
        self.assertEqual(G.parse_contract("---RESULT---\n{bad\n---RESULT---")["reason"], "invalid_json")
        self.assertEqual(G.parse_contract("---RESULT---\n[1]\n---RESULT---")["reason"], "not_object")
        self.assertEqual(G.parse_contract(block([step("S1", "PASS")], status="PARTIAL"))["reason"], "bad_status")
        self.assertEqual(G.parse_contract(block([]))["reason"], "no_steps")
        self.assertTrue(G.parse_contract(block([step("S1", "PASS")]))["ok"])

    def test_seeded_perfect(self):
        steps = [step(t, S.TRUTH_SEEDED[t]) for t in S.TAGS]
        g = G.grade("seeded", block(steps))
        self.assertEqual(sorted(g["defects_detected"]), ["F1", "F2", "F3", "F4", "F5", "F6"])
        self.assertEqual(g["false_fail_tags"], [])
        self.assertEqual(g["correct"], 9)

    def test_seeded_misses_and_false_fail(self):
        steps = [step(t, "PASS") for t in S.TAGS]
        steps[0]["status"] = "FAIL"  # S1 is a control
        g = G.grade("seeded", block(steps))
        self.assertEqual(g["defects_detected"], [])
        self.assertEqual(g["false_fail_tags"], ["S1"])

    def test_missing_tag_is_not_detection(self):
        steps = [step(t, S.TRUTH_SEEDED[t]) for t in S.TAGS if t != "S3"]
        g = G.grade("seeded", block(steps))
        self.assertNotIn("F2", g["defects_detected"])
        self.assertEqual(g["tags_missing"], ["S3"])

    def test_clean_false_fail_counts(self):
        steps = [step(t, "PASS") for t in S.TAGS]
        steps[5]["status"] = "FAIL"
        g = G.grade("clean", block(steps, status="FAIL"))
        self.assertEqual(g["false_fail_tags"], ["S6"])
        self.assertTrue(g["overall_false_fail"])

    def test_duplicate_tag_any_fail_wins(self):
        steps = [step("S2", "PASS"), step("S2", "FAIL")]
        self.assertEqual(G.tag_verdicts({"steps": steps})["S2"], "FAIL")

    def test_tag_not_matched_inside_word(self):
        self.assertEqual(G.tag_verdicts({"steps": [{"step": "CSS1 check", "status": "FAIL"}]}), {})

    def test_unparseable_grades_zero(self):
        g = G.grade("seeded", "garbage")
        self.assertFalse(g["parse_ok"])
        self.assertEqual(g["defects_detected"], [])


if __name__ == "__main__":
    unittest.main()
