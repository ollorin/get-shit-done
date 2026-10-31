import { Client } from "/Users/ollorin/charlotte/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "/Users/ollorin/charlotte/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
const c = new Client({ name: "p", version: "1" });
await c.connect(new StdioClientTransport({ command: "node", args: [process.argv[2]], stderr: "ignore" }));
const t = async (n, a = {}) => { const r = await c.callTool({ name: n, arguments: a }); return r.content?.find(x => x.type === "text")?.text?.slice(0, 300); };
console.log(await t("charlotte:tab_open"));
console.log(await t("charlotte:navigate", { url: "http://localhost:3000" }).then(s => s.slice(0, 80)));
console.log(await t("charlotte:evaluate", { expression: "JSON.stringify({vis: document.visibilityState, focus: document.hasFocus(), hidden: document.hidden})" }));
await c.close(); process.exit(0);
