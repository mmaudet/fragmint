# SQLite Keyword Augmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite LIKE keyword search as a second candidate source in `HybridRetriever` and `VectorRetriever` so domain-specific fragments (e.g. MIRAI) surface even when the embedding model fails to discriminate.

**Architecture:** Expose `SearchService.sqliteSearch` as a public `keywordSearch` method. In each retriever, call it after the vector search, merge by ID (vector takes priority), then proceed with the existing ranking logic on the combined pool.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, Fastify 5

---

### Task 1: Expose `keywordSearch` on `SearchService`

**Files:**
- Modify: `packages/server/src/search/search-service.ts` (add public method after line 375)

- [ ] **Step 1: Add `keywordSearch` public method**

In `packages/server/src/search/search-service.ts`, after the closing `}` of `status()` (line 375) and before `private async sqliteSearch`, add:

```typescript
  async keywordSearch(query: string, filters?: SearchFilters, limit = 20): Promise<SearchResult[]> {
    return this.sqliteSearch(query, filters, limit);
  }
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors

---

### Task 2: Update test helper + add failing tests

**Files:**
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

- [ ] **Step 1: Update `fakeSearchService` to include `keywordSearch`**

Replace the existing `fakeSearchService` function (line 67-71) with:

```typescript
function fakeSearchService(results: SearchResult[] = [], keywordResults: SearchResult[] = []): SearchService {
  return {
    search: vi.fn(async () => results),
    keywordSearch: vi.fn(async () => keywordResults),
  } as unknown as SearchService;
}
```

- [ ] **Step 2: Run existing tests — must still pass**

```bash
pnpm --filter @fragmint/server test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all existing tests pass (HybridRetriever and VectorRetriever tests work because `keywordSearch` returns `[]` by default)

- [ ] **Step 3: Add failing tests for VectorRetriever keyword augmentation**

Add inside the `describe('VectorRetriever', ...)` block, after the last existing test:

```typescript
  it('includes keyword-only fragments from keywordSearch when vector misses them', async () => {
    const vectorResult: SearchResult = { ...SAMPLE_RESULT, id: 'vec-1', score: 0.8 };
    const kwResult: SearchResult = { ...SAMPLE_RESULT, id: 'kw-1', score: null as unknown as number, domain: 'mirai' };
    const svc = fakeSearchService([vectorResult], [kwResult]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection(
      { text: 'présentation MIRAI', filters: {}, collectionSlug: null },
    );
    const ids = results.map((r) => r.fragment_id);
    expect(ids).toContain('vec-1');
    expect(ids).toContain('kw-1');
    expect(results.find((r) => r.fragment_id === 'kw-1')?.score_breakdown?.method).toBe('sqlite_like');
  });

  it('deduplicates fragments present in both vector and keyword results (VectorRetriever)', async () => {
    const shared: SearchResult = { ...SAMPLE_RESULT, id: 'shared-1', score: 0.8 };
    const svc = fakeSearchService([shared], [shared]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
    );
    expect(results.filter((r) => r.fragment_id === 'shared-1')).toHaveLength(1);
  });

  it('calls keywordSearch with the same filters as search', async () => {
    const svc = fakeSearchService([], []);
    const retriever = new VectorRetriever(svc);
    await retriever.searchForSection(
      {
        text: 'security',
        filters: { lang: 'fr', domain: ['cloud'], type: 'argument' },
        collectionSlug: 'my-col',
      },
      3,
    );
    expect(vi.mocked(svc.keywordSearch).mock.calls[0]![1]).toMatchObject({
      lang: 'fr',
      type: ['argument'],
      collectionSlug: 'my-col',
      quality_min: 'approved',
    });
    expect(vi.mocked(svc.keywordSearch).mock.calls[0]![2]).toBe(3);
  });
```

- [ ] **Step 4: Add failing tests for HybridRetriever keyword augmentation**

Add inside `describe('HybridRetriever (RRF)', ...)`, after the last existing test:

