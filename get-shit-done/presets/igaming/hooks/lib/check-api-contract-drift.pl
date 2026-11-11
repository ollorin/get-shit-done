# check-api-contract-drift: run the API contract diff before an agent `git commit` (Phase 269).
# The target repo is resolved like block-push (cd / -C / payload cwd); a repo without
# scripts/api-contract/diff-registries.ts is skipped (RULING A10/B3), so `cd ~/get-shit-done && git commit`
# is not judged by this project's contract. Matches `a; git commit`, `git -C x commit`, `rtk git commit`.
use strict; use warnings;
use ShellParse qw(parse_shell flatten git_calls read_input git_out run_capture);

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';
my $cwd = $in->{cwd} // $ENV{PWD} // '.';
my ($cmds) = parse_shell($command);
my %seen;
for my $g (git_calls(flatten($cmds, $cwd))) {
  next unless $g->{sub} eq 'commit';
  my $dir = $g->{dir}; $dir = $cwd unless defined $dir;
  my $root = git_out($dir, 'rev-parse', '--show-toplevel');
  next unless length $root && -f "$root/scripts/api-contract/diff-registries.ts";
  next if $seen{$root}++;
  my ($out, $status) = run_capture($root, 1, 'deno', 'run', '--allow-read', 'scripts/api-contract/diff-registries.ts');
  print STDERR $out;
  if ($status != 0) {
    print STDERR "\nBLOCKED: API contract drift detected (frontend call with no matching backend route).\n";
    print STDERR "See output above. Fix the drift, or add a documented waiver to scripts/api-contract/waivers.json.\n";
    exit 2;
  }
}
exit 0;
