// scripts/migrate-entities-to-tags.ts
// Run once to migrate entity data into the tags system.
// Idempotent — safe to run multiple times.
// Usage: npx tsx scripts/migrate-entities-to-tags.ts
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load better-sqlite3 from server package (not hoisted to monorepo root)
const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRequire = createRequire(resolve(__dirname, '../packages/server/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = serverRequire('better-sqlite3');

const DB_PATH = process.env.FRAGMINT_DB_PATH ?? join(process.cwd(), '.fragmint.db');
if (!existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}. Set FRAGMINT_DB_PATH env var.`);
  process.exit(1);
}

const db = new Database(DB_PATH);

// Entity type (singular) → tag prefix
const TYPE_PREFIX: Record<string, string> = {
  client: 'client',
  product: 'produit',
  technology: 'tech',
  partner: 'partner',
  certification: 'cert',
  regulation: 'reg',
};

// entities_json bucket (plural) → tag prefix
const BUCKET_PREFIX: Record<string, string> = {
  clients: 'client',
  products: 'produit',
  technologies: 'tech',
  partners: 'partner',
  certifications: 'cert',
  regulations: 'reg',
};

function normalize(name: string): string {
  return name
    .replace(/^NEW:/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tagSlug(prefix: string, name: string): string {
  return `${prefix}:${normalize(name)}`;
}

const now = new Date().toISOString();

let tagsMigrated = 0;
let linksMigrated = 0;
let candidatesMigrated = 0;

const migrate = db.transaction(() => {
  // ── 1. Migrate entities table → fragment_tags ──────────────────────────────
  const entities = db.prepare("SELECT * FROM entities WHERE status != ?").all('rejected') as any[];
  for (const ent of entities) {
    const prefix = TYPE_PREFIX[ent.type] ?? ent.type;
    const slug = tagSlug(prefix, ent.canonical_name ?? ent.name);
    const label = ent.canonical_name ?? ent.name;
    const isValidated = ent.validated === 1 ? 1 : 0;
    const status = isValidated ? 'active' : 'pending';
    const existing = db.prepare('SELECT slug FROM fragment_tags WHERE slug = ?').get(slug);
    if (!existing) {
      db.prepare(
        `INSERT INTO fragment_tags (slug, label, category, created_at, validated, proposed_by, trust_source, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(slug, label, prefix, ent.created_at ?? now, isValidated, ent.proposed_by ?? 'migration', ent.trust_source ?? 'human-direct', status);
      tagsMigrated++;
    }
  }

  // ── 2. Migrate fragment_entities → fragment_tag_links ─────────────────────
  const feRows = db.prepare(
    'SELECT fe.fragment_id, e.type, e.canonical_name, e.name FROM fragment_entities fe JOIN entities e ON e.id = fe.entity_id'
  ).all() as any[];
  for (const row of feRows) {
    const prefix = TYPE_PREFIX[row.type] ?? row.type;
    const slug = tagSlug(prefix, row.canonical_name ?? row.name);
    const existing = db.prepare(
      'SELECT 1 FROM fragment_tag_links WHERE fragment_id = ? AND tag_slug = ?'
    ).get(row.fragment_id, slug);
    if (!existing) {
      db.prepare('INSERT OR IGNORE INTO fragment_tag_links (fragment_id, tag_slug) VALUES (?, ?)').run(row.fragment_id, slug);
      linksMigrated++;
    }
    // Also patch the JSON tags column on the fragment
    const frag = db.prepare('SELECT tags FROM fragments WHERE id = ?').get(row.fragment_id) as any;
    if (frag) {
      let tags: string[] = [];
      try { tags = JSON.parse(frag.tags ?? '[]'); } catch { tags = []; }
      if (!tags.includes(slug)) {
        tags.push(slug);
        db.prepare('UPDATE fragments SET tags = ? WHERE id = ?').run(JSON.stringify(tags), row.fragment_id);
      }
    }
  }

  // ── 3. Migrate harvest_candidates entities_json → tags ────────────────────
  const candidates = db.prepare(
    "SELECT id, entities_json, tags FROM harvest_candidates WHERE entities_json IS NOT NULL AND entities_json != ?"
  ).all('{}') as any[];
  for (const cand of candidates) {
    let entMap: Record<string, string[]>;
    try { entMap = JSON.parse(cand.entities_json); } catch { continue; }
    let existingTags: string[] = [];
    try { existingTags = JSON.parse(cand.tags ?? '[]'); } catch { existingTags = []; }
    const added: string[] = [];
    for (const [bucket, names] of Object.entries(entMap)) {
      const prefix = BUCKET_PREFIX[bucket] ?? bucket.replace(/s$/, '');
      for (const name of names as string[]) {
        if (!name?.trim()) continue;
        const slug = tagSlug(prefix, name);
        if (!existingTags.includes(slug) && !added.includes(slug)) added.push(slug);
      }
    }
    if (added.length > 0) {
      const newTags = [...existingTags, ...added];
      db.prepare('UPDATE harvest_candidates SET tags = ? WHERE id = ?').run(JSON.stringify(newTags), cand.id);
      candidatesMigrated++;
    }
  }
});

migrate();

console.log(`entities → fragment_tags: ${tagsMigrated} new tags`);
console.log(`fragment_entities → fragment_tag_links: ${linksMigrated} new links`);
console.log(`harvest_candidates entities_json → tags: ${candidatesMigrated} candidates updated`);
console.log('Migration complete.');
db.close();
