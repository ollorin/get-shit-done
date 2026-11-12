#!/usr/bin/env node
// freshness-tracker: warns about documentation that is older than the code it describes. A doc is stale when the last commit on
// its related code is newer than the last commit on the doc. WARN ONLY: it always exits 0 (a usage error exits 1).
// Mappings come from flags, so a project names its own layout (the examples are placeholders):
//   --map '<doc glob>=<code glob>,<code glob>'          e.g. --map 'docs/api/**=src/api/**,src/shared/**'
//   --tag-map '<doc glob>#<tag>=<code glob>,<code glob>' adds code globs when the doc's front matter lists the tag, e.g.
//                                                         --tag-map 'docs/api/**#billing=src/billing/**'
// The most specific (longest) doc glob wins; a doc with no mapping is skipped. Front matter is the leading `---` block; only the
// key `tags` is read (inline `[a, b]` or a `- a` block). Files: positional .md paths, or every tracked docs/**/*.md.
// Usage: node scripts/validation/freshness-tracker.mjs [--map ...] [--tag-map ...] [doc.md ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Pure. The doc glob as an anchored-at-start regular expression: ** crosses directories, * stays inside one.
export function matchesGlob(pattern, p) {
  const re = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${re}`).test(p);
}

// Pure. The mapping for a doc: most specific (longest) doc glob first.
export function findMapping(mappings, docPath) {
  return [...mappings].sort((a, b) => b.docPattern.length - a.docPattern.length).find((m) => matchesGlob(m.docPattern, docPath)) ?? null;
}

// Pure. The `tags` of a leading `---` front-matter block; anything unreadable yields no tags.
export function readFrontmatterTags(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const at = lines.findIndex((l) => /^tags\s*:/.test(l));
  if (at < 0) return [];
  const inline = lines[at].replace(/^tags\s*:\s*/, '').trim();
  const unquote = (t) => t.trim().replace(/^["']|["']$/g, '');
  if (inline.startsWith('[')) return inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  const tags = [];
  for (const l of lines.slice(at + 1)) {
    const item = l.match(/^\s+-\s+(.*)$/);
    if (!item) break;
    tags.push(unquote(item[1]));
  }
  return tags;
}

// Pure. The code globs for a doc: the mapping's, plus its tag mappings for the doc's tags, deduplicated.
export function codePatternsFor(mapping, tags) {
  const extra = tags.flatMap((t) => mapping.tagMappings?.[t.toLowerCase()] ?? []);
  return [...new Set([...mapping.codePatterns, ...extra])];
}

// Pure. The stale result, or null when the doc is at least as new as its code or either history is unknown.
export function staleResult(docPath, codePatterns, codeChange, docUpdate) {
  if (!codeChange || !docUpdate || !(codeChange.date > docUpdate.date)) return null;
  const staleByDays = Math.floor((codeChange.date.getTime() - docUpdate.date.getTime()) / 86400000);
  return { docPath, codePatterns, lastCodeChange: codeChange, lastDocUpdate: docUpdate, staleByDays };
}

export function parseMapFlags(argv) {
  const mappings = [];
  const docs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--map' || arg === '--tag-map') {
      const value = argv[i + 1];
      i += 1;
      const eq = value === undefined ? -1 : value.indexOf('=');
      if (eq < 1 || eq === value.length - 1) return { error: `${arg} needs '<doc glob>=<code glob>,...'` };
      const codes = value.slice(eq + 1).split(',').filter(Boolean);
      if (arg === '--map') {
        mappings.push({ docPattern: value.slice(0, eq), codePatterns: codes, tagMappings: {} });
      } else {
        const [docPattern, tag] = value.slice(0, eq).split('#');
        if (!tag) return { error: "--tag-map needs '<doc glob>#<tag>=<code glob>,...'" };
        let m = mappings.find((x) => x.docPattern === docPattern);
        if (!m) { m = { docPattern, codePatterns: [], tagMappings: {} }; mappings.push(m); }
        m.tagMappings[tag.toLowerCase()] = codes;
      }
    } else if (arg.startsWith('-')) return { error: `unknown argument ${arg}` };
    else if (arg.endsWith('.md')) docs.push(arg);
  }
  return { mappings, docs };
}

function lastChange(patterns) {
  const r = spawnSync('git', ['log', '-1', '--format=%H %aI', '--', ...patterns], { encoding: 'utf8' });
  const out = r.status === 0 ? r.stdout.trim() : '';
  const sp = out.indexOf(' ');
  return sp < 0 ? null : { commit: out.slice(0, sp), date: new Date(out.slice(sp + 1)) };
}

function trackedDocs() {
  const r = spawnSync('git', ['ls-files', 'docs/*.md', 'docs/**/*.md'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n').filter((p) => p.trim()) : [];
}

function main(argv) {
  const parsed = parseMapFlags(argv);
  if (parsed.error) {
    console.error(`freshness-tracker: ${parsed.error}`);
    return 1;
  }
  const docs = parsed.docs.length > 0 ? parsed.docs : trackedDocs();
  if (docs.length === 0) {
    console.log('No documentation files found.');
    return 0;
  }
  if (parsed.mappings.length === 0) console.log('No --map given: no document has a code mapping, nothing can be stale.');
  console.log(`Checking freshness of ${docs.length} document(s)...\n`);
  const stale = docs.flatMap((docPath) => {
    const mapping = findMapping(parsed.mappings, docPath);
    if (!mapping) return [];
    let tags = [];
    try { tags = readFrontmatterTags(fs.readFileSync(docPath, 'utf8')); } catch { tags = []; }
    const patterns = codePatternsFor(mapping, tags);
    const result = staleResult(docPath, patterns, lastChange(patterns), lastChange([docPath]));
    return result ? [result] : [];
  });
  if (stale.length === 0) {
    console.log('All documents are fresh.');
    return 0;
  }
  console.log(`Found ${stale.length} stale document(s):\n`);
  for (const r of stale) {
    const more = r.codePatterns.length > 2 ? ` +${r.codePatterns.length - 2} more` : '';
    console.log(`  ${r.docPath} stale (${r.codePatterns.slice(0, 2).join(', ')}${more} changed ${r.staleByDays} days ago, commit ${r.lastCodeChange.commit.slice(0, 7)})`);
  }
  console.log('\nNote: freshness warnings are advisory only. Review and update if needed.');
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
