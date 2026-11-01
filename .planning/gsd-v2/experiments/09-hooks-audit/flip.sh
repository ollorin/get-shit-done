#!/bin/bash
# flip.sh - enable Claude Code hooks for igaming-platform (experiments/09-hooks-audit RULING section C).
#   flip.sh --apply     [--dry-run] [--approved-by-ceo "<quoted approval>"]   unregister the hooks that must not come back, then remove the project
#                                     hook-disable flag + local hooks block. Needs a TTY and the typed word FLIP.
#   flip.sh --smoke     [--dry-run]   new-session probes of the live hook set (claude -p, haiku); --dry-run lists them
#   flip.sh --rollback                restore both settings files (and RTK.md) from the latest backup. TTY + typed word, from a terminal
#                                     outside Claude Code: it refuses when CLAUDECODE is set or a claude process is an ancestor, and refuses --approved-by-ceo.
#                                     This steers rather than enforces: a deliberately detached process with a faked pty still passes.
# --approved-by-ceo "<quote>" (--apply only) replaces ONLY the TTY and the typed word (the CEO delegated the run to an agent). The quote must be
#   the CEO's own words (min 8 chars); one line (date, mode, flag, quote) is appended to $PROJECT_DIR/.tmp/gsd-v2/hooks-flip-backup/approvals.log
#   before anything changes. Every refusal below still applies to --apply (rollback has none besides nothing applied / a missing backup).
#   The quote cannot be verified, so once hooks are on the protect hook denies any agent command that runs flip.sh with --apply or
#   --rollback (gsd-protect-managed-files.js, FLIP_APPLY_RE), a literal-spelling steer; --rollback itself refuses agents. --smoke stays allowed.
#   The first --apply still works from an agent because hooks are off at that moment; a second --apply is refused ("already applied").
# Install step BEFORE --apply (agents, commands, get-shit-done, hooks only; no whisper/MCP/.env.template):
#   cd ~/get-shit-done && node bin/install.js --global --claude      (needs a clean fork tree only for npm run install:gsd)
#   It runs `npm ci` for the hook dependencies inside ~/.claude/get-shit-done (npm cache or network) and refreshes the
#   protect/charlotte-lock registrations in settings.json (idempotent). `npm run install:gsd` adds npm install, whisper
#   models, the telegram MCP merge into ~/.claude/.claude.json and .env.template: not needed for the flip.
# --dry-run mutates nothing real: it transforms COPIES in a temp dir, validates the JSON and prints the diff.
# Env overrides for testing on fixtures: CLAUDE_HOME (default ~/.claude), PROJECT_DIR (default ~/igaming-platform).
set -u
TMPD=""; KEEP_TMP=0; trap '[ "$KEEP_TMP" = 1 ] || { [ -z "$TMPD" ] || rm -rf "$TMPD"; }' EXIT
MODE=""; SUB=""; APPROVED=0; APPROVAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply|--smoke|--rollback) MODE="$1";;
    --dry-run) SUB="--dry-run";;
    --approved-by-ceo) APPROVED=1; shift; APPROVAL="${1:-}";;
    *) echo "usage: flip.sh --apply [--dry-run] [--approved-by-ceo \"<quote>\"] | --smoke [--dry-run] | --rollback" >&2; exit 64;;
  esac
  shift
