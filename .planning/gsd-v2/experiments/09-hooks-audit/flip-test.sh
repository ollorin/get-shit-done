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
export FLIP_PROCS_ROOT_PID=$$   # flip.sh judges only this test's own processes; the host may be running a real Charlotte/OrbStack job
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
  { sleep 2; printf '%s\n' "$3"; sleep 1; } | PATH="${FPP:+$FPP:}$PATH" CLAUDE_HOME="$d/claude" PROJECT_DIR="$d/proj" script -q /dev/null bash "$FLIP_SH" "$2" >"$d/out.$2.$$" 2>&1
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
  PATH="${FPP:+$FPP:}$PATH" CLAUDE_HOME="$1/claude" PROJECT_DIR="$1/proj" bash "$FLIP_SH" "$2" --approved-by-ceo "$3" </dev/null >"$1/out.app.$2.$$" 2>&1; echo $?
}
D="$T/g"; mkfix "$D"
r=$(fapp "$D" --apply "Фикс хуков запусти сам, не жди меня"); [ "$r" = 0 ] && ok "7a approved apply without TTY" || bad "7a approved apply rc=$r"
L="$D/proj/.tmp/gsd-v2/hooks-flip-backup/approvals.log"
[ "$(wc -l < "$L" 2>/dev/null | tr -d ' ')" = 1 ] && grep -q -- "--approved-by-ceo.*Фикс хуков" "$L" && grep -q -- "--apply" "$L" && ok "7b one log line: date, mode, flag, quote" || bad "7b approvals.log wrong: $(cat "$L" 2>/dev/null)"
r=$(fapp "$D" --apply "Фикс хуков запусти сам, не жди меня"); [ "$r" != 0 ] && ok "7c second approved apply refused (F1 still holds)" || bad "7c second approved apply accepted"
r=$(fapp "$D" --rollback "Фикс хуков запусти сам, не жди меня"); [ "$r" = 0 ] && same_as_original "$D" && ok "7d approved rollback identical to the original" || bad "7d approved rollback rc=$r"
[ "$(wc -l < "$L" | tr -d ' ')" = 2 ] && ok "7e approved apply and rollback logged (2 lines; the refused run logs nothing)" || bad "7e log lines: $(wc -l < "$L")"

# 8. a missing or short quote does not replace the TTY
D="$T/h"; mkfix "$D"
r=$(fapp "$D" --apply "ok"); [ "$r" != 0 ] && same_as_original "$D" && [ ! -f "$D/proj/.tmp/gsd-v2/hooks-flip-backup/approvals.log" ] && ok "8a short quote refused, nothing changed or logged" || bad "8a short quote accepted (rc=$r)"
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

# 10. smoke (B1): a stub `claude` that behaves like the real CLI: --allowedTools is variadic (swallows later positionals), -p without a
#     prompt is an error, stdin is consumed, config warnings go to stderr. Logs one line per call.
mkstub() { # mkstub <bindir> <log> <mode: good|rtkon|fail|noblock>
  mkdir -p "$1"; printf '%s' "$3" > "$1/mode"
  cat > "$1/claude" <<'STUB'
#!/bin/bash
HERE="$(cd "$(dirname "$0")" && pwd)"; mode=$(cat "$HERE/mode")
[ "$mode" = fail ] && exit 1
prompt=""; tools=0; seen_p=0; skip=0
for a in "$@"; do
  if [ $skip = 1 ]; then skip=0; continue; fi
  case "$a" in
    -p) seen_p=1; tools=0;;
    --model|--permission-mode) skip=1; tools=0;;
    --allowedTools) tools=1;;
    --*) tools=0;;
    *) if [ $tools = 1 ]; then :; elif [ $seen_p = 1 ] && [ -z "$prompt" ]; then prompt="$a"; fi;;
  esac
