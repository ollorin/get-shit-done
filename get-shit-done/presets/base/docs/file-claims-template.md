# Phase file claims

Append-only. Read a peer's CLAIMED rows before you touch anything listed here.
Release protocol: remove your own rows only; never rewrite another phase's rows.

Status key: CLAIMED = active edit window. A peer that needs one of these files messages the owning lane and does not edit silently. PLANNED = listed, not started. A released section is deleted.

Copy the section below for each lane. Use the phase id, the plan id and the date of the claim.

## <phase id> — <phase name> (CLAIMED <YYYY-MM-DD>)

| File | Plan | Note |
|---|---|---|
| `<path/to/file>` | `<phase>-<plan>` | `<what changes in this file>` |
