# GSD Injection Points: Four Satellite Stacks

Analysis of how DISCOVERY, DEBUGGER, CONVERSATION MINING, and NYQUIST/VALIDATE-PHASE can be integrated into the golden path (/gsd:prd → /gsd:new-milestone → /gsd:execute-roadmap → /gsd:complete-milestone).

---

## 1. DISCOVERY (Deep Product Investigation)

### What it does today
- **Inputs:** Rough product concept (1-2 pages), optional codebase context
- **Process:** Parallel investigation across 6 dimensions (domain, competitive, innovation, codebase, technical, risk) in 2 rounds with gap closure
- **Outputs:** Enriched PRD at `.planning/discovery/PRD.md`, structured with executive summary, feature specification, risk assessment, open questions
- **Preconditions:** Concept must exist; greenfield or brownfield project detected
- **Live entry point:** `/gsd:discover` skill (calls workflows/discover.md) — currently standalone, not in golden path

### Proposed injection point
**File:** `/Users/ollorin/get-shit-done/get-shit-done/workflows/prd.md`
**Section:** Step 1 (PM Discovery Stage) after 1c (Q&A Loop), OR Step 2 (PO/BA Scoping) after 2c (Q&A Loop)
**Specific location:**
- After each Q&A loop completes, confidence is calculated (1c line 98-100, 2c line 213-214)
- If confidence remains LOW (<0.50) after max_rounds, instead of force-advancing, optionally offer parallel deep investigation
- Insert after line 107-115 (1e Update Stage Marker) and line 316 (2f Update Stage Marker)

### Trigger condition
- **AUTO:** When confidence < 0.50 after Q&A completes AND unresolved gaps are all blocked (cannot be resolved by standard Q&A)
- **DORMANT:** Confidence >= 0.65, or user explicitly declines investigation offer
- **Signal:** Specific gaps marked as `research_needed: true` in gap analysis (not just `unresolved`)

### What the change involves

**Files edited:**
1. `prd.md` — Add decision point after each Q&A loop
2. Create new workflow: `prd-discovery-phase.md` (or enhance discover.md with prd-context mode)

**Additions to prd.md:**
- After 1c Q&A loop (new subsection 1c-discovery):
  ```
  If confidence < 0.50 AND unresolved gaps exist:
    - Display: "Confidence is low. Run deep product investigation on specific gaps?"
    - Options: "Investigate now (15-30 min)" | "Accept uncertainty, continue" | "Stop and rethink"
    - If "Investigate now": 
      - Extract gap questions as discovery targets
      - Spawn 4-6 parallel gsd-product-investigator agents (Sonnet) focused on each gap
      - Collect findings into `.planning/prds/pending/{slug}-DISCOVERY.md`
      - Resume confidence calculation: gaps now answered by research
  ```

- After 2c Q&A loop (new subsection 2c-discovery) — similar gate for scoping gaps

**New files:**
- `.planning/prds/pending/{slug}-DISCOVERY.md` — Parallel investigation output (if triggered)

### Risks / open questions
- **Context pressure:** PRD workflow + parallel investigators = 7 agents in flight. Total ~80-100k context across system. Manageable if investigators read minimal source.
- **Discovery quality vs time:** 15-30 min investigations may not resolve architectural concerns. Confidence may still be LOW after research — need escalation path to human decision.
- **Backlink risk:** If PRD discovery finds new gaps mid-research, loop back to Q&A or break the flow?
- **Scope creep:** Discovery on Step 1 gaps (market/user/business) vs Step 2 gaps (scope/stories) — very different research approaches. May need separate discovery logic per stage.
- **Token cost:** Parallel investigators run Sonnet (40k context × 4-6 agents = 160-240k tokens). Compress to Haiku if confident on gap precision.

---

## 2. DEBUGGER (Autonomous Debugging on Phase Failure)

### What it does today
- **Inputs:** Bug symptoms (expected vs actual, error messages, reproduction steps)
- **Process:** Scientific hypothesis testing, persistent debug session state, checkpoint handling for user interaction
- **Outputs:** Root cause analysis, evidence trail, optional fix (depends on mode)
- **Preconditions:** Codebase readable, symptoms clearly described, at least one error message
- **Live entry point:** `/gsd:debug` command (calls commands/gsd/debug.md) — currently standalone, spawned manually on failure discovery

### Proposed injection point
**File 1:** `/Users/ollorin/get-shit-done/get-shit-done/workflows/execute-phase.md`
**Section:** Step "execute_waves" → Step 4.5 (Handle failures) at line 292-296
**Specific location:**
- When executor agent returns `status: "failed"` for a plan (line 292-296)
- Instead of immediately asking "Continue?", check if this is the **2nd failure of the same plan** (retry logic)
- Insert auto-spawn before user prompt

