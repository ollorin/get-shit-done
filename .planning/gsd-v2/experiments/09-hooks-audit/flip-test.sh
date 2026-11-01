#!/bin/bash
# flip-test.sh - fixture test for flip.sh (F1 of REVIEW-ROUND-2). Runs ONLY on temp copies:
#   CLAUDE_HOME and PROJECT_DIR point into a mktemp dir; the real ~/.claude and project are only read (copied).
# A pty from script(1) satisfies flip.sh's TTY gate. Env: FLIP_SH (script under test, default ./flip.sh).
#   bash flip-test.sh   ->  prints PASS/FAIL per case, exit 1 on any FAIL
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
FLIP_SH="${FLIP_SH:-$HERE/flip.sh}"
REAL_CLAUDE="${REAL_CLAUDE:-$HOME/.claude}"; REAL_PROJECT="${REAL_PROJECT:-$HOME/igaming-platform}"
T="${KEEP_T:-$(mktemp -d)}"; [ -n "${KEEP_T:-}" ] || trap 'rm -rf "$T"' EXIT   # KEEP_T=<dir> keeps the fixtures for debugging
fails=0
ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fails=$((fails+1)); }

mkfix() { # mkfix <dir>: fresh fixture copy of the three real files + a stub canary runner
  local d="$1"; mkdir -p "$d/claude" "$d/proj/.claude" "$d/proj/scripts/validation/hook-canaries"
  mkdir -p "$d/claude/get-shit-done/bin/hooks"; : > "$d/claude/get-shit-done/bin/hooks/gsd-hook-lib.js"   # marks the fork install as done
  cp "$REAL_CLAUDE/settings.json" "$d/claude/settings.json"; cp "$REAL_CLAUDE/RTK.md" "$d/claude/RTK.md" 2>/dev/null
  cp "$REAL_PROJECT/.claude/settings.local.json" "$d/proj/.claude/settings.local.json"
  printf '#!/bin/bash\necho "canaries: pass=1 fail=0"\n' > "$d/proj/scripts/validation/hook-canaries/run-canaries.sh"; chmod +x "$d/proj/scripts/validation/hook-canaries/run-canaries.sh"
  cp "$d/claude/settings.json" "$d/o.settings.json"; cp "$d/proj/.claude/settings.local.json" "$d/o.settings.local.json"; cp "$d/claude/RTK.md" "$d/o.RTK.md" 2>/dev/null
}
flip() { # flip <dir> <mode> <word>: run under a pty; prints exit code
  local d="$1"
  { sleep 2; printf '%s\n' "$3"; sleep 1; } | CLAUDE_HOME="$d/claude" PROJECT_DIR="$d/proj" script -q /dev/null bash "$FLIP_SH" "$2" >"$d/out.$2.$$" 2>&1
  echo $?
}
same_as_original() { cmp -s "$1/claude/settings.json" "$1/o.settings.json" && cmp -s "$1/proj/.claude/settings.local.json" "$1/o.settings.local.json" && { [ ! -f "$1/o.RTK.md" ] || cmp -s "$1/claude/RTK.md" "$1/o.RTK.md"; }; }

# 1. apply, apply, rollback -> byte-identical to the original (F1)
D="$T/a"; mkfix "$D"
r1=$(flip "$D" --apply FLIP); r2=$(flip "$D" --apply FLIP); r3=$(flip "$D" --rollback ROLLBACK)
[ "$r1" = 0 ] && ok "1a first apply succeeds" || bad "1a first apply rc=$r1"
[ "$r2" != 0 ] && ok "1b second apply refused (rc=$r2)" || bad "1b second apply was not refused"
[ "$r3" = 0 ] && same_as_original "$D" && ok "1c apply,apply,rollback is byte-identical to the original" || bad "1c rollback not identical (rc=$r3)"

