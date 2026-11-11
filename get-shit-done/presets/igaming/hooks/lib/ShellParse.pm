# Quote-aware shell tokeniser shared by the project Bash hooks. Perl port of the
# gsd-guard-bash.js parseShell/unwrap/flatten (RULING A5/A6): quoted text, heredoc bodies,
# comments and redirect targets are never command words; $(..), backticks, `sh -c STR`,
# `eval`, and heredocs that feed a shell are parsed recursively.
package ShellParse;
use strict;
use warnings;
use Exporter 'import';
our @EXPORT_OK = qw(parse_shell flatten parse_git git_calls read_input resolve_dir base git_out run_capture skip_flags);

my %SHELLS   = map { $_ => 1 } qw(sh bash zsh dash);
my %KEYWORDS = map { $_ => 1 } ('{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'time', 'while', 'until', 'for', 'case', 'esac');

sub base { my $p = shift; $p =~ s{.*/}{}s; return $p }

sub skip_arith {    # $i points just after "$((" or "((" ; returns index after the matching "))"
  my ($s, $i) = @_;
  my $d = 2; my $n = length $s;
  while ($i < $n && $d > 0) { my $c = substr($s, $i, 1); $d++ if $c eq '('; $d-- if $c eq ')'; $i++ }
  return $i;
}

sub scan_subs {    # commands inside $(..) / `..` found in free text (unquoted heredoc bodies, arithmetic)
  my ($t) = @_; my @out; my $p = 0;
  while ($p < length $t) {
    my $a = index($t, '$(', $p); my $b = index($t, '`', $p);
    last if $a < 0 && $b < 0;
    if ($b < 0 || ($a >= 0 && $a < $b)) {
      if (substr($t, $a + 2, 1) eq '(') { $p = skip_arith($t, $a + 3); next }
      my ($r, $e) = parse_shell($t, $a + 2, 1); push @out, @$r; $p = $e;
    } else {
      my $j = index($t, '`', $b + 1); last if $j < 0;
      my ($r) = parse_shell(substr($t, $b + 1, $j - $b - 1)); push @out, @$r; $p = $j + 1;
    }
  }
  return @out;
}

my %GIT_CACHE;
sub git_out {    # list-form exec (no shell): `git -C <dir> <args>`; stdout chomped, '' on failure; memoised
  my ($dir, @a) = @_;
  my $key = join("\0", $dir, @a);
  return $GIT_CACHE{$key} if exists $GIT_CACHE{$key};
  my ($out, $st) = run_capture($dir, 0, 'git', '-C', $dir, @a);
  $out =~ s/\s+\z//;
  return $GIT_CACHE{$key} = ($st == 0 ? $out : '');
}

sub run_capture {    # (out, status): run argv list in $dir (chdir), stderr merged when $merge
  my ($dir, $merge, @cmd) = @_;
  pipe(my $r, my $w) or return ('', 255);
  my $pid = fork();
  return ('', 255) unless defined $pid;
  if (!$pid) {
    close $r; open(STDOUT, '>&', $w); if ($merge) { open(STDERR, '>&', $w) } else { open(STDERR, '>', '/dev/null') }
    open(STDIN, '<', '/dev/null');
    chdir($dir) if $cmd[0] ne 'git' && defined $dir && length $dir;
    exec(@cmd) or exit 127;
  }
  close $w; local $/; my $o = <$r>; close $r; waitpid($pid, 0);
  return (defined $o ? $o : '', $? >> 8);
}

sub skip_flags { my ($w, $i, $valued) = @_; while ($i < @$w && $w->[$i] =~ /^-/) { $i += ($valued && $valued->{ $w->[$i] }) ? 2 : 1 } return $i }

# Returns (\@cmds, $end). cmd = { words => [..], redirs => [..], piped => 0|1 }
sub parse_shell {
  my ($s, $i, $in_sub) = @_;
  $i //= 0; $in_sub //= 0;
  my $n = length $s;
  my (@cmds, @cur, @redir, @heredocs); my $meta;
  my ($word, $has, $skip, $pipe_in) = ('', 0, '', 0);

  my $end_word = sub {
    if ($has) { if (length $skip) { push @redir, "$skip$word" } else { push @cur, $word } }
    $skip = '' if $has;
    $word = ''; $has = 0;
  };
  my $end_cmd = sub {
    my $pipe_next = shift // 0;
    $end_word->(); $skip = '';
    if (@cur || @redir) { my $m = $meta // {}; %$m = (%$m, words => [@cur], redirs => [@redir], piped => $pipe_in); push @cmds, $m }
    $meta = undef; @cur = (); @redir = (); $pipe_in = $pipe_next;
  };
  my $sub = sub { my ($r, $e) = parse_shell($s, $_[0], 1); push @cmds, @$r; return $e };
  my $backtick = sub {
    my $j = $_[0];
    while ($j < $n && substr($s, $j, 1) ne '`') { $j += substr($s, $j, 1) eq '\\' ? 2 : 1 }
    my ($r) = parse_shell(substr($s, $_[0], $j - $_[0]));
    push @cmds, @$r;
    return $j + 1;
  };
  my $read_bodies = sub {
    while (@heredocs) {
      my $h = shift @heredocs; my $body = '';
      while ($i < $n) {
        my $nl = index($s, "\n", $i); $nl = $n if $nl == -1;
        my $line = substr($s, $i, $nl - $i);
        $i = $nl + 1; $i = $n if $i > $n;
        $line =~ s/^\t+// if $h->{strip};
        last if $line eq $h->{delim};
        $body .= "$line\n";
      }
      $h->{meta}{body} = $body;
      if ($h->{shell}) { my ($r) = parse_shell($body); push @cmds, @$r }
      elsif (!$h->{quoted}) { push @cmds, scan_subs($body) }
    }
  };

  while ($i < $n) {
    my $c = substr($s, $i, 1);
    my $c2 = $i + 1 < $n ? substr($s, $i + 1, 1) : '';
    if ($c eq '\\') {
      if ($c2 eq "\n") { $i += 2; next }
      if ($i + 1 < $n) { $word .= $c2; $has = 1 }
      $i += 2;
    } elsif ($c eq "'") {
      my $j = index($s, "'", $i + 1); $j = $n if $j == -1;
      $word .= substr($s, $i + 1, $j - $i - 1); $has = 1; $i = $j + 1;
    } elsif ($c eq '"') {
      $i++; $has = 1;
      while ($i < $n && substr($s, $i, 1) ne '"') {
        my $d = substr($s, $i, 1); my $d2 = $i + 1 < $n ? substr($s, $i + 1, 1) : '';
        if ($d eq '\\' && $i + 1 < $n) { $word .= $d2; $i += 2 }
        elsif ($d eq '$' && $d2 eq '(' && substr($s, $i + 2, 1) eq '(') { $word .= '$ARITH'; my $st = $i + 3; $i = skip_arith($s, $st); push @cmds, scan_subs(substr($s, $st, $i - $st)) }
        elsif ($d eq '$' && $d2 eq '(') { $word .= '$SUB'; $i = $sub->($i + 2) }
        elsif ($d eq '`') { $word .= '$SUB'; $i = $backtick->($i + 1) }
        else { $word .= $d; $i++ }
      }
      $i++;
    } elsif ($c eq '$' && $c2 eq "'") {
      $i += 2; $has = 1;
      while ($i < $n && substr($s, $i, 1) ne "'") {
        if (substr($s, $i, 1) eq '\\' && $i + 1 < $n) { $word .= substr($s, $i + 1, 1); $i += 2 } else { $word .= substr($s, $i, 1); $i++ }
      }
      $i++;
    } elsif ($c eq '$' && $c2 eq '(' && substr($s, $i + 2, 1) eq '(') {
      $word .= '$ARITH'; $has = 1; my $st = $i + 3; $i = skip_arith($s, $st); push @cmds, scan_subs(substr($s, $st, $i - $st));
    } elsif ($c eq '$' && $c2 eq '(') {
      $word .= '$SUB'; $has = 1; $i = $sub->($i + 2);
    } elsif ($c eq '`') {
      $word .= '$SUB'; $has = 1; $i = $backtick->($i + 1);
    } elsif ($c eq ' ' || $c eq "\t") {
      $end_word->(); $i++;
    } elsif ($c eq "\n") {
      $end_cmd->(); $i++; $read_bodies->();
    } elsif ($c eq '#' && !$has) {
      $i++ while $i < $n && substr($s, $i, 1) ne "\n";
    } elsif ($c eq ';' || $c eq '|' || $c eq '&') {
      if ($c eq '&' && $c2 eq '>') { $end_word->(); $skip = '>'; $i += (substr($s, $i + 2, 1) eq '>') ? 3 : 2; next }
      my $pipe = ($c eq '|') ? 1 : 0;
      $end_cmd->($pipe);
      $i += ($c2 eq $c || ($c eq '|' && $c2 eq '&')) ? 2 : 1;
    } elsif ($c eq '(' && $c2 eq '(' && !@cur && !$has) {
      $i = skip_arith($s, $i + 2);
    } elsif ($c eq '(') {
      $end_cmd->(); $i++;
    } elsif ($c eq ')') {
      $end_cmd->(); $i++;
      return (\@cmds, $i) if $in_sub;
    } elsif ($c eq '<' && $c2 eq '<' && substr($s, $i + 2, 1) ne '<') {
      $end_word->(); $i += 2;
      my $strip = (substr($s, $i, 1) eq '-') ? 1 : 0; $i++ if $strip;
      $i++ while $i < $n && substr($s, $i, 1) =~ /[ \t]/;
      my ($delim, $quoted) = ('', 0);
      while ($i < $n && substr($s, $i, 1) !~ /[\s;|&<>()]/) {
        my $q = substr($s, $i, 1);
        if ($q eq "'" || $q eq '"') {
          $quoted = 1; my $j = index($s, $q, $i + 1); $j = $n if $j == -1;
          $delim .= substr($s, $i + 1, $j - $i - 1); $i = $j + 1;
        } elsif ($q eq '\\') { $quoted = 1; $delim .= ($i + 1 < $n ? substr($s, $i + 1, 1) : ''); $i += 2 }
        else { $delim .= $q; $i++ }
      }
      my (undef, $f) = _unwrap([@cur]);
      $meta //= {};
      push @heredocs, { delim => $delim, strip => $strip, quoted => $quoted, meta => $meta, shell => ($f->{shell} || @{ $f->{inner} } ? 1 : 0) };
    } elsif ($c eq '<' || $c eq '>') {
      if ($c2 eq '(') { $word .= '$PROC'; $has = 1; $i = $sub->($i + 2); next }
      my $op = $c;
      if ($has && $word =~ /^\d+$/) { $word = ''; $has = 0 } else { $end_word->() }
      $i++;
      if ($i < $n && (substr($s, $i, 1) eq $c || substr($s, $i, 1) eq '|')) { $op .= substr($s, $i, 1); $i++ }
      if ($c eq '<' && $i < $n && substr($s, $i, 1) eq '<') { $i++ }
      $i++ if $i < $n && substr($s, $i, 1) eq '&';
      $skip = $op;
    } else {
      $word .= $c; $has = 1; $i++;
    }
  }
  $end_cmd->();
  return (\@cmds, $i);
}

sub _unwrap {
  my @w = @{ $_[0] };
  my $i = 0; my $f = { timeout => 0, rtk => '', shell => 0, xargs => 0, inner => [] };
  for (my $guard = 0; $guard < 20 && $i < @w; $guard++) {
    my $x = $w[$i]; my $b = base($x);
    if ($KEYWORDS{$x}) { $i++; next }
    if ($x =~ /^[A-Za-z_]\w*=/) { $i++; next }
    if ($b eq 'rtk') { $i++; if (($w[$i] // '') eq 'proxy') { $i++; $f->{rtk} = 'proxy' } else { $f->{rtk} = 'lossy' } next }
    if ($b eq 'exec') { $i++; $i += 2 if ($w[$i] // '') eq '-a'; next }
    if ($b eq 'function') { $i += 2; next }
    if ($b eq 'sudo') {    # sudo [-u user | -g group | -h host | -p prompt | -C n | -r role | -t type | -D dir | -R dir] [-E ...] cmd
      $i++;
      while ($i < @w && $w[$i] =~ /^-/) { $i += ($w[$i] =~ /^-[ughpCrtDRT]$|^--(?:user|group|host|prompt|close-from|role|type|chdir|chroot|other-user)$/) ? 2 : 1 }
      next;
    }
    if (grep { $b eq $_ } qw(command nohup builtin noglob)) { $i++; $i++ while $i < @w && $w[$i] =~ /^-/ && $w[$i] ne '--'; next }
    if ($b eq 'stdbuf') { $i++; while ($i < @w && $w[$i] =~ /^-/) { $i += ($w[$i] =~ /^-[ioe]$/) ? 2 : 1 } next }
    if ($b eq 'caffeinate') { $i++; while ($i < @w && $w[$i] =~ /^-/) { $i += ($w[$i] =~ /^-[tw]$/) ? 2 : 1 } next }
    if ($b eq 'watch') { $i++; while ($i < @w && $w[$i] =~ /^-/) { $i += ($w[$i] =~ /^(?:-n|-d|--interval|--differences)$/ && ($w[$i + 1] // '') =~ /^\d/) ? 2 : 1 } next }
    if ($b eq 'npx' || $b eq 'bunx') { $i++; $i++ while $i < @w && $w[$i] =~ /^-/; next }
    if (($b eq 'npm' || $b eq 'pnpm' || $b eq 'yarn') && ($w[$i + 1] // '') =~ /^(?:exec|dlx)$/) { $i += 2; $i++ while $i < @w && $w[$i] =~ /^-/; next }
    if ($b eq 'env') {
      $i++;
      while ($i < @w && ($w[$i] =~ /^-/ || $w[$i] =~ /^\w+=/)) {
        if ($w[$i] eq '-S' || $w[$i] eq '--split-string') { push @{ $f->{inner} }, $w[$i + 1] if defined $w[$i + 1]; return ([], $f) }
        if ($w[$i] =~ /^--split-string=(.*)$/s || $w[$i] =~ /^-S(.+)$/s) { push @{ $f->{inner} }, $1; return ([], $f) }
        $i += ($w[$i] eq '-u' || $w[$i] eq '-C') ? 2 : 1;
      }
      next;
    }
    if ($b eq 'nice') { $i++; if (($w[$i] // '') eq '-n') { $i += 2 } elsif (($w[$i] // '') =~ /^-\d+$/) { $i++ } next }
    if ($b eq 'timeout' || $b eq 'gtimeout') {
      $f->{timeout} = 1; $i++;
      while ($i < @w && $w[$i] =~ /^-/) { $i += ($w[$i] =~ /^(-k|-s|--kill-after|--signal)$/) ? 2 : 1 }
      $i++; next;
    }
    if ($b eq 'xargs') {
      $f->{xargs} = 1; $i++;
      while ($i < @w && $w[$i] =~ /^-/) { $i += ($w[$i] =~ /^(-I|-n|-P|-L|-d|-s|-E|-a)$/) ? 2 : 1 }
      next;
    }
    if ($SHELLS{$b}) {
      $f->{shell} = 1;
      for (my $k = $i + 1; $k < @w; $k++) {
        if ($w[$k] =~ /^-[a-z]*c[a-z]*$/) { push @{ $f->{inner} }, $w[$k + 1] if defined $w[$k + 1]; last }
      }
      return ([], $f);
    }
    if ($b eq 'eval') { push @{ $f->{inner} }, join(' ', @w[$i + 1 .. $#w]); return ([], $f) }
    last;
  }
  return ([@w[$i .. $#w]], $f);
}

# lock_info(words) -> ('lock', \@wrapped) | ('supervisor') | (): the command word (past bash / node / `deno run`
# flags) is scripts/stack-lock.(sh|ts) with a non-empty `-- <cmd>`, or session-supervisor.sh. Looking only at the
# command word keeps data such as `X=session-supervisor.sh deno task ...` from exempting a real run.
sub lock_info {
  my ($words) = @_;
  my ($rest, $f) = _unwrap($words);
  my @w = @$rest;
  if (!@w && $f->{shell}) {
    my $k = 0; $k++ while $k < @$words && ($words->[$k] =~ /^\w+=/ || !$SHELLS{ base($words->[$k]) });
    @w = @{$words}[$k .. $#$words];
  }
  return unless @w;
  my $b = base($w[0]); my $i = 0;
  if ($b =~ /^(?:stack-lock\.(?:sh|ts)|session-supervisor\.sh)$/) { $i = 0 }
  elsif ($SHELLS{$b} || $b =~ /^(?:node|tsx|bun)$/) { $i = skip_flags(\@w, 1) }
  elsif ($b eq 'deno' && ($w[1] // '') eq 'run') { $i = skip_flags(\@w, 2, { map { $_ => 1 } qw(--env-file --config -c --import-map --lock) }) }
  else { return }
  my $t = base($w[$i] // '');
  return ('supervisor') if $t eq 'session-supervisor.sh';
  if ($t =~ /^stack-lock\.(?:sh|ts)$/) {
    for my $j ($i + 1 .. $#w) { if ($w[$j] eq '--') { return $j < $#w ? ('lock', [@w[$j + 1 .. $#w]]) : () } }
  }
  return;
}

sub _stdin_shell {    # `bash` / `sh -s` with no script file: it executes what is piped / here-stringed into it
  my ($words) = @_;
  my $k = 0; $k++ while $k < @$words && ($words->[$k] =~ /^\w+=/ || !$SHELLS{ base($words->[$k]) });
  return 0 if $k >= @$words;
  for my $j ($k + 1 .. $#$words) { return 0 if $words->[$j] !~ /^-/ || $words->[$j] =~ /^-[a-z]*c/ }
  return 1;
}

# entries: { words, rest, facts, redirs, piped, dir, locked, wrapper }; nested `sh -c`/eval strings, find -exec
# commands, stack-lock `-- <cmd>` commands (locked=1), process/stdin-shell scripts are expanded.
# `cd`/`pushd X` updates the running directory textually.
sub flatten {
  my ($cmds, $cwd, $depth, $locked) = @_;
  $depth //= 0; $locked //= 0; my @out; my $dir = $cwd; my $idx = 0;
  for my $c (@$cmds) {
    my ($rest, $f) = _unwrap($c->{words});
    my $e = { words => $c->{words}, rest => $rest, facts => $f, redirs => $c->{redirs}, piped => $c->{piped}, dir => $dir, locked => $locked, wrapper => 0 };
    push @out, $e;
    if (@$rest && base($rest->[0]) =~ /^(?:cd|pushd)$/ && @$rest >= 2) { my $nd = resolve_dir($dir, $rest->[1]); $dir = $nd if defined $nd }
    if ($depth < 12) {
      for my $inner (@{ $f->{inner} }) { my ($r) = parse_shell($inner); push @out, flatten($r, $dir, $depth + 1, $locked) }
      if ($f->{shell} && !@{ $f->{inner} } && _stdin_shell($c->{words})) {
        my @texts = map { /^<<(.*)/s ? $1 : () } @{ $c->{redirs} };
        if ($c->{piped} && $idx > 0) { my $p = $cmds->[$idx - 1]; my @pw = @{ $p->{words} }; shift @pw; push @texts, ($p->{body} // ''), join(' ', @pw) }
        for my $t (@texts) { my ($r) = parse_shell($t); push @out, flatten($r, $dir, $depth + 1, $locked) }
      }
      if (@$rest && base($rest->[0]) eq 'find') {
        for (my $k = 1; $k < @$rest; $k++) {
          next unless $rest->[$k] =~ /^-(?:exec|execdir|ok|okdir)$/;
          my @in; for (my $j = $k + 1; $j < @$rest && $rest->[$j] !~ /^[;+]$/; $j++) { push @in, $rest->[$j] }
          push @out, flatten([{ words => \@in, redirs => [], piped => 0 }], $dir, $depth + 1, $locked) if @in;
        }
      }
      my ($kind, $wr) = lock_info($c->{words});
      if ($kind) {
        $e->{wrapper} = 1;
        push @out, flatten([{ words => $wr, redirs => [], piped => 0 }], $dir, $depth + 1, 1) if $kind eq 'lock';
      }
    }
    $idx++;
  }
  return @out;
}

sub resolve_dir {
  my ($base, $t) = @_;
  return $base unless defined $t && length $t;
  $t =~ s{^~(?=/|$)}{$ENV{HOME}};
  return undef if $t =~ /\$/;
  return $t if $t =~ m{^/};
  return ($base // '.') . "/$t";
}

# rest[0] must be git. Returns { dirs => [..], sub => str, args => [..] }
sub parse_git {
  my @r = @{ $_[0] };
  my @dirs; my $i = 1;
  my %withval = map { $_ => 1 } ('-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env');
  while ($i < @r && $r[$i] =~ /^-/) {
    if ($r[$i] eq '-C') { push @dirs, ($r[$i + 1] // ''); $i += 2 }
    elsif ($withval{ $r[$i] }) { $i += 2 }
    else { $i++ }
  }
  return { dirs => \@dirs, sub => ($r[$i] // ''), args => [@r[($i + 1) .. $#r]] };
}

# Every `git ...` entry as { e => entry, sub, args, dir } where dir folds the running `cd` and any `-C` chain.
sub git_calls {
  my @out;
  for my $e (@_) {
    my $r = $e->{rest}; next unless @$r && base($r->[0]) eq 'git';
    my $g = parse_git($r); my $dir = $e->{dir};
    for my $d (@{ $g->{dirs} }) { my $nd = defined $dir ? resolve_dir($dir, $d) : undef; $dir = $nd }
    push @out, { e => $e, sub => $g->{sub}, args => $g->{args}, dir => $dir };
  }
  return @out;
}

# Reads the hook JSON payload from stdin. Fails closed: exit 2 on unreadable input.
sub read_input {
  local $/; my $raw = <STDIN>; $raw //= '';
  my $d = eval { require JSON::PP; JSON::PP->new->decode($raw) };
  if (!$d || ref $d ne 'HASH') { print STDERR "BLOCKED: hook input is not valid JSON (fail closed)\n"; exit 2 }
  return $d;
}

1;
