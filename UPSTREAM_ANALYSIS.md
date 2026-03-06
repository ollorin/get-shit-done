# Upstream GSD Analysis (Last 3-4 Weeks)

**Analysis Date:** March 6, 2026
**Upstream Repo:** glittercowboy/get-shit-done
**Analysis Period:** Feb 6 - Mar 6, 2026
**Common Ancestor:** b85247a (10 commits ago in both directions)

## Summary

Upstream has **10 commits ahead** of our fork, split into:
- 3 feature commits (--discuss flag, Nyquist hardening, granularity refactoring)
- 3 bug/fix commits (Windows @file: protocol, missing frontmatter)
- 4 release/docs commits (v1.22.3, v1.22.4 changelog)

**High-level divergence:** Upstream has completed a major architectural refactoring (gsd-tools.js → modular lib/ structure with 16 .cjs modules and comprehensive tests). Our fork has taken a different path (execution telemetry, correctness rules, knowledge logging). Both are substantial, non-conflicting improvements.

---

## Upstream Commits (Most Recent First)

### Release Commits (Skip - Low Value)
- **2eaed7a** `1.22.4` - Version bump
- **f5fb00c** `docs: update changelog for v1.22.4` - Documentation only
- **39ab041** `1.22.3` - Version bump
- **569ce68** `docs: update changelog for v1.22.3` - Documentation only

**Status:** These are release artifacts. Skip unless coordinating version alignment.

---

### Critical Bug Fixes

#### **517ee0d** - Windows @file: Protocol Resolution (RECOMMENDED CHERRY-PICK ⭐⭐⭐)
**Commit:** `fix: resolve @file: protocol in all INIT consumers for Windows compatibility (#841)`

**Problem Solved:**
When gsd-tools init output exceeds 50KB, it writes to a temp file and outputs `@file:<path>`. On Windows, agents were hallucinating `/tmp` paths that don't exist (should be `C:\tmp`). This breaks all large projects on Windows.

**What Changed:**
- Added `@file:` resolution line after every `INIT=$(node ...)` call
- Changes span 32 workflow, agent, and reference files (all get-shit-done/ files)
- Backward compatible: no breaking changes

**Status in Fork:** ❌ NOT IN OUR FORK
**Conflict Risk:** LOW - mechanical addition to every workflow file
**Value:** CRITICAL - Fixes Windows compatibility for large projects
**Effort:** Medium - Need to add @file: resolution to ~30 files, but it's a copy-paste operation

**Files Affected:**
```
agents/gsd-*.md (multiple)
commands/gsd/*.md (multiple)
get-shit-done/workflows/*.md (all)
get-shit-done/references/planning-config.md
```

---

#### **73efecc** - Missing Skills Frontmatter (MINIMAL VALUE)
**Commit:** `fix: add missing skills frontmatter to gsd-nyquist-auditor`

**Problem:** The new Nyquist auditor agent was missing the frontmatter metadata required by the skills system.

