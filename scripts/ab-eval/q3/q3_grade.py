"""Deterministic grading of a Q3 session from the runner's own output contract (---RESULT--- block, classify.ts rules)."""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

import q3_spec as S

RESULT_BLOCK = re.compile(r"---RESULT---\s*([\s\S]*?)\s*---RESULT---")  # mirrors classify.ts RESULT_BLOCK_PATTERN
TAG = re.compile(r"\bS([1-9])\b")
STATUSES = {"PASS", "FAIL", "ERROR", "LIMIT_ABORTED", "TIMEOUT"}


def strip_code_fence(text: str) -> str:  # mirrors classify.ts stripCodeFence
    t = text.strip()
    if not t.startswith("```"):
        return t
    t = re.sub(r"^```[ \t]*[A-Za-z0-9_+-]*[ \t]*\r?\n?", "", t)
    t = re.sub(r"\r?\n?```$", "", t)
    return t.strip()


def extract_result(text: str) -> Optional[str]:
    m = RESULT_BLOCK.search(text or "")
    if not m:
        return None
    payload = strip_code_fence(m.group(1))
    return payload or None


def parse_contract(text: str) -> Dict[str, Any]:
    """Contract parse: block present, JSON valid, status in the allowed set, steps a non-empty list."""
    payload = extract_result(text)
    if payload is None:
        return {"ok": False, "reason": "no_result_block", "data": None}
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return {"ok": False, "reason": "invalid_json", "data": None}
    if not isinstance(data, dict):
        return {"ok": False, "reason": "not_object", "data": None}
    if data.get("status") not in STATUSES:
        return {"ok": False, "reason": "bad_status", "data": data}
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps:
        return {"ok": False, "reason": "no_steps", "data": data}
    return {"ok": True, "reason": None, "data": data}


def tag_verdicts(data: Dict[str, Any]) -> Dict[str, str]:
    """Tag -> 'FAIL' if any step carrying the tag reports FAIL, else 'PASS' if one carries it with PASS/other; absent tags omitted."""
    out: Dict[str, str] = {}
    for st in data.get("steps") or []:
        if not isinstance(st, dict):
            continue
        status = str(st.get("status", "")).upper()
        for n in set(TAG.findall(str(st.get("step", "")))):
            tag = f"S{n}"
            if status == "FAIL" or out.get(tag) == "FAIL":
                out[tag] = "FAIL"
            else:
                out[tag] = "PASS" if status == "PASS" else status or "UNKNOWN"
    return out


def grade(kind: str, text: str) -> Dict[str, Any]:
    truth = S.TRUTH_SEEDED if kind == "seeded" else S.TRUTH_CLEAN
    c = parse_contract(text)
    verdicts = tag_verdicts(c["data"]) if c["data"] else {}
    detected = [S.DEFECT_OF[t] for t in S.TAGS if truth[t] == "FAIL" and verdicts.get(t) == "FAIL"]
    defects = [S.DEFECT_OF[t] for t in S.TAGS if truth[t] == "FAIL"]
    false_fail = [t for t in S.TAGS if truth[t] == "PASS" and verdicts.get(t) == "FAIL"]
    controls = [t for t in S.TAGS if truth[t] == "PASS"]
    return {
        "kind": kind, "parse_ok": c["ok"], "parse_reason": c["reason"],
        "overall_status": (c["data"] or {}).get("status"),
        "verdicts": verdicts, "tags_present": sorted(verdicts), "tags_missing": [t for t in S.TAGS if t not in verdicts],
        "defects_total": len(defects), "defects_detected": detected,
        "false_fail_tags": false_fail, "controls_total": len(controls),
        "overall_false_fail": kind == "clean" and (c["data"] or {}).get("status") == "FAIL",
        "correct": sum(1 for t in S.TAGS if verdicts.get(t) == truth[t]),
    }
