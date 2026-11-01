#!/usr/bin/env python3
"""PreToolUse deny hook for A/B eval runs (DESIGN §4.4). Reads hook JSON on stdin.

Traversal is judged by where a path resolves, not by its spelling: `cd apps/api && ... > ../../.tmp/x`
resolves inside the run's snapshot repo and is allowed; anything resolving outside it is denied. Two literal-text
cases are not traversal: a heredoc body (`cat >> docs/x.md <<'EOF'` with `../` links in the text) and the run's own
Claude project dir (`~/.claude/projects/<encoded run repo>/`, where the tool-result overflow files of this run live).
"""
import json
import os
import re
import sys
import time

HOME = os.path.expanduser("~")
ROOTS = [
    "igaming-platform", "get-shit-done", ".claude/projects",
    "ab-eval/tasks", "ab-eval/judge", "ab-eval/results", "ab-eval/variants", "ab-eval/harness/harness-deny",
    "stream.jsonl", "harness-denials",
]
# tool names count as the stack only as words of their own: `ls supabase/migrations` or `docs/docker.md` is a path
STACK = re.compile(r"((?<![\w/.\-])(?:supabase|docker|orbctl|colima|psql)(?![\w/])|db reset|functions serve|nx start|run-integration-tests|test:integration|preflight|stack-lock|:5432[0-9]|integration\.test\.ts)")
NET = re.compile(r"(\bgit push\b|\bgh |\bcurl\b|\bwget\b)")
DOTDOT = re.compile(r"(^|/)\.\.(/|$)")
SEGMENTS = re.compile(r"&&|\|\||;|\||\n")
TOKEN = re.compile(r"[^\s;|&<>()'\"`]+")
CD = re.compile(r"cd(?:\s+(\S+))?$")
MSG_STACK = "HARNESS-DENY: shared stack commands are unavailable in this eval"
MSG_NET = "HARNESS-DENY: network/remote commands are unavailable in this eval"
MSG_ROOT = "HARNESS-DENY: path outside the run snapshot is off limits; use paths relative to your working directory"
MSG_WRITE = "HARNESS-DENY: writes outside the run directory are not allowed"


HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n.*?\n[ \t]*\2[ \t]*(?=\n|$)", re.S)


DATA_WRITERS = {"cat", "tee"}


def strip_heredocs(cmd):
    """Command with the bodies of `cat`/`tee` heredocs removed: that text is data written to a file (a docs page
    quoting `curl` or `supabase db reset`), not something the shell runs or paths it opens. Bodies fed to an
    interpreter (`bash <<EOF`, `python3 - <<EOF`) stay: they execute."""
    def repl(m):
        head = re.split(r"&&|\|\||;|\|", cmd[:m.start()])[-1].split("\n")[-1].split()
        return "<<HEREDOC" if head and head[0] in DATA_WRITERS else m.group(0)
    return HEREDOC.sub(repl, cmd)


def own_project(run_dir):
    """The run's own `.claude/projects/<encoded cwd>` marker (Claude keys transcripts by cwd with '/' -> '-')."""
    return ".claude/projects/" + os.path.normpath(os.path.join(run_dir, "repo")).replace("/", "-")


def _scrub_own(text, run_dir):
    return text.replace(own_project(run_dir), "<own-project>")


# The installed GSD reference docs (`~/.claude/get-shit-done/references/*-detail.md`) are what a v2 agent's on-demand
# pointers name, so they are readable; the rest of that tree (bin/, templates) and the live repo stay denied.
INSTALLED_REFS = re.compile(r"(?:~|%s)/\.claude/get-shit-done/references(?:/[\w.\-]*)*" % re.escape(HOME))
MUTATING = re.compile(r">|\btee\b|\brm\b|\bmv\b|\bcp\b|\bln\b|\bchmod\b|\bsed\s+-\w*i")
REDIRECT_NOISE = re.compile(r"\d*>&\d+|\d*>\s*/dev/null")


def scrub_refs(text, mutating=False):
    """Replace read-only mentions of the installed references dir by a marker; a `..` segment or a command that
    writes/removes/copies keeps the path visible to the ROOTS check."""
    if mutating:
        return text
    return INSTALLED_REFS.sub(lambda m: m.group(0) if ".." in m.group(0) else "<installed-refs>", text)


def scrub_for_roots(tool, text, run_dir, code=""):
    """Text the ROOTS check sees: the run's own project dir and (read-only) installed references removed."""
    mutating = tool == "Bash" and bool(MUTATING.search(REDIRECT_NOISE.sub("", code or text)))
    return scrub_refs(_scrub_own(text, run_dir), mutating)


