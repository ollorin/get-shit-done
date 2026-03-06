# Upstream Cherry-Picks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port 5 upstream GSD commits into our fork, handling markdown cherry-picks cleanly and manually porting `lib/*.cjs` changes to our monolithic `gsd-tools.js`.

**Architecture:** Upstream has refactored to a modular `lib/` structure we don't have. For commits that touch `lib/*.cjs`, we cherry-pick only the markdown files and port the logic changes directly to `get-shit-done/bin/gsd-tools.js`. For pure-markdown commits we cherry-pick normally and resolve any conflicts with our local changes.

**Tech Stack:** Git cherry-pick, bash, Node.js (gsd-tools.js monolith at `get-shit-done/bin/gsd-tools.js`)

---

## Commits to apply (in order)

| SHA | What | Approach |
|-----|------|----------|
| `a7c08bf` | `--discuss` flag for `/gsd:quick` | Pure markdown cherry-pick |
| `517ee0d` | Windows `@file:` protocol fix | Markdown cherry-pick (minor conflicts expected) |
| `ef032bc` | Nyquist hardening (defaults, gates, W008/W009, validate-phase) | Partial cherry-pick + port lib/ changes to gsd-tools.js |
| `73efecc` | Missing frontmatter for gsd-nyquist-auditor | Pure cherry-pick (new file) |
| `c298a1a` | Rename `depth` → `granularity` with migration | Partial cherry-pick + port migration to gsd-tools.js |

---

### Task 1: Cherry-pick `--discuss` flag for `/gsd:quick` (a7c08bf)

**Files:**
- Modify: `commands/gsd/quick.md`
- Modify: `get-shit-done/workflows/quick.md`

**Step 1: Cherry-pick the commit**

```bash
git cherry-pick a7c08bf
```

