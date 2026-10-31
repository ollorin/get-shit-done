// Per-file FP/routing/sizing counters from scripts/fp-gate.ts (exp 07 runner, DESIGN §5.1 fp_delta).
// usage: deno run --allow-read fp_counts.ts <fp-gate.ts> <fp-gate-config.json> <root> <rel>...
// Missing files count as zero, so a file added by the run has a base of zero.
const [gatePath, configPath, root, ...rels] = Deno.args;
const gate = await import(new URL(`file://${gatePath}`).href);
const config = JSON.parse(await Deno.readTextFile(configPath));
const out: Record<string, Record<string, number>> = {};
for (const rel of rels) {
  const zero = { throws: 0, fireAndForget: 0, oversizeFiles: 0, ifElseRouters: 0 };
  const inScope = config.scanRoots.some((r: string) => rel.startsWith(`${r}/`)) &&
    !gate.matchesAnyGlob(rel, config.excludeGlobs);
  let text: string | null = null;
  try {
    text = await Deno.readTextFile(`${root}/${rel}`);
  } catch {
    text = null;
  }
  if (!inScope || text === null) {
    out[rel] = zero;
    continue;
  }
  out[rel] = {
    throws: gate.countThrows(text, rel, config),
    fireAndForget: gate.countFireAndForget(text, rel),
    oversizeFiles: gate.countOversizeFiles(rel, text.split("\n").length, config.locThreshold),
    ifElseRouters: gate.countIfElseRouters(text, rel, config.ifElseRouterBranchThreshold),
  };
}
console.log(JSON.stringify(out));
