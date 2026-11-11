# B-FIX2 Summary

## Task 1 (guard, confirm, session)

### Commits
- `352c6da` fix(agnostic-B-FIX2): hook-reference clauses (1a-1d) and --preset-dir refused for every agent (items 1, 2)
- `a583d6e` fix(agnostic-B-FIX2): escape bidi and zero-width characters in the confirmation text (item 3)
- `7881652` fix(agnostic-B-FIX2): ancestor match exact on claude basename, args narrowed, orphan kept (item 4)

### Outcome
- Item 1, `project-deploy-guard.js` (72 lines): `referencesDest(command, canon)` guards a dest when a hook command (case and NFKD folded) contains (a) the dest path, (b) the basename as a whole token (split on whitespace, quotes, `/`, `;`, `&`, `|`, `$`, parentheses), (c) the dest's immediate directory with its trailing `/`, or (d) a glob token that `globToRegExp` matches against the dest path. `globToRegExp` is new (no glob helper existed in the repo). Module header states that `.claude/settings.local.json` hooks are not read.
- Item 2: `refusalOf` refuses every agent session that passes `--preset-dir` with `preset-dir requires a human terminal`, even with zero guarded paths. `--preset` (name-based) is unchanged. `diff` is still never refused.
- Item 3, `project-deploy-confirm.js`: `CONTROL_RE` adds U+202A-202E, U+2066-2069, U+200B-200D, U+2060, U+FEFF (built with `new RegExp` and `\\u` escapes).
- Item 4, `project-deploy-session.js`: `isAgent` matches `comm` basename against `/^claude$/i` (exact, case-insensitive; was a prefix match). Args match only `/(^|\/)@anthropic-ai\/claude-code(\/|$)|\/claude-code\/(cli|bin)\b/`. Orphan refusal kept. Header documents PID 1 in containers (fail closed).

### Test rows
| Row | Case | Expectation |
|---|---|---|
| 1b | `cd scripts && ./gate.sh` | `scripts/gate.sh` guarded |
| 1c | `bash scripts/` | `scripts/x.sh` guarded |
| 1c+1d | `bash scripts/g*.sh` | `scripts/gate.sh` guarded |
| 1d | `node g?te.sh` (no path, dir or whole basename) | `scripts/gate.sh` guarded |
| 1a | `node ba.sh` (root dest `a.sh`) | guarded by substring |
| 1 | `docs/a.md` vs the four commands above | unguarded |
| 1 | malformed glob `node [x.sh` | no throw, unguarded |
| 2 | agent `init --preset-dir`, docs-only preset | refused, `paths: []`, snapshot unchanged |
| 2 | human `init --preset-dir`, docs-only preset | exit 0, writes |
| 3 | each of 14 bidi/zero-width code points in preset name | raw char absent, `\uXXXX` present |
| 3 | U+202E in a shown path and U+200B in a content line | both escaped |
| 4 | `claudette` ancestor | not an agent |
| 4 | tmux `-s claude-code` arg | not an agent |
| 4 | `.../@anthropic-ai/claude-code/cli.js` ancestor | agent |
| 4 | comm exactly `claude` | agent |

### Changed existing tests (intentional)
- `project-deploy-guard.test.js` H2-c: `scripts/other.sh` now asserted guarded. Clause (c) guards the sibling because the command `$CLAUDE_PROJECT_DIR/SCRIPTS/Gate.sh` contains `scripts/` after folding (spec 1c).
- No assertion changed in `project-deploy.test.js` (A9 already expected the refusal).

### Mutants (`.tmp/mutate-b-fix2-t1.js`; four affected test files per run; baseline rc=0; sha256 checked before and after each)
| Mutant | Killed by (first failing row) | Restored identical |
|---|---|---|
| M1a clause (a) dropped | 1a row | yes |
| M1b clause (b) dropped | 1b row | yes |
| M1c clause (c) dropped | H2-c, 1c row | yes |
| M1d clause (d) dropped | 1d row | yes |
| M2 preset-dir gated on guarded>0 | agent zero-guarded row | yes |
| M3 bidi list reverted to HEAD | U+202A row | yes |
| M4a comm prefix match | `claudette` row | yes |
| M4b args loose substring | tmux row | yes |
| M4c orphan refusal dropped | M5-a | yes |

### Verification
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: rc=0, 1949 pass, 0 fail. Log: `.tmp/agnostic-B-FIX2-T1.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).
- `project-deploy.js` unchanged at 290 lines.

### Deviations and notes
- `globToRegExp` did not exist; implemented in `project-deploy-guard.js` and exported for tests.
- Clause (c) uses only the dest's immediate directory, not every ancestor. Using ancestors would guard `.claude/rules/*` whenever any hook runs from `.claude/`, which breaks the existing "rule-only sync is never refused" row.
- Clause (d) matches the glob with a `(^|/)` suffix anchor, so a basename glob matches any path ending in that basename.
- The `"Claude"` macOS desktop-app comm (P12 SPACED_TABLE) stays refused: the ancestor match is case-insensitive equality, not case-sensitive. This is a judgment call beyond the literal spec.
- Item 1 is still a heuristic. A glob or basename spelled differently (for example via a variable) can still be missed; the settings.local.json limit stays documented.
- Nothing pushed. No `install:gsd`. No stash, reset or clean.

## Self-Check
- Commits `352c6da`, `a583d6e`, `7881652` present on `exp/agnostic`.
- 9 clause mutants killed; 9/9 restored byte-identical.
