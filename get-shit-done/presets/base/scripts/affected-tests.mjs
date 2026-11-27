// Affected tests: prints the tests a diff affects as one JSON line { full, files, reason }.
// Usage: node scripts/affected-tests.mjs <base-ref>   (required; diffs merge-base(base-ref, HEAD) to the working tree). Exit: 0 selected, 2 config, base or git failure.
// Config: stack.affected.tests in .planning/config.json (selection rules in scripts/lib/affected.mjs).
import { main } from './lib/affected.mjs';

process.exitCode = main('tests', process.argv);
