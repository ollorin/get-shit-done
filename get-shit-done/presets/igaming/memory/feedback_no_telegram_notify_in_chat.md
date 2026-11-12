---
name: feedback-no-telegram-notify-in-chat
description: "The owner 2026-11-11: no Telegram for GSD notifications (Track 1 decision ledger, Track 2 demo notify); deliver to the chat instead"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-11-11T06:29:06.413Z
---

The owner 2026-11-11: Telegram is not needed. Decision-ledger summaries (Track 1: PRD / milestone-plan discussion points) and demo notifications (Track 2: gsd-demo `notify`) go to the chat, not Telegram.

**Why:** the owner reads the main session; Telegram replies never reached the ledger anyway (known gap in FABLE-AGENT-AB2.md section 7).

**How to apply:** when adopting Fable's Track 1/2 into the GSD fork, drop the Telegram send/reply path; main orchestrator prints the ledger/demo summary in chat and the owner's changes come back as chat messages. Telegram daemon PID 29365 stays allowlisted until the owner decides to kill it. See [[feedback-fable-replaces-opus-during-allowance]] for the same Fable review series.
