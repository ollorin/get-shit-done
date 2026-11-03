"""Role table, brief rendering and per-run agent sets (DESIGN-ALL-AGENTS §1-§4).

Every run is a haiku dispatcher that makes one Agent call; the agent under test and any children come only from
the `--agents` JSON built here (probes S3/S10: `~/.claude/agents` is not loaded). A variant may rename the agent a
role uses (`variants/<V>/roles.json`, e.g. runner -> gsd2-runner); arm A uses the task's own `agent`.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

import ab_common as C

# calib = default calibration mode (ab_calib.py); grade = role grader (ab_grade.role_grade); brief = template name
ROLES: Dict[str, Dict[str, Any]] = {
    "executor":     {"brief": "executor", "calib": "tests", "grade": "code"},
    "debugger":     {"brief": "debugger", "calib": "tests", "grade": "code"},
    "test-writer":  {"brief": "test-writer", "calib": "mutants", "grade": "mutants"},
    "docs-updater": {"brief": "docs-updater", "calib": "evidence", "grade": "docs"},
    "review":       {"brief": "reviewer", "calib": "evidence", "grade": "report"},
    "plancheck":    {"brief": "plancheck", "calib": "evidence", "grade": "report"},
    "planner":      {"brief": "planner", "calib": "evidence", "grade": "report"},
    "verifier":     {"brief": "verifier", "calib": "evidence", "grade": "report"},
    "runner":       {"brief": "runner", "calib": "planted", "grade": "runner"},
    "coordinator":  {"brief": "coordinator", "calib": "coord", "grade": "coord"},
    "charlotte-qa": {"brief": "charlotte-qa", "calib": "fixture", "grade": "report", "mcp": "charlotte"},
    "smoke":        {"brief": "smoke", "calib": "setup", "grade": "report"},
}

STUB_ROLES = {  # child agent name a coordinator spawns -> stub_child.py --role
    "gsd-executor": "executor", "gsd-verifier": "verifier", "gsd-plan-checker": "plan-checker",
    "gsd-docs-updater": "docs-updater", "gsd-test-writer": "test-writer", "general-purpose": "review",
}
STUB_PROMPT = (
    "You are a stand-in for the `{name}` agent in an evaluation harness. Run exactly one Bash command with "
    "timeout 600000: `python3 {stub} --role {role} --plan <PLAN>` where <PLAN> is the plan id (like 398-02) named "
    "in your prompt; for a phase-level job pass `--phase <N>` instead of --plan. Print the command's stdout "
    "verbatim as your final message. Do nothing else."
)
CLAUDE_ADDED_KEYS = ("omitClaudeMd", "maxTurns", "effort")  # frontmatter extras honoured in --agents JSON


def role_cfg(task: Dict[str, Any]) -> Dict[str, Any]:
    role = task["role"]
    if role not in ROLES:
        raise C.Refused(f"{task['id']}: unknown role {role!r}")
    return ROLES[role]


def calibration_cfg(task: Dict[str, Any]) -> Dict[str, Any]:
    raw = task.get("calibration")
    cfg = dict(raw) if isinstance(raw, dict) else {}
    cfg.setdefault("mode", role_cfg(task)["calib"])
    return cfg


def variant_roles(variant: str) -> Dict[str, str]:
    return C.read_json(C.variant_dir(variant) / "roles.json", {}) or {}


def subagent_type(task: Dict[str, Any], variant: str) -> str:
    return variant_roles(variant).get(task["role"], task["agent"])


def allowed_models(task: Dict[str, Any]) -> List[str]:
    """Substrings a run's models may contain; the dispatcher is always haiku (ab_run.execute)."""
    return sorted({"haiku", str(task.get("model", "haiku"))})


def mcp_config(task: Dict[str, Any]) -> Path:
    kind = role_cfg(task).get("mcp")
    return C.AB_HOME / "harness" / ("charlotte-mcp.json" if kind == "charlotte" else "empty-mcp.json")