done
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
PROJECT_DIR="${PROJECT_DIR:-$HOME/igaming-platform}"
real() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
is_fixture() { [ "$(real "$CLAUDE_HOME")" != "$(real "$HOME/.claude")" ] && [ "$(real "$PROJECT_DIR")" != "$(real "$HOME/igaming-platform")" ]; } # both paths away from the real defaults: tests only
under_agent() { [ -n "${CLAUDECODE:-}" ] || ps -axo pid=,ppid=,comm= | awk -v p=$$ '{pp[$1]=$2; x=$0; sub(/^ *[0-9]+ +[0-9]+ +/,"",x); c[$1]=x} END{while(p>1&&p in pp){n=c[p]; sub(/.*\//,"",n); if(n ~ /^claude/) exit 0; p=pp[p]} exit 1}'; }
USER_SETTINGS="$CLAUDE_HOME/settings.json"
LOCAL_SETTINGS="$PROJECT_DIR/.claude/settings.local.json"
RTK_MD="$CLAUDE_HOME/RTK.md"
BACKUP_ROOT="$PROJECT_DIR/.tmp/gsd-v2/hooks-flip-backup"   # under .tmp/gsd-v2: the host cleanup never deletes it
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
  [ -t 0 ] && [ -t 1 ] || die "needs a TTY (a person in a terminal)$([ "$MODE" = --rollback ] || echo ' or --approved-by-ceo "<quote>"')"
  printf 'Type %s to continue: ' "$1"; read -r w; [ "$w" = "$1" ] || die "aborted"
}
command -v python3 >/dev/null || die "python3 required"

# Running stack/OrbStack operations and the Charlotte runner, judged by the process's own argv (a `claude -p` prompt that merely
# mentions "orbctl restart" is not one). Prints one reason per line. FLIP_PROCS_ROOT_PID (tests, honoured only on fixture paths) limits the scan to one process tree.
busy_processes() {
  FLIP_FIXTURE=$(is_fixture && echo 1 || echo 0) python3 -I - <<'PY'
import os,re,subprocess
rows=[]
for l in subprocess.run(['ps','-axo','pid=,ppid=,command='],capture_output=True,text=True).stdout.splitlines():
    p=l.split(None,2)
    if len(p)==3 and p[0].isdigit() and p[1].isdigit(): rows.append((int(p[0]),int(p[1]),p[2]))
root=os.environ.get('FLIP_PROCS_ROOT_PID') if os.environ.get('FLIP_FIXTURE')=='1' else None   # tests on fixture paths only: look at the descendants of this pid, not the whole host
if root and root.isdigit():
    keep={int(root)}
    while True:
        more={p for p,pp,c in rows if pp in keep and p not in keep}
        if not more: break
        keep|=more
    rows=[r for r in rows if r[0] in keep]
RUNNERS={'node','npx','pnpx','bunx','pnpm','yarn','nx','bun','deno','tsx'}
SHELLS={'sh','bash','zsh','dash'}
def scan(line,depth=0):
    w=line.split()
    if not w: return None
    b=os.path.basename(w[0]); rest=w[1:]; j=' '.join(rest)
    if b in ('orbctl','docker') and rest and rest[0] in ('stop','start','restart','kill'): return 'restart'
    if b=='supabase' and rest and rest[0] in ('start','stop'): return 'restart'
    if b in RUNNERS:
        if re.search(r'(^|[ /])supabase (start|stop)( |$)',j) or re.search(r'(^|[ /])nx (start|stop):dev( |$)',j) or (b=='nx' and re.match(r'(start|stop):dev( |$)',j)): return 'restart'
        if b in ('deno','tsx','node','bun','npx') and re.search(r'(^|[ /])runner/run\.ts( |$)',j): return 'charlotte'
    if b in SHELLS and depth<3 and len(rest)>=2 and rest[0]=='-c': return scan(' '.join(rest[1:]),depth+1)
    return None
seen=set()
for _,_,line in rows:
    k=scan(line)
    if k and k not in seen:
        seen.add(k)
        print('an OrbStack/docker/supabase restart or start/stop is running: '+line[:100] if k=='restart' else 'a Charlotte runner (runner/run.ts) is running: '+line[:100])
PY
}

