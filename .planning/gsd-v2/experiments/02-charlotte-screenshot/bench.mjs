// Usage: node bench.mjs <charlotte-dist-index.js> <label> <calls> [url] [scenario]
// Drives a private Charlotte MCP server over stdio, mimicking the runner:
// tab_open -> configure -> navigate -> reload -> screenshot{save:true} x N.
import { Client } from "/Users/ollorin/charlotte/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "/Users/ollorin/charlotte/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [dist, label, nStr, url = "http://localhost:3000", scenario = "runner"] = process.argv.slice(2);
const n = Number(nStr);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shot-bench-"));
const transport = new StdioClientTransport({
  command: "node", args: [dist],
  env: { ...process.env, CHARLOTTE_PROFILE_ROOT: path.join(tmp, "profiles") },
});
const client = new Client({ name: "bench", version: "1" });
await client.connect(transport);
const call = async (name, args = {}, timeout = 400000) => {
  const t = performance.now();
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    const txt = r.content?.find((c) => c.type === "text")?.text ?? "";
    const img = r.content?.find((c) => c.type === "image");
    return { ms: performance.now() - t, ok: !r.isError, img: !!img, bytes: img?.data?.length, txt: txt.slice(0, 200) };
  } catch (e) { return { ms: performance.now() - t, ok: false, txt: String(e).slice(0, 200) }; }
};
const steps = scenario === "single" ? [] : [["charlotte:tab_open", {}]];
steps.push(["charlotte:configure", { screenshot_dir: path.join(tmp, "shots") }], ["charlotte:navigate", { url }]);
if (scenario === "runner") steps.push(["charlotte:reload", {}], ["charlotte:wait_for", { js: "document.readyState === 'complete'", timeout: 3000 }]);
for (const [nm, a] of steps) { const r = await call(nm, a); console.error(label, nm, r.ok, Math.round(r.ms), r.txt.slice(0, 80)); }
import { execSync } from "node:child_process";
const display = () => { try { return /CurrentPowerState"=([0-9]+)/.exec(execSync("ioreg -r -k IOPowerManagement -c IOMobileFramebufferAP | grep CurrentPowerState | head -1").toString())?.[1] === "1" ? "on" : "off"; } catch { return "unknown"; } };
const displayStart = display();
const lat = [], res = [];
for (let i = 0; i < n; i++) {
  const r = await call("charlotte:screenshot", { save: true });
  res.push(r); lat.push(r.ms);
  console.error(label, "shot", i + 1, r.ok ? "OK" : "FAIL", Math.round(r.ms), "ms", r.ok ? r.bytes : r.txt);
}
const ok = res.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const all = [...lat].sort((a, b) => a - b);
const q = (a, p) => a.length ? Math.round(a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]) : null;
console.log(JSON.stringify({ label, display: displayStart, displayEnd: display(), dist, url, scenario, n, ok: ok.length, fail: n - ok.length, p50_all: q(all, .5), p95_all: q(all, .95), p50_ok: q(ok, .5), p95_ok: q(ok, .95), max: q(all, 1) }));
await client.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
