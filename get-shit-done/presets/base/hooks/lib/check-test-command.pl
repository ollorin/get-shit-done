# check-test-command: a command that runs a suite using the shared local stack must run under the stack lock
# (scripts/stack-lock.sh) or the session supervisor. The suites are the literals of `stack.locked_commands` in
# <project>/.planning/config.json; a literal of `stack.deploy.never_touch` is denied lock or no lock, read at run time from the git toplevel of the tool call's cwd. CLAUDE_PROJECT_DIR is
# never read: the canary runner points it at the hooks root, so reading it would see no fixture config and pass vacuously.
# Tokenised (ShellParse): quoted text, commit messages, heredoc bodies and redirect targets are never command words.
# A locked literal matches as an ordered subsequence of the command words: options, option values and other targets between its tokens
# (`npm --prefix web run test:e2e`, `make -C backend integration`, `make clean integration`) never hide it.
# Letter case never matters when a literal is matched (the default macOS volume is case-insensitive), and a word after `cd dir &&` is also tried as dir/word.
use strict; use warnings;
use ShellParse qw(parse_shell flatten read_input base);
use HookGuard qw(prepare toplevel);
use JSON::PP;
use B ();
use Cwd ();

sub fail_closed { print STDERR "BLOCKED: check-test-command (fail closed): $_[0]\n"; print STDERR "$_[1]\n" if defined $_[1]; exit 2 }
# JSON numbers decode to plain scalars; only a real string is a literal
sub is_string { my $v = shift; return 0 if !defined $v || ref $v; my $f = B::svref_2object(\$v)->FLAGS; return ($f & B::SVp_POK) && !($f & (B::SVp_IOK | B::SVp_NOK)) ? 1 : 0 }

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';    # a non-object tool_input dies here: run-perl.sh fails closed
my $cwd = $in->{cwd};
$cwd = '.' unless defined $cwd && !ref $cwd && length $cwd;

my ($root, $why) = toplevel($cwd);
fail_closed($why) unless defined $root;    # a cwd that does not exist, or any git failure other than "not a work tree"
exit 0 unless length $root;    # an existing directory outside any work tree: no config
my $cfg_file = "$root/.planning/config.json";
exit 0 unless -e $cfg_file;

