#!/usr/bin/env python3
"""Exp 15: variants for the arms, and one snapshot per task shared by all arms through symlinks."""
import argparse
import hashlib
import json
import shutil
import subprocess

import ab_common as C
import ab_setup as S

ARMS = {  # variant -> (test-writer draft suffix, reviewer draft suffix)
    "K": ("k", None), "E2": ("e2", None), "V": (None, "v"), "S": ("s", "s"),
    "P": ("p", "p"), "Q2": (None, "r2"), "A2": (None, None),
}
LINKS = ("pristine-{}", "pristine-{}.json", "memory-{}", "scrub-{}.json")


def tree_hash(root):
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        h.update(str(p.relative_to(root)).encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def build_variant(name, tw, rv):
    src, dst = C.variant_dir("A"), C.variant_dir(name)
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    agents = C.read_json(src / "agents.json", {})
    for n in ("gsd-debugger", "gsd-phase-coordinator"):  # moved since the freeze, unused by the two roles
        agents[n] = S.agent_entry((C.CLAUDE_AGENTS / f"{n}.md").read_text(), n)
    drafts, roles = {}, {}
    for draft, suffix, role in (("gsd2-test-writer", tw, "test-writer"), ("gsd2-reviewer", rv, "review")):
        if suffix:
            path = C.V2_DRAFTS / f"{draft}.{suffix}.md"
            agents[draft] = S.agent_entry(path.read_text(), draft)
            drafts[draft], roles[role] = path, draft
    C.write_json(dst / "agents.json", agents)
    C.write_json(dst / "roles.json", roles)
    S.write_sources(name, drafts, {"base_variant": "A", "drafts_dir": str(C.V2_DRAFTS), "note": "exp 15 arm"})


def check_arms():
    """Arms may differ only in the agent set: overlay and memory hash equal to A, or refuse."""
    want = {d: tree_hash(C.variant_dir("A") / d) for d in ("overlay", "memory")}
    for name in ARMS:
        for d, h in want.items():
            if tree_hash(C.variant_dir(name) / d) != h:
                raise C.Refused(f"variant {name}: {d} differs from A")
    a = C.read_json(C.variant_dir("A") / "agents.json", {})
    for name, (tw, rv) in ARMS.items():
        v = C.read_json(C.variant_dir(name) / "agents.json", {})
        for key in ("gsd-test-writer", "gsd-executor", "gsd-planner", "gsd-verifier"):
            if a[key] != v[key]:
                raise C.Refused(f"variant {name}: {key} differs from A")


def build_task(task_id):
    tdir = C.task_dir(task_id)
    pristine = tdir / "pristine-A"
    if not pristine.exists() or pristine.is_symlink():
        for cmd in ("base", "index"):
            subprocess.run(["python3", "ab_setup.py", cmd, "--task", task_id], check=True, capture_output=True)
        subprocess.run(["python3", "ab_setup.py", "variant", "--task", task_id, "--variant", "A"],
                       check=True, capture_output=True)
        shutil.rmtree(tdir / "raw", ignore_errors=True)
    for name in ARMS:
        for pat in LINKS:
            link, target = tdir / pat.format(name), tdir / pat.format("A")
            if link.is_symlink() or link.is_file():
                link.unlink()
            elif link.exists():
                shutil.rmtree(link)
            link.symlink_to(target.name)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--tasks", nargs="*", default=[])
    a.add_argument("--variants", action="store_true")
    o = a.parse_args()
    if o.variants:
        for name, (tw, rv) in ARMS.items():
            build_variant(name, tw, rv)
        check_arms()
        print("variants ok", sorted(ARMS))
    for t in o.tasks:
        build_task(t)
        print(t, "snapshot ok", C.git(C.task_dir(t) / "pristine-A", "rev-parse", "--short", "HEAD").strip(), flush=True)


if __name__ == "__main__":
    main()
