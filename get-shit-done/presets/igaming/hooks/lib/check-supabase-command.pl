# check-supabase-command: block bare `supabase start` / `supabase stop` (RULING R5).
# Matches path-prefixed and npx-prefixed binaries; --exclude / --project-id must be in the SAME command.
use strict; use warnings;
use ShellParse qw(parse_shell flatten read_input base);

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
exit 0 unless $command =~ /supabase/;
my ($cmds) = parse_shell($command);

my %SB_VAL = map { $_ => 1 } qw(--workdir --profile --dns-resolver --network-id --output -o);
sub has_flag {    # --flag=x or --flag <value>
  my ($flag, @w) = @_;
  for my $k (0 .. $#w) { return 1 if $w[$k] =~ /^\Q$flag\E=.+/ || ($w[$k] eq $flag && defined $w[$k + 1] && $w[$k + 1] !~ /^-/) }
  return 0;
}
sub has_exclude {    # --exclude x | --exclude=x | -x x | -xx (cobra short flag, value may be attached)
  my @w = @_;
  return 1 if has_flag('--exclude', @w);
  for my $k (0 .. $#w) { return 1 if $w[$k] =~ /^-x.+/ || ($w[$k] eq '-x' && defined $w[$k + 1] && $w[$k + 1] !~ /^-/) }
  return 0;
}
sub scan {    # words of one command (wrappers already unwrapped / flattened by ShellParse)
  my @w = @_;
  return undef unless @w && base($w[0]) =~ /^supabase(?:@.*)?$/;
  my $i = ShellParse::skip_flags(\@w, 1, \%SB_VAL);
  my $sub = $w[$i] // '';
  return 'start' if $sub eq 'start' && !has_exclude(@w) && !has_flag('--project-id', @w);
  return 'stop' if $sub eq 'stop' && !has_flag('--project-id', @w);
  return undef;
}

for my $e (flatten($cmds, $in->{cwd} // '')) {
  my $bad = scan(@{ $e->{rest} });
  next unless $bad;
  print STDERR <<'MSG';
BLOCKED: Direct `supabase start` or `supabase stop` (bare commands)

Use the nx commands, which handle JWT bypass and configuration:
  Development (full stack with JWT bypass):  npx nx start:dev api
  Minimal (database + Redis, no Kong):       npx nx start:minimal api
  Stop services:                             npx nx stop:dev api   |   npx nx supabase:stop api

Direct control with safe options:
  supabase start --exclude edge-runtime        # skip Kong Gateway
  supabase start|stop --project-id <id>        # explicit project scope
  supabase status | supabase db reset | supabase migration new <name>
MSG
  exit 2;
}
exit 0;
