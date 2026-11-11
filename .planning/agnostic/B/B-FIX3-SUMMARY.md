# B-FIX3 summary

Branch exp/agnostic. Full gate `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: 1979 tests, 0 fail, 0 skipped (B-FIX2 ended at 1960). Ratchet lint `scripts/agnostic-lint.js check`: ok. Igaming preset scan: 54 files, 0 hits.

| Item | Commit | Mutants (each killed) | Tests added |
|---|---|---|---|
| F1 glob ReDoS | c0dc9f6 | 1: regex glob build (no bound) → F1-a timeout | 3 |
| F2 slice overlap | 174f26e | 1: overlap 100 → F2-a/b/c fail | 3 |
| F3 assigned_secret | 3ef4c17 | 1: B-FIX2 code rule → F3-a fails | 2 |
| F4 guard heuristics | f845923 | 5: stem off, no backslash fold, dir substring, no literal rule, no root prefix → all fail | 6 |
| F6 adopt | 24c5cf8 | 3: adopt not counted, no mode check, apply ignores mode-only → all fail | 2 |
| G7 skip contract | d57b507 | 1: skip on any probe error → G7-skip fails | 2 |

Totals: 12 mutants killed, 19 tests added. Every mutant file was restored byte-identical.

## Deviations (coordinator to confirm)

- **F1 matcher.** Collapsing wildcard runs does not fix the backtracking. Measured in bounded child processes: `*a*a*…` with 30 groups against a 70-char path still ran past 3 s, and `*b**b**…` took 1.5 s. `globToRegExp` is replaced by `globMatch`, a dynamic-programming matcher with no regex and no backtracking. Globs over 256 chars match nothing.
- **F1 "recorded".** An over-long glob is treated as unguarded with no report field. Adding a report field would have pushed `project-deploy.js` past its cap. Not implemented as a recorded entry.
- **F4 `$VAR/` prefix.** `$CLAUDE_PROJECT_DIR/scripts/gate.sh` must still guard its sibling (existing H2-c test). The project-root prefix (`./`, `$VAR/`) is dropped before the directory check.
- **F6 mode update.** `update` must actually change the mode, so `stageStep` now writes a byte-equal file when only its mode differs. Rollback still restores the original mode.
- **Line cap.** `project-deploy.js` is 298 lines (was 292), under the 300 cap but not extracted.

## Notes

- `project-deploy-guard.js` now also documents unguarded run-time paths (variable expansion, computed `node -e` paths).
- G7 reads `GSD_IGAMING_REPO` (default `/Users/ollorin/igaming-platform`); G6 keeps the literal path because it counts occurrences inside the fragment.
