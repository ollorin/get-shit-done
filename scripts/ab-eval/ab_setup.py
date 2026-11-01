#!/usr/bin/env python3
"""Build variant, task and oracle snapshots for the A/B eval (DESIGN §3.1, §4.2, §4.6).

  freeze-variant --variant A            variants/A from live HEAD + ~/.claude (read-only)
  record-sources --variant A            write variants/A/sources.json (provenance) without changing agents.json
  variant-from-drafts --variant B       variants/B = A + the gsd2 drafts; --refresh rebuilds only the agent set
  hook --task ID --variant V            reinstall the snapshot pre-commit hook (link check tolerates .planning/)
  base --task ID                        git archive base sha -> tasks/ID/raw (harness overlay, scrub)
  index --task ID                       zg index once on raw (copied to every arm, DESIGN S5)
  variant --task ID --variant V         tasks/ID/pristine-V = raw + variant overlay + scrubbed memory, one commit
  oracle --task ID                      hidden ref tests + ref.diff from the live repo (read-only)
  calibrate --task ID [--repeat 3]      no-LLM check: visible/hidden fail at base, pass at ref (DESIGN S4.6)
  all --task ID --variant V             base, index, variant, oracle, calibrate
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ab_common as C  # noqa: E402
import ab_grade as G  # noqa: E402

ZG_GLOBS = ["apps/api/functions/**", "apps/api/libs/**", "scripts/**", "docs/**"]  # probe S5, 2,125 files
INDEX_PREFIXES = ("apps/api/functions/", "apps/api/libs/", "scripts/", "docs/")
PLANNING_KEEP = ("STATE.md", "ROADMAP.md", "config.json")
PLANNING_DROP = re.compile(r"(SUMMARY|VERIFICATION|REVIEW|VERDICT|PLAN-CHECK)", re.IGNORECASE)
CHECKPOINTS = ("CHECKPOINT.json", "TASK-CHECKPOINT.json", "EXECUTION_LOG.md")
LINK_LINE = "deno task validate:links $CHANGED_DOCS_ABS"
# The planning scrub deletes .planning/ files from every snapshot, so docs that link into .planning/ always fail the
# repo's link check there. Only broken links whose target is under .planning/ are tolerated; any other broken link,
# a heading/anchor failure, an unprocessable file or a validator crash still blocks the commit (the scrub is untouched).
LINK_SNIPPET = """LINK_OUT=$(deno task validate:links $CHANGED_DOCS_ABS 2>&1) && LINK_RC=0 || LINK_RC=$?
echo "$LINK_OUT"
if [ "$LINK_RC" != "0" ]; then
  LINK_ERRS=$(echo "$LINK_OUT" | grep -E ':[0-9]+:[0-9]+ - ' || true)
  LINK_BAD=$(echo "$LINK_ERRS" | grep -v -E 'Broken file link: [^ ]*\.planning/' || true)
  LINK_UNPROC=$(echo "$LINK_OUT" | grep -E 'unprocessable files: [1-9]' || true)
  if [ -z "$LINK_ERRS" ] || [ -n "$LINK_BAD" ] || [ -n "$LINK_UNPROC" ]; then
    exit 1
  fi
  echo "ab-eval: broken links into .planning/ tolerated (scrubbed from this snapshot only)"
