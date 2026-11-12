# Sourced by the project hook wrappers: run lib/<name>.pl with the hook's stdin. Fails closed (exit 2)
# when perl is missing, the script crashes, runs past 10 s, or the command is over 32 KB (HookGuard::start);
# guard-authoring.md section 2 "Unreadable is FAIL".
SRC="${BASH_SOURCE[1]}"; D="${SRC%/*}"; [ "$D" = "$SRC" ] && D=.
HERE="$(cd "$D" 2>/dev/null && pwd)" || { echo "BLOCKED: cannot resolve the directory of the hook $SRC (fail closed)" >&2; exit 2; }
PERL=/usr/bin/perl; [ -x "$PERL" ] || PERL="$(command -v perl)"
[ -x "$PERL" ] || { echo "BLOCKED: perl not found, hook cannot parse its input (fail closed)" >&2; exit 2; }
"$PERL" -e 'alarm shift; exec @ARGV or exit 127' 10 "$PERL" -I"$HERE/lib" -MHookGuard \
  -e 'HookGuard::start(); my $f = shift; defined(my $r = do $f) or die($@ || "cannot run $f: $!\n")' "$HERE/lib/$1.pl"
rc=$?
case "$rc" in
  0|2) exit "$rc";;
  142) echo "BLOCKED: hook $1 ran past 10 s (a command the tokeniser cannot finish), failing closed" >&2; exit 2;;
  *) echo "BLOCKED: hook $1 crashed (rc=$rc), failing closed" >&2; exit 2;;
esac
