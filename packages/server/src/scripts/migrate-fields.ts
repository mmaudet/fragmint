/**
 * Migration script: translate French domains/tags → English, seed fragment_types and fragment_tags tables.
 *
 * Usage:
 *   tsx packages/server/src/scripts/migrate-fields.ts \
 *     --vault ./example-vault \
 *     [--dry-run] \
 *     [--llm-endpoint http://localhost:11434/v1] \
 *     [--llm-model mistral-nemo:12b]
 *
 * Environment variables: FRAGMINT_LLM_ENDPOINT, FRAGMINT_LLM_MODEL, FRAGMINT_LLM_API_KEY
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/connection.js';
import {
  fragments as fragmentsTable,
  fragmentTypes as fragmentTypesTable,
  fragmentDomains as fragmentDomainsTable,
  fragmentTags as fragmentTagsTable,
} from '../db/schema.js';
import { LlmClient } from '../services/llm-client.js';
import { FRAGMENT_TYPES } from '../schema/fragment.js';
import { GitRepository } from '../git/git-repository.js';

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const vaultArg = argValue('--vault');
if (!vaultArg) {
  console.error(
    'Usage: tsx migrate-fields.ts --vault <path> [--dry-run] [--llm-endpoint <url>] [--llm-model <model>]',
  );
  process.exit(1);
}

const vaultPath = resolve(vaultArg);
const dryRun = args.includes('--dry-run');
const llmEndpoint =
  argValue('--llm-endpoint') ?? process.env.FRAGMINT_LLM_ENDPOINT ?? 'http://localhost:11434/v1';
const llmModel =
  argValue('--llm-model') ?? process.env.FRAGMINT_LLM_MODEL ?? 'mistral-nemo:12b';
const llmApiKey = process.env.FRAGMINT_LLM_API_KEY;

// Fixed type renames (not LLM-dependent — deterministic slug changes)
const TYPE_RENAMES: Record<string, string> = {
  'cas-usage': 'use-case',
  'témoignage': 'testimonial',
  'reference-technique': 'technical-reference',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

async function translateValues(
  values: string[],
  llm: LlmClient,
): Promise<Record<string, string>> {
  if (values.length === 0) return {};

  const prompt = `You are a normalization assistant for a document management system.
These values are used as domain identifiers and content tags. Translate French values to English.

Rules:
- Product/company names (twake, lincloud, linshare, linagora, secnumcloud) → keep as-is
- Standard/certification codes (rgpd, gdpr, nis2, pci-dss, iso27001, sla) → keep as-is
- French words → translate to lowercase English equivalent
- Multi-word translations → use hyphen-separated kebab-case
- Already-English words → keep as-is

Values to normalize: ${JSON.stringify(values)}

Return ONLY a JSON object mapping each original value to its normalized English value.
Example: {"souverainete": "sovereignty", "tarification": "pricing", "lincloud": "lincloud", "legal": "legal"}`;

  try {
    const response = await llm.chatMessages([{ role: 'user', content: prompt }]);
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in response');
    const parsed = JSON.parse(match[0]) as Record<string, string>;
    // Ensure every input has an entry (fall back to original if LLM missed it)
    for (const v of values) {
      if (!(v in parsed)) parsed[v] = v;
    }
    return parsed;
  } catch (e) {
    console.error('[translate] LLM call failed, using identity mapping:', e);
    return Object.fromEntries(values.map((v) => [v, v]));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const fragmentsDir = join(vaultPath, 'fragments');
  const dbPath = join(vaultPath, '.fragmint.db');

  console.log(`Vault: ${vaultPath}`);
  console.log(`Dry run: ${dryRun}`);

  // 1. Collect all fragment files
  const mdFiles = findMdFiles(fragmentsDir);
  console.log(`Found ${mdFiles.length} fragment file(s)`);

  // 2. Parse frontmatter and collect unique domains, tags, and types
  const fileData: Array<{
    path: string;
    id: string;
    type: string;
    domain: string;
    tags: string[];
    raw: string;
    body: string;
    data: Record<string, unknown>;
  }> = [];

  const allDomains = new Set<string>();
  const allTags = new Set<string>();

  for (const filePath of mdFiles) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const { data, content } = matter(raw);
      const id = data['id'] as string;
      const type = (data['type'] as string) ?? '';
      const domain = (data['domain'] as string) ?? '';
      const tags: string[] = Array.isArray(data['tags']) ? (data['tags'] as string[]) : [];
      fileData.push({ path: filePath, id, type, domain, tags, raw, body: content, data });
      if (domain) allDomains.add(domain);
      for (const t of tags) allTags.add(t);
    } catch (e) {
      console.warn(`[skip] ${filePath}: ${e}`);
    }
  }

  const allValues = [...new Set([...allDomains, ...allTags])];
  console.log(
    `Unique domains: ${[...allDomains].join(', ')}\nUnique tags: ${[...allTags].join(', ')}`,
  );

  // 3. One LLM call to translate all values
  console.log('\nCalling LLM to translate values...');
  const llm = new LlmClient({
    endpoint: llmEndpoint,
    model: llmModel,
    temperature: 0.1,
    timeout: 60000,
    apiKey: llmApiKey,
  });

  const mapping = await translateValues(allValues, llm);

  console.log('\nTranslation mapping:');
  for (const [orig, translated] of Object.entries(mapping)) {
    const changed = orig !== translated;
    console.log(`  ${changed ? '→' : ' '} ${orig} → ${translated}`);
  }

  console.log('\nType renames (deterministic, no LLM needed):');
  for (const [orig, renamed] of Object.entries(TYPE_RENAMES)) {
    console.log(`  → ${orig} → ${renamed}`);
  }

  if (dryRun) {
    console.log('\nDry run — no files modified.');
    return;
  }

  // 4. Apply mapping + type renames to fragment files
  const changedPaths: string[] = [];
  for (const f of fileData) {
    const newType = TYPE_RENAMES[f.type] ?? f.type;
    const newDomain = mapping[f.domain] ?? f.domain;
    const newTags = f.tags.map((t) => mapping[t] ?? t);
    const typeChanged = newType !== f.type;
    const domainChanged = newDomain !== f.domain;
    const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(f.tags);
    if (!typeChanged && !domainChanged && !tagsChanged) continue;

    const newData = { ...f.data, type: newType, domain: newDomain, tags: newTags };
    const updated = matter.stringify(f.body, newData as Record<string, unknown>);
    writeFileSync(f.path, updated, 'utf-8');
    changedPaths.push(f.path);
  }

  console.log(`\nUpdated ${changedPaths.length} file(s)`);

  // 5. Git commit all changes in the vault
  if (changedPaths.length > 0) {
    const git = new GitRepository(vaultPath);
    const hash = await git.commitFiles(
      changedPaths,
      'chore: migrate types, domains and tags to English',
    );
    console.log(`Git commit: ${hash || '(nothing to commit)'}`);
  }

  // 6. Update DB
  const db = createDb(dbPath);
  const dbFragments = await db
    .select({ id: fragmentsTable.id, type: fragmentsTable.type, domain: fragmentsTable.domain, tags: fragmentsTable.tags })
    .from(fragmentsTable);

  let dbUpdated = 0;
  for (const row of dbFragments) {
    const newType = TYPE_RENAMES[row.type] ?? row.type;
    const newDomain = mapping[row.domain] ?? row.domain;
    const oldTags: string[] = row.tags ? (JSON.parse(row.tags) as string[]) : [];
    const newTags = oldTags.map((t) => mapping[t] ?? t);
    const typeChanged = newType !== row.type;
    const domainChanged = newDomain !== row.domain;
    const tagsChanged = JSON.stringify(newTags) !== row.tags;
    if (!typeChanged && !domainChanged && !tagsChanged) continue;

    await db
      .update(fragmentsTable)
      .set({ type: newType, domain: newDomain, tags: JSON.stringify(newTags) })
      .where(eq(fragmentsTable.id, row.id));
    dbUpdated++;
  }
  console.log(`DB: updated ${dbUpdated} row(s)`);

  // 7. Seed fragment_types table
  const now = new Date().toISOString();
  for (const slug of FRAGMENT_TYPES) {
    await db.insert(fragmentTypesTable).values({ slug, label: slug, created_at: now }).onConflictDoNothing();
  }
  console.log(`fragment_types: seeded ${FRAGMENT_TYPES.length} type(s)`);

  // 7b. Seed fragment_domains from translated domains
  const translatedDomains = new Set([...allDomains].map((d) => mapping[d] ?? d));
  for (const slug of translatedDomains) {
    await db.insert(fragmentDomainsTable).values({ slug, label: slug, created_at: now }).onConflictDoNothing();
  }
  console.log(`fragment_domains: seeded ${translatedDomains.size} domain(s)`);

  // 8. Seed fragment_tags table from all translated tags
  const translatedTags = new Set([...allTags].map((t) => mapping[t] ?? t));
  for (const slug of translatedTags) {
    await db
      .insert(fragmentTagsTable)
      .values({ slug, label: slug, created_at: now })
      .onConflictDoNothing();
  }
  console.log(`fragment_tags: seeded ${translatedTags.size} tag(s)`);

  console.log('\nMigration complete.');
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
