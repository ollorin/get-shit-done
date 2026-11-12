# check-git-merge-target: ask before merging into the default branch.
# ask: `gh pr merge`, `gh api .../merges`, `git pull` while on the default branch, `git fetch <remote> <x>:<default>`, `git update-ref` of the default branch,
#      `gh api -X PUT .../pulls/N/merge`, `gh api graphql ... mergePullRequest`, `git push <remote> <x>:<default>|<default>`,
#      `git push [remote [HEAD]]` while the checkout is on the default branch, `git merge` while the target checkout is on the default
#      branch or master (or unresolvable; a preceding `git checkout|switch <default>` in the same command counts). allow: ONLY a plain lone `git merge <args>`
#      into a non-default branch (see the grant below); any compound or decorated command emits no decision (so `git merge x && git reset --hard` is not auto-allowed).
# The default branch name and the owner title are rendered from the stack profile. Branch names are compared as literal strings
# (`eq`), never as a regex: a name may hold `.` and `/`.
use strict; use warnings;
use ShellParse qw(parse_shell flatten git_calls read_input base git_out skip_flags);
use HookGuard qw(prepare);
use JSON::PP;

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
my $cwd = $in->{cwd} // $ENV{PWD} // '.';
my ($cmds) = parse_shell($command);
my ($limit, @entries) = prepare($cmds, $cwd, flatten($cmds, $cwd));

sub emit { my ($d, $r) = @_; print encode_json({ hookSpecificOutput => { hookEventName => 'PreToolUse', permissionDecision => $d, permissionDecisionReason => $r } }), "\n"; exit 0 }
emit('ask', "$limit ({{project.owner_title}} approval required)") if $limit;

for my $e (@entries) {
  my @r = @{ $e->{rest} }; next unless @r;
  next unless base($r[0]) eq 'gh';
  my @a = @r[skip_flags(\@r, 1, { '-R' => 1, '--repo' => 1, '--hostname' => 1 }) .. $#r];
  emit('ask', 'gh pr merge merges into {{stack.branch.default}} - {{project.owner_title}} approval required') if @a >= 2 && $a[0] eq 'pr' && $a[1] eq 'merge';
  if (@a && $a[0] eq 'api') {
    my $joined = join(' ', @a);
    emit('ask', 'gh api PUT .../merge merges a PR - {{project.owner_title}} approval required')
      if $joined =~ m{/pulls/\d+/merge\b} && $joined =~ /(?:-X|--method)[ =]?PUT/i;
    emit('ask', 'gh api .../merges merges a branch - {{project.owner_title}} approval required') if $joined =~ m{/merges\b};
    emit('ask', 'gh api GraphQL merge mutation - {{project.owner_title}} approval required')
      if $joined =~ /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/;
  }
}

my @git = git_calls(@entries);
sub on_default { my ($g) = @_; my $dir = $g->{dir}; $dir = $cwd unless defined $dir; my $b = git_out($dir, 'symbolic-ref', '--short', '-q', 'HEAD'); return ($b eq '{{stack.branch.default}}' || $b eq 'master') }
for my $g (@git) {
  next unless $g->{sub} eq 'push';
  emit('ask', 'git push --all/--mirror touches {{stack.branch.default}} - {{project.owner_title}} approval required') if grep { /^--(?:al(?:l)?|m(?:i(?:r(?:r(?:o(?:r)?)?)?)?)?)$/ } @{ $g->{args} };
  my @pos = grep { !/^-/ } @{ $g->{args} };
  shift @pos;    # remote
  emit('ask', 'git push from a checkout on {{stack.branch.default}} - {{project.owner_title}} approval required')
    if (!@pos || (grep { $_ eq 'HEAD' || $_ eq '@' } @pos)) && on_default($g);
  for my $ref (@pos) {
    my $dst = $ref; $dst =~ s/^\+//; $dst =~ s/^.*://; $dst =~ s{^refs/heads/}{};
    emit('ask', "git push to {{stack.branch.default}} - {{project.owner_title}} approval required ($ref)")
      if $dst eq '{{stack.branch.default}}' || $dst eq 'master';
  }
}

for my $g (@git) {
  emit('ask', 'git pull merges into {{stack.branch.default}} - {{project.owner_title}} approval required') if $g->{sub} eq 'pull' && on_default($g);
  if ($g->{sub} eq 'fetch') {
    for my $ref (grep { !/^-/ && /:/ } @{ $g->{args} }) {
      my $dst = $ref; $dst =~ s/^.*://; $dst =~ s{^refs/heads/}{};
      emit('ask', "git fetch into {{stack.branch.default}} - {{project.owner_title}} approval required ($ref)") if $dst eq '{{stack.branch.default}}' || $dst eq 'master';
    }
  }
  emit('ask', 'git update-ref moves {{stack.branch.default}} - {{project.owner_title}} approval required')
    if $g->{sub} eq 'update-ref' && grep { $_ eq 'refs/heads/{{stack.branch.default}}' || $_ eq 'refs/heads/master' } @{ $g->{args} };
}

my $forced_default = 0;
for my $g (@git) {
  if ($g->{sub} =~ /^(?:checkout|switch)$/) { my @pos = grep { !/^-/ } @{ $g->{args} }; $forced_default = 1 if @pos && ($pos[0] eq '{{stack.branch.default}}' || $pos[0] eq 'master'); next }
  next unless $g->{sub} eq 'merge';
  emit('ask', 'git merge after checking out {{stack.branch.default}} - {{project.owner_title}} approval required') if $forced_default;
  my $dir = $g->{dir}; $dir = $cwd unless defined $dir;
  my $branch = git_out($dir, 'symbolic-ref', '--short', '-q', 'HEAD');
  emit('ask', "git merge: could not resolve the target branch in $dir") unless length $branch;
  emit('ask', 'git merge into {{stack.branch.default}} - {{project.owner_title}} approval required') if $branch eq '{{stack.branch.default}}' || $branch eq 'master';
}

# The grant is for a plain `git merge <args>` only: `merge` is the first word after `git` (no -c / --config-env / --exec-path /
# -C global option), no env or wrapper prefix, no redirect, pipe, `&`, `;`, substitution, subshell or backslash in the text.
# Anything else (e.g. `git -c core.fsmonitor=... merge`) gets no decision and falls to the normal permission prompt.
if (@entries == 1 && @git == 1 && $git[0]{sub} eq 'merge') {
  my $e = $entries[0];
  my $plain = $command !~ /[&`\$()<>|;\n\\]/ && !@{ $e->{redirs} } && !$e->{piped}
    && @{ $e->{words} } == @{ $e->{rest} } && ($e->{rest}[1] // '') eq 'merge' && base($e->{rest}[0]) eq 'git';
  emit('allow', 'git merge into a non-default branch') if $plain;
}
exit 0;
