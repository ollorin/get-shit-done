# Shared planning-file writes — re-read before write

Applies to every step that mutates a file another concurrent GSD session (or a
prior step in this same session) may have changed since you last read it:
`STATE.md`, `ROADMAP.md`, `config.json`, `REQUIREMENTS.md`, `PROJECT.md`,
`MILESTONES.md`.

**The rule — never blind-overwrite a shared planning file:**

1. **Re-Read the file immediately before writing it.** Do NOT edit from a snapshot
   captured earlier in the session — a research spawn, a Q&A loop, a wave of
   executors, or another terminal may have advanced it in the meantime.
2. **Apply your delta to the fresh copy**, not to the stale one. Change only the
   line(s)/section(s) you own; preserve everything else exactly as re-read.
3. **Prefer the atomic `gsd-tools.js` mutators over raw `Write`** whenever one
   exists — they read-modify-write in a single process and cannot clobber
   unrelated fields:
   - `config get` / `config-set <key.path> <value>` for `config.json`
   - `roadmap update-plan-progress`, `phase add/insert/remove`, `phase complete`
     for `ROADMAP.md` / phase state
   - `state ...` helpers for `STATE.md` where available
4. **If you must `Write` the whole file** (no mutator fits), re-Read → merge →
   write in the tightest possible window, and never across an intervening
   Agent()/subagent spawn. If you spawned since your last read, re-Read again.

Last-write-wins on a stale snapshot silently discards a concurrent session's
work — treat these files as shared mutable state, not session-local scratch.
