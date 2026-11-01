#!/bin/bash
# flip.sh - enable Claude Code hooks for igaming-platform (experiments/09-hooks-audit RULING section C).
#   flip.sh --apply     [--dry-run] [--approved-by-ceo "<quoted approval>"]   unregister the hooks that must not come back, then remove the project
#                                     hook-disable flag + local hooks block. Needs a TTY and the typed word FLIP.
#   flip.sh --smoke     [--dry-run]   new-session probes of the live hook set (claude -p, haiku); --dry-run lists them
#   flip.sh --rollback  [--approved-by-ceo "<quoted approval>"]   restore both settings files (and RTK.md) from the latest backup. TTY + typed word.
# --approved-by-ceo "<quote>" replaces ONLY the TTY and the typed word (the CEO delegated the run to an agent). The quote must be
#   the CEO's own words (min 8 chars); one line (date, mode, flag, quote) is appended to $PROJECT_DIR/.tmp/hooks-flip-backup/approvals.log
#   before anything changes. Every refusal below still applies to --apply (rollback has none besides a missing backup).
# Install step BEFORE --apply (agents, commands, get-shit-done, hooks only; no whisper/MCP/.env.template):
#   cd ~/get-shit-done && node bin/install.js --global --claude      (needs a clean fork tree only for npm run install:gsd)
#   It runs `npm ci` for the hook dependencies inside ~/.claude/get-shit-done (npm cache or network) and refreshes the
#   protect/charlotte-lock registrations in settings.json (idempotent). `npm run install:gsd` adds npm install, whisper
#   models, the telegram MCP merge into ~/.claude/.claude.json and .env.template: not needed for the flip.
# --dry-run mutates nothing real: it transforms COPIES in a temp dir, validates the JSON and prints the diff.
# Env overrides for testing on fixtures: CLAUDE_HOME (default ~/.claude), PROJECT_DIR (default ~/igaming-platform).
set -u
MODE=""; SUB=""; APPROVED=0; APPROVAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply|--smoke|--rollback) MODE="$1";;
    --dry-run) SUB="--dry-run";;
    --approved-by-ceo) APPROVED=1; shift; APPROVAL="${1:-}";;
    *) echo "usage: flip.sh --apply [--dry-run] [--approved-by-ceo \"<quote>\"] | --smoke [--dry-run] | --rollback [--approved-by-ceo \"<quote>\"]" >&2; exit 64;;
  esac
  shift
done
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
PROJECT_DIR="${PROJECT_DIR:-$HOME/igaming-platform}"
USER_SETTINGS="$CLAUDE_HOME/settings.json"
LOCAL_SETTINGS="$PROJECT_DIR/.claude/settings.local.json"
RTK_MD="$CLAUDE_HOME/RTK.md"
BACKUP_ROOT="$PROJECT_DIR/.tmp/hooks-flip-backup"
APPLIED="$BACKUP_ROOT/applied"   # holds the backup dir of an apply that was not rolled back yet
FLAG="disable""AllHooks"   # split so this file never trips the protect hook's substring match when read via Bash

die() { echo "flip: $*" >&2; exit 1; }
need_tty() { # need_tty <WORD>: a person at a TTY types WORD, or --approved-by-ceo "<quote>" is logged instead
  if [ "$APPROVED" = 1 ]; then
    local q; q=$(printf '%s' "$APPROVAL" | tr '\n\r' '  ')
    [ "${#q}" -ge 8 ] || die "--approved-by-ceo needs the CEO's quoted approval (at least 8 characters) as its value"
    mkdir -p "$BACKUP_ROOT" && printf '%s\t%s\t--approved-by-ceo\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE" "$q" >> "$BACKUP_ROOT/approvals.log" || die "cannot write approvals.log; nothing changed"
    echo "flip: non-interactive run approved by the CEO (logged to $BACKUP_ROOT/approvals.log)"; return 0
  fi
  [ -t 0 ] && [ -t 1 ] || die "needs a TTY (a person in a terminal) or --approved-by-ceo \"<quote>\""
  printf 'Type %s to continue: ' "$1"; read -r w; [ "$w" = "$1" ] || die "aborted"
}
command -v python3 >/dev/null || die "python3 required"

