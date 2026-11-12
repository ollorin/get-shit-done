# Shared guards of the Bash hooks, kept out of ShellParse.pm (which stays byte-equal to its source).
#   start()        run-perl.sh calls it before a hook script: drops the GIT_* variables that redirect git, then denies
#                  (exit 2) a command longer than 32 KB, because the tokeniser is quadratic on nested $( ... ).
#   prepare()      flatten()'s entries -> (limit reason, entries + the commands behind wrappers the tokeniser does not know).
#                  The tokeniser gives up silently at 20 command-word prefixes and at 12 nesting levels; a command that
#                  hits either limit has an unjudged tail, so the hooks deny it instead of trusting what was seen.
#   toplevel()     the git toplevel of a cwd, telling "not in a work tree" (allowed by the caller) from any other failure.
package HookGuard;
use strict;
use warnings;
use Exporter 'import';
use JSON::PP;
use B ();
use ShellParse qw(parse_shell flatten run_capture base);
our @EXPORT_OK = qw(start prepare fallback_entries toplevel);

my $MAX_COMMAND = 32768;
my @GIT_ENV = qw(GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
  GIT_NAMESPACE GIT_CEILING_DIRECTORIES GIT_PREFIX);

sub _is_string {    # JSON::PP gives numbers an IOK/NOK flag and no POK flag; null is undef; true/false and containers are refs
  my ($v) = @_;
  return 0 if !defined $v || ref $v;
  my $f = B::svref_2object(\$v)->FLAGS;
  return ($f & B::SVf_POK()) && !($f & (B::SVf_IOK() | B::SVf_NOK())) ? 1 : 0;
}