def contamination_scan_text(tool, tool_input):
    """What the transcript scan matches ROOTS against: contamination_text with read-only installed-reference
    mentions removed."""
    text = contamination_text(tool, tool_input)
    return scrub_refs(text, tool == "Bash" and bool(MUTATING.search(REDIRECT_NOISE.sub("", text))))


def contamination_text(tool, tool_input):
    """The part of a tool call that names where it reads or runs: paths and commands, not the content a Write or
    Edit puts into a file (a SUMMARY quoting `/Users/o/igaming-platform` opens nothing). `cat/tee` heredoc bodies are
    data too (strip_heredocs)."""
    g = tool_input.get
    if tool == "Bash":
        return strip_heredocs(g("command", "") or "")
    if tool in ("Read", "Write", "Edit"):
        return " ".join(str(g(k, "") or "") for k in ("file_path", "notebook_path"))
    return " ".join(str(g(k, "") or "") for k in ("path", "pattern", "glob", "file_path"))


def _resolve(base, path):
    return os.path.normpath(path if os.path.isabs(path) else os.path.join(base or os.sep, path))


def _inside(path, root):
    return path == root or path.startswith(root + os.sep)


def _other_run(text, runid):
    found = re.findall(r"ab-eval/[A-Za-z0-9_-]+/runs/([A-Za-z0-9_.-]+)", text) + \
        re.findall(r"/runs/([A-Za-z0-9_.-]+)/(?:repo|memory)", text)
    return any(m != runid for m in found)


def escape_reason(cmd, cwd, root):
    """First `cd` target or `..` token that resolves outside root, following `cd` steps within the command."""
    eff = cwd
    for seg in SEGMENTS.split(cmd):
        seg = seg.strip().strip("()").strip()
        if not seg:
            continue
        cd = CD.match(seg)
        if cd:
            target = os.path.expanduser((cd.group(1) or "~").strip("'\""))
            new = _resolve(eff, target)
            if not _inside(new, root):
                return f"cd {target}"
            eff = new
            continue
        for tok in TOKEN.findall(seg):
            if DOTDOT.search(tok) and not _inside(_resolve(eff, tok), root):
                return tok
    return None


def decide(tool, tool_input, cwd, run_dir):
    """Return (category, reason) for a denied call, or None. Pure: no I/O."""
    root = os.path.normpath(os.path.join(run_dir, "repo"))
    runid = os.path.basename(os.path.normpath(run_dir))
    cwd = cwd or root
    if tool == "Bash":
        cmd = tool_input.get("command", "")
        code = strip_heredocs(cmd)
        if STACK.search(code):
            return "stack", MSG_STACK
        if NET.search(code):
            return "net", MSG_NET
        if any(r in scrub_for_roots("Bash", cmd, run_dir, code) for r in ROOTS) or _other_run(cmd, runid) \
                or escape_reason(code, cwd, root):
            return "root", MSG_ROOT
    elif tool == "Read":
        path = tool_input.get("file_path", "")
        if any(r in scrub_for_roots("Read", path, run_dir) for r in ROOTS) or _other_run(path, runid) or \
                (DOTDOT.search(path) and not _inside(_resolve(cwd, path), root)):
            return "root", MSG_ROOT
    elif tool in ("Edit", "Write"):
        path = _resolve(cwd, tool_input.get("file_path", ""))
        if not (path.startswith(run_dir + "/") or path.startswith("/tmp/") or path.startswith("/private/tmp/")):
            return "write", MSG_WRITE
    return None


def main():
    data = json.load(sys.stdin)
    tool = data.get("tool_name", "")
    cwd = data.get("cwd", "") or ""
    run_dir = os.environ.get("AB_RUN_DIR") or os.path.dirname(cwd)
    tool_input = data.get("tool_input", {}) or {}
    hit = decide(tool, tool_input, cwd, run_dir)
    if hit:
        cat, reason = hit
        try:
            with open(os.path.join(run_dir, "harness-denials.jsonl"), "a") as fh:
                fh.write(json.dumps({"ts": time.time(), "tool": tool, "cat": cat,
                                     "agent_type": data.get("agent_type"), "agent_id": data.get("agent_id"),
                                     "input": json.dumps(tool_input)[:300]}) + "\n")
        except OSError:
            pass
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                 "permissionDecisionReason": reason}}))
    sys.exit(0)


if __name__ == "__main__":
    main()
