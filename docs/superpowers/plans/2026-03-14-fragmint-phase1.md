# Fragmint Phase 1 — Semantic Indexing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Milvus vector search and embedding pipeline to Fragmint, with automatic SQLite fallback.

**Architecture:** A new `search/` module contains EmbeddingClient (HTTP calls to Ollama), MilvusClient (SDK wrapper), and SearchService (orchestration + fallback). FragmentService delegates search/indexation to SearchService. Config is extended with embedding/milvus fields.

**Tech Stack:** `@zilliz/milvus2-sdk-node`, Ollama `/v1/embeddings` API, `nomic-embed-text-v1` (768d)

**Spec:** `docs/superpowers/specs/2026-03-14-fragmint-phase1-design.md`

---

## Chunk 1: Config, Embedding Client, Milvus Client

### Task 1: Extend configuration

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/package.json` (add `@zilliz/milvus2-sdk-node`)

- [ ] **Step 1: Add Milvus SDK dependency**

Add `"@zilliz/milvus2-sdk-node": "^2.5.0"` to `packages/server/package.json` dependencies, then run `pnpm install`.

- [ ] **Step 2: Extend FragmintConfig interface and loadConfig**

In `packages/server/src/config.ts`, add these fields to the `FragmintConfig` interface:

```typescript
  // Embedding
  embedding_endpoint: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_batch_size: number;

  // Milvus
  milvus_address: string;
  milvus_collection: string;
  milvus_enabled: boolean;
```

In the `loadConfig` return object, add these defaults:

```typescript
    embedding_endpoint: process.env.FRAGMINT_EMBEDDING_ENDPOINT ?? fileConfig.embedding_endpoint ?? 'http://localhost:11434/v1',
    embedding_model: process.env.FRAGMINT_EMBEDDING_MODEL ?? fileConfig.embedding_model ?? 'nomic-embed-text-v1',
    embedding_dimensions: toNumber(process.env.FRAGMINT_EMBEDDING_DIMENSIONS) ?? fileConfig.embedding_dimensions ?? 768,
    embedding_batch_size: toNumber(process.env.FRAGMINT_EMBEDDING_BATCH_SIZE) ?? fileConfig.embedding_batch_size ?? 32,
    milvus_address: process.env.FRAGMINT_MILVUS_ADDRESS ?? fileConfig.milvus_address ?? 'localhost:19530',
    milvus_collection: process.env.FRAGMINT_MILVUS_COLLECTION ?? fileConfig.milvus_collection ?? 'fragmint_fragments',
    milvus_enabled: process.env.FRAGMINT_MILVUS_ENABLED === 'true' || fileConfig.milvus_enabled === true,
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/config.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(config): add embedding and Milvus configuration fields"
```

---

### Task 2: Embedding Client

**Files:**
- Create: `packages/server/src/search/embedding-client.ts`
- Test: `packages/server/src/search/embedding-client.test.ts`

- [ ] **Step 1: Write embedding client tests**

```typescript
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
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm vitest run --project server`
Expected: FAIL — module not found

- [ ] **Step 3: Implement embedding-client.ts**

```typescript
// packages/server/src/search/embedding-client.ts

export class EmbeddingClient {
  private readonly url: string;

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly dimensions: number,
  ) {
    this.url = `${endpoint.replace(/\/$/, '')}/embeddings`;
  }

  async embed(text: string): Promise<number[]> {
    const vectors = await this.callApi([text]);
    return vectors[0];
  }

  async embedBatch(texts: string[], batchSize = 32): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await this.callApi(batch);
      results.push(...vectors);
    }
    return results;
  }

  async ping(): Promise<{ ok: boolean; latency_ms: number }> {
    const start = Date.now();
    try {
      await this.callApi(['ping']);
      return { ok: true, latency_ms: Date.now() - start };
    } catch {
      return { ok: false, latency_ms: Date.now() - start };
    }
  }

  private async callApi(input: string[]): Promise<number[][]> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const json = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return json.data.map(d => d.embedding);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm vitest run --project server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/search/
