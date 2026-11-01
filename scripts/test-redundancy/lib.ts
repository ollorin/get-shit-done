// Pure helpers for the test-redundancy experiment (12): mutant generation, case discovery,
// kill-matrix analysis. No I/O; run.ts does the I/O, selftest.ts proves these.

export interface Mutant {
  id: string;
  line: number; // 1-based line of the changed code
  op: string;
  old: string; // unique snippet (>=1 lines)
  new: string;
}

/** Replace string/template contents with "_" so operators inside literals are not matched. */
export const maskStrings = (line: string): string => {
  let out = "";
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\") {
        out += "__";
        i++;
      } else if (c === q) {
        out += c;
        q = null;
      } else out += "_";
    } else if (c === '"' || c === "'" || c === "`") {
      q = c;
      out += c;
    } else out += c;
  }
  return out;
};

/** Code lines only: drops comment lines, block-comment bodies, imports/exports-from, multi-line templates. */
export const codeLines = (src: string): { text: string; masked: string; lineNo: number }[] => {
  const res: { text: string; masked: string; lineNo: number }[] = [];
  let inBlock = false;
  let inTpl = false;
  src.split("\n").forEach((text, i) => {
    const t = text.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      return;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      return;
    }
    const ticks = (text.match(/(?<!\\)`/g) ?? []).length;
    const wasTpl = inTpl;
    if (ticks % 2 === 1) inTpl = !inTpl;
    if (wasTpl || inTpl) return;
    if (t === "" || t.startsWith("//") || t.startsWith("*")) return;
    if (/^(import|export)\b.*\bfrom\b/.test(t) || /^import\s/.test(t)) return;
    if (/^(export\s+)?(type|interface)\b/.test(t)) return;
    let masked = maskStrings(text);
    const cm = masked.indexOf("//");
    if (cm >= 0) masked = masked.slice(0, cm);
    res.push({ text, masked, lineNo: i + 1 });
  });
  return res;
};

type Edit = { op: string; col: number; len: number; rep: string };

const lineEdits = (text: string, masked: string): Edit[] => {
  const edits: Edit[] = [];
  const add = (re: RegExp, op: string, rep: (m: RegExpExecArray) => string | null) => {
    for (const m of masked.matchAll(re)) {
      const r = rep(m as RegExpExecArray);
      if (r !== null) edits.push({ op, col: m.index!, len: m[0].length, rep: r });
    }
  };
  add(/===/g, "eq-flip", () => "!==");
  add(/!==/g, "eq-flip", () => "===");
  add(/&&/g, "and-or", () => "||");
  add(/\|\|/g, "or-and", () => "&&");
  add(/\btrue\b/g, "bool", () => "false");
  add(/\bfalse\b/g, "bool", () => "true");
  add(/\(!(?!=)/g, "not-drop", () => "(");
  add(/ <= /g, "cmp", () => " < ");
  add(/ >= /g, "cmp", () => " > ");
  add(/ < /g, "cmp", () => " <= ");
  add(/ > /g, "cmp", () => " >= ");
  add(/ \+ /g, "arith", () => " - ");
  add(/ - /g, "arith", () => " + ");
  add(/\.isOk\(\)/g, "isOk-isErr", () => ".isErr()");
  add(/\.isErr\(\)/g, "isOk-isErr", () => ".isOk()");
  add(/(?<![\w.$])\d+(?![\w.])/g, "num+1", (m) => String(Number(m[0]) + 1));
  add(/\.some\(/g, "some-every", () => ".every(");
  add(/\.every\(/g, "some-every", () => ".some(");
  add(/Math\.max\(/g, "max-min", () => "Math.min(");
  add(/Math\.min\(/g, "max-min", () => "Math.max(");
  add(/\.startsWith\(/g, "starts-ends", () => ".endsWith(");
  add(/ \+= /g, "arith", () => " -= ");
  add(/ -= /g, "arith", () => " += ");
  add(/\?\? [\w$.'"]+(?:\([^()]*\))?/g, "nullish-left", () => ""); // `a ?? b` -> `a `
  // type-preserving operators: force an if/while condition, drop a bare `!`, delete a call statement
  for (const m of masked.matchAll(/\b(?:if|while) \(/g)) {
    let depth = 0, end = -1;
    for (let i = m.index! + m[0].length - 1; i < masked.length; i++) {
      if (masked[i] === "(") depth++;
      else if (masked[i] === ")" && --depth === 0) { end = i; break; }
    }
    if (end < 0) continue;
    const start = m.index! + m[0].length;
    if (/^(true|false)$/.test(masked.slice(start, end).trim())) continue;
    edits.push({ op: "cond-true", col: start, len: end - start, rep: "true" });
    edits.push({ op: "cond-false", col: start, len: end - start, rep: "false" });
    edits.push({ op: "cond-negate", col: start, len: end - start, rep: `!(${text.slice(start, end)})` });
  }
  add(/(?<![!=\w)\]'"`])!(?=[\w(])/g, "not-drop", () => "");
  if (/^\s*(?:await\s+)?[\w$.]+\([^;]*\);\s*$/.test(masked) && !/^\s*(?:return|throw)\b/.test(masked)) {
    edits.push({ op: "stmt-delete", col: 0, len: text.length, rep: "" });
  }
  // value -> `undefined as never` always type-checks, so it probes whether any test pins the value
  const prop = /^(\s*)(["']?[\w$-]+["']?):\s+(.+?),\s*$/.exec(masked);
  if (prop && !/^(case|default)\b/.test(prop[2]) && !prop[3].startsWith("{") && !prop[3].startsWith("[") && !/[({[]$/.test(prop[3])) {
    const vs = prop[1].length + prop[2].length + 1 + (masked.slice(prop[1].length + prop[2].length + 1).search(/\S/));
    const ve = masked.replace(/,\s*$/, "").length;
    edits.push({ op: "prop-undef", col: vs, len: ve - vs, rep: "undefined as never" });
  }
  const ret = /^(\s*)return\s+(.+?);\s*$/.exec(masked);
  if (ret && ret[2] !== "undefined") {
    const vs = masked.indexOf("return") + 7;
    edits.push({ op: "return-undef", col: vs, len: masked.replace(/;\s*$/, "").length - vs, rep: "undefined as never" });
  }
  // non-empty string literal (single-line, double/single quoted) -> empty
  for (const m of text.matchAll(/(["'])((?:\\.|(?!\1).)+)\1/g)) {
    const before = masked.slice(0, m.index!);
    if (/\b(from|import)\s*$/.test(before) || /(^|[\s(,{])case\s*$/.test(before)) continue;
    if (masked[m.index!] !== m[1]) continue; // matched inside a comment
    if (m[2].length < 8 || !m[2].includes(" ")) continue; // tags/ids fail type-check, not tests
    edits.push({ op: "str-empty", col: m.index!, len: m[0].length, rep: m[1] + m[1] });
  }
  return edits;
};

const countOverlap = (hay: string, needle: string): number => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n++;
  return n;
};

/** Smallest window of consecutive lines around `idx` that occurs exactly once in the file. */
export const uniqueWindow = (lines: string[], idx: number, src: string): [number, number] | null => {
  for (let k = 0; k < 12; k++) {
    for (const [a, b] of [[idx - k, idx], [idx, idx + k], [idx - k, idx + k]] as const) {
      if (a < 0 || b >= lines.length) continue;
      const w = lines.slice(a, b + 1).join("\n");
      if (w.trim() !== "" && countOverlap(src, w) === 1) return [a, b];
    }
  }
  return null;
};

export const generateMutants = (src: string, max = Infinity): Mutant[] => {
  const lines = src.split("\n");
  const seen = new Set<string>();
  const out: Mutant[] = [];
  for (const cl of codeLines(src)) {
    for (const e of lineEdits(cl.text, cl.masked)) {
      const newLine = cl.text.slice(0, e.col) + e.rep + cl.text.slice(e.col + e.len);
      if (newLine === cl.text) continue;
      const key = `${cl.lineNo}|${newLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const w = uniqueWindow(lines, cl.lineNo - 1, src);
      if (!w) continue;
      const oldS = lines.slice(w[0], w[1] + 1).join("\n");
      const nl = lines.slice(w[0], w[1] + 1);
      nl[cl.lineNo - 1 - w[0]] = newLine;
      out.push({ id: "", line: cl.lineNo, op: e.op, old: oldS, new: nl.join("\n") });
    }
  }
  // deterministic spread when capped
  const picked = out.length <= max ? out : out.filter((_, i) => Math.floor((i * max) / out.length) !== Math.floor(((i - 1) * max) / out.length)).slice(0, max);
  return picked.map((m, i) => ({ ...m, id: `M${String(i + 1).padStart(3, "0")}` }));
};

// ---- test-case discovery ----

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

/** Leaf cases (steps or plain Deno.test) from `deno test` stdout, named `parent ... step` like gsd-mutate failing_tests. */
export const parseCases = (stdout: string): string[] => {
  const cases: string[] = [];
  const stack: { indent: number; name: string; kids: number }[] = [];
  const re = /^(\s*)(.*?) \.\.\.(?: (ok|FAILED|ignored)\b.*)?\s*$/;
  for (const raw of stripAnsi(stdout).split("\n")) {
    const m = re.exec(raw);
    if (!m) continue;
    const indent = m[1].length;
    const name = m[2];
    const top = stack[stack.length - 1];
    if (!m[3]) stack.push({ indent, name, kids: 0 });
    else if (top && top.indent === indent && top.name === name) {
      stack.pop();
      // a case that printed output is opened on one line and closed on another: no child cases => it is a leaf
      if (top.kids === 0) cases.push([...stack.map((x) => x.name), name].join(" ... "));
      if (stack.length) stack[stack.length - 1].kids++;
    } else {
      cases.push([...stack.map((x) => x.name), name].join(" ... "));
      if (top) top.kids++;
    }
  }
  return cases;
};

export interface CaseSpan {
  name: string;
  start: number;
  end: number;
}

/** Find it/test/Deno.test/t.step/describe calls with a literal title; return leaf spans with full names. */
export const caseSpans = (src: string): CaseSpan[] => {
  const calls: { kind: string; title: string; start: number; end: number }[] = [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const re = /(?<![\w.])(describe|it|test|Deno\.test|t\.step)(?:\.\w+)?\(\s*(?:\{\s*name:\s*)?(["'`])((?:\\.|(?!\2).)*)\2/g;
  for (const m of src.matchAll(re)) {
    const open = src.indexOf("(", m.index! + m[1].length);
    let depth = 0, q: string | null = null, end = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "/" && src[i + 1] === "/") i = src.indexOf("\n", i);
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        end = i;
        break;
      }
      if (i < 0) break;
    }
    if (end < 0) continue;
    calls.push({ kind: m[1], title: m[3], start: m.index!, end });
  }
  const spans: CaseSpan[] = [];
  for (const c of calls) {
    const kids = calls.some((o) => o !== c && o.start > c.start && o.end < c.end);
    if (kids && c.kind === "describe") continue;
    if (kids && c.kind !== "t.step" && c.kind !== "Deno.test") continue;
    if (kids) continue; // parent with steps: not a leaf
    const anc = calls.filter((o) => o !== c && o.start < c.start && o.end > c.end).sort((a, b) => a.start - b.start);
    spans.push({
      name: [...anc.map((a) => a.title), c.title].join(" ... "),
      start: lineOf(c.start),
      end: lineOf(c.end),
    });
  }
  return spans;
};

// ---- kill-matrix analysis ----

export interface Matrix {
  cases: string[];
  /** mutantId -> cases that failed on it (killed with named failing cases). */
  kills: Record<string, string[]>;
}

export interface Analysis {
  perCase: { name: string; kills: number; unique: number }[];
  zeroKill: string[];
  zeroUnique: string[];
  greedy: string[];
  droppable: string[];
  killedMutants: number;
}

export const analyse = (m: Matrix, loc?: Record<string, number>, forced: string[] = []): Analysis => {
  const mutants = Object.keys(m.kills).filter((id) => m.kills[id].length > 0);
  const killers = new Map<string, Set<string>>();
  for (const c of m.cases) killers.set(c, new Set());
  for (const id of mutants) for (const c of m.kills[id]) killers.get(c)?.add(id);
  const perCase = m.cases.map((name) => {
    const ks = killers.get(name)!;
    const unique = [...ks].filter((id) => m.kills[id].filter((c) => killers.has(c)).length === 1).length;
    return { name, kills: ks.size, unique };
  });
  const uncovered = new Set(mutants.filter((id) => m.kills[id].some((c) => killers.has(c))));
  const greedy: string[] = [];
  for (const f of forced) {
    if (!killers.has(f)) continue;
    greedy.push(f);
    for (const id of killers.get(f)!) uncovered.delete(id);
  }
  while (uncovered.size) {
    let best = "", bestN = 0;
    for (const c of m.cases) {
      if (greedy.includes(c)) continue;
      const n = [...killers.get(c)!].filter((id) => uncovered.has(id)).length;
      const better = n > bestN || (n === bestN && n > 0 && (loc?.[c] ?? 0) < (loc?.[best] ?? 0));
      if (better) {
        best = c;
        bestN = n;
      }
    }
    if (bestN === 0) break;
    greedy.push(best);
    for (const id of killers.get(best)!) uncovered.delete(id);
  }
  return {
    perCase,
    zeroKill: perCase.filter((p) => p.kills === 0).map((p) => p.name),
    zeroUnique: perCase.filter((p) => p.unique === 0).map((p) => p.name),
    greedy,
    droppable: m.cases.filter((c) => !greedy.includes(c)),
    killedMutants: mutants.length,
  };
};