**File 2:** `/Users/ollorin/get-shit-done/get-shit-done/workflows/execute-roadmap.md`
**Section:** Step "handle_failure" at line 341-376
**Specific location:**
- When a phase_failed event is logged (line 342-349)
- Before presenting user options (retry/skip/stop), conditionally spawn debugger
- Insert after line 350 (log failure)

### Trigger condition
- **AUTO:** On plan/phase failure, if:
  - Error message is non-empty and not "user cancelled"
  - This is the 2nd+ attempt at the same task/plan (not 1st failure)
  - NOT a user-initiated cancel or auth blocker (e.g., API key missing)
  - Last completed step is known (from agent return)
- **DORMANT:** 1st failure → ask user "Fix now?" first. Only auto-debug on repeated failure.
- **Signal:** `classifyHandoffIfNeeded` Claude Code bugs are excluded (these are platform issues, not debuggable code)

### What the change involves

**Files edited:**
1. `execute-phase.md` Step 4.5 — Add retry counter and debug spawn logic
2. `execute-roadmap.md` Step handle_failure — Add phase-level debug spawn logic

**Additions to execute-phase.md (after line 296):**
```markdown
**Retry and Debug Logic:**

If this plan has failed before in this execution:
  retry_count = increment retry counter from ephemeral state
  
  If retry_count == 1 (second attempt, first failure):
    # Ask user before debugging
    User prompt: "Plan failed. Options: Fix now (spawn debugger) | Retry | Skip | Stop"
    If "Fix now":
      → Spawn gsd-debugger with context (error, last step, files modified)
  
  If retry_count >= 2 (third+ attempt):
    # Auto-spawn debugger
    Log: "⚡ Auto-spawning debugger after {retry_count} failures"
    Agent(
      subagent_type="gsd-debugger",
      model="sonnet",
      description="Debug plan {plan_id} failure",
      prompt="Plan {plan_id} failed {retry_count} times. Error: {error}. Last step: {step}. Debug and fix."
    )
```

**Additions to execute-roadmap.md (after line 349):**
```markdown
**Phase-Level Debug Spawn:**

If the phase_failed error is not auth-related:
  User prompt: "Phase {N} failed. Options: Debug | Retry | Skip | Stop"
  If "Debug":
    → Spawn gsd-debugger in phase-mode with phase context
```

**New ephemeral state file:**
- `.planning/execution-state.json` — Track retry counters per plan/phase (cleaned up on success or user abort)

### Risks / open questions
- **Premature debug:** 2nd failure may be a quick fix (typo, config). Debug might be overkill. Maybe only auto-spawn on 3rd+ failure?
- **Infinite loop:** If debugger finds and fixes, plan re-executes, fails again with different error → potential loop. Need hard stop at 4th attempt.
- **Context load:** Debugger reads full implementation files, tests, config. For large phases, this is 100k+ context per attempt. After 2-3 retries, memory becomes issue.
- **User expectations:** "I'll just skip and move on" vs "Debugger will handle it." Unclear which is user's preference. May need config flag.
- **Attribution:** If debugger's fix breaks something else, who's responsible? Need clear audit trail in commit messages.

---

## 3. CONVERSATION MINING (Extract Session Knowledge at Milestone Completion)

### What it does today
- **Inputs:** Conversation JSONL files from Claude Code project sessions, optional filtering (age, count)
- **Process:** Sequential extraction across dimensions (decisions, reasoning patterns, meta-knowledge) via Haiku subagents, storage to knowledge DB with deduplication
- **Outputs:** Stored knowledge entries in `.planning/knowledge/`, marked as analyzed in `.conversation-analysis-log.jsonl`
- **Preconditions:** Session JSONL files exist, knowledge DB initialized, gsd-tools conversation mining support available
- **Live entry point:** `/gsd:mine-conversations` command (calls workflows/mine-conversations.md) — currently standalone

### Proposed injection point
**File:** `/Users/ollorin/get-shit-done/get-shit-done/workflows/complete-milestone.md`
**Section:** Step "archive_milestone" at line 365-397, before or after `milestone complete` CLI call
**Specific location:**
- After `gsd-tools milestone complete` has archived ROADMAP/REQUIREMENTS (line 370)
- Insert mining step before "Phase archival (optional)" (line 384)
- New subsection: "Mine Milestone Conversations"

### Trigger condition
- **AUTO:** Always, immediately after milestone archival. Extract all sessions from milestone duration.
- **DORMANT:** Only if `/gsd:settings` has `knowledge.auto_mine: true` (default: true)
- **Signal:** Milestone version is set (from `version` return of `milestone complete`)

