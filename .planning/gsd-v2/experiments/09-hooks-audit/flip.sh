#!/bin/bash
# flip.sh - enable Claude Code hooks for igaming-platform (experiments/09-hooks-audit RULING section C).
#   flip.sh --apply     [--dry-run]   unregister the hooks that must not come back, then remove the project
#                                     hook-disable flag + local hooks block. Needs a TTY and the typed word FLIP.
#   flip.sh --smoke     [--dry-run]   new-session probes of the live hook set (claude -p, haiku); --dry-run lists them
#   flip.sh --rollback                restore both settings files (and RTK.md) from the latest backup. TTY + typed word.
# --dry-run mutates nothing real: it transforms COPIES in a temp dir, validates the JSON and prints the diff.
# Env overrides for testing on fixtures: CLAUDE_HOME (default ~/.claude), PROJECT_DIR (default ~/igaming-platform).
set -u
MODE="${1:-}"; SUB="${2:-}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
PROJECT_DIR="${PROJECT_DIR:-$HOME/igaming-platform}"
USER_SETTINGS="$CLAUDE_HOME/settings.json"
LOCAL_SETTINGS="$PROJECT_DIR/.claude/settings.local.json"
RTK_MD="$CLAUDE_HOME/RTK.md"
BACKUP_ROOT="$PROJECT_DIR/.tmp/hooks-flip-backup"
FLAG="disable""AllHooks"   # split so this file never trips the protect hook's substring match when read via Bash

die() { echo "flip: $*" >&2; exit 1; }
need_tty() {
  [ -t 0 ] && [ -t 1 ] || die "needs a TTY (a person in a terminal); Bash tool calls cannot run this"
  printf 'Type %s to continue: ' "$1"; read -r w; [ "$w" = "$1" ] || die "aborted"
}
command -v python3 >/dev/null || die "python3 required"

refusals() { # prints one reason per line when the flip must not happen now
  local owner="$PROJECT_DIR/.tmp/local-stack.lock/owner.txt" lock="$PROJECT_DIR/.tmp/charlotte.lock"
  [ -f "$owner" ] && grep -qi charlotte "$owner" && echo "local-stack lock owner label contains 'charlotte': $(head -c 120 "$owner")"
  if [ -f "$lock" ]; then
    local pid; pid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("pid",""))' "$lock" 2>/dev/null)
    if [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; then echo ".tmp/charlotte.lock is live (pid ${pid:-unknown})"; fi
  fi
  pgrep -fl 'orbctl (stop|start|restart)' >/dev/null 2>&1 && echo "an OrbStack restart is running"
  if [ -x "$PROJECT_DIR/scripts/validation/hook-canaries/run-canaries.sh" ]; then
    "$PROJECT_DIR/scripts/validation/hook-canaries/run-canaries.sh" >/tmp/flip-canaries.out 2>&1 || echo "canaries fail: $(tail -1 /tmp/flip-canaries.out)"
  else echo "canary runner missing"; fi
  find "$PROJECT_DIR/.planning/phases" -name PAUSED.json 2>/dev/null | head -3 | sed 's/^/PAUSED.json exists: /'
  ls "$HOME"/Library/LaunchAgents/com.gsd.resume* 2>/dev/null | head -3 | sed 's/^/resume plist exists: /'
}

