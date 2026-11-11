# check-git-merge-target: ask before merging into main (RULING A13/A14).
# ask: `gh pr merge`, `gh api -X PUT .../pulls/N/merge`, `gh api graphql ... mergePullRequest`, `git push <remote> <x>:main|main`,
#      `git push [remote [HEAD]]` while the checkout is on main, `git merge` while the target checkout is on main (or unresolvable;
#      a preceding `git checkout|switch main` in the same command counts). allow: ONLY a lone `git merge` into a non-main branch;
#      any compound command emits no decision (so `git merge x && git reset --hard` is not auto-allowed).
use strict; use warnings;
use ShellParse qw(parse_shell flatten git_calls read_input base git_out skip_flags);
use JSON::PP;

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
my $cwd = $in->{cwd} // $ENV{PWD} // '.';
my ($cmds) = parse_shell($command);
my @entries = flatten($cmds, $cwd);

sub emit { my ($d, $r) = @_; print encode_json({ hookSpecificOutput => { hookEventName => 'PreToolUse', permissionDecision => $d, permissionDecisionReason => $r } }), "\n"; exit 0 }

for my $e (@entries) {
  my @r = @{ $e->{rest} }; next unless @r;
  next unless base($r[0]) eq 'gh';
  my @a = @r[skip_flags(\@r, 1, { '-R' => 1, '--repo' => 1, '--hostname' => 1 }) .. $#r];
  emit('ask', 'gh pr merge merges into main - CEO approval required') if @a >= 2 && $a[0] eq 'pr' && $a[1] eq 'merge';
  if (@a && $a[0] eq 'api') {
    my $joined = join(' ', @a);
    emit('ask', 'gh api PUT .../merge merges a PR - CEO approval required')
      if $joined =~ m{/pulls/\d+/merge\b} && $joined =~ /(?:-X|--method)[ =]?PUT/i;
    emit('ask', 'gh api GraphQL merge mutation - CEO approval required')
      if $joined =~ /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/;
  }
}

my @git = git_calls(@entries);
sub on_main { my ($g) = @_; my $dir = $g->{dir}; $dir = $cwd unless defined $dir; my $b = git_out($dir, 'symbolic-ref', '--short', '-q', 'HEAD'); return ($b eq 'main' || $b eq 'master') }
for my $g (@git) {
  next unless $g->{sub} eq 'push';
  emit('ask', 'git push --all/--mirror touches main - CEO approval required') if grep { /^--(?:all|mirror)$/ } @{ $g->{args} };
  my @pos = grep { !/^-/ } @{ $g->{args} };
  shift @pos;    # remote
  emit('ask', 'git push from a checkout on main - CEO approval required')
    if (!@pos || (grep { $_ eq 'HEAD' || $_ eq '@' } @pos)) && on_main($g);
  for my $ref (@pos) {
    my $dst = $ref; $dst =~ s/^\+//; $dst =~ s/^.*://; $dst =~ s{^refs/heads/}{};
    emit('ask', "git push to main - CEO approval required ($ref)") if $dst eq 'main' || $dst eq 'master';
  }
}

my $forced_main = 0;
for my $g (@git) {
  if ($g->{sub} =~ /^(?:checkout|switch)$/) { my @pos = grep { !/^-/ } @{ $g->{args} }; $forced_main = 1 if @pos && $pos[0] =~ /^(?:main|master)$/; next }
  next unless $g->{sub} eq 'merge';
  emit('ask', 'git merge after checking out main - CEO approval required') if $forced_main;
  my $dir = $g->{dir}; $dir = $cwd unless defined $dir;
  my $branch = git_out($dir, 'symbolic-ref', '--short', '-q', 'HEAD');
  emit('ask', "git merge: could not resolve the target branch in $dir") unless length $branch;
  emit('ask', 'git merge into main - CEO approval required') if $branch eq 'main';
}

if (@entries == 1 && @git == 1 && $git[0]{sub} eq 'merge') {
  emit('allow', 'git merge into a non-main branch');
}
exit 0;