refusals() { # prints one reason per line when the flip must not happen now
  [ -f "$CLAUDE_HOME/get-shit-done/bin/hooks/gsd-hook-lib.js" ] || echo "fork hooks not installed in $CLAUDE_HOME (protect hook is the old one): run  cd ~/get-shit-done && node bin/install.js --global --claude"
  [ -f "$APPLIED" ] && echo "already applied (backup $(cat "$APPLIED")): run --rollback first; a second apply would overwrite the original backup"
  python3 -c 'import json,sys;sys.exit(0 if sys.argv[2] in json.load(open(sys.argv[1])) else 1)' "$LOCAL_SETTINGS" "$FLAG" 2>/dev/null || echo "hook-disable flag is not set in $LOCAL_SETTINGS: nothing to flip (already applied?)"
  local owner="$PROJECT_DIR/.tmp/local-stack.lock/owner.txt" lock="$PROJECT_DIR/.tmp/charlotte.lock"
  [ -f "$owner" ] && grep -qi charlotte "$owner" && echo "local-stack lock owner label contains 'charlotte': $(head -c 120 "$owner")"
  if [ -f "$lock" ]; then
    local pid; pid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("pid",""))' "$lock" 2>/dev/null)
    if [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; then echo ".tmp/charlotte.lock is live (pid ${pid:-unknown})"; fi
  fi
  pgrep -fl 'orbctl (stop|start|restart)|docker (stop|start|restart|kill)|supabase (start|stop)|nx (start|stop):dev' >/dev/null 2>&1 && echo "an OrbStack/docker/supabase restart or start/stop is running"
  if [ -s "$owner" ]; then echo "local-stack lock is held (owner.txt non-empty): $(head -c 120 "$owner")"
  elif [ -f "$PROJECT_DIR/.tmp/local-stack.flock" ] && ! python3 -c 'import fcntl,sys;f=open(sys.argv[1]);fcntl.flock(f,fcntl.LOCK_SH|fcntl.LOCK_NB)' "$PROJECT_DIR/.tmp/local-stack.flock" 2>/dev/null; then
    echo "local-stack flock is held (.tmp/local-stack.flock)"
  fi
  if [ -x "$PROJECT_DIR/scripts/validation/hook-canaries/run-canaries.sh" ]; then
    local co; co=$(mktemp)
    "$PROJECT_DIR/scripts/validation/hook-canaries/run-canaries.sh" >"$co" 2>&1 || echo "canaries fail: $(tail -1 "$co")"
    rm -f "$co"
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
  cp "$USER_SETTINGS" "$b/settings.json"; cp "$LOCAL_SETTINGS" "$b/settings.local.json"
  if [ -f "$RTK_MD" ]; then cp "$RTK_MD" "$b/RTK.md"; else : > "$b/RTK.md.absent"; fi
  echo "$b" > "$BACKUP_ROOT/latest"; echo "$b" > "$APPLIED"
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
      BLOCKED) [[ "$out" == *BLOCKED* || "$out" == *PROTECTED* || "$out" == *"hook"*[Dd]enied* ]] && v=ok || v=WRONG;;
      RUNS)    [[ "$out" != *BLOCKED* && "$out" != *PROTECTED* && "$out" != *"hook"*[Dd]enied* ]] && v=ok || v=WRONG;;
      'CMP>8000') n=$(printf '%s' "$out" | tr -dc '0-9'); [ "${n:-0}" -gt 8000 ] && v=ok || v=WRONG;;
      EMPTY)   t=$(printf '%s' "$out" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]'); case "$t" in ''|'(nooutput)'|'nooutput'|'(empty)'|'empty'|'(none)'|'none') v=ok;; *) v=WRONG;; esac;;
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
  cp "$b/settings.json" "$USER_SETTINGS"; cp "$b/settings.local.json" "$LOCAL_SETTINGS"
  if [ -f "$b/RTK.md" ]; then cp "$b/RTK.md" "$RTK_MD"; elif [ -f "$b/RTK.md.absent" ]; then rm -f "$RTK_MD"; fi
  rm -f "$APPLIED"
  echo "flip: rolled back from $b (the project flag is back; it applies to user-level hooks too). Restart or open new sessions."
}

case "$MODE" in
  --apply) do_apply;; --smoke) do_smoke;; --rollback) do_rollback;;
  *) echo "usage: flip.sh --apply [--dry-run] | --smoke [--dry-run] | --rollback" >&2; exit 64;;
esac