sub start {
  delete @ENV{@GIT_ENV};
  local $/; my $raw = <STDIN>; $raw //= '';
  my $d = eval { JSON::PP->new->decode($raw) };
  my $c = (ref $d eq 'HASH' && ref $d->{tool_input} eq 'HASH') ? $d->{tool_input}{command} : undef;
  # A Bash call whose command is a number, null, boolean, array or object has no text to judge: every Bash hook would otherwise stringify it and allow.
  if (ref $d eq 'HASH' && ref $d->{tool_input} eq 'HASH' && ($d->{tool_name} // '') eq 'Bash' && !_is_string($c)) {
    print STDERR "BLOCKED: the Bash command is not a JSON string (fail closed): the hooks cannot judge it\n";
    exit 2;
  }
  if (defined $c && !ref $c) {
    my $n = do { use bytes; length $c };
    if ($n > $MAX_COMMAND) {
      print STDERR "BLOCKED: the command is $n bytes, over the $MAX_COMMAND-byte limit the hooks can judge (fail closed). Split it or put it in a script file.\n";
      exit 2;
    }
  }
  # A NUL or another control character (all but tab and newline) ends or splits what the tokeniser reads, so what it judges may differ from what the shell runs.
  if (defined $c && !ref $c && $c =~ /([\x00-\x08\x0b-\x1f\x7f])/) {
    printf STDERR "BLOCKED: the command holds a control character (byte 0x%02x): the hooks cannot judge it (fail closed)\n", ord $1;
    exit 2;
  }
  close STDIN;
  open(STDIN, '<', \$raw) or die "cannot re-open stdin: $!";
}

my %WRAP = map { $_ => 1 } qw(rtk exec function sudo command nohup builtin noglob stdbuf caffeinate watch npx bunx env nice
  timeout gtimeout xargs eval { } ! if then else elif fi do done time while until for case esac);

# '' when the tokeniser saw the whole command, else a reason naming the limit that was hit.
sub _limit_reason {
  my ($cmds, $cwd, $entries) = @_;
  for my $e (@$entries) {
    my @r = @{ $e->{rest} }; next unless @r;
    my $b = base($r[0]);
    return 'the command word is behind 20 or more prefixes (assignments or wrappers): the tokeniser stops unwrapping at 20, so the real command is not judged'
      if $r[0] =~ /^[A-Za-z_]\w*=/ || $WRAP{ $r[0] } || $WRAP{$b} || ($b =~ /^(?:npm|pnpm|yarn)$/ && ($r[1] // '') =~ /^(?:exec|dlx)$/);
  }
  my $nested = grep { @{ $_->{facts}{inner} } || $_->{facts}{shell} || $_->{wrapper} || (@{ $_->{rest} } && base($_->{rest}[0]) eq 'find') } @$entries;
  return '' unless $nested;
  my @deeper = flatten($cmds, $cwd, -1);
  return @deeper > @$entries ? 'the command nests shells, eval or wrappers more than 12 levels deep: the tokeniser stops expanding at 12, so the inner commands are not judged' : '';
}


# Wrappers ShellParse::_unwrap does not know: options that take a value, positional words to skip before the command, and whether
# the wrapped command may also come as a `-c STRING`. The fixed lists live here so ShellParse.pm stays byte-equal to its source.
my %WRAPPER = (
  ionice  => { val => { map { $_ => 1 } qw(-c -n -p -P -u --class --classdata --pid --pgid --uid) }, pos => 0 },
  setsid  => { val => {}, pos => 0 },
  arch    => { val => { map { $_ => 1 } qw(-e -d) }, pos => 0 },
  xcrun   => { val => { map { $_ => 1 } qw(-sdk --sdk -toolchain --toolchain) }, pos => 0 },
  flock   => { val => { map { $_ => 1 } qw(-w -E --timeout --wait --conflict-exit-code) }, pos => 1, c => 1 },
  taskset => { val => { map { $_ => 1 } qw(-c --cpu-list) }, pos => 1, posless => qr/^(?:-c|--cpu-list)$/ },
  chrt    => { val => {}, pos => 1 },
  unbuffer => { val => {}, pos => 0 },
  script  => { val => { map { $_ => 1 } qw(-t -T) }, pos => 1, c => 1 },
  su      => { val => { map { $_ => 1 } qw(-s -g -G --shell --group --supp-group) }, pos => 0, c => 1, all => 1 },
  parallel => { val => { map { $_ => 1 } qw(-j -n -N -S -a -L -l -I --jobs --max-args --sshlogin --arg-file) }, pos => 0, until => qr/^::::?$/ },
);

# (\@command words | undef, @inner strings): what the wrapper at $r[0] runs. A leading option word that no command can start with
# (`time -p`, `command --`, `exec -c`, `nice --adjustment=5` once ShellParse has taken the wrapper word) is dropped.
sub _strip {
  my @r = @_;
  my $w = $WRAPPER{ base($r[0]) };
  unless ($w) {
    return unless $r[0] =~ /^-/;
    my $i = 0; $i++ while $i < @r && $r[$i] =~ /^-/;
    return ($i < @r ? [@r[$i .. $#r]] : undef);
  }
  my @inner;
  if ($w->{c}) {
    for my $k (1 .. $#r - 1) { push @inner, $r[$k + 1] if $r[$k] =~ /^-[A-Za-z]*c$/ || $r[$k] eq '--command'; last if !$w->{all} && $r[$k] !~ /^-/ && $k > 1 }
  }
  my ($i, $pos) = (1, $w->{pos});
  while ($i < @r && $r[$i] =~ /^-/) {
    if ($r[$i] eq '--') { $i++; last }
    $pos = 0 if $w->{posless} && $r[$i] =~ $w->{posless};
    $i += $w->{val}{ $r[$i] } ? 2 : 1;
  }
  $i += $pos;
  my @cmd = $i <= $#r ? @r[$i .. $#r] : ();
  if ($w->{until}) { for my $k (0 .. $#cmd) { if ($cmd[$k] =~ $w->{until}) { @cmd = @cmd[0 .. $k - 1]; last } } }
  push @inner, $cmd[0] if @cmd == 1 && $cmd[0] =~ /\s/;
  return (\@cmd, @inner) if @cmd;
  return (undef, @inner);
}

sub _derive {    # a command-word list under entry $e -> that command's entries (unwrapped like a top-level command)
  my ($e, $words) = @_;
  my ($rest, $f) = ShellParse::_unwrap($words);
  my @new = ({ %$e, words => $words, rest => $rest, facts => $f });
  for my $s (@{ $f->{inner} }) { my ($c) = parse_shell($s); push @new, flatten($c, $e->{dir}, 1) }
  return @new;
}

my $MAX_DERIVED = 2000;

# (reason, entries): the tokeniser's entries plus the commands behind the wrappers above. A reason is returned when
# a tokeniser limit was hit or the wrapping is so deep that the derived entries exceed the cap.
sub prepare {
  my ($cmds, $cwd, @entries) = @_;
  my $why = _limit_reason($cmds, $cwd, \@entries);
  my @out = @entries; my $n = 0;
  for (my $i = 0; $i < @out; $i++) {
    my @r = @{ $out[$i]{rest} }; next unless @r;
    my ($cmd, @inner) = _strip(@r);
    next unless $cmd || @inner;
    return ($why || "the command is wrapped more than $MAX_DERIVED times: it is not judged", @out) if ++$n > $MAX_DERIVED;
    push @out, _derive($out[$i], $cmd) if $cmd;
    for my $s (@inner) { my ($c) = parse_shell($s); push @out, flatten($c, $out[$i]{dir}, 1) }
  }
  return ($why, @out);
}

my %DATA_HEAD = map { $_ => 1 } qw(echo printf cat head tail less more grep egrep fgrep rg ag ack wc ls stat file diff cmp
  sed awk gawk tee touch mkdir cp mv ln chmod man which type whereis test [ [[ true false read export set unset alias jq tr cut sort uniq
  git rm sudo doas);
my %DAMAGING = map { $_ => 1 } qw(git rm sudo doas);

# Fallback lane for an unknown wrapper: when the command word is not a reader or a tool judged on its own, any later word that is
# git, rm, sudo or doas is judged as a command word. A later word holding a space is parsed as a command line only when it is the
# first argument (`wrapper 'git reset --hard'`) or follows a shell evaluator (`sh -c`, eval, xargs, env -S, watch, timeout,
# nohup, exec, sudo); a quoted sentence given to an option of an arbitrary program (`--title "deny sudo ls"`) is data.
# Returns (reason, entries); a reason means more than $MAX_DERIVED command lines were derived.
my %EVALUATOR = map { $_ => 1 } qw(eval xargs watch timeout gtimeout nohup exec sudo doas);
my %SHELL = map { $_ => 1 } qw(bash sh zsh dash ksh);
sub fallback_entries {
  my @src = @_; my @out; my ($n, $why) = (0, '');
  for (my $i = 0; $i < @src; $i++) {
    my $e = $src[$i]; my @w = @{ $e->{rest} }; next unless @w;
    next if $DATA_HEAD{ base($w[0]) };
    my $eval = 0;
    for my $k (1 .. $#w) {
      my $b = base($w[$k]); my @d;
      if ($DAMAGING{$b}) { @d = _derive($e, [@w[$k .. $#w]]) }
      elsif ($w[$k] =~ /\s/ && ($k == 1 || $eval)) { my ($c) = parse_shell($w[$k]); @d = flatten($c, $e->{dir}, 1) }
      $eval = 1 if $EVALUATOR{$b} || ($SHELL{$b} && grep { /^-[A-Za-z]*c$/ } @w[$k + 1 .. $#w]) || ($b eq 'env' && grep { /^(?:-[A-Za-z]*S|--split-string)/ } @w[$k + 1 .. $#w]);
      next unless @d;
      if (++$n > $MAX_DERIVED) { $why = "the command has more than $MAX_DERIVED command lines behind an unknown wrapper: it is not judged"; last }
      push @out, @d; push @src, @d;
    }
    last if $why;
  }
  return ($why, @out);
}

# (root, '') in a work tree; ('', '') when the directory exists and is genuinely not in a work tree; (undef, reason) otherwise.
sub toplevel {
  my ($cwd) = @_;
  return (undef, "the working directory '$cwd' does not exist") unless defined $cwd && -d $cwd;
  my ($out, $st) = run_capture($cwd, 1, 'git', '-C', $cwd, 'rev-parse', '--show-toplevel');
  $out =~ s/\s+\z//;
  return ($out, '') if $st == 0 && length $out;
  return ('', '') if $out =~ /not a git repository|must be run in a work tree/;
  my ($first) = split /\n/, $out;
  return (undef, "git could not resolve the repository of '$cwd' (status $st" . (defined $first && length $first ? ": $first" : '') . ')');
}

1;
