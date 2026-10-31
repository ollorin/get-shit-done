# 03 — 1h prompt cache for phase coordinators

Change: `experimental: cacheTtl: 1h` in `agents/gsd-phase-coordinator.md` (fork + installed copy; originals in `backup/`). Applies to coordinators spawned after 2026-10-31 ~19:40 local. Running 401/402 coordinators unaffected.

Baseline (`research/01-SESSION-ANALYSIS.md` F2): coordinators wrote 333M cache tokens, 325M (98%) of them re-writes after a poll > 5 min; ~$767 premium over 34 days.

Check on the first new coordinator transcript: `usage.cache_creation.ephemeral_1h_input_tokens` > 0 and cache-write / cache-read ratio well below baseline. If the 1h bucket stays 0, the frontmatter key is not honoured → try `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=1h` scoped narrowly, or revert.