done
n=$(cat | wc -c | tr -d ' ')
echo "CALL stdin=$n prompt=$([ -n "$prompt" ] && echo yes || echo no)" >> "$STUB_LOG"
echo "Warning: permission rule 2121 ignored" >&2
[ -n "$prompt" ] || { echo "Error: Input must be provided either through stdin or as a prompt argument"; exit 1; }
case "$prompt" in
  *"git push"*) if [ -f "$PROJECT_DIR/.preflight-passed" ]; then echo "Everything up-to-date"; else echo "BLOCKED: preflight"; fi;;
  *disableAllHooks*) echo "BLOCKED: PROTECTED";;
  *"deno task test"*) echo "ok | 1 passed";;
  *"grep -rn"*) [ "$mode" = noblock ] && echo "no match" || echo "BLOCKED: use zg";;
  *"git grep -n foo"*) echo "no match";;
  *"grep -n foo"*) echo "no match";;
  *"wc -l"*) [ "$mode" = rtkon ] && echo "10" || echo "9999";;
  *LaunchAgents*) echo "(no output)";;
esac
STUB
  chmod +x "$1/claude"
}
smoke() { # smoke <dir> <mode> : prints rc; output in $1/smoke.out, stub log in $1/stub.log
  local d="$1"; : > "$d/stub.log"; mkstub "$d/stubbin" "$d/stub.log" "$2"
  PATH="$d/stubbin:$PATH" STUB_LOG="$d/stub.log" CLAUDE_HOME="$d/claude" PROJECT_DIR="$d/proj" bash "$FLIP_SH" --smoke </dev/null >"$d/smoke.out" 2>&1; echo $?
}
D="$T/s1"; mkfix "$D"
r=$(smoke "$D" good)
[ "$r" = 0 ] && grep -q "flip: smoke ok" "$D/smoke.out" && ok "10a smoke passes against a CLI that behaves like the real one" || bad "10a smoke rc=$r: $(tail -3 "$D/smoke.out")"
[ "$(grep -c '^CALL' "$D/stub.log")" = 8 ] && ok "10b smoke made all 8 calls (the loop's stdin was not consumed)" || bad "10b calls: $(grep -c '^CALL' "$D/stub.log")"
[ "$(grep -c 'stdin=0 ' "$D/stub.log")" = 8 ] && grep -q 'prompt=yes' "$D/stub.log" && ! grep -q 'prompt=no' "$D/stub.log" && ok "10c every call had empty stdin and a prompt not swallowed by --allowedTools" || bad "10c stub log: $(sort "$D/stub.log" | uniq -c | tr '\n' ';')"
grep -q "^ok .*EMPTY" "$D/smoke.out" && ok "10d CLI warnings on stderr do not turn the EMPTY row into WRONG" || bad "10d EMPTY row: $(grep EMPTY "$D/smoke.out")"
grep -q "final step" "$D/smoke.out" && ok "10e the main-session final step is printed in a live run too" || bad "10e final step missing from a live smoke run"
D="$T/s2"; mkfix "$D"
r=$(smoke "$D" rtkon)
[ "$r" != 0 ] && grep -q "^WRONG .*CMP>8000" "$D/smoke.out" && [ "$(grep -c '^WRONG' "$D/smoke.out")" = 1 ] && ok "10f RTK-on output with stderr digits (2121) is WRONG, nothing else is" || bad "10f rc=$r: $(cat "$D/smoke.out" | tr '\n' '|')"
D="$T/s3"; mkfix "$D"
r=$(smoke "$D" fail)
[ "$r" != 0 ] && grep -q "^WRONG .*EMPTY" "$D/smoke.out" && ok "10g a failing claude makes every row WRONG, including EMPTY (rc=$r)" || bad "10g rc=$r: $(cat "$D/smoke.out" | tr '\n' '|')"
D="$T/s4"; mkfix "$D"
r=$(smoke "$D" noblock)
[ "$r" != 0 ] && ok "10h a hook that does not block makes smoke exit non-zero" || bad "10h smoke passed although the grep row was not blocked"
D="$T/s5"; mkfix "$D"; touch "$D/proj/.preflight-passed"
r=$(smoke "$D" good)
[ "$r" = 0 ] && grep -q "^SKIP .*git push" "$D/smoke.out" && ok "10i a fresh .preflight-passed marker skips the push row instead of reporting WRONG" || bad "10i rc=$r: $(tail -4 "$D/smoke.out" | tr '\n' '|')"

