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

## Task 2 (scan, apply, project-deploy adoption)

### Commits
- `0bbd174` fix(agnostic-B-FIX2): scan regexes bounded, long lines sliced, assigned_secret values must look like secrets (items 5, 6)
- `489f83f` fix(agnostic-B-FIX2): applyPlan re-checks containment, reports unrestored paths, sweeps crash temps (items 7, 8b)
- `a3290e0` fix(agnostic-B-FIX2): unmanaged files byte-equal to the render are adopted, not conflicting (item 8a)

### Outcome
- Item 5, `project-deploy-scan.js`: `url_credentials` scheme `[a-z][a-z0-9+.-]{0,15}` with `(?<![a-z0-9+.-])`. `scanText` slices lines over `LINE_CAP` (20000) with `LINE_OVERLAP` (100) via `sliceLine`. A 200k run finishes in well under 250 ms for every pattern (test 7).
- Item 6: `assigned_secret` is a regex plus an `accept` predicate on the captured value. Rejected: `(` or `)`, `.` followed by a letter, prefixes `env(`, `process.`, `os.`, `getenv`. Accepted only with a digit, a `_+/=` separator, or mixed case at 20+ chars. All five spec negatives produce no hit. `scanText` checks every match, not just the first, so a rejected call earlier on a line does not hide a later secret.
- Item 7, `project-deploy-apply.js`: the containment re-check before rename is tested with a dest dir swapped for a symlink. `applyPlan` header documents `written` (renamed paths on success, unrestored paths on failure). Failed restore is tested: `ok` false, `rolled_back` false, `written` `['a.txt']`, content asserted.
- Item 8a, `project-deploy.js` `planFile`: `adopt` when there is no manifest entry and the bytes equal the rendered content. No write; the manifest records it. Differing content stays `conflict`.
- Item 8b: `clearStaleTemps` removes regular files named `.gsd-tmp-` + 16 hex in this plan's dest dirs. Other names and other dirs are untouched.

### Deviations
- Hyphen is not an entropy marker. Spec literal `_-+/=` would make `Token: expiration-policy-document` (a spec negative) a hit. Hyphen is excluded.
- `Deno.` is not listed in the module. The literal trips the ratchet term class `deno` (`scripts/agnostic-lint.js check` RISE). The `.member` rule already rejects every `Deno.x` form. The Deno negative row lives in the test file, which is outside the lint scope.
- `clearStaleTemps` renamed from `sweepStale` because `sweeps` is a ratchet term (case-insensitive).
- The preset golden is unchanged: `preset-igaming.test.js` 6/6 green. The igaming redaction is already in the preset (`<redacted:assigned_secret>`), and `scanDir` on `get-shit-done/presets` is 0 hits over 54 files, so nothing needed to be reported to the coordinator.
- Block files with no manifest and differing content still take the existing `update` path, not `conflict`. Unchanged; the spec's conflict rule was applied to whole-file dests only.
- A failed restore leaves its restore temp (`<dest>.gsd-tmp-<16 hex>`) on disk. The new sweep removes it on the next apply. Not separately cleaned in `rollback`.

### Mutants (`.tmp/mutate-b-fix2-t2.js`, log `.tmp/agnostic-B-FIX2-T2-mutants.log`; baseline rc=0; each file restored and sha256-checked)
| Mutant | First failing row | Killed | Restored identical |
|---|---|---|---|
| M5a url_credentials unbounded (HEAD regex) | 7 ReDoS | yes | yes |
| M5b url lookbehind dropped | 8 long scheme | yes | yes |
| M5c line cap removed | 9 sliceLine | yes | yes |
| M5d overlap 0 | 10 boundary token | yes | yes |
| M6a paren/call clause dropped | 6 self-scan (test-file negative rows) | yes | yes |
| M6b getenv/env prefix clause dropped | 6 self-scan | yes | yes |
| M6c entropy clause dropped | 6 self-scan | yes | yes |
| M6d hyphen counted as entropy | 6 self-scan | yes | yes |
| M6e mixed-case clause dropped | 12 mixed-case positive | yes | yes |
| M6f member-access narrowed to parens | 6 self-scan | yes | yes |
| M7a containment check replaced by `{}` | L5a symlink swap | yes | yes |
| M7b `rolled_back` always true | L5b restore failure | yes | yes |
| M8a adopt always | P10 unchanged preset | yes | yes |
| M8b adopt never | adopt row | yes | yes |
| M8c any `*.gsd-tmp-*` removed | apply temp-name row | yes | yes |

M5a finishes but exceeds the 250 ms bound, so test 7 fails on its timing assertion (no timeout). The self-scan rows (M6a, b, c, d, f) fail because the mutant accepts the literal negative rows in the test file, which test 6 also scans; this is a valid kill of the clause.

### Verification
- `NODE_PATH=$HOME/get-shit-done/node_modules npm test`: rc=0, 1960 pass, 0 fail (was 1949 after Task 1). Log: `.tmp/agnostic-B-FIX2-T2.log`.
- `node scripts/agnostic-lint.js check`: ok (869 denied, 338 allowed).
- `project-deploy.js` 292 lines, `project-deploy-apply.js` 190, `project-deploy-scan.js` 90.
- Nothing pushed. No `install:gsd`. No stash, reset or clean. `.audit/` left untouched.

## Findings -> commits
| Review finding | Item | Commit |
|---|---|---|
| M3 ReDoS in url_credentials; long-line cap | 5 | `0bbd174` |
| L7 assigned_secret false positives; igaming regression | 6 | `0bbd174` |
| L5 containment re-check and failed-restore reporting | 7 | `489f83f` |
| L6 applyPlan rollback tests | 7 | `489f83f` |
| L9 adopt of byte-equal unmanaged files | 8a | `a3290e0` |
| L9 stale temp sweep | 8b | `489f83f` |

Final test count: 1960 pass, 0 fail.
