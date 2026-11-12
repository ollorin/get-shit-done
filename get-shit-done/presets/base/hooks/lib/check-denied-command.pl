# check-denied-command: the tokenised twin of the settings deny and ask rows. A permission row stops one literal
# spelling; this hook stops the same command behind `git -C`, `git -c`, a trailing flag, a split or reordered flag
# cluster, `env`, `bash -c` or a path prefix. It adds no policy of its own, and it is a steer, not a boundary:
# a variable assembled at run time or a script that runs the command is not chased.
# deny: sudo/doas as a command word (also with no command after it: `sudo -i`), su (login or `su -c`); recursive rm of the root,
#       the home directory, the working directory (also spelled $HOME, $PWD, ~), a bare glob (`*`, `.*`) or a command substitution
#       (`rm -rf $(pwd)`: the target is not known); a command with a control character (NUL ... , HookGuard::start);
#       git push with --force/-f or a +refspec; git reset --hard; a forced git clean that is not a dry run;
#       git grep -O / --open-files-in-pager (it runs the given command); git -c <key> for a key that names a command to run;
#       a reader command (cat, grep, jq ...) given a .env file, a path under a secrets/ directory, ~/.ssh, ~/.gnupg, the
#       cloud CLI credentials directory, ~/.config/gh, .npmrc, .git-credentials, *.pem, *.key or id_rsa*-style keys (names matched case-insensitively).
#       For grep-family commands, sed, awk and jq the pattern, program or filter (the first positional, or the -e/-f/--regexp/--file value) is
#       not a file and is not judged (file_words); the file arguments and the value of -f/--file are.
# ask:  git rebase, git pull --rebase.
# Long options are matched by their unambiguous prefixes (`reset --h`, `clean --fo`, `pull --reb`, `rm --rec`). A command word the
# hook does not know (an unknown wrapper) is scanned for later git, rm, sudo and doas words and for quoted command lines (HookGuard).
# Known limits of the frozen tokeniser (ShellParse.pm), not judged here: `(( $(sudo ls) ))`, nested escaped backticks, brace expansion
# `{sudo,ls}`, ANSI-C quoting `$'\x2df'` and a glob in the command word (`su[d]o`).
use strict; use warnings;
use ShellParse qw(parse_shell flatten git_calls read_input base);
use HookGuard qw(prepare fallback_entries);
use JSON::PP;

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';    # a non-object tool_input dies here: run-perl.sh fails closed
my $cwd = $in->{cwd};
$cwd = '.' unless defined $cwd && !ref $cwd && length $cwd;
my ($cmds) = parse_shell($command);
my ($limit, @entries) = prepare($cmds, $cwd, flatten($cmds, $cwd));

sub deny { print STDERR "BLOCKED: $_[0]\n"; exit 2 }
sub ask { print encode_json({ hookSpecificOutput => { hookEventName => 'PreToolUse', permissionDecision => 'ask', permissionDecisionReason => $_[0] } }), "\n"; exit 0 }

deny($limit) if $limit;
my ($scan, @tail) = fallback_entries(@entries);
deny($scan) if $scan;
push @entries, @tail;

# A recursive rm target that is a whole tree: / ~ $HOME . .. or a glob, reached through any run of `.` `..` `*` `**` segments
# (`/.`, `~/.`, `./.`, `../..`, `/*/`, `**`). A named directory anywhere in the path makes it a named target.
sub root_like {
  my ($t) = @_;
  my @seg = grep { length } split m{/+}, $t;
  shift @seg if @seg && $seg[0] =~ /^(?:~\w*|\$\{?(?:HOME|PWD|OLDPWD)\}?)$/;
  return (grep { $_ !~ /^(?:\.|\.\.|\.\*|\*\*?)$/ } @seg) ? 0 : 1;
}
my %READER = map { $_ => 1 } qw(cat head tail less more grep egrep fgrep rg sed awk cut tr wc sort uniq nl tac strings xxd od
  hexdump base64 jq yq diff cmp source . bat rev paste column fold fmt comm join pr ag ack ug ugrep zgrep pcregrep);
