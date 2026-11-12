// Known-bad inputs for the style gate. Each fixture is source text run through the real scanText with the js-ts rule set.
// The last fixture checks the corpus itself: every rule keeps at least three fixtures, so deleting one fails this gate.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findDuplicates, normalise } from '../../style-gate/dup.mjs';
import { scanText } from '../../style-gate/scan.mjs';

const RULE_SET_FILE = fileURLToPath(new URL('../../style-gate/rule-sets/js-ts.json', import.meta.url));
const raw = JSON.parse(fs.readFileSync(RULE_SET_FILE, 'utf8'));
const RULE_SET = {
  structural: raw.structural,
  threshold: raw.router_branch_threshold,
  regexRules: raw.regex_rules.map((r) => ({ id: r.id, re: new RegExp(r.pattern), message: r.message, edgeExempt: r.edge_exempt === true })),
};
const MAX = 20;
const flags = (rule, text, file = 'src/domain.js') => scanText(text, file, RULE_SET, { edgeGlobs: [], maxLines: MAX }).some((v) => v.rule === rule);
const block = (tag, n = 15) => Array.from({ length: n }, (_, k) => `const ${tag}${k} = compute(argumentNumber${k}, otherArgument${k}, thirdArgument${k});`).join('\n');
const duplicated = (files) => findDuplicates(files.map(({ file, text }) => ({ file, lines: normalise(text, file) })), 12).length > 0;

const FIXTURES = [
  { rule: 'throws', name: 'throw in a domain function', why: 'the plain violation the rule exists for', text: 'export const f = (x) => {\n  if (!x) throw new Error("no");\n  return x;\n};\n' },
  { rule: 'throws', name: 'try block', why: 'a try block converts failures by exception', text: 'export function f() {\n  try {\n    return g();\n  } catch (e) {\n    return null;\n  }\n}\n' },
  { rule: 'throws', name: 'throw after a comment-like string', why: 'a // inside a string must not hide a real throw on the same line', text: 'const u = "http://x"; throw new Error(u);\n' },
  { rule: 'fireAndForget', name: 'empty catch handler', why: 'an empty handler drops the failure', text: 'run().catch(() => {});\n' },
  { rule: 'fireAndForget', name: 'empty catch without spaces', why: 'formatting must not hide the empty handler', text: 'run().catch(()=>{ });\n' },
  { rule: 'fireAndForget', name: 'orphaned async result', why: 'a bare async result statement has no consumer', text: 'ResultAsync.fromPromise(save(x), toErr);\n' },
  { rule: 'ifElseRouters', name: 'four dispatch branches', why: 'an if/else chain on method and path is the router the rule forbids', text: 'if (method === "GET" && path === "/a") a();\nelse if (method === "GET" && path === "/b") b();\nelse if (method === "POST" && path === "/c") c();\nelse if (method === "PUT" && path === "/d") d();\n' },
  { rule: 'ifElseRouters', name: 'switch on the route', why: 'a switch on the route is the same router', text: 'switch (route) {\n  case "a": return a();\n  default: return b();\n}\n' },
  { rule: 'ifElseRouters', name: 'dispatch on url', why: 'the path token may be named url', text: 'if (method === "GET" && url === "/a") a();\nelse if (method === "GET" && url === "/b") b();\nelse if (method === "POST" && url === "/c") c();\nelse if (method === "PUT" && url === "/d") d();\n' },
  { rule: 'inputMutation', name: 'push on a parameter', why: 'the argument is changed in place', text: 'export function add(items, x) {\n  items.push(x);\n  return items;\n}\n' },
  { rule: 'inputMutation', name: 'member assignment on a parameter', why: 'an assignment into the argument', text: 'export const setTotal = (order) => {\n  order.total = 1;\n  return order;\n};\n' },
  { rule: 'inputMutation', name: 'delete on a parameter', why: 'delete changes the argument', text: 'function strip(obj) {\n  delete obj.secret;\n  return obj;\n}\n' },
  { rule: 'oversizeFiles', name: 'one line over the limit', why: 'the boundary: limit + 1 lines', text: `${'const a = 1;\n'.repeat(MAX + 1)}` },
  { rule: 'oversizeFiles', name: 'far over the limit', why: 'a god file', text: `${'const a = 1;\n'.repeat(MAX * 5)}` },
  { rule: 'oversizeFiles', name: 'over the limit with no trailing newline', why: 'the last line without a newline still counts', text: Array.from({ length: MAX + 1 }, () => 'const a = 1;').join('\n') },
  { rule: 'duplicateBlocks', name: 'block pasted into a second file', why: 'the plain copy', files: [{ file: 'src/a.js', text: `${block('v')}\n` }, { file: 'src/b.js', text: `${block('v')}\n` }] },
  { rule: 'duplicateBlocks', name: 'block pasted twice in one file', why: 'a copy inside one file counts', files: [{ file: 'src/a.js', text: `${block('v')}\nexport const gap = 1;\n${block('v')}\n` }] },
  { rule: 'duplicateBlocks', name: 'copy re-indented with comments', why: 'formatting and comments must not hide a copy', files: [{ file: 'src/a.js', text: `${block('v')}\n` }, { file: 'src/b.js', text: `${block('v').split('\n').map((l) => `    ${l} // copied`).join('\n')}\n` }] },
];
const RULES = ['throws', 'fireAndForget', 'ifElseRouters', 'inputMutation', 'oversizeFiles', 'duplicateBlocks'];

export const CANARIES = [
  ...FIXTURES.map((f) => ({ name: `${f.rule}: ${f.name}`, why: f.why, detect: () => (f.files ? duplicated(f.files) : flags(f.rule, f.text)) })),
  { name: 'corpus keeps three fixtures per rule', why: 'removing a fixture would silently weaken the guard', detect: () => RULES.every((r) => FIXTURES.filter((f) => f.rule === r).length >= 3) },
];
