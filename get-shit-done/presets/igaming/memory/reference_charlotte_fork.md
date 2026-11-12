---
name: reference_charlotte_fork
description: "Charlotte (browser-QA MCP) is a user-owned fork like GSD — source at ~/charlotte, home folder, treat like the GSD fork (never clobber, never pull upstream)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: d29a6c8d-ecd0-4f75-a980-b2df3eb2d186
---

Charlotte (the browser-automation / QA MCP used by gsd-charlotte-qa and the Phase 290 E2E
regression gate) is a **user-maintained fork**, not a vendor tool. Its source lives at
`<home>/charlotte` in the home folder, alongside `~/get-shit-done`, with git remote
`origin = <private-repo>` (the user's own repo).

Treat it with the SAME discipline as the GSD fork: author changes in the home-folder source,
NEVER pull upstream or clobber the fork. When Charlotte misbehaves, the fix belongs in `~/charlotte`.

**Rollout mechanism (learned 2026-07-22 — differs from GSD; there is NO `install:*` script):**
- **Fork source:** `~/charlotte` — origin `<private-repo>`, currently **v0.4.0**
  (multi-instance/InstanceManager). Only build script is `npm run build` (tsc → `dist/`).
- **Consumed copy the live MCP actually runs:** `~/.claude-mcp-servers/charlotte/` — a SEPARATE git
  clone (same origin), was at **v0.3.0**, `dist/index.js` is what the MCP loads. Configured in
  `~/.claude.json` at `mcpServers.charlotte` → `{command:"node", args:["<home>/.claude-mcp-servers/charlotte/dist/index.js"]}`.
- **To roll a fork fix live:** (1) `git -C ~/charlotte push origin main` (fork remote — allowed);
  (2) in `~/.claude-mcp-servers/charlotte`: `git pull origin main && npm install && npm run build`;
  (3) restart Claude Code / reconnect the MCP so it reloads `dist`. A rebuild alone in `~/charlotte`
  does NOT affect the running MCP — different path. Cherry-picking a fix onto the 0.3.0 consumed copy
  risks conflicts (the 0.3.0→0.4.0 refactor touched navigation/observation/session/screencast); taking
  the whole fork HEAD is cleaner. All rollout steps are outward/env-modifying → user runs them.

**Detached-frame defect — FIXED 2026-07-22** (fork commit `254e70b`, local-only/unpushed): root cause
was NOT the 307 redirect (that was a red herring) — `BrowserManager.ensureConnected()` relaunches
Chromium after a crash/disconnect but `PageManager` kept returning the OLD cached `Page` (dead
browser, permanently `detached` main frame) → `page.goto()`/`page.title()` throw "Attempted to use
detached Frame" via Puppeteer's `@throwIfDetached`. Fix: `PageManager.ensureActivePage()` detects a
dead page (`isClosed()`/`mainFrame().detached`) and transparently recreates the tab; wired into all
live-op call sites. Needs the rollout above to reach Phase 290's live gate.

Relevant to: Phase 290 (milestone Charlotte E2E regression & close gate) and any Charlotte-touching
work in Waves A/C/D of v0.1.24. See [[reference_gsd_fork_rollout]] for the parallel GSD mechanism.