fi"""
GSD_FILES = {  # Wave-1 execution_context and references (execute-phase.md:206-240), constant in both arms
    "workflows/execute-plan.md": "execute-plan.md",
    "templates/summary.md": "summary.md",
    "references/checkpoints.md": "checkpoints.md",
    "references/tdd.md": "tdd.md",
    "references/content-firewall.md": "content-firewall.md",
}


def parse_frontmatter(text: str) -> Tuple[Dict[str, str], str, str]:
    """Return (flat frontmatter dict, body, raw frontmatter text). Only `key: value` lines are read."""
    if not text.startswith("---\n"):
        return {}, text, ""
    m = re.search(r"^---[ \t]*$", text[4:], re.MULTILINE)
    if not m:
        raise C.Refused("frontmatter opened but not closed")
    head = text[4:4 + m.start()]
    body = text[4 + m.end():].lstrip("\n")
    fm = {}
    for line in head.splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, body, head


def agent_entry(def_text: str, name: str) -> Dict[str, Any]:
    fm, body, _ = parse_frontmatter(def_text)
    if "description" not in fm:
        raise C.Refused(f"{name}: frontmatter lacks 'description'")
    tools = [t.strip() for t in fm.get("tools", "").split(",") if t.strip()]
    entry: Dict[str, Any] = {"description": fm["description"], "tools": tools, "prompt": body}
    if "model" in fm:  # absent = inherit the spawner's tier (DESIGN S4.3; the Agent call passes model)
        entry["model"] = fm["model"]
    if fm.get("omitClaudeMd", "").lower() == "true":  # PROBES S13
        entry["omitClaudeMd"] = True
    if fm.get("maxTurns", "").isdigit():
        entry["maxTurns"] = int(fm["maxTurns"])
    if fm.get("effort"):
        entry["effort"] = fm["effort"]
    return entry


def cmd_freeze_variant(args: argparse.Namespace) -> None:
    if args.variant != "A":
        raise C.Refused("only variant A is frozen here; B/C are supplied by the drafter (see RUNNER.md)")
    vdir = C.variant_dir("A")
    if (vdir / "MANIFEST.md").exists() and not args.force:
        raise C.Refused("variants/A is already frozen; --force rebuilds it (this changes the control arm)")
    head = C.git(C.LIVE_REPO, "rev-parse", "HEAD").strip()
    if vdir.exists():
        shutil.rmtree(vdir)
    overlay = vdir / "overlay"
    rules = [p for p in C.git(C.LIVE_REPO, "ls-tree", "-r", "--name-only", head, "--", ".claude/rules").splitlines()
             if p.endswith(".md")]
    files: List[Path] = []
    for rel in ["CLAUDE.md"] + rules:
        dest = overlay / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(C.git_bytes(C.LIVE_REPO, "show", f"{head}:{rel}"))
        files.append(dest)
    shutil.copytree(C.MEMORY_SRC, vdir / "memory")
    agents = {}
    agent_hashes = {}
    for name in C.AGENT_DEFS:
        src = C.CLAUDE_AGENTS / f"{name}.md"
        text = src.read_text()
        agents[name] = agent_entry(text, name)
        agent_hashes[name] = C.sha256_file(src)
    C.write_json(vdir / "agents.json", agents)
    lines = [
        "# Variant A (control) — frozen", "",
        f"- live repo HEAD: `{head}` (read with `git show`, never checked out)",
        f"- built: {C.utc_now()}",
        f"- agents.json from installed defs (read-only): {', '.join(C.AGENT_DEFS)}",
        "", "## Overlay (copied into every snapshot)", "", "| file | bytes | scoped | sha256 |", "|---|---|---|---|",
    ]
    for f in files:
        text = f.read_text(errors="replace")
        _fm, _b, fm_head = parse_frontmatter(text)
        scoped = "yes" if "paths:" in fm_head else "no"
        lines.append(f"| {f.relative_to(overlay)} | {f.stat().st_size} | {scoped} | {C.sha256_file(f)} |")
    mem = list((vdir / "memory").rglob("*"))
    mem_files = [m for m in mem if m.is_file()]
    lines += ["", f"## Memory: {len(mem_files)} files, {sum(m.stat().st_size for m in mem_files)} bytes", ""]
    lines += ["## Agent defs (installed, sha256)", ""] + [f"- {n}: {h}" for n, h in agent_hashes.items()]
    lines += ["", "## Expected inherited instruction chars", "",
              f"- CLAUDE.md + unscoped rules + MEMORY.md = `{_expected_inherited(overlay, vdir / 'memory')}`"]
    C.write_json(vdir / "expected.json", {"inherited_chars": _expected_inherited(overlay, vdir / "memory")})
    (vdir / "MANIFEST.md").write_text("\n".join(lines) + "\n")
    record_installed_sources("A")
    print(f"frozen variant A at {head}; {len(files)} overlay files, {len(mem_files)} memory files")


def cmd_freeze_agents(args: argparse.Namespace) -> None:
    """Add every installed agent def missing from variants/<V>/agents.json (children of the coordinator and the
    roles under test). Existing entries are never changed, so the frozen control arm stays byte-identical."""
    vdir = C.variant_dir(args.variant)
    agents = C.read_json(vdir / "agents.json", None)
    if agents is None:
        raise C.Refused(f"variants/{args.variant} is not frozen")
    added = []
    for src in sorted(C.CLAUDE_AGENTS.glob("*.md")):
        name = src.stem
        if name in agents:
            continue
        agents[name] = agent_entry(src.read_text(), name)
        added.append((name, C.sha256_file(src)))
    C.write_json(vdir / "agents.json", agents)
    manifest = vdir / "MANIFEST.md"
    with open(manifest, "a") as fh:
        fh.write(f"\n## Agent defs added by freeze-agents ({C.utc_now()}, installed defs, sha256)\n\n")
        fh.writelines(f"- {n}: {h}\n" for n, h in added)
    record_installed_sources(args.variant)
    print(f"variant {args.variant}: {len(added)} agent defs added, {len(agents)} total")


DRAFT_ROLES = {  # draft agent -> the registry role it replaces in the B arm
    "gsd2-runner": "runner", "gsd2-docs-updater": "docs-updater", "gsd2-phase-coordinator": "coordinator",
    "gsd2-executor": "executor", "gsd2-planner": "planner", "gsd2-plan-checker": "plancheck",
    "gsd2-verifier": "verifier", "gsd2-reviewer": "review", "gsd2-test-writer": "test-writer",
    "gsd2-debugger": "debugger",
}
# DESIGN §3.1 rule 2: B must not replace the general-purpose reviewer with a new def. These drafts exist only in the
# Q/C arms (`--include-q-only`) and are evaluated as their own role there.
Q_ONLY_DRAFTS = {"gsd2-reviewer"}


def source_state(repo: Path, paths: Sequence[Path]) -> Tuple[str, List[str]]:
    """(HEAD sha, repo-relative paths whose bytes differ from HEAD) for files inside repo."""
    head = C.git(repo, "rev-parse", "HEAD").strip()
    dirty: List[str] = []
    for path in paths:
        try:
            rel = str(path.resolve().relative_to(repo.resolve()))
        except ValueError:
            continue  # a drafts dir outside the repo (tests) has no HEAD to compare with
        try:
            committed = C.git_bytes(repo, "show", f"{head}:{rel}")
        except RuntimeError:
            dirty.append(rel)
            continue
        if committed != path.read_bytes():
            dirty.append(rel)
    return head, dirty


def write_sources(variant: str, drafts: Dict[str, Path], extra: Dict[str, Any]) -> Dict[str, Any]:
    """variants/<V>/sources.json: for every agents.json entry the source file and its sha256, the entry hash, and the
    source repo commit. `ab_common.verify_sources` compares these with the files now (stale-build detection).
    Entries without a draft must equal the installed def (the control arm's definition)."""
    vdir = C.variant_dir(variant)
    agents = C.read_json(vdir / "agents.json", {})
    rows: Dict[str, Any] = {}
    drift: List[str] = []
    for name, entry in sorted(agents.items()):
        if name in drafts:
            path, kind = drafts[name], "draft"
        else:
            path, kind = C.CLAUDE_AGENTS / f"{name}.md", "installed"
            if not path.exists() or agent_entry(path.read_text(), name) != entry:
                drift.append(name)
                continue
        rows[name] = {"kind": kind, "path": str(path), "sha256": C.sha256_file(path),
                      "entry_sha256": C.entry_sha256(entry)}
    if drift:
        raise C.Refused(f"variant {variant}: agents.json differs from the installed defs for {drift}; the control "
                        "arm drifted. Re-freeze A with --force only if the control is meant to change")
    head, dirty = source_state(C.GSD_REPO, [p for p in drafts.values()])
    doc = {"variant": variant, "built": C.utc_now(), "source_repo": str(C.GSD_REPO), "source_commit": head,
           "dirty_sources": dirty, "agents": rows, **extra}
    C.write_json(vdir / C.SOURCES_FILE, doc)
    return doc


def record_installed_sources(variant: str) -> Dict[str, Any]:
    return write_sources(variant, {}, {"drafts_dir": None})


def cmd_record_sources(args: argparse.Namespace) -> None:
    if not (C.variant_dir(args.variant) / "agents.json").exists():
        raise C.Refused(f"variants/{args.variant} is not frozen")
    doc = record_installed_sources(args.variant)
    print(f"variant {args.variant}: sources.json for {len(doc['agents'])} agents at {doc['source_commit'][:12]}")


def cmd_variant_from_drafts(args: argparse.Namespace) -> None:
    """Variant B (or Q): variants/<V> = a copy of variants/<FROM> (identical overlay and memory) whose agents.json is
    the source variant's agents plus the drafts in agents/v2 as extra `gsd2-*` agents, roles.json mapping role ->
    draft, and sources.json recording the drafts' repo commit and file hashes. `--refresh` rebuilds only those three
    files of an existing variant; `--force` rebuilds the directory. Dirty drafts (differing from HEAD) are refused
    unless `--allow-dirty`."""
    src, dst = C.variant_dir(args.base_variant), C.variant_dir(args.variant)
    if not (src / "agents.json").exists():
        raise C.Refused(f"variants/{args.base_variant} is not frozen")
    agents = dict(C.read_json(src / "agents.json", {}))
    roles: Dict[str, str] = {}
    drafts: Dict[str, Path] = {}
    for name, role in sorted(DRAFT_ROLES.items()):
        if name in Q_ONLY_DRAFTS and not args.include_q_only:
            continue
        draft = Path(args.drafts) / f"{name}{args.suffix}.md"
        if not draft.exists():
            draft = Path(args.drafts) / f"{name}.md"  # a suffix arm falls back to the base draft
        if not draft.exists():
            continue
        agents[name] = agent_entry(draft.read_text(), name)  # the arm always calls the agent by its base name
        drafts[name] = draft
        roles[role] = name
    _head, dirty = source_state(C.GSD_REPO, list(drafts.values()))
    if dirty and not args.allow_dirty:
        raise C.Refused(f"drafts differ from {C.GSD_REPO} HEAD: {dirty}; commit them or pass --allow-dirty")
    if dst.exists():
        if args.force:
            shutil.rmtree(dst)
        elif not args.refresh:
            raise C.Refused(f"variants/{args.variant} exists; --refresh rebuilds its agent set, --force the directory")
    if not dst.exists():
        shutil.copytree(src, dst)
    C.write_json(dst / "agents.json", agents)
    C.write_json(dst / "roles.json", roles)
    doc = write_sources(args.variant, drafts, {"base_variant": args.base_variant, "suffix": args.suffix,
                                               "include_q_only": bool(args.include_q_only),
                                               "drafts_dir": str(args.drafts)})
    manifest = dst / "MANIFEST.md"
    text = manifest.read_text() if manifest.exists() else ""
    marker = f"\n## Variant {args.variant}:"
    if marker in text:
        text = text[:text.index(marker)]
    lines = [f"- {n} <- {drafts[n].name}: {doc['agents'][n]['sha256']}" for n in sorted(drafts)]
    manifest.write_text(text.rstrip("\n") + "\n" + f"\n## Variant {args.variant}: copy of {args.base_variant} plus "
                        f"drafts ({doc['built']})\n\nOverlay, memory and the existing agent defs are identical to the "
                        f"source variant. Drafts read from `{C.GSD_REPO}` at commit `{doc['source_commit']}`"
                        f"{' (dirty: ' + ', '.join(dirty) + ')' if dirty else ''}; provenance and hashes in "
                        f"`{C.SOURCES_FILE}` (runs refuse when a source file changes).\n\n"
                        + "\n".join(lines) + f"\n\nroles.json: {json.dumps(roles)}\n")
    print(f"variant {args.variant} from drafts at {doc['source_commit'][:12]}: roles {roles}")


def _expected_inherited(overlay: Path, memory: Path) -> int:
    """CLAUDE.md + unscoped rules, as the instructions attachments measure them (G1; memory is checked by path)."""
    total = len((overlay / "CLAUDE.md").read_text(errors="replace"))
    for f in (overlay / ".claude" / "rules").glob("*.md"):
        text = f.read_text(errors="replace")
        if "paths:" not in parse_frontmatter(text)[2]:
            total += len(text)
    return total


def extract_rev_paths(repo: Path, rev: str, paths: List[str], dest: Path) -> None:
    """Extract `git archive rev -- paths` into dest (tar on the command line; no shell)."""
    data = C.git_bytes(repo, "archive", "--format=tar", rev, "--", *paths)
    tar = dest / ".extract.tar"
    dest.mkdir(parents=True, exist_ok=True)
    tar.write_bytes(data)
    subprocess.run(["tar", "-x", "-f", str(tar), "-C", str(dest)], check=True)
    tar.unlink()


def scrub_planning(raw: Path, phase_dir: str, target_plan: str, keep: Sequence[str] = ()) -> None:
    """Keep base-era state and the phase's context; drop other PLAN files (later plans describe the
    future design), checkpoints, and any post-plan artifacts. The target plan itself stays, and so does
    every phase-dir file matching a `keep` glob (a task's `planning_keep`)."""
    pdir = raw / ".planning"
    if not pdir.exists():
        return
    phase_name = Path(phase_dir).name
    target_name = Path(target_plan).name
    for child in list(pdir.iterdir()):
        if child.name in PLANNING_KEEP:
            continue
        if child.name == "phases" and child.is_dir():
            for ph in list(child.iterdir()):
                if ph.name == phase_name:
                    for f in list(ph.iterdir()):
                        is_other_plan = f.name.endswith("-PLAN.md") and f.name != target_name
                        kept = any(fnmatch.fnmatch(f.name, g) for g in keep)
                        if f.is_file() and not kept and (PLANNING_DROP.search(f.name) or is_other_plan
                                                         or f.name in CHECKPOINTS):
                            f.unlink()
                elif ph.is_dir():
                    shutil.rmtree(ph)
                else:
                    ph.unlink()
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def apply_patch(raw: Path, patch: Path) -> None:
    proc = subprocess.run(["git", "apply", "--whitespace=nowarn", str(patch)], cwd=str(raw),
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise C.Refused(f"patch {patch.name} does not apply to the base tree: {proc.stderr.strip()[:300]}")


def apply_task_inputs(t: Dict[str, Any], raw: Path) -> None:
    """Task-specific snapshot content, applied after the planning scrub (ab_roles/README: task schema):
    restore (paths re-extracted from base or a named rev), overlay (examples/artifacts/<dir> copied onto the tree),
    patches (planted defects), fixture (seeded qa app), review_diff (`.review/change.diff` for reviewers)."""
    for item in t.get("restore", []):
        rev, path = (item["rev"], item["path"]) if isinstance(item, dict) else (t["base"], item)
        try:
            extract_rev_paths(C.LIVE_REPO, rev, [path], raw)
        except subprocess.CalledProcessError as exc:
            raise C.Refused(f"restore {path}@{rev} failed: {exc}") from exc
        except RuntimeError as exc:
            raise C.Refused(f"restore {path}@{rev} failed: {exc}") from exc
    for name in t.get("overlay", []):
        src = C.ARTIFACTS / name
        if not src.is_dir():
            raise C.Refused(f"overlay dir {src} does not exist")
        shutil.copytree(src, raw, dirs_exist_ok=True)
    for name in t.get("patches", []):
        apply_patch(raw, C.ARTIFACTS / name)
    if t.get("fixture"):
        dest = raw / "qa-fixture" / "qa-app"
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(C.FIXTURES / t["fixture"], dest)
    if t.get("review_diff"):
        target = t["base"]
        specs = list(t.get("scope_files", []))
        diff = C.git(C.LIVE_REPO, "diff", f"{target}^", target, "--", *specs) if specs \
            else C.git(C.LIVE_REPO, "diff", f"{target}^", target, "--", ".", ":(exclude).planning")
        (raw / ".review").mkdir(exist_ok=True)
        (raw / ".review" / "change.diff").write_text(diff)


def cmd_base(args: argparse.Namespace, cfg: Dict[str, Any]) -> None:
    t = C.find_task(cfg, args.task)
    tdir = C.task_dir(t["id"])
    raw = tdir / "raw"
    C.check_disk(C.AB_HOME, need_gib=2.0)
    if raw.exists():
        if not args.force:
            raise C.Refused(f"{raw} exists; --force rebuilds the base tree")
        shutil.rmtree(raw)
    raw.mkdir(parents=True)
    head = C.git(C.LIVE_REPO, "rev-parse", "HEAD").strip()
    (tdir / "head.txt").write_text(head + "\n")
    extract_rev_paths(C.LIVE_REPO, t["base"], ["."], raw)
    # constant harness overlay (both arms, DESIGN S4.2 step 3); hooks are stripped (PROBES S6)
    for rel in (".claude/hooks", ".claude/skills"):
        if (raw / rel).exists():
            shutil.rmtree(raw / rel)
        extract_rev_paths(C.LIVE_REPO, head, [rel], raw)
    settings = C.read_json_rev(C.LIVE_REPO, head, ".claude/settings.json")
    settings.pop("hooks", None)
    C.write_json(raw / ".claude" / "settings.json", settings)
    (raw / ".claude" / "settings.local.json").unlink(missing_ok=True)
    env_src = C.LIVE_REPO / "apps" / "api" / ".env.test"
    if env_src.exists():
        shutil.copy2(env_src, raw / "apps" / "api" / ".env.test")
    (tdir / "pre-commit").write_bytes(C.git_bytes(C.LIVE_REPO, "show", f"{head}:scripts/hooks/pre-commit"))
    gsd = raw / ".gsd-eval"
    gsd.mkdir()
    for src_rel, name in GSD_FILES.items():
        shutil.copy2(C.GSD_HOME / src_rel, gsd / name)
    shutil.copytree(C.FIXTURES / "qa-app", raw / "qa-fixture" / "qa-app")
    shutil.rmtree(raw / "apps" / "mobile", ignore_errors=True)
    if t.get("scrub") != "none":
        scrub_planning(raw, t["phase_dir"], t["plan"], t.get("planning_keep", []))
    apply_task_inputs(t, raw)
    print(f"base {t['base']} -> {raw} ({C.dir_bytes(raw) // 1048576} MiB)")


def cmd_index(args: argparse.Namespace, cfg: Dict[str, Any]) -> None:
    raw = C.task_dir(args.task) / "raw"
    if not raw.exists():
        raise C.Refused("run `base` first")
    shutil.rmtree(raw / ".zvec-grep", ignore_errors=True)
    argv = ["zg", "index", str(raw)]
    for g in ZG_GLOBS:
        argv += ["-g", g]
    rc, out, secs = C.run_cmd(argv, raw, timeout=1800)
    (C.task_dir(args.task) / "index.log").write_text(out)
    if rc != 0:
        raise C.Refused(f"zg index failed rc={rc}: {out.strip()[-300:]}")
    print(f"zg index ok in {secs}s")


def scrub_memory(src: Path, dst: Path, terms: List[str]) -> Dict[str, Any]:
    """Copy memory without topic files that name a task identifier (DESIGN §8 scrub, 5c)."""
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    lowered = [t.lower() for t in terms]
    removed: List[str] = []
    lines_removed = 0
    for f in sorted(p for p in src.rglob("*") if p.is_file()):
        rel = f.relative_to(src)
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if f.name == "MEMORY.md":
            kept = []
            for line in f.read_text(errors="replace").splitlines(keepends=True):
                if any(term in line.lower() for term in lowered):
                    lines_removed += 1
                else:
                    kept.append(line)
            target.write_text("".join(kept))
            continue
        data = f.read_bytes()
        if any(term in data.decode(errors="replace").lower() for term in lowered):
            removed.append(str(rel))
            continue
        target.write_bytes(data)
    return {"removed_files": removed, "memory_md_lines_removed": lines_removed}


def overlay_files(overlay: Path) -> List[Path]:
    return sorted(p for p in overlay.rglob("*") if p.is_file())


def snapshot_precommit(text: str) -> str:
    """The live repo's pre-commit hook with the link step relaxed for .planning/ targets (see LINK_SNIPPET)."""
    if text.count(LINK_LINE) != 1:
        raise C.Refused(f"live pre-commit hook has {text.count(LINK_LINE)} occurrences of {LINK_LINE!r}; "
                        "update ab_setup.LINK_LINE before building snapshots")
    return text.replace(LINK_LINE, LINK_SNIPPET)


def install_hook(pristine: Path, raw_hook: Path) -> None:
    hook = pristine / ".git" / "hooks" / "pre-commit"
    hook.write_text(snapshot_precommit(raw_hook.read_text()))
    hook.chmod(0o755)


def cmd_hook(args: argparse.Namespace, cfg: Dict[str, Any]) -> None:
    t = C.find_task(cfg, args.task)
    tdir = C.task_dir(t["id"])
    pristine = tdir / f"pristine-{args.variant}"
    if not (pristine / ".git").exists():
        raise C.Refused(f"{pristine} has no snapshot repo")
    install_hook(pristine, tdir / "pre-commit")
    print(f"pre-commit hook reinstalled in {pristine}")


def cmd_variant(args: argparse.Namespace, cfg: Dict[str, Any]) -> None:
    t = C.find_task(cfg, args.task)
    tdir = C.task_dir(t["id"])
    raw = tdir / "raw"
    vdir = C.variant_dir(args.variant)
    for need in (raw / ".zvec-grep", vdir / "overlay", vdir / "memory", vdir / "agents.json", vdir / "MANIFEST.md"):
        if not need.exists():
            raise C.Refused(f"missing {need}; run base/index first, and freeze or supply variant {args.variant}")
    pristine = tdir / f"pristine-{args.variant}"
    C.clone_tree(raw, pristine)
    touched_index = False
    rules_src = vdir / "overlay" / ".claude" / "rules"
    if rules_src.exists():
        shutil.rmtree(pristine / ".claude" / "rules", ignore_errors=True)
    for src in overlay_files(vdir / "overlay"):
        rel = src.relative_to(vdir / "overlay")
        touched_index = touched_index or str(rel).startswith(INDEX_PREFIXES)
        (pristine / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, pristine / rel)
    if touched_index:  # DESIGN S5 copies the index; re-index only when the overlay changes indexed paths
        shutil.rmtree(pristine / ".zvec-grep", ignore_errors=True)
        rc, out, _ = C.run_cmd(["zg", "index", str(pristine)] + sum([["-g", g] for g in ZG_GLOBS], []), pristine, 1800)
        if rc != 0:
            raise C.Refused(f"re-index of variant {args.variant} failed: {out[-300:]}")
    scrub = scrub_memory(vdir / "memory", tdir / f"memory-{args.variant}", t.get("scrub_terms", []))
    C.write_json(tdir / f"scrub-{args.variant}.json", scrub)
    shutil.rmtree(pristine / ".git", ignore_errors=True)
    C.git(pristine, "init", "-q")
    exclude = pristine / ".git" / "info" / "exclude"
    exclude.write_text(exclude.read_text() + ".zvec-grep/\n.claude/settings.local.json\n")
    C.git(pristine, "add", "-A")
    C.git(pristine, "-c", "user.name=ab-eval", "-c", "user.email=ab-eval@localhost",
          "commit", "-q", "-m", f"base {t['base']}")
    base_commit = C.git(pristine, "rev-parse", "HEAD").strip()
    install_hook(pristine, tdir / "pre-commit")
    C.write_json(tdir / f"pristine-{args.variant}.json",
                 {"base_commit": base_commit, "variant": args.variant, "built": C.utc_now(),
                  "reindexed": touched_index, "memory_scrub": scrub})
    print(f"pristine-{args.variant} commit {base_commit[:12]}; memory removed {len(scrub['removed_files'])} "
          f"files, {scrub['memory_md_lines_removed']} index lines")


def ref_diff_text(t: Dict[str, Any], ref_sha: str, specs: List[str]) -> str:
    """Reference diff shown to judges. With `ref_overlay` it is the authored solution: base file vs overlay file."""
    name = t.get("ref_overlay")
    if not name:
        return C.git(C.LIVE_REPO, "diff", t["base"], ref_sha, "--", *specs)
    import difflib
    out = []
    root = C.ARTIFACTS / name
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = str(f.relative_to(root))
        proc = subprocess.run(["git", "show", f"{t['base']}:{rel}"], cwd=str(C.LIVE_REPO), capture_output=True, text=True)
        old = proc.stdout.splitlines(keepends=True) if proc.returncode == 0 else []
        out += list(difflib.unified_diff(old, f.read_text().splitlines(keepends=True), f"a/{rel}", f"b/{rel}"))
    return "".join(out)


def cmd_oracle(args: argparse.Namespace, cfg: Dict[str, Any]) -> None:
    t = C.find_task(cfg, args.task)
    odir = C.task_dir(t["id"]) / "oracle"
    hidden_dir = odir / "hidden"
    if hidden_dir.exists():
        shutil.rmtree(hidden_dir)
    hidden_dir.mkdir(parents=True)
    entries = []
    for i, spec in enumerate(t.get("hidden", [])):
        path, sha = spec.rsplit("@", 1)
        C.git(C.LIVE_REPO, "cat-file", "-e", sha)
        src_name = f"{i:02d}-{Path(path).name}"
        (hidden_dir / src_name).write_bytes(C.git_bytes(C.LIVE_REPO, "show", f"{sha}:{path}"))
        entries.append({"dest": path, "src": src_name, "sha": sha})
    C.write_json(odir / "hidden.json", entries)
    known = [{k: v for k, v in item.items() if k != "evidence"} for item in t.get("known", [])]
    if known:
        C.write_json(odir / "known.json", known)
    C.git(C.LIVE_REPO, "cat-file", "-e", t["base"])
    if t.get("ref"):
        ref_sha = t["ref"][-1]
        C.git(C.LIVE_REPO, "cat-file", "-e", ref_sha)
        specs = t["scope_files"] or ["."]
        (odir / "ref.diff").write_text(ref_diff_text(t, ref_sha, specs))
    print(f"oracle: {len(entries)} hidden files, {len(known)} known items")


def cmd_calibrate(args: argparse.Namespace, cfg: Dict[str, Any]) -> None:
    import ab_calib as K  # local import: ab_calib imports this module's helpers
    t = C.find_task(cfg, args.task)
    tdir = C.task_dir(t["id"])
    result = K.calibrate(t, tdir, args.repeat)
    C.write_json(tdir / "calib.json", result)
    print(f"calibration {'PASS' if result['ok'] else 'FAIL'} (mode {result['mode']}): "
          + "; ".join(f"{c['name']}={'ok' if c['ok'] else 'FAIL'}" for c in result["checks"]))
    if not result["ok"]:
        raise C.Refused("calibration failed; the oracle is not valid, replace the task or disable it (DESIGN S4.6)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    fv = sub.add_parser("freeze-variant")
    fv.add_argument("--variant", required=True)
    fv.add_argument("--force", action="store_true")
    for name in ("base", "index", "oracle"):
        s = sub.add_parser(name)
        s.add_argument("--task", required=True)
        s.add_argument("--force", action="store_true")
    fa = sub.add_parser("freeze-agents")
    fa.add_argument("--variant", default="A")
    vd = sub.add_parser("variant-from-drafts")
    vd.add_argument("--variant", required=True)
    vd.add_argument("--base-variant", default="A")
    vd.add_argument("--drafts", default=str(C.V2_DRAFTS))
    vd.add_argument("--suffix", default="", help="'.c' selects the quality-arm drafts (gsd2-<name>.c.md)")
    vd.add_argument("--include-q-only", action="store_true", help="add Q-only drafts (gsd2-reviewer); never for B")
    vd.add_argument("--allow-dirty", action="store_true", help="build from drafts that differ from the repo HEAD")
    vd.add_argument("--refresh", action="store_true", help="rebuild agents.json, roles.json, sources.json only")
    vd.add_argument("--force", action="store_true")
    rs = sub.add_parser("record-sources")
    rs.add_argument("--variant", default="A")
    hk = sub.add_parser("hook")
    hk.add_argument("--task", required=True)
    hk.add_argument("--variant", required=True)
    v = sub.add_parser("variant")
    v.add_argument("--task", required=True)
    v.add_argument("--variant", required=True)
    cal = sub.add_parser("calibrate")
    cal.add_argument("--task", required=True)
    cal.add_argument("--repeat", type=int, default=3)
    al = sub.add_parser("all")
    al.add_argument("--task", required=True)
    al.add_argument("--variant", default="A")
    return p


def main(argv: List[str]) -> int:
    args = build_parser().parse_args(argv)
    cfg = C.load_tasks()
    if args.cmd == "freeze-variant":
        cmd_freeze_variant(args)
    elif args.cmd == "freeze-agents":
        cmd_freeze_agents(args)
    elif args.cmd == "variant-from-drafts":
        cmd_variant_from_drafts(args)
    elif args.cmd == "record-sources":
        cmd_record_sources(args)
    elif args.cmd == "hook":
        cmd_hook(args, cfg)
    elif args.cmd == "base":
        cmd_base(args, cfg)
    elif args.cmd == "index":
        cmd_index(args, cfg)
    elif args.cmd == "variant":
        cmd_variant(args, cfg)
    elif args.cmd == "oracle":
        cmd_oracle(args, cfg)
    elif args.cmd == "calibrate":
        cmd_calibrate(args, cfg)
    elif args.cmd == "all":
        for step in (["base", "--task", args.task], ["index", "--task", args.task],
                     ["variant", "--task", args.task, "--variant", args.variant],
                     ["oracle", "--task", args.task], ["calibrate", "--task", args.task]):
            main(step)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except C.Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(2)
