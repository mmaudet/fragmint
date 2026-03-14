// packages/server/src/search/embedding-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingClient } from './embedding-client.js';

describe('EmbeddingClient', () => {
  let client: EmbeddingClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new EmbeddingClient('http://localhost:11434/v1', 'nomic-embed-text-v1', 768);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('embed() sends correct request and returns vector', async () => {
    const mockVector = Array.from({ length: 768 }, (_, i) => i * 0.001);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: mockVector }] }),
    });

    const result = await client.embed('hello world');
    expect(result).toEqual(mockVector);
    expect(result.length).toBe(768);

    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://localhost:11434/v1/embeddings');
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('nomic-embed-text-v1');
    expect(body.input).toEqual(['hello world']);
  });

  it('embedBatch() splits into batches', async () => {
    const mockVector = Array.from({ length: 768 }, () => 0.1);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: mockVector }, { embedding: mockVector }] }),
    });

    const texts = ['a', 'b', 'c', 'd', 'e'];
    const results = await client.embedBatch(texts, 2);
    expect(results.length).toBe(5);
    // 5 texts with batch size 2 = 3 fetch calls (2+2+1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('embed() throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(client.embed('test')).rejects.toThrow('Embedding API error: 500');
  });

  it('embed() throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(client.embed('test')).rejects.toThrow('ECONNREFUSED');
  });

  it('ping() returns ok and latency', async () => {
    const mockVector = Array.from({ length: 768 }, () => 0);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: mockVector }] }),
    });

    const result = await client.ping();
    expect(result.ok).toBe(true);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('ping() returns not ok on failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));

    const result = await client.ping();
    expect(result.ok).toBe(false);
  });
});