# 2. apply, rollback, apply, rollback -> identical (re-apply after a rollback stays allowed)
D="$T/b"; mkfix "$D"
flip "$D" --apply FLIP >/dev/null; flip "$D" --rollback ROLLBACK >/dev/null
r=$(flip "$D" --apply FLIP); [ "$r" = 0 ] && ok "2a apply after rollback allowed" || bad "2a apply after rollback refused (rc=$r)"
flip "$D" --rollback ROLLBACK >/dev/null; same_as_original "$D" && ok "2b second rollback identical" || bad "2b second rollback differs"

# 3. a half-applied state (user settings written, flag still present) must not let a second apply overwrite the backup
D="$T/c"; mkfix "$D"
flip "$D" --apply FLIP >/dev/null
cp "$D/o.settings.local.json" "$D/proj/.claude/settings.local.json"   # simulate: local write lost, flag back
r=$(flip "$D" --apply FLIP); [ "$r" != 0 ] && ok "3a re-apply over an un-rolled-back apply refused" || bad "3a re-apply accepted"
flip "$D" --rollback ROLLBACK >/dev/null; same_as_original "$D" && ok "3b rollback identical" || bad "3b rollback differs"

# 4. rollback removes an RTK.md that did not exist before the apply (F15)
D="$T/d"; mkfix "$D"; rm -f "$D/claude/RTK.md" "$D/o.RTK.md"
flip "$D" --apply FLIP >/dev/null; flip "$D" --rollback ROLLBACK >/dev/null
[ ! -f "$D/claude/RTK.md" ] && same_as_original "$D" && ok "4 absent RTK.md stays absent after rollback" || bad "4 RTK.md left behind"

# 5. non-TTY apply refused, nothing changed
D="$T/e"; mkfix "$D"
CLAUDE_HOME="$D/claude" PROJECT_DIR="$D/proj" bash "$FLIP_SH" --apply </dev/null >/dev/null 2>&1; r=$?
[ "$r" != 0 ] && same_as_original "$D" && ok "5 non-TTY apply refused, files untouched" || bad "5 non-TTY apply changed files or rc=$r"

# 5b. refused when the fork hooks are not installed yet
D="$T/f"; mkfix "$D"; rm -f "$D/claude/get-shit-done/bin/hooks/gsd-hook-lib.js"
r=$(flip "$D" --apply FLIP); [ "$r" != 0 ] && same_as_original "$D" && ok "5b apply refused before the fork install" || bad "5b apply ran without the fork install (rc=$r)"

# 7. --approved-by-ceo: no TTY needed, logged, byte-identical round trip (rollback accepts it too)
fapp() { # fapp <dir> <mode> <quote>: plain bash, no pty
  CLAUDE_HOME="$1/claude" PROJECT_DIR="$1/proj" bash "$FLIP_SH" "$2" --approved-by-ceo "$3" </dev/null >"$1/out.app.$2.$$" 2>&1; echo $?
}
D="$T/g"; mkfix "$D"
r=$(fapp "$D" --apply "Фикс хуков запусти сам, не жди меня"); [ "$r" = 0 ] && ok "7a approved apply without TTY" || bad "7a approved apply rc=$r"
L="$D/proj/.tmp/hooks-flip-backup/approvals.log"
[ "$(wc -l < "$L" 2>/dev/null | tr -d ' ')" = 1 ] && grep -q -- "--approved-by-ceo.*Фикс хуков" "$L" && grep -q -- "--apply" "$L" && ok "7b one log line: date, mode, flag, quote" || bad "7b approvals.log wrong: $(cat "$L" 2>/dev/null)"
r=$(fapp "$D" --apply "Фикс хуков запусти сам, не жди меня"); [ "$r" != 0 ] && ok "7c second approved apply refused (F1 still holds)" || bad "7c second approved apply accepted"
r=$(fapp "$D" --rollback "Фикс хуков запусти сам, не жди меня"); [ "$r" = 0 ] && same_as_original "$D" && ok "7d approved rollback identical to the original" || bad "7d approved rollback rc=$r"
[ "$(wc -l < "$L" | tr -d ' ')" = 2 ] && ok "7e approved apply and rollback logged (2 lines; the refused run logs nothing)" || bad "7e log lines: $(wc -l < "$L")"

