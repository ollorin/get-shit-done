# check-test-command: keep the Charlotte E2E suite and `deno task test:integration*` off the shared stack.
# Tokenised (ShellParse): quoted text, commit messages, heredoc bodies and redirect targets are never
# command words, so no early-exit allowlist exists (RULING A1/A2/A5). Rulings R2 (single scenarios only
# under stack-lock or the supervisor) and R3 (reminder, not deny, for direct integration-file runs).
use strict; use warnings;
use ShellParse qw(parse_shell flatten read_input base);
use JSON::PP;

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
my $cwd = $in->{cwd} // '';
my ($cmds) = parse_shell($command);
my @entries = flatten($cmds, $cwd);

my $TASKS = qr/^test:(?:player|operator|e2e|scenario|regression|smoke|rg|tags)$/;

# deno task [--cwd X | -c X | flags] NAME args... -> { name, cwd, args } (rest[0] is deno)
sub deno_task {
  my @r = @{ $_[0] };
  my $i = 1;
  $i++ while $i < @r && $r[$i] =~ /^-/ && $r[$i] ne 'task';
  return undef unless ($r[$i] // '') eq 'task';
  $i++;
  my ($tcwd, @flags);
  while ($i < @r && $r[$i] =~ /^-/) {
    if ($r[$i] =~ /^--(?:cwd|config)=(.*)$/) { $tcwd = $1; $i++ }
    elsif ($r[$i] =~ /^(?:--cwd|-c|--config)$/) { $tcwd = $r[$i + 1] // ''; $i += 2 }
    else { $i++ }
  }
  return { name => ($r[$i] // ''), cwd => $tcwd, args => [@r[$i + 1 .. $#r]] };
}

sub single_scenario {    # scenario name passed as exactly one positional / one --scenario=<one>
  my ($task) = @_;
  my @pos = grep { !/^-/ } @{ $task->{args} };
  return @pos == 1 && $pos[0] !~ /[,*]/ && !grep { /^--(?:tags?|all|regression|smoke)\b/ } @{ $task->{args} };
}

sub run_ts_scenario {    # deno run ... runner/run.ts --scenario=<one> | --scenario <one> (no bulk selectors)
  my @a = @{ $_[0] };
  my @sc;
  for my $k (0 .. $#a) {
    if ($a[$k] =~ /^--scenario=(.+)$/) { push @sc, $1 }
    elsif ($a[$k] eq '--scenario' && defined $a[$k + 1] && $a[$k + 1] !~ /^-/) { push @sc, $a[$k + 1] }
  }
  return 0 unless @sc == 1 && $sc[0] !~ /[,*]/;
  return 0 if grep { /^--(?:tags?|all|filter|grep)\b/ } @a;
  return 1;
}

# nx / pnpm nx / yarn nx / npm run e2e -> words starting at `nx`, or ().  The Charlotte suite is reachable as the
# nx targets `e2e` and `regression` (apps/e2e-charlotte/project.json) and the root scripts `e2e` / `affected:e2e`.
sub nx_words {
  my @r = @{ $_[0] };
  return () unless @r;
  my $h = base($r[0]);
  return @r if $h eq 'nx';
  return @r[1 .. $#r] if ($h eq 'pnpm' || $h eq 'yarn') && base($r[1] // '') eq 'nx';
  if ($h =~ /^(?:npm|pnpm|yarn|bun)$/) {
    my @a = grep { !/^-/ } @r[1 .. $#r];
    shift @a if @a && $a[0] eq 'run';
    return ('nx', 'e2e', 'script') if @a && $a[0] =~ /^(?:e2e|affected:e2e)$/;
  }
  return ();
}

# nx <target> <project> | nx run <project>:<target>[:cfg] | nx run-many|affected -t a,b | nx affected:<target>
sub nx_class {
  my @w = @_;
  my $i = 1; $i++ while $i < @w && $w[$i] =~ /^-/;
  my $cmd = $w[$i] // '';
  my @args = @w[$i + 1 .. $#w];
  my @targets;
  if ($cmd =~ /^(?:run-many|affected|affected:(\w[\w:-]*)|run-many:(\w[\w:-]*))$/) {
    push @targets, grep { defined } ($1, $2);
    for (my $k = 0; $k < @args; $k++) {
      if ($args[$k] =~ /^(?:-t|--targets?)=(.+)$/) { push @targets, split /,/, $1 }
      elsif ($args[$k] =~ /^(?:-t|--targets?)$/) { while ($k + 1 < @args && $args[$k + 1] !~ /^-/) { push @targets, split /,/, $args[++$k] } }
    }
  } elsif ($cmd eq 'run') {
    my ($spec) = grep { !/^-/ } @args;
    my (undef, $t) = split /:/, ($spec // ''), 2;
    push @targets, $t if defined $t;
  } else {
    push @targets, $cmd;
    my (undef, $t) = split /:/, $cmd, 2;    # nx <project>:<target>[:cfg]
    push @targets, $t if defined $t;
  }
  return 'charlotte' if grep { /^(?:e2e|regression)(?::|$)/ } @targets;
  return 'integration' if grep { /^test:integration/ } @targets;
  return undef;
}

my ($reason, $detail);
# classify one command (rest words); returns 'charlotte' | 'integration' | undef; $locked = wrapped by stack-lock
sub classify {
  my ($rest, $dir, $locked) = @_;
  return undef unless @$rest;
  my $head = base($rest->[0]);
  my @nxw = nx_words($rest);
  return nx_class(@nxw) if @nxw;
  return undef unless $head eq 'deno';
  my $t = deno_task($rest);
  if ($t) {
    my $n = $t->{name};
    if ($n =~ /^test:integration(?::.*)?$/) { return 'integration' }
    if ($n =~ $TASKS) {
      return undef if $n eq 'test:scenario' && $locked && single_scenario($t);
      return 'charlotte';
    }
    if ($n eq 'test') {
      my $eff = join('/', grep { defined } $dir, $t->{cwd});
      return 'charlotte' if $eff =~ m{(?:^|/)e2e-charlotte(?:/|$)};
    }
    return undef;
  }
  if (($rest->[1] // '') eq 'run') {
    my $in_runner = ($dir // '') =~ m{(?:^|/)e2e-charlotte/runner/?$};
    my @run = grep { m{(?:^|/)runner/run\.ts$} || ($in_runner && m{^(?:\./)?run\.ts$}) } @$rest;
    if (@run) { return undef if $locked && run_ts_scenario($rest); return 'charlotte' }
  }
  return undef;
}

# Wrapper entries (stack-lock / session-supervisor) are not judged themselves: stack-lock's `-- <cmd>` is
# flattened into its own locked=1 entry by ShellParse, and anything run through the supervisor is exempt.
for my $e (@entries) {
  next if $e->{wrapper} || !@{ $e->{rest} };
  my $r = classify($e->{rest}, $e->{dir}, $e->{locked});
  if (defined $r) { $reason = $r; last }
}

if ($reason) {
  my @m;
  if ($reason eq 'integration') {
    push @m, 'BLOCKED: live-stack integration tests must go through the stack lock:',
             '  bash scripts/run-integration-tests.sh --bucket=<name>   (from repo root)';
  } else {
    push @m, 'BLOCKED: the Charlotte E2E suite spawns real Claude subprocesses and burns account budget.',
             '  (also via nx: e2e / regression targets, npm run e2e). Bulk runs go through scripts/session-supervisor.sh. One scenario is allowed only under the stack lock:',
             '  deno run -A scripts/stack-lock.ts --label <x> -- deno task --cwd apps/e2e-charlotte test:scenario <one>',
             '  Harness unit tests: cd apps/e2e-charlotte && deno task test:unit';
  }
  push @m, 'Allowed: cd apps/api && deno task test <file> | deno test <file> | npx nx test <project>';
  print STDERR join("\n", @m), "\n";
  exit 2;
}

# R3: direct run of an *.integration.test.ts without the stack lock -> reminder only (convert to deny when 401/402 close)
{
  for my $e (@entries) {
    next if $e->{locked};
    my @r = @{ $e->{rest} }; next unless @r && base($r[0]) eq 'deno';
    my $isnt = (($r[1] // '') eq 'test') || (($r[1] // '') eq 'task' && ($r[2] // '') =~ /^test/);
    next unless $isnt && grep { /\.integration\.test\.ts/ } @r;
    print encode_json({ hookSpecificOutput => { hookEventName => 'PreToolUse',
      additionalContext => 'Integration test files touch the live local stack: wrap the run in `deno run -A scripts/stack-lock.ts --label <x> -- <cmd>` (or use scripts/run-integration-tests.sh --bucket=<name>) so it serialises with Charlotte and other phases.' } }), "\n";
    last;
  }
}
exit 0;
