// Guard registry: the single list of machine-enforced guards of this project. canary-gate.mjs loads
// canaries/<id>.canaries.mjs for every id; guard-registry-reconcile.mjs diffs these rows against the table in
// docs/gsd/guard-estate.md. Each string must equal its cell of that table (no `|`, no line break).
// Row: { id, guard, prevents, implementedIn }; id is a lower-case slug and is the corpus file name; implementedIn is a
// repository path.

export const GUARD_REGISTRY = [
  {
    id: 'sample-guard',
    guard: 'No tab character in a checked file',
    prevents: 'Mixed tab and space indentation reaching review',
    implementedIn: 'scripts/validation/guards/sample-guard.mjs',
  },
  {
    id: 'style-gate',
    guard: 'Style ratchet: no new throw, input mutation, oversize file or duplicated block',
    prevents: 'Error-by-exception, in-place mutation, god files and copied logic reaching review',
    implementedIn: 'scripts/style-gate.mjs',
  },
];

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const FIELDS = ['id', 'guard', 'prevents', 'implementedIn'];

// Problems of a registry value, as strings; an empty array means well formed. A duplicate id is a problem.
export function validateRegistry(rows) {
  if (!Array.isArray(rows)) return ['GUARD_REGISTRY is not an array'];
  const problems = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    if (row === null || typeof row !== 'object') return problems.push(`row ${i} is not an object`);
    for (const f of FIELDS) {
      if (typeof row[f] !== 'string' || row[f].trim() === '') problems.push(`row ${i} (${row.id}): ${f} must be a non-empty string`);
      else if (/[|\r\n]/.test(row[f])) problems.push(`row ${i} (${row.id}): ${f} must not contain | or a line break`);
    }
    if (typeof row.id === 'string' && !ID_RE.test(row.id)) problems.push(`row ${i}: id ${JSON.stringify(row.id)} is not a lower-case slug`);
    if (seen.has(row.id)) problems.push(`duplicate id ${row.id}`);
    seen.add(row.id);
  });
  return problems;
}
