"""Facts from a run's transcripts (DESIGN §4.4 transcript scan, §5.1 tier and cost fields).

Input is the mirrored transcript tree copied into runs/<RUN>/transcripts/ (main session jsonl plus
subagents/agent-*.jsonl and their .meta.json). Output is plain data; no judgement is made here.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import ab_common as C

EXEC_CHILD = "gsd-executor"


def _lines(path: Path):
    for raw in path.read_text(errors="replace").splitlines():
        try:
            yield json.loads(raw)
        except json.JSONDecodeError:
            continue


def _usage_sum(usage: Dict[str, Any]) -> int:
    return int(usage.get("input_tokens", 0) or 0) + int(usage.get("cache_creation_input_tokens", 0) or 0) + \
        int(usage.get("cache_read_input_tokens", 0) or 0)


def _subagent_type(path: Path) -> Optional[str]:
    meta = path.with_name(path.stem + ".meta.json")
    if meta.exists():
        return C.read_json(meta, {}).get("agentType")
    return None


def analyze(tdir: Path, denials_path: Path, targets: Tuple[str, ...] = (EXEC_CHILD,)) -> Dict[str, Any]:
    files = sorted(tdir.rglob("*.jsonl")) if tdir.exists() else []
    main_files = [f for f in files if "subagents" not in f.parts]
    sub_files = [f for f in files if "subagents" in f.parts]
    out: Dict[str, Any] = {
        "models": set(), "api_turns": 0, "usage": {"input": 0, "output": 0, "cache_creation": 0, "cache_read": 0},
        "max_ctx": 0, "compactions": 0, "instructions": {}, "nested_memory": [], "agent_spawns": [],
        "tier_violations": [], "contaminated": [], "tool_calls": [], "first_turn_tok": None, "memory_paths": [],
        "first_turn_source": None,
    }
    seen_msg_ids = set()
    first_turn_candidates: List[Any] = []
    for f in main_files + sub_files:
        is_sub = "subagents" in f.parts
        sub_type = _subagent_type(f) if is_sub else None
        results: Dict[str, Dict[str, Any]] = {}
        uses: List[Dict[str, Any]] = []
        first_usage_seen = False
        for d in _lines(f):
            kind = d.get("type")
            if kind == "attachment":
                att = d.get("attachment") or {}
                if att.get("type") == "instructions":
                    for fl in att.get("files", []):
                        key = fl.get("path", "?")
                        chars = len(fl.get("content", "") or "")
                        out["instructions"][key] = max(chars, out["instructions"].get(key, 0))
                elif att.get("type") == "nested_memory":
                    out["nested_memory"].append(att.get("path", "?"))
                elif "mem" in str(att.get("type", "")).lower():
                    out["memory_paths"].append(att.get("path", "?"))
            elif kind == "system" and "compact" in str(d.get("subtype", "")):
                out["compactions"] += 1
            elif kind == "assistant":
                msg = d.get("message", {}) or {}
                mid = msg.get("id")
                if msg.get("model"):
                    out["models"].add(msg["model"])
                usage = msg.get("usage") or {}
                if mid and mid not in seen_msg_ids and usage:
                    seen_msg_ids.add(mid)
                    out["api_turns"] += 1
                    u = out["usage"]
                    u["input"] += int(usage.get("input_tokens", 0) or 0)
                    u["output"] += int(usage.get("output_tokens", 0) or 0)
                    u["cache_creation"] += int(usage.get("cache_creation_input_tokens", 0) or 0)
                    u["cache_read"] += int(usage.get("cache_read_input_tokens", 0) or 0)
                    out["max_ctx"] = max(out["max_ctx"], _usage_sum(usage))
                if usage and not first_usage_seen:
                    first_usage_seen = True
                    first_turn_candidates.append((is_sub, sub_type, _usage_sum(usage), str(f.name)))
                for block in msg.get("content", []) or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        uses.append(block)
            elif kind == "user":
                content = (d.get("message", {}) or {}).get("content")
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "tool_result":
                            results[block.get("tool_use_id", "")] = {"text": json.dumps(block.get("content")),
                                                                     "is_error": bool(block.get("is_error"))}
        for block in uses:
            name = block.get("name", "")
            inp = block.get("input", {}) or {}
            text = json.dumps(inp, sort_keys=True)
            if name in ("Agent", "Task"):
                desc = str(inp.get("description", ""))
                spawn = {"subagent_type": inp.get("subagent_type"), "model": inp.get("model"), "description": desc,
                         "spawned_from": sub_type or "main"}
                out["agent_spawns"].append(spawn)
                if not inp.get("model"):
                    out["tier_violations"].append({"reason": "agent call without model", "description": desc})
                elif inp.get("subagent_type") == EXEC_CHILD and inp.get("model") != "haiku" \
                        and "escalate:" not in desc:
                    out["tier_violations"].append({"reason": f"executor child on {inp.get('model')}",
                                                   "description": desc})
            if name in C.TOOLS_WITH_PATHS:
                out["tool_calls"].append({"name": name, "input": text, "agent": sub_type or "main"})
                if any(root in text for root in C.ROOTS):
                    res = results.get(block.get("id", ""), {"text": "", "is_error": False})
                    if "HARNESS-DENY" not in res["text"]:
                        out["contaminated"].append({"tool": name, "input": text[:200], "agent": sub_type or "main"})
    out["first_turn_tok"], out["first_turn_source"] = _first_turn(first_turn_candidates, targets)
    out["denials"] = _denials(denials_path)
    out["models"] = sorted(out["models"])
    out["instructions"] = [{"path": k, "chars": v} for k, v in sorted(out["instructions"].items())]
    return out


def _first_turn(cands: List[Any], targets: Tuple[str, ...] = (EXEC_CHILD,)):
    """The role-under-test subagent's first API turn, else the main session's first turn (DESIGN §5.1 cost)."""
    for is_sub, sub_type, tok, name in cands:
        if is_sub and sub_type in targets:
            return tok, f"subagent:{name}"
    for is_sub, _sub_type, tok, name in cands:
        if not is_sub:
            return tok, f"main:{name}"
    return None, None


def _denials(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
