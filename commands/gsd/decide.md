---
name: gsd:decide
description: Answer queued owner questions (A-NN) at any time; works while a roadmap run is in flight
argument-hint: "[A-NN <answer> | A-NN ok] ..."
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

<objective>
Record owner answers in `.planning/DECISIONS.jsonl` (the owner's title is `owner_title` in the init output). Contract: @~/.claude/get-shit-done/references/decisions-protocol.md (`decisions` = `node "$HOME/.claude/get-shit-done/bin/decisions.js"`).
</objective>

<process>
1. No arguments: `decisions list --open`. Nothing open: say so and stop. Otherwise ask them with AskUserQuestion (at most 4 per call, irreversible and costly first; options = the record's options, the default marked "(current default)").
2. Per answer: `decisions answer A-NN --value "<answer>"` (`A-NN ok`: add `--confirm`). Add `--accept-as-built` only when the user said to keep what was built.
3. Report each outcome in one line, from the JSON the command printed, and do what the protocol's Answers table says for it. `rework`: tell the user which built phases are affected and that the running roadmap picks the ticket up at its next phase boundary; when no run is in flight, offer `/gsd:insert-phase`.
4. `decisions render`, then commit `.planning/DECISIONS.jsonl` and `.planning/DECISIONS.md` (`git commit -- <those two paths>`).

Never edit the ledger by hand and never decide `--accept-as-built` yourself.
</process>
