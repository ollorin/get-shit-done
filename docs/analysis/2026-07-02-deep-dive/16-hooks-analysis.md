# Hooks Deep Dive — Inventory, Wiring, and Crash Analysis

Scope: every Claude Code hook registered in `~/.claude/settings.json` /
`~/.claude/settings.local.json`, their source files in the GSD repo, their
deployed copies in `~/.claude/`, and the non-GSD `rtk` Bash-rewrite hook.
All findings below are backed by direct dry-runs (representative hook-protocol
JSON on stdin), static code reading, and filesystem evidence (byte sizes,
mtimes, presence/absence of state files) gathered in this session. Every
hook was tested against the **installed** copy (the one actually running for
the user) unless otherwise noted; environment mutations were isolated via a
`HOME`-redirected fake home directory in scratch, never touching real
`~/.claude` state, with one exception (see rtk section) where read-only
`rtk` subcommands were used.

## Inventory & Wiring

`~/.claude/settings.json` registers:

| Event | Matcher | Command | Timeout wrapper |
|---|---|---|---|
| SessionStart | — | `node ~/.claude/hooks/gsd-check-update.js` | none |
| PreToolUse | `Bash` | `~/.claude/hooks/rtk-rewrite.sh` | none |
| PreToolUse | `Read` | `node ~/.claude/get-shit-done/bin/hooks/doc-compression-hook.js` | none |
| PreToolUse | `Write` | `timeout 10s node ~/.claude/get-shit-done/bin/hooks/gsd-protect-managed-files.js` | 10s |
| PreToolUse | `Edit` | `timeout 10s node ~/.claude/get-shit-done/bin/hooks/gsd-protect-managed-files.js` | 10s |
| Stop | — | `node ~/.claude/get-shit-done/bin/hooks/session-end-standalone.js` | none |
| statusLine | — | `/usr/local/bin/node ~/.claude/hooks/gsd-statusline.js` | none |

`~/.claude/settings.local.json` contains only a `permissions` block — no
hooks. It does not add or override anything hook-related.

Timeout protection is inconsistent: only the two `gsd-protect-managed-files.js`
registrations get a shell-level `timeout 10s` wrapper. SessionStart,
Bash-PreToolUse (rtk), Read-PreToolUse (doc-compression), and Stop have no
such wrapper — if any of these ever hangs (network call, DB lock, huge file
read), there is no local safety net beyond whatever default timeout the
Claude Code harness itself applies internally.

### Source → deployed copy map

Two independent directory layouts exist in the repo and are easy to confuse:

- **Top-level repo `hooks/`** (`/Users/ollorin/get-shit-done/hooks/`): contains
  only `gsd-check-update.js` and `gsd-statusline.js`, plus a `dist/` copy of
  the same two files produced by `scripts/build-hooks.js`. These two are
  simple, dependency-free Node scripts copied verbatim to
  `~/.claude/hooks/`.
- **Nested repo package `get-shit-done/get-shit-done/`** (yes, a
  `get-shit-done` directory inside the `get-shit-done` repo,
  144 git-tracked files, this is the actual npm-package root that
  `bin/install.js` deploys from): `get-shit-done/get-shit-done/bin/hooks/`
  holds `doc-compression-hook.js`, `gsd-protect-managed-files.js`,
  `session-end-standalone.js`, `compression-cache.js`, `config.js`, and
  `per-turn.js`. These deploy to `~/.claude/get-shit-done/bin/hooks/`.
- `rtk-rewrite.sh` has **no repo source at all** — it exists only at
  `~/.claude/hooks/rtk-rewrite.sh` (13.0K). It is not part of the GSD
  package; it belongs to the separate `rtk` (Rust Token Killer) CLI proxy
  tool documented in the user's global `~/.claude/RTK.md`. `rtk` itself is a
  Rust binary at `/Users/ollorin/.local/bin/rtk` (`rtk 0.14.0`), invoked by
  this hook, not by GSD.

`gsd-file-manifest.json` (4,940 tracked file entries) and
`gsd-source-path.txt` (`/Users/ollorin/get-shit-done`) exist at
`~/.claude/` and back `gsd-protect-managed-files.js`'s block/allow decision.

## Verdict Table