Expected: clean apply (no conflicts — we haven't touched these files).

**Step 2: Verify the flag was added**

```bash
grep -n "discuss" get-shit-done/workflows/quick.md | head -10
grep -n "discuss" commands/gsd/quick.md | head -10
```

Expected: `--discuss` flag appears in both files.

**Step 3: Commit (cherry-pick auto-commits, just verify)**

```bash
git log --oneline -2
```

---

### Task 2: Cherry-pick Windows `@file:` protocol fix (517ee0d)

**Files:** ~30 workflow/agent markdown files, including `agents/gsd-executor.md` and `agents/gsd-planner.md` which we've modified.

The fix adds one line to bash blocks in each consumer:
```bash
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

**Step 1: Attempt cherry-pick**

```bash
git cherry-pick 517ee0d
```

**Step 2: Check for conflicts**

```bash
git status
```

If conflicts exist in `agents/gsd-executor.md` or `agents/gsd-planner.md`:
- Open the conflicted file
- Keep BOTH our additions AND the `@file:` line from upstream
- The `@file:` line must go right after the `INIT=` bash variable assignment in each agent's init block
- Mark resolved: `git add <file>`

**Step 3: Continue cherry-pick after resolving**

```bash
git cherry-pick --continue
```

**Step 4: Verify the fix is in our modified agents**

```bash
grep "@file:" agents/gsd-executor.md
grep "@file:" agents/gsd-planner.md
```

Both should match: `if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi`

---

### Task 3: Nyquist hardening — cherry-pick markdown portion (ef032bc)

The full commit touches: new markdown files + `lib/*.cjs` changes we don't have. Strategy: cherry-pick with `--no-commit`, then drop the lib/ hunks from staging (they'd fail anyway since the files don't exist), keep all markdown changes, then manually port the logic.

**Files created (new — no conflict):**
- `agents/gsd-nyquist-auditor.md`
- `commands/gsd/validate-phase.md`
- `get-shit-done/workflows/validate-phase.md`

**Files modified (markdown — cherry-pick these):**
- `agents/gsd-phase-researcher.md`
- `agents/gsd-plan-checker.md`
- `get-shit-done/workflows/plan-phase.md`
- `get-shit-done/workflows/audit-milestone.md`
- `get-shit-done/workflows/health.md`
- `get-shit-done/workflows/new-project.md`
- `get-shit-done/workflows/settings.md`
- `get-shit-done/references/model-profiles.md`

**Files to NOT apply (lib/ — we'll port manually in Task 4):**
- `get-shit-done/bin/lib/config.cjs` → port to gsd-tools.js
- `get-shit-done/bin/lib/core.cjs` → port to gsd-tools.js
- `get-shit-done/bin/lib/verify.cjs` → port to gsd-tools.js

**Step 1: Cherry-pick without committing**

```bash
git cherry-pick ef032bc --no-commit
```

**Step 2: Check what staged and what conflicted**

```bash
git status
```

Any lib/*.cjs files showing as conflicts: remove them from staging.

```bash
# The lib/ files don't exist in our tree, so cherry-pick may either create them
# or report conflicts. Either way, remove them:
git rm --cached get-shit-done/bin/lib/config.cjs 2>/dev/null || true
git rm --cached get-shit-done/bin/lib/core.cjs 2>/dev/null || true
git rm --cached get-shit-done/bin/lib/verify.cjs 2>/dev/null || true
# Also delete the actual files if created:
rm -f get-shit-done/bin/lib/config.cjs get-shit-done/bin/lib/core.cjs get-shit-done/bin/lib/verify.cjs
```

**Step 3: Verify the new files exist**

```bash
ls agents/gsd-nyquist-auditor.md
ls commands/gsd/validate-phase.md
ls get-shit-done/workflows/validate-phase.md
```

**Step 4: Commit the markdown portion**

```bash
git commit -m "feat: Nyquist hardening — markdown portion (cherry-pick ef032bc)

Adds gsd-nyquist-auditor agent, validate-phase command/workflow,
mandatory VALIDATION.md gates in plan-phase, compliance scan in
audit-milestone, W008/W009 health check stubs in health workflow.

lib/ changes ported separately to gsd-tools.js.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Port Nyquist lib/ changes to gsd-tools.js

Three separate logic changes from `ef032bc`'s `lib/` files, all small.

**File:** `get-shit-done/bin/gsd-tools.js`

#### 4a: Add `nyquist_validation` to config defaults (from lib/core.cjs line ~77)

Find the `defaults` object around line 229 in gsd-tools.js:
```js
const defaults = {
  ...
  parallelization: true,
  brave_search: false,
};
```

Add `nyquist_validation: true` after `parallelization`:
```js
  parallelization: true,
  nyquist_validation: true,   // ← add this
  brave_search: false,
```

Also add it to the returned config object (after `parallelization` in the return statement around line 272):
```js
  parallelization,
  nyquist_validation: get('nyquist_validation', { section: 'workflow', field: 'nyquist_validation' }) ?? defaults.nyquist_validation,
  brave_search: get('brave_search') ?? defaults.brave_search,
```

#### 4b: Add `gsd-nyquist-auditor` to agent model map (from lib/core.cjs line ~27)

Search for where agent model profiles are defined in gsd-tools.js — look for `gsd-verifier` or similar. Add the nyquist auditor entry:
```js
'gsd-nyquist-auditor': { quality: 'sonnet', balanced: 'sonnet', budget: 'haiku' },
```

#### 4c: Add W008/W009 health checks (from lib/verify.cjs)

Find the health check section in gsd-tools.js (around line 4114 where `WARN`/`PASS` checks live). Add two new checks after the existing ones:

**W008** — detect absent `nyquist_validation` key:
```js
// W008: nyquist_validation key absent from config
if (fs.existsSync(configPath)) {
  try {
    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const configParsed = JSON.parse(configRaw);
    if (configParsed.workflow && configParsed.workflow.nyquist_validation === undefined) {
      checks.push({
        name: 'Nyquist Config Key',
        status: 'WARN',
        message: 'W008: workflow.nyquist_validation absent from config.json (defaults to enabled — run /gsd:health --repair to add key)',
      });
    }
  } catch {}
}
```

**W009** — detect RESEARCH.md without matching VALIDATION.md:
```js
// W009: phases with RESEARCH.md but missing VALIDATION.md
try {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  if (fs.existsSync(phasesDir)) {
    const phaseEntries = fs.readdirSync(phasesDir, { withFileTypes: true });
    for (const e of phaseEntries) {
      if (!e.isDirectory()) continue;
      const phaseFiles = fs.readdirSync(path.join(phasesDir, e.name));
      const hasResearch = phaseFiles.some(f => f.endsWith('-RESEARCH.md'));
      const hasValidation = phaseFiles.some(f => f.endsWith('-VALIDATION.md'));
      if (hasResearch && !hasValidation) {
        checks.push({
          name: `Nyquist Gap: ${e.name}`,
          status: 'WARN',
          message: `W009: ${e.name} has RESEARCH.md but no VALIDATION.md — run /gsd:validate-phase to retroactively validate`,
        });
      }
    }
  }
} catch {}
```

**Step 1: Apply 4a — add nyquist_validation default**

Edit `get-shit-done/bin/gsd-tools.js` lines ~238-240 (defaults object).
Edit the return statement ~line 272 to include the config read.

**Step 2: Apply 4b — add agent model map entry**

Search for `gsd-verifier` in gsd-tools.js, add `gsd-nyquist-auditor` next to it.

**Step 3: Apply 4c — add W008/W009 health checks**

Find the health checks array around line 4114 and add the two new checks.

**Step 4: Verify no syntax errors**

```bash
node -e "require('./get-shit-done/bin/gsd-tools.js')" 2>&1 | head -5
```

Expected: no output (clean require).

**Step 5: Commit**

```bash
git add get-shit-done/bin/gsd-tools.js
git commit -m "feat: port Nyquist lib/ changes to gsd-tools.js (from ef032bc)

- Add nyquist_validation: true to config defaults
- Add gsd-nyquist-auditor to agent model map
- Add W008/W009 health checks for Nyquist config and artifact gaps

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Cherry-pick nyquist-auditor frontmatter fix (73efecc)

**File:** `agents/gsd-nyquist-auditor.md` (created in Task 3)

**Step 1: Cherry-pick**

```bash
git cherry-pick 73efecc
```

Expected: clean apply — just adds frontmatter to the new agent file.

**Step 2: Verify**

```bash
head -10 agents/gsd-nyquist-auditor.md
```

Expected: YAML frontmatter block at top of file.

---

### Task 6: Cherry-pick + port `depth` → `granularity` rename (c298a1a)

**Files:**
- Markdown (cherry-pick): `agents/gsd-planner.md`, `agents/gsd-roadmapper.md`, `get-shit-done/workflows/settings.md`, `get-shit-done/workflows/new-project.md`, `get-shit-done/templates/config.json`, `README.md`
- lib/ (port to gsd-tools.js): migration logic in `lib/config.cjs` and `lib/core.cjs`

**Step 1: Cherry-pick without committing**

```bash
git cherry-pick c298a1a --no-commit
```

**Step 2: Remove lib/ files from staging**

```bash
git rm --cached get-shit-done/bin/lib/config.cjs 2>/dev/null || true
git rm --cached get-shit-done/bin/lib/core.cjs 2>/dev/null || true
rm -f get-shit-done/bin/lib/config.cjs get-shit-done/bin/lib/core.cjs
```

Resolve any conflicts in `agents/gsd-planner.md` (we've modified it) — keep both our additions and the `depth`→`granularity` rename.

**Step 3: Commit markdown portion**

```bash
git commit -m "refactor: rename depth → granularity — markdown portion (cherry-pick c298a1a)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

**Step 4: Port migration logic to gsd-tools.js**

In the config reading function around line 243-279, after `const parsed = JSON.parse(raw);`, add the migration:

```js
// Migrate deprecated "depth" key to "granularity"
if ('depth' in parsed && !('granularity' in parsed)) {
  const depthToGranularity = { quick: 'coarse', standard: 'standard', comprehensive: 'fine' };
  parsed.granularity = depthToGranularity[parsed.depth] || parsed.depth;
  delete parsed.depth;
  try { fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8'); } catch {}
}
```

**Step 5: Verify no syntax errors**

```bash
node -e "require('./get-shit-done/bin/gsd-tools.js')" 2>&1 | head -5
```

**Step 6: Commit**

```bash
git add get-shit-done/bin/gsd-tools.js
git commit -m "refactor: port depth→granularity migration to gsd-tools.js (from c298a1a)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Run install + push

**Step 1: Run install to deploy to ~/.claude**

```bash
node bin/install.js
```

**Step 2: Push all commits**

```bash
git push
```

**Step 3: Verify final state**

```bash
git log --oneline -8
git status
```

Expected: clean working tree, 7+ new commits ahead of remote (pre-push count + our cherry-picks).
