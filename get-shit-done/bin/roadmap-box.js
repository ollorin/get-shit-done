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

module.exports = { checkboxState, tickCheckbox };