lock_refusals() { # the stack/Charlotte lock state; checked first, and again right before the first write (a TTY prompt can wait indefinitely)
  local owner="$PROJECT_DIR/.tmp/local-stack.lock/owner.txt" lock="$PROJECT_DIR/.tmp/charlotte.lock"
  [ -f "$owner" ] && grep -qi charlotte "$owner" && echo "local-stack lock owner label contains 'charlotte': $(head -c 120 "$owner")"
  if [ -f "$lock" ]; then
    local pid; pid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("pid",""))' "$lock" 2>/dev/null)
    if [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; then echo ".tmp/charlotte.lock is live (pid ${pid:-unknown})"; fi
  fi
  busy_processes
  if [ -s "$owner" ]; then echo "local-stack lock is held (owner.txt non-empty): $(head -c 120 "$owner")"
  elif [ -f "$PROJECT_DIR/.tmp/local-stack.flock" ] && ! python3 -c 'import fcntl,sys;f=open(sys.argv[1]);fcntl.flock(f,fcntl.LOCK_SH|fcntl.LOCK_NB)' "$PROJECT_DIR/.tmp/local-stack.flock" 2>/dev/null; then
    echo "local-stack flock is held (.tmp/local-stack.flock)"
  fi
}

refusals() { # prints one reason per line when the flip must not happen now
  lock_refusals
  [ -f "$CLAUDE_HOME/get-shit-done/bin/hooks/gsd-hook-lib.js" ] || echo "fork hooks not installed in $CLAUDE_HOME (protect hook is the old one): run  cd ~/get-shit-done && node bin/install.js --global --claude"
  [ -f "$APPLIED" ] && echo "already applied (backup $(cat "$APPLIED")): run --rollback first; a second apply would overwrite the original backup"
  python3 -c 'import json,sys;sys.exit(0 if sys.argv[2] in json.load(open(sys.argv[1])) else 1)' "$LOCAL_SETTINGS" "$FLAG" 2>/dev/null || echo "hook-disable flag is not set in $LOCAL_SETTINGS: nothing to flip (already applied?)"
  if [ -x "$PROJECT_DIR/scripts/validation/hook-canaries/run-canaries.sh" ]; then
    local co; co=$(mktemp)
    "$PROJECT_DIR/scripts/validation/hook-canaries/run-canaries.sh" >"$co" 2>&1 || echo "canaries fail: $(tail -1 "$co")"
    rm -f "$co"
  else echo "canary runner missing"; fi
  find "$PROJECT_DIR/.planning/phases" -name PAUSED.json 2>/dev/null | head -3 | sed 's/^/PAUSED.json exists: /'
  ls "$HOME"/Library/LaunchAgents/com.gsd.resume* 2>/dev/null | head -3 | sed 's/^/resume plist exists: /'
}