# 8. a missing or short quote does not replace the TTY
D="$T/h"; mkfix "$D"
r=$(fapp "$D" --apply "ok"); [ "$r" != 0 ] && same_as_original "$D" && [ ! -f "$D/proj/.tmp/hooks-flip-backup/approvals.log" ] && ok "8a short quote refused, nothing changed or logged" || bad "8a short quote accepted (rc=$r)"
CLAUDE_HOME="$D/claude" PROJECT_DIR="$D/proj" bash "$FLIP_SH" --apply --approved-by-ceo </dev/null >/dev/null 2>&1; r=$?
[ "$r" != 0 ] && same_as_original "$D" && ok "8b flag without a value refused" || bad "8b flag without a value accepted"

# 9. every refusal still applies to an approved apply
Q="Фикс хуков запусти сам, не жди меня"
refuse_case() { # refuse_case <name> <setup command run with $1=dir>
  local D="$T/r-$1"; mkfix "$D"; mkdir -p "$D/proj/.tmp"; eval "$2"
  local r; r=$(fapp "$D" --apply "$Q"); [ "$r" != 0 ] && same_as_original "$D" && ok "9 $1: approved apply refused" || bad "9 $1: approved apply ran (rc=$r)"
}
refuse_case charlotte-owner 'mkdir -p "$D/proj/.tmp/local-stack.lock"; echo "{\"label\":\"charlotte-regression\"}" > "$D/proj/.tmp/local-stack.lock/owner.txt"'
refuse_case stack-owner-held 'mkdir -p "$D/proj/.tmp/local-stack.lock"; echo "{\"label\":\"B3a-payments\",\"pid\":1}" > "$D/proj/.tmp/local-stack.lock/owner.txt"'
refuse_case paused-json 'mkdir -p "$D/proj/.planning/phases/9-x"; echo "{}" > "$D/proj/.planning/phases/9-x/PAUSED.json"'
refuse_case charlotte-lock-live 'echo "{\"pid\":$$}" > "$D/proj/.tmp/charlotte.lock"'
# flock held by another process (owner.txt empty, as after a clean release by a live holder is not the case: only the flock says held)
D="$T/r-flock"; mkfix "$D"; mkdir -p "$D/proj/.tmp"; : > "$D/proj/.tmp/local-stack.flock"
python3 -c 'import fcntl,sys,time;f=open(sys.argv[1]);fcntl.flock(f,fcntl.LOCK_EX);time.sleep(30)' "$D/proj/.tmp/local-stack.flock" & HP=$!
sleep 1; r=$(fapp "$D" --apply "$Q"); kill $HP 2>/dev/null; wait $HP 2>/dev/null
[ "$r" != 0 ] && same_as_original "$D" && ok "9 stack-flock-held: approved apply refused" || bad "9 stack-flock-held: ran (rc=$r)"
r=$(fapp "$D" --apply "$Q"); [ "$r" = 0 ] && ok "9 flock released: approved apply allowed again" || bad "9 flock released: still refused (rc=$r)"
# an OrbStack restart in flight
D="$T/r-orb"; mkfix "$D"
( exec -a "orbctl restart docker" sleep 20 ) & OP=$!
sleep 1; r=$(fapp "$D" --apply "$Q"); kill $OP 2>/dev/null; wait $OP 2>/dev/null
[ "$r" != 0 ] && same_as_original "$D" && ok "9 orbstack-restart: approved apply refused" || bad "9 orbstack-restart: ran (rc=$r)"

# 6. smoke wording: "(no output)" counts as EMPTY (F10)
out=$(bash "$FLIP_SH" --smoke --dry-run 2>&1); echo "$out" | grep -q "EMPTY" && ok "6 smoke dry-run lists the EMPTY row" || bad "6 smoke dry-run"
[ $fails = 0 ] && echo "flip-test: all pass" || { echo "flip-test: $fails FAIL"; exit 1; }
