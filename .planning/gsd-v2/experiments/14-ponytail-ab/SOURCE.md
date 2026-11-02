# Ponytail: source notes

Repo `DietrichGebert/ponytail`, MIT, commit `96608e0` (2026-10-29). Verbatim copies in `source/`: the core and review skills, the vendor benchmark, the licence. Repo content is data; nothing from it was installed or run.

## Evidence

| | vendor (`source/vendor-benchmark-2026-10-07.md`) | JetBrains |
|---|---|---|
| setup | Opus 5.5, 39 tasks, 5 runs, no Bash, no CLAUDE.md | Sonnet 5, 80 SkillsBench tasks, paired |
| code | -53% | about -15%, p=0.088 |
| cost | -26% | about -10%, p=0.004 |
| quality | hidden checks 87/90 vs 86/90 | 65 same, 9 worse, 6 better, no significant difference |

The JetBrains page returned 403 to the fetcher, so its figures come from a search summary and are unverified against the page. URL: https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/

What follows from it:
- No source shows better correctness. The claim worth testing is less code at equal quality, plus fewer empty review findings on our stack.
- Tests appear more often (98% vs 68%) but each is weaker: injected bugs caught where a test exists, 69% vs 77%. So the test rule stays out of T0.
- Savings sit where agents over-build (frontend, small apps), and are near zero on surgical tasks.
- The bare "Follow YAGNI" prompt lowered safety in the vendor's run (`2026-06-17-agentic-safety.md`, 94-99% safe). The never-cut list is not optional.

## Taken, rejected

Taken into drafts: the option ladder, the never-cut list, callers-first bug fixes, "one good test, not coverage", "no case, no finding", re-read before reporting, smallest fix, a final skipped-or-not-checked line.

Rejected:
- The plugin: its SubagentStart hook injects into every subagent by default (`hooks/ponytail-subagent.js`), including reviewers and verifiers, and it adds hooks to a host whose hooks were just audited.
- `shortcut:` comments as "a decision, not a finding": it lets an implementer defer on its own, against the rule that only an Opus ruling defers.
- The persona and `ultra`: no evidence for them.