| Hook | Event | Purpose | Status | Evidence | Perf note |
|---|---|---|---|---|---|
| `rtk` binary (via `rtk-rewrite.sh`) | PreToolUse:Bash | Rewrites raw shell commands to token-saving `rtk` equivalents, then `rtk` executes them | **CRASHING** | Reproduced: `rtk proxy seq 1 5000000 \| head -1` → stderr `thread 'main' panicked at .../stdio.rs:1165:9: failed printing to stdout: Broken pipe (os error 32)`, rtk's own exit code **134** (SIGABRT) via zsh `$pipestatus` | Adds a subprocess per rewritten Bash call; panic itself doesn't add material latency but can flip pipeline exit status under `pipefail` |
| `rtk-rewrite.sh` | PreToolUse:Bash | The rewrite engine itself (pattern-matches ~25 command families, emits `updatedInput`) | **SUSPECT** | `find`/`ls` rewrites don't preserve compatibility with the flags they forward — see Crash Root Causes | Negligible (`jq`/`grep`/`sed` pipeline, sub-10ms) |
| `doc-compression-hook.js` | PreToolUse:Read | Intercept Read of GSD doc files (`STATE.md`, `ROADMAP.md`, `*-PLAN.md`, etc.) and return a compressed summary | **DEAD** (permanent silent no-op) | Two independent bugs both individually sufficient to disable it; `compression-metrics.jsonl` and `compression-state.json` — the files it creates on first successful run — do not exist anywhere on disk, proving it has never fired even once | Currently zero (always exits before doing work); would add per-Read latency on large doc files once/if fixed |
| `gsd-protect-managed-files.js` | PreToolUse:Write/Edit | Block direct edits to installer-managed files under `~/.claude/`, point the user at the real source | **HEALTHY** | Dry-run: managed file → exit 2 + correct guidance message; non-managed file → exit 0; malformed JSON → exit 0 (fail-open); empty stdin → exit 0 | Sub-50ms typical, well inside the 10s wrapper |
| `session-end-standalone.js` | Stop | Consume stdin, clean up stale `/tmp/gsd-session-*` files, (new) prune stale knowledge + checkpoint WAL | **VERSION SKEW** (currently healthy-but-stale; new code untested in production) | Installed copy = 1,449 bytes, mtime 2026-07-04 23:30 — **old** version, no knowledge-maintenance code at all. Repo copy = 2,431 bytes, mtime 2026-07-05 00:12 (~42 min newer) — has the new `pruneStaleEntries`/`checkpointWAL` wiring. Confirmed by direct byte-for-byte read of the installed file via `fs.readFileSync` | Old (live) version: ~5ms. New (unreleased) version tested in isolation: ~50ms on an empty DB, no timeout wrapper once deployed |
| `per-turn.js` | *(none — not registered anywhere)* | Implements a "per-turn" knowledge-extraction pipeline | **DEAD / ORPHANED** | Not present in `settings.json`; `grep` across all installed `.js` finds zero requires of it outside itself | N/A — never executes |
| `config.js` / `compression-cache.js` | *(support modules, not directly hooked)* | Hook-config load/save, circuit breaker, file-based compression cache | **HEALTHY in isolation / unreachable in practice** | All I/O wrapped in try/catch with sane fallbacks; only unreachable because their only caller (`doc-compression-hook.js`) never gets past its own guard | N/A |
| `gsd-check-update.js` | SessionStart | Spawn a detached background npm-registry version check, cache result | **HEALTHY** | Dry-run: exit 0, no stderr, returns immediately (background child is `detached`+`unref`ed) | Non-blocking by design |
| `gsd-statusline.js` | statusLine | Render two-row statusline (model/dir/git/context bar + GSD quota bar) | **HEALTHY** | Dry-run with representative payload produced correct two-line output, exit 0 | Reads/writes several `~/.claude/cache/*.json` files each render; git info cached 5s, quota cached 10s — bounded |

## Crash Root Causes

### 1. `rtk` panics with SIGABRT on early-closed stdout pipes (CONFIRMED, live)

Reproduced directly:

```
$ rtk proxy seq 1 5000000 | head -1
1
$ echo $pipestatus
134 0
```