my %COPY = map { $_ => 1 } qw(cp mv ln install rsync scp);    # the last word is the destination: writing .env from a template is fine
sub glob_re { my $g = quotemeta(shift); $g =~ s/\\\*/.*/g; $g =~ s/\\\?/./g; return qr/^$g$/ }
sub secret_path {
  my ($w) = @_;
  return 0 if $w =~ /^-/;
  my @seg = map { lc } grep { length } split m{/}, $w;
  return 0 unless @seg;
  my $b = pop @seg;
  return 1 if grep { $_ eq 'secrets' } @seg;
  return 1 if grep { /^\.(?:ssh|a[w]s|gnupg)$/ } @seg, $b;
  return 1 if grep { $seg[$_] eq '.config' && ($seg[$_ + 1] // $b) eq 'gh' } 0 .. $#seg;
  return 1 if $b =~ /^\.(?:npmrc|git-credentials)$/ || $b =~ /\.(?:pem|key)$/ || $b =~ /^id_(?:rsa|dsa|ecdsa|ed25519)/;
  return 1 if $b eq '.env';
  if ($b =~ /^\.[^\/]*[*?]/ ) { my $re = glob_re($b); return 1 if '.env' =~ $re || '.env.local' =~ $re }
  return ($b =~ /^\.env\./ && $b !~ /^\.env[^\/]*\.(?:example|sample|template|dist)$/) ? 1 : 0;
}

# Commands whose first positional is a pattern, program or filter (not a file): `grep foo f`, `sed -n p f`, `awk '{print}' f`, `jq .k f`.
# sv: short options that take a separate or attached value; pat: short options whose value is the pattern or program; file: short options
# whose value is a file; stop: a short option that ends the cluster (its rest is attached). lv: long options by name, kind v (value skipped),
# p (value is the pattern), f (value is a file), 2 (name and value skipped), sf (name skipped, then a file).
my %GREP_LONG = map { $_ => 'v' } qw(after-context before-context context max-count directories devices include exclude exclude-from exclude-dir label binary-files group-separator);
my %GREP_SPEC = (sv => 'ABCmdD', pat => 'e', file => 'f', stop => '', lv => { %GREP_LONG, regexp => 'p', file => 'f' });
my %PATTERN_SPEC = (
  (map { $_ => \%GREP_SPEC } qw(grep egrep fgrep zgrep pcregrep ug ugrep ag ack)),
  rg => { sv => 'ABCmgtTjMrEd', pat => 'e', file => 'f', stop => '', lv => { %GREP_LONG, regexp => 'p', file => 'f',
    map { $_ => 'v' } qw(glob iglob type type-not threads max-columns replace encoding max-depth max-filesize sort sortr ignore-file pre pre-glob path-separator) } },
  sed => { sv => 'l', pat => 'e', file => 'f', stop => 'i', lv => { expression => 'p', file => 'f', 'line-length' => 'v', 'in-place' => '' } },
  awk => { sv => 'Fv', pat => '', file => 'f', stop => '', lv => { file => 'f', 'field-separator' => 'v', assign => 'v', source => 'p', include => 'v', load => 'v' } },
  jq => { sv => 'L', pat => '', file => 'f', stop => '', lv => { arg => '2', argjson => '2', slurpfile => 'sf', rawfile => 'sf', indent => 'v', 'from-file' => 'f' } },
);
$PATTERN_SPEC{gawk} = $PATTERN_SPEC{awk}; $PATTERN_SPEC{yq} = $PATTERN_SPEC{jq};
# The words of a reader command that may name a file: every word, minus the pattern/program/filter and the values of options that take one.
sub file_words {
  my ($tool, @a) = @_;
  my $spec = $PATTERN_SPEC{$tool} or return @a;
  my ($i, $opts, $pat, @pos, @files) = (0, 1, 0);
  while ($i < @a) {
    my $w = $a[$i++];
    if ($opts && $w eq '--') { $opts = 0; next }
    if ($opts && $w =~ /^--(.+)$/s) {
      my ($name, $val) = split /=/, $1, 2;
      my $key = exists $spec->{lv}{$name} ? $name : (grep { index($_, $name) == 0 } sort keys %{ $spec->{lv} })[0];
      my $kind = defined $key ? $spec->{lv}{$key} : '';
      next unless length $kind;
      if (defined $val) { push @files, $val if $kind eq 'f'; $pat = 1 if $kind eq 'p' || $kind eq 'f'; next }
      if ($kind eq '2' || $kind eq 'sf') { my $name_arg = $a[$i++]; my $v = $a[$i++]; push @files, $v if $kind eq 'sf' && defined $v; next }
      my $v = $a[$i++];
      push @files, $v if $kind eq 'f' && defined $v;
      $pat = 1 if $kind eq 'p' || $kind eq 'f';
      next;
    }
    if ($opts && $w =~ /^-(.+)$/s) {
      my @l = split //, $1;
      for my $n (0 .. $#l) {
        my $c = $l[$n];
        last if index($spec->{stop}, $c) >= 0;
        my $kind = index($spec->{sv}, $c) >= 0 ? 'v' : index($spec->{pat}, $c) >= 0 ? 'p' : index($spec->{file}, $c) >= 0 ? 'f' : '';
        next unless length $kind;
        my $rest = join '', @l[$n + 1 .. $#l];
        my $v = length $rest ? $rest : $a[$i++];
        push @files, $v if $kind eq 'f' && defined $v;
        $pat = 1 if $kind eq 'p' || $kind eq 'f';
        last;
      }
      next;
    }
    push @pos, $w;
  }
  shift @pos if !$pat && @pos;
  @pos = grep { !/^\w+=/ } @pos if $tool =~ /^g?awk$/;
  return (@pos, @files);
}

for my $e (@entries) {
  my @r = @{ $e->{rest} };
  my @w = @{ $e->{words} };
  my @prefix = @w[0 .. $#w - @r];    # all of @w when sudo (or its options alone) is the whole command
  deny('sudo is never run by an agent: ask the owner to run the command') if grep { base($_) eq 'sudo' } @prefix;
  next unless @r;
  my $h = base($r[0]);
  deny('doas is never run by an agent: ask the owner to run the command') if $h eq 'doas';
  deny('su runs commands as another user and is never run by an agent (also `su -c`): ask the owner to run the command') if $h eq 'su';
  if ($h eq 'rm') {
    my ($recursive, $opts, @targets) = (0, 1);
    for my $a (@r[1 .. $#r]) {
      if ($opts && $a eq '--') { $opts = 0; next }
      if ($opts && $a =~ /^-/) { $recursive = 1 if $a =~ /^--r(?:e(?:c(?:u(?:r(?:s(?:i(?:v(?:e)?)?)?)?)?)?)?)?$/ || $a =~ /^-[A-Za-z0-9]*[rR]/; next }
      push @targets, $a;
    }
    my @bad = grep { root_like($_) || m{^\$SUB(?:/|$)} } @targets;    # the tokeniser writes a command substitution as $SUB: its value is not known
    deny("recursive rm of '$bad[0]' removes a whole tree: name the directory to remove") if $recursive && @bad;
  }
  if ($READER{$h} || $COPY{$h}) {
    my @hit = grep { secret_path($_) } ($COPY{$h} ? @r[1 .. $#r - 1] : file_words($h, @r[1 .. $#r])), map { /^<([^<].*)$/ ? $1 : () } @{ $e->{redirs} };
    deny("'$hit[0]' may hold secrets and is not read by an agent: read the committed template (.env.example) or ask the owner") if @hit;
  }
}

# `git -c key=value` keys that make git run a command (or load config that does); a `!` value is an alias-style shell command.
my $RUNS_COMMAND = qr/^(?:core\.(?:pager|fsmonitor|editor|sshcommand|askpass|hookspath|gitproxy)|alias\..*|pager\..*|diff\.external|diff\..*\.(?:textconv|command)
  |merge\..*\.driver|filter\..*|credential\..*helper|gpg\..*program|sequence\.editor|(?:difftool|mergetool|man|browser)\..*(?:cmd|path)|web\.browser
  |include(?:if\..*)?\.path|uploadpack\.packobjectshook|protocol\.ext\.allow|remote\..*\.(?:receivepack|uploadpack|vcs))$/x;
sub git_config_overrides {    # the `-c name=value` / `--config-env=name=ENVVAR` words before the subcommand
  my @r = @_; my @cfg; my $i = 1;
  while ($i < @r && $r[$i] =~ /^-/) {
    if ($r[$i] eq '-c' || $r[$i] eq '--config-env') { push @cfg, $r[$i + 1] // ''; $i += 2 }
    elsif ($r[$i] =~ /^--config-env=(.*)$/s || $r[$i] =~ /^-c(.+)$/s) { push @cfg, $1; $i++ }
    elsif ($r[$i] =~ /^(?:-C|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)$/) { $i += 2 }
    else { $i++ }
  }
  return @cfg;
}
# --open-files-in-pager abbreviates down to --op (--o is ambiguous with --only-matching and --or); -O takes its command attached (-Ocmd, -inOcmd).
my $PAGER_LONG = '--open-files-in-pager';
sub is_pager_opt { my $x = shift; $x =~ s/=.*//s; return (length $x >= 4 && index($PAGER_LONG, $x) == 0) || $x =~ /^-[A-Za-z]*O/ }

for my $g (git_calls(@entries)) {
  for my $c (git_config_overrides(@{ $g->{e}{rest} })) {
    my ($k, $v) = split /=/, $c, 2; $k = lc($k // '');
    my $reset = defined $v && $v eq '';    # `-c credential.helper=` empties the helper list: it runs nothing
    deny("git -c $k can make git run a command: set it in your own git config or ask the owner")
      if ($k =~ $RUNS_COMMAND && !$reset) || (defined $v && $v =~ /^!/);
  }
  my @a = @{ $g->{args} };
  if ($g->{sub} eq 'grep') {
    my @opts = @a; for my $i (0 .. $#opts) { if ($opts[$i] eq '--') { @opts = @opts[0 .. $i - 1]; last } }
    deny('git grep -O / --open-files-in-pager runs the command it is given: never run by an agent') if grep { is_pager_opt($_) } @opts;
  }
  if ($g->{sub} eq 'push') {
    deny('git push --force overwrites the remote branch: never run by an agent')
      if grep { $_ eq '--force' || /^-[A-Za-z]*f[A-Za-z]*$/ || /^\+./ } @a;    # --force-with-lease and --force-if-includes are other options: no abbreviation of --force is unambiguous in git push
  }
  deny('git reset --hard discards uncommitted work: never run by an agent') if $g->{sub} eq 'reset' && grep { /^--h(?:a(?:r(?:d)?)?)?$/ } @a;    # git reset: --hard abbreviates to --h
  if ($g->{sub} eq 'clean') {
    my $force = grep { /^--f(?:o(?:r(?:c(?:e)?)?)?)?$/ || /^-[A-Za-z]*f/ } @a;    # git clean has one long option per letter: --f.. is --force
    my $dry = grep { /^--d(?:r(?:y(?:-(?:r(?:u(?:n)?)?)?)?)?)?$/ || /^-[A-Za-z]*n/ } @a;
    deny('git clean -f deletes untracked files: never run by an agent (use -n to list them)') if $force && !$dry;
  }
}
for my $g (git_calls(@entries)) {
  my @a = @{ $g->{args} };
  ask('git rebase rewrites history - {{project.owner_title}} approval required') if $g->{sub} eq 'rebase';
  ask('git pull --rebase rewrites history - {{project.owner_title}} approval required')
    if $g->{sub} eq 'pull' && grep { /^--reb(?:a(?:s(?:e)?)?)?(?:=.*)?$/ || /^-[A-Za-z]*r[A-Za-z]*$/ } @a;
}
exit 0;