git commit -m "feat(search): add embedding client with batch support and ping"
```

---

### Task 3: Milvus Client

**Files:**
- Create: `packages/server/src/search/milvus-client.ts`

- [ ] **Step 1: Implement milvus-client.ts**

```typescript
// packages/server/src/search/milvus-client.ts
import { MilvusClient as MilvusSdk, DataType } from '@zilliz/milvus2-sdk-node';

export interface MilvusFragment {
  id: string;
  vector: number[];
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  created_at: number;   // unix timestamp
  updated_at: number;   // unix timestamp
  tags: string[];
  access_read: string[];
  community_id: number;
}

export interface MilvusSearchResult {
  id: string;
  score: number;
}

export interface MilvusFilters {
  type?: string[];
  domain?: string[];
  lang?: string;
  quality_min?: string;
  tags?: string[];
}

const QUALITY_ORDER = ['draft', 'reviewed', 'approved'];

function buildFilterExpr(filters: MilvusFilters): string {
  const parts: string[] = [];

  if (filters.type?.length) {
    const vals = filters.type.map(t => `"${t}"`).join(', ');
    parts.push(`type in [${vals}]`);
  }
  if (filters.domain?.length) {
    const vals = filters.domain.map(d => `"${d}"`).join(', ');
    parts.push(`domain in [${vals}]`);
  }
  if (filters.lang) {
    parts.push(`lang == "${filters.lang}"`);
  }
  if (filters.quality_min) {
    const minIdx = QUALITY_ORDER.indexOf(filters.quality_min);
    if (minIdx > 0) {
      const allowed = QUALITY_ORDER.slice(minIdx).map(q => `"${q}"`).join(', ');
      parts.push(`quality in [${allowed}]`);
    }
  }

  // Always exclude deprecated
  parts.push(`quality != "deprecated"`);

  return parts.join(' and ');
}

export class FragmintMilvusClient {
  private sdk: MilvusSdk;

  constructor(
    private readonly address: string,
    private readonly collectionName: string,
    private readonly dimensions: number,
  ) {
    this.sdk = new MilvusSdk({ address });
  }

