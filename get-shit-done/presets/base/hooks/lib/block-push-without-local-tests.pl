# block-push: no `git push` without a fresh pre-PR gate marker (the gate script is {{stack.commands.pre_pr_gate}}).
# Tokenised: `true; git push`, `git  push`, `/usr/bin/git push`, `command git push`, `git -c a=b push`,
# `GIT_TRACE=0 git push`, `bash -c "git push"` are all judged. The marker may only be written by the gate script, so
# touch/tee/cp/mv/curl/wget/redirects naming `.pre-pr-passed` (any letter case) are blocked; so is a redirect into a variable once one holds the name, sed --in-place and find -exec touch; reading its age (node/python stat, an awk match) is allowed.
# Judged as a push: `git push`, `git send-pack`, `git subtree push`.
# The marker lives in the git dir of the push's repo (per worktree): `git rev-parse --absolute-git-dir`/.pre-pr-passed.
use strict; use warnings;
use ShellParse qw(parse_shell flatten git_calls read_input base git_out);
use HookGuard qw(prepare);

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
my $cwd = $in->{cwd} // $ENV{PWD} // '.';
my ($cmds) = parse_shell($command);
my ($limit, @entries) = prepare($cmds, $cwd, flatten($cmds, $cwd));
if ($limit) { print STDERR "BLOCKED: $limit\n"; exit 2 }

# The marker may only be written by the gate script. Guardrail for honest agents, not a boundary: variables
# assembled at runtime or aliases (`git -c alias.p=push p`) are not chased.
my $MARK = qr/\.pre-pr-(?:passed|[^\s]*[{?*\[])/i;    # case-insensitive: the default macOS volume treats .PRE-PR-PASSED as the same file
# interpreters (incl. versioned python3.12 / php8.2) and writers that can create a file from their own argument text
sub always { my $h = shift; return $h =~ /^(?:touch|tee|truncate|dd|deno|bun|node(?:js)?|tsx|ts-node|python[\d.]*|perl|ruby[\d.]*|php[\d.]*|lua[\d.]*|awk|gawk|mawk|bash|sh|zsh|dash|ksh|eval|osascript|Rscript|tclsh|curl|wget|sponge|ed|ex|vi|vim|nvim|nano|emacs)$/ }
my %DEST   = map { $_ => 1 } qw(cp mv ln install rsync);
# Reading the marker's age is allowed: code that only stats the file (node -e statSync, python -c getmtime) and an awk pattern that only matches its text.
sub read_only_code {
  my ($h, @hits) = @_;
  return 0 unless $h =~ /^(?:deno|bun|node(?:js)?|tsx|ts-node|python[\d.]*|perl|ruby[\d.]*|php[\d.]*|lua[\d.]*)$/;
  for my $w (@hits) {
    return 0 unless $w =~ /(?:statSync|lstatSync|existsSync|accessSync|\bstat\b|\blstat\b|getmtime|getctime|getatime|\.exists\(|isfile|\bmtime\b)/;
    return 0 if $w =~ /(?:write|append|utime|touch|copy|rename|link|open|create|truncate|unlink|\brm\b|mkdir|chmod|chown|system|exec|spawn|popen|subprocess|shutil|replace|move|dump|save|>|\|)/i;
  }
  return 1;
}
sub read_only_awk {
  my ($h, $r, @hits) = @_;
  return 0 unless $h =~ /^(?:awk|gawk|mawk)$/;
  return 0 if grep { /^-i/ || /^--in-place/ || $_ eq '-f' || /^--file/ } @$r[1 .. $#$r];
  return (grep { /[>|]|system\s*\(|getline|close\s*\(/ } @hits) ? 0 : 1;
}
my $mentioned = 0;
for my $e (@entries) { $mentioned ||= (grep { /$MARK/ } @{ $e->{words} }, @{ $e->{redirs} }) ? 1 : 0 }
if ($mentioned) {
  my $deny = 0;
  for my $e (@entries) {
    $deny ||= (grep { />>?\|?$MARK/ || />>?.*$MARK/ } @{ $e->{redirs} }) ? 1 : 0;
    my @r = @{ $e->{rest} }; next unless @r;
    my $h = base($r[0]); my @hitw = grep { /$MARK/ } @r[1 .. $#r]; my $hit = @hitw ? 1 : 0;
    if (always($h)) { $deny ||= ($hit && !read_only_code($h, @hitw) && !read_only_awk($h, \@r, @hitw)) || $e->{facts}{xargs} }
    elsif ($h =~ /^g?find$/) {    # find -exec touch/tee/cp/... naming the marker, or find -fprint into it
      for my $k (1 .. $#r) {
        if ($r[$k] =~ /^-(?:exec|execdir|ok|okdir)$/) { my $x = base($r[$k + 1] // ''); $deny ||= (always($x) || $DEST{$x} || $x eq 'sed') ? 1 : 0 }
        $deny ||= 1 if $r[$k] =~ /^-f(?:print0?|printf|ls)$/;
      }
    }
    elsif ($h eq 'xargs' || $e->{facts}{xargs}) { $deny ||= 1 if always($h) || $DEST{$h} }
    elsif ($DEST{$h}) { $deny ||= ($r[-1] =~ /$MARK/) ? 1 : 0 }
    elsif ($h eq 'sed') { $deny ||= ($hit && grep { /^-[a-zA-Z]*i/ || /^--i(?:n(?:-(?:p(?:l(?:a(?:c(?:e)?)?)?)?)?)?)?(?:=|$)/ } @r) ? 1 : 0 }
  }
  my $varmark = grep { !@{ $_->{rest} } && grep { /^\w+=.*$MARK/ } @{ $_->{words} } } @entries;
  if ($varmark) { for my $e (@entries) { $deny ||= 1 if grep { />>?\|?.*\$/ } @{ $e->{redirs} }; my @r = @{ $e->{rest} }; $deny ||= 1 if @r && (always(base($r[0])) || $DEST{ base($r[0]) }) && grep { /\$/ } @r[1 .. $#r] } }
  $deny ||= (grep { $_->{facts}{xargs} && @{ $_->{rest} } && (always(base($_->{rest}[0])) || $DEST{ base($_->{rest}[0]) }) } @entries) ? 1 : 0;
  if ($deny) {
    print STDERR "BLOCKED: .pre-pr-passed is written only by {{stack.commands.pre_pr_gate}} after a green run.\n  Run {{stack.commands.pre_pr_gate}}; do not create or edit the marker.\n";
    exit 2;
  }
}

for my $g (git_calls(@entries)) {
  next unless $g->{sub} =~ /^(?:push|send-pack)$/ || ($g->{sub} eq 'subtree' && ($g->{args}[0] // '') eq 'push');
  my $dir = $g->{dir}; $dir = $cwd unless defined $dir;
  my $root = git_out($dir, 'rev-parse', '--show-toplevel');
  $root = '.' unless length $root;
  # Scope: only repos that HAVE the gate script.
  next unless -f "$root/{{stack.commands.pre_pr_gate}}";
  my $gitdir = git_out($dir, 'rev-parse', '--absolute-git-dir');
  $gitdir = "$root/.git" unless length $gitdir;
  my $marker = "$gitdir/.pre-pr-passed";
  next if -f $marker && (time - (stat $marker)[9]) < 1800;
  print STDERR <<'MSG';
BLOCKED: git push requires the local pre-PR gate to pass first.

Run the gate script (it runs the checks CI runs):
  {{stack.commands.pre_pr_gate}}

The gate must pass before pushing. This saves CI minutes.
MSG
  exit 2;
}
exit 0;
