---
name: feedback_no_attribution_tags_in_rules
description: Don't add "(owner <date>)" or similar provenance tags when writing rules into CLAUDE.md, rules files, or GSD
metadata:
  type: feedback
---

When codifying a rule in CLAUDE.md, `.claude/rules/` or GSD, state the rule only. Do not add provenance tags such as "(owner 2026-10-01)". The owner called this "unnecessary info" on 2026-10-01.

**Why:** every agent loads these files, so tags cost tokens and add nothing; git history already records who decided and when.

**How to apply:** keep an incident reference only when it explains WHY a rule exists, e.g. "(387.2: teardown hid the TOTP path)". Never add a who/when stamp. Related: [[feedback_be_concise_token_budget]].
