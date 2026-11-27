// Targeted UI QA: prints the specs a diff affects as one JSON line { full, files, reason }.
// Usage: node scripts/affected-specs.mjs [base-ref]   (base-ref defaults to HEAD). Exit: 0 selected, 2 config or git failure.
// Config: stack.affected.specs in .planning/config.json (selection rules in scripts/lib/affected.mjs).
import { main } from './lib/affected.mjs';

process.exitCode = main('specs', process.argv);
