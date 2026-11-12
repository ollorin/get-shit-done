# redirect-recursive-search: deny recursive / unbounded filesystem search from Bash.
# Deny: grep|egrep|fgrep|rg with -r/-R/--recursive (also inside a cluster with a context count: -2r, -n2r, -5rn; and -d rec,
#       --directories=recurse); rg, ag and ack with no file target (or a directory target) - they recurse by default;
#       find -exec/-execdir/-ok without a real -maxdepth option before the first action; `rtk grep` (lossy: 500 matches became 16 lines).
# Allow: non-recursive grep on named files or globs, wait loops, `git grep`, pipe-fed grep/rg,
#        `rtk proxy grep` by the same rules. Pipe-fed `rg` is allowed (it reads stdin, never walks the cwd).
use strict; use warnings;
use ShellParse qw(parse_shell flatten read_input base);
use HookGuard qw(prepare);

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
# fast path on the text with quotes and backslashes removed, so `"gr"ep`, `g''rep`, `gr\ep` still reach the parser
{ (my $flat = $command) =~ tr/'"\\//d; exit 0 unless $flat =~ /(?:grep|rg|find|ug|ag|ack|busybox|toybox)/; }
my ($cmds) = parse_shell($command);
my ($limit, @entries) = prepare($cmds, $in->{cwd} // '', flatten($cmds, $in->{cwd} // ''));
if ($limit) { print STDERR "BLOCKED: $limit\n"; exit 2 }

my %GREP_VAL = map { $_ => 1 } qw(-e -f -m -A -B -C -d -D);
my %RG_VAL   = map { $_ => 1 } qw(-e -f -g -t -T -A -B -C -m -j -M -r -E -d);
my %AG_VAL   = map { $_ => 1 } qw(-A -B -C -G -g -m -p -W);
# find options that take one value: a `-maxdepth` word in that position is data, not the option
my %FIND_VAL = map { ("-$_" => 1) } qw(name iname path ipath wholename iwholename regex iregex lname ilname type xtype user group perm newer
  size mtime atime ctime mmin amin cmin links inum samefile fstype printf fprintf fprint fls mindepth);
my %LONG_VAL = map { ("--$_" => 1) } qw(regexp file max-count after-context before-context context directories devices color colour context-separator ignore-file
  glob iglob type type-not threads replace max-depth max-filesize max-columns sort sortr pre pre-glob type-add
  type-clear colors engine encoding path-separator);

my ($why, $shape);
for my $e (@entries) {
  my @r = @{ $e->{rest} }; next unless @r;
  shift @r while @r > 1 && base($r[0]) =~ /^(?:busybox|toybox)$/;    # `busybox grep -r`: the applet is the command
  my $head = base($r[0]);
  if ($head =~ /^g?find$/) {
    my ($exec, $depth) = (0, 0);    # -maxdepth counts only as a real option placed before the first -exec/-ok action
    for (my $k = 1; $k < @r; $k++) {
      if ($r[$k] =~ /^-(?:exec|execdir|ok|okdir)$/) { $exec = 1; last }
      if ($r[$k] eq '-maxdepth') { $depth = 1 if ($r[$k + 1] // '') =~ /^\d+$/; $k++ }
      elsif ($FIND_VAL{ $r[$k] }) { $k++ }
    }
    if ($exec && !$depth) { $why = 'find -exec without -maxdepth walks the whole tree'; $shape = 'find'; last }
    next;
  }
  next unless $head =~ /^(?:grep|egrep|fgrep|ggrep|gegrep|gfgrep|zgrep|zegrep|zfgrep|bzgrep|xzgrep|pcregrep|pcre2grep|rg|ag|ack|ack-grep|ugrep|ug|rgrep)$/;
  if ($e->{facts}{rtk} eq 'lossy') { $why = '`rtk grep` is lossy (it truncates match lists and drops files), so its output is not evidence'; $shape = 'rtk'; last }
  my $isrg = ($head =~ /^(?:rg|ag|ack|ack-grep)$/);    # recurse by default and take their path words like rg
  my $valset = $head eq 'rg' ? \%RG_VAL : $isrg ? \%AG_VAL : \%GREP_VAL;
  my ($recursive, $have_pat, $helponly, @pos) = ($head eq 'rgrep' ? 1 : 0, 0, 0);
  for (my $k = 1; $k < @r; $k++) {
    my $a = $r[$k];
    if ($a eq '--') { push @pos, @r[$k + 1 .. $#r]; last }
    if ($a =~ /^--/) {
      # GNU/BSD getopt accept any unambiguous long-option prefix: --rec, --recurs, --dere, --dir=recurse, --directories=recurse
      $recursive = 1 if !$isrg && $a =~ /^--(?:rec(?:u(?:r(?:s(?:i(?:v(?:e)?)?)?)?)?)?|der(?:e(?:f(?:e(?:r(?:e(?:n(?:c(?:e(?:-(?:r(?:e(?:c(?:u(?:r(?:s(?:i(?:v(?:e)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)$/;
      $have_pat = 1 if $a =~ /^--(?:regexp|file)(?:=|$)/;
      $recursive = 1 if !$isrg && $a =~ /^--dir(?:e(?:c(?:t(?:o(?:r(?:i(?:e(?:s)?)?)?)?)?)?)?)?=rec(?:u(?:r(?:s(?:e)?)?)?)?$/;
      $recursive = 1 if !$isrg && $a =~ /^--dir(?:e(?:c(?:t(?:o(?:r(?:i(?:e(?:s)?)?)?)?)?)?)?)?$/ && ($r[$k + 1] // '') =~ /^rec(?:u(?:r(?:s(?:e)?)?)?)?$/;
      $helponly = 1 if $isrg && $a =~ /^--(?:help|version)$/;
      $k++ if $LONG_VAL{$a};
    } elsif ($a =~ /^-(.+)/) {
      my $cl = $1;
      $helponly = 1 if $isrg && $cl =~ /^[hV]$/;
      if (!$isrg) {    # walk the cluster: a digit (`-2r`, `-n2r`, `-5rn`) is a context count, -d takes its value (attached or the next word), A B C m D e f take theirs
        my @ch = split //, $cl;
        for my $ci (0 .. $#ch) {
          my $c = $ch[$ci];
          if ($c eq 'r' || $c eq 'R') { $recursive = 1; last }
          if ($c eq 'd') { my $v = $ci < $#ch ? substr($cl, $ci + 1) : ($r[$k + 1] // ''); $recursive = 1 if $v =~ /^rec(?:u(?:r(?:s(?:e)?)?)?)?$/; last }
          last if $c =~ /^[ABCmDef]$/;
        }
      }
      for my $ch (split //, $cl) {
        if ($valset->{"-$ch"}) { $have_pat = 1 if $ch eq 'e' || $ch eq 'f' || ($ch eq 'g' && $head =~ /^(?:ag|ack|ack-grep)$/); $k++ if $cl =~ /\Q$ch\E$/; last }
      }
    } else { push @pos, $a }
  }
  shift @pos unless $have_pat;
  if ($recursive) { $why = "recursive $head reads the whole tree"; $shape = 'recursive'; last }
  if ($isrg) {
    next if $e->{piped} || $e->{facts}{xargs} || $helponly || grep { /^<[^<]|^<<</ } @{ $e->{redirs} };
    my $dirdir = grep { $_ eq '.' || $_ eq '..' || m{/$} || -d (m{^~} ? ($_ =~ s{^~}{$ENV{HOME}}r) : m{^/} ? $_ : ($e->{dir} // '.') . "/$_") } @pos;
    if (!@pos || $dirdir) { $why = @pos ? "$head on a directory recurses" : "$head without an explicit file target walks the cwd"; $shape = 'rg'; last }
  }
}

if ($why) {
  print STDERR <<"MSG";
BLOCKED: $why.
  Search instead:          {{stack.commands.search}} <pattern> -- <path>
  Symbols:                 the LSP tool (workspaceSymbol / findReferences / goToDefinition)
  Still allowed: grep on named files or globs (no -r), 'until grep -q ...' wait loops, git grep, pipe-fed grep.
MSG
  exit 2;
}
exit 0;
