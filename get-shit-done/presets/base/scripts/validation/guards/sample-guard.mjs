// Sample guard: flags a file that contains a tab character. A model for a new guard: a pure decision function,
// a CLI around it, a registry row (guard-registry.mjs), a corpus (canaries/sample-guard.canaries.mjs), a doc row.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const hasTab = (text) => text.includes('\t');

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flagged = process.argv.slice(2).filter((file) => hasTab(fs.readFileSync(file, 'utf8')));
  for (const file of flagged) console.error(`sample-guard: tab character in ${file}`);
  process.exit(flagged.length === 0 ? 0 : 1);
}