stderr:
```
thread 'main' (PID) panicked at library/std/src/io/stdio.rs:1165:9:
failed printing to stdout: Broken pipe (os error 32)
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

Mechanics: `rtk` writes its output through Rust's buffered `Stdout`, whose
`print!`/`write_all` calls **panic** on a write error instead of surfacing
it as a `Result`. When a downstream reader (`head`, `head -N`, etc.) reads
what it needs and closes its end, the kernel delivers `EPIPE` on `rtk`'s
next write. Rust's default `SIGPIPE` handling is reset to the OS default
(terminate) only for the *first* write; because `rtk`'s stdout macros
panic rather than checking the `io::Result`, and the process exits via
abort (exit code 134 = `128+SIGABRT`, not the usual clean-unwind 101),
this looks like a double-panic/abort path — most likely `panic = "abort"`
in `rtk`'s release profile, or a panic raised from within the panic-hook's
own final write attempt.

**Blast radius**: In this reproduction, the data the reader actually wanted
(`"1"`) was delivered correctly and completely *before* the panic — stdout
content is not corrupted, and `head`'s own exit code was 0. The damage is
entirely on rtk's own exit status (134) and stderr noise. This only breaks
something concrete when: (a) a script or hook downstream checks the exit
code of the `rtk`-invoking stage specifically (e.g. via `pipestatus`/`PIPESTATUS`
or `set -o pipefail`), or (b) the panic text is mistaken by the model for a
real command failure, wasting a turn on cleanup that isn't needed. Notably,
`rtk-rewrite.sh` itself runs under `set -euo pipefail` — that script doesn't
itself pipe an `rtk` invocation into anything, so it isn't self-vulnerable,
but any *user-composed* command a script rewrites into an `rtk`-prefixed
pipeline (e.g. `rtk git log | head -5` typed directly, or any future rewrite
rule that leaves a trailing `| head`) inherits this fragility.

Confirmed this is specific to raw/unbounded output: `rtk`'s own curated
subcommands (`rtk git log --oneline -a | head -1`, `rtk ls <big-dir> | head -1`)
did **not** panic — they appear to self-limit/summarize output as part of
the tool's normal token-saving behavior, so they rarely produce enough bytes
to fill a pipe before finishing. The panic only reliably reproduces via
`rtk proxy <cmd-with-large-output>` (the documented "no filtering" escape
hatch) or presumably any built-in subcommand whose output isn't pre-bounded.

### 2. Doc-compression hook is a permanent silent no-op (CONFIRMED, two independent bugs)

**Bug A — the config file the guard checks for is never deployed.**
`doc-compression-hook.js` opens with an early-exit guard (lines 6-18) that
reads `path.join(__dirname, '..', '..', 'hook-config.json')` — for the
installed hook this resolves to `~/.claude/get-shit-done/hook-config.json`.
That file **does not exist**:

```
$ test -f ~/.claude/get-shit-done/hook-config.json && echo EXISTS || echo MISSING
MISSING
```

A `hook-config.json` **does** exist, but only at the outer repo root
(`/Users/ollorin/get-shit-done/hook-config.json`) — a path the installed hook
never looks at, and `bin/install.js` has no logic anywhere that copies or
generates `hook-config.json` (`grep -n "hook-config" bin/install.js` → no
matches). Every single `Read` PreToolUse invocation therefore hits
`catch (_) { process.exit(0); }` on line 15-17 before even parsing
`tool_name`/`tool_input`. Verified directly:

```
$ echo '{"tool_name":"Read","tool_input":{"file_path":".../test-STATE.md"}}' \
  | node ~/.claude/get-shit-done/bin/hooks/doc-compression-hook.js
