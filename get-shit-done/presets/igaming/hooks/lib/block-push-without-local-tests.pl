# block-push: no `git push` without a fresh scripts/preflight.sh pass marker (RULING A11/A12).
# Tokenised: `true; git push`, `git  push`, `/usr/bin/git push`, `command git push`, `git -c a=b push`,
# `GIT_TRACE=0 git push`, `bash -c "git push"` are all judged. The marker may only be written by
# scripts/preflight.sh, so touch/tee/cp/mv/redirects naming `.preflight-passed` are blocked.
use strict; use warnings;
use ShellParse qw(parse_shell flatten git_calls read_input base git_out);

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
my $cwd = $in->{cwd} // $ENV{PWD} // '.';
my ($cmds) = parse_shell($command);
my @entries = flatten($cmds, $cwd);

# The marker may only be written by scripts/preflight.sh. Guardrail for honest agents, not a boundary: variables
# assembled at runtime or aliases (`git -c alias.p=push p`) are not chased.
my $MARK = qr/\.preflight-(?:passed|[^\s]*[{?*\[])/;
# interpreters (incl. versioned python3.12 / php8.2) and writers that can create a file from their own argument text
sub always { my $h = shift; return $h =~ /^(?:touch|tee|truncate|dd|deno|bun|node(?:js)?|tsx|ts-node|python[\d.]*|perl|ruby[\d.]*|php[\d.]*|lua[\d.]*|awk|gawk|mawk|bash|sh|zsh|dash|ksh|eval|osascript|Rscript|tclsh)$/ }
my %DEST   = map { $_ => 1 } qw(cp mv ln install rsync);
my $mentioned = 0;
for my $e (@entries) { $mentioned ||= (grep { /$MARK/ } @{ $e->{words} }, @{ $e->{redirs} }) ? 1 : 0 }
if ($mentioned) {
  my $deny = 0;
  for my $e (@entries) {
    $deny ||= (grep { />>?\|?$MARK/ || />>?.*$MARK/ } @{ $e->{redirs} }) ? 1 : 0;
    my @r = @{ $e->{rest} }; next unless @r;
    my $h = base($r[0]); my $hit = (grep { /$MARK/ } @r[1 .. $#r]) ? 1 : 0;
    if (always($h)) { $deny ||= $hit || $e->{facts}{xargs} }
    elsif ($h eq 'xargs' || $e->{facts}{xargs}) { $deny ||= 1 if always($h) || $DEST{$h} }
    elsif ($DEST{$h}) { $deny ||= ($r[-1] =~ /$MARK/) ? 1 : 0 }
    elsif ($h eq 'sed') { $deny ||= ($hit && grep { /^-[a-zA-Z]*i/ } @r) ? 1 : 0 }
  }
  my $varmark = grep { !@{ $_->{rest} } && grep { /^\w+=.*$MARK/ } @{ $_->{words} } } @entries;
  if ($varmark) { for my $e (@entries) { my @r = @{ $e->{rest} }; $deny ||= 1 if @r && (always(base($r[0])) || $DEST{ base($r[0]) }) && grep { /\$/ } @r[1 .. $#r] } }
  $deny ||= (grep { $_->{facts}{xargs} && @{ $_->{rest} } && (always(base($_->{rest}[0])) || $DEST{ base($_->{rest}[0]) }) } @entries) ? 1 : 0;
  if ($deny) {
    print STDERR "BLOCKED: .preflight-passed is written only by scripts/preflight.sh after a green run.\n  Run scripts/preflight.sh; do not create or edit the marker.\n";
    exit 2;
  }
}

for my $g (git_calls(@entries)) {
  next unless $g->{sub} eq 'push';
  my $dir = $g->{dir}; $dir = $cwd unless defined $dir;
  my $root = git_out($dir, 'rev-parse', '--show-toplevel');
  $root = '.' unless length $root;
  # Scope: only repos that HAVE the preflight convention (the GSD fork has none).
  next unless -f "$root/scripts/preflight.sh";
  my $marker = "$root/.preflight-passed";
  next if -f $marker && (time - (stat $marker)[9]) < 1800;
  print STDERR <<'MSG';
BLOCKED: git push requires local CI preflight to pass first.

Run the preflight script (mirrors CI exactly):
  scripts/preflight.sh             # auto-detect affected
  scripts/preflight.sh --all       # force all checks
  scripts/preflight.sh --skip-twice  # quick single run

Preflight must pass before pushing. This saves CI money.
MSG
  exit 2;
}
exit 0;