### What the change involves

**Files edited:**
1. `complete-milestone.md` — Add mining step after archival

**Additions to complete-milestone.md (after line 370, new subsection "3.5"):**
```markdown
## 3.5. Mine Milestone Conversations (Auto)

Display: "Mining knowledge from milestone sessions..."

Extract milestone date range:
```bash
START_DATE=$(date -d "$(git log --reverse --grep='feat(' | head -1 | cut -d' ' -f1)" +%s)
END_DATE=$(date +%s)
AGE_DAYS=$(( (END_DATE - START_DATE) / 86400 ))
```

Spawn conversation miner:
```bash
MINE_JSON=$(node ~/.claude/get-shit-done/bin/gsd-tools.js mine-conversations \
  --max-age-days "${AGE_DAYS}" --limit 50)
```

Parse result, filter for current milestone sessions (by timestamp or explicit marker).

Log result:
- "Mined {N} conversations, {M} insights stored"
- If errors: list failed conversations for manual retry

Store in `.planning/milestones/v{version}-KNOWLEDGE.md`:
```markdown
# Knowledge Extracted: v{version} — {date}

From {N} conversations, {M} insights stored:
- {count} Decisions
- {count} Reasoning Patterns
- {count} Meta-Knowledge

See `.planning/knowledge/` for full entries.
```
```

**New files:**
- `.planning/milestones/v{version}-KNOWLEDGE.md` — Metadata on what was mined

### Risks / open questions
- **Session identification:** How to know which sessions belong to which milestone? Timestamp-based (all sessions during phase execution)? Explicit milestone tagging in CLI?
- **Extraction quality:** Mining at milestone-end loses detailed session context (which phase was active during which conversation). Insights may be too coarse.
- **Duplicate extraction:** If a session spans two milestones, will it be mined twice? `.conversation-analysis-log.jsonl` deduplicates by content-hash, so safe — but no explicit "belongs_to_milestone" marker.
- **Token cost:** Haiku extraction × 50 sessions = ~50-100 tokens per, but auto-running may add 5-10k tokens to each milestone completion. Acceptable?
- **Knowledge relevance:** Conversations include brainstorming, dead-ends, off-topic. Mined insights may be 50% noise. Need quality filter in extraction or post-mine review.
- **Completeness:** What if mining fails for a session? Should milestone completion fail, or continue with partial knowledge? Current pattern: continue (partial is better than none).

---

## 4. NYQUIST/VALIDATE-PHASE (Validation Coverage Check as Verification Gate)

### What it does today
- **Inputs:** Completed phase with PLAN/SUMMARY files, test infrastructure detected, requirement map built
- **Process:** Gap analysis per requirement (COVERED/PARTIAL/MISSING), present gap plan to user, spawn gsd-nyquist-auditor to fill missing tests, generate/update VALIDATION.md
- **Outputs:** VALIDATION.md with test-to-requirement map, compliance status (all automated, partial, escalated)
- **Preconditions:** Phase executed (SUMMARY.md exists), test infrastructure present (pytest/jest/vitest detected), requirements mapped in PLAN frontmatter
- **Live entry point:** `/gsd:validate-phase {N}` command (calls workflows/validate-phase.md) — currently standalone, manual workflow

### Proposed injection point
**File:** `/Users/ollorin/get-shit-done/agents/gsd-verifier.md` (primary) + `/Users/ollorin/get-shit-done/get-shit-done/workflows/execute-phase.md` Step "verify_phase_goal" (secondary)
**Section:** Primary: In verifier initialization, before spawning comprehensive verification. Secondary: execute-phase.md step "pre_verify_gates" (line 446-473)
**Specific location:**
- Execute-phase calls gsd-verifier at line 561-571
- Verifier reads PLAN and SUMMARY to assess goal achievement
- **Insert:** Immediately after verifier reads phase artifacts (goals from PLAN/SUMMARY), scan for requirement-to-test mapping
- If gaps detected, spawn gsd-nyquist-auditor autonomously before full verification
- Verifier continues with complete test coverage as a prerequisite to verification

### Trigger condition
- **AUTO:** When gsd-verifier starts for any phase with:
  - PLAN.md exists with requirement IDs in frontmatter
  - SUMMARY.md exists (phase executed)
  - Test infrastructure detected (test files exist)
- **DORMANT:** If phase has no requirements (internal refactor only) OR no test infrastructure, skip
- **Signal:** `nyquist_validation_enabled: true` in config (from init plan-phase step 1)

### What the change involves

**Files edited:**
1. `gsd-verifier.md` — Add validation gap detection in initialization
2. `execute-phase.md` Step pre_verify_gates — Make Nyquist auditor spawn mandatory (not optional)