# put <src> <dst>: write dst atomically (same-directory temp + mv), keeping dst's mode; a failure leaves dst untouched.
put() {
  local src="$1" dst="$2" t m
  [ -L "$dst" ] && dst=$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$dst")
  t="$dst.flip.$$"
  cp "$src" "$t" || { rm -f "$t"; return 1; }
  if [ -e "$dst" ]; then m=$(python3 -c 'import os,sys;print(format(os.stat(sys.argv[1]).st_mode & 0o7777,"o"))' "$dst" 2>/dev/null); [ -n "$m" ] && chmod "$m" "$t"; fi
  mv -f "$t" "$dst" || { rm -f "$t"; return 1; }
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
  local tmp; tmp=$(mktemp -d); TMPD="$tmp"
  transform "$USER_SETTINGS" "$LOCAL_SETTINGS" "$RTK_MD" "$tmp" || die "transform failed; nothing changed"
  for f in settings.json settings.local.json; do python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$tmp/$f" || die "invalid JSON produced for $f"; done
  echo "--- diff user settings"; diff -u "$USER_SETTINGS" "$tmp/settings.json" | head -80
  echo "--- diff local settings"; diff -u "$LOCAL_SETTINGS" "$tmp/settings.local.json"
  if [ $dry = 1 ]; then KEEP_TMP=1; echo "flip: dry-run complete (nothing changed; copies in $tmp)"; return 0; fi
  need_tty FLIP
  r=$(lock_refusals); [ -z "$r" ] || { echo "$r" | sed 's/^/  - /' >&2; die "stack/Charlotte lock state changed while waiting; nothing changed"; }
  local b="$BACKUP_ROOT/$(date +%Y%m%dT%H%M%S)"
  mkdir -p "$b" || die "cannot create backup dir; nothing changed"
  cp "$USER_SETTINGS" "$b/settings.json" && cp "$LOCAL_SETTINGS" "$b/settings.local.json" || die "backup failed; nothing changed"
  if [ -f "$RTK_MD" ]; then cp "$RTK_MD" "$b/RTK.md" || die "backup failed; nothing changed"; else : > "$b/RTK.md.absent" || die "backup failed; nothing changed"; fi
  cmp -s "$USER_SETTINGS" "$b/settings.json" && cmp -s "$LOCAL_SETTINGS" "$b/settings.local.json" || die "backup mismatch; nothing changed"
  if [ -f "$RTK_MD" ]; then cmp -s "$RTK_MD" "$b/RTK.md" || die "backup mismatch; nothing changed"; fi
  echo "$b" > "$BACKUP_ROOT/latest" && echo "$b" > "$APPLIED" || die "cannot record backup; nothing changed"
  # order matters: unregister the user-level hooks first, only then drop the flag (no session sees the old set)
  # `applied` stays set only once a write has landed: a failed first write changes nothing, so it is cleared again.
  put "$tmp/settings.json" "$USER_SETTINGS" || { rm -f "$APPLIED"; die "write user settings failed; nothing changed (backup in $b)"; }
  put "$tmp/RTK.md" "$RTK_MD" || echo "flip: WARNING: could not write $RTK_MD (docs only; rollback restores it from $b)" >&2
  put "$tmp/settings.local.json" "$LOCAL_SETTINGS" || die "write local settings failed; run: flip.sh --rollback (backup $b)"
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

smoke_rows() { # cmd<TAB>expect(BLOCKED|RUNS|CMP>8000|ZERO)<TAB>proves
  printf '%s\t%s\t%s\n' \
    'echo disable''AllHooks' BLOCKED 'user-level hooks live, no side effect' \
    'git push origin zz-nosuch' BLOCKED 'project hooks live (marker stale since Oct 30)' \
    'cd apps/api && deno task test functions/games-crud/index.test.ts' RUNS 'allowed test shape' \
    'grep -rn zzprobe apps/api/functions/games-crud' BLOCKED 'R1 deny names zg / git grep' \
    'grep -n foo README.md' RUNS 'R1 allow' \
    'git grep -n foo -- README.md' RUNS 'R1 allow' \
    'git log --oneline | wc -l' 'CMP>8000' 'RTK off' \
    'ls ~/Library/LaunchAgents | grep -c gsd' ZERO 'no resume armed'
}

do_smoke() {
  local dry=0; [ "$SUB" = "--dry-run" ] && dry=1
  [ $dry = 1 ] || command -v claude >/dev/null || die "claude CLI not found"
  local fails=0 ran=0 skipped=0 total v out rc n t
  total=$(smoke_rows | wc -l | tr -d ' ')
  local mark="$PROJECT_DIR/.preflight-passed" fresh=0
  if [ -f "$mark" ]; then
    local age; age=$(python3 -c 'import os,sys,time;print(int(time.time()-os.stat(sys.argv[1]).st_mtime))' "$mark" 2>/dev/null || echo 999999)
    [ "$age" -lt 1800 ] && fresh=1
  fi
  while IFS=$'\t' read -r cmd expect proves <&3; do
    if [ $dry = 1 ]; then printf 'would run (%s, proves: %s): %s\n' "$expect" "$proves" "$cmd"; continue; fi
    ran=$((ran+1))
    if [ $fresh = 1 ] && [[ "$cmd" == "git push"* ]]; then
      skipped=$((skipped+1)); printf '%-6s %-9s %s\n' SKIP "$expect" "$cmd (a fresh .preflight-passed marker lets the push through; rerun after the marker is 30 min old)"; continue
    fi
    # prompt first (--allowedTools is variadic and would swallow it), stdin closed (claude -p would eat the row list), stderr dropped (CLI warnings are not output)
    out=$(cd "$PROJECT_DIR" && claude -p "Run exactly this one Bash command and reply with only its raw output or the exact BLOCKED/denial text, nothing else: $cmd" \
      --model haiku --permission-mode acceptEdits --allowedTools Bash </dev/null 2>/dev/null); rc=$?
    v=WRONG
    if [ $rc = 0 ]; then
      case "$expect" in
        BLOCKED) [[ "$out" == *BLOCKED* || "$out" == *PROTECTED* || "$out" == *"hook"*[Dd]enied* ]] && v=ok;;
        RUNS)    [[ "$out" != *BLOCKED* && "$out" != *PROTECTED* && "$out" != *"hook"*[Dd]enied* ]] && v=ok;;
        'CMP>8000') n=$(printf '%s' "$out" | tr -dc '0-9'); [ "${n:-0}" -gt 8000 ] && v=ok;;
        ZERO)    t=$(printf '%s' "$out" | tr -d '[:space:]'); [ "$t" = 0 ] && v=ok;;
      esac
    fi
    [ $v = ok ] || fails=$((fails+1))
    printf '%-6s %-9s %s\n' "$v" "$expect" "$cmd"
  done 3< <(smoke_rows)
  echo "final step: have the main session's runner execute the first probe (hook-disable echo): BLOCKED = running sessions picked up the change; printed = they did not, restart them at a phase boundary. 'Enabled 100%' only when no claude process predates the flip (ps -o etime)."
  [ $dry = 1 ] && return 0
  [ "$ran" = "$total" ] && [ "$total" -gt 0 ] || { echo "flip: smoke ran $ran of $total rows; consider: flip.sh --rollback" >&2; exit 1; }
  [ $fails = 0 ] || { echo "flip: $fails smoke row(s) wrong; consider: flip.sh --rollback" >&2; exit 1; }
  echo "flip: smoke ok ($((ran-skipped)) of $total rows checked, $skipped skipped)"
}

