#!/usr/bin/env tsx
// packages/server/src/scripts/migrate-readable-ids.ts
// Usage: npx tsx packages/server/src/scripts/migrate-readable-ids.ts
// Assigne un readable_id à tous les fragments qui n'en ont pas encore.
// Idempotent : ne modifie pas les fragments qui ont déjà un readable_id.

import { isNull, eq } from 'drizzle-orm';
import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { generateReadableId } from '../services/readable-id.js';

const DB_PATH = process.env.FRAGMINT_DB_PATH ?? '/data/vault/.fragmint.db';

const db = createDb(DB_PATH);

// Récupérer tous les fragments sans readable_id
const toMigrate = await db
  .select({ id: fragments.id, domain: fragments.domain, type: fragments.type })
  .from(fragments)
  .where(isNull(fragments.readable_id));

console.log(`Found ${toMigrate.length} fragments without readable_id`);

let count = 0;
for (const frag of toMigrate) {
  const readableId = await generateReadableId(db, frag.domain, frag.type);
  await db
    .update(fragments)
    .set({ readable_id: readableId })
    .where(eq(fragments.id, frag.id));
  count++;
  if (count % 50 === 0) console.log(`  Migrated ${count}/${toMigrate.length}...`);
}

console.log(`Done. Migrated ${count} fragments.`);