# 11. backup and rollback failures (B2); cp stubs make the failure deterministic
mkcpstub() { # mkcpstub <bindir> <glob matched against cp's last argument>
  mkdir -p "$1"; printf '#!/bin/bash\nlast="${@: -1}"\ncase "$last" in %s) echo "cp: $last: Permission denied" >&2; exit 1;; esac\nexec /bin/cp "$@"\n' "$2" > "$1/cp"; chmod +x "$1/cp"
}
D="$T/b1"; mkfix "$D"; mkdir -p "$D/proj/.tmp"; chmod 555 "$D/proj/.tmp"
r=$(flip "$D" --apply FLIP); chmod 755 "$D/proj/.tmp"
[ "$r" != 0 ] && same_as_original "$D" && grep -q "nothing changed" "$D"/out.--apply.* && ok "11a unwritable backup dir: apply aborts, nothing changed" || bad "11a rc=$r: $(tail -2 "$D"/out.--apply.* | tr '\n' '|')"
D="$T/b2"; mkfix "$D"; mkcpstub "$D/cpstub" '*/hooks-flip-backup/*'
r=$(FPP="$D/cpstub" flip "$D" --apply FLIP)
[ "$r" != 0 ] && same_as_original "$D" && grep -q "backup failed; nothing changed" "$D"/out.--apply.* && ok "11b failed backup copy: apply aborts, nothing changed" || bad "11b rc=$r"
D="$T/b3"; mkfix "$D"; flip "$D" --apply FLIP >/dev/null; mkcpstub "$D/cpstub" '*settings.json*'
r=$(FPP="$D/cpstub" flip "$D" --rollback ROLLBACK)
[ "$r" != 0 ] && [ -f "$D/proj/.tmp/gsd-v2/hooks-flip-backup/applied" ] && ! grep -q "rolled back from" "$D"/out.--rollback.* && ok "11c failed restore: rollback exits non-zero, keeps the marker, does not say rolled back" || bad "11c rc=$r marker=$([ -f "$D/proj/.tmp/gsd-v2/hooks-flip-backup/applied" ] && echo kept || echo GONE): $(tail -2 "$D"/out.--rollback.* | tr '\n' '|')"
r=$(flip "$D" --rollback ROLLBACK); [ "$r" = 0 ] && same_as_original "$D" && ok "11d the retried rollback restores the original" || bad "11d retried rollback rc=$r"
python3 - "$D/claude/settings.json" <<'PY'
import json,sys;p=sys.argv[1];d=json.load(open(p));d['zzLaterRule']=1;json.dump(d,open(p,'w'),indent=2)
PY
cp "$D/claude/settings.json" "$D/later.json"
r=$(flip "$D" --rollback ROLLBACK)
[ "$r" != 0 ] && cmp -s "$D/claude/settings.json" "$D/later.json" && ok "11e second rollback refused: nothing applied, a later settings change survives" || bad "11e second rollback rc=$r changed the settings"

# 12. backups live under .tmp/gsd-v2 (B3), which the host cleanup keeps
D="$T/k"; mkfix "$D"; flip "$D" --apply FLIP >/dev/null
[ -f "$D/proj/.tmp/gsd-v2/hooks-flip-backup/latest" ] && [ -f "$D/proj/.tmp/gsd-v2/hooks-flip-backup/applied" ] && [ ! -e "$D/proj/.tmp/hooks-flip-backup" ] && ok "12 backup, latest and applied are under .tmp/gsd-v2/hooks-flip-backup" || bad "12 backup root: $(ls "$D/proj/.tmp" 2>&1 | tr '\n' ' ')"