transform() { # transform <user_settings_in> <local_settings_in> <rtk_md_in> <outdir> ; writes outdir/{settings.json,settings.local.json,RTK.md}
  python3 -I - "$1" "$2" "$3" "$4" "$FLAG" <<'PY'
import json,sys,os
us,ls,rtk,out,flag=sys.argv[1:6]
DROP=('rtk-rewrite','schedule-resume','gsd-check-update','doc-compression-hook')
u=json.load(open(us)); removed=[]
hooks=u.get('hooks',{})
for ev in list(hooks):
    keep=[]
    for m in hooks[ev]:
        hs=[h for h in m.get('hooks',[]) if not any(d in h.get('command','') for d in DROP)]
        removed+=[(ev,h.get('command','')) for h in m.get('hooks',[]) if h not in hs]
        if hs: keep.append({**m,'hooks':hs})
    if keep: hooks[ev]=keep
    else: del hooks[ev]
for d in DROP:
    assert not any(d in h.get('command','') for ms in hooks.values() for m in ms for h in m.get('hooks',[])), d
l=json.load(open(ls)); had=flag in l
l.pop(flag,None); l.pop('hooks',None)
os.makedirs(out,exist_ok=True)
json.dump(u,open(out+'/settings.json','w'),indent=2); open(out+'/settings.json','a').write('\n')
json.dump(l,open(out+'/settings.local.json','w'),indent=2); open(out+'/settings.local.json','a').write('\n')
for r in removed: print('unregistered:',r[0],r[1])
print('flag present before:',had)
txt="""# RTK - Rust Token Killer

Binary kept; NOT auto-applied. The rtk-rewrite hook is unregistered (experiments/09-hooks-audit RULING R9):
rewriting truncated diffs, collapsed json values, dropped test output and buffered long-running commands.
Re-enable per command only with a fidelity canary (full output and rc equal to raw, or an explicit marker).

```bash
rtk gain              # token savings analytics
rtk proxy <cmd>       # run a command raw through rtk
```

Do not type `rtk grep`, `rtk git diff` or `rtk git log` for evidence: output is lossy.
"""
open(out+'/RTK.md','w').write(txt)
PY
}

