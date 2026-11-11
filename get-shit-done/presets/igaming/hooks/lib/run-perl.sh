# Sourced by the project hook wrappers: run lib/<name>.pl with the hook's stdin. Fails closed (exit 2)
# when perl is missing or the script crashes; guard-authoring.md section 2 "Unreadable is FAIL".
HERE="$(cd "${BASH_SOURCE[1]%/*}" && pwd)"
PERL=/usr/bin/perl; [ -x "$PERL" ] || PERL="$(command -v perl)"
[ -x "$PERL" ] || { echo "BLOCKED: perl not found, hook cannot parse its input (fail closed)" >&2; exit 2; }
"$PERL" -I"$HERE/lib" "$HERE/lib/$1.pl"
rc=$?
case "$rc" in 0|2) exit "$rc";; *) echo "BLOCKED: hook $1 crashed (rc=$rc), failing closed" >&2; exit 2;; esac