# 13. a lock taken while the canaries run is caught before the first write (N2)
D="$T/n2"; mkfix "$D"
printf '#!/bin/bash\nmkdir -p "%s/proj/.tmp/local-stack.lock"; echo "{\\"label\\":\\"B3a-payments\\",\\"pid\\":1}" > "%s/proj/.tmp/local-stack.lock/owner.txt"\necho "canaries: pass=1 fail=0"\n' "$D" "$D" > "$D/proj/scripts/validation/hook-canaries/run-canaries.sh"
r=$(flip "$D" --apply FLIP)
[ "$r" != 0 ] && same_as_original "$D" && ok "13 lock taken during the canary run: apply refused, files untouched" || bad "13 apply ran although the stack lock was taken during the canaries (rc=$r)"

# 14. robustness (N9)
D="$T/n9a"; mkfix "$D"; chmod 555 "$D/claude"
r=$(flip "$D" --apply FLIP); chmod 755 "$D/claude"
r2=$(flip "$D" --apply FLIP)
[ "$r" != 0 ] && [ "$r2" = 0 ] && ok "14a failed first write leaves no 'applied' marker: the retry applies (rc $r then $r2)" || bad "14a first=$r retry=$r2"
D="$T/n9b"; mkfix "$D"; mkcpstub "$D/cpstub" '*/claude/RTK.md*'
r=$(FPP="$D/cpstub" flip "$D" --apply FLIP)
[ "$r" = 0 ] && grep -q "WARNING.*RTK.md" "$D"/out.--apply.* && ok "14b RTK.md write failure is reported, apply still completes" || bad "14b rc=$r: $(grep -c WARNING "$D"/out.--apply.*)"
D="$T/n9c"; mkfix "$D"; i1=$(ls -i "$D/claude/settings.json" | awk '{print $1}')
flip "$D" --apply FLIP >/dev/null; i2=$(ls -i "$D/claude/settings.json" | awk '{print $1}')
[ "$i1" != "$i2" ] && [ -z "$(ls "$D/claude" "$D/proj/.claude" | grep '\.flip\.')" ] && ok "14c settings are replaced by temp file + mv (new inode, no temp left)" || bad "14c inode $i1 -> $i2, leftovers: $(ls "$D/claude" "$D/proj/.claude" | grep '\.flip\.')"
D="$T/n9d"; mkfix "$D"
( exec -a "claude -p please run orbctl restart docker and nx start:dev" sleep 20 ) & CP=$!
sleep 1; r=$(fapp "$D" --apply "$Q"); kill $CP 2>/dev/null; wait $CP 2>/dev/null
[ "$r" = 0 ] && ok "14d prompt text naming orbctl/nx in a claude -p argv is not a restart" || bad "14d approved apply refused by prompt text (rc=$r)"
D="$T/n9f"; mkfix "$D"
( exec -a "bash -c orbctl restart docker" sleep 20 ) & CP=$!
sleep 1; r=$(fapp "$D" --apply "$Q"); kill $CP 2>/dev/null; wait $CP 2>/dev/null
[ "$r" != 0 ] && same_as_original "$D" && ok "14f a restart started through bash -c still refuses the apply" || bad "14f bash -c orbctl restart not seen (rc=$r)"
D="$T/n9e"; mkfix "$D"
( exec -a "deno run --allow-all runner/run.ts --tags=regression" sleep 20 ) & CP=$!
sleep 1; r=$(fapp "$D" --apply "$Q"); kill $CP 2>/dev/null; wait $CP 2>/dev/null
[ "$r" != 0 ] && same_as_original "$D" && ok "14e a running Charlotte runner (runner/run.ts) refuses the apply" || bad "14e apply ran beside a Charlotte runner (rc=$r)"

# 6. smoke wording: "(no output)" counts as EMPTY (F10)
out=$(bash "$FLIP_SH" --smoke --dry-run 2>&1); echo "$out" | grep -q "EMPTY" && ok "6 smoke dry-run lists the EMPTY row" || bad "6 smoke dry-run"
[ $fails = 0 ] && echo "flip-test: all pass" || { echo "flip-test: $fails FAIL"; exit 1; }