**Status in Fork:** ❌ N/A (we don't have gsd-nyquist-auditor yet)
**Value:** LOW - Will be irrelevant until we cherry-pick the Nyquist feature
**Action:** Skip for now; cherry-pick with Nyquist hardening if we take that

---

### Major Features

#### **ef032bc** - Nyquist Hardening + Retroactive Validation (RECOMMENDED ⭐⭐⭐)
**Commit:** `feat: harden Nyquist defaults, add retroactive validation, compress prompts (#855)`

**What It Adds:**
1. **Retroactive Validation:** `/gsd:validate-phase` command runs validation on already-executed phases
2. **Nyquist Auditor Agent:** `gsd-nyquist-auditor` detects gaps, writes missing tests, debugs failures
3. **Audit Milestone Compliance:** Adds Nyquist coverage table showing which phases are validated
4. **Hardened Config Defaults:** Changes `nyquist_validation` default from `false` → `true`
5. **W008/W009 Health Checks:** Warns when validation key is missing or files out of sync
6. **Auto-Repair:** `addNyquistKey` repair adds missing config key automatically

**New Files:**
- `agents/gsd-nyquist-auditor.md` (178 lines)
- `commands/gsd/validate-phase.md` (35 lines)
- `get-shit-done/workflows/validate-phase.md` (167 lines)
- `get-shit-done/templates/VALIDATION.md` (76 lines)
- `get-shit-done/references/questioning.md` (21 lines, new reference)

**Status in Fork:** ❌ NOT IN OUR FORK
**Conflict Risk:** LOW - All new files, targeted features
**Value:** HIGH - Closes gap in validation architecture, makes testing mandatory
**Effort:** High - Need to integrate new agent, new workflow, new command, update templates
**Compatibility:** Adds health checks that will warn about missing validation on our phases, but doesn't break existing workflows

**Key Insight:** This aligns with our Phase 57 learnings about self-checks and correctness. Very complementary to our execution telemetry work.

---

#### **c298a1a** - Depth → Granularity Refactoring (MODERATE PRIORITY ⭐⭐)
**Commit:** `refactor: rename depth setting to granularity (closes #879)`

**What It Changes:**
- Renames config setting `workflow.depth` → `workflow.granularity`
- Value mapping: `quick` → `coarse`, `standard` → `standard`, `comprehensive` → `fine`
- Rationale: "depth" implied investigation thoroughness, but only controls phase count. "granularity" is more accurate.

**Files Affected:** 10 files
```
README.md
agents/gsd-planner.md
agents/gsd-roadmapper.md
docs/USER-GUIDE.md
get-shit-done/bin/lib/config.cjs
get-shit-done/bin/lib/core.cjs
get-shit-done/templates/config.json
get-shit-done/templates/roadmap.md
get-shit-done/workflows/new-project.md
get-shit-done/workflows/settings.md
```

**Backward Compatibility:** YES - Auto-migration in `loadConfig()` and `config-ensure` workflow
- Old projects with `depth` are auto-renamed on next `/gsd:settings` or project load
- Works bidirectionally in both `.planning/config.json` and `~/.gsd/defaults.json`

**Status in Fork:** ❌ NOT IN OUR FORK (we still use "depth")
**Conflict Risk:** MEDIUM - Affects config parsing, templates, agent logic
**Value:** MEDIUM - Better terminology, but not functionally important
**Effort:** Medium - Systematic refactoring across ~10 files
**Compatibility:** If we take this, existing projects will auto-migrate (safe)

---

#### **a7c08bf** - `--discuss` Flag for `/gsd:quick` (MODERATE PRIORITY ⭐⭐)
**Commit:** `feat: add --discuss flag to /gsd:quick for lightweight pre-planning discussion (#861)`

**What It Adds:**
- New `--discuss` flag for `/gsd:quick` command
- Lightweight discussion phase before planning to surface assumptions & gray areas
- Captures user decisions in `CONTEXT.md` as locked constraints
- Composable with `--full` flag for discussion + plan-checking + verification
- Reduces hallucination risk for ambiguous quick tasks

**Files Changed:** 2
```
commands/gsd/quick.md (8 lines added/modified)
get-shit-done/workflows/quick.md (388 lines of additions - big feature)
```

**New Workflow Steps:**
- Argument parsing for `--discuss` and `--full` flags
- Step 4.5: Discussion phase (only when `--discuss`)
  - Spawn gsd-discusser agent
  - Capture decisions in CONTEXT.md
- Step 5.5: Plan-checker loop (only when `--full`)
- Step 6.5: Verification (only when `--full`)

**Status in Fork:** ❌ NOT IN OUR FORK
**Conflict Risk:** MEDIUM-HIGH - Our `/gsd:quick` likely differs; patch may not apply cleanly
**Value:** MEDIUM - Nice feature, but quick tasks are less critical than milestone flows
**Effort:** Medium - Requires integrating new agent (gsd-discusser) and updating quick.md workflow

---

## Architectural Changes Not Captured in Commits

### Major Refactoring: gsd-tools.js → Modular lib/ Structure

**Impact on Cherry-Picking:** This is INVISIBLE in the commits above but affects all Windows fix.

**What Happened:**
- Upstream refactored monolithic `gsd-tools.js` (10,795 lines) into modular CommonJS structure
- New architecture: `bin/gsd-tools.js` (1,185 lines) + `bin/lib/*.cjs` (16 modules)

**Modules:**
- `lib/commands.cjs` - CLI command routing
- `lib/config.cjs` - Config parsing + migration logic
- `lib/core.cjs` - Core utilities + @file: resolution (the Windows fix!)
- `lib/init.cjs` - Initialization logic
- `lib/phase.cjs` - Phase management
- `lib/roadmap.cjs` - Roadmap operations
- `lib/state.cjs` - STATE.md management
- `lib/verify.cjs` - Verification + health checks
- + 8 more specialized modules

**Comprehensive Test Suite:**
- 16 test files covering all modules
- ~8,000+ lines of test code
- Tests for all major workflows, state transitions, edge cases

**Status in Fork:** ❌ NOT APPLICABLE
- Our `gsd-tools.js` is still monolithic
- This refactoring is a major structural change, not a cherry-pick candidate
- Would require porting our execution telemetry work to the new structure

**Value:** VERY HIGH - Better maintainability, testability, Windows compatibility baked in
**Effort:** VERY HIGH - Would be a complete rewrite of gsd-tools.js

**Recommendation:** Document this for potential future adoption, but don't cherry-pick. Our current monolithic approach works; refactoring would be a major undertaking.

---

## New Documentation & Tooling

### User Guide (NEW)
**docs/USER-GUIDE.md** (502 lines)
- Comprehensive configuration reference
- Workflow toggles explained
- Git branching options
- Per-agent model breakdown
- Troubleshooting guide

**Status in Fork:** ❌ NOT IN OUR FORK
**Value:** HIGH - Very useful reference, but supplementary
**Effort:** LOW - Just copy the file

---

### GitHub Actions Test Workflow (NEW)
**.github/workflows/test.yml** (49 lines)
- Runs full test suite on every push
- Validates against Node 18, 20, 22
- CI/CD integration

**Status in Fork:** ✓ We have GitHub Actions already (different setup)
**Value:** LOW - We have our own CI setup

---

### Context Monitor Hook (NEW)
**hooks/gsd-context-monitor.js** (141 lines)
- Monitors token usage and context pressure
- Provides real-time warnings

**Status in Fork:** ❌ NOT IN OUR FORK
**Value:** MEDIUM - Useful observability, but not critical

---

### New Workflows
- **commands/gsd/add-tests.md** (41 lines) - Add tests to a phase
- **commands/gsd/cleanup.md** (18 lines) - Clean up .planning/ directory
- **commands/gsd/health.md** (22 lines) - Health check wrapper
- **get-shit-done/workflows/add-tests.md** (351 lines) - Implementation
- **get-shit-done/workflows/cleanup.md** (152 lines) - Cleanup implementation
- **get-shit-done/workflows/health.md** (159 lines) - Health check implementation

---

## Cherry-Pick Recommendation Matrix

| Commit | Feature | Priority | Effort | Risk | Recommendation |
|--------|---------|----------|--------|------|-----------------|
| 517ee0d | Windows @file: resolution | **CRITICAL** | Medium | Low | ✅ **CHERRY-PICK NOW** |
| ef032bc | Nyquist hardening + validation | High | High | Low | ✅ **CHERRY-PICK SOON** |
| c298a1a | depth → granularity refactor | Medium | Medium | Medium | ⚠️ **OPTIONAL** (nice to have, adds friction with old projects) |
| a7c08bf | --discuss flag for quick | Medium | Medium | Medium | ⚠️ **OPTIONAL** (nice feature, lower priority) |
| 73efecc | Missing frontmatter | Low | Trivial | None | ✅ **CHERRY-PICK WITH** ef032bc |
| Architecture | gsd-tools refactor | Very High | Very High | High | ❌ **SKIP** (defer to future major version) |
| Docs | README, USER-GUIDE, test suite | Medium | Low | None | ✅ **CHERRY-PICK AFTER** features |

---

## Detailed Integration Plan

### Phase 1: Critical Bug Fixes (Do First)
**1a. Cherry-pick Windows @file: resolution (517ee0d)**
- Add `@file:` resolution logic to all workflow files
- Test on Windows if possible
- Estimate: 2-3 hours (mechanical changes)

### Phase 2: Major Features (Do Next)
**2a. Cherry-pick Nyquist hardening (ef032bc) + frontmatter fix (73efecc)**
- Integrate new `gsd-nyquist-auditor` agent
- Integrate `/gsd:validate-phase` command + workflow
- Add health checks (W008, W009)
- Update templates (VALIDATION.md)
- Test integration with our Phase 57 execution telemetry
- Estimate: 6-8 hours (moderate complexity, good alignment with our work)

**2b. OPTIONAL: Cherry-pick --discuss flag (a7c08bf)**
- Requires adapting our current quick.md workflow
- May conflict with our quick task tracking
- Estimate: 3-4 hours (depends on our current quick.md structure)

### Phase 3: Nice-to-Haves (Do Last)
**3a. OPTIONAL: Cherry-pick granularity refactoring (c298a1a)**
- Systematic terminology update
- Auto-migration in config handling
- Estimate: 2-3 hours (systematic but low-risk)

**3b. Documentation & Tooling**
- Copy USER-GUIDE.md for reference
- Selectively integrate test suite ideas (no need to adopt entire test framework)
- Estimate: 2-3 hours (low priority, supplementary)

---

## Conflict Watch List

### High Confidence (Low Risk)
- Windows @file: resolution (517ee0d) - Pure additions, no removals
- Nyquist hardening (ef032bc) - All new files + optional config keys
- Missing frontmatter (73efecc) - Trivial one-liner fix

### Medium Confidence (Medium Risk)
- Granularity refactoring (c298a1a) - Requires config migration logic updates
- --discuss flag (a7c08bf) - Depends on current state of our quick.md workflow

### Low Confidence (High Risk)
- Architectural refactoring (gsd-tools.js → lib/) - Too different to cherry-pick, would require major rework

---

## Our Fork's Unique Strengths

While analyzing upstream, it's clear our fork has made distinct progress:
- **Execution Telemetry** (12d26b6) - Real-time phase execution tracking
- **Correctness Rules** (b0e796c) - Executor self-checks for security
- **Knowledge Logging** (6bdf914, 28a8a5a) - Context harvesting from user reasoning
- **Session End Hooks** (72736f6) - Proper cleanup and logging

These are complementary to upstream's Nyquist validation work. Suggest documenting these improvements for potential upstream contribution after stabilization.

---

## Final Recommendation

**Immediate Action:**
1. ✅ Cherry-pick 517ee0d (Windows @file: protocol) - Critical for cross-platform support
2. ✅ Cherry-pick ef032bc + 73efecc (Nyquist hardening) - Aligns with our correctness efforts

**Timeline:**
- Week 1: Integrate Windows fix + Nyquist features
- Week 2: Test integration, resolve any conflicts
- Week 3: Optional—consider --discuss flag and granularity refactor

**Long-Term:**
- Document our execution telemetry + knowledge logging work
- Consider contributing back to upstream after stabilization
- Monitor upstream for additional architectural improvements (but don't chase refactors)

---

## Questions for Review

1. **Windows Support Priority:** How important is Windows compatibility for your users? If critical, 517ee0d should be top priority.
2. **Validation Maturity:** Are you ready to enforce validation in all phases, or should we make Nyquist features optional initially?
3. **Quick Tasks Priority:** How frequently are quick tasks used vs. milestone flows? Affects --discuss flag priority.
4. **Architecture:** Would a modular lib/ structure be valuable for your team, or is the monolithic gsd-tools.js working well?
