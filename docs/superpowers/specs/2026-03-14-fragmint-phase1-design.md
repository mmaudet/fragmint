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
| Default model | `nomic-embed-text-v2-moe` (768d) | MoE architecture, better quality than v1 |

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
  embedding_max_tokens: number;  // default: 480 (model context max is 512)
  embedding_prefix_document: string; // default: "search_document: "
  embedding_prefix_query: string;    // default: "search_query: "
  embedding_prefix_cluster: string;  // default: "clustering: "

  // Milvus
  milvus_address: string;        // default: "localhost:19530"
  milvus_collection: string;     // default: "fragmint_fragments"
  milvus_enabled: boolean;       // default: false
}
```

Environment variables: `FRAGMINT_EMBEDDING_ENDPOINT`, `FRAGMINT_EMBEDDING_MODEL`, `FRAGMINT_EMBEDDING_DIMENSIONS`, `FRAGMINT_EMBEDDING_BATCH_SIZE`, `FRAGMINT_EMBEDDING_MAX_TOKENS`, `FRAGMINT_EMBEDDING_PREFIX_DOCUMENT`, `FRAGMINT_EMBEDDING_PREFIX_QUERY`, `FRAGMINT_EMBEDDING_PREFIX_CLUSTER`, `FRAGMINT_MILVUS_ADDRESS`, `FRAGMINT_MILVUS_COLLECTION`, `FRAGMINT_MILVUS_ENABLED`.

**`milvus_enabled` defaults to `false`** — Phase 0 continues to work unchanged. When enabled, search switches to hybrid mode. If Milvus goes down at runtime, automatic fallback to SQLite.

**Note on `embedding.provider`:** The PRD config schema includes a `provider` field (`local | openai | custom`). This is intentionally omitted in Phase 1 — the OpenAI-compatible endpoint URL is sufficient to target Ollama, OpenRouter, or any compatible API. A provider discriminator can be added later if non-OpenAI-compatible APIs are needed.

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

{ "model": "nomic-embed-text-v2-moe", "input": ["search_document: text to embed"] }
→ { "data": [{ "embedding": [0.1, 0.2, ...] }] }
```

The `EmbeddingClient` is agnostic — it sends text as-is. The `SearchService` is responsible for applying task prefixes and truncation before calling the client.

On HTTP error or timeout, the client throws — the `SearchService` handles fallback.

### Task Prefixes (nomic-embed-text-v2-moe)

The default model `nomic-embed-text-v2-moe` uses a Mixture-of-Experts architecture that **requires mandatory task-specific prefixes** for optimal embedding quality. Without them, the MoE routing produces lower-quality embeddings.

| Operation | Prefix | Applied by |
|---|---|---|
| Indexing a fragment | `search_document: ` | `SearchService.indexFragment()` / `indexBatch()` |
| Searching (user/agent query) | `search_query: ` | `SearchService.search()` |
| Clustering (Phase 6 Leiden) | `clustering: ` | Future use |

Prefixes are configurable via `embedding_prefix_document`, `embedding_prefix_query`, `embedding_prefix_cluster` — set to empty strings for models that don't need them.

### Truncation

The model's context window is **512 tokens maximum** (~350-400 words). Text is truncated to `embedding_max_tokens` (default 480, leaving margin) before sending to the API. Rough estimate: 1 token ≈ 4 characters for French/English.

The text sent for embedding is: `{prefix}{title}\n\n{body}` (truncated, no YAML frontmatter).

### Batch calls

Batch calls group by `batchSize` (default 32) to avoid overloading Ollama.

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
    options?: {
      prefixes?: { document: string; query: string; cluster: string };
      maxTokens?: number;
    }
  )

  async indexFragment(id: string, body: string, metadata: FragmentMetadata): Promise<void>
  async indexBatch(fragments: { id: string; body: string; metadata: FragmentMetadata }[]): Promise<{ indexed: number }>
  async search(query: string, filters?: SearchFilters, limit?: number): Promise<SearchResult[]>
  async removeFromIndex(id: string): Promise<void>
  async status(): Promise<{ milvus: boolean; embedding: boolean; mode: 'milvus' | 'sqlite' }>
}
```

### Type definitions

```typescript
interface FragmentMetadata {
  type: string; domain: string; lang: string; quality: string;
  author: string; tags: string[]; access_read: string[];
  created_at: string; updated_at: string;
}

interface SearchFilters {
  type?: string[]; domain?: string[]; lang?: string;
  quality_min?: string; tags?: string[];
}

interface SearchResult {
  id: string; score: number; title: string; body_excerpt: string;
  type: string; domain: string; lang: string; quality: string;
  author: string; uses: number;
}

// MilvusFilters: same as SearchFilters but translated to Milvus boolean expressions
// MilvusFragment: { id, vector, ...FragmentMetadata fields as scalars }
// MilvusSearchResult: { id, score, ...scalar fields }
```

### `quality_min` semantics

`quality_min` maps to an inclusion set based on the quality ordering `draft < reviewed < approved`:
- `quality_min: "draft"` → all qualities (no filter)
- `quality_min: "reviewed"` → Milvus expr: `quality in ["reviewed", "approved"]`
- `quality_min: "approved"` → Milvus expr: `quality == "approved"`

`deprecated` is always excluded from search results unless explicitly requested.

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
- The existing SQLite search code in `FragmentService` is moved to `SearchService` — `SearchService` owns all search logic (including the SQLite fallback path)
- The SQLite fallback path must honor all filters (type, domain, lang, quality_min, tags) for feature parity with Milvus. Tags are filtered via `LIKE` on the JSON-serialized `tags` column.
- The existing `POST /v1/index/trigger` admin route already calls `fragmentService.reindex()` — no route changes needed, the reindex now includes vector indexation automatically

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

const searchService = new SearchService(db, embeddingClient, milvusClient, {
  prefixes: {
    document: config.embedding_prefix_document,
    query: config.embedding_prefix_query,
    cluster: config.embedding_prefix_cluster,
  },
  maxTokens: config.embedding_max_tokens,
});

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
    image: milvusdb/milvus:v2.4.17
    command: ["milvus", "run", "standalone"]
    ports:
      - "19530:19530"
      - "9091:9091"
    environment:
      ETCD_USE_EMBED: "true"
      ETCD_DATA_DIR: /var/lib/milvus/etcd
      COMMON_STORAGETYPE: local
    volumes:
      - milvus-data:/var/lib/milvus
volumes:
  milvus-data:
```

**Starting the full stack for development:**
```bash
# Start Milvus
docker compose -f docker/docker-compose.dev.yml up -d

# Start Fragmint with Milvus + Ollama embedding
FRAGMINT_MILVUS_ENABLED=true npx tsx packages/server/src/index.ts
```

Requires Ollama running locally with `nomic-embed-text-v2-moe` model installed (`ollama pull nomic-embed-text-v2-moe`).

## 9. CLI Updates

The PRD lists `inventory` and `gaps` as Phase 1 CLI commands. These already exist from Phase 0 (`fragmint inventory`, `fragmint gaps`). No CLI changes needed — the enhanced inventory response (with gaps) flows through the existing API endpoint automatically.

## Out of Scope (Phase 1)

- Leiden clustering / community_id (Phase 6)
- GraphRAG entity extraction (Phase 8)
- MCP server tools (Phase 2)
- Frontend visualization (Phase 4)
- Multilingual desynchronization (Phase 6)