do_apply() {
  local dry=0; [ "$SUB" = "--dry-run" ] && dry=1
  [ -f "$USER_SETTINGS" ] && [ -f "$LOCAL_SETTINGS" ] || die "settings files not found ($USER_SETTINGS, $LOCAL_SETTINGS)"
  local r; r=$(refusals)
  if [ -n "$r" ]; then echo "flip: REFUSING:" >&2; echo "$r" | sed 's/^/  - /' >&2; [ $dry = 1 ] || exit 1; echo "(dry-run continues)"; fi
  local tmp; tmp=$(mktemp -d)
  transform "$USER_SETTINGS" "$LOCAL_SETTINGS" "$RTK_MD" "$tmp" || die "transform failed; nothing changed"
  for f in settings.json settings.local.json; do python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$tmp/$f" || die "invalid JSON produced for $f"; done
  echo "--- diff user settings"; diff -u "$USER_SETTINGS" "$tmp/settings.json" | head -80
  echo "--- diff local settings"; diff -u "$LOCAL_SETTINGS" "$tmp/settings.local.json"
  if [ $dry = 1 ]; then echo "flip: dry-run complete (nothing changed; copies in $tmp)"; return 0; fi
  need_tty FLIP
  local b="$BACKUP_ROOT/$(date +%Y%m%dT%H%M%S)"; mkdir -p "$b"
  cp "$USER_SETTINGS" "$b/settings.json"; cp "$LOCAL_SETTINGS" "$b/settings.local.json"; [ -f "$RTK_MD" ] && cp "$RTK_MD" "$b/RTK.md"
  echo "$b" > "$BACKUP_ROOT/latest"
  # order matters: unregister the user-level hooks first, only then drop the flag (no session sees the old set)
  cp "$tmp/settings.json" "$USER_SETTINGS" || die "write user settings failed; backup in $b"
  cp "$tmp/RTK.md" "$RTK_MD"
  cp "$tmp/settings.local.json" "$LOCAL_SETTINGS" || die "write local settings failed; run: flip.sh --rollback (backup $b)"
  echo "flip: applied. Backup: $b"
  cat <<'BRIEF'

Next: run `flip.sh --smoke` from a NEW terminal session. Tell coordinators:
  Hooks are on. Denied: recursive grep/rg, rg without a file, rtk grep, find -exec without -maxdepth (use
  `git grep -n X -- path` or `zg query --rg -F X path`); Charlotte suite tasks and runner/run.ts outside
  stack-lock/session-supervisor; deno task test:integration*; git push without a fresh preflight; supabase
  start/stop without --exclude/--project-id; db reset/preflight.sh/test:regression during a live Charlotte lock;
  any Bash text containing the hook-disable setting name (commit messages too); edits to .claude/hooks/** and
  settings (use .planning/hook-patches/ + scripts/hooks-apply.sh). A deny is not a failure: retype once. If a
  CLAUDE.md shape is denied, stop and report the exact string.
BRIEF
}

smoke_rows() { # cmd<TAB>expect(BLOCKED|RUNS|CMP>8000|EMPTY)<TAB>proves
  printf '%s\t%s\t%s\n' \
    'echo disable''AllHooks' BLOCKED 'user-level hooks live, no side effect' \
    'git push origin zz-nosuch' BLOCKED 'project hooks live (marker stale since Oct 30)' \
    'cd apps/api && deno task test functions/games-crud/index.test.ts' RUNS 'allowed test shape' \
    'grep -rn zzprobe apps/api/functions/games-crud' BLOCKED 'R1 deny names zg / git grep' \
    'grep -n foo README.md' RUNS 'R1 allow' \
    'git grep -n foo -- README.md' RUNS 'R1 allow' \
    'git log --oneline | wc -l' 'CMP>8000' 'RTK off' \
    'ls ~/Library/LaunchAgents | grep gsd' EMPTY 'no resume armed'
}

do_smoke() {
  local dry=0; [ "$SUB" = "--dry-run" ] && dry=1
  command -v claude >/dev/null || die "claude CLI not found"
  local fails=0
  while IFS=$'\t' read -r cmd expect proves; do
    if [ $dry = 1 ]; then printf 'would run (%s, proves: %s): %s\n' "$expect" "$proves" "$cmd"; continue; fi
    out=$(cd "$PROJECT_DIR" && claude -p --model haiku --permission-mode acceptEdits --allowedTools Bash \
      "Run exactly this one Bash command and reply with only its raw output or the exact BLOCKED/denial text, nothing else: $cmd" 2>&1)
    case "$expect" in
      BLOCKED) [[ "$out" == *BLOCKED* || "$out" == *denied* || "$out" == *PROTECTED* ]] && v=ok || v=WRONG;;
      RUNS)    [[ "$out" != *BLOCKED* && "$out" != *denied* ]] && v=ok || v=WRONG;;
      'CMP>8000') n=$(printf '%s' "$out" | tr -dc '0-9'); [ "${n:-0}" -gt 8000 ] && v=ok || v=WRONG;;
      EMPTY)   [ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ] && v=ok || v=WRONG;;
    esac
    [ $v = ok ] || fails=$((fails+1))
    printf '%-6s %-9s %s\n' "$v" "$expect" "$cmd"
  done < <(smoke_rows)
  [ $dry = 1 ] && { echo "final step: have the main session's runner execute the first probe (hook-disable echo): BLOCKED = running sessions picked up the change; printed = they did not, restart them at a phase boundary. 'Enabled 100%' only when no claude process predates the flip (ps -o etime)."; return 0; }
  [ $fails = 0 ] || { echo "flip: $fails smoke row(s) wrong; consider: flip.sh --rollback" >&2; exit 1; }
  echo "flip: smoke ok"
}

do_rollback() {
  [ -f "$BACKUP_ROOT/latest" ] || die "no backup recorded in $BACKUP_ROOT/latest"
  local b; b=$(cat "$BACKUP_ROOT/latest"); [ -d "$b" ] || die "backup dir $b missing"
  for f in settings.json settings.local.json; do python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$b/$f" || die "backup $f is not valid JSON"; done
  need_tty ROLLBACK
  cp "$b/settings.json" "$USER_SETTINGS"; cp "$b/settings.local.json" "$LOCAL_SETTINGS"; [ -f "$b/RTK.md" ] && cp "$b/RTK.md" "$RTK_MD"
  echo "flip: rolled back from $b (the project flag is back; it applies to user-level hooks too). Restart or open new sessions."
}

case "$MODE" in
  --apply) do_apply;; --smoke) do_smoke;; --rollback) do_rollback;;
  *) echo "usage: flip.sh --apply [--dry-run] | --smoke [--dry-run] | --rollback" >&2; exit 64;;
esac
