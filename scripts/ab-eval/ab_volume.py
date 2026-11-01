#!/usr/bin/env python3
"""Test-volume metric for test-writer runs (experiment 11 DESIGN, "Volume metric (new)").

Per run, from `grade/diff.patch`, on test files only, ignoring blank lines and hunks that only re-indent or
re-wrap (the added and removed non-blank lines are the same multiset after whitespace is stripped):

  cases_added, cases_removed, net_cases   regex `Deno.test(`, `it(`, `test(`, `t.step(` at the start of a line
  loc_added, loc_removed, net_loc         non-blank lines
  behaviours                               task registry key `behaviours` (an int)
  loc_per_behaviour, cases_per_behaviour   loc_added / behaviours, cases_added / behaviours
  mutants_killed, mutants_survived         grade/summary.json role_checks.kills (applied mutants only)
  kills_per_added_case                     mutants_killed / max(cases_added, 1)

Known weakness (DESIGN): a regex case count misses wrappers, and a table-driven loop counts one case for many rows.
The gate reads net_cases, so merging into a table lowers the count on purpose.

  python3 ab_volume.py run RUN_ID [RUN_ID ...]     print the metrics as JSON, one line per run
  python3 ab_volume.py selftest
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402

TEST_FILE = re.compile(r"(\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|_test\.[jt]s$|/__tests__/)")
CASE_LINE = re.compile(r"^\s*(?:await\s+)?(?:Deno\.test|it|test|t\.step)\s*\(")


def split_files(patch: str) -> Dict[str, List[str]]:
    files: Dict[str, List[str]] = {}
    cur: Optional[str] = None
    for line in patch.split("\n"):
        if line.startswith("diff --git "):
            m = re.match(r"diff --git a/(.*?) b/(.*)$", line)
            cur = m.group(2) if m else None
            if cur is not None:
                files[cur] = []
        elif cur is not None:
            files[cur].append(line)
    return files


def hunks(lines: List[str]) -> List[List[str]]:
    out: List[List[str]] = []
    cur: Optional[List[str]] = None
    for line in lines:
        if line.startswith("@@"):
            cur = []
            out.append(cur)
        elif cur is not None and line[:1] in ("+", "-") and not line.startswith(("+++", "---")):
            cur.append(line)
    return out


def _norm(line: str) -> str:
    return re.sub(r"\s+", "", line[1:])


def hunk_is_whitespace_only(h: List[str]) -> bool:
    added = Counter(_norm(x) for x in h if x[0] == "+" and _norm(x))
    removed = Counter(_norm(x) for x in h if x[0] == "-" and _norm(x))
    return added == removed


def measure_patch(patch: str) -> Dict[str, int]:
    m = {"cases_added": 0, "cases_removed": 0, "loc_added": 0, "loc_removed": 0, "test_files": 0}
    for path, lines in split_files(patch).items():
        if not TEST_FILE.search(path):
            continue
        m["test_files"] += 1
        for h in hunks(lines):
            if hunk_is_whitespace_only(h):
                continue
            for x in h:
                body = x[1:]
                if not body.strip():
                    continue
                key = "added" if x[0] == "+" else "removed"
                m[f"loc_{key}"] += 1
                if CASE_LINE.match(body):
                    m[f"cases_{key}"] += 1
    m["net_loc"] = m["loc_added"] - m["loc_removed"]
    m["net_cases"] = m["cases_added"] - m["cases_removed"]
    return m


def run_metrics(run_id: str, behaviours: Optional[int] = None) -> Dict[str, Any]:
    run_dir = C.AB_HOME / "runs" / run_id
    patch_file = run_dir / "grade" / "diff.patch"
    patch = patch_file.read_text(errors="replace") if patch_file.exists() else ""
    m: Dict[str, Any] = dict(measure_patch(patch), run_id=run_id)
    summary = C.read_json(run_dir / "grade" / "summary.json", {}) or {}
    kills = (summary.get("role_checks") or {}).get("kills") or []
    applied = [k for k in kills if k.get("applied")]
    m["mutants_total"] = len(applied)
    m["mutants_killed"] = sum(1 for k in applied if k.get("killed"))
    m["mutants_survived"] = m["mutants_total"] - m["mutants_killed"]
    m["kills_per_added_case"] = round(m["mutants_killed"] / max(m["cases_added"], 1), 4)
    if behaviours:
        m["behaviours"] = behaviours
        m["loc_per_behaviour"] = round(m["loc_added"] / behaviours, 2)
        m["cases_per_behaviour"] = round(m["cases_added"] / behaviours, 2)
    return m


def selftest() -> int:
    patch = (
        "diff --git a/x/a.test.ts b/x/a.test.ts\n--- a/x/a.test.ts\n+++ b/x/a.test.ts\n"
        "@@ -1,3 +1,5 @@\n+Deno.test(\"n\", () => {\n+  assertEquals(1, 1);\n+});\n-Deno.test(\"o\", () => {\n-});\n"
        "@@ -50,2 +52,2 @@\n-  foo(1);\n+    foo(1);\n"
        "diff --git a/x/a.ts b/x/a.ts\n--- a/x/a.ts\n+++ b/x/a.ts\n@@ -1 +1 @@\n-a\n+b\n"
    )
    m = measure_patch(patch)
    want = {"cases_added": 1, "cases_removed": 1, "loc_added": 3, "loc_removed": 2, "net_loc": 1, "net_cases": 0}
    bad = {k: (m[k], v) for k, v in want.items() if m[k] != v}
    if bad:
        print(f"selftest FAIL {bad}")
        return 1
    print("selftest OK")
    return 0


def main(argv: List[str]) -> int:
    if argv and argv[0] == "selftest":
        return selftest()
    if argv and argv[0] == "run":
        cfg = C.load_tasks()
        for rid in argv[1:]:
            task = C.find_task(cfg, rid.split("-")[0])
            print(json.dumps(run_metrics(rid, task.get("behaviours"))))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
