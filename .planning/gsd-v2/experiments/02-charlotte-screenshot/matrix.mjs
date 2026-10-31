// Usage: node matrix.mjs [repeat]  -- direct-puppeteer config matrix, 20s protocolTimeout per shot.
import puppeteer from "/Users/ollorin/charlotte/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const BASE = ["--no-sandbox","--disable-setuid-sandbox","--disable-gpu","--disable-dev-shm-usage","--disk-cache-size=1","--media-cache-size=1","--disable-application-cache"];
const BG = ["--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--disable-background-timer-backgrounding"];
const configs = {
  A_main_headlessTrue: { opts: { headless: true, args: BASE } },
  B_headless_shell: { opts: { headless: "shell", args: BASE, executablePath: process.env.SHELL_BIN } },
  C_true_bgflags: { opts: { headless: true, args: [...BASE, ...BG] } },
  D_true_bgflags_noOcclusion: { opts: { headless: true, args: [...BASE, ...BG, "--disable-features=CalculateNativeWinOcclusion,MacWebContentsOcclusion"] } },
  E_true_bringToFront: { opts: { headless: true, args: BASE }, pre: async (p) => { await p.bringToFront(); } },
  F_true_viewportOnly: { opts: { headless: true, args: BASE }, shot: { fullPage: false } },
  G_true_noBeyondViewport: { opts: { headless: true, args: BASE }, shot: { fullPage: true, captureBeyondViewport: false } },
};
const only = process.argv[2] ? process.argv[2].split(",") : Object.keys(configs);
const reps = Number(process.argv[3] ?? 2);
const out = await Promise.all(only.map(async (name) => {
  const c = configs[name]; const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mx-"));
  let browser; const res = [];
  try {
    browser = await puppeteer.launch({ ...c.opts, userDataDir: dir, protocolTimeout: 20000 });
    const page = await browser.newPage();
    await page.goto("http://localhost:3000", { waitUntil: "load" });
    if (c.pre) await c.pre(page);
    for (let i = 0; i < reps; i++) {
      const t = performance.now();
      try { await page.screenshot({ type: "png", encoding: "base64", fullPage: true, ...(c.shot ?? {}) }); res.push(Math.round(performance.now() - t)); }
      catch (e) { res.push("FAIL:" + Math.round(performance.now() - t) + ":" + String(e.message).slice(0, 40)); }
    }
  } catch (e) { res.push("ERR:" + String(e.message).slice(0, 60)); }
  finally { try { await browser?.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); }
  return [name, res];
}));
for (const [n, r] of out) console.log(n.padEnd(30), JSON.stringify(r));
