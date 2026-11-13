'use strict';
// The one definition of a ROADMAP phase checkbox line: `- [x] Phase N`, `- [ ] **Phase N`, zero padding allowed, no text before
// "Phase", and N never a prefix of a longer number (Phase 1 is not Phase 10 or 1.2).
const norm = (n) => String(n).trim().replace(/^0+(?=\d)/, '');
const re = (phaseNum, box) => new RegExp(`^[ \\t]*-[ \\t]*\\[(${box})\\][ \\t]*(?:\\*\\*)?Phase[ \\t]+0*${norm(phaseNum).replace(/\./g, '\\.')}(?!\\d|\\.\\d|[A-Za-z])`, 'im');

// true (ticked) / false (unticked) / null (no line for the phase)
function checkboxState(content, phaseNum) {
  const m = String(content).match(re(phaseNum, 'x| '));
  return m ? m[1].toLowerCase() === 'x' : null;
}

// Tick the phase's own line; the rest of the line is kept, with `suffix` appended.
function tickCheckbox(content, phaseNum, suffix = '') {
  const line = re(phaseNum, ' ');
  const m = content.match(line);
  if (!m) return content;
  const end = content.indexOf('\n', m.index);
  const stop = end === -1 ? content.length : end;
  return `${content.slice(0, m.index)}${m[0].replace('[ ]', '[x]')}${content.slice(m.index + m[0].length, stop)}${suffix}${content.slice(stop)}`;
}

// The phase's details section: from its `##-####` heading (bold, zero padding allowed) to the next phase heading or `## `; null when there is no such heading.
function phaseSection(content, phaseNum) {
  const text = String(content);
  const head = new RegExp(`^#{2,4}[ \\t]*(?:\\*\\*)?Phase[ \\t]+0*${norm(phaseNum).replace(/\./g, '\\.')}(?!\\d|\\.\\d|[A-Za-z])`, 'im').exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const end = rest.search(/^(?:#{2,4}[ \t]*(?:\*\*)?Phase[ \t]|## )/im);
  return text.slice(head.index, end === -1 ? text.length : head.index + head[0].length + end);
}

// `phase add` / `phase insert`: the new phase in all four places a phase lives: details section (after the previous phase's section, before a
// following `## ` heading), checklist line, `Execution Order` arrow chain (bold label or heading) and Progress table row (when each exists).
// `inline` (insert): the checklist line, chain entry and table row go right after `prev`'s own, not at the end.
function addPhase(content, { num, name, entry, prev, inline = false }) {
  let text = String(content);
  const lines = () => text.split('\n');
  const join = (ls) => { text = ls.join('\n'); };
  const section = prev ? phaseSection(text, prev) : null;
  if (section !== null) {
    const at = text.indexOf(section) + section.replace(/\s+$/, '').replace(/\n---$/, '').length;
    text = `${text.slice(0, at)}\n${entry}${text.slice(at)}`;
  } else {
    const sep = text.lastIndexOf('\n---');
    text = sep > 0 ? text.slice(0, sep) + entry + text.slice(sep) : text + entry;
  }
  let ls = lines();
  const prevBox = inline && prev !== null && prev !== undefined ? ls.findIndex((l) => re(prev, 'x| ').test(l)) : -1;
  const box = prevBox >= 0 ? prevBox : ls.reduce((last, l, i) => (/^[ \t]*-[ \t]*\[[ xX]\][ \t]*(?:\*\*)?Phase[ \t]+\d/.test(l) ? i : last), -1);
  if (box >= 0) {
    let end = box;
    while (end + 1 < ls.length && /^[ \t]+\S/.test(ls[end + 1])) end += 1;
    ls.splice(end + 1, 0, /\*\*Phase/.test(ls[box]) ? `- [ ] **Phase ${num}: ${name}**` : `- [ ] Phase ${num}: ${name}`);
  }
  const order = ls.findIndex((l) => /\*\*Execution Order:?\*\*/.test(l) || /^#{1,4}[ \t]*Execution Order\b/i.test(l));
  if (order >= 0) {
    const at = [order, order + 1, order + 2].find((i) => i < ls.length && ls[i].includes('→'));
    if (at !== undefined) {
      const parts = ls[at].replace(/\s+$/, '').split('→');
      const own = inline ? parts.findIndex((p) => new RegExp(`(^|[^\\d.])0*${norm(prev).replace(/\./g, '\\.')}(?!\\d|\\.\\d)`).test(p)) : -1;
      if (own >= 0) parts.splice(own + 1, 0, ` ${num} `);
      else parts.push(` ${num}`);
      ls[at] = parts.map((p, i) => (i === 0 ? p.replace(/\s+$/, '') : p.trim())).join(' → ');
    }
  }
  const progress = ls.findIndex((l) => /^##[ \t]+Progress\b/i.test(l));
  const head = progress >= 0 ? ls.findIndex((l, i) => i > progress && /^\|/.test(l)) : -1;
  if (head >= 0) {
    const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
    let last = head + 1;
    while (last + 1 < ls.length && /^\|/.test(ls[last + 1])) last += 1;
    const own = inline ? ls.findIndex((l, i) => i > head && new RegExp(`^\\|[ \\t]*0*${norm(prev).replace(/\./g, '\\.')}(?!\\d|\\.\\d)`).test(l)) : -1;
    if (own >= 0) last = own;
    const prevRow = last > head + 1 ? cells(ls[last]) : [];
    const row = cells(ls[head]).map((h, i) => (/phase/i.test(h) ? `${num}. ${name}` : /milestone/i.test(h) ? (prevRow[i] || '') : /plans/i.test(h) ? '0/0' : /status/i.test(h) ? 'Not started' : /complet/i.test(h) ? '-' : ''));
    ls.splice(last + 1, 0, `| ${row.join(' | ')} |`);
  }
  join(ls);
  return text;
}

module.exports = { checkboxState, tickCheckbox, phaseSection, addPhase };
