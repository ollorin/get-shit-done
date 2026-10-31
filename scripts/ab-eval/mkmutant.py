#!/usr/bin/env python3
"""Write a one-hunk mutant patch: mkmutant.py <rev> <path> <out.patch> <old> <new>  (old must occur exactly once in <path>@<rev>)."""
import difflib
import subprocess
import sys
from pathlib import Path

REPO = Path.home() / "igaming-platform"


def main(rev: str, path: str, out: str, old: str, new: str) -> int:
    text = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=REPO, capture_output=True, text=True, check=True).stdout
    if text.count(old) != 1:
        print(f"old occurs {text.count(old)} times", file=sys.stderr)
        return 1
    diff = difflib.unified_diff(text.splitlines(keepends=True), text.replace(old, new).splitlines(keepends=True),
                                f"a/{path}", f"b/{path}", n=3)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text("".join(diff))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:6]))
