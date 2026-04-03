<overview>
Per-phase audit logging captures a structured record of every significant agent action during
plan execution. Audit logs are append-only JSONL files in `.planning/audit/` — one file per phase.

Purpose:
- Post-hoc debugging when a phase produces unexpected output
- Compliance evidence that tests ran, gates were checked, commits were made
- Input for future learning extraction (which patterns led to good vs bad outcomes)
</overview>

<audit_log_location>

## Storage Location

```
.planning/audit/
  phase-{N}-audit.jsonl    # e.g., phase-236-audit.jsonl
```

One file per phase. The file is append-only — never overwrite existing entries.
Create the `.planning/audit/` directory if it does not exist.

</audit_log_location>

<entry_format>

## Audit Log Entry Format

Each line is a self-contained JSON object (JSONL format):

```json
{
  "ts": "2026-04-03T10:15:30Z",
  "phase": 236,
  "plan": "236-01",
  "event": "task_complete",
  "task_index": 1,
  "task_name": "Create open-pr command with preflight gate",
  "data": {
    "files_written": ["~/get-shit-done/commands/gsd/open-pr.md"],
    "commit": "abc1234",
    "duration_seconds": 45
  }
}
```

**Required fields for all entries:**
- `ts` — ISO 8601 timestamp
- `phase` — phase number (integer)
- `plan` — plan identifier string (e.g., "236-01")
- `event` — event type (see below)

**Optional fields (include when relevant):**
- `task_index` — task number within plan
- `task_name` — human-readable task name
- `data` — event-specific payload

</entry_format>

<event_types>

## Event Types

| Event | When to emit | Required `data` fields |
|-------|-------------|------------------------|
| `plan_start` | Plan execution begins | `plan_file`, `task_count` |
| `task_start` | Task begins execution | `task_index`, `task_name` |
| `task_complete` | Task completes successfully | `task_index`, `files_written`, `commit` |
| `task_failed` | Task fails | `task_index`, `error` |
| `test_run` | Tests executed | `command`, `result`, `pass_count`, `fail_count` |
| `gate_check` | Compliance gate evaluated | `gate_name`, `passed`, `reason` |
| `checkpoint_reached` | Checkpoint block encountered | `checkpoint_type`, `gate` |
| `checkpoint_resolved` | Checkpoint resolved | `checkpoint_type`, `outcome` |
| `install_script_run` | GSD install script executed | `result`, `files_propagated` |
| `plan_complete` | Plan finishes, SUMMARY.md written | `summary_path`, `total_tasks`, `duration_seconds` |

</event_types>

<write_commands>

## Writing Audit Log Entries

### Via gsd-tools.js (preferred)

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" audit-log write \
  --phase 236 \
  --plan "236-01" \
  --event task_complete \
  --data '{"task_index":1,"task_name":"Create open-pr command","files_written":["open-pr.md"]}'
```

### Via inline shell (fallback when gsd-tools not available)

```bash
AUDIT_DIR=".planning/audit"
mkdir -p "$AUDIT_DIR"
AUDIT_FILE="$AUDIT_DIR/phase-${PHASE_NUMBER}-audit.jsonl"
ENTRY=$(node -e "
const d = {
  ts: new Date().toISOString(),
  phase: ${PHASE_NUMBER},
  plan: '${PLAN_ID}',
  event: '${EVENT}',
  data: ${DATA_JSON}
};
process.stdout.write(JSON.stringify(d));
")
echo "$ENTRY" >> "$AUDIT_FILE"
echo "Audit log entry written to $AUDIT_FILE"
```

### Verification that write succeeded

```bash
# Check entry was appended
tail -1 ".planning/audit/phase-${PHASE_NUMBER}-audit.jsonl" | node -e "
  const d = require('fs').readFileSync('/dev/stdin', 'utf8');
  try { JSON.parse(d); console.log('OK — valid JSON entry'); }
  catch(e) { console.error('INVALID JSON: ' + e.message); process.exit(1); }
"
```

</write_commands>

<gsd_executor_instructions>

## Instructions for gsd-executor Agents

Write audit log entries at these points during plan execution:

1. **Plan start** — before executing any tasks
2. **Each task start** — before beginning task work
3. **Each task complete or failed** — immediately after
4. **Any gate check** — preflight gate, FP lint, test run
5. **Plan complete** — after SUMMARY.md is written

This produces a complete chronological trace of the execution. If a plan fails mid-way,
the audit log shows exactly where execution stopped.

**Non-fatal:** If the audit log write fails (disk full, permissions), log the error and
continue execution. Audit logging MUST NOT block plan execution.

</gsd_executor_instructions>

<retention>

## Retention Policy

Audit logs are kept indefinitely as part of the project planning record.
They are committed to git along with PLAN.md and SUMMARY.md files.

To clean up old audit logs:
```bash
# Keep only logs from phases completed in the last 30 days
find .planning/audit/ -name "phase-*-audit.jsonl" -mtime +30 -delete
```

</retention>