my $cfg = do {
  open(my $fh, '<', $cfg_file) or fail_closed("cannot read $cfg_file");
  local $/; my $raw = <$fh>; close $fh;
  my $d = eval { JSON::PP->new->decode($raw // '') };
  fail_closed("$cfg_file is not valid JSON", '  Repair .planning/config.json with the Edit or Write tool; Bash stays blocked until it parses.')
    unless defined $d && ref $d eq 'HASH';
  $d;
};
my $stack = $cfg->{stack};
exit 0 unless defined $stack;
fail_closed('stack in .planning/config.json must be an object') unless ref $stack eq 'HASH';
sub literals {    # a list of non-empty strings as token lists; absent: none; any other shape: fail closed
  my ($v, $key) = @_;
  return () unless defined $v;
  fail_closed("$key must be an array of non-empty strings") unless ref $v eq 'ARRAY';
  return map { fail_closed("$key must be an array of non-empty strings") if !is_string($_) || $_ !~ /\S/; [split ' ', $_] } @$v;
}
my @literals = literals($stack->{locked_commands}, 'stack.locked_commands');
my $deploy = $stack->{deploy};
fail_closed('stack.deploy must be an object') if defined $deploy && ref $deploy ne 'HASH';
my @never = literals(($deploy // {})->{never_touch}, 'stack.deploy.never_touch');
exit 0 unless @literals || @never;

my ($cmds) = parse_shell($command);
my ($limit, @entries) = prepare($cmds, $cwd, flatten($cmds, $cwd));
fail_closed($limit) if $limit;

# Commands that read, print or edit their arguments and never run them: a listed literal there is data.
my %DATA = map { $_ => 1 } qw(echo printf cat head tail less more grep egrep fgrep rg ag ack wc ls stat file diff cmp
  sed awk gawk tee touch mkdir rm cp mv ln chmod man which type whereis test [ [[ true false read export set unset alias
  git jq tr cut sort uniq);

sub norm_word {    # a path word without `//`, `/./`, a leading `./` or a `dir/..` pair, so `tools/./release.sh` is `tools/release.sh`
  my ($w) = @_;
  return $w unless $w =~ m{/};
  1 while $w =~ s{/\./}{/}g || $w =~ s{//+}{/}g || $w =~ s{(?<![^/])(?!\.\.(?:/|$))[^/]+/\.\.(?:/|$)}{};
  $w =~ s{^(?:\./)+(?=.)}{};
  return $w;
}

sub tok_eq1 {    # a literal token equals a word, a path word that ends with it, or (slash-less literal) the basename of a path word; letter case never matters (the default macOS volume is case-insensitive)
  my ($lit, $word) = @_;
  $word = lc norm_word($word); $lit = lc norm_word($lit);
  return 1 if $word eq $lit;
  return 0 unless $word =~ m{/};
  return $lit =~ m{/} ? ($word =~ m{(?:^|/)\Q$lit\E$} ? 1 : 0) : (base($word) eq $lit ? 1 : 0);
}

# After `cd tools && ./release.sh` the word runs from the directory the parser tracked in $e->{dir}: the word is also tried as that path.
sub tok_eq {
  my ($lit, $word, $e) = @_;
  return 1 if tok_eq1($lit, $word);
  my $d = $e->{dir};
  return 0 unless defined $d && $d ne $cwd && $word !~ /^[-~]/;
  return tok_eq1($lit, lex_path($word =~ m{^/} ? $word : "$d/$word"));
}

# command words of an entry; a shell running a script (`bash x.sh`) has no `rest`, so its words are used
sub words_of {
  my ($e) = @_;
  return @{ $e->{rest} } if @{ $e->{rest} };
  return () if !$e->{facts}{shell} || @{ $e->{facts}{inner} || [] };
  my @w = @{ $e->{words} };
  my $k = 0; $k++ while $k < @w && ($w[$k] =~ /^\w+=/ || $w[$k] !~ /^(?:.*\/)?(?:sh|bash|zsh|dash)$/);
  return @w[$k .. $#w];
}

# The lock script is trusted only when it resolves to the repository's own scripts/ directory (relative, ./ or absolute); a lookalike
# elsewhere (/tmp/x/stack-lock.sh) exempts nothing, and then no entry of the command counts as locked.
sub lex_path {
  my @out;
  for my $s (split m{/}, $_[0]) { next if $s eq '' || $s eq '.'; if ($s eq '..') { pop @out } else { push @out, $s } }
  return '/' . join('/', @out);
}
sub lock_trusted {
  my ($e) = @_;
  my ($w) = grep { base($_) =~ /^(?:stack-lock\.(?:sh|ts)|session-supervisor\.sh)$/ } @{ $e->{words} };
  return 0 unless defined $w;
  my $dir = $e->{dir}; $dir = $cwd unless defined $dir && length $dir;
  return 0 unless $w =~ m{^/} || $dir =~ m{^/};
  my $abs = lex_path($w =~ m{^/} ? $w : "$dir/$w");
  my $want = lex_path("$root/scripts/" . base($w));
  return 1 if $abs eq $want;
  my ($ad, $wd) = map { my $d = $_; $d =~ s{/[^/]*$}{}; Cwd::realpath($d) // '' } $abs, $want;
  return length $ad && $ad eq $wd && base($abs) eq base($want) ? 1 : 0;
}
my $untrusted = (grep { $_->{wrapper} && !lock_trusted($_) } @entries) ? 1 : 0;

for my $e (@entries) {
  my @r = words_of($e);
  next unless @r;
  my $data = $DATA{ base($r[0]) };
  for my $lit (@never) {    # never-touch: the tokens in order anywhere in one command, under the lock or not
    next if $data && !tok_eq($lit->[0], $r[0], $e);
    my $k = 0;
    for my $w (@r) { $k++ if $k < @$lit && tok_eq($lit->[$k], $w, $e) }
    next unless $k == @$lit;
    print STDERR 'BLOCKED: `', join(' ', @$lit), "` is a never-touch deploy command (stack.deploy.never_touch): only the owner runs it.\n";
    exit 2;
  }
  next if $data || (!$untrusted && ($e->{wrapper} || $e->{locked}));
  for my $lit (@literals) {
    my $n = @$lit;
    for my $i (0 .. $#r) {
      next unless tok_eq($lit->[0], $r[$i], $e);
      my $j = 1;    # the next listed tokens in order; any word between them (an option and its value, a make target) is skipped
      for my $k ($i + 1 .. $#r) { last if $j >= $n; $j++ if tok_eq($lit->[$j], $r[$k], $e) }
      next unless $j == $n;
      print STDERR 'BLOCKED: `', join(' ', @$lit), "` runs a suite that uses the shared local stack (stack.locked_commands).\n",
        "  Run it under the stack lock or the session supervisor:\n",
        '  scripts/stack-lock.sh --label <x> -- ', join(' ', @r), "\n";
      exit 2;
    }
  }
}
exit 0;
