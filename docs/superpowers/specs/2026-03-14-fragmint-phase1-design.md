# Fragmint Phase 1 — Semantic Indexing Design Spec

**Date:** 2026-03-14
**Status:** Approved
**PRD Reference:** Fragmint PRD v0.5 — Phase 1 (Indexation sémantique, ~2 semaines)
**Depends on:** Phase 0 (completed)

## Summary

Phase 1 adds semantic search to Fragmint by integrating Milvus for vector storage and an embedding pipeline via Ollama (OpenAI-compatible API). The existing SQLite fulltext search becomes a fallback when Milvus is unavailable. Inventory is enhanced with gap detection.

## Tech Stack Additions

| Component | Choice | Rationale |
|---|---|---|
| Vector DB (dev/test) | Milvus Lite | Zero infra, CI-friendly |
| Vector DB (dev/staging) | Milvus Standalone via Docker | Closer to prod |
| Vector DB SDK | `@zilliz/milvus2-sdk-node` | Official Node.js SDK |
| Embedding | Ollama API (OpenAI-compatible `/v1/embeddings`) | Sovereign, air-gap, configurable endpoint |
| Default model | `nomic-embed-text-v1` (768d) | PRD specification |

## 1. File Structure

New files in `packages/server/src/search/`:

```
packages/server/src/
├── search/
│   ├── embedding-client.ts      # HTTP client for embedding API
│   ├── embedding-client.test.ts # Unit tests (mocked fetch)
│   ├── milvus-client.ts         # Milvus SDK wrapper
│   ├── search-service.ts        # Orchestration + SQLite fallback
│   ├── search-service.test.ts   # Unit tests (mocked clients)
│   └── index.ts                 # Re-exports
```

Modified files:
- `packages/server/src/config.ts` — add embedding + milvus config fields
- `packages/server/src/services/fragment-service.ts` — inject SearchService, delegate search/index
- `packages/server/src/index.ts` — wire SearchService into server setup

## 2. Configuration

Extended `FragmintConfig`:

```typescript
interface FragmintConfig {
  // ... existing fields (port, store_path, jwt_secret, jwt_ttl, log_level, trust_proxy, dev)

  // Embedding
  embedding_endpoint: string;    // default: "http://localhost:11434/v1"
  embedding_model: string;       // default: "nomic-embed-text-v1"
  embedding_dimensions: number;  // default: 768
  embedding_batch_size: number;  // default: 32

  // Milvus
  milvus_address: string;        // default: "localhost:19530"
  milvus_collection: string;     // default: "fragmint_fragments"
  milvus_enabled: boolean;       // default: false
}
```

Environment variables: `FRAGMINT_EMBEDDING_ENDPOINT`, `FRAGMINT_EMBEDDING_MODEL`, `FRAGMINT_EMBEDDING_DIMENSIONS`, `FRAGMINT_EMBEDDING_BATCH_SIZE`, `FRAGMINT_MILVUS_ADDRESS`, `FRAGMINT_MILVUS_COLLECTION`, `FRAGMINT_MILVUS_ENABLED`.

**`milvus_enabled` defaults to `false`** — Phase 0 continues to work unchanged. When enabled, search switches to hybrid mode. If Milvus goes down at runtime, automatic fallback to SQLite.

## 3. Embedding Client

`packages/server/src/search/embedding-client.ts`

```typescript
class EmbeddingClient {
  constructor(endpoint: string, model: string, dimensions: number)

  async embed(text: string): Promise<number[]>
  async embedBatch(texts: string[], batchSize?: number): Promise<number[][]>
  async ping(): Promise<{ ok: boolean; latency_ms: number }>
}
```

**HTTP call:**
```
POST {endpoint}/embeddings
Content-Type: application/json

{ "model": "nomic-embed-text-v1", "input": ["text to embed"] }
→ { "data": [{ "embedding": [0.1, 0.2, ...] }] }
```

The text sent for embedding is the concatenation of `title + "\n\n" + body` (no YAML frontmatter). Batch calls group by `batchSize` (default 32) to avoid overloading Ollama.

On HTTP error or timeout, the client throws — the `SearchService` handles fallback.

## 4. Milvus Client

`packages/server/src/search/milvus-client.ts`

```typescript
class MilvusClient {
  constructor(address: string, collectionName: string, dimensions: number)

  async ensureCollection(): Promise<void>
  async upsert(items: MilvusFragment[]): Promise<void>
  async search(vector: number[], filters: MilvusFilters, limit: number): Promise<MilvusSearchResult[]>
  async delete(id: string): Promise<void>
  async ping(): Promise<boolean>
}
```

**Collection schema** (`fragmint_fragments`) per PRD section 12:

| Field | Type | Role |
|---|---|---|
| `id` | VARCHAR, PK | Fragment ID |
| `vector` | FLOAT_VECTOR(768) | Embedding |
| `type` | VARCHAR | Scalar filter |
| `domain` | VARCHAR | Scalar filter |
| `lang` | VARCHAR | Scalar filter |
| `quality` | VARCHAR | Scalar filter |
| `author` | VARCHAR | Scalar filter |
| `created_at` | INT64 | Timestamp |
| `updated_at` | INT64 | Timestamp |
| `tags` | JSON | Scalar filter |
| `access_read` | JSON | Access control filter |
| `community_id` | INT64 | Leiden cluster (Phase 6, default 0) |