  async ensureCollection(): Promise<void> {
    const exists = await this.sdk.hasCollection({ collection_name: this.collectionName });
    if (exists.value) return;

    await this.sdk.createCollection({
      collection_name: this.collectionName,
      fields: [
        { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
        { name: 'vector', data_type: DataType.FloatVector, dim: this.dimensions },
        { name: 'type', data_type: DataType.VarChar, max_length: 32 },
        { name: 'domain', data_type: DataType.VarChar, max_length: 128 },
        { name: 'lang', data_type: DataType.VarChar, max_length: 8 },
        { name: 'quality', data_type: DataType.VarChar, max_length: 16 },
        { name: 'author', data_type: DataType.VarChar, max_length: 128 },
        { name: 'created_at', data_type: DataType.Int64 },
        { name: 'updated_at', data_type: DataType.Int64 },
        { name: 'tags', data_type: DataType.JSON },
        { name: 'access_read', data_type: DataType.JSON },
        { name: 'community_id', data_type: DataType.Int64 },
      ],
    });

    await this.sdk.createIndex({
      collection_name: this.collectionName,
      field_name: 'vector',
      index_type: 'IVF_FLAT',
      metric_type: 'COSINE',
      params: { nlist: 128 },
    });

    await this.sdk.loadCollection({ collection_name: this.collectionName });
  }

  async upsert(items: MilvusFragment[]): Promise<void> {
    if (items.length === 0) return;
    await this.sdk.upsert({
      collection_name: this.collectionName,
      data: items,
    });
  }

  async search(vector: number[], filters: MilvusFilters, limit: number): Promise<MilvusSearchResult[]> {
    const filterExpr = buildFilterExpr(filters);
    const results = await this.sdk.search({
      collection_name: this.collectionName,
      vector,
      limit,
      filter: filterExpr,
      output_fields: ['id'],
    });

    return (results.results || []).map((r: any) => ({
      id: r.id as string,
      score: r.score as number,
    }));
  }

  async delete(id: string): Promise<void> {
    await this.sdk.delete({
      collection_name: this.collectionName,
      filter: `id == "${id}"`,
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.sdk.checkHealth();
      return true;
    } catch {
      return false;
    }
  }
}
```

Note: No unit test for MilvusClient — it's a thin SDK wrapper. Integration tests run only with `MILVUS_TEST_ADDRESS` env var.

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/search/milvus-client.ts
git commit -m "feat(search): add Milvus client with collection setup, upsert, search, delete"
```

---

## Chunk 2: Search Service, FragmentService Integration, Inventory

### Task 4: Search Service

**Files:**
- Create: `packages/server/src/search/search-service.ts`
- Create: `packages/server/src/search/index.ts`
- Test: `packages/server/src/search/search-service.test.ts`

- [ ] **Step 1: Write search service tests**

```typescript
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
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm vitest run --project server`
Expected: FAIL

- [ ] **Step 3: Implement search-service.ts**

```typescript
// packages/server/src/search/search-service.ts
import { eq, like, and, or, desc, inArray, ne } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import type { EmbeddingClient } from './embedding-client.js';
import type { FragmintMilvusClient, MilvusFilters } from './milvus-client.js';

export interface FragmentMetadata {
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  tags: string[];
  access_read: string[];
  created_at: string;
  updated_at: string;
}

export interface SearchFilters {
  type?: string[];
  domain?: string[];
  lang?: string;
  quality_min?: string;
  tags?: string[];
}

export interface SearchResult {
  id: string;
  score: number;
  title: string | null;
  body_excerpt: string | null;
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  uses: number;
}

const QUALITY_ORDER = ['draft', 'reviewed', 'approved'];

export class SearchService {
  constructor(
    private db: FragmintDb,
    private embeddingClient: EmbeddingClient,
    private milvusClient: FragmintMilvusClient | null,
  ) {}

  async indexFragment(id: string, body: string, metadata: FragmentMetadata): Promise<void> {
    if (!this.milvusClient) return;

    try {
      const title = body.match(/^#\s+(.+)$/m)?.[1] ?? '';
      const vector = await this.embeddingClient.embed(`${title}\n\n${body}`);

      await this.milvusClient.upsert([{
        id,
        vector,
        type: metadata.type,
        domain: metadata.domain,
        lang: metadata.lang,
        quality: metadata.quality,
        author: metadata.author,
        created_at: new Date(metadata.created_at).getTime(),
        updated_at: new Date(metadata.updated_at).getTime(),
        tags: metadata.tags,
        access_read: metadata.access_read,
        community_id: 0,
      }]);
    } catch (err) {
      console.warn(`Failed to index fragment ${id} in Milvus:`, err);
    }
  }

  async indexBatch(items: { id: string; body: string; metadata: FragmentMetadata }[]): Promise<{ indexed: number }> {
    if (!this.milvusClient || items.length === 0) return { indexed: 0 };

    let indexed = 0;
    try {
      const texts = items.map(item => {
        const title = item.body.match(/^#\s+(.+)$/m)?.[1] ?? '';
        return `${title}\n\n${item.body}`;
      });

      const vectors = await this.embeddingClient.embedBatch(texts);

      const milvusItems = items.map((item, i) => ({
        id: item.id,
        vector: vectors[i],
        type: item.metadata.type,
        domain: item.metadata.domain,
        lang: item.metadata.lang,
        quality: item.metadata.quality,
        author: item.metadata.author,
        created_at: new Date(item.metadata.created_at).getTime(),
        updated_at: new Date(item.metadata.updated_at).getTime(),
        tags: item.metadata.tags,
        access_read: item.metadata.access_read,
        community_id: 0,
      }));

      // Batch upsert in chunks of 100
      for (let i = 0; i < milvusItems.length; i += 100) {
        await this.milvusClient.upsert(milvusItems.slice(i, i + 100));
        indexed += Math.min(100, milvusItems.length - i);
      }
    } catch (err) {
      console.warn(`Failed to batch index in Milvus:`, err);
    }
    return { indexed };
  }

  async search(query: string, filters?: SearchFilters, limit = 20): Promise<SearchResult[]> {
    // Try Milvus path
    if (this.milvusClient) {
      try {
        const vector = await this.embeddingClient.embed(query);
        const milvusFilters: MilvusFilters = {
          type: filters?.type,
          domain: filters?.domain,
          lang: filters?.lang,
          quality_min: filters?.quality_min,
        };
        const milvusResults = await this.milvusClient.search(vector, milvusFilters, limit);

        if (milvusResults.length > 0) {
          // Enrich from SQLite
          const ids = milvusResults.map(r => r.id);
          const rows = await this.db.select().from(fragments)
            .where(inArray(fragments.id, ids));

          const rowMap = new Map(rows.map(r => [r.id, r]));
          return milvusResults
            .map(mr => {
              const row = rowMap.get(mr.id);
              if (!row) return null;
              return {
                id: row.id,
                score: mr.score,
                title: row.title,
                body_excerpt: row.body_excerpt,
                type: row.type,
                domain: row.domain,
                lang: row.lang,
                quality: row.quality,
                author: row.author,
                uses: row.uses,
              };
            })
            .filter((r): r is SearchResult => r !== null);
        }
      } catch (err) {
        console.warn('Milvus search failed, falling back to SQLite:', err);
      }
    }

    // SQLite fallback
    return this.sqliteSearch(query, filters, limit);
  }

  async removeFromIndex(id: string): Promise<void> {
    if (!this.milvusClient) return;
    try {
      await this.milvusClient.delete(id);
    } catch (err) {
      console.warn(`Failed to remove fragment ${id} from Milvus:`, err);
    }
  }

  async status(): Promise<{ milvus: boolean; embedding: boolean; mode: 'milvus' | 'sqlite' }> {
    let milvusOk = false;
    if (this.milvusClient) {
      milvusOk = await this.milvusClient.ping();
    }
    const embeddingResult = await this.embeddingClient.ping();

    return {
      milvus: milvusOk,
      embedding: embeddingResult.ok,
      mode: milvusOk ? 'milvus' : 'sqlite',
    };
  }

  private async sqliteSearch(query: string, filters?: SearchFilters, limit = 20): Promise<SearchResult[]> {
    const conditions = [];
    const q = `%${query}%`;
    conditions.push(or(like(fragments.title, q), like(fragments.body_excerpt, q)));

    if (filters?.type?.length) {
      conditions.push(inArray(fragments.type, filters.type));
    }
    if (filters?.domain?.length) {
      conditions.push(inArray(fragments.domain, filters.domain));
    }
    if (filters?.lang) {
      conditions.push(eq(fragments.lang, filters.lang));
    }
    if (filters?.quality_min) {
      const minIdx = QUALITY_ORDER.indexOf(filters.quality_min);
      if (minIdx > 0) {
        const allowed = QUALITY_ORDER.slice(minIdx);
        conditions.push(inArray(fragments.quality, allowed));
      }
    }
    if (filters?.tags?.length) {
      for (const tag of filters.tags) {
        conditions.push(like(fragments.tags, `%${tag}%`));
      }
    }

    // Always exclude deprecated
    conditions.push(ne(fragments.quality, 'deprecated'));

    const rows = await this.db.select().from(fragments)
      .where(and(...conditions))
      .orderBy(desc(fragments.uses))
      .limit(limit);

    return rows.map(row => ({
      id: row.id,
      score: 0, // no score for SQLite fallback
      title: row.title,
      body_excerpt: row.body_excerpt,
      type: row.type,
      domain: row.domain,
      lang: row.lang,
      quality: row.quality,
      author: row.author,
      uses: row.uses,
    }));
  }
}
```

- [ ] **Step 4: Create search/index.ts**

```typescript
// packages/server/src/search/index.ts
export { EmbeddingClient } from './embedding-client.js';
export { FragmintMilvusClient, type MilvusFragment, type MilvusSearchResult, type MilvusFilters } from './milvus-client.js';
export { SearchService, type FragmentMetadata, type SearchFilters, type SearchResult } from './search-service.js';
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `pnpm vitest run --project server`
Expected: PASS (all previous tests + new search service tests)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/search/
git commit -m "feat(search): add SearchService with Milvus hybrid search and SQLite fallback"
```

---

### Task 5: Integrate SearchService into FragmentService

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts`

- [ ] **Step 1: Add SearchService dependency and delegate search**

Modify `FragmentService`:

1. **Constructor** — add `private searchService: SearchService` as 4th parameter:
```typescript
constructor(
  private db: FragmintDb,
  private storePath: string,
  private audit: AuditService,
  private searchService: SearchService,
)
```

2. **`create()`** — after the SQLite insert and audit log, add:
```typescript
    // Index in vector store
    await this.searchService.indexFragment(id, input.body, {
      type: input.type, domain: input.domain, lang: input.lang,
      quality: 'draft', author, tags: input.tags,
      access_read: input.access.read,
      created_at: now, updated_at: now,
    });
```

3. **`update()`** — after SQLite update and audit log, add:
```typescript
    // Re-index in vector store
    await this.searchService.indexFragment(id, newBody, {
      type: updatedFrontmatter.type, domain: updatedFrontmatter.domain,
      lang: updatedFrontmatter.lang, quality: updatedFrontmatter.quality,
      author: updatedFrontmatter.author, tags: updatedFrontmatter.tags,
      access_read: updatedFrontmatter.access.read,
      created_at: updatedFrontmatter.created_at, updated_at: updatedFrontmatter.updated_at,
    });
```

4. **`approve()`** — same pattern after SQLite update.

5. **`deprecate()`** — after SQLite update, call `removeFromIndex`:
```typescript
    await this.searchService.removeFromIndex(id);
```

6. **`search()`** — replace entire method body:
```typescript
  async search(query: string, filters?: SearchFilters, limit = 20) {
    return this.searchService.search(query, filters, limit);
  }
```

Update the import to bring in `SearchService` and `SearchFilters` types from `../search/index.js`. Remove the now-unused `like`, `or`, `sql` imports from drizzle-orm if they're no longer used elsewhere.

7. **`reindex()`** — after the SQLite indexing loop, add vector batch indexing:
```typescript
    // Batch index into vector store
    const batchItems = [];
    for (const absPath of files) {
      try {
        const { frontmatter, body } = readFragment(absPath);
        batchItems.push({
          id: frontmatter.id,
          body,
          metadata: {
            type: frontmatter.type, domain: frontmatter.domain,
            lang: frontmatter.lang, quality: frontmatter.quality,
            author: frontmatter.author, tags: frontmatter.tags,
            access_read: frontmatter.access.read,
            created_at: frontmatter.created_at, updated_at: frontmatter.updated_at,
          },
        });
      } catch { /* already logged above */ }
    }
    if (batchItems.length > 0) {
      const vectorResult = await this.searchService.indexBatch(batchItems);
      console.log(`Vector-indexed ${vectorResult.indexed} fragments`);
    }
```

- [ ] **Step 2: Run tests — verify existing tests still pass**

Run: `pnpm vitest run`
Expected: Integration tests may need updating since FragmentService now requires SearchService. Fix any constructor calls in test-helpers.ts.

- [ ] **Step 3: Update test-helpers.ts**

In `packages/server/src/test-helpers.ts`, the `createServer` function already constructs FragmentService. Since the server's `createServer` in `index.ts` will be updated in Task 6 to pass SearchService, integration tests should continue to work after that update. For now, if any test directly instantiates FragmentService, pass a SearchService with null milvus client.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/fragment-service.ts packages/server/src/test-helpers.ts
git commit -m "feat(services): integrate SearchService into FragmentService for search and indexation"
```

---

### Task 6: Wire SearchService in server entry point

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Update createServer to instantiate SearchService**

Add imports at top of `index.ts`:
```typescript
import { EmbeddingClient, FragmintMilvusClient, SearchService } from './search/index.js';
```

Replace the services section with:
```typescript
  // Search infrastructure
  const embeddingClient = new EmbeddingClient(
    config.embedding_endpoint, config.embedding_model, config.embedding_dimensions
  );

  let milvusClient: FragmintMilvusClient | null = null;
  if (config.milvus_enabled) {
    try {
      milvusClient = new FragmintMilvusClient(
        config.milvus_address, config.milvus_collection, config.embedding_dimensions
      );
      await milvusClient.ensureCollection();
      console.log('Milvus connected and collection ready');
    } catch (err) {
      console.warn('Milvus connection failed, using SQLite fallback:', err);
      milvusClient = null;
    }
  }

  const searchService = new SearchService(db, embeddingClient, milvusClient);

  // Services
  const auditService = new AuditService(db);
  const userService = new UserService(db);
  const tokenService = new TokenService(db);
  const fragmentService = new FragmentService(db, storePath, auditService, searchService);
```

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass (integration tests use in-memory SQLite, milvus_enabled defaults to false)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): wire SearchService with embedding client and optional Milvus"
```

---

### Task 7: Enhanced inventory with gap detection

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts`

- [ ] **Step 1: Enhance inventory() method**

Replace the `inventory()` method in `FragmentService`:

```typescript
  async inventory(topic?: string, lang?: string) {
    const allFragments = await this.db.select({
      id: fragments.id,
      type: fragments.type,
      domain: fragments.domain,
      lang: fragments.lang,
      quality: fragments.quality,
      translation_of: fragments.translation_of,
    }).from(fragments);

    const filtered = topic
      ? allFragments.filter(f => f.domain.toLowerCase().includes(topic.toLowerCase()))
      : allFragments;

    const byType: Record<string, number> = {};
    const byQuality: Record<string, number> = {};
    const byLang: Record<string, Record<string, number>> = {};

    for (const f of filtered) {
      byType[f.type] = (byType[f.type] || 0) + 1;
      byQuality[f.quality] = (byQuality[f.quality] || 0) + 1;
      if (!byLang[f.lang]) byLang[f.lang] = {};
      byLang[f.lang][f.quality] = (byLang[f.lang][f.quality] || 0) + 1;
    }

    // Gap detection
    const gaps: Array<{
      type: string; domain: string; lang: string;
      status: 'no_approved' | 'missing_translation';
      draft_count?: number; source_id?: string;
    }> = [];

    // 1. Find type/domain pairs with no approved fragment
    const typeDomainPairs = new Map<string, { drafts: number; hasApproved: boolean }>();
    for (const f of filtered) {
      const key = `${f.type}|${f.domain}`;
      const entry = typeDomainPairs.get(key) ?? { drafts: 0, hasApproved: false };
      if (f.quality === 'approved') entry.hasApproved = true;
      if (f.quality === 'draft') entry.drafts++;
      typeDomainPairs.set(key, entry);
    }
    for (const [key, val] of typeDomainPairs) {
      if (!val.hasApproved) {
        const [type, domain] = key.split('|');
        gaps.push({ type, domain, lang: '*', status: 'no_approved', draft_count: val.drafts });
      }
    }

    // 2. Find fragments with missing translations
    const allLangs = [...new Set(allFragments.map(f => f.lang))];
    const originals = allFragments.filter(f => !f.translation_of);
    for (const orig of originals) {
      const translations = allFragments.filter(f => f.translation_of === orig.id);
      const translatedLangs = new Set([orig.lang, ...translations.map(t => t.lang)]);
      for (const l of allLangs) {
        if (!translatedLangs.has(l)) {
          gaps.push({
            type: orig.type, domain: orig.domain, lang: l,
            status: 'missing_translation', source_id: orig.id,
          });
        }
      }
    }

    return { total: filtered.length, by_type: byType, by_quality: byQuality, by_lang: byLang, gaps };
  }
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/fragment-service.ts
git commit -m "feat(inventory): add gap detection for missing approvals and translations"
```

---

### Task 8: Docker compose for Milvus dev + final verification

**Files:**
- Create: `docker/docker-compose.dev.yml`

- [ ] **Step 1: Create docker-compose.dev.yml**

```yaml
# docker/docker-compose.dev.yml
# Milvus standalone for local development
# Start: docker compose -f docker/docker-compose.dev.yml up -d
# Then: FRAGMINT_MILVUS_ENABLED=true fragmint serve --dev
services:
  milvus:
    image: milvusdb/milvus:v2.4.17
    ports:
      - "19530:19530"
      - "9091:9091"
    environment:
      ETCD_USE_EMBED: "true"
      COMMON_STORAGETYPE: local
    volumes:
      - milvus-data:/var/lib/milvus
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9091/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  milvus-data:
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass (unit + integration, no Milvus needed)

- [ ] **Step 3: Commit**

```bash
git add docker/docker-compose.dev.yml
git commit -m "chore: add Milvus Docker Compose for local development"
```
