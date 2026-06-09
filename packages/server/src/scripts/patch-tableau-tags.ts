/**
 * One-shot migration: add semantic tags to existing table-row fragments
 * that only have `source:tableau`.
 *
 * Run:  npx tsx packages/server/src/scripts/patch-tableau-tags.ts
 *
 * After running, restart the server so reindex() syncs the new tags into
 * SQLite fragment_tag_links and Milvus (which makes Pool A see them).
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const VAULT_PATH = './example-vault';
const FRAGMENTS_DIR = join(VAULT_PATH, 'fragments');

function deriveExtraTagsFromBody(body: string): string[] {
  const extra: string[] = [];

  const isModule = /\*\*Module\*\*\s*:/.test(body);
  const isRgesn = /Bonnes\s+pratiques.*RGESN|RGESN/i.test(body);
  const isAudit = /\*\*Type\s+d.audit\*\*\s*:|pentest|intrusion|vulnérabilité|accès/i.test(body);
  const isIncidentPhase = /\*\*Phase\*\*\s*:|Détection|Qualification|Notification|Remédiation|Post-mortem/i.test(body);
  const isGtiGtr = /GTI|GTR|Criticité\s+de\s+l.Anomalie/i.test(body);
  const isSlaIndicator = /\*\*Indicateur\*\*\s*:|Taux\s+de\s+disponibilité|Engagement\s*:/i.test(body);

  if (isModule)        extra.push('migration');
  if (isRgesn)         extra.push('rgesn');
  if (isAudit)         extra.push('audit', 'securite');
  if (isIncidentPhase) extra.push('incidents', 'gestion-incidents');
  if (isGtiGtr)        extra.push('gti', 'gtr', 'sla', 'incidents');
  if (isSlaIndicator)  extra.push('sla', 'disponibilité');

  return extra;
}

function patchFile(content: string, newTags: string[]): string {
  const parsed = matter(content);
  parsed.data.tags = newTags;
  return matter.stringify(parsed.content, parsed.data);
}

function walkDir(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((e) =>
    e.isDirectory() ? walkDir(join(dir, e.name)) : [join(dir, e.name)],
  );
}

let patched = 0;
let skipped = 0;

for (const absPath of walkDir(FRAGMENTS_DIR).filter((f) => f.endsWith('.md'))) {
  const content = readFileSync(absPath, 'utf-8');
  const parsed = matter(content);
  const currentTags: string[] = Array.isArray(parsed.data.tags) ? parsed.data.tags as string[] : [];

  if (!currentTags.includes('source:tableau')) { skipped++; continue; }

  const extra = deriveExtraTagsFromBody(parsed.content);
  if (extra.length === 0) { skipped++; continue; }

  const merged = [...new Set([...currentTags, ...extra])];
  if (extra.every((t) => currentTags.includes(t))) { skipped++; continue; }

  writeFileSync(absPath, patchFile(content, merged), 'utf-8');
  console.log(`PATCHED ${absPath.split('/').slice(-1)[0]}  +[${extra.join(', ')}]`);
  patched++;
}

console.log(`\nDone: ${patched} patched, ${skipped} skipped.`);
console.log('Restart the server to trigger reindex() → SQLite + Milvus updated.');
