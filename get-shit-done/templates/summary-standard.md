---
phase: XX-name
plan: YY
subsystem: [primary category]
tags: [searchable tech]
provides:
  - [bullet list of what was built/delivered]
affects: [list of phase names or keywords]
tech-stack:
  added: [libraries/tools]
  patterns: [architectural/code patterns]
key-files:
  created: [important files created]
  modified: [important files modified]
key-decisions:
  - "Decision 1"
duration: Xmin
completed: YYYY-MM-DD
---

# Phase [X]: [Name] Summary

**[Substantive one-liner describing outcome]**

## Performance
- **Duration:** [time]
- **Tasks:** [count completed]
- **Files modified:** [count]

## Accomplishments
- [Key outcome 1]
- [Key outcome 2]

## Task Commits
1. **Task 1: [task name]** - `hash`
2. **Task 2: [task name]** - `hash`
3. **Task 3: [task name]** - `hash`

## Files Created/Modified
- `path/to/file.ts` - What it does
- `path/to/another.ts` - What it does

## Decisions & Deviations
[Key decisions or "None - followed plan as specified"]
[Minor deviations if any, or "None"]

## Defect Classes
| class | instance | caught_by | severity | rule_gap |
|---|---|---|---|---|
| [general class name] | [path/file.ext:line] | [plan-check\|test-writer\|mutation-proof\|opus-diff-review\|opus-ruling\|verifier\|ui-qa\|other] | [critical\|major\|minor] | [rule that should have prevented it, or "none — new rule needed"] |

Nothing found? Delete the table and leave exactly `None found. (reviewed by: <caught_by values>)` where each value is one of plan-check, test-writer, mutation-proof, opus-diff-review, opus-ruling, verifier, ui-qa, other (e.g. `None found. (reviewed by: plan-check, verifier)`) — a bare `None found.` is a gate failure. Never omit the section.

## Next Phase Readiness
[What's ready for next phase]