```typescript
  it('includes SQLite-only fragments from keywordSearch when LLM scores them high', async () => {
    const vectorResult: SearchResult = { ...SAMPLE_RESULT, id: 'fragmint-1', score: 0.8 };
    const miraiResult: SearchResult = { ...SAMPLE_RESULT, id: 'mirai-1', score: null as unknown as number, domain: 'mirai' };
    const svc = fakeSearchService([vectorResult], [miraiResult]);
    const llmResp = JSON.stringify([
      { id: 'fragmint-1', score: 2 }, // low — dropped by floor
      { id: 'mirai-1', score: 9 },    // high — should surface
    ]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'présentation MIRAI', filters: {}, collectionSlug: null },
      2,
    );
    const ids = results.map((r) => r.fragment_id);
    expect(ids).toContain('mirai-1');
  });

  it('deduplicates fragments present in both vector and keyword results (HybridRetriever)', async () => {
    const shared: SearchResult = { ...SAMPLE_RESULT, id: 'shared-1', score: 0.8 };
    const svc = fakeSearchService([shared], [shared]);
    const llm = fakeLlmClient([JSON.stringify([{ id: 'shared-1', score: 7 }])]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      1,
    );
    expect(results.filter((r) => r.fragment_id === 'shared-1')).toHaveLength(1);
  });

  it('SQLite-only fragment has vector_score:0 and vector_rank:0 in score_breakdown', async () => {
    const kwOnly: SearchResult = { ...SAMPLE_RESULT, id: 'kw-only', score: null as unknown as number };
    const svc = fakeSearchService([], [kwOnly]);
    const llm = fakeLlmClient([JSON.stringify([{ id: 'kw-only', score: 8 }])]);
    const retriever = new HybridRetriever(svc, llm, 60, 'balanced', 0); // floor=0 to not drop it
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      1,
    );
    expect(results).toHaveLength(1);
    expect(results[0].score_breakdown?.vector_score).toBe(0);
    expect(results[0].score_breakdown?.vector_rank).toBe(0);
    expect(results[0].score_breakdown?.llm_score).toBe(8);
  });
```

- [ ] **Step 5: Run new tests — must fail**

```bash
pnpm --filter @fragmint/server test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|×|includes keyword|deduplicates|SQLite-only|calls keyword"
```

Expected: the 6 new tests FAIL (method not yet implemented)

---

### Task 3: Implement keyword augmentation in `VectorRetriever`

**Files:**
- Modify: `packages/server/src/retrieval/vector-retriever.ts`

- [ ] **Step 1: Rewrite `searchForSection`**

Replace the entire `searchForSection` method body (lines 15-54) with:

```typescript
  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { filters, collectionSlug } = query;
    // Domain and tags are soft hints — injected into query text, not hard filters.
    const enrichedText = enrichQueryWithFilters(query.text, filters);
    const searchFilters = {
      type: filters.type ? [filters.type] : undefined,
      lang: filters.lang,
      collectionSlug: collectionSlug ?? undefined,
      quality_min: 'approved' as const,
    };

    const vectorResults = await this.searchService.search(enrichedText, searchFilters, limit);
    const keywordResults = await this.searchService.keywordSearch(enrichedText, searchFilters, limit);

    const seen = new Set(vectorResults.map((r) => r.id));
    const results = [...vectorResults, ...keywordResults.filter((r) => !seen.has(r.id))];

    const filtered = results
      // null score = SQLite LIKE result → always pass through (no threshold)
      // non-null score = Milvus cosine → apply threshold
      .filter((r) => r.score == null || r.score >= SCORE_THRESHOLD)
      .map((r) => {
        const cappedScore = r.score != null ? Math.min(1.0, r.score) : null;
        const breakdown: ScoreBreakdown = r.score != null
          ? { method: 'vector', vector_score: cappedScore! }
          : { method: 'sqlite_like' };

        return {
          fragment_id: r.id,
          score: cappedScore,
          title: r.title,
          body_excerpt: r.body_excerpt,
          quality: r.quality,
          type: r.type,
          score_breakdown: breakdown,
        } satisfies RetrievedFragment;
      });

    console.debug(
      `[retrieval][vector-only] section "${enrichedText.slice(0, 50)}" → ${filtered.length} candidates after threshold`,
    );
    return filtered;
  }
```

- [ ] **Step 2: Run VectorRetriever tests**

```bash
pnpm --filter @fragmint/server test -- --reporter=verbose 2>&1 | grep -E "VectorRetriever|FAIL|PASS"
```

Expected: all VectorRetriever tests pass (including 3 new ones)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors

---

### Task 4: Implement keyword augmentation in `HybridRetriever`

**Files:**
- Modify: `packages/server/src/retrieval/hybrid-retriever.ts`

- [ ] **Step 1: Rewrite `searchForSection`**

Replace the entire `searchForSection` method (lines 39-133) with:

