# Auto-Ngrok Webhook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When `NGROK_AUTHTOKEN` is set, automatically start an ngrok tunnel on daemon startup, get the public URL, and use it as the Telegram webhook — no manual URL needed.

**Architecture:** Add `@ngrok/ngrok` as a dependency. In `startBot()`, check for `NGROK_AUTHTOKEN` before the webhook/polling branch: if set, start a tunnel pointing at `PORT`, grab the URL, then call `startWebhookMode()` with it. On `stopBot()`, close the tunnel. Priority: manual `TELEGRAM_WEBHOOK_URL` > auto ngrok > long polling.

**Tech Stack:** `@ngrok/ngrok` (official Node.js SDK), TypeScript ESM, existing `startWebhookMode()` in `src/daemon/bot/index.ts`

**GSD Installer note:** `scripts/install-modules.js` uses npm workspaces and runs `npm install` at the repo root, which covers `mcp-servers/telegram-mcp/`. Adding `@ngrok/ngrok` to `telegram-mcp/package.json` is sufficient — no installer script changes needed.

---

### Task 1: Install `@ngrok/ngrok` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

```bash
cd /Users/ollorin/get-shit-done/mcp-servers/telegram-mcp
npm install @ngrok/ngrok
```

Expected: `@ngrok/ngrok` appears in `package.json` dependencies and `node_modules/@ngrok/ngrok` exists.

**Step 2: Verify types are available**

```bash
ls node_modules/@ngrok/ngrok/dist/*.d.ts 2>/dev/null | head -3
```

Expected: `.d.ts` files present (the package ships its own types).

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(telegram-mcp): add @ngrok/ngrok dependency"
```

---

### Task 2: Add auto-ngrok tunnel logic to `src/daemon/bot/index.ts`

**Files:**
- Modify: `src/daemon/bot/index.ts`

**Step 1: Add the ngrok import at the top of the file**

After the existing imports (after line 18, before the `const log` line), add:

```typescript
import ngrok from '@ngrok/ngrok';
```

**Step 2: Add module-level variable to track the ngrok listener**

After the `webhookServer` declaration (line 40), add:

```typescript
/** ngrok tunnel listener — non-null only when auto-ngrok is active */
let ngrokListener: Awaited<ReturnType<typeof ngrok.forward>> | null = null;
```

**Step 3: Add `startNgrokTunnel()` helper function**

Add this function after `startPollingMode()` (after line 197):

```typescript
/**
 * Start an ngrok tunnel and return the public HTTPS URL.
 *
 * Requires NGROK_AUTHTOKEN to be set. The tunnel forwards to localhost:{port}.
 * The returned URL is used as the Telegram webhook base URL.
 *
 * @param port Local port to tunnel (same as webhook HTTP server port)
 * @returns Public HTTPS URL (e.g. "https://abc123.ngrok-free.app")
 */
async function startNgrokTunnel(port: number): Promise<string> {
  const authtoken = process.env.NGROK_AUTHTOKEN as string;
  ngrokListener = await ngrok.forward({
    addr: port,
    authtoken,
  });
  const url = ngrokListener.url();
  if (!url) {
    throw new Error('ngrok tunnel started but returned no URL');
  }
  log.info({ url, port }, 'ngrok tunnel established');
  return url;
}
```

**Step 4: Update the webhook/polling branch in `startBot()` to check for auto-ngrok**

Find this block in `startBot()` (lines 141–149):

```typescript
  // ─── Webhook vs polling ───────────────────────────────────────────────────

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

  if (webhookUrl) {
    await startWebhookMode(botInstance, webhookUrl);
  } else {
    await startPollingMode(botInstance);
  }
```

Replace it with:

```typescript
  // ─── Webhook vs polling ───────────────────────────────────────────────────
  // Priority: manual TELEGRAM_WEBHOOK_URL > auto ngrok (NGROK_AUTHTOKEN) > long polling

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  const ngrokAuthtoken = process.env.NGROK_AUTHTOKEN;

  if (webhookUrl) {
    await startWebhookMode(botInstance, webhookUrl);
  } else if (ngrokAuthtoken) {
    const port = parseInt(process.env.PORT ?? '3000', 10);
    const tunnelUrl = await startNgrokTunnel(port);
    await startWebhookMode(botInstance, tunnelUrl);
  } else {
    await startPollingMode(botInstance);
  }
