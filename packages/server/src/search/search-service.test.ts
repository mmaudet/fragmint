// packages/server/src/search/search-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService, reRankResults, type SearchResult } from './search-service.js';
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
    expect(embedding.embed).toHaveBeenCalledWith('search_query: sovereignty');
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

  describe('valid_at temporal filtering', () => {
    beforeEach(async () => {
      // Add fragments with temporal bounds
      await db.insert(fragments).values({
        id: 'frag-future-1', type: 'argument', domain: 'test', lang: 'fr',
        quality: 'approved', author: 'test', title: 'Future fragment',
        body_excerpt: 'This fragment is not yet valid for searching.',
        created_at: '2026-03-14', updated_at: '2026-03-14',
        file_path: 'fragments/test/argument-future-fr-00000001.md',
        origin: 'manual', uses: 0,
        valid_from: '2030-01-01', valid_until: null,
      });
      await db.insert(fragments).values({
        id: 'frag-expired-1', type: 'argument', domain: 'test', lang: 'fr',
        quality: 'approved', author: 'test', title: 'Expired fragment',
        body_excerpt: 'This fragment has expired and should not appear.',
        created_at: '2026-03-14', updated_at: '2026-03-14',
        file_path: 'fragments/test/argument-expired-fr-00000001.md',
        origin: 'manual', uses: 0,
        valid_from: '2020-01-01', valid_until: '2025-01-01',
      });
      await db.insert(fragments).values({
        id: 'frag-current-1', type: 'argument', domain: 'test', lang: 'fr',
        quality: 'approved', author: 'test', title: 'Current fragment',
        body_excerpt: 'This fragment is currently valid for testing.',
        created_at: '2026-03-14', updated_at: '2026-03-14',
        file_path: 'fragments/test/argument-current-fr-00000001.md',
        origin: 'manual', uses: 0,
        valid_from: '2026-01-01', valid_until: '2027-12-31',
      });
    });

    it('search() with valid_at excludes not-yet-valid fragments', async () => {
      const embedding = mockEmbeddingClient();
      const service = new SearchService(db, embedding as any, null);

      const results = await service.search('fragment', { valid_at: '2026-06-15' });
      const ids = results.map(r => r.id);
      expect(ids).not.toContain('frag-future-1');
      expect(ids).toContain('frag-current-1');
    });

    it('search() with valid_at excludes expired fragments', async () => {
      const embedding = mockEmbeddingClient();
      const service = new SearchService(db, embedding as any, null);

      const results = await service.search('fragment', { valid_at: '2026-06-15' });
      const ids = results.map(r => r.id);
      expect(ids).not.toContain('frag-expired-1');
    });

    it('search() without valid_at returns all fragments (backward compat)', async () => {
      const embedding = mockEmbeddingClient();
      const service = new SearchService(db, embedding as any, null);

      const results = await service.search('fragment');
      const ids = results.map(r => r.id);
      expect(ids).toContain('frag-future-1');
      expect(ids).toContain('frag-expired-1');
      expect(ids).toContain('frag-current-1');
    });
  });
});

describe('reRankResults', () => {
  function makeResult(overrides: Partial<SearchResult>): SearchResult {
    return {
      id: 'frag-1',
      score: 1.0,
      title: 'Test',
      body_excerpt: 'body',
      type: 'argument',
      domain: 'test',
      lang: 'fr',
      quality: 'approved',
      author: 'test',
      uses: 0,
      updated_at: '2025-01-01',
      ...overrides,
    };
  }

  it('boosts approved fragments over drafts', () => {
    const results = [
      makeResult({ id: 'draft', quality: 'draft', score: 1.0 }),
      makeResult({ id: 'approved', quality: 'approved', score: 1.0 }),
    ];
    const ranked = reRankResults(results);
    expect(ranked[0].id).toBe('approved');
    expect(ranked[1].id).toBe('draft');
    // approved keeps score * 1.0, draft gets score * 0.80
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('boosts recently updated fragments', () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const results = [
      makeResult({ id: 'old', updated_at: oneYearAgo, score: 1.0 }),
      makeResult({ id: 'fresh', updated_at: threeDaysAgo, score: 1.0 }),
    ];
    const ranked = reRankResults(results);
    expect(ranked[0].id).toBe('fresh');
    // fresh gets +0.05, old gets no freshness boost
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('boosts high-usage fragments', () => {
    const results = [
      makeResult({ id: 'low-use', uses: 0, score: 1.0 }),
      makeResult({ id: 'high-use', uses: 15, score: 1.0 }),
    ];
    const ranked = reRankResults(results);
    expect(ranked[0].id).toBe('high-use');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('preserves order when all fragments have same quality/age/usage', () => {
    const now = new Date().toISOString();
    const results = [
      makeResult({ id: 'a', score: 0.9, quality: 'approved', uses: 0, updated_at: now }),
      makeResult({ id: 'b', score: 0.8, quality: 'approved', uses: 0, updated_at: now }),
      makeResult({ id: 'c', score: 0.7, quality: 'approved', uses: 0, updated_at: now }),
    ];
    const ranked = reRankResults(results);
    expect(ranked[0].id).toBe('a');
    expect(ranked[1].id).toBe('b');
    expect(ranked[2].id).toBe('c');
  });
});
