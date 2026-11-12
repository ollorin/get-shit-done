---
name: feedback-editor-diagnostics-unreliable-for-deno
description: "IDE TypeScript diagnostics on Deno files (apps/api) are unreliable; run deno check before relaying any \"type error\" to an agent"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-09-26T18:02:32.122Z
---

The IDE's TS server can't resolve Deno imports (`@std/*`, `@igaming/*`, the `Deno` global). So `assert`/`assertExists` lose their `asserts` signatures, and narrowing guards look broken even when the code is correct. On 2026-09-26 I relayed 3 "type errors" in 387 test files. All were false, and `deno check` was clean.

**Why:** false alarms cost coordinators a verification round and weaken my credibility as a reviewer.

**How to apply:** for `apps/api/**` files, run `cd apps/api && deno check <file>` before flagging a type error. Player-web/operator-web diagnostics are trustworthy only if `npx tsc --noEmit -p apps/<app>` agrees. The 616 jest-dom errors there were real.