Filters are applied via Milvus boolean expressions (e.g., `type in ["introduction","argument"] and lang == "fr" and quality != "deprecated"`).

Search results return `{ id, score }` plus scalar fields — the `SearchService` enriches with full SQLite data.

`ensureCollection()` is idempotent — creates the collection and index only if they don't exist. Called once at server startup.

## 5. Search Service

`packages/server/src/search/search-service.ts`

```typescript
class SearchService {
  constructor(
    db: FragmintDb,
    embeddingClient: EmbeddingClient,
    milvusClient: MilvusClient | null,  // null if milvus_enabled=false
  )

  async indexFragment(id: string, body: string, metadata: FragmentMetadata): Promise<void>
  async indexBatch(fragments: { id: string; body: string; metadata: FragmentMetadata }[]): Promise<{ indexed: number }>
  async search(query: string, filters?: SearchFilters, limit?: number): Promise<SearchResult[]>
  async removeFromIndex(id: string): Promise<void>
  async status(): Promise<{ milvus: boolean; embedding: boolean; mode: 'milvus' | 'sqlite' }>
}
```

### Search flow

1. If Milvus available → embed query → Milvus vector search with scalar filters → enrich results from SQLite (body, full frontmatter)
2. If Milvus down or not configured → fallback to existing SQLite `LIKE` search (Phase 0)
3. Fallback is transparent to caller — same return format

### Indexation flow

1. Compute embedding via `EmbeddingClient`
2. Upsert into Milvus (if available)
3. If embedding or Milvus fails → log warning, fragment remains in SQLite (degraded search but functional)

### Modifications to FragmentService

- Constructor: accepts `SearchService` as new dependency
- `create()`, `update()`, `approve()`, `deprecate()`: after Git commit and SQLite upsert, call `searchService.indexFragment()` (or `removeFromIndex()` for deprecate)
- `search()`: delegates to `searchService.search()` instead of direct SQLite LIKE
- `reindex()`: after SQLite scan, calls `searchService.indexBatch()` for all fragments
- The existing SQLite search code in `FragmentService` is removed — `SearchService` owns all search logic (including the SQLite fallback path)

## 6. Inventory with Gap Detection

`FragmentService.inventory()` is enhanced — still in FragmentService (business logic on SQLite, not vector search).

Enhanced response:

```json
{
  "total": 23,
  "by_type": { "introduction": 5, "argument": 8 },
  "by_quality": { "approved": 14, "reviewed": 6, "draft": 3 },
  "by_lang": { "fr": { "approved": 12 }, "en": { "approved": 2 } },
  "gaps": [
    { "type": "conclusion", "domain": "souveraineté", "lang": "fr", "status": "no_approved", "draft_count": 1 },
    { "type": "introduction", "domain": "souveraineté", "lang": "en", "status": "missing_translation", "source_id": "frag-xxx" }
  ]
}
```

**Gap detection logic:**
- Cross-reference all type/domain/lang combinations in the store
- Flag type/domain pairs with no `approved` fragment → `no_approved`
- Flag fragments that have translations in some languages but not all → `missing_translation`
- No semantic analysis — purely structural counting from SQLite

## 7. Server Wiring

In `packages/server/src/index.ts` (`createServer`):

```typescript
// After DB setup, before routes
const embeddingClient = new EmbeddingClient(
  config.embedding_endpoint, config.embedding_model, config.embedding_dimensions
);

let milvusClient: MilvusClient | null = null;
if (config.milvus_enabled) {
  milvusClient = new MilvusClient(config.milvus_address, config.milvus_collection, config.embedding_dimensions);
  await milvusClient.ensureCollection();
}

const searchService = new SearchService(db, embeddingClient, milvusClient);

// FragmentService now receives searchService
const fragmentService = new FragmentService(db, storePath, auditService, searchService);
```

## 8. Testing Strategy

### Unit Tests

**`embedding-client.test.ts`:**
- Mock `globalThis.fetch` — verify correct request format, batch splitting, error handling, timeout behavior

**`search-service.test.ts`:**
- Mock both `EmbeddingClient` and `MilvusClient`
- Test: Milvus path works when client is provided
- Test: fallback to SQLite when milvusClient is null
- Test: fallback to SQLite when milvusClient.search() throws
- Test: indexFragment calls embed + upsert
- Test: indexFragment logs warning but doesn't throw when embedding fails

**Inventory gap detection:**
- Test with various SQLite data sets to verify gap detection logic

### Integration Tests

- Milvus integration tests only run when `MILVUS_TEST_ADDRESS` env var is set (skipped in CI by default)
- Embedding integration tests only run when `EMBEDDING_TEST_ENDPOINT` is set (skipped without Ollama)
- Existing Phase 0 integration tests continue to work unchanged (no Milvus, SQLite fallback)

### Docker for dev testing

```yaml
# docker/docker-compose.dev.yml
services:
  milvus:
    image: milvusdb/milvus:v2.4-latest
    ports:
      - "19530:19530"
      - "9091:9091"
    volumes:
      - milvus-data:/var/lib/milvus
volumes:
  milvus-data:
```

## Out of Scope (Phase 1)

- Leiden clustering / community_id (Phase 6)
- GraphRAG entity extraction (Phase 8)
- MCP server tools (Phase 2)
- Frontend visualization (Phase 4)
- Multilingual desynchronization (Phase 6)
