// deno run --allow-read --allow-write reduce.ts <test.ts> <summary.json> <out.test.ts>
// Writes a copy of the test file with every non-greedy (droppable) case removed (line spans from caseSpans).
import { caseSpans } from "./lib.ts";

export const reduceSource = (src: string, keep: Set<string>): { out: string; removed: string[]; skipped: string[] } => {
  const lines = src.split("\n");
  const spans = caseSpans(src);
  const drop = new Set<number>();
  const removed: string[] = [];
  const skipped: string[] = [];
  for (const s of spans) {
    if (keep.has(s.name)) continue;
    const first = lines[s.start - 1].trim();
    const last = lines[s.end - 1].trim();
    const cleanStart = /^(it|test|Deno\.test|await t\.step|t\.step)\b/.test(first) || first === "Deno.test(";
    const cleanEnd = /\)\s*;?$/.test(last);
    if (!cleanStart || !cleanEnd) {
      skipped.push(s.name);
      continue;
    }
    for (let i = s.start; i <= s.end; i++) drop.add(i);
    removed.push(s.name);
  }
  return { out: lines.filter((_, i) => !drop.has(i + 1)).join("\n"), removed, skipped };
};

if (import.meta.main) {
  const [testPath, summaryPath, outPath] = Deno.args;
  const sum = JSON.parse(await Deno.readTextFile(summaryPath));
  const { out, removed, skipped } = reduceSource(await Deno.readTextFile(testPath), new Set<string>(sum.greedy));
  await Deno.writeTextFile(outPath, out);
  console.log(JSON.stringify({ removed: removed.length, skipped }));
}
