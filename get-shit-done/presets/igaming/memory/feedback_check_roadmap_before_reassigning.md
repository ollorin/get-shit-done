---
name: feedback_check_roadmap_before_reassigning
description: Before ruling that another phase owns a fix, check ROADMAP.md — that phase may be deferred out of the milestone (NB6→388.1 mistake, 2026-10-01)
metadata:
  type: feedback
---

On 2026-10-01 main ruled that "NB6 stays with 388.1". NB6 is the Charlotte operator login broken by the 2FA gate flip. But ROADMAP.md:712 showed 388.1 had been DEFERRED to the next milestone on 2026-09-27, so the fix had no owner. The verifier caught it, and 387.2 took it back.

**Why:** a hand-off to a deferred or non-existent phase is a silent deferral. That violates the owner's "no defer" rule.

**How to apply:** before assigning work to another phase, read that phase's ROADMAP row and confirm its status is in-milestone and not deferred. Default to the phase that introduced the break.

Also main-only: if Docker or OrbStack crashes mid-run, pause all stack work and treat every test result from the outage window as void. Related: [[bug_killing_wait_shell_revives_agent]].
