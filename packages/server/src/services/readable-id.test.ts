import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { generateReadableId } from './readable-id.js';

describe('generateReadableId', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('génère LS-ref-001 pour le premier fragment linshare/reference', async () => {
    const id = await generateReadableId(db, 'linshare', 'reference');
    expect(id).toBe('LS-ref-001');
  });

  it('génère LS-ref-002 si LS-ref-001 existe déjà', async () => {
    await db.insert(fragments).values({
      id: 'frag-test',
      type: 'reference',
      domain: 'linshare',
      lang: 'fr',
      quality: 'draft',
      author: 'test',
      title: 'Test',
      body_excerpt: '',
      collection_slug: 'common',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      file_path: 'test.md',
      origin: 'manual',
      uses: 0,
      readable_id: 'LS-ref-001',
    });
    const id = await generateReadableId(db, 'linshare', 'reference');
    expect(id).toBe('LS-ref-002');
  });

  it('utilise un préfixe de 3 chars uppercase pour domaine inconnu', async () => {
    const id = await generateReadableId(db, 'my-custom-domain', 'argument');
    expect(id).toBe('MYC-arg-001');
  });

  it('génère indépendamment par (domain, type)', async () => {
    const id1 = await generateReadableId(db, 'linshare', 'reference');
    const id2 = await generateReadableId(db, 'linshare', 'argument');
    expect(id1).toBe('LS-ref-001');
    expect(id2).toBe('LS-arg-001');
  });
});
