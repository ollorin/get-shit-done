// inputMutation (js-ts): a plain identifier parameter that its own function changes in place.
// Input is the comment- and string-stripped view (scan.mjs). Stated limits: aliases and destructured or rest parameters
// are not chased; an expression-bodied arrow function is not inspected; the function body is found by brace matching on
// the stripped view, which still counts braces inside regular-expression literals, so a body holding an unbalanced brace
// in such a literal is mis-bounded.

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'else', 'do', 'try', 'finally', 'new', 'typeof', 'await', 'yield', 'in', 'of', 'delete', 'void', 'throw', 'case', 'super', 'import', 'export']);
const MUTATING = 'push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear';
const MEMBER = '(?:\\s*\\.\\s*[\\w$]+|\\s*\\[[^\\]\\n]*\\])';
const ASSIGN = '(?:=(?![=>])|[-+*/%&|^]=|\\*\\*=|<<=|>>>?=|&&=|\\|\\|=|\\?\\?=)';

const skipSpace = (s, i) => { let k = i; while (k < s.length && /\s/.test(s[k])) k += 1; return k; };

function matchClose(s, open, a, b) {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === a) depth += 1;
    else if (s[i] === b) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ('([{<'.includes(c)) depth += 1;
    else if (')]}'.includes(c) || (c === '>' && text[i - 1] !== '=')) depth -= 1;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts;
}

const PARAM = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*(?::[^=]*)?(?:=[\s\S]*)?$/;

function paramNames(text) {
  return splitTopLevel(text)
    .filter((p) => !/^\s*(?:\.\.\.|\{|\[)/.test(p))
    .map((p) => PARAM.exec(p)?.[1])
    .filter((n) => n !== undefined && n !== 'this');
}

/** Function-like ranges in the stripped view: { params, start, end } with start/end the body braces. */
function functionRanges(s) {
  const out = [];
  const add = (paramText, bodyOpen) => {
    if (s[bodyOpen] !== '{') return;
    const end = matchClose(s, bodyOpen, '{', '}');
    out.push({ params: paramNames(paramText), start: bodyOpen, end: end === -1 ? s.length : end });
  };
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '(') continue;
    const close = matchClose(s, i, '(', ')');
    if (close === -1) continue;
    const k = skipSpace(s, close + 1);
    const before = /([A-Za-z_$][\w$]*)\s*$/.exec(s.slice(Math.max(0, i - 80), i))?.[1];
    if (s.startsWith('=>', k)) { add(s.slice(i + 1, close), skipSpace(s, k + 2)); continue; }
    const typed = s[k] === ':' ? /^:[^;{}()=]*?(=>|\{)/.exec(s.slice(k, k + 300)) : null;
    if (typed && typed[1] === '=>') { add(s.slice(i + 1, close), skipSpace(s, k + typed[0].length)); continue; }
    const bodyOpen = typed ? k + typed[0].length - 1 : k;
    if (before && !KEYWORDS.has(before) && s[bodyOpen] === '{') add(s.slice(i + 1, close), bodyOpen);
  }
  for (const m of s.matchAll(/([A-Za-z_$][\w$]*)\s*=>\s*(\{)/g)) add(m[1], m.index + m[0].length - 1);
  return out;
}

function patternsFor(name) {
  const e = name.replace(/\$/g, '\\$');
  const head = `(?<![\\w$.])${e}`;
  return [
    new RegExp(`${head}${MEMBER}+\\s*${ASSIGN}`, 'g'),
    new RegExp(`${head}${MEMBER}+\\s*(?:\\+\\+|--)`, 'g'),
    new RegExp(`(?:\\+\\+|--)\\s*${head}${MEMBER}+`, 'g'),
    new RegExp(`\\bdelete\\s+${head}${MEMBER}`, 'g'),
    new RegExp(`\\bObject\\s*\\.\\s*assign\\s*\\(\\s*${head}\\s*[,)]`, 'g'),
    new RegExp(`${head}(?:\\s*\\.\\s*[\\w$]+)*\\s*\\.\\s*(?:${MUTATING})\\s*\\(`, 'g'),
  ];
}

/** Pure: [{ line, message }] for every in-place change of a plain parameter inside its own function. */
export function inputMutations(stripped) {
  const funcs = functionRanges(stripped);
  const seen = new Set();
  const out = [];
  for (const f of funcs) {
    const body = stripped.slice(f.start + 1, f.end);
    for (const name of f.params) {
      const shadowed = funcs.filter((g) => g !== f && g.start > f.start && g.end < f.end && g.params.includes(name));
      for (const re of patternsFor(name)) {
        for (const m of body.matchAll(re)) {
          const pos = f.start + 1 + m.index;
          if (shadowed.some((g) => pos > g.start && pos < g.end) || seen.has(pos)) continue;
          seen.add(pos);
          out.push({ line: stripped.slice(0, pos).split('\n').length, message: `parameter "${name}" is changed in place; build a new value` });
        }
      }
    }
  }
  return out.sort((a, b) => a.line - b.line);
}
