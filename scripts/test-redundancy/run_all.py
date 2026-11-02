#!/usr/bin/env python3
"""In-file mutation matrix over every co-located unit pair. One process, resumable, stops on low disk.
usage: run_all.py --root <worktree> --out <dir> [--list] [--min-free-gib 7] [--timeout 1800]"""
import argparse, json, os, re, shutil, subprocess, sys, time

# Excluded: anything that may reach the shared stack; this run stays off it.
STACK = re.compile(r"createClient\(|SUPABASE_(URL|SERVICE)|localhost:|127\.0\.0\.1|supabase/functions|fetch\(\s*[`\"']http")


def pairs(root):
    out = []
    for base in ("apps/api/libs", "apps/api/functions"):
        for d, dirs, files in os.walk(os.path.join(root, base)):
            dirs[:] = [x for x in dirs if x not in ("node_modules", "fixtures", "__fixtures__")]
            for f in files:
                if not f.endswith(".test.ts") or f.endswith(".integration.test.ts"):
                    continue
                src = os.path.join(d, f[: -len(".test.ts")] + ".ts")
                test = os.path.join(d, f)
                if os.path.exists(src):
                    if STACK.search(open(test, errors="ignore").read()):
                        continue
                    out.append((os.path.relpath(src, root), os.path.relpath(test, root)))
    return sorted(out)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--root", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--list", action="store_true")
    a.add_argument("--min-free-gib", type=float, default=7)
    a.add_argument("--timeout", type=int, default=1800)
    a.add_argument("--reverse", action="store_true", help="walk from the end; a second process in its own worktree shares --out")
    o = a.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    ps = pairs(o.root)
    if o.list:
        print(len(ps))
        return 0
    os.makedirs(o.out, exist_ok=True)
    log = open(os.path.join(o.out, "progress.tsv"), "a", buffering=1)
    done = 0
    for src, test in reversed(ps) if o.reverse else ps:
        label = src.replace("/", "__")[:-3]
        out = os.path.join(o.out, label)
        if os.path.exists(os.path.join(out, "summary.json")) or os.path.exists(out + ".failed"):
            done += 1
            continue
        free = shutil.disk_usage("/System/Volumes/Data").free / 2**30
        if free < o.min_free_gib:
            log.write(f"STOP\tdisk {free:.1f} GiB\n")
            return 3
        t0 = time.time()
        try:
            r = subprocess.run(["deno", "run", "--allow-read", "--allow-write", "--allow-run", os.path.join(here, "run.ts"),
                                "--root", o.root, "--source", src, "--test", test, "--out", out, "--cross", "0"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=o.timeout, cwd=here, text=True)
            status = "ok" if r.returncode == 0 else f"rc{r.returncode}"
            err = "" if r.returncode == 0 else (r.stderr or "")[-300:].replace("\n", " ")
        except subprocess.TimeoutExpired:
            status, err = "timeout", ""
        subprocess.run(["git", "-C", o.root, "checkout", "-q", "--", "."])
        if status != "ok":
            open(out + ".failed", "w").write(status + " " + err)
        done += 1
        log.write(f"{time.strftime('%H:%M:%S')}\t{status}\t{int(time.time()-t0)}s\t{done}/{len(ps)}\t{src}\n")
    log.write("DONE\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
