# redirect-recursive-search: deny recursive / unbounded filesystem search from Bash (RULING R1).
# Deny: grep|egrep|fgrep|rg with -r/-R/--recursive; rg with no file target (or a directory target);
#       find -exec/-execdir/-ok without -maxdepth; `rtk grep` (lossy: 500 matches became 16 lines).
# Allow: non-recursive grep on named files or globs, wait loops, `git grep`, pipe-fed grep/rg,
#        `rtk proxy grep` by the same rules, `zg ...`. Deviation noted in RESULT.md: pipe-fed `rg` is
#        allowed (it reads stdin, never walks the cwd).
use strict; use warnings;
use ShellParse qw(parse_shell flatten read_input base);

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
# fast path on the text with quotes and backslashes removed, so `"gr"ep`, `g''rep`, `gr\ep` still reach the parser
{ (my $flat = $command) =~ tr/'"\\//d; exit 0 unless $flat =~ /(?:grep|rg|find)/; }
my ($cmds) = parse_shell($command);
my @entries = flatten($cmds, $in->{cwd} // '');

my %GREP_VAL = map { $_ => 1 } qw(-e -f -m -A -B -C -d -D);
my %RG_VAL   = map { $_ => 1 } qw(-e -f -g -t -T -A -B -C -m -j -M -r -E -d);
my %LONG_VAL = map { ("--$_" => 1) } qw(regexp file max-count after-context before-context context directories devices color colour context-separator ignore-file
  glob iglob type type-not threads replace max-depth max-filesize max-columns sort sortr pre pre-glob type-add
  type-clear colors engine encoding path-separator);

my ($why, $shape);
for my $e (@entries) {
  my @r = @{ $e->{rest} }; next unless @r;
  my $head = base($r[0]);
  if ($head eq 'find') {
    my $exec = grep { /^-(?:exec|execdir|ok|okdir)$/ } @r;
    my $depth = grep { /^-maxdepth$/ } @r;
    if ($exec && !$depth) { $why = 'find -exec without -maxdepth walks the whole tree'; $shape = 'find'; last }
    next;
  }
  next unless $head =~ /^(?:grep|egrep|fgrep|rg|ugrep|ug|rgrep)$/;
  if ($e->{facts}{rtk} eq 'lossy') { $why = '`rtk grep` is lossy (it truncates match lists and drops files), so its output is not evidence'; $shape = 'rtk'; last }
  my $isrg = ($head eq 'rg');
  my $valset = $isrg ? \%RG_VAL : \%GREP_VAL;
  my ($recursive, $have_pat, $helponly, @pos) = ($head eq 'rgrep' ? 1 : 0, 0, 0);
  for (my $k = 1; $k < @r; $k++) {
    my $a = $r[$k];
    if ($a eq '--') { push @pos, @r[$k + 1 .. $#r]; last }
    if ($a =~ /^--/) {
      # GNU/BSD getopt accept any unambiguous long-option prefix: --rec, --recurs, --dere, --dir=recurse, --directories=recurse
      $recursive = 1 if !$isrg && $a =~ /^--(?:rec(?:u(?:r(?:s(?:i(?:v(?:e)?)?)?)?)?)?|der(?:e(?:f(?:e(?:r(?:e(?:n(?:c(?:e(?:-(?:r(?:e(?:c(?:u(?:r(?:s(?:i(?:v(?:e)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)$/;
      $have_pat = 1 if $a =~ /^--(?:regexp|file)(?:=|$)/;
      $recursive = 1 if !$isrg && $a =~ /^--dir(?:e(?:c(?:t(?:o(?:r(?:i(?:e(?:s)?)?)?)?)?)?)?)?=recurse$/;
      $recursive = 1 if !$isrg && $a =~ /^--dir(?:e(?:c(?:t(?:o(?:r(?:i(?:e(?:s)?)?)?)?)?)?)?)?$/ && ($r[$k + 1] // '') eq 'recurse';
      $helponly = 1 if $isrg && $a =~ /^--(?:help|version)$/;
      $k++ if $LONG_VAL{$a};
    } elsif ($a =~ /^-(.+)/) {
      my $cl = $1;
      $recursive = 1 if !$isrg && $cl =~ /^[A-Za-z]*[rR]/ && $cl !~ /^[ABCmdDef]/;
      $recursive = 1 if !$isrg && $cl =~ /^drecurse/;
      $helponly = 1 if $isrg && $cl =~ /^[hV]$/;
      if (!$isrg && $cl =~ /^d$/ && ($r[$k + 1] // '') eq 'recurse') { $recursive = 1 }
      for my $ch (split //, $cl) {
        if ($valset->{"-$ch"}) { $have_pat = 1 if $ch eq 'e' || $ch eq 'f'; $k++ if $cl =~ /\Q$ch\E$/; last }
      }
    } else { push @pos, $a }
  }
  shift @pos unless $have_pat;
  if ($recursive) { $why = "recursive $head reads the whole tree"; $shape = 'recursive'; last }
  if ($isrg) {
    next if $e->{piped} || $e->{facts}{xargs} || $helponly || grep { /^<[^<]|^<<</ } @{ $e->{redirs} };
    my $dirdir = grep { $_ eq '.' || $_ eq '..' || m{/$} || -d (m{^~} ? ($_ =~ s{^~}{$ENV{HOME}}r) : m{^/} ? $_ : ($e->{dir} // '.') . "/$_") } @pos;
    if (!@pos || $dirdir) { $why = @pos ? 'rg on a directory recurses' : 'rg without an explicit file target walks the cwd'; $shape = 'rg'; last }
  }
}

if ($why) {
  print STDERR <<"MSG";
BLOCKED: $why.
  Exact sweep of a path:   git grep -n <pattern> -- <path>     |   zg query --rg -F <pattern> <path>
  Discovery / by meaning:  zg query "<text>"   (hybrid keyword+semantic; run 'zg index' if stale)
  Symbols:                 the LSP tool (workspaceSymbol / findReferences / goToDefinition)
  Still allowed: grep on named files or globs (no -r), 'until grep -q ...' wait loops, git grep, pipe-fed grep.
MSG
  exit 2;
}
exit 0;