```typescript
  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { filters, collectionSlug } = query;
    // Domain and tags are soft hints — injected into query text, not hard filters.
    const enrichedText = enrichQueryWithFilters(query.text, filters);

    const phase1Count = Math.max(limit * PHASE1_MULTIPLIER, 8);
    const searchFilters = {
      type: filters.type ? [filters.type] : undefined,
      lang: filters.lang,
      collectionSlug: collectionSlug ?? undefined,
      quality_min: 'approved' as const,
    };

    // Step 1 — Vector candidates (limit × PHASE1_MULTIPLIER), already sorted by cosine desc
    const vectorCandidates = await this.searchService.search(enrichedText, searchFilters, phase1Count);

    // Step 1b — Keyword candidates from SQLite LIKE (same filters, same count)
    // Catches fragments the embedding model misses (e.g. domain-specific terms like "MIRAI")
    const keywordCandidates = await this.searchService.keywordSearch(enrichedText, searchFilters, phase1Count);
    const seen = new Set(vectorCandidates.map((c) => c.id));
    const allCandidates = [...vectorCandidates, ...keywordCandidates.filter((c) => !seen.has(c.id))];

    console.debug(
      `[retrieval][hybrid] section "${enrichedText.slice(0, 50)}" → ${vectorCandidates.length} vector + ${allCandidates.length - vectorCandidates.length} keyword candidates`,
    );

    if (allCandidates.length === 0) return [];

    // Keep raw vector scores for breakdown (before any RRF transformation)
    const vectorScoreMap = new Map(vectorCandidates.map((c) => [c.id, c.score]));

    // Step 2 — LLM batch judge on ALL candidates → Map<id, llm_score_0_10>
    const llmScoreMap = await this.batchJudge(query, allCandidates);

    // Step 3 — Build 2 ranked lists
    // List 1: vector order only (SQLite-only fragments absent → get 0 contribution from this list)
    const list1 = vectorCandidates.map((c) => ({ id: c.id, _data: c }));

    // List 2: all candidates sorted by LLM score desc
    const list2 = [...allCandidates]
      .sort((a, b) => (llmScoreMap.get(b.id) ?? LLM_NEUTRAL_SCORE) - (llmScoreMap.get(a.id) ?? LLM_NEUTRAL_SCORE))
      .map((c) => ({ id: c.id, _data: c }));

    // Step 4 — RRF fusion
    const fused = rrfFusion([list1, list2], this.rrfK, this.weights);

    // Step 5 — Apply LLM floor: drop fragments where LLM explicitly rejected (llm_score < floor)
    const floorFiltered = this.llmFloor > 0
      ? fused.filter(({ item }) => {
          const llmScore = llmScoreMap.get(item.id) ?? LLM_NEUTRAL_SCORE;
          if (llmScore < this.llmFloor) {
            console.debug(
              `[retrieval][hybrid] fragment ${item.id.slice(0, 8)} dropped by LLM floor (llm=${llmScore} < ${this.llmFloor})`,
            );
            return false;
          }
          return true;
        })
      : fused;

    // Step 6 — Build result with score_breakdown
    // SQLite-only fragments: vector_score=0, vector_rank=0 (sentinel: not in vector list)
    const list1IndexMap = new Map(list1.map((item, i) => [item.id, i + 1]));
    const list2IndexMap = new Map(list2.map((item, i) => [item.id, i + 1]));

    const results = floorFiltered.slice(0, limit).map(({ item, rrf_score }) => {
      const c = item._data;
      const vectorScore = Math.min(1.0, vectorScoreMap.get(c.id) ?? 0);
      const llmScore = llmScoreMap.get(c.id) ?? LLM_NEUTRAL_SCORE;
      const vectorRank = list1IndexMap.get(c.id) ?? 0;
      const llmRank = list2IndexMap.get(c.id) ?? 0;
      const normalizedScore = normalizeRrfScore(rrf_score, this.weights, this.rrfK);

      const breakdown: ScoreBreakdown = {
        method: 'hybrid_rrf',
        vector_score: vectorScore,
        vector_rank: vectorRank,
        llm_score: llmScore,
        llm_rank: llmRank,
        rrf_score,
        rrf_k: this.rrfK,
      };

      return {
        fragment_id: c.id,
        score: normalizedScore,
        title: c.title,
        body_excerpt: c.body_excerpt,
        quality: c.quality,
        type: c.type,
        score_breakdown: breakdown,
      } satisfies RetrievedFragment;
    });

    console.debug(
      `[retrieval][hybrid] section "${enrichedText.slice(0, 50)}" → returning top ${results.length} after RRF`,
    );
    return results;
  }
```

- [ ] **Step 2: Run all retrieval tests**

```bash
pnpm --filter @fragmint/server test -- --reporter=verbose 2>&1 | tail -40
```

Expected: all tests pass (including the 3 new HybridRetriever tests)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors

---

### Task 5: Full validation

- [ ] **Step 1: Run full test suite**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 2: Run lint**

```bash
pnpm lint 2>&1 | tail -20
```

Expected: no errors

---

## Self-Review

**Spec coverage:**
- ✅ `keywordSearch` public wrapper on `SearchService` → Task 1
- ✅ Hybrid: merge before LLM, early exit on `allCandidates.length === 0` → Task 4
- ✅ Hybrid: list1 = vector only, list2 = all candidates → Task 4
- ✅ Hybrid: SQLite-only gets `vector_score:0, vector_rank:0` → Task 4 + Task 2 (test)
- ✅ Vector: merge after search, dedup, threshold bypass for null scores → Task 3
- ✅ Invariants: no fake scores, quality_min filter applied to both sources → both tasks
- ✅ AgenticRetriever: not touched (already covers full index)

**No placeholders:** all steps contain complete code.

**Type consistency:** `searchFilters` variable typed consistently; `quality_min: 'approved' as const` needed for type narrowing in both retrievers.
