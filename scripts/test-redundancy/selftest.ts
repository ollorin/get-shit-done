// deno test --allow-read scripts/test-redundancy/selftest.ts
import { analyse, caseSpans, generateMutants, maskStrings, parseCases } from "./lib.ts";

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

Deno.test("maskStrings hides operators inside literals", () => {
  eq(maskStrings(`a === "x && y"`), `a === "______"`);
});

Deno.test("generateMutants: operators, uniqueness, string/comment skipping", () => {
  const src = [
    `import { a } from "./a.ts";`,
    `// if (x === 1) comment`,
    `export const f = (x: number) => {`,
    `  if (x === 1 && x > 0) return "yes";`,
    `  if (x === 1 && x > 0) return "yes";`,
    `  return "a === b";`,
    `};`,
  ].join("\n");
  const ms = generateMutants(src);
  const ops = ms.map((m) => m.op);
  if (!ops.includes("eq-flip") || !ops.includes("and-or") || !ops.includes("cmp") || !ops.includes("num+1")) throw new Error(ops.join());
  for (const m of ms) {
    const n = src.split(m.old).length - 1;
    if (n !== 1) throw new Error(`${m.id} old occurs ${n}`);
    if (m.old === m.new) throw new Error("noop");
    if (m.old.includes("import") && m.old.split("\n").length === 1) throw new Error("mutated import");
  }
  // the duplicated line must be anchored with a neighbour so that `old` is unique
  if (!ms.some((m) => m.line === 4 && m.old.split("\n").length > 1)) throw new Error("dup line not widened");
  // nothing from inside the string literal on line 6 flips ===
  if (ms.some((m) => m.line === 6 && m.op === "eq-flip")) throw new Error("mutated inside string");
  if (ms.some((m) => m.line === 2)) throw new Error("mutated comment");
});

Deno.test("parseCases: steps, plain tests, nesting", () => {
  const out = [
    "running 3 tests from ./x.test.ts",
    "\u001b[0mA ... ",
    "  one ... \u001b[32mok\u001b[0m (1ms)",
    "  B ... ",
    "    two ... ok (0ms)",
    "  B ... ok (0ms)",
    "A ... ok (2ms)",
    "plain ... ok (0ms)",
    "bad ... ",
    "  s ... FAILED (1ms)",
    "bad ... FAILED (1ms)",
  ].join("\n");
  eq(parseCases(out), ["A ... one", "A ... B ... two", "plain", "bad ... s"]);
});

Deno.test("caseSpans: names and spans match the nesting", () => {
  const src = [
    `describe("D", () => {`,
    `  it("one", () => {`,
    `    expect(1).toBe(1);`,
    `  });`,
    `  describe("N", () => {`,
    `    it("two (x)", () => { expect("it(").toBe("it("); });`,
    `  });`,
    `});`,
    `Deno.test("plain", () => {});`,
  ].join("\n");
  eq(caseSpans(src).map((s) => [s.name, s.start, s.end]), [["D ... one", 2, 4], ["D ... N ... two (x)", 6, 6], ["plain", 9, 9]]);
});

Deno.test("analyse: unique kills, zero kill, greedy cover (known matrix)", () => {
  // M1 killed by a,b ; M2 by b ; M3 by c,d ; M4 survives ; d kills nothing else
  const a = analyse({
    cases: ["a", "b", "c", "d", "e"],
    kills: { M1: ["a", "b"], M2: ["b"], M3: ["c", "d"], M4: [] },
  });
  eq(a.killedMutants, 3);
  eq(a.zeroKill, ["e"]);
  eq(a.perCase.find((p) => p.name === "b")!.unique, 1); // M2
  eq(a.perCase.find((p) => p.name === "a")!.unique, 0);
  eq(a.zeroUnique.sort(), ["a", "c", "d", "e"]);
  eq(a.greedy.length, 2); // b covers M1+M2, then one of c/d
  if (!a.greedy.includes("b")) throw new Error("b needed");
  eq(a.droppable.length, 3);
});

