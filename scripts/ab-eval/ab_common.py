"""Shared paths, guards and helpers for the A/B instruction eval runner (exp 07, DESIGN §4, §7)."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

AB_HOME = Path(os.environ.get("AB_HOME", str(Path.home() / "ab-eval")))
LIVE_REPO = Path(os.environ.get("AB_LIVE_REPO", "/Users/ollorin/igaming-platform"))  # read-only source
GSD_HOME = Path.home() / ".claude" / "get-shit-done"
CLAUDE_AGENTS = Path.home() / ".claude" / "agents"
MEMORY_SRC = Path.home() / ".claude" / "projects" / "-Users-ollorin-igaming-platform" / "memory"
PROJECTS = Path.home() / ".claude" / "projects"
SCRIPT_DIR = Path(__file__).resolve().parent
HOOKS = SCRIPT_DIR / "hooks"
PROMPTS = SCRIPT_DIR / "prompts"
FIXTURES = SCRIPT_DIR / "fixtures"
EXAMPLES = SCRIPT_DIR / "examples"
BRIEFS = EXAMPLES / "briefs"        # task-specific brief text (<ID>.md), committed
ARTIFACTS = EXAMPLES / "artifacts"  # authored per-task inputs (overlays, patches, mutants, scenarios)
HARNESS_SRC = SCRIPT_DIR / "harness"
GSD_REPO = Path.home() / "get-shit-done"             # source repo of the B/Q drafts (read-only here)
V2_DRAFTS = GSD_REPO / "agents" / "v2"
SOURCES_FILE = "sources.json"                          # variants/<V>/sources.json: build provenance (commit, hashes)

GIB = 1024 ** 3
MAX_CONCURRENT = 2          # CLAUDE.md parallelism ceiling / host memory (DESIGN §4.5)
MIN_FREE_GIB = 8.0          # exp 10: lowered from 10.0 (brief stop line is 7 GiB free on /System/Volumes/Data)
HARD_FREE_GIB = 5.0         # abort setup below this (DESIGN §4.2 step 1)
MAX_EVAL_GIB = 8.0          # ~/ab-eval size cap; exp 15: 18 task snapshots (clones, so real disk is lower), disk floor still applies
QUOTA_CEILING = 0.85        # refuse a batch above this seven_day utilisation (DESIGN §4.5)
AGENT_DEFS = ("gsd-executor", "gsd-planner", "gsd-plan-checker", "gsd-verifier")
ROOTS = (  # mirror of harness-deny.py ROOTS; used by the transcript contamination scan
    "igaming-platform", "get-shit-done", ".claude/projects",
    "ab-eval/tasks", "ab-eval/judge", "ab-eval/results", "ab-eval/variants",
)
TOOLS_WITH_PATHS = ("Bash", "Read", "Edit", "Write", "Glob", "Grep")


def deny_hook():
    """The PreToolUse deny hook as a module: its path/command scrubbing is the single definition the transcript
    contamination scan reuses."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("harness_deny_hook", Path(__file__).resolve().parent / "hooks" / "harness-deny.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Refused(RuntimeError):
    """A guard stopped the command before it did any work (budget, disk, calibration)."""


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def load_tasks(path: Optional[Path] = None) -> Dict[str, Any]:
    cfg = json.loads((path or AB_HOME / "tasks.json").read_text())
    if path is None:  # exp 15: task sets kept in their own files, one writer each
        for frag in sorted((Path(__file__).parent / "examples" / "tasks.d").glob("*.json")):
            cfg["tasks"].extend(json.loads(frag.read_text()))
    return cfg


def find_task(cfg: Dict[str, Any], task_id: str) -> Dict[str, Any]:
    for t in cfg["tasks"]:
        if t["id"] == task_id:
            return t
    raise Refused(f"unknown task {task_id}; add it to tasks.json")


def task_dir(task_id: str) -> Path:
    return AB_HOME / "tasks" / task_id


def variant_dir(variant: str) -> Path:
    return AB_HOME / "variants" / variant


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()]