**Additions to gsd-verifier.md (new step after "load context"):**
```markdown
## Validate-Phase Integration: Requirement-to-Test Scan

**Trigger:** Phase has requirement IDs AND test infrastructure detected.

1. **Scan Phase Artifacts for Requirements:**
   ```bash
   grep -h "^req:" .planning/phases/{phase_dir}/*-PLAN.md | cut -d: -f2 | sort -u
   # Extract all requirement IDs from plans (e.g., REQ-001, REQ-002)
   ```

2. **Map Requirements to Tests:**
   For each requirement, search test files for matching test:
   ```bash
   For each REQ-ID:
     - Look for test name containing requirement name or ID
     - Check test file imports/tests requirement-related code
     - Mark: COVERED (test green), PARTIAL (test exists, failing), MISSING (no test)
   ```

3. **If Gaps Detected:**
   ```markdown
   Gaps found: {N} missing/partial tests
   
   Spawning gsd-nyquist-auditor to fill gaps...
   
   Agent(
     subagent_type="gsd-nyquist-auditor",
     model="{auditor_model}",
     prompt="Phase {N}: {N} test gaps detected. Generate missing tests.",
     description="Fill Nyquist gaps for Phase {N}"
   )
   
   Wait for auditor completion, update test files, re-scan.
   ```

4. **If No Gaps:**
   Continue with regular verification.
```

**Additions to execute-phase.md pre_verify_gates (new item PHGATE-04 after line 443):**
```markdown
<item id="PHGATE-04" severity="blocking">
  <check>Nyquist validation: requirement-to-test mapping complete</check>
  <pass>All requirements have at least one automated test (VALIDATION.md confirms)</pass>
  <fail>Test gaps exist. Spawn gsd-nyquist-auditor. Phase cannot proceed to verifier with missing tests.</fail>
</item>
```

**New files:**
- Phase-level VALIDATION.md created/updated by gsd-nyquist-auditor (if gaps found)

### Risks / open questions
- **Requirement identification:** How precise is requirement-to-test matching? Requires clear naming convention (REQ-ID in both plan and test). If loose, false positives/negatives.
- **Test quality vs count:** Nyquist auditor generates minimal "green light" tests, not comprehensive. Phase may have 100% test coverage but low quality. Need quality gate beyond "test exists."
- **Time cost:** Verifier becomes heavier: scan, detect gaps, spawn auditor, wait, re-scan. Each phase verification adds 5-10 min. Acceptable for critical phases, not for every phase.
- **Precedence:** Should Nyquist run BEFORE other verification checks (goal achievement, integration tests) or AFTER? If tests fail, verification blocks anyway. Order affects UX.
- **Escalation:** If gsd-nyquist-auditor escalates a gap (implementation bug, not missing test), how does verifier handle? Currently escalated gaps move to manual-only — verification should note this and may fail.
- **Config:** Should auditor spawn be conditional on `nyquist_validation_enabled`? Or always run for phases with requirements? Recommend: always run if requirements exist (tight coupling).

---

## Summary: Injection Points & Triggers

| Stack | Golden Path File | Injection Section | Trigger | Auto/Dormant | Risks |
|-------|------------------|-------------------|---------|--------------|-------|
| **DISCOVERY** | prd.md | Step 1d / 2d (post Q&A) | Confidence < 0.50 | Auto if gaps unresolved | Context pressure, loop risk, scope creep |
| **DEBUGGER** | execute-phase.md Step 4.5 + execute-roadmap.md handle_failure | After plan/phase fails | 2nd+ failure attempt | Auto on retry 2+, user gate on retry 1 | Premature debug, infinite loop, context load |
| **MINING** | complete-milestone.md Step 3.5 | After milestone archival | Always (config toggleable) | Auto if `auto_mine: true` | Session identification, extraction quality, noise |
| **NYQUIST** | gsd-verifier.md init + execute-phase.md pre_verify_gates | Before full verification | Requirements exist + tests detectable | Auto spawn if gaps found | Matching precision, test quality, time cost, escalation handling |

---

## Implementation Roadmap

**Phase 1 (Quick Wins):**
1. MINING — Easiest, pure append to complete-milestone.md, no dependencies
2. NYQUIST — Fold into verifier initialization, already used by validate-phase

**Phase 2 (Moderate):**
3. DISCOVERY — Add decision gate to prd.md after Q&A, reuse existing investigators
4. DEBUGGER — Add retry logic + spawn logic to execute-phase and execute-roadmap

**Phase 3 (Validation):**
- Test each injection in isolation on a non-critical phase
- Measure token cost and time overhead
- Gather user feedback on auto-spawn triggers
