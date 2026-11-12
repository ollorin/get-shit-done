---
phase: agnostic-M
plan: 06
type: backend
wave: 8
depends_on: ["05"]
files_modified:
  - get-shit-done/bin/project-context.js
  - get-shit-done/bin/project-context.test.js
  - get-shit-done/bin/gsd-tools.js
  - get-shit-done/bin/gsd-tools.test.js
  - get-shit-done/presets/igaming/project.block.json
  - get-shit-done/bin/preset-igaming.test.js
  - scripts/agnostic-lint/allowlist.json
  - get-shit-done/bin/decisions.js
  - get-shit-done/bin/hooks/gsd-protect-managed-files.js
  - tests/fixtures/agnostic/risk-terms.json
  - agents/*.md
  - commands/gsd/*.md
  - get-shit-done/workflows/*.md
  - get-shit-done/references/*.md
  - scripts/agnostic-lint/baseline.json
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "The T0 / threat-model / ruling rule applies to every path in the brief's risk domains, and to auth and security always, with wording at least as strict as before"
    - "A project whose brief lists the seven former hard-coded terms gets all seven back as risk domains, and the tracked igaming project block lists all seven"
    - "With no brief (source `builtin`) every state-mutating path is a risk-domain path"
    - "Core prompts name no product domain and no owner title"
  artifacts:
    - tests/fixtures/agnostic/risk-terms.json
    - get-shit-done/bin/project-context.test.js
---

<objective>
E4 (risk domains, critical path) and E5 (owner title). Classes `money` 69, `reg` 27, `game` 7, `owner` 29 denied lines at `0b9c35a`.

**The rule being generalised (D:81).** Today: "tag every behaviour on a money, auth, RNG, KYC, payment, ledger or settlement path T0 (real-DB, mutation-proven)", the threat-model + atomicity mandate for money/auth plans, and the ruling route for those topics. It is hard-wired in `agents/gsd-planner.md` (MANDATE-6 and the T0 line), `gsd-plan-checker.md`, `gsd-test-writer.md`, `gsd-phase-coordinator.md`, `references/decisions-protocol.md`, `workflows/plan-phase.md`, `prd.md`, `new-milestone.md`, and the default at `gsd-tools.js:409, 424`.

**Canonical wording (use these two sentences verbatim wherever the list stood):**

> A risk-domain path is any path the product brief lists under Risk Domains (`risk_domains` in the init output); authentication/authorisation and security are always risk domains.

> Tag every behaviour on a risk-domain path T0 (real-DB, mutation-proven).

And directly after the first sentence, wherever it stands:

> When `risk_domains_source` is `builtin` (no brief, or a brief with an empty list), every path that mutates state is a risk-domain path.

**Must not weaken, checked in 6.4:**
1. Every obligation keeps its force: T0 tier, REUSE only when the cited test is itself the T0 test, threat-model task, adversary view, single-transaction atomicity ("a partial failure leaves no half-applied state"), no compensating saga, ruling route.
2. Obligations that named one domain now cover all risk domains (wider, never narrower). The atomicity task applies to every state mutation on a risk-domain path.
3. Project-specific evidence (post-mortem class numbers, ticket ids, product examples) is removed from core; the sentence becomes "cite the escapes the brief records for that domain, if any".
4. With no brief, or a brief whose list is empty (the auto-mode default of 4.1), the init output says `risk_domains_source: "builtin"` and the rule widens instead of narrowing: every state-mutating path is treated as a risk-domain path (third canonical sentence). The planner prints the source line in the plan header. A project can only narrow the rule by naming its risk domains. igaming is not installed before its config carries the tracked project block (index section 4).
5. igaming's own list cannot drift below the old hard-coded one: the D:163 project block is tracked at `get-shit-done/presets/igaming/project.block.json` and a test proves its `risk_domains` is a superset of the fixture (6.1).
</objective>

<tasks>

<task id="6.1" type="auto" tdd="true">
<name>effectiveRiskDomains + term-coverage test [critical path]</name>
<files>get-shit-done/bin/project-context.js, project-context.test.js, tests/fixtures/agnostic/risk-terms.json (new), get-shit-done/presets/igaming/project.block.json (new), preset-igaming.test.js:31, gsd-tools.js:409, 424, 5749-5750 (the use site of `adversarial_review_security_patterns`), gsd-tools.test.js:14745, 14757, 14769</files>
<action>
- `effectiveRiskDomains(profile)` → `{ risk_domains, risk_domains_source }`: `['auth', 'security']` first, then `project.risk_domains` de-duplicated case-insensitively; source `brief` when the list is non-empty, else `builtin`. `contextFields` returns both keys, plus `ruling_topics` built the same way from `project.ruling_topics`.
- Fixture: `["money","payment","ledger","settlement","auth","rng","kyc"]` (the list at D:163).
- `presets/igaming/project.block.json`: the `project` block of D:158-164 verbatim (`slug`, `owner_title`, `risk_domains`, `ruling_topics`). It is the source the cutover copies into igaming's config (index section 4, item 1). The file also holds a `stack` object with the igaming values of the run-time keys M-03 and M-09 introduced, so the cutover loses no rule: `locked_commands` (the suite commands of the igaming lock-command hook, `presets/igaming/hooks/lib/check-test-command.pl:17-123`), `flake_patterns` (the three categories of `~/igaming-platform/apps/api/scripts/flake-gate.ts:127-191`, read-only, written in the 3.11 pattern shape), `style` (`rule_set: "js-ts"`, roots = the two scan roots of `scripts/fp-gate-config.json:5`), `host.worker_patterns` (the test-runner class of the reaper), `deploy.never_touch: []` (index section 4). If the directory-listing test of `preset-igaming.test.js` (`:59`) flags the new file, add its name to `META` (`:31`).
- `effectiveRiskDomains` also returns `all_state_mutating: true` when the source is `builtin`; `contextFields` passes it on.
- Defaults at `:409` and `:424`: remove `'payment'` (the one domain word; the list goes from 10 to 9 entries). At the use site (`:5749-5750`) the effective risk domains are appended to the patterns, so a project whose brief names `payment` triggers exactly as before. The three length asserts at `gsd-tools.test.js:14745`, `:14757`, `:14769` change from 10 to 9: UPDATE each, with the comment-free reason in the summary ("domain word moved to the brief"). A legacy project with no brief loses the `payment` trigger of the adversarial review: state it in the summary; 6.4 rules on it.
</action>
<behavior>
- T1 unit R-a: profile with the fixture list → all seven present plus `security`; source `brief`. ADD.
- T1 unit R-b: no `project` block → exactly `auth`, `security`; source `builtin`; `all_state_mutating` true. `risk_domains: []` → the same. ADD.
- T2 unit R-h: the `stack` object of `project.block.json` passes the shape checks of `project-profile.js` for the five keys, and `scanFlakePatterns` (3.11) with its `flake_patterns` flags the three source incident shapes. ADD (in `preset-igaming.test.js`).
- T1 unit R-g: `presets/igaming/project.block.json` `risk_domains` contains every term of `risk-terms.json` (superset), and `effectiveRiskDomains` over it has source `brief`. ADD (in `preset-igaming.test.js`).
- T2 unit R-h: default config has 9 `adversarial_review_security_patterns` and none is in `risk-terms.json` except `auth`. UPDATE `gsd-tools.test.js:14745, 14757, 14769`.
- T1 unit R-c: `["Auth","auth","KYC"]` → no duplicate, `kyc` kept once. ADD.
- T1 CLI R-d: `init plan-phase` output carries `risk_domains` and `risk_domains_source`. ADD.
- T2 unit R-e: adversarial-review trigger fires on a file path containing a brief risk domain and on `auth`. UPDATE the existing trigger test (find with `grep -n adversarial_review_security_patterns gsd-tools.test.js`).
- T1 unit R-f (red until 6.2 and 6.3, committed in 6.3): each of the eight files named in the objective contains the three canonical sentences, and `templates/product-brief.md` has the `## Risk Domains` heading. ADD in 6.3.
</behavior>
<verify>Full gate.</verify>
<done>R-a to R-e, R-g, R-h pass.</done>
</task>

<task id="6.2" type="auto" tdd="true">
<name>Risk wording in agents [critical path, Sonnet implements]</name>
<files>agents/gsd-planner.md (money 7, reg 2, game 1), gsd-plan-checker.md (5), gsd-test-writer.md (2), gsd-phase-coordinator.md (6), gsd-verifier.md (3), gsd-e2e-test-generator.md (9), gsd-roadmapper.md (4), gsd-ui-inventory.md (3), gsd-qa-analyst.md (2), gsd-product-investigator.md (2), gsd-demo.md (1), gsd-discovery-synthesizer.md (1); commands/gsd/generate-e2e-coverage.md (3)</files>
<action>
For each hit line (`git grep -n -i -E` with the `money`, `reg`, `game` patterns of `terms.json`): if it states the risk rule, rewrite with the canonical sentences and the four constraints of the objective; if it is an example, replace it with a neutral one or delete it. The fixture-tier rule in `gsd-e2e-test-generator.md` stays as "state the brief marks as a risk domain needs a dedicated account" (D:83).
`gsd-planner.md` MANDATE-6 title becomes "Risk-domain plans require a threat-model + atomicity task"; body per constraints 1-3. Change no other mandate.
</action>
<behavior>
- T1: R-f rows for the four agents pass. ADD (in 6.3's commit).
- T2: lint classes `money`, `reg`, `game` are 0 in these files. REUSE the ratchet after `write-baseline`.
</behavior>
<verify>Full gate; `prompt-budget.test.js` green.</verify>
<done>Counts recorded per file.</done>
</task>

<task id="6.3" type="auto" tdd="true">
<name>Risk wording in references, workflows, bin [critical path, Sonnet implements]</name>
<files>references/decisions-protocol.md (5), coordinator-detail.md (6), verifier-detail.md (6), planner-detail.md (4), checkpoints.md (2), gsd-test-protocol.md (1), verification-patterns.md (1); workflows/execute-phase.md (4), prd.md (4), plan-phase.md (2), new-milestone.md (2), audit-milestone.md (2), execute-plan.md (1); gsd-tools.js (money 5, reg 1, game 1: comments and messages), gsd-circuit-breaker.js (1); project-context.test.js</files>
<action>Same method. `decisions-protocol.md` reversibility text: "irreversible = data loss, a risk-domain effect, a public contract, a legal/compliance position". Then add test R-f.</action>
<behavior>
- T1 unit R-f: passes for all eight files. ADD.
- T2: `node scripts/agnostic-lint.js report` shows 0 denied for `money`, `reg`, `game`. REUSE the ratchet.
</behavior>
<verify>Full gate.</verify>
<done>Three classes at zero.</done>
</task>

<task id="6.4" type="auto" tdd="true">
<name>Fable diff review of 6.1-6.3; apply fixes</name>
<files>.planning/agnostic/M/M-06-RISK-RULING.md (written by the reviewer), then the files of 6.1-6.3</files>
<action>
One reviewer on `model: "fable"` (fall back to `opus` and say so) gets `git diff <sha before 6.1>..HEAD` and constraints 1-4. For every removed line that carried an obligation it names the added line that carries it now, or raises a finding. It also answers: can a brief with an empty risk list make a plan skip T0 for an authentication path (expected: no, built-in) or for any state-mutating path (expected: no, source `builtin` widens); does any sentence let an agent choose the risk domains itself; is the lost `payment` default at `gsd-tools.js:409, 424` for a legacy project acceptable, or must legacy mode keep it (then: keep it behind `uiQaMode === 'legacy'`-style detection and allow-list the line). Haiku applies fixes; then Sonnet rounds to zero (cap in index section 0).
</action>
<behavior>
- T1: each finding that names a missing obligation gets one assertion in R-f (the sentence must be present in the named file). UPDATE R-f.
</behavior>
<verify>Full gate; ruling file lists every obligation with old and new `file:line`.</verify>
<done>No open finding.</done>
</task>

<task id="6.5" type="auto" tdd="true">
<name>Owner title (E5)</name>
<files>references/decisions-protocol.md (10), agents/gsd-demo.md (4), gsd-planner.md (1), commands/gsd/decide.md (2), demo.md (1), prd.md (1), workflows (5 lines, 3 files: grep), references/coordinator-detail.md (1), get-shit-done/bin/decisions.js (3), hooks/gsd-protect-managed-files.js:20, gsd-tools.js (owner lines: grep)</files>
<action>
Prompts say "the owner" ("the owner's title is `owner_title` in the init output" once per file where a message is shown to a person). `decisions.js`: messages use `owner_title` from the profile, default "owner". The hook flag `--approved-by-ceo` (`gsd-protect-managed-files.js:20`): accept `--approved-by-owner`, keep the old flag as an alias on one line with an allowlist entry (`gsd-protect-managed-files.js` × `owner`, `max: 1`, reason "legacy flag alias") under the allow-list raise rule of index section 1: `--allow-raise` only when `check` shows that one `RISE allowed` row and no `RISE denied` row.
</action>
<behavior>
- T2 unit: `decisions` output for a profile with `owner_title: "Founder"` contains "Founder". UPDATE the nearest existing message test in `decisions.test.js`; ADD if none asserts a message.
- T2 unit: the hook accepts both flags. UPDATE `gsd-protect-managed-files.test.js` (one added row).
- T2: lint class `owner` is 0 denied, 1 allowed. REUSE the ratchet.
</behavior>
<verify>Full gate.</verify>
<done>29 → 0 (one allow-listed alias).</done>
</task>

</tasks>

<verification>`node scripts/agnostic-lint.js report`: `money`, `reg`, `game`, `owner` read 0 denied. Full gate green.</verification>
<success_criteria>The four must-have truths; ruling file of 6.4 closed.</success_criteria>
<output>`.planning/agnostic/M/M-06-SUMMARY.md`</output>