def append_jsonl(path: Path, row: Dict[str, Any]) -> None:
    """Append one row; flock keeps parallel runs from interleaving lines."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def entry_sha256(entry: Any) -> str:
    """Hash of one agents.json entry in canonical form (detects hand edits of agents.json)."""
    return sha256_bytes(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode())


SOURCE_DRIFT_OK = False  # exp 10: arm W reuses the frozen agents.json entry; the installed def may have moved on


def verify_sources(variant: str, names: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """Refuse when a variant's agents.json is stale (DESIGN §3.1 rule 3: any later edit is a new variant).

    Compares the recorded sha256 of each agent's source file (draft in the gsd repo or installed def) with the file
    now, and the recorded entry hash with the entry now in agents.json. `names` limits the check to the agents a run
    will use; None checks every recorded agent. Returns the provenance of the checked agents."""
    vdir = variant_dir(variant)
    src = read_json(vdir / SOURCES_FILE, None)
    if src is None:
        raise Refused(f"variants/{variant}/{SOURCES_FILE} missing: the build predates provenance tracking; rebuild "
                      "(`ab_setup.py variant-from-drafts --variant B --refresh` for B/Q, `record-sources` for A)")
    agents = read_json(vdir / "agents.json", {})
    recorded = src.get("agents", {})
    bad: List[str] = []
    out: Dict[str, Any] = {}
    for name in (list(names) if names is not None else sorted(recorded)):
        rec = recorded.get(name)
        if rec is None:
            if name in agents:
                bad.append(f"{name}: in agents.json but not in {SOURCES_FILE}")
            continue
        path = Path(rec["path"])
        if not path.exists():
            bad.append(f"{name}: source {path} no longer exists")
        elif sha256_file(path) != rec["sha256"] and not SOURCE_DRIFT_OK:
            bad.append(f"{name}: {path} is {sha256_file(path)[:12]}, build recorded {rec['sha256'][:12]}")
        if name not in agents:
            bad.append(f"{name}: missing from agents.json")
        elif entry_sha256(agents[name]) != rec["entry_sha256"]:
            bad.append(f"{name}: agents.json entry differs from the recorded build")
        out[name] = {"sha256": rec["sha256"], "source_commit": src.get("source_commit"), "kind": rec.get("kind")}
    if bad:
        raise Refused(f"variant {variant} is stale or edited ({'; '.join(bad)}); rebuild it: "
                      "`ab_setup.py variant-from-drafts --variant B --refresh` (B/Q) or `record-sources` (A), "
                      "then re-run; results from the old build are superseded")
    return out


def free_gib(path: Path) -> float:
    return shutil.disk_usage(str(path)).free / GIB


def dir_bytes(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            fp = Path(root) / name
            try:  # a concurrent run's temp files (deno coverage) can vanish between listing and stat
                if not fp.is_symlink():
                    total += fp.stat().st_size
            except FileNotFoundError:
                continue
    return total


def check_disk(path: Path, need_gib: float) -> None:
    free = free_gib(path)
    if free < HARD_FREE_GIB:
        raise Refused(f"free disk {free:.1f} GiB < hard floor {HARD_FREE_GIB} GiB; stop and clean up")
    if free < need_gib:
        raise Refused(f"free disk {free:.1f} GiB < required {need_gib} GiB")


def check_eval_cap() -> None:
    used = dir_bytes(AB_HOME) / GIB if AB_HOME.exists() else 0.0
    if used > MAX_EVAL_GIB:
        raise Refused(f"{AB_HOME} is {used:.2f} GiB, over the {MAX_EVAL_GIB} GiB cap; delete old runs/ first")


def git(repo: Path, *args: str, check: bool = True) -> str:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()[:300]}")
    return proc.stdout


def read_json_rev(repo: Path, rev: str, rel: str) -> Any:
    return json.loads(git_bytes_at(repo, rev, rel).decode())


def git_bytes_at(repo: Path, rev: str, rel: str) -> bytes:
    return git_bytes(repo, "show", f"{rev}:{rel}")


def git_bytes(repo: Path, *args: str) -> bytes:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.decode(errors='replace')[:300]}")
    return proc.stdout


def run_cmd(argv: Sequence[str], cwd: Path, timeout: int = 900) -> Tuple[int, str, float]:
    """Run a command without a shell. Returns (rc, combined output, seconds)."""
    t0 = time.time()
    try:
        proc = subprocess.run(list(argv), cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
        out, rc = proc.stdout + proc.stderr, proc.returncode
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or b"").decode(errors="replace") + (exc.stderr or b"").decode(errors="replace")
        rc = 124
    return rc, out, round(time.time() - t0, 1)


def ensure_harness() -> None:
    """Write the run-time harness config (DESIGN S4.3, S4.4): deny hook via --settings, empty MCP config,
    the stub child used by coordinator tasks, and the Charlotte MCP config for charlotte-qa tasks."""
    harness = AB_HOME / "harness"
    harness.mkdir(parents=True, exist_ok=True)
    stub_src = HARNESS_SRC / "stub_child.py"
    if stub_src.exists():
        shutil.copy2(stub_src, harness / "stub_child.py")
    write_json(harness / "charlotte-mcp.json", {"mcpServers": {"charlotte": {
        "command": "node", "args": [str(Path.home() / ".claude-mcp-servers" / "charlotte" / "dist" / "index.js")]}}})
    write_json(harness / "settings.json", {"hooks": {"PreToolUse": [{
        "matcher": "Bash|Read|Edit|Write|Agent",
        "hooks": [{"type": "command", "command": str(HOOKS / "harness-deny.py")}]}]}})
    (harness / "empty-mcp.json").write_text('{"mcpServers":{}}\n')


def clone_tree(src: Path, dst: Path) -> None:
    """APFS copy-on-write clone (DESIGN §4.2 step 7)."""
    if dst.exists():
        shutil.rmtree(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cp", "-cR", str(src), str(dst)], check=True)


def encode_project_dir(cwd: Path) -> Path:
    """Claude Code keys transcripts by the cwd with '/' replaced by '-' (probe S8)."""
    return PROJECTS / str(cwd.resolve()).replace("/", "-")
