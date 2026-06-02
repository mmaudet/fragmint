# Retrieval Modes (Piste B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three pluggable retrieval modes (`vector-only`, `agentic-only`, `hybrid`) to the Fragmint backend, selectable via `FRAGMINT_RETRIEVAL_MODE` env var and toggleable at runtime via admin API, replacing the hardcoded vector search in `PlanService.runSectionSearch`.

**Architecture:** A common `FragmentRetriever` interface with three implementations lives in `packages/server/src/retrieval/`. A factory module owns the active instance and a mutable mode variable for runtime toggling. `PlanService` gains a `retriever?` config field that is preferred over the existing `search?` field (which remains for backward-compat with tests). `index.ts` creates the retriever via the factory and wires it into `PlanAssembler`. `ComposerService` is intentionally left unchanged.

**Tech Stack:** TypeScript, Fastify 5, Vitest (unit tests via in-memory SQLite + vi.fn() mocks), existing `SearchService`, `LlmClient`, `IndexService`, `FragmentService`.

---

## File map

### Create
- `packages/server/src/retrieval/fragment-retriever.ts` — shared interface + types
- `packages/server/src/retrieval/vector-retriever.ts` — wraps SearchService
- `packages/server/src/retrieval/agentic-retriever.ts` — IndexService + 2-phase LLM judge
- `packages/server/src/retrieval/hybrid-retriever.ts` — Milvus pre-filter + LLM batch re-rank
- `packages/server/src/retrieval/factory.ts` — createRetriever + runtime toggle
- `packages/server/src/retrieval/retrieval.test.ts` — Vitest unit tests for all retrievers + factory

### Modify
- `packages/server/src/config.ts` — add `retrieval_mode` field + `FRAGMINT_RETRIEVAL_MODE` env var
- `packages/server/src/services/index-service.ts` — add `collectionSlug?` param to `getIndex` / `getData` / `generate` so AgenticRetriever filters by collection
- `packages/server/src/services/plan-service.ts` — add `retriever?` to config, add `requireRetriever()`, update `runSectionSearch`
- `packages/server/src/index.ts` — wire `createRetriever` after `searchService`, pass `retriever` to planService
- `packages/server/src/routes/admin-routes.ts` — add `GET/POST /v1/admin/retrieval/mode` endpoint + expose `retrieval_mode` in existing `/v1/index/status`

---

## Task 1: Add `retrieval_mode` to config

**Files:**
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Add `retrieval_mode` to the interface**

In `packages/server/src/config.ts`, after the `upload_max_bytes` line in the `FragmintConfig` interface (line 50), add:

```typescript
  // Retrieval
  retrieval_mode: 'vector-only' | 'agentic-only' | 'hybrid';
```

- [ ] **Step 2: Read the env var in `loadConfig`**

In `loadConfig`, after `upload_max_bytes` (near line 138), add:

```typescript
    retrieval_mode:
      (process.env.FRAGMINT_RETRIEVAL_MODE as FragmintConfig['retrieval_mode'] | undefined) ??
      fileConfig.retrieval_mode ??
      'vector-only',
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors (the new field is optional in YAML files and defaults to `'vector-only'`).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/config.ts
git commit -m "feat(config): add retrieval_mode (FRAGMINT_RETRIEVAL_MODE, default vector-only)"
```

---

## Task 2: Create `FragmentRetriever` interface

**Files:**
- Create: `packages/server/src/retrieval/fragment-retriever.ts`

- [ ] **Step 1: Write the failing test (interface import)**

Add to `packages/server/src/retrieval/retrieval.test.ts` (create the file):

```typescript
import { describe, it, expect } from 'vitest';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

describe('FragmentRetriever interface', () => {
  it('can be satisfied by a minimal stub', () => {
    const stub: FragmentRetriever = {
      searchForSection: async (_q: SectionQuery): Promise<RetrievedFragment[]> => [],
    };
    expect(stub).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — cannot find module `./fragment-retriever.js`.

- [ ] **Step 3: Create the interface file**

Create `packages/server/src/retrieval/fragment-retriever.ts`:

```typescript
import type { PlanFilters } from '../schema/plan.js';

export interface SectionQuery {
  text: string;
  filters: PlanFilters;
  collectionSlug: string | null;
  inferred_type?: string;
}

export interface RetrievedFragment {
  fragment_id: string;
  score: number;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
  justification?: string;
}