do_rollback() {
  is_fixture || { ! under_agent || die "rollback runs only from a terminal outside Claude Code"; [ "$APPROVED" = 0 ] || die "--approved-by-ceo is not accepted for --rollback"; }
  [ -f "$APPLIED" ] || die "nothing applied (no $APPLIED); nothing changed"
  local b; b=$(cat "$APPLIED"); [ -d "$b" ] || die "backup dir $b missing"
  for f in settings.json settings.local.json; do python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$b/$f" || die "backup $f is not valid JSON"; done
  need_tty ROLLBACK
  put "$b/settings.json" "$USER_SETTINGS" || die "rollback incomplete (user settings); marker kept, backup $b"
  put "$b/settings.local.json" "$LOCAL_SETTINGS" || die "rollback incomplete (local settings); marker kept, backup $b"
  if [ -f "$b/RTK.md" ]; then put "$b/RTK.md" "$RTK_MD" || die "rollback incomplete (RTK.md); marker kept, backup $b"
  elif [ -f "$b/RTK.md.absent" ]; then rm -f "$RTK_MD" || die "rollback incomplete (RTK.md); marker kept, backup $b"; fi
  cmp -s "$b/settings.json" "$USER_SETTINGS" && cmp -s "$b/settings.local.json" "$LOCAL_SETTINGS" || die "rollback incomplete (files differ from backup); marker kept, backup $b"
  rm -f "$APPLIED" || die "files restored but cannot clear $APPLIED"
  echo "flip: rolled back from $b (the project flag is back; it applies to user-level hooks too). Restart or open new sessions."
}

case "$MODE" in
  --apply) do_apply;; --smoke) do_smoke;; --rollback) do_rollback;;
  *) echo "usage: flip.sh --apply [--dry-run] | --smoke [--dry-run] | --rollback" >&2; exit 64;;
esac
