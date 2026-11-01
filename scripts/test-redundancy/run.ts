// Usage (from any cwd):
//   deno run --allow-read --allow-write --allow-run run.ts --root <worktree> --source <repo-rel .ts> \
//     --test <repo-rel .test.ts> --out <dir> [--max N] [--mutate-script <gsd-mutate.ts>] [--env-file .env.test]
// Generates mutants, runs them through gsd-mutate (sequential), turns failing_tests into a kill matrix.
import { analyse, caseSpans, generateMutants, parseCases } from "./lib.ts";

const arg = (n: string, d?: string) => {
  const i = Deno.args.indexOf(`--${n}`);
  const v = i >= 0 ? Deno.args[i + 1] : d;
  if (v === undefined) throw new Error(`missing --${n}`);
  return v;
};
const root = arg("root");
const source = arg("source");
const test = arg("test");
const out = arg("out");
const max = Number(arg("max", "100000"));
const mutateScript = arg("mutate-script", "/Users/ollorin/igaming-platform/scripts/gsd-mutate/gsd-mutate.ts");
const envFile = arg("env-file", ".env.test");
const crossMax = Number(arg("cross", "0")); // >0: also run every killed/survived mutant against up to N other test files that import the source
await Deno.mkdir(out, { recursive: true });

const sources = source.split(",");
const srcTexts = await Promise.all(sources.map((f) => Deno.readTextFile(`${root}/${f}`)));
const srcText = srcTexts.join("\n");
const testText = await Deno.readTextFile(`${root}/${test}`);
let seq = 0;
const mutants = sources.flatMap((file, i) =>
  generateMutants(srcTexts[i], max).map((m) => ({ ...m, id: `M${String(++seq).padStart(3, "0")}`, file }))
);
await Deno.writeTextFile(
  `${out}/mutants.json`,
  JSON.stringify(mutants.map((m) => ({ id: m.id, file: m.file, test, old: m.old, new: m.new })), null, 1),
);

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const apiDir = `${root}/apps/api`;
const t0 = Date.now();
const base = await new Deno.Command("deno", {
  args: ["test", "--allow-all", `--env-file=${envFile}`, test.replace(/^apps\/api\//, "")],
  cwd: apiDir,
  stdout: "piped",
  stderr: "piped",
}).output();
const baseMs = Date.now() - t0;
if (!base.success) throw new Error("baseline red:\n" + dec(base.stdout).slice(-2000));
const cases = parseCases(dec(base.stdout));
if (new Set(cases).size !== cases.length) console.error("WARN duplicate case names; duplicates collapse in the matrix");

const run = await new Deno.Command("deno", {
  args: [
    "run", "--allow-read", "--allow-write", "--allow-run=git,deno,perl,kill", mutateScript,
    "--mutants", `${out}/mutants.json`, "--root", root, "--out", `${out}/mutate.jsonl`,
    "--test-flag=--allow-all", `--test-flag=--env-file=${envFile}`,
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
const runInfo = JSON.parse(await Deno.readTextFile(`${out}/mutate.jsonl.run.json`));
if (runInfo.baseline_before !== "green" || runInfo.baseline_after !== "green") console.error("WARN baselines not green: run void", runInfo);

const recs = (await Deno.readTextFile(`${out}/mutate.jsonl`)).trim().split("\n").map((l) => JSON.parse(l));
const extraKills: Record<string, string[]> = {};
const crossFiles: string[] = [];
if (crossMax > 0) {
  const names = sources.map((f) => f.split("/").pop()!.replace(/\.ts$/, "")).join("|");
  const g = await new Deno.Command("git", { args: ["grep", "-lE", `from ['"][^'"]*/(${names})(\\.ts)?['"]`, "--", "*.test.ts"], cwd: root, stdout: "piped" }).output();
  const unitOnly = async (f: string) => {
    if (/__tests__|integration|e2e|\/supabase\//i.test(f)) return false; // never touch the shared stack
    const t = await Deno.readTextFile(`${root}/${f}`);
    return !/SUPABASE_URL|127\.0\.0\.1|localhost:5\d{4}|Deno\.env\.get\(['"]SUPABASE/.test(t);
  };
  const direct = dec(g.stdout).trim().split("\n").filter((f) => f && f !== test);
  // barrel / indirect users: test files that mention an exported identifier of the sources (most mentions first)
  const idents = [...new Set(srcTexts.flatMap((t) => [...t.matchAll(/^export (?:const|function|async function) (\w{6,})/gm)].map((m) => m[1])))];
  let named: string[] = [];
  if (idents.length) {
    const gn = await new Deno.Command("git", { args: ["grep", "-cwE", idents.join("|"), "--", "*.test.ts"], cwd: root, stdout: "piped" }).output();
    named = dec(gn.stdout).trim().split("\n").filter(Boolean).map((l) => ({ f: l.slice(0, l.lastIndexOf(":")), n: Number(l.slice(l.lastIndexOf(":") + 1)) }))
      .filter((x) => x.f !== test && !direct.includes(x.f)).sort((a, b) => b.n - a.n).map((x) => x.f);
  }
  const cands = [...direct, ...named];
  const found: string[] = [];
  for (const f of cands) if (found.length < crossMax && await unitOnly(f)) found.push(f);
  const live = recs.filter((r) => r.outcome === "killed" || r.outcome === "survived").map((r) => r.id);
  const all = JSON.parse(await Deno.readTextFile(`${out}/mutants.json`));
  for (const [i, f] of found.entries()) {
    const sel = all.filter((m: { id: string }) => live.includes(m.id)).map((m: Record<string, string>) => ({ ...m, test: f }));
    await Deno.writeTextFile(`${out}/mutants-cross${i}.json`, JSON.stringify(sel, null, 1));
    await new Deno.Command("deno", {
      args: ["run", "--allow-read", "--allow-write", "--allow-run=git,deno,perl,kill", mutateScript, "--mutants", `${out}/mutants-cross${i}.json`, "--root", root, "--out", `${out}/cross${i}.jsonl`, "--test-flag=--allow-all", `--test-flag=--env-file=${envFile}`],
      stdout: "null", stderr: "null",
    }).output();
    let info: { baseline_before?: string; baseline_after?: string } = {};
    try { info = JSON.parse(await Deno.readTextFile(`${out}/cross${i}.jsonl.run.json`)); } catch { /* run cut short */ }
    if (info.baseline_before !== "green" || info.baseline_after !== "green") { console.error("WARN cross file skipped (baseline not green or run cut short):", f); continue; }
    crossFiles.push(f);
    for (const l of (await Deno.readTextFile(`${out}/cross${i}.jsonl`)).trim().split("\n")) {
      const r = JSON.parse(l);
      if (r.outcome === "killed") (extraKills[r.id] ??= []).push(`[other-file] ${f}`);
    }
  }
}
const byId = new Map(mutants.map((m) => [m.id, m]));
const caseSet = new Set(cases);
const kills: Record<string, string[]> = {};
const crossLabels = crossFiles.map((f) => `[other-file] ${f}`);
const unattributed: string[] = [];
const unknownNames = new Set<string>();
const counts: Record<string, number> = {};
const ms: Record<string, number[]> = {};
for (const r of recs) {
  counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  (ms[r.outcome] ??= []).push(r.duration_ms);
  if (r.outcome !== "killed") continue;
  const names: string[] = r.failing_tests.filter((n: string) => caseSet.has(n));
  for (const n of r.failing_tests) if (!caseSet.has(n)) unknownNames.add(n);
  if (names.length === 0) unattributed.push(r.id);
  else kills[r.id] = names;
}

for (const [id, extra] of Object.entries(extraKills)) kills[id] = [...(kills[id] ?? []), ...extra];
const spans = caseSpans(testText);
const loc: Record<string, number> = {};
for (const s of spans) loc[s.name] = s.end - s.start + 1;
const unmatched = cases.filter((c) => loc[c] === undefined);
const locAll: Record<string, number> = Object.fromEntries(cases.map((c) => [c, loc[c] ?? 1]));
const allCases = [...cases, ...crossLabels];
for (const c of crossLabels) locAll[c] = 0;
const a = analyse({ cases: allCases, kills }, locAll, crossLabels);
const locOf = (c: string) => loc[c] ?? 1; // table-driven row without a literal title: 1 data line (estimate, see unmatchedLocCases)
const droppableLoc = a.droppable.reduce((s, c) => s + locOf(c), 0);
const srcLoc = srcText.split("\n").length;
const testLoc = testText.split("\n").length;
const survivors = recs.filter((r) => r.outcome === "survived").map((r) => {
  const m = byId.get(r.id)!;
  return { id: r.id, killedElsewhere: extraKills[r.id] ?? [], file: m.file, line: m.line, op: m.op, old: m.old.split("\n").find((l, i) => m.new.split("\n")[i] !== l) ?? m.old, new: m.new.split("\n").find((l, i) => m.old.split("\n")[i] !== l) ?? m.new };
});
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const summary = {
  source, test, srcLoc, testLoc, nCases: cases.length, caseLocTotal: sum(cases.map(locOf)),
  baselineRunMs: baseMs, nMutants: mutants.length, outcomes: counts,
  meanMsPerOutcome: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(sum(v) / v.length)])),
  totalMutantMs: sum(recs.map((r) => r.duration_ms)),
  killedAttributed: a.killedMutants, killedUnattributed: unattributed,
  crossFiles, greedyCount: a.greedy.filter((c) => !crossLabels.includes(c)).length, droppableCount: a.droppable.length, droppableLoc,
  zeroKillCases: a.zeroKill, zeroUniqueCases: a.zeroUnique,
  unmatchedLocCases: unmatched, failingNamesNotInCaseList: [...unknownNames],
  mutateExit: run.code, runInfo,
};
await Deno.writeTextFile(`${out}/summary.json`, JSON.stringify({ summary, perCase: a.perCase.map((p) => ({ ...p, loc: locOf(p.name) })), greedy: a.greedy, droppable: a.droppable, survivors, kills }, null, 1));
const killIds = Object.keys(kills);
const header = ["case", "loc", "kills", "unique", ...killIds].join("\t");
const rows = cases.map((c) => {
  const p = a.perCase.find((x) => x.name === c)!;
  return [c, locOf(c), p.kills, p.unique, ...killIds.map((id) => (kills[id].includes(c) ? 1 : 0))].join("\t");
});
await Deno.writeTextFile(`${out}/matrix.tsv`, [header, ...rows].join("\n") + "\n");
console.log(JSON.stringify(summary, null, 1));