(exit 0, no output)
```

**Bug B — even past the guard, the hook reads the wrong field names.**
Real Claude Code PreToolUse payloads use `tool_name` / `tool_input` (this is
exactly what the sibling hook `gsd-protect-managed-files.js` correctly reads
via `data.tool_input`). `doc-compression-hook.js` instead destructures
`const { tool, parameters } = hookData;` (line 80) and checks
`if (tool !== 'Read') process.exit(0);` (line 83). Isolated proof:

```
$ node -e "
const hookData = JSON.parse('{\"tool_name\":\"Read\",\"tool_input\":{...}}');
const { tool, parameters } = hookData;
console.log(tool, parameters, tool !== 'Read');
"
undefined undefined true
```

`tool` is always `undefined` against the real protocol shape, so the
`tool !== 'Read'` check is **always true** and the hook always passes
through — a second, independent reason the feature can never activate,
layered on top of Bug A.

**Corroborating evidence of total inactivity**: the two files the hook
creates on any successful compression (`~/.claude/get-shit-done/compression-metrics.jsonl`
and `~/.claude/get-shit-done/compression-state.json`, the circuit-breaker
state) do not exist anywhere on disk. Zero compression events have ever
been recorded by this install.

**Latent crash risk (not currently triggered, but real)**: lines 21-23
`require('../compression/header-extractor')`, `require('./config')`,
`require('./compression-cache')` sit at module top-level, **outside** the
`try/catch` that wraps `main()`. If any of `header-extractor.js`'s
dependencies (`markdown-it`, `gray-matter`) were ever missing, this would
throw an uncaught, unhandled exception on process load — crashing the
hook process outright (not the graceful `catch (error) { ...; process.exit(0); }`
path at line 218) on *every single Read call* system-wide. Today this is
masked twice over: Bug A means the requires are only reached if
`hook-config.json` is somehow made to exist, and separately the actual
deps (`markdown-it`, `minimatch`, `dotenv`, `better-sqlite3`) are in fact
present in `~/.claude/get-shit-done/node_modules/`. But the moment someone
"fixes" Bug A without also hardening the require block, a missing/broken
npm install becomes a hard crash on the Read hot path instead of falling
back gracefully.

### 3. `session-end-standalone.js` — deployed hook is stale; new lifecycle code is undeployed and thus unvalidated in production

The installed Stop hook (`~/.claude/get-shit-done/bin/hooks/session-end-standalone.js`,
1,449 bytes, mtime `2026-07-04T23:30:49Z`) is the **pre-Phase-49** version:
stdin drain + temp-file cleanup + `process.exit(0)`. It has no knowledge
DB interaction at all. The repo source
(`/Users/ollorin/get-shit-done/get-shit-done/bin/hooks/session-end-standalone.js`,
2,431 bytes, mtime `2026-07-05T00:12:53Z`, ~42 minutes newer) already
contains the new `runKnowledgeMaintenance()` function
(`pruneStaleEntries` + `checkpointWAL` against the global knowledge DB at
`~/.claude/knowledge/<user>.db`). This was confirmed by reading the
installed file's actual bytes via `fs.readFileSync` directly (bypassing any
caching) — it genuinely lacks the function; this is not a test artifact.

Practical implication: `bin/install.js` has not been re-run since this repo
edit landed, so **the new prune/checkpoint-on-stop behavior is not live for
the user yet** — today's Stop hook is simple and safe. When install *is*
re-run, the new code will go live for the first time in production. Testing
the new code's logic directly (in isolation, via a `HOME`-redirected fake
home so no real `~/.claude/knowledge/` data was touched) showed it behaves
correctly: opens/creates the SQLite DB (`vectorEnabled: true`), runs
`pruneStaleEntries`/`checkpointWAL` cleanly, completes in ~50ms against an
empty DB, and its error handling is layered (inner try/catch around
`process.stderr.write` inside an outer try/catch around the whole
DB/require sequence) so it should never throw past `runKnowledgeMaintenance()`
itself.

Two residual risks in the new (not-yet-deployed) code, both about
production readiness rather than confirmed crashes:
- No timeout wrapper is applied to the Stop hook in `settings.json` (unlike
  the `timeout 10s` GSD added for the Write/Edit protect-managed-files
  hook). `pruneStaleEntries` → `getStaleKnowledge` computes a per-candidate
  `getStalenessScore` with its own separate `SELECT` for up to `limit=200`
  rows — an N+1 query pattern that is fine on a small personal DB today but
  has no ceiling if the knowledge DB grows large, and nothing would time it
  out if it ever got slow.
- `knowledge-db.js`'s `getDBPath()` hardcodes
  `path.join(os.homedir(), '.claude', 'knowledge', ...)` with no
  environment-variable override (no `GSD_KNOWLEDGE_DB_PATH` or equivalent
  exists in the current source). This made it impossible to safely dry-run
  the *installed* Stop hook's DB path against a disposable database without
  redirecting `HOME` wholesale — a testability gap that also means there is
  currently no supported way to point this hook at a non-default DB (e.g.
  for a per-project knowledge store) without an env-var mechanism.

### 4. `per-turn.js` is dead code, not a "crashing" hook but a discovered-but-unused feature

`per-turn.js` (installed at
`~/.claude/get-shit-done/bin/hooks/per-turn.js`, present in both repo copies)
implements `perTurnHook`/`createPerTurnMiddleware`, wired to call
`extractKnowledge` and `processExtractionBatch` on every assistant turn. It
is **not** registered anywhere in `settings.json` (no PostToolUse/Stop entry
references it), and a repo-wide grep for `per-turn|perTurnHook|createPerTurnMiddleware`
outside the file itself returns zero matches. It cannot crash because it
never runs; it is inert dead weight, most likely a half-finished feature
(there is a comment in `session-end-standalone.js` noting "Knowledge
extraction now happens at phase start via mine-conversations... not per
turn," suggesting `per-turn.js` was superseded but never deleted).

### 5. `rtk-rewrite.sh` rewrites `find`/`ls` into forms that break on standard flags

Encountered live during this investigation: a plain
`find /path -maxdepth 3 -iname '*hook*'` issued through the Bash tool was
silently rewritten (per the hook's own logic, `^find[[:space:]]+` →
`rtk find /path -maxdepth 3 -iname '*hook*'`) and **failed outright**:

```
error: invalid value 'axdepth' for '--max <MAX>': invalid digit found in string
```
and, on a corrected retry:
```
error: unexpected argument '-i' found
Usage: rtk find [OPTIONS] <PATTERN> [PATH]
```

`rtk find`'s CLI does not accept GNU-`find`-style `-maxdepth N` or `-iname`
flags — the rewrite hook has no compatibility check before substituting
`find` → `rtk find`, so any command using those (extremely common) flags
is turned into a broken invocation and hard-fails (exit code 2) even though
the *original* unmodified `find` command would have worked fine. Separately,
`ls -la <dir>` gets rewritten to `rtk ls -la <dir>`, which does **not**
error but silently ignores `-la` and returns `rtk`'s own summarized format
(`file  size` list + `📊 N files, N dirs` footer) instead of real long-format
`ls -la` output — a silent output-shape substitution with no error signal,
arguably more insidious than the `find` case since nothing indicates the
requested flags were ignored. Both were worked around in this session by
invoking the tools via absolute path (`/usr/bin/find`), which the rewrite's
`case` patterns don't intercept (they match on the bare leading token, not
absolute paths) — itself informative: the rewrite is trivially bypassed by
path qualification but not deliberately opt-out-able by an agent that
doesn't already know this trick.

## Observations

- **Dual repo layout is a version-skew hazard.** Hook sources live in two
  unrelated directories inside the same repo:
  `/Users/ollorin/get-shit-done/hooks/` (2 files: check-update, statusline)
  and `/Users/ollorin/get-shit-done/get-shit-done/bin/hooks/` (6 files: the
  compression/protection/session-end family). `git status` at the top of
  this session showed uncommitted modifications to
  `get-shit-done/bin/gsd-tools.js` and `get-shit-done/bin/knowledge-synthesis.js`
  in that nested package — i.e. active edits are already landing in exactly
  the directory that feeds `bin/install.js`. The confirmed session-end skew
  (Root Cause 3) is a direct, currently-observable instance of this hazard:
  repo and install drift apart the moment a hook file changes and installer
  isn't re-run, with no automated check surfacing the drift.
- **Timeout coverage is inconsistent across the hook set.** Only the two
  Write/Edit `gsd-protect-managed-files.js` registrations get a `timeout 10s`
  wrapper in `settings.json`. SessionStart, PreToolUse:Bash (rtk),
  PreToolUse:Read (doc-compression), and Stop have none.
- **Dependency health for the GSD hook package is currently fine.**
  `~/.claude/get-shit-done/node_modules/` has `dotenv`, `markdown-it`,
  `minimatch`, `better-sqlite3` all present, matching
  `~/.claude/get-shit-done/package.json`'s declared deps
  (`dotenv`, `markdown-it`, `gray-matter`, `minimatch`, `better-sqlite3`,
  `sqlite-vec`, `@xenova/transformers`). No missing-dependency crash is
  live today; the risk noted in Root Cause 2 is latent, contingent on a
  future reinstall or environment change.
- **No historical crash logs exist to review.** There is no `*.log` under
  `~/.claude/hooks/`, and no `.jsonl`/`.log` files exist at the top level of
  `~/.claude/get-shit-done/` at all beyond the config/manifest JSON files
  already discussed — meaning there's no hook-side logging/telemetry
  mechanism to fall back on for post-hoc crash diagnosis; the only way to
  learn a GSD hook failed is either an inline `stderr.write` (which several
  hooks emit) or total silence (as with doc-compression, which never even
  gets that far).
- **`config.js`'s config path resolution is hardcoded independently of the
  hook that calls it.** `doc-compression-hook.js`'s own early guard resolves
  its config path via `__dirname`-relative traversal, while `config.js`'s
  `loadHookConfig()`/`CONFIG_PATH` hardcodes
  `path.join(process.env.HOME, '.claude', 'get-shit-done', 'hook-config.json')`
  regardless of where the script is actually running from. They coincide
  today only because the installed layout happens to line up; running
  either module from a different location (e.g. directly from the repo, as
  attempted during this investigation) silently targets the real user's
  home directory instead of wherever the script lives — a footgun for
  anyone testing these hooks locally without being aware of it.
- **`knowledge-db.js` has no path override mechanism.** `getDBPath()`
  hardcodes `~/.claude/knowledge/<username>.db` for both `'global'` and
  `'project'` scopes with no environment variable indirection, which is why
  `session-end-standalone.js`'s new knowledge-maintenance code could only be
  safely exercised in this investigation by redirecting the entire `HOME`
  environment variable, not a narrower DB-specific override.

---

## Recommendations (orchestrator synthesis, 2026-07-05)

Ranked. Items marked [v1.14] should land inside the current milestone; [rtk] belong in the separate rtk project; [v1.15] go to the next cycle.

### R-1 [v1.14] Resurrect the doc-compression hook (three stacked bugs, feature never ran once)
The flagship "60-70% token reduction" feature is provably dead-on-arrival — zero metrics files have ever been written. Three fixes, all small:
1. **Installer**: deploy `hook-config.json` to `~/.claude/get-shit-done/hook-config.json` in `bin/install.js` (the early-exit guard path). Squarely MILE-20 territory (install fixes) — fits the current milestone.
2. **Protocol fields**: the hook reads `hookData.tool`/`hookData.parameters`; Claude Code sends `tool_name`/`tool_input` (sibling hook `gsd-protect-managed-files.js` does it right). Fix the field names.
3. **Unguarded requires**: wrap in try/catch fail-open so a missing dep can never hard-crash every Read.
Then actually measure the reduction (this also resolves audit P3-5 honestly). Suggested vehicle: gap-closure plan appended to Phase 50 scope.

### R-2 [v1.14] Delete `per-turn.js` (orphaned hook, never registered anywhere) — add to the Phase 50 sweep list.

### R-3 [v1.14] Timeout-wrap the Stop hook registration
Phase 44 timeout-wrapped PreToolUse hooks; the Stop hook (session-end-standalone.js) has no timeout in settings.json. Phase 49 just made it do more work (knowledge prune + WAL checkpoint). Add the same timeout pattern at registration in install.js.

### R-4 [rtk] Fix the broken-pipe panic in the rtk binary
Reproduced: `rtk proxy <large-output> | head -1` → Rust panic on stdout EPIPE → exit 134 (SIGABRT). Data reaching the reader is fine, but the abnormal exit breaks pipefail pipelines and litters every session with panic noise. Standard Rust fix in rtk main(): restore default SIGPIPE disposition (libc::signal(SIGPIPE, SIG_DFL)) or route stdout writes through error-checked writes that exit 0 on EPIPE. Separate repo — file it there.

### R-5 [rtk] Flag-compatibility guard in `rtk-rewrite.sh`
The rewriter turns `find`/`ls`/`grep` into rtk subcommands without checking flag support (observed live: `find -maxdepth` mangled into "invalid value 'axdepth'"). Guard: only rewrite when args match the rtk subcommand's supported surface; otherwise pass through to the real binary.

### R-6 [v1.15] Version-skew detection (S-4, now with three concrete incidents)
This investigation itself tripped on skew twice: (a) installed session-end hook is the pre-49 version while repo has the new one (expected mid-run, but undetectable), and (b) the investigating agent reported "no GSD_KNOWLEDGE_DB_PATH override" because it read the installed copy — repo HEAD has it (knowledge-db.js:39, landed in 49-01). A content-hash manifest + SessionStart warning would have labeled both instantly. Evidence file for the S-4 proposal in doc 15.

### Corrections to agent findings
- "knowledge-db.js has no env-var path override" — TRUE for the installed copy, FALSE for repo HEAD (landed in 49-01, commit 77b7e77). Skew artifact, not a code gap.
- session-end skew is expected mid-run (orchestrator deploys at phase gates; Phase 49 has not gated yet) — the issue is detectability, not a process violation.