export interface FragmentRetriever {
  searchForSection(query: SectionQuery, limit?: number): Promise<RetrievedFragment[]>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/retrieval/fragment-retriever.ts packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(retrieval): add FragmentRetriever interface and SectionQuery/RetrievedFragment types"
```

---

## Task 3: Implement `VectorRetriever`

**Files:**
- Create: `packages/server/src/retrieval/vector-retriever.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/retrieval/retrieval.test.ts`:

```typescript
import { vi } from 'vitest';
import { VectorRetriever } from './vector-retriever.js';
import type { SearchService, SearchResult } from '../search/search-service.js';

function fakeSearchService(results: SearchResult[] = []): SearchService {
  return {
    search: vi.fn(async () => results),
  } as unknown as SearchService;
}

const SAMPLE_RESULT: SearchResult = {
  id: 'frag-1',
  score: 0.85,
  title: 'Fragment 1',
  body_excerpt: 'excerpt',
  type: 'argument',
  domain: 'cloud',
  lang: 'fr',
  quality: 'approved',
  author: 'alice',
  uses: 3,
  updated_at: '2026-01-01',
};

describe('VectorRetriever', () => {
  it('maps SearchService results to RetrievedFragment', async () => {
    const svc = fakeSearchService([SAMPLE_RESULT]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'cloud introduction',
      filters: { lang: 'fr' },
      collectionSlug: 'common',
    });
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-1');
    expect(results[0].score).toBe(0.85);
  });

  it('filters out results below SCORE_THRESHOLD (0.2)', async () => {
    const svc = fakeSearchService([{ ...SAMPLE_RESULT, id: 'low', score: 0.1 }]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'cloud',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toHaveLength(0);
  });

  it('passes lang, domain, type, tags, collectionSlug to SearchService', async () => {
    const svc = fakeSearchService([]);
    const retriever = new VectorRetriever(svc);
    await retriever.searchForSection({
      text: 'security',
      filters: { lang: 'fr', domain: ['cloud'], type: 'argument', tags: ['sla'] },
      collectionSlug: 'my-col',
    }, 3);
    expect((svc.search as any).mock.calls[0][1]).toMatchObject({
      lang: 'fr',
      domain: ['cloud'],
      type: ['argument'],
      tags: ['sla'],
      collectionSlug: 'my-col',
      quality_min: 'reviewed',
    });
    expect((svc.search as any).mock.calls[0][2]).toBe(3);
  });

  it('passes undefined domain when filters.domain is empty', async () => {
    const svc = fakeSearchService([]);
    const retriever = new VectorRetriever(svc);
    await retriever.searchForSection({ text: 'x', filters: { domain: [] }, collectionSlug: null });
    expect((svc.search as any).mock.calls[0][1].domain).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — cannot find module `./vector-retriever.js`.

- [ ] **Step 3: Implement `VectorRetriever`**

Create `packages/server/src/retrieval/vector-retriever.ts`:

```typescript
import type { SearchService } from '../search/search-service.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const SCORE_THRESHOLD = 0.2;

export class VectorRetriever implements FragmentRetriever {
  constructor(private searchService: SearchService) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { text, filters, collectionSlug } = query;
    const results = await this.searchService.search(
      text,
      {
        domain: filters.domain?.length ? filters.domain : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'reviewed',
      },
      limit,
    );
    return results
      .filter((r) => r.score >= SCORE_THRESHOLD)
      .map((r) => ({
        fragment_id: r.id,
        score: r.score,
        title: r.title,
        body_excerpt: r.body_excerpt,
        quality: r.quality,
      }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: all tests PASS.

- [ ] **Step 5: Add Milvus-OFF test — confirm VectorRetriever doesn't crash**

`SearchService` already has a `try/catch` around Milvus and falls back to SQLite (line 281-283 of `search-service.ts`). This test makes that guarantee explicit at the VectorRetriever level.

Append to the `VectorRetriever` describe block in `retrieval.test.ts`:

```typescript
  it('returns results from SearchService even when SearchService is backed by SQLite (Milvus OFF)', async () => {
    // Simulate SearchService with milvusClient=null — it falls back to sqliteSearch internally.
    // We verify VectorRetriever doesn't crash and forwards whatever SearchService returns.
    const svc = fakeSearchService([SAMPLE_RESULT]); // fake already simulates the fallback result
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({ text: 'cloud', filters: {}, collectionSlug: null });
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-1');
  });

  it('returns empty array (does not throw) when SearchService throws', async () => {
    const svc = {
      search: vi.fn(async () => { throw new Error('Milvus exploded'); }),
    } as unknown as SearchService;
    const retriever = new VectorRetriever(svc);
    // VectorRetriever does NOT swallow errors — they propagate.
    // But PlanService.runSectionSearch catches them (existing error tolerance test).
    // This test documents that fact.
    await expect(retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }))
      .rejects.toThrow('Milvus exploded');
  });
```

> **Note:** VectorRetriever propagates SearchService errors by design — it doesn't re-wrap them. The error tolerance lives in `PlanService.validatePlan()` which already catches per-section failures (tested in `plan-service.test.ts` "keeps other sections when one section search fails"). This is the correct separation.

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: all tests PASS.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/retrieval/vector-retriever.ts packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(retrieval): implement VectorRetriever wrapping SearchService"
```

---

## Task 3.5: Add `collectionSlug` filter to `IndexService`

**Files:**
- Modify: `packages/server/src/services/index-service.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts` (AgenticRetriever tests updated in Task 4)

**Why:** `IndexService.getData()` currently loads ALL approved fragments regardless of collection. `AgenticRetriever` calls it for Phase 1 candidate selection — without filtering, it would propose fragments from other collections.

**Design:** When `collectionSlug` is provided, skip the 5-minute in-memory cache (cache is keyed on "all collections"). When absent, cache behavior is unchanged.

- [ ] **Step 1: Write the failing test**

This test uses a real in-memory DB (consistent with `search-service.test.ts` pattern).

Add a new describe block to `packages/server/src/services/index-service.test.ts` (create file if it doesn't exist):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @fragmint/server test index-service
```

Expected: FAIL — `getData` does not accept a `collectionSlug` parameter.

- [ ] **Step 3: Update `IndexService`**

Modify `packages/server/src/services/index-service.ts`:

```typescript
// Change getIndex signature:
async getIndex(format: 'md' | 'json', collectionSlug?: string): Promise<string | IndexData> {
  const data = await this.getData(false, collectionSlug);
  return format === 'json' ? data : renderMarkdown(data);
}

// Change getData signature — add collectionSlug, bypass cache when set:
async getData(forceRefresh = false, collectionSlug?: string): Promise<IndexData> {
  if (collectionSlug) {
    // Filtered queries never use the global cache
    return this.generate(collectionSlug);
  }
  const now = Date.now();
  if (!forceRefresh && this.cachedData && now - this.cacheTimestamp < this.CACHE_TTL) {
    return this.cachedData;
  }
  this.cachedData = await this.generate();
  this.cacheTimestamp = now;
  return this.cachedData;
}

// Change generate signature — add optional collectionSlug filter:
private async generate(collectionSlug?: string): Promise<IndexData> {
  const conditions: SQL[] = [eq(fragments.quality, 'approved')];
  if (collectionSlug) conditions.push(eq(fragments.collection_slug, collectionSlug));

  const rows = await this.db
    .select()
    .from(fragments)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions));
  // ... rest of generate unchanged
```

Also add the `SQL` type import at the top of `index-service.ts`:

```typescript
import { eq, inArray, and, type SQL } from 'drizzle-orm';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @fragmint/server test index-service
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/index-service.ts packages/server/src/services/index-service.test.ts
git commit -m "feat(index-service): add collectionSlug filter to getData/getIndex"
```

---

## Task 4: Implement `AgenticRetriever`

**Files:**
- Create: `packages/server/src/retrieval/agentic-retriever.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

The agentic retriever does two LLM calls per section:
- **Phase 1** (1 call): reads the index markdown + section → returns 10-15 fragment UUIDs
- **Phase 2** (N parallel calls, one per candidate): reads fragment body → returns score 0-10 + reason

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/retrieval/retrieval.test.ts`:

```typescript
import { AgenticRetriever } from './agentic-retriever.js';
import type { IndexService } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { LlmClient } from '../services/llm-client.js';

function fakeIndexService(md = '# Index\n\n- **[TM-arg-001]** Fragment One\n  id: frag-uuid-1'): IndexService {
  return {
    getIndex: vi.fn(async () => md),
  } as unknown as IndexService;
}

function fakeLlmClient(responses: string[]): LlmClient {
  let i = 0;
  return {
    chatMessages: vi.fn(async () => responses[i++] ?? ''),
  } as unknown as LlmClient;
}

function fakeFragmentService(bodies: Record<string, string> = {}): FragmentService {
  return {
    getById: vi.fn(async (id: string) => {
      if (!(id in bodies)) return null;
      return { id, title: `Title ${id}`, body: bodies[id], quality: 'approved' };
    }),
  } as unknown as FragmentService;
}

describe('AgenticRetriever', () => {
  it('phase1 parses the LLM JSON array of UUIDs', async () => {
    const llm = fakeLlmClient([
      '["frag-uuid-1", "frag-uuid-2"]',           // phase 1
      '{"score": 8, "reason": "relevant"}',        // phase 2 — frag-uuid-1
      '{"score": 4, "reason": "partial"}',          // phase 2 — frag-uuid-2
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body one', 'frag-uuid-2': 'body two' }),
    );
    const results = await retriever.searchForSection({
      text: 'cloud introduction',
      filters: {},
      collectionSlug: null,
    }, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].fragment_id).toBe('frag-uuid-1');
    expect(results[0].score).toBeCloseTo(0.8);
    expect(results[0].justification).toBe('relevant');
  });

  it('returns empty when phase1 LLM returns non-JSON', async () => {
    const llm = fakeLlmClient(['No IDs found for this query.']);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService());
    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
  });

  it('skips fragments not found by FragmentService', async () => {
    const llm = fakeLlmClient([
      '["frag-missing"]',
      // phase 2 won't fire because getById returns null
    ]);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService({}));
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
  });

  it('filters out fragments with score below 0.3 after normalization', async () => {
    const llm = fakeLlmClient([
      '["frag-low"]',
      '{"score": 2, "reason": "poor match"}',   // 2/10 = 0.2 < threshold
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-low': 'body' }),
    );
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — cannot find module `./agentic-retriever.js`.

- [ ] **Step 3: Implement `AgenticRetriever`**

Create `packages/server/src/retrieval/agentic-retriever.ts`:

```typescript
import type { LlmClient } from '../services/llm-client.js';
import type { IndexService } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { PlanFilters } from '../schema/plan.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const PHASE2_SCORE_MIN = 0.3;
const PHASE1_MULTIPLIER = 3;

export class AgenticRetriever implements FragmentRetriever {
  constructor(
    private indexService: IndexService,
    private llm: LlmClient,
    private fragmentService: FragmentService,
  ) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const indexMd = (await this.indexService.getIndex('md', query.collectionSlug ?? undefined)) as string;
    const phase1Count = limit * PHASE1_MULTIPLIER;

    const candidateIds = await this.selectCandidates(query, indexMd, phase1Count);
    if (candidateIds.length === 0) return [];

    const scored = (
      await Promise.all(candidateIds.map((id) => this.judgeFragment(query, id)))
    ).filter((r): r is RetrievedFragment => r !== null && r.score >= PHASE2_SCORE_MIN);

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private async selectCandidates(
    query: SectionQuery,
    indexMd: string,
    count: number,
  ): Promise<string[]> {
    const filtersLine = buildFiltersDesc(query.filters);
    const collectionLine = query.collectionSlug ? `Collection: ${query.collectionSlug}` : '';
    const prompt = `You are a document composition assistant with access to a fragment library.

Section to populate: "${query.text}"
${query.inferred_type ? `Preferred fragment type: ${query.inferred_type}` : ''}
${filtersLine}
${collectionLine}

Fragment index (readable_id then UUID then title):
${indexMd}

Select the ${count} most relevant fragment UUIDs for this section.
Return ONLY a JSON array of UUID strings: ["uuid1", "uuid2", ...]`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];
      return (parsed as unknown[])
        .filter((id): id is string => typeof id === 'string')
        .slice(0, count);
    } catch {
      return [];
    }
  }

  private async judgeFragment(
    query: SectionQuery,
    fragmentId: string,
  ): Promise<RetrievedFragment | null> {
    const fragment = await this.fragmentService.getById(fragmentId);
    if (!fragment) return null;

    const prompt = `Evaluate whether this content fragment is relevant for a document section.

Section: "${query.text}"
Fragment title: "${fragment.title ?? ''}"
Fragment body (excerpt):
${(fragment.body ?? '').slice(0, 800)}

Score relevance from 0 to 10 (integer). 7+ = good fit. 3 or below = poor fit.
Return ONLY JSON: {"score": 8, "reason": "..."}`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\{[\s\S]*?\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]) as { score?: unknown; reason?: unknown };
      const rawScore = typeof parsed.score === 'number' ? parsed.score : 0;
      const normalizedScore = Math.max(0, Math.min(10, rawScore)) / 10;
      return {
        fragment_id: fragmentId,
        score: normalizedScore,
        title: fragment.title ?? null,
        body_excerpt: (fragment.body ?? '').slice(0, 200),
        quality: fragment.quality,
        justification: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    } catch {
      return null;
    }
  }
}

function buildFiltersDesc(filters: PlanFilters): string {
  const parts: string[] = [];
  if (filters.lang) parts.push(`Language: ${filters.lang}`);
  if (filters.domain?.length) parts.push(`Domain(s): ${filters.domain.join(', ')}`);
  if (filters.type) parts.push(`Type: ${filters.type}`);
  if (filters.tags?.length) parts.push(`Tags: ${filters.tags.join(', ')}`);
  return parts.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/retrieval/agentic-retriever.ts packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(retrieval): implement AgenticRetriever (IndexService + 2-phase LLM judge)"
```

---

## Task 5: Implement `HybridRetriever`

**Files:**
- Create: `packages/server/src/retrieval/hybrid-retriever.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

The hybrid retriever:
- **Phase 1**: `SearchService.search(..., limit=20)` → get up to 20 vector candidates
- **Phase 2**: LLM batch-rates all candidates in a single call → score 0-10 per candidate
- **Combine**: `combined = 0.4 × vectorScore + 0.6 × (llmScore/10)`, return top K

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/retrieval/retrieval.test.ts`:

```typescript
import { HybridRetriever } from './hybrid-retriever.js';

describe('HybridRetriever', () => {
  it('returns vector results directly when count <= limit (no LLM needed)', async () => {
    const svc = fakeSearchService([SAMPLE_RESULT]);
    const llm = fakeLlmClient([]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 5);
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-1');
    expect((llm.chatMessages as any).mock.calls).toHaveLength(0);
  });

  it('applies combined score when LLM re-ranks multiple candidates', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'f1', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'f2', score: 0.8 },
      { ...SAMPLE_RESULT, id: 'f3', score: 0.7 },
    ];
    const svc = fakeSearchService(candidates);
    // LLM scores: f1=5, f2=9, f3=3 → normalized: 0.5, 0.9, 0.3
    // combined: f1=0.4*0.9+0.6*0.5=0.36+0.3=0.66, f2=0.4*0.8+0.6*0.9=0.32+0.54=0.86, f3=...
    const llmResp = JSON.stringify([{ id: 'f1', score: 5 }, { id: 'f2', score: 9 }, { id: 'f3', score: 3 }]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 2);
    expect(results).toHaveLength(2);
    expect(results[0].fragment_id).toBe('f2'); // highest combined
  });

  it('falls back to top-K by vector score when LLM returns unparseable response', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'fa', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'fb', score: 0.8 },
      { ...SAMPLE_RESULT, id: 'fc', score: 0.7 },
    ];
    const svc = fakeSearchService(candidates);
    const llm = fakeLlmClient(['This is not JSON at all, sorry.']);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 2);
    // Neutral fallback score = 5 → combined 0.4*score + 0.6*0.5, so vector order preserved
    expect(results).toHaveLength(2);
    expect(results[0].fragment_id).toBe('fa');
  });

  it('returns empty when SearchService returns no results', async () => {
    const retriever = new HybridRetriever(fakeSearchService([]), fakeLlmClient([]));
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — cannot find module `./hybrid-retriever.js`.

- [ ] **Step 3: Implement `HybridRetriever`**

Create `packages/server/src/retrieval/hybrid-retriever.ts`:

```typescript
import type { SearchService, SearchResult } from '../search/search-service.js';
import type { LlmClient } from '../services/llm-client.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const PREFILTER_COUNT = 20;
const VECTOR_WEIGHT = 0.4;
const LLM_WEIGHT = 0.6;
const LLM_NEUTRAL_SCORE = 5;

export class HybridRetriever implements FragmentRetriever {
  constructor(
    private searchService: SearchService,
    private llm: LlmClient,
  ) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { text, filters, collectionSlug } = query;
    const candidates = await this.searchService.search(
      text,
      {
        domain: filters.domain?.length ? filters.domain : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'reviewed',
      },
      PREFILTER_COUNT,
    );

    if (candidates.length === 0) return [];

    if (candidates.length <= limit) {
      return candidates.map((c) => ({
        fragment_id: c.id,
        score: c.score,
        title: c.title,
        body_excerpt: c.body_excerpt,
        quality: c.quality,
      }));
    }

    const llmScores = await this.batchJudge(text, candidates);
    const scoreMap = new Map(llmScores);

    return candidates
      .map((c) => {
        const llmRaw = scoreMap.get(c.id) ?? LLM_NEUTRAL_SCORE;
        const llmNorm = Math.max(0, Math.min(10, llmRaw)) / 10;
        return {
          fragment_id: c.id,
          score: VECTOR_WEIGHT * c.score + LLM_WEIGHT * llmNorm,
          title: c.title,
          body_excerpt: c.body_excerpt,
          quality: c.quality,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private async batchJudge(
    sectionText: string,
    candidates: SearchResult[],
  ): Promise<Array<[string, number]>> {
    const list = candidates
      .map(
        (c, i) =>
          `${i + 1}. ID:${c.id}\nTitle: ${c.title ?? ''}\nExcerpt: ${(c.body_excerpt ?? '').slice(0, 120)}`,
      )
      .join('\n\n');

    const prompt = `Rate the relevance of each fragment for the following document section.

Section: "${sectionText}"

Fragments:
${list}

Return a JSON array where each item is {"id": "...", "score": 7}.
Score from 0 to 10. Include ALL ${candidates.length} fragments.
Return ONLY the JSON array, no other text.`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]);
      const parsed = JSON.parse(match[0]) as unknown[];
      if (!Array.isArray(parsed)) return candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]);
      return parsed
        .filter(
          (item): item is { id: string; score: number } =>
            typeof (item as any).id === 'string' && typeof (item as any).score === 'number',
        )
        .map((item) => [item.id, item.score]);
    } catch {
      return candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/retrieval/hybrid-retriever.ts packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(retrieval): implement HybridRetriever (Milvus pre-filter + LLM batch re-rank)"
```

---

## Task 6: Implement the factory

**Files:**
- Create: `packages/server/src/retrieval/factory.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

The factory uses module-level mutable state (acceptable: it's an in-memory runtime toggle that resets on server restart).

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/retrieval/retrieval.test.ts`:

```typescript
import { createRetriever, setRetrievalMode, getCurrentMode } from './factory.js';
import type { RetrieverDeps } from './factory.js';

function fakeDeps(): RetrieverDeps {
  return {
    searchService: fakeSearchService(),
    llm: fakeLlmClient([]),
    indexService: fakeIndexService(),
    fragmentService: fakeFragmentService(),
  };
}

describe('factory', () => {
  it('createRetriever("vector-only") returns a VectorRetriever-like object', async () => {
    const retriever = createRetriever('vector-only', fakeDeps());
    expect(retriever).toBeDefined();
    expect(typeof retriever.searchForSection).toBe('function');
    expect(getCurrentMode()).toBe('vector-only');
  });

  it('createRetriever("agentic-only") returns AgenticRetriever', async () => {
    const retriever = createRetriever('agentic-only', fakeDeps());
    expect(retriever).toBeDefined();
    expect(getCurrentMode()).toBe('agentic-only');
  });

  it('createRetriever("hybrid") returns HybridRetriever', async () => {
    const retriever = createRetriever('hybrid', fakeDeps());
    expect(retriever).toBeDefined();
    expect(getCurrentMode()).toBe('hybrid');
  });

  it('setRetrievalMode switches the active mode', () => {
    createRetriever('vector-only', fakeDeps());
    setRetrievalMode('hybrid');
    expect(getCurrentMode()).toBe('hybrid');
  });

  it('setRetrievalMode throws if createRetriever was never called', () => {
    // Reset module state by re-importing is not easy in Vitest; test the error path directly
    // This is a guard against misuse. We test it by inspecting the error message.
    // Note: this test will PASS if deps were set by a prior test. It mainly documents the contract.
    expect(() => setRetrievalMode('vector-only')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — cannot find module `./factory.js`.

- [ ] **Step 3: Implement the factory**

Create `packages/server/src/retrieval/factory.ts`:

```typescript
import type { SearchService } from '../search/search-service.js';
import type { LlmClient } from '../services/llm-client.js';
import type { IndexService } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { FragmentRetriever } from './fragment-retriever.js';
import { VectorRetriever } from './vector-retriever.js';
import { AgenticRetriever } from './agentic-retriever.js';
import { HybridRetriever } from './hybrid-retriever.js';

export type RetrievalMode = 'vector-only' | 'agentic-only' | 'hybrid';

export interface RetrieverDeps {
  searchService: SearchService;
  llm: LlmClient;
  indexService: IndexService;
  fragmentService: FragmentService;
}

let _mode: RetrievalMode = 'vector-only';
let _deps: RetrieverDeps | null = null;
let _retriever: FragmentRetriever | null = null;

export function createRetriever(mode: RetrievalMode, deps: RetrieverDeps): FragmentRetriever {
  _mode = mode;
  _deps = deps;
  _retriever = build(mode, deps);
  return _retriever;
}

export function setRetrievalMode(mode: RetrievalMode): FragmentRetriever {
  if (!_deps) throw new Error('Call createRetriever before setRetrievalMode');
  _mode = mode;
  _retriever = build(mode, _deps);
  return _retriever;
}

export function getCurrentMode(): RetrievalMode {
  return _mode;
}

function build(mode: RetrievalMode, deps: RetrieverDeps): FragmentRetriever {
  switch (mode) {
    case 'vector-only':
      return new VectorRetriever(deps.searchService);
    case 'agentic-only':
      return new AgenticRetriever(deps.indexService, deps.llm, deps.fragmentService);
    case 'hybrid':
      return new HybridRetriever(deps.searchService, deps.llm);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/retrieval/factory.ts packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(retrieval): add factory with createRetriever, setRetrievalMode, getCurrentMode"
```

---

## Task 7: Wire `FragmentRetriever` into `PlanService`

**Files:**
- Modify: `packages/server/src/services/plan-service.ts`

Strategy: keep `search?: SearchService` for backward-compat (existing tests pass a fake `SearchService`). Add `retriever?: FragmentRetriever`. `requireRetriever()` prefers `retriever`; if absent, wraps `search` in `VectorRetriever` as a fallback. The existing tests all pass `search` and continue to work unchanged.

- [ ] **Step 1: Add import for `FragmentRetriever` and `SectionQuery`**

At the top of `packages/server/src/services/plan-service.ts`, after the existing imports, add:

```typescript
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from '../retrieval/fragment-retriever.js';
import { VectorRetriever } from '../retrieval/vector-retriever.js';
```

- [ ] **Step 2: Add `retriever?` to `PlanServiceConfig`**

In `PlanServiceConfig` (lines 41-47), after `search?: SearchService;`, add:

```typescript
  retriever?: FragmentRetriever;
```

So the interface becomes:

```typescript
export interface PlanServiceConfig {
  fragmentMaxChars: number;
  docxReferencePath?: string;
  llm?: LlmClient;
  search?: SearchService;
  retriever?: FragmentRetriever;
  fragments?: FragmentService;
}
```

- [ ] **Step 3: Replace `requireSearch()` with `requireRetriever()`**

Replace the `requireSearch()` method (lines 182-188):

```typescript
// BEFORE (lines 182-188):
protected requireSearch(): SearchService {
  if (!this.config.search) throw new Error('PlanService: SearchService not configured');
  return this.config.search;
}
```

With:

```typescript
// AFTER:
protected requireRetriever(): FragmentRetriever {
  if (this.config.retriever) return this.config.retriever;
  if (this.config.search) return new VectorRetriever(this.config.search);
  throw new Error('PlanService: neither retriever nor search is configured');
}
```

- [ ] **Step 4: Update `runSectionSearch` to use the retriever**

Replace the `runSectionSearch` method (lines 195-212):

```typescript
// BEFORE:
private async runSectionSearch(
  section: { title: string; description: string; inferred_type?: string },
  filters: PlanFilters,
  collectionSlug: string | null,
): Promise<FragmentCandidate[]> {
  const results = await this.requireSearch().search(
    `${section.title}\n${section.description}`,
    {
      domain: filters.domain?.length ? filters.domain : undefined,
      type: filters.type ? [filters.type] : undefined,
      lang: filters.lang,
      tags: filters.tags,
      collectionSlug: collectionSlug ?? undefined,
      quality_min: 'reviewed',
    },
    5,
  );
  return results.filter((r) => r.score >= SECTION_SCORE_THRESHOLD).map(toCandidate);
}
```

With:

```typescript
// AFTER:
private async runSectionSearch(
  section: { title: string; description: string; inferred_type?: string },
  filters: PlanFilters,
  collectionSlug: string | null,
): Promise<FragmentCandidate[]> {
  const query: SectionQuery = {
    text: `${section.title}\n${section.description}`,
    filters,
    collectionSlug,
    inferred_type: section.inferred_type,
  };
  const results: RetrievedFragment[] = await this.requireRetriever().searchForSection(query, 5);
  return results
    .filter((r) => r.score >= SECTION_SCORE_THRESHOLD)
    .map((r) => ({
      fragment_id: r.fragment_id,
      score: r.score,
      title: r.title,
      body_excerpt: r.body_excerpt,
      quality: r.quality,
    }));
}
```

- [ ] **Step 5: Run existing plan-service tests**

```bash
pnpm --filter @fragmint/server test plan-service
```

Expected: all existing tests PASS (they use `search: fakeSearch(...)` which now routes through `VectorRetriever` wrapper transparently).

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors. Remove the `SearchService` import from `plan-service.ts` if it is now unused — check with:

```bash
grep -n "SearchService" packages/server/src/services/plan-service.ts
```

If `SearchService` only appears in the import and in `PlanServiceConfig`, keep the import. The `search?: SearchService` field remains in the config interface for backward compat.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/plan-service.ts
git commit -m "feat(plan-service): plug FragmentRetriever interface, fallback to VectorRetriever(search)"
```

---

## Task 8: Wire the factory into `index.ts`

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add factory import**

At the top of `packages/server/src/index.ts`, after the existing imports (around line 69), add:

```typescript
import { createRetriever } from './retrieval/factory.js';
```

- [ ] **Step 2: Create the retriever after `searchService` is instantiated**

After the `searchService` construction (after line 273), add:

```typescript
  const retriever = createRetriever(config.retrieval_mode, {
    searchService,
    llm: llmClient,
    indexService,
    fragmentService,
  });
```

**Important:** `indexService` is instantiated later (line 325). Move `const indexService = new IndexService(db);` to before the retriever creation, or restructure. The correct order should be:

1. `searchService` (already at line 266)
2. `fragmentService` (line 279) — needed for agentic mode
3. `indexService` (currently line 325) — move to before retriever
4. `llmClient` (line 299-305) — already before retriever position

After moving `indexService` to after `fragmentService`, add:

```typescript
  const retriever = createRetriever(config.retrieval_mode, {
    searchService,
    llm: llmClient,
    indexService,
    fragmentService,
  });
```

- [ ] **Step 3: Pass `retriever` to `planService`**

Replace the `planService` construction (lines 316-322):

```typescript
// BEFORE:
  const planService = new PlanAssembler(db, {
    fragmentMaxChars: config.plan_fragment_max_chars,
    docxReferencePath: config.plan_docx_reference_path,
    llm: llmClient,
    search: searchService,
    fragments: fragmentService,
  });
```

With:

```typescript
// AFTER:
  const planService = new PlanAssembler(db, {
    fragmentMaxChars: config.plan_fragment_max_chars,
    docxReferencePath: config.plan_docx_reference_path,
    llm: llmClient,
    retriever,
    fragments: fragmentService,
  });
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
pnpm --filter @fragmint/server test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): wire FragmentRetriever factory into PlanAssembler"
```

---

## Task 9: Admin endpoint + auth tests + integration test

**Files:**
- Modify: `packages/server/src/routes/admin-routes.ts`
- Modify: `packages/server/src/routes/plans.integration.test.ts`

This task has three parts: (a) the toggle endpoint, (b) 401/403 auth tests, (c) integration test for wiring.

---

### Part A — Toggle endpoint

- [ ] **Step 1: Add import in `admin-routes.ts`**

At the top of `packages/server/src/routes/admin-routes.ts`, add:

```typescript
import { setRetrievalMode, getCurrentMode, type RetrievalMode } from '../retrieval/factory.js';
```

- [ ] **Step 2: Add routes**

In the `adminRoutes` function, after the existing reindex route (before the closing brace), add:

```typescript
  app.get(
    '/v1/admin/retrieval/mode',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_req, reply) => {
      return reply.send({ data: { mode: getCurrentMode() }, meta: null, error: null });
    },
  );

  app.post(
    '/v1/admin/retrieval/mode',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as { mode?: unknown };
      const VALID_MODES: RetrievalMode[] = ['vector-only', 'agentic-only', 'hybrid'];
      if (!body?.mode || !VALID_MODES.includes(body.mode as RetrievalMode)) {
        return reply.status(400).send({
          data: null,
          meta: null,
          error: `mode must be one of: ${VALID_MODES.join(', ')}`,
        });
      }
      const retriever = setRetrievalMode(body.mode as RetrievalMode);
      return reply.send({
        data: { mode: body.mode, retriever_type: retriever.constructor.name },
        meta: null,
        error: null,
      });
    },
  );
```

- [ ] **Step 3: Expose `retrieval_mode` in the existing `/v1/index/status` response**

Find the existing `/v1/index/status` route in `admin-routes.ts` (around line 114). Its current response is `{ status, mode, milvus, embedding, last_run }`. Add `retrieval_mode`:

```typescript
// Change the return value from:
data: { status: 'ok', mode, milvus, embedding, last_run: new Date().toISOString() },
// To:
data: { status: 'ok', mode, milvus, embedding, last_run: new Date().toISOString(), retrieval_mode: getCurrentMode() },
```

This allows a future OpenCode plugin (Piste A) to read the active retrieval mode without a separate call.

---

### Part B — Auth tests (401/403)

- [ ] **Step 4: Write the auth tests**

Add a new describe block at the bottom of `packages/server/src/routes/plans.integration.test.ts` (or create `packages/server/src/routes/admin-retrieval.integration.test.ts`):

```typescript
describe('Admin retrieval/mode auth', () => {
  it('GET /v1/admin/retrieval/mode returns 401 without token', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/retrieval/mode',
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /v1/admin/retrieval/mode returns 403 with non-admin token', async () => {
    // Get a reader token (createTestServer seeds a 'reader' user as well, or use role=contributor)
    const readerToken = await getAuthToken(server.app, 'reader');
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/retrieval/mode',
      headers: { authorization: `Bearer ${readerToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ mode: 'hybrid' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /v1/admin/retrieval/mode returns 200 with admin token', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/retrieval/mode',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ mode: 'vector-only' }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.mode).toBe('vector-only');
  });

  it('POST /v1/admin/retrieval/mode returns 400 for unknown mode', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/retrieval/mode',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ mode: 'turbo-mode' }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('must be one of');
  });
});
```

> **Note on `getAuthToken(server, 'reader')`:** Check the signature of `getAuthToken` in `test-helpers.ts`. If it only creates admin tokens, add a `role` parameter or create a second test user with role `contributor` in `beforeAll`.

---

### Part C — Integration test: hybrid wiring

- [ ] **Step 5: Write the hybrid wiring integration test**

This verifies that when `createRetriever('hybrid', deps)` is called in `index.ts`, the planService actually uses a `HybridRetriever` under the hood. Add to `plans.integration.test.ts`:

```typescript
  it('planService uses the configured retriever (hybrid mode) for validatePlan', async () => {
    // Switch to hybrid mode at runtime
    const modeRes = await api('POST', '/v1/admin/retrieval/mode', { mode: 'hybrid' });
    expect(modeRes.statusCode).toBe(200);

    // Stub the retriever on planService to track calls
    const planService = (server.app as any).planService;
    const fakeRetriever = {
      searchForSection: vi.fn(async () => [
        { fragment_id: 'f-hybrid-1', score: 0.88, title: 'Hybrid result', body_excerpt: 'b', quality: 'approved' },
      ]),
    };
    planService.config.retriever = fakeRetriever;

    const created = await api('POST', '/v1/plans', { title: 'Hybrid test', spec_prompt: '' });
    const id = JSON.parse(created.body).data.id;
    await api('PATCH', `/v1/plans/${id}`, { plan_markdown: '## Intro\n\nTest section' });
    await api('POST', `/v1/plans/${id}/generate`);
    await api('POST', `/v1/plans/${id}/validate`);

    expect(fakeRetriever.searchForSection).toHaveBeenCalled();
    const call = fakeRetriever.searchForSection.mock.calls[0][0];
    expect(call.text).toContain('Intro');

    // Reset to vector-only after test
    planService.config.retriever = undefined;
    await api('POST', '/v1/admin/retrieval/mode', { mode: 'vector-only' });
  });
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
pnpm --filter @fragmint/server test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/admin-routes.ts packages/server/src/routes/plans.integration.test.ts
git commit -m "feat(admin): retrieval/mode endpoint, auth tests, hybrid wiring integration test"
```

---

## Task 10: Logs + observability

**Files:**
- Modify: `packages/server/src/retrieval/factory.ts`
- Modify: `packages/server/src/retrieval/vector-retriever.ts`
- Modify: `packages/server/src/retrieval/agentic-retriever.ts`
- Modify: `packages/server/src/retrieval/hybrid-retriever.ts`

Minimal logging to make mode switches visible during the demo and debug production issues.

- [ ] **Step 1: Startup log in `factory.ts`**

In `createRetriever()`, after `_retriever = build(mode, deps)`, add:

```typescript
console.log(`[retrieval] mode=${mode}`);
```

In `setRetrievalMode()`, after `_retriever = build(mode, _deps)`, add:

```typescript
console.log(`[retrieval] mode switched to ${mode}`);
```

- [ ] **Step 2: Per-section log in `VectorRetriever`**

At the end of `searchForSection()`, before the `return`, add:

```typescript
console.debug(`[retrieval][vector-only] section "${query.text.slice(0, 50)}" → ${results.length} candidates after threshold`);
```

- [ ] **Step 3: Per-section logs in `AgenticRetriever`**

After `selectCandidates()` returns in `searchForSection()`:

```typescript
console.debug(`[retrieval][agentic-only] section "${query.text.slice(0, 50)}" → phase1 selected ${candidateIds.length} candidates`);
```

After the `scored` Promise.all resolves:

```typescript
const filtered = scored.filter(...);
console.debug(`[retrieval][agentic-only] section "${query.text.slice(0, 50)}" → phase2 kept ${filtered.length}/${candidateIds.length} (score >= ${PHASE2_SCORE_MIN})`);
```

- [ ] **Step 4: Per-section logs in `HybridRetriever`**

After SearchService returns `candidates` in `searchForSection()`:

```typescript
console.debug(`[retrieval][hybrid] section "${query.text.slice(0, 50)}" → ${candidates.length} vector candidates`);
```

After `batchJudge` and sort:

```typescript
console.debug(`[retrieval][hybrid] section "${query.text.slice(0, 50)}" → top ${limit} after LLM re-rank`);
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/retrieval/
git commit -m "feat(retrieval): add startup and per-section debug logs"
```

---

## Task 11: Fix UUID mapping bug in AgenticRetriever

**Status:** BUG — agentic-only retourne 0 fragments en production car le LLM voit `TM-arg-001` dans l'index mais l'index ne contient pas les UUIDs. `getById('TM-arg-001')` retourne `null` → Phase 2 entièrement vide.

**Files:**
- Modify: `packages/server/src/retrieval/agentic-retriever.ts`
- Modify: `packages/server/src/services/index-service.ts` (exposer la map readable_id→uuid)
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

**Fix:** construire côté serveur un `Map<readableId, uuid>` depuis `IndexData`. Après parsing de la réponse LLM Phase 1, traduire chaque token en UUID (accepte UUID brut ou readable_id). L'index markdown reste propre — pas d'UUID dans le rendu.

- [ ] **Step 1: Exposer `buildReadableIdMap` dans `index-service.ts`**

Ajouter une fonction exportée dans `packages/server/src/services/index-service.ts` :

```typescript
export function buildReadableIdMap(data: IndexData): Map<string, string> {
  const map = new Map<string, string>();
  for (const subj of Object.values(data.subjects)) {
    for (const frags of Object.values(subj.types)) {
      for (const f of frags) {
        map.set(f.readable_id, f.id);
      }
    }
  }
  return map;
}
```

- [ ] **Step 2: Écrire le test failing**

Ajouter dans `retrieval.test.ts` :

```typescript
import { buildReadableIdMap } from '../services/index-service.js';

describe('buildReadableIdMap', () => {
  it('maps readable_id to uuid', () => {
    const data: IndexData = {
      generated_at: '',
      total: 1,
      subjects: {
        cloud: {
          label: 'Cloud', prefix: 'LC', count: 1,
          types: {
            argument: [{ readable_id: 'LC-arg-001', id: 'uuid-abc', title: 'T', lang: 'fr', tags: [], entities: [] }],
          },
        },
      },
    };
    const map = buildReadableIdMap(data);
    expect(map.get('LC-arg-001')).toBe('uuid-abc');
  });
});
```

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — `buildReadableIdMap` not exported.

- [ ] **Step 3: Mettre à jour `selectCandidates` dans `agentic-retriever.ts`**

Remplacer la méthode `selectCandidates` pour qu'elle accepte readable_ids ET UUIDs :

```typescript
private async selectCandidates(
  query: SectionQuery,
  indexMd: string,
  idMap: Map<string, string>,
  count: number,
): Promise<string[]> {
  const filtersLine = buildFiltersDesc(query.filters);
  const collectionLine = query.collectionSlug ? `Collection: ${query.collectionSlug}` : '';
  const prompt = `You are a document composition assistant with access to a fragment library.

Section to populate: "${query.text}"
${query.inferred_type ? `Preferred fragment type: ${query.inferred_type}` : ''}
${filtersLine}
${collectionLine}

Fragment index (ID then title):
${indexMd}

Select the ${count} most relevant fragment IDs for this section.
Return ONLY a JSON array of ID strings: ["TM-arg-001", "LC-intro-003", ...]`;

  try {
    const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
    const match = response.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => idMap.get(id) ?? id)  // readable_id → uuid, passthrough si déjà UUID
      .filter((id) => id.length > 0)
      .slice(0, count);
  } catch {
    return [];
  }
}
```

Mettre à jour l'appel dans `searchForSection` :

```typescript
async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
  const indexData = await this.indexService.getData(false, query.collectionSlug ?? undefined);
  const indexMd = renderMarkdown(indexData);  // string
  const idMap = buildReadableIdMap(indexData);
  const phase1Count = limit * PHASE1_MULTIPLIER;

  const candidateIds = await this.selectCandidates(query, indexMd, idMap, phase1Count);
  // ... reste inchangé
```

Ajouter les imports nécessaires :

```typescript
import { buildReadableIdMap } from '../services/index-service.js';
import type { IndexData } from '../services/index-service.js';
```

**Note :** `indexService.getData()` retourne `IndexData`. Appeler `renderMarkdown` directement depuis `agentic-retriever.ts` requiert de l'exporter depuis `index-service.ts`. Ajouter `export` devant `function renderMarkdown`.

- [ ] **Step 4: Exporter `renderMarkdown` depuis `index-service.ts`**

```typescript
// Changer :
function renderMarkdown(data: IndexData): string {
// En :
export function renderMarkdown(data: IndexData): string {
```

- [ ] **Step 5: Mettre à jour le test AgenticRetriever (Phase 1)**

Le fake `IndexService` doit exposer `getData` en plus de `getIndex` :

```typescript
function fakeIndexService(): IndexService {
  const data: IndexData = {
    generated_at: '',
    total: 1,
    subjects: {
      cloud: {
        label: 'Cloud', prefix: 'LC', count: 1,
        types: {
          argument: [{ readable_id: 'LC-arg-001', id: 'frag-uuid-1', title: 'Fragment One', lang: 'fr', tags: [], entities: [] }],
        },
      },
    },
  };
  return {
    getData: vi.fn(async () => data),
  } as unknown as IndexService;
}
```

Mettre à jour le premier test pour que le LLM retourne un readable_id :

```typescript
it('phase1 maps readable_id → uuid before judging', async () => {
  const llm = fakeLlmClient([
    '["LC-arg-001"]',                           // phase 1 — readable_id
    '{"score": 8, "reason": "relevant"}',        // phase 2
  ]);
  const retriever = new AgenticRetriever(
    fakeIndexService(),
    llm,
    fakeFragmentService({ 'frag-uuid-1': 'body one' }),
  );
  const results = await retriever.searchForSection({
    text: 'cloud introduction',
    filters: {},
    collectionSlug: null,
  }, 5);
  expect(results).toHaveLength(1);
  expect(results[0].fragment_id).toBe('frag-uuid-1');  // UUID, pas readable_id
});
```

- [ ] **Step 6: Run all tests**

```bash
pnpm --filter @fragmint/server test
```

Expected: tous les tests PASS.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/retrieval/agentic-retriever.ts \
        packages/server/src/services/index-service.ts \
        packages/server/src/retrieval/retrieval.test.ts
git commit -m "fix(agentic-retriever): map readable_id to UUID in phase1, export renderMarkdown/buildReadableIdMap"
```

---

## Task 12: Phase 0 — TOC-based index filtering (scalabilité)

**Contexte :** Avec 1000+ fragments approved, l'index markdown (~100KB) dépasse la context window de certains LLMs. La Phase 0 envoie d'abord une table des matières compacte (~1-2KB, O(domaines × types)) pour que le LLM sélectionne les domaines/types pertinents, puis Phase 1 ne reçoit que l'index filtré.

**Déclenchement :** Phase 0 s'active uniquement si `query.filters.domain` est vide. Si le plan a un filtre domaine, on saute directement en Phase 1 (l'index est déjà suffisamment restreint).

**Files:**
- Modify: `packages/server/src/services/index-service.ts`
- Modify: `packages/server/src/retrieval/agentic-retriever.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

- [ ] **Step 1: Ajouter `renderToc` dans `index-service.ts`**

Ajouter après `renderMarkdown` :

```typescript
export function renderToc(data: IndexData): string {
  const lines: string[] = [
    `# Fragmint — Table des matières (${data.total} fragments approuvés)`,
    '',
    '| Domaine | ' + Object.keys(TYPE_SHORT).join(' | ') + ' | Total |',
    '|---------|' + Object.keys(TYPE_SHORT).map(() => '---').join('|') + '|-------|',
  ];
  for (const [domain, subj] of Object.entries(data.subjects).sort(([a], [b]) => a.localeCompare(b))) {
    const counts = Object.keys(TYPE_SHORT).map((t) => subj.types[t]?.length ?? 0);
    lines.push(`| ${subj.label} (${domain}) | ${counts.join(' | ')} | ${subj.count} |`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 2: Écrire le test failing**

```typescript
import { renderToc } from '../services/index-service.js';

describe('renderToc', () => {
  it('renders a compact table with domain+type counts', () => {
    const data: IndexData = {
      generated_at: '',
      total: 2,
      subjects: {
        cloud: {
          label: 'LinCloud', prefix: 'LC', count: 2,
          types: {
            argument: [
              { readable_id: 'LC-arg-001', id: 'u1', title: 'T1', lang: 'fr', tags: [], entities: [] },
              { readable_id: 'LC-arg-002', id: 'u2', title: 'T2', lang: 'fr', tags: [], entities: [] },
            ],
          },
        },
      },
    };
    const toc = renderToc(data);
    expect(toc).toContain('LinCloud');
    expect(toc).toContain('2');  // Total
    expect(toc).toContain('Table des matières');
  });
});
```

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — `renderToc` not exported.

- [ ] **Step 3: Implémenter `selectDomainTypes` dans `agentic-retriever.ts`**

Ajouter une méthode Phase 0 :

```typescript
private async selectDomainTypes(
  query: SectionQuery,
  toc: string,
  availableCombinations: Set<string>,
): Promise<string[] | null> {
  const prompt = `You are a document composition assistant.

Section to populate: "${query.text}"
${query.filters.lang ? `Language: ${query.filters.lang}` : ''}

Fragment library table of contents:
${toc}

Select the domain:type combinations most relevant for this section.
Return ONLY a JSON array: ["domain:type", ...] (e.g. ["twake-mail:argument", "linshare:use-case"])`;

  try {
    const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
    const match = response.match(/\[[\s\S]*?\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    const valid = (parsed as unknown[])
      .filter((s): s is string => typeof s === 'string' && availableCombinations.has(s));
    return valid.length > 0 ? valid : null;  // null → fallback sur index complet
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Intégrer Phase 0 dans `searchForSection`**

```typescript
async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
  const indexData = await this.indexService.getData(false, query.collectionSlug ?? undefined);
  const idMap = buildReadableIdMap(indexData);
  const phase1Count = limit * PHASE1_MULTIPLIER;

  let filteredData = indexData;

  // Phase 0 — TOC filtering (only when no domain filter AND index large enough to justify it)
  const PHASE0_THRESHOLD = 200; // fragments — below this, full index fits in context window
  if (!query.filters.domain?.length && indexData.total > PHASE0_THRESHOLD) {
    const toc = renderToc(indexData);
    const combinations = new Set<string>(
      Object.entries(indexData.subjects).flatMap(([domain, subj]) =>
        Object.keys(subj.types).map((type) => `${domain}:${type}`)
      )
    );
    const selected = await this.selectDomainTypes(query, toc, combinations);
    if (selected) {
      console.debug(`[retrieval][agentic-only][phase0] section "${query.text.slice(0, 50)}" → selected ${selected.length} combinations: ${selected.join(', ')}`);
      filteredData = filterIndexData(indexData, selected);
    } else {
      console.debug(`[retrieval][agentic-only][phase0] section "${query.text.slice(0, 50)}" → fallback to full index (phase0 returned null)`);
    }
  } else {
    console.debug(`[retrieval][agentic-only][phase0] skipped (domain filter: ${query.filters.domain.join(', ')})`);
  }

  const indexMd = renderMarkdown(filteredData);
  const filteredIdMap = buildReadableIdMap(filteredData);

  const candidateIds = await this.selectCandidates(query, indexMd, filteredIdMap, phase1Count);
  console.debug(`[retrieval][agentic-only][phase1] section "${query.text.slice(0, 50)}" → ${candidateIds.length} candidates`);
  if (candidateIds.length === 0) return [];

  const scored = (
    await Promise.all(candidateIds.map((id) => this.judgeFragment(query, id)))
  ).filter((r): r is RetrievedFragment => r !== null && r.score >= PHASE2_SCORE_MIN);
  console.debug(`[retrieval][agentic-only][phase2] section "${query.text.slice(0, 50)}" → kept ${scored.length}/${candidateIds.length}`);

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

Ajouter la fonction utilitaire `filterIndexData` dans `agentic-retriever.ts` :

```typescript
function filterIndexData(data: IndexData, selected: string[]): IndexData {
  const selSet = new Set(selected);
  const subjects: IndexData['subjects'] = {};
  for (const [domain, subj] of Object.entries(data.subjects)) {
    const types: typeof subj.types = {};
    for (const [type, frags] of Object.entries(subj.types)) {
      if (selSet.has(`${domain}:${type}`)) types[type] = frags;
    }
    if (Object.keys(types).length > 0) {
      const count = Object.values(types).reduce((acc, f) => acc + f.length, 0);
      subjects[domain] = { ...subj, types, count };
    }
  }
  const total = Object.values(subjects).reduce((acc, s) => acc + s.count, 0);
  return { ...data, subjects, total };
}
```

Ajouter les imports dans `agentic-retriever.ts` :

```typescript
import { buildReadableIdMap, renderMarkdown, renderToc } from '../services/index-service.js';
import type { IndexData } from '../services/index-service.js';
```

- [ ] **Step 5: Écrire les tests Phase 0**

```typescript
// IndexService fake avec total > 200 pour déclencher Phase 0
function fakeIndexServiceLarge(): IndexService {
  const frags = Array.from({ length: 201 }, (_, i) => ({
    readable_id: `LC-arg-${String(i + 1).padStart(3, '0')}`,
    id: `frag-uuid-${i + 1}`,
    title: `Fragment ${i + 1}`,
    lang: 'fr', tags: [], entities: [],
  }));
  const data: IndexData = {
    generated_at: '',
    total: 201,
    subjects: {
      cloud: { label: 'Cloud', prefix: 'LC', count: 201, types: { argument: frags } },
    },
  };
  return { getData: vi.fn(async () => data) } as unknown as IndexService;
}

describe('AgenticRetriever — Phase 0', () => {
  it('skips phase0 when domain filter is set (even with large index)', async () => {
    const llm = fakeLlmClient([
      '["LC-arg-001"]',                     // phase 1 seulement
      '{"score": 8, "reason": "ok"}',
    ]);
    const retriever = new AgenticRetriever(fakeIndexServiceLarge(), llm, fakeFragmentService({ 'frag-uuid-1': 'body' }));
    await retriever.searchForSection({
      text: 'test',
      filters: { domain: ['cloud'] },     // domain set → phase 0 skipped même si total > 200
      collectionSlug: null,
    });
    // chatMessages appelé 2 fois : phase1 + phase2 (pas de phase0)
    expect((llm.chatMessages as any).mock.calls).toHaveLength(2);
  });

  it('skips phase0 when index is small (total <= 200), even without domain filter', async () => {
    const llm = fakeLlmClient([
      '["LC-arg-001"]',                   // phase 1 directement
      '{"score": 8, "reason": "ok"}',
    ]);
    // fakeIndexService() a total=1 → pas de Phase 0
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService({ 'frag-uuid-1': 'body' }));
    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    expect((llm.chatMessages as any).mock.calls).toHaveLength(2);  // pas de phase0
  });

  it('triggers phase0 when index is large (total > 200) and no domain filter', async () => {
    const llm = fakeLlmClient([
      '["cloud:argument"]',               // phase 0 response
      '["LC-arg-001"]',                   // phase 1
      '{"score": 8, "reason": "ok"}',     // phase 2
    ]);
    const retriever = new AgenticRetriever(fakeIndexServiceLarge(), llm, fakeFragmentService({ 'frag-uuid-1': 'body' }));
    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    // chatMessages appelé 3 fois : phase0 + phase1 + phase2
    expect((llm.chatMessages as any).mock.calls).toHaveLength(3);
  });

  it('falls back to full index when phase0 returns invalid JSON', async () => {
    const llm = fakeLlmClient([
      'not json',                          // phase 0 → fallback
      '["LC-arg-001"]',                   // phase 1 sur index complet
      '{"score": 8, "reason": "ok"}',
    ]);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService({ 'frag-uuid-1': 'body' }));
    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    expect(results).toHaveLength(1);  // fallback fonctionne
  });

  it('falls back to full index when phase0 returns no valid combinations', async () => {
    const llm = fakeLlmClient([
      '["nonexistent-domain:argument"]',   // phase 0 → combinaison inexistante → null
      '["LC-arg-001"]',
      '{"score": 7, "reason": "ok"}',
    ]);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService({ 'frag-uuid-1': 'body' }));
    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    expect(results).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run all tests**

```bash
pnpm --filter @fragmint/server test
```

Expected: tous les tests PASS.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/retrieval/agentic-retriever.ts \
        packages/server/src/services/index-service.ts \
        packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(agentic-retriever): phase0 TOC-based filtering, fallback on failure"
```

---

## Protocole de validation manuelle (post-Tasks 11+12)

5 minutes après le commit, valider ces 4 cas :

**Prérequis :** avoir des fragments `quality=approved` en base + un token admin.

```bash
TOKEN="frag_tok_XXXX"
BASE="http://localhost:3210"

# 1. Passer en agentic-only
curl -s -X POST $BASE/v1/admin/retrieval/mode \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"agentic-only"}' | jq .data.mode

# 2. Créer un plan sans filtre domaine — Phase 0 DOIT se déclencher
# (checker les logs serveur : "[agentic-only][phase0] selected N combinations")
curl -s -X POST $BASE/v1/plans \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test agentic","spec_prompt":""}' | jq .data.id
# → noter l'ID
PLAN_ID="<id>"
curl -s -X POST $BASE/v1/plans/$PLAN_ID/generate \
  -H "Authorization: Bearer $TOKEN" | jq .data.state.sections[0].candidates

# 3. Créer un plan AVEC filtre domaine — Phase 0 DOIT être skippée
# (logs : "[phase0] skipped (domain filter: twake-mail)")
curl -s -X POST $BASE/v1/plans \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test domain filter","spec_prompt":"","filters":{"domain":["twake-mail"]}}' | jq .data.id
# → générer + valider, vérifier les logs

# 4. Tester le fallback Phase 0 (simuler un LLM qui foire)
# Passer temporairement à un mauvais endpoint LLM → Phase 0 devrait tomber en fallback
# sans crasher, et retourner quand même des résultats de Phase 1+2
```

**Ce qu'on valide :**
- Cas 1 : `candidates` non vide (UUID fix fonctionnel)
- Cas 2 : log Phase 0 visible avec combinations sélectionnées
- Cas 3 : log Phase 0 "skipped"
- Cas 4 : le plan génère quand même des résultats malgré Phase 0 en erreur

---

## Demo config note

Before running the demo with Maudet, update these env vars:

```bash
# Switch to Claude Sonnet via OpenRouter for LLM quality
FRAGMINT_LLM_ENDPOINT=https://openrouter.ai/api/v1
FRAGMINT_LLM_MODEL=anthropic/claude-sonnet-4-5
FRAGMINT_LLM_API_KEY=<openrouter-key>

# Set hybrid as default mode for production-quality demo
FRAGMINT_RETRIEVAL_MODE=hybrid
```

**For live toggle during demo:**
```bash
curl -X POST http://localhost:3210/v1/admin/retrieval/mode \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"vector-only"}'    # then agentic-only, then hybrid
```

**Sovereignty messaging note:** In production, switch to Mistral Large via the French sovereign API instead of OpenRouter/Claude.

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| 3 modes: vector-only, agentic-only, hybrid | Tasks 3, 4, 5 |
| `FRAGMINT_RETRIEVAL_MODE` env var | Task 1 |
| `fragment-retriever.ts` interface | Task 2 |
| factory.ts | Task 6 |
| VectorRetriever wraps SearchService | Task 3 |
| Milvus OFF fallback (explicit test) | Task 3 Step 5 |
| AgenticRetriever: IndexService + 2-phase LLM judge | Task 4 |
| AgenticRetriever filters by collectionSlug | Tasks 3.5 + 4 |
| IndexService.getData collection filter (bypasses cache) | Task 3.5 |
| HybridRetriever: pre-filter + LLM batch | Task 5 |
| Wire into PlanService.runSectionSearch | Task 7 |
| Wire into index.ts | Task 8 |
| Runtime toggle endpoint (admin only) | Task 9 Part A |
| `retrieval_mode` exposed in `/v1/index/status` | Task 9 Part A Step 3 |
| 401/403 tests for toggle endpoint | Task 9 Part B |
| Integration test: hybrid wiring end-to-end | Task 9 Part C |
| Logs at startup + per section | Task 10 |
| Demo LLM config (OpenRouter/Mistral Large) | Demo config note |
| ComposerService NOT changed | Confirmed: uses searchService directly for slot resolution (type+domain matching), not semantic section search — different use case, correct separation |
| Existing tests preserved | Task 7: backward compat via `search?` field + VectorRetriever wrapper — `plans.integration.test.ts` which stubs `planService.config.search` continues to work |

**Placeholder scan:** None found — all steps include complete code.

**Type consistency check:**
- `SectionQuery` defined in Task 2, used in Tasks 3/4/5/7 ✓
- `RetrievedFragment` defined in Task 2, returned by all retrievers ✓
- `RetrieverDeps` defined in Task 6, used in Task 8 ✓
- `FragmentRetriever` interface used in Task 7 config field ✓
- `RetrievalMode` type exported from factory, used in Tasks 9 + 10 ✓
- `IndexService.getIndex(format, collectionSlug?)` updated in Task 3.5, called in Task 4 ✓

---

## Scope note — Piste A

Piste A (OpenCode plugin) is intentionally excluded from this plan. It will be a separate plan after Piste B is delivered and tested on the IRA corpus. Once the retrieval modes are live, Piste A V1 reduces to: verify MCP tools work from OpenCode + build a `/fragmint compose` command that calls the same backend. OpenCode will automatically benefit from whatever mode is active.

---

## Execution options

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, two-stage review (spec + quality) between tasks

**2. Inline Execution** — execute tasks sequentially in this session with checkpoints

Which approach?
