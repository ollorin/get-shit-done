// Known-bad inputs for sample-guard. Each detect() returns true when the real guard flags the input.
import { hasTab } from '../guards/sample-guard.mjs';

export const CANARIES = [
  { name: 'leading tab', why: 'a tab-indented line is the case the guard exists for', detect: () => hasTab('\tconst x = 1;\n') },
  { name: 'tab inside a line', why: 'a tab after the first column is still a tab', detect: () => hasTab('const x =\t1;\n') },
  { name: 'tab on a CRLF line', why: 'line endings must not hide the tab', detect: () => hasTab('a\r\n\tb\r\n') },
];