```

**Step 5: Update `stopBot()` to close the ngrok tunnel**

Find this in `stopBot()`:

```typescript
  if (webhookServer) {
    webhookServer.close();
    webhookServer = null;
  }

  log.info('Bot stopped');
```

Replace with:

```typescript
  if (webhookServer) {
    webhookServer.close();
    webhookServer = null;
  }

  if (ngrokListener) {
    await ngrokListener.close();
    ngrokListener = null;
    log.info('ngrok tunnel closed');
  }

  log.info('Bot stopped');
```

Note: `stopBot()` must become `async` — update its signature from `export function stopBot(): void` to `export async function stopBot(): Promise<void>`.

**Step 6: Build to verify no TypeScript errors**

```bash
cd /Users/ollorin/get-shit-done/mcp-servers/telegram-mcp
npm run build
```

Expected: exits 0, no errors. `dist/daemon/bot/index.js` updated.

**Step 7: Commit**

```bash
git add src/daemon/bot/index.ts
git commit -m "feat(telegram-mcp): auto-start ngrok tunnel when NGROK_AUTHTOKEN is set"
```

---

### Task 3: Update `.env.example` and `.env` docs

**Files:**
- Modify: `mcp-servers/telegram-mcp/.env.example`

**Step 1: Add NGROK_AUTHTOKEN to `.env.example`**

Find the existing webhook section:

```
# Optional — webhook mode (default: long polling)
# Set to a public HTTPS URL to receive updates via webhook instead of polling.
TELEGRAM_WEBHOOK_URL=https://your-ngrok-url.ngrok.io
PORT=3333
```

Replace with:

```
# Optional — webhook mode (default: long polling)
# Option A: provide a static public HTTPS URL (e.g. from a fixed tunnel or hosted server)
# TELEGRAM_WEBHOOK_URL=https://your-domain.com

# Option B: auto-start ngrok tunnel on daemon startup (fresh URL each restart)
# Get your authtoken at https://dashboard.ngrok.com/get-started/your-authtoken
# NGROK_AUTHTOKEN=your-ngrok-authtoken-here
PORT=3333
```

**Step 2: Commit**

```bash
git add mcp-servers/telegram-mcp/.env.example
git commit -m "docs(telegram-mcp): document NGROK_AUTHTOKEN env var in .env.example"
```

---

### Task 4: Add `NGROK_AUTHTOKEN` to the live `.env` and rebuild dist

**Files:**
- Modify: `mcp-servers/telegram-mcp/.env`
- Build dist

**Step 1: Add NGROK_AUTHTOKEN to `.env`**

The user must obtain their authtoken from https://dashboard.ngrok.com/get-started/your-authtoken and add:

```
NGROK_AUTHTOKEN=<their-authtoken>
```

**Step 2: Rebuild dist**

```bash
cd /Users/ollorin/get-shit-done/mcp-servers/telegram-mcp
npm run build
```

**Step 3: Smoke-test by running the daemon directly**

```bash
cd /Users/ollorin/get-shit-done/mcp-servers/telegram-mcp
node dist/daemon/index.js 2>&1 | head -20
```

Expected log lines (JSON):
- `"msg":"ngrok tunnel established"` with a `url` field like `https://abc123.ngrok-free.app`
- `"msg":"Bot started in webhook mode on port 3000"` (or whatever PORT is set to)

Kill with Ctrl-C after confirming.

---

## Summary

| Task | Change | Commit |
|------|--------|--------|
| 1 | Install `@ngrok/ngrok` | `feat: add @ngrok/ngrok dependency` |
| 2 | Auto-tunnel in `bot/index.ts` | `feat: auto-start ngrok tunnel` |
| 3 | Update `.env.example` | `docs: document NGROK_AUTHTOKEN` |
| 4 | Wire `NGROK_AUTHTOKEN` in live `.env` + smoke test | (no commit — `.env` is gitignored) |
