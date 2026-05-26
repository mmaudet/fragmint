import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { IndexService } from './index-service.js';

async function seedFragment(db: ReturnType<typeof createDb>, id: string, collection: string) {
  await db.insert(fragments).values({
    id,
    type: 'argument',
    domain: 'cloud',
    lang: 'fr',
    quality: 'approved',
    author: 'test',
    title: `Fragment ${id}`,
    body_excerpt: 'excerpt',
    collection_slug: collection,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    file_path: `fragments/${id}.md`,
    origin: 'manual',
    uses: 0,
  });
}

describe('IndexService — collection filtering', () => {
  let db: ReturnType<typeof createDb>;
  let svc: IndexService;

  beforeEach(async () => {
    db = createDb(':memory:');
    svc = new IndexService(db);
    await seedFragment(db, 'frag-col-a-1', 'col-a');
    await seedFragment(db, 'frag-col-a-2', 'col-a');
    await seedFragment(db, 'frag-col-b-1', 'col-b');
  });

  it('returns all approved fragments when no collectionSlug is given', async () => {
    const data = await svc.getData();
    expect(data.total).toBe(3);
  });

  it('returns only fragments from the given collection', async () => {
    const data = await svc.getData(false, 'col-a');
    expect(data.total).toBe(2);
    const ids = Object.values(data.subjects).flatMap((s) =>
      Object.values(s.types).flatMap((frags) => frags.map((f) => f.id)),
    );
    expect(ids).toContain('frag-col-a-1');
    expect(ids).not.toContain('frag-col-b-1');
  });

  it('does not use the in-memory cache when collectionSlug is given', async () => {
    // Warm the global cache first
    await svc.getData();
    // Add a new fragment to col-a
    await seedFragment(db, 'frag-col-a-3', 'col-a');
    // Filtered query bypasses cache → sees new fragment
    const fresh = await svc.getData(false, 'col-a');
    expect(fresh.total).toBe(3);
  });
});
