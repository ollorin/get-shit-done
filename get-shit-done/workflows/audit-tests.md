<purpose>
Find and fix, across an existing suite, the duplicated tests, the slow tests and the tests that leave rows or files behind. The role is the per-phase test steward (`agents/gsd-test-writer.md`), run here once per test directory or bucket. Edits tests only.
</purpose>

<process>

<step name="units">
Read the profile (`gsd-tools profile get stack.commands`, `gsd-tools profile get stack.gates`, `.planning/STACK-PROFILE.md`) for the test commands and for how the project groups tests (buckets, directories). Units = the directories or buckets named in `$ARGUMENTS`, else every one the profile or the tree defines.

Rank slowest first: per-file or per-bucket seconds from the latest `{phase_dir}/captures/gates.txt` or the runner's own timing output (one timed run of a unit through the profile's `test_file` command is enough; never the full suite). No timing available: rank by test file count.

Time box: `--minutes N` from `$ARGUMENTS`, default 60. Stop starting units when it is spent and say which were not audited.
</step>

<step name="steward">
Reviewer tier: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get reviewer_model --raw --default sonnet`.

For each unit, in rank order, at most 2 at once and never two on overlapping files (one writer per file set):

```
Agent(subagent_type="gsd-test-writer", model="{reviewer_model}", description="Test steward: {unit}",
  prompt="Standalone mode. Unit: {unit}. Worklist: {worklist path}. Return file: {return path}. Commands: {stack_commands verbatim}. Report per your output section.")
```

Before each dispatch run `gsd-tools test-worklist --dir {unit} --out .tmp/steward/{unit-slug}-worklist.json` and pass that path; after it, `gsd-tools verify steward-return --worklist <that file> --file <the return>` with one re-dispatch on exit 1, as in `execute-phase.md` `test_steward`. Each steward commits its own test-only changes. Wait for the wave before the next; a child that died is re-dispatched for the same unit, never resumed alongside its replacement.
</step>

<step name="report">
Print one table: unit | deleted / merged / sped up / added | seconds before -> after | findings left unfixed. Then the totals and the units skipped by the time box. A net-positive test count in any unit needs its stated reason or is listed as a finding. Never push; never run the full suite.
</step>

</process>