Deno.test("analyse: tie-break prefers fewer LOC", () => {
  const a = analyse({ cases: ["big", "small"], kills: { M1: ["big", "small"] } }, { big: 50, small: 5 });
  eq(a.greedy, ["small"]);
});

Deno.test("generateMutants: cond forcing, statement delete, prose-only string emptying", () => {
  const src = [
    `export const g = (xs: string[]) => {`,
    `  if (xs.length > 0 && !xs[0]) {`,
    `    log("first element is missing here");`,
    `  }`,
    `  return "ok";`,
    `};`,
  ].join("\n");
  const ms = generateMutants(src);
  const has = (op: string, nl: string) => ms.some((m) => m.op === op && m.new.includes(nl));
  if (!has("cond-true", "if (true) {") || !has("cond-false", "if (false) {")) throw new Error("cond ops");
  if (!has("cond-negate", "if (!(xs.length > 0 && !xs[0])) {")) throw new Error("cond-negate");
  if (!has("not-drop", "&& xs[0])")) throw new Error("bare ! drop");
  if (!ms.some((m) => m.op === "stmt-delete" && m.new === "")) throw new Error("stmt-delete");
  if (!has("str-empty", 'log("");')) throw new Error("prose string");
  if (ms.some((m) => m.op === "str-empty" && m.new.includes('return "";'))) throw new Error("short tag emptied");
});

Deno.test("generateMutants: method swaps and nullish-left", () => {
  const ms = generateMutants(`export const h = (a: number[], b?: number) => a.some((x) => x > 1) && Math.max(1, 2) > (b ?? 3);`);
  const has = (op: string, s: string) => ms.some((m) => m.op === op && m.new.includes(s));
  if (!has("some-every", ".every(") || !has("max-min", "Math.min(") || !has("nullish-left", "(b )")) throw new Error(ms.map((m) => m.op + ":" + m.new).join("\n"));
});

Deno.test("generateMutants: prop-undef and return-undef use `undefined as never`", () => {
  const ms = generateMutants([`export const k = (a: number) => {`, `  const o = {`, `    code: "X_1",`, `    n: a + 1,`, `  };`, `  return o.n;`, `};`].join("\n"));
  const has = (op: string, s: string) => ms.some((m) => m.op === op && m.new.includes(s));
  if (!has("prop-undef", "code: undefined as never,") || !has("prop-undef", "n: undefined as never,") || !has("return-undef", "return undefined as never;")) throw new Error(ms.map((m) => m.op + ":" + m.new).join("|"));
});

import { reduceSource } from "./reduce.ts";
Deno.test("reduceSource: removes only non-kept case spans", () => {
  const src = [`describe("D", () => {`, `  it("a", () => {`, `    x();`, `  });`, `  it("b", () => {`, `    y();`, `  });`, `});`].join("\n");
  const r = reduceSource(src, new Set(["D ... a"]));
  eq(r.removed, ["D ... b"]);
  eq(r.out, [`describe("D", () => {`, `  it("a", () => {`, `    x();`, `  });`, `});`].join("\n"));
});

Deno.test("analyse: forced (cross-file) cases cover first and are never droppable choices", () => {
  const a = analyse({ cases: ["a", "b", "[x]"], kills: { M1: ["a", "[x]"], M2: ["b"] } }, {}, ["[x]"]);
  eq(a.greedy, ["[x]", "b"]); // M1 already covered elsewhere, so `a` is droppable
  eq(a.droppable, ["a"]);
});

Deno.test("parseCases: a case that printed output is opened and closed on separate lines", () => {
  const out = [
    "plain ... ok (0ms)",
    "noisy ... ",
    "------- output -------",
    "[x] some log line",
    "----- output end -----",
    "noisy ... ok (1ms)",
    "G ... ",
    "  step ... ",
    "  ------- output -------",
    "  log",
    "  ----- output end -----",
    "  step ... FAILED (1ms)",
    "G ... FAILED (1ms)",
  ].join("\n");
  eq(parseCases(out), ["plain", "noisy", "G ... step"]);
});
