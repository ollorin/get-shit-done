<purpose>
Validate `.planning/` directory integrity and report actionable issues. Checks that the ROADMAP, phase directories on disk, plan/summary numbering, and plan frontmatter are consistent with each other.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="run_health_check">
**Run consistency validation:**

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" validate consistency
```

This is the only validation subcommand the dispatcher implements. It emits JSON:
- `passed`: `true` | `false`
- `errors[]`: array of message strings (structural problems that stop validation, e.g. ROADMAP.md missing)
- `warnings[]`: array of message strings (roadmap/disk drift, numbering gaps, orphaned summaries, missing plan frontmatter)
- `warning_count`: number of warnings

There is no `--repair` flag and no auto-fix machinery — this check is read-only and reports what a human must reconcile.
</step>

<step name="format_output">
**Format and display results:**

Derive the header status from the JSON:
- `errors.length > 0` → **BROKEN**
- `errors.length === 0 && warnings.length > 0` → **DEGRADED**
- otherwise → **HEALTHY**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD Health Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: HEALTHY | DEGRADED | BROKEN
Errors: N | Warnings: N
```

**If errors exist**, list each `errors[]` string:
```
## Errors

- ROADMAP.md not found
```

**If warnings exist**, list each `warnings[]` string:
```
## Warnings

- Phase 5 in ROADMAP.md but no directory on disk
- Gap in phase numbering: 3 → 5
- 02-implementation/02-01-PLAN.md: missing 'wave' in frontmatter
```
</step>

<step name="suggest_fixes">
**If any errors or warnings exist**, tell the user what to reconcile by hand — this workflow does NOT mutate `.planning/`:

- ROADMAP/disk drift → add the missing phase to ROADMAP.md, or create/remove the phase directory.
- Phase- or plan-numbering gaps → renumber with `/gsd:remove-phase` / `/gsd:insert-phase`, or rename directories to the `NN-name` pattern.
- Missing `wave` frontmatter → re-plan the phase (`/gsd:plan-phase`) so the planner regenerates well-formed PLAN.md frontmatter.
- Orphaned SUMMARY.md → confirm whether the plan was deleted intentionally.

If `passed` is `true` and there are no warnings, report a clean bill of health and stop.
</step>

</process>
