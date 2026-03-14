// packages/server/src/search/search-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from './search-service.js';
import { createDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';

function mockEmbeddingClient() {
  return {
    embed: vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.1)),
    embedBatch: vi.fn().mockResolvedValue([Array.from({ length: 768 }, () => 0.1)]),
    ping: vi.fn().mockResolvedValue({ ok: true, latency_ms: 10 }),
  };
}

function mockMilvusClient() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([{ id: 'frag-test-1', score: 0.95 }]),
    delete: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(true),
    ensureCollection: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SearchService', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(async () => {
    db = createDb(':memory:');
    // Seed a fragment for SQLite fallback tests
    await db.insert(fragments).values({
      id: 'frag-test-1', type: 'argument', domain: 'test', lang: 'fr',
      quality: 'approved', author: 'test', title: 'Test argument',
      body_excerpt: 'This is a test argument about sovereignty.',
      created_at: '2026-03-14', updated_at: '2026-03-14',
      file_path: 'fragments/test/argument-test-fr-00000001.md',
      origin: 'manual', uses: 5,
    });
  });

  it('search() uses Milvus when client is available', async () => {
    const embedding = mockEmbeddingClient();
    const milvus = mockMilvusClient();
    const service = new SearchService(db, embedding as any, milvus as any);

    const results = await service.search('sovereignty');
    expect(embedding.embed).toHaveBeenCalledWith('sovereignty');
    expect(milvus.search).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('frag-test-1');
  });

  it('search() falls back to SQLite when milvusClient is null', async () => {
    const embedding = mockEmbeddingClient();
    const service = new SearchService(db, embedding as any, null);

    const results = await service.search('test');
    // Should still find the fragment via SQLite LIKE
    expect(results.length).toBeGreaterThan(0);
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('search() falls back to SQLite when Milvus throws', async () => {
    const embedding = mockEmbeddingClient();
    const milvus = mockMilvusClient();
    milvus.search.mockRejectedValue(new Error('Milvus down'));
    const service = new SearchService(db, embedding as any, milvus as any);

    const results = await service.search('test');
    expect(results.length).toBeGreaterThan(0); // fallback worked
  });

  it('indexFragment() calls embed + upsert', async () => {
    const embedding = mockEmbeddingClient();
    const milvus = mockMilvusClient();
    const service = new SearchService(db, embedding as any, milvus as any);

    await service.indexFragment('frag-test-1', 'some body text', {
      type: 'argument', domain: 'test', lang: 'fr', quality: 'approved',
      author: 'test', tags: [], access_read: ['*'],
      created_at: '2026-03-14', updated_at: '2026-03-14',
    });

    expect(embedding.embed).toHaveBeenCalled();
    expect(milvus.upsert).toHaveBeenCalled();
  });

  it('indexFragment() does not throw when embedding fails', async () => {
    const embedding = mockEmbeddingClient();
    embedding.embed.mockRejectedValue(new Error('Ollama down'));
    const milvus = mockMilvusClient();
    const service = new SearchService(db, embedding as any, milvus as any);

    // Should not throw — just log warning
    await expect(service.indexFragment('frag-test-1', 'body', {
      type: 'argument', domain: 'test', lang: 'fr', quality: 'approved',
      author: 'test', tags: [], access_read: ['*'],
      created_at: '2026-03-14', updated_at: '2026-03-14',
    })).resolves.not.toThrow();
  });

  it('status() reports milvus mode when client available', async () => {
    const embedding = mockEmbeddingClient();
    const milvus = mockMilvusClient();
    const service = new SearchService(db, embedding as any, milvus as any);

    const status = await service.status();
    expect(status.mode).toBe('milvus');
    expect(status.milvus).toBe(true);
  });

  it('status() reports sqlite mode when no milvus client', async () => {
    const embedding = mockEmbeddingClient();
    const service = new SearchService(db, embedding as any, null);

    const status = await service.status();
    expect(status.mode).toBe('sqlite');
    expect(status.milvus).toBe(false);
  });
});
