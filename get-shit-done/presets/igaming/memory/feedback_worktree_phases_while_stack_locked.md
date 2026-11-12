---
name: feedback-worktree-phases-while-stack-locked
description: "When one phase holds the shared stack lock, run other phases code-only in git worktrees (.tmp/wt-<phase>) instead of waiting"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 58cca91c-5014-4482-b959-beca6c420713
  modified: 2026-10-03T19:37:39.821Z
---

When the owner asked "how we can speedup?", the answer was that phases had been serialized on the single local stack: any apps/api write in the main checkout hot-reloads `supabase functions serve` and voids the lock holder's live runs. So other phases now run in `git worktree add -b wt/<phase> .tmp/wt-<phase> HEAD`. They do code, migrations, unit tests, Opus reviews and frontend builds there, with no stack use. Integration tests are written but marked "pending joint train". Main merges the worktree branches and runs ONE joint train.

**Why:** Phase 390 held the lock for ~20h of fix loops while 391/392 (planned, file-disjoint) sat idle.

**How to apply:**
- Give each worktree phase a disjoint migration-timestamp range.
- Fix iterations run only the affected test files, once. The double train runs once, at the final SHA.
- Keep executor units small; context deaths cost 20–40 min each.

**Lesson from v0.1.33:** leaving ALL SQL execution to the joint train is the wrong default. Phase 391 piled up at least 5 defects that only running the SQL could find: a CHECK dropped silently, a 42P01 at runtime, a self-assertion whose RAISE was broken, and money predicates "tested" only by token presence. Give worktree phases rotating stack-lock turns for real-DB passes (db reset plus DB/PostgREST tests) as soon as their migrations exist, not at the end. Text and contract tests over SQL never prove a decision.

**A `db reset` run from a worktree needs the version pins.** Copy the gitignored `apps/api/supabase/.temp/{postgres,gotrue,rest,storage}-version` and `storage-migration` from the main checkout into the worktree first. Without them the CLI falls back to newer image defaults, the pull fails, and the DB is left wiped. This happened in v0.1.33. Run every CLI command from `<worktree>/apps/api`. From the worktree root the CLI names the project after the directory basename and reports "supabase start is not running". Never copy `project-ref` (the linked remote project) into a worktree. If a reset fails, the runner stops; it never rebuilds by applying migrations through psql. Worktree real-DB passes may only run DB/PostgREST tests, because edge functions are served from the main checkout.

Related: [[feedback-keep-two-phases-in-flight]].
