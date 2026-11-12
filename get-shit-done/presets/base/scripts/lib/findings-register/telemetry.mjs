// Findings register: the source ids found in the unit files, and the resolution telemetry of a check.
// A telemetry is { checkName, resolvedCount, totalCount, unresolvedItems: [{ name, reason, location: { file, line } }] }.

// Bullet prose ("- K1-C3-1 was corrected") and disposition notes about a merged draft ("**X2-C9-1 dedupe with X1-C1-1") are not
// finding headers, so they are not sources.
const SOURCE_ID_RE = /^[\s#*|`]*([A-Z][A-Za-z0-9]{0,4}-[A-Za-z]{1,4}\d*-\d+[a-z]?)(?![A-Za-z0-9-])(?!\*{0,2}\s+(?:dedupe|duplicate|dropped|retracted|reclassified|corrected)\b)/;

export const stripHtmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));

// totalCount is counted from unit-file lines, never from the rows the register emitted.
export const listSourceIds = (units) => [...units]
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((u) => stripHtmlComments(u.text).split(/\r?\n/).flatMap((line, i) => {
    const hit = line.match(SOURCE_ID_RE);
    return hit ? [{ id: hit[1], file: u.name, line: i + 1 }] : [];
  }));

export const countSourceIds = (units) => listSourceIds(units).length;

export const buildTelemetry = (sources, resolved) => ({
  checkName: 'findings-register',
  resolvedCount: sources.filter((s) => resolved.has(s.id)).length,
  totalCount: sources.length,
  unresolvedItems: sources.filter((s) => !resolved.has(s.id)).map((s) => ({
    name: s.id,
    reason: 'no register row in the raw register or the extras',
    location: { file: s.file, line: s.line },
  })),
});