def task_brief_text(task: Dict[str, Any]) -> str:
    f = C.BRIEFS / f"{task['id']}.md"
    if f.exists():
        return f.read_text().strip()
    return str(task.get("brief", "")).strip()


def _subs(task: Dict[str, Any], variant: str) -> Dict[str, str]:
    subs: Dict[str, str] = {
        "SUBAGENT_TYPE": subagent_type(task, variant), "MODEL": str(task.get("model", "haiku")),
        "TASK_ID": task["id"], "TASK_BRIEF": task_brief_text(task),
        "SCOPE_FILES": ", ".join(task.get("scope_files", [])),
        "DESCRIPTION": str(task.get("description") or f"{task['role']} {task['id']}"),
    }
    for key in ("plan", "phase_dir", "phase_number", "phase_name", "plan_number", "task_range", "base"):
        if key in task and task[key] is not None:
            subs[key.upper() if key != "plan" else "PLAN_FILE"] = str(task[key])
    subs["PLAN_NUMBER"] = str(task.get("plan_number", ""))
    subs["TASK_NAMES"] = "; ".join(task.get("task_names", []))
    subs["COMMIT_NOTE"] = str(task.get("commit_note") or "Commit each test file as its own RED commit before any "
                              "implementation exists in the tree.")
    subs["SCOPE_NOTE"] = (" " + str(task["scope_note"]).strip()) if task.get("scope_note") else ""
    for key, value in task.items():
        if isinstance(value, (str, int)) and not isinstance(value, bool):
            subs.setdefault(key.upper(), str(value))
    if task["role"] == "executor":
        subs["DESCRIPTION"] = f"Execute plan {task.get('plan_number')} tasks {task.get('task_range')}"
    return subs


def render_brief(task: Dict[str, Any], variant: str = "A") -> str:
    cfg = role_cfg(task)
    template = (C.PROMPTS / f"brief-{cfg['brief']}.md").read_text()
    subs = _subs(task, variant)
    # the task brief may itself hold placeholders (kept literal): substitute it last
    brief = subs.pop("TASK_BRIEF")
    for key, value in subs.items():
        template = template.replace("{{" + key + "}}", value)
    template = template.replace("{{TASK_BRIEF}}", brief)
    left = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", template)))
    if left:
        raise C.Refused(f"{task['id']}: brief template has unfilled placeholders {left}")
    if not brief and "{{TASK_BRIEF}}" in (C.PROMPTS / f"brief-{cfg['brief']}.md").read_text():
        raise C.Refused(f"{task['id']}: no task brief (examples/briefs/{task['id']}.md or `brief`)")
    return template


def stub_agents(run_stub_path: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for name, role in STUB_ROLES.items():
        out[name] = {"description": f"Evaluation stub for {name}", "tools": ["Bash"], "model": "haiku",
                     "prompt": STUB_PROMPT.format(name=name, stub=run_stub_path, role=role)}
    return out


def agent_provenance(task: Dict[str, Any], variant: str) -> Dict[str, Any]:
    """Refuse a stale or hand-edited build of the agent a run will use; return its recorded provenance."""
    need = subagent_type(task, variant)
    if need == "general-purpose":
        return {}
    return C.verify_sources(variant, [need])


def build_agents(task: Dict[str, Any], variant: str) -> Dict[str, Any]:
    """Agents JSON for the run: the variant's defs, plus stubs for coordinator tasks (children by name)."""
    agent_provenance(task, variant)
    agents = C.read_json(C.variant_dir(variant) / "agents.json", {})
    need = subagent_type(task, variant)
    if need != "general-purpose" and need not in agents:
        raise C.Refused(f"{task['id']}: agent {need!r} is not in variants/{variant}/agents.json "
                        "(run `ab_setup.py freeze-agents` or `variant-from-drafts`)")
    if task["role"] == "coordinator":
        agents = dict(agents)
        agents.update(stub_agents(str(C.AB_HOME / "harness" / "stub_child.py")))
    return agents
