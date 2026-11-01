// Read-only import of the production prompt builder; emits the prompt for each scenario in argv[0] to argv[1].
import { buildPrompt } from "/Users/ollorin/igaming-platform/apps/e2e-charlotte/runner/prompt.ts";

const [inPath, outPath, shotRoot] = Deno.args;
const scenarios = JSON.parse(await Deno.readTextFile(inPath)) as Record<string, any>;
const out: Record<string, string> = {};
for (const [key, sc] of Object.entries(scenarios)) {
  out[key] = buildPrompt(sc, `${shotRoot}/${key}/screenshots`, `${shotRoot}/${key}/recordings`, 0);
}
await Deno.writeTextFile(outPath, JSON.stringify(out));
